/**
 * src/modules/dispatch/workflows/task-assignment-v2.ts
 *
 * `guild.task_assignment.v2` — the authoritative, per-attempt production channel
 * (ADR `task-cell-runtime-contract.md` D6). This is the I/O + launcher-facing
 * BUILDER layer over the pure G2 contract
 * (`scripts/lib/core/contracts/task-cell-backend.ts`); it owns no schema of its
 * own — it reuses `buildTaskAssignmentV2` / `validateTaskAssignmentV2` /
 * `validateTaskAttemptV1` / `taskCellPaths`.
 *
 * It replaces the v1 representative-first-task collapse
 * (`task-assignment.ts` → one file per SPECIALIST name, first task only). Here a
 * dispatch emits ONE immutable assignment file per (task_run_id, attempt,
 * instance_id) at the canonical run-tree path, plus its `guild.task_attempt.v1`
 * companion — so a specialist owning ≥2 tasks gets ≥2 distinct files and nothing
 * is overwritten (P0.3 / adversarial test 1).
 *
 * Fail-closed (D6 — a malformed/unreadable assignment is a HARD dispatch failure,
 * not log-and-continue):
 *   - the WRITER validates before writing and THROWS on a malformed assignment or
 *     an attempt to overwrite an existing immutable file;
 *   - the READER validates after reading and returns null on any malformed/absent
 *     file (the caller then fails the lane rather than acting on garbage).
 */

import * as fs from "fs";
import * as path from "path";

import {
  TASK_ATTEMPT_SCHEMA,
  buildTaskAssignmentV2,
  taskCellPaths,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
  type TaskAssignmentV2,
  type TaskAttemptV1,
  type ToolPermissionProjection,
} from "../../../../scripts/lib/core/contracts/task-cell-backend";

/**
 * The launcher-facing dispatch descriptor for ONE task attempt. The launcher
 * resolves these from team.yaml × the plan (one per task-id a specialist owns);
 * `buildTaskCell` turns each into a self-contained `guild.task_assignment.v2`
 * plus its attempt companion. Every id is a safe path segment (the contract's
 * `taskCellPaths` throws otherwise — a hard failure, never a silent sanitize).
 */
export interface TaskCellDispatchInput {
  runId: string;
  /** The stable logical task (the plan lane / task-id). One per file — never collapsed. */
  logicalTaskId: string;
  /** This attempt's run id + attempt number (attempt 1 for a fresh dispatch). */
  taskRunId: string;
  attempt: number;
  attemptId: string;
  /** The EPHEMERAL instance identity — unique per (task_run_id, attempt); never reused (D3). */
  instanceId: string;
  /** D4 lineage — required on every non-first attempt, forbidden on the first. */
  previousAttemptId?: string | null;
  retryReason?: string | null;
  cellId: string;
  goalId: string;
  phaseId: string;
  stepId: string;
  teamId: string;
  /** The specialist slug owning this lane. */
  workerRole: string;
  specialistTypeId: string;
  specialistTypeVersion: string;
  specialistTypeHash: string;
  specialistProfileId: string;
  specialistProfileHash: string;
  /** Fresh per instance — an attempt NEVER reuses the prior attempt's bundle (D3). */
  contextBundleId: string;
  contextBundleHash: string;
  hostId: string;
  adapterId: string;
  hostCapabilitiesHash: string;
  objective: string;
  nonGoals?: string[];
  scopePaths?: string[];
  outputSchema: string;
  acceptanceTests?: string[];
  dependencies?: Array<{ logical_task_id: string; accepted_artifact_ref: string | null }>;
  projection: ToolPermissionProjection;
  autonomyPolicy: string;
  budgets: TaskAssignmentV2["budgets"];
  deadline?: string | null;
  /** Resolved decision 2 — a REUSED parent orchestrator is a `lead_binding_id` (no new lead instance). */
  leadBindingId?: string | null;
  /** …or a cell that spawns a distinct Team Lead records `team_lead_instance_id`. Exactly one. */
  teamLeadInstanceId?: string | null;
  now: () => string;
}

/** The two immutable records a dispatch emits: the assignment + its attempt companion. */
export interface TaskCell {
  assignment: TaskAssignmentV2;
  attempt: TaskAttemptV1;
}

/**
 * Build a self-contained `guild.task_assignment.v2` + its `guild.task_attempt.v1`
 * companion from a single dispatch descriptor. Reuses the contract's
 * `buildTaskAssignmentV2` (which derives the canonical channels + enforces the D4
 * lineage / lead XOR) and validates the attempt record fail-closed. THROWS on any
 * malformed input — a dispatch that cannot be built is a hard failure (D6).
 */
