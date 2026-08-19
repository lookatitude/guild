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
import {
  buildTaskCell,
  writeTaskCell,
  type TaskCellDispatchInput,
} from "../../../src/modules/dispatch/workflows/task-assignment-v2";
import {
  buildAcceptance,
  runDeterministicFloor,
  writeAcceptanceRecord,
} from "../../../src/modules/dispatch/workflows/task-cell-acceptance";

const SCRIPT = path.resolve(__dirname, "../teammate-idle.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

const SEED_NOW = () => "2026-07-15T00:00:00.000Z";

/**
 * task-cell-runtime G4: seed a durable `guild.handoff_acceptance.v1` (+ sibling
 * assignment binding worker_role) so the acceptance gate resolves this teammate as
 * safe-to-dismiss. Empty scope/tests → the deterministic floor passes vacuously.
 */
function seedAcceptance(cwd: string, runId: string, logicalTaskId: string, workerRole: string): void {
  const disp: TaskCellDispatchInput = {
    runId,
    logicalTaskId,
    taskRunId: `${logicalTaskId}.tr1`,
    attempt: 1,
    attemptId: `${logicalTaskId}.att1`,
    instanceId: `${logicalTaskId}.a1.i1`,
    cellId: `cell-${logicalTaskId}`,
    goalId: "goal",
    phaseId: "build",
    stepId: logicalTaskId,
    teamId: "guild",
    workerRole,
    specialistTypeId: workerRole,
    specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type",
    specialistProfileId: workerRole,
    specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${runId}/${workerRole}.md`,
    contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli",
    adapterId: "claude-code-cli@1",
    hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux",
    modelTier: "mid",
    objective: `implement ${logicalTaskId}`,
    nonGoals: [],
    scopePaths: [],
    outputSchema: "guild.handoff_receipt.v1",
    acceptanceTests: [],
    dependencies: [],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    deadline: null,
    leadBindingId: "lead-binding",
    now: SEED_NOW,
  };
  const cell = buildTaskCell(disp);
  // T3 F3: descriptor writers fail closed without the run's minted binding.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rb = require("../../../src/modules/lifecycle/workflows/run-binding") as
    typeof import("../../../src/modules/lifecycle/workflows/run-binding");
  const existing = rb.loadRunBinding({ root: cwd, run_id: cell.assignment.run_id });
  const bindingRef =
    (existing ?? rb.mintRunBinding({ root: cwd, run_id: cell.assignment.run_id })).binding_ref;
  writeTaskCell(cwd, cell, { binding_ref: bindingRef });
  const validation = runDeterministicFloor({
    assignment: cell.assignment,
    submitted: {
      receipt_id: "r1",
      receipt_path: "handoffs/x.md",
      schema_valid: true,
      claimed_changed_files: [],
      acceptance_tests_passed: [],
      submitted_at: SEED_NOW(),
    },
    validationResultId: "val-1",
    now: SEED_NOW,
  });
  writeAcceptanceRecord(
    cwd,
    buildAcceptance({
      validation,
      acceptancePolicyVersion: "1.0.0",
      authoritiesRequired: ["deterministic_floor", "team_lead"],
      authoritiesObserved: [
        { authority: "deterministic_floor", decision: "accepted", at: SEED_NOW(), reason: null },
        { authority: "team_lead", decision: "accepted", at: SEED_NOW(), reason: null },
      ],
      now: SEED_NOW,
    })
  );
}

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

  // ── Receipt-channel enforcement — R4a / P1-2 ────────────────────────────────

  describe("receipt-channel enforcement (R4a / P1-2)", () => {
    /** Write a receipt markdown, optionally with a guild.handoff.v2 envelope. */
    function writeReceipt(
      runDir: string,
      teammate: string,
      taskId: string,
      envelope?: object
    ): string {
      const handoffsDir = path.join(runDir, "handoffs");
      fs.mkdirSync(handoffsDir, { recursive: true });
      let content =
        `# Handoff Receipt\n\n` +
        `## changed_files\n- test.ts\n\n` +
        `## opens_for\n- none\n\n` +
        `## assumptions\n- test\n\n` +
        `## evidence\n- tested\n\n` +
        `## followups\n- none\n`;
      if (envelope) {
        content += `\n\`\`\`guild.handoff.v2\n${JSON.stringify(envelope, null, 2)}\n\`\`\`\n`;
      }
      const filePath = path.join(handoffsDir, `${teammate}-${taskId}.md`);
      fs.writeFileSync(filePath, content);
      return filePath;
    }

    const VALID_ENVELOPE = {
      schema_version: "guild.handoff.v2",
      task_id: "task-001",
      tier: "mid",
      status: "done",
      summary: "Implemented the auth endpoints and tests.",
      artifacts: ["src/auth.ts:1-80"],
      issues: [],
    };

    it("emits [LANE-SUBMITTED] / awaiting-acceptance for a valid receipt with NO acceptance record (G4 D5)", () => {
      const runId = "run-sess-receipt-valid";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      writeReceipt(runDir, "backend", "task-001", VALID_ENVELOPE);

      const { exitCode, stdout } = runScript(
        {
          session_id: "sess-receipt-valid",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0); // always exits 0
      // A receipt on disk is handoff_submitted, NOT dismissible — no acceptance yet.
      expect(stdout).toMatch(/\[LANE-SUBMITTED\]/);
      expect(stdout).toMatch(/awaiting-acceptance/);
      expect(stdout).not.toMatch(/\[LANE-COMPLETE\]/);
      expect(stdout).not.toMatch(/\[LANE-ACCEPTED\]/);
      expect(stdout).not.toMatch(/safe-to-dismiss/);
      expect(stdout).toMatch(/backend-task-001\.md/);
    });

    it("emits [LANE-ACCEPTED] / safe-to-dismiss ONLY when a durable guild.handoff_acceptance.v1 exists (G4 D5)", () => {
      const runId = "run-sess-receipt-valid";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      writeReceipt(runDir, "backend", "task-001", VALID_ENVELOPE);
      // Seed the durable acceptance record that authorizes termination.
      seedAcceptance(tmpDir, runId, "lt-backend", "backend");

      const { exitCode, stdout } = runScript(
        {
          session_id: "sess-receipt-valid",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/\[LANE-ACCEPTED\]/);
      expect(stdout).toMatch(/safe-to-dismiss/);
      expect(stdout).toMatch(/\[TERMINATE-AUTHORIZED\]/);
      expect(stdout).not.toMatch(/\[AUTO-DISMISS\]/);
    });

    it("emits 'do not paste it in chat' nudge when no receipt exists (no plan)", () => {
      const { exitCode, stdout } = runScript(
        {
          session_id: "sess-no-receipt",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/do not paste it in chat/i);
      expect(stdout).not.toMatch(/\[LANE-COMPLETE\]/);
    });

    it("includes GUILD_TASK_ID in the nudge path when set and receipt is missing", () => {
      const runId = "run-sess-taskid";
      const { stdout } = runScript(
        {
          session_id: "sess-taskid",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        {
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
          GUILD_TASK_ID: "task-007",
          GUILD_RUN_ID: runId,
        }
      );
      expect(stdout).toMatch(/task-007/);
      expect(stdout).toMatch(/do not paste it in chat/i);
    });

    it("emits 'do not paste in chat' nudge when receipt exists but has no guild.handoff.v2 envelope", () => {
      const runId = "run-sess-no-envelope";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      // Write receipt WITHOUT a guild.handoff.v2 envelope block
      writeReceipt(runDir, "backend", "task-001" /* no envelope */);

      const { exitCode, stdout } = runScript(
        {
          session_id: "sess-no-envelope",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/do not paste it in chat/i);
      expect(stdout).not.toMatch(/\[LANE-COMPLETE\]/);
    });

    it("still always exits 0 with a valid receipt (non-gating)", () => {
      const runId = "run-sess-exits0";
      const runDir = path.join(tmpDir, ".guild", "runs", runId);
      writeReceipt(runDir, "qa", "task-002", VALID_ENVELOPE);

      const { exitCode } = runScript(
        {
          session_id: "sess-exits0",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "qa",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" }
      );
      expect(exitCode).toBe(0);
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

  describe("RID W3 — read-only fallback identity", () => {
    it("uses the canonical date-first shape and emits a visible warning", () => {
      const { exitCode, stdout, stderr } = runScript(
        {
          session_id: "Session W3 Idle",
          cwd: tmpDir,
          hook_event_name: "TeammateIdle",
          teammate_name: "backend",
          team_name: "guild-team",
        },
        { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: "" },
      );
      expect(exitCode).toBe(0);
      expect(stderr).toMatch(/WARN.*read-only fallback/i);
      expect(`${stdout}\n${stderr}`).toMatch(/run-\d{8}-\d{6}-session-w3-idle/);
      expect(`${stdout}\n${stderr}`).not.toContain("run-Session W3 Idle");
    });
  });
});
