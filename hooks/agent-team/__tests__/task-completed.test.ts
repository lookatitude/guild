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
 *   - OD-4 discriminator (AC-3): in-scope receipt (post-effective-date run.yaml)
 *     with no envelope → fail-closed (exit non-zero)
 *   - OD-4 discriminator (AC-3): in-scope receipt WITH valid envelope → done (exit 0)
 *   - OD-4 discriminator (AC-3): grandfathered (pre-effective-date) receipt with
 *     no envelope → lenient, still exit 0
 *   - OD-4 discriminator (AC-3): malformed/undeterminable run date → fail-open
 *     (lenient + logged)
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

  // ── OD-4 discriminator tests (AC-3) ──────────────────────────────────────
  //
  // Policy effective date: 2026-06-03 (communication-format-policy.md §policy_effective_date)
  // In-scope: run.yaml.started_at >= 2026-06-03 → fail-closed on missing envelope
  // Grandfathered: run.yaml.started_at < 2026-06-03 → lenient (envelope optional)
  // Undeterminable date (no run.yaml / bad value): fail-open lenient + log warning

  /**
   * Write a minimal run.yaml with started_at set to the given ISO date string.
   * Mirrors the real guild.run.v1 schema (started_at is a top-level YAML scalar).
   */
  function writeRunYaml(runDir: string, startedAt: string): void {
    fs.mkdirSync(runDir, { recursive: true });
    const content = [
      `schema_version: guild.run.v1`,
      `run_id: ${path.basename(runDir)}`,
      `command: /guild:build`,
      `started_at: ${startedAt}`,
      `status: open`,
    ].join("\n") + "\n";
    fs.writeFileSync(path.join(runDir, "run.yaml"), content);
  }

  describe("OD-4 discriminator — in-scope receipt (post-effective-date), no v2 envelope → fail-closed", () => {
    // AC-3 case 1: in-scope receipt with NO valid embedded v2 block → INVALID (exit non-zero)
    it("exits non-zero when run is post-effective-date and receipt has no guild.handoff.v2 envelope", () => {
      const runId = "run-scope-postdate";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      // started_at on the effective date itself (2026-06-03) → in-scope
      writeRunYaml(runDir, "2026-06-03T00:00:00Z");
      createReceipt(runDir, "backend", "task-scope-001", FULL_RECEIPT_FIELDS); // no envelope

      const { exitCode, stderr } = runScript(
        {
          session_id: "scope-postdate",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-scope-001",
          task_subject: "In-scope task",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId }
      );
      expect(exitCode).not.toBe(0);
      // Must mention both: the missing envelope AND the in-scope enforcement
      expect(stderr).toMatch(/missing.*guild\.handoff\.v2.*envelope|guild\.handoff\.v2.*envelope.*missing/i);
      expect(stderr).toMatch(/in-scope for enforcement|in-scope.*enforcement/i);
    });

    it("exits non-zero when run started_at is after effective date and receipt has no envelope", () => {
      const runId = "run-scope-future";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      writeRunYaml(runDir, "2026-07-01T10:00:00Z"); // clearly after 2026-06-03
      createReceipt(runDir, "backend", "task-scope-002", FULL_RECEIPT_FIELDS); // no envelope

      const { exitCode, stderr } = runScript(
        {
          session_id: "scope-future",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-scope-002",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId }
      );
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/in-scope|fail-closed/i);
    });
  });

  describe("OD-4 discriminator — in-scope receipt WITH valid v2 envelope → done (exit 0)", () => {
    // AC-3 case 2: in-scope receipt WITH a valid embedded v2 block → accepted (exit 0)
    it("exits 0 when run is post-effective-date and receipt has a valid guild.handoff.v2 envelope", () => {
      const runId = "run-scope-valid";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      writeRunYaml(runDir, "2026-06-03T00:00:00Z");
      const envelope = { ...VALID_ENVELOPE, task_id: "task-scope-valid" };
      createReceipt(runDir, "backend", "task-scope-valid", FULL_RECEIPT_FIELDS, envelope);

      const { exitCode, stderr } = runScript(
        {
          session_id: "scope-valid",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-scope-valid",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId }
      );
      expect(exitCode).toBe(0);
      expect(stderr).toMatch(/envelope validated/i);
    });
  });

  describe("OD-4 discriminator — grandfathered (pre-effective-date) receipt, no envelope → lenient (exit 0)", () => {
    // AC-3 case 3: pre-effective-date run → envelope is optional; still exits 0
    it("exits 0 when run is pre-effective-date and receipt has no guild.handoff.v2 envelope", () => {
      const runId = "run-legacy-predate";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      writeRunYaml(runDir, "2026-06-02T23:59:59Z"); // one second before effective date
      createReceipt(runDir, "backend", "task-legacy-001", FULL_RECEIPT_FIELDS); // no envelope

      const { exitCode, stderr } = runScript(
        {
          session_id: "legacy-predate",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-legacy-001",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId }
      );
      expect(exitCode).toBe(0);
      expect(stderr).toMatch(/grandfathered|legacy|optional/i);
    });
  });

  describe("OD-4 discriminator — undeterminable run date → fail-open lenient + logged", () => {
    // AC-3 case 4: missing run.yaml → fail-open (lenient, exit 0) + logs warning
    it("exits 0 (fail-open lenient) when run.yaml is absent (cannot determine run date)", () => {
      const runId = "run-no-yaml";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      // Do NOT write run.yaml — run dir exists but no manifest
      fs.mkdirSync(runDir, { recursive: true });
      createReceipt(runDir, "backend", "task-nodate-001", FULL_RECEIPT_FIELDS); // no envelope

      const { exitCode, stderr } = runScript(
        {
          session_id: "no-yaml",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-nodate-001",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId }
      );
      expect(exitCode).toBe(0);
      // Must log a warning about indeterminate date
      expect(stderr).toMatch(/indeterminate|undetermined|cannot.*date|fail.open|unknown.*date/i);
    });

    it("exits 0 (fail-open lenient) when run.yaml has a malformed started_at value", () => {
      const runId = "run-bad-date";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      // Write run.yaml with an unparseable date
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "run.yaml"),
        "schema_version: guild.run.v1\nrun_id: run-bad-date\nstarted_at: not-a-date\n"
      );
      createReceipt(runDir, "backend", "task-baddate-001", FULL_RECEIPT_FIELDS); // no envelope

      const { exitCode, stderr } = runScript(
        {
          session_id: "bad-date",
          cwd: tmpDir,
          hook_event_name: "TaskCompleted",
          task_id: "task-baddate-001",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId }
      );
      expect(exitCode).toBe(0);
      expect(stderr).toMatch(/indeterminate|undetermined|cannot.*date|fail.open|unknown.*date/i);
    });
  });
});
