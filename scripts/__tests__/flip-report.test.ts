/**
 * scripts/__tests__/flip-report.test.ts
 *
 * TDD for flip-report.ts — §11.2 step 6.
 * Verifies:
 *  - Happy: reads paired grading.json, writes flip-report.md with correct P→F/F→P counts + aggregates.
 *  - Empty: zero cases → empty report, exit 0.
 *  - Malformed/missing grading.json → exit 1.
 *  - Missing --run-id → exit 1.
 *  - Does not reference .guild/wiki (invariant).
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../flip-report.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function runScript(args: string[]): { exitCode: number; stdout: string; stderr: string } {
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

function seedGrading(tmpDir: string, runId: string, fixtureName: string): string {
  const runDir = path.join(tmpDir, ".guild", "evolve", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, fixtureName), path.join(runDir, "grading.json"));
  return runDir;
}

describe("flip-report.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-flip-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("happy path — grading-happy.json", () => {
    it("exits 0", () => {
      seedGrading(tmpDir, "run-a", "grading-happy.json");
      const { exitCode } = runScript(["--run-id", "run-a", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("writes flip-report.md to default path", () => {
      seedGrading(tmpDir, "run-a", "grading-happy.json");
      runScript(["--run-id", "run-a", "--cwd", tmpDir]);
      const reportPath = path.join(tmpDir, ".guild", "evolve", "run-a", "flip-report.md");
      expect(fs.existsSync(reportPath)).toBe(true);
    });

    it("reports 2 regressions (pos-2, neg-2)", () => {
      seedGrading(tmpDir, "run-a", "grading-happy.json");
      runScript(["--run-id", "run-a", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-a", "flip-report.md"),
        "utf8"
      );
      // 2 P→F regressions: pos-2 (was pass, now fail), neg-2 (was pass, now fail)
      expect(content).toMatch(/regressions[^\d]*2/i);
    });

    it("reports 3 fixes (pos-3, pos-4, pos-5)", () => {
      seedGrading(tmpDir, "run-a", "grading-happy.json");
      runScript(["--run-id", "run-a", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-a", "flip-report.md"),
        "utf8"
      );
      // 3 F→P fixes: pos-3, pos-4, pos-5
      expect(content).toMatch(/fixes[^\d]*3/i);
    });

    it("lists regression case ids in the body", () => {
      seedGrading(tmpDir, "run-a", "grading-happy.json");
      runScript(["--run-id", "run-a", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-a", "flip-report.md"),
        "utf8"
      );
      expect(content).toContain("pos-2");
      expect(content).toContain("neg-2");
    });

    it("includes pass_rate for both current and proposed", () => {
      seedGrading(tmpDir, "run-a", "grading-happy.json");
      runScript(["--run-id", "run-a", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-a", "flip-report.md"),
        "utf8"
      );
      // current: 7/10 = 0.7, proposed: 8/10 = 0.8
      expect(content).toMatch(/0\.7/);
      expect(content).toMatch(/0\.8/);
    });

    it("does not reference .guild/wiki", () => {
      seedGrading(tmpDir, "run-a", "grading-happy.json");
      runScript(["--run-id", "run-a", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-a", "flip-report.md"),
        "utf8"
      );
      expect(content).not.toMatch(/\.guild\/wiki/);
    });
  });

  describe("empty grading", () => {
    it("exits 0 with zero cases", () => {
      seedGrading(tmpDir, "run-empty", "grading-empty.json");
      const { exitCode } = runScript(["--run-id", "run-empty", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("writes a minimal report", () => {
      seedGrading(tmpDir, "run-empty", "grading-empty.json");
      runScript(["--run-id", "run-empty", "--cwd", tmpDir]);
      const reportPath = path.join(tmpDir, ".guild", "evolve", "run-empty", "flip-report.md");
      expect(fs.existsSync(reportPath)).toBe(true);
    });
  });

  describe("CLI errors", () => {
    it("exits 1 when --run-id is missing", () => {
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/run-id/i);
    });

    it("exits 1 when grading.json does not exist", () => {
      const { exitCode, stderr } = runScript(["--run-id", "missing", "--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/grading/i);
    });

    it("exits 1 when grading.json is malformed JSON", () => {
      const runDir = path.join(tmpDir, ".guild", "evolve", "bad-run");
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, "grading.json"), "not json {", "utf8");
      const { exitCode, stderr } = runScript(["--run-id", "bad-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/parse|malformed|json/i);
    });
  });
});
