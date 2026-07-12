/**
 * scripts/lib/update-check.ts
 *
 * Channel-aware update detection (plugin-update-lifecycle G1 + G1-CH + G1-ALL).
 *
 * Core model — host-neutral:
 *   channel      = dev | stable (main) | beta (next), resolved from the install
 *                  itself (never guessed): a dev checkout/symlink wins; a Claude
 *                  marketplace clone's .git HEAD names the pinned branch; a
 *                  wrapper/agents-file install carries a guild.install_receipt.v1.
 *   staleness    = stable: installed semver < latest v* tag
 *                  beta:   installed commit SHA ≠ remote heads/next SHA
 *   remote state = ONE `git ls-remote` (tags + heads) against the source repo,
 *                  cached machine-level with a TTL. Session start NEVER hits the
 *                  network: the hook reads the cache and spawns a detached
 *                  refresh when the cache is stale (AC-4 fail-open).
 *
 * Every network/filesystem seam is injectable for tests.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  HOST_REGISTRY_ROWS,
  type HostId,
} from "../../src/modules/host-runtime/workflows/host-registry-schema";
import type { UpdateCaps } from "../../src/modules/host-runtime/workflows/host-capabilities-schema";

export const SOURCE_REPO_DEFAULT = "https://github.com/lookatitude/guild.git";
export const CACHE_SCHEMA = "guild.update_check_cache.v1";
export const RECEIPT_SCHEMA = "guild.install_receipt.v1";
export const RECEIPT_BASENAME = "guild-install-receipt.json";

export type Channel = "dev" | "stable" | "beta";
export type UpdateMode = "auto" | "notify" | "off";

// ── Semver ──────────────────────────────────────────────────────────────────

/** Parse "v2.1.0" / "2.1.0" (prerelease tags are ignored for stable staleness). */
export function parseSemver(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

export function semverLt(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}

/** Highest full-release v* tag (prereleases excluded — stable never targets an rc). */
export function latestStableTag(tags: string[]): string | null {
  let best: string | null = null;
  for (const t of tags) {
    if (!parseSemver(t)) continue;
    if (best === null || semverLt(best, t)) best = t;
  }
  return best;
}

// ── ls-remote parsing ───────────────────────────────────────────────────────

export interface RemoteState {
  latest_tag: string | null;
  next_head_sha: string | null;
  main_head_sha: string | null;
}

/** Parse `git ls-remote --tags --heads <repo>` output. */
export function parseLsRemote(raw: string): RemoteState {
  const tags: string[] = [];
  let next: string | null = null;
  let main: string | null = null;
  for (const line of raw.split("\n")) {
    const m = /^([0-9a-f]{40})\s+(\S+)$/.exec(line.trim());
    if (!m) continue;
    const [, sha, ref] = m;
    if (ref === "refs/heads/next") next = sha;
    else if (ref === "refs/heads/main") main = sha;
    else if (ref.startsWith("refs/tags/v") && !ref.endsWith("^{}")) {
      tags.push(ref.slice("refs/tags/".length));
    }
  }
  return { latest_tag: latestStableTag(tags), next_head_sha: next, main_head_sha: main };
}

// ── Channel resolution ──────────────────────────────────────────────────────

export interface InstallReceipt {
  schema_version: string;
  host: string;
  channel: "stable" | "beta";
  ref: string;
  commit: string | null;
  version: string;
  installed_at: string;
}

export interface InstallState {
  channel: Channel;
  /** Installed plugin.json version. */
  version: string | null;
  /** Installed commit SHA when known (marketplace clone HEAD or receipt). */
  commit: string | null;
  /** How the channel was determined — for the signal line + telemetry. */
  source: "dev-checkout" | "marketplace-clone" | "receipt" | "default";
}

/**
 * Resolve a `.git` PATH to the real git directory: a normal clone has a `.git`
 * DIR; a git worktree (and some marketplace layouts) has a `.git` FILE whose
 * content is `gitdir: <path>` — follow it (one level; relative paths resolve
 * against the file's parent). Returns null when neither shape matches.
 */
export function resolveGitDir(
  gitPath: string,
  fsi: Pick<typeof fs, "existsSync" | "readFileSync" | "statSync"> = fs
): string | null {
  try {
    const st = fsi.statSync(gitPath);
    if (st.isDirectory()) return gitPath;
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+)\s*$/m.exec(fsi.readFileSync(gitPath, "utf8"));
      if (!m) return null;
      const target = m[1].trim();
      return path.isAbsolute(target) ? target : path.resolve(path.dirname(gitPath), target);
    }
  } catch {
    // fall through
  }
  return null;
}

