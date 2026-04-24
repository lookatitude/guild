/**
 * scripts/__tests__/evolve-loop.test.ts
 *
 * TDD for evolve-loop.ts — §11.2 top-level orchestration wrapper.
 * Verifies:
 *  - Happy: snapshots skills/meta/<slug>/ → .guild/skill-versions/<slug>/vN/.
 *  - Writes pipeline.md to .guild/evolve/<run-id>/.
 *  - Does NOT promote (stops before the gate).
 *  - Missing --skill → exit 1.
 *  - Missing skill dir → exit 1.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../evolve-loop.ts");
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

/**
 * Seed a minimal skill at skills/meta/<slug>/ by copying skill-v1 fixtures.
 */
function seedLiveSkill(tmpDir: string, slug: string): string {
  const dir = path.join(tmpDir, "skills", "meta", slug);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ["SKILL.md", "evals.json"]) {
    fs.copyFileSync(
      path.join(FIXTURES, "skill-v1", f),
      path.join(dir, f)
    );
  }
  return dir;
}

describe("evolve-loop.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-evolve-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("happy path — one skill, no prior history", () => {
    it("exits 0", () => {
      seedLiveSkill(tmpDir, "guild-brainstorm");
      const { exitCode } = runScript([
        "--skill",
        "guild-brainstorm",
        "--run-id",
        "run-x",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
    });

    it("creates v1 snapshot in .guild/skill-versions/<slug>/", () => {
      seedLiveSkill(tmpDir, "guild-brainstorm");
      runScript([
        "--skill",
        "guild-brainstorm",
        "--run-id",
        "run-x",
        "--cwd",
        tmpDir,
      ]);
      const snap = path.join(
        tmpDir,
        ".guild",
        "skill-versions",
        "guild-brainstorm",
        "v1",
        "SKILL.md"
      );
      expect(fs.existsSync(snap)).toBe(true);
    });

    it("increments version when prior snapshots exist", () => {
      seedLiveSkill(tmpDir, "guild-brainstorm");
      // pre-seed v1
      const pre = path.join(
        tmpDir,
        ".guild",
        "skill-versions",
        "guild-brainstorm",
        "v1"
      );
      fs.mkdirSync(pre, { recursive: true });
      fs.copyFileSync(
        path.join(FIXTURES, "skill-v1", "SKILL.md"),
        path.join(pre, "SKILL.md")
      );

      runScript([
        "--skill",
        "guild-brainstorm",
        "--run-id",
        "run-y",
        "--cwd",
        tmpDir,
      ]);
      const v2 = path.join(
        tmpDir,
        ".guild",
        "skill-versions",
        "guild-brainstorm",
        "v2",
        "SKILL.md"
      );
      expect(fs.existsSync(v2)).toBe(true);
    });

    it("writes pipeline.md to .guild/evolve/<run-id>/", () => {
      seedLiveSkill(tmpDir, "guild-brainstorm");
      runScript([
        "--skill",
        "guild-brainstorm",
        "--run-id",
        "run-x",
        "--cwd",
        tmpDir,
      ]);
      const plan = path.join(
        tmpDir,
        ".guild",
        "evolve",
        "run-x",
        "pipeline.md"
      );
      expect(fs.existsSync(plan)).toBe(true);
    });

    it("pipeline.md lists the 10 §11.2 steps", () => {
      seedLiveSkill(tmpDir, "guild-brainstorm");
      runScript([
        "--skill",
        "guild-brainstorm",
        "--run-id",
        "run-x",
        "--cwd",
        tmpDir,
      ]);
      const content = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-x", "pipeline.md"),
        "utf8"
      );
      // Expect references to all 10 steps
      for (const n of ["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.", "10."]) {
        expect(content).toContain(n);
      }
    });

    it("does NOT modify the live skill (promotion is external)", () => {
      seedLiveSkill(tmpDir, "guild-brainstorm");
      const liveSkillPath = path.join(
        tmpDir,
        "skills",
        "meta",
        "guild-brainstorm",
        "SKILL.md"
      );
      const before = fs.readFileSync(liveSkillPath, "utf8");
      runScript([
        "--skill",
        "guild-brainstorm",
        "--run-id",
        "run-x",
        "--cwd",
        tmpDir,
      ]);
      const after = fs.readFileSync(liveSkillPath, "utf8");
      expect(after).toBe(before);
    });

    it("does not write to .guild/wiki", () => {
      seedLiveSkill(tmpDir, "guild-brainstorm");
      runScript([
        "--skill",
        "guild-brainstorm",
        "--run-id",
        "run-x",
        "--cwd",
        tmpDir,
      ]);
      const wikiPath = path.join(tmpDir, ".guild", "wiki");
      expect(fs.existsSync(wikiPath)).toBe(false);
    });
  });

  describe("CLI errors", () => {
    it("exits 1 when --skill is missing", () => {
      const { exitCode, stderr } = runScript(["--cwd", tmpDir, "--run-id", "x"]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/skill/i);
    });

    it("exits 1 when skill directory does not exist", () => {
      const { exitCode, stderr } = runScript([
        "--skill",
        "ghost",
        "--run-id",
        "x",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/skill/i);
    });
  });
});
