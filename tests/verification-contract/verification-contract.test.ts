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
  // T16 retired the layout baseline: every live violation is open.
  for (const v of report.violations) {
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
    expect(read(".github/workflows/test-suites.yml")).not.toMatch(/^  jest:|npx jest/m);
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

  test("R22 · one authoring home: no dual copies, no nested clone, no Jest, no workflows/ dir, no principles skill", () => {
    expect(authoringHomeFindings()).toEqual([]);
    // CONTROL: each planted defect is visible to the same walk.
    const root = path.join(scratch, "r22");
    fs.mkdirSync(path.join(root, "plugin", ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(root, "plugin", ".claude-plugin", "plugin.json"), "{}");
    fs.mkdirSync(path.join(root, "src", "modules", "state", "resources"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "modules", "state", "index.ts"), "export {};\n");
    fs.writeFileSync(path.join(root, "jest.config.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(root, "package.json"), '{"devDependencies":{"ts-jest":"1"}}');
    fs.mkdirSync(path.join(root, "src", "domains", "knowledge", "workflows"), { recursive: true });
    fs.mkdirSync(path.join(root, "skills", "core", "principles"), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", "core", "principles", "SKILL.md"), "---\nname: principles\n---\n");
    expect(authoringHomeFindings(root)).toEqual([
      "dual copy: src/modules/state/index.ts",
      "dual copy: src/modules/state/resources",
      "jest config: jest.config.js",
      "jest dependency: package.json",
      "nested clone: plugin",
      "principles skill: skills/core/principles/SKILL.md",
      "workflows dir: src/domains/knowledge/workflows",
    ]);
  });

  test("KTD2 · one authoring home: each surface tree lives once, at the plugin root", () => {
    expect(surfaceHomeFindings()).toEqual([]);
    // CONTROL: a second copy under src/surfaces and a missing root tree are visible.
    const root = path.join(scratch, "ktd2");
    for (const t of ["commands", "skills", "templates", "hooks"]) fs.mkdirSync(path.join(root, t), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "surfaces", "skills"), { recursive: true });
    expect(surfaceHomeFindings(root)).toEqual(["missing home: agents", "second copy: src/surfaces/skills"]);
  });

  test("KTD9 · no dual-home mirrors, no shipping _archive, every print-only alias file present", () => {
    expect(mirrorArchiveFindings()).toEqual([]);
    // CONTROL: a planted _archive, a resources mirror and a missing alias are visible.
    const root = path.join(scratch, "ktd9");
    fs.mkdirSync(path.join(root, "_archive", "v1"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "modules", "wiki", "resources"), { recursive: true });
    fs.mkdirSync(path.join(root, "commands"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "commands", "aliases.allowlist.json"),
      JSON.stringify({ aliases: ["audit", "stats"] }),
    );
    fs.writeFileSync(path.join(root, "commands", "audit.md"), "print-only\n");
    expect(mirrorArchiveFindings(root)).toEqual([
      "_archive: _archive",
      "alias missing: commands/stats.md",
      "dual copy: src/modules/wiki/resources",
    ]);
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

// ── U9 clone and deletion greps (R22, KTD9) ─────────────────────────────────

const U9_SKIP = new Set(["node_modules", ".git", ".worktrees", ".guild", ".github"]);
const LINT_FIXTURES = "scripts/lint/__tests__/fixtures";

/** Every directory and file under root, repo-relative, minus VCS/state/lint fixtures. */
function u9Walk(root: string): { dirs: string[]; files: string[] } {
  const dirs: string[] = [];
  const files: string[] = [];
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // Root dist/ is gitignored generated host packages, not an authored copy.
        if (U9_SKIP.has(e.name) || r === LINT_FIXTURES || r === "dist") continue;
        dirs.push(r);
        walk(r);
      } else if (e.isFile()) {
        files.push(r);
      }
    }
  };
  walk("");
  return { dirs, files };
}

/** Code or byte mirrors left in the retired src/modules tree (manifests are data). */
function dualCopies(tree: { dirs: string[]; files: string[] }): string[] {
  return [
    ...tree.dirs.filter((d) => /^src\/modules\/[^/]+\/resources$/.test(d)),
    ...tree.files.filter((f) => /^src\/modules\/.+\.(ts|js|md)$/.test(f) && f !== "src/modules/README.md"),
  ].map((p) => `dual copy: ${p}`);
}

/** R22: one authoring home. */
function authoringHomeFindings(root = PLUGIN_ROOT): string[] {
  const tree = u9Walk(root);
  const out = [...dualCopies(tree)];
  for (const d of tree.dirs) {
    const nested = fs.existsSync(path.join(root, d, ".git")) ||
      fs.existsSync(path.join(root, d, ".claude-plugin", "plugin.json"));
    if (d === "plugin" || nested) out.push(`nested clone: ${d}`);
    if (path.basename(d) === "workflows") out.push(`workflows dir: ${d}`);
  }
  for (const f of tree.files) {
    if (/(^|\/)jest\.config\.[cm]?[jt]s(on)?$/.test(f)) out.push(`jest config: ${f}`);
    if (path.basename(f) !== "package.json") continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(root, f), "utf8")) as Record<string, unknown>;
    const deps = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
      .flatMap((k) => Object.keys((pkg[k] as Record<string, string> | undefined) ?? {}));
    if (pkg.jest !== undefined || deps.some((d) => d === "jest" || d === "ts-jest" || d === "@types/jest")) {
      out.push(`jest dependency: ${f}`);
    }
  }
  if (fs.existsSync(path.join(root, "skills"))) {
    out.push(...principlesSkills(root).map((f) => `principles skill: ${f}`));
  }
  return out.sort();
}

/** KTD9: no mirrors, no _archive; KTD14 alias files stay until the stable cut. */
/**
 * KTD2 as amended by the operator at T16: commands/, skills/ (playbooks under
 * skills/playbooks/), agents/, templates/ and hooks/ are authored once, at the
 * plugin root. src/surfaces/ holds only graphs and prompts.
 */
function surfaceHomeFindings(root = PLUGIN_ROOT): string[] {
  const out: string[] = [];
  for (const t of ["agents", "commands", "hooks", "skills", "templates"]) {
    if (!fs.existsSync(path.join(root, t))) out.push(`missing home: ${t}`);
    if (fs.existsSync(path.join(root, "src", "surfaces", t))) out.push(`second copy: src/surfaces/${t}`);
  }
  return out.sort();
}

function mirrorArchiveFindings(root = PLUGIN_ROOT): string[] {
  const tree = u9Walk(root);
  const out = [...dualCopies(tree)];
  for (const d of tree.dirs) if (path.basename(d) === "_archive") out.push(`_archive: ${d}`);
  const allow = JSON.parse(
    fs.readFileSync(path.join(root, "commands", "aliases.allowlist.json"), "utf8"),
  ) as { aliases: string[] };
  for (const a of allow.aliases) {
    if (!fs.existsSync(path.join(root, "commands", `${a}.md`))) out.push(`alias missing: commands/${a}.md`);
  }
  return out.sort();
}

/** The distinct executables the hook manifest invokes. */
function userPathRuntimes(hooksJson: string): string[] {
  const found = new Set<string>();
  for (const m of hooksJson.matchAll(/"command"\s*:\s*"([^\s"]+)/g)) found.add(m[1]);
  return [...found].sort();
}

