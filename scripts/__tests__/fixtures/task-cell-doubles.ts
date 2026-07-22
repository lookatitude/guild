/**
 * scripts/__tests__/fixtures/task-cell-doubles.ts
 *
 * The four in-memory substrate doubles for `TaskCellBackend` (G2, task-cell-runtime).
 * Deterministic: no processes, no tmux server, no ssh, no timers, no wall clock.
 *
 * Lives under `__tests__/fixtures/` on purpose — `testPathIgnorePatterns` keeps jest
 * from treating it as a suite, and nothing in `scripts/lib/**` imports it, so the
 * doubles stay OUT of the production import graph.
 *
 * The ADR's central claim (D5) is that lifecycle SEMANTICS are identical across
 * tmux / in-process / serial / remote and only the MECHANICS differ. The doubles are
 * built to make that claim falsifiable rather than assumed: all four inherit one
 * `InMemoryTaskCellBackend` state machine and differ ONLY in
 *
 *   - `substrate` (the label recorded on every instance + assignment),
 *   - `parallelism` (the serial floor is 1; the rest run lanes concurrently),
 *   - the teardown MECHANISM they name when they kill a worker, and
 *   - `isAvailable()` (a substrate can be absent: no tmux server, remote offline).
 *
 * If a substrate ever needed a semantic carve-out, it would have to override a
 * lifecycle method — and the shared conformance suite would immediately show which
 * substrate diverged.
 *
 * Worker behaviour is SCRIPTED, never simulated: a test says `ackAssignment(id)` or
 * `submitHandoff(id, receipt)` or `failTerminationTimes(id, 2)`. Anything a test does
 * not script simply never happens, so "the worker never acked" is the DEFAULT — which
 * is exactly the adversarial-test-4 condition, and it means every happy path in the
 * suite has to state its own preconditions out loud.
 */

import {
  assertTransition,
  assignmentId,
  attemptLineage,
  dependencyGate,
  isTerminal,
  outOfScopeFiles,
  taskCellPaths,
  validateTaskAssignmentV2,
  AGENT_INSTANCE_SCHEMA,
  HANDOFF_ACCEPTANCE_SCHEMA,
  HANDOFF_VALIDATION_SCHEMA,
  TASK_ATTEMPT_SCHEMA,
  type AcceptHandoffRequest,
  type AcceptHandoffResult,
  type AgentInstanceV1,
  type AwaitAssignmentAckResult,
  type AwaitReadyResult,
  type AwaitTerminatedResult,
  type CellHandle,
  type CollectHandoffResult,
  type DeliverAssignmentResult,
  type HandoffAcceptanceV1,
  type HandoffValidationV1,
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
} from "../../lib/core/contracts/task-cell-backend";

/** A monotonic, hermetic clock. Every double gets its own; no wall-clock reads. */
export function fakeClock(startMs = Date.UTC(2026, 6, 14, 0, 0, 0)): () => string {
  let tick = 0;
  return () => new Date(startMs + tick++ * 1000).toISOString();
}

interface LiveInstance {
  state: TaskCellState;
  instance: AgentInstanceV1;
  attempt: TaskAttemptV1;
  assignment: TaskAssignmentV2 | null;
  last_heartbeat_at: string | null;
  /** Substrate liveness: a pane/process that teardown has not yet killed. */
  substrate_alive: boolean;
  terminal: TerminalOutcome | null;
  // ── scripted worker behaviour ──
  ready: boolean;
  ack_queued: boolean;
  handoff_queued: SubmittedHandoff | null;
  termination_failures_remaining: number;
}

export interface TeardownOutcome {
  ok: boolean;
  mechanism: string;
  error?: string;
}

export class InMemoryTaskCellBackend implements TaskCellBackend, TaskCellRecordStore {
  readonly substrate: TaskCellSubstrate;
  readonly parallelism: number;

  protected available = true;
  protected readonly now: () => string;

  private seq = 0;
  private readonly cells = new Map<string, { req: SpawnCellRequest; instance_ids: string[] }>();
  private readonly live = new Map<string, LiveInstance>();
  /**
   * The DURABLE ledgers. These hold the same object references the live map does, so
   * they track mutations — and, crucially, they SURVIVE `simulateOrchestratorCrash()`.
   * On a real backend this is the on-disk run tree; here it is the only thing a resume
   * gets to see.
   */
  private readonly instanceRecords: AgentInstanceV1[] = [];
  private readonly attemptRecords: TaskAttemptV1[] = [];
  /** Keyed by assignment_path — a duplicate write THROWS. "No overwrite" is structural. */
  private readonly assignments = new Map<string, TaskAssignmentV2>();
  private readonly validations: HandoffValidationV1[] = [];
  private readonly acceptances: HandoffAcceptanceV1[] = [];
  /** Every instance_id this backend has ever minted; a repeat is a contract violation. */
  private readonly mintedInstanceIds = new Set<string>();
  /** Teardowns performed, for suites that assert the worker actually died. */
  readonly teardowns: Array<{ instance_id: string; mechanism: string; ok: boolean }> = [];

