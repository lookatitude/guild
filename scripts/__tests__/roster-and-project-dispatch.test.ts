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
  resolveRoster,
  tierForModel,
} from "../lib/roster";
import { composeInProcessDispatch } from "../lib/host/inprocess-backend";
import { GENERIC_SUBAGENT_TYPE } from "../lib/core/contracts/team-backend";
import type { Specialist, TeamLaunchRequest } from "../lib/core/contracts/team-backend";
import { buildPrompt } from "../lib/host/tmux-backend";

const LAUNCHER = path.resolve(__dirname, "../agent-team-launcher.ts");
const EVOLVE_LOOP = path.resolve(__dirname, "../evolve-loop.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

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
});

describe("agent-team-launcher parseYaml — no generic `source:` alias", () => {
  it("a per-specialist `source:` key never sets definition_source", () => {
    const tmpDir = mkTmp("guild-launcher-src-");
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
    const result = spawnSync(
      "npx",
      ["tsx", LAUNCHER, "--team", teamPath, "--cwd", tmpDir, "--dry-run"],
      { encoding: "utf8", env, timeout: 30000 }
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

describe("agent-team-launcher CLI — definition threading (dry-run)", () => {
  it("team.yaml definition fields reach the pane prompt", () => {
    const tmpDir = mkTmp("guild-launcher-def-");
    const teamDir = path.join(tmpDir, ".guild", "team");
    fs.mkdirSync(teamDir, { recursive: true });
    const teamPath = path.join(teamDir, "test-slug.yaml");
    fs.copyFileSync(path.join(FIXTURES, "team-project-specialist.yaml"), teamPath);

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "TMUX") env[k] = v;
    }
    const result = spawnSync(
      "npx",
      ["tsx", LAUNCHER, "--team", teamPath, "--cwd", tmpDir, "--dry-run"],
      { encoding: "utf8", env, timeout: 30000 }
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Your role definition is at `.guild/agents/kb-viz-engineer.md`"
    );
    // The shipped lane must NOT carry the adoption instruction.
    const architectPane = result.stdout
      .split("\n")
      .filter((l) => l.includes("You are the `architect` teammate"));
    expect(architectPane.length).toBeGreaterThan(0);
    expect(architectPane[0]).not.toContain("Your role definition");
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
      { encoding: "utf8", timeout: 30000 }
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
      { encoding: "utf8", timeout: 30000 }
    );
    expect(result.status).toBe(0);
    const snap = path.join(tmpDir, ".guild", "skill-versions", "qskill", "v1", "SKILL.md");
    expect(fs.readFileSync(snap, "utf8")).toContain("TIER");
  });
});
