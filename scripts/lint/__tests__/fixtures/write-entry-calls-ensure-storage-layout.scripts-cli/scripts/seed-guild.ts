import { writeFileSync } from "node:fs";
export function seed(cwd: string): void {
  writeFileSync(`${cwd}/.guild/guild.yaml`, "schema: guild.root.v1\n");
}
