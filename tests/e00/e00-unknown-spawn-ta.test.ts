/**
 * E00-T0 · startup-uncertainty reds U1-U6 (root release after L-INTEGRATION-1),
 * bound to implementation/e00/l-startup-uncertainty-interface.v1.json:
 *   - TaskCellSpawnResult.spawn_effect?: "none" | "unknown" (absent = legacy none)
 *   - runtime error named SpawnOutcomeUnknownError with instance_id, attempt_id,
 *     logical_task_id, reason, orphan_recorded
 *   - controller unknown outcome: orphaned true, awaiting "teardown",
 *     qualified_release false, teardown { ok:false, confirmed:false } with failure
 *     token spawn_outcome_unknown (+ orphan_record_failed when the marker write failed),
 *     actual nonterminal state, no new D5 state.
 *
 * Authored BEFORE any C/L source change (pre-correction reds). The new error type
 * may not be exported yet: assertions read behavior (name, fields, records), never
 * only a missing export. Known no-effect controls keep legacy failed sealing.
 *
 * Physical truth is a REAL test-owned child process (sleep 60xx) the double starts
 * BEFORE it returns, so "the worker may be alive" is a fact the test checks, not a
 * flag. Mechanics only: real FilesystemTaskCellRuntime, source controller lane
 * (support/controller-lane.ts), declared ExecutionTransportPort double, the tmux
 * port through the test-owned shim with only its printed -F output malformed.
 * LanePort.prototype.spawn/terminate are patched per test and restored. No real
 * Claude, broker, TC, package or qualification claim.
 *
 * Limit: the source lane fixture closes the controller in its own finally and the
 * CLI supervision loop is not reachable in TA; U6 checks the heartbeat is still
 * "supervising" when the lane outcome returns, not process lifetime after close.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawn as spawnChild, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import {
  ExecutionTransportTaskCellWorkerPort, FilesystemTaskCellRuntime, auditTaskCellArtifactJoin, readControllerStatus, taskCellPaths,
} from "../../src/domains/dispatch";
import { readTaskCellLifecycleEvents } from "../../src/domains/telemetry";
import { TmuxTaskCellWorkerPort } from "../../scripts/lib/host/tmux-backend";
import { resolveAdoptedDefinition } from "../../scripts/task-cell-controller";
import { FULL_RUNGS, FakeWorkerPort, ownChild, ownedTempDir, processStart, teardownOwned, tempRoot, type TempRoot } from "./support/e00-harness";
import { adoptDefinition } from "./support/adopted-definition";
import { LANE_RUN, LanePort, runControllerLane } from "./support/controller-lane";
import { installTmuxShim, resolveRealTmux, tmuxOn, type TmuxShim } from "./tc/tmux-shim";

afterEach(teardownOwned);

const TERMINAL_EVENTS = ["failed", "terminated", "timed_out", "cancelled", "reaped"];
const KILL_VERBS = ["kill-pane", "if-shell", "kill-window", "kill-session", "kill-server", "respawn-pane", "respawn-window"];
let sleepSeq = 6100;

/** A real child the "worker" leaves behind; owned for teardown. */
function liveChild(root: string): { pid: number; start: string; alive: () => boolean } {
  const child = ownChild(spawnChild("sleep", [String(++sleepSeq)], { stdio: "ignore" }), root);
  const pid = child.pid!;
  const start = processStart(pid)!;
  return { pid, start, alive: () => processStart(pid) === start };
}

type Mode = "failed" | "cancelled" | "timed_out" | "succeeded_no_handle" | "throw" | "unsupported";

