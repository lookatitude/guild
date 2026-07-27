/**
 * scripts/__tests__/mh-04-execution-transports.test.ts
 *
 * MH-04 — versioned execution transports (`guild.execution.transports.v1`).
 *
 * Red-first coverage for the six seams the initiative names — PaneAdapter,
 * in-process (+ serial), tmux, remote, wrapper, and launcher — plus the two
 * invariants the runtime-boundary contract makes load-bearing:
 *
 *   BR-04 / MHRC-MOD-003 — execution transports own execution MECHANICS and never
 *     decide lifecycle state, policy, gate outcomes, or receipt semantics. Host
 *     branching is absent from the generic launcher; transport errors come back as
 *     typed outcomes.
 *   BR-07 / MHRC-UNS-001 — an unsupported operation is an EXPLICIT typed outcome
 *     that implies no fallback and causes no side effect; it is never silence.
 *
 * Everything here is pure/injected: no tmux, no ssh, no host binary, no clock.
 */

import * as fs from "fs";
import * as path from "path";

import {
  EXECUTION_TRANSPORT_SCHEMA_VERSION,
  EXECUTION_TRANSPORT_CONTRACT_VERSION,
  EXECUTION_OPERATIONS,
  EXECUTION_OUTCOME_STATUSES,
  EXECUTION_REASON_CODES,
  EXECUTION_TRANSPORT_IDS,
  EXECUTION_DETAIL_MAX_LENGTH,
  EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION,
  EXECUTION_REASON_TO_NEUTRAL_REASON,
  executionOutcome,
  normalizeExecutionError,
  redactExecutionDetail,
  isExecutionContractCompatible,
  selectExecutionSubstrate,
  type ExecutionCapabilityProbe,
  type ExecutionHandle,
  type ExecutionOperation,
  type ExecutionOutcome,
  type ExecutionRunFn,
  type ExecutionRunResult,
  type ExecutionTransportPort,
  type PaneAdapterLike,
  type RemoteTransportLike,
  type TeamBackendLike,
} from "../../src/modules/dispatch/workflows/execution-transport-ports";
import {
  PaneExecutionTransport,
  InProcessExecutionTransport,
  TmuxExecutionTransport,
  RemoteExecutionTransport,
  createHostExecutionRuntime,
  recordingObservationSink,
} from "../../src/modules/dispatch/workflows/execution-transport-adapters";

import {
  NEUTRAL_DISPOSITIONS,
  NEUTRAL_REASON_CODES,
  isNeutralDisposition,
  isNeutralReasonCode,
} from "../../src/modules/lifecycle";

import { buildAdapters, ClaudePaneAdapter, CodexPaneAdapter } from "../lib/pane-adapter";
import {
  InProcessTeamBackend,
  SerialBackend,
  MockTransport,
  paneCommand,
  type PaneSpec,
  type Specialist,
  type TeamLaunchRequest,
} from "../lib/team-backend";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OK: ExecutionRunResult = { status: 0, stdout: "", stderr: "" };
const NONZERO: ExecutionRunResult = { status: 1, stdout: "", stderr: "tmux: boom" };
/** spawnSync's ENOENT shape — the binary is not installed at all. */
const ABSENT: ExecutionRunResult = { status: null, stdout: "", stderr: "" };

interface ScriptedRunner {
  run: ExecutionRunFn;
  calls: Array<{ cmd: string; args: string[] }>;
}

/** A runner that replays a queue, falling back to `tail` once the queue drains. */
function scriptedRun(queue: ExecutionRunResult[], tail: ExecutionRunResult = OK): ScriptedRunner {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const pending = [...queue];
  return {
    calls,
    run: (cmd, args) => {
      calls.push({ cmd, args });
      return pending.length > 0 ? (pending.shift() as ExecutionRunResult) : tail;
    },
  };
}

/** Deterministic clock: every read advances by `step` ms. */
function steppingClock(step: number): { now(): number } {
  let t = 0;
  return {
    now: () => {
      const value = t;
      t += step;
      return value;
    },
  };
}

const SPECIALIST: Specialist = { name: "architect", scope: "boundaries", dependsOn: [] };

const PANE_SPEC: PaneSpec = {
  name: "architect",
  scope: "boundaries",
  runId: "run-mh04",
  slug: "mh04",
  prompt: "do the thing",
  hostKind: "claude",
  taskId: "MH-04",
  specialist: "architect",
};

const LAUNCH_REQUEST: TeamLaunchRequest = {
  slug: "mh04",
  runId: "run-mh04",
  cwd: "/tmp/mh04",
  specialists: [SPECIALIST],
  targetName: "guild-mh04",
  mode: "new-session",
  dryRun: true,
};

const HANDLE: ExecutionHandle = {
  transport_id: "tmux",
  handle_id: "guild-mh04",
  host_id: null,
  host_kind: "claude",
  invocation: null,
};

/** The five operations every transport port must answer for. */
const CORE_OPS: ExecutionOperation[] = ["spawn", "send", "wait", "interrupt", "close"];

