/**
 * src/modules/dispatch/workflows/execution-transport-adapters.ts
 *
 * MH-04 — the BOUNDED adapters that carry the shipped substrates onto
 * `guild.execution.transports.v1`, plus the injected `HostRuntime` execution
 * dependency that selects between them.
 *
 * Each class here is a thin wrapper over an already-shipped seam:
 *
 *   PaneExecutionTransport      → any `PaneAdapter` (bespoke claude/codex/…
 *                                 AND the generic wrapped-CLI adapter)
 *   InProcessExecutionTransport → `InProcessTeamBackend` AND `SerialBackend`
 *   TmuxExecutionTransport      → tmux session mechanics
 *   RemoteExecutionTransport    → any `RemoteTransport` (mock / ssh)
 *
 * "Bounded adapter, not a duplicated host branch" is the load-bearing property:
 * ONE pane class serves every registered host kind, and ONE in-process class
 * serves both the Agent-tool backend and the serial floor. Adding a host adds a
 * registry row and an adapter — it never adds a branch here.
 *
 * Nothing in this file decides lifecycle state, gate outcomes, or policy (BR-04);
 * every method returns a closed `ExecutionOutcome` and never throws.
 */

import {
  EXECUTION_TRANSPORT_CONTRACT_VERSION,
  EXECUTION_TRANSPORT_SCHEMA_VERSION,
  executionOutcome,
  failedExecutionOutcome,
  isExecutionContractCompatible,
  isExecutionTransportId,
  isTeamDispatchScope,
  isTeamLaunchRequestLike,
  redactExecutionDetail,
  selectExecutionSubstrate,
  unsupportedExecutionOutcome,
  validateRemoteProbeFacts,
  type ExecutionCapabilityProbe,
  type ExecutionClock,
  type ExecutionHandle,
  type ExecutionObservationSink,
  type ExecutionOperation,
  type ExecutionOutcome,
  type ExecutionRunFn,
  type ExecutionSpawnRequest,
  type ExecutionSubstrateRequest,
  type ExecutionSubstrateSelection,
  type ExecutionTransportId,
  type ExecutionTransportPort,
  type ExecutionWaitOptions,
  type HostExecutionRuntime,
  type PaneAdapterLike,
  type PaneSpecLike,
  type RemoteExecutionTargetLike,
  type RemoteProbeFacts,
  type RemoteTransportLike,
  type TeamBackendLike,
  type TeamDispatchCollision,
  type TeamDispatchLaunch,
  type TeamDispatchPort,
  type TeamDispatchPreflight,
  type TeamDispatchPreflightFailure,
  type TeamDispatchSession,
  type TeamDispatchTarget,
  type TeamLaunchRequestLike,
  type TeamLaunchResultLike,
} from "./execution-transport-ports";

// ── Shared plumbing ──────────────────────────────────────────────────────────

const NOOP_SINK: ExecutionObservationSink = { record: () => undefined };

/** A sink that keeps every outcome in memory — the default evidence collector. */
export function recordingObservationSink(): ExecutionObservationSink & {
  readonly records: Array<ExecutionOutcome<unknown>>;
} {
  const records: Array<ExecutionOutcome<unknown>> = [];
  return {
    records,
    record: (outcome) => void records.push(outcome),
  };
}

const SYSTEM_CLOCK: ExecutionClock = { now: () => Date.now() };

/** Per-seam re-entrancy state for observation delivery. */
interface ObservationGate {
  delivering: boolean;
}

/**
 * Deliver a DECIDED outcome to the injected observation sink, totally.
 *
 * The sink is a collaborator, not a participant: by the time it is called the
 * outcome is already constructed, frozen, and about to be returned. A defect in
 * the observer is therefore the OBSERVER's failure, and it may not
 *
 *   - turn a decided transport fact into a thrown host error (BR-07: a
 *     transport operation always returns one member of the closed vocabulary), or
 *   - re-enter the seam it is observing without bound. A sink whose `record()`
 *     calls back into the transport or the runtime would otherwise recurse
 *     forever; the gate drops the NESTED observation instead.
 *
 * OBSERVABILITY LIMITATION, stated rather than papered over: when the sink
 * throws, or when an observation is dropped because the sink re-entered the
 * seam, that outcome is NOT durably observed. The failure is deliberately not
 * re-published through the same sink — doing so would recurse through the exact
 * defect that just failed — so this boundary cannot promise that every outcome
 * reached the observability spine. It promises only that the operation itself
 * stays total and that no successful durable-observation claim is manufactured.
 */
function deliverObservation(
  sink: ExecutionObservationSink,
  outcome: ExecutionOutcome<unknown>,
  gate: ObservationGate
): void {
  if (gate.delivering) return;
  gate.delivering = true;
  try {
    sink.record(outcome);
  } catch {
    /* the observer failed; the observed fact is unchanged and still returned */
  } finally {
    gate.delivering = false;
  }
}

/**
 * Base class: publishes the contract identity, funnels every outcome through the
 * injected sink, and answers the whole operation set so no port can silently omit
 * one. Subclasses override only what their substrate can actually do.
 */
abstract class BaseExecutionTransport implements ExecutionTransportPort {
  readonly schema_version = EXECUTION_TRANSPORT_SCHEMA_VERSION;
  readonly contract_version = EXECUTION_TRANSPORT_CONTRACT_VERSION;
  abstract readonly transport_id: ExecutionTransportId;
  protected readonly sink: ExecutionObservationSink;
  /** Per-instance, so one transport's re-entrant sink cannot gag another's. */
  private readonly observationGate: ObservationGate = { delivering: false };
  /** The operations this substrate genuinely performs. */
  protected abstract readonly supported: ReadonlySet<ExecutionOperation>;
  /** Why the unsupported operations are unsupported — stated, never implied. */
  protected abstract readonly unsupportedDetail: string;

  constructor(sink: ExecutionObservationSink = NOOP_SINK) {
    this.sink = sink;
  }

  supports(operation: ExecutionOperation): boolean {
    return this.supported.has(operation);
  }

  /**
   * Publish an outcome to the observation sink and return it UNCHANGED — the
   * same frozen record either way, whether the sink succeeded, threw, or was
   * skipped as re-entrant. See `deliverObservation` for the guarantee and its
   * one honest limitation.
   */
  protected observed<T>(outcome: ExecutionOutcome<T>): ExecutionOutcome<T> {
    deliverObservation(this.sink, outcome as ExecutionOutcome<unknown>, this.observationGate);
    return outcome;
  }

  protected unsupportedOp<T>(operation: ExecutionOperation): ExecutionOutcome<T> {
    return this.observed(
      unsupportedExecutionOutcome<T>(this.transport_id, operation, this.unsupportedDetail)
    );
  }

