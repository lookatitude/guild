/**
 * E00-T0-C-R4 · TA regressions for G-lane:E00-C r4 C-r4-F1
 * (review/G-lane-E00-C/result-r4.json): every accepted-fact cleanup must settle
 * the lane from the actual runtime state and terminal seal. A confirmed cleanup
 * reports terminated; a refused or thrown cleanup reports the actual
 * non-terminal state with awaiting teardown and orphan evidence, keeps the
 * primary failure reason, never force-fails the accepted fact, and the handle
 * keeps the actual runtime state (never cleared to null). Expected red until
 * E00-C corrects it; the normal post-final branch is a preservation control.
 *
 * Mechanics only (CD16): source run over the REAL runtime
 * (support/controller-lane.ts). Explicit TA seams: the private preflight() is
 * stubbed (source runs are mechanics_only at P6); acceptance post-state faults
 * use a planted next lifecycle marker; the private cleanup() is wrapped to throw
 * for the thrown-cleanup rows; the worker port's terminate() confirms or refuses.
 * No qualified release is asserted.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { taskCellPaths } from "../../src/domains/dispatch";
import { sha256, teardownOwned } from "./support/e00-harness";
import { LANE_RUN, attemptOf, runControllerLane, type LaneOptions, type LaneRun } from "./support/controller-lane";

afterEach(teardownOwned);

const busLogOf = (root: string) => path.join(root, ".guild", "runs", LANE_RUN, "bus", "log.jsonl");

function plantNextMarker(root: string, iid: string, nth: number, name: string) {
  const dir = path.join(root, ".guild", "runs", LANE_RUN, "task-cell-telemetry", "event-ids");
  const seq = fs.readdirSync(dir).filter((n) => n.startsWith(`${iid}.`)).length + nth;
  fs.writeFileSync(path.join(dir, `${iid}.${String(seq).padStart(6, "0")}.${name}`), "planted by test\n", { flag: "wx" });
}

const stubPreflight = (c: any) => { c.preflight = () => ({ ok: true }); };

/** Original acceptHandoff persists, publishes and transitions, then its handoff_accepted line fails (accepted fact, not finalized). */
const acceptedEventMissing: LaneOptions["wrap"] = (rt, root) => {
  const orig = rt.acceptHandoff.bind(rt);
  rt.acceptHandoff = async (i: { instance_id: string }, req: unknown) => { plantNextMarker(root, i.instance_id, 1, "handoff_accepted"); return orig(i, req); };
};

/** Original collect fails before publication; the validation reconciler completes then throws (repair evidence lost). */
const validationRepairLost: LaneOptions["wrap"] = (rt, root) => {
  const collect = rt.collectHandoff.bind(rt);
  let first = true;
  rt.collectHandoff = async (...a: unknown[]) => {
    if (!first) return collect(...a);
    first = false;
    const bus = busLogOf(root);
    const before = fs.statSync(bus).mode & 0o777;
    fs.chmodSync(bus, 0o444);
    try { return await collect(...a); } finally { fs.chmodSync(bus, before); }
  };
  const rec = rt.reconcilePersistedValidation.bind(rt);
  let n = 0;
  rt.reconcilePersistedValidation = async (...a: unknown[]) => {
    if (++n > 1) return rec(...a);
    await rec(...a);
    throw new Error("fixture: reconciler result lost after its state advance");
  };
};

/** The private cleanup() throws on its first `throws` calls, before doing anything. */
const cleanupThrows = (throws: number) => (c: any) => {
  stubPreflight(c);
  const orig = c.cleanup.bind(c);
  let n = 0;
  c.cleanup = async (...a: unknown[]) => {
    if (++n <= throws) throw new Error(`fixture: cleanup threw #${n}`);
    return orig(...a);
  };
};

function handleOf(run: LaneRun): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(run.root, ".guild", "runs", LANE_RUN, "controller", "handles", `${run.ids!.instance_id}.json`), "utf8"));
}

async function runtimeState(run: LaneRun): Promise<string | null> {
  return (await run.controller.runtime.observe({ instance_id: run.ids!.instance_id, run_id: LANE_RUN }))?.handle.state ?? null;
}

/** Accepted fact stays accepted: bytes are an accepting record, never overwritten by a rejection, attempt never failed. */
function expectAcceptedFactKept(run: LaneRun) {
  const p = path.join(run.root, taskCellPaths(run.ids!).acceptance_path);
  const rec = JSON.parse(fs.readFileSync(p, "utf8"));
  expect(rec.downstream_release_at).not.toBeNull();
  expect(sha256(fs.readFileSync(p))).toBe(sha256(JSON.stringify(rec, null, 2) + "\n"));
  expect(attemptOf(run).terminal_state).not.toBe("failed");
  expect(run.out.qualified_release).toBe(false);
}

async function expectConfirmed(run: LaneRun, primary: RegExp) {
  expectAcceptedFactKept(run);
  expect(attemptOf(run).terminal_state).toBe("terminated");
  expect(await runtimeState(run)).toBe("terminated");
  expect(run.out.state).toBe("terminated");
  expect(String(run.out.failure_reason)).toMatch(primary);
  expect(handleOf(run).runtime_state).toBe("terminated");
}

