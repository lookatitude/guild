/**
 * E00-T0-C-R6 · TA regression for the one remaining bounded-review finding
 * (review/G-lane-E00-C/result-r6.json F1, C-r6-F1): when final.json exists, the
 * closed audit must require cleanup.final_sha256 to match its actual bytes; null
 * is acceptable only when no final record exists.
 *
 * Mechanics only (CD16): a closed E00 controller run built from a source run over
 * the REAL runtime (support/controller-lane.ts, private preflight() stubbed, post-
 * final cleanup, station result), then file edits on the closed run. No package,
 * host or qualification assertion.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { auditTaskCellArtifactJoin } from "../../src/domains/dispatch";
import { sha256, teardownOwned } from "./support/e00-harness";
import { LANE_RUN, runControllerLane, type LaneRun } from "./support/controller-lane";

afterEach(teardownOwned);

async function closedE00(): Promise<LaneRun> {
  const run = await runControllerLane({ lead: "accepted", controllerHook: (c) => { c.preflight = () => ({ ok: true }); } });
  run.controller.writeStationResult();
  return run;
}

const ctrl = (run: LaneRun, ...rel: string[]) => path.join(run.root, ".guild", "runs", LANE_RUN, "controller", ...rel);
const cleanupPath = (run: LaneRun) => ctrl(run, "cleanup", run.ids!.instance_id, "cleanup.json");
const finalPath = (run: LaneRun) => ctrl(run, "acceptance-evidence", run.ids!.instance_id, "final.json");
const audit = (run: LaneRun) => auditTaskCellArtifactJoin({ cwd: run.root, runId: LANE_RUN, requireClosed: true });
const setFinalSha = (run: LaneRun, value: string | null) => {
  const c = JSON.parse(fs.readFileSync(cleanupPath(run), "utf8"));
  c.final_sha256 = value;
  fs.writeFileSync(cleanupPath(run), JSON.stringify(c, null, 2) + "\n");
};

describe("C-r6-F1 · the closed audit verifies cleanup.final_sha256 against an existing final.json (TA mechanics)", () => {
  it("control: final.json exists and cleanup.final_sha256 matches its bytes; the closed audit passes", async () => {
    const run = await closedE00();
    expect(fs.existsSync(finalPath(run))).toBe(true);
    expect(JSON.parse(fs.readFileSync(cleanupPath(run), "utf8")).final_sha256).toBe(sha256(fs.readFileSync(finalPath(run))));
    expect(audit(run).ok).toBe(true);
  });

  it("control (mechanics): no final record and final_sha256 null; the closed audit passes", async () => {
    const run = await closedE00();
    fs.rmSync(finalPath(run));
    setFinalSha(run, null);
    expect(audit(run).ok).toBe(true);
  });

  it("final.json exists but cleanup.final_sha256 is null: the closed audit fails", async () => {
    const run = await closedE00();
    expect(audit(run).ok).toBe(true);
    setFinalSha(run, null);
    expect(fs.existsSync(finalPath(run))).toBe(true);
    expect(JSON.parse(fs.readFileSync(cleanupPath(run), "utf8")).cleanup_state).toBe("complete");
    expect(audit(run).ok).toBe(false);
  });
});
