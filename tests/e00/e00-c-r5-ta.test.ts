/**
 * E00-T0-C-R5 · TA regressions for G-lane:E00-C r5 (review/G-lane-E00-C/result-r5.json).
 *
 * C-r5-F1: the closed TaskCell audit (auditTaskCellArtifactJoin, requireClosed; the
 * task-cell-audit CLI) must refuse an E00 controller run unless every instance has
 * a verified complete cleanup: cleanup.json present, valid and complete, its
 * instance/terminal/final hashes and any terminal-reconciliation ref matching the
 * actual files, and the actual terminal lifecycle event present even when the JSON
 * claims complete. A positive complete-cleanup control and a legacy non-E00 run
 * (runtime only, no controller claim, no cleanup.json) keep their current result.
 *
 * C-r5-F2: when cleanup completed the physical seal and publication and a later
 * cleanup step throws, the generic catch's retry of terminate RETURNS illegal_state;
 * the lane must report the actual terminal state with physical teardown confirmed,
 * the retry/bookkeeping failure visible separately, and no orphan or awaiting
 * teardown. A port that really refused stays unconfirmed and pending.
 *
 * Mechanics only (CD16): source runs over the REAL runtime (support/controller-lane.ts).
 * Explicit TA seams: the private preflight() stub (source runs are mechanics_only at
 * P6), a planted next lifecycle marker, the private cleanup() wrapped to throw after
 * it completed, and file edits on the closed run for the audit negatives. No package,
 * host or qualification assertion.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { auditTaskCellArtifactJoin, taskCellPaths } from "../../src/domains/dispatch";
import { composeStationTeam, writeTeamPlan, writeTeamResult } from "../../src/domains/teams";
import { FIXED_NOW, acceptLane, driveLane, makeRuntime, sha256, teardownOwned, tempRoot } from "./support/e00-harness";
import { LANE_RUN, attemptOf, runControllerLane, type LaneOptions, type LaneRun } from "./support/controller-lane";

afterEach(teardownOwned);

const stubPreflight = (c: any) => { c.preflight = () => ({ ok: true }); };

function plantNextMarker(root: string, iid: string, nth: number, name: string) {
  const dir = path.join(root, ".guild", "runs", LANE_RUN, "task-cell-telemetry", "event-ids");
  const seq = fs.readdirSync(dir).filter((n) => n.startsWith(`${iid}.`)).length + nth;
  fs.writeFileSync(path.join(dir, `${iid}.${String(seq).padStart(6, "0")}.${name}`), "planted by test\n", { flag: "wx" });
}

/** termination_started is the next event, the terminal event the one after: only its line fails. */
const terminalEventMissing: LaneOptions["wrap"] = (rt, root) => {
  const orig = rt.terminate.bind(rt);
  rt.terminate = async (i: { instance_id: string }, ...a: unknown[]) => { plantNextMarker(root, i.instance_id, 2, "terminated"); return orig(i, ...a); };
};

/** An E00 controller run closed through the controller (post-final cleanup, then the station result). */
async function closedE00(opts: Partial<LaneOptions> = {}) {
  const run = await runControllerLane({ lead: "accepted", controllerHook: stubPreflight, ...opts });
  run.controller.writeStationResult();
  return run;
}

const cleanupPath = (run: LaneRun) => path.join(run.root, ".guild", "runs", LANE_RUN, "controller", "cleanup", run.ids!.instance_id, "cleanup.json");
const audit = (run: LaneRun) => auditTaskCellArtifactJoin({ cwd: run.root, runId: LANE_RUN, requireClosed: true });
const editCleanup = (run: LaneRun, edit: (c: Record<string, any>) => void) => {
  const c = JSON.parse(fs.readFileSync(cleanupPath(run), "utf8"));
  edit(c);
  fs.writeFileSync(cleanupPath(run), JSON.stringify(c, null, 2) + "\n");
};

