// codex G-lane r1: an exported function with the right NAME and no marker read
// must NOT satisfy the law. Before the fix this tree was clean (the exemption
// keyed on the export alone); after it, it is flagged.
export function ensureStorageLayout(cwd: string): void {
  void cwd;
  void ".guild/storage-layout.json";
}
