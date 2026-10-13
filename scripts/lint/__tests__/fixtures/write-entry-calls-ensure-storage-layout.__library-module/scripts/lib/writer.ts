import { writeFileSync } from "node:fs";
// D4: a library with no process-entry guard. Its callers are the entries in scope.
export function write(cwd: string): void {
  writeFileSync(`${cwd}/.guild/runs/x.json`, "{}");
}
