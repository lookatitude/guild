/**
 * scripts/__tests__/check-plugin-root-fallback.test.ts
 *
 * TDD for check-plugin-root-fallback.ts (issue #36 CI regression rail).
 *
 * Anti-vacuity: proves the rail (a) FLAGS a known-bad fixture carrying the two-level
 * fallback, and (b) PASSES on the current tree (which PR #61 already swept clean).
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { findViolations } from "../check-plugin-root-fallback";

const SCRIPT = path.resolve(__dirname, "../check-plugin-root-fallback.ts");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BAD = "npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/evolve-loop.ts";
const GOOD =
  "npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/evolve-loop.ts";

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

describe("check-plugin-root-fallback.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pluginroot-rail-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("findViolations — unit", () => {
    it("flags the two-level fallback in a src/modules/*/resources file", () => {
      const dir = path.join(tmpDir, "src", "modules", "foo", "resources", "skills", "bar");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), `line one\n${BAD}\nline three\n`);

      const violations = findViolations(tmpDir);
      expect(violations).toHaveLength(1);
      expect(violations[0].file).toBe(
        path.join("src", "modules", "foo", "resources", "skills", "bar", "SKILL.md")
      );
      expect(violations[0].line).toBe(2);
    });

    it("flags occurrences in commands/, skills/, command-src/, skill-src/", () => {
      const targets = [
        ["commands", "foo.md"],
        ["skills", "meta", "foo", "SKILL.md"],
        ["command-src", "command-registry.json"],
        ["skill-src", "skill-registry.json"],
      ];
      for (const parts of targets) {
        const dir = path.join(tmpDir, ...parts.slice(0, -1));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, parts[parts.length - 1]), BAD);
      }

      const violations = findViolations(tmpDir);
      expect(violations).toHaveLength(4);
    });

    it("does NOT flag the fixed triple-fallback pattern", () => {
      const dir = path.join(tmpDir, "commands");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "foo.md"), GOOD);

      expect(findViolations(tmpDir)).toHaveLength(0);
    });

    it("does NOT flag files outside the scanned roots", () => {
      const dir = path.join(tmpDir, "docs");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "foo.md"), BAD);

      expect(findViolations(tmpDir)).toHaveLength(0);
    });

    it("returns [] for an empty/nonexistent tree", () => {
      expect(findViolations(tmpDir)).toEqual([]);
    });
  });

  describe("CLI — anti-vacuity", () => {
    it("FAILS (exit 1) against a known-bad fixture", () => {
      const dir = path.join(tmpDir, "skills", "meta", "foo");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), BAD);

      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/foo\/SKILL\.md/);
      expect(stderr).toMatch(/GUILD_PLUGIN_ROOT/);
    });

    it("PASSES (exit 0) on an empty tree", () => {
      const { exitCode, stdout } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/PASS/);
    });

    it("PASSES (exit 0) on the current plugin tree (PR #61 already swept it clean)", () => {
      const { exitCode, stdout } = runScript(["--cwd", REPO_ROOT]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/PASS/);
    });
  });
});
