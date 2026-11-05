/**
 * E00-T0 · focused C8 regressions (review/G-lane-E00-C/result-r8.json F1, F2) and
 * the root C8-A1 probe (implementation/e00/c-rework-r8.json), authored BEFORE any
 * C source change against the frozen C8 candidate.
 *
 * F1  a real spawn succeeds, then the "spawned" lifecycle append really throws
 *     (events.jsonl made read-only for that one append, EACCES verified active):
 *     the attempt stays nonterminal and orphaned with its allocated ids and cap
 *     slot; runLane returns the nonterminal orphan outcome, never a generic throw.
 * F2  a succeeded transport outcome with a truthy but unusable handle (empty,
 *     whitespace or non-string handle_id; handle transport_id differing from the
 *     outcome or the port; unknown transport id) is never stored, never ready, and
 *     is spawn_effect unknown. Valid-handle and unsupported controls preserved.
 * C8-A1 with ANY actual allocated nonterminal orphan on a live controller (typed
 *     unknown spawn; readiness or delivery failure whose teardown is refused, all
 *     before this.instances.push), probed inside runLane's return before the
 *     fixture's finally closes it, writeStationResult refuses station_not_settled
 *     and publishes no team result. Controls: an
 *     all-terminal station publishes; a terminal lane whose cleanup evidence is
 *     incomplete is still station-settled while the closed audit fails separately.
 *
 * Physical truth is a real test-owned child (sleep 62xx). Mechanics only: source
 * controller lane over the REAL runtime; LanePort.prototype.spawn patched per test
 * and restored; the runtime emitLifecycle method wrapped only to arm the one-shot
 * file fault around the real append. No product edits, no TC/broker/package claim.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawn as spawnChild } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { ExecutionTransportTaskCellWorkerPort, auditTaskCellArtifactJoin, readControllerStatus, taskCellPaths } from "../../src/domains/dispatch";
import { ownChild, ownedTempDir, processStart, teardownOwned } from "./support/e00-harness";
import { LANE_RUN, LanePort, runControllerLane } from "./support/controller-lane";

const faultRestores: Array<() => void> = [];
function restoreFaults(): void {
  while (faultRestores.length) { try { faultRestores.pop()!(); } catch { /* gone */ } }
}
afterEach(restoreFaults);
afterEach(teardownOwned);

const TERMINAL = ["failed", "terminated", "timed_out", "cancelled", "reaped"];
let sleepSeq = 6200;

function liveChild(root: string): { pid: number; alive: () => boolean } {
  const child = ownChild(spawnChild("sleep", [String(++sleepSeq)], { stdio: "ignore" }), root);
  const pid = child.pid!;
  const start = processStart(pid)!;
  return { pid, alive: () => processStart(pid) === start };
}

const runDir = (root: string) => path.join(root, ".guild", "runs", LANE_RUN);
const teamResultFiles = (root: string) => {
  const dir = path.join(runDir(root), "team-result");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => !n.startsWith(".")) : [];
};

interface LaneObs {
  root: string; out: any; thrown: Error | null; iid: string | null; attempt: any; view: any; audit: { ok: boolean };
  spawnCalls: number; heartbeatAtReturn: string | null; station: { refused: string | null; published: string | null; files_after: string[] } | null;
}