// ── T17: plugin-local docs (R28 · F9) and the producer boundary (R76) ────────

/** The 13 command files that dispatch; the rest of commands/ are print-only aliases. */
const DISPATCH_COMMANDS = [
  "build", "config", "guild", "ideate", "init", "initiative", "learn",
  "maintain", "ops", "plan", "qa", "status", "wiki",
].map((c) => `commands/${c}.md`);
const USING_GUILD = "skills/meta/using-guild/SKILL.src.md";
const MCP_READMES = ["mcp-servers/guild-memory/README.md", "mcp-servers/guild-telemetry/README.md"];
/** Every plugin-local doc this D8 owns: README, AGENTS.md, CLAUDE.md, using-guild, command help, MCP READMEs. */
const D8_DOCS = [
  "README.md", "AGENTS.md", "CLAUDE.md", USING_GUILD, ...MCP_READMES,
  ...fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).filter((f) => f.endsWith(".md")).map((f) => `commands/${f}`),
].sort();

type Texts = Record<string, string>;
interface DocRule {
  id: string;
  /** each file must match every `locked` pattern */
  files: string[];
  locked: RegExp[];
  /** no D8 doc may match any `retired` pattern */
  retired?: RegExp[];
}

/** Whitespace-normalized, so a sentence wrapped across lines still matches. */
function liveDocs(root = PLUGIN_ROOT): Texts {
  const out: Texts = {};
  for (const rel of D8_DOCS) out[rel] = fs.readFileSync(path.join(root, rel), "utf8").replace(/\s+/g, " ");
  return out;
}

