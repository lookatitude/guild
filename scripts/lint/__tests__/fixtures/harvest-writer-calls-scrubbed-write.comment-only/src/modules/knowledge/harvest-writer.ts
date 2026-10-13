import { writeFileSync } from "node:fs";
// Security note: this should go through scrubbedWrite (it does not).
export function promote(cwd: string, slug: string, body: string): void {
  writeFileSync(`${cwd}/.guild/wiki/decisions/${slug}.md`, body);
}
