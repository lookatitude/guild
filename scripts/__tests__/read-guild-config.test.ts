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
});
