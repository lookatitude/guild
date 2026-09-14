import { ensureStorageLayout } from "../src/domains/state/index";
export function main(cwd: string): void {
  ensureStorageLayout(cwd); // marker read only — never composes or projects the surface
}
