import * as fs from "node:fs";
import * as path from "node:path";
// codex G-lane r1: scripts/stamp-recall-importance.ts writes wiki pages through
// exactly this shape. No string literal contains "wiki/" or ".guild/wiki", so a
// literal-shaped predicate missed it and its baseline entry was wrongly dropped.
export function stamp(cwd: string, page: string, body: string): void {
  const wikiDir = path.join(cwd, ".guild", "wiki");
  fs.writeFileSync(path.join(wikiDir, page), body);
}
