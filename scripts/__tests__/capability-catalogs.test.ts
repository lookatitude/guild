import * as fs from "fs";
import * as path from "path";
import {
  listOperationsRunbooks,
  listOperationsSkillIds,
} from "../../src/modules/operations";
import { listQualitySkillIds } from "../../src/modules/quality";
import {
  isSpecialistAgentId,
  isSpecialistSkillId,
  listSpecialistAgentIds,
  listSpecialistSkillPrefixes,
} from "../../src/modules/specialists";

const pluginRoot = path.resolve(__dirname, "../..");

function readManifest(moduleId: string): {
  owns?: {
    agents?: string[];
    skills?: string[];
    skill_id_prefixes?: string[];
  };
} {
  return JSON.parse(
    fs.readFileSync(
      path.join(pluginRoot, "src", "modules", moduleId, "module.manifest.json"),
      "utf8"
    )
  );
}

describe("capability module catalogs", () => {
  it("operations catalog matches the operations module manifest", () => {
    const manifest = readManifest("operations");
    expect(listOperationsSkillIds()).toEqual(manifest.owns?.skills);
    expect(listOperationsRunbooks().map((entry) => entry.skillId)).toEqual(
      (manifest.owns?.skills ?? []).filter((id) => id.startsWith("ops-"))
    );
  });

  it("quality catalog matches the quality module manifest", () => {
    const manifest = readManifest("quality");
    expect(listQualitySkillIds()).toEqual(manifest.owns?.skills);
  });

  it("specialists roster matches the specialists module manifest", () => {
    const manifest = readManifest("specialists");
    expect(listSpecialistAgentIds()).toEqual(manifest.owns?.agents);
    expect(listSpecialistSkillPrefixes()).toEqual(manifest.owns?.skill_id_prefixes);
  });

  it("specialists helpers recognize owned agents and skill prefixes only", () => {
    expect(isSpecialistAgentId("qa")).toBe(true);
    expect(isSpecialistAgentId("guild-quality")).toBe(false);
    expect(isSpecialistSkillId("qa-test-strategy")).toBe(true);
    expect(isSpecialistSkillId("guild-quality")).toBe(false);
  });
});
