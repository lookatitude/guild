/**
 * src/modules/state/workflows/storage-roots.ts
 *
 * The platform root abstraction (KTD15, proposal §9). Four external roots plus
 * the durable root, resolved once per call from the OS + environment.
 *
 *   durable    the repo's `.guild/` — truth only; survives a clone
 *   state      per-user runtime state that is NOT truth (journals, leases)
 *   cache      rebuildable derivations (sqlite, maps, catalogs, graphs)
 *   worktrees  managed git worktrees, a resource with an owner and a reaper
 *   temp       scratch (KTD34/R51) — deleted on close, swept after 24h
 *
 * Only `durable` lives under the repo. Everything else is OFF the repo, which is
 * the whole point of KTD15: `.guild/` holds what you would lose by deleting it.
 *
 * CONTRACT: pure path arithmetic. No mkdir, no stat, no clock, no network. The
 * caller materializes a directory at first write (lazy layout, proposal §6).
 */

import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

/** The five roots every storage decision resolves against. */
export interface GuildStorageRoots {
  /** `<activeRoot>/.guild` — durable truth, the only in-repo root. */
  durable: string;
  /** Per-user Guild state root (XDG_STATE_HOME / Application Support / LOCALAPPDATA). */
  state: string;
  /** Per-user Guild cache root (XDG_CACHE_HOME / Caches / LOCALAPPDATA). */
  cache: string;
  /** Managed-worktree root. */
  worktrees: string;
  /** Guild's namespaced subtree of the OS temp dir. */
  temp: string;
}

/** Injection seam: tests and fixtures override the platform without touching `process`. */
export interface StorageRootsOptions {
  /** The repo root the `.guild/` directory belongs to. */
  activeRoot: string;
  /** Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to `os.homedir()`. */
  homedir?: string;
  /** Defaults to `os.tmpdir()`. */
  tmpdir?: string;
}

/**
 * Explicit overrides, checked before the platform defaults. `GUILD_*_HOME` is the
 * supported way to relocate a root (test fixtures, sandboxes, CI); no production
 * code may hardcode an absolute scratch path (KTD34 lint).
 */
const OVERRIDE_KEYS = {
  state: "GUILD_STATE_HOME",
  cache: "GUILD_CACHE_HOME",
  worktrees: "GUILD_WORKTREE_HOME",
  temp: "GUILD_TEMP_HOME",
} as const;

/** The single directory name Guild owns inside every external root. */
export const GUILD_NAMESPACE = "guild";

function platformStateRoot(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return local ? path.join(local, "Guild", "state") : path.join(home, "AppData", "Local", "Guild", "state");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Guild", "state");
  }
  const xdg = env.XDG_STATE_HOME;
  return xdg ? path.join(xdg, GUILD_NAMESPACE) : path.join(home, ".local", "state", GUILD_NAMESPACE);
}

function platformCacheRoot(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return local ? path.join(local, "Guild", "cache") : path.join(home, "AppData", "Local", "Guild", "cache");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Caches", "Guild");
  }
  const xdg = env.XDG_CACHE_HOME;
  return xdg ? path.join(xdg, GUILD_NAMESPACE) : path.join(home, ".cache", GUILD_NAMESPACE);
}

/**
 * A stable, collision-resistant id for one Guild root, derived from its absolute
 * path. External roots are shared across every repo on the machine, so every
 * cache/state/temp path is keyed by this id — two checkouts of the same repo, or
 * two repos with the same basename, never share a cache.
 *
 * The basename prefix is for humans reading `ls`; the digest is what makes it unique.
 */
export function guildRootId(activeRoot: string): string {
  const abs = path.resolve(activeRoot);
  const digest = crypto.createHash("sha256").update(abs).digest("hex").slice(0, 12);
  const base = path.basename(abs).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "root";
  return `${base}-${digest}`;
}

/** Resolve the five roots. Pure; safe to call on every path lookup. */
export function resolveStorageRoots(opts: StorageRootsOptions): GuildStorageRoots {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.homedir ?? os.homedir();
  const tmp = opts.tmpdir ?? os.tmpdir();
  const activeRoot = path.resolve(opts.activeRoot);

  const override = (key: keyof typeof OVERRIDE_KEYS): string | null => {
    const raw = env[OVERRIDE_KEYS[key]];
    return raw && raw.trim() ? path.resolve(raw.trim()) : null;
  };

  const state = override("state") ?? platformStateRoot(platform, env, home);
  const cache = override("cache") ?? platformCacheRoot(platform, env, home);
  return {
    durable: path.join(activeRoot, ".guild"),
    state,
    cache,
    worktrees: override("worktrees") ?? path.join(cache, "worktrees"),
    temp: override("temp") ?? path.join(tmp, GUILD_NAMESPACE),
  };
}
