import * as path from "node:path";

declare function resolveRoot(cwd: string): string;

/** Bypass pinned by codex G-lane r4 P2: two levels of nested parentheses. */
export function guildDir(): string {
  return path.join(resolveRoot(process.cwd()), ".guild");
}
