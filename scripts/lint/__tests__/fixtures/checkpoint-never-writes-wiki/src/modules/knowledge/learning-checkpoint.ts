import { writeFileSync } from "node:fs";
export function checkpoint(cwd: string): void {
  writeFileSync(`${cwd}/.guild/wiki/decisions/checkpoint.md`, "promoted");
}
