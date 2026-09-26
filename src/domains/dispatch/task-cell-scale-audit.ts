/** G12 scale/interoperability close gate over the canonical TaskCell record join. */
import {
  assignmentId,
  validateAgentInstanceV1,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
  type ModelTier,
  type TaskCellRecordSet,
  type TaskCellSubstrate,
} from "./task-cell-contract";

export interface TaskCellCapabilityEnvelope {
  allowed_substrates: TaskCellSubstrate[];
  allowed_model_tiers: ModelTier[];
  max_cost_usd: number | null;
}

export type TaskCellCapabilityIndex = Record<string, TaskCellCapabilityEnvelope>;

export interface TaskCellScaleAuditInput {
  records: TaskCellRecordSet;
  expected_logical_task_ids: string[];
  minimum_instances: number;
  required_substrates: TaskCellSubstrate[];
  capability_index: TaskCellCapabilityIndex;
}

export interface TaskCellScaleAuditResult {
  schema_version: "guild.task_cell_scale_audit.v1";
  ok: boolean;
  findings: string[];
  counts: {
    logical_tasks: number;
    instances: number;
    retries: number;
    substrates: number;
    assignments: number;
    validations: number;
    acceptances: number;
  };
}

export const TASK_CELL_SCALE_FLOOR = 256;

function sorted(values: Iterable<string>): string[] { return [...values].sort(); }
function sameSet(a: Iterable<string>, b: Iterable<string>): boolean {
  return JSON.stringify(sorted(new Set(a))) === JSON.stringify(sorted(new Set(b)));
}
function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) { if (seen.has(value)) duplicate.add(value); else seen.add(value); }
  return sorted(duplicate);
}
function nonBlank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function stringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every(nonBlank); }
function validValidation(value: unknown): boolean {
  if (!plain(value) || value.schema_version !== "guild.handoff_validation.v1") return false;
  for (const key of ["validation_result_id", "run_id", "cell_id", "logical_task_id", "task_run_id", "instance_id", "assignment_id", "receipt_id", "validated_at"]) {
    if (!nonBlank(value[key])) return false;
  }
  return Number.isInteger(value.attempt) && Number(value.attempt) >= 1 &&
    typeof value.schema_valid === "boolean" && typeof value.scope_valid === "boolean" && typeof value.tests_passed === "boolean" &&
    stringArray(value.out_of_scope_files) && stringArray(value.failed_acceptance_tests) &&
    (value.result === "passed" || value.result === "failed") && (value.reason === null || nonBlank(value.reason));
}
function validAcceptance(value: unknown): boolean {
  if (!plain(value) || value.schema_version !== "guild.handoff_acceptance.v1") return false;
  for (const key of ["run_id", "cell_id", "logical_task_id", "task_run_id", "instance_id", "assignment_id", "receipt_id", "validation_result_id", "acceptance_policy_version"]) {
    if (!nonBlank(value[key])) return false;
  }
  if (!Number.isInteger(value.attempt) || Number(value.attempt) < 1 || !Array.isArray(value.authorities_required) || !Array.isArray(value.authorities_observed)) return false;
  if (!value.authorities_required.every((item) => ["deterministic_floor", "team_lead", "reviewer_cell"].includes(String(item)))) return false;
  if (!value.authorities_observed.every((item) => plain(item) && ["deterministic_floor", "team_lead", "reviewer_cell"].includes(String(item.authority)) &&
    ["accepted", "rejected"].includes(String(item.decision)) && nonBlank(item.at) && (item.reason === null || nonBlank(item.reason)))) return false;
  return (value.downstream_release_at === null || nonBlank(value.downstream_release_at)) &&
    (value.termination_authorized_at === null || nonBlank(value.termination_authorized_at));
}
function validEnvelope(value: unknown): value is TaskCellCapabilityEnvelope {
  return plain(value) && Array.isArray(value.allowed_substrates) && value.allowed_substrates.length > 0 &&
    value.allowed_substrates.every((item) => ["tmux", "in-process", "serial", "remote"].includes(String(item))) &&
    Array.isArray(value.allowed_model_tiers) && value.allowed_model_tiers.length > 0 &&
    value.allowed_model_tiers.every((item) => ["cheap", "mid", "powerful"].includes(String(item))) &&
    (value.max_cost_usd === null || (typeof value.max_cost_usd === "number" && Number.isFinite(value.max_cost_usd) && value.max_cost_usd >= 0));
}

