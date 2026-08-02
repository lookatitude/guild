/**
 * src/modules/config/workflows/host-open-preflight.ts
 *
 * Host-neutral startup/preflight contract (spec init-config-goal §O lines 96-99,
 * §E step 3, §V1/§V2). DESIGN CONTRACT authored on lane L1 (run-8202a843):
 * this file pins the TYPES + SIGNATURES that host adapters (L3) and the init /
 * repair APIs (L2) bind to. Function BODIES are L2's implementation work — the
 * stubs throw so the contract is importable but cannot be silently half-wired.
 *
 * STRUCTURED DATA ONLY — these functions return data describing what an adapter
 * should render; they NEVER render UI, prompt, or write files. Adapters render;
 * `initializeGuild` / `repairGuildInstall` write (spec §O line 105, V10).
 *
 * Module: config — pure detection + node builtins; no host/runtime imports.
 */

import * as fs from "fs";
import { sealSet } from "../../kernel";
import * as path from "path";
import type { ScaffoldEntry } from "./init-scaffold-manifest";
import { requiredEntriesFor } from "./init-scaffold-manifest";
import {
  discoverWorkspace,
  parseWorkspaceManifest,
} from "./workspace-manifest";
import { advisoryMessage } from "./init-config-copy";

// ===========================================================================
// detectGuildState — install-state + workspace-mode detection from cwd
// ===========================================================================

/** Schema version stamped on a detection result. */
export const GUILD_STATE_SCHEMA_VERSION = "guild.guild_state.v1" as const;

/**
 * Install + topology state of a `cwd` (spec §O line 98).
 * - `not_installed`          — no `.guild/` at cwd and cwd is not under a workspace root.
 * - `single_project`         — cwd has `.guild/` (no workspace.json), required floor present.
 * - `workspace_root`         — cwd has `.guild/workspace.json` with is_workspace:true, floor present.
 * - `workspace_child`        — cwd is under an ancestor workspace root; cwd has its own `.guild/`.
 * - `installed_needs_repair` — `.guild/` present but malformed/incomplete (NEVER a silent single fallback, NEVER a crash).
 */
export type GuildState =
  | "not_installed"
  | "single_project"
  | "workspace_root"
  | "workspace_child"
  | "installed_needs_repair";

/** A single piece of evidence backing the classification (spec §O line 98 "with evidence paths"). */
export interface GuildStateEvidence {
  /** What this evidence is about. */
  readonly kind:
    | "guild_dir"
    | "workspace_json"
    | "settings_json"
    | "ancestor_workspace"
    | "child_git_repo"
    | "manifest_entry";
  /** Absolute path the evidence refers to. */
  readonly path: string;
  /** Whether the path was found to exist / be valid. */
  readonly present: boolean;
  /** Optional detail (e.g. "is_workspace:true", "JSON parse error at offset N"). */
  readonly detail?: string;
}

/**
 * Why an install is `installed_needs_repair`. Exactly the two V1-mandated
 * problem codes. `null` for every non-repair state.
 */
export interface GuildStateProblem {
  readonly problem: "malformed_workspace_json" | "missing_required_manifest_entry";
  /** Absolute path of the malformed file or the first missing required entry. */
  readonly path: string;
  /** Optional human detail for the repair report. */
  readonly detail?: string;
}

/** Result of `detectGuildState(cwd)`. */
export interface GuildStateResult {
  readonly schema_version: typeof GUILD_STATE_SCHEMA_VERSION;
  readonly state: GuildState;
  /** Absolute cwd the detection ran for. */
  readonly cwd: string;
  /**
   * Absolute path of the governing `.guild/` root for this session:
   * cwd for single_project / workspace_root / workspace_child / single-project repair;
   * cwd even for a child (the child owns its project layer). `null` for not_installed.
   */
  readonly projectRoot: string | null;
  /**
   * Absolute path of the ancestor (or self) workspace root, when one applies:
   * cwd for workspace_root; the discovered ancestor for workspace_child; else `null`.
   */
  readonly workspaceRoot: string | null;
  /** The required-floor entries that were checked for this mode (mirror of requiredEntriesFor). */
  readonly checkedRequired: readonly ScaffoldEntry[];
  /** Ordered evidence supporting the classification. */
  readonly evidence: readonly GuildStateEvidence[];
  /** Populated ONLY when state === "installed_needs_repair"; otherwise null. */
  readonly problem: GuildStateProblem | null;
}

