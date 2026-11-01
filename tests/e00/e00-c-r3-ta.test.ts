/**
 * E00-T0-C-R3 · TA regressions for G-lane:E00-C r3 C-r3-F1
 * (review/G-lane-E00-C/result-r3.json): a lane must not report timed_out,
 * rejected or failed when the runtime teardown returned termination_failed,
 * the observed runtime state is terminating and the attempt is orphaned with no
 * terminal seal. Expected red until E00-C corrects it.
 *
 * Mechanics only (CD16): a source run through startTaskCellController over the
 * REAL runtime (support/controller-lane.ts). The only fault is the worker port's
 * terminate() returning ok:false, the declared TaskCellWorkerPort contract for an
 * unconfirmed teardown; each red has a confirmed-termination control. The
 * catch-all case throws from the controller's runtime.awaitReady (method boundary).
 * Reviewer rejection shares the controller's reject() mapping with the team_lead
 * rejection covered here. No package, host or review evidence is implied.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { taskCellPaths } from "../../src/domains/dispatch";
import { teardownOwned } from "./support/e00-harness";
import { attemptOf, runControllerLane, type LaneOptions, type LaneRun } from "./support/controller-lane";

afterEach(teardownOwned);

const TERMINAL = ["timed_out", "rejected", "failed", "terminated", "cancelled"];

async function observedState(run: LaneRun): Promise<string | null> {
  return (await run.controller.runtime.observe({ instance_id: run.ids!.instance_id, run_id: run.ids!.run_id }))?.handle.state ?? null;
}

/** Confirmed teardown: the lane reports the expected terminal state and the attempt carries the same seal. */
async function expectSettled(opts: LaneOptions, state: string, reason: RegExp) {
  const run = await runControllerLane(opts);
  expect(run.out.state).toBe(state);
  expect(String(run.out.failure_reason)).toMatch(reason);
  expect(attemptOf(run).terminal_state).toBe(state);
  expect(fs.existsSync(path.join(run.root, taskCellPaths(run.ids!).terminal_path))).toBe(true);
  expect(run.port.terminated.length).toBeGreaterThan(0);
}

/** Refused teardown: no terminal lane state, the runtime and attempt stay non-terminal, nothing sealed. */
async function expectUnsettled(opts: LaneOptions) {
  const run = await runControllerLane({ ...opts, port: { ...opts.port, refuseTerminate: true } });
  expect(run.port.terminated.length).toBeGreaterThan(0);
  const attempt = attemptOf(run);
  // Preconditions: the teardown really was refused and left an orphaned, unsealed attempt.
  expect(attempt.terminal_state ?? null).toBeNull();
  expect(attempt.orphaned).toBe(true);
  expect(fs.existsSync(path.join(run.root, taskCellPaths(run.ids!).terminal_path))).toBe(false);
  const runtimeState = await observedState(run);
  expect(runtimeState).toBe("terminating");
  // The defect: the lane outcome must not claim a settled terminal state.
  expect(TERMINAL).not.toContain(run.out.state);
  expect(JSON.stringify(run.out)).toMatch(/termination|teardown|orphan/);
  expect(run.controller.outcomes().every((o: { state: string }) => !TERMINAL.includes(o.state))).toBe(true);
}

describe("C-r3-F1 · terminal lane states only after a confirmed teardown (TA mechanics)", () => {
  it("control: ack timeout with confirmed termination reports timed_out and seals timed_out", async () => {
    await expectSettled({ port: { ack: false } }, "timed_out", /ack_timeout/);
  });
  it("ack timeout with refused termination does not report timed_out", async () => {
    await expectUnsettled({ port: { ack: false } });
  });

  it("control: receipt timeout with confirmed termination reports timed_out and seals timed_out", async () => {
    await expectSettled({ port: { receipt: "none" } }, "timed_out", /receipt_timeout/);
  });
  it("receipt timeout with refused termination does not report timed_out", async () => {
    await expectUnsettled({ port: { receipt: "none" } });
  });

  it("control: a refused controller-observed submission with confirmed forced termination reports failed and seals failed", async () => {
    await expectSettled({ port: { receipt: "foreign" } }, "failed", /./);
  });
  it("a refused controller-observed submission with refused forced termination does not report failed", async () => {
    await expectUnsettled({ port: { receipt: "foreign" } });
  });

  it("control: deterministic-floor rejection with confirmed termination reports rejected and seals rejected", async () => {
    await expectSettled({ port: { receipt: "floor_fail" } }, "rejected", /validation_failed/);
  });
  it("deterministic-floor rejection with refused termination does not report rejected", async () => {
    await expectUnsettled({ port: { receipt: "floor_fail" } });
  });

  it("control: team_lead rejection with confirmed termination reports rejected and seals rejected", async () => {
    await expectSettled({ lead: "rejected" }, "rejected", /fixture lead rejection/);
  });
  it("team_lead rejection with refused termination does not report rejected", async () => {
    await expectUnsettled({ lead: "rejected" });
  });

  const throwOnReady: LaneOptions["wrap"] = (rt) => {
    rt.awaitReady = async () => { throw new Error("fixture: method-boundary fault"); };
  };
  it("control: a controller error with confirmed forced termination reports failed and seals failed", async () => {
    await expectSettled({ wrap: throwOnReady }, "failed", /controller_error/);
  });
  it("a controller error with refused forced termination does not report failed", async () => {
    await expectUnsettled({ wrap: throwOnReady });
  });
});
