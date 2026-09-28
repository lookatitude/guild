// codex G-lane r2: a LOCALLY DEFINED function named readFileSync. A name-only
// check sees "readFileSync(...)" and exempts the file; nothing is ever read.
// The exemption must resolve the callee through the file's fs import bindings.
function readFileSync(_p: string): string {
  return "";
}
export function ensureStorageLayout(cwd: string): string {
  return readFileSync(`${cwd}/.guild/storage-layout.json`);
}

// D4: the real file is also a CLI (process.argv[1] guard), so it is a process entry.
if (process.argv[1]?.endsWith("ensure-storage-layout.js")) ensureStorageLayout(process.cwd());
