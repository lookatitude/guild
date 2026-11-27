/**
 * hooks/lib/guild-managed.ts
 *
 * True when `absPath` lies inside a Guild-managed root: under `pluginRoot`, or under a
 * directory that holds a `.guild/` directory. Anything else (scratch dirs, home config,
 * unrelated repos) is outside Guild's scope.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { durableGuildDir } from "../../src/domains/state";

export function isUnderGuildManagedRoot(absPath: string, pluginRoot: string | null): boolean {
  const target = path.resolve(absPath);
  if (pluginRoot !== null) {
    const rel = path.relative(path.resolve(pluginRoot), target);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) return true;
  }
  let dir = path.dirname(target);
  for (;;) {
    try {
      if (fs.statSync(durableGuildDir(dir)).isDirectory()) return true;
    } catch {
      // not present at this level
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}