function callOperation(
  port: ExecutionTransportPort,
  op: ExecutionOperation
): ExecutionOutcome<unknown> {
  const handle: ExecutionHandle = { ...HANDLE, transport_id: port.transport_id };
  switch (op) {
    case "spawn":
      return port.spawn({ handle_id: "h1", command: "echo hi", host_kind: "claude" });
    case "send":
      return port.send(handle, "hello");
    case "wait":
      return port.wait(handle, { timeout_ms: 10 });
    case "interrupt":
      return port.interrupt(handle, "operator cancelled");
    case "close":
      return port.close(handle);
    case "connect":
      return port.connect({ hostId: "h", hostKind: "claude", endpoint: "user@box" });
    case "probe":
      return port.probe({ hostId: "h", hostKind: "claude", endpoint: "user@box" }, ["tmux"]);
  }
}

/** Every outcome, from every seam, must satisfy the closed contract. */
function assertClosedOutcome(result: ExecutionOutcome<unknown>): void {
  expect(result.schema_version).toBe(EXECUTION_TRANSPORT_SCHEMA_VERSION);
  expect(result.contract_version).toBe(EXECUTION_TRANSPORT_CONTRACT_VERSION);
  expect(EXECUTION_OPERATIONS).toContain(result.operation);
  expect(EXECUTION_TRANSPORT_IDS).toContain(result.transport_id);
  expect(EXECUTION_OUTCOME_STATUSES).toContain(result.status);
  if (result.status === "succeeded") {
    expect(result.reason_code).toBeNull();
    expect(result.outcome.reason_code).toBeNull();
  } else {
    expect(EXECUTION_REASON_CODES).toContain(result.reason_code);
    expect(isNeutralReasonCode(result.outcome.reason_code)).toBe(true);
  }
  // The neutral envelope is a public MH-02 record, closed over MH-02's vocabulary.
  expect(result.outcome.schema_version).toBe("guild.runtime.contracts.v1");
  expect(isNeutralDisposition(result.outcome.disposition)).toBe(true);
  expect(Object.isFrozen(result.outcome)).toBe(true);
  // Transport facts must survive serialization — no Error, no host object.
  expect(() => JSON.stringify(result)).not.toThrow();
  expect(result.facts["transport_status"]).toBe(result.status);
  expect(result.facts["transport_operation"]).toBe(result.operation);
}

// ── 1 · The versioned contract ───────────────────────────────────────────────

describe("guild.execution.transports.v1 — the versioned port contract", () => {
  it("pins a schema version and a contract major", () => {
    expect(EXECUTION_TRANSPORT_SCHEMA_VERSION).toBe("guild.execution.transports.v1");
    expect(EXECUTION_TRANSPORT_CONTRACT_VERSION).toBe(1);
  });

  it("closes the operation vocabulary over spawn/send/wait/interrupt/close + remote ops", () => {
    expect([...EXECUTION_OPERATIONS].sort()).toEqual(
      ["close", "connect", "interrupt", "probe", "send", "spawn", "wait"].sort()
    );
  });

  it("closes the outcome vocabulary over success, failure, cancellation, timeout, unsupported", () => {
    expect([...EXECUTION_OUTCOME_STATUSES].sort()).toEqual(
      ["cancelled", "failed", "succeeded", "timed_out", "unsupported"].sort()
    );
  });

  it("refuses a consumer pinned to a foreign contract major", () => {
    expect(isExecutionContractCompatible(1)).toBe(true);
    expect(isExecutionContractCompatible(2)).toBe(false);
    expect(isExecutionContractCompatible(0)).toBe(false);
  });
});

// ── 2 · The outcome constructor fails closed ─────────────────────────────────

describe("executionOutcome — fail-closed construction", () => {
  it("builds a succeeded outcome with no reason code", () => {
    const result = executionOutcome({
      operation: "spawn",
      transport_id: "tmux",
      status: "succeeded",
    });
    assertClosedOutcome(result);
    expect(result.outcome.disposition).toBe("succeeded");
  });

  it("refuses a succeeded outcome that carries a reason code", () => {
    expect(() =>
      executionOutcome({
        operation: "spawn",
        transport_id: "tmux",
        status: "succeeded",
        reason_code: "spawn_failed",
      })
    ).toThrow(/succeeded/i);
  });

  it("refuses a non-succeeded outcome with no reason code", () => {
    expect(() =>
      executionOutcome({ operation: "spawn", transport_id: "tmux", status: "failed" })
    ).toThrow(/reason_code/i);
  });

  it("refuses an unknown operation, transport, status, or reason code", () => {
    const base = { operation: "spawn", transport_id: "tmux", status: "failed" } as const;
    expect(() =>
      executionOutcome({ ...base, operation: "restart" as ExecutionOperation, reason_code: "spawn_failed" })
    ).toThrow(/operation/i);
    expect(() =>
      executionOutcome({ ...base, transport_id: "carrier-pigeon" as never, reason_code: "spawn_failed" })
    ).toThrow(/transport/i);
    expect(() => executionOutcome({ ...base, status: "maybe" as never, reason_code: "spawn_failed" })).toThrow(
      /status/i
    );
    expect(() => executionOutcome({ ...base, reason_code: "gremlins" as never })).toThrow(/reason/i);
  });

  it("freezes the outcome and its facts so a caller cannot rewrite evidence", () => {
    const result = executionOutcome({
      operation: "wait",
      transport_id: "tmux",
      status: "timed_out",
      reason_code: "deadline_exceeded",
      facts: { elapsed_ms: 30 },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.facts)).toBe(true);
  });
});

