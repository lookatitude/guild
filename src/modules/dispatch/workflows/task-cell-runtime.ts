/** Filesystem-canonical production implementation of the TaskCellBackend seam. */
import * as fs from "fs";
import * as path from "path";

import { sha256 } from "../../communication";
import {
  appendTaskCellLifecycleEvent,
  type TaskCellLifecycleEventName,
} from "../../telemetry";
import {
  AGENT_INSTANCE_SCHEMA,
  TASK_ATTEMPT_SCHEMA,
  assertTransition,
  attemptLineage,
  taskCellPaths,
  validateAgentInstanceV1,
  validateTaskAssignmentV2,
  validateTaskAttemptV1,
  type AcceptHandoffRequest,
  type AcceptHandoffResult,
  type AgentInstanceV1,
  type AwaitAssignmentAckResult,
  type AwaitReadyResult,
  type AwaitTerminatedResult,
  type CellHandle,
  type CollectHandoffResult,
  type DeliverAssignmentResult,
  type HeartbeatResult,
  type InstanceHandle,
  type InstanceObservation,
  type InstanceRef,
  type OpFailure,
  type ReapResult,
  type RejectHandoffRequest,
  type RejectHandoffResult,
  type SpawnCellRequest,
  type SpawnInstanceRequest,
  type SubmittedHandoff,
  type TaskAssignmentV2,
  type TaskAttemptV1,
  type TaskCellBackend,
  type TaskCellRecordSet,
  type TaskCellRecordStore,
  type TaskCellState,
  type TaskCellSubstrate,
  type TerminalOutcome,
  type TerminalState,
  type TerminateRequest,
  type TerminateResult,
  type WaitOptions,
} from "./task-cell-contract";
import {
  acknowledgeAssignment,
  readAssignmentAck,
  readTaskAssignmentV2,
  writeAgentInstanceV1,
  writeTaskAssignmentV2,
  writeTaskAttemptV1,
} from "./task-assignment-v2";
import type { DispatchBindingEnvelope } from "./task-assignment";
import {
  buildAcceptance,
  buildRejection,
  findRunAcceptances,
  gateDependencies,
  markAttemptOrphaned,
  runDeterministicFloor,
  sealTerminalAttempt,
  writeAcceptanceRecord,
  writeValidationRecord,
} from "./task-cell-acceptance";
import { publishTaskCellFile } from "./task-cell-artifact-join";
import type {
  ExecutionHandle,
  ExecutionSpawnRequest,
  ExecutionTransportPort,
} from "./execution-transport-ports";

export type TaskCellMechanicsMode = "native" | "wrapped" | "bridged" | "emulated" | "degraded";
export interface TaskCellMechanicsResult { ok: boolean; reason: string | null }

/** Host mechanics only. Lifecycle semantics and durable records stay in this class. */
export interface TaskCellWorkerPort {
  readonly mode: TaskCellMechanicsMode;
  readonly losses: readonly string[];
  isAvailable(): boolean;
  spawn(input: {
    instance_id: string;
    run_id: string;
    assignment_path: string;
    instance: AgentInstanceV1;
  }): TaskCellMechanicsResult;
  ready(input: { instance_id: string; run_id: string }): TaskCellMechanicsResult;
  notifyAssignment(input: {
    instance_id: string;
    run_id: string;
    assignment_path: string;
  }): TaskCellMechanicsResult;
  terminate(input: { instance_id: string; run_id: string; reason: string }): TaskCellMechanicsResult;
}

export interface FilesystemTaskCellRuntimeOpts {
  cwd: string;
  substrate: TaskCellSubstrate;
  parallelism: number;
  binding: DispatchBindingEnvelope;
  worker: TaskCellWorkerPort;
  now?: () => string;
  idFactory?: (kind: "instance" | "attempt" | "validation") => string;
}

export interface ExecutionTransportTaskCellWorkerPortOpts {
  transport: ExecutionTransportPort;
  requestFor: (input: {
    instance_id: string;
    run_id: string;
    assignment_path: string;
    instance: AgentInstanceV1;
  }) => ExecutionSpawnRequest;
  /** A filesystem watcher/poll loop consumes the canonical assignment pointer. */
  filesystemAssignmentWakeup?: boolean;
  mode?: TaskCellMechanicsMode;
}

/**
 * Bounded adapter from the shipped execution-transport seam to TaskCell worker
 * mechanics. Unsupported operations stay explicit losses; termination is never
 * fabricated when a transport owns no closeable handle.
 */