/** Declared ExecutionTransportPort double: every post-call mode starts a real child first. */
function transportDouble(root: string, mode: Mode, onSpawn?: () => void) {
  const state = { calls: 0, child: null as ReturnType<typeof liveChild> | null };
  const transport = {
    supports: (op: string) => op === "spawn",
    spawn: () => {
      state.calls++;
      if (mode === "unsupported") return { status: "unsupported", reason_code: "spawn_unsupported", detail: "transport double: spawn unsupported", value: null };
      state.child = liveChild(root);
      onSpawn?.();
      if (mode === "throw") throw new Error("transport double: connection lost after launch");
      if (mode === "succeeded_no_handle") return { status: "succeeded", reason_code: null, detail: null, value: null };
      return { status: mode, reason_code: `transport_${mode}`, detail: `transport double: ${mode} after launch`, value: { transport_id: "double", handle_id: "h-allocated-1" } };
    },
    send: () => ({ status: "unsupported", reason_code: "send_unsupported", detail: null, value: null }),
    interrupt: () => ({ status: "unsupported", reason_code: "interrupt_unsupported", detail: null, value: null }),
    close: () => ({ status: "unsupported", reason_code: "close_unsupported", detail: null, value: null }),
  };
  const port = new ExecutionTransportTaskCellWorkerPort({
    transport: transport as never,
    filesystemAssignmentWakeup: true,
    requestFor: () => ({ handle_id: "h-allocated-1", payload: {} }) as never,
  });
  return { port, state };
}

const POST_CALL: Mode[] = ["failed", "cancelled", "timed_out", "succeeded_no_handle"];

// ── U1/U2 adapter: the shared transport port classifies its own outcome ──

describe("U1/U2 · ExecutionTransportTaskCellWorkerPort post-call outcomes are spawn_effect unknown", () => {
  for (const mode of POST_CALL) {
    it(`${mode}: ok false, spawn_effect "unknown"; the launched child is still alive`, () => {
      const root = ownedTempDir("guild-e00-unk-");
      const { port, state } = transportDouble(root, mode);
      const r = port.spawn({ instance_id: "i1", run_id: "r1", assignment_path: "a.json", instance: {} as never }) as { ok: boolean; reason: string | null; spawn_effect?: string };
      expect(state.child!.alive()).toBe(true);
      expect({ ok: r.ok, spawn_effect: r.spawn_effect ?? "absent" }).toEqual({ ok: false, spawn_effect: "unknown" });
    });
  }

  it("control: an actual unsupported spawn (no call effect) is not unknown", () => {
    const root = ownedTempDir("guild-e00-unk-");
    const { port, state } = transportDouble(root, "unsupported");
    const r = port.spawn({ instance_id: "i1", run_id: "r1", assignment_path: "a.json", instance: {} as never }) as { ok: boolean; spawn_effect?: string };
    expect(state.child).toBeNull();
    expect(r.ok).toBe(false);
    expect(r.spawn_effect ?? "none").toBe("none");
  });
});

// ── U1-U4 runtime: the real FilesystemTaskCellRuntime does not seal an unknown start ──

function runtimeFor(root: TempRoot, worker: any, maxInstances = 1) {
  let seq = 0;
  return new FilesystemTaskCellRuntime({
    rungPlan: FULL_RUNGS, cwd: root.cwd, substrate: "tmux", parallelism: 4, maxInstances,
    binding: { binding_ref: root.bindingRef }, worker, now: () => "2026-10-27T00:00:00.000Z",
    idFactory: (kind: string) => `${kind}-${++seq}`,
  } as never);
}

async function spawnOne(runtime: any, root: TempRoot, taskId: string) {
  const cell = await runtime.spawnCell({
    run_id: root.runId, cell_id: `cell-${taskId}`, goal_id: "goal-e00", phase_id: "build",
    step_id: taskId, team_id: "team-e00", logical_task_id: taskId,
    fanout: "lead_plus_one", lead: { lead_binding_id: "lead-binding-e00" },
  });
  return runtime.spawnInstance(cell, {
    task_run_id: `${taskId}.tr1`, attempt: 1, worker_role: "backend",
    specialist_type_id: "backend", specialist_type_version: "1", specialist_type_hash: "sha256:type",
    specialist_profile_id: "backend", specialist_profile_hash: "sha256:profile",
    host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:caps",
    model_tier: "mid", model_id: "fixture-model", context_bundle_id: `.guild/context/${taskId}.md`,
    context_bundle_hash: `sha256:${"0".repeat(64)}`,
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
  });
}

