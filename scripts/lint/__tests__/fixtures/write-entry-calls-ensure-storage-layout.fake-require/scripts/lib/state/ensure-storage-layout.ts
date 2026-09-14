// codex G-lane r4: a LOCAL function named require. A rule that decides "this is a
// module load" from the callee's spelling reads `require("node:fs")` here as a real
// fs namespace binding; the checker resolves the identifier to this declaration,
// which is in this source file, so it is not the ambient require.
function require(_spec: string): { readFileSync(p: string, enc?: string): string } {
  return { readFileSync: () => "" };
}
const fs = require("node:fs");
export function ensureStorageLayout(cwd: string): string {
  return fs.readFileSync(`${cwd}/.guild/storage-layout.json`, "utf8");
}
