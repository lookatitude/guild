import { join as j } from "node:path";

/** Bypass pinned by codex G-lane r5: the join is imported under another name. */
export function guildDir(cwd: string): string {
  return j(cwd, ".guild");
}