  constructor(opts: {
    substrate: TaskCellSubstrate;
    parallelism: number;
    now?: () => string;
  }) {
    this.substrate = opts.substrate;
    this.parallelism = opts.parallelism;
    this.now = opts.now ?? fakeClock();
  }

  get records(): TaskCellRecordStore {
    return this;
  }

  isAvailable(): boolean {
    return this.available;
  }

  /** The substrate-specific kill. Overridden per double; the scripted failure is shared. */
  protected teardownMechanism(): string {
    return "in-memory-teardown";
  }

  private teardown(l: LiveInstance): TeardownOutcome {
    const mechanism = this.teardownMechanism();
    if (l.termination_failures_remaining > 0) {
      l.termination_failures_remaining -= 1;
      this.teardowns.push({ instance_id: l.instance.instance_id, mechanism, ok: false });
      return { ok: false, mechanism, error: `${mechanism} failed` };
    }
    l.substrate_alive = false;
    this.teardowns.push({ instance_id: l.instance.instance_id, mechanism, ok: true });
    return { ok: true, mechanism };
  }

  // ── test control surface (NOT part of TaskCellBackend) ─────────────────────

  /** The worker acknowledges its assignment. Without this, `awaitAssignmentAck` times out. */
  ackAssignment(instance_id: string): void {
    this.mustLive(instance_id).ack_queued = true;
  }

  /** The worker writes its `guild.handoff_receipt.v1` and signals completion. */
  submitHandoff(instance_id: string, receipt: SubmittedHandoff): void {
    this.mustLive(instance_id).handoff_queued = receipt;
  }

  /** The next `n` teardowns of this instance fail (adversarial test 6). */
  failTerminationTimes(instance_id: string, n: number): void {
    this.mustLive(instance_id).termination_failures_remaining = n;
  }

  /** The substrate never brings the worker up — `awaitReady` times out. */
  scriptNeverReady(instance_id: string): void {
    this.mustLive(instance_id).ready = false;
  }

  setAvailable(v: boolean): void {
    this.available = v;
  }

  /** Is the pane/process still alive? Used to prove an accepted handoff really kills the worker. */
  isWorkerAlive(instance_id: string): boolean {
    return this.mustLive(instance_id).substrate_alive;
  }

  /**
   * Drop every live handle but keep the durable records — an orchestrator crash.
   * What survives is exactly what a real backend would find on disk.
   */
  simulateOrchestratorCrash(): void {
    this.cells.clear();
    this.live.clear();
  }

  // ── durable record channel ─────────────────────────────────────────────────

  async readRecords(run_id: string): Promise<TaskCellRecordSet> {
    return {
      instances: this.instanceRecords.filter((i) => i.run_id === run_id).map(clone),
      attempts: this.attemptRecords.filter((a) => a.run_id === run_id).map(clone),
      assignments: [...this.assignments.values()].filter((a) => a.run_id === run_id).map(clone),
      validations: this.validations.filter((v) => v.run_id === run_id).map(clone),
      acceptances: this.acceptances.filter((a) => a.run_id === run_id).map(clone),
    };
  }

  // ── 1 · spawnCell ──────────────────────────────────────────────────────────

  async spawnCell(req: SpawnCellRequest): Promise<CellHandle> {
    if (this.cells.has(req.cell_id)) throw new Error(`cell already spawned: ${req.cell_id}`);
    this.cells.set(req.cell_id, { req, instance_ids: [] });
    return this.cellHandle(req.cell_id);
  }

  // ── 2 · spawnInstance ──────────────────────────────────────────────────────

  async spawnInstance(cell: CellHandle, req: SpawnInstanceRequest): Promise<InstanceHandle> {
    const entry = this.cells.get(cell.cell_id);
    if (!entry) throw new Error(`unknown cell: ${cell.cell_id}`);

    // D4 — throws when attempt > 1 arrives without previous_attempt_id + retry_reason.
    const lineage = attemptLineage(req);

    const instance_id = this.mint("inst");
    const attempt_id = this.mint("att");
    const created_at = this.now();

    const instance: AgentInstanceV1 = {
      schema_version: AGENT_INSTANCE_SCHEMA,
      instance_id,
      run_id: entry.req.run_id,
      cell_id: entry.req.cell_id,
      logical_task_id: entry.req.logical_task_id,
      task_run_id: req.task_run_id,
      attempt: lineage.attempt,
      attempt_id,
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
      created_at,
      started_at: null,
      terminated_at: null,
      terminal_state: null,
      terminal_reason: null,
    };

    const attempt: TaskAttemptV1 = {
      schema_version: TASK_ATTEMPT_SCHEMA,
      run_id: entry.req.run_id,
      cell_id: entry.req.cell_id,
      logical_task_id: entry.req.logical_task_id,
      task_run_id: req.task_run_id,
      attempt: lineage.attempt,
      attempt_id,
      previous_attempt_id: lineage.previous_attempt_id ?? null,
      retry_reason: lineage.retry_reason ?? null,
      instance_id,
      created_at,
      terminal_state: null,
      terminal_reason: null,
      terminated_at: null,
      immutable: false,
      orphaned: false,
      reap_attempts: 0,
    };
    this.attemptRecords.push(attempt);
    this.instanceRecords.push(instance);

    const l: LiveInstance = {
      state: "declared",
      instance,
      attempt,
      assignment: null,
      last_heartbeat_at: null,
      substrate_alive: true,
      terminal: null,
      ready: true,
      ack_queued: false,
      handoff_queued: null,
      termination_failures_remaining: 0,
    };
    this.live.set(instance_id, l);
    entry.instance_ids.push(instance_id);

    this.transition(l, "instantiated");
    return this.handle(l);
  }