  spawn(_request: ExecutionSpawnRequest): ExecutionOutcome<ExecutionHandle> {
    return this.unsupportedOp<ExecutionHandle>("spawn");
  }

  send(_handle: ExecutionHandle, _payload: string): ExecutionOutcome<undefined> {
    return this.unsupportedOp<undefined>("send");
  }

  wait(_handle: ExecutionHandle, _options: ExecutionWaitOptions): ExecutionOutcome<undefined> {
    return this.unsupportedOp<undefined>("wait");
  }

  interrupt(_handle: ExecutionHandle, _reason: string): ExecutionOutcome<undefined> {
    return this.unsupportedOp<undefined>("interrupt");
  }

  close(_handle: ExecutionHandle): ExecutionOutcome<undefined> {
    return this.unsupportedOp<undefined>("close");
  }

  connect(_target: RemoteExecutionTargetLike): ExecutionOutcome<undefined> {
    return this.unsupportedOp<undefined>("connect");
  }

  probe(
    _target: RemoteExecutionTargetLike,
    _binaries: readonly string[]
  ): ExecutionOutcome<RemoteProbeFacts> {
    return this.unsupportedOp<RemoteProbeFacts>("probe");
  }
}

// ── PaneAdapter + wrapper seam ───────────────────────────────────────────────

export interface PaneExecutionTransportOpts {
  readonly adapter: PaneAdapterLike;
  readonly run: ExecutionRunFn;
  readonly sink?: ExecutionObservationSink;
  /** Shell used to execute the rendered pane command. */
  readonly shell?: string;
  /**
   * Environment the adapter's env map is layered ON TOP OF. Defaults to the
   * launcher's own environment: passing only the adapter map would hand the pane a
   * process with no PATH, so the host binary the command names could never resolve.
   */
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
}

/**
 * The PaneAdapter seam — and, through the SAME class, the wrapper seam: a
 * `WrappedCliPaneAdapter` is a `PaneAdapterLike` exactly as a `ClaudePaneAdapter`
 * is, so cursor / github-copilot / opencode / rovo-dev route through this one
 * transport with zero per-host code.
 *
 * A PaneAdapter is a preflight probe plus a command/env builder. It owns no live
 * process, so `send`/`wait`/`interrupt`/`close` are honestly UNSUPPORTED rather
 * than faked — which is precisely what the closed unsupported outcome is for.
 */
export class PaneExecutionTransport extends BaseExecutionTransport {
  readonly transport_id = "pane" as const;
  protected readonly supported: ReadonlySet<ExecutionOperation> = new Set<ExecutionOperation>([
    "spawn",
  ]);
  protected readonly unsupportedDetail =
    "a PaneAdapter renders a pane invocation and owns no live process handle";
  private readonly adapter: PaneAdapterLike;
  private readonly run: ExecutionRunFn;
  private readonly shell: string;
  private readonly baseEnv: Readonly<Record<string, string | undefined>>;

  constructor(opts: PaneExecutionTransportOpts) {
    super(opts.sink);
    this.adapter = opts.adapter;
    this.run = opts.run;
    this.shell = opts.shell ?? "sh";
    this.baseEnv = opts.baseEnv ?? process.env;
  }

  override spawn(request: ExecutionSpawnRequest): ExecutionOutcome<ExecutionHandle> {
    const pane = request.pane;
    if (!pane) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "invalid_request",
          detail: "pane spawn requires a pane spec",
        })
      );
    }

    // CH-6 fail-fast: probe the host BEFORE anything is launched. A failed
    // preflight is a typed transport failure, not a thrown host error.
    let preflight: { ok: boolean; message: string };
    try {
      preflight = this.adapter.preflight();
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<ExecutionHandle>(
          this.transport_id,
          "spawn",
          err,
          "transport_unavailable",
          { host_kind: this.adapter.hostKind }
        )
      );
    }
    if (!preflight.ok) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "transport_unavailable",
          detail: preflight.message,
          facts: { host_kind: this.adapter.hostKind, preflight_ok: false },
          assertions: ["preflight failed", "no pane was launched"],
        })
      );
    }

    let command: string;
    let env: Record<string, string>;
    try {
      command = this.adapter.command(pane);
      env = this.adapter.env(pane);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<ExecutionHandle>(this.transport_id, "spawn", err, "spawn_failed", {
          host_kind: this.adapter.hostKind,
        })
      );
    }

    let result;
    try {
      result = this.run(this.shell, ["-c", command], { env: { ...this.baseEnv, ...env } });
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<ExecutionHandle>(this.transport_id, "spawn", err, "spawn_failed", {
          host_kind: this.adapter.hostKind,
        })
      );
    }
    if (result.status === null) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "transport_unavailable",
          detail: `${this.shell} did not run`,
          facts: { host_kind: this.adapter.hostKind },
        })
      );
    }
    if (result.status !== 0) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "spawn_failed",
          detail: result.stderr,
          facts: { host_kind: this.adapter.hostKind, exit_status: result.status },
        })
      );
    }

    const handle: ExecutionHandle = {
      transport_id: this.transport_id,
      handle_id: request.handle_id,
      host_id: request.host_id ?? null,
      host_kind: this.adapter.hostKind,
      invocation: { command, env },
    };
    return this.observed(
      executionOutcome<ExecutionHandle>({
        operation: "spawn",
        transport_id: this.transport_id,
        status: "succeeded",
        value: handle,
        facts: {
          host_kind: this.adapter.hostKind,
          adapter_version: this.adapter.adapterVersion,
          preflight_ok: true,
        },
      })
    );
  }
}

// ── In-process + serial seam ─────────────────────────────────────────────────

export interface InProcessExecutionTransportOpts {
  readonly backend: TeamBackendLike;
  readonly sink?: ExecutionObservationSink;
  /** `in-process` (default) or `serial` — the same adapter, a different floor. */
  readonly transport_id?: Extract<ExecutionTransportId, "in-process" | "serial">;
}

/**
 * The in-process seam. `spawn` composes the Agent-tool dispatch plan through the
 * shipped backend; the host owns the resulting agents, so this transport has no
 * process handle of its own and reports the other operations UNSUPPORTED.
 *
 * `SerialBackend` (the Rung-4 parallelism=1 floor) is the same shape and rides the
 * same class — the serial floor is a different backend, not a different branch.
 */
export class InProcessExecutionTransport extends BaseExecutionTransport {
  readonly transport_id: ExecutionTransportId;
  protected readonly supported: ReadonlySet<ExecutionOperation> = new Set<ExecutionOperation>([
    "spawn",
  ]);
  protected readonly unsupportedDetail =
    "in-process dispatch hands lanes to the host's agent runtime; the transport holds no process handle";
  private readonly backend: TeamBackendLike;