/** Read `.git/HEAD` (+ resolve the ref) with plain fs — no git exec. */
export function readGitHead(gitDir: string, fsi: Pick<typeof fs, "existsSync" | "readFileSync"> = fs): {
  branch: string | null;
  sha: string | null;
} {
  const headPath = path.join(gitDir, "HEAD");
  if (!fsi.existsSync(headPath)) return { branch: null, sha: null };
  const head = fsi.readFileSync(headPath, "utf8").trim();
  const refMatch = /^ref:\s*refs\/heads\/(\S+)$/.exec(head);
  if (!refMatch) {
    // Detached HEAD — the content is the SHA itself.
    return { branch: null, sha: /^[0-9a-f]{40}$/.test(head) ? head : null };
  }
  const branch = refMatch[1];
  // A worktree gitdir keeps HEAD locally but shares refs via `commondir`.
  const refRoots = [gitDir];
  const commondirFile = path.join(gitDir, "commondir");
  if (fsi.existsSync(commondirFile)) {
    const common = fsi.readFileSync(commondirFile, "utf8").trim();
    refRoots.push(path.isAbsolute(common) ? common : path.resolve(gitDir, common));
  }
  for (const root of refRoots) {
    const looseRef = path.join(root, "refs", "heads", branch);
    if (fsi.existsSync(looseRef)) {
      const sha = fsi.readFileSync(looseRef, "utf8").trim();
      return { branch, sha: /^[0-9a-f]{40}$/.test(sha) ? sha : null };
    }
    const packed = path.join(root, "packed-refs");
    if (fsi.existsSync(packed)) {
      for (const line of fsi.readFileSync(packed, "utf8").split("\n")) {
        const m = /^([0-9a-f]{40})\s+refs\/heads\/(\S+)$/.exec(line.trim());
        if (m && m[2] === branch) return { branch, sha: m[1] };
      }
    }
  }
  return { branch, sha: null };
}

export function branchToChannel(branch: string | null): Channel {
  if (branch === "next") return "beta";
  return "stable";
}

/**
 * Resolve the install's channel + identity from the plugin root.
 *
 * Order (most-specific wins):
 *  1. DEV — the root (or a symlink target) is a working checkout OUTSIDE the
 *     host's managed plugin area (e.g. the operator's live symlink into
 *     plugin/). Never checked, never auto-updated (AC-5).
 *  2. MARKETPLACE CLONE — the root sits under a managed plugin area AND has a
 *     .git dir: read HEAD branch/SHA (Claude Code; the @next pin is not
 *     exposed, but the clone's checked-out branch IS the channel).
 *  3. RECEIPT — guild-install-receipt.json at the package root (wrapper +
 *     agents-file hosts; written by install.sh).
 *  4. DEFAULT — stable, version-only compare.
 */
export function resolveInstallState(
  pluginRoot: string,
  opts: { homedir?: string; fsi?: typeof fs } = {}
): InstallState {
  const fsi = opts.fsi ?? fs;
  const home = opts.homedir ?? os.homedir();
  const real = (() => {
    try {
      return fsi.realpathSync(pluginRoot);
    } catch {
      return pluginRoot;
    }
  })();

  const version = readInstalledVersion(pluginRoot, fsi);
  // Compare in REAL path space on both sides — on macOS the tmp/home tree is
  // symlinked (/var → /private/var), so an unresolved prefix never matches a
  // realpath'd root.
  const managedRoots = [
    path.join(home, ".claude", "plugins"),
    path.join(home, ".config", "claude", "plugins"),
  ].map((m) => {
    try {
      return fsi.realpathSync(m);
    } catch {
      return m;
    }
  });
  const isManaged = managedRoots.some(
    (m) => real === m || real.startsWith(m + path.sep)
  );

  // Handles both clone shape (.git dir) and worktree shape (.git FILE with a
  // gitdir: pointer) — a worktree misread as no-git would silently fall to the
  // stable default and defeat beta SHA staleness (codex G-lane MAJOR).
  const gitDir = resolveGitDir(path.join(real, ".git"), fsi);
  if (gitDir) {
    const { branch, sha } = readGitHead(gitDir, fsi);
    if (!isManaged) {
      return { channel: "dev", version, commit: sha, source: "dev-checkout" };
    }
    return {
      channel: branchToChannel(branch),
      version,
      commit: sha,
      source: "marketplace-clone",
    };
  }

  const receiptPath = path.join(real, RECEIPT_BASENAME);
  if (fsi.existsSync(receiptPath)) {
    try {
      const r = JSON.parse(fsi.readFileSync(receiptPath, "utf8")) as InstallReceipt;
      if (r.schema_version === RECEIPT_SCHEMA) {
        return {
          channel: r.channel === "beta" ? "beta" : "stable",
          version: r.version ?? version,
          commit: r.commit ?? null,
          source: "receipt",
        };
      }
    } catch {
      // fall through to default
    }
  }

  return { channel: "stable", version, commit: null, source: "default" };
}

