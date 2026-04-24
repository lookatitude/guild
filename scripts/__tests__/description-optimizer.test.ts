/**
 * scripts/__tests__/description-optimizer.test.ts
 *
 * TDD for description-optimizer.ts — §11.2 step 9.
 * Deterministic heuristic, not LLM.
 * Verifies:
 *  - Happy: derives trigger tokens from positives, filters against negatives, emits YAML.
 *  - Length cap: ≤ 1024 chars.
 *  - Missing --skill → exit 1.
 *  - Missing evals.json → exit 1.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../description-optimizer.ts");
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
 * Seed a minimal skill directory layout at <tmpDir>/skills/meta/<slug>/evals.json.
 * The optimizer accepts either a full layout or a direct evals path (the heuristic
 * searches skills/<tier>/<slug>/evals.json).
 */
function seedSkill(tmpDir: string, slug: string, fixtureName: string): string {
  const skillDir = path.join(tmpDir, "skills", "meta", slug);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(
    path.join(FIXTURES, fixtureName),
    path.join(skillDir, "evals.json")
  );
  return skillDir;
}

describe("description-optimizer.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-descopt-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("happy path — evals-for-optimizer.json", () => {
    it("exits 0", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-for-optimizer.json");
      const { exitCode } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
    });

    it("emits YAML description to stdout", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-for-optimizer.json");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(stdout).toMatch(/^description:/m);
    });

    it("description mentions 'brainstorm' (shared positive token)", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-for-optimizer.json");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(stdout.toLowerCase()).toContain("brainstorm");
    });

    it("description is ≤ 1024 chars", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-for-optimizer.json");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      // Match the value after `description: `
      const m = stdout.match(/^description:\s*(.+)$/m);
      expect(m).not.toBeNull();
      const desc = (m![1] || "").trim();
      expect(desc.length).toBeLessThanOrEqual(1024);
    });

    it("description is a single line", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-for-optimizer.json");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      const descLines = stdout
        .split("\n")
        .filter((l) => l.startsWith("description:"));
      expect(descLines.length).toBe(1);
    });

    it("includes a TRIGGER clause", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-for-optimizer.json");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(stdout).toMatch(/TRIGGER/);
    });

    it("includes a DO NOT TRIGGER clause when negatives are supplied", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-for-optimizer.json");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(stdout).toMatch(/DO NOT TRIGGER/);
    });
  });

  describe("CLI errors", () => {
    it("exits 1 when --skill is missing", () => {
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/skill/i);
    });

    it("exits 1 when evals.json does not exist", () => {
      const { exitCode, stderr } = runScript([
        "--skill",
        "nonexistent-skill",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/evals/i);
    });
  });
});
