import * as fs from "node:fs";

// codex G-lane r3: the shape that defeats a binding-NAME rule. `fs` IS a real
// namespace import at module scope, so a name-keyed check sees `fs.readFileSync`
// and passes — but inside the exported body `fs` is shadowed by a local object
// that reads nothing. Only the checker resolves the callee to the shadow.
export function ensureStorageLayout(cwd: string): string {
  const fs = {
    readFileSync(_p: string, _enc?: string): string {
      return "";
    },
  };
  return fs.readFileSync(`${cwd}/.guild/storage-layout.json`, "utf8");
}

// Keeps the module-scope import genuinely used, so the file is not trivially odd.
export function realStat(p: string): boolean {
  return fs.existsSync(p);
}

// D4: the real file is also a CLI (process.argv[1] guard), so it is a process entry.
if (process.argv[1]?.endsWith("ensure-storage-layout.js")) ensureStorageLayout(process.cwd());
