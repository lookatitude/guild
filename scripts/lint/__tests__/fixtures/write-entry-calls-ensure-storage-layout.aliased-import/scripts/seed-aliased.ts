import { writeFileSync as save } from "node:fs";
export function seed(cwd: string): void {
  save(`${cwd}/.guild/guild.yaml`, "schema: guild.root.v1\n");
}