/**
 * Detect Guild install state + workspace topology from `cwd`. Pure, read-only,
 * crash-free (all fs/JSON access wrapped; malformed → installed_needs_repair).
 *
 * Detection and the resolver MUST agree on what "a workspace root" is. L2 implements
 * BOTH against ONE shared `parseWorkspaceManifest(path)` helper (extract from the
 * resolver's `discoverWorkspace`, settings-reader.ts) so the two never diverge; the
 * rules below mirror that helper's CURRENT behavior exactly (parse-error vs is_workspace).
 *
 * Algorithm (L2 implements; pinned here as the contract):
 *  1a. cwd `.guild/workspace.json` is the INSTALL/REPAIR target — presence COMMITS to
 *     the workspace-root interpretation; it is NEVER reinterpreted as single_project:
 *       - JSON parse error            → installed_needs_repair{malformed_workspace_json, path}.
 *       - parsed, `is_workspace` !== true (false or missing) → installed_needs_repair{
 *         malformed_workspace_json, path}. (Closes the V1 hole — a present-but-invalid
 *         workspace.json at cwd must NOT fall through to step 4/single_project.)
 *       - parsed, `is_workspace === true` → go to step 2.
 *     (Deeper field validation beyond `is_workspace` is whatever the shared
 *     `parseWorkspaceManifest` enforces — keep cwd and ancestor on the SAME validator;
 *     do not add cwd-only shape checks the resolver won't also apply.)
 *  1b. ANCESTOR walk (EXCLUSIVE of cwd) — mirror the resolver's `discoverWorkspace`:
 *       - JSON parse error            → SKIP, continue up (F4).
 *       - parsed, `is_workspace === true`  → ancestor workspace root → cwd is workspace_child.
 *       - parsed, `is_workspace` !== true  → STOP the walk (deliberate opt-out; returns
 *         no ancestor) — cwd is NOT a child; fall through to step 4/5.
 *  2. cwd has a VALID `.guild/workspace.json` (is_workspace === true) → workspace_root;
 *     verify requiredEntriesFor("workspace_root"); first missing →
 *     needs_repair{missing_required_manifest_entry, path}.
 *  3. cwd is under an ancestor workspace root → workspace_child; verify
 *     requiredEntriesFor("workspace_child"); first missing → needs_repair.
 *  4. cwd has `.guild/` AND NO workspace.json at cwd AND no ancestor workspace →
 *     single_project; verify requiredEntriesFor("single_project"); first missing →
 *     needs_repair. (Only reachable when no workspace.json exists at cwd — a present
 *     one was already resolved in step 1/2.)
 *  5. No `.guild/` at cwd and no ancestor workspace → not_installed.
 * Never silently fall back to single_project on malformed/incomplete (V1).
 */