  constructor(opts: InProcessExecutionTransportOpts) {
    super(opts.sink);
    this.backend = opts.backend;
    this.transport_id = opts.transport_id ?? "in-process";
  }

  override spawn(request: ExecutionSpawnRequest): ExecutionOutcome<ExecutionHandle> {
    if (!isTeamLaunchRequestLike(request.payload)) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "invalid_request",
          detail: "in-process spawn requires a team launch request payload",
        })
      );
    }

    let available: boolean;
    try {
      available = this.backend.isAvailable();
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<ExecutionHandle>(
          this.transport_id,
          "spawn",
          err,
          "transport_unavailable"
        )
      );
    }
    if (!available) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "transport_unavailable",
          detail: `backend ${this.backend.kind} reports itself unavailable`,
          facts: { backend_kind: this.backend.kind },
        })
      );
    }

    let result;
    try {
      result = this.backend.launch(request.payload);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<ExecutionHandle>(this.transport_id, "spawn", err, "spawn_failed", {
          backend_kind: this.backend.kind,
        })
      );
    }

    const planSize = Array.isArray(result.dispatchPlan) ? result.dispatchPlan.length : 0;
    const facts = {
      backend_kind: this.backend.kind,
      dispatch_plan_size: planSize,
      planned_command_count: result.plannedCommands.length,
      parallelism: result.parallelism ?? null,
    };
    if (!result.ok) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "spawn_failed",
          detail: result.notes.join(" | "),
          facts,
        })
      );
    }

    const handle: ExecutionHandle = {
      transport_id: this.transport_id,
      handle_id: request.handle_id,
      host_id: request.host_id ?? null,
      host_kind: request.host_kind ?? null,
      invocation: null,
    };
    return this.observed(
      executionOutcome<ExecutionHandle>({
        operation: "spawn",
        transport_id: this.transport_id,
        status: "succeeded",
        value: handle,
        facts,
      })
    );
  }
}

// ── tmux seam ────────────────────────────────────────────────────────────────

export interface TmuxExecutionTransportOpts {
  readonly run: ExecutionRunFn;
  readonly clock?: ExecutionClock;
  readonly sink?: ExecutionObservationSink;
  readonly pollLimit?: number;
}

const DEFAULT_TMUX_POLL_LIMIT = 8;

/**
 * The tmux seam — the only substrate here that owns a real, addressable session,
 * so it is the one that implements the full lifecycle: spawn a detached session,
 * send input, wait for it to end, interrupt it, and close it with CONFIRMATION.
 *
 * `wait` is where three of the five outcome classes become observable:
 *   the session ends normally                     → succeeded
 *   the session ends after the caller interrupted → cancelled
 *   the deadline or the poll budget runs out      → timed_out
 * tmux itself being absent is `transport_unavailable`, never a silent success.
 */
export class TmuxExecutionTransport extends BaseExecutionTransport {
  readonly transport_id = "tmux" as const;
  protected readonly supported: ReadonlySet<ExecutionOperation> = new Set<ExecutionOperation>([
    "spawn",
    "send",
    "wait",
    "interrupt",
    "close",
  ]);
  protected readonly unsupportedDetail =
    "tmux is a local multiplexer; remote connect/probe belong to the remote transport";
  private readonly run: ExecutionRunFn;
  private readonly clock: ExecutionClock;
  private readonly pollLimit: number;
  /** Sessions the caller has interrupted — a later `wait` reports `cancelled`. */
  private readonly interrupted = new Set<string>();

  constructor(opts: TmuxExecutionTransportOpts) {
    super(opts.sink);
    this.run = opts.run;
    this.clock = opts.clock ?? SYSTEM_CLOCK;
    this.pollLimit = opts.pollLimit ?? DEFAULT_TMUX_POLL_LIMIT;
  }

  /** null → tmux itself is unavailable; true/false → session alive / gone. */
  private sessionAlive(handleId: string): boolean | null {
    const result = this.run("tmux", ["has-session", "-t", handleId]);
    if (result.status === null) return null;
    return result.status === 0;
  }

