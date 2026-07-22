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
  extraPayload: Record<string, unknown> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const sessionId = `test-${crypto.randomUUID()}`;
  const payload = JSON.stringify({ prompt, session_id: sessionId, ...extraPayload });
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

  /**
   * Issue #59 (oir-wi-59): this hook is no longer only an advisory nudge — it
   * is also the UserPromptSubmit entry for the ACTIVE lifecycle gate, which it
   * delegates to `hooks/dist/lifecycle-gate.js`. These tests pin the SHELL
   * wiring (delegation happens, the block envelope is the only stdout, the
   * nudge is short-circuited, absence degrades to silence). The gate's own
   * detection logic is covered in `hooks/lib/__tests__/lifecycle-gate.test.ts`.
   */
  describe("lifecycle-gate delegation (issue #59)", () => {
    let workRoot: string;
    let runDir: string;
    const RUN_ID = "run-sh-59";

    /** A real active build run with enough lead-own ad-hoc drift to trip the gate. */
    function seedDriftingRun(): void {
      runDir = path.join(workRoot, ".guild", "runs", RUN_ID);
      fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
      fs.writeFileSync(path.join(workRoot, ".guild", "runs", "current-run-id"), RUN_ID);
      fs.writeFileSync(
        path.join(workRoot, ".guild", "settings.json"),
        JSON.stringify({ defaults: { lifecycle_gate: { adhoc_activity_threshold: 3 } } }),
      );
      fs.writeFileSync(
        path.join(runDir, "run.yaml"),
        [
          "schema_version: guild.run.v1",
          `run_id: ${RUN_ID}`,
          "initiative_attachment: null",
          "phase: build",
          "gates: {}",
          "status: open",
          "phases_log: []",
          "",
        ].join("\n"),
      );
      // Real v1.4 trace lines, written in the on-disk format post-tool-use.ts emits.
      // Timestamps must be RECENT: the gate only blocks on CURRENT drift
      // (hooks/lib/lifecycle-gate.ts isDriftCurrent), so a fixed historical
      // epoch would make this fixture look like an abandoned run.
      const base = Date.now() - 60_000;
      const lines: string[] = [];
      for (let i = 0; i < 5; i++) {
        lines.push(
          JSON.stringify({
            ts: new Date(base + i * 1000).toISOString(),
            event: "tool_call",
            run_id: RUN_ID,
            tool: i < 2 ? "Edit" : "Bash",
            command_redacted: "redacted",
            status: "ok",
            latency_ms: 5,
            result_excerpt_redacted: "",
          }),
        );
      }
      fs.writeFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), lines.join("\n") + "\n");
    }

    beforeEach(() => {
      workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-lifecycle-gate-sh-"));
      fs.mkdirSync(path.join(workRoot, ".guild", "runs"), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(workRoot, { recursive: true, force: true });
    });

    it("emits the block envelope as its ONLY stdout, short-circuiting the nudge", () => {
      seedDriftingRun();
      // The prompt also matches the uncovered-ML-domain nudge — the gate must win
      // outright, because mixing plain text into the JSON would corrupt it.
      const { exitCode, stdout } = runScript("keep editing the pytorch training pipeline", {
        GUILD_CWD: workRoot,
      });
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { decision: string; reason: string };
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("[GUILD LIFECYCLE GATE]");
      expect(parsed.reason).toContain("guild:resume");
      expect(stdout).not.toMatch(/ML \/ AI engineering/);
    });

    it("stays silent (and lets the nudge through) when no run is active", () => {
      const { exitCode, stdout } = runScript("help me set up a pytorch training pipeline", {
        GUILD_CWD: workRoot,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/ML \/ AI engineering/);
    });

    it("honors the in-prompt override token", () => {
      seedDriftingRun();
      const { exitCode, stdout } = runScript("keep going [guild:gate-override]", {
        GUILD_CWD: workRoot,
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });

    it("honors the session-wide env override", () => {
      seedDriftingRun();
      const { exitCode, stdout } = runScript("keep going", {
        GUILD_CWD: workRoot,
        GUILD_LIFECYCLE_GATE_OVERRIDE: "1",
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });

    it("fires once per crossing, then hands the correction to the MODEL", () => {
      seedDriftingRun();
      const first = runScript("keep going", { GUILD_CWD: workRoot });
      expect(JSON.parse(first.stdout).decision).toBe("block");

      // The block reached the USER only. The next prompt is ACCEPTED (never
      // dead-ends) and carries the same body to the model as additionalContext
      // — the delivery a bare block cannot do.
      const second = runScript("keep going", { GUILD_CWD: workRoot });
      expect(second.exitCode).toBe(0);
      const parsed = JSON.parse(second.stdout) as {
        hookSpecificOutput: { hookEventName: string; additionalContext: string };
      };
      expect(parsed.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
      expect(parsed.hookSpecificOutput.additionalContext).toContain("[GUILD LIFECYCLE GATE]");

      // Delivered exactly once — the third prompt is fully silent.
      const third = runScript("keep going", { GUILD_CWD: workRoot });
      expect(third.exitCode).toBe(0);
      expect(third.stdout.trim()).toBe("");
    });

    it("ignores malformed gate output instead of forwarding it as a decision", () => {
      // A stub bundle that prints a crash message + concatenated JSON. A prefix
      // test would forward this as a hook decision AND suppress the nudge.
      const stubRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-stub-gate-"));
      fs.mkdirSync(path.join(stubRoot, "hooks", "dist"), { recursive: true });
      fs.mkdirSync(path.join(stubRoot, "templates", "specialists"), { recursive: true });
      fs.writeFileSync(
        path.join(stubRoot, "hooks", "dist", "lifecycle-gate.js"),
        'process.stdout.write(\'{"decision":"block","reason":"a"}{"decision":"block"}\');\n',
      );
      try {
        const { exitCode, stdout, stderr } = runScript(
          "help me set up a pytorch training pipeline",
          { GUILD_CWD: workRoot, GUILD_PLUGIN_ROOT: stubRoot },
        );
        expect(exitCode).toBe(0);
        expect(stdout).not.toContain('"decision"');
        expect(stderr).toContain("ignoring unrecognized lifecycle-gate output");
        // ...and the ordinary nudge still gets its turn.
        expect(stdout).toMatch(/ML \/ AI engineering/);
      } finally {
        fs.rmSync(stubRoot, { recursive: true, force: true });
      }
    });

    it("degrades to silence when the gate bundle is absent (source-only checkout)", () => {
      seedDriftingRun();
      // A plugin root with no dist/ — the shell must skip the gate, not error.
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), "guild-bare-root-"));
      fs.mkdirSync(path.join(bare, "templates", "specialists"), { recursive: true });
      try {
        const { exitCode, stdout } = runScript("keep going", {
          GUILD_CWD: workRoot,
          GUILD_PLUGIN_ROOT: bare,
        });
        expect(exitCode).toBe(0);
        expect(stdout.trim()).toBe("");
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });
  });
});