export class ExecutionTransportTaskCellWorkerPort implements TaskCellWorkerPort {
  readonly mode: TaskCellMechanicsMode;
  readonly losses: readonly string[];
  private readonly transport: ExecutionTransportPort;
  private readonly requestFor: ExecutionTransportTaskCellWorkerPortOpts["requestFor"];
  private readonly filesystemAssignmentWakeup: boolean;
  private readonly handles = new Map<string, ExecutionHandle>();

  constructor(opts: ExecutionTransportTaskCellWorkerPortOpts) {
    this.transport = opts.transport;
    this.requestFor = opts.requestFor;
    this.filesystemAssignmentWakeup = opts.filesystemAssignmentWakeup === true;
    const losses: string[] = [];
    if (!this.transport.supports("send") && this.filesystemAssignmentWakeup) {
      losses.push("send unsupported: assignment wakeup emulated by the canonical filesystem channel");
    }
    if (!this.transport.supports("close")) {
      losses.push("close unsupported: worker termination cannot be confirmed by this transport");
    }
    this.losses = Object.freeze(losses);
    this.mode = opts.mode ?? (losses.length === 0 ? "native" : "emulated");
  }

  isAvailable(): boolean { return this.transport.supports("spawn"); }
  spawn(input: { instance_id: string; run_id: string; assignment_path: string; instance: AgentInstanceV1 }): TaskCellMechanicsResult {
    const outcome = this.transport.spawn(this.requestFor(input));
    if (outcome.status !== "succeeded" || !outcome.value) {
      return { ok: false, reason: outcome.detail ?? outcome.reason_code ?? "transport spawn failed" };
    }
    this.handles.set(input.instance_id, outcome.value);
    return { ok: true, reason: null };
  }
  ready(input: { instance_id: string; run_id: string }): TaskCellMechanicsResult {
    return this.handles.has(input.instance_id)
      ? { ok: true, reason: this.mode === "native" ? null : "spawn-confirmed readiness (recorded emulation)" }
      : { ok: false, reason: "no transport handle" };
  }
  notifyAssignment(input: { instance_id: string; run_id: string; assignment_path: string }): TaskCellMechanicsResult {
    const handle = this.handles.get(input.instance_id);
    if (!handle) return { ok: false, reason: "no transport handle" };
    if (this.transport.supports("send")) {
      const outcome = this.transport.send(handle, input.assignment_path);
      return outcome.status === "succeeded"
        ? { ok: true, reason: null }
        : { ok: false, reason: outcome.detail ?? outcome.reason_code ?? "assignment send failed" };
    }
    return this.filesystemAssignmentWakeup
      ? { ok: true, reason: "canonical filesystem assignment channel (recorded emulation)" }
      : { ok: false, reason: "transport cannot deliver an assignment and no filesystem wakeup was declared" };
  }
  terminate(input: { instance_id: string; run_id: string; reason: string }): TaskCellMechanicsResult {
    const handle = this.handles.get(input.instance_id);
    if (!handle) return { ok: false, reason: "no transport handle" };
    if (!this.transport.supports("close")) {
      return { ok: false, reason: "transport cannot confirm worker termination" };
    }
    if (this.transport.supports("interrupt")) {
      const interrupted = this.transport.interrupt(handle, input.reason);
      if (interrupted.status !== "succeeded") {
        return { ok: false, reason: interrupted.detail ?? interrupted.reason_code ?? "interrupt failed" };
      }
    }
    const closed = this.transport.close(handle);
    if (closed.status !== "succeeded") {
      return { ok: false, reason: closed.detail ?? closed.reason_code ?? "close failed" };
    }
    this.handles.delete(input.instance_id);
    return { ok: true, reason: null };
  }
}

interface Live {
  cell: CellHandle;
  handle: InstanceHandle;
  state: TaskCellState;
}