/** A source controller lane whose LanePort.spawn is `spawnImpl`; optional probes run inside runLane's return. */
async function lane(spawnImpl: ((this: any, input: any) => any) | null, o: {
  wrap?: (rt: any, root: string) => void; hook?: (c: any, root: string) => void; lead?: "accepted"; probeStation?: boolean;
  /** Further LanePort methods replaced for this lane only (ready / notifyAssignment / terminate). */
  port?: Record<string, (this: any, input: any) => any>;
} = {}): Promise<LaneObs> {
  const proto = LanePort.prototype as any;
  const had = Object.prototype.hasOwnProperty.call(proto, "spawn");
  const original = proto.spawn;
  let spawnCalls = 0;
  if (spawnImpl) proto.spawn = function (this: any, input: any) { spawnCalls++; return spawnImpl.call(this, input); };
  const replaced = Object.entries(o.port ?? {}).map(([name, fn]) => {
    const own = Object.prototype.hasOwnProperty.call(proto, name);
    const prev = proto[name];
    proto[name] = fn;
    return () => { if (own) proto[name] = prev; else delete proto[name]; };
  });
  let root = "";
  let out: any = null;
  let thrown: Error | null = null;
  let heartbeatAtReturn: string | null = null;
  let station: LaneObs["station"] = null;
  try {
    const run = await runControllerLane({
      lead: o.lead,
      wrap: (rt, r) => { root = r; o.wrap?.(rt, r); },
      controllerHook: (c, r) => {
        o.hook?.(c, r);
        const inner = c.runLane.bind(c);
        c.runLane = async (spec: unknown) => {
          const res = await inner(spec);
          const hb = path.join(runDir(r), "controller", "heartbeat.json");
          heartbeatAtReturn = fs.existsSync(hb) ? JSON.parse(fs.readFileSync(hb, "utf8")).state ?? null : null;
          if (o.probeStation) {
            // C8-A1: the controller is still live here (the fixture closes it only after runLane returns).
            let refused: string | null = null;
            let published: string | null = null;
            try { published = c.writeStationResult(); } catch (e) { refused = (e as { reason?: string }).reason ?? (e as Error).message; }
            station = { refused, published, files_after: teamResultFiles(r) };
          }
          return res;
        };
      },
    });
    out = run.out;
  } catch (error) {
    thrown = error as Error;
  } finally {
    if (spawnImpl) { if (had) proto.spawn = original; else delete proto.spawn; }
    for (const undo of replaced.reverse()) undo();
    restoreFaults();
  }
  const handles = path.join(runDir(root), "controller", "handles");
  const files = fs.existsSync(handles) ? fs.readdirSync(handles) : [];
  const iid = files.length === 1 ? files[0]!.replace(/\.json$/, "") : null;
  const p = iid ? taskCellPaths({ run_id: LANE_RUN, logical_task_id: "T1", attempt: 1, instance_id: iid }) : null;
  const attempt = p && fs.existsSync(path.join(root, p.attempt_path)) ? JSON.parse(fs.readFileSync(path.join(root, p.attempt_path), "utf8")) : null;
  const status = readControllerStatus({ cwd: root, runId: LANE_RUN, consumerPolicy: "cooperative_local" } as never) as any;
  const view = (status.instances ?? []).find((i: any) => i.instance_id === iid) ?? null;
  const audit = auditTaskCellArtifactJoin({ cwd: root, runId: LANE_RUN, requireClosed: true }) as { ok: boolean };
  return { root, out, thrown, iid, attempt, view, audit, spawnCalls, heartbeatAtReturn, station };
}

/** Presence and nullable value are separate fields; a missing record never reads as null. */
function unknownObservation(r: LaneObs, tokens: string[]) {
  const failure = String(r.out?.teardown?.failure ?? "");
  return {
    thrown: r.thrown?.message ?? null, spawn_calls: r.spawnCalls,
    orphaned: r.out?.orphaned ?? null, awaiting: r.out?.awaiting ?? null, qualified_release: r.out?.qualified_release ?? null,
    instance_id_matches: r.iid !== null && r.out?.instance_id === r.iid,
    teardown_ok: r.out?.teardown?.ok ?? null, teardown_confirmed: r.out?.teardown?.confirmed ?? null,
    failure_tokens: Object.fromEntries(tokens.map((t) => [t, failure.includes(t)])),
    state_nonterminal: r.out ? !TERMINAL.includes(r.out.state) : null,
    attempt_present: r.attempt !== null, view_present: r.view !== null,
    attempt_terminal: r.attempt === null ? "missing_record" : "terminal_state" in r.attempt ? r.attempt.terminal_state : "missing_field",
    attempt_orphaned: r.attempt?.orphaned ?? null,
    status_terminal: r.view === null ? "missing_view" : "attempt_terminal_state" in r.view ? r.view.attempt_terminal_state : "missing_field",
    status_awaiting: r.view?.awaiting ?? null, status_qualified: r.view?.qualified_release ?? null, closed_audit_ok: r.audit.ok,
  };
}
const UNKNOWN_EXPECTED = (tokens: string[]) => ({
  thrown: null, spawn_calls: 1, orphaned: true, awaiting: "teardown", qualified_release: false, instance_id_matches: true,
  teardown_ok: false, teardown_confirmed: false, failure_tokens: Object.fromEntries(tokens.map((t) => [t, true])),
  state_nonterminal: true, attempt_present: true, view_present: true, attempt_terminal: null, attempt_orphaned: true,
  status_terminal: null, status_awaiting: "teardown", status_qualified: false, closed_audit_ok: false,
});

// ── F1 ──