// ── 3 · Neutral normalization (BR-04) ────────────────────────────────────────

describe("normalization into the public neutral contract", () => {
  it("maps every execution status onto a real MH-02 disposition", () => {
    for (const status of EXECUTION_OUTCOME_STATUSES) {
      const disposition = EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION[status];
      expect(NEUTRAL_DISPOSITIONS).toContain(disposition);
    }
    expect(EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION["succeeded"]).toBe("succeeded");
    expect(EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION["unsupported"]).toBe("unsupported");
    expect(EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION["failed"]).toBe("failed");
    // A cancellation and a timeout are non-success TRANSPORT facts, never a
    // policy verdict — the exact status survives in `facts.transport_status`.
    expect(EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION["cancelled"]).toBe("failed");
    expect(EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION["timed_out"]).toBe("failed");
  });

  it("maps every execution reason onto a real MH-02 reason code", () => {
    for (const reason of EXECUTION_REASON_CODES) {
      const neutral = EXECUTION_REASON_TO_NEUTRAL_REASON[reason];
      expect(NEUTRAL_REASON_CODES).toContain(neutral);
    }
  });

  it("never emits a policy disposition or a policy reason code (BR-04)", () => {
    // A transport that could say `refused`/`policy_denied` would be deciding gate
    // policy — the one thing BR-04 forbids it from owning.
    const dispositions = Object.values(EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION);
    expect(dispositions).not.toContain("refused");
    const reasons = Object.values(EXECUTION_REASON_TO_NEUTRAL_REASON);
    for (const forbidden of ["policy_denied", "approval_required", "gate_unsatisfied"]) {
      expect(reasons).not.toContain(forbidden);
    }
  });

  it("keeps an authentication failure explicit rather than collapsing it to unsupported (MHRC-UNS-003)", () => {
    const result = executionOutcome({
      operation: "connect",
      transport_id: "remote",
      status: "failed",
      reason_code: "authentication_failed",
    });
    expect(result.status).toBe("failed");
    expect(result.outcome.disposition).toBe("failed");
    expect(result.outcome.reason_code).toBe("authentication_failed");
  });

  it("preserves the exact transport status as a fact even when dispositions merge", () => {
    const cancelled = executionOutcome({
      operation: "wait",
      transport_id: "tmux",
      status: "cancelled",
      reason_code: "cancelled_by_caller",
    });
    const timedOut = executionOutcome({
      operation: "wait",
      transport_id: "tmux",
      status: "timed_out",
      reason_code: "deadline_exceeded",
    });
    expect(cancelled.outcome.disposition).toBe(timedOut.outcome.disposition);
    expect(cancelled.outcome.facts["transport_status"]).toBe("cancelled");
    expect(timedOut.outcome.facts["transport_status"]).toBe("timed_out");
  });
});

// ── 4 · Host-specific errors never leak ──────────────────────────────────────

describe("normalizeExecutionError — host errors stop at the boundary", () => {
  it("strips host-native error fields and keeps a bounded message", () => {
    const hostError = Object.assign(
      new Error("ssh: connect to host 10.0.0.7 port 22: Connection refused"),
      { code: "ECONNREFUSED", errno: -61, syscall: "connect", address: "10.0.0.7" }
    );
    const normalized = normalizeExecutionError(hostError, "remote_unreachable");
    expect(normalized.reason_code).toBe("remote_unreachable");
    expect(typeof normalized.message).toBe("string");
    expect(Object.keys(normalized).sort()).toEqual(["message", "reason_code", "truncated"]);
    expect(JSON.stringify(normalized)).not.toMatch(/ECONNREFUSED|syscall|errno|stack/);
  });

  it("truncates a runaway host error to the published bound", () => {
    const normalized = normalizeExecutionError(new Error("x".repeat(5000)), "spawn_failed");
    expect(normalized.message.length).toBeLessThanOrEqual(EXECUTION_DETAIL_MAX_LENGTH);
    expect(normalized.truncated).toBe(true);
  });

  it("accepts a non-Error throw without leaking its shape", () => {
    const normalized = normalizeExecutionError({ weird: { nested: true } }, "spawn_failed");
    expect(typeof normalized.message).toBe("string");
    expect(normalized.message).not.toMatch(/\[object Object\]/);
  });

  it("redacts credentials before they reach the evidence trail (MHRC-UNS-003)", () => {
    const detail = redactExecutionDetail(
      "env OPENAI_API_KEY=sk-live-4b2f9 ANTHROPIC_API_KEY=sk-ant-zzz " +
        "Authorization: Bearer abcdef123456 password=hunter2 ssh://user:s3cret@box"
    );
    expect(detail).not.toMatch(/sk-live-4b2f9|sk-ant-zzz|abcdef123456|hunter2|s3cret/);
    expect(detail).toMatch(/\[redacted\]/);
  });

  it("routes a thrown host error through the outcome, never through an exception", () => {
    const transport = new RemoteExecutionTransport({
      transport: {
        kind: "exploding",
        connect: () => ({ ok: true, message: "ok" }),
        probe: () => ({ present: ["tmux"], missing: [] }),
        spawn: () => {
          throw Object.assign(new Error("tmux: no server running on /private/tmp/tmux-501"), {
            code: "ENOENT",
          });
        },
        teardown: () => undefined,
      },
      target: { hostId: "box", hostKind: "claude", endpoint: "user@box" },
    });
    const result = transport.spawn({ handle_id: "lane-1", command: "claude 'go'" });
    assertClosedOutcome(result);
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("spawn_failed");
    expect(JSON.stringify(result)).not.toMatch(/ENOENT/);
  });
});

