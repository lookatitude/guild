import * as path from "node:path";

/**
 * Negative control: the state storage layer is the ONE place that may construct
 * a .guild path, so the identical line must NOT be flagged here.
 */
export function guildDir(cwd: string): string {
  return path.join(cwd, ".guild");
}