/** Arm a one-shot real append failure for the first "spawned" event; returns the activation record. */
function armSpawnedAppendFault(rt: any, root: string) {
  const state = { armed: false, eacces_verified: false, original_threw: null as string | null };
  const orig = rt.emitLifecycle.bind(rt);
  rt.emitLifecycle = (instance: unknown, eventName: string, ...rest: unknown[]) => {
    if (eventName !== "spawned" || state.armed) return orig(instance, eventName, ...rest);
    state.armed = true;
    const events = path.join(runDir(root), "task-cell-telemetry", "events.jsonl");
    fs.chmodSync(events, 0o400);
    const restore = () => fs.chmodSync(events, 0o600);
    faultRestores.push(restore);
    try { fs.closeSync(fs.openSync(events, "a")); } catch (e) { state.eacces_verified = (e as NodeJS.ErrnoException).code === "EACCES"; }
    try {
      return orig(instance, eventName, ...rest);
    } catch (e) {
      state.original_threw = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
      throw e;
    } finally {
      restore();
    }
  };
  return state;
}

describe("C8-F1 · a real spawn followed by a failing spawned-lifecycle append settles as a nonterminal orphan", () => {
  it("child alive, fault verified active; ids and cap slot retained; runLane returns the orphan outcome; supervision continues", async () => {
    let child: ReturnType<typeof liveChild> | null = null;
    let fault: ReturnType<typeof armSpawnedAppendFault> | null = null;
    const r = await lane(function (this: any) { child = liveChild(this.root); return { ok: true, reason: null }; }, {
      wrap: (rt, root) => { fault = armSpawnedAppendFault(rt, root); },
    });
    // Preconditions: the real worker is alive and the real append actually failed with EACCES.
    expect(child!.alive()).toBe(true);
    expect(fault).toMatchObject({ armed: true, eacces_verified: true, original_threw: "EACCES" });
    expect({ ...unknownObservation(r, ["spawn_outcome_unknown"]), heartbeat_at_return: r.heartbeatAtReturn })
      .toEqual({ ...UNKNOWN_EXPECTED(["spawn_outcome_unknown"]), heartbeat_at_return: "supervising" });
    expect(child!.alive()).toBe(true);
  });
});

// ── F2 ──

const PORT_TRANSPORT = "pane";
/** A required v1 identity field left out entirely (not null, not empty). */
const OMIT = Symbol("omit");
type TransportId = string | typeof OMIT;
type HandleCase = [label: string, value: unknown, outcomeTransport?: TransportId, portTransport?: TransportId];
const UNUSABLE: HandleCase[] = [
  ["empty handle_id", { transport_id: PORT_TRANSPORT, handle_id: "", host_id: null, host_kind: null, invocation: null }],
  ["whitespace handle_id", { transport_id: PORT_TRANSPORT, handle_id: "   ", host_id: null, host_kind: null, invocation: null }],
  ["non-string handle_id", { transport_id: PORT_TRANSPORT, handle_id: 42, host_id: null, host_kind: null, invocation: null }],
  ["handle transport_id differs from the outcome and the port", { transport_id: "serial", handle_id: "h-1", host_id: null, host_kind: null, invocation: null }],
  ["outcome transport_id differs from the port", { transport_id: "serial", handle_id: "h-1", host_id: null, host_kind: null, invocation: null }, "serial"],
  ["unknown handle transport_id", { transport_id: "bogus", handle_id: "h-1", host_id: null, host_kind: null, invocation: null }],
  // Required-identity boundary: a missing v1 transport_id is never optional.
  ["missing outcome transport_id", { transport_id: PORT_TRANSPORT, handle_id: "h-1", host_id: null, host_kind: null, invocation: null }, OMIT],
  ["missing port transport_id", { transport_id: PORT_TRANSPORT, handle_id: "h-1", host_id: null, host_kind: null, invocation: null }, PORT_TRANSPORT, OMIT],
];

const withTransport = <T extends object>(o: T, id: TransportId): T => (id === OMIT ? o : { ...o, transport_id: id });

