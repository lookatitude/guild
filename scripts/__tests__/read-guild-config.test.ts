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

    // ── defect guard: scaffold must not emit the deprecated key so a fresh
    //    settings.json never self-triggers the DEPRECATED warning on every read.
    test("--scaffold output does NOT contain defaults.agent_team (fresh scaffold must be warn-free)", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      // The deprecated key must be absent from the scaffold — top-level agent_mode replaces it.
      expect(j.defaults.agent_team).toBeUndefined();
    });

    // ── back-compat read path is still active: an EXISTING config with agent_team
    //    must still warn once on stderr (covered by the tests above that write
    //    settings.json with defaults.agent_team — kept here as an explicit sanity pin).
    test("reading a settings.json that contains defaults.agent_team still emits DEPRECATED warning", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { agent_team: "auto" } });
      const { status, err } = run(["--cwd", dir]);
      expect(status).toBe(0);
      expect(err).toMatch(/defaults\.agent_team.*DEPRECATED|DEPRECATED.*agent_team/i);
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

  // ── models: block (cost-aware-tiering-and-lean-context ADR §10, VC-10) ──────
  describe("models: block (ADR §10 — cost-aware tiering config)", () => {
    // ── scaffold ──────────────────────────────────────────────────────────────

    test("--scaffold includes models block with all required keys + _help entries", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models).toBeDefined();
      expect(j.models.enabled).toBe(true);
      expect(j.models.tiers).toBeDefined();
      expect(j.models.tiers.cheap).toBeDefined();
      expect(j.models.tiers.mid).toBeDefined();
      expect(j.models.tiers.powerful).toBeDefined();
      expect(j.models.scoreWeights).toBeDefined();
      expect(j.models.thresholds).toEqual({ mid: 1, powerful: 3 });
      expect(j.models.advisorRounds).toBe(2);
      expect(Array.isArray(j.models.escalationMarkers)).toBe(true);
      expect(j.models.recallBeforeRead).toBe(true);
      expect(j.models.recallScoreThreshold).toBe(0.4);
      expect(j.models.structuredOutputRequired).toBe(true);
      expect(j.models.cacheTTL).toEqual({ coordinator: "1h", leaf: "5m" });
      expect(j.models.importanceGate).toBe(3);
      // _help entries
      expect(j._help["models.enabled"]).toBeDefined();
      expect(j._help["models.tiers"]).toBeDefined();
      expect(j._help["models.scoreWeights"]).toBeDefined();
      expect(j._help["models.thresholds"]).toBeDefined();
      expect(j._help["models.advisorRounds"]).toBeDefined();
      expect(j._help["models.escalationMarkers"]).toBeDefined();
      expect(j._help["models.recallBeforeRead"]).toBeDefined();
      expect(j._help["models.recallScoreThreshold"]).toBeDefined();
      expect(j._help["models.structuredOutputRequired"]).toBeDefined();
      expect(j._help["models.cacheTTL.coordinator"]).toBeDefined();
      expect(j._help["models.cacheTTL.leaf"]).toBeDefined();
      expect(j._help["models.importanceGate"]).toBeDefined();
    });

    test("--scaffold default tier map is cheap=haiku, mid=sonnet, powerful=opus (ADR §1)", () => {
      const { out } = run(["--scaffold"]);
      const j = JSON.parse(out);
      expect(j.models.tiers.cheap.claude).toBe("haiku");
      expect(j.models.tiers.mid.claude).toBe("sonnet");
      expect(j.models.tiers.powerful.claude).toBe("opus");
      // codex and gemini are null (no third host yet)
      expect(j.models.tiers.cheap.codex).toBeNull();
      expect(j.models.tiers.cheap.gemini).toBeNull();
      expect(j.models.tiers.mid.codex).toBeNull();
      expect(j.models.tiers.powerful.codex).toBeNull();
    });

    test("--scaffold _precedence includes model-tier ladder", () => {
      const { out } = run(["--scaffold"]);
      const j = JSON.parse(out);
      expect(j._help._precedence).toMatch(/model-tier|--model-tier/i);
    });

    // ── zero-config behavior ──────────────────────────────────────────────────

    test("no settings.json → models defaults present (zero-config behavior preserved)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models).toBeDefined();
      expect(j.models.enabled).toBe(true);
      expect(j.models.tiers.cheap.claude).toBe("haiku");
      expect(j.models.advisorRounds).toBe(2);
      expect(j.models.recallScoreThreshold).toBe(0.4);
    });

    // ── settings.json overrides ───────────────────────────────────────────────

    test("settings.json models.enabled: false is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { models: { enabled: false } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.enabled).toBe(false);
      // Tier defaults still present (deep-merge)
      expect(j.models.tiers.cheap.claude).toBe("haiku");
    });

    test("settings.json partial models.tiers override merges over defaults", () => {
      const dir = repo();
      writeSettings(dir, { models: { tiers: { cheap: { claude: "sonnet", codex: null, gemini: null } } } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.tiers.cheap.claude).toBe("sonnet"); // overridden
      expect(j.models.tiers.mid.claude).toBe("sonnet");   // default still present
      expect(j.models.tiers.powerful.claude).toBe("opus"); // default still present
    });

    test("settings.json models.advisorRounds: 4 is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { models: { advisorRounds: 4 } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.advisorRounds).toBe(4);
    });

    test("settings.json models.recallScoreThreshold: 0.7 is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { models: { recallScoreThreshold: 0.7 } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.recallScoreThreshold).toBe(0.7);
    });

    test("settings.json models.thresholds partial override merges over defaults", () => {
      const dir = repo();
      writeSettings(dir, { models: { thresholds: { mid: 2, powerful: 4 } } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.thresholds.mid).toBe(2);
      expect(j.models.thresholds.powerful).toBe(4);
    });

    test("settings.json models.importanceGate: 2 is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { models: { importanceGate: 2 } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.importanceGate).toBe(2);
    });

    test("settings.json models.cacheTTL partial override merges over defaults", () => {
      const dir = repo();
      writeSettings(dir, { models: { cacheTTL: { coordinator: "5m", leaf: "off" } } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.cacheTTL.coordinator).toBe("5m");
      expect(j.models.cacheTTL.leaf).toBe("off");
    });

    test("settings.json models.escalationMarkers: custom array is read and resolved", () => {
      const dir = repo();
      const markers = ["not certain", "need more info"];
      writeSettings(dir, { models: { escalationMarkers: markers } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.escalationMarkers).toEqual(markers);
    });

    test("settings.json models.recallBeforeRead: false is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { models: { recallBeforeRead: false } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.recallBeforeRead).toBe(false);
    });

    test("settings.json models.structuredOutputRequired: false is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { models: { structuredOutputRequired: false } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.structuredOutputRequired).toBe(false);
    });

    // ── --validate closed-key rejection ──────────────────────────────────────

    test("--validate rejects unknown models.* key (closed key set)", () => {
      const dir = repo();
      writeSettings(dir, { models: { bogusField: true } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/unknown models key "bogusField"/);
    });

    test("--validate rejects unknown models.cacheTTL.* key", () => {
      const dir = repo();
      writeSettings(dir, { models: { cacheTTL: { coordinator: "1h", leaf: "5m", extra: "on" } } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/unknown models\.cacheTTL key "extra"/);
    });

    test("--validate rejects invalid models.cacheTTL.coordinator value", () => {
      const dir = repo();
      writeSettings(dir, { models: { cacheTTL: { coordinator: "10m", leaf: "5m" } } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/models\.cacheTTL\.coordinator.*invalid|invalid.*models\.cacheTTL/i);
    });

    test("--validate rejects models.importanceGate out of 1–5 range", () => {
      const dir = repo();
      writeSettings(dir, { models: { importanceGate: 7 } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/models\.importanceGate/);
    });

    test("--validate rejects models.advisorRounds < 1", () => {
      const dir = repo();
      writeSettings(dir, { models: { advisorRounds: 0 } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/models\.advisorRounds/);
    });

    test("--validate rejects models.recallScoreThreshold out of 0–1", () => {
      const dir = repo();
      writeSettings(dir, { models: { recallScoreThreshold: 1.5 } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/models\.recallScoreThreshold/);
    });

    test("--validate rejects unknown models.thresholds key", () => {
      const dir = repo();
      writeSettings(dir, { models: { thresholds: { mid: 1, powerful: 3, extreme: 5 } } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/unknown models\.thresholds key "extreme"/);
    });

    test("--validate passes a clean models block", () => {
      const dir = repo();
      writeSettings(dir, {
        models: {
          enabled: true,
          advisorRounds: 3,
          recallScoreThreshold: 0.5,
          importanceGate: 2,
          recallBeforeRead: true,
          structuredOutputRequired: true,
          cacheTTL: { coordinator: "1h", leaf: "5m" },
        },
      });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });

    // ── --model-tier CLI escape hatch ─────────────────────────────────────────

    test("--model-tier=cheap is surfaced in _model_tier_override", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir, "--model-tier=cheap"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j._model_tier_override).toBeDefined();
      expect(j._model_tier_override.tier).toBe("cheap");
      expect(j._model_tier_override.source).toMatch(/--model-tier/);
    });

    test("--model-tier=mid is surfaced in _model_tier_override", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir, "--model-tier=mid"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j._model_tier_override.tier).toBe("mid");
    });

    test("--model-tier=powerful is surfaced in _model_tier_override", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir, "--model-tier=powerful"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j._model_tier_override.tier).toBe("powerful");
    });

    test("--model-tier=bogus is silently ignored (no _model_tier_override)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir, "--model-tier=bogus"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j._model_tier_override).toBeUndefined();
    });

    test("no --model-tier flag → no _model_tier_override in output", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j._model_tier_override).toBeUndefined();
    });
  });

  // ── models.ingestSimilarityGate (D-INGEST-GATE — v2-security-and-untrusted-content ADR)
  describe("models.ingestSimilarityGate (D-INGEST-GATE)", () => {
    test("--scaffold includes models.ingestSimilarityGate: 0.80 + _help entry", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.ingestSimilarityGate).toBe(0.8);
      expect(j._help["models.ingestSimilarityGate"]).toBeDefined();
      expect(j._help["models.ingestSimilarityGate"]).toMatch(/D-INGEST-GATE|ingest|BM25/i);
    });

    test("no settings.json → models.ingestSimilarityGate defaults to 0.80 (zero-config)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.ingestSimilarityGate).toBe(0.8);
    });

    test("settings.json models.ingestSimilarityGate: 0.90 is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { models: { ingestSimilarityGate: 0.9 } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.models.ingestSimilarityGate).toBe(0.9);
    });

    test("--validate rejects models.ingestSimilarityGate > 1", () => {
      const dir = repo();
      writeSettings(dir, { models: { ingestSimilarityGate: 1.5 } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/models\.ingestSimilarityGate/);
    });

    test("--validate rejects models.ingestSimilarityGate < 0", () => {
      const dir = repo();
      writeSettings(dir, { models: { ingestSimilarityGate: -0.1 } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/models\.ingestSimilarityGate/);
    });

    test("--validate passes models.ingestSimilarityGate: 0.75", () => {
      const dir = repo();
      writeSettings(dir, { models: { ingestSimilarityGate: 0.75 } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });
  });

  // ── security: block (D-BYPASS — v2-security-and-untrusted-content ADR)
  describe("security: block (D-BYPASS)", () => {
    test("--scaffold includes security block + bypass_permissions_policy: audit + _help entry", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.security).toBeDefined();
      expect(j.security.bypass_permissions_policy).toBe("audit");
      expect(j._help["security.bypass_permissions_policy"]).toBeDefined();
      expect(j._help["security.bypass_permissions_policy"]).toMatch(/deny|audit|allow/i);
    });

    test("no settings.json → security defaults to audit (zero-config)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.security.bypass_permissions_policy).toBe("audit");
    });

    test("settings.json security.bypass_permissions_policy: deny is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { security: { bypass_permissions_policy: "deny" } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.security.bypass_permissions_policy).toBe("deny");
    });

    test("settings.json security.bypass_permissions_policy: allow is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { security: { bypass_permissions_policy: "allow" } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.security.bypass_permissions_policy).toBe("allow");
    });

    test("--validate rejects unknown security.* key (closed key set)", () => {
      const dir = repo();
      writeSettings(dir, { security: { bypass_permissions_policy: "audit", unknown_key: true } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/unknown security key "unknown_key"/);
    });

    test("--validate rejects invalid bypass_permissions_policy value", () => {
      const dir = repo();
      writeSettings(dir, { security: { bypass_permissions_policy: "silent" } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/bypass_permissions_policy/);
    });

    test("--validate passes valid security block", () => {
      const dir = repo();
      writeSettings(dir, { security: { bypass_permissions_policy: "deny" } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });
  });

  // ── secrets_policy: block (D-SECRETS — v2-security-and-untrusted-content ADR)
  describe("secrets_policy: block (D-SECRETS)", () => {
    test("--scaffold includes secrets_policy block with defaults + _help entries", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.secrets_policy).toBeDefined();
      expect(j.secrets_policy.env_allowlist).toEqual([]);
      expect(j.secrets_policy.redaction_patterns).toEqual([]);
      expect(j.secrets_policy.fail_mode_durable).toBe("closed");
      expect(j.secrets_policy.fail_mode_telemetry).toBe("open");
      expect(j._help["secrets_policy.env_allowlist"]).toBeDefined();
      expect(j._help["secrets_policy.redaction_patterns"]).toBeDefined();
      expect(j._help["secrets_policy.fail_mode_durable"]).toBeDefined();
      expect(j._help["secrets_policy.fail_mode_telemetry"]).toBeDefined();
    });

    test("no settings.json → secrets_policy defaults present (zero-config)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.secrets_policy.fail_mode_durable).toBe("closed");
      expect(j.secrets_policy.fail_mode_telemetry).toBe("open");
      expect(j.secrets_policy.env_allowlist).toEqual([]);
    });

    test("settings.json secrets_policy overrides are read and resolved", () => {
      const dir = repo();
      writeSettings(dir, {
        secrets_policy: {
          env_allowlist: ["MY_API_KEY", "GITHUB_TOKEN"],
          redaction_patterns: ["sk-[a-z0-9]{48}"],
          fail_mode_durable: "open",
          fail_mode_telemetry: "closed",
        },
      });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.secrets_policy.env_allowlist).toEqual(["MY_API_KEY", "GITHUB_TOKEN"]);
      expect(j.secrets_policy.redaction_patterns).toEqual(["sk-[a-z0-9]{48}"]);
      expect(j.secrets_policy.fail_mode_durable).toBe("open");
      expect(j.secrets_policy.fail_mode_telemetry).toBe("closed");
    });

    test("--validate rejects unknown secrets_policy.* key (closed key set)", () => {
      const dir = repo();
      writeSettings(dir, { secrets_policy: { env_allowlist: [], bogus_key: true } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/unknown secrets_policy key "bogus_key"/);
    });

    test("--validate rejects invalid fail_mode_durable value", () => {
      const dir = repo();
      writeSettings(dir, { secrets_policy: { fail_mode_durable: "silent" } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/fail_mode_durable/);
    });

    test("--validate rejects invalid fail_mode_telemetry value", () => {
      const dir = repo();
      writeSettings(dir, { secrets_policy: { fail_mode_telemetry: "warn" } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/fail_mode_telemetry/);
    });

    test("--validate passes a clean secrets_policy block", () => {
      const dir = repo();
      writeSettings(dir, {
        secrets_policy: {
          env_allowlist: ["GITHUB_TOKEN"],
          redaction_patterns: [],
          fail_mode_durable: "closed",
          fail_mode_telemetry: "open",
        },
      });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });
  });

  // ── mcp: block (D-MCP — v2-security-and-untrusted-content ADR)
  describe("mcp: block (D-MCP)", () => {
    test("--scaffold includes mcp block with empty hashes + _help entry", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.mcp).toBeDefined();
      expect(j.mcp.tool_description_hashes).toEqual({});
      expect(j._help["mcp.tool_description_hashes"]).toBeDefined();
      expect(j._help["mcp.tool_description_hashes"]).toMatch(/SHA-256|hash|D-MCP/i);
    });

    test("no settings.json → mcp.tool_description_hashes defaults to {} (zero-config)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.mcp.tool_description_hashes).toEqual({});
    });

    test("settings.json mcp.tool_description_hashes with entries is read and resolved", () => {
      const dir = repo();
      const hashes = { "wiki_search": "abc123def456", "telemetry_query": "789xyz" };
      writeSettings(dir, { mcp: { tool_description_hashes: hashes } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.mcp.tool_description_hashes).toEqual(hashes);
    });

    test("--validate rejects unknown mcp.* key (closed key set)", () => {
      const dir = repo();
      writeSettings(dir, { mcp: { tool_description_hashes: {}, unknown_field: true } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/unknown mcp key "unknown_field"/);
    });

    test("--validate passes a clean mcp block", () => {
      const dir = repo();
      writeSettings(dir, { mcp: { tool_description_hashes: { "guild-memory:wiki_search": "sha256abc" } } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });
  });

  // ── defaults.index: block (D-PS-1 — v2-persistence-and-sqlite-index ADR)
  describe("defaults.index: block (D-PS-1 SQLite lazy-cache thresholds)", () => {
    test("--scaffold includes defaults.index block with all 6 keys + _help entries", () => {
      const { status, out } = run(["--scaffold"]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.defaults.index).toBeDefined();
      expect(j.defaults.index.enabled).toBe(true);
      expect(j.defaults.index.kg_node_threshold).toBe(2000);
      expect(j.defaults.index.kg_size_threshold_mb).toBe(1);
      expect(j.defaults.index.links_edge_threshold).toBe(2000);
      expect(j.defaults.index.runs_threshold).toBe(20);
      expect(j.defaults.index.wiki_file_threshold).toBe(500);
      expect(j._help["defaults.index.enabled"]).toBeDefined();
      expect(j._help["defaults.index.kg_node_threshold"]).toBeDefined();
      expect(j._help["defaults.index.kg_size_threshold_mb"]).toBeDefined();
      expect(j._help["defaults.index.links_edge_threshold"]).toBeDefined();
      expect(j._help["defaults.index.runs_threshold"]).toBeDefined();
      expect(j._help["defaults.index.wiki_file_threshold"]).toBeDefined();
    });

    test("no settings.json → defaults.index present with all built-in defaults (zero-config)", () => {
      const dir = repo();
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.defaults.index.enabled).toBe(true);
      expect(j.defaults.index.kg_node_threshold).toBe(2000);
      expect(j.defaults.index.wiki_file_threshold).toBe(500);
    });

    test("settings.json defaults.index overrides are read and resolved (deep-merge over defaults)", () => {
      const dir = repo();
      writeSettings(dir, {
        defaults: {
          index: {
            enabled: false,
            wiki_file_threshold: 200,
          },
        },
      });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.defaults.index.enabled).toBe(false);
      expect(j.defaults.index.wiki_file_threshold).toBe(200);
      // un-overridden keys keep defaults via deep-merge
      expect(j.defaults.index.kg_node_threshold).toBe(2000);
      expect(j.defaults.index.runs_threshold).toBe(20);
    });

    test("settings.json defaults.index.enabled: true is read and resolved", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { index: { enabled: true } } });
      const { status, out } = run(["--cwd", dir]);
      expect(status).toBe(0);
      const j = JSON.parse(out);
      expect(j.defaults.index.enabled).toBe(true);
    });

    test("--validate rejects unknown defaults.index.* key (closed key set)", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { index: { enabled: true, bogus_threshold: 999 } } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/unknown defaults\.index key "bogus_threshold"/);
    });

    test("--validate accepts defaults key (index is now in ALLOWED set)", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { index: { enabled: false } } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });

    test("--validate rejects defaults.index.enabled as non-boolean", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { index: { enabled: "yes" } } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/defaults\.index\.enabled/);
    });

    test("--validate rejects defaults.index.kg_node_threshold < 1", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { index: { kg_node_threshold: 0 } } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/defaults\.index\.kg_node_threshold/);
    });

    test("--validate rejects defaults.index.kg_size_threshold_mb <= 0", () => {
      const dir = repo();
      writeSettings(dir, { defaults: { index: { kg_size_threshold_mb: -1 } } });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(1);
      expect(out).toMatch(/defaults\.index\.kg_size_threshold_mb/);
    });

    test("--validate passes a complete valid defaults.index block", () => {
      const dir = repo();
      writeSettings(dir, {
        defaults: {
          index: {
            enabled: true,
            kg_node_threshold: 3000,
            kg_size_threshold_mb: 2,
            links_edge_threshold: 1500,
            runs_threshold: 30,
            wiki_file_threshold: 1000,
          },
        },
      });
      const { status, out } = run(["--cwd", dir, "--validate"]);
      expect(status).toBe(0);
      expect(out).toMatch(/VALID/);
    });
  });
});
