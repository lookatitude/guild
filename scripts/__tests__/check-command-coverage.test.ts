/**
 * scripts/__tests__/check-command-coverage.test.ts
 *
 * Umbrella-side command-coverage check (complement to check-doc-sync).
 * TDD: written before/with the implementation.
 *
 * Covers:
 *  - isTokenCovered: namespaced token, leading-slash variant, file-ref variant.
 *  - WORD-BOUNDARY false-positive guard (the critical one): `stat` must NOT be covered by
 *    `guild:status`, and `status` must NOT be covered by `guild:stat`.
 *  - evaluateCommandCoverage partition + stable sort.
 *  - collectCommandTokens / gatherKnowledgeText against tmp fixtures.
 *  - CLI exit codes: 0 covered, 1 uncovered, 0 with --warn, 2 bad input.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

import {
  isTokenCovered,
  evaluateCommandCoverage,
  collectCommandTokens,
  gatherKnowledgeText,
} from "../workspace/check-command-coverage";

describe("isTokenCovered — namespaced + file-ref forms", () => {
  test("guild:<token> counts as covered", () => {
    expect(isTokenCovered("build", "the guild:build command does X")).toBe(true);
  });
  test("/guild:<token> (leading slash) counts as covered", () => {
    expect(isTokenCovered("init", "run /guild:init first")).toBe(true);
  });
  test("commands/<token>.md file reference counts as covered", () => {
    expect(isTokenCovered("plan", "see commands/plan.md for details")).toBe(true);
  });
  test("absent token is not covered", () => {
    expect(isTokenCovered("nonexistent", "guild:build and guild:plan only")).toBe(false);
  });
});

describe("isTokenCovered — word-boundary false-positive guard (critical)", () => {
  test("'stat' is NOT covered by 'guild:status'", () => {
    expect(isTokenCovered("stat", "only guild:status appears here")).toBe(false);
  });
  test("'status' is NOT covered by 'guild:stat'", () => {
    expect(isTokenCovered("status", "only guild:stat appears here")).toBe(false);
  });
  test("'stat' IS covered by an exact 'guild:stat'", () => {
    expect(isTokenCovered("stat", "guild:stat exactly")).toBe(true);
  });
  test("'stats' is covered by 'guild:stats' but not by 'guild:status'", () => {
    expect(isTokenCovered("stats", "guild:stats here")).toBe(true);
    expect(isTokenCovered("stats", "only guild:status here")).toBe(false);
  });
});

describe("evaluateCommandCoverage — partition", () => {
  test("partitions covered / uncovered and sorts uncovered", () => {
    const text = "guild:build guild:plan /guild:init commands/qa.md";
    const r = evaluateCommandCoverage(["build", "plan", "init", "qa", " zzz".trim(), "missing"], text);
    expect(r.covered.sort()).toEqual(["build", "init", "plan", "qa"]);
    expect(r.uncovered).toEqual(["missing", "zzz"]); // sorted
  });
  test("empty token list → both empty", () => {
    expect(evaluateCommandCoverage([], "anything")).toEqual({ covered: [], uncovered: [] });
  });
});

describe("collectCommandTokens / gatherKnowledgeText — fixtures", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cmd-cov-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("collectCommandTokens reads <token>.md basenames, sorted, .md only", () => {
    const cmds = path.join(dir, "commands");
    fs.mkdirSync(cmds);
    fs.writeFileSync(path.join(cmds, "build.md"), "x");
    fs.writeFileSync(path.join(cmds, "plan.md"), "x");
    fs.writeFileSync(path.join(cmds, "README.txt"), "ignore me");
    expect(collectCommandTokens(cmds)).toEqual(["build", "plan"]);
  });

  test("gatherKnowledgeText reads .md recursively and concatenates", () => {
    const k = path.join(dir, "knowledge");
    fs.mkdirSync(path.join(k, "architecture"), { recursive: true });
    fs.writeFileSync(path.join(k, "index.md"), "guild:build");
    fs.writeFileSync(path.join(k, "architecture", "surface.md"), "guild:plan");
    const text = gatherKnowledgeText(k);
    expect(text).toContain("guild:build");
    expect(text).toContain("guild:plan");
  });
});

describe("CLI — exit codes", () => {
  const SCRIPT = path.resolve(__dirname, "../workspace/check-command-coverage.ts");
  const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;
  let dir: string;

  function setup(commands: string[], knowledge: string): { cmds: string; know: string } {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cmd-cov-cli-"));
    const cmds = path.join(dir, "commands");
    const know = path.join(dir, "knowledge");
    fs.mkdirSync(cmds);
    fs.mkdirSync(know);
    for (const c of commands) fs.writeFileSync(path.join(cmds, `${c}.md`), `# ${c}\n`);
    fs.writeFileSync(path.join(know, "index.md"), knowledge);
    return { cmds, know };
  }

  function run(args: string[]): { status: number; out: string; err: string } {
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", env: ENV, timeout: 120_000 });
    return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
  }

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("all covered → exit 0", () => {
    const { cmds, know } = setup(["build", "plan"], "guild:build and guild:plan");
    const r = run(["--commands-dir", cmds, "--knowledge-dir", know]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/all 2 commands covered/);
  });

  test("uncovered command → exit 1 (real gate)", () => {
    const { cmds, know } = setup(["build", "ghost"], "guild:build only");
    const r = run(["--commands-dir", cmds, "--knowledge-dir", know]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/guild:ghost/);
  });

  test("uncovered command with --warn → exit 0 (advisory)", () => {
    const { cmds, know } = setup(["build", "ghost"], "guild:build only");
    const r = run(["--commands-dir", cmds, "--knowledge-dir", know, "--warn"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/guild:ghost/);
  });

  test("missing args → exit 2", () => {
    const r = run([]);
    expect(r.status).toBe(2);
  });

  test("nonexistent dir → exit 2", () => {
    const r = run(["--commands-dir", "/no/such/dir", "--knowledge-dir", "/also/missing"]);
    expect(r.status).toBe(2);
  });
});