function handleDouble(root: string | null, value: unknown, outcomeTransport: TransportId = PORT_TRANSPORT, status = "succeeded", portTransport: TransportId = PORT_TRANSPORT) {
  const state = { child: null as ReturnType<typeof liveChild> | null, calls: 0 };
  const transport = withTransport({
    schema_version: "execution_transport.v1", contract_version: 1,
    supports: (op: string) => op === "spawn",
    spawn: () => {
      state.calls++;
      if (status === "unsupported") return withTransport({ operation: "spawn", status, reason_code: "unsupported_operation", detail: "unsupported", value: null, facts: {} }, outcomeTransport);
      if (root) state.child = liveChild(root);
      return withTransport({ operation: "spawn", status, reason_code: null, detail: null, value, facts: {} }, outcomeTransport);
    },
    send: () => ({ status: "unsupported", reason_code: "unsupported_operation", detail: null, value: null }),
    interrupt: () => ({ status: "unsupported", reason_code: "unsupported_operation", detail: null, value: null }),
    close: () => ({ status: "unsupported", reason_code: "unsupported_operation", detail: null, value: null }),
  }, portTransport);
  const port = new ExecutionTransportTaskCellWorkerPort({ transport: transport as never, filesystemAssignmentWakeup: true, requestFor: () => ({ handle_id: "h-1", payload: {} }) as never });
  return { port, state };
}

describe("C8-F2 · adapter: a truthy but unusable handle is never stored or ready and is spawn_effect unknown", () => {
  for (const [label, value, outcomeTransport, portTransport] of UNUSABLE) {
    it(label, () => {
      const root = ownedTempDir("guild-e00-c8-");
      const { port, state } = handleDouble(root, value, outcomeTransport, "succeeded", portTransport);
      const s = port.spawn({ instance_id: "i1", run_id: "r1", assignment_path: "a.json", instance: {} as never }) as { ok: boolean; spawn_effect?: string };
      expect(state.child!.alive()).toBe(true);
      const ready = port.ready({ instance_id: "i1", run_id: "r1" });
      const notify = port.notifyAssignment({ instance_id: "i1", run_id: "r1", assignment_path: "a.json" });
      expect({ spawn_ok: s.ok, spawn_effect: s.spawn_effect ?? "absent", ready_ok: ready.ok, notify_ok: notify.ok })
        .toEqual({ spawn_ok: false, spawn_effect: "unknown", ready_ok: false, notify_ok: false });
    });
  }

  it("control: a valid handle matching the outcome and port is stored and ready", () => {
    const { port } = handleDouble(null, { transport_id: PORT_TRANSPORT, handle_id: "h-1", host_id: null, host_kind: null, invocation: null });
    const s = port.spawn({ instance_id: "i1", run_id: "r1", assignment_path: "a.json", instance: {} as never }) as { ok: boolean; spawn_effect?: string };
    expect(s.ok).toBe(true);
    expect(s.spawn_effect ?? "none").not.toBe("unknown");
    expect(port.ready({ instance_id: "i1", run_id: "r1" }).ok).toBe(true);
  });

  it("control: a valid transport-assigned handle_id different from the requested one is stored and ready", () => {
    const { port } = handleDouble(null, { transport_id: PORT_TRANSPORT, handle_id: "h-transport-assigned-7", host_id: null, host_kind: null, invocation: null });
    const s = port.spawn({ instance_id: "i1", run_id: "r1", assignment_path: "a.json", instance: {} as never }) as { ok: boolean; spawn_effect?: string };
    expect({ ok: s.ok, unknown: (s.spawn_effect ?? "none") === "unknown", ready: port.ready({ instance_id: "i1", run_id: "r1" }).ok })
      .toEqual({ ok: true, unknown: false, ready: true });
  });

  it("control: an actual unsupported spawn is none and stores nothing", () => {
    const { port, state } = handleDouble(null, null, PORT_TRANSPORT, "unsupported");
    const s = port.spawn({ instance_id: "i1", run_id: "r1", assignment_path: "a.json", instance: {} as never }) as { ok: boolean; spawn_effect?: string };
    expect(state.child).toBeNull();
    expect({ ok: s.ok, spawn_effect: s.spawn_effect ?? "none" }).toEqual({ ok: false, spawn_effect: "none" });
    expect(port.ready({ instance_id: "i1", run_id: "r1" }).ok).toBe(false);
  });
});

describe("C8-F2 · controller: an unusable handle never advances; the lane settles as a nonterminal orphan", () => {
  for (const [label, value, outcomeTransport, portTransport] of UNUSABLE) {
    it(label, async () => {
      let d: ReturnType<typeof handleDouble> | null = null;
      const r = await lane(function (this: any, input: any) { d = handleDouble(this.root, value, outcomeTransport, "succeeded", portTransport); return d.port.spawn(input); });
      expect(d!.state.child!.alive()).toBe(true);
      expect(unknownObservation(r, ["spawn_outcome_unknown"])).toEqual(UNKNOWN_EXPECTED(["spawn_outcome_unknown"]));
    });
  }
});

