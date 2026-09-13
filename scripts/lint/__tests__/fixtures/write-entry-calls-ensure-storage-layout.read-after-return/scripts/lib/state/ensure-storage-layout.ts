import * as fs from "node:fs";
import * as path from "node:path";
// codex G-lane r3: a REAL fs read on a REAL fs import, parked after an
// unconditional return. It never executes, so it must not satisfy the law.
export function ensureStorageLayout(cwd: string): string | null {
  return null;
  // eslint-disable-next-line no-unreachable
  return fs.readFileSync(path.join(cwd, ".guild", "storage-layout.json"), "utf8");
}
