/**
 * scripts/evolve-loop.test.ts
 *
 * TDD for evolve-loop.ts — §11.2 top-level orchestration wrapper.
 * Verifies:
 *  - Happy: records the live body's baseline_sha256 in pipeline.md and writes NO
 *    version tree (KTD48 — compact history replaced it).
 *  - Writes pipeline.md to .guild/evolve/<run-id>/.
 *  - Does NOT promote (stops before the gate).
 *  - Missing --skill → exit 1.
 *  - Missing skill dir → exit 1.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "evolve-loop.ts");
const FIXTURES = path.resolve(__dirname, "fixtures");

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

    it("records the live body's baseline_sha256 in pipeline.md", () => {
      const live = seedLiveSkill(tmpDir, "guild-brainstorm");
      runScript(["--skill", "guild-brainstorm", "--run-id", "run-x", "--cwd", tmpDir]);
      const pipeline = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-x", "pipeline.md"),
        "utf8"
      );
      const expected = crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(live, "SKILL.md"), "utf8"), "utf8")
        .digest("hex");
      expect(pipeline).toContain(`baseline_sha256: ${expected}`);
    });

    it("writes NO version tree — compact history replaced it (KTD48)", () => {
      seedLiveSkill(tmpDir, "guild-brainstorm");
      runScript(["--skill", "guild-brainstorm", "--run-id", "run-y", "--cwd", tmpDir]);
      const seen: string[] = [];
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, e.name);
          if (e.name === "skill-versions") seen.push(abs);
          if (e.isDirectory()) walk(abs);
        }
      };
      walk(tmpDir);
      expect(seen).toEqual([]);
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

  // ── G2b-3 fix: KNOWN_TIERS hardcode → dynamic skills/ enumeration ────────
  // Dir-level skills (skills/guild-quality/, no tier nesting) and any future
  // tier dir must resolve without a code change to the tier list.
  describe("G2b-3 — dynamic tier enumeration (dir-level skills + future tiers)", () => {
    it("resolves a dir-level skill (skills/<slug>/SKILL.md, no tier nesting)", () => {
      const dir = path.join(tmpDir, "skills", "guild-quality");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(FIXTURES, "skill-v1", "SKILL.md"), path.join(dir, "SKILL.md"));

      const { exitCode } = runScript(["--skill", "guild-quality", "--run-id", "run-x", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      const pipeline = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-x", "pipeline.md"),
        "utf8"
      );
      expect(pipeline).toMatch(/baseline_sha256: [0-9a-f]{64}/);
    });

    it("resolves a knowledge-tier slug (skills/knowledge/<slug>/SKILL.md)", () => {
      const dir = path.join(tmpDir, "skills", "knowledge", "wiki-ingest");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(FIXTURES, "skill-v1", "SKILL.md"), path.join(dir, "SKILL.md"));

      const { exitCode } = runScript(["--skill", "wiki-ingest", "--run-id", "run-x", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      const pipeline = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-x", "pipeline.md"),
        "utf8"
      );
      expect(pipeline).toMatch(/baseline_sha256: [0-9a-f]{64}/);
    });

    it("a made-up future tier dir is picked up without any code change", () => {
      const dir = path.join(tmpDir, "skills", "future-tier", "some-skill");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(FIXTURES, "skill-v1", "SKILL.md"), path.join(dir, "SKILL.md"));

      const { exitCode } = runScript(["--skill", "some-skill", "--run-id", "run-x", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("still resolves the pre-existing meta tier unchanged", () => {
      seedLiveSkill(tmpDir, "guild-brainstorm");
      const { exitCode } = runScript(["--skill", "guild-brainstorm", "--run-id", "run-x", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });
  });

  // ── DH-3 fix: consuming-repo project instance wins over the plugin tree ───
  // A promoted/minted skill lives at .guild/skills/<slug>/. findLiveSkillDir
  // must resolve THAT first, so a second evolve snapshots the live (already
  // evolved) content — not the stale plugin-tree baseline. Consuming repos that
  // have no plugin tree at all must still be able to snapshot from .guild.
  describe("DH-3 — .guild/skills/<slug>/ project instance resolves first", () => {
    function seedGuildInstance(dir: string, slug: string, marker: string): void {
      const d = path.join(dir, ".guild", "skills", slug);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(
        path.join(d, "SKILL.md"),
        `---\nname: ${slug}\ndescription: ${marker}\n---\n# ${marker}\n`,
        "utf8"
      );
      fs.copyFileSync(
        path.join(FIXTURES, "skill-v1", "evals.json"),
        path.join(d, "evals.json")
      );
    }

    it("baselines the .guild instance, not the plugin-tree copy, when both exist", () => {
      // Plugin-tree baseline (stale) + a live .guild project instance (evolved).
      seedLiveSkill(tmpDir, "guild-brainstorm");
      seedGuildInstance(tmpDir, "guild-brainstorm", "GUILD-INSTANCE-LIVE");

      const { exitCode } = runScript([
        "--skill",
        "guild-brainstorm",
        "--run-id",
        "run-dh3",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);

      // pipeline.md records the resolved tier as "project", and the baseline hashes
      // the .guild instance body — proving the project instance won over the plugin tree.
      const pipeline = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-dh3", "pipeline.md"),
        "utf8"
      );
      const instanceHash = crypto
        .createHash("sha256")
        .update(
          fs.readFileSync(
            path.join(tmpDir, ".guild", "skills", "guild-brainstorm", "SKILL.md"),
            "utf8"
          ),
          "utf8"
        )
        .digest("hex");
      expect(pipeline).toContain(`baseline_sha256: ${instanceHash}`);
      // plain substring (not a line-anchored key regex): pipeline.md is prose+
      // frontmatter; the comms-format policy reserves YAML-key extraction for
      // the shared js-yaml reader, and this assertion only needs presence.
      expect(pipeline).toContain("tier: project");
    });

    it("resolves the .guild instance when NO plugin tree exists (consuming repo)", () => {
      // No skills/ tree at all — only the consuming repo's .guild instance.
      seedGuildInstance(tmpDir, "guild-brainstorm", "ONLY-GUILD-INSTANCE");

      const { exitCode } = runScript([
        "--skill",
        "guild-brainstorm",
        "--run-id",
        "run-dh3b",
        "--cwd",
        tmpDir,
      ]);
      expect(exitCode).toBe(0);
      const pipeline = fs.readFileSync(
        path.join(tmpDir, ".guild", "evolve", "run-dh3b", "pipeline.md"),
        "utf8"
      );
      const instanceHash = crypto
        .createHash("sha256")
        .update(
          fs.readFileSync(
            path.join(tmpDir, ".guild", "skills", "guild-brainstorm", "SKILL.md"),
            "utf8"
          ),
          "utf8"
        )
        .digest("hex");
      expect(pipeline).toContain(`baseline_sha256: ${instanceHash}`);
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