// ── 5 · PaneAdapter + wrapper seams ──────────────────────────────────────────

describe("PaneExecutionTransport — the PaneAdapter and wrapper seams", () => {
  const spawnRequest = {
    handle_id: "architect",
    command: "",
    host_kind: "claude",
    pane: PANE_SPEC,
  };

  it("renders and launches a pane invocation when preflight passes", () => {
    const runner = scriptedRun([OK]);
    const transport = new PaneExecutionTransport({
      adapter: new ClaudePaneAdapter({ run: () => ({ status: 0, stdout: "", stderr: "" }) }),
      run: runner.run,
    });
    const result = transport.spawn(spawnRequest);
    assertClosedOutcome(result);
    expect(result.status).toBe("succeeded");
    expect(result.value?.invocation?.command).toBe(paneCommand(
      PANE_SPEC.prompt,
      PANE_SPEC.runId,
      PANE_SPEC.capability_scope,
      PANE_SPEC.taskId,
      PANE_SPEC.specialist
    ));
  });

  it("turns a failed preflight into a typed failure, and spawns nothing (CH-6 fail-fast)", () => {
    const runner = scriptedRun([OK]);
    const transport = new PaneExecutionTransport({
      adapter: new ClaudePaneAdapter({ run: () => ({ status: 127, stdout: "", stderr: "not found" }) }),
      run: runner.run,
    });
    const result = transport.spawn(spawnRequest);
    assertClosedOutcome(result);
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("transport_unavailable");
    expect(runner.calls).toHaveLength(0);
  });

  it("reports send/wait/interrupt/close as UNSUPPORTED with no side effect (MHRC-UNS-001)", () => {
    const runner = scriptedRun([]);
    const transport = new PaneExecutionTransport({
      adapter: new CodexPaneAdapter({
        run: () => ({ status: 0, stdout: "", stderr: "" }),
        env: { OPENAI_API_KEY: "k" },
      }),
      run: runner.run,
    });
    for (const op of ["send", "wait", "interrupt", "close"] as ExecutionOperation[]) {
      const result = callOperation(transport, op);
      assertClosedOutcome(result);
      expect(result.status).toBe("unsupported");
      expect(result.reason_code).toBe("operation_unsupported");
      expect(transport.supports(op)).toBe(false);
    }
    expect(runner.calls).toHaveLength(0);
  });

  it("carries every registered host — bespoke AND wrapped — through ONE bounded adapter", () => {
    const adapters = buildAdapters({
      run: () => ({ status: 0, stdout: "", stderr: "" }),
      env: { OPENAI_API_KEY: "k" },
    });
    const kinds = Object.keys(adapters);
    // The registry ships bespoke (claude/codex/antigravity-2/pi) AND generic
    // wrapped-CLI rows; both must flow through the same transport class.
    expect(kinds).toEqual(expect.arrayContaining(["claude", "codex", "cursor"]));
    for (const kind of kinds) {
      const adapter = adapters[kind as keyof typeof adapters] as PaneAdapterLike;
      const transport = new PaneExecutionTransport({ adapter, run: scriptedRun([OK]).run });
      const spec: PaneSpec = { ...PANE_SPEC, hostKind: kind as PaneSpec["hostKind"] };
      const result = transport.spawn({ handle_id: "architect", pane: spec, host_kind: kind });
      assertClosedOutcome(result);
      expect(result.status).toBe("succeeded");
      // Bounded adapter, not a re-implementation: the command is the adapter's own.
      expect(result.value?.invocation?.command).toBe(adapter.command(spec));
      expect(result.value?.invocation?.env).toEqual(adapter.env(spec));
    }
  });
});

