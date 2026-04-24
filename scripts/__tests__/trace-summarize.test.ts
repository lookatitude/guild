/**
 * scripts/__tests__/trace-summarize.test.ts
 *
 * TDD: written before trace-summarize.ts implementation.
 * Spawns the script with a temp run dir, verifies:
 *  - Happy path: correct counts, specialists, ok_rate, sections present
 *  - Empty: minimal summary without crash
 *  - Malformed: valid lines parsed, invalid lines skipped, exit 0
 *  - CLI errors: missing --run-id → exit 1, missing events file → exit 1
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../trace-summarize.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function runScript(
  args: string[],
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeRunDir(tmpDir: string, runId: string, fixtureFile: string): string {
  const runDir = path.join(tmpDir, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const src = path.join(FIXTURES, fixtureFile);
  const dst = path.join(runDir, "events.ndjson");
  fs.copyFileSync(src, dst);
  return runDir;
}

describe("trace-summarize.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-summarize-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────
  // Happy path
  // ─────────────────────────────────────────────────────────────
  describe("happy path — events-happy.ndjson", () => {
    it("exits 0", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      const { exitCode } = runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("writes summary.md to default output path", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const summaryPath = path.join(tmpDir, ".guild", "runs", "test-run", "summary.md");
      expect(fs.existsSync(summaryPath)).toBe(true);
    });

    it("writes summary.md to custom --out path", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      const outPath = path.join(tmpDir, "custom-summary.md");
      runScript(["--run-id", "test-run", "--cwd", tmpDir, "--out", outPath]);
      expect(fs.existsSync(outPath)).toBe(true);
    });

    it("frontmatter contains run_id", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/run_id:\s*test-run/);
    });

    it("frontmatter contains correct event_count (20 events)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/event_count:\s*20/);
    });

    it("frontmatter contains both specialists sorted alphabetically", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      // Both specialists must appear
      expect(content).toMatch(/backend-engineer/);
      expect(content).toMatch(/frontend-engineer/);
      // In the frontmatter list, backend comes before frontend alphabetically
      const backendIdx = content.indexOf("backend-engineer");
      const frontendIdx = content.indexOf("frontend-engineer");
      expect(backendIdx).toBeLessThan(frontendIdx);
    });

    it("frontmatter contains errors count (1 error in happy fixture)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/errors:\s*1/);
    });

    it("frontmatter ok_rate is correct (19/20 = 0.95)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/ok_rate:\s*0\.95/);
    });

    it("frontmatter tools_used lists tools sorted by count descending", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      // Read appears 6 times, Bash 5, Write 4, Edit 3 in happy fixture
      // (plus SubagentStop with empty tool which is excluded from tools_used)
      expect(content).toMatch(/Read:\s*6/);
      expect(content).toMatch(/Bash:\s*5/);
      expect(content).toMatch(/Write:\s*4/);
      expect(content).toMatch(/Edit:\s*3/);
      // Read (6) must appear before Bash (5) in the tools list
      const readIdx = content.indexOf("Read: 6");
      const bashIdx = content.indexOf("Bash: 5");
      expect(readIdx).toBeLessThan(bashIdx);
    });

    it("frontmatter started_at and ended_at are correct ISO timestamps", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/started_at:\s*2026-04-24T10:00:00\.000Z/);
      expect(content).toMatch(/ended_at:\s*2026-04-24T10:00:45\.000Z/);
    });

    it("frontmatter files_touched_count is correct (Write+Edit = 7)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      // 3 Write + 3 Edit (backend) + 1 Write + 2 Edit + 1 Write (frontend) = Write:4, Edit:3 = 7
      expect(content).toMatch(/files_touched_count:\s*7/);
    });

    it("body has all required markdown sections", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/^# Run test-run summary/m);
      expect(content).toMatch(/^## Timeline/m);
      expect(content).toMatch(/^## Specialist activity/m);
      expect(content).toMatch(/^## Notable events/m);
      expect(content).toMatch(/^## Reflection hints/m);
    });

    it("body does not reference .guild/wiki (invariant check)", () => {
      makeRunDir(tmpDir, "test-run", "events-happy.ndjson");
      runScript(["--run-id", "test-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "test-run", "summary.md"),
        "utf8"
      );
      expect(content).not.toMatch(/\.guild\/wiki/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Empty events file
  // ─────────────────────────────────────────────────────────────
  describe("empty events file — events-empty.ndjson", () => {
    it("exits 0 (does not crash)", () => {
      makeRunDir(tmpDir, "empty-run", "events-empty.ndjson");
      const { exitCode } = runScript(["--run-id", "empty-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("writes a summary.md", () => {
      makeRunDir(tmpDir, "empty-run", "events-empty.ndjson");
      runScript(["--run-id", "empty-run", "--cwd", tmpDir]);
      const summaryPath = path.join(tmpDir, ".guild", "runs", "empty-run", "summary.md");
      expect(fs.existsSync(summaryPath)).toBe(true);
    });

    it("frontmatter shows event_count: 0", () => {
      makeRunDir(tmpDir, "empty-run", "events-empty.ndjson");
      runScript(["--run-id", "empty-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "empty-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/event_count:\s*0/);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Malformed events file
  // ─────────────────────────────────────────────────────────────
  describe("malformed events file — events-malformed.ndjson", () => {
    it("exits 0 when at least some lines parse", () => {
      makeRunDir(tmpDir, "malformed-run", "events-malformed.ndjson");
      const { exitCode } = runScript(["--run-id", "malformed-run", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("writes a summary.md for 3 valid events", () => {
      makeRunDir(tmpDir, "malformed-run", "events-malformed.ndjson");
      runScript(["--run-id", "malformed-run", "--cwd", tmpDir]);
      const summaryPath = path.join(tmpDir, ".guild", "runs", "malformed-run", "summary.md");
      expect(fs.existsSync(summaryPath)).toBe(true);
    });

    it("counts only valid lines (3 valid out of 5 total)", () => {
      makeRunDir(tmpDir, "malformed-run", "events-malformed.ndjson");
      runScript(["--run-id", "malformed-run", "--cwd", tmpDir]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", "malformed-run", "summary.md"),
        "utf8"
      );
      expect(content).toMatch(/event_count:\s*3/);
    });

    it("reports parse errors to stderr", () => {
      makeRunDir(tmpDir, "malformed-run", "events-malformed.ndjson");
      const { stderr } = runScript(["--run-id", "malformed-run", "--cwd", tmpDir]);
      // Should log parse error for the 2 malformed lines
      expect(stderr).toMatch(/parse/i);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // CLI error handling
  // ─────────────────────────────────────────────────────────────
  describe("CLI error handling", () => {
    it("exits 1 when --run-id is missing", () => {
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/run-id/i);
    });

    it("exits 1 when events.ndjson does not exist", () => {
      // Run dir exists but no events file
      const runDir = path.join(tmpDir, ".guild", "runs", "no-events");
      fs.mkdirSync(runDir, { recursive: true });
      const { exitCode, stderr } = runScript(["--run-id", "no-events", "--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/events/i);
    });
  });
});
