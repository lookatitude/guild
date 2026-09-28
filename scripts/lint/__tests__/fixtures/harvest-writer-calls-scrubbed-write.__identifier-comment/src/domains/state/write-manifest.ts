import { writeFileSync } from "node:fs";
// D7: comments (.guild/wiki), identifiers (wiki_cas_conflict, root_wiki) and a
// string that is not a write path do not make this file a wiki writer.
export const wiki_cas_conflict = "wiki_cas_conflict";
const HINT = "(or GUILD_MEMORY_WIKI_ROOT=<path>/.guild/wiki)";
export function writeManifest(root_wiki: string, root: string): string {
  writeFileSync(`${root}/.guild/workspace.json`, "{}");
  return `${HINT} ${root_wiki}`;
}