function attemptFiles(root: TempRoot, taskId: string) {
  const base = path.join(root.cwd, ".guild", "runs", root.runId, "task-cells", taskId, "attempts", "1", "instances");
  const iid = fs.existsSync(base) ? fs.readdirSync(base)[0] ?? null : null;
  if (!iid) return null;
  const p = taskCellPaths({ run_id: root.runId, logical_task_id: taskId, attempt: 1, instance_id: iid });
  const attemptAbs = path.join(root.cwd, p.attempt_path);
  return { iid, attemptAbs, attempt: fs.existsSync(attemptAbs) ? JSON.parse(fs.readFileSync(attemptAbs, "utf8")) : null, terminalExists: fs.existsSync(path.join(root.cwd, p.terminal_path)) };
}

const terminalEventsFor = (root: TempRoot, iid: string) =>
  readTaskCellLifecycleEvents({ cwd: root.cwd, runId: root.runId }).filter((e) => e.instance_id === iid && TERMINAL_EVENTS.includes(e.event_name as string)).map((e) => e.event_name);

/** Restores for injected write faults; run in finally and again after each test. */
const faultRestores: Array<() => void> = [];
function restoreFaults(): void {
  while (faultRestores.length) { try { faultRestores.pop()!(); } catch { /* already gone */ } }
}
afterEach(restoreFaults);

/**
 * The marker write rewrites the EXISTING attempt file in place (writeSealed), so the
 * fault targets that file (and its directory); the fault counts only when a write
 * open of the actual file is verified to fail with EACCES.
 */
function blockAttemptWrite(attemptAbs: string): boolean {
  const dir = path.dirname(attemptAbs);
  fs.chmodSync(attemptAbs, 0o400);
  fs.chmodSync(dir, 0o500);
  faultRestores.push(() => { fs.chmodSync(dir, 0o700); fs.chmodSync(attemptAbs, 0o600); });
  try {
    fs.closeSync(fs.openSync(attemptAbs, "r+"));
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EACCES";
  }
}

async function runtimeUnknown(mode: Mode, opts: { failMarker?: boolean } = {}) {
  const root = tempRoot("guild-e00-unk-");
  let injectionActive: boolean | null = null;
  const double = transportDouble(root.cwd, mode, () => {
    if (!opts.failMarker) return;
    // The orphan marker write must fail: the actual attempt file goes read-only after launch.
    const base = path.join(root.cwd, ".guild", "runs", root.runId, "task-cells", "T1", "attempts", "1", "instances");
    injectionActive = blockAttemptWrite(path.join(root.cwd, taskCellPaths({ run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: fs.readdirSync(base)[0]! }).attempt_path));
  });
  const runtime = runtimeFor(root, double.port);
  let error: any = null;
  try { await spawnOne(runtime, root, "T1"); } catch (e) { error = e; } finally { restoreFaults(); }
  return { root, runtime, double, error, injectionActive, files: attemptFiles(root, "T1") };
}