// ── 6 · In-process + serial seams ────────────────────────────────────────────

describe("InProcessExecutionTransport — the in-process and serial seams", () => {
  it("spawns an Agent-tool dispatch plan through the shipped backend", () => {
    const transport = new InProcessExecutionTransport({ backend: new InProcessTeamBackend() });
    const result = transport.spawn({ handle_id: "mh04", payload: LAUNCH_REQUEST });
    assertClosedOutcome(result);
    expect(result.status).toBe("succeeded");
    expect(result.facts["dispatch_plan_size"]).toBe(1);
  });

  it("covers the serial floor with the SAME adapter (no duplicated host branch)", () => {
    const transport = new InProcessExecutionTransport({
      backend: new SerialBackend() as TeamBackendLike,
      transport_id: "serial",
    });
    const result = transport.spawn({ handle_id: "mh04", payload: LAUNCH_REQUEST });
    assertClosedOutcome(result);
    expect(result.status).toBe("succeeded");
    expect(result.transport_id).toBe("serial");
    expect(result.facts["backend_kind"]).toBe("serial");
  });

  it("fails typed when the backend is unavailable", () => {
    const transport = new InProcessExecutionTransport({
      backend: { kind: "in-process", isAvailable: () => false, launch: () => {
        throw new Error("must not be called");
      } },
    });
    const result = transport.spawn({ handle_id: "mh04", payload: LAUNCH_REQUEST });
    assertClosedOutcome(result);
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("transport_unavailable");
  });

  it("fails typed on a malformed launch payload instead of throwing", () => {
    const transport = new InProcessExecutionTransport({ backend: new InProcessTeamBackend() });
    const result = transport.spawn({ handle_id: "mh04", payload: { nope: true } });
    assertClosedOutcome(result);
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("invalid_request");
  });

  it("reports a backend that returns ok:false as a typed failure", () => {
    const transport = new InProcessExecutionTransport({
      backend: {
        kind: "in-process",
        isAvailable: () => true,
        launch: () => ({
          kind: "in-process",
          ok: false,
          plannedCommands: [],
          orchestratorPaneId: null,
          teammatePaneIds: {},
          notes: ["backend said no"],
        }),
      },
    });
    const result = transport.spawn({ handle_id: "mh04", payload: LAUNCH_REQUEST });
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("spawn_failed");
  });

  it("reports the non-spawn operations as unsupported", () => {
    const transport = new InProcessExecutionTransport({ backend: new InProcessTeamBackend() });
    for (const op of ["send", "wait", "interrupt", "close"] as ExecutionOperation[]) {
      const result = callOperation(transport, op);
      assertClosedOutcome(result);
      expect(result.status).toBe("unsupported");
    }
  });
});

// ── 7 · tmux seam — the full lifecycle, including cancel + timeout ───────────

