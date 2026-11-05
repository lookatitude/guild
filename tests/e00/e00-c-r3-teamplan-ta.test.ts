/**
 * E00-T0-C-R3 · the team_plan_publication_failed forced-failure branch of
 * C-r3-F1 (review/G-lane-E00-C/result-r3.json), kept separate so the retained
 * C-r3 red test stays byte-stable.
 *
 * Mechanics only (CD16): source run over the real runtime (support/controller-lane.ts).
 * Deterministic method-boundary fault: after the real runtime.awaitReady, the
 * station team-plan file is moved aside, so publishTaskCellFile returns null and
 * the controller force-terminates with team_plan_publication_failed. The worker
 * port's terminate() then confirms (control) or refuses (red).
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { taskCellPaths } from "../../src/domains/dispatch";
import { teardownOwned } from "./support/e00-harness";
import { LANE_RUN, attemptOf, runControllerLane, type LaneOptions } from "./support/controller-lane";

afterEach(teardownOwned);

const TERMINAL = ["timed_out", "rejected", "failed", "terminated", "cancelled"];

const hidePlanAfterReady: LaneOptions["wrap"] = (rt, root) => {
  const orig = rt.awaitReady.bind(rt);
  rt.awaitReady = async (...a: unknown[]) => {
    const r = await orig(...a);
    const plan = path.join(root, ".guild", "runs", LANE_RUN, "team-plan", "build.json");
    fs.renameSync(plan, `${plan}.hidden`);
    return r;
  };
};

describe("C-r3-F1 · team_plan_publication_failed reports terminal only after a confirmed teardown (TA mechanics)", () => {
  it("control: confirmed forced termination reports failed and seals failed", async () => {
    const run = await runControllerLane({ wrap: hidePlanAfterReady });
    expect(run.out).toMatchObject({ state: "failed", failure_reason: "team_plan_publication_failed" });
    expect(attemptOf(run).terminal_state).toBe("failed");
  });

  it("refused forced termination does not report failed", async () => {
    const run = await runControllerLane({ wrap: hidePlanAfterReady, port: { refuseTerminate: true } });
    expect(JSON.stringify(run.out)).toContain("team_plan_publication_failed");
    const attempt = attemptOf(run);
    expect(attempt.terminal_state ?? null).toBeNull();
    expect(attempt.orphaned).toBe(true);
    expect(fs.existsSync(path.join(run.root, taskCellPaths(run.ids!).terminal_path))).toBe(false);
    expect((await run.controller.runtime.observe({ instance_id: run.ids!.instance_id, run_id: LANE_RUN }))?.handle.state).toBe("terminating");
    expect(TERMINAL).not.toContain(run.out.state);
  });
});
