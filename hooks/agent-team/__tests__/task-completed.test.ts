/**
 * Tests for hooks/agent-team/task-completed.ts
 *
 * TDD: these tests are written BEFORE the implementation.
 * Sets up a mock .guild/runs/ directory with / without handoff receipts.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../task-completed.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function runScript(
  payloadOverride: object,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const input = JSON.stringify(payloadOverride);
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

function createReceipt(
  runDir: string,
  specialist: string,
  taskId: string,
  fields: Record<string, string>
): string {
  const handoffsDir = path.join(runDir, "handoffs");
  fs.mkdirSync(handoffsDir, { recursive: true });
  const lines = Object.entries(fields)
    .map(([k, v]) => `## ${k}\n${v}`)
    .join("\n\n");
  const content = `# Handoff Receipt\n\n${lines}\n`;
  const filePath = path.join(handoffsDir, `${specialist}-${taskId}.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

const FULL_RECEIPT_FIELDS = {
  changed_files: "- hooks/agent-team/task-created.ts",
  opens_for: "- none",
  assumptions: "- Used npx tsx for TS execution",
  evidence: "- exit code 0 on valid fixture",
  followups: "- none",
};

describe("task-completed.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("env gate", () => {
    it("no-ops with exit 0 when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is unset", () => {
      const { exitCode } = runScript(
        { hook_event_name: "TaskCompleted", task_id: "task-999", teammate_name: "backend" },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "" }
      );
      expect(exitCode).toBe(0);
    });
  });

  describe("valid completion — receipt with all required fields", () => {
    it("exits 0 when handoff receipt has all 5 required fields", () => {
      const runId = "run-sess-abc123";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "backend", "task-001", FULL_RECEIPT_FIELDS);

      const payload = {
        session_id: "sess-abc123",
        cwd: tmpDir,
        hook_event_name: "TaskCompleted",
        task_id: "task-001",
        task_subject: "Implement auth endpoints",
        teammate_name: "backend",
        team_name: "guild-team",
      };
      const { exitCode } = runScript(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("invalid completion — missing receipt", () => {
    it("exits non-zero when no receipt file exists", () => {
      const payload = {
        session_id: "sess-abc123",
        cwd: tmpDir,
        hook_event_name: "TaskCompleted",
        task_id: "task-001",
        task_subject: "Task without receipt",
        teammate_name: "backend",
        team_name: "guild-team",
      };
      const { exitCode, stderr } = runScript(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/receipt|handoff/i);
    });
  });

  describe("invalid completion — receipt missing required fields", () => {
    it("exits non-zero and names the missing field when a required field is absent", () => {
      const runId = "run-sess-abc123";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      // Omit 'evidence' and 'followups'
      const incompleteFields = {
        changed_files: "- hooks/agent-team/task-created.ts",
        opens_for: "- none",
        assumptions: "- Used npx tsx",
      };
      createReceipt(runDir, "backend", "task-001", incompleteFields);

      const payload = {
        session_id: "sess-abc123",
        cwd: tmpDir,
        hook_event_name: "TaskCompleted",
        task_id: "task-001",
        task_subject: "Partial receipt task",
        teammate_name: "backend",
        team_name: "guild-team",
      };
      const { exitCode, stderr } = runScript(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/evidence|followups/i);
    });
  });
});