function docProblems(texts: Texts, rules: DocRule[]): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    for (const f of rule.files) {
      for (const re of rule.locked) if (!re.test(texts[f] ?? "")) out.push(`${rule.id}: ${f} lacks ${re}`);
    }
    for (const re of rule.retired ?? []) {
      for (const [f, t] of Object.entries(texts)) if (re.test(t)) out.push(`${rule.id}: ${f} still says ${re}`);
    }
  }
  return out;
}

/** Remove every match of `re` from `f`, the way a drifting edit would drop a locked sentence. */
function withoutMatch(texts: Texts, f: string, re: RegExp): Texts {
  return { ...texts, [f]: texts[f].replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`), "") };
}

const CONCERN_LINE = new RegExp(DEFAULT_CONCERN_ENUM.join(" · "));

/** R28: the plugin-local docs state the locked architecture (plan §U10 copy list). */
const R28_RULES: DocRule[] = [
  {
    id: "readme-architecture",
    files: ["README.md"],
    locked: [
      /\*\*13 dispatching command files\*\*/,
      /17 are indexed/,
      /bare `\/guild` is the T0 orchestrator session/,
      /`research`, `debug`, and `--class=` bind the class/,
      /five class graphs \(product · research · debug · ops · init\)/,
      /three tiers \(T0 → a Team Lead per TaskCell → specialists\)/,
      /one inner loop \(recall → research-on-miss → implement → verify → harvest\)/,
      /enforced budget \(`advisorRounds`/,
      /critic is the advisor machinery agent/,
      /`qa` is the one review gate/,
      /at most 6k tokens/,
      /at most 1,200 tokens of citations/,
      /glossary\.md` terms take at most 200/,
      /\*\*One promotion law\*\*/,
      /checkpoint is a domain function/,
      /extract-structural\.ts/,
      /durable config holds policy keys only/,
      /bind per session on the run record/,
      /keeps a compact history/,
      /`\/guild:status dashboard`/,
      /ships no UI pages/,
      /the bootstrap always loads/,
      /first write-capable entry upgrades it/,
      /Files here are latest-only/,
    ],
  },
  {
    id: "agents-architecture",
    files: ["AGENTS.md"],
    locked: [
      /the twelve domains/,
      /There is no `src\/modules\/` tree/,
      /`src\/runtime\/mcp\/` — the source of the two optional MCP servers/,
      /no Jest and no layout-laws baseline/,
      /\*\*One promotion law\.\*\* Harvest is the only auto writer/,
      /T0 request queue, which the lead drains/,
      /`none \| decision \| playbook_span \| skill_def \| reflect`/,
      /per-phase team files <slug>\.<phase>\.yaml/,
      /Per-goal is a roster slice/,
      /guild\.research_packet\.v1/,
      /there is no `skill-versions\/` tree/,
      /Ingested blobs are `knowledge\/sources\/`, never `raw\/`/,
      /SessionStart on a Guild root always loads the Guild bootstrap/,
    ],
  },
  {
    id: "using-guild-gateway",
    files: [USING_GUILD],
    locked: [
      /\*\*Bare `\/guild` is T0\*\*/,
      /A verb is an option, not a requirement/,
      /This file is \*\*latest-only\*\*/,
    ],
  },
  {
    id: "command-help",
    files: ["commands/guild.md"],
    locked: [/no verb runs six-way intake/, /`research` \/ `debug` \/ `--class=` bind the workflow class/],
  },
  { id: "command-help", files: ["commands/maintain.md"], locked: [/restore the inverse span/] },
  { id: "command-help", files: ["commands/config.md"], locked: [/Durable config is policy only/] },
  { id: "claude-md-imports-agents", files: ["CLAUDE.md"], locked: [/@AGENTS\.md/] },
  {
    id: "mcp-source-home",
    files: MCP_READMES,
    locked: [/The source lives at `src\/runtime\/mcp\/guild-(memory|telemetry)\/`/, /bun test --isolate/],
  },
  {
    id: "retired-layout",
    files: [],
    locked: [],
    retired: [
      /`src\/modules\/<module>\/`/,
      /npx jest/,
      /`dist\/index\.js`/,
      /skills\/core\/principles/,
      /Update \(\d/,
      /58 specialist starter recipes (plus the dashboard launcher )?live under `skills\/playbooks\/`/,
    ],
  },
];