describe("C-r5-F1 · the closed audit verifies E00 cleanup (TA mechanics)", () => {
  it("control: a closed E00 run with complete cleanup passes the closed audit", async () => {
    const run = await closedE00();
    expect(JSON.parse(fs.readFileSync(cleanupPath(run), "utf8"))).toMatchObject({ cleanup_state: "complete", terminal_telemetry_state: "complete" });
    expect(audit(run).ok).toBe(true);
  });

  it("control (legacy, non-E00): a runtime-only closed run without a controller claim or cleanup.json keeps its closed-audit result", async () => {
    const root = tempRoot("guild-e00-cr5-legacy-");
    const rt = makeRuntime(root);
    const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend" });
    expect((await acceptLane(rt, d.instance)).ok).toBe(true);
    expect((await rt.runtime.terminate(d.instance)).ok).toBe(true);
    const planAbs = writeTeamPlan(root.cwd, root.runId, composeStationTeam("build", {}, { tierIndex: {} }), { now: () => FIXED_NOW });
    const paths = taskCellPaths({ run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: d.instance.instance_id });
    writeTeamResult(root.cwd, root.runId, { schema_version: "guild.team_result.v1", station: "build", team_plan_ref: path.relative(root.cwd, planAbs),
      lanes: [{ role: "backend", instance_id: d.instance.instance_id, handoff_ref: paths.handoff_path, acceptance_ref: paths.acceptance_path }] }, { now: () => FIXED_NOW });
    expect(fs.existsSync(path.join(root.cwd, ".guild", "runs", root.runId, "controller"))).toBe(false);
    const r = auditTaskCellArtifactJoin({ cwd: root.cwd, runId: root.runId, requireClosed: true });
    expect({ ok: r.ok, missing: r.missing, invalid: r.invalid }).toEqual({ ok: true, missing: [], invalid: [] });
  });

  it("refuses a sealed, published terminal whose terminal event is missing (cleanup lifecycle_event_incomplete)", async () => {
    const run = await closedE00({ wrap: terminalEventMissing });
    expect(attemptOf(run).terminal_state).toBe("terminated");
    expect(JSON.parse(fs.readFileSync(cleanupPath(run), "utf8")).cleanup_state).toBe("lifecycle_event_incomplete");
    expect(audit(run).ok).toBe(false);
  });

  it("refuses a missing terminal event even when cleanup.json is edited to claim complete", async () => {
    const run = await closedE00({ wrap: terminalEventMissing });
    editCleanup(run, (c) => { c.cleanup_state = "complete"; c.terminal_telemetry_state = "complete"; });
    expect(audit(run).ok).toBe(false);
  });

  const negatives: Array<[string, (run: LaneRun) => void]> = [
    ["cleanup.json is missing", (run) => fs.rmSync(cleanupPath(run))],
    ["cleanup.json is not JSON", (run) => fs.writeFileSync(cleanupPath(run), "{not json")],
    ["cleanup.json has another schema_version", (run) => editCleanup(run, (c) => { c.schema_version = "guild.task_cell_cleanup.v0"; })],
    ["cleanup.json names another instance", (run) => editCleanup(run, (c) => { c.instance_id = "instance-other"; })],
    ["cleanup_state is not complete", (run) => editCleanup(run, (c) => { c.cleanup_state = "pending"; })],
    ["terminal_sha256 does not match the actual terminal record", (run) => editCleanup(run, (c) => { c.terminal_sha256 = "0".repeat(64); })],
    ["final_sha256 does not match the actual final.json", (run) => editCleanup(run, (c) => { c.final_sha256 = "0".repeat(64); })],
    ["terminal_reconciliation names a file that does not exist", (run) => editCleanup(run, (c) => { c.terminal_reconciliation = { path: ".guild/runs/x/missing.json", sha256: "0".repeat(64) }; })],
  ];
  for (const [label, edit] of negatives) {
    it(`refuses a closed E00 run when ${label}`, async () => {
      const run = await closedE00();
      expect(audit(run).ok).toBe(true);
      edit(run);
      expect(audit(run).ok).toBe(false);
    });
  }
});

/** The private cleanup() completes on its first call, then a later step throws (seam). */
const completedThenThrows = (c: any) => {
  stubPreflight(c);
  const orig = c.cleanup.bind(c);
  let n = 0;
  c.cleanup = async (...a: unknown[]) => {
    const r = await orig(...a);
    if (++n === 1) throw new Error("fixture: later cleanup step threw after the physical seal");
    return r;
  };
};

const handleOf = (run: LaneRun) => JSON.parse(fs.readFileSync(path.join(run.root, ".guild", "runs", LANE_RUN, "controller", "handles", `${run.ids!.instance_id}.json`), "utf8"));

describe("C-r5-F2 · a retry after a completed physical cleanup confirms teardown from the seal (TA mechanics)", () => {
  it("cleanup sealed and published, then threw; the retry returns illegal_state: terminal, confirmed, retry failure visible, no awaiting teardown", async () => {
    const seen: unknown[] = [];
    const run = await runControllerLane({
      lead: "accepted", controllerHook: completedThenThrows,
      wrap: (rt) => { const orig = rt.terminate.bind(rt); rt.terminate = async (...a: unknown[]) => { const r = await orig(...a); seen.push(r); return r; }; },
    });
    // Preconditions: the physical seal and publication happened; the retry RETURNED illegal_state.
    expect(attemptOf(run)).toMatchObject({ terminal_state: "terminated", immutable: true });
    expect(fs.existsSync(path.join(run.root, taskCellPaths(run.ids!).terminal_path))).toBe(true);
    expect(seen.length).toBe(2);
    expect(seen[1]).toMatchObject({ ok: false, failure: "illegal_state" });
    // Physical teardown confirmed from the seal; the retry/bookkeeping failure stays visible separately.
    expect(run.out.state).toBe("terminated");
    expect(run.out.awaiting ?? null).toBeNull();
    expect(run.out.teardown.confirmed).toBe(true);
    expect(run.out.orphaned).toBe(false);
    expect(JSON.stringify(run.out.teardown)).toMatch(/illegal_state|cleanup_threw/);
    expect(handleOf(run)).toMatchObject({ runtime_state: "terminated", awaiting: null });
  });

  it("control: a really refused teardown stays unconfirmed and pending (terminating, awaiting teardown, orphaned)", async () => {
    const run = await runControllerLane({ lead: "accepted", controllerHook: completedThenThrows, port: { refuseTerminate: true } });
    expect(attemptOf(run).terminal_state ?? null).toBeNull();
    expect(run.out).toMatchObject({ state: "terminating", awaiting: "teardown", orphaned: true });
    expect(run.out.teardown.confirmed).toBe(false);
  });
});
