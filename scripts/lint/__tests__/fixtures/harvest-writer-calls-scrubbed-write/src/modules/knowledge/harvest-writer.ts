import { writeFileSync } from "node:fs";
export function promote(cwd: string, slug: string, body: string): void {
  writeFileSync(`${cwd}/.guild/wiki/decisions/${slug}.md`, body);
}
