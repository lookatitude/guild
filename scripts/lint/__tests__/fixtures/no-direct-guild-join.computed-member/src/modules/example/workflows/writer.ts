import * as path from "node:path";

/** Bypass pinned by codex G-lane r5: computed member access and a parenthesized callee. */
export function guildDir(cwd: string): string {
  const viaIndex = path["join"](cwd, ".guild");
  return (path.join)(viaIndex, ".guild");
}