export function readInstalledVersion(pluginRoot: string, fsi: typeof fs = fs): string | null {
  try {
    const manifest = JSON.parse(
      fsi.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")
    ) as { version?: string };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

// ── Cache ───────────────────────────────────────────────────────────────────

export interface UpdateCache {
  schema_version: string;
  checked_at: string; // ISO
  source_repo: string;
  remote: RemoteState;
}

export function cachePath(homedir: string = os.homedir()): string {
  return path.join(homedir, ".guild", "update-check.json");
}

export function readCache(file: string, fsi: typeof fs = fs): UpdateCache | null {
  try {
    const c = JSON.parse(fsi.readFileSync(file, "utf8")) as UpdateCache;
    return c.schema_version === CACHE_SCHEMA ? c : null;
  } catch {
    return null;
  }
}

export function cacheIsFresh(cache: UpdateCache | null, ttlHours: number, now: Date): boolean {
  if (!cache) return false;
  const age = now.getTime() - Date.parse(cache.checked_at);
  return Number.isFinite(age) && age >= 0 && age < ttlHours * 3600_000;
}

/** Network refresh — the ONLY networked call in the mechanism. Fail-open. */
export function refreshCache(opts: {
  repo?: string;
  file?: string;
  now?: Date;
  runner?: (cmd: string, args: string[]) => string;
  fsi?: typeof fs;
}): UpdateCache | null {
  const repo = opts.repo ?? SOURCE_REPO_DEFAULT;
  const file = opts.file ?? cachePath();
  const fsi = opts.fsi ?? fs;
  const run =
    opts.runner ??
    ((cmd: string, args: string[]) =>
      execFileSync(cmd, args, { encoding: "utf8", timeout: 15_000 }));
  try {
    const raw = run("git", ["ls-remote", "--tags", "--heads", repo]);
    const cache: UpdateCache = {
      schema_version: CACHE_SCHEMA,
      checked_at: (opts.now ?? new Date()).toISOString(),
      source_repo: repo,
      remote: parseLsRemote(raw),
    };
    fsi.mkdirSync(path.dirname(file), { recursive: true });
    fsi.writeFileSync(file, JSON.stringify(cache, null, 2) + "\n", "utf8");
    return cache;
  } catch {
    return null; // offline / rate-limited / no git — silent (AC-4)
  }
}

// ── Staleness decision ──────────────────────────────────────────────────────

/**
 * AC-7: the per-host update capability row is the SoT for how a host checks
 * and applies updates. Unknown host ids return null (callers fall back to the
 * coarse hostKind mapping).
 */
export function updateCapsForHost(hostId: string | undefined): UpdateCaps | null {
  if (!hostId) return null;
  const row = HOST_REGISTRY_ROWS[hostId as HostId];
  return row ? row.capabilities.package.update : null;
}

export interface UpdateSignal {
  update_available: boolean;
  channel: Channel;
  installed: string; // human label: version or short SHA
  available: string | null;
  /** Host-appropriate one-command apply string (AC-3). */
  command: string | null;
  reason:
    | "dev-install"
    | "mode-off"
    | "no-cache"
    | "up-to-date"
    | "stable-newer-tag"
    | "beta-new-commit";
}

export function computeSignal(opts: {
  state: InstallState;
  cache: UpdateCache | null;
  hostKind?: "claude" | "wrapper" | "agents-file";
  /** Registry host id — when given, the AC-7 capability row supplies the command. */
  hostId?: string;
}): UpdateSignal {
  const { state, cache } = opts;
  const short = (sha: string | null) => (sha ? sha.slice(0, 7) : "unknown");
  const installedLabel =
    state.channel === "beta" ? short(state.commit) : state.version ?? "unknown";

  const base = {
    channel: state.channel,
    installed: installedLabel,
    available: null as string | null,
    command: null as string | null,
  };

  if (state.channel === "dev") {
    return { ...base, update_available: false, reason: "dev-install" };
  }
  if (!cache) {
    return { ...base, update_available: false, reason: "no-cache" };
  }

  // Command resolution: the AC-7 capability row wins; the coarse hostKind
  // mapping is the fallback for callers without a registry id.
  const rowCaps = updateCapsForHost(opts.hostId);
  const command = rowCaps
    ? rowCaps.command
    : opts.hostKind === "wrapper"
      ? "guild-run update"
      : opts.hostKind === "agents-file"
        ? "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update"
        : "claude plugin marketplace update guild && claude plugin update guild@guild";

  if (state.channel === "beta") {
    const remoteSha = cache.remote.next_head_sha;
    if (remoteSha && state.commit && remoteSha !== state.commit) {
      return {
        ...base,
        update_available: true,
        available: short(remoteSha),
        command,
        reason: "beta-new-commit",
      };
    }
    return { ...base, update_available: false, reason: "up-to-date" };
  }

  // stable
  const latest = cache.remote.latest_tag;
  if (latest && state.version && semverLt(state.version, latest)) {
    return {
      ...base,
      update_available: true,
      available: latest,
      command,
      reason: "stable-newer-tag",
    };
  }
  return { ...base, update_available: false, reason: "up-to-date" };
}

/** The one-line banner signal (AC-3: channel + installed → available + exact command). */
export function renderSignalLine(sig: UpdateSignal): string | null {
  if (!sig.update_available || !sig.available) return null;
  const channelLabel = sig.channel === "beta" ? "beta (next)" : "stable";
  return (
    `Guild update available on ${channelLabel}: ${sig.installed} → ${sig.available}` +
    (sig.command ? ` — run: ${sig.command}` : "")
  );
}