describe("TmuxExecutionTransport — the tmux seam", () => {
  function tmux(queue: ExecutionRunResult[], clockStep = 5) {
    const runner = scriptedRun(queue);
    return {
      runner,
      transport: new TmuxExecutionTransport({ run: runner.run, clock: steppingClock(clockStep) }),
    };
  }

  it("spawns a detached session and returns a handle", () => {
    const { transport, runner } = tmux([OK]);
    const result = transport.spawn({ handle_id: "guild-mh04", command: "claude 'go'", cwd: "/tmp/mh04" });
    assertClosedOutcome(result);
    expect(result.status).toBe("succeeded");
    expect(result.value?.handle_id).toBe("guild-mh04");
    expect(runner.calls[0].args.slice(0, 4)).toEqual(["new-session", "-d", "-s", "guild-mh04"]);
  });

  it("fails typed when tmux rejects the spawn", () => {
    const { transport } = tmux([NONZERO]);
    const result = transport.spawn({ handle_id: "guild-mh04", command: "claude 'go'" });
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("spawn_failed");
  });

  it("fails typed with transport_unavailable when tmux is not installed", () => {
    const { transport } = tmux([ABSENT]);
    const result = transport.spawn({ handle_id: "guild-mh04", command: "claude 'go'" });
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("transport_unavailable");
  });

  it("refuses a spawn request with no command instead of building a broken one", () => {
    const { transport, runner } = tmux([OK]);
    const result = transport.spawn({ handle_id: "guild-mh04" });
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("invalid_request");
    expect(runner.calls).toHaveLength(0);
  });

  it("sends a payload through send-keys, and reports a send failure typed", () => {
    const { transport, runner } = tmux([OK]);
    const ok = transport.send(HANDLE, "status?");
    assertClosedOutcome(ok);
    expect(ok.status).toBe("succeeded");
    expect(runner.calls[0].args[0]).toBe("send-keys");

    const { transport: bad } = tmux([NONZERO]);
    const failure = bad.send(HANDLE, "status?");
    expect(failure.status).toBe("failed");
    expect(failure.reason_code).toBe("send_failed");
  });

  it("waits until the session is gone → succeeded", () => {
    // has-session: alive, alive, gone
    const { transport } = tmux([OK, OK, NONZERO]);
    const result = transport.wait(HANDLE, { timeout_ms: 1000 });
    assertClosedOutcome(result);
    expect(result.status).toBe("succeeded");
  });

  it("returns TIMED_OUT when the deadline passes with the session still live", () => {
    const { transport } = tmux([OK, OK, OK, OK, OK, OK, OK, OK], 100);
    const result = transport.wait(HANDLE, { timeout_ms: 150 });
    assertClosedOutcome(result);
    expect(result.status).toBe("timed_out");
    expect(result.reason_code).toBe("deadline_exceeded");
  });

  it("returns CANCELLED when the caller interrupted the lane first", () => {
    const runner = scriptedRun([OK, NONZERO]); // interrupt ok, then has-session: gone
    const transport = new TmuxExecutionTransport({ run: runner.run, clock: steppingClock(5) });
    const interrupted = transport.interrupt(HANDLE, "operator cancelled");
    assertClosedOutcome(interrupted);
    expect(interrupted.status).toBe("succeeded");

    const result = transport.wait(HANDLE, { timeout_ms: 1000 });
    assertClosedOutcome(result);
    expect(result.status).toBe("cancelled");
    expect(result.reason_code).toBe("cancelled_by_caller");
  });

  it("reports a failed interrupt typed rather than pretending the lane stopped", () => {
    const { transport } = tmux([NONZERO]);
    const result = transport.interrupt(HANDLE, "operator cancelled");
    assertClosedOutcome(result);
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("interrupt_failed");
  });

  it("closes the session and CONFIRMS it is gone", () => {
    const { transport } = tmux([OK, NONZERO]); // kill-session ok, has-session gone
    const result = transport.close(HANDLE);
    assertClosedOutcome(result);
    expect(result.status).toBe("succeeded");
    expect(result.facts["confirmed"]).toBe(true);
  });

  it("reports an unconfirmed close as a failure (the lane is an orphan, not closed)", () => {
    const { transport } = tmux([OK, OK]); // kill-session ok, has-session STILL alive
    const result = transport.close(HANDLE);
    assertClosedOutcome(result);
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("close_failed");
    expect(result.facts["confirmed"]).toBe(false);
  });

  it("reports remote-only operations as unsupported", () => {
    const { transport } = tmux([]);
    for (const op of ["connect", "probe"] as ExecutionOperation[]) {
      const result = callOperation(transport, op);
      assertClosedOutcome(result);
      expect(result.status).toBe("unsupported");
    }
  });
});

// ── 8 · Remote seam ──────────────────────────────────────────────────────────

describe("RemoteExecutionTransport — the remote seam", () => {
  const TARGET = { hostId: "box", hostKind: "claude", endpoint: "user@box" };

  function remote(overrides: Partial<RemoteTransportLike> = {}) {
    const base: RemoteTransportLike = {
      kind: "mock",
      connect: () => ({ ok: true, message: "connected" }),
      probe: (_host, binaries) => ({ present: [...binaries], missing: [] }),
      spawn: () => ({ remoteId: "mock-1" }),
      teardown: () => undefined,
    };
    return new RemoteExecutionTransport({ transport: { ...base, ...overrides }, target: TARGET });
  }

  it("connects through the injected transport", () => {
    const result = remote().connect(TARGET);
    assertClosedOutcome(result);
    expect(result.status).toBe("succeeded");
  });

  it("reports an unreachable endpoint as a typed failure", () => {
    const result = remote({ connect: () => ({ ok: false, message: "ssh: cannot reach user@box" }) }).connect(
      TARGET
    );
    assertClosedOutcome(result);
    expect(result.status).toBe("failed");
    expect(result.reason_code).toBe("remote_unreachable");
  });

  it("reports a missing remote binary as UNSUPPORTED with the capability named", () => {
    const result = remote({ probe: () => ({ present: ["tmux"], missing: ["codex"] }) }).probe(TARGET, [
      "tmux",
      "codex",
    ]);
    assertClosedOutcome(result);
    expect(result.status).toBe("unsupported");
    expect(result.reason_code).toBe("capability_absent");
    expect(result.facts["missing"]).toBe("codex");
  });

  it("spawns a remote lane and closes it through teardown", () => {
    let torn = 0;
    const transport = remote({ teardown: () => void torn++ });
    const spawned = transport.spawn({ handle_id: "lane-1", command: "claude 'go'" });
    assertClosedOutcome(spawned);
    expect(spawned.status).toBe("succeeded");
    expect(spawned.value?.handle_id).toBe("mock-1");

    const closed = transport.close(spawned.value as ExecutionHandle);
    assertClosedOutcome(closed);
    expect(closed.status).toBe("succeeded");
    expect(torn).toBe(1);
  });

  it("reports send/wait/interrupt as unsupported on the remote seam", () => {
    const transport = remote();
    for (const op of ["send", "wait", "interrupt"] as ExecutionOperation[]) {
      const result = callOperation(transport, op);
      assertClosedOutcome(result);
      expect(result.status).toBe("unsupported");
    }
  });

  it("accepts the SHIPPED MockTransport unchanged (bounded adapter, not a fork)", () => {
    const shipped = new MockTransport();
    const transport = new RemoteExecutionTransport({ transport: shipped, target: TARGET });
    const spawned = transport.spawn({ handle_id: "lane-1", command: "claude 'go'", pane: PANE_SPEC });
    expect(spawned.status).toBe("succeeded");
    expect(shipped.spawns).toHaveLength(1);
    expect(shipped.spawns[0].command).toBe("claude 'go'");
  });
});

