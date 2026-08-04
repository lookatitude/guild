/**
 * hooks/__tests__/teammate-idle.test.ts
 *
 * Tests for hooks/agent-team/teammate-idle.ts
 *
 * Covers:
 *  - LANE-SUBMITTED (task-cell-runtime G4, ADR D5): a valid receipt with NO
 *    durable acceptance record is handoff_submitted, NOT dismissible.
 *  - LANE-ACCEPTED: a durable guild.handoff_acceptance.v1 gates safe-to-dismiss.
 *  - Invalid-envelope nudge: strict fenced-JSON wording (not YAML frontmatter)
 *  - Missing-receipt nudge: strict fenced-JSON wording (not YAML frontmatter)
 *  - Always exits 0
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  buildTaskCell,
  writeTaskCell,
  type TaskCellDispatchInput,
} from "../../src/modules/dispatch/workflows/task-assignment-v2";
import {
  buildAcceptance,
  runDeterministicFloor,
  writeAcceptanceRecord,
} from "../../src/modules/dispatch/workflows/task-cell-acceptance";

const SCRIPT = path.resolve(__dirname, "../agent-team/teammate-idle.ts");

// ── Helpers ────────────────────────────────────────────────────────────────

function runScript(
  payload: Record<string, unknown>,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      GUILD_RUN_ID: "test-run",
      ...env,
    },
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Build a valid fenced-JSON receipt markdown string. */
function makeValidReceipt(taskId: string, status = "done"): string {
  return [
    "## changed_files",
    "- hooks/lib/handoff-v2.ts:1-200",
    "",
    "## opens_for",
    "Downstream consumers can rely on strict validation.",
    "",
    "## assumptions",
    "None.",
    "",
    "## evidence",
    "Tests pass.",
    "",
    "## followups",
    "None.",
    "",
    "```guild.handoff.v2",
    JSON.stringify({
      schema_version: "guild.handoff.v2",
      task_id: taskId,
      tier: "mid",
      status,
      summary: "Implemented the feature.",
      artifacts: [],
      issues: [],
    }),
    "```",
  ].join("\n");
}

/** Build an invalid receipt (YAML frontmatter only — the p2-3 drift pattern). */
function makeYamlFrontmatterReceipt(taskId: string): string {
  return [
    "---",
    `schema: guild.handoff.v2`,
    `task_id: ${taskId}`,
    `specialist: backend`,
    `status: done`,
    `timestamp: 2026-05-27T00:00:00Z`,
    "---",
    "",
    "## changed_files",
    "- some/file.ts",
    "",
    "## opens_for",
    "Unblocks next.",
    "",
    "## assumptions",
    "None.",
    "",
    "## evidence",
    "Ran tests.",
    "",
    "## followups",
    "None.",
  ].join("\n");
}

/** Build a plan file that assigns a task to a teammate. */
function makePlanFile(taskId: string, teammate: string): string {
  return `- ${taskId}: Some task to do\n  owner: ${teammate}\n`;
}

const SEED_NOW = () => "2026-07-15T00:00:00.000Z";

