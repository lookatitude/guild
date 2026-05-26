/**
 * Tests for hooks/agent-team/task-completed.ts
 *
 * Covers:
 *   - env gate (no-op when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS unset)
 *   - valid markdown receipt with all §8.2 required fields (no envelope)
 *   - missing receipt → blocked
 *   - receipt missing required §8.2 fields → blocked
 *   - valid guild.handoff.v2 envelope in receipt → accepted, learnings persisted
 *   - invalid guild.handoff.v2 envelope (bloat / schema error) → blocked (SC-7)
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../task-completed.ts");

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
  fields: Record<string, string>,
  envelope?: object
): string {
  const handoffsDir = path.join(runDir, "handoffs");
  fs.mkdirSync(handoffsDir, { recursive: true });
  const lines = Object.entries(fields)
    .map(([k, v]) => `## ${k}\n${v}`)
    .join("\n\n");
  let content = `# Handoff Receipt\n\n${lines}\n`;
  if (envelope) {
    content += `\n\`\`\`guild.handoff.v2\n${JSON.stringify(envelope, null, 2)}\n\`\`\`\n`;
  }
  const filePath = path.join(handoffsDir, `${specialist}-${taskId}.md`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

const FULL_RECEIPT_FIELDS = {
  changed_files: "- hooks/agent-team/task-completed.ts",
  opens_for: "- none",
  assumptions: "- Used npx tsx for TS execution",
  evidence: "- exit code 0 on valid fixture",
  followups: "- none",
};

const VALID_ENVELOPE = {
  schema_version: "guild.handoff.v2",
  task_id: "task-001",
  tier: "mid",
  status: "done",
  summary: "Implemented the auth endpoints and tests.",
  artifacts: ["src/auth.ts:1-80"],
  issues: [],
  learnings: ["Prefer typed returns over prose blobs"],
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

    it("no-ops with exit 0 when CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS is 0", () => {
      const { exitCode } = runScript(
        { hook_event_name: "TaskCompleted", task_id: "task-999", teammate_name: "backend" },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "0" }
      );
      expect(exitCode).toBe(0);
    });
  });

  describe("valid completion — receipt with all required fields (no envelope)", () => {
    it("exits 0 when handoff receipt has all 5 required fields and no envelope", () => {
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
      const { exitCode, stderr } = runScript(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).toBe(0);
      expect(stderr).toMatch(/dismissed/i);
    });
  });

  describe("valid completion — receipt with valid guild.handoff.v2 envelope", () => {
    it("exits 0 and persists learnings when envelope is valid", () => {
      const runId = "run-sess-abc123";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "backend", "task-001", FULL_RECEIPT_FIELDS, VALID_ENVELOPE);

      const payload = {
        session_id: "sess-abc123",
        cwd: tmpDir,
        hook_event_name: "TaskCompleted",
        task_id: "task-001",
        task_subject: "Implement auth endpoints",
        teammate_name: "backend",
        team_name: "guild-team",
      };
      const { exitCode, stderr } = runScript(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).toBe(0);
      expect(stderr).toMatch(/envelope validated/i);
      expect(stderr).toMatch(/learnings persisted/i);

      // Verify the learnings file was written
      const lPath = path.join(
        tmpDir,
        ".guild",
        "runs",
        runId,
        "learnings",
        "backend-task-001.json"
      );
      expect(fs.existsSync(lPath)).toBe(true);
      const record = JSON.parse(fs.readFileSync(lPath, "utf8"));
      expect(record.learnings).toEqual(VALID_ENVELOPE.learnings);
      expect(record.task_id).toBe("task-001");
      expect(record.tier).toBe("mid");
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

  describe("invalid completion — receipt missing required §8.2 fields", () => {
    it("exits non-zero and names the missing field when a required field is absent", () => {
      const runId = "run-sess-abc123";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      // Omit 'evidence' and 'followups'
      const incompleteFields = {
        changed_files: "- hooks/agent-team/task-completed.ts",
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

  describe("invalid completion — invalid guild.handoff.v2 envelope (SC-7 bloat rejection)", () => {
    it("exits non-zero when envelope has wrong schema_version", () => {
      const runId = "run-sess-abc123";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "backend", "task-001", FULL_RECEIPT_FIELDS, {
        ...VALID_ENVELOPE,
        schema_version: "guild.handoff.v1",
      });

      const payload = {
        session_id: "sess-abc123",
        cwd: tmpDir,
        hook_event_name: "TaskCompleted",
        task_id: "task-001",
        teammate_name: "backend",
        team_name: "guild-team",
      };
      const { exitCode, stderr } = runScript(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/invalid guild\.handoff\.v2/i);
    });

    it("exits non-zero when summary exceeds cap (bloat rejection SC-7)", () => {
      const runId = "run-sess-abc123";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "backend", "task-001", FULL_RECEIPT_FIELDS, {
        ...VALID_ENVELOPE,
        summary: "x".repeat(700), // > 600 char cap
      });

      const payload = {
        session_id: "sess-abc123",
        cwd: tmpDir,
        hook_event_name: "TaskCompleted",
        task_id: "task-001",
        teammate_name: "backend",
        team_name: "guild-team",
      };
      const { exitCode, stderr } = runScript(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/SC-7|bloat|cap/i);
    });

    it("exits non-zero when notes exceeds 200-char cap (O-4)", () => {
      const runId = "run-sess-abc123";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "backend", "task-001", FULL_RECEIPT_FIELDS, {
        ...VALID_ENVELOPE,
        notes: "x".repeat(201),
      });

      const payload = {
        session_id: "sess-abc123",
        cwd: tmpDir,
        hook_event_name: "TaskCompleted",
        task_id: "task-001",
        teammate_name: "backend",
        team_name: "guild-team",
      };
      const { exitCode, stderr } = runScript(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/notes.*cap|cap.*notes/i);
    });

    it("exits non-zero when status=escalate but escalate_reason is missing", () => {
      const runId = "run-sess-abc123";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "backend", "task-001", FULL_RECEIPT_FIELDS, {
        ...VALID_ENVELOPE,
        status: "escalate",
        // escalate_reason intentionally omitted
      });

      const payload = {
        session_id: "sess-abc123",
        cwd: tmpDir,
        hook_event_name: "TaskCompleted",
        task_id: "task-001",
        teammate_name: "backend",
        team_name: "guild-team",
      };
      const { exitCode, stderr } = runScript(payload, {
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/escalate_reason/i);
    });
  });

  describe("run-state checkpoint (ADR-RE-1)", () => {
    function runStateFor(runId: string): string {
      return path.join(tmpDir, ".guild", "runs", runId, "run-state.json");
    }

    it("writes run-state.json marking the lane done after a clean envelope completion", () => {
      const runId = "run-sess-abc123";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "backend", "task-001", FULL_RECEIPT_FIELDS, VALID_ENVELOPE);

      const { exitCode, stderr } = runScript(
        {
          session_id: "sess-abc123",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-001",
          task_subject: "Implement auth endpoints",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0);
      expect(stderr).toMatch(/run-state checkpoint updated/i);

      const statePath = runStateFor(runId);
      expect(fs.existsSync(statePath)).toBe(true);
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      expect(state.schema_version).toBe("guild.run_state.v1");
      expect(state.run_id).toBe(runId);
      expect(state.lanes["task-001"].status).toBe("done");
      expect(state.lanes["task-001"].tier).toBe("mid");
      expect(state.lanes["task-001"].receipt_ref).toBe("handoffs/backend-task-001.md");
    });

    it("marks the lane done for a legacy receipt with no envelope", () => {
      const runId = "run-sess-legacy";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "qa", "task-002", FULL_RECEIPT_FIELDS);

      const { exitCode } = runScript(
        {
          session_id: "sess-legacy",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-002",
          teammate_name: "qa",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0);

      const state = JSON.parse(fs.readFileSync(runStateFor(runId), "utf8"));
      expect(state.lanes["task-002"].status).toBe("done");
      expect(state.lanes["task-002"].receipt_ref).toBe("handoffs/qa-task-002.md");
    });

    it("records lane status 'failed' when the envelope status is blocked", () => {
      const runId = "run-sess-blocked";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "backend", "task-003", FULL_RECEIPT_FIELDS, {
        ...VALID_ENVELOPE,
        status: "blocked",
      });

      const { exitCode } = runScript(
        {
          session_id: "sess-blocked",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-003",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0);

      const state = JSON.parse(fs.readFileSync(runStateFor(runId), "utf8"));
      expect(state.lanes["task-003"].status).toBe("failed");
    });

    it("captures inlined depends-on references into the lane", () => {
      const runId = "run-sess-deps";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      createReceipt(runDir, "backend", "task-004", FULL_RECEIPT_FIELDS, VALID_ENVELOPE);

      const { exitCode } = runScript(
        {
          session_id: "sess-deps",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-004",
          task_subject: "Build endpoints",
          task_description: "Implements the API. depends-on: task-000",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0);

      const state = JSON.parse(fs.readFileSync(runStateFor(runId), "utf8"));
      expect(state.lanes["task-004"].depends_on).toContain("task-000");
    });

    it("does NOT write run-state when the completion is blocked (missing receipt)", () => {
      const runId = "run-sess-noreceipt";
      const { exitCode } = runScript(
        {
          session_id: "sess-noreceipt",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-005",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).not.toBe(0);
      expect(fs.existsSync(runStateFor(runId))).toBe(false);
    });
  });
});
