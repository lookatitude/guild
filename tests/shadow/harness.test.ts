/**
 * tests/shadow/harness.test.ts
 *
 * End-to-end harness tests for scripts/shadow-mode.ts.
 * Exercises 3 cross-cutting fixture scenarios:
 *   1. historical-agreement  → 0% divergence
 *   2. historical-divergence → 30% divergence
 *   3. historical-empty      → "no historical data", exit 0
 *
 * Shadow mode ALWAYS exits 0 — this contract is verified for all scenarios.
 *
 * Implements guild-plan.md §11.2 step 7 cross-cutting coverage.
 * Addresses §15.2 risk row 4 (evolve overfit) and row 3 (decision-capture noise).
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../../scripts/shadow-mode.ts");
const FIXTURES = path.resolve(__dirname, "fixtures");

// Proposed skill that triggers on "task-write" prompts.
// Skill slug ends with "alpha" → slugLastSegment = "alpha".
// Historical traces use specialist "specialist-alpha" → historicalTriggered = true.
const PROPOSED_SKILL_CONTENT = [
  "---",
  "name: specialist-alpha",
  "description: TRIGGER for task-write and spec-write requests. DO NOT TRIGGER for deploy and tool-read requests.",
  "---",
  "",
  "Handles all task-write and spec-write operations.",
].join("\n");

const SKILL_SLUG = "specialist-alpha";
const RUN_ID = "shadow-test";

function runShadowMode(args: string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function seedHistoricalRun(
  tmpDir: string,
  runName: string,
  fixtureSrc: string
): void {
  const runDir = path.join(tmpDir, ".guild", "runs", runName);
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(
    path.join(FIXTURES, fixtureSrc, "events.ndjson"),
    path.join(runDir, "events.ndjson")
  );
}

function seedProposedEdit(tmpDir: string, content: string): string {
  const p = path.join(tmpDir, "proposed.md");
  fs.writeFileSync(p, content, "utf8");
  return p;
}

function readReport(tmpDir: string, runId: string): string {
  return fs.readFileSync(
    path.join(tmpDir, ".guild", "evolve", runId, "shadow-report.md"),
    "utf8"
  );
}

/** Parse the divergence_rate from report front-matter (e.g. "0.300" → 0.3). */
function parseDivergenceRate(report: string): number {
  const m = report.match(/^divergence_rate:\s*([\d.]+)/m);
  if (!m) throw new Error("divergence_rate not found in report front-matter");
  return parseFloat(m[1]);
}

/** Parse total_divergences from report front-matter. */
function parseTotalDivergences(report: string): number {
  const m = report.match(/^total_divergences:\s*(\d+)/m);
  if (!m) throw new Error("total_divergences not found in report front-matter");
  return parseInt(m[1], 10);
}

/** Parse total_prompts from report front-matter. */
function parseTotalPrompts(report: string): number {
  const m = report.match(/^total_prompts:\s*(\d+)/m);
  if (!m) throw new Error("total_prompts not found in report front-matter");
  return parseInt(m[1], 10);
}

// ── historical-agreement ───────────────────────────────────────────────────

describe("shadow-mode harness — historical-agreement fixture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-shadow-agree-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 (shadow mode never blocks)", () => {
    seedHistoricalRun(tmpDir, "agree-run-1", "historical-agreement");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    const { exitCode } = runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    expect(exitCode).toBe(0);
  });

  it("writes shadow-report.md", () => {
    seedHistoricalRun(tmpDir, "agree-run-1", "historical-agreement");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const reportPath = path.join(
      tmpDir, ".guild", "evolve", RUN_ID, "shadow-report.md"
    );
    expect(fs.existsSync(reportPath)).toBe(true);
  });

  it("reports 0% divergence", () => {
    seedHistoricalRun(tmpDir, "agree-run-1", "historical-agreement");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const report = readReport(tmpDir, RUN_ID);
    const rate = parseDivergenceRate(report);
    expect(rate).toBe(0);
  });

  it("replays all 10 prompts", () => {
    seedHistoricalRun(tmpDir, "agree-run-1", "historical-agreement");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const report = readReport(tmpDir, RUN_ID);
    const totalPrompts = parseTotalPrompts(report);
    expect(totalPrompts).toBe(10);
  });

  it("report includes proposed spec section", () => {
    seedHistoricalRun(tmpDir, "agree-run-1", "historical-agreement");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const report = readReport(tmpDir, RUN_ID);
    expect(report).toMatch(/proposed spec/i);
    expect(report).toContain("specialist-alpha");
  });
});

// ── historical-divergence ──────────────────────────────────────────────────

describe("shadow-mode harness — historical-divergence fixture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-shadow-divg-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 (shadow mode never blocks even on divergence)", () => {
    seedHistoricalRun(tmpDir, "divg-run-1", "historical-divergence");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    const { exitCode } = runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    expect(exitCode).toBe(0);
  });

  it("reports 30% divergence (3/10 prompts diverge)", () => {
    seedHistoricalRun(tmpDir, "divg-run-1", "historical-divergence");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const report = readReport(tmpDir, RUN_ID);
    const rate = parseDivergenceRate(report);
    // Allow for floating-point representation: 0.300
    expect(rate).toBeCloseTo(0.3, 2);
  });

  it("reports 3 total divergences", () => {
    seedHistoricalRun(tmpDir, "divg-run-1", "historical-divergence");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const report = readReport(tmpDir, RUN_ID);
    const divergences = parseTotalDivergences(report);
    expect(divergences).toBe(3);
  });

  it("replays all 10 prompts", () => {
    seedHistoricalRun(tmpDir, "divg-run-1", "historical-divergence");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const report = readReport(tmpDir, RUN_ID);
    const totalPrompts = parseTotalPrompts(report);
    expect(totalPrompts).toBe(10);
  });

  it("report body mentions divergence rate percentage", () => {
    seedHistoricalRun(tmpDir, "divg-run-1", "historical-divergence");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const report = readReport(tmpDir, RUN_ID);
    // Body should display "30.0%" in the aggregate section
    expect(report).toMatch(/30\.0%/);
  });
});

// ── historical-empty ───────────────────────────────────────────────────────

describe("shadow-mode harness — historical-empty fixture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-shadow-empty-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 (diagnostic, never blocks)", () => {
    seedHistoricalRun(tmpDir, "empty-run-1", "historical-empty");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    const { exitCode } = runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    expect(exitCode).toBe(0);
  });

  it("writes shadow-report.md even with no data", () => {
    seedHistoricalRun(tmpDir, "empty-run-1", "historical-empty");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const reportPath = path.join(
      tmpDir, ".guild", "evolve", RUN_ID, "shadow-report.md"
    );
    expect(fs.existsSync(reportPath)).toBe(true);
  });

  it("report indicates no historical runs were found", () => {
    seedHistoricalRun(tmpDir, "empty-run-1", "historical-empty");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const report = readReport(tmpDir, RUN_ID);
    // Script outputs "No historical runs found" when all runs are empty/skipped
    expect(report).toMatch(/no historical runs found/i);
  });

  it("reports total_prompts: 0", () => {
    seedHistoricalRun(tmpDir, "empty-run-1", "historical-empty");
    const proposed = seedProposedEdit(tmpDir, PROPOSED_SKILL_CONTENT);
    runShadowMode([
      "--skill", SKILL_SLUG,
      "--proposed-edit", proposed,
      "--run-id", RUN_ID,
      "--cwd", tmpDir,
    ]);
    const report = readReport(tmpDir, RUN_ID);
    const totalPrompts = parseTotalPrompts(report);
    expect(totalPrompts).toBe(0);
  });
});
