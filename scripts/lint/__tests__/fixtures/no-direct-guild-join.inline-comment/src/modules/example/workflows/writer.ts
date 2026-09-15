import * as path from "node:path";

/** Bypass pinned by codex G-lane r3 P2: an inline comment holding a quote. */
export function guildDir(cwd: string): string {
  return path.join(cwd /* "root" */, ".guild");
}
