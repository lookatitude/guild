import * as fs from "node:fs";
import * as path from "node:path";
// codex G-lane r2: a REAL fs read, inside a nested function the exported body
// never invokes. Walking the whole subtree finds the read and exempts a body
// that does no work; only reachable statements may count.
export function ensureStorageLayout(cwd: string): null {
  function unusedReader(): string {
    return fs.readFileSync(path.join(cwd, ".guild", "storage-layout.json"), "utf8");
  }
  void unusedReader;
  return null;
}
