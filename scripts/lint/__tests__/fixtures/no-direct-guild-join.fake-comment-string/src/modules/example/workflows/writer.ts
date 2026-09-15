import * as path from "node:path";

/** Bypass pinned by codex G-lane r4 P2: strings that look like comment delimiters. */
export function guildDir(cwd: string): string {
  const open = "/*"; const dir = path.join(cwd, ".guild"); const close = "*/";
  return open + dir + close;
}
