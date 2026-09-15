import * as path from "node:path";

declare function resolveRoot(opts: { cwd: string }): string;

/** Bypass pinned by codex G-lane r2 P2: an object literal in the first argument. */
export function guildDir(cwd: string): string {
  return path.join(resolveRoot({ cwd }), ".guild");
}