describe("U1-U3 · runtime keeps an unknown start unsealed, orphaned and counted", () => {
  for (const mode of [...POST_CALL, "throw"] as Mode[]) {
    it(`${mode}: SpawnOutcomeUnknownError; attempt nonterminal + orphaned; no terminal event; cap held; no replay; child alive`, async () => {
      const r = await runtimeUnknown(mode);
      // Physical precondition: one call, the child it launched is alive, the attempt exists.
      expect(r.double.state.calls).toBe(1);
      expect(r.double.state.child!.alive()).toBe(true);
      expect(r.files).not.toBeNull();
      const second = await secondAdmissionRefused(r.runtime, r.root);
      expect(observedRuntime(r, second)).toEqual({
        error_name: "SpawnOutcomeUnknownError", instance_id: r.files!.iid, attempt_id: r.files!.attempt?.attempt_id ?? "missing",
        logical_task_id: "T1", reason_is_string: true, orphan_recorded: true,
        attempt_present: true, attempt_terminal: null, attempt_orphaned: true, terminal_seal: false, terminal_events: [], second_admission_refused: true, transport_calls: 1,
      });
      expect(r.double.state.child!.alive()).toBe(true);
    });
  }
});

async function secondAdmissionRefused(runtime: any, root: TempRoot): Promise<boolean> {
  try { await spawnOne(runtime, root, "T2"); return false; } catch { return true; }
}

function observedRuntime(r: Awaited<ReturnType<typeof runtimeUnknown>>, second: boolean) {
  return {
    error_name: r.error?.name ?? null, instance_id: r.error?.instance_id ?? null, attempt_id: r.error?.attempt_id ?? null,
    logical_task_id: r.error?.logical_task_id ?? null, reason_is_string: typeof r.error?.reason === "string", orphan_recorded: r.error?.orphan_recorded ?? null,
    // A missing record must fail: presence is its own field and the nullable value is kept as read.
    attempt_present: r.files!.attempt !== null,
    attempt_terminal: r.files!.attempt === null ? "missing_record" : "terminal_state" in r.files!.attempt ? r.files!.attempt.terminal_state : "missing_field",
    attempt_orphaned: r.files!.attempt?.orphaned ?? null,
    terminal_seal: r.files!.terminalExists, terminal_events: terminalEventsFor(r.root, r.files!.iid),
    second_admission_refused: second, transport_calls: r.double.state.calls,
  };
}

describe("U4 · runtime: an orphan-marker write failure never turns into 'no live effect'", () => {
  it("orphan_recorded false; attempt still nonterminal and unsealed; no terminal event; cap held; child alive", async () => {
    const r = await runtimeUnknown("failed", { failMarker: true });
    // Preconditions: the fault was verified active on the actual attempt file; the child is alive.
    expect(r.injectionActive).toBe(true);
    expect(r.double.state.child!.alive()).toBe(true);
    const second = await secondAdmissionRefused(r.runtime, r.root);
    const { attempt_orphaned: _bookkeeping, ...observed } = observedRuntime(r, second);
    expect(observed).toEqual({
      error_name: "SpawnOutcomeUnknownError", instance_id: r.files!.iid, attempt_id: r.files!.attempt?.attempt_id ?? "missing",
      logical_task_id: "T1", reason_is_string: true, orphan_recorded: false,
      attempt_present: true, attempt_terminal: null, terminal_seal: false, terminal_events: [], second_admission_refused: true, transport_calls: 1,
    });
  });
});

