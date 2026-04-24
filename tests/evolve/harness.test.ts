/**
 * tests/evolve/harness.test.ts
 *
 * End-to-end harness tests for scripts/flip-report.ts.
 * Exercises 4 cross-cutting fixture scenarios (regression-heavy, pure-fixes,
 * neutral, malformed) and asserts promote/reject/error outcomes.
 *
 * Each test writes grading.json into an OS tmpdir (.guild/evolve/<run-id>/)
 * so runs are fully isolated.
 *
 * Implements guild-plan.md §11.2 step 6 cross-cutting coverage.
 * Addresses §15.2 risk row 4 (evolve overfit to its own evals).
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../../scripts/flip-report.ts");
const FIXTURES = path.resolve(__dirname, "fixtures");

function runFlipReport(args: string[]): {
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

function seedGrading(
  tmpDir: string,
  runId: string,
  fixtureName: string
): string {
  const runDir = path.join(tmpDir, ".guild", "evolve", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(
    path.join(FIXTURES, fixtureName),
    path.join(runDir, "grading.json")
  );
  return runDir;
}

function readReport(tmpDir: string, runId: string): string {
  return fs.readFileSync(
    path.join(tmpDir, ".guild", "evolve", runId, "flip-report.md"),
    "utf8"
  );
}

/** Parse a numeric field from the YAML front-matter of a flip report. */
function parseFrontmatterField(report: string, field: string): number {
  const m = report.match(new RegExp(`^${field}:\\s*(\\d+)`, "m"));
  if (!m) throw new Error(`field '${field}' not found in report front-matter`);
  return parseInt(m[1], 10);
}

// ── Test fixtures ──────────────────────────────────────────────────────────