export function detectGuildState(cwd: string): GuildStateResult {
  const evidence: GuildStateEvidence[] = [];
  const guildDir = path.join(cwd, ".guild");
  const guildDirPresent = safeIsDir(guildDir);
  evidence.push({ kind: "guild_dir", path: guildDir, present: guildDirPresent });

  // -- Step 1a: cwd's OWN .guild/workspace.json (INCLUSIVE of cwd) ----------
  // Presence COMMITS to the workspace-root interpretation; a present-but-invalid
  // manifest at cwd is needs_repair, never a silent single_project fallback (V1).
  const cwdManifestPath = path.join(guildDir, "workspace.json");
  const cwdParsed = parseWorkspaceManifest(cwdManifestPath);

  if (cwdParsed.status === "parse_error") {
    evidence.push({
      kind: "workspace_json",
      path: cwdManifestPath,
      present: true,
      detail: `JSON parse error: ${cwdParsed.error}`,
    });
    return repairResult(
      cwd,
      "workspace_root",
      { problem: "malformed_workspace_json", path: cwdManifestPath, detail: cwdParsed.error },
      evidence,
    );
  }
  if (cwdParsed.status === "not_workspace") {
    evidence.push({
      kind: "workspace_json",
      path: cwdManifestPath,
      present: true,
      detail: "present but is_workspace !== true",
    });
    return repairResult(
      cwd,
      "workspace_root",
      {
        problem: "malformed_workspace_json",
        path: cwdManifestPath,
        detail: "workspace.json present but is_workspace !== true",
      },
      evidence,
    );
  }
  if (cwdParsed.status === "workspace") {
    evidence.push({
      kind: "workspace_json",
      path: cwdManifestPath,
      present: true,
      detail: "is_workspace:true",
    });
    // Step 2: valid workspace_root — verify the workspace-root required floor.
    return verifyFloor(cwd, "workspace_root", cwd, evidence);
  }

  // cwdParsed.status === "absent" → no workspace.json at cwd.
  evidence.push({ kind: "workspace_json", path: cwdManifestPath, present: false });

  // -- Step 1b/3: ancestor walk (EXCLUSIVE of cwd) -------------------------
  // Shares the resolver's discoverWorkspace (same parseWorkspaceManifest classifier):
  // parse_error skips, is_workspace!==true stops, is_workspace===true → ancestor.
  const ancestor = discoverWorkspace(cwd);
  if (ancestor) {
    const ancestorManifestPath = path.join(ancestor.rootDir, ".guild", "workspace.json");
    evidence.push({
      kind: "ancestor_workspace",
      path: ancestorManifestPath,
      present: true,
      detail: "is_workspace:true",
    });
    if (guildDirPresent) {
      // Step 3: cwd is a workspace_child (under an ancestor; owns its own .guild/).
      return verifyFloor(cwd, "workspace_child", ancestor.rootDir, evidence);
    }
    // Under a workspace but cwd has no .guild/ of its own → not yet installed
    // here. Init will offer to create the child project (workspaceRoot carried so
    // the prompt can default to a child under the ancestor).
    return notInstalledResult(cwd, ancestor.rootDir, evidence);
  }

  // -- Step 4: single_project (cwd has .guild/, no workspace.json, no ancestor) --
  if (guildDirPresent) {
    return verifyFloor(cwd, "single_project", null, evidence);
  }

  // -- Step 5: nothing at cwd and no ancestor workspace → not_installed -----
  return notInstalledResult(cwd, null, evidence);
}

// ---------------------------------------------------------------------------
// detectGuildState helpers (pure, crash-free)
// ---------------------------------------------------------------------------

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
function safeIsDir(p: string): boolean {
  const s = safeStat(p);
  return s !== null && s.isDirectory();
}
function safeExistsForEntry(absPath: string, kind: ScaffoldEntry["kind"]): boolean {
  const s = safeStat(absPath);
  if (s === null) return false;
  return kind === "dir" ? s.isDirectory() : s.isFile();
}

/** Resolve a manifest entry's repo-root-relative POSIX path against an absolute root. */
function resolveEntryPath(root: string, entry: ScaffoldEntry): string {
  const segments = entry.path.replace(/\/+$/, "").split("/");
  return path.join(root, ...segments);
}

/**
 * Verify the mode's required floor (`requiredEntriesFor(mode)`) on disk. First
 * missing required entry → installed_needs_repair{missing_required_manifest_entry};
 * else the clean `state`.
 */
function verifyFloor(
  cwd: string,
  mode: "single_project" | "workspace_root" | "workspace_child",
  workspaceRoot: string | null,
  evidence: GuildStateEvidence[],
): GuildStateResult {
  const checkedRequired = requiredEntriesFor(mode);
  let firstMissing: ScaffoldEntry | null = null;
  for (const entry of checkedRequired) {
    const abs = resolveEntryPath(cwd, entry);
    const present = safeExistsForEntry(abs, entry.kind);
    evidence.push({ kind: "manifest_entry", path: abs, present, detail: entry.path });
    if (!present && firstMissing === null) firstMissing = entry;
  }

  if (firstMissing !== null) {
    const missingAbs = resolveEntryPath(cwd, firstMissing);
    return {
      schema_version: GUILD_STATE_SCHEMA_VERSION,
      state: "installed_needs_repair",
      cwd,
      projectRoot: cwd,
      workspaceRoot,
      checkedRequired,
      evidence,
      problem: {
        problem: "missing_required_manifest_entry",
        path: missingAbs,
        detail: `required ${firstMissing.kind} '${firstMissing.path}' is missing`,
      },
    };
  }

  const state: GuildState = mode;
  return {
    schema_version: GUILD_STATE_SCHEMA_VERSION,
    state,
    cwd,
    projectRoot: cwd,
    workspaceRoot,
    checkedRequired,
    evidence,
    problem: null,
  };
}