async function expectUnconfirmed(run: LaneRun, primary: RegExp, actual: string) {
  expectAcceptedFactKept(run);
  expect(attemptOf(run).terminal_state ?? null).toBeNull();
  expect(fs.existsSync(path.join(run.root, taskCellPaths(run.ids!).terminal_path))).toBe(false);
  expect(await runtimeState(run)).toBe(actual);
  expect(run.out.state).toBe(actual);
  expect(run.out.awaiting).toBe("teardown");
  expect(String(run.out.failure_reason)).toMatch(primary);
  expect(handleOf(run)).toMatchObject({ runtime_state: actual, awaiting: "teardown" });
}

describe("C-r4-F1 · accepted fact that cannot be finalized: cleanup result settles the lane (TA mechanics)", () => {
  const base: LaneOptions = { lead: "accepted", wrap: acceptedEventMissing, controllerHook: stubPreflight };
  it("confirmed cleanup reports terminated with the primary reason kept", async () => {
    await expectConfirmed(await runControllerLane(base), /lifecycle_event_incomplete/);
  });
  it("refused cleanup reports the actual terminating state, awaiting teardown, orphaned", async () => {
    const run = await runControllerLane({ ...base, port: { refuseTerminate: true } });
    await expectUnconfirmed(run, /lifecycle_event_incomplete/, "terminating");
    expect(attemptOf(run).orphaned).toBe(true);
  });
});

describe("C-r4-F1 · repair_incomplete accepted path: cleanup result settles the lane (TA mechanics)", () => {
  const base: LaneOptions = { lead: "accepted", wrap: validationRepairLost, controllerHook: stubPreflight };
  it("confirmed cleanup reports terminated with the repair reason kept", async () => {
    const run = await runControllerLane(base);
    expect(fs.existsSync(path.join(run.root, ".guild", "runs", LANE_RUN, "controller", "acceptance-evidence", run.ids!.instance_id, "final.json"))).toBe(false);
    await expectConfirmed(run, /./);
    expect(run.out.failure_reason).not.toBeNull();
  });
  it("refused cleanup reports the actual terminating state, awaiting teardown, orphaned", async () => {
    const run = await runControllerLane({ ...base, port: { refuseTerminate: true } });
    await expectUnconfirmed(run, /./, "terminating");
    expect(run.out.failure_reason).not.toBeNull();
  });
});

describe("C-r4-F1 · generic catch after an accepted fact: thrown cleanup settles from actual state and seal (TA mechanics)", () => {
  it("first cleanup throws, the catch's cleanup confirms: terminated with the thrown primary reason kept", async () => {
    await expectConfirmed(await runControllerLane({ lead: "accepted", controllerHook: cleanupThrows(1) }), /cleanup threw #1/);
  });
  it("first cleanup throws, the catch's cleanup is refused: actual terminating, awaiting teardown, orphaned", async () => {
    const run = await runControllerLane({ lead: "accepted", controllerHook: cleanupThrows(1), port: { refuseTerminate: true } });
    await expectUnconfirmed(run, /cleanup threw #1/, "terminating");
  });
  it("every cleanup throws: no teardown happened; actual handoff_accepted, awaiting teardown, handle not cleared", async () => {
    const run = await runControllerLane({ lead: "accepted", controllerHook: cleanupThrows(2) });
    await expectUnconfirmed(run, /cleanup threw #1/, "handoff_accepted");
  });
});

describe("C-r4 preservation · normal post-final cleanup already settles through the central helper (TA mechanics)", () => {
  it("control: confirmed post-final cleanup reports terminated and the handle tracks it", async () => {
    const run = await runControllerLane({ lead: "accepted", controllerHook: stubPreflight });
    expect(fs.existsSync(path.join(run.root, ".guild", "runs", LANE_RUN, "controller", "acceptance-evidence", run.ids!.instance_id, "final.json"))).toBe(true);
    expect(run.out.state).toBe("terminated");
    expect(attemptOf(run).terminal_state).toBe("terminated");
    expect(handleOf(run).runtime_state).toBe("terminated");
  });
  it("control: refused post-final cleanup reports terminating, awaiting teardown, orphaned", async () => {
    const run = await runControllerLane({ lead: "accepted", controllerHook: stubPreflight, port: { refuseTerminate: true } });
    expect(run.out).toMatchObject({ state: "terminating", awaiting: "teardown" });
    expect(attemptOf(run).orphaned).toBe(true);
    expect(attemptOf(run).terminal_state ?? null).toBeNull();
  });
  it("refused post-final cleanup leaves the handle at the actual terminating state (not cleared)", async () => {
    const run = await runControllerLane({ lead: "accepted", controllerHook: stubPreflight, port: { refuseTerminate: true } });
    expect(handleOf(run)).toMatchObject({ runtime_state: "terminating", awaiting: "teardown" });
  });
});