describe("flip-report harness — regression-heavy fixture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-evolve-rh-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 (valid grading JSON)", () => {
    seedGrading(tmpDir, "run-rh", "regression-heavy.json");
    const { exitCode } = runFlipReport(["--run-id", "run-rh", "--cwd", tmpDir]);
    expect(exitCode).toBe(0);
  });

  it("reports ≥5 regressions", () => {
    seedGrading(tmpDir, "run-rh", "regression-heavy.json");
    runFlipReport(["--run-id", "run-rh", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-rh");
    const regressions = parseFrontmatterField(report, "regressions");
    expect(regressions).toBeGreaterThanOrEqual(5);
  });

  it("regressions exceed fixes (NOT promote-eligible)", () => {
    seedGrading(tmpDir, "run-rh", "regression-heavy.json");
    runFlipReport(["--run-id", "run-rh", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-rh");
    const regressions = parseFrontmatterField(report, "regressions");
    const fixes = parseFrontmatterField(report, "fixes");
    expect(regressions).toBeGreaterThan(fixes);
  });

  it("lists P→F regressions in the body", () => {
    seedGrading(tmpDir, "run-rh", "regression-heavy.json");
    runFlipReport(["--run-id", "run-rh", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-rh");
    expect(report).toMatch(/P→F/);
    expect(report).toContain("spec-write-01");
  });

  it("includes token delta in the aggregate table", () => {
    seedGrading(tmpDir, "run-rh", "regression-heavy.json");
    runFlipReport(["--run-id", "run-rh", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-rh");
    expect(report).toMatch(/tokens_total/i);
  });
});

// ── pure-fixes ─────────────────────────────────────────────────────────────

describe("flip-report harness — pure-fixes fixture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-evolve-pf-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0", () => {
    seedGrading(tmpDir, "run-pf", "pure-fixes.json");
    const { exitCode } = runFlipReport(["--run-id", "run-pf", "--cwd", tmpDir]);
    expect(exitCode).toBe(0);
  });

  it("reports 0 regressions (PROMOTE-eligible)", () => {
    seedGrading(tmpDir, "run-pf", "pure-fixes.json");
    runFlipReport(["--run-id", "run-pf", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-pf");
    const regressions = parseFrontmatterField(report, "regressions");
    expect(regressions).toBe(0);
  });

  it("reports ≥5 fixes", () => {
    seedGrading(tmpDir, "run-pf", "pure-fixes.json");
    runFlipReport(["--run-id", "run-pf", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-pf");
    const fixes = parseFrontmatterField(report, "fixes");
    expect(fixes).toBeGreaterThanOrEqual(5);
  });

  it("pass_rate_proposed is higher than pass_rate_current", () => {
    seedGrading(tmpDir, "run-pf", "pure-fixes.json");
    runFlipReport(["--run-id", "run-pf", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-pf");
    // current has 5/10 failures, proposed has all passing → current 0.500, proposed 1.000
    expect(report).toMatch(/pass_rate_current:\s*0\.500/);
    expect(report).toMatch(/pass_rate_proposed:\s*1\.000/);
  });

  it("includes F→P entries in the body", () => {
    seedGrading(tmpDir, "run-pf", "pure-fixes.json");
    runFlipReport(["--run-id", "run-pf", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-pf");
    expect(report).toMatch(/F→P/);
    expect(report).toContain("spec-write-01");
  });
});

// ── neutral ────────────────────────────────────────────────────────────────

describe("flip-report harness — neutral fixture (tokens ↓ >10%)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-evolve-nt-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0", () => {
    seedGrading(tmpDir, "run-nt", "neutral.json");
    const { exitCode } = runFlipReport(["--run-id", "run-nt", "--cwd", tmpDir]);
    expect(exitCode).toBe(0);
  });

  it("reports 0 regressions", () => {
    seedGrading(tmpDir, "run-nt", "neutral.json");
    runFlipReport(["--run-id", "run-nt", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-nt");
    const regressions = parseFrontmatterField(report, "regressions");
    expect(regressions).toBe(0);
  });

  it("reports 0 fixes (no flip change)", () => {
    seedGrading(tmpDir, "run-nt", "neutral.json");
    runFlipReport(["--run-id", "run-nt", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-nt");
    const fixes = parseFrontmatterField(report, "fixes");
    expect(fixes).toBe(0);
  });

  it("tokens_total_delta reflects >10% reduction (PROMOTE-eligible via efficiency)", () => {
    seedGrading(tmpDir, "run-nt", "neutral.json");
    runFlipReport(["--run-id", "run-nt", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-nt");
    // The delta should be negative (reduction), confirm the sign
    const deltaMatch = report.match(/tokens_total_delta:\s*(-[\d.]+%)/);
    expect(deltaMatch).not.toBeNull();
    if (deltaMatch) {
      const delta = parseFloat(deltaMatch[1]);
      expect(delta).toBeLessThan(-10.0); // >10% reduction = negative value below -10%
    }
  });

  it("report includes stable_pass and stable_fail counts", () => {
    seedGrading(tmpDir, "run-nt", "neutral.json");
    runFlipReport(["--run-id", "run-nt", "--cwd", tmpDir]);
    const report = readReport(tmpDir, "run-nt");
    expect(report).toMatch(/stable_pass:\s*\d+/);
    expect(report).toMatch(/stable_fail:\s*\d+/);
  });
});

// ── malformed ──────────────────────────────────────────────────────────────

describe("flip-report harness — malformed fixture (missing proposed key)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-evolve-mf-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 1 (bad input)", () => {
    seedGrading(tmpDir, "run-mf", "malformed.json");
    const { exitCode } = runFlipReport(["--run-id", "run-mf", "--cwd", tmpDir]);
    expect(exitCode).toBe(1);
  });

  it("stderr mentions the validation error", () => {
    seedGrading(tmpDir, "run-mf", "malformed.json");
    const { stderr } = runFlipReport(["--run-id", "run-mf", "--cwd", tmpDir]);
    expect(stderr).toMatch(/proposed|grading|parse|malformed/i);
  });

  it("does not write a flip-report.md", () => {
    seedGrading(tmpDir, "run-mf", "malformed.json");
    runFlipReport(["--run-id", "run-mf", "--cwd", tmpDir]);
    const reportPath = path.join(
      tmpDir,
      ".guild",
      "evolve",
      "run-mf",
      "flip-report.md"
    );
    expect(fs.existsSync(reportPath)).toBe(false);
  });
});
