import * as path from "node:path";

/**
 * Negative control: a consumer that took its base from the storage API and joins
 * ONLY below it is compliant — the `.guild` segment never appears here.
 */
export function wikiPage(guildDir: string, slug: string): string {
  return path.join(guildDir, "wiki", "decisions", `${slug}.md`);
}