/**
 * task-cell-runtime G4: seed a DURABLE `guild.handoff_acceptance.v1` (+ its sibling
 * assignment binding worker_role) into the run tree under `cwd`, so the acceptance
 * gate resolves this teammate's lane as safe-to-dismiss. Scope/tests are empty so
 * the deterministic floor passes vacuously for any receipt.
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
  const rb = require("../../src/modules/lifecycle/workflows/run-binding") as
    typeof import("../../src/modules/lifecycle/workflows/run-binding");
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
  const acceptance = buildAcceptance({
    validation,
    acceptancePolicyVersion: "1.0.0",
    authoritiesRequired: ["deterministic_floor", "team_lead"],
    authoritiesObserved: [
      { authority: "deterministic_floor", decision: "accepted", at: SEED_NOW(), reason: null },
      { authority: "team_lead", decision: "accepted", at: SEED_NOW(), reason: null },
    ],
    now: SEED_NOW,
  });
  writeAcceptanceRecord(cwd, acceptance);
}

// ── Fixtures ───────────────────────────────────────────────────────────────

describe("teammate-idle.ts", () => {
  let tmpDir: string;
  let runDir: string;
  let handoffsDir: string;
  let planDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-idle-test-"));
    // Create .guild/ so resolveGuildRoot anchors here
    fs.mkdirSync(path.join(tmpDir, ".guild"), { recursive: true });
    runDir = path.join(tmpDir, ".guild", "runs", "test-run");
    handoffsDir = path.join(runDir, "handoffs");
    planDir = path.join(tmpDir, ".guild", "plan");
    fs.mkdirSync(handoffsDir, { recursive: true });
    fs.mkdirSync(planDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const basePayload = {
    hook_event_name: "TeammateIdle",
    session_id: "test-session",
    teammate_name: "backend",
    team_name: "guild",
  };

  // ── Always-exit-0 ─────────────────────────────────────────────────────────

  it("always exits 0", () => {
    const { exitCode } = runScript({ ...basePayload, cwd: tmpDir });
    expect(exitCode).toBe(0);
  });

  it("exits 0 even with invalid JSON on stdin", () => {
    const result = spawnSync("npx", ["tsx", SCRIPT], {
      input: "not json",
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
        GUILD_RUN_ID: "test-run",
      },
      timeout: 20000,
    });
    expect(result.status).toBe(0);
  });

  // ── LANE-SUBMITTED (G4: valid receipt, NO acceptance record) ───────────────
  // A receipt on disk is the worker's OUTPUT, not an acceptance. Without a durable
  // guild.handoff_acceptance.v1 the lane is handoff_submitted — NOT safe to
  // dismiss. This is the P0.4 false-positive channel the old [AUTO-DISMISS] was.

  describe("LANE-SUBMITTED (valid receipt, no acceptance record)", () => {
    beforeEach(() => {
      // Write a valid fenced-JSON receipt — but seed NO acceptance record.
      fs.writeFileSync(
        path.join(handoffsDir, "backend-task-t1.md"),
        makeValidReceipt("task-t1", "done")
      );
    });

    it("emits [LANE-SUBMITTED] / awaiting-acceptance, NOT [LANE-COMPLETE]/[AUTO-DISMISS]", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("[LANE-SUBMITTED]");
      expect(stdout).toContain("awaiting-acceptance");
      expect(stdout).toContain('teammate="backend"');
      expect(stdout).not.toContain("[LANE-COMPLETE]");
      expect(stdout).not.toContain("[LANE-ACCEPTED]");
      expect(stdout).not.toContain("[AUTO-DISMISS]");
      expect(stdout).not.toContain("safe-to-dismiss");
    });

    it("emits a `submitted ·` pointer line per valid task (not a dismissal)", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      const receiptPath = path.join(handoffsDir, "backend-task-t1.md");
      expect(stdout).toContain(`submitted · task-t1 · status:done · receipt:${receiptPath}`);
    });
  });

  // ── LANE-ACCEPTED (G4: durable acceptance record authorizes dismissal) ─────

  describe("LANE-ACCEPTED (durable guild.handoff_acceptance.v1 exists)", () => {
    beforeEach(() => {
      fs.writeFileSync(
        path.join(handoffsDir, "backend-task-t1.md"),
        makeValidReceipt("task-t1", "done")
      );
      // Seed a durable acceptance record binding worker_role=backend.
      seedAcceptance(tmpDir, "test-run", "lt-backend", "backend");
    });

    it("emits [LANE-ACCEPTED] / safe-to-dismiss gated on the acceptance record", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("[LANE-ACCEPTED]");
      expect(stdout).toContain("safe-to-dismiss");
      expect(stdout).toContain("[TERMINATE-AUTHORIZED]");
      expect(stdout).toContain("logical_task=lt-backend");
      expect(stdout).not.toContain("[AUTO-DISMISS]");
      expect(stdout).not.toContain("[LANE-SUBMITTED]");
    });
  });

  // ── Invalid-envelope nudge ─────────────────────────────────────────────────

  describe("invalid-envelope nudge (receipt exists, envelope missing/invalid)", () => {
    beforeEach(() => {
      // Write a YAML-frontmatter-only receipt (p2-3 drift pattern)
      fs.writeFileSync(
        path.join(handoffsDir, "backend-task-t1.md"),
        makeYamlFrontmatterReceipt("task-t1")
      );
    });

    it("does NOT emit [LANE-COMPLETE]", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).not.toContain("[LANE-COMPLETE]");
    });

    it("does NOT emit [AUTO-DISMISS]", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).not.toContain("[AUTO-DISMISS]");
    });

    it("states the envelope must be a strict fenced JSON block (not YAML frontmatter)", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("strict fenced JSON block");
      expect(stdout).toContain("NOT YAML frontmatter");
      expect(stdout).toContain("frontmatter-only receipt is rejected");
    });

    it("still exits 0", () => {
      const { exitCode } = runScript({ ...basePayload, cwd: tmpDir });
      expect(exitCode).toBe(0);
    });
  });

  // ── Missing-receipt nudge ──────────────────────────────────────────────────

  describe("missing-receipt nudge (plan assigns task, no receipt)", () => {
    beforeEach(() => {
      // Create a plan file assigning task-t1 to backend
      fs.writeFileSync(path.join(planDir, "lane.md"), makePlanFile("task-t1", "backend"));
    });

    it("does NOT emit [LANE-COMPLETE]", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).not.toContain("[LANE-COMPLETE]");
    });

    it("states the envelope must be a strict fenced JSON block (not YAML frontmatter)", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("strict fenced JSON block");
      expect(stdout).toContain("NOT YAML frontmatter");
      expect(stdout).toContain("frontmatter-only receipt is rejected");
    });

    it("references the receipt path", () => {
      const { stdout } = runScript({ ...basePayload, cwd: tmpDir });
      expect(stdout).toContain("backend-task-t1.md");
    });

    it("still exits 0", () => {
      const { exitCode } = runScript({ ...basePayload, cwd: tmpDir });
      expect(exitCode).toBe(0);
    });
  });
});
