/**
 * E00-T0 · H5 focused reds for the TeammateIdle CD17b integration (root decisions
 * implementation/e00/h-read-plan-integration-decisions.json Q3, confirmed boundary):
 * authored after the L source freeze and BEFORE any H source change.
 *
 * Contract under test, run on the author-tree compiled bundle the way hooks.json invokes
 * it (node hooks/agent-team/dist/teammate-idle.js). This is compiled mechanics only, not
 * an installed or shipped qualification; H also runs source and rebuilt-bundle checks:
 *   - downstream display tokens are released | blocked | unknown;
 *   - a validated assignment carrying done_when_ref (field presence) is E00: the token
 *     comes from the canonical isQualifiedDownstreamRelease predicate with
 *     cooperative_local / same_run; released only when qualified_release is true; a
 *     definite unqualified verdict is blocked; an unevaluable predicate is unknown;
 *     a malformed ref never downgrades to legacy;
 *   - legacy assignments (no done_when_ref) keep the timestamp display;
 *   - termination authorization ([LANE-ACCEPTED] / [TERMINATE-AUTHORIZED]) is independent.
 *
 * E00 records come from the REAL source controller lane (support/controller-lane.ts,
 * lead accepted, private preflight stub): genuine source-mechanics fixture records,
 * never a package qualification. A qualified E00 positive exists only in gated TC.
 * Legacy records use the same writers as hooks/agent-team/__tests__/teammate-idle.test.ts.
 * Faults are file edits inside the owned temp root. No product edits, no rebuild.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import {
  buildAcceptance, buildTaskCell, isQualifiedDownstreamRelease, runDeterministicFloor, taskCellPaths, writeAcceptanceRecord, writeTaskCell,
  type TaskCellDispatchInput,
} from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { PLUGIN, ownedTempDir, teardownOwned } from "./support/e00-harness";
import { LANE_RUN, runControllerLane, type LaneRun } from "./support/controller-lane";

afterEach(teardownOwned);

const HOOK = path.join(PLUGIN, "hooks", "agent-team", "dist", "teammate-idle.js");
const SESSION = LANE_RUN.replace(/^run-/, "");
const CONSUMER = { policy: "cooperative_local", context: { mode: "same_run" } } as never;

function runHook(root: string, session: string, teammate = "backend"): string {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ session_id: session, cwd: root, hook_event_name: "TeammateIdle", teammate_name: teammate, team_name: "guild-team" }),
    cwd: root, encoding: "utf8", timeout: 30000,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: process.env["HOME"] ?? root, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" },
  });
  return `${r.stdout ?? ""}`;
}

/** The downstream token printed for one instance, or null when its line is absent. */
function tokenFor(stdout: string, instanceId: string): string | null {
  const m = stdout.match(new RegExp(`\\[TERMINATE-AUTHORIZED\\][^\\n]*instance=${instanceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} downstream=(\\S+)`));
  return m ? m[1]! : null;
}

async function e00Lane(): Promise<LaneRun & { paths: ReturnType<typeof taskCellPaths>; acceptance: any; assignment: any }> {
  const run = await runControllerLane({ lead: "accepted", controllerHook: (c) => { c.preflight = () => ({ ok: true }); } });
  const paths = taskCellPaths(run.ids!);
  const acceptance = JSON.parse(fs.readFileSync(path.join(run.root, paths.acceptance_path), "utf8"));
  const assignment = JSON.parse(fs.readFileSync(path.join(run.root, paths.assignment_path), "utf8"));
  return { ...run, paths, acceptance, assignment };
}

const evidence = (run: LaneRun, name: string) => path.join(run.root, ".guild", "runs", LANE_RUN, "controller", "acceptance-evidence", run.ids!.instance_id, name);

/** Anti-vacuity: the record really carries a release timestamp and termination authorization, and the assignment the intended ref. */
function preconditions(run: Awaited<ReturnType<typeof e00Lane>>, refPresent = true) {
  expect(run.acceptance.downstream_release_at).not.toBeNull();
  expect(run.acceptance.termination_authorized_at).not.toBeNull();
  const assignment = JSON.parse(fs.readFileSync(path.join(run.root, run.paths.assignment_path), "utf8"));
  expect(Object.prototype.hasOwnProperty.call(assignment, "done_when_ref")).toBe(refPresent);
}

