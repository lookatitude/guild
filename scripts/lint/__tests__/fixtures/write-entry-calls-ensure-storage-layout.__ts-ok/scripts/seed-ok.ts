import { writeFileSync as save } from "node:fs";
import { ensureStorageLayout } from "../src/modules/state/index";
export function seed(cwd: string): void {
  ensureStorageLayout(cwd);
  save(`${cwd}/.guild/guild.yaml`, "schema: guild.root.v1\n");
}
