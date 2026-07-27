/**
 * src/modules/state/workflows/guild-root.ts
 *
 * Canonical state-module implementation for resolving the active Guild root.
 * Host-side hooks may remain compatibility adapters, but module callers never
 * depend on the host surface.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Resolve the nearest ancestor containing Guild state.
 *
 * `GUILD_ROOT` is an explicit override for hosts that launch outside the
 * workspace. Otherwise resolution walks upward from `startDir` (or cwd).
 */
export function resolveGuildRoot(startDir: string): string {
  const resolvedStart = path.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir: string | null = null;
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      try {
        if (fs.existsSync(guildDir) && fs.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
        // The candidate disappeared between exists/stat; continue upward.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}
