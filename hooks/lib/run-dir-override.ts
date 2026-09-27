/**
 * `GUILD_RUN_DIR`, honoured only when it is a non-empty ABSOLUTE path (F4).
 *
 * A bare `??` accepts "" (an empty string is not nullish), and every write then
 * lands at a RELATIVE path under whatever cwd the hook inherited. An unusable
 * override is treated as absent so the caller falls back to its own resolved
 * run directory; a hook never writes outside the run tree it resolved.
 */

import * as path from "node:path";

export function runDirOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env["GUILD_RUN_DIR"];
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  return path.isAbsolute(raw) ? raw : undefined;
}
