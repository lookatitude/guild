import * as path from "node:path";

/** Bypass pinned by codex G-lane r5: a parenthesized and a concatenated literal. */
export function guildDir(cwd: string): string {
  const a = path.join(cwd, (".guild"));
  return path.join(a, "." + "guild");
}
