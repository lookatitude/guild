import * as path from "node:path";

/** Bypass pinned by codex G-lane r2 P2: a string with "//" on the same line. */
export function guildDir(cwd: string): string {
  const label = "a//b"; return label.length ? path.join(cwd, ".guild") : "";
}