  override spawn(request: ExecutionSpawnRequest): ExecutionOutcome<ExecutionHandle> {
    const command = request.command ?? "";
    if (command.length === 0) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "invalid_request",
          detail: "tmux spawn requires a command",
        })
      );
    }
    const args = [
      "new-session",
      "-d",
      "-s",
      request.handle_id,
      ...(request.cwd ? ["-c", request.cwd] : []),
      command,
    ];
    let result;
    try {
      result = this.run("tmux", args);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<ExecutionHandle>(this.transport_id, "spawn", err, "spawn_failed")
      );
    }
    if (result.status === null) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "transport_unavailable",
          detail: "tmux is not installed or did not run",
        })
      );
    }
    if (result.status !== 0) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "spawn_failed",
          detail: result.stderr,
          facts: { exit_status: result.status },
        })
      );
    }
    const handle: ExecutionHandle = {
      transport_id: this.transport_id,
      handle_id: request.handle_id,
      host_id: request.host_id ?? null,
      host_kind: request.host_kind ?? null,
      invocation: { command, env: {} },
    };
    return this.observed(
      executionOutcome<ExecutionHandle>({
        operation: "spawn",
        transport_id: this.transport_id,
        status: "succeeded",
        value: handle,
        facts: { session: request.handle_id },
      })
    );
  }

  override send(handle: ExecutionHandle, payload: string): ExecutionOutcome<undefined> {
    let result;
    try {
      result = this.run("tmux", ["send-keys", "-t", handle.handle_id, payload, "Enter"]);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<undefined>(this.transport_id, "send", err, "send_failed")
      );
    }
    if (result.status === null) {
      return this.observed(
        executionOutcome<undefined>({
          operation: "send",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "transport_unavailable",
          detail: "tmux is not installed or did not run",
        })
      );
    }
    if (result.status !== 0) {
      return this.observed(
        executionOutcome<undefined>({
          operation: "send",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "send_failed",
          detail: result.stderr,
          facts: { exit_status: result.status },
        })
      );
    }
    return this.observed(
      executionOutcome<undefined>({
        operation: "send",
        transport_id: this.transport_id,
        status: "succeeded",
        facts: { session: handle.handle_id, payload_bytes: payload.length },
      })
    );
  }

  override wait(
    handle: ExecutionHandle,
    options: ExecutionWaitOptions
  ): ExecutionOutcome<undefined> {
    const limit = Math.max(1, options.poll_limit ?? this.pollLimit);
    const wasInterrupted = this.interrupted.has(handle.handle_id);
    const start = this.clock.now();
    let polls = 0;

    while (polls < limit) {
      let alive: boolean | null;
      try {
        alive = this.sessionAlive(handle.handle_id);
      } catch (err) {
        return this.observed(
          failedExecutionOutcome<undefined>(this.transport_id, "wait", err, "wait_failed", {
            polls,
          })
        );
      }
      polls += 1;
      if (alive === null) {
        return this.observed(
          executionOutcome<undefined>({
            operation: "wait",
            transport_id: this.transport_id,
            status: "failed",
            reason_code: "transport_unavailable",
            detail: "tmux is not installed or did not run",
            facts: { polls },
          })
        );
      }
      if (!alive) {
        // The lane is gone. WHY it is gone is a transport fact, not a verdict:
        // an interrupted lane reports `cancelled`, an uninterrupted one `succeeded`.
        return this.observed(
          wasInterrupted
            ? executionOutcome<undefined>({
                operation: "wait",
                transport_id: this.transport_id,
                status: "cancelled",
                reason_code: "cancelled_by_caller",
                detail: "the session ended after an operator interrupt",
                facts: { polls, session: handle.handle_id },
              })
            : executionOutcome<undefined>({
                operation: "wait",
                transport_id: this.transport_id,
                status: "succeeded",
                facts: { polls, session: handle.handle_id },
              })
        );
      }
      if (this.clock.now() - start >= options.timeout_ms) break;
    }

    return this.observed(
      executionOutcome<undefined>({
        operation: "wait",
        transport_id: this.transport_id,
        status: "timed_out",
        reason_code: "deadline_exceeded",
        detail:
          polls >= limit
            ? `poll budget of ${limit} exhausted before the session ended`
            : `deadline of ${options.timeout_ms}ms passed with the session still live`,
        facts: { polls, timeout_ms: options.timeout_ms, session: handle.handle_id },
      })
    );
  }

  override interrupt(handle: ExecutionHandle, reason: string): ExecutionOutcome<undefined> {
    let result;
    try {
      result = this.run("tmux", ["send-keys", "-t", handle.handle_id, "C-c"]);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<undefined>(this.transport_id, "interrupt", err, "interrupt_failed")
      );
    }
    if (result.status === null) {
      return this.observed(
        executionOutcome<undefined>({
          operation: "interrupt",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "transport_unavailable",
          detail: "tmux is not installed or did not run",
        })
      );
    }
    if (result.status !== 0) {
      // The interrupt did NOT land — do not record a cancellation the lane
      // never received, or a later `wait` would report a cancel that never was.
      return this.observed(
        executionOutcome<undefined>({
          operation: "interrupt",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "interrupt_failed",
          detail: result.stderr,
          facts: { exit_status: result.status, session: handle.handle_id },
        })
      );
    }
    this.interrupted.add(handle.handle_id);
    return this.observed(
      executionOutcome<undefined>({
        operation: "interrupt",
        transport_id: this.transport_id,
        status: "succeeded",
        facts: { session: handle.handle_id, interrupt_reason: reason },
      })
    );
  }

  override close(handle: ExecutionHandle): ExecutionOutcome<undefined> {
    let killed;
    try {
      killed = this.run("tmux", ["kill-session", "-t", handle.handle_id]);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<undefined>(this.transport_id, "close", err, "close_failed")
      );
    }
    if (killed.status === null) {
      return this.observed(
        executionOutcome<undefined>({
          operation: "close",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "transport_unavailable",
          detail: "tmux is not installed or did not run",
        })
      );
    }

    // A kill is not a close until the session is CONFIRMED gone; an unconfirmed
    // teardown leaves an orphan and must never be reported as closed.
    let alive: boolean | null;
    try {
      alive = this.sessionAlive(handle.handle_id);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<undefined>(this.transport_id, "close", err, "close_failed")
      );
    }
    if (alive === null) {
      return this.observed(
        executionOutcome<undefined>({
          operation: "close",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "transport_unavailable",
          detail: "tmux became unavailable during close confirmation",
          facts: { confirmed: false },
        })
      );
    }
    if (alive) {
      return this.observed(
        executionOutcome<undefined>({
          operation: "close",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "close_failed",
          detail: `session ${handle.handle_id} is still live after kill-session`,
          facts: { confirmed: false, session: handle.handle_id },
        })
      );
    }
    this.interrupted.delete(handle.handle_id);
    return this.observed(
      executionOutcome<undefined>({
        operation: "close",
        transport_id: this.transport_id,
        status: "succeeded",
        facts: { confirmed: true, session: handle.handle_id },
      })
    );
  }
}

// ── Remote seam ──────────────────────────────────────────────────────────────

export interface RemoteExecutionTransportOpts {
  readonly transport: RemoteTransportLike;
  readonly target: RemoteExecutionTargetLike;
  readonly sink?: ExecutionObservationSink;
}

/**
 * The remote seam. Wraps any `RemoteTransport` (the shipped `MockTransport` and
 * `SshRemoteTransport` both satisfy it structurally) and turns its three failure
 * modes into distinct closed outcomes:
 *
 *   endpoint unreachable        → failed / remote_unreachable
 *   required binary absent      → unsupported / capability_absent  (no fallback)
 *   spawn threw a host error    → failed / spawn_failed, normalized and redacted
 */
export class RemoteExecutionTransport extends BaseExecutionTransport {
  readonly transport_id = "remote" as const;
  protected readonly supported: ReadonlySet<ExecutionOperation> = new Set<ExecutionOperation>([
    "spawn",
    "close",
    "connect",
    "probe",
  ]);
  protected readonly unsupportedDetail =
    "the remote transport spawns detached lanes; it holds no interactive channel to them";
  private readonly transport: RemoteTransportLike;
  private readonly target: RemoteExecutionTargetLike;

  constructor(opts: RemoteExecutionTransportOpts) {
    super(opts.sink);
    this.transport = opts.transport;
    this.target = opts.target;
  }

