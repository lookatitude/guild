/**
 * scripts/__tests__/rollback-walker.test.ts
 *
 * TDD for rollback-walker.ts — §11.3 versioning and rollback.
 * Verifies:
 *  - Happy: enumerates v1/v2/v3 and emits a markdown table to stdout.
 *  - --steps <n>: emits a proposed rollback action as YAML.
 *  - Does NOT mutate .guild/skill-versions/.
 *  - Missing --skill → exit 1.
 *  - Missing skill-versions dir → exit 1.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../rollback-walker.ts");
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

function seedVersions(tmpDir: string, slug: string): string {
  const base = path.join(tmpDir, ".guild", "skill-versions", slug);
  fs.mkdirSync(base, { recursive: true });
  for (const v of ["skill-v1", "skill-v2", "skill-v3"]) {
    const target = path.join(base, v.replace("skill-", ""));
    fs.mkdirSync(target, { recursive: true });
    for (const f of ["SKILL.md", "evals.json", "meta.json"]) {
      fs.copyFileSync(
        path.join(FIXTURES, v, f),
        path.join(target, f)
      );
    }
  }
  return base;
}

describe("rollback-walker.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rollback-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("happy path — 3 versions", () => {
    it("exits 0", () => {
      seedVersions(tmpDir, "guild-brainstorm");
      const { exitCode } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
    });

    it("emits markdown version table to stdout", () => {
      seedVersions(tmpDir, "guild-brainstorm");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      // Must mention v1, v2, v3
      expect(stdout).toContain("v1");
      expect(stdout).toContain("v2");
      expect(stdout).toContain("v3");
    });

    it("includes source metadata in output", () => {
      seedVersions(tmpDir, "guild-brainstorm");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(stdout).toContain("initial");
      expect(stdout).toContain("evolve-step-9");
    });

    it("does NOT mutate .guild/skill-versions/ (file count stable)", () => {
      const base = seedVersions(tmpDir, "guild-brainstorm");
      const before = fs.readdirSync(base).sort();
      runScript(["--skill", "guild-brainstorm", "--cwd", tmpDir]);
      const after = fs.readdirSync(base).sort();
      expect(after).toEqual(before);
    });
  });

  describe("--steps <n>", () => {
    it("emits a proposed rollback target as YAML", () => {
      seedVersions(tmpDir, "guild-brainstorm");
      const { stdout, exitCode } = runScript([
        "--skill",
        "guild-brainstorm",
        "--steps",
        "1",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
      // current is v3, steps=1 → target v2
      expect(stdout).toMatch(/proposed_rollback:/);
      expect(stdout).toMatch(/target_version:\s*v2/);
    });

    it("rejects steps that walk past v1", () => {
      seedVersions(tmpDir, "guild-brainstorm");
      const { exitCode, stderr } = runScript([
        "--skill",
        "guild-brainstorm",
        "--steps",
        "5",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/steps|past|invalid/i);
    });
  });

  describe("CLI errors", () => {
    it("exits 1 when --skill is missing", () => {
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/skill/i);
    });

    it("exits 1 when skill-versions dir does not exist", () => {
      const { exitCode, stderr } = runScript([
        "--skill",
        "ghost-skill",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/version/i);
    });
  });
});
