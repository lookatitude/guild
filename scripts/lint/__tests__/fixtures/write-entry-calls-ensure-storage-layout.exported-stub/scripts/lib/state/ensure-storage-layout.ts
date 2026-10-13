// codex G-lane r1: an exported function with the right NAME and no marker read
// must NOT satisfy the law. Before the fix this tree was clean (the exemption
// keyed on the export alone); after it, it is flagged.
export function ensureStorageLayout(cwd: string): void {
  void cwd;
  void ".guild/storage-layout.json";
}

// D4: the real file is also a CLI (process.argv[1] guard), so it is a process entry.
if (process.argv[1]?.endsWith("ensure-storage-layout.js")) ensureStorageLayout(process.cwd());
