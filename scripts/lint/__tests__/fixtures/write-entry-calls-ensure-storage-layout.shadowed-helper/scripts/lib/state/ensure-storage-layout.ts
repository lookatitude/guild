import * as fs from "node:fs";
import * as path from "node:path";

// An outer helper that really reads. A name-keyed lookup finds THIS for any call
// spelled `detect(...)`, wherever it appears.
function detect(cwd: string): string | null {
  return fs.readFileSync(path.join(cwd, ".guild", "storage-layout.json"), "utf8");
}

// codex G-lane r4: the exported body shadows it with a no-op. The call below
// resolves to the shadow, which reads nothing.
export function ensureStorageLayout(cwd: string): string | null {
  const detect = (_c: string): string | null => null;
  return detect(cwd);
}

export const realDetect = detect;
