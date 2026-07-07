/**
 * tests/universal-host/p2-w2-sc2-drift-gate.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W2-2 (ADR step 15/16) — the DRIFT GATE that
 * will later permit the install-channel cutover.
 *
 * The gate is: `render(source-entry) === committed-artifact`. A drift gate is only
 * trustworthy if it is anti-vacuous in BOTH directions:
 *   - ALIGNED  → GREEN: every committed skill/command renders byte-identical from its
 *     neutral source entry (no false drift).
 *   - MUTATED  → RED:   any divergence in a source entry (a single-byte change to a
 *     field or the body, a dropped/extra entry) makes the gate fire (no missed drift).
 *
 * Covers BOTH the skill registry (`guild.skill_src.v1`) and the command registry
 * (`guild.command.v1`), so the gate that gates the cutover is proven on both surfaces.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  loadSkillRegistry,
  renderSkillFromRegistry,
  WAVE2_SKILL_IDS,
  type SkillSrcRegistryV1,
  type SkillSrcV1,
} from "../../scripts/lib/skill-source-transform";
import {
  renderCommandV1,
  type CommandRegistryV1,
  type CommandV1,
} from "../../scripts/lib/command-registry";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");

const SKILL_REGISTRY = loadSkillRegistry();
const COMMAND_REGISTRY = JSON.parse(
  fs.readFileSync(path.join(PLUGIN_ROOT, "command-src", "command-registry.json"), "utf8"),
) as CommandRegistryV1;

function committedSkill(id: string): string {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "skills", "meta", id, "SKILL.md"), "utf8");
}
function committedCommand(id: string): string {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "commands", `${id}.md`), "utf8");
}

/** The drift predicate the gate evaluates: rendered output differs from the committed bytes. */
function drift(rendered: string, committed: string): boolean {
  return rendered !== committed;
}

function cloneSkillEntry(id: string): SkillSrcV1 {
  return JSON.parse(JSON.stringify(SKILL_REGISTRY.skills.find((s) => s.id === id)!));
}
function cloneCommandEntry(id: string): CommandV1 {
  return JSON.parse(JSON.stringify(COMMAND_REGISTRY.commands.find((c) => c.id === id)!));
}

describe("SC-W2-2 drift gate — ALIGNED → GREEN (no false drift)", () => {
  it("every skill renders with NO drift vs its committed artifact", () => {
    for (const id of WAVE2_SKILL_IDS) {
      expect(drift(renderSkillFromRegistry(SKILL_REGISTRY, id), committedSkill(id))).toBe(false);
    }
  });

  it("every command renders with NO drift vs its committed artifact", () => {
    for (const c of COMMAND_REGISTRY.commands) {
      expect(drift(renderCommandV1(c), committedCommand(c.id))).toBe(false);
    }
  });
});

describe("SC-W2-2 drift gate — MUTATED → RED (no missed drift)", () => {
  it("a one-char body mutation in a SKILL entry is detected", () => {
    const e = cloneSkillEntry("tdd");
    e.body = e.body.replace(/\n/, "\n "); // inject a single space after the first newline
    const reg: SkillSrcRegistryV1 = {
      schema_version: SKILL_REGISTRY.schema_version,
      skills: [e],
    };
    expect(drift(renderSkillFromRegistry(reg, "tdd"), committedSkill("tdd"))).toBe(true);
  });

  it("a frontmatter-field mutation in a SKILL entry is detected", () => {
    const e = cloneSkillEntry("verify-done");
    e.description = e.description + " DRIFT";
    const reg: SkillSrcRegistryV1 = { schema_version: SKILL_REGISTRY.schema_version, skills: [e] };
    expect(drift(renderSkillFromRegistry(reg, "verify-done"), committedSkill("verify-done"))).toBe(true);
  });

  it("a description mutation in a COMMAND entry is detected", () => {
    const c = cloneCommandEntry(COMMAND_REGISTRY.commands[0].id);
    c.description = c.description + " DRIFT";
    expect(drift(renderCommandV1(c), committedCommand(c.id))).toBe(true);
  });

  it("a body mutation in a COMMAND entry is detected", () => {
    const c = cloneCommandEntry(COMMAND_REGISTRY.commands[0].id);
    c.body = c.body.replace(/\n/, "\n "); // single-byte change
    expect(drift(renderCommandV1(c), committedCommand(c.id))).toBe(true);
  });

  it("an allowed_tools mutation in a COMMAND entry is detected", () => {
    const c = cloneCommandEntry(COMMAND_REGISTRY.commands[0].id);
    c.allowed_tools = [...c.allowed_tools, "Extra"];
    expect(drift(renderCommandV1(c), committedCommand(c.id))).toBe(true);
  });

  it("the gate cannot be satisfied vacuously — a mismatched committed oracle fails too", () => {
    // Rendering a faithful skill entry against a DIFFERENT committed file must drift,
    // proving the equality is real (not e.g. `true`-by-construction).
    expect(drift(renderSkillFromRegistry(SKILL_REGISTRY, "tdd"), committedSkill("verify-done"))).toBe(true);
  });
});