// ── 9 · Launcher seam — selection is INJECTED, never branched in the launcher ─

describe("selectExecutionSubstrate — the launcher seam (MHRC-MOD-003)", () => {
  function probe(facts: {
    inside?: boolean;
    available?: boolean;
    independent?: boolean;
  }): ExecutionCapabilityProbe & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      insideMultiplexer: () => (calls.push("inside"), facts.inside ?? false),
      multiplexerAvailable: () => (calls.push("available"), facts.available ?? false),
      independentAgents: () => (calls.push("independent"), facts.independent ?? false),
    };
  }

  it("auto + inside a multiplexer → team in-session", () => {
    const selection = selectExecutionSubstrate({ requested_mode: "auto", dry_run: false }, probe({ inside: true }));
    expect(selection.dispatch_mode).toBe("team");
    expect(selection.transport_id).toBe("tmux");
    expect(selection.reason).toBe("auto: $TMUX set → team in-session");
  });

  it("auto + tmux installed → team new-session", () => {
    const selection = selectExecutionSubstrate(
      { requested_mode: "auto", dry_run: false },
      probe({ available: true })
    );
    expect(selection.dispatch_mode).toBe("team");
    expect(selection.reason).toBe("auto: tmux installed → team new-session");
  });

  it("auto + no tmux + independent agents → agent", () => {
    const selection = selectExecutionSubstrate(
      { requested_mode: "auto", dry_run: false },
      probe({ independent: true })
    );
    expect(selection.dispatch_mode).toBe("agent");
    expect(selection.transport_id).toBe("in-process");
    expect(selection.reason).toBe("auto: host supports independent agents → agent");
  });

  it("auto + nothing available → subagent", () => {
    const selection = selectExecutionSubstrate({ requested_mode: "auto", dry_run: false }, probe({}));
    expect(selection.dispatch_mode).toBe("subagent");
    expect(selection.transport_id).toBeNull();
    expect(selection.reason).toBe("auto: no tmux, no independent-agent support → subagent");
  });

  it("honours explicit team / agent / subagent pins", () => {
    expect(
      selectExecutionSubstrate({ requested_mode: "team", dry_run: true }, probe({})).reason
    ).toBe("explicit agent_mode=team");
    expect(
      selectExecutionSubstrate({ requested_mode: "agent", dry_run: false }, probe({})).reason
    ).toBe("explicit agent_mode=agent");
    expect(
      selectExecutionSubstrate({ requested_mode: "subagent", dry_run: false }, probe({})).reason
    ).toBe("explicit agent_mode=subagent");
  });

  it("degrades a pinned team to subagent when tmux is absent, and says so", () => {
    const selection = selectExecutionSubstrate({ requested_mode: "team", dry_run: false }, probe({}));
    expect(selection.dispatch_mode).toBe("subagent");
    expect(selection.degraded_from).toBe("team");
    expect(selection.warning).toContain("agent_mode=team pinned but tmux is not available");
    expect(selection.reason).toBe("agent_mode=team pinned but tmux unavailable → subagent fallback");
  });

  it("treats a null requested mode as auto", () => {
    const selection = selectExecutionSubstrate({ requested_mode: null, dry_run: false }, probe({ inside: true }));
    expect(selection.dispatch_mode).toBe("team");
  });

  it("probes LAZILY — an explicit pin never spawns a tmux probe", () => {
    const p = probe({});
    selectExecutionSubstrate({ requested_mode: "agent", dry_run: false }, p);
    expect(p.calls).toEqual([]);
    const dry = probe({});
    selectExecutionSubstrate({ requested_mode: "team", dry_run: true }, dry);
    expect(dry.calls).toEqual([]);
  });

  it("stops probing as soon as the ladder resolves", () => {
    const p = probe({ inside: true });
    selectExecutionSubstrate({ requested_mode: "auto", dry_run: false }, p);
    expect(p.calls).toEqual(["inside"]);
  });

  it("keeps the substrate DECISION out of the launcher source (host branching absent)", () => {
    // The CANONICAL launcher is the dispatch module's own copy; the top-level
    // scripts/ entry is its materialized projection and is regenerated, not authored.
    const moduleRoot = path.join(__dirname, "..", "..", "src", "modules", "dispatch");
    const launcher = fs.readFileSync(
      path.join(moduleRoot, "resources", "scripts", "agent-team-launcher.ts"),
      "utf8"
    );
    const ports = fs.readFileSync(
      path.join(moduleRoot, "workflows", "execution-transport-ports.ts"),
      "utf8"
    );
    const decisionVocabulary = [
      "auto: $TMUX set → team in-session",
      "auto: tmux installed → team new-session",
      "auto: host supports independent agents → agent",
      "auto: no tmux, no independent-agent support → subagent",
      "agent_mode=team pinned but tmux unavailable → subagent fallback",
    ];
    for (const phrase of decisionVocabulary) {
      expect(ports).toContain(phrase);
      expect(launcher).not.toContain(phrase);
    }
    // The launcher asks the injected port for the decision.
    expect(launcher).toContain("selectExecutionSubstrate");
  });
});