/** Build an installed_needs_repair result for a malformed-manifest problem. */
function repairResult(
  cwd: string,
  mode: "single_project" | "workspace_root" | "workspace_child",
  problem: GuildStateProblem,
  evidence: GuildStateEvidence[],
): GuildStateResult {
  return {
    schema_version: GUILD_STATE_SCHEMA_VERSION,
    state: "installed_needs_repair",
    cwd,
    projectRoot: cwd,
    workspaceRoot: mode === "workspace_root" ? cwd : null,
    checkedRequired: requiredEntriesFor(mode),
    evidence,
    problem,
  };
}

function notInstalledResult(
  cwd: string,
  workspaceRoot: string | null,
  evidence: GuildStateEvidence[],
): GuildStateResult {
  return {
    schema_version: GUILD_STATE_SCHEMA_VERSION,
    state: "not_installed",
    cwd,
    projectRoot: null,
    workspaceRoot,
    checkedRequired: [],
    evidence,
    problem: null,
  };
}

// ===========================================================================
// Workspace suggestion (spec §E6 / V4) — structured data only
// ===========================================================================

/** Suggestion for how init should scaffold a not_installed root (§E6 / V4). */
export interface WorkspaceSuggestion {
  readonly root_kind: RootKind;
  /** Recommended INIT mode (see {@link InitMode}). */
  readonly recommended_mode: InitMode;
  /** Absolute paths of descendant directories (immediate OR nested, depth-bounded;
   *  not descended into once a `.git` is found) that are their own git repos. */
  readonly child_git_repos: readonly string[];
  /** The init branches an adapter must offer (always includes "skip"). */
  readonly branches: readonly ("single_project" | "multiple_repo_workspace" | "skip")[];
}

/** Dir names never descended into during the child-repo walk (noise / non-source). */
const CHILD_SCAN_SKIP_DIRS = new Set([".git", ".guild", "node_modules", ".hg", ".svn"]);
/** Bound the descent so a pathological deep tree can't stall detection (immediate + nested). */
const CHILD_SCAN_MAX_DEPTH = 6;

/**
 * Detect descendant directories that are their OWN git repo — immediate OR nested
 * (e.g. `packages/foo/.git`), per spec §E6/V4. A directory that IS a git repo is
 * recorded and NOT descended into (a repo nested inside a repo is that repo's
 * submodule/worktree, not a separate workspace child). `root` itself is never a child.
 */
export function detectChildGitRepos(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > CHILD_SCAN_MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory() || CHILD_SCAN_SKIP_DIRS.has(ent.name)) continue;
      const childDir = path.join(dir, ent.name);
      // A git repo marks itself with a `.git` dir (normal clone) or `.git` file (worktree/submodule).
      if (safeStat(path.join(childDir, ".git")) !== null) {
        out.push(childDir); // it's a repo — record and DO NOT descend into it
      } else {
        walk(childDir, depth + 1); // keep looking for nested repos
      }
    }
  };
  walk(root, 1);
  return out.sort();
}

/**
 * Entries that do NOT make a root "non-empty" for init purposes: the root's own VCS
 * dir, OS cruft, a bare `.gitignore`, and editor metadata. Per spec §E6/V4 an "empty"
 * root may legitimately carry these and still be offered single-vs-workspace.
 */
const EMPTY_ROOT_IGNORED = new Set([
  ".git", ".gitignore", ".gitattributes", ".DS_Store",
  ".vscode", ".idea", ".editorconfig", "Thumbs.db",
]);

