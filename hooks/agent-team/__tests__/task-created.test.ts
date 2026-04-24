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
      expect(stderr).not.toMatch(/error|block|fail/i);
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
});