function readJson(file: string): unknown | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export class FilesystemTaskCellRuntime implements TaskCellBackend, TaskCellRecordStore {
  readonly substrate: TaskCellSubstrate;
  readonly parallelism: number;
  readonly records: TaskCellRecordStore = this;
  readonly mechanics_mode: TaskCellMechanicsMode;
  readonly recorded_losses: readonly string[];
  private readonly cwd: string;
  private readonly binding: DispatchBindingEnvelope;
  private readonly worker: TaskCellWorkerPort;
  private readonly now: () => string;
  private readonly idFactory: (kind: "instance" | "attempt" | "validation") => string;
  private readonly cells = new Map<string, CellHandle>();
  private readonly live = new Map<string, Live>();
  private seq = 0;
  private telemetrySeq = 0;

  constructor(opts: FilesystemTaskCellRuntimeOpts) {
    if (!Number.isInteger(opts.parallelism) || opts.parallelism < 1) throw new Error("parallelism must be >= 1");
    this.cwd = path.resolve(opts.cwd);
    this.substrate = opts.substrate;
    this.parallelism = opts.parallelism;
    this.binding = opts.binding;
    this.worker = opts.worker;
    this.mechanics_mode = opts.worker.mode;
    this.recorded_losses = [...opts.worker.losses];
    this.now = opts.now ?? (() => new Date().toISOString());
    this.idFactory = opts.idFactory ?? ((kind) => `${kind}-${process.pid}-${++this.seq}`);
  }

  contentHash(content: string | Buffer): string { return `sha256:${sha256(content)}`; }
  isAvailable(): boolean { return this.worker.isAvailable(); }

  async spawnCell(req: SpawnCellRequest): Promise<CellHandle> {
    if (this.cells.has(req.cell_id)) throw new Error(`cell already spawned: ${req.cell_id}`);
    const cell: CellHandle = Object.freeze({ ...req, instance_ids: Object.freeze([] as string[]) });
    this.cells.set(req.cell_id, cell);
    return cell;
  }

  async spawnInstance(cell: CellHandle, req: SpawnInstanceRequest): Promise<InstanceHandle> {
    if (!this.worker.isAvailable()) throw new Error(`${this.substrate} TaskCell worker substrate is unavailable`);
    const known = this.cells.get(cell.cell_id);
    if (!known) throw new Error(`unknown cell: ${cell.cell_id}`);
    const lineage = attemptLineage(req);
    const instanceId = this.idFactory("instance");
    const attemptId = this.idFactory("attempt");
    const createdAt = this.now();
    const instance: AgentInstanceV1 = {
      schema_version: AGENT_INSTANCE_SCHEMA,
      instance_id: instanceId,
      run_id: cell.run_id,
      cell_id: cell.cell_id,
      logical_task_id: cell.logical_task_id,
      task_run_id: req.task_run_id,
      attempt: lineage.attempt,
      attempt_id: attemptId,
      worker_role: req.worker_role,
      specialist_type_id: req.specialist_type_id,
      specialist_type_version: req.specialist_type_version,
      specialist_type_hash: req.specialist_type_hash,
      specialist_profile_id: req.specialist_profile_id,
      specialist_profile_hash: req.specialist_profile_hash,
      host_id: req.host_id,
      adapter_id: req.adapter_id,
      host_capabilities_hash: req.host_capabilities_hash,
      substrate: this.substrate,
      model_tier: req.model_tier,
      model_id: req.model_id ?? null,
      context_bundle_id: req.context_bundle_id,
      context_bundle_hash: req.context_bundle_hash,
      projection: req.projection,
      budgets: req.budgets,
      created_at: createdAt,
      started_at: null,
      terminated_at: null,
      terminal_state: null,
      terminal_reason: null,
    };
    if (!validateAgentInstanceV1(instance)) throw new Error("invalid guild.agent_instance.v1");
    const attempt: TaskAttemptV1 = {
      schema_version: TASK_ATTEMPT_SCHEMA,
      run_id: cell.run_id,
      cell_id: cell.cell_id,
      logical_task_id: cell.logical_task_id,
      task_run_id: req.task_run_id,
      attempt: lineage.attempt,
      attempt_id: attemptId,
      previous_attempt_id: lineage.previous_attempt_id ?? null,
      retry_reason: lineage.retry_reason ?? null,
      instance_id: instanceId,
      created_at: createdAt,
      terminal_state: null,
      terminal_reason: null,
      terminated_at: null,
      immutable: false,
      orphaned: false,
      reap_attempts: 0,
    };
    writeTaskAttemptV1(this.cwd, attempt, this.binding);
    writeAgentInstanceV1(this.cwd, instance, this.binding);
    const paths = taskCellPaths({ run_id: cell.run_id, logical_task_id: cell.logical_task_id, attempt: lineage.attempt, instance_id: instanceId });
    this.publish(instance, "attempt", paths.attempt_path, createdAt, true);
    this.publish(instance, "instance", paths.instance_path, createdAt, true);
    if (fs.existsSync(path.resolve(this.cwd, req.context_bundle_id))) {
      this.publish(instance, "context", req.context_bundle_id, createdAt, true);
    }
    const handle: InstanceHandle = Object.freeze({
      instance_id: instanceId, cell_id: cell.cell_id, run_id: cell.run_id,
      logical_task_id: cell.logical_task_id, task_run_id: req.task_run_id,
      attempt: lineage.attempt, attempt_id: attemptId, worker_role: req.worker_role,
      substrate: this.substrate, state: "instantiated",
    });
    const contextPath = path.resolve(this.cwd, req.context_bundle_id);
    const contextBytes = (() => {
      try {
        const stat = fs.statSync(contextPath);
        return stat.isFile() ? stat.size : 0;
      } catch { return 0; }
    })();
    this.emitLifecycle(instance, "spawn_started", createdAt, {
      specialist_type_hash: instance.specialist_type_hash,
      specialist_profile_hash: instance.specialist_profile_hash,
      context_bundle_hash: instance.context_bundle_hash,
      host_capabilities_hash: instance.host_capabilities_hash,
      projection_hash: `sha256:${sha256(JSON.stringify(instance.projection))}`,
      context_bundle_bytes: contextBytes,
    });
    const spawned = this.worker.spawn({ instance_id: instanceId, run_id: cell.run_id, assignment_path: paths.assignment_path, instance });
    if (!spawned.ok) {
      const failedAt = this.now();
      sealTerminalAttempt({ cwd: this.cwd, ids: this.ids(handle), terminal_state: "failed", reason: spawned.reason ?? "spawn failed", now: () => failedAt });
      this.emitLifecycle(instance, "failed", failedAt);
      throw new Error(spawned.reason ?? "TaskCell worker spawn failed");
    }
    this.emitLifecycle(instance, "spawned", this.now());
    const nextCell = Object.freeze({ ...known, instance_ids: Object.freeze([...known.instance_ids, instanceId]) });
    this.cells.set(cell.cell_id, nextCell);
    this.live.set(instanceId, { cell: nextCell, handle, state: "instantiated" });
    return handle;
  }

  async awaitReady(instance: InstanceHandle, _opts?: WaitOptions): Promise<AwaitReadyResult> {
    const live = this.mustLive(instance);
    if (live.state !== "instantiated") return this.failure(live, "illegal_state", `expected instantiated, got ${live.state}`);
    const ready = this.worker.ready({ instance_id: instance.instance_id, run_id: instance.run_id });
    if (!ready.ok) return this.forceTerminal(live, "timed_out", ready.reason ?? "worker did not become ready");
    this.transition(live, "ready");
    this.emitLifecycle(live.handle, "ready", this.now());
    return { ok: true, instance: this.snapshot(live) };
  }

  async deliverAssignment(instance: InstanceHandle, raw: unknown): Promise<DeliverAssignmentResult> {
    const live = this.mustLive(instance);
    if (live.state !== "ready") return this.failure(live, "illegal_state", `expected ready, got ${live.state}`);
    const assignment = validateTaskAssignmentV2(raw);
    if (!assignment) return this.forceTerminal(live, "failed", "malformed guild.task_assignment.v2", "malformed_assignment");
    if (assignment.instance_id !== instance.instance_id || assignment.run_id !== instance.run_id ||
        assignment.task_run_id !== instance.task_run_id || assignment.attempt !== instance.attempt) {
      return this.forceTerminal(live, "failed", "assignment identity does not match instance", "identity_mismatch");
    }
    const gate = gateDependencies(assignment.dependencies, findRunAcceptances(this.cwd, assignment.run_id).map((x) => x.acceptance));
    if (!gate.ready) return { ...this.failure(live, "dependencies_blocked", `blocked on ${gate.blocked_on.join(", ")}`), blocked_on: gate.blocked_on };
    const assignmentPath = writeTaskAssignmentV2(this.cwd, assignment, this.binding);
    this.publish(this.instanceRecord(instance), "assignment", assignment.assignment_path, assignment.written_at, true);
    if (fs.existsSync(path.resolve(this.cwd, assignment.context_bundle_id))) {
      this.publish(this.instanceRecord(instance), "context", assignment.context_bundle_id, assignment.written_at, true);
    }
    const notified = this.worker.notifyAssignment({ instance_id: instance.instance_id, run_id: instance.run_id, assignment_path: assignment.assignment_path });
    if (!notified.ok) return this.forceTerminal(live, "failed", notified.reason ?? "assignment delivery failed");
    this.transition(live, "assigned");
    this.emitLifecycle(live.handle, "assignment_delivered", this.now());
    return { ok: true, instance: this.snapshot(live), assignment, assignment_path: assignmentPath };
  }

  async awaitAssignmentAck(instance: InstanceHandle, _opts?: WaitOptions): Promise<AwaitAssignmentAckResult> {
    const live = this.mustLive(instance);
    if (live.state !== "assigned") return this.failure(live, "illegal_state", `expected assigned, got ${live.state}`);
    const ack = readAssignmentAck(this.cwd, this.ids(instance));
    if (!ack) return this.forceTerminal(live, "timed_out", "assignment acknowledgement timed out", "timed_out");
    this.transition(live, "assignment_acknowledged");
    // A synchronous worker may write its durable ack inside notifyAssignment,
    // before deliverAssignment can append assignment_delivered. The ack record
    // preserves the worker-observed time; the ordered lifecycle ledger records
    // when the runtime observed the gate, so replay remains monotonic.
    const observedAt = this.now();
    this.emitLifecycle(live.handle, "assignment_acknowledged", observedAt);
    this.transition(live, "running");
    this.emitLifecycle(live.handle, "running", observedAt);
    return { ok: true, instance: this.snapshot(live), acknowledged_at: ack.acknowledged_at };
  }

  async observe(ref: InstanceRef): Promise<InstanceObservation | null> {
    const live = this.live.get(ref.instance_id);
    if (!live || live.handle.run_id !== ref.run_id) return null;
    const paths = taskCellPaths(this.ids(live.handle));
    const instance = validateAgentInstanceV1(readJson(path.resolve(this.cwd, paths.instance_path)));
    const attempt = validateTaskAttemptV1(readJson(path.resolve(this.cwd, paths.attempt_path)));
    if (!instance || !attempt) return null;
    const assignment = readTaskAssignmentV2(this.cwd, paths.assignment_path);
    const heartbeat = readJson(path.resolve(this.cwd, paths.heartbeat_path)) as Record<string, unknown> | null;
    return { handle: this.snapshot(live), instance, attempt, assignment, last_heartbeat_at: typeof heartbeat?.at === "string" ? heartbeat.at : null };
  }

  async heartbeat(ref: InstanceRef, at: string): Promise<HeartbeatResult> {
    const live = this.live.get(ref.instance_id);
    if (!live || live.handle.run_id !== ref.run_id) {
      return { ok: false, instance: this.unknownHandle(ref), last_heartbeat_at: null };
    }
    const paths = taskCellPaths(this.ids(live.handle));
    fs.writeFileSync(path.resolve(this.cwd, paths.heartbeat_path), JSON.stringify({ schema_version: "guild.task_cell_heartbeat.v1", instance_id: ref.instance_id, at }, null, 2) + "\n");
    this.publish(this.instanceRecord(live.handle), "heartbeat", paths.heartbeat_path, at, true);
    return { ok: true, instance: this.snapshot(live), last_heartbeat_at: at };
  }

  async collectHandoff(instance: InstanceHandle, _opts?: WaitOptions): Promise<CollectHandoffResult> {
    const live = this.mustLive(instance);
    if (live.state !== "running") return this.failure(live, "illegal_state", `expected running, got ${live.state}`);
    const paths = taskCellPaths(this.ids(instance));
    const submitted = readJson(path.resolve(this.cwd, paths.handoff_path)) as SubmittedHandoff | null;
    const assignment = readTaskAssignmentV2(this.cwd, paths.assignment_path);
    if (!submitted || !assignment) return this.failure(live, "timed_out", "handoff not submitted");
    this.transition(live, "handoff_submitted");
    this.emitLifecycle(live.handle, "handoff_submitted", this.now());
    const validation = runDeterministicFloor({ assignment, submitted, validationResultId: this.idFactory("validation"), now: this.now });
    writeValidationRecord(this.cwd, validation);
    if (validation.result !== "passed") return { ...this.failure(live, "validation_failed", validation.reason ?? "validation failed"), validation };
    this.transition(live, "handoff_validated");
    this.emitLifecycle(live.handle, "handoff_validated", validation.validated_at);
    return { ok: true, instance: this.snapshot(live), validation };
  }

  async acceptHandoff(instance: InstanceHandle, req: AcceptHandoffRequest): Promise<AcceptHandoffResult> {
    const live = this.mustLive(instance);
    if (live.state !== "handoff_validated") return this.failure(live, "illegal_state", `expected handoff_validated, got ${live.state}`);
    const validation = this.validationRecord(instance);
    if (!validation) return this.failure(live, "validation_failed", "missing validation record");
    try {
      const acceptance = buildAcceptance({ validation, acceptancePolicyVersion: req.acceptance_policy_version, authoritiesRequired: req.authorities_required, authoritiesObserved: req.authorities_observed, reviewerCellId: req.reviewer_cell_id, now: this.now });
      writeAcceptanceRecord(this.cwd, acceptance);
      this.transition(live, "handoff_accepted");
      this.emitLifecycle(live.handle, "handoff_accepted", acceptance.downstream_release_at ?? acceptance.termination_authorized_at ?? this.now());
      return { ok: true, instance: this.snapshot(live), acceptance };
    } catch (error) {
      return this.failure(live, "not_authorized", error instanceof Error ? error.message : String(error));
    }
  }

  async rejectHandoff(instance: InstanceHandle, req: RejectHandoffRequest): Promise<RejectHandoffResult> {
    const live = this.mustLive(instance);
    if (live.state !== "handoff_submitted" && live.state !== "handoff_validated") return this.failure(live, "illegal_state", `cannot reject from ${live.state}`);
    const validation = this.validationRecord(instance);
    if (!validation) return this.failure(live, "validation_failed", "missing validation record");
    const acceptance = buildRejection({ validation, acceptancePolicyVersion: req.acceptance_policy_version, authoritiesRequired: req.authorities_required, authoritiesObserved: req.authorities_observed, reviewerCellId: req.reviewer_cell_id, reason: req.reason, now: this.now });
    writeAcceptanceRecord(this.cwd, acceptance);
    const terminated = await this.terminate(instance, { force: true, forced_state: "rejected", reason: req.reason });
    if (!terminated.ok) {
      const failed = terminated as OpFailure;
      return {
        ok: false,
        failure: failed.failure,
        reason: failed.reason,
        instance: failed.instance,
        ...(failed.blocked_on ? { blocked_on: failed.blocked_on } : {}),
      };
    }
    return { ok: true, instance: terminated.instance, acceptance };
  }

  async cancel(instance: InstanceHandle, reason: string): Promise<TerminateResult> {
    return this.terminate(instance, { force: true, forced_state: "cancelled", reason });
  }

  async terminate(instance: InstanceHandle, req: TerminateRequest = {}): Promise<TerminateResult> {
    const live = this.mustLive(instance);
    if (["terminated", "failed", "cancelled", "timed_out", "rejected"].includes(live.state)) return this.failure(live, "illegal_state", `${live.state} is terminal`);
    const paths = taskCellPaths(this.ids(instance));
    const acceptance = readJson(path.resolve(this.cwd, paths.acceptance_path)) as Record<string, unknown> | null;
    if (!req.force && (!acceptance || typeof acceptance.termination_authorized_at !== "string")) {
      return this.failure(live, "not_authorized", "no durable termination authorization");
    }
    const forced = req.force === true;
    const target: TerminalState = forced ? (req.forced_state ?? "failed") : "terminated";
    if (forced && !req.reason) return this.failure(live, "not_authorized", "forced termination requires a reason");
    this.emitLifecycle(live.handle, "termination_started", this.now());
    if (!forced) {
      if (live.state === "handoff_accepted") this.transition(live, "terminating");
      else live.state = "terminating";
    }
    const killed = this.worker.terminate({ instance_id: instance.instance_id, run_id: instance.run_id, reason: req.reason ?? "accepted handoff" });
    if (!killed.ok) {
      markAttemptOrphaned(this.cwd, this.ids(instance));
      live.state = "terminating";
      this.emitLifecycle(live.handle, "orphaned", this.now());
      return this.failure(live, "termination_failed", killed.reason ?? "worker termination failed");
    }
    const attempt = sealTerminalAttempt({ cwd: this.cwd, ids: this.ids(instance), terminal_state: target, reason: req.reason ?? null, now: this.now });
    live.state = target;
    const outcome = this.outcome(attempt);
    this.emitLifecycle(live.handle, target, outcome.terminated_at);
    return { ok: true, instance: this.snapshot(live), outcome };
  }

  async awaitTerminated(instance: InstanceHandle, _opts?: WaitOptions): Promise<AwaitTerminatedResult> {
    const live = this.mustLive(instance);
    const attempt = this.attemptRecord(instance);
    if (!attempt?.immutable || attempt.terminal_state === null) return this.failure(live, "timed_out", "instance is not terminal");
    live.state = attempt.terminal_state;
    return { ok: true, instance: this.snapshot(live), outcome: this.outcome(attempt) };
  }

  async reapOrphan(ref: InstanceRef): Promise<ReapResult> {
    const live = this.live.get(ref.instance_id);
    if (!live || live.handle.run_id !== ref.run_id) return { ok: false, reaped: false, instance: this.unknownHandle(ref), reap_attempts: 0, outcome: null };
    const attempt = this.attemptRecord(live.handle);
    if (!attempt?.orphaned || attempt.terminal_state !== null) return { ok: true, reaped: false, instance: this.snapshot(live), reap_attempts: attempt?.reap_attempts ?? 0, outcome: attempt?.terminal_state ? this.outcome(attempt) : null };
    const killed = this.worker.terminate({ instance_id: ref.instance_id, run_id: ref.run_id, reason: "orphan reap" });
    if (!killed.ok) {
      const again = markAttemptOrphaned(this.cwd, this.ids(live.handle));
      this.emitLifecycle(live.handle, "orphaned", this.now());
      return { ok: false, reaped: false, instance: this.snapshot(live), reap_attempts: again.reap_attempts, outcome: null };
    }
    const sealed = sealTerminalAttempt({ cwd: this.cwd, ids: this.ids(live.handle), terminal_state: "terminated", reason: "orphan reaped", orphaned: true, reapAttempts: attempt.reap_attempts, now: this.now });
    live.state = "terminated";
    this.emitLifecycle(live.handle, "reaped", sealed.terminated_at ?? this.now());
    return { ok: true, reaped: true, instance: this.snapshot(live), reap_attempts: sealed.reap_attempts, outcome: this.outcome(sealed) };
  }

  async readRecords(runId: string): Promise<TaskCellRecordSet> {
    const root = path.join(this.cwd, ".guild", "runs", runId, "task-cells");
    const files: string[] = [];
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs); else if (entry.isFile()) files.push(abs);
      }
    };
    walk(root);
    const instances = files.filter((f) => f.endsWith("/instance.json")).map((f) => validateAgentInstanceV1(readJson(f))).filter((x): x is AgentInstanceV1 => x !== null);
    const attempts = files.filter((f) => f.endsWith("/attempt.json")).map((f) => validateTaskAttemptV1(readJson(f))).filter((x): x is TaskAttemptV1 => x !== null);
    const assignments = files.filter((f) => f.endsWith("/assignment.json")).map((f) => validateTaskAssignmentV2(readJson(f))).filter((x): x is TaskAssignmentV2 => x !== null);
    const validations = files.filter((f) => f.endsWith("/handoff-validation.json")).map((f) => readJson(f)).filter((x): x is TaskCellRecordSet["validations"][number] => !!x && (x as { schema_version?: string }).schema_version === "guild.handoff_validation.v1");
    const acceptances = files.filter((f) => f.endsWith("/handoff-acceptance.json")).map((f) => readJson(f)).filter((x): x is TaskCellRecordSet["acceptances"][number] => !!x && (x as { schema_version?: string }).schema_version === "guild.handoff_acceptance.v1");
    return { instances, attempts, assignments, validations, acceptances };
  }

  private publish(instance: AgentInstanceV1, kind: Parameters<typeof publishTaskCellFile>[0]["kind"], relativePath: string, at: string, required: boolean): void {
    const artifact = publishTaskCellFile({ cwd: this.cwd, ids: { run_id: instance.run_id, logical_task_id: instance.logical_task_id, attempt: instance.attempt, instance_id: instance.instance_id }, kind, relativePath, hostId: instance.host_id, role: "task-cell-runtime", now: () => at });
    if (required && artifact === null) throw new Error(`artifact-bus publish failed for ${kind}:${relativePath}`);
  }
  private ids(i: InstanceHandle): { run_id: string; logical_task_id: string; attempt: number; instance_id: string } { return { run_id: i.run_id, logical_task_id: i.logical_task_id, attempt: i.attempt, instance_id: i.instance_id }; }
  private mustLive(i: InstanceHandle): Live { const live = this.live.get(i.instance_id); if (!live || live.handle.run_id !== i.run_id) throw new Error(`unknown instance: ${i.instance_id}`); return live; }
  private snapshot(live: Live): InstanceHandle { return Object.freeze({ ...live.handle, state: live.state }); }
  private transition(live: Live, to: TaskCellState): void { assertTransition(live.state, to); live.state = to; }
  private failure(live: Live, failure: OpFailure["failure"], reason: string): OpFailure { return { ok: false, failure, reason, instance: this.snapshot(live) }; }
  private forceTerminal(live: Live, state: Extract<TerminalState, "failed" | "timed_out">, reason: string, failure: OpFailure["failure"] = "timed_out"): OpFailure {
    this.emitLifecycle(live.handle, "termination_started", this.now());
    const killed = this.worker.terminate({ instance_id: live.handle.instance_id, run_id: live.handle.run_id, reason });
    if (!killed.ok) {
      markAttemptOrphaned(this.cwd, this.ids(live.handle));
      live.state = "terminating";
      this.emitLifecycle(live.handle, "orphaned", this.now());
      return this.failure(
        live,
        "termination_failed",
        `${reason}; cleanup failed: ${killed.reason ?? "worker termination could not be confirmed"}`,
      );
    }
    const attempt = sealTerminalAttempt({ cwd: this.cwd, ids: this.ids(live.handle), terminal_state: state, reason, now: this.now });
    live.state = state;
    this.emitLifecycle(live.handle, state, attempt.terminated_at ?? this.now());
    return this.failure(live, failure, reason);
  }
  private emitLifecycle(
    instance: AgentInstanceV1 | InstanceHandle,
    eventName: TaskCellLifecycleEventName,
    at: string,
    metadata: Partial<Pick<
      import("../../telemetry").TaskCellLifecycleEventInput,
      "specialist_type_hash" | "specialist_profile_hash" | "context_bundle_hash" |
      "host_capabilities_hash" | "projection_hash" | "context_bundle_bytes"
    >> = {},
  ): void {
    const record = "specialist_type_hash" in instance ? instance : this.instanceRecord(instance);
    appendTaskCellLifecycleEvent({
      cwd: this.cwd,
      event: {
        event_id: `${record.instance_id}.${String(++this.telemetrySeq).padStart(6, "0")}.${eventName}`,
        event_name: eventName,
        at,
        run_id: record.run_id,
        cell_id: record.cell_id,
        logical_task_id: record.logical_task_id,
        task_run_id: record.task_run_id,
        attempt: record.attempt,
        attempt_id: record.attempt_id,
        instance_id: record.instance_id,
        substrate: record.substrate,
        mechanics_mode: this.mechanics_mode,
        degradation_reasons: [...this.recorded_losses],
        ...metadata,
      },
    });
  }
  private instanceRecord(i: InstanceHandle): AgentInstanceV1 { const paths = taskCellPaths(this.ids(i)); const record = validateAgentInstanceV1(readJson(path.resolve(this.cwd, paths.instance_path))); if (!record) throw new Error(`missing instance record: ${i.instance_id}`); return record; }
  private attemptRecord(i: InstanceHandle): TaskAttemptV1 | null { const paths = taskCellPaths(this.ids(i)); return validateTaskAttemptV1(readJson(path.resolve(this.cwd, paths.attempt_path))); }
  private validationRecord(i: InstanceHandle): TaskCellRecordSet["validations"][number] | null { const paths = taskCellPaths(this.ids(i)); const value = readJson(path.resolve(this.cwd, paths.validation_path)); return value && (value as { schema_version?: string }).schema_version === "guild.handoff_validation.v1" ? value as TaskCellRecordSet["validations"][number] : null; }
  private outcome(a: TaskAttemptV1): TerminalOutcome { return { instance_id: a.instance_id, state: a.terminal_state!, reason: a.terminal_reason, terminated_at: a.terminated_at!, orphaned: a.orphaned, reap_attempts: a.reap_attempts }; }
  private unknownHandle(ref: InstanceRef): InstanceHandle { return { instance_id: ref.instance_id, run_id: ref.run_id, cell_id: "unknown", logical_task_id: "unknown", task_run_id: "unknown", attempt: 1, attempt_id: "unknown", worker_role: "unknown", substrate: this.substrate, state: "failed" }; }
}

// Re-exported for worker implementations that want to own the ack write directly.
export { acknowledgeAssignment };