export function buildTaskCell(input: TaskCellDispatchInput): TaskCell {
  const assignment = buildTaskAssignmentV2({
    run_id: input.runId,
    cell_id: input.cellId,
    goal_id: input.goalId,
    phase_id: input.phaseId,
    step_id: input.stepId,
    team_id: input.teamId,
    logical_task_id: input.logicalTaskId,
    task_run_id: input.taskRunId,
    attempt: input.attempt,
    attempt_id: input.attemptId,
    previous_attempt_id: input.previousAttemptId ?? null,
    retry_reason: input.retryReason ?? null,
    instance_id: input.instanceId,
    team_lead_instance_id: input.teamLeadInstanceId ?? null,
    lead_binding_id: input.leadBindingId ?? null,
    worker_role: input.workerRole,
    specialist_type_id: input.specialistTypeId,
    specialist_type_version: input.specialistTypeVersion,
    specialist_type_hash: input.specialistTypeHash,
    specialist_profile_id: input.specialistProfileId,
    specialist_profile_hash: input.specialistProfileHash,
    context_bundle_id: input.contextBundleId,
    context_bundle_hash: input.contextBundleHash,
    host_id: input.hostId,
    adapter_id: input.adapterId,
    host_capabilities_hash: input.hostCapabilitiesHash,
    objective: input.objective,
    non_goals: input.nonGoals ?? [],
    scope_paths: input.scopePaths ?? [],
    output_schema: input.outputSchema,
    acceptance_tests: input.acceptanceTests ?? [],
    dependencies: input.dependencies ?? [],
    projection: input.projection,
    autonomy_policy: input.autonomyPolicy,
    budgets: input.budgets,
    deadline: input.deadline ?? null,
    written_at: input.now(),
  });

  // Re-validate the built assignment fail-closed — the builder cannot express the
  // full D6 field contract in the type system, so a malformed shape must be
  // caught HERE, before anything reaches disk.
  if (!validateTaskAssignmentV2(assignment)) {
    throw new Error(
      `refusing to emit a malformed guild.task_assignment.v2 for ` +
        `${input.logicalTaskId} (instance ${input.instanceId}) — fail-closed (D6)`
    );
  }

  const attemptRecord: TaskAttemptV1 = {
    schema_version: TASK_ATTEMPT_SCHEMA,
    run_id: input.runId,
    cell_id: input.cellId,
    logical_task_id: input.logicalTaskId,
    task_run_id: input.taskRunId,
    attempt: input.attempt,
    attempt_id: input.attemptId,
    previous_attempt_id: input.previousAttemptId ?? null,
    retry_reason: input.retryReason ?? null,
    instance_id: input.instanceId,
    created_at: input.now(),
    terminal_state: null,
    terminal_reason: null,
    terminated_at: null,
    immutable: false,
    orphaned: false,
    reap_attempts: 0,
  };
  if (!validateTaskAttemptV1(attemptRecord)) {
    throw new Error(
      `refusing to emit a malformed guild.task_attempt.v1 for ` +
        `${input.logicalTaskId} attempt ${input.attempt} — fail-closed (D4)`
    );
  }

  return { assignment, attempt: attemptRecord };
}

/** Resolve the on-disk absolute location of a run-tree-relative channel path under `cwd`. */
function absUnderCwd(cwd: string, relPath: string): string {
  return path.resolve(cwd, relPath);
}

/**
 * Write one immutable `guild.task_assignment.v2` at its canonical
 * `assignment_path` (resolved under `cwd`). Fail-closed:
 *   - THROWS if the assignment fails `validateTaskAssignmentV2`;
 *   - THROWS if a file already exists at the canonical path (the v1 overwrite
 *     class — assignments are immutable per instance+attempt, D6).
 * Returns the absolute path written.
 */
export function writeTaskAssignmentV2(cwd: string, assignment: TaskAssignmentV2): string {
  const valid = validateTaskAssignmentV2(assignment);
  if (!valid) {
    throw new Error(
      "refusing to write a malformed guild.task_assignment.v2 — fail-closed (D6)"
    );
  }
  const out = absUnderCwd(cwd, valid.assignment_path);
  if (fs.existsSync(out)) {
    throw new Error(
      `assignment overwrite refused at ${valid.assignment_path} — assignments are ` +
        `immutable per (task_run_id, attempt, instance_id) (D6)`
    );
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(valid, null, 2) + "\n", "utf8");
  return out;
}

/**
 * Write the `guild.task_attempt.v1` companion at its canonical `attempt_path`
 * (one immutable file per attempt, ABOVE the instances — D4). Fail-closed on a
 * malformed record. Idempotent for a single-instance attempt: writing the same
 * record twice is a no-op; a DIFFERENT record at the same path THROWS (a terminal
 * attempt is never overwritten).
 */
