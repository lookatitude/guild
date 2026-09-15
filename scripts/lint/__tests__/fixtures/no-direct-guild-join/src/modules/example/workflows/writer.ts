import * as path from "node:path";

/** Known positive for `no-direct-guild-join` (KTD15). */
export function wikiDir(cwd: string): string {
  return path.join(cwd, ".guild", "wiki");
}

export function runsDir(root: string): string {
  return `${root}/.guild/runs`;
}
