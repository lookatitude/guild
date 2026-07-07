/**
 * hooks/lib/guild-root.ts
 *
 * Usage: import { resolveGuildRoot } from "./lib/guild-root.js";
 *
 * resolveGuildRoot(startCwd)
 *   Walk UP from startCwd to the nearest ancestor directory that contains
 *   a `.git` entry (file for worktrees, directory for normal repos) OR an
 *   existing `.guild/` directory.  Returns that ancestor path.
 *
 *   Falls back to startCwd when no such ancestor is found up to the
 *   filesystem root — preserves no-repo / isolated-directory behaviour and
 *   never throws.
 *
 * Invariant: `.guild/` must only ever land at a repo root, never in a
 * subdirectory.  Every hook that writes `.guild/runs/…` should call this
 * helper and use the returned root rather than the raw `cwd` supplied by
 * Claude Code's hook payload.
 *
 * Precedence contract (unchanged from before):
 *   GUILD_RUN_DIR (or any other explicit env override) still wins outright.
 *   GUILD_CWD / payload.cwd / process.cwd() is still the *starting* cwd.
 *   Only the fallback path-join switches from raw cwd to the walked-up root.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Walk from startCwd upward until we hit an ancestor that has `.git` or
 * `.guild/`.  Returns the ancestor path.  Falls back to startCwd when no
 * such ancestor exists (e.g. running outside any repo).
 */
export function resolveGuildRoot(startCwd: string): string {
  let current = path.resolve(startCwd);

  for (;;) {
    // .git can be a directory (normal repo) or a file (git worktree).
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }

    // .guild must be a directory (not a file) to count as an anchor.
    const guildDir = path.join(current, ".guild");
    if (fs.existsSync(guildDir)) {
      try {
        if (fs.statSync(guildDir).isDirectory()) {
          return current;
        }
      } catch {
        // stat failed (e.g. race with deletion) — keep walking
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding an anchor — fall back to the
      // original startCwd so no-repo behaviour is preserved.
      return path.resolve(startCwd);
    }
    current = parent;
  }
}