/** True iff `root` has no entries other than the EMPTY_ROOT_IGNORED allowlist. */
function rootIsEmpty(root: string): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return false;
  }
  return entries.filter((e) => !EMPTY_ROOT_IGNORED.has(e)).length === 0;
}

/**
 * Compute the §E6 workspace suggestion for a root being initialized:
 *  - child git repos present  → recommend `workspace` (root_kind: has_child_repos).
 *  - empty root               → ask single vs workspace (root_kind: empty;
 *                               recommended_mode defaults to single_project, adapter shows both).
 *  - non-empty, no child repos → recommend `single_project` (still confirmed).
 * Returns structured data only — the prompt UI is the adapter's (L4) job.
 */
export function suggestWorkspaceMode(root: string): WorkspaceSuggestion {
  const childRepos = detectChildGitRepos(root);
  const branches = ["single_project", "multiple_repo_workspace", "skip"] as const;
  if (childRepos.length > 0) {
    return {
      root_kind: "has_child_repos",
      recommended_mode: "workspace",
      child_git_repos: childRepos,
      branches,
    };
  }
  if (rootIsEmpty(root)) {
    return {
      root_kind: "empty",
      recommended_mode: "single_project",
      child_git_repos: [],
      branches,
    };
  }
  return {
    root_kind: "non_empty_no_child_repos",
    recommended_mode: "single_project",
    child_git_repos: [],
    branches,
  };
}

// ===========================================================================
// hostOpenPreflight — per-session-start routing data for host adapters
// ===========================================================================

/** Schema version stamped on a preflight result. */
export const HOST_OPEN_PREFLIGHT_SCHEMA_VERSION = "guild.host_open_preflight.v1" as const;

/**
 * The CLI/file hosts that have a native config surface (NOT app/connector-blocked).
 * The blocked set is EXACTLY the 4 app/connector refuse hosts (OPEN blockers, L0
 * verdict) → preflight returns action:"blocked" for those, never a false-native render
 * path. Every other host id — the keep-CLI/file set PLUS the verified-multi-host new-CLI
 * (cursor / github-copilot / opencode / rovo-dev) and new-IDE (kiro / qoder / trae,
 * file-surface via agents-file) — is non-blocked (its native render degrades honestly
 * when unverified, but it is not an app/connector refusal).
 */
export const CLI_NATIVE_HOSTS: ReadonlySet<string> = sealSet([
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  // verified-multi-host new-CLI hosts
  "cursor",
  "github-copilot",
  "opencode",
  "rovo-dev",
  // verified-multi-host new-IDE hosts (file surface, agents-file bound)
  "kiro",
  "qoder",
  "trae",
], "CLI_NATIVE_HOSTS");

/** What the adapter should do next — DATA, not a rendered surface. */
export type PreflightAction = "proceed" | "offer_init" | "offer_repair" | "blocked";

/** Advisory copy code — message text comes from init-config-copy.ts (centralized, spec line 83). */
export interface PreflightAdvisory {
  readonly code: "ready" | "not_installed" | "needs_repair" | "host_unsupported";
  /** Centralized copy resolved from init-config-copy.ts. */
  readonly message: string;
}

/** Classification of the opened root for the init prompt (spec lines 85-92). */
export type RootKind = "empty" | "non_empty_no_child_repos" | "has_child_repos";

/**
 * The mode vocabulary `initializeGuild(cwd, mode)` accepts (spec §E step 4 / line 100):
 * `single_project | workspace`. DISTINCT from the detection/scaffold vocabulary
 * `ScaffoldMode` (whose workspace value is `workspace_root`) — the init prompt must speak
 * the initializer's language so L3/L4 never pass `workspace_root` into `initializeGuild`.
 * Mapping: detected `workspace_root` ⇄ init `workspace`; `single_project` is identical.
 */
export type InitMode = "single_project" | "workspace";

