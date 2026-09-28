import * as fs from "node:fs";
import * as path from "node:path";
// D7 positive: the wiki path is built by a local helper; the call-scoped rule
// follows the identifier into the helper body and still flags the write.
function pagePath(root: string, slug: string): string {
  return path.join(root, ".guild", "wiki", "decisions", `${slug}.md`);
}
export function promote(root: string, slug: string, body: string): void {
  fs.writeFileSync(pagePath(root, slug), body);
}
