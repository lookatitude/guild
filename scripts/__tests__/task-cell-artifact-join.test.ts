import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { sha256 } from "../../src/modules/communication";
import {
  acknowledgeAssignment,
  buildTaskCell,
  writeTaskCell,
  type TaskCellDispatchInput,
} from "../../src/modules/dispatch/workflows/task-assignment-v2";
import {
  buildAcceptance,
  runDeterministicFloor,
  sealTerminalAttempt,
  writeAcceptanceRecord,
  writeValidationRecord,
} from "../../src/modules/dispatch/workflows/task-cell-acceptance";
import {
  auditTaskCellArtifactJoin,
  type TaskCellArtifactKind,
} from "../../src/modules/dispatch/workflows/task-cell-artifact-join";
import { mintRunBinding } from "../../src/modules/lifecycle/workflows/run-binding";
import { composeStationTeam } from "../../src/modules/teams/workflows/station-composer";
import { writeTeamPlan, writeTeamResult } from "../../src/modules/teams/workflows/station-signals";

const NOW = () => "2026-08-10T16:30:00.000Z";

function root(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-join-"));
}

function prepare(cwd: string) {
  const runId = "run-g10";
  const contextRel = `.guild/context/${runId}/backend-T1.md`;
  const context = "# bounded context\n";
  fs.mkdirSync(path.dirname(path.join(cwd, contextRel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, contextRel), context);
  const binding = mintRunBinding({ root: cwd, run_id: runId });
  const input: TaskCellDispatchInput = {
    runId,
    logicalTaskId: "T1",
    taskRunId: "T1.tr1",
    attempt: 1,
    attemptId: "T1.att1",
    instanceId: "T1.a1.i1",
    cellId: "cell-T1",
    goalId: "goal-g10",
    phaseId: "build",
    stepId: "T1",
    teamId: "team-g10",
    workerRole: "backend",
    specialistTypeId: "backend",
    specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type-backend",
    specialistProfileId: "backend",
    specialistProfileHash: "sha256:profile-backend",
    contextBundleId: contextRel,
    contextBundleHash: `sha256:${sha256(context)}`,
    hostId: "claude-code-cli",
    adapterId: "claude-code-cli@1",
    hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux",
    modelTier: "mid",
    modelId: "claude-sonnet",
    objective: "implement T1",
    nonGoals: [],
    scopePaths: ["src/api"],
    outputSchema: "guild.handoff_receipt.v1",
    acceptanceTests: ["npm test -- api"],
    dependencies: [],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    autonomyPolicy: "supervised",
    budgets: { tokens: 1000, wall_clock_ms: 60_000, cost_usd: 1 },
    deadline: null,
    leadBindingId: "lead-g10",
    now: NOW,
  };
  const cell = buildTaskCell(input);
  writeTaskCell(cwd, cell, { binding_ref: binding.binding_ref });
  return { runId, contextRel, cell };
}

function writeBuildStationArtifacts(cwd: string, runId: string, instanceIds: string[]): void {
  writeTeamPlan(cwd, runId, composeStationTeam("build", {}, { tierIndex: {} }), { now: NOW });
  writeTeamResult(cwd, runId, {
    schema_version: "guild.team_result.v1",
    station: "build",
    team_plan_ref: `.guild/runs/${runId}/team-plan/build.json`,
    lanes: instanceIds.map((instance_id) => ({ role: "backend", instance_id, handoff_ref: null, acceptance_ref: null })),
  }, { now: NOW });
}

describe("TaskCell authoritative artifact join", () => {
  it("joins typed station plan/result through the same bus and detects station drift", () => {
    const cwd = root();
    const { runId, cell } = prepare(cwd);
    const plan = {
      schema_version: "guild.team_plan.v1" as const,
      station: "build" as const,
      roster: [{ role: "backend", scope: null, default_tier: "mid" as const, fanout: "lead_only" as const, source: "default" as const }],
      fired_rules: [],
      plan_driven_slots: ["task-owner-implementers"],
      advisory_memory: true,
      advisory_panel: { producer: null, challengers: [], fired_challenger_rules: [] },
      composition_trace: {
        schema_version: "guild.composition_trace.v1" as const,
        mode: "lead_only" as const,
        fanout_signals: { independence: false, adversarial_value: false, distinct_discipline_count: 0 },
        cost_estimate: { band: "low" as const, worker_lanes: 1 },
        cost_gate_policy: "disabled_by_operator" as const,
        lead_binding: "reuse_parent" as const,
        lead_reuses_parent: true,
        override: null,
      },
    };
    const planPath = writeTeamPlan(cwd, runId, plan, { now: NOW });
    writeTeamResult(cwd, runId, {
      schema_version: "guild.team_result.v1",
      station: "build",
      team_plan_ref: `.guild/runs/${runId}/team-plan/build.json`,
      lanes: [{ role: "backend", instance_id: cell.assignment.instance_id, handoff_ref: null, acceptance_ref: null }],
    }, { now: NOW });

    const joined = auditTaskCellArtifactJoin({ cwd, runId, requireClosed: false });
    expect(joined.ok).toBe(true);
    expect(joined.artifacts.map((item) => item.kind)).toEqual(expect.arrayContaining(["team_plan", "team_result"]));

    fs.writeFileSync(planPath, JSON.stringify({ ...plan, fired_rules: ["tampered"] }, null, 2) + "\n");
    const drifted = auditTaskCellArtifactJoin({ cwd, runId, requireClosed: false });
    expect(drifted.ok).toBe(false);
    expect(drifted.invalid).toContainEqual(expect.stringContaining("team_plan"));
  });

  it("publishes the open identity/attempt/assignment/context join and reports closeout gaps", () => {
    const cwd = root();
    const { runId } = prepare(cwd);

    const open = auditTaskCellArtifactJoin({ cwd, runId, requireClosed: false });
    expect(open.ok).toBe(true);
    expect(open.missing).toEqual([]);
    expect(new Set(open.artifacts.map((a) => a.kind))).toEqual(
      new Set<TaskCellArtifactKind>(["instance", "attempt", "assignment", "context"]),
    );

    const closed = auditTaskCellArtifactJoin({ cwd, runId, requireClosed: true });
    expect(closed.ok).toBe(false);
    expect(closed.missing).toEqual(
      expect.arrayContaining([
        expect.stringContaining("handoff"),
        expect.stringContaining("ack"),
        expect.stringContaining("validation"),
        expect.stringContaining("acceptance"),
        expect.stringContaining("terminal"),
      ]),
    );
  });

  it("reconstructs a closed run from bus-linked records without a transcript", () => {
    const cwd = root();
    const { runId, cell } = prepare(cwd);
    const submitted = {
      receipt_id: "receipt-T1",
      receipt_path: cell.assignment.handoff_path,
      schema_valid: true,
      claimed_changed_files: ["src/api/routes.ts"],
      acceptance_tests_passed: ["npm test -- api"],
      submitted_at: NOW(),
    };
    acknowledgeAssignment(cwd, cell.assignment, NOW);
    fs.writeFileSync(
      path.join(cwd, cell.assignment.handoff_path),
      JSON.stringify(submitted, null, 2) + "\n",
    );
    const validation = runDeterministicFloor({
      assignment: cell.assignment,
      submitted,
      validationResultId: "validation-T1",
      now: NOW,
    });
    writeValidationRecord(cwd, validation);
    const acceptance = buildAcceptance({
      validation,
      acceptancePolicyVersion: "1",
      authoritiesRequired: ["deterministic_floor", "team_lead"],
      authoritiesObserved: [
        { authority: "deterministic_floor", decision: "accepted", at: NOW(), reason: null },
        { authority: "team_lead", decision: "accepted", at: NOW(), reason: null },
      ],
      now: NOW,
    });
    writeAcceptanceRecord(cwd, acceptance);
    sealTerminalAttempt({
      cwd,
      ids: { run_id: runId, logical_task_id: "T1", attempt: 1, instance_id: "T1.a1.i1" },
      terminal_state: "terminated",
      reason: null,
      now: NOW,
    });
    writeBuildStationArtifacts(cwd, runId, [cell.assignment.instance_id]);

    const audit = auditTaskCellArtifactJoin({ cwd, runId, requireClosed: true });
    expect(audit.ok).toBe(true);
    expect(audit.missing).toEqual([]);
    expect(audit.invalid).toEqual([]);
    expect(new Set(audit.artifacts.map((a) => a.kind))).toEqual(
      new Set<TaskCellArtifactKind>([
        "team_plan",
        "team_result",
        "instance",
        "attempt",
        "assignment",
        "ack",
        "context",
        "handoff",
        "validation",
        "acceptance",
        "terminal",
      ]),
    );
  });

  it("detects context tampering before closeout", () => {
    const cwd = root();
    const { runId, contextRel } = prepare(cwd);
    fs.writeFileSync(path.join(cwd, contextRel), "tampered\n");
    const audit = auditTaskCellArtifactJoin({ cwd, runId, requireClosed: false });
    expect(audit.ok).toBe(false);
    expect(audit.invalid).toContainEqual(expect.stringContaining("context hash mismatch"));
  });
});