/** Init-prompt data for adapters to render natively (action === "offer_init"). */
export interface InitPromptData {
  /** Recommended INIT mode given root_kind (has_child_repos → "workspace"; else "single_project").
   *  This is the `initializeGuild` mode, NOT ScaffoldMode — see {@link InitMode}. */
  readonly recommended_mode: InitMode;
  readonly root_kind: RootKind;
  /** Absolute paths of detected immediate/nested child `.git/` repos (drives the workspace recommendation). */
  readonly child_git_repos: readonly string[];
  /** The branches the adapter must offer (always includes "skip"). */
  readonly branches: readonly ("single_project" | "multiple_repo_workspace" | "skip")[];
}

/** Result of `hostOpenPreflight(cwd, host)`. */
export interface HostOpenPreflightResult {
  readonly schema_version: typeof HOST_OPEN_PREFLIGHT_SCHEMA_VERSION;
  /** Host id this preflight ran for. */
  readonly host: string;
  readonly cwd: string;
  /** The underlying detection result. */
  readonly detection: GuildStateResult;
  /** What the adapter should do next. */
  readonly action: PreflightAction;
  /** True only when state ∈ {single_project, workspace_root, workspace_child} AND host can render. */
  readonly lifecycle_available: boolean;
  /** Centralized advisory copy + code. */
  readonly advisory: PreflightAdvisory;
  /** Present when action === "offer_init"; else null. */
  readonly init_prompt: InitPromptData | null;
  /** Present when action === "offer_repair"; else null. Mirrors detection.problem. */
  readonly repair_hint: GuildStateProblem | null;
  /**
   * Optional cache key a long-lived host may key a positive result on
   * (spec line 64): "<cwd>|<host>|<settings mtime+size fingerprint>". Correctness
   * never depends on cache hits; null when not computed.
   */
  readonly cache_fingerprint: string | null;
}

/**
 * Run host-open preflight for a session-start event (spec §O line 99, §V2).
 * Runs `detectGuildState(cwd)`, then maps state → action for the host:
 *  - not_installed                       → offer_init (with InitPromptData), lifecycle_available:false
 *  - installed_needs_repair              → offer_repair (with repair_hint),  lifecycle_available:false
 *  - single/workspace_root/workspace_child → proceed,    lifecycle_available:true
 *  - host ∉ CLI_NATIVE_HOSTS             → blocked, advisory.code:"host_unsupported" (L0 OPEN blocker)
 *
 * Returns structured data only — the adapter renders it through its native surface.
 */
export function hostOpenPreflight(cwd: string, host: string): HostOpenPreflightResult {
  const detection = detectGuildState(cwd);

  // Hosts without a native config surface in this build (the 4 app/connector
  // platforms + any unknown id) → blocked, no false-native path (L0 OPEN blocker).
  if (!CLI_NATIVE_HOSTS.has(host)) {
    return {
      schema_version: HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
      host,
      cwd,
      detection,
      action: "blocked",
      lifecycle_available: false,
      advisory: { code: "host_unsupported", message: advisoryMessage("host_unsupported") },
      init_prompt: null,
      repair_hint: null,
      cache_fingerprint: null,
    };
  }

  switch (detection.state) {
    case "not_installed": {
      const suggestion = suggestWorkspaceMode(cwd);
      return {
        schema_version: HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
        host,
        cwd,
        detection,
        action: "offer_init",
        lifecycle_available: false,
        advisory: { code: "not_installed", message: advisoryMessage("not_installed") },
        init_prompt: {
          recommended_mode: suggestion.recommended_mode,
          root_kind: suggestion.root_kind,
          child_git_repos: suggestion.child_git_repos,
          branches: suggestion.branches,
        },
        repair_hint: null,
        cache_fingerprint: null,
      };
    }
    case "installed_needs_repair":
      return {
        schema_version: HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
        host,
        cwd,
        detection,
        action: "offer_repair",
        lifecycle_available: false,
        advisory: { code: "needs_repair", message: advisoryMessage("needs_repair") },
        init_prompt: null,
        repair_hint: detection.problem,
        cache_fingerprint: null,
      };
    case "single_project":
    case "workspace_root":
    case "workspace_child":
    default:
      return {
        schema_version: HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
        host,
        cwd,
        detection,
        action: "proceed",
        lifecycle_available: true,
        advisory: { code: "ready", message: advisoryMessage("ready") },
        init_prompt: null,
        repair_hint: null,
        cache_fingerprint: null,
      };
  }
}
