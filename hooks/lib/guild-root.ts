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
 *   (Neither of these env overrides live inside this function — every
 *   caller resolves GUILD_RUN_DIR / GUILD_CWD / payload.cwd BEFORE calling
 *   resolveGuildRoot(); this helper only ever sees the already-chosen
 *   starting cwd. There is no env short-circuit to preserve here.)
 *
 * .git-first precedence (fixes a mis-rooting defect):
 *   A NEAREST-.git-ANCESTOR-WINS rule takes priority over `.guild/`. The walk
 *   scans the FULL ancestry chain up to the filesystem root for a `.git`
 *   entry; the nearest ancestor that has one is returned immediately, even
 *   if a bare `.guild/` directory sits closer to startCwd. This matters
 *   because a stale/nested `.guild/` left over in a subdirectory (e.g. an
 *   old `scripts/.guild/` from a prior bug, or a leftover from tooling) must
 *   never capture the walk before the real repo root is reached — that used
 *   to permanently mis-root telemetry into the stale subdirectory instead of
 *   the actual repo root.
 *
 *   Only when NO ancestor up to the filesystem root has `.git` do we fall
 *   back to the nearest ancestor with a bare `.guild/` directory. If neither
 *   is found anywhere in the ancestry, we fall back to startCwd itself
 *   (preserves no-repo / isolated-directory behaviour and never throws).
 *
 *   This resolves correctly for the umbrella-workspace layout too: a hook
 *   running inside `<repo>/` (which has its own `.git`) anchors at `<repo>/`
 *   because that's the NEAREST `.git`, even though an umbrella root further
 *   up also has `.git` + `.guild/` — the walk stops at the first (nearest)
 *   `.git` hit, so each repo still gets exactly one `.guild/` at its own
 *   root. A hook running at the umbrella root itself anchors there for the
 *   same reason (nearest `.git` is the umbrella root's own).
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Walk from startCwd upward to the filesystem root, applying .git-first
 * precedence: the nearest ancestor containing `.git` wins outright, even
 * over a nearer bare `.guild/`. Only when no ancestor anywhere up the chain
 * has `.git` do we fall back to the nearest ancestor with a bare `.guild/`.
 * Falls back to startCwd when neither is found anywhere in the ancestry
 * (e.g. running outside any repo).
 *
 * Implemented as a single upward walk that tracks the nearest `.guild/`
 * candidate seen so far while still scanning every remaining ancestor for
 * `.git` — semantically equivalent to two passes (git-scan, then
 * guild-fallback) without walking the ancestry twice.
 */
export function resolveGuildRoot(startCwd: string): string {
  const resolvedStart = path.resolve(startCwd);
  let current = resolvedStart;
  let nearestGuildDir: string | null = null;

  for (;;) {
    // .git can be a directory (normal repo) or a file (git worktree).
    // A .git hit at ANY ancestor outranks a .guild/ hit at a nearer one —
    // this is the fix: don't stop early just because .guild/ showed up
    // first while walking bottom-up.
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }

    // .guild must be a directory (not a file) to count as an anchor.
    // Only remember the FIRST (nearest) one we see; keep walking past it
    // in case a .git shows up further up the chain.
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      if (fs.existsSync(guildDir)) {
        try {
          if (fs.statSync(guildDir).isDirectory()) {
            nearestGuildDir = current;
          }
        } catch {
          // stat failed (e.g. race with deletion) — keep walking
        }
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding a .git ancestor anywhere.
      // Fall back to the nearest .guild/ ancestor if one was seen, else to
      // the original startCwd so no-repo behaviour is preserved.
      return nearestGuildDir ?? resolvedStart;
    }
    current = parent;
  }
}
