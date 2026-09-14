import * as fs from "node:fs";
import * as path from "node:path";
// The real shape: the exported entry delegates to a helper that reads the marker.
function detect(cwd: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(cwd, ".guild", "storage-layout.json"), "utf8");
    return (JSON.parse(raw) as { storage_layout_version?: number }).storage_layout_version ?? null;
  } catch { return null; }
}
export function ensureStorageLayout(cwd: string): number | null {
  return detect(cwd);
}