function e00Observation(run: LaneRun, stdout: string) {
  return {
    lane_accepted: /\[LANE-ACCEPTED\]/.test(stdout),
    terminate_authorized_line: tokenFor(stdout, run.ids!.instance_id) !== null,
    token: tokenFor(stdout, run.ids!.instance_id),
  };
}

describe("H5 · E00 acceptance: the downstream token comes from the canonical predicate, never the raw timestamp", () => {
  it("H5-2 source-mechanics run (no verified package): definite unqualified -> blocked", async () => {
    const run = await e00Lane();
    preconditions(run);
    const verdict = isQualifiedDownstreamRelease(run.root, { ids: run.ids!, acceptance: run.acceptance } as never, CONSUMER);
    expect(verdict.qualified_release).toBe(false);
    expect(e00Observation(run, runHook(run.root, SESSION))).toEqual({ lane_accepted: true, terminate_authorized_line: true, token: "blocked" });
  }, 60_000);

  it("H5-1 final evidence missing: definite unqualified -> blocked", async () => {
    const run = await e00Lane();
    preconditions(run);
    fs.rmSync(evidence(run, "final.json"));
    expect(isQualifiedDownstreamRelease(run.root, { ids: run.ids!, acceptance: run.acceptance } as never, CONSUMER).reason).toBe("finalization_incomplete");
    expect(e00Observation(run, runHook(run.root, SESSION))).toEqual({ lane_accepted: true, terminate_authorized_line: true, token: "blocked" });
  }, 60_000);

  it("H5-4 final evidence acceptance hash tampered: definite unqualified -> blocked", async () => {
    const run = await e00Lane();
    preconditions(run);
    const f = evidence(run, "final.json");
    const final = JSON.parse(fs.readFileSync(f, "utf8"));
    fs.writeFileSync(f, JSON.stringify({ ...final, acceptance_sha256: "0".repeat(64) }, null, 2) + "\n");
    expect(isQualifiedDownstreamRelease(run.root, { ids: run.ids!, acceptance: run.acceptance } as never, CONSUMER).reason).toBe("evidence_binding_mismatch");
    expect(e00Observation(run, runHook(run.root, SESSION))).toEqual({ lane_accepted: true, terminate_authorized_line: true, token: "blocked" });
  }, 60_000);

  it("H5-3 predicate cannot be evaluated: the literal token unknown, never released", async () => {
    const run = await e00Lane();
    preconditions(run);
    // pre.json keeps its schema but loses producer_context: the canonical predicate throws.
    const p = evidence(run, "pre.json");
    const { producer_context: _dropped, ...rest } = JSON.parse(fs.readFileSync(p, "utf8"));
    fs.writeFileSync(p, JSON.stringify(rest, null, 2) + "\n");
    let threw = false;
    try { isQualifiedDownstreamRelease(run.root, { ids: run.ids!, acceptance: run.acceptance } as never, CONSUMER); } catch { threw = true; }
    expect(threw).toBe(true);
    expect(e00Observation(run, runHook(run.root, SESSION))).toEqual({ lane_accepted: true, terminate_authorized_line: true, token: "unknown" });
  }, 60_000);

  it("H5-5 malformed done_when_ref is still E00: never the legacy timestamp display", async () => {
    const run = await e00Lane();
    preconditions(run);
    const a = path.join(run.root, run.paths.assignment_path);
    fs.writeFileSync(a, JSON.stringify({ ...run.assignment, done_when_ref: "not-an-object" }, null, 2) + "\n");
    preconditions(run, true);
    const obs = e00Observation(run, runHook(run.root, SESSION));
    expect({ ...obs, token_ok: obs.token === "blocked" || obs.token === "unknown" }).toEqual({ lane_accepted: true, terminate_authorized_line: true, token: obs.token, token_ok: true });
  }, 60_000);
});

// ── legacy and termination controls ──