export function auditTaskCellScaleRecords(input: TaskCellScaleAuditInput): TaskCellScaleAuditResult {
  const findings: string[] = [];
  const { records } = input;
  if (!records || !Array.isArray(records.instances) || !Array.isArray(records.attempts) ||
      !Array.isArray(records.assignments) || !Array.isArray(records.validations) || !Array.isArray(records.acceptances)) {
    return {
      schema_version: "guild.task_cell_scale_audit.v1",
      ok: false,
      findings: ["records must be a guild TaskCell record set"],
      counts: { logical_tasks: 0, instances: 0, retries: 0, substrates: 0, assignments: 0, validations: 0, acceptances: 0 },
    };
  }
  if (!Number.isInteger(input.minimum_instances) || input.minimum_instances < TASK_CELL_SCALE_FLOOR) findings.push(`minimum_instances must be an integer >= ${TASK_CELL_SCALE_FLOOR}`);
  if (records.instances.length < input.minimum_instances) findings.push(`instance count ${records.instances.length} is below required scale ${input.minimum_instances}`);
  if (input.expected_logical_task_ids.length === 0) findings.push("expected logical-task set is empty");
  const duplicateExpected = duplicates(input.expected_logical_task_ids);
  if (duplicateExpected.length > 0) findings.push(`expected logical-task set contains duplicates: ${duplicateExpected.join(", ")}`);
  if (new Set(input.required_substrates).size < 2) findings.push("mixed-backend audit requires at least two distinct substrates");

  let invalidRecord = false;
  records.instances.forEach((item, index) => { if (!validateAgentInstanceV1(item)) { findings.push(`invalid instance record at index ${index}`); invalidRecord = true; } });
  records.attempts.forEach((item, index) => { if (!validateTaskAttemptV1(item)) { findings.push(`invalid attempt record at index ${index}`); invalidRecord = true; } });
  records.assignments.forEach((item, index) => { if (!validateTaskAssignmentV2(item)) { findings.push(`invalid assignment record at index ${index}`); invalidRecord = true; } });
  records.validations.forEach((item, index) => { if (!validValidation(item)) { findings.push(`invalid validation record at index ${index}`); invalidRecord = true; } });
  records.acceptances.forEach((item, index) => { if (!validAcceptance(item)) { findings.push(`invalid acceptance record at index ${index}`); invalidRecord = true; } });
  for (const [hostId, envelope] of Object.entries(input.capability_index ?? {})) {
    if (!nonBlank(hostId) || !validEnvelope(envelope)) findings.push(`invalid capability envelope for host ${hostId || "<empty>"}`);
  }
  if (invalidRecord) {
    return {
      schema_version: "guild.task_cell_scale_audit.v1",
      ok: false,
      findings,
      counts: {
        logical_tasks: 0,
        instances: records.instances.length,
        retries: 0,
        substrates: 0,
        assignments: records.assignments.length,
        validations: records.validations.length,
        acceptances: records.acceptances.length,
      },
    };
  }

  const instanceIds = records.instances.map((item) => item.instance_id);
  const attemptIds = records.attempts.map((item) => item.instance_id);
  const assignmentIds = records.assignments.map((item) => item.instance_id);
  const validationIds = records.validations.map((item) => item.instance_id);
  const acceptanceIds = records.acceptances.map((item) => item.instance_id);
  for (const [label, values] of [
    ["instance", instanceIds], ["attempt", attemptIds], ["assignment", assignmentIds],
    ["validation", validationIds], ["acceptance", acceptanceIds],
  ] as const) {
    const duplicate = duplicates(values);
    if (duplicate.length > 0) findings.push(`duplicate ${label} instance ids: ${duplicate.join(", ")}`);
  }
  for (const [label, values] of [
    ["attempt_id", records.attempts.map((item) => item.attempt_id)],
    ["task_run_id", records.attempts.map((item) => item.task_run_id)],
  ] as const) {
    const duplicate = duplicates(values);
    if (duplicate.length > 0) findings.push(`duplicate ${label} values: ${duplicate.join(", ")}`);
  }
  if (!sameSet(instanceIds, attemptIds)) findings.push("attempt instance set differs from instance set");
  if (!sameSet(instanceIds, assignmentIds)) findings.push("assignment instance set differs from instance set");
  if (!sameSet(instanceIds, validationIds)) findings.push("validation instance set differs from instance set");
  if (!sameSet(instanceIds, acceptanceIds)) findings.push("acceptance instance set differs from instance set");

  const actualLogical = new Set(records.instances.map((item) => item.logical_task_id));
  if (!sameSet(actualLogical, input.expected_logical_task_ids)) findings.push("actual logical-task set differs from expected set");
  const runIds = new Set([
    ...records.instances.map((item) => item.run_id),
    ...records.attempts.map((item) => item.run_id),
    ...records.assignments.map((item) => item.run_id),
    ...records.validations.map((item) => item.run_id),
    ...records.acceptances.map((item) => item.run_id),
  ]);
  if (runIds.size !== 1) findings.push(`record join spans ${runIds.size} run ids`);

  const instanceById = new Map(records.instances.map((item) => [item.instance_id, item]));
  const attemptByInstance = new Map(records.attempts.map((item) => [item.instance_id, item]));
  const assignmentByInstance = new Map(records.assignments.map((item) => [item.instance_id, item]));
  const validationByInstance = new Map(records.validations.map((item) => [item.instance_id, item]));
  const acceptanceByInstance = new Map(records.acceptances.map((item) => [item.instance_id, item]));

  for (const [instanceId, instance] of instanceById) {
    const attempt = attemptByInstance.get(instanceId);
    const assignment = assignmentByInstance.get(instanceId);
    if (!attempt || !assignment) continue;
    for (const [label, a, b] of [
      ["attempt_id", instance.attempt_id, attempt.attempt_id],
      ["task_run_id", instance.task_run_id, attempt.task_run_id],
      ["logical_task_id", instance.logical_task_id, attempt.logical_task_id],
      ["assignment attempt_id", instance.attempt_id, assignment.attempt_id],
      ["assignment task_run_id", instance.task_run_id, assignment.task_run_id],
      ["assignment logical_task_id", instance.logical_task_id, assignment.logical_task_id],
    ] as const) {
      if (a !== b) findings.push(`${instanceId} ${label} identity mismatch`);
    }
    const envelope = input.capability_index[instance.host_id];
    if (!envelope) {
      findings.push(`${instanceId} host ${instance.host_id} is not in capability index`);
    } else if (validEnvelope(envelope)) {
      if (!envelope.allowed_substrates.includes(instance.substrate)) findings.push(`${instanceId} substrate ${instance.substrate} is outside host capability envelope`);
      if (!envelope.allowed_model_tiers.includes(instance.model_tier)) findings.push(`${instanceId} model tier ${instance.model_tier} is outside host capability envelope`);
      if (envelope.max_cost_usd !== null) {
        if (instance.budgets.cost_usd === null) findings.push(`${instanceId} has no cost budget inside a bounded capability envelope`);
        else if (instance.budgets.cost_usd > envelope.max_cost_usd) findings.push(`${instanceId} cost budget exceeds host capability envelope`);
      }
    }
  }

  const attemptsByTask = new Map<string, typeof records.attempts>();
  for (const attempt of records.attempts) {
    const list = attemptsByTask.get(attempt.logical_task_id);
    if (list) list.push(attempt); else attemptsByTask.set(attempt.logical_task_id, [attempt]);
  }
  for (const [logicalTaskId, attempts] of attemptsByTask) {
    const ordered = [...attempts].sort((a, b) => a.attempt - b.attempt);
    for (let index = 0; index < ordered.length; index++) {
      const current = ordered[index];
      const expectedAttempt = index + 1;
      if (current.attempt !== expectedAttempt) findings.push(`${logicalTaskId} retry lineage is not contiguous at attempt ${current.attempt}`);
      if (expectedAttempt === 1) {
        if (current.previous_attempt_id !== null || current.retry_reason !== null) findings.push(`${logicalTaskId} first attempt carries retry lineage`);
      } else {
        const prior = ordered[index - 1];
        if (current.previous_attempt_id !== prior.attempt_id || !nonBlank(current.retry_reason)) findings.push(`${logicalTaskId} retry lineage is broken at attempt ${current.attempt}`);
        if (!prior.immutable || prior.terminal_state === null) findings.push(`${logicalTaskId} retry starts before prior attempt is immutable terminal`);
      }
    }
  }

  for (const [instanceId, validation] of validationByInstance) {
    const assignment = assignmentByInstance.get(instanceId);
    if (!assignment) continue;
    if (validation.assignment_id !== assignmentId(assignment) || validation.task_run_id !== assignment.task_run_id || validation.attempt !== assignment.attempt) {
      findings.push(`${instanceId} handoff validation does not bind the assignment identity`);
    }
  }
  for (const [instanceId, acceptance] of acceptanceByInstance) {
    const validation = validationByInstance.get(instanceId);
    const attempt = attemptByInstance.get(instanceId);
    if (!validation || !attempt) continue;
    if (acceptance.validation_result_id !== validation.validation_result_id || acceptance.assignment_id !== validation.assignment_id || acceptance.receipt_id !== validation.receipt_id) {
      findings.push(`${instanceId} handoff acceptance does not bind the validation join`);
    }
    const decisions = new Map(acceptance.authorities_observed.map((item) => [item.authority, item.decision]));
    const authorized = acceptance.authorities_required.every((authority) => decisions.get(authority) === "accepted");
    if (acceptance.downstream_release_at !== null && (validation.result !== "passed" || !authorized)) findings.push(`${instanceId} releases downstream without passed validation and authorities`);
    if (attempt.terminal_state === "terminated" && acceptance.downstream_release_at === null) findings.push(`${instanceId} terminates successful work without downstream release`);
    if (attempt.terminal_state === "rejected" && acceptance.downstream_release_at !== null) findings.push(`${instanceId} rejected attempt releases downstream`);
  }

  const substrates = new Set(records.instances.map((item) => item.substrate));
  for (const required of input.required_substrates) {
    if (!substrates.has(required)) findings.push(`required substrate ${required} is absent`);
  }
  const counts = {
    logical_tasks: actualLogical.size,
    instances: records.instances.length,
    retries: records.attempts.filter((item) => item.attempt > 1).length,
    substrates: substrates.size,
    assignments: records.assignments.length,
    validations: records.validations.length,
    acceptances: records.acceptances.length,
  };
  return { schema_version: "guild.task_cell_scale_audit.v1", ok: findings.length === 0, findings, counts };
}