describe("known no-effect controls · runtime keeps legacy failed sealing and releases the slot", () => {
  const cases: Array<[string, () => { ok: boolean; reason: string; spawn_effect?: string }]> = [
    ["explicit spawn_effect none", () => ({ ok: false, reason: "fixture: refused before any action", spawn_effect: "none" })],
    ["legacy port with spawn_effect absent", () => ({ ok: false, reason: "fixture: legacy refusal" })],
  ];
  for (const [label, result] of cases) {
    it(`${label}: attempt sealed failed with a terminal event; next admission succeeds`, async () => {
      const root = tempRoot("guild-e00-unk-");
      const worker = new FakeWorkerPort();
      let first = true;
      worker.spawn = ((input: { instance_id: string }) => (first ? ((first = false), result()) : FakeWorkerPort.prototype.spawn.call(worker, input))) as never;
      const runtime = runtimeFor(root, worker);
      let error: any = null;
      try { await spawnOne(runtime, root, "T1"); } catch (e) { error = e; }
      expect(error).not.toBeNull();
      expect(error.name).not.toBe("SpawnOutcomeUnknownError");
      const f = attemptFiles(root, "T1")!;
      expect({ terminal_state: f.attempt.terminal_state, orphaned: f.attempt.orphaned }).toEqual({ terminal_state: "failed", orphaned: false });
      expect(terminalEventsFor(root, f.iid)).toEqual(["failed"]);
      await spawnOne(runtime, root, "T2");
    });
  }

  it("actual unsupported transport spawn: sealed failed, no child, slot released", async () => {
    const root = tempRoot("guild-e00-unk-");
    const { port, state } = transportDouble(root.cwd, "unsupported");
    const runtime = runtimeFor(root, port, 2);
    let error: any = null;
    try { await spawnOne(runtime, root, "T1"); } catch (e) { error = e; }
    expect(state.child).toBeNull();
    expect(error?.name).not.toBe("SpawnOutcomeUnknownError");
    expect(attemptFiles(root, "T1")!.attempt.terminal_state).toBe("failed");
  });
});

// ── U1-U4, U6 controller: truthful nonterminal orphan outcome through the real runtime ──

type SpawnImpl = (this: any, input: any) => any;
async function laneWith(spawnImpl: SpawnImpl, hook?: (controller: any, root: string) => void) {
  const proto = LanePort.prototype as any;
  const had = Object.prototype.hasOwnProperty.call(proto, "spawn");
  const original = proto.spawn;
  const originalTerminate = proto.terminate;
  const calls = { spawn: 0, terminate: 0 };
  proto.spawn = function (this: any, input: any) { calls.spawn++; return spawnImpl.call(this, input); };
  proto.terminate = function (this: any, input: any) { calls.terminate++; return originalTerminate.call(this, input); };
  let root = "";
  let heartbeatAtReturn: string | null = null;
  let out: any = null;
  let thrown: Error | null = null;
  try {
    const lane = await runControllerLane({
      wrap: (_rt, r) => { root = r; },
      controllerHook: (controller, r) => {
        const inner = controller.runLane.bind(controller);
        controller.runLane = async (spec: unknown) => {
          const o = await inner(spec);
          const hb = path.join(r, ".guild", "runs", LANE_RUN, "controller", "heartbeat.json");
          heartbeatAtReturn = fs.existsSync(hb) ? JSON.parse(fs.readFileSync(hb, "utf8")).state ?? null : null;
          return o;
        };
        hook?.(controller, r);
      },
    });
    out = lane.out;
  } catch (error) {
    thrown = error as Error;
  } finally {
    if (had) proto.spawn = original; else delete proto.spawn;
    proto.terminate = originalTerminate;
  }
  const handles = path.join(root, ".guild", "runs", LANE_RUN, "controller", "handles");
  try { fs.chmodSync(handles, 0o700); } catch { /* absent */ }
  const files = fs.existsSync(handles) ? fs.readdirSync(handles) : [];
  for (const f of files) fs.chmodSync(path.join(handles, f), 0o600);
  const iid = files.length === 1 ? files[0]!.replace(/\.json$/, "") : null;
  const p = iid ? taskCellPaths({ run_id: LANE_RUN, logical_task_id: "T1", attempt: 1, instance_id: iid }) : null;
  const attempt = p && fs.existsSync(path.join(root, p.attempt_path)) ? JSON.parse(fs.readFileSync(path.join(root, p.attempt_path), "utf8")) : null;
  const status = readControllerStatus({ cwd: root, runId: LANE_RUN, consumerPolicy: "cooperative_local" } as never) as any;
  const view = (status.instances ?? []).find((i: any) => i.instance_id === iid) ?? null;
  const audit = auditTaskCellArtifactJoin({ cwd: root, runId: LANE_RUN, requireClosed: true }) as { ok: boolean };
  return { root, out, thrown, iid, attempt, view, audit, calls, heartbeatAtReturn };
}

