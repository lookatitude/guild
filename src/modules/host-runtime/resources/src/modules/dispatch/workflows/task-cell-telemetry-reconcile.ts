/** Reconcile shipping launcher records into the G11 lifecycle ledger. */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  appendTaskCellLifecycleEvent,
  readTaskCellLifecycleEvents,
  type TaskCellLifecycleEventInput,
  type TaskCellLifecycleEventName,
  type TaskCellTelemetryMechanicsMode,
} from "../../telemetry";
import {
  taskCellPaths,
  validateAgentInstanceV1,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
  type AgentInstanceV1,
  type TaskAssignmentV2,
} from "./task-cell-contract";
import { readAssignmentAck } from "./task-assignment-v2";

export interface ReconcileTaskCellLifecycleTelemetryInput {
  cwd: string;
  runId: string;
  /** Restrict launch confirmation to the batch the caller actually committed. */
  instanceIds?: readonly string[];
  /** Backend-confirmed spawn time. Without it, a durable ack is required. */
  launchConfirmedAt?: string;
}

export interface ReconcileTaskCellLifecycleTelemetryResult {
  ok: boolean;
  instances: number;
  events_appended: number;
  findings: string[];
}

function readJson(file: string): unknown | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return null; }
}

function assignmentFiles(cwd: string, runId: string): string[] {
  const root = path.join(cwd, ".guild", "runs", runId, "task-cells");
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name === "assignment.json") files.push(abs);
    }
  };
  walk(root);
  return files.sort();
}

function mechanics(instance: AgentInstanceV1): TaskCellTelemetryMechanicsMode {
  if (instance.substrate === "remote") return "bridged";
  if (instance.substrate === "serial") return "degraded";
  return "wrapped";
}

