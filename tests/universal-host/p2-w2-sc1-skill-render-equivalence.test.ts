/**
 * tests/universal-host/p2-w2-sc1-skill-render-equivalence.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W2-1 (ADR step 15) — per-skill
 * render-equivalence over the 5 invocation-driving skills.
 *
 * The neutral structured registry `plugin/skill-src/skill-registry.json`
 * (`guild.skill_src.v1`) + the LW2-1 transformer renders the host-native Claude
 * `SKILL.md` such that `renderSkillFromRegistry(registry, id)` is BYTE-IDENTICAL
 * to the committed `plugin/skills/meta/<id>/SKILL.md` for review-broker /
 * execute-plan / systematic-debug / tdd / verify-done. (`using-guild` EXCLUDED — F-5,
 * no committed SKILL.md.)
 *
 * Test-the-real-path discipline: this drives the SAME `loadSkillRegistry()` /
 * `renderSkillFromRegistry()` the production transformer exposes and reads the SAME
 * committed tree — no synthetic inventory, no hand-authored render.
 *
 * Falsifiable: if a registry entry drifts from its committed SKILL.md (or a field
 * is mis-rendered), the byte equality fails. Anti-vacuity: the registry must cover
 * EXACTLY the 5 ids and the transform must be NON-identity (the source body carries
 * no frontmatter — the renderer reconstructs it).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  loadSkillRegistry,
  renderSkillFromRegistry,
  validateSkillSrcRegistryV1,
  WAVE2_SKILL_IDS,
} from "../../scripts/lib/skill-source-transform";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const SKILLS_META = path.join(PLUGIN_ROOT, "skills", "meta");

function committedSkillMd(id: string): string {
  return fs.readFileSync(path.join(SKILLS_META, id, "SKILL.md"), "utf8");
}

const REGISTRY = loadSkillRegistry();

describe("SC-W2-1 — skill render-equivalence over the 5 invocation skills", () => {
  it("the neutral registry is valid and covers EXACTLY the 5 ids (anti-vacuity)", () => {
    expect(validateSkillSrcRegistryV1(REGISTRY).valid).toBe(true);
    expect(REGISTRY.skills.map((s) => s.id).sort()).toEqual([...WAVE2_SKILL_IDS].sort());
    expect(REGISTRY.skills.map((s) => s.id)).not.toContain("using-guild"); // F-5 exclusion
  });

  for (const id of WAVE2_SKILL_IDS) {
    it(`renders ${id} BYTE-IDENTICAL to the committed skills/meta/${id}/SKILL.md`, () => {
      const committed = committedSkillMd(id);
      const rendered = renderSkillFromRegistry(REGISTRY, id);
      expect(rendered).toBe(committed);
      expect(Buffer.from(rendered)).toEqual(Buffer.from(committed));
    });
  }

  it("the transform is NON-identity: the source body carries no frontmatter fence/keys", () => {
    for (const id of WAVE2_SKILL_IDS) {
      const entry = REGISTRY.skills.find((s) => s.id === id)!;
      expect(entry.body.startsWith("---")).toBe(false);
      expect(entry.body).not.toContain(`\nname: ${entry.name}\n`);
      // but the rendered file DOES reconstruct the fenced frontmatter
      expect(renderSkillFromRegistry(REGISTRY, id).startsWith("---\nname: ")).toBe(true);
    }
  });
});
