/**
 * src/modules/state/workflows/storage-layout.ts
 *
 * `GuildStorage` — the ONE place production code may construct a `.guild/` path
 * (KTD15, proposal §10). Everything else asks this API.
 *
 * Four root profiles (proposal §21.5): `standalone`, `workspace-only`, `hybrid`,
 * `child`. The profile decides which of `project` / `workspace` is present, so a
 * caller cannot accidentally write workspace truth into a child repo.
 *
 * Lazy layout (proposal §6, R23): nothing here creates a directory. `ensureDir`
 * exists for the moment a writer actually writes, and the init floor is
 * `guild.yaml` + scoped config — no eager empty dirs, no fake registries.
 *
 * KTD16 freeze: `runs/`, `analysis/` and `recommendations/` keep their shipped
 * durable-relative paths this cut. `runRecord()` is the accessor; changing what it
 * returns is an operator decision, not a lane's.
 *
 * CONTRACT: path arithmetic + explicitly named fs operations. Accessors are pure;
 * only `ensureDir`, `closeRun` and the janitor touch disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { discoverGuild } from "./guild-discovery";
import {
  isContainedRealDir,
  readdirSafe,
  removeContainedEmptyDir,
  removeContainedTree,
} from "./storage-fs";
import {
  assertClassPlacement,
  assertSafeSegments,
  DURABLE_SUBTREES,
  type GuildScope,
  type StorageClass,
} from "./storage-policy";
import {
  guildRootId,
  resolveStorageRoots,
  type GuildStorageRoots,
  type StorageRootsOptions,
} from "./storage-roots";

/**
 * The durable POLICY config file per scope (U-CFG). `settings.json` was the v1
 * home and mixed policy with host/model inventory; the split keeps the inventory
 * out of git entirely (KTD22) and gives each scope one file to reason about.
 */
export const POLICY_CONFIG_FILES = Object.freeze({
  project: "config/project.json",
  workspace: "config/workspace.json",
});

/** Proposal §21.5. Which durable scopes this root owns. */
export type RootProfile = "standalone" | "workspace-only" | "hybrid" | "child";

/** Path accessors for one durable scope. */
export interface ScopedDurablePaths {
  /** The scope's config file. */
  config(): string;
  /** The canonical knowledge tree (see DURABLE_SUBTREES). */
  knowledge(...segments: string[]): string;
  /**
   * The definition tree (KTD20/KTD47). `definition("sources", id)` is the durable
   * home for an ingested blob and replaces the retired raw sources tree (R59).
   */
  definitions(...segments: string[]): string;
  initiative(status: "active" | "archived", id: string): string;
  /** KTD16-frozen run record root. */
  runRecord(runId: string, ...segments: string[]): string;
  artifact(...segments: string[]): string;
}

export interface GuildStorage {
  /** The repo root the durable tree hangs off. */
  readonly activeRoot: string;
  /** Stable id keying every external root. */
  readonly rootId: string;
  readonly profile: RootProfile;
  readonly root: GuildStorageRoots;

  /** Present iff the profile owns project scope. */
  readonly project?: ScopedDurablePaths;
  /** Present iff the profile owns workspace scope. */
  readonly workspace?: ScopedDurablePaths;

  /**
   * Shorthand for the active scope's definition tree. This is the accessor KTD47
   * names: `definition("sources", "<id>")`.
   */
  definition(...segments: string[]): string;

  /** Live run/runtime state, off the repo. */
  runtime(...segments: string[]): string;
  /** Rebuildable derivations, off the repo. */
  cache(...segments: string[]): string;
  /** Managed worktree for one lane of one run. */
  worktree(runId: string, laneId: string): string;
  /**
   * Scratch (KTD34/R51). With a run id the directory is run-scoped and deleted by
   * `closeRun`; without one it is session scratch the 24h janitor reclaims.
   */
  temporary(runId?: string, ...segments: string[]): string;

  /** Create a directory at first write. The lazy half of R23. */
  ensureDir(absPath: string): string;
  /**
   * Resource close: delete this run's scratch and runtime state, and reclaim only
   * EMPTY managed worktrees. Idempotent. Never deletes a populated worktree.
   */
  closeRun(runId: string): CloseRunResult;
}

export interface CloseRunResult {
  runId: string;
  /** Directories actually removed. */
  removed: string[];
  /** Managed resources left in place, each with the reason it was not reclaimed. */
  preserved: Array<{ path: string; reason: string }>;
}

export interface CreateStorageOptions extends Partial<Omit<StorageRootsOptions, "activeRoot">> {
  /** Override discovery (tests, fixtures). Defaults to `discoverGuild(cwd)`. */
  activeRoot?: string;
  profile?: RootProfile;
}


