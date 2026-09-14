import { ensureStorageLayout } from "../src/modules/state/index";
void ensureStorageLayout;
export function seed(
  cwd: string,
  ensureStorageLayout: (c: string) => void,
): void {
  ensureStorageLayout(cwd);
  require("node:fs").mkdirSync(`${cwd}/.guild/wiki`, { recursive: true });
}
