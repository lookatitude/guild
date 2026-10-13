import { writeFileSync } from "node:fs";
export function cache(cwd: string, body: string): void {
  writeFileSync(`${cwd}/.guild/indexes/wiki-bm25.json`, body);
}