/** One observed-vs-expected object so a red shows every delta at once. */
function observedLane(r: Awaited<ReturnType<typeof laneWith>>, tokens: string[]) {
  const failure = String(r.out?.teardown?.failure ?? "");
  return {
    thrown: r.thrown?.message ?? null, spawn_calls: r.calls.spawn,
    orphaned: r.out?.orphaned ?? null, awaiting: r.out?.awaiting ?? null, qualified_release: r.out?.qualified_release ?? null,
    teardown_ok: r.out?.teardown?.ok ?? null, teardown_confirmed: r.out?.teardown?.confirmed ?? null,
    failure_tokens: Object.fromEntries(tokens.map((t) => [t, failure.includes(t)])),
    state_nonterminal: r.out ? !TERMINAL_EVENTS.includes(r.out.state) : null,
    // A missing attempt record or status view must fail: presence is asserted separately from the nullable value.
    attempt_present: r.attempt !== null, view_present: r.view !== null,
    attempt_terminal: r.attempt === null ? "missing_record" : "terminal_state" in r.attempt ? r.attempt.terminal_state : "missing_field",
    status_terminal: r.view === null ? "missing_view" : "attempt_terminal_state" in r.view ? r.view.attempt_terminal_state : "missing_field",
    status_awaiting: r.view?.awaiting ?? null, status_qualified: r.view?.qualified_release ?? null, closed_audit_ok: r.audit.ok,
  };
}

function expectUnknownOutcome(r: Awaited<ReturnType<typeof laneWith>>, tokens: string[]) {
  expect(observedLane(r, tokens)).toEqual({
    thrown: null, spawn_calls: 1, orphaned: true, awaiting: "teardown", qualified_release: false,
    teardown_ok: false, teardown_confirmed: false, failure_tokens: Object.fromEntries(tokens.map((t) => [t, true])),
    state_nonterminal: true, attempt_present: true, view_present: true, attempt_terminal: null, status_terminal: null, status_awaiting: "teardown", status_qualified: false, closed_audit_ok: false,
  });
}

describe("U1-U3 · controller: a post-call unknown start settles as a truthful nonterminal orphan", () => {
  for (const mode of [...POST_CALL, "throw"] as Mode[]) {
    it(`shared transport ${mode}`, async () => {
      let d: ReturnType<typeof transportDouble> | null = null;
      const r = await laneWith(function (this: any, input: any) {
        d = transportDouble(this.root, mode);
        return d.port.spawn(input);
      });
      expect(d!.state.child!.alive()).toBe(true);
      expectUnknownOutcome(r, ["spawn_outcome_unknown"]);
    });
  }

  it("C wrapper: an opaque inner post-call throw is unknown", async () => {
    let child: ReturnType<typeof liveChild> | null = null;
    const r = await laneWith(function (this: any) { child = liveChild(this.root); throw new Error("inner port: lost after launch"); });
    expect(child!.alive()).toBe(true);
    expectUnknownOutcome(r, ["spawn_outcome_unknown"]);
  });

  it("C wrapper: a handle write failure AFTER inner success is unknown (no pretended absence)", async () => {
    let child: ReturnType<typeof liveChild> | null = null;
    const r = await laneWith(function (this: any, input: any) {
      child = liveChild(this.root);
      // The wrapper's post-success "spawned" handle write must fail: file and directory read-only.
      const handles = path.join(this.root, ".guild", "runs", LANE_RUN, "controller", "handles");
      fs.chmodSync(path.join(handles, `${input.instance_id}.json`), 0o400);
      fs.chmodSync(handles, 0o500);
      return { ok: true, reason: null };
    });
    expect(child!.alive()).toBe(true);
    expectUnknownOutcome(r, ["spawn_outcome_unknown"]);
  });
});

