import * as path from "node:path";

/** Bypass pinned by codex G-lane r1 P2: the same call split across lines. */
export function wikiDir(cwd: string): string {
  return path.join(
    cwd,
    ".guild",
    "wiki",
  );
}