  override connect(target: RemoteExecutionTargetLike): ExecutionOutcome<undefined> {
    let result;
    try {
      result = this.transport.connect(target);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<undefined>(this.transport_id, "connect", err, "remote_unreachable", {
          host_id: target.hostId,
        })
      );
    }
    if (!result.ok) {
      return this.observed(
        executionOutcome<undefined>({
          operation: "connect",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "remote_unreachable",
          detail: result.message,
          facts: { host_id: target.hostId, endpoint: target.endpoint },
        })
      );
    }
    return this.observed(
      executionOutcome<undefined>({
        operation: "connect",
        transport_id: this.transport_id,
        status: "succeeded",
        detail: result.message,
        facts: { host_id: target.hostId, endpoint: target.endpoint, kind: this.transport.kind },
      })
    );
  }

  override probe(
    target: RemoteExecutionTargetLike,
    binaries: readonly string[]
  ): ExecutionOutcome<RemoteProbeFacts> {
    let raw: unknown;
    try {
      raw = this.transport.probe(target, [...binaries]);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<RemoteProbeFacts>(
          this.transport_id,
          "probe",
          err,
          "remote_unreachable",
          { host_id: target.hostId }
        )
      );
    }

    // The probe RETURNED — but what it returned is untrusted host data. Validate
    // the COMPLETE record before anything reads or joins it, so a partial,
    // non-array, sparse, non-string, throwing-getter or Proxy response becomes a
    // typed failure instead of a property-access exception crossing the boundary.
    //
    // `invalid_request`, not `capability_absent`: a broken response contract is
    // not evidence that the remote host lacks a binary, and reporting it as an
    // absent capability would let a caller act on data that was never valid.
    const validated = validateRemoteProbeFacts(raw);
    const result = validated.value;
    // Both halves are checked: a validator that reported `ok` without producing
    // facts is itself a contract breach, and it must not fall through to a read.
    if (!validated.ok || result === null) {
      return this.observed(
        executionOutcome<RemoteProbeFacts>({
          operation: "probe",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "invalid_request",
          detail: validated.detail ?? "the remote probe response was rejected",
          facts: {
            host_id: target.hostId,
            endpoint: target.endpoint,
            probe_response_valid: false,
          },
          assertions: [
            "the remote probe response did not satisfy the probe contract",
            "no capability claim was derived from it",
            "no fallback is implied",
          ],
        })
      );
    }

    const facts = {
      host_id: target.hostId,
      endpoint: target.endpoint,
      present: result.present.join(","),
      missing: result.missing.join(","),
    };
    if (result.missing.length > 0) {
      // An absent remote binary is an ABSENT CAPABILITY, not a broken transport —
      // and it licenses no fallback host.
      return this.observed(
        executionOutcome<RemoteProbeFacts>({
          operation: "probe",
          transport_id: this.transport_id,
          status: "unsupported",
          reason_code: "capability_absent",
          detail: `remote host ${target.hostId} is missing: ${result.missing.join(", ")}`,
          value: result,
          facts,
          assertions: [
            "the missing capability is named",
            "no fallback is implied",
            "no lane was spawned",
          ],
        })
      );
    }
    return this.observed(
      executionOutcome<RemoteProbeFacts>({
        operation: "probe",
        transport_id: this.transport_id,
        status: "succeeded",
        value: result,
        facts,
      })
    );
  }

  override spawn(request: ExecutionSpawnRequest): ExecutionOutcome<ExecutionHandle> {
    const command = request.command ?? "";
    if (command.length === 0) {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "invalid_request",
          detail: "remote spawn requires a command",
        })
      );
    }
    const spec: PaneSpecLike = request.pane ?? {
      name: request.handle_id,
      scope: "",
      runId: "",
      slug: "",
      prompt: command,
      hostKind: request.host_kind ?? this.target.hostKind,
      specialist: request.handle_id,
    };
    let handleLike;
    try {
      handleLike = this.transport.spawn(this.target, spec, command);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<ExecutionHandle>(this.transport_id, "spawn", err, "spawn_failed", {
          host_id: this.target.hostId,
          endpoint: this.target.endpoint,
        })
      );
    }
    const handle: ExecutionHandle = {
      transport_id: this.transport_id,
      handle_id: handleLike.remoteId,
      host_id: this.target.hostId,
      host_kind: spec.hostKind,
      invocation: { command, env: {} },
    };
    return this.observed(
      executionOutcome<ExecutionHandle>({
        operation: "spawn",
        transport_id: this.transport_id,
        status: "succeeded",
        value: handle,
        facts: {
          host_id: this.target.hostId,
          endpoint: this.target.endpoint,
          remote_id: handleLike.remoteId,
        },
      })
    );
  }

  override close(handle: ExecutionHandle): ExecutionOutcome<undefined> {
    try {
      this.transport.teardown();
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<undefined>(this.transport_id, "close", err, "close_failed", {
          host_id: this.target.hostId,
        })
      );
    }
    return this.observed(
      executionOutcome<undefined>({
        operation: "close",
        transport_id: this.transport_id,
        status: "succeeded",
        facts: { host_id: this.target.hostId, remote_id: handle.handle_id },
      })
    );
  }
}

// ── Run-scoped team dispatch seam ────────────────────────────────────────────

/** One composed substrate command, as the caller would display it. */
export interface TeamSessionCommandLike {
  readonly display: string;
}

export interface TeamSessionPlanLike {
  readonly mode: string;
  readonly targetName: string;
  readonly commands: readonly TeamSessionCommandLike[];
}

export interface TeamSessionSpawnOutcomeLike {
  readonly ok: boolean;
  readonly failedCommand: TeamSessionCommandLike | null;
  readonly stderr: string;
  readonly orchestratorPaneId: string;
  readonly teammatePaneIds: Record<string, string>;
}

export interface TeamSessionPreflightLike {
  readonly ok: boolean;
  readonly failures: ReadonlyArray<{
    specialist: string;
    hostKind: string;
    message: string;
  }>;
}

/**
 * The OPTIONAL session half of a team backend: a substrate that owns an
 * addressable session namespace (availability, target collision, per-host
 * preflight, current session identity, and a plan/spawn split that keeps the
 * exact failed command). `TmuxTeamBackend` satisfies it structurally; the
 * in-process and remote backends do NOT, and their dispatch ports answer those
 * operations `unsupported` rather than faking a session they do not own.
 */
export interface TeamSessionSeamLike {
  sessionExists(name: string): boolean;
  windowExists(name: string): boolean;
  currentSessionName(): string | null;
  preflight(
    specialists: readonly unknown[],
    orchestratorHostKind?: string
  ): TeamSessionPreflightLike;
  plan(request: TeamLaunchRequestLike): TeamSessionPlanLike;
  spawn(plan: TeamSessionPlanLike): TeamSessionSpawnOutcomeLike;
}

export interface TeamDispatchExecutionTransportOpts {
  readonly backend: TeamBackendLike;
  readonly transport_id: Extract<
    ExecutionTransportId,
    "in-process" | "serial" | "tmux" | "remote"
  >;
  /** Present only for substrates that own an addressable session (tmux). */
  readonly session?: TeamSessionSeamLike;
  readonly sink?: ExecutionObservationSink;
}

/**
 * The RUN-SCOPED dispatch seam — one bounded adapter for every team substrate.
 *
 * This is what the production launcher resolves through `transportFor()`: the
 * in-process rung, the remote rung and the tmux rung are the SAME class over
 * three injected backends, not three branches. The tmux rung additionally
 * receives the session seam, which is the only difference between them.
 *
 * It stays a transport (BR-04): it reports availability, collision, preflight
 * facts, session identity and what a launch DID. It never decides whether a
 * collision should abort a run, whether a preflight failure is acceptable, or
 * what any of it means for a lifecycle, a gate, a receipt or a support claim.
 */
