/**
 * E00-T0-C-R4 · R4-A1 (root-verified, same CD25 contract as C-r4-F1): the private
 * settleLaneTermination must not drop a prior qualified=true to false when the
 * cleanup teardown is unconfirmed.
 *
 * BOOLEAN PROPAGATION ONLY, in an explicit TA seam. This is NOT a qualification
 * assertion: no package, broker or preflight proof is made or implied, and the
 * `true` passed in is a test input, not a computed release. The termination
 * state and result are real: a source-run lane (support/controller-lane.ts,
 * preflight stubbed) whose post-final cleanup terminate() was confirmed or refused
 * by the worker port; the runtime's actual terminate() result is recorded and
 * passed to the private seam with an explicit qualified=true.
 */
import { describe, it, expect, afterEach } from "bun:test";

import { teardownOwned } from "./support/e00-harness";
import { attemptOf, runControllerLane, type LaneRun } from "./support/controller-lane";

afterEach(teardownOwned);

/** Run a post-final lane and keep the runtime's actual cleanup terminate() result. */
async function postFinalLane(refuseTerminate: boolean) {
  const seen: unknown[] = [];
  const run = await runControllerLane({
    lead: "accepted",
    port: { refuseTerminate },
    controllerHook: (c) => { c.preflight = () => ({ ok: true }); },
    wrap: (rt) => {
      const orig = rt.terminate.bind(rt);
      rt.terminate = async (...a: unknown[]) => { const r = await orig(...a); seen.push(r); return r; };
    },
  });
  return { run, termination: { result: seen[seen.length - 1] ?? null, threw: null } };
}

/** The seam's outcome callback, recording exactly what the controller passes. */
const recordOutcome = (state: string, iid: string | null, failure: string | null, awaiting: string | null = null, qualified = false, extra: Record<string, unknown> = {}) =>
  ({ state, instance_id: iid, failure_reason: failure, awaiting, qualified_release: qualified, ...extra });

async function settle(run: LaneRun, termination: unknown) {
  const handle = run.controller.instances[0].handle;
  return run.controller.settleLaneTermination(handle, null, termination, recordOutcome, true) as Promise<Record<string, any>>;
}

describe("R4-A1 · prior qualified=true propagates through unconfirmed settlement (boolean propagation in a TA seam, not a qualification claim)", () => {
  it("control: confirmed teardown keeps the passed qualified=true with state terminated", async () => {
    const { run, termination } = await postFinalLane(false);
    expect((termination.result as { ok?: boolean }).ok).toBe(true);
    expect(attemptOf(run).terminal_state).toBe("terminated");
    const out = await settle(run, termination);
    expect(out).toMatchObject({ state: "terminated", qualified_release: true });
    expect(out.teardown.confirmed).toBe(true);
  });

  it("refused teardown keeps the passed qualified=true while the state stays terminating, orphaned, awaiting teardown, unconfirmed", async () => {
    const { run, termination } = await postFinalLane(true);
    // Preconditions: the real runtime result and disk state of a refused teardown.
    expect(termination.result).toMatchObject({ ok: false, failure: "termination_failed" });
    expect(attemptOf(run).terminal_state ?? null).toBeNull();
    expect(attemptOf(run).orphaned).toBe(true);
    const out = await settle(run, termination);
    expect(out).toMatchObject({ state: "terminating", awaiting: "teardown", orphaned: true });
    expect(out.teardown.confirmed).toBe(false);
    expect(out.qualified_release).toBe(true);
  });
});