  // ── 3 · awaitReady ─────────────────────────────────────────────────────────

  async awaitReady(instance: InstanceHandle, _opts?: WaitOptions): Promise<AwaitReadyResult> {
    const l = this.mustLive(instance.instance_id);
    if (l.state !== "instantiated") {
      return this.fail(l, "illegal_state", `awaitReady requires instantiated, got ${l.state}`);
    }
    if (!l.ready) {
      this.recordTerminal(l, "timed_out", "substrate never brought the worker up");
      this.teardown(l);
      return this.fail(l, "timed_out", "worker never became ready");
    }
    this.transition(l, "ready");
    return { ok: true, instance: this.handle(l) };
  }

  // ── 4 · deliverAssignment ──────────────────────────────────────────────────

  async deliverAssignment(
    instance: InstanceHandle,
    raw: unknown
  ): Promise<DeliverAssignmentResult> {
    const l = this.mustLive(instance.instance_id);

    if (l.state !== "ready") {
      return this.fail(l, "illegal_state", `deliverAssignment requires ready, got ${l.state}`);
    }

    // D6 — a malformed or unreadable assignment is a HARD DISPATCH FAILURE. The
    // worker never starts; the instance dies here, it does not log-and-continue.
    const assignment = validateTaskAssignmentV2(raw);
    if (!assignment) {
      this.recordTerminal(l, "failed", "malformed guild.task_assignment.v2");
      this.teardown(l);
      return this.fail(l, "malformed_assignment", "assignment failed fail-closed validation");
    }

    const mismatch = this.identityMismatch(l, assignment);
    if (mismatch) {
      this.recordTerminal(l, "failed", `assignment identity mismatch: ${mismatch}`);
      this.teardown(l);
      return this.fail(l, "identity_mismatch", `assignment identity mismatch: ${mismatch}`);
    }

    // D5 — downstream is released ONLY by a durable acceptance record. An upstream
    // that was rejected (or never accepted) leaves this lane BLOCKED, not failed:
    // it is still a legitimate lane, it just may not start.
    const gate = dependencyGate(assignment.dependencies, this.acceptances);
    if (!gate.ready) {
      return {
        ok: false,
        failure: "dependencies_blocked",
        reason: `upstream not accepted: ${gate.blocked_on.join(", ")}`,
        instance: this.handle(l),
        blocked_on: gate.blocked_on,
      };
    }

    // One immutable assignment per (task_run_id, attempt, instance_id). A second
    // write to the same path is the v1 overwrite class — it throws, it never clobbers.
    if (this.assignments.has(assignment.assignment_path)) {
      throw new Error(
        `assignment overwrite refused at ${assignment.assignment_path} ` +
          `(${assignmentId(assignment)}) — assignments are immutable per instance+attempt`
      );
    }
    this.assignments.set(assignment.assignment_path, assignment);
    l.assignment = assignment;

    this.transition(l, "assigned");
    return {
      ok: true,
      instance: this.handle(l),
      assignment,
      assignment_path: assignment.assignment_path,
    };
  }

  // ── 5 · awaitAssignmentAck ─────────────────────────────────────────────────

  /**
   * The ack gate (D5). This is the ONLY door into `running`: the worker reads and
   * acknowledges its assignment, and only then does the runtime let it work. A worker
   * that never acks is timed out and torn down (adversarial test 4).
   */
  async awaitAssignmentAck(
    instance: InstanceHandle,
    _opts?: WaitOptions
  ): Promise<AwaitAssignmentAckResult> {
    const l = this.mustLive(instance.instance_id);
    if (l.state !== "assigned") {
      return this.fail(
        l,
        "illegal_state",
        `awaitAssignmentAck requires assigned, got ${l.state}`
      );
    }
    if (!l.ack_queued) {
      this.recordTerminal(l, "timed_out", "worker never acknowledged its assignment");
      this.teardown(l);
      return this.fail(l, "timed_out", "no assignment acknowledgment");
    }
    const acknowledged_at = this.now();
    this.transition(l, "assignment_acknowledged");
    this.transition(l, "running");
    l.instance.started_at = acknowledged_at;
    return { ok: true, instance: this.handle(l), acknowledged_at };
  }

  // ── 6 · observe ────────────────────────────────────────────────────────────

  async observe(ref: InstanceRef): Promise<InstanceObservation | null> {
    const l = this.live.get(ref.instance_id);
    if (!l || l.instance.run_id !== ref.run_id) return null;
    return {
      handle: this.handle(l),
      instance: clone(l.instance),
      attempt: clone(l.attempt),
      assignment: l.assignment ? clone(l.assignment) : null,
      last_heartbeat_at: l.last_heartbeat_at,
    };
  }

  // ── 7 · heartbeat ──────────────────────────────────────────────────────────

