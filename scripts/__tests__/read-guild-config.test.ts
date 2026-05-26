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
});
