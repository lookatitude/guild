import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// read-guild-config.ts is silent on stdout==config / stderr==warnings only.
// Suppress the tsx-loader DEP0205 deprecation noise so assertions are clean.
const SCRIPT = path.resolve(__dirname, "..", "read-guild-config.ts");
const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

function run(args: string[], extraEnv: Record<string, string> = {}): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", env: { ...ENV, ...extraEnv } });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function mkRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cfg-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  return dir;
}

function writeSettings(dir: string, obj: unknown): void {
  fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(obj, null, 2));
}

describe("read-guild-config.ts — .guild/settings.json surface", () => {
  const repos: string[] = [];
  afterAll(() => repos.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const repo = () => {
    const d = mkRepo();
    repos.push(d);
    return d;
  };

  test("--scaffold emits valid JSON with all keys + _help block", () => {
    const { status, out } = run(["--scaffold"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.rigor).toBe("standard");
    expect(j.review).toBe("local");
    expect(j.defaults.adversarial).toBe("on");
    expect(j.defaults.quality.budget.per_class_minutes).toBe(10);
    expect(j._help).toBeDefined();
    expect(j._help._precedence).toMatch(/CLI flag > --rigor profile > settings\.json > built-in/);
  });

  test("settings.json overrides built-in defaults", () => {
    const dir = repo();
    writeSettings(dir, { rigor: "deep", review: "cross", defaults: { agent_team: "on" } });
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.rigor).toBe("deep");
    expect(j.review).toBe("cross");
    expect(j.defaults.agent_team).toBe("on");
    expect(j.defaults.adversarial).toBe("on"); // unspecified key keeps default (deep-merge)
  });

  test("CLI flag overrides settings.json (flags win)", () => {
    const dir = repo();
    writeSettings(dir, { rigor: "deep", review: "cross" });
    const { out } = run(["--cwd", dir, "--rigor=quick", "--review=off"]);
    const j = JSON.parse(out);
    expect(j.rigor).toBe("quick");
    expect(j.review).toBe("off");
  });

  test("config.yml back-compat shim migrates + warns once when settings.json absent", () => {
    const dir = repo();
    fs.writeFileSync(
      path.join(dir, ".guild", "config.yml"),
      "loops: all\ncodex_review: true\nauto_approve: spec-and-plan\n"
    );
    const { status, out, err } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.loops).toBe("all");
    expect(j.review).toBe("cross"); // codex_review:true → review:cross
    expect(j.auto_approve).toEqual(["spec", "plan"]); // spec-and-plan → [spec,plan]
    expect(err).toMatch(/config\.yml is DEPRECATED/);
  });

  test("settings.json takes precedence over a legacy config.yml (authoritative)", () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, ".guild", "config.yml"), "loops: all\n");
    writeSettings(dir, { rigor: "deep" });
    const { out, err } = run(["--cwd", dir]);
    const j = JSON.parse(out);
    expect(j.rigor).toBe("deep");
    expect(err).not.toMatch(/DEPRECATED/); // config.yml ignored when settings.json present
  });

  test("--validate rejects an unknown defaults.* key (closed-key)", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { bogus_key: true } });
    const { status, out } = run(["--cwd", dir, "--validate"]);
    expect(status).toBe(1);
    expect(out).toMatch(/unknown defaults key "bogus_key"/);
  });

  test("--validate rejects defaults.wiki.autopromote: true always", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { wiki: { autopromote: true } } });
    const { status, out } = run(["--cwd", dir, "--validate"]);
    expect(status).toBe(1);
    expect(out).toMatch(/autopromote: true is REJECTED/);
  });

  test("--validate rejects defaults.adversarial: off only with --self-build", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { adversarial: "off" } });
    const selfBuild = run(["--cwd", dir, "--validate", "--self-build"]);
    expect(selfBuild.status).toBe(1);
    expect(selfBuild.out).toMatch(/adversarial: off is REJECTED for Guild self-build/);
    const consumer = run(["--cwd", dir, "--validate"]);
    expect(consumer.status).toBe(0); // allowed for a normal consuming repo
  });

  test("--validate passes a clean settings.json", () => {
    const dir = repo();
    writeSettings(dir, { rigor: "standard", defaults: { adversarial: "on" } });
    const { status, out } = run(["--cwd", dir, "--validate"]);
    expect(status).toBe(0);
    expect(out).toMatch(/VALID/);
  });

  // ── --rigor profile expansion (command-surface.md §4.3 — the anti-soup mechanism).
  describe("--rigor profile expansion (§4.3)", () => {
    test("rigor=deep → loops=all + review=cross + _rigor_expanded present", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir, "--rigor=deep"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.rigor).toBe("deep");
      expect(j.loops).toBe("all");
      expect(j.review).toBe("cross"); // deep auto-implies cross (host available by default)
      expect(j.loop_cap).toBe(16);
      expect(j._rigor_expanded).toBeDefined();
      expect(j._rigor_expanded.rigor).toBe("deep");
      expect(j._rigor_expanded.review_implied).toBe("cross");
      expect(j._rigor_expanded.applied).toEqual(expect.arrayContaining(["loops", "review", "loop_cap"]));
    });

    test("default (rigor=standard, nothing else) → loops=spec,plan + review=local", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir]); // no flags, no settings.json
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.rigor).toBe("standard");
      expect(j.loops).toBe("spec,plan");
      expect(j.review).toBe("local");
      expect(j._rigor_expanded.applied).toEqual(expect.arrayContaining(["loops", "review"]));
    });

    test("rigor=quick → loops=none + review=off (loop_cap N/A)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir, "--rigor=quick"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.rigor).toBe("quick");
      expect(j.loops).toBe("none");
      expect(j.review).toBe("off");
      expect(j._rigor_expanded.loop_cap).toBeNull(); // "—" for quick
    });

    test("explicit --review=off beats rigor=deep (flag wins over derived)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir, "--rigor=deep", "--review=off"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.rigor).toBe("deep");
      expect(j.review).toBe("off"); // explicit flag wins
      expect(j.loops).toBe("all"); // loops still derived (not pinned)
      expect(j._rigor_expanded.overridden_by_explicit).toContain("review");
    });

    test("settings.json explicit loops=none beats rigor=standard's spec,plan", () => {
      const dir = repo();
      writeSettings(dir, { loops: "none" }); // rigor defaults to standard
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.rigor).toBe("standard");
      expect(j.loops).toBe("none"); // explicit settings.json value wins over spec,plan
      expect(j._rigor_expanded.overridden_by_explicit).toContain("loops");
      expect(j._rigor_expanded.loops).toBe("spec,plan"); // annotation still shows what rigor WOULD derive
    });

    test("explicit loops: null in settings.json is NOT a choice — rigor still derives", () => {
      const dir = repo();
      writeSettings(dir, { rigor: "deep", loops: null });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.loops).toBe("all"); // null means "derive from rigor", so deep fills it
      expect(j._rigor_expanded.applied).toContain("loops");
    });

    test("deep falls back to review=local + note when cross-host unavailable (D7, never hard-fails)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir, "--rigor=deep"], { GUILD_CROSS_HOST_AVAILABLE: "0" });
      expect(status).toBe(0); // NEVER a hard failure on host outage
      const j = JSON.parse(out);
      expect(j.review).toBe("local"); // fell back from cross
      expect(j._rigor_expanded.review_fallback).toBe(true);
      expect(j._rigor_expanded.review_implied).toBe("cross");
      expect(j._rigor_expanded.note).toMatch(/weak-independence/);
    });
  });

  // ── D3: defaults.auto_learn (closed key, bool, default false)
  describe("defaults.auto_learn (D3)", () => {
    test("--scaffold includes defaults.auto_learn: false + _help entry", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.defaults.auto_learn).toBe(false);
      expect(j._help["defaults.auto_learn"]).toBeDefined();
      expect(j._help["defaults.auto_learn"]).toMatch(/auto_learn|learn-\*/i);
    });

    test("settings.json with defaults.auto_learn: true is read and present in output", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { auto_learn: true } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.defaults.auto_learn).toBe(true);
    });

    test("settings.json with defaults.auto_learn: false resolves to false", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { auto_learn: false } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.defaults.auto_learn).toBe(false);
    });

    test("--validate accepts defaults.auto_learn (closed-key passes)", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { auto_learn: true } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });

    test("defaults.auto_learn absent from settings.json defaults to false via deep-merge", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { adversarial: "on" } }); // no auto_learn key
      const { out } = run(["--cwd", dir]);
      const j = JSON.parse(out);
      expect(j.defaults.auto_learn).toBe(false); // DEFAULTS.defaults fills it
    });
  });

  // ── D5: agent_mode Tier-1 key
  describe("agent_mode (D5 Tier-1 key)", () => {
    test("--scaffold includes agent_mode: auto + _help entry", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("auto");
      expect(j._help["agent_mode"]).toBeDefined();
      expect(j._help["agent_mode"]).toMatch(/team|agent|subagent|auto/i);
    });

    test("settings.json agent_mode=team is read as Tier-1", () => {
      const dir = repo();
      writeSettings(dir, { agent_mode: "team" });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("team");
    });

    test("settings.json agent_mode=subagent is read as Tier-1", () => {
      const dir = repo();
      writeSettings(dir, { agent_mode: "subagent" });
      const { out } = run(["--cwd", dir]);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("subagent");
    });

    test("settings.json agent_mode=agent is read as Tier-1", () => {
      const dir = repo();
      writeSettings(dir, { agent_mode: "agent" });
      const { out } = run(["--cwd", dir]);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("agent");
    });

    test("--agent-mode=subagent CLI flag overrides settings.json agent_mode=team (flag wins)", () => {
      const dir = repo();
      writeSettings(dir, { agent_mode: "team" });
      const { out } = run(["--cwd", dir, "--agent-mode=subagent"]);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("subagent");
    });

    test("--agent-mode=team CLI flag overrides settings.json agent_mode=auto (flag wins)", () => {
      const dir = repo();
      writeSettings(dir, { agent_mode: "auto" });
      const { out } = run(["--cwd", dir, "--agent-mode=team"]);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("team");
    });

    test("built-in default for agent_mode is auto when not set anywhere", () => {
      const dir = repo(); // no settings.json
      const { out } = run(["--cwd", dir]);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("auto");
    });

    test("invalid --agent-mode= value is silently ignored (falls back to default)", () => {
      const dir = repo();
      const { out } = run(["--cwd", dir, "--agent-mode=bogus"]);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("auto"); // invalid → ignored, default applies
    });
  });

  // ── D5: defaults.agent_team deprecation alias (warn-once)
  describe("defaults.agent_team deprecation (D5 alias → agent_mode)", () => {
    test("defaults.agent_team: on warns on stderr and translates to agent_mode: team", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { agent_team: "on" } });
      const { status, out, err } = run(["--cwd", dir]);
      expect(status).toBe(0);
      expect(err).toMatch(/agent_team.*DEPRECATED|DEPRECATED.*agent_team/i);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("team"); // on → team
      expect(j.defaults.agent_team).toBe("on"); // still present in defaults (deep-merge)
    });

    test("defaults.agent_team: off warns and translates to agent_mode: subagent", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { agent_team: "off" } });
      const { status, out, err } = run(["--cwd", dir]);
      expect(status).toBe(0);
      expect(err).toMatch(/DEPRECATED/);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("subagent"); // off → subagent
    });

    test("defaults.agent_team: auto warns and translates to agent_mode: auto", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { agent_team: "auto" } });
      const { out, err } = run(["--cwd", dir]);
      expect(err).toMatch(/DEPRECATED/);
      const j = JSON.parse(out);
      expect(j.agent_mode).toBe("auto"); // auto → auto
    });

    test("explicit Tier-1 agent_mode wins over deprecated defaults.agent_team alias", () => {
      const dir = repo();
      // agent_mode=subagent at Tier-1, agent_team: on in defaults
      writeSettings(dir, { agent_mode: "subagent", defaults: { agent_team: "on" } });
      const { out, err } = run(["--cwd", dir]);
      // Deprecation warning still fires (agent_team is present)
      expect(err).toMatch(/DEPRECATED/);
      const j = JSON.parse(out);
      // Tier-1 wins: subagent, not "team" from the alias
      expect(j.agent_mode).toBe("subagent");
    });

    test("defaults.agent_team still passes --validate (kept in ALLOWED set)", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { agent_team: "on" } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0); // deprecated but not rejected
      expect(out).toMatch(/VALID/);
    });
  });

  // ── workspace.mode (guild.workspace.v1) ─────────────────────────────────────
  describe("workspace.mode (guild.workspace.v1)", () => {
    test("--scaffold includes workspace.mode: auto and _help entry", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.workspace).toBeDefined();
      expect(j.workspace.mode).toBe("auto");
      expect(j._help["workspace.mode"]).toBeDefined();
      expect(j._help["workspace.mode"]).toMatch(/auto.*on.*off|on.*auto/i);
    });

    test("settings.json workspace.mode=on is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { workspace: { mode: "on" } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.workspace.mode).toBe("on");
    });

    test("settings.json workspace.mode=off is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { workspace: { mode: "off" } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.workspace.mode).toBe("off");
    });

    test("default workspace.mode is auto when not set in settings.json", () => {
      const dir = repo();
      // no settings.json
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.workspace.mode).toBe("auto");
    });

    test("--validate rejects unknown workspace.* key (closed key set, no max_depth)", () => {
      const dir = repo();
      writeSettings(dir, { workspace: { mode: "auto", max_depth: 2 } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/unknown workspace key "max_depth"/);
    });

    test("--validate passes valid workspace.mode: auto", () => {
      const dir = repo();
      writeSettings(dir, { workspace: { mode: "auto" } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });

    test("--validate passes valid workspace.mode: on", () => {
      const dir = repo();
      writeSettings(dir, { workspace: { mode: "on" } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });

    test("--validate passes valid workspace.mode: off", () => {
      const dir = repo();
      writeSettings(dir, { workspace: { mode: "off" } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });
  });
});