// ── 10 · The injected HostRuntime execution dependency ───────────────────────

describe("createHostExecutionRuntime — transport selection is injected", () => {
  function runtime() {
    const sink = recordingObservationSink();
    return {
      sink,
      value: createHostExecutionRuntime({
        transports: {
          tmux: new TmuxExecutionTransport({ run: scriptedRun([OK]).run, clock: steppingClock(1) }),
          "in-process": new InProcessExecutionTransport({ backend: new InProcessTeamBackend() }),
        },
        sink,
      }),
    };
  }

  it("resolves a registered transport through the port, not a host branch", () => {
    const { value } = runtime();
    const result = value.transportFor("tmux");
    assertClosedOutcome(result);
    expect(result.status).toBe("succeeded");
    expect(result.value?.transport_id).toBe("tmux");
  });

  it("returns UNSUPPORTED for a transport the runtime does not carry", () => {
    const { value } = runtime();
    const result = value.transportFor("remote");
    assertClosedOutcome(result);
    expect(result.status).toBe("unsupported");
    expect(result.reason_code).toBe("operation_unsupported");
  });

  it("refuses a port pinned to a foreign contract major", () => {
    const foreign = new TmuxExecutionTransport({ run: scriptedRun([OK]).run, clock: steppingClock(1) });
    Object.defineProperty(foreign, "contract_version", { value: 99 });
    const value = createHostExecutionRuntime({ transports: { tmux: foreign } });
    const result = value.transportFor("tmux");
    expect(result.status).toBe("unsupported");
    expect(result.reason_code).toBe("contract_version_unsupported");
  });

  it("routes substrate selection through the injected dependency", () => {
    const { value } = runtime();
    const result = value.selectSubstrate(
      { requested_mode: "auto", dry_run: false },
      {
        insideMultiplexer: () => false,
        multiplexerAvailable: () => true,
        independentAgents: () => false,
      }
    );
    assertClosedOutcome(result);
    expect(result.status).toBe("succeeded");
    expect(result.value?.dispatch_mode).toBe("team");
    expect(result.value?.transport_id).toBe("tmux");
  });

  it("records every transport outcome on the observation sink (nothing is silent)", () => {
    const { value, sink } = runtime();
    value.transportFor("tmux");
    value.transportFor("remote");
    expect(sink.records).toHaveLength(2);
    for (const record of sink.records) assertClosedOutcome(record);
  });
});

// ── 11 · Closed-outcome sweep across every seam × every operation ────────────

describe("every transport answers every operation with a closed typed outcome", () => {
  function allTransports(): ExecutionTransportPort[] {
    return [
      new PaneExecutionTransport({
        adapter: new ClaudePaneAdapter({ run: () => ({ status: 0, stdout: "", stderr: "" }) }),
        run: scriptedRun([OK]).run,
      }),
      new InProcessExecutionTransport({ backend: new InProcessTeamBackend() }),
      new InProcessExecutionTransport({
        backend: new SerialBackend() as TeamBackendLike,
        transport_id: "serial",
      }),
      new TmuxExecutionTransport({ run: scriptedRun([OK, NONZERO]).run, clock: steppingClock(1) }),
      new RemoteExecutionTransport({
        transport: {
          kind: "mock",
          connect: () => ({ ok: true, message: "ok" }),
          probe: (_h, b) => ({ present: [...b], missing: [] }),
          spawn: () => ({ remoteId: "mock-1" }),
          teardown: () => undefined,
        },
        target: { hostId: "box", hostKind: "claude", endpoint: "user@box" },
      }),
    ];
  }

  it("never throws and never returns an out-of-vocabulary status", () => {
    for (const transport of allTransports()) {
      for (const op of EXECUTION_OPERATIONS) {
        const result = callOperation(transport, op);
        assertClosedOutcome(result);
        // `supports` and the returned status must agree.
        if (!transport.supports(op)) expect(result.status).toBe("unsupported");
      }
    }
  });

  it("answers all five operation classes on every transport port", () => {
    for (const transport of allTransports()) {
      for (const op of CORE_OPS) {
        expect(typeof (transport as unknown as Record<string, unknown>)[op]).toBe("function");
      }
    }
  });
});
