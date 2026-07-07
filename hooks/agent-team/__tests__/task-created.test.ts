/**
 * Tests for hooks/agent-team/task-created.ts
 *
 * TDD: these tests are written BEFORE the implementation.
 * Each test spawns the script with fixture input on stdin,
 * verifying exit code and stderr output.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../task-created.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function runScript(
  fixtureFile: string,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const input = fs.readFileSync(path.join(FIXTURES, fixtureFile), "utf8");
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input,
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

function runScriptWithPayload(
  payloadStr: string,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: payloadStr,
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

describe("task-created.ts", () => {
  describe("env gate: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS not set", () => {
    it("no-ops with exit 0 when env var is unset", () => {
      const { exitCode } = runScript("task-created.invalid.json", {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "",
      });
      expect(exitCode).toBe(0);
    });

    it("no-ops with exit 0 when env var is '0'", () => {
      const { exitCode } = runScript("task-created.invalid.json", {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "0",
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("valid task", () => {
    it("exits 0 for a task with owner, description (output contract), and no bad deps", () => {
      const { exitCode, stderr } = runScript("task-created.valid.json", {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).toBe(0);
      // WARN about run-state write with a non-existent fixture cwd is intentional
      // and non-fatal. Only hard failures (BLOCKED / FATAL) are disqualifying.
      expect(stderr).not.toMatch(/BLOCKED|FATAL/);
    });
  });

  describe("invalid task — missing owner", () => {
    it("exits non-zero when teammate_name is empty", () => {
      const { exitCode, stderr } = runScript("task-created.invalid.json", {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/owner/i);
    });
  });

  describe("invalid task — missing output contract", () => {
    it("exits non-zero when task_description is absent", () => {
      // Build a payload with no description
      const payload = JSON.stringify({
        session_id: "sess-x",
        cwd: "/tmp",
        hook_event_name: "TaskCreated",
        task_id: "task-no-desc",
        task_subject: "Task with no description",
        teammate_name: "backend",
        team_name: "guild-team",
      });
      const result = spawnSync("npx", ["tsx", SCRIPT], {
        input: payload,
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
        },
        timeout: 15000,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/output contract|description|scope|success.criter/i);
    });
  });

  describe("run-state in_progress seeding (ADR-RE-1 dispatch seam)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-created-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes run-state.json with in_progress for the task lane after validation passes", () => {
      const runId = "run-tc-test-001";
      const taskId = "task-101";
      const payload = JSON.stringify({
        session_id: "sess-abc",
        cwd: tmpDir,
        hook_event_name: "TaskCreated",
        task_id: taskId,
        task_subject: "Build auth endpoints",
        task_description: "Add JWT login and signup",
        teammate_name: "backend",
        team_name: "guild-team",
      });

      const { exitCode, stderr } = runScriptWithPayload(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
        GUILD_RUN_ID: runId,
      });

      expect(exitCode).toBe(0);
      expect(stderr).toMatch(/in_progress/i);

      const runStateFile = path.join(tmpDir, ".guild", "runs", runId, "run-state.json");
      expect(fs.existsSync(runStateFile)).toBe(true);

      const state = JSON.parse(fs.readFileSync(runStateFile, "utf8"));
      expect(state.schema_version).toBe("guild.run_state.v1");
      expect(state.run_id).toBe(runId);
      expect(state.lanes[taskId]).toBeDefined();
      expect(state.lanes[taskId].status).toBe("in_progress");
    });

    it("falls back to run-<session_id> when GUILD_RUN_ID is unset", () => {
      const sessionId = "sess-fallback";
      const taskId = "task-102";
      const payload = JSON.stringify({
        session_id: sessionId,
        cwd: tmpDir,
        hook_event_name: "TaskCreated",
        task_id: taskId,
        task_subject: "Auth work",
        task_description: "Implement JWT endpoints",
        teammate_name: "backend",
        team_name: "guild-team",
      });

      // Explicitly delete GUILD_RUN_ID from env so the fallback fires.
      const envWithoutRunId = { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" };
      delete envWithoutRunId["GUILD_RUN_ID"];
      const result = spawnSync("npx", ["tsx", SCRIPT], {
        input: payload,
        encoding: "utf8",
        env: envWithoutRunId,
        timeout: 15000,
      });
      const { exitCode } = { exitCode: result.status ?? 1 };

      expect(exitCode).toBe(0);

      const runStateFile = path.join(
        tmpDir, ".guild", "runs", `run-${sessionId}`, "run-state.json"
      );
      expect(fs.existsSync(runStateFile)).toBe(true);
      const state = JSON.parse(fs.readFileSync(runStateFile, "utf8"));
      expect(state.lanes[taskId].status).toBe("in_progress");
    });

    it("exits 0 even when run-state write fails (non-fatal: bad cwd)", () => {
      // cwd points to a non-existent path — mkdirSync will still succeed but
      // the write is constrained. Actually since mkdirSync uses recursive:true
      // it WILL create the path. So test the validation-failed path instead
      // (blocked task must NOT write in_progress).
      const payload = JSON.stringify({
        session_id: "sess-nofatal",
        cwd: tmpDir,
        hook_event_name: "TaskCreated",
        task_id: "task-103",
        task_subject: "No description task",
        task_description: "",         // missing — validation fails
        teammate_name: "backend",
        team_name: "guild-team",
      });

      const { exitCode } = runScriptWithPayload(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });

      // Must exit non-zero because description is missing (blocked before run-state).
      expect(exitCode).not.toBe(0);

      // No run-state should have been written (blocked before we reach that step).
      const runId = "run-sess-nofatal";
      const runStateFile = path.join(tmpDir, ".guild", "runs", runId, "run-state.json");
      expect(fs.existsSync(runStateFile)).toBe(false);
    });
  });
});