export class TeamDispatchExecutionTransport
  extends BaseExecutionTransport
  implements TeamDispatchPort
{
  readonly transport_id: ExecutionTransportId;
  readonly dispatch_kind: string;
  /**
   * The seven generic operations this substrate performs. The dispatch surface
   * below reports under the SAME closed vocabulary — a read is a `probe`, the
   * launch is a `spawn` — because a port may not invent an eighth operation.
   */
  protected readonly supported: ReadonlySet<ExecutionOperation> = new Set<ExecutionOperation>([
    "spawn",
  ]);
  protected readonly unsupportedDetail =
    "a dispatch transport performs run-scoped launches; it holds no per-lane channel";
  private readonly backend: TeamBackendLike;
  private readonly session: TeamSessionSeamLike | null;

  constructor(opts: TeamDispatchExecutionTransportOpts) {
    super(opts.sink);
    this.backend = opts.backend;
    this.transport_id = opts.transport_id;
    this.session = opts.session === undefined ? null : opts.session;
    let kind: unknown;
    try {
      kind = opts.backend.kind;
    } catch {
      kind = undefined;
    }
    this.dispatch_kind = typeof kind === "string" ? kind : opts.transport_id;
  }

  private unsupportedRead<T>(detail: string): ExecutionOutcome<T> {
    return this.observed(unsupportedExecutionOutcome<T>(this.transport_id, "probe", detail));
  }

  available(): ExecutionOutcome<undefined> {
    let ok: unknown;
    try {
      ok = this.backend.isAvailable();
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<undefined>(
          this.transport_id,
          "probe",
          err,
          "transport_unavailable",
          { dispatch_kind: this.dispatch_kind }
        )
      );
    }
    if (ok !== true) {
      return this.observed(
        executionOutcome<undefined>({
          operation: "probe",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "transport_unavailable",
          detail: `backend ${this.dispatch_kind} reports itself unavailable`,
          facts: { dispatch_kind: this.dispatch_kind, available: false },
        })
      );
    }
    return this.observed(
      executionOutcome<undefined>({
        operation: "probe",
        transport_id: this.transport_id,
        status: "succeeded",
        facts: { dispatch_kind: this.dispatch_kind, available: true },
      })
    );
  }

  collision(target: TeamDispatchTarget): ExecutionOutcome<TeamDispatchCollision> {
    const session = this.session;
    if (session === null) {
      return this.unsupportedRead<TeamDispatchCollision>(
        `the ${this.dispatch_kind} substrate owns no addressable session namespace`
      );
    }
    if (
      target === null ||
      typeof target !== "object" ||
      typeof target.target_name !== "string" ||
      !isTeamDispatchScope(target.scope)
    ) {
      return this.observed(
        executionOutcome<TeamDispatchCollision>({
          operation: "probe",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "invalid_request",
          detail: "a collision probe requires a target name and a session|window scope",
        })
      );
    }
    let exists: unknown;
    try {
      exists =
        target.scope === "window"
          ? session.windowExists(target.target_name)
          : session.sessionExists(target.target_name);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchCollision>(
          this.transport_id,
          "probe",
          err,
          "transport_unavailable",
          { dispatch_kind: this.dispatch_kind, target_scope: target.scope }
        )
      );
    }
    const value: TeamDispatchCollision = {
      target_name: target.target_name,
      scope: target.scope,
      exists: exists === true,
    };
    return this.observed(
      executionOutcome<TeamDispatchCollision>({
        operation: "probe",
        transport_id: this.transport_id,
        status: "succeeded",
        value,
        facts: {
          dispatch_kind: this.dispatch_kind,
          target_name: value.target_name,
          target_scope: value.scope,
          target_exists: value.exists,
        },
      })
    );
  }

  preflight(request: TeamLaunchRequestLike): ExecutionOutcome<TeamDispatchPreflight> {
    const session = this.session;
    if (session === null) {
      return this.unsupportedRead<TeamDispatchPreflight>(
        `the ${this.dispatch_kind} substrate opens no host panes to preflight`
      );
    }
    if (!isTeamLaunchRequestLike(request)) {
      return this.observed(
        executionOutcome<TeamDispatchPreflight>({
          operation: "probe",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "invalid_request",
          detail: "a preflight probe requires a team launch request",
        })
      );
    }
    let raw: unknown;
    try {
      raw = session.preflight(request.specialists, request.orchestratorHostKind);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchPreflight>(
          this.transport_id,
          "probe",
          err,
          "transport_unavailable",
          { dispatch_kind: this.dispatch_kind }
        )
      );
    }
    const failures: TeamDispatchPreflightFailure[] = [];
    let reportedOk = false;
    try {
      const record = (raw ?? {}) as { ok?: unknown; failures?: unknown };
      reportedOk = record.ok === true;
      const list = Array.isArray(record.failures) ? record.failures : [];
      for (const entry of list) {
        const failure = (entry ?? {}) as {
          specialist?: unknown;
          hostKind?: unknown;
          message?: unknown;
        };
        failures.push({
          specialist:
            typeof failure.specialist === "string" ? failure.specialist : "(unknown specialist)",
          host_kind: typeof failure.hostKind === "string" ? failure.hostKind : "(unknown host)",
          message: typeof failure.message === "string" ? failure.message : "(no message)",
        });
      }
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchPreflight>(
          this.transport_id,
          "probe",
          err,
          "invalid_request",
          { dispatch_kind: this.dispatch_kind }
        )
      );
    }
    // The PROBE succeeded even when the host dependencies did not: what an unmet
    // dependency means for the run is the caller's decision, never a transport's.
    const ok = reportedOk && failures.length === 0;
    return this.observed(
      executionOutcome<TeamDispatchPreflight>({
        operation: "probe",
        transport_id: this.transport_id,
        status: "succeeded",
        value: { ok, failures },
        facts: {
          dispatch_kind: this.dispatch_kind,
          preflight_ok: ok,
          preflight_failure_count: failures.length,
        },
      })
    );
  }

  sessionIdentity(): ExecutionOutcome<TeamDispatchSession> {
    const session = this.session;
    if (session === null) {
      return this.unsupportedRead<TeamDispatchSession>(
        `the ${this.dispatch_kind} substrate has no current session identity`
      );
    }
    let name: unknown;
    try {
      name = session.currentSessionName();
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchSession>(
          this.transport_id,
          "probe",
          err,
          "transport_unavailable",
          { dispatch_kind: this.dispatch_kind }
        )
      );
    }
    const session_name = typeof name === "string" && name.length > 0 ? name : null;
    return this.observed(
      executionOutcome<TeamDispatchSession>({
        operation: "probe",
        transport_id: this.transport_id,
        status: "succeeded",
        value: { session_name },
        facts: { dispatch_kind: this.dispatch_kind, session_name },
      })
    );
  }

  launch(request: TeamLaunchRequestLike): ExecutionOutcome<TeamDispatchLaunch> {
    if (!isTeamLaunchRequestLike(request)) {
      return this.observed(
        executionOutcome<TeamDispatchLaunch>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "invalid_request",
          detail: "a run-scoped dispatch requires a team launch request",
        })
      );
    }
    // Deliberately NO implicit availability probe: a dry run must never touch the
    // substrate, and the caller owns when — and whether — availability is probed.
    if (this.session !== null && request.dryRun !== true) {
      return this.launchThroughSession(this.session, request);
    }
    return this.launchThroughBackend(request);
  }

  /** The generic path: the backend performs the whole run-scoped launch. */
  private launchThroughBackend(
    request: TeamLaunchRequestLike
  ): ExecutionOutcome<TeamDispatchLaunch> {
    let result: TeamLaunchResultLike;
    try {
      result = this.backend.launch(request);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchLaunch>(
          this.transport_id,
          "spawn",
          err,
          "spawn_failed",
          { dispatch_kind: this.dispatch_kind }
        )
      );
    }
    let value: TeamDispatchLaunch;
    try {
      value = this.normalizeLaunchResult(result, null, null);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchLaunch>(
          this.transport_id,
          "spawn",
          err,
          "invalid_request",
          { dispatch_kind: this.dispatch_kind }
        )
      );
    }
    return this.reportLaunch(value, request);
  }

  /**
   * The session path: `plan()` then `spawn(plan)` — the same two calls the
   * shipped backend's own `launch()` makes, kept SPLIT so the exact failed
   * command and its stderr survive as typed fields instead of being folded into
   * prose the caller would have to parse back out.
   */
  private launchThroughSession(
    session: TeamSessionSeamLike,
    request: TeamLaunchRequestLike
  ): ExecutionOutcome<TeamDispatchLaunch> {
    let plan: TeamSessionPlanLike;
    try {
      plan = session.plan(request);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchLaunch>(
          this.transport_id,
          "spawn",
          err,
          "spawn_failed",
          { dispatch_kind: this.dispatch_kind }
        )
      );
    }
    const planned: string[] = [];
    try {
      const commands = plan === null || plan === undefined ? null : plan.commands;
      if (Array.isArray(commands)) {
        for (const command of commands) {
          if (command !== null && command !== undefined && typeof command.display === "string") {
            planned.push(command.display);
          }
        }
      }
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchLaunch>(
          this.transport_id,
          "spawn",
          err,
          "invalid_request",
          { dispatch_kind: this.dispatch_kind }
        )
      );
    }

    let outcome: TeamSessionSpawnOutcomeLike;
    try {
      outcome = session.spawn(plan);
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchLaunch>(
          this.transport_id,
          "spawn",
          err,
          "spawn_failed",
          { dispatch_kind: this.dispatch_kind, planned_command_count: planned.length }
        )
      );
    }

    let value: TeamDispatchLaunch;
    try {
      const ok = outcome !== null && outcome !== undefined && outcome.ok === true;
      const failedCommand =
        outcome !== null &&
        outcome !== undefined &&
        outcome.failedCommand !== null &&
        outcome.failedCommand !== undefined &&
        typeof outcome.failedCommand.display === "string"
          ? outcome.failedCommand.display
          : null;
      const stderr =
        outcome !== null && outcome !== undefined && typeof outcome.stderr === "string"
          ? outcome.stderr
          : "";
      // Redacted but NOT truncated: this is the operator-facing stderr, and a
      // bounded `detail` already carries the boundary's own summary.
      const failureDetail = ok ? null : redactExecutionDetail(stderr);
      const paneIds: Record<string, string> = {};
      const rawPanes =
        outcome === null || outcome === undefined ? null : outcome.teammatePaneIds;
      if (rawPanes !== null && rawPanes !== undefined && typeof rawPanes === "object") {
        for (const key of Object.keys(rawPanes as Record<string, unknown>)) {
          const paneId = (rawPanes as Record<string, unknown>)[key];
          if (typeof paneId === "string") paneIds[key] = paneId;
        }
      }
      value = {
        kind: this.dispatch_kind,
        ok,
        planned_commands: planned,
        orchestrator_pane_id:
          outcome !== null &&
          outcome !== undefined &&
          typeof outcome.orchestratorPaneId === "string"
            ? outcome.orchestratorPaneId
            : null,
        teammate_pane_ids: paneIds,
        notes: ok
          ? []
          : [`tmux command failed: ${failedCommand ?? "(unknown)"}`, stderr].filter(
              (note) => note.length > 0
            ),
        dispatch_plan: null,
        parallelism: null,
        failed_command: failedCommand,
        failure_detail: failureDetail,
      };
    } catch (err) {
      return this.observed(
        failedExecutionOutcome<TeamDispatchLaunch>(
          this.transport_id,
          "spawn",
          err,
          "invalid_request",
          { dispatch_kind: this.dispatch_kind }
        )
      );
    }
    return this.reportLaunch(value, request);
  }

  /** Map an already-normalized launch onto the closed outcome vocabulary. */
  private reportLaunch(
    value: TeamDispatchLaunch,
    request: TeamLaunchRequestLike
  ): ExecutionOutcome<TeamDispatchLaunch> {
    const facts = {
      dispatch_kind: this.dispatch_kind,
      launch_ok: value.ok,
      dry_run: request.dryRun === true,
      planned_command_count: value.planned_commands.length,
      dispatch_plan_size: value.dispatch_plan === null ? 0 : value.dispatch_plan.length,
      teammate_pane_count: Object.keys(value.teammate_pane_ids).length,
    };
    if (!value.ok) {
      return this.observed(
        executionOutcome<TeamDispatchLaunch>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: "failed",
          reason_code: "spawn_failed",
          detail:
            value.failure_detail !== null && value.failure_detail.length > 0
              ? value.failure_detail
              : value.notes.join(" | "),
          value,
          facts,
        })
      );
    }
    return this.observed(
      executionOutcome<TeamDispatchLaunch>({
        operation: "spawn",
        transport_id: this.transport_id,
        status: "succeeded",
        value,
        facts,
      })
    );
  }

  /** Defensive projection of an untrusted backend launch result. */
  private normalizeLaunchResult(
    result: TeamLaunchResultLike,
    failedCommand: string | null,
    failureDetail: string | null
  ): TeamDispatchLaunch {
    const record = (result ?? {}) as unknown as Record<string, unknown>;
    const planned: string[] = [];
    const rawPlanned = record["plannedCommands"];
    if (Array.isArray(rawPlanned)) {
      for (const command of rawPlanned) if (typeof command === "string") planned.push(command);
    }
    const notes: string[] = [];
    const rawNotes = record["notes"];
    if (Array.isArray(rawNotes)) {
      for (const note of rawNotes) if (typeof note === "string") notes.push(note);
    }
    const paneIds: Record<string, string> = {};
    const rawPanes = record["teammatePaneIds"];
    if (rawPanes !== null && rawPanes !== undefined && typeof rawPanes === "object") {
      for (const key of Object.keys(rawPanes as Record<string, unknown>)) {
        const paneId = (rawPanes as Record<string, unknown>)[key];
        if (typeof paneId === "string") paneIds[key] = paneId;
      }
    }
    const orchestrator = record["orchestratorPaneId"];
    const dispatchPlan = record["dispatchPlan"];
    const parallelism = record["parallelism"];
    const kind = record["kind"];
    return {
      kind: typeof kind === "string" ? kind : this.dispatch_kind,
      ok: record["ok"] === true,
      planned_commands: planned,
      orchestrator_pane_id: typeof orchestrator === "string" ? orchestrator : null,
      teammate_pane_ids: paneIds,
      notes,
      dispatch_plan: Array.isArray(dispatchPlan) ? (dispatchPlan as readonly unknown[]) : null,
      parallelism: typeof parallelism === "number" ? parallelism : null,
      failed_command: failedCommand,
      failure_detail: failureDetail,
    };
  }

  /**
   * The generic seven-operation `spawn`: the SAME run-scoped launch, reported as
   * a handle. There is one launch implementation, reached two ways.
   */
  override spawn(request: ExecutionSpawnRequest): ExecutionOutcome<ExecutionHandle> {
    const launched = this.launch(request.payload as TeamLaunchRequestLike);
    if (launched.status !== "succeeded") {
      return this.observed(
        executionOutcome<ExecutionHandle>({
          operation: "spawn",
          transport_id: this.transport_id,
          status: launched.status,
          reason_code: launched.reason_code,
          detail: launched.detail,
          facts: { dispatch_kind: this.dispatch_kind },
        })
      );
    }
    const handle: ExecutionHandle = {
      transport_id: this.transport_id,
      handle_id: request.handle_id,
      host_id: request.host_id === undefined ? null : request.host_id,
      host_kind: request.host_kind === undefined ? null : request.host_kind,
      invocation: null,
    };
    return this.observed(
      executionOutcome<ExecutionHandle>({
        operation: "spawn",
        transport_id: this.transport_id,
        status: "succeeded",
        value: handle,
        facts: {
          dispatch_kind: this.dispatch_kind,
          planned_command_count:
            launched.value === null ? 0 : launched.value.planned_commands.length,
        },
      })
    );
  }
}