// ── C8-A1 ──

describe("C8-A1 · the station result refuses while any allocated nonterminal orphan is live", () => {
  it("live controller with an actual unknown orphan: writeStationResult refuses station_not_settled and publishes nothing", async () => {
    let d: ReturnType<typeof handleDouble> | null = null;
    const r = await lane(function (this: any, input: any) {
      d = handleDouble(this.root, { transport_id: PORT_TRANSPORT, handle_id: "h-1", host_id: null, host_kind: null, invocation: null }, PORT_TRANSPORT, "failed");
      return d.port.spawn(input);
    }, { probeStation: true });
    // Preconditions: the child is alive and the lane is the nonterminal unknown orphan.
    expect(d!.state.child!.alive()).toBe(true);
    expect(r.out).toMatchObject({ orphaned: true, awaiting: "teardown" });
    expect(r.attempt?.terminal_state === null && r.attempt !== null).toBe(true);
    expect(r.station).toEqual({ refused: "station_not_settled", published: null, files_after: [] });
  });

  // The guard covers EVERY allocated nonterminal instance, not only the typed unknown spawn:
  // an instance orphaned before this.instances.push (readiness or delivery failure whose
  // teardown is refused) must also block the station result.
  const refuseTeardown = () => ({ ok: false, reason: "fixture: worker teardown refused" });
  const preAssignmentOrphans: Array<[string, Record<string, (this: any, input: any) => any>]> = [
    ["readiness failure with refused teardown", { ready: () => ({ ok: false, reason: "fixture: never ready" }), terminate: refuseTeardown }],
    ["assignment delivery failure with refused teardown", { notifyAssignment: () => ({ ok: false, reason: "fixture: delivery failed" }), terminate: refuseTeardown }],
  ];
  for (const [label, port] of preAssignmentOrphans) {
    it(`${label}: a live allocated nonterminal orphan blocks the station result; nothing is published`, async () => {
      let child: ReturnType<typeof liveChild> | null = null;
      const r = await lane(function (this: any) { child = liveChild(this.root); return { ok: true, reason: null }; }, { port, probeStation: true });
      // Preconditions: real child alive; the attempt exists, is nonterminal and orphaned; teardown unconfirmed.
      expect(child!.alive()).toBe(true);
      expect({ thrown: r.thrown?.message ?? null, attempt_present: r.attempt !== null, attempt_terminal: r.attempt ? r.attempt.terminal_state : "missing_record", attempt_orphaned: r.attempt?.orphaned ?? null, awaiting: r.out?.awaiting ?? null, teardown_confirmed: r.out?.teardown?.confirmed ?? null })
        .toEqual({ thrown: null, attempt_present: true, attempt_terminal: null, attempt_orphaned: true, awaiting: "teardown", teardown_confirmed: false });
      expect(r.station).toEqual({ refused: "station_not_settled", published: null, files_after: [] });
    });
  }

  it("control: an all-terminal station publishes its team result", async () => {
    const r = await lane(null, { lead: "accepted", hook: (c) => { c.preflight = () => ({ ok: true }); }, probeStation: true });
    expect(r.attempt?.terminal_state).toBe("terminated");
    expect(r.station?.refused ?? null).toBeNull();
    expect(typeof r.station?.published).toBe("string");
    expect(r.station?.files_after.length).toBe(1);
  });

  it("control: a terminal lane with incomplete cleanup evidence is still station-settled; the closed audit fails separately", async () => {
    const r = await lane(null, {
      lead: "accepted", probeStation: true,
      hook: (c) => { c.preflight = () => ({ ok: true }); },
      wrap: (rt, root) => {
        const orig = rt.terminate.bind(rt);
        rt.terminate = async (i: { instance_id: string }, ...a: unknown[]) => {
          const dir = path.join(runDir(root), "task-cell-telemetry", "event-ids");
          const seq = fs.readdirSync(dir).filter((n) => n.startsWith(`${i.instance_id}.`)).length + 2;
          fs.writeFileSync(path.join(dir, `${i.instance_id}.${String(seq).padStart(6, "0")}.terminated`), "planted by test\n", { flag: "wx" });
          return orig(i, ...a);
        };
      },
    });
    expect(r.attempt?.terminal_state).toBe("terminated");
    expect(r.station?.refused ?? null).toBeNull();
    expect(r.station?.files_after.length).toBe(1);
    expect(r.audit.ok).toBe(false);
  });
});
