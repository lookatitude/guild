/**
 * E00-T0-C-R5 supplementary (post-correction) TA checks: the separation the C-r5
 * contract requires, kept apart from the byte-stable pre-fix red file.
 *
 * C-r5-F2: after a cleanup that physically sealed and published, then threw, the
 * retry's failed API result (illegal_state) and the cleanup bookkeeping failure are
 * reported as their own tokens while physical teardown stays confirmed.
 * C-r5-F1: the closed audit names the incomplete-cleanup evidence it refused on.
 *
 * Mechanics only (CD16), same seams as e00-c-r5-ta.test.ts: source run over the
 * REAL runtime, private preflight() stub, private cleanup() throw-after-complete
 * wrapper, planted terminal marker. No package, host or qualification assertion.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { auditTaskCellArtifactJoin } from "../../src/domains/dispatch";
import { teardownOwned } from "./support/e00-harness";
import { LANE_RUN, attemptOf, runControllerLane } from "./support/controller-lane";

afterEach(teardownOwned);

const stubPreflight = (c: any) => { c.preflight = () => ({ ok: true }); };

describe("C-r5-F2 supplementary · retry API failure and cleanup bookkeeping stay distinct from a confirmed physical teardown", () => {
  it("teardown is confirmed and terminal; api:illegal_state and cleanup_threw are separate failure tokens; no orphan or awaiting", async () => {
    const run = await runControllerLane({
      lead: "accepted",
      controllerHook: (c) => {
        stubPreflight(c);
        const orig = c.cleanup.bind(c);
        let n = 0;
        c.cleanup = async (...a: unknown[]) => { const r = await orig(...a); if (++n === 1) throw new Error("fixture: later cleanup step threw"); return r; };
      },
    });
    expect(attemptOf(run)).toMatchObject({ terminal_state: "terminated", immutable: true });
    expect(run.out).toMatchObject({ state: "terminated", orphaned: false });
    expect(run.out.awaiting ?? null).toBeNull();
    expect(run.out.teardown.confirmed).toBe(true);
    expect(run.out.teardown.ok).toBe(false);
    const tokens = String(run.out.teardown.failure).split(",");
    expect(tokens).toContain("api:illegal_state");
    expect(tokens).toContain("cleanup_threw");
    expect(tokens).not.toContain("unconfirmed");
  });
});

describe("C-r5-F1 supplementary · the closed audit names the cleanup evidence it refused on", () => {
  it("a sealed terminal with a missing terminal event fails the closed audit with a cleanup/lifecycle finding for that instance", async () => {
    const run = await runControllerLane({
      lead: "accepted", controllerHook: stubPreflight,
      wrap: (rt, root) => {
        const orig = rt.terminate.bind(rt);
        rt.terminate = async (i: { instance_id: string }, ...a: unknown[]) => {
          const dir = path.join(root, ".guild", "runs", LANE_RUN, "task-cell-telemetry", "event-ids");
          const seq = fs.readdirSync(dir).filter((n) => n.startsWith(`${i.instance_id}.`)).length + 2;
          fs.writeFileSync(path.join(dir, `${i.instance_id}.${String(seq).padStart(6, "0")}.terminated`), "planted by test\n", { flag: "wx" });
          return orig(i, ...a);
        };
      },
    });
    run.controller.writeStationResult();
    const audit = auditTaskCellArtifactJoin({ cwd: run.root, runId: LANE_RUN, requireClosed: true });
    expect(audit.ok).toBe(false);
    const findings = [...audit.missing, ...audit.invalid].filter((f) => f.includes(run.ids!.instance_id));
    expect(findings.some((f) => /cleanup|lifecycle|event/.test(f))).toBe(true);
  });
});