/**
 * `scope` is recorded for the caller's diagnostics only: the shipped layout does
 * NOT re-parent durable paths by scope this cut (see the receipt's §21/§26 delta —
 * KTD16 and the knowledge laws freeze the current shapes).
 */
function scopedPaths(
  guildDir: string,
  _scope: GuildScope,
  configFile: string,
): ScopedDurablePaths {
  const durable = (cls: StorageClass, ...segments: string[]): string => {
    // `definitionsRoot` is "" (the definition tree root IS `.guild/`), so drop
    // empty prefix segments before validating the caller's own segments.
    const parts = segments.filter((s) => s !== "");
    assertSafeSegments(parts);
    const abs = path.join(guildDir, ...parts);
    assertClassPlacement(cls, abs, guildDir);
    return abs;
  };
  return {
    config: () => durable("canonical", configFile),
    knowledge: (...segments) => durable("canonical", DURABLE_SUBTREES.knowledge, ...segments),
    definitions: (...segments) => {
      assertSafeSegments(segments);
      // Flatten first: `definition("sources/x")` and `definition("sources", "x")`
      // are the same request and must not resolve to two different homes
      // (codex G-lane r1 P2).
      const parts = segments.flatMap((seg) => seg.split(/[\\/]+/)).filter((p) => p !== "");
      const [head, ...rest] = parts;
      if (head === "sources") return durable("durable-record", DURABLE_SUBTREES.sources, ...rest);
      return durable("canonical", DURABLE_SUBTREES.definitionsRoot, ...parts);
    },
    initiative: (status, id) => durable("durable-record", DURABLE_SUBTREES.initiatives, status, id),
    runRecord: (runId, ...segments) => durable("durable-record", DURABLE_SUBTREES.runs, runId, ...segments),
    artifact: (...segments) => durable("durable-record", DURABLE_SUBTREES.artifacts, ...segments),
  };
}

function detectProfile(cwd: string, activeRoot: string): RootProfile {
  const d = discoverGuild(cwd);
  if (d.level === "workspace") {
    // A workspace root that also owns canonical knowledge of its own is hybrid.
    const own = path.join(activeRoot, ".guild", DURABLE_SUBTREES.knowledge);
    return fs.existsSync(own) ? "hybrid" : "workspace-only";
  }
  return d.workspaceRoot ? "child" : "standalone";
}

