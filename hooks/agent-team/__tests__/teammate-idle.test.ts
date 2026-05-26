/**
 * Tests for hooks/agent-team/teammate-idle.ts
 *
 * TDD: these tests are written BEFORE the implementation.
 * teammate-idle always exits 0 but emits nudge messages to stdout.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../teammate-idle.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function runScript(
  payload: object,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("teammate-idle.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-idle-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("env gate", () => {
    it("always exits 0 even when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is unset", () => {
      const { exitCode } = runScript(
        { hook_event_name: "TeammateIdle", teammate_name: "backend", team_name: "guild" },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "" }
      );
      expect(exitCode).toBe(0);
    });
  });

  describe("always exits 0 — no exit-code gating", () => {
    it("exits 0 on valid payload with agent teams enabled", () => {
      const { exitCode } = runScript(
        {
          session_id: "sess-abc123",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0);
    });

    it("exits 0 on the 'invalid' fixture (empty teammate_name)", () => {
      const invalidPayload = JSON.parse(
        fs.readFileSync(path.join(FIXTURES, "teammate-idle.invalid.json"), "utf8")
      );
      invalidPayload.cwd = tmpDir;
      const { exitCode } = runScript(invalidPayload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("nudge message emitted to stdout", () => {
    it("emits a nudge to stdout when teammate is idle with no receipt and no plan", () => {
      const { stdout } = runScript(
        {
          session_id: "sess-abc123",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      // Nudge should mention the teammate name
      expect(stdout).toMatch(/backend/i);
    });

    it("nudge message includes actionable guidance", () => {
      const { stdout } = runScript(
        {
          session_id: "sess-abc123",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "architect",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      // Should guide the teammate to write a receipt or check plan
      expect(stdout).toMatch(/handoff|receipt|task|complete/i);
    });
  });

  describe("structured heartbeat liveness (ADR-RE-3)", () => {
    function writeHeartbeat(runId: string, teammate: string, record: object): void {
      const hbDir = path.join(tmpDir, ".guild", "runs", runId, "in-progress");
      fs.mkdirSync(hbDir, { recursive: true });
      fs.writeFileSync(path.join(hbDir, `${teammate}.json`), JSON.stringify(record));
    }

    function writeLegacyLog(runId: string, teammate: string, mtimeMs: number): void {
      const dir = path.join(tmpDir, ".guild", "runs", runId, "in-progress");
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, `${teammate}.log`);
      fs.writeFileSync(p, "working...\n");
      const t = mtimeMs / 1000;
      fs.utimesSync(p, t, t);
    }

    it("reports a FRESH heartbeat with the phase in the nudge", () => {
      writeHeartbeat("run-sess-hb", "backend", {
        timestamp: new Date().toISOString(),
        step: "implementing-run-state",
        pct_complete: 60,
      });
      const { stdout, stderr } = runScript(
        {
          session_id: "sess-hb",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(stdout).toMatch(/heartbeat FRESH/i);
      expect(stdout).toMatch(/implementing-run-state/);
      expect(stderr).toMatch(/liveness=heartbeat\/fresh/i);
    });

    it("flags a STALE heartbeat older than the timeout", () => {
      const twentyMinAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      writeHeartbeat("run-sess-stale", "backend", { timestamp: twentyMinAgo, step: "stuck" });
      const { stdout } = runScript(
        {
          session_id: "sess-stale",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(stdout).toMatch(/heartbeat STALE/i);
    });

    it("falls back to the legacy .log mtime when no JSON heartbeat exists", () => {
      writeLegacyLog("run-sess-legacy", "backend", Date.now() - 60 * 1000);
      const { stdout, stderr } = runScript(
        {
          session_id: "sess-legacy",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(stdout).toMatch(/legacy log mtime/i);
      expect(stderr).toMatch(/liveness=mtime/i);
    });

    it("honors defaults.heartbeat_timeout_ms from settings.json (short timeout → stale)", () => {
      const guildDir = path.join(tmpDir, ".guild");
      fs.mkdirSync(guildDir, { recursive: true });
      fs.writeFileSync(
        path.join(guildDir, "settings.json"),
        JSON.stringify({ defaults: { heartbeat_timeout_ms: 1000 } })
      );
      // 5s-old heartbeat is stale under a 1s timeout.
      writeHeartbeat("run-sess-cfg", "backend", {
        timestamp: new Date(Date.now() - 5000).toISOString(),
      });
      const { stdout } = runScript(
        {
          session_id: "sess-cfg",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(stdout).toMatch(/heartbeat STALE/i);
    });

    it("reports 'no heartbeat' when neither signal is present", () => {
      const { stdout } = runScript(
        {
          session_id: "sess-none",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(stdout).toMatch(/no heartbeat/i);
    });
  });
});
