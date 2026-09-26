/**
 * tests/verification-contract/verification-contract.test.ts
 *
 * The Verification Contract (plugin-layout-implementation-plan rev 20) as one
 * suite, indexed by R-id in ./index.json. Every row resolves to real fixtures:
 *
 *   - a test title in a test file (the file must exist and still carry it),
 *   - a layout-laws check that flags its planted fixture AND leaves the live
 *     tree with zero open violations,
 *   - a description-budget leg that passes live and fails on a planted
 *     over-budget manifest,
 *   - or a fixture authored below, whose title starts with the row id.
 *
 * A row a later lane owns is a test.todo naming that lane; nothing else pends.
 * build-coverage-draft.ts reads the same index and lists every row as a
 * `kind: eval` entry carrying its R-ids.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { measure } from "../../scripts/lint/description-budget";
import { policyKeySpec } from "../../src/domains/config";
import { CELL_LAST_FAILURES } from "../../src/domains/dispatch";
import { DEFAULT_CONCERN_ENUM } from "../../src/domains/distribution";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS = path.join(PLUGIN_ROOT, "scripts");
const TSX_CLI = path.join(SCRIPTS, "node_modules", "tsx", "dist", "cli.mjs");

interface Fixture {
  test?: string;
  title?: string;
  lint?: string;
  budget?: "catalog" | "per-skill" | "prefix";
}
interface Row {
  id: string;
  unit: string;
  proves: string;
  fixtures?: Fixture[];
  owner?: string;
  pending?: string;
}
interface Index {
  schema: string;
  required_ids: string[];
  rows: Row[];
}

const INDEX = JSON.parse(fs.readFileSync(path.join(__dirname, "index.json"), "utf8")) as Index;
const SELF = path.relative(PLUGIN_ROOT, __filename).split(path.sep).join("/");
const LATER_LANES = new Set(["T14", "T15", "T16", "T17"]);

/** Run a scripts/ CLI under Node + tsx, the way CI runs it. */
function runCli(script: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [TSX_CLI, path.join(SCRIPTS, script), ...args], {
    cwd: SCRIPTS,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function read(rel: string): string {
  return fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8");
}

// ── shared gate runs (one spawn each) ────────────────────────────────────────

/** check id -> did its planted fixture flag (every positive variant) */
const lintFlags = new Map<string, boolean>();
/** check id -> open (non-baselined) violations on the live tree */
const lintOpen = new Map<string, string[]>();
let coverageYaml = "";
let coverageCode = -1;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guild-vc-"));

beforeAll(() => {
  const fixtures = runCli("lint/layout-laws.ts", ["--fixtures"]);
  for (const line of fixtures.stdout.split("\n")) {
    const m = /^\s+(FLAGS|VACUOUS|CLEAN|OVERFLAG|MISSING)\s+(\S+)/.exec(line);
    if (!m) continue;
    const id = m[2].split(".")[0];
    if (m[1] === "CLEAN" || m[1] === "OVERFLAG") continue;
    lintFlags.set(id, (lintFlags.get(id) ?? true) && m[1] === "FLAGS");
  }
  const live = runCli("lint/layout-laws.ts", ["--json"]);
  const report = JSON.parse(live.stdout) as { violations: Array<{ check: string; path: string; detail: string }> };
  const baseline = new Set(
    (JSON.parse(read("scripts/lint/layout-baseline.json")) as { entries: string[] }).entries,
  );
  for (const v of report.violations) {
    const key = `${v.check}::${v.path}::${v.detail}`;
    if (baseline.has(key)) continue;
    lintOpen.set(v.check, [...(lintOpen.get(v.check) ?? []), `${v.path} — ${v.detail}`]);
  }
  const out = path.join(scratch, "coverage.yaml");
  coverageCode = runCli("lint/build-coverage-draft.ts", [`--out=${out}`]).code;
  coverageYaml = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
}, 600_000);

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

// ── the index itself ─────────────────────────────────────────────────────────

describe("the Verification Contract index", () => {
  test("names every required row id at least once", () => {
    const have = new Set(INDEX.rows.map((r) => r.id));
    expect(INDEX.required_ids.filter((id) => !have.has(id))).toEqual([]);
  });

  test("every pending row names a later lane, and every other row names a fixture", () => {
    for (const row of INDEX.rows) {
      if (row.owner) {
        expect(LATER_LANES.has(row.owner)).toBe(true);
        expect(row.fixtures).toBeUndefined();
      } else {
        expect((row.fixtures ?? []).length).toBeGreaterThan(0);
      }
    }
  });
});

// ── one test per row ─────────────────────────────────────────────────────────

describe("Verification Contract rows", () => {
  const budgets = measure(PLUGIN_ROOT, true);

  for (const row of INDEX.rows) {
    if (row.owner) {
      test.todo(`${row.id} · ${row.pending} (owner: ${row.owner})`);
      continue;
    }
    test(`${row.id} · ${row.proves}`, () => {
      for (const fx of row.fixtures ?? []) {
        if (fx.test) {
          const abs = path.join(PLUGIN_ROOT, fx.test);
          expect(fs.existsSync(abs)).toBe(true);
          // The named fixture still exists under that title: an index row can
          // never keep pointing at a test that was renamed or deleted.
          const needle = fx.test === SELF ? `"${fx.title}"` : fx.title!;
          expect(fs.readFileSync(abs, "utf8").includes(needle)).toBe(true);
        }
        if (fx.lint) {
          expect(lintFlags.get(fx.lint)).toBe(true);
          expect(lintOpen.get(fx.lint) ?? []).toEqual([]);
        }
        if (fx.budget) {
          const leg = budgets.find((l) => l.id === fx.budget);
          expect(leg?.ok).toBe(true);
        }
      }
    });
  }
});

// ── fixtures authored for rows no earlier lane covered ───────────────────────

describe("authored Verification Contract fixtures", () => {
  test("R1 · the coverage map regenerates with zero unmapped ids", () => {
    expect(coverageCode).toBe(0);
    expect(coverageYaml).toMatch(/^\s+unmapped: 0$/m);
    expect(coverageYaml).toMatch(/^\s+domain_orphans: 0$/m);
  });

  test("R71 · every Verification Contract row is an eval id in the coverage map", () => {
    for (const row of INDEX.rows) {
      const key = `eval:${SELF}#${row.owner ? `${row.id}@${row.owner}` : row.id}`;
      const at = coverageYaml.indexOf(`- id: "${key}"`);
      expect(at).toBeGreaterThanOrEqual(0);
      const entry = coverageYaml.slice(at, coverageYaml.indexOf("\n  - id:", at + 1) >>> 0);
      expect(entry).toContain("kind: eval");
      expect(entry).toContain(`r_ids: ["${row.id}"]`);
    }
    // CONTROL: the lookup is not vacuous — an id the index does not carry is absent.
    expect(coverageYaml.includes(`- id: "eval:${SELF}#R999"`)).toBe(false);
  });

  test("R24 · bun test is the blocking runner, isolated per file, in a hermetic cwd", () => {
    expect(read("bunfig.toml")).toMatch(/^preload = \["\.\/test-preload\.ts"\]$/m);
    expect(bunTestProblems(read(".github/workflows/compile-gates.yml"))).toEqual([]);
    expect(read(".github/workflows/test-suites.yml")).toMatch(/jest:[\s\S]*?continue-on-error: true/);
    // The preload ran for THIS file: a temp cwd, no GUILD_* identity, Node as the
    // spawn path whenever a node is installed (KTD11).
    expect(path.relative(PLUGIN_ROOT, process.cwd()).startsWith("..")).toBe(true);
    expect(Object.keys(process.env).filter((k) => k.startsWith("GUILD_"))).toEqual([]);
    if (Bun.which("node")) expect(path.basename(process.execPath)).toBe("node");
  });

  test("R24 · CONTROL: an advisory or non-isolated bun test job is flagged", () => {
    const live = read(".github/workflows/compile-gates.yml");
    const advisory = live.replace("  bun-test:\n", "  bun-test:\n    continue-on-error: true\n");
    const shared = live.replace("run: bun test --isolate", "run: bun test");
    expect(bunTestProblems(advisory)).toContain("the bun test job is advisory");
    expect(bunTestProblems(shared)).toContain("bun test runs without --isolate");
  });

  test("R21 · CONTROL: an over-budget description fails the per-skill and catalog legs", () => {
    const root = path.join(scratch, "budget-plugin");
    const skill = path.join(root, "skills", "meta", "bloated");
    fs.mkdirSync(skill, { recursive: true });
    fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ skills: ["./skills/meta"] }));
    fs.writeFileSync(path.join(skill, "SKILL.md"), `---\nname: bloated\ndescription: ${"x".repeat(40_000)}\n---\n`);
    const legs = measure(root, true);
    expect(legs.find((l) => l.id === "per-skill")?.ok).toBe(false);
    expect(legs.find((l) => l.id === "catalog")?.ok).toBe(false);
  });

  test("R37 · the lint resolves concern labels against the authored enum, inert until authored", () => {
    const root = path.join(scratch, "concern-root");
    const page = (concern: string) =>
      `---\nimportance: high\nlabels:\n  domain: [billing]\n  concern: [${concern}]\n  status: [active]\n---\n# p\n`;
    fs.mkdirSync(path.join(root, ".guild", "wiki", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "wiki", "decisions", "ok.md"), page("security"));
    fs.writeFileSync(path.join(root, ".guild", "wiki", "decisions", "bad.md"), page("vibes"));
    // Through the shipped entry the wiki skill runs: `wiki-lint-checks.ts --root <repo>`.
    const labelFindings = () => {
      const r = runCli("wiki-lint-checks.ts", ["--root", root, "--json"]);
      const findings = (JSON.parse(r.stdout) as { findings: { check: string; file: string }[] }).findings;
      expect(r.code).toBe(findings.length > 0 ? 2 : 0);
      return findings.filter((f) => f.check.startsWith("label-")).map((f) => `${path.basename(f.file)} ${f.check}`);
    };
    // Inert: no taxonomy authored, so no label finding at all (KTD54).
    expect(labelFindings()).toEqual([]);
    // Authored with the shipped default: the out-of-enum concern is flagged, the
    // in-enum one is not.
    fs.writeFileSync(
      path.join(root, ".guild", "project.yaml"),
      `label_taxonomy:\n  domain: [billing]\n  concern: [${DEFAULT_CONCERN_ENUM.join(", ")}]\n  status: [active]\n`,
    );
    expect(labelFindings()).toEqual(["bad.md label-unknown"]);
    expect(DEFAULT_CONCERN_ENUM).toHaveLength(9);
    expect(Object.isFrozen(DEFAULT_CONCERN_ENUM)).toBe(true);
  });

  test("R40 · the instruction rank is shipped and the cell failure enum is closed", () => {
    const usingGuild = read("skills/meta/using-guild/SKILL.src.md").replace(/\s+/g, " ");
    expect(usingGuild).toContain(
      "hooks > assignment `done_when` oracles > project `AGENTS.md` / `CLAUDE.md` > playbook > skill body > this file",
    );
    // The accept-path proof (a failure outside this enum voids the ledger) runs on the
    // real runtime in scripts/lib/three-tier-dispatch.test.ts.
    expect([...CELL_LAST_FAILURES]).toEqual(["retry", "replan", "escalate", "skip-recorded"]);
  });

  test("R41 · principles are folded into using-guild, not a skill", () => {
    const usingGuild = read("skills/meta/using-guild/SKILL.src.md");
    const section = usingGuild.split("## Operating principles")[1]?.split("\n## ")[0] ?? "";
    expect((section.match(/^\d\. \*\*/gm) ?? []).length).toBe(5);
    expect(principlesSkills()).toEqual([]);
    // CONTROL: the walk finds a planted principles skill.
    const planted = path.join(scratch, "skills", "core", "principles");
    fs.mkdirSync(planted, { recursive: true });
    fs.writeFileSync(path.join(planted, "SKILL.md"), "---\nname: principles\n---\n");
    expect(principlesSkills(scratch)).toEqual(["skills/core/principles/SKILL.md"]);
  });

  test("R43 · tests are colocated: no scripts/__tests__ tree remains", () => {
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "scripts", "__tests__"))).toBe(false);
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "scripts", "comms", "__tests__"))).toBe(false);
  });

  test("R45 · the status entrypoint does not load unused domains", () => {
    const r = runCli("lint/hot-path-budget.ts", ["require-graph"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^\s+OK\s+status \(capability-profile\)/m);
  });

  test("R58 · using-guild names bare /guild as T0", () => {
    const usingGuild = read("skills/meta/using-guild/SKILL.src.md");
    expect(usingGuild).toContain("**Bare `/guild` is T0**");
    expect(usingGuild).toContain("A verb is an option, not a requirement.");
    expect(usingGuild).not.toMatch(/verb is (always )?required/i);
  });

  test("R78 · config set accepts review.critic off | advisor and refuses anything else", () => {
    const cwd = path.join(scratch, "critic-root");
    fs.mkdirSync(path.join(cwd, ".guild"), { recursive: true });
    const policy = path.join(cwd, ".guild", "config", "project.json");
    const refused = runCli("config-cmd.ts", ["set", "review.critic", "human", "--scope", "project", "--cwd", cwd]);
    expect(refused.code).toBe(1);
    expect(refused.stdout + refused.stderr).toContain("'review.critic' must be one of: off | advisor");
    expect(fs.existsSync(policy)).toBe(false);
    const set = runCli("config-cmd.ts", ["set", "review.critic", "off", "--scope", "project", "--cwd", cwd]);
    expect(set.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(policy, "utf8")).review.critic).toBe("off");
    expect(policyKeySpec("review.critic")?.default).toBe("advisor");
  });

  test("KTD6 · Bun authors and CI compiles; the user path is Node with no Bun", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts.compile.startsWith("bun ")).toBe(true);
    expect(pkg.scripts.test).toBe("bun test --isolate");
    expect(userPathRuntimes(read("hooks/hooks.json"))).toEqual(["bash", "node"]);
    const workflow = read(".github/workflows/compile-gates.yml");
    const nodeOnly = workflow.split("  node-only-runtime:\n")[1]?.split(/\n  [a-z-]+:\n/)[0] ?? "";
    expect(nodeOnly).toContain("node runtime/guild-mcp.js");
    expect(nodeOnly).not.toContain("setup-bun");
    // CONTROL: a hook that runs through bun or tsx is visible to the same read.
    expect(userPathRuntimes('{"command": "bun hooks/x.ts"} {"command": "npx tsx hooks/y.ts"}')).toEqual([
      "bun", "npx",
    ]);
  });
});

/** What keeps the bun test job from being a blocking, isolated gate. */
function bunTestProblems(workflow: string): string[] {
  const job = workflow.split("  bun-test:\n")[1]?.split(/\n  [a-z-]+:\n/)[0] ?? "";
  const problems: string[] = [];
  if (!job) problems.push("no bun-test job");
  if (/continue-on-error:\s*true/.test(job)) problems.push("the bun test job is advisory");
  if (!/run:\s*bun test --isolate\b/.test(job)) problems.push("bun test runs without --isolate");
  return problems;
}

/** Every principles skill file under <root>/skills. */
function principlesSkills(root = PLUGIN_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/^SKILL(\.src)?\.md$/.test(e.name) && path.basename(dir) === "principles") {
        out.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(root, "skills"));
  return out.sort();
}

/** The distinct executables the hook manifest invokes. */
function userPathRuntimes(hooksJson: string): string[] {
  const found = new Set<string>();
  for (const m of hooksJson.matchAll(/"command"\s*:\s*"([^\s"]+)/g)) found.add(m[1]);
  return [...found].sort();
}