/** Build the storage API for one Guild root. */
export function createGuildStorage(cwd: string = process.cwd(), opts: CreateStorageOptions = {}): GuildStorage {
  const activeRoot = path.resolve(opts.activeRoot ?? discoverGuild(cwd).activeRoot);
  const roots = resolveStorageRoots({
    activeRoot,
    platform: opts.platform,
    env: opts.env,
    homedir: opts.homedir,
    tmpdir: opts.tmpdir,
  });
  const guildDir = roots.durable;
  const rootId = guildRootId(activeRoot);
  const profile = opts.profile ?? detectProfile(cwd, activeRoot);

  const external = (cls: StorageClass, base: string, ...segments: string[]): string => {
    assertSafeSegments(segments);
    const abs = path.join(base, ...segments);
    assertClassPlacement(cls, abs, guildDir);
    return abs;
  };

  // The config SPLIT (KTD22 / U-CFG): each scope's config is a POLICY file under
  // `.guild/config/`, not the v1 `settings.json` inventory grab-bag. This accessor
  // is the seam — repointing it here is what moves every caller at once.
  const project = profile === "workspace-only" ? undefined : scopedPaths(guildDir, "project", POLICY_CONFIG_FILES.project);
  const workspace =
    profile === "workspace-only" || profile === "hybrid"
      ? scopedPaths(guildDir, "workspace", POLICY_CONFIG_FILES.workspace)
      : undefined;
  const activeScope = project ?? workspace!;

  const runtimeBase = path.join(roots.state, "roots", rootId);
  const cacheBase = path.join(roots.cache, "roots", rootId);
  const tempBase = path.join(roots.temp, rootId);

  const storage: GuildStorage = {
    activeRoot,
    rootId,
    profile,
    root: roots,
    project,
    workspace,
    definition: (...segments) => activeScope.definitions(...segments),
    runtime: (...segments) => external("runtime", runtimeBase, ...segments),
    cache: (...segments) => external("cache", cacheBase, ...segments),
    worktree: (runId, laneId) => {
      assertSafeSegments([runId, laneId]);
      return external("managed-resource", roots.worktrees, rootId, runId, laneId);
    },
    temporary: (runId, ...segments) => {
      if (runId === undefined) return external("temporary", tempBase, "session", ...segments);
      assertSafeSegments([runId]);
      return external("temporary", tempBase, "runs", runId, ...segments);
    },
    ensureDir(absPath) {
      fs.mkdirSync(absPath, { recursive: true });
      return absPath;
    },
    closeRun(runId) {
      assertSafeSegments([runId]);
      const removed: string[] = [];
      const preserved: Array<{ path: string; reason: string }> = [];
      // Scratch first: it is never truth, so it goes unconditionally (R51) — but
      // every delete is CONTAINMENT-CHECKED against the root that owns it, on the
      // resolved path, so no component of the path can be a link out
      // (storage-fs.ts). `lstat` on the last component alone was not enough: a
      // pre-existing `runs -> /outside` link made `closeRun` delete `/outside/<id>`
      // (codex G-lane r3 P1).
      for (const [dir, owningRoot] of [
        [storage.temporary(runId), tempBase],
        [external("runtime", runtimeBase, "runs", runId), runtimeBase],
      ] as const) {
        const gone = removeContainedTree(dir, owningRoot);
        if (gone) removed.push(dir);
      }
      // Managed worktrees are resources, not scratch: only an EMPTY one is reclaimed.
      const worktreeRoot = path.join(roots.worktrees, rootId);
      const runWorktrees = path.join(worktreeRoot, runId);
      if (isContainedRealDir(runWorktrees, worktreeRoot)) {
        for (const lane of readdirSafe(runWorktrees)) {
          const laneDir = path.join(runWorktrees, lane);
          if (!isContainedRealDir(laneDir, runWorktrees)) {
            preserved.push({ path: laneDir, reason: "not a real directory Guild owns (symlink or special file)" });
            continue;
          }
          // A NON-EMPTY managed worktree is NEVER deleted by close.
          //
          // Two rounds of codex review killed every cheap "is it clean?" test:
          // a marker can be stale, mtimes can tie at filesystem granularity, and
          // a DELETED tracked file leaves no new mtime at all. Each miss costs a
          // user their uncommitted work, and none of them is worth the disk the
          // heuristic saves. So close reclaims only what provably holds nothing,
          // and a populated tree is handed to the resource reaper, which can
          // afford to ask git.
          if (readdirSafe(laneDir).length > 0) {
            preserved.push({
              path: laneDir,
              reason: "non-empty managed worktree — reclaimed by the resource reaper, never by close",
            });
            continue;
          }
          if (removeContainedEmptyDir(laneDir, runWorktrees)) removed.push(laneDir);
          else preserved.push({ path: laneDir, reason: "became non-empty during close" });
        }
        removeContainedEmptyDir(runWorktrees, worktreeRoot);
      }
      return { runId, removed, preserved };
    },
  };
  return storage;
}

// ---------------------------------------------------------------------------
// Platform cache homes (KTD15 / U-CFG)
// ---------------------------------------------------------------------------

/**
 * Host capability manifests and model catalogs are DISCOVERED facts about the
 * machine, not durable truth about the project. They live on the platform cache
 * root, so a clone carries no host identity and a stale pin cannot survive into
 * someone else's session (KTD22).
 *
 * Both helpers go through `GuildStorage.cache()` rather than joining a path, so
 * the class placement check runs and `no-direct-guild-join` stays satisfied.
 */
export function hostCapabilityCacheDir(cwd: string, hostId?: string): string {
  const storage = createGuildStorage(realRoot(cwd));
  return hostId === undefined ? storage.cache("hosts") : storage.cache("hosts", hostId);
}

/**
 * Resolve symlinks before the root id is derived.
 *
 * A DURABLE path is inside the repo, so a writer and a reader always agree on it
 * however they spelled the root. A CACHE path is keyed by a hash of the root, so
 * a symlinked temp root and its resolved spelling — one directory on macOS — key two different
 * caches, and one process writes a manifest the next cannot find. Resolving first
 * makes the key the directory, not the spelling. A path that does not exist yet
 * is returned unchanged; the caller is about to create it.
 */
function realRoot(cwd: string): string {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/** The capability manifest for one host id, on the platform cache root. */
export function hostCapabilityCacheFile(cwd: string, hostId: string): string {
  return path.join(hostCapabilityCacheDir(cwd, hostId), "capability.json");
}

/** Model-catalog snapshot home, on the platform cache root. */
export function modelCatalogCacheHome(cwd: string): string {
  return createGuildStorage(realRoot(cwd)).cache("model-catalog");
}
