import * as fs from "fs";
import * as path from "path";
import { parseFrontmatter } from "../lib/frontmatter";
import {
  listOperationsRunbooks,
  listOperationsSkillIds,
} from "../../src/modules/operations";
import { listQualitySkillIds } from "../../src/modules/quality";
import {
  isMachineryAgentId,
  isSpecialistSkillId,
  isSpecialistTemplateId,
  listMachineryAgentIds,
  listSpecialistSkillPrefixes,
  listSpecialistTemplateIds,
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

  it("specialists catalog matches the specialists module manifest", () => {
    const manifest = readManifest("specialists");
    expect(listMachineryAgentIds()).toEqual(manifest.owns?.agents);
    expect(listSpecialistSkillPrefixes()).toEqual(manifest.owns?.skill_id_prefixes);
  });

  it("machinery agents = agents/*.md; template ids = templates/specialists/*.md (both filesystem-pinned)", () => {
    const agentFiles = fs
      .readdirSync(path.join(pluginRoot, "agents"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(agentFiles).toEqual(listMachineryAgentIds());
    const templateFiles = fs
      .readdirSync(path.join(pluginRoot, "templates", "specialists"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(templateFiles).toEqual(listSpecialistTemplateIds());
    // Every template self-declares its contract stamp (read via the shared
    // js-yaml-backed frontmatter parser, OD-3).
    for (const t of templateFiles) {
      const raw = fs.readFileSync(
        path.join(pluginRoot, "templates", "specialists", `${t}.md`),
        "utf8"
      );
      const fm = parseFrontmatter(raw);
      expect(fm?.["template_version"]).toBe("guild.specialist_template.v1");
    }
  });

  it("specialists helpers recognize machinery agents, template ids, and skill prefixes only", () => {
    expect(isMachineryAgentId("advisor")).toBe(true);
    expect(isMachineryAgentId("qa")).toBe(false);
    expect(isSpecialistTemplateId("qa")).toBe(true);
    expect(isSpecialistTemplateId("advisor")).toBe(false);
    expect(isSpecialistSkillId("qa-test-strategy")).toBe(true);
    expect(isSpecialistSkillId("guild-quality")).toBe(false);
  });

  it("every shipped definition carries the closed persona enums (AGENT.template.v1 slots)", () => {
    // Canonical value vocabulary: target-architecture.md §Agent personality
    // (umbrella wiki). Closed sets — any new value must be ratified there first.
    const OPERATING_STYLE = new Set(["methodical", "pragmatic", "exploratory"]);
    const TERSENESS = new Set(["terse", "balanced", "expansive"]);
    const PUSHBACK = new Set(["deferential", "evidence-led", "assertive"]);
    const ESCALATION = new Set(["conservative", "balanced", "eager"]);
    const definitionPaths = [
      ...listMachineryAgentIds().map((n) => path.join(pluginRoot, "agents", `${n}.md`)),
      ...listSpecialistTemplateIds().map((n) =>
        path.join(pluginRoot, "templates", "specialists", `${n}.md`)
      ),
    ];
    // 3 machinery agents (advisor, context-manager, developer) + 15 domain templates.
    expect(definitionPaths).toHaveLength(18);
    for (const p of definitionPaths) {
      const fm = parseFrontmatter(fs.readFileSync(p, "utf8")) ?? {};
      expect({ file: p, v: fm["operating_style"] }).toEqual({
        file: p,
        v: expect.stringMatching(/./),
      });
      expect(OPERATING_STYLE.has(String(fm["operating_style"]))).toBe(true);
      const persona = fm["personality"] as Record<string, unknown> | undefined;
      expect(persona && typeof persona === "object").toBe(true);
      expect(TERSENESS.has(String(persona?.["terseness"]))).toBe(true);
      expect(PUSHBACK.has(String(persona?.["pushback_posture"]))).toBe(true);
      expect(ESCALATION.has(String(persona?.["escalation_bias"]))).toBe(true);
      // flavor is optional but when present must be a single short line.
      const flavor = persona?.["flavor"];
      if (flavor !== undefined && flavor !== null) {
        expect(typeof flavor).toBe("string");
        expect(String(flavor)).not.toContain("\n");
        expect(String(flavor).length).toBeLessThanOrEqual(80);
      }
    }
  });
});
