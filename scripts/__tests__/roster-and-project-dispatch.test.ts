/**
 * scripts/__tests__/roster-and-project-dispatch.test.ts
 *
 * Covers the project-specialist wiring:
 *  - lib/roster.ts: D4 code-backed enumeration (shipped ∪ project, proposed/
 *    excluded, project-wins merge, tier derivation) + derived registry
 *    conservatism (empty/marker → write; hand-authored → refuse; force wins).
 *  - composeInProcessDispatch: project-local specialist → generic subagent
 *    type + GUILD_AGENT_DEFINITION + definitionPath; shipped unchanged.
 *  - buildPrompt: definition-adoption instruction present only for
 *    definition_source === "project".
 *  - agent-team-launcher CLI (dry-run): team.yaml `definition:` +
 *    `definition_source:` thread through parseYaml into pane prompts.
 *  - evolve-loop findLiveSkillDir: project instance (.guild/skills/<slug>/)
 *    wins over the plugin tree (DH-3 read path).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import {
  deriveAgentsRegistry,
  deriveSkillsRegistry,
  GENERATED_MARKER,
  HOST_NATIVE_MARKER,
  listSpecialistTemplates,
  migrateTeamRoster,
  mintFromTemplate,
  projectInstanceToHostNative,
  resolveRoster,
  SPECIALIST_TEMPLATE_VERSION,
  tierForModel,
} from "../lib/roster";
import { composeInProcessDispatch } from "../lib/host/inprocess-backend";
import { GENERIC_SUBAGENT_TYPE } from "../lib/core/contracts/team-backend";
import type { Specialist, TeamLaunchRequest } from "../lib/core/contracts/team-backend";
import { buildPrompt } from "../lib/host/tmux-backend";
import { mintRunBinding } from "../lib/run-binding";
import { parseYaml } from "../agent-team-launcher";
import { createExactClaudePluginFixture } from "./fixtures/exact-claude-plugin-fixture";

const EVOLVE_LOOP = path.resolve(__dirname, "../evolve-loop.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");
const EXACT_CLAUDE_PLUGIN_ROOT = createExactClaudePluginFixture();
const LAUNCHER = path.join(EXACT_CLAUDE_PLUGIN_ROOT, "scripts", "agent-team-launcher.ts");

afterAll(() => fs.rmSync(EXACT_CLAUDE_PLUGIN_ROOT, { recursive: true, force: true }));

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeAgent(
  dir: string,
  name: string,
  fm: Record<string, string | string[]>
): void {
  fs.mkdirSync(dir, { recursive: true });
  const lines = [`name: ${name}`];
  for (const [k, v] of Object.entries(fm)) {
    lines.push(Array.isArray(v) ? `${k}: [${v.join(", ")}]` : `${k}: ${v}`);
  }
  fs.writeFileSync(
    path.join(dir, `${name}.md`),
    `---\n${lines.join("\n")}\n---\n\n# ${name}\n`,
    "utf8"
  );
}

function fixtureRoots(): { projectRoot: string; pluginRoot: string } {
  const base = mkTmp("guild-roster-");
  const pluginRoot = path.join(base, "plugin");
  const projectRoot = path.join(base, "project");

  writeAgent(path.join(pluginRoot, "agents"), "backend", {
    description: "shipped backend",
    model: "sonnet",
  });
  writeAgent(path.join(pluginRoot, "agents"), "architect", {
    description: "shipped architect",
    model: "opus",
  });

  const projAgents = path.join(projectRoot, ".guild", "agents");
  writeAgent(projAgents, "kb-viz-engineer", {
    description: "project viz specialist",
    model: "gpt-5.5",
    default_tier: "powerful",
    derived_from_template: "guild.agent_template.v1",
  });
  // Overrides the shipped type of the same name.
  writeAgent(projAgents, "backend", {
    description: "project-specialized backend",
    model: "haiku",
  });
  // Incubating draft — must never be a candidate.
  writeAgent(path.join(projAgents, "proposed"), "data-scientist", {
    description: "incubating",
    model: "sonnet",
  });

  const skillDir = path.join(projectRoot, ".guild", "skills", "kb-viz-render");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: kb-viz-render\ndescription: render KB graphs\n---\nbody\n`,
    "utf8"
  );
  const proposedSkill = path.join(projectRoot, ".guild", "skills", "proposed-x");
  fs.mkdirSync(proposedSkill, { recursive: true });
  fs.writeFileSync(path.join(proposedSkill, "SKILL.md"), `---\nname: x\n---\n`, "utf8");

  // Shipped specialist TYPE templates (machinery-vs-template-library ADR):
  // one stamped (a mint candidate) and one missing the stamp (skipped).
  const tplDir = path.join(pluginRoot, "templates", "specialists");
  writeAgent(tplDir, "frontend", {
    template_version: SPECIALIST_TEMPLATE_VERSION,
    description: "frontend type template",
    model: "sonnet",
    skills: ["guild-principles", "frontend-a11y"],
  });
  writeAgent(tplDir, "unstamped", {
    description: "not a valid template",
    model: "sonnet",
  });

  return { projectRoot, pluginRoot };
}

describe("lib/roster resolveRoster (D4 enumeration)", () => {
  it("unions shipped + project, excludes proposed/, project wins on collision", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const r = resolveRoster({ projectRoot, pluginRoot });

    expect(r.shipped.map((a) => a.name).sort()).toEqual(["architect", "backend"]);
    expect(r.project.map((a) => a.name).sort()).toEqual(["backend", "kb-viz-engineer"]);
    // proposed/ never a candidate
    expect(r.roster.find((a) => a.name === "data-scientist")).toBeUndefined();

    // merge: 3 distinct names; backend is the PROJECT instance
    expect(r.roster).toHaveLength(3);
    const backend = r.roster.find((a) => a.name === "backend")!;
    expect(backend.source).toBe("project");
    expect(backend.overrides_shipped).toBe(true);
    expect(backend.definition).toBe(path.join(".guild", "agents", "backend.md"));
    expect(r.warnings.some((w) => w.includes("overrides the shipped type"))).toBe(true);
  });

  it("derives tiers: explicit default_tier wins, model ladder otherwise, mid fallback", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const r = resolveRoster({ projectRoot, pluginRoot });
    const byName = Object.fromEntries(r.roster.map((a) => [a.name, a]));
    expect(byName["architect"].default_tier).toBe("powerful"); // opus
    expect(byName["backend"].default_tier).toBe("cheap"); // haiku (project override)
    expect(byName["kb-viz-engineer"].default_tier).toBe("powerful"); // explicit, unknown model
    expect(tierForModel("gpt-5.5")).toBeNull(); // unknown model → explicit tier was load-bearing
  });

  it("enumerates project skills, excluding proposed-*", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(r.project_skills.map((s) => s.id)).toEqual(["kb-viz-render"]);
  });

  it("passes project metadata (owns/external_skills/reusable_in/consistency_source, skill type/used_by) through to the derived registries", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const agentPath = path.join(projectRoot, ".guild", "agents", "kb-viz-engineer.md");
    const raw = fs.readFileSync(agentPath, "utf8");
    fs.writeFileSync(
      agentPath,
      raw.replace(
        "---\n\n# kb-viz-engineer",
        [
          "owns: [kb_viz, dashboards]",
          "external_skills: [impeccable]",
          "reusable_in: [benchmark]",
          "work_class: implementation",
          "consistency_source: ../website/.guild/agents/kb-viz-engineer.md",
          "---",
          "",
          "# kb-viz-engineer",
        ].join("\n")
      )
    );
    const skillMd = path.join(projectRoot, ".guild", "skills", "kb-viz-render", "SKILL.md");
    fs.writeFileSync(
      skillMd,
      `---\nname: kb-viz-render\ndescription: render KB graphs\ntype: production\nused_by: [kb-viz-engineer]\nexternal_skills: [impeccable]\n---\nbody\n`
    );

    const r = resolveRoster({ projectRoot, pluginRoot });
    const agent = r.project.find((a) => a.name === "kb-viz-engineer")!;
    expect(agent.owns).toEqual(["kb_viz", "dashboards"]);
    expect(agent.reusable_in).toEqual(["benchmark"]);
    expect(agent.work_class).toBe("implementation");
    // Optional: absent (not null) in the entry-derived registry when the source lacks it.
    expect(r.project.find((a) => a.name === "backend")!.work_class).toBeNull();
    expect(agent.consistency_source).toBe("../website/.guild/agents/kb-viz-engineer.md");
    expect(r.project_skills[0].type).toBe("production");
    expect(r.project_skills[0].used_by).toEqual(["kb-viz-engineer"]);

    expect(deriveAgentsRegistry(r).action).toBe("written");
    const reg = fs.readFileSync(
      path.join(projectRoot, ".guild", "agents", "registry.yaml"),
      "utf8"
    );
    expect(reg).toContain("owns:");
    expect(reg).toContain("kb_viz");
    expect(reg).toContain("work_class: implementation");
    // The work_class-less project override must not gain a null/empty key.
    expect(reg).not.toContain("work_class: null");
    expect(reg).toContain("consistency_source: ../website/.guild/agents/kb-viz-engineer.md");
    expect(deriveSkillsRegistry(r).action).toBe("written");
    const sreg = fs.readFileSync(
      path.join(projectRoot, ".guild", "skills", "registry.yaml"),
      "utf8"
    );
    expect(sreg).toContain("type: production");
    expect(sreg).toContain("used_by:");
  });

  it("flags the augmenting registered types (advisor/developer/doc-writer)", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    writeAgent(path.join(pluginRoot, "agents"), "developer", {
      description: "generic mid-tier implementer",
      model: "sonnet",
    });
    const r = resolveRoster({ projectRoot, pluginRoot });
    const byName = Object.fromEntries(r.roster.map((a) => [a.name, a]));
    expect(byName["developer"].augmenting).toBe(true);
    expect(byName["architect"].augmenting).toBe(false);
    expect(byName["kb-viz-engineer"].augmenting).toBe(false);
  });
});

describe("lib/roster derived registries", () => {
  it("writes over an empty init-scaffolded registry and is idempotent", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const regPath = path.join(projectRoot, ".guild", "agents", "registry.yaml");
    fs.writeFileSync(regPath, "# schema_version: guild.agents_registry.v1\nagents: []\n");

    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(deriveAgentsRegistry(r).action).toBe("written");
    const written = fs.readFileSync(regPath, "utf8");
    expect(written).toContain(GENERATED_MARKER);
    expect(written).toContain("id: kb-viz-engineer");
    expect(written).toContain("overrides_shipped: true");
    // Regenerating over our own output: unchanged, then written after a change.
    expect(deriveAgentsRegistry(r).action).toBe("unchanged");

    expect(deriveSkillsRegistry(r).action).toBe("written");
    const skillsReg = fs.readFileSync(
      path.join(projectRoot, ".guild", "skills", "registry.yaml"),
      "utf8"
    );
    expect(skillsReg).toContain("id: kb-viz-render");
    expect(skillsReg).not.toContain("proposed-x");
  });

  it("refuses to clobber a hand-authored registry unless forced", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const regPath = path.join(projectRoot, ".guild", "agents", "registry.yaml");
    const handAuthored =
      "# schema_version: guild.agents_registry.v1\nagents:\n  - id: artisanal\n    file: .guild/agents/artisanal.md\n";
    fs.writeFileSync(regPath, handAuthored);

    const r = resolveRoster({ projectRoot, pluginRoot });
    const refused = deriveAgentsRegistry(r);
    expect(refused.action).toBe("refused");
    expect(fs.readFileSync(regPath, "utf8")).toBe(handAuthored);

    expect(deriveAgentsRegistry(r, { force: true }).action).toBe("written");
    expect(fs.readFileSync(regPath, "utf8")).toContain(GENERATED_MARKER);
  });

  it("refuses a registry whose entries live under a different key shape", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const regPath = path.join(projectRoot, ".guild", "agents", "registry.yaml");
    fs.writeFileSync(regPath, "specialists:\n  - id: custom-shape\n");
    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(deriveAgentsRegistry(r).action).toBe("refused");
    expect(fs.readFileSync(regPath, "utf8")).toContain("custom-shape");
  });

  it("a marker SUBSTRING buried in hand-authored content does not unlock the write", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const regPath = path.join(projectRoot, ".guild", "agents", "registry.yaml");
    fs.writeFileSync(
      regPath,
      `agents:\n  - id: artisanal\n    note: "mentions ${GENERATED_MARKER} in a value"\n`
    );
    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(deriveAgentsRegistry(r).action).toBe("refused");
  });

  it("refuses a symlinked registry target", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const outside = path.join(mkTmp("guild-outside-"), "victim.yaml");
    fs.writeFileSync(outside, "agents: []\n");
    const regPath = path.join(projectRoot, ".guild", "agents", "registry.yaml");
    fs.symlinkSync(outside, regPath);
    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(deriveAgentsRegistry(r).action).toBe("refused");
    expect(fs.readFileSync(outside, "utf8")).toBe("agents: []\n");
  });

  it("refuses when the containing dir symlinks outside the project root", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const outsideDir = mkTmp("guild-outside-dir-");
    const skillsDir = path.join(projectRoot, ".guild", "skills");
    // fixtureRoots created real skills content — repoint the registry's parent
    // dir by symlinking a sibling name instead.
    fs.rmSync(skillsDir, { recursive: true, force: true });
    fs.symlinkSync(outsideDir, skillsDir);
    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(deriveSkillsRegistry(r).action).toBe("refused");
    expect(fs.readdirSync(outsideDir)).toEqual([]);
  });

  it("hard-refuses when .guild itself is an outside symlink and agents/ does not exist yet", () => {
    const base = mkTmp("guild-symroot-");
    const pluginRoot = path.join(base, "plugin");
    writeAgent(path.join(pluginRoot, "agents"), "backend", {
      description: "shipped backend",
      model: "sonnet",
    });
    const projectRoot = path.join(base, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    const outside = mkTmp("guild-symroot-victim-");
    fs.symlinkSync(outside, path.join(projectRoot, ".guild"));
    // .guild/agents does NOT exist — the nearest existing ancestor (.guild →
    // outside) must still be realpath-checked.
    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(deriveAgentsRegistry(r, { force: true }).action).toBe("refused");
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("force never overrides a symlinked registry target (path safety is hard)", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const outside = path.join(mkTmp("guild-force-victim-"), "victim.yaml");
    fs.writeFileSync(outside, "agents: []\n");
    fs.symlinkSync(outside, path.join(projectRoot, ".guild", "agents", "registry.yaml"));
    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(deriveAgentsRegistry(r, { force: true }).action).toBe("refused");
    expect(fs.readFileSync(outside, "utf8")).toBe("agents: []\n");
  });

  it("dryRun never writes", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const regPath = path.join(projectRoot, ".guild", "agents", "registry.yaml");
    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(deriveAgentsRegistry(r, { dryRun: true }).action).toBe("written");
    expect(fs.existsSync(regPath)).toBe(false);
  });
});

function launchReq(specialists: Specialist[]): TeamLaunchRequest {
  return {
    slug: "test-slug",
    runId: "run-1",
    cwd: "/tmp",
    specialists,
    targetName: "guild-test",
    mode: "in-session",
    dryRun: true,
  };
}

describe("migrate-team-roster — shipped domain lanes → project instances (v2.2 fixer)", () => {
  function writeTeamFile(projectRoot: string, name: string, doc: string): string {
    const dir = path.join(projectRoot, ".guild", "team");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, name);
    fs.writeFileSync(p, doc, "utf8");
    return p;
  }

  it("mints + rewrites shipped DOMAIN entries, leaves machinery and project entries alone", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const teamPath = writeTeamFile(
      projectRoot,
      "demo.build.yaml",
      [
        "spec: .guild/spec/demo.md",
        "phase: build",
        "specialists:",
        "  - name: frontend", // domain role WITH a template → migrate
        "    definition: agents/frontend.md",
        "    definition_source: shipped",
        "  - name: advisor", // machinery → untouched
        "    definition: agents/advisor.md",
        "    definition_source: shipped",
        "  - name: kb-viz-engineer", // already project → untouched
        "    definition: .guild/agents/kb-viz-engineer.md",
        "    definition_source: project",
        "",
      ].join("\n")
    );
    const results = migrateTeamRoster({ pluginRoot, projectRoot });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("rewritten");
    expect(results[0].migrated).toEqual(["frontend"]);
    expect(results[0].minted).toEqual(["frontend"]);
    // The instance exists and the team entry points at it.
    expect(fs.existsSync(path.join(projectRoot, ".guild", "agents", "frontend.md"))).toBe(true);
    const rewritten = fs.readFileSync(teamPath, "utf8");
    expect(rewritten).toContain(`definition: ${path.join(".guild", "agents", "frontend.md")}`);
    // Machinery + project entries keep their sources.
    expect(rewritten.match(/definition_source: shipped/g)).toHaveLength(1); // advisor only
    expect(rewritten.match(/definition_source: project/g)).toHaveLength(2); // frontend + kb-viz
    // Idempotent: a second run is a no-op.
    const again = migrateTeamRoster({ pluginRoot, projectRoot });
    expect(again[0].action).toBe("unchanged");
  });

  it("dry-run reports without writing; unparseable files are refused not guessed", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const teamPath = writeTeamFile(
      projectRoot,
      "demo.build.yaml",
      "spec: x\nspecialists:\n  - name: frontend\n    definition: agents/frontend.md\n    definition_source: shipped\n"
    );
    const before = fs.readFileSync(teamPath, "utf8");
    const dry = migrateTeamRoster({ pluginRoot, projectRoot, dryRun: true });
    expect(dry[0].action).toBe("rewritten");
    expect(fs.readFileSync(teamPath, "utf8")).toBe(before); // nothing written
    expect(fs.existsSync(path.join(projectRoot, ".guild", "agents", "frontend.md"))).toBe(false);

    writeTeamFile(projectRoot, "broken.yaml", "specialists: [unclosed\n  - oops: {");
    const res = migrateTeamRoster({ pluginRoot, projectRoot });
    const broken = res.find((r) => r.path.endsWith("broken.yaml"))!;
    expect(broken.action).toBe("refused");
  });

  it("surfaces a REFUSED mint as file-level failure instead of silently leaving the lane broken", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    // Symlink the WHOLE templates/specialists dir: entries still enumerate
    // (regular files through the linked dir), but mintFromTemplate's realpath
    // containment refuses each source — the refused-mint path.
    const tplDir = path.join(pluginRoot, "templates", "specialists");
    const moved = path.join(path.dirname(pluginRoot), "specialists-moved");
    fs.renameSync(tplDir, moved);
    fs.symlinkSync(moved, tplDir);
    writeTeamFile(
      projectRoot,
      "demo.build.yaml",
      "specialists:\n  - name: frontend\n    definition: agents/frontend.md\n    definition_source: shipped\n"
    );
    const res = migrateTeamRoster({ pluginRoot, projectRoot });
    expect(res[0].action).toBe("refused");
    expect(res[0].failed.map((x) => x.role)).toEqual(["frontend"]);
    // The entry stays shipped — but loudly, not silently.
    const raw = fs.readFileSync(path.join(projectRoot, ".guild", "team", "demo.build.yaml"), "utf8");
    expect(raw).toContain("definition_source: shipped");
    // Dry-run reports the SAME refusal (probe runs the real checks).
    const dry = migrateTeamRoster({ pluginRoot, projectRoot, dryRun: true });
    expect(dry[0].failed.map((x) => x.role)).toEqual(["frontend"]);
  });

  it("a domain role WITHOUT a template (novel project type) is never migrated", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const teamPath = writeTeamFile(
      projectRoot,
      "demo.build.yaml",
      "specialists:\n  - name: data-scientist\n    definition: agents/data-scientist.md\n    definition_source: shipped\n"
    );
    const res = migrateTeamRoster({ pluginRoot, projectRoot });
    expect(res[0].action).toBe("unchanged");
    expect(fs.readFileSync(teamPath, "utf8")).toContain("definition_source: shipped");
  });
});

describe("projectInstanceToHostNative — opt-in .claude/agents projection", () => {
  it("projects a minted instance with the marker; refuses hand-authored targets; overwrites its own output", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    expect(mintFromTemplate({ pluginRoot, projectRoot, name: "frontend" }).action).toBe("written");

    const first = projectInstanceToHostNative({ projectRoot, name: "frontend" });
    expect(first.action).toBe("written");
    const projected = fs.readFileSync(first.path, "utf8");
    expect(projected.split("\n")[1]).toBe(HOST_NATIVE_MARKER);
    // Body is the instance byte-for-byte after the marker line.
    const instance = fs.readFileSync(path.join(projectRoot, ".guild", "agents", "frontend.md"), "utf8");
    expect(projected.replace(`${HOST_NATIVE_MARKER}\n`, "")).toBe(instance);

    // Re-projection over its own output is allowed (marker present).
    expect(projectInstanceToHostNative({ projectRoot, name: "frontend" }).action).toBe("written");

    // A hand-authored file (no marker) is never clobbered.
    const hand = path.join(projectRoot, ".claude", "agents", "custom.md");
    fs.mkdirSync(path.dirname(hand), { recursive: true });
    fs.writeFileSync(hand, "---\nname: custom\nmodel: sonnet\n---\n# custom\n");
    fs.writeFileSync(path.join(projectRoot, ".guild", "agents", "custom.md"),
      "---\nname: custom\nmodel: sonnet\n---\n# custom instance\n");
    expect(projectInstanceToHostNative({ projectRoot, name: "custom" }).action).toBe("refused");

    // No instance → refused with a mint hint.
    const missing = projectInstanceToHostNative({ projectRoot, name: "qa" });
    expect(missing.action).toBe("refused");
    expect(missing.reason).toContain("mint it first");
  });

  it("refuses a symlinked .claude ancestor (no write outside the project)", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    expect(mintFromTemplate({ pluginRoot, projectRoot, name: "frontend" }).action).toBe("written");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hostnative-escape-"));
    fs.symlinkSync(outside, path.join(projectRoot, ".claude"));
    const res = projectInstanceToHostNative({ projectRoot, name: "frontend" });
    expect(res.action).toBe("refused");
    expect(res.reason).toContain("outside the project root");
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("stamps the marker on CRLF instances too (never a silent unmarked projection)", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    expect(mintFromTemplate({ pluginRoot, projectRoot, name: "frontend" }).action).toBe("written");
    const inst = path.join(projectRoot, ".guild", "agents", "frontend.md");
    fs.writeFileSync(inst, fs.readFileSync(inst, "utf8").replace(/\n/g, "\r\n"));
    const res = projectInstanceToHostNative({ projectRoot, name: "frontend" });
    expect(res.action).toBe("written");
    const projected = fs.readFileSync(res.path, "utf8");
    expect(projected.startsWith(`---\r\n${HOST_NATIVE_MARKER}\r\n`)).toBe(true);
  });
});

describe("specialist type templates + deterministic mint (machinery-vs-template-library ADR)", () => {
  it("enumerates stamped templates only; templates never join the dispatchable roster", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const r = resolveRoster({ projectRoot, pluginRoot });
    expect(r.templates.map((t) => t.name)).toEqual(["frontend"]);
    expect(r.templates[0].source).toBe("template");
    expect(r.templates[0].definition).toBe(
      path.join("templates", "specialists", "frontend.md")
    );
    // The unstamped file is skipped with a warning, not silently accepted.
    expect(r.warnings.some((w) => w.includes("unstamped"))).toBe(true);
    // Not dispatchable: the merged roster contains no template entries.
    expect(r.roster.find((a) => a.name === "frontend")).toBeUndefined();
    // Direct enumeration agrees.
    expect(listSpecialistTemplates(pluginRoot).map((t) => t.name)).toEqual(["frontend"]);
  });

  it("mints a project instance: byte-preserving copy with the provenance stamp swapped in", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const res = mintFromTemplate({ pluginRoot, projectRoot, name: "frontend" });
    expect(res.action).toBe("written");
    const minted = fs.readFileSync(res.path, "utf8");
    expect(minted).toContain(`derived_from_template: ${SPECIALIST_TEMPLATE_VERSION}`);
    expect(minted).not.toContain("template_version:");
    // Body + every other frontmatter line preserved byte-for-byte.
    const original = fs.readFileSync(
      path.join(pluginRoot, "templates", "specialists", "frontend.md"),
      "utf8"
    );
    expect(minted).toBe(
      original.replace(
        `template_version: ${SPECIALIST_TEMPLATE_VERSION}`,
        `derived_from_template: ${SPECIALIST_TEMPLATE_VERSION}`
      )
    );
    // The minted INSTANCE is now a dispatchable project roster entry.
    const r = resolveRoster({ projectRoot, pluginRoot });
    const inst = r.roster.find((a) => a.name === "frontend")!;
    expect(inst.source).toBe("project");
    expect(inst.derived_from_template).toBe(SPECIALIST_TEMPLATE_VERSION);
    expect(inst.definition).toBe(path.join(".guild", "agents", "frontend.md"));
  });

  it("refuses to re-mint an existing instance (reuse, never re-create) and fails closed on bad input", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    expect(mintFromTemplate({ pluginRoot, projectRoot, name: "frontend" }).action).toBe("written");
    const again = mintFromTemplate({ pluginRoot, projectRoot, name: "frontend" });
    expect(again.action).toBe("exists");
    // No template → refused; unstamped template → refused; unsafe name → refused.
    expect(mintFromTemplate({ pluginRoot, projectRoot, name: "no-such-role" }).action).toBe("refused");
    expect(mintFromTemplate({ pluginRoot, projectRoot, name: "unstamped" }).action).toBe("refused");
    expect(mintFromTemplate({ pluginRoot, projectRoot, name: "../escape" }).action).toBe("refused");
  });

  it("treats an instance under ANY filename with a matching roster name as exists (name-identity reuse)", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    // A pre-existing project specialist named `frontend` under a DIFFERENT
    // filename must block the mint — roster identity is frontmatter name.
    writeAgent(path.join(projectRoot, ".guild", "agents"), "custom-frontend", {
      description: "hand-rolled frontend",
      model: "sonnet",
    });
    fs.renameSync(
      path.join(projectRoot, ".guild", "agents", "custom-frontend.md"),
      path.join(projectRoot, ".guild", "agents", "our-frontend.md")
    );
    // Rewrite its name to collide with the template role.
    const p = path.join(projectRoot, ".guild", "agents", "our-frontend.md");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("name: custom-frontend", "name: frontend"));
    const res = mintFromTemplate({ pluginRoot, projectRoot, name: "frontend" });
    expect(res.action).toBe("exists");
    expect(res.reason).toContain("our-frontend.md");
    expect(fs.existsSync(path.join(projectRoot, ".guild", "agents", "frontend.md"))).toBe(false);
  });

  it("refuses a symlinked template source (no smuggled non-template mint)", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    // A stamped file OUTSIDE the library, reached via a symlinked <role>.md.
    const outside = path.join(path.dirname(pluginRoot), "outside.md");
    fs.writeFileSync(
      outside,
      `---\ntemplate_version: ${SPECIALIST_TEMPLATE_VERSION}\nname: rogue\nmodel: opus\n---\n# rogue\n`
    );
    fs.symlinkSync(outside, path.join(pluginRoot, "templates", "specialists", "rogue.md"));
    expect(mintFromTemplate({ pluginRoot, projectRoot, name: "rogue" }).action).toBe("refused");
  });

  it("fails closed when the literal stamp line is not exactly-once in the frontmatter", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    // YAML-quoted stamp satisfies the parser but not the literal line — refuse
    // rather than mint with the wrong provenance key.
    fs.writeFileSync(
      path.join(pluginRoot, "templates", "specialists", "quoted.md"),
      `---\ntemplate_version: "${SPECIALIST_TEMPLATE_VERSION}"\nname: quoted\nmodel: sonnet\n---\n# quoted\n`
    );
    const res = mintFromTemplate({ pluginRoot, projectRoot, name: "quoted" });
    expect(res.action).toBe("refused");
    expect(res.reason).toContain("exactly one literal");
  });

  it("never swaps a template_version line that lives in the BODY", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const body = `\nDocs note:\n\ntemplate_version: ${SPECIALIST_TEMPLATE_VERSION}\n`;
    const p = path.join(pluginRoot, "templates", "specialists", "frontend.md");
    fs.appendFileSync(p, body);
    const res = mintFromTemplate({ pluginRoot, projectRoot, name: "frontend" });
    expect(res.action).toBe("written");
    const minted = fs.readFileSync(res.path, "utf8");
    // Frontmatter stamp swapped; the body occurrence untouched.
    expect(minted).toContain(`derived_from_template: ${SPECIALIST_TEMPLATE_VERSION}`);
    expect(minted).toContain(`\nDocs note:\n\ntemplate_version: ${SPECIALIST_TEMPLATE_VERSION}\n`);
  });

  it("roster-resolve CLI mint writes the instance and refreshes the derived registry (exit 0 / 3)", () => {
    const { projectRoot, pluginRoot } = fixtureRoots();
    const cli = path.resolve(__dirname, "../roster-resolve.ts");
    const run = () =>
      spawnSync("npx", ["tsx", cli, "mint", "frontend", "--cwd", projectRoot, "--plugin-root", pluginRoot], {
        encoding: "utf8",
      });
    const first = run();
    expect(first.status).toBe(0);
    expect(fs.existsSync(path.join(projectRoot, ".guild", "agents", "frontend.md"))).toBe(true);
    const registry = fs.readFileSync(
      path.join(projectRoot, ".guild", "agents", "registry.yaml"),
      "utf8"
    );
    expect(registry).toContain("frontend");
    expect(registry).toContain(GENERATED_MARKER);
    const second = run();
    expect(second.status).toBe(3); // exists — the reuse signal, not an error
  });
});

describe("composeInProcessDispatch — project-local specialists", () => {
  const shipped: Specialist = {
    name: "architect",
    scope: "design",
    dependsOn: [],
    definition: "agents/architect.md",
    definition_source: "shipped",
  };
  const projectLocal: Specialist = {
    name: "kb-viz-engineer",
    scope: "viz lane",
    dependsOn: [],
    definition: ".guild/agents/kb-viz-engineer.md",
    definition_source: "project",
  };

  it("shipped specialist dispatches by name (unchanged)", () => {
    const [d] = composeInProcessDispatch(launchReq([shipped]));
    expect(d.subagentType).toBe("architect");
    expect(d.definitionPath).toBeNull();
    expect(d.env["GUILD_AGENT_DEFINITION"]).toBeUndefined();
  });

  it("project specialist dispatches as generic type with the definition carried", () => {
    const [d] = composeInProcessDispatch(launchReq([projectLocal]));
    expect(d.subagentType).toBe(GENERIC_SUBAGENT_TYPE);
    expect(d.name).toBe("kb-viz-engineer");
    expect(d.definitionPath).toBe(".guild/agents/kb-viz-engineer.md");
    expect(d.env["GUILD_AGENT_DEFINITION"]).toBe(".guild/agents/kb-viz-engineer.md");
    expect(d.env["GUILD_SPECIALIST"]).toBe("kb-viz-engineer");
    expect(d.prompt).toContain(".guild/agents/kb-viz-engineer.md");
    expect(d.prompt).toContain("adopt it");
  });

  it("a definition path without definition_source: project stays name-addressed", () => {
    const [d] = composeInProcessDispatch(
      launchReq([{ ...shipped, definition_source: undefined }])
    );
    expect(d.subagentType).toBe("architect");
  });

  // #58 — GUILD_AGENT_DEFINITION + the adoption prompt are UNCONDITIONAL for a
  // project specialist, and a project specialist with no definition path FAILS
  // CLOSED rather than silently degrading to a persona-stripped generic agent.
  it("emits GUILD_AGENT_DEFINITION + definitionPath + adoption prompt for EVERY project specialist (unconditional)", () => {
    const [d] = composeInProcessDispatch(launchReq([projectLocal]));
    expect(d.subagentType).toBe(GENERIC_SUBAGENT_TYPE);
    expect(d.env["GUILD_AGENT_DEFINITION"]).toBe(".guild/agents/kb-viz-engineer.md");
    expect(d.definitionPath).toBe(".guild/agents/kb-viz-engineer.md");
    expect(d.prompt).toContain(".guild/agents/kb-viz-engineer.md");
    expect(d.prompt).toContain("adopt it");
  });

  it("throws (fail-closed) when a project specialist has no definition path — never a bare generic dispatch", () => {
    const noDefinition: Specialist = {
      name: "ghost",
      scope: "orphan lane",
      dependsOn: [],
      definition_source: "project",
      // definition intentionally omitted
    };
    expect(() => composeInProcessDispatch(launchReq([noDefinition]))).toThrow(
      /project specialist "ghost"/,
    );
    expect(() => composeInProcessDispatch(launchReq([noDefinition]))).toThrow(
      /invalid definition path/,
    );
  });

  it("throws (fail-closed) when a project specialist's definition is empty", () => {
    const emptyDefinition: Specialist = {
      name: "ghost",
      scope: "orphan lane",
      dependsOn: [],
      definition: "",
      definition_source: "project",
    };
    expect(() => composeInProcessDispatch(launchReq([emptyDefinition]))).toThrow(
      /#58/,
    );
  });

  it("throws (fail-closed) on a role-mismatched / arbitrary definition path", () => {
    const mismatched: Specialist = {
      name: "kb-viz-engineer",
      scope: "viz lane",
      dependsOn: [],
      definition: ".guild/agents/frontend.md", // wrong role
      definition_source: "project",
    };
    expect(() => composeInProcessDispatch(launchReq([mismatched]))).toThrow(
      /invalid definition path/,
    );
    const arbitrary: Specialist = { ...mismatched, definition: "/etc/passwd" };
    expect(() => composeInProcessDispatch(launchReq([arbitrary]))).toThrow(/#58/);
  });
});

describe("agent-team-launcher parseYaml — no generic `source:` alias", () => {
  it("parses and sanitizes a single-line definition_ref", () => {
    const ref = {
      schema_version: "guild.project_definition_ref.v1",
      project_id: "plugin", layer: "project-guild", kind: "agent", id: "architect",
      relative_path: ".guild/agents/architect.md", content_hash: `sha256:${"a".repeat(64)}`,
      source_commit: null, specialist_profile_hash: "b".repeat(64), specialist_type_hash: "c".repeat(64), skills: [],
    };
    const team = parseYaml(["backend: in-process", "specialists:", "  - name: architect", "    definition: .guild/agents/architect.md", `    definition_ref: ${JSON.stringify(ref)}`].join("\n"));
    expect(team.specialists[0].definition_ref).toEqual(ref);
  });

  it("a per-specialist `source:` key never sets definition_source", () => {
    const tmpDir = mkTmp("guild-launcher-src-");
    const runId = "run-20260811-010101-roster-source-alias";
    mintRunBinding({ root: tmpDir, run_id: runId });
    const teamDir = path.join(tmpDir, ".guild", "team");
    fs.mkdirSync(teamDir, { recursive: true });
    const teamPath = path.join(teamDir, "test-slug.yaml");
    fs.writeFileSync(
      teamPath,
      [
        "spec: .guild/spec/test-slug.md",
        "backend: agent-team",
        "user_approved_agent_team: true",
        "specialists:",
        "  - name: architect",
        '    scope: "design"',
        "    depends-on: []",
        "    definition: .guild/agents/architect.md",
        "    source: project", // provenance metadata — must NOT trigger project dispatch
        "",
      ].join("\n")
    );
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "TMUX") env[k] = v;
    }
    env.GUILD_PLUGIN_ROOT = EXACT_CLAUDE_PLUGIN_ROOT;
    // T7R-R1-B1: this fixture is about roster/agent-definition dispatch, not
    // approval, and carries no team-plan trail. Opt into the ONE audited escape
    // hatch; the gate's own pins live in t7-h1-dispatch-approval.test.ts.
    env.GUILD_DISPATCH_APPROVAL_OVERRIDE =
      "roster dispatch fixture: no team-plan trail; approval verification is pinned separately";
    const result = spawnSync(
      "npx",
      [
        "tsx",
        LAUNCHER,
        "--team",
        teamPath,
        "--cwd",
        tmpDir,
        "--run-id",
        runId,
        "--dry-run",
      ],
      { encoding: "utf8", env, timeout: 120_000 }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Your role definition");
  });
});

describe("buildPrompt — definition-adoption instruction", () => {
  it("embeds the instruction for project-local specialists only", () => {
    const withDef = buildPrompt("slug", "run-1", {
      name: "kb-viz-engineer",
      scope: "viz",
      definition: ".guild/agents/kb-viz-engineer.md",
      definition_source: "project",
    });
    expect(withDef).toContain("Your role definition is at `.guild/agents/kb-viz-engineer.md`");
    expect(withDef).toContain(".guild/skills/<skill>/SKILL.md");

    const shipped = buildPrompt("slug", "run-1", {
      name: "architect",
      scope: "design",
      definition: "agents/architect.md",
      definition_source: "shipped",
    });
    expect(shipped).not.toContain("Your role definition");
  });
});

describe("agent-team-launcher CLI — committed definition gate", () => {
  it("refuses a project definition with no committed manifest before pane creation", () => {
    const tmpDir = mkTmp("guild-launcher-def-");
    const teamDir = path.join(tmpDir, ".guild", "team");
    fs.mkdirSync(teamDir, { recursive: true });
    const teamPath = path.join(teamDir, "test-slug.yaml");
    fs.copyFileSync(path.join(FIXTURES, "team-project-specialist.yaml"), teamPath);

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "TMUX") env[k] = v;
    }
    env.GUILD_PLUGIN_ROOT = EXACT_CLAUDE_PLUGIN_ROOT;
    // T7R-R1-B1: this fixture is about roster/agent-definition dispatch, not
    // approval, and carries no team-plan trail. Opt into the ONE audited escape
    // hatch; the gate's own pins live in t7-h1-dispatch-approval.test.ts.
    env.GUILD_DISPATCH_APPROVAL_OVERRIDE =
      "roster dispatch fixture: no team-plan trail; approval verification is pinned separately";
    const result = spawnSync(
      "npx",
      ["tsx", LAUNCHER, "--team", teamPath, "--cwd", tmpDir, "--dry-run"],
      { encoding: "utf8", env, timeout: 120_000 }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/REFUSED \(project definition\).*no valid adoption manifest/s);
    expect(result.stdout).not.toContain("Your role definition");
  });
});

describe("evolve-loop findLiveSkillDir — project instance wins (DH-3)", () => {
  it("snapshots the .guild/skills/<slug>/ instance when present", () => {
    const tmpDir = mkTmp("guild-evolve-proj-");
    const projSkill = path.join(tmpDir, ".guild", "skills", "myskill");
    fs.mkdirSync(projSkill, { recursive: true });
    fs.writeFileSync(path.join(projSkill, "SKILL.md"), "---\nname: myskill\n---\nPROJECT-INSTANCE\n");
    // A same-named plugin-tree skill that must LOSE to the project instance.
    const pluginSkill = path.join(tmpDir, "skills", "meta", "myskill");
    fs.mkdirSync(pluginSkill, { recursive: true });
    fs.writeFileSync(path.join(pluginSkill, "SKILL.md"), "---\nname: myskill\n---\nPLUGIN-TREE\n");

    const result = spawnSync(
      "npx",
      ["tsx", EVOLVE_LOOP, "--skill", "myskill", "--run-id", "r1", "--cwd", tmpDir],
      { encoding: "utf8", timeout: 120_000 }
    );
    expect(result.status).toBe(0);
    const snap = path.join(tmpDir, ".guild", "skill-versions", "myskill", "v1", "SKILL.md");
    expect(fs.readFileSync(snap, "utf8")).toContain("PROJECT-INSTANCE");
    const pipeline = fs.readFileSync(
      path.join(tmpDir, ".guild", "evolve", "r1", "pipeline.md"),
      "utf8"
    );
    expect(pipeline).toContain(".guild/skills/myskill");
  });

  it("falls back to the plugin tree (all six tiers) when no project instance exists", () => {
    const tmpDir = mkTmp("guild-evolve-tier-");
    const tierSkill = path.join(tmpDir, "skills", "guild-quality", "qskill");
    fs.mkdirSync(tierSkill, { recursive: true });
    fs.writeFileSync(path.join(tierSkill, "SKILL.md"), "---\nname: qskill\n---\nTIER\n");

    const result = spawnSync(
      "npx",
      ["tsx", EVOLVE_LOOP, "--skill", "qskill", "--run-id", "r1", "--cwd", tmpDir],
      { encoding: "utf8", timeout: 120_000 }
    );
    expect(result.status).toBe(0);
    const snap = path.join(tmpDir, ".guild", "skill-versions", "qskill", "v1", "SKILL.md");
    expect(fs.readFileSync(snap, "utf8")).toContain("TIER");
  });
});
