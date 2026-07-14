/**
 * hooks/__tests__/check-skill-coverage.test.ts
 *
 * Audit finding (check-skill-coverage.sh:73, stale-content): the frontend nudge
 * ("No specialist covers frontend / UI engineering") was a hardcoded P5-era
 * snapshot that went factually wrong once templates/specialists/frontend.md
 * shipped — every react/css/vue prompt kept getting a wrong nudge.
 *
 * The fix makes coverage a RUNTIME check (`domain_covered()` — does
 * templates/specialists/<name>.md exist) instead of a hardcoded list. These
 * tests prove both the mechanism (synthetic templates dir via
 * GUILD_PLUGIN_ROOT override) AND the REAL regression (against the actual
 * plugin repo, where frontend.md really does exist today).
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";

const SCRIPT = path.resolve(__dirname, "../check-skill-coverage.sh");
const REAL_PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

function runScript(
  prompt: string,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const sessionId = `test-${crypto.randomUUID()}`;
  const payload = JSON.stringify({ prompt, session_id: sessionId });
  const result = spawnSync("bash", [SCRIPT], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15000,
  });
  // Clean up the per-session lock file so repeated invocations in the same
  // test don't collide with a stale nudge-already-fired lock.
  try {
    fs.unlinkSync(`/tmp/guild-skill-nudge-${sessionId}`);
  } catch {
    /* fine — may not exist */
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("check-skill-coverage.sh — runtime template-coverage check", () => {
  describe("against the REAL plugin repo (regression pin)", () => {
    it("does NOT nudge for a react/frontend prompt — frontend.md really ships", () => {
      const { exitCode, stdout } = runScript("please review this react component's css");
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });

    it("templates/specialists/frontend.md actually exists (sanity check for the test above)", () => {
      expect(
        fs.existsSync(path.join(REAL_PLUGIN_ROOT, "templates", "specialists", "frontend.md")),
      ).toBe(true);
    });

    it("still nudges for an uncovered domain (ML engineering — anti-vacuity control)", () => {
      const { exitCode, stdout } = runScript("help me set up a pytorch training pipeline");
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/ML \/ AI engineering/);
    });
  });

  describe("against a synthetic templates dir (mechanism check)", () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-skill-coverage-"));
      fs.mkdirSync(path.join(tmpRoot, "templates", "specialists"), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("nudges for frontend keywords when frontend.md is ABSENT from the templates dir", () => {
      const { exitCode, stdout } = runScript("can you build this vue component", {
        GUILD_PLUGIN_ROOT: tmpRoot,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/frontend \/ UI engineering/);
    });

    it("does NOT nudge for frontend keywords once frontend.md is added", () => {
      fs.writeFileSync(
        path.join(tmpRoot, "templates", "specialists", "frontend.md"),
        "# frontend specialist template\n",
        "utf8",
      );
      const { exitCode, stdout } = runScript("can you build this vue component", {
        GUILD_PLUGIN_ROOT: tmpRoot,
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });
  });
});
