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

  // ── F3 regression: slug→trigger divergence fix ───────────────────────────
  // The old code used the slug's LAST SEGMENT (e.g. "skill" from "guild:create-skill")
  // to test whether a historical trace "triggered" the skill. That's too generic —
  // a specialist named "wiki-query-skill-helper" would spuriously count as triggered.
  // The fix: bind on the full non-namespace identity ("create-skill", not "skill").
  describe("F3 fix — slug binds on full identity, not last segment", () => {
    it("divergences are 0 when historical specialist shares only the last segment (not full identity)", () => {
      // Setup: historical specialist = "wiki-query-skill-helper" (contains "skill" but not "create-skill")
      // Proposed skill slug: "guild:create-skill"
      // Proposed description doesn't trigger on these prompts (DO NOT TRIGGER for wiki)
      // Both prompts are wiki-related → wouldTrigger = false
      //
      // Old (broken): "wiki-query-skill-helper".includes("skill") = true → historicalTriggered = true
      //               wouldTrigger=false ≠ historicalTriggered=true → 2 divergences (false upper-bound)
      // New (correct): "wiki-query-skill-helper".includes("create-skill") = false → historicalTriggered = false
      //                wouldTrigger=false === historicalTriggered=false → 0 divergences (accurate)
      const slugDivergenceRunDir = path.join(tmpDir, ".guild", "runs", "slug-div-run");
      fs.mkdirSync(slugDivergenceRunDir, { recursive: true });
      fs.copyFileSync(
        path.join(FIXTURES, "shadow-slug-divergence", "events.ndjson"),
        path.join(slugDivergenceRunDir, "events.ndjson")
      );
      const proposed = seedProposedEdit(
        tmpDir,
        "---\nname: guild-create-skill\ndescription: create skill specialist. TRIGGER for create skill. DO NOT TRIGGER for wiki.\n---\nBody."
      );
      const { exitCode } = runScript([
        "--skill",
        "guild:create-skill",
        "--proposed-edit",
        proposed,
        "--run-id",
        "f3-slug-test",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
      const report = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "f3-slug-test", "shadow-report.md"),
        "utf8"
      );
      // Front-matter: total_divergences: 0
      expect(report).toMatch(/^total_divergences:\s*0$/m);
    });

    it("divergences are 0 when historical specialist matches full skill identity", () => {
      // historical specialist = "create-skill" → correct match on full identity
      // proposed description triggers on prompts containing "create" → wouldTrigger = true
      // historicalTriggered = true → no divergence
      const correctRunDir = path.join(tmpDir, ".guild", "runs", "slug-correct-run");
      fs.mkdirSync(correctRunDir, { recursive: true });
      fs.writeFileSync(
        path.join(correctRunDir, "events.ndjson"),
        [
          '{"event":"UserPromptSubmit","prompt":"create a new skill for the project","specialist":""}',
          '{"event":"SubagentStop","specialist":"create-skill"}',
        ].join("\n") + "\n",
        "utf8"
      );
      const proposed = seedProposedEdit(
        tmpDir,
        "---\nname: guild-create-skill\ndescription: create skill specialist. TRIGGER for create skill new. DO NOT TRIGGER for deploy.\n---\nBody."
      );
      const { exitCode } = runScript([
        "--skill",
        "guild:create-skill",
        "--proposed-edit",
        proposed,
        "--run-id",
        "f3-correct-test",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
      const report = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "f3-correct-test", "shadow-report.md"),
        "utf8"
      );
      // Both proposed triggered AND historical triggered → no divergence
      expect(report).toMatch(/^total_divergences:\s*0$/m);
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
