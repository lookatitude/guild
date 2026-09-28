import * as fs from "node:fs";
// D3: the KTD48 step names skill-versions/ in order to DELETE the leftover tree.
export function dropSkillVersions(guildDir: string): void {
  fs.rmSync(`${guildDir}/skill-versions`, { recursive: true, force: true });
}