  async heartbeat(ref: InstanceRef, at: string): Promise<HeartbeatResult> {
    const l = this.live.get(ref.instance_id);
    if (!l || l.instance.run_id !== ref.run_id) {
      throw new Error(`unknown instance: ${ref.instance_id}`);
    }
    if (isTerminal(l.state)) {
      return { ok: false, instance: this.handle(l), last_heartbeat_at: l.last_heartbeat_at };
    }
    l.last_heartbeat_at = at;
    return { ok: true, instance: this.handle(l), last_heartbeat_at: at };
  }

  // ── 8 · collectHandoff ─────────────────────────────────────────────────────

  /**
   * Runs the DETERMINISTIC FLOOR and persists `guild.handoff_validation.v1`.
   * Pure and mechanical — never a model judgement. A receipt that fails the floor
   * stays `handoff_submitted`: it is not validated, cannot be accepted, and has
   * released nothing (adversarial test 5).
   */
  async collectHandoff(
    instance: InstanceHandle,
    _opts?: WaitOptions
  ): Promise<CollectHandoffResult> {
    const l = this.mustLive(instance.instance_id);
    if (l.state !== "running") {
      return this.fail(l, "illegal_state", `collectHandoff requires running, got ${l.state}`);
    }
    if (!l.handoff_queued) {
      this.recordTerminal(l, "timed_out", "worker never submitted a handoff");
      this.teardown(l);
      return this.fail(l, "timed_out", "no handoff submitted");
    }
    const assignment = l.assignment;
    if (!assignment) {
      return this.fail(l, "illegal_state", "running instance has no assignment");
    }

    const receipt = l.handoff_queued;
    this.transition(l, "handoff_submitted");

    const out_of_scope_files = outOfScopeFiles(
      assignment.scope_paths,
      receipt.claimed_changed_files
    );
    const failed_acceptance_tests = assignment.acceptance_tests.filter(
      (t) => !receipt.acceptance_tests_passed.includes(t)
    );
    const schema_valid = receipt.schema_valid;
    const scope_valid = out_of_scope_files.length === 0;
    const tests_passed = failed_acceptance_tests.length === 0;
    const passed = schema_valid && scope_valid && tests_passed;

    const validation: HandoffValidationV1 = {
      schema_version: HANDOFF_VALIDATION_SCHEMA,
      validation_result_id: this.mint("val"),
      run_id: l.instance.run_id,
      cell_id: l.instance.cell_id,
      logical_task_id: l.instance.logical_task_id,
      task_run_id: l.instance.task_run_id,
      attempt: l.instance.attempt,
      instance_id: l.instance.instance_id,
      assignment_id: assignmentId(assignment),
      receipt_id: receipt.receipt_id,
      schema_valid,
      scope_valid,
      tests_passed,
      out_of_scope_files,
      failed_acceptance_tests,
      result: passed ? "passed" : "failed",
      reason: passed
        ? null
        : [
            schema_valid ? null : "receipt is not a schema-valid guild.handoff_receipt.v1",
            scope_valid ? null : `changed files outside scope: ${out_of_scope_files.join(", ")}`,
            tests_passed
              ? null
              : `acceptance tests not passed: ${failed_acceptance_tests.join(", ")}`,
          ]
            .filter(Boolean)
            .join("; "),
      validated_at: this.now(),
    };
    this.validations.push(validation);

    if (!passed) {
      return {
        ok: false,
        failure: "validation_failed",
        reason: validation.reason ?? "deterministic floor failed",
        instance: this.handle(l),
        validation,
      };
    }
    this.transition(l, "handoff_validated");
    return { ok: true, instance: this.handle(l), validation };
  }

  // ── 9 · acceptHandoff ──────────────────────────────────────────────────────

  async acceptHandoff(
    instance: InstanceHandle,
    req: AcceptHandoffRequest
  ): Promise<AcceptHandoffResult> {
    const l = this.mustLive(instance.instance_id);
    if (l.state !== "handoff_validated") {
      // A receipt that never passed the floor can never be accepted (D5).
      return this.fail(
        l,
        l.state === "handoff_submitted" ? "validation_failed" : "illegal_state",
        `acceptHandoff requires handoff_validated, got ${l.state}`
      );
    }
    const validation = this.latestValidation(l.instance.instance_id);
    if (!validation || validation.result !== "passed") {
      return this.fail(l, "validation_failed", "no passing deterministic-floor validation");
    }

    // Resolved decision 3 — every REQUIRED authority must be observed as accepted.
    // A missing or rejecting authority is not a rubber stamp; it writes nothing.
    const missing = req.authorities_required.filter(
      (a) => !req.authorities_observed.some((o) => o.authority === a && o.decision === "accepted")
    );
    if (missing.length > 0) {
      return this.fail(
        l,
        "not_authorized",
        `acceptance authorities not satisfied: ${missing.join(", ")}`
      );
    }

    const at = this.now();
    const acceptance: HandoffAcceptanceV1 = {
      schema_version: HANDOFF_ACCEPTANCE_SCHEMA,
      run_id: l.instance.run_id,
      cell_id: l.instance.cell_id,
      logical_task_id: l.instance.logical_task_id,
      task_run_id: l.instance.task_run_id,
      attempt: l.instance.attempt,
      instance_id: l.instance.instance_id,
      assignment_id: validation.assignment_id,
      receipt_id: validation.receipt_id,
      validation_result_id: validation.validation_result_id,
      acceptance_policy_version: req.acceptance_policy_version,
      authorities_required: [...req.authorities_required],
      authorities_observed: req.authorities_observed.map(clone),
      reviewer_cell_id: req.reviewer_cell_id ?? null,
      downstream_release_at: at,
      termination_authorized_at: at,
    };
    this.acceptances.push(acceptance);
    this.transition(l, "handoff_accepted");
    return { ok: true, instance: this.handle(l), acceptance };
  }