function iso(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function maxAt(a: string, b: string): string { return Date.parse(a) >= Date.parse(b) ? a : b; }

export function reconcileTaskCellLifecycleTelemetry(
  input: ReconcileTaskCellLifecycleTelemetryInput,
): ReconcileTaskCellLifecycleTelemetryResult {
  const cwd = fs.realpathSync(path.resolve(input.cwd));
  const selected = input.instanceIds ? new Set(input.instanceIds) : null;
  const findings: string[] = [];
  let appended = 0;
  let instances = 0;
  let existing;
  try { existing = readTaskCellLifecycleEvents({ cwd, runId: input.runId }); }
  catch (error) {
    return { ok: false, instances: 0, events_appended: 0, findings: [error instanceof Error ? error.message : String(error)] };
  }
  const namesByInstance = new Map<string, Set<TaskCellLifecycleEventName>>();
  for (const event of existing) {
    const names = namesByInstance.get(event.instance_id);
    if (names) names.add(event.event_name); else namesByInstance.set(event.instance_id, new Set([event.event_name]));
  }

  for (const file of assignmentFiles(cwd, input.runId)) {
    const assignment = validateTaskAssignmentV2(readJson(file));
    if (!assignment) { findings.push(`invalid TaskCell assignment: ${path.relative(cwd, file)}`); continue; }
    if (selected && !selected.has(assignment.instance_id)) continue;
    const ids = {
      run_id: assignment.run_id,
      logical_task_id: assignment.logical_task_id,
      attempt: assignment.attempt,
      instance_id: assignment.instance_id,
    };
    const paths = taskCellPaths(ids);
    const instance = validateAgentInstanceV1(readJson(path.join(cwd, paths.instance_path)));
    const attempt = validateTaskAttemptV1(readJson(path.join(cwd, paths.attempt_path)));
    if (!instance || !attempt) { findings.push(`missing/invalid instance or attempt for ${assignment.instance_id}`); continue; }
    const ack = readAssignmentAck(cwd, ids);
    const proofAt = iso(input.launchConfirmedAt) ?? iso(ack?.acknowledged_at);
    if (proofAt === null) continue;
    instances += 1;
    const known = namesByInstance.get(instance.instance_id) ?? new Set<TaskCellLifecycleEventName>();
    namesByInstance.set(instance.instance_id, known);
    const losses = assignment.projection.recorded_losses.map((item) => `${item.capability}:${item.mapping}:${item.loss}`);
    if (instance.substrate === "serial") losses.push("serial substrate: parallel execution unavailable");
    let lastAt = instance.created_at;
    const emit = (eventName: TaskCellLifecycleEventName, candidateAt: string, metadata: Partial<TaskCellLifecycleEventInput> = {}): void => {
      const at = maxAt(lastAt, candidateAt);
      lastAt = at;
      if (known.has(eventName)) return;
      try {
        appendTaskCellLifecycleEvent({
          cwd,
          event: {
            event_id: `reconcile.${instance.instance_id}.${eventName}`,
            event_name: eventName,
            at,
            run_id: instance.run_id,
            cell_id: instance.cell_id,
            logical_task_id: instance.logical_task_id,
            task_run_id: instance.task_run_id,
            attempt: instance.attempt,
            attempt_id: instance.attempt_id,
            instance_id: instance.instance_id,
            substrate: instance.substrate,
            mechanics_mode: mechanics(instance),
            degradation_reasons: losses,
            ...metadata,
          },
        });
        known.add(eventName);
        appended += 1;
      } catch (error) {
        findings.push(`${instance.instance_id}/${eventName}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    const contextPath = path.resolve(cwd, instance.context_bundle_id);
    let contextBytes = 0;
    try {
      const stat = fs.lstatSync(contextPath);
      if (stat.isFile() && !stat.isSymbolicLink()) contextBytes = stat.size;
    } catch { /* missing context is detected by the artifact join */ }
    emit("spawn_started", instance.created_at, {
      specialist_type_hash: instance.specialist_type_hash,
      specialist_profile_hash: instance.specialist_profile_hash,
      context_bundle_hash: instance.context_bundle_hash,
      host_capabilities_hash: instance.host_capabilities_hash,
      projection_hash: `sha256:${createHash("sha256").update(JSON.stringify(instance.projection)).digest("hex")}`,
      context_bundle_bytes: contextBytes,
    });
    emit("spawned", proofAt);
    emit("ready", proofAt);
    emit("assignment_delivered", proofAt);
    if (ack) {
      emit("assignment_acknowledged", ack.acknowledged_at);
      emit("running", ack.acknowledged_at);
    }
    const handoff = readJson(path.join(cwd, paths.handoff_path)) as Record<string, unknown> | null;
    const submittedAt = iso(handoff?.submitted_at);
    if (submittedAt) emit("handoff_submitted", submittedAt);
    const validation = readJson(path.join(cwd, paths.validation_path)) as Record<string, unknown> | null;
    const validatedAt = iso(validation?.validated_at);
    if (validatedAt && validation?.result === "passed") emit("handoff_validated", validatedAt);
    const acceptance = readJson(path.join(cwd, paths.acceptance_path)) as Record<string, unknown> | null;
    const acceptedAt = iso(acceptance?.downstream_release_at);
    if (acceptedAt) emit("handoff_accepted", acceptedAt);
    const terminationAt = iso(acceptance?.termination_authorized_at) ?? iso(attempt.terminated_at);
    if (terminationAt) emit("termination_started", terminationAt);
    if (attempt.orphaned && attempt.terminal_state === null) emit("orphaned", terminationAt ?? lastAt);
    if (attempt.terminal_state && attempt.terminated_at) {
      const terminalEvent: TaskCellLifecycleEventName = attempt.orphaned && attempt.terminal_state === "terminated"
        ? "reaped"
        : attempt.terminal_state;
      emit(terminalEvent, attempt.terminated_at);
    }
  }
  if (selected) {
    for (const instanceId of selected) {
      if (![...namesByInstance.keys()].includes(instanceId)) findings.push(`selected instance has no TaskCell assignment: ${instanceId}`);
    }
  }
  return { ok: findings.length === 0 && instances > 0, instances, events_appended: appended, findings };
}
