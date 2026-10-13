import * as fs from "node:fs";
// D3 positive: the exemption is one exact path; a sibling writing the tree is flagged.
export function snapshot(guildDir: string, body: string): void {
  fs.writeFileSync(`${guildDir}/skill-versions/x.md`, body);
}