  // ── 10 · rejectHandoff ─────────────────────────────────────────────────────

  /**
   * A rejection is DURABLE, not a silent kill (D5). It writes a
   * `guild.handoff_acceptance.v1` whose `downstream_release_at` is null — so the
   * record exists and is auditable, downstream stays blocked (adversarial test 8),
   * and termination is authorized so the worker can be torn down with an explicit
   * rejection terminal event.
   */
  async rejectHandoff(
    instance: InstanceHandle,
    req: RejectHandoffRequest
  ): Promise<RejectHandoffResult> {
    const l = this.mustLive(instance.instance_id);
    if (l.state !== "handoff_submitted" && l.state !== "handoff_validated") {
      return this.fail(
        l,
        "illegal_state",
        `rejectHandoff requires handoff_submitted|handoff_validated, got ${l.state}`
      );
    }
    const validation = this.latestValidation(l.instance.instance_id);
    const at = this.now();
    const acceptance: HandoffAcceptanceV1 = {
      schema_version: HANDOFF_ACCEPTANCE_SCHEMA,
      run_id: l.instance.run_id,
      cell_id: l.instance.cell_id,
      logical_task_id: l.instance.logical_task_id,
      task_run_id: l.instance.task_run_id,
      attempt: l.instance.attempt,
      instance_id: l.instance.instance_id,
      assignment_id: l.assignment ? assignmentId(l.assignment) : "",
      receipt_id: validation?.receipt_id ?? "",
      validation_result_id: validation?.validation_result_id ?? "",
      acceptance_policy_version: req.acceptance_policy_version,
      authorities_required: [...req.authorities_required],
      authorities_observed: req.authorities_observed.map(clone),
      reviewer_cell_id: req.reviewer_cell_id ?? null,
      downstream_release_at: null,
      termination_authorized_at: at,
    };
    this.acceptances.push(acceptance);

    this.recordTerminal(l, "rejected", req.reason);
    this.teardown(l);
    return { ok: true, instance: this.handle(l), acceptance };
  }

  // ── 11 · cancel ────────────────────────────────────────────────────────────

  async cancel(instance: InstanceHandle, reason: string): Promise<TerminateResult> {
    const l = this.mustLive(instance.instance_id);
    if (isTerminal(l.state)) {
      return this.fail(l, "illegal_state", `cannot cancel a terminal instance (${l.state})`);
    }
    this.recordTerminal(l, "cancelled", reason);
    const t = this.teardown(l);
    if (!t.ok) this.markOrphan(l);
    return { ok: true, instance: this.handle(l), outcome: this.outcome(l) };
  }

  // ── 12 · terminate ─────────────────────────────────────────────────────────

  /**
   * Termination is AUTHORIZED, never assumed. The only two doors:
   *
   *   (a) a durable `guild.handoff_acceptance.v1` carrying `termination_authorized_at`
   *       (the `handoff_accepted` path), or
   *   (b) an explicit forced-terminal policy, which MUST carry a reason and writes a
   *       rejection/failure terminal event — never a silent kill.
   *
   * A receipt sitting on disk authorizes nothing (D5, adversarial test 5).
   */
  async terminate(instance: InstanceHandle, req: TerminateRequest = {}): Promise<TerminateResult> {
    const l = this.mustLive(instance.instance_id);

    // Idempotent reap of an already-terminal instance whose worker is still alive.
    if (isTerminal(l.state)) {
      if (l.substrate_alive) {
        const t = this.teardown(l);
        if (!t.ok) {
          this.markOrphan(l);
          return this.fail(l, "termination_failed", t.error ?? "teardown failed");
        }
      }
      return { ok: true, instance: this.handle(l), outcome: this.outcome(l) };
    }

    if (l.state === "handoff_accepted" || l.state === "terminating") {
      if (!this.terminationAuthorized(l.instance.instance_id)) {
        return this.fail(
          l,
          "not_authorized",
          "no durable acceptance record authorizing termination"
        );
      }
      if (l.state === "handoff_accepted") this.transition(l, "terminating");
      const t = this.teardown(l);
      if (!t.ok) {
        // Adversarial test 6 — the worker survived the kill. Park in `terminating`,
        // record the orphan on the attempt ledger, and leave it for the reaper.
        this.markOrphan(l);
        return this.fail(l, "termination_failed", t.error ?? "teardown failed");
      }
      this.recordTerminal(l, "terminated", null);
      return { ok: true, instance: this.handle(l), outcome: this.outcome(l) };
    }

    if (!req.force) {
      return this.fail(
        l,
        "not_authorized",
        `termination of a ${l.state} instance requires a durable acceptance record ` +
          "or an explicit forced-terminal policy"
      );
    }
    if (!req.reason) {
      return this.fail(l, "not_authorized", "a forced termination must carry a reason");
    }
    const forced: TerminalState = req.forced_state ?? "failed";
    this.recordTerminal(l, forced, req.reason);
    const t = this.teardown(l);
    if (!t.ok) this.markOrphan(l);
    return { ok: true, instance: this.handle(l), outcome: this.outcome(l) };
  }

