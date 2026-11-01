/**
 * E00-T0-C-R6 supplementary (POST-FIX, not red-before): the fail-closed branches of
 * the corrected final-record check in the closed audit
 * (src/domains/dispatch/task-cell-cleanup-check.ts). These were authored after the C
 * correction and were never run against the pre-fix validator; the pre-fix red is
 * e00-c-r6-ta.test.ts (final.json present, final_sha256 null).
 *
 * Mechanics only (CD16): closed E00 run from a source run over the REAL runtime
 * (support/controller-lane.ts, private preflight() stubbed), then edits at the
 * final.json path. No package, host or qualification assertion.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { auditTaskCellArtifactJoin } from "../../src/domains/dispatch";
import { sha256, teardownOwned } from "./support/e00-harness";
import { LANE_RUN, runControllerLane, type LaneRun } from "./support/controller-lane";

const restores: Array<() => void> = [];
afterEach(async () => {
  while (restores.length) restores.pop()!();
  await teardownOwned();
});

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
const finalFinding = (run: LaneRun) => [...audit(run).missing, ...audit(run).invalid].some((f) => f.includes("final_sha256") && f.includes(run.ids!.instance_id));

describe("C-r6-F1 post-fix · an existing final record must be a readable regular file matching final_sha256 (TA mechanics)", () => {
  it("final.json is a symlink to identical bytes with the matching hash: the closed audit fails", async () => {
    const run = await closedE00();
    const bytes = fs.readFileSync(finalPath(run));
    const target = path.join(run.root, "final-copy.json");
    fs.writeFileSync(target, bytes);
    fs.rmSync(finalPath(run));
    fs.symlinkSync(target, finalPath(run));
    setFinalSha(run, sha256(bytes));
    expect(audit(run).ok).toBe(false);
    expect(finalFinding(run)).toBe(true);
  });

  it("final.json is a directory and final_sha256 is null: the closed audit fails", async () => {
    const run = await closedE00();
    fs.rmSync(finalPath(run));
    fs.mkdirSync(finalPath(run));
    setFinalSha(run, null);
    expect(audit(run).ok).toBe(false);
    expect(finalFinding(run)).toBe(true);
  });

  it("final.json is unreadable with the matching hash: the closed audit fails", async () => {
    const run = await closedE00();
    const abs = finalPath(run);
    fs.chmodSync(abs, 0o000);
    restores.push(() => { try { fs.chmodSync(abs, 0o600); } catch { /* removed */ } });
    expect(audit(run).ok).toBe(false);
    expect(finalFinding(run)).toBe(true);
  });

  it("no final.json but a non-null final_sha256: the closed audit fails", async () => {
    const run = await closedE00();
    fs.rmSync(finalPath(run));
    expect(audit(run).ok).toBe(false);
    expect(finalFinding(run)).toBe(true);
  });
});
