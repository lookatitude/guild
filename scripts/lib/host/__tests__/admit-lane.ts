/**
 * Test support: admit a lane the way agent-team-launcher does before a real
 * launch. reserveInstance claims the slot (the attempt record), then the
 * instance's guild.task_assignment.v2 is written. Backend tests that drive a
 * real (non-dry) launch use this so plr-wi-15-4's admission check sees a real
 * cell, and hook tests use it so the projection gate has an assignment.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildTaskAssignmentV2,
  reserveInstance,
  reserveRefused,
  taskCellPaths,
} from "../../../../src/domains/dispatch";

export function tmpLaunchRoot(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-admit-lane-")));
}

export function admitLane(
  cwd: string,
  runId: string,
  logicalTaskId: string,
  instanceId: string,
  tools: string[] = ["Read"],
): void {
  const claim = reserveInstance({
    cwd,
    run_id: runId,
    logical_task_id: logicalTaskId,
    attempt: 1,
    instance_id: instanceId,
    max: 64,
  });
  if (reserveRefused(claim)) throw new Error(claim.reason);
  writeLaneAssignment(cwd, runId, logicalTaskId, instanceId, tools);
}

/** Write one valid v2 assignment for an instance of attempt 1, with no reservation. */
export function writeLaneAssignment(
  cwd: string,
  runId: string,
  logicalTaskId: string,
  instanceId: string,
  tools: string[] = ["Read"],
): void {
  const assignment = buildTaskAssignmentV2({
    run_id: runId,
    cell_id: `cell-${logicalTaskId}`,
    goal_id: "goal-test",
    phase_id: "build",
    step_id: logicalTaskId,
    team_id: "test",
    logical_task_id: logicalTaskId,
    task_run_id: `${logicalTaskId}.tr1`,
    attempt: 1,
    attempt_id: `${logicalTaskId}.att1`,
    instance_id: instanceId,
    lead_binding_id: "lead-binding-test",
    worker_role: "backend",
    specialist_type_id: "backend",
    specialist_type_version: "1",
    specialist_type_hash: "sha256:type-backend",
    specialist_profile_id: "backend",
    specialist_profile_hash: "sha256:profile-backend",
    context_bundle_id: `context/${runId}/backend-${logicalTaskId}.md`,
    context_bundle_hash: `sha256:ctx-${logicalTaskId}`,
    host_id: "claude-code-cli",
    adapter_id: "claude-code-cli@1",
    host_capabilities_hash: "sha256:caps",
    objective: `implement ${logicalTaskId}`,
    non_goals: [],
    scope_paths: [],
    output_schema: "guild.handoff_receipt.v1",
    acceptance_tests: [],
    dependencies: [],
    projection: { tools, permissions: [], recorded_losses: [] },
    autonomy_policy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    deadline: null,
    written_at: "2026-09-28T00:00:00.000Z",
  } as Parameters<typeof buildTaskAssignmentV2>[0]);
  const file = path.resolve(
    cwd,
    taskCellPaths({ run_id: runId, logical_task_id: logicalTaskId, attempt: 1, instance_id: instanceId }).assignment_path,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(assignment, null, 2)}\n`, { flag: "wx" });
}

/**
 * Admit every lane of a launch request in a fresh temp root. A lane with no
 * task id gets its name as the task id.
 */
export function admitRequest<
  R extends {
    runId: string;
    cwd: string;
    specialists: ReadonlyArray<{ name: string; taskId?: string; task_cell_instance_id?: string }>;
  },
>(req: R): R {
  const cwd = tmpLaunchRoot();
  const specialists = req.specialists.map((s) => {
    const taskId = s.taskId ?? s.name;
    const instanceId = s.task_cell_instance_id ?? `${taskId}.a1.i-test`;
    admitLane(cwd, req.runId, taskId, instanceId);
    return { ...s, taskId, task_cell_instance_id: instanceId };
  });
  return { ...req, cwd, specialists };
}