/** F9: each colliding sentence reads the locked way, and its retired form is gone everywhere. */
const F9_RULES: DocRule[] = [
  {
    id: "autopromote",
    files: ["README.md", "AGENTS.md", USING_GUILD, "commands/wiki.md"],
    locked: [/wiki\.autopromote`?,? ?\(?defaults? on/],
    retired: [/Nothing auto-promotes/, /autopromote: false/, /autopromote[^.]{0,40}REJECTED/],
  },
  {
    id: "harvest-writer",
    files: ["README.md", "AGENTS.md", USING_GUILD, "commands/wiki.md"],
    locked: [/Harvest is the only (auto|automatic)( wiki)? writer/i],
    retired: [/agents emit candidates only/i, /tooling emits candidates, never auto-writes/],
  },
  {
    id: "settings-policy",
    files: ["README.md", "AGENTS.md", "commands/config.md"],
    locked: [/policy (keys )?only/i],
    retired: [/settings\.json`? config surface/, /settings\.json`? +# project\/workspace behavior/, /the single JSON file holding every Guild option/],
  },
  { id: "concern-enum", files: ["README.md", USING_GUILD], locked: [CONCERN_LINE] },
  {
    id: "bm25",
    files: ["README.md", "AGENTS.md", "commands/wiki.md"],
    locked: [/fails open to BM25/],
    retired: [/\.guild\/index\.sqlite/, /SQLite read-through wiki cache\*\* — lazy-build/],
  },
  {
    id: "skill-versions",
    files: ["README.md", "AGENTS.md"],
    locked: [/compact history/],
    retired: [/\.guild\/skill-versions/, /skill-versions\/ +#/],
  },
  {
    id: "verb-always-required",
    files: [USING_GUILD, "README.md"],
    locked: [/A verb is (an option, not a requirement|optional)/],
    retired: [/smart \*\*phase detection\*\*/, /let the brainstorm skill prompt/, /a verb is (always )?required/i],
  },
  {
    id: "glossary-one-liner",
    files: [USING_GUILD],
    locked: [/In any Guild root, project terms live in `\.guild\/wiki\/glossary\.md`; recall on miss\./],
  },
  {
    id: "raw-to-sources",
    files: ["commands/wiki.md"],
    locked: [/Ingested blobs live in `\.guild\/knowledge\/sources\/`/],
    retired: [/\.guild\/raw\//, /── raw\//],
  },
];

/** A ts/js import specifier that reaches a sibling repo's source (KTD66). */
function siblingImport(spec: string): boolean {
  return /(^|\/)(website|benchmark)\//.test(spec) || /^(@[^/]+\/)?(guild-)?(website|benchmark)$/.test(spec);
}

function siblingImportFindings(files: Array<{ rel: string; text: string }>): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"\n]+)['"]/gm;
  for (const { rel, text } of files) {
    for (const m of text.matchAll(re)) if (siblingImport(m[1])) out.push(`${rel} imports ${m[1]}`);
  }
  return out;
}

/** Tracked plugin source (not fixtures, not compiled bundles, not node_modules). */
function pluginSource(root = PLUGIN_ROOT): Array<{ rel: string; text: string }> {
  const listed = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root, encoding: "utf8" }).stdout;
  return listed
    .split("\n")
    .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f) && !f.endsWith(".d.ts"))
    .filter((f) => !/(^|\/)(node_modules|dist|fixtures)\//.test(f) && !f.startsWith("runtime/") && !f.startsWith(".guild/"))
    .filter((f) => fs.existsSync(path.join(root, f)))
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(root, rel), "utf8") }));
}

/** UI pages the plugin must not ship; docs/index.html is the one retired-docs redirect. */
function uiPageFindings(paths: string[]): string[] {
  return paths
    .filter((f) => /\.(astro|tsx|jsx|vue|svelte|mdx|html?)$/.test(f))
    .filter((f) => !f.startsWith(".guild/") && !f.startsWith("dist/") && f !== "docs/index.html");
}

describe("T17 plugin-local docs and producer boundary", () => {
  const live = liveDocs();

  test("R28 · README, AGENTS.md, using-guild and command help state the locked architecture", () => {
    expect(docProblems(live, R28_RULES)).toEqual([]);
  });

  test("R28 · CONTROL: dropping any locked sentence, or planting a retired one, is flagged", () => {
    for (const rule of R28_RULES) {
      for (const f of rule.files) {
        for (const re of rule.locked) {
          expect(docProblems(withoutMatch(live, f, re), [rule])).toContain(`${rule.id}: ${f} lacks ${re}`);
        }
      }
    }
    const planted = { ...live, "README.md": `${live["README.md"]} Run \`npx jest\` from \`src/modules/<module>/\`.` };
    const found = docProblems(planted, R28_RULES);
    expect(found).toContain("retired-layout: README.md still says /npx jest/");
    expect(found).toContain("retired-layout: README.md still says /`src\\/modules\\/<module>\\/`/");
  });

  test("F9 · every colliding sentence reads the locked way and its retired form is gone", () => {
    expect(docProblems(live, F9_RULES)).toEqual([]);
  });

  test("F9 · CONTROL: each topic flags its retired sentence and its missing locked sentence", () => {
    const retiredSamples: Record<string, string> = {
      "autopromote": "Promotion on user gate. Nothing auto-promotes.",
      "harvest-writer": "defaults.wiki.autopromote: true is REJECTED always (agents emit candidates only)",
      "settings-policy": "Manage the `.guild/settings.json` config surface",
      "bm25": "Resolves run state or the optional `.guild/index.sqlite` cache.",
      "skill-versions": "Walk a skill back n versions from `.guild/skill-versions/`",
      "verb-always-required": "Bare entry — smart **phase detection**: a verb is always required.",
      "raw-to-sources": "Project knowledge over `.guild/raw/` and the wiki.",
    };
    for (const rule of F9_RULES) {
      for (const f of rule.files) {
        for (const re of rule.locked) {
          expect(docProblems(withoutMatch(live, f, re), [rule])).toContain(`${rule.id}: ${f} lacks ${re}`);
        }
      }
      if (!rule.retired) continue;
      const sample = retiredSamples[rule.id];
      expect(sample).toBeDefined();
      const planted = { ...live, "AGENTS.md": `${live["AGENTS.md"]} ${sample}` };
      expect(docProblems(planted, [rule]).some((p) => p.startsWith(`${rule.id}: AGENTS.md still says`))).toBe(true);
    }
    // The concern line is the shipped enum, not a hand-copied list: a renamed value fails.
    const drifted = { ...live, "README.md": live["README.md"].replace(" · ux · ", " · design · ") };
    expect(docProblems(drifted, F9_RULES)).toContain(`concern-enum: README.md lacks ${CONCERN_LINE}`);
  });

  test("R76 · plugin source imports no website/ or benchmark/ tree", () => {
    const source = pluginSource();
    expect(source.length).toBeGreaterThan(500);
    expect(siblingImportFindings(source)).toEqual([]);
  });

  test("R76 · CONTROL: a relative, a bare and a dynamic sibling import are each flagged", () => {
    // Split literals, so this file does not itself read as a sibling import to the live scan.
    const planted = [
      { rel: "src/domains/kernel/x.ts", text: 'import { page } from "../../../../' + "website" + '/src/pages/index";\n' },
      { rel: "scripts/y.ts", text: 'const ui = require("guild-' + "benchmark" + '");\n' },
      { rel: "hooks/z.ts", text: 'await import("../' + "benchmark" + '/src/ui/app");\n' },
      { rel: "src/domains/kernel/ok.ts", text: 'import { a } from "./website-copy";\n' },
    ];
    expect(siblingImportFindings(planted)).toEqual([
      "src/domains/kernel/x.ts imports ../../../../website/src/pages/index",
      "scripts/y.ts imports guild-benchmark",
      "hooks/z.ts imports ../benchmark/src/ui/app",
    ]);
  });

  test("R76 · the dashboard launcher ships, off the skills glob, and the plugin has no UI pages", () => {
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "skills/playbooks/dashboard/SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "runtime/scripts/dashboard-launch.js"))).toBe(true);
    expect(read("commands/status.md")).toContain("runtime/scripts/dashboard-launch.js");
    const manifest = JSON.parse(read(".claude-plugin/plugin.json")) as { skills: string[] };
    expect(manifest.skills.filter((s) => s.includes("playbooks"))).toEqual([]);
    const tracked = spawnSync("git", ["ls-files"], { cwd: PLUGIN_ROOT, encoding: "utf8" }).stdout.split("\n");
    expect(uiPageFindings(tracked)).toEqual([]);
    // CONTROL: a plugin UI page or component is flagged; the docs redirect is not.
    expect(uiPageFindings(["src/ui/App.tsx", "skills/playbooks/dashboard/index.html", "docs/index.html"])).toEqual([
      "src/ui/App.tsx",
      "skills/playbooks/dashboard/index.html",
    ]);
  });
});
