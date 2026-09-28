import { ensureStorageLayout } from "../src/modules/state/index";
void ensureStorageLayout;
export function seed(
  cwd: string,
  ensureStorageLayout: (c: string) => void,
): void {
  ensureStorageLayout(cwd);
  require("node:fs").mkdirSync(`${cwd}/.guild/wiki`, { recursive: true });
}

// D4: process entry via a process.argv[1] guard.
if (process.argv[1]?.endsWith("seed-shadowed.js")) seed(process.cwd(), () => {});
