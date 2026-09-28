import * as fs from "node:fs";
export function seed(cwd: string): void {
  fs["writeFileSync"](`${cwd}/.guild/wiki/a.md`, "x");
}

// D4: process entry via a top-level statement that reads process.argv.
seed(process.argv[2] ?? process.cwd());
