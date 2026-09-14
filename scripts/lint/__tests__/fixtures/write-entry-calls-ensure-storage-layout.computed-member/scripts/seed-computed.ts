import * as fs from "node:fs";
export function seed(cwd: string): void {
  fs["writeFileSync"](`${cwd}/.guild/wiki/a.md`, "x");
}