describe("U4 · controller: orphan-marker write failure keeps the physical orphan", () => {
  it("orphaned true, awaiting teardown, qualified false, failure tokens spawn_outcome_unknown + orphan_record_failed", async () => {
    let child: ReturnType<typeof liveChild> | null = null;
    let injectionActive: boolean | null = null;
    let r: Awaited<ReturnType<typeof laneWith>>;
    try {
      r = await laneWith(function (this: any, input: any) {
        const d = transportDouble(this.root, "failed", () => {
          const p = taskCellPaths({ run_id: LANE_RUN, logical_task_id: "T1", attempt: 1, instance_id: input.instance_id });
          injectionActive = blockAttemptWrite(path.join(this.root, p.attempt_path));
        });
        try { return d.port.spawn(input); } finally { child = d.state.child; }
      });
    } finally {
      restoreFaults();
    }
    expect(injectionActive).toBe(true);
    expect(child!.alive()).toBe(true);
    // The attempt's own orphan flag cannot be written; the physical orphan is still reported.
    expectUnknownOutcome(r, ["spawn_outcome_unknown", "orphan_record_failed"]);
  });
});

describe("U6 · controller supervision while an unknown worker may be alive", () => {
  it("the heartbeat is still supervising when the unknown lane outcome returns; no re-dispatch", async () => {
    const r = await laneWith(function (this: any, input: any) { return transportDouble(this.root, "timed_out").port.spawn(input); });
    expect({ thrown: r.thrown?.message ?? null, spawn_calls: r.calls.spawn, heartbeat_at_return: r.heartbeatAtReturn, orphaned: r.out?.orphaned ?? null, awaiting: r.out?.awaiting ?? null })
      .toEqual({ thrown: null, spawn_calls: 1, heartbeat_at_return: "supervising", orphaned: true, awaiting: "teardown" });
  });
});

describe("controller known no-effect controls", () => {
  it("C wrapper: spawn_pending handle write failure BEFORE the inner call is none; inner port never called; sealed failed", async () => {
    const r = await laneWith(function () { return { ok: true, reason: null }; }, (_c, root) => {
      const handles = path.join(root, ".guild", "runs", LANE_RUN, "controller", "handles");
      fs.mkdirSync(handles, { recursive: true });
      fs.chmodSync(handles, 0o500);
    });
    expect(r.calls.spawn).toBe(0);
    expect(r.out?.orphaned ?? false).toBe(false);
    expect(String(r.out?.teardown?.failure ?? "")).not.toContain("spawn_outcome_unknown");
  });

  it("an explicit spawn_effect none refusal: attempt and status sealed failed, not orphaned", async () => {
    const r = await laneWith(function () { return { ok: false, reason: "definition_hash_mismatch", spawn_effect: "none" }; });
    expect(r.calls.spawn).toBe(1);
    expect(r.attempt?.terminal_state).toBe("failed");
    expect(r.attempt?.orphaned).toBe(false);
    expect(r.view?.attempt_terminal_state).toBe("failed");
  });
});

// ── U5 tmux producer: identity_unknown is spawn_effect unknown end to end ──

const tmuxAvailable = resolveRealTmux() !== null;
const NODE = process.execPath.includes("bun") ? "node" : process.execPath;
const CLAUDE_FIXTURE = path.join(__dirname, "tc", "claude-fixture.mjs");