  // ── 13 · awaitTerminated ───────────────────────────────────────────────────

  async awaitTerminated(
    instance: InstanceHandle,
    _opts?: WaitOptions
  ): Promise<AwaitTerminatedResult> {
    const l = this.mustLive(instance.instance_id);
    if (!isTerminal(l.state) || !l.terminal) {
      return this.fail(l, "timed_out", `instance is still ${l.state}`);
    }
    return { ok: true, instance: this.handle(l), outcome: this.outcome(l) };
  }

  // ── 14 · reapOrphan ────────────────────────────────────────────────────────

  async reapOrphan(ref: InstanceRef): Promise<ReapResult> {
    const l = this.live.get(ref.instance_id);
    if (!l || l.instance.run_id !== ref.run_id) {
      throw new Error(`unknown instance: ${ref.instance_id}`);
    }
    if (!l.attempt.orphaned && !l.substrate_alive) {
      return {
        ok: true,
        reaped: false,
        instance: this.handle(l),
        reap_attempts: l.attempt.reap_attempts,
        outcome: l.terminal ? this.outcome(l) : null,
      };
    }

    const t = this.teardown(l);
    this.bumpReap(l);
    if (!t.ok) {
      return {
        ok: false,
        reaped: false,
        instance: this.handle(l),
        reap_attempts: l.attempt.reap_attempts,
        outcome: l.terminal ? this.outcome(l) : null,
      };
    }
    // The kill finally landed. `terminating` now resolves to `terminated`; an
    // already-terminal record just drops its orphan flag. The orphan is PRESERVED on
    // the outcome either way — the terminal record must remember it was orphaned.
    if (l.state === "terminating") this.recordTerminal(l, "terminated", null);
    l.substrate_alive = false;
    return {
      ok: true,
      reaped: true,
      instance: this.handle(l),
      reap_attempts: l.attempt.reap_attempts,
      outcome: l.terminal ? this.outcome(l) : null,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private mint(prefix: string): string {
    const id = `${prefix}-${this.substrate}-${++this.seq}`;
    if (prefix === "inst") {
      if (this.mintedInstanceIds.has(id)) {
        throw new Error(`instance_id reuse is a D3 violation: ${id}`);
      }
      this.mintedInstanceIds.add(id);
    }
    return id;
  }

  private mustLive(instance_id: string): LiveInstance {
    const l = this.live.get(instance_id);
    if (!l) throw new Error(`unknown instance: ${instance_id}`);
    return l;
  }

  private transition(l: LiveInstance, to: TaskCellState): void {
    assertTransition(l.state, to);
    l.state = to;
  }

  private fail(l: LiveInstance, failure: OpFailure["failure"], reason: string): OpFailure {
    return { ok: false, failure, reason, instance: this.handle(l) };
  }

  private identityMismatch(l: LiveInstance, a: TaskAssignmentV2): string | null {
    const i = l.instance;
    const pairs: Array<[string, string | number, string | number]> = [
      ["run_id", a.run_id, i.run_id],
      ["cell_id", a.cell_id, i.cell_id],
      ["logical_task_id", a.logical_task_id, i.logical_task_id],
      ["task_run_id", a.task_run_id, i.task_run_id],
      ["attempt", a.attempt, i.attempt],
      ["attempt_id", a.attempt_id, i.attempt_id],
      ["instance_id", a.instance_id, i.instance_id],
      ["worker_role", a.worker_role, i.worker_role],
    ];
    for (const [field, got, want] of pairs) {
      if (got !== want) return `${field}=${String(got)} (instance has ${String(want)})`;
    }
    return null;
  }

  /**
   * Seal the attempt. D4: terminal attempts are IMMUTABLE — the terminal DECISION
   * (state, reason, timestamp) can be written exactly once and never revised. Reaper
   * bookkeeping (`orphaned`, `reap_attempts`) may still be appended afterwards; that
   * is what "the terminal state records an orphan, the reaper retries" means.
   */
  private recordTerminal(l: LiveInstance, state: TerminalState, reason: string | null): void {
    if (l.attempt.immutable) {
      throw new Error(
        `terminal attempt ${l.attempt.attempt_id} is immutable — cannot re-terminate ` +
          `(${l.attempt.terminal_state} → ${state}); a retry must mint a new attempt (D4)`
      );
    }
    this.transition(l, state);
    const at = this.now();
    l.attempt.terminal_state = state;
    l.attempt.terminal_reason = reason;
    l.attempt.terminated_at = at;
    l.attempt.immutable = true;
    l.instance.terminal_state = state;
    l.instance.terminal_reason = reason;
    l.instance.terminated_at = at;
    l.terminal = {
      instance_id: l.instance.instance_id,
      state,
      reason,
      terminated_at: at,
      orphaned: l.attempt.orphaned,
      reap_attempts: l.attempt.reap_attempts,
    };
  }

  /**
   * `orphaned` is a HISTORICAL FACT, never cleared: this instance outlived a kill and
   * needed the reaper. The terminal record must remember that (adversarial test 6).
   */
  private markOrphan(l: LiveInstance): void {
    l.attempt.orphaned = true;
  }

  private bumpReap(l: LiveInstance): void {
    l.attempt.reap_attempts += 1;
  }

  private latestValidation(instance_id: string): HandoffValidationV1 | null {
    for (let i = this.validations.length - 1; i >= 0; i--) {
      if (this.validations[i].instance_id === instance_id) return this.validations[i];
    }
    return null;
  }

  private terminationAuthorized(instance_id: string): boolean {
    return this.acceptances.some(
      (a) => a.instance_id === instance_id && a.termination_authorized_at !== null
    );
  }

  private outcome(l: LiveInstance): TerminalOutcome {
    const base = l.terminal;
    if (!base) throw new Error(`instance ${l.instance.instance_id} has no terminal outcome`);
    return { ...base, orphaned: l.attempt.orphaned, reap_attempts: l.attempt.reap_attempts };
  }

  private cellHandle(cell_id: string): CellHandle {
    const entry = this.cells.get(cell_id);
    if (!entry) throw new Error(`unknown cell: ${cell_id}`);
    const { req } = entry;
    return {
      cell_id: req.cell_id,
      run_id: req.run_id,
      logical_task_id: req.logical_task_id,
      goal_id: req.goal_id,
      phase_id: req.phase_id,
      step_id: req.step_id,
      team_id: req.team_id,
      fanout: req.fanout,
      lead: req.lead,
      instance_ids: [...entry.instance_ids],
    };
  }

  private handle(l: LiveInstance): InstanceHandle {
    return {
      instance_id: l.instance.instance_id,
      cell_id: l.instance.cell_id,
      run_id: l.instance.run_id,
      logical_task_id: l.instance.logical_task_id,
      task_run_id: l.instance.task_run_id,
      attempt: l.instance.attempt,
      attempt_id: l.instance.attempt_id,
      worker_role: l.instance.worker_role,
      substrate: this.substrate,
      state: l.state,
    };
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── The four substrates ──────────────────────────────────────────────────────

/** Rung 1 — visible tmux panes. Teardown is `tmux kill-pane`. */
export class TmuxTaskCellDouble extends InMemoryTaskCellBackend {
  constructor(now?: () => string) {
    super({ substrate: "tmux", parallelism: 8, now });
  }
  protected teardownMechanism(): string {
    return "tmux kill-pane";
  }
}

/** Rung 2 — in-process Agent() dispatch on a host with no tmux. Teardown aborts the call. */
export class InProcessTaskCellDouble extends InMemoryTaskCellBackend {
  constructor(now?: () => string) {
    super({ substrate: "in-process", parallelism: 4, now });
  }
  protected teardownMechanism(): string {
    return "abort in-process agent";
  }
}

/** Rung 4 — the serial floor. Its ONLY difference is `parallelism: 1`; semantics are identical. */
export class SerialTaskCellDouble extends InMemoryTaskCellBackend {
  constructor(now?: () => string) {
    super({ substrate: "serial", parallelism: 1, now });
  }
  protected teardownMechanism(): string {
    return "return from inline call";
  }
}

/** Rung 3 — a remote host over ssh. Teardown is a remote kill, and the host can be offline. */
export class RemoteTaskCellDouble extends InMemoryTaskCellBackend {
  constructor(now?: () => string) {
    super({ substrate: "remote", parallelism: 8, now });
  }
  protected teardownMechanism(): string {
    return "ssh kill remote session";
  }
  /** Take the remote host offline — `isAvailable()` goes false, as a real transport would. */
  goOffline(): void {
    this.setAvailable(false);
  }
}

export interface SubstrateDouble {
  name: string;
  make: (now?: () => string) => InMemoryTaskCellBackend;
}

/** The conformance suite runs the SAME assertions against every entry here. */
export const SUBSTRATE_DOUBLES: SubstrateDouble[] = [
  { name: "tmux", make: (now) => new TmuxTaskCellDouble(now) },
  { name: "in-process", make: (now) => new InProcessTaskCellDouble(now) },
  { name: "serial", make: (now) => new SerialTaskCellDouble(now) },
  { name: "remote", make: (now) => new RemoteTaskCellDouble(now) },
];

// ── Fixture builders (keep the suite about lifecycle, not boilerplate) ───────

export function makeSpawnCellRequest(over: Partial<SpawnCellRequest> = {}): SpawnCellRequest {
  return {
    run_id: "run-20260714-tc",
    cell_id: "cell-1",
    goal_id: "goal-1",
    phase_id: "build",
    step_id: "step-1",
    team_id: "team-1",
    logical_task_id: "lt-api",
    fanout: "lead_plus_one",
    lead: { lead_binding_id: "lead-binding-parent-orchestrator" },
    ...over,
  };
}

export function makeSpawnInstanceRequest(
  over: Partial<SpawnInstanceRequest> = {}
): SpawnInstanceRequest {
  return {
    task_run_id: "tr-1",
    attempt: 1,
    worker_role: "backend",
    specialist_type_id: "backend",
    specialist_type_version: "2.0.0",
    specialist_type_hash: "sha256:type-backend",
    specialist_profile_id: "backend",
    specialist_profile_hash: "sha256:profile-backend",
    host_id: "claude-code-cli",
    adapter_id: "claude@1",
    host_capabilities_hash: "sha256:caps",
    model_tier: "mid",
    model_id: "claude-sonnet-5",
    context_bundle_id: "ctx-1",
    context_bundle_hash: "sha256:ctx-1",
    projection: { tools: ["read", "write", "shell"], permissions: ["fs:write"], recorded_losses: [] },
    budgets: { tokens: 50_000, wall_clock_ms: 600_000, cost_usd: 1 },
    ...over,
  };
}

/** Build a well-formed assignment that MATCHES a live instance handle. */
export function makeAssignmentFor(
  cell: CellHandle,
  instance: InstanceHandle,
  over: Partial<Record<string, unknown>> = {}
): TaskAssignmentV2 {
  const paths = taskCellPaths({
    run_id: instance.run_id,
    logical_task_id: instance.logical_task_id,
    attempt: instance.attempt,
    instance_id: instance.instance_id,
  });
  const lineage = attemptLineage({
    attempt: instance.attempt,
    previous_attempt_id: (over["previous_attempt_id"] as string | null) ?? null,
    retry_reason: (over["retry_reason"] as string | null) ?? null,
  });
  const base = {
    schema_version: "guild.task_assignment.v2",
    run_id: instance.run_id,
    cell_id: cell.cell_id,
    goal_id: cell.goal_id,
    phase_id: cell.phase_id,
    step_id: cell.step_id,
    team_id: cell.team_id,
    logical_task_id: instance.logical_task_id,
    task_run_id: instance.task_run_id,
    attempt_id: instance.attempt_id,
    instance_id: instance.instance_id,
    worker_role: instance.worker_role,
    specialist_type_id: "backend",
    specialist_type_version: "2.0.0",
    specialist_type_hash: "sha256:type-backend",
    specialist_profile_id: "backend",
    specialist_profile_hash: "sha256:profile-backend",
    context_bundle_id: `ctx-${instance.instance_id}`,
    context_bundle_hash: `sha256:ctx-${instance.instance_id}`,
    host_id: "claude-code-cli",
    adapter_id: "claude@1",
    host_capabilities_hash: "sha256:caps",
    objective: `implement ${instance.logical_task_id}`,
    non_goals: ["do not touch the launcher"],
    scope_paths: ["src/api"],
    output_schema: "guild.handoff_receipt.v1",
    acceptance_tests: ["npm test -- api"],
    dependencies: [],
    projection: { tools: ["read", "write", "shell"], permissions: ["fs:write"], recorded_losses: [] },
    autonomy_policy: "supervised",
    budgets: { tokens: 50_000, wall_clock_ms: 600_000, cost_usd: 1 },
    deadline: null,
    written_at: "2026-07-14T00:00:00.000Z",
    assignment_path: paths.assignment_path,
    handoff_path: paths.handoff_path,
    heartbeat_path: paths.heartbeat_path,
    cancel_channel: paths.cancel_channel,
    ...lineage,
    ...(cell.lead as Record<string, unknown>),
    ...over,
  };
  return base as unknown as TaskAssignmentV2;
}

/** A receipt that satisfies the deterministic floor for `makeAssignmentFor`'s defaults. */
export function makeValidReceipt(over: Partial<SubmittedHandoff> = {}): SubmittedHandoff {
  return {
    receipt_id: "receipt-1",
    receipt_path: "handoffs/backend-1.md",
    schema_valid: true,
    claimed_changed_files: ["src/api/routes.ts"],
    acceptance_tests_passed: ["npm test -- api"],
    submitted_at: "2026-07-14T00:05:00.000Z",
    ...over,
  };
}

export const ACCEPTANCE_REQ: AcceptHandoffRequest = {
  acceptance_policy_version: "1.0.0",
  authorities_required: ["deterministic_floor", "team_lead"],
  authorities_observed: [
    {
      authority: "deterministic_floor",
      decision: "accepted",
      at: "2026-07-14T00:06:00.000Z",
      reason: null,
    },
    { authority: "team_lead", decision: "accepted", at: "2026-07-14T00:06:01.000Z", reason: null },
  ],
  reviewer_cell_id: null,
};

export const REJECTION_REQ: RejectHandoffRequest = {
  acceptance_policy_version: "1.0.0",
  authorities_required: ["deterministic_floor", "team_lead"],
  authorities_observed: [
    {
      authority: "deterministic_floor",
      decision: "rejected",
      at: "2026-07-14T00:06:00.000Z",
      reason: "receipt failed the deterministic floor",
    },
  ],
  reviewer_cell_id: null,
  reason: "receipt failed the deterministic floor",
};
