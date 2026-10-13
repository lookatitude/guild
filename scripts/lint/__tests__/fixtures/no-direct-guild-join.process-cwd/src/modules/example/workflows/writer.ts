import * as path from "node:path";

/** Bypass pinned by codex G-lane r1 P2: a CALL in the first argument. */
export function guildDir(): string {
  return path.join(process.cwd(), ".guild");
}
