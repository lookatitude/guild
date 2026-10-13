import { writeFileSync } from "node:fs";
export function seed(cwd: string): void {
  writeFileSync(`${cwd}/.guild/guild.yaml`, "schema: guild.root.v1\n");
}

// D4: process entry via require.main.
if (require.main === module) seed(process.cwd());
