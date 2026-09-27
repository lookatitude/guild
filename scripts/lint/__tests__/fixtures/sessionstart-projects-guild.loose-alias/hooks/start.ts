// The provisional aliases `compose` / `project` no longer satisfy the pinned chain.
import { ensureStorageLayout } from "./lib/ensure-layout";
declare function compose(): void;
declare function project(): void;
export function main(cwd: string): void {
  ensureStorageLayout(cwd);
  compose();
  project();
}
