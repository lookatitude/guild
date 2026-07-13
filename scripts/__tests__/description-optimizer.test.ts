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
    timeout: 120_000,
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

  // ── F2 regression: bare-string evals corpus ──────────────────────────────
  // The shipped evals corpus uses bare strings (not {prompt} objects).
  // The optimizer MUST accept both shapes without crashing (§11.2 step-6).
  describe("F2 fix — bare-string evals corpus (evals-bare-strings.json)", () => {
    it("exits 0 with bare-string corpus", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-bare-strings.json");
      const { exitCode } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
    });

    it("emits YAML description to stdout with bare-string corpus", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-bare-strings.json");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(stdout).toMatch(/^description:/m);
    });

    it("description from bare-string corpus captures brainstorm tokens", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-bare-strings.json");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(stdout.toLowerCase()).toContain("brainstorm");
    });

    it("description from bare-string corpus is ≤ 1024 chars", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-bare-strings.json");
      const { stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      const m = stdout.match(/^description:\s*(.+)$/m);
      expect(m).not.toBeNull();
      const desc = (m![1] || "").trim();
      expect(desc.length).toBeLessThanOrEqual(1024);
    });

    it("{prompt}-object corpus still works after bare-string fix", () => {
      // Guard: the {prompt} fixture must keep working — both shapes coexist.
      seedSkill(tmpDir, "guild-brainstorm", "evals-for-optimizer.json");
      const { exitCode, stdout } = runScript([
        "--skill",
        "guild-brainstorm",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^description:/m);
    });
  });

  // ── G2b-3 fix: KNOWN_TIERS hardcode → dynamic skills/ enumeration ────────
  // Before the fix, findEvalsFile only searched skills/{core,meta,specialists}/,
  // so the 11 knowledge-tier skills (skills/knowledge/<slug>/evals.json) and
  // dir-level skills (skills/guild-quality/evals.json, no tier nesting) were
  // unreachable to the evolve pipeline's description optimizer.
  describe("G2b-3 — dynamic tier enumeration (knowledge tier + dir-level skills)", () => {
    it("resolves a knowledge-tier slug (skills/knowledge/<slug>/evals.json)", () => {
      const skillDir = path.join(tmpDir, "skills", "knowledge", "wiki-ingest");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.copyFileSync(
        path.join(FIXTURES, "evals-for-optimizer.json"),
        path.join(skillDir, "evals.json"),
      );

      const { exitCode, stdout } = runScript(["--skill", "wiki-ingest", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^description:/m);
    });

    it("resolves a dir-level skill (skills/<slug>/evals.json, no tier nesting)", () => {
      const skillDir = path.join(tmpDir, "skills", "guild-quality");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.copyFileSync(
        path.join(FIXTURES, "evals-for-optimizer.json"),
        path.join(skillDir, "evals.json"),
      );

      const { exitCode, stdout } = runScript(["--skill", "guild-quality", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^description:/m);
    });

    it("still resolves the pre-existing tiers (core/meta/specialists) unchanged", () => {
      seedSkill(tmpDir, "guild-brainstorm", "evals-for-optimizer.json"); // skills/meta/
      const { exitCode, stdout } = runScript(["--skill", "guild-brainstorm", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^description:/m);
    });

    it("a made-up future tier dir is picked up without any code change", () => {
      const skillDir = path.join(tmpDir, "skills", "future-tier", "some-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.copyFileSync(
        path.join(FIXTURES, "evals-for-optimizer.json"),
        path.join(skillDir, "evals.json"),
      );

      const { exitCode, stdout } = runScript(["--skill", "some-skill", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^description:/m);
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