const SEED_NOW = () => "2026-07-15T00:00:00.000Z";
function seedLegacy(root: string, runId: string, logicalTaskId: string, lead: "accepted" | "rejected"): { instanceId: string; acceptance: any } {
  const disp: TaskCellDispatchInput = {
    runId, logicalTaskId, taskRunId: `${logicalTaskId}.tr1`, attempt: 1, attemptId: `${logicalTaskId}.att1`, instanceId: `${logicalTaskId}.a1.i1`,
    cellId: `cell-${logicalTaskId}`, goalId: "goal", phaseId: "build", stepId: logicalTaskId, teamId: "guild", workerRole: "backend",
    specialistTypeId: "backend", specialistTypeVersion: "1", specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${runId}/backend.md`, contextBundleHash: "sha256:ctx", hostId: "claude-code-cli", adapterId: "claude-code-cli@1",
    hostCapabilitiesHash: "sha256:caps", substrate: "tmux", modelTier: "mid", objective: `implement ${logicalTaskId}`, nonGoals: [], scopePaths: [],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: [], dependencies: [], projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    autonomyPolicy: "supervised", budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, deadline: null, leadBindingId: "lead-binding", now: SEED_NOW,
  };
  const cell = buildTaskCell(disp);
  const bindingRef = mintRunBinding({ root, run_id: runId }).binding_ref;
  writeTaskCell(root, cell, { binding_ref: bindingRef });
  const validation = runDeterministicFloor({
    assignment: cell.assignment,
    submitted: { receipt_id: "r1", receipt_path: "handoffs/x.md", schema_valid: true, claimed_changed_files: [], acceptance_tests_passed: [], submitted_at: SEED_NOW() },
    validationResultId: "val-1", now: SEED_NOW,
  });
  const accepted = buildAcceptance({
    validation, acceptancePolicyVersion: "1.0.0", authoritiesRequired: ["deterministic_floor", "team_lead"],
    authoritiesObserved: [
      { authority: "deterministic_floor", decision: "accepted", at: SEED_NOW(), reason: null },
      { authority: "team_lead", decision: "accepted", at: SEED_NOW(), reason: null },
    ],
    now: SEED_NOW,
  });
  // buildRejection is domain-internal (not on the dispatch index). Its record is the same
  // acceptanceRecord with downstream_release_at null, termination still authorized, and the
  // observed rejection; that exact shape is persisted through the public writer.
  const acceptance = lead === "accepted" ? accepted : {
    ...accepted, downstream_release_at: null,
    authorities_observed: accepted.authorities_observed.map((o: any) => (o.authority === "team_lead" ? { ...o, decision: "rejected", reason: "fixture rejection" } : o)),
  };
  writeAcceptanceRecord(root, acceptance, { binding_ref: bindingRef });
  return { instanceId: cell.assignment.instance_id, acceptance };
}

describe("H5 controls · legacy display and termination independence", () => {
  it("C-1 legacy assignment (no done_when_ref) with a release timestamp keeps downstream=released", () => {
    const root = ownedTempDir("guild-e00-h5-");
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    const { instanceId, acceptance } = seedLegacy(root, "run-h5-legacy", "lt-backend", "accepted");
    expect(acceptance.downstream_release_at).not.toBeNull();
    expect(acceptance.termination_authorized_at).not.toBeNull();
    const assignment = JSON.parse(fs.readFileSync(path.join(root, taskCellPaths({ run_id: "run-h5-legacy", logical_task_id: "lt-backend", attempt: 1, instance_id: instanceId }).assignment_path), "utf8"));
    expect(Object.prototype.hasOwnProperty.call(assignment, "done_when_ref")).toBe(false);
    const out = runHook(root, "h5-legacy");
    expect({ lane_accepted: /\[LANE-ACCEPTED\]/.test(out), token: tokenFor(out, instanceId) }).toEqual({ lane_accepted: true, token: "released" });
  });

  it("C-2 legacy rejection (no release timestamp, termination authorized): blocked, never released", () => {
    const root = ownedTempDir("guild-e00-h5-");
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    const { instanceId, acceptance } = seedLegacy(root, "run-h5-legacy-r", "lt-backend", "rejected");
    expect(acceptance.downstream_release_at).toBeNull();
    expect(acceptance.termination_authorized_at).not.toBeNull();
    const out = runHook(root, "h5-legacy-r");
    expect({ lane_accepted: /\[LANE-ACCEPTED\]/.test(out), token: tokenFor(out, instanceId) }).toEqual({ lane_accepted: true, token: "blocked" });
  });

  it("C-3 termination stays independent: a blocked E00 lane is still LANE-ACCEPTED / TERMINATE-AUTHORIZED", async () => {
    const run = await e00Lane();
    preconditions(run);
    const out = runHook(run.root, SESSION);
    expect({ lane_accepted: /\[LANE-ACCEPTED\]/.test(out), safe: /safe-to-dismiss/.test(out), line: tokenFor(out, run.ids!.instance_id) !== null })
      .toEqual({ lane_accepted: true, safe: true, line: true });
  }, 60_000);
});
