/**
 * scripts/__tests__/shadow-mode.test.ts
 *
 * TDD for shadow-mode.ts — §11.2 step 7.
 * Verifies:
 *  - Happy: replays proposed skill against historical traces, writes shadow-report.md.
 *  - Always exits 0 (diagnostic, never blocks).
 *  - Missing --skill or --proposed-edit → exit 1.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../shadow-mode.ts");
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

function seedHistoricalRuns(tmpDir: string): void {
  for (const r of ["shadow-run-1", "shadow-run-2"]) {
    const runDir = path.join(tmpDir, ".guild", "runs", r);
    fs.mkdirSync(runDir, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURES, r, "events.ndjson"),
      path.join(runDir, "events.ndjson")
    );
  }
}

function seedProposedEdit(tmpDir: string, content: string): string {
  const p = path.join(tmpDir, "proposed.md");
  fs.writeFileSync(p, content, "utf8");
  return p;
}

describe("shadow-mode.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-shadow-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("happy path — 2 historical runs", () => {
    it("exits 0", () => {
      seedHistoricalRuns(tmpDir);
      const proposed = seedProposedEdit(
        tmpDir,
        "---\nname: guild-brainstorm\ndescription: TRIGGER for brainstorm requests. DO NOT TRIGGER for deploy.\n---\nBody."
      );
      // Run-id also needs to exist under .guild/evolve/
      fs.mkdirSync(path.join(tmpDir, ".guild", "evolve", "shadow-run"), {
        recursive: true,
      });
      const { exitCode } = runScript([
        "--skill",
        "guild-brainstorm",
        "--proposed-edit",
        proposed,
        "--run-id",
        "shadow-run",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
    });

    it("writes shadow-report.md", () => {
      seedHistoricalRuns(tmpDir);
      const proposed = seedProposedEdit(
        tmpDir,
        "---\nname: guild-brainstorm\ndescription: TRIGGER for brainstorm requests. DO NOT TRIGGER for deploy.\n---"
      );
      fs.mkdirSync(path.join(tmpDir, ".guild", "evolve", "shadow-run"), {
        recursive: true,
      });
      runScript([
        "--skill",
        "guild-brainstorm",
        "--proposed-edit",
        proposed,
        "--run-id",
        "shadow-run",
        "--cwd",
        tmpDir,
      ]);
      const reportPath = path.join(
        tmpDir,
        ".guild",
        "evolve",
        "shadow-run",
        "shadow-report.md"
      );
      expect(fs.existsSync(reportPath)).toBe(true);
    });

    it("report mentions both historical runs", () => {
      seedHistoricalRuns(tmpDir);
      const proposed = seedProposedEdit(
        tmpDir,
        "---\nname: guild-brainstorm\ndescription: TRIGGER for brainstorm requests. DO NOT TRIGGER for deploy.\n---"
      );
      fs.mkdirSync(path.join(tmpDir, ".guild", "evolve", "shadow-run"), {
        recursive: true,
      });
      runScript([
        "--skill",
        "guild-brainstorm",
        "--proposed-edit",
        proposed,
        "--run-id",
        "shadow-run",
        "--cwd",
        tmpDir,
      ]);
      const reportPath = path.join(
        tmpDir,
        ".guild",
        "evolve",
        "shadow-run",
        "shadow-report.md"
      );
      const content = fs.readFileSync(reportPath, "utf8");
      expect(content).toContain("shadow-run-1");
      expect(content).toContain("shadow-run-2");
    });

    it("report includes a divergence rate", () => {
      seedHistoricalRuns(tmpDir);
      const proposed = seedProposedEdit(
        tmpDir,
        "---\nname: guild-brainstorm\ndescription: TRIGGER for brainstorm requests. DO NOT TRIGGER for deploy.\n---"
      );
      fs.mkdirSync(path.join(tmpDir, ".guild", "evolve", "shadow-run"), {
        recursive: true,
      });
      runScript([
        "--skill",
        "guild-brainstorm",
        "--proposed-edit",
        proposed,
        "--run-id",
        "shadow-run",
        "--cwd",
        tmpDir,
      ]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "shadow-run", "shadow-report.md"),
        "utf8"
      );
      expect(content).toMatch(/divergence/i);
    });

    it("does not reference .guild/wiki", () => {
      seedHistoricalRuns(tmpDir);
      const proposed = seedProposedEdit(
        tmpDir,
        "---\nname: guild-brainstorm\ndescription: TRIGGER for brainstorm requests. DO NOT TRIGGER for deploy.\n---"
      );
      fs.mkdirSync(path.join(tmpDir, ".guild", "evolve", "shadow-run"), {
        recursive: true,
      });
      runScript([
        "--skill",
        "guild-brainstorm",
        "--proposed-edit",
        proposed,
        "--run-id",
        "shadow-run",
        "--cwd",
        tmpDir,
      ]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "shadow-run", "shadow-report.md"),
        "utf8"
      );
      expect(content).not.toMatch(/\.guild\/wiki/);
    });
  });

  describe("CLI errors", () => {
    it("exits 1 when --skill is missing", () => {
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/skill/i);
    });

    it("exits 1 when --proposed-edit is missing", () => {
      const { exitCode, stderr } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/proposed-edit/i);
    });
  });
});
