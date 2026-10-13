import * as fs from "node:fs";
// codex G-lane r2: the shape no path-assembly analysis caught. There is no
// path.join and no template literal — the segments are array elements joined by
// a method call. Under the raw-text rule this is a wiki writer because the file
// carries both tokens and touches an fs write API.
export function write(root: string, page: string, body: string): void {
  const target = [root, ".guild", "wiki", page].join("/");
  fs.writeFileSync(target, body);
}