export function writeTaskAttemptV1(cwd: string, attempt: TaskAttemptV1): string {
  const valid = validateTaskAttemptV1(attempt);
  if (!valid) {
    throw new Error(
      "refusing to write a malformed guild.task_attempt.v1 — fail-closed (D4)"
    );
  }
  const paths = taskCellPaths({
    run_id: valid.run_id,
    logical_task_id: valid.logical_task_id,
    attempt: valid.attempt,
    instance_id: valid.instance_id,
  });
  const out = absUnderCwd(cwd, paths.attempt_path);
  const serialized = JSON.stringify(valid, null, 2) + "\n";
  if (fs.existsSync(out)) {
    if (fs.readFileSync(out, "utf8") === serialized) return out; // idempotent re-write
    throw new Error(
      `attempt record overwrite refused at ${paths.attempt_path} — a terminal ` +
        `attempt is immutable; a retry mints a new attempt (D4)`
    );
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, serialized, "utf8");
  return out;
}

/**
 * Emit BOTH records for a dispatch (attempt companion first — it is the join a
 * resume reconstructs from — then the immutable assignment). Returns the two
 * absolute paths written.
 */
export function writeTaskCell(cwd: string, cell: TaskCell): { assignmentPath: string; attemptPath: string } {
  const attemptPath = writeTaskAttemptV1(cwd, cell.attempt);
  const assignmentPath = writeTaskAssignmentV2(cwd, cell.assignment);
  return { assignmentPath, attemptPath };
}

/**
 * Production READER (pane side). Reads the `guild.task_assignment.v2` at a
 * run-tree-relative path (as carried in `GUILD_TASK_ASSIGNMENT` / a pointer) and
 * returns the validated object, or null when absent / unparseable / invalid —
 * never throws. A null return is the worker's "no valid assignment" signal; the
 * lane then fails and the worker never starts (D5/D6).
 */
export function readTaskAssignmentV2(cwd: string, assignmentPath: string): TaskAssignmentV2 | null {
  try {
    const raw = fs.readFileSync(absUnderCwd(cwd, assignmentPath), "utf8");
    return validateTaskAssignmentV2(JSON.parse(raw));
  } catch {
    return null;
  }
}

export const ASSIGNMENT_ACK_SCHEMA = "guild.assignment_ack.v1" as const;

/** The ack marker a worker writes AFTER validating its assignment and BEFORE working (D5). */
export interface AssignmentAckV1 {
  schema_version: typeof ASSIGNMENT_ACK_SCHEMA;
  run_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt: number;
  instance_id: string;
  assignment_id: string;
  acknowledged_at: string;
}

/**
 * The canonical ack-marker path for an instance: `assignment-ack.json` alongside
 * the assignment in its instance dir (inside the run tree — D6). Derived from the
 * SAME `taskCellPaths` as every other channel, so a same-run non-canonical layout
 * can never masquerade as an ack.
 */
export function assignmentAckPath(ids: {
  run_id: string;
  logical_task_id: string;
  attempt: number;
  instance_id: string;
}): string {
  const paths = taskCellPaths(ids);
  return path.join(paths.instance_dir, "assignment-ack.json");
}

/**
 * The ack primitive (D5 ack gate). The worker reads + validates its assignment,
 * then calls this to write a durable ack marker the launcher/worker can await —
 * `running` is reachable ONLY after this marker exists. Returns the absolute path
 * written; THROWS on a malformed assignment (an unvalidated assignment can never
 * be acknowledged).
 */
export function acknowledgeAssignment(
  cwd: string,
  assignment: TaskAssignmentV2,
  now: () => string
): string {
  const valid = validateTaskAssignmentV2(assignment);
  if (!valid) {
    throw new Error(
      "refusing to acknowledge a malformed guild.task_assignment.v2 — the ack gate " +
        "requires a validated assignment (D5)"
    );
  }
  const ack: AssignmentAckV1 = {
    schema_version: ASSIGNMENT_ACK_SCHEMA,
    run_id: valid.run_id,
    logical_task_id: valid.logical_task_id,
    task_run_id: valid.task_run_id,
    attempt: valid.attempt,
    instance_id: valid.instance_id,
    assignment_id: `${valid.task_run_id}:${valid.attempt}:${valid.instance_id}`,
    acknowledged_at: now(),
  };
  const rel = assignmentAckPath({
    run_id: valid.run_id,
    logical_task_id: valid.logical_task_id,
    attempt: valid.attempt,
    instance_id: valid.instance_id,
  });
  const out = absUnderCwd(cwd, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ack, null, 2) + "\n", "utf8");
  return out;
}

/** Read + validate an ack marker for an instance, or null when absent/malformed (the await primitive). */
export function readAssignmentAck(
  cwd: string,
  ids: { run_id: string; logical_task_id: string; attempt: number; instance_id: string }
): AssignmentAckV1 | null {
  try {
    const raw = fs.readFileSync(absUnderCwd(cwd, assignmentAckPath(ids)), "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj["schema_version"] !== ASSIGNMENT_ACK_SCHEMA) return null;
    if (typeof obj["instance_id"] !== "string" || typeof obj["acknowledged_at"] !== "string") {
      return null;
    }
    return obj as unknown as AssignmentAckV1;
  } catch {
    return null;
  }
}