// ── The injected HostRuntime execution dependency ────────────────────────────

export interface HostExecutionRuntimeOpts {
  readonly transports: Partial<Record<ExecutionTransportId, ExecutionTransportPort>>;
  readonly sink?: ExecutionObservationSink;
}

/**
 * Build the execution slice of the `HostRuntime` facade.
 *
 * A caller receives this and asks it for a transport; it never constructs one by
 * branching on a host kind. An unregistered transport and a transport pinned to a
 * foreign contract major are both refused with an explicit `unsupported` outcome —
 * neither silently resolves to "whatever else is available".
 */
export function createHostExecutionRuntime(
  opts: HostExecutionRuntimeOpts
): HostExecutionRuntime {
  const sink = opts.sink ?? NOOP_SINK;
  const transports = { ...opts.transports };
  const ids = Object.keys(transports).filter(isExecutionTransportId) as ExecutionTransportId[];

  // The runtime-local observer is total for exactly the same reason a transport's
  // is: a broken sink may not turn `transportFor()` or `selectSubstrate()` into a
  // thrown host error, and a sink that calls back into this runtime may not
  // recurse. The gate is per-runtime, so it cannot gag a transport's own sink.
  const gate: ObservationGate = { delivering: false };
  const observed = <T>(outcome: ExecutionOutcome<T>): ExecutionOutcome<T> => {
    deliverObservation(sink, outcome as ExecutionOutcome<unknown>, gate);
    return outcome;
  };

  return {
    schema_version: EXECUTION_TRANSPORT_SCHEMA_VERSION,
    contract_version: EXECUTION_TRANSPORT_CONTRACT_VERSION,
    transport_ids: ids,

    selectSubstrate(
      request: ExecutionSubstrateRequest,
      probe: ExecutionCapabilityProbe
    ): ExecutionOutcome<ExecutionSubstrateSelection> {
      const chosen = selectExecutionSubstrate(request, probe);
      return observed(
        executionOutcome<ExecutionSubstrateSelection>({
          // Selection READS capability facts; it decides no lifecycle state.
          operation: "probe",
          transport_id: "runtime",
          status: "succeeded",
          value: chosen,
          facts: {
            dispatch_mode: chosen.dispatch_mode,
            selected_transport: chosen.transport_id,
            degraded_from: chosen.degraded_from,
            selection_reason: chosen.reason,
          },
        })
      );
    },

    transportFor(transport_id: string): ExecutionOutcome<ExecutionTransportPort> {
      const known = isExecutionTransportId(transport_id);
      const reportedId: ExecutionTransportId = known ? transport_id : "runtime";
      const port = known ? transports[transport_id] : undefined;
      if (!port) {
        return observed(
          executionOutcome<ExecutionTransportPort>({
            operation: "connect",
            transport_id: reportedId,
            status: "unsupported",
            reason_code: "operation_unsupported",
            detail: `no transport registered for ${JSON.stringify(transport_id)}`,
            facts: { requested_transport: transport_id, registered: ids.join(",") },
            assertions: ["the requested transport is not registered", "no fallback is implied"],
          })
        );
      }
      if (!isExecutionContractCompatible(port.contract_version)) {
        return observed(
          executionOutcome<ExecutionTransportPort>({
            operation: "connect",
            transport_id: reportedId,
            status: "unsupported",
            reason_code: "contract_version_unsupported",
            detail:
              `transport ${transport_id} declares contract major ` +
              `${String(port.contract_version)}; this runtime speaks ` +
              `${EXECUTION_TRANSPORT_CONTRACT_VERSION}`,
            facts: { requested_transport: transport_id },
            assertions: ["a foreign contract major is refused, never downgraded"],
          })
        );
      }
      return observed(
        executionOutcome<ExecutionTransportPort>({
          operation: "connect",
          transport_id: reportedId,
          status: "succeeded",
          value: port,
          facts: { requested_transport: transport_id },
        })
      );
    },
  };
}