function tmuxPort(root: string, opts: { mangle?: boolean; resolve?: (root: string, inst: any) => any } = {}) {
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  if (!fs.existsSync(path.join(root, ".guild", "guild.yaml"))) fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  adoptDefinition(root, "backend");
  const bin = path.join(root, ".bin");
  const shim: TmuxShim = installTmuxShim(root, bin);
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\nexec "${NODE}" "${CLAUDE_FIXTURE}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, ".claude-fixture-mode"), "normal");
  const stubPlugin = path.join(root, ".stub-plugin");
  fs.mkdirSync(stubPlugin, { recursive: true });
  const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
    const r = spawnSync(cmd === "tmux" ? path.join(bin, "tmux") : cmd, args, { encoding: "utf8", timeout: 20000, ...o } as never);
    let stdout = (r.stdout as unknown as string) ?? "";
    if (opts.mangle && cmd === "tmux" && (args[0] === "new-session" || args[0] === "new-window") && r.status === 0) stdout = stdout.replace(/^%/, "?");
    return { status: r.status, stdout, stderr: (r.stderr as unknown as string) ?? "" };
  };
  const port = new TmuxTaskCellWorkerPort({
    cwd: root, sessionName: "e00-unk",
    snapshotDir: path.join(root, ".guild", "runs", LANE_RUN, "controller", "launch"),
    resolveDefinition: (inst) => (opts.resolve ? opts.resolve(root, inst) : resolveAdoptedDefinition(root, inst.worker_role)),
    receiptPath: (inst) => path.join(root, ".guild", "runs", LANE_RUN, "handoffs", `${inst.worker_role}-${inst.logical_task_id}.md`),
    ackArgv: ["node", path.join(root, "task-cell-ack.js")],
    run,
    env: { PATH: `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? root, SHELL: fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh", LANG: "en_US.UTF-8" },
    activate: () => ({ args: ["--plugin-dir", stubPlugin], pluginRoot: stubPlugin }),
  });
  const calls = () => (fs.existsSync(shim.callsLog) ? fs.readFileSync(shim.callsLog, "utf8").split("\n").filter(Boolean) : []);
  const panes = () => { const r = tmuxOn(shim, ["list-panes", "-a", "-F", "#{pane_id}"]); return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : []; };
  return { port, calls, panes };
}

const laneHashes = (root: string, inst: any) => {
  const d = resolveAdoptedDefinition(root, inst.worker_role);
  return "error" in d ? d : { ...d, ref: { ...d.ref, specialist_profile_hash: inst.specialist_profile_hash, specialist_type_hash: inst.specialist_type_hash } };
};

describe.skipIf(!tmuxAvailable)("U5 · tmux identity_unknown is spawn_effect unknown through the controller", () => {
  it("the port declares unknown; the controller settles a nonterminal orphan; the pane stays live; no kill verb", async () => {
    let t: ReturnType<typeof tmuxPort> | null = null;
    let portResult: any = null;
    const r = await laneWith(function (this: any, input: any) {
      t = tmuxPort(this.root, { mangle: true, resolve: laneHashes });
      portResult = t.port.spawn(input);
      return portResult;
    });
    expect(String(portResult?.reason)).toMatch(/^spawn_identity_unavailable/);
    expect(t!.panes().length).toBe(1);
    expect(t!.calls().filter((c) => KILL_VERBS.includes(c))).toEqual([]);
    expect(portResult?.spawn_effect ?? "absent").toBe("unknown");
    expectUnknownOutcome(r, ["spawn_outcome_unknown"]);
  });

  it("control: a tmux preflight refusal (no pane) is not unknown and issues no tmux create", () => {
    const root = ownedTempDir("guild-e00-unk-");
    const t = tmuxPort(root);
    const r = t.port.spawn({ instance_id: "i1", run_id: LANE_RUN, assignment_path: "a.json", instance: {
      instance_id: "i1", run_id: LANE_RUN, logical_task_id: "T1", worker_role: "backend", host_id: "codex-cli",
      specialist_profile_hash: "sha256:x", specialist_type_hash: "sha256:y", projection: { tools: [], permissions: [], recorded_losses: [] }, model_id: null,
    } } as never) as { ok: boolean; reason: string; spawn_effect?: string };
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^host_unsupported/);
    expect(r.spawn_effect ?? "none").toBe("none");
    expect(t.calls().filter((c) => c === "new-session" || c === "new-window")).toEqual([]);
  });
});
