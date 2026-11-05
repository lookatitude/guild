/**
 * E00-T0-C-R1 · TA regressions for G-lane:E00-C r1 blockers F2 and F7, plus the
 * F1 interface declaration (review/G-lane-E00-C/result-r1.json, design r12,
 * root resolutions Q1-Q3). Expected red until E00-C corrects them.
 *
 * Mechanics only (CD16): source runs, OS-temp owned roots, the public facade
 * (startTaskCellController, recordControllerLoss, approveOraclePlan) and its
 * declared ports (TaskCellWorkerPort, LossTeardownPort). The F7 teardown port is
 * a recording seam over fake pane identities: it never signals a process. Team
 * authority is built through the existing contracts (composeProposal ->
 * writeProposal, recordDecision -> writeDecision); nothing here is review,
 * broker or installed-package evidence. F1/F3-F6 need an installed package and
 * live in tc/e00-c-r1.tc.test.ts (not executed without E00_TC_PACKAGE_ROOT).
 *
 * F2 membership (root Q3): the oracle plan's approved_plan_ref must equal the
 * approved proposal's hash-bound spec_ref (or plan_ref); that regular JSON's
 * work_items[].id/owner gives lane membership and the owning role. The team
 * decision must approve that exact proposal for this run and phase.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { taskCellPaths } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { composeStationTeam } from "../../src/domains/teams";
import {
  FIXED_NOW, FULL_RUNGS, FakeWorkerPort, PLUGIN, driveLane, makeRuntime, ownedTempDir, requireExport, sha256,
  teardownOwned, tempRoot, walkFiles, type TempRoot,
  hostBootSession
} from "./support/e00-harness";
import { writeApprovedTeam } from "./support/team-authority-fixture";

afterEach(teardownOwned);

const FACADE = "src/domains/dispatch/index.ts";
const RUN = "run-e00-cr1";
const LEAD = "lead-binding-cr1";
const REVIEWER = "cr1-review";

// ── F2 fixture: genuine proposal / decision / approved machine plan ──────────

interface Lane { id: string; role: string; reviewer?: boolean }
interface Variant {
  /** work_items written to the approved plan JSON (default: one per lane, owner = role). */
  workItems?: Array<{ id: string; owner: string }>;
  /** Mutate the oracle plan before approval (refs, lanes). */
  oracle?: (plan: Record<string, any>, f: Fixture) => void;
  /** LaneSpec role override for the dispatched lane. */
  specRole?: string;
}
interface Fixture { root: string; runId: string; bindingRef: string; runDir: string; specRel: string; decisionRel: string; proposal: Record<string, any> }

function buildRoot(lanes: Lane[], v: Variant): Fixture {
  const root = ownedTempDir("guild-e00-cr1-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: RUN }).binding_ref;
  const runDir = path.join(root, ".guild", "runs", RUN);

  const specRel = ".guild/plan/e00-cr1.spec.json";
  const team = writeApprovedTeam(root, RUN, lanes, { reviewerId: REVIEWER, planRel: specRel, workItems: v.workItems });
  const f: Fixture = { root, runId: RUN, bindingRef, runDir, specRel, decisionRel: team.teamDecisionRef.path, proposal: team.proposal };
  const oracle: Record<string, any> = {
    schema_version: "guild.task_oracle_plan.v1",
    approved_plan_ref: team.approvedPlanRef,
    team_decision_ref: team.teamDecisionRef,
    lead_binding_id: LEAD,
    acceptance_policy_version: "E00.1",
    lanes: lanes.map((l) => ({
      logical_task_id: l.id,
      authorities_required: l.reviewer ? ["deterministic_floor", "team_lead", "reviewer_cell"] : ["deterministic_floor", "team_lead"],
      reviewer_participant_id: l.reviewer ? REVIEWER : null,
      done_when: [{ id: "artifact", oracle: "artifact_exists", target: JSON.stringify({ path: `src/out/${l.id}.txt`, sha256: null }) }],
    })),
  };
  v.oracle?.(oracle, f);
  fs.mkdirSync(path.join(runDir, "oracle-plan"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "oracle-plan", "build.json"), JSON.stringify(oracle, null, 2) + "\n");
  return f;
}

function laneSpec(f: Fixture, id: string, role: string) {
  const contextRel = `.guild/context/${f.runId}/${role}-${id}.md`;
  fs.mkdirSync(path.dirname(path.join(f.root, contextRel)), { recursive: true });
  fs.writeFileSync(path.join(f.root, contextRel), `# context ${id}\n`);
  return {
    logical_task_id: id, worker_role: role,
    specialist: { type_id: role, type_version: "1", type_hash: "sha256:type", profile_id: role, profile_hash: "sha256:profile" },
    host: { host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:caps", host_family: "anthropic" },
    model: { tier: "mid", model_id: "fixture-model" },
    context_bundle_id: contextRel, objective: `implement ${id}`, non_goals: [], scope_paths: ["src"],
    acceptance_tests: ["fixture"], dependencies: [],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    autonomy_policy: "supervised", deadline: null,
    ready_timeout_ms: 0, ack_timeout_ms: 0, receipt_timeout_ms: 0, review_timeout_ms: 0,
  };
}

const assignmentsUnder = (f: Fixture) => walkFiles(path.join(f.runDir, "task-cells")).filter((p) => path.basename(p) === "assignment.json");

/**
 * Approve, start through the package facade and run one lane. Returns where the
 * lane was stopped: a start refusal, a lane refusal, or an admitted assignment.
 */
async function admitLane(lanes: Lane[], dispatch: string, v: Variant = {}) {
  const approve = await requireExport<(o: unknown) => { ok: boolean }>(FACADE, "approveOraclePlan");
  const start = await requireExport<(o: unknown) => any>(FACADE, "startTaskCellController");
  const f = buildRoot(lanes, v);
  expect(approve({ cwd: f.root, runId: f.runId, phase: "build", decidedBy: "cr1-operator", now: () => FIXED_NOW }).ok).toBe(true);
  let seq = 0;
  const started = start({
    cwd: f.root, runId: f.runId, phase: "build", workerTrustPolicy: "cooperative_local", now: () => FIXED_NOW,
    binding: { binding_ref: f.bindingRef }, worker: new FakeWorkerPort(), rungPlan: FULL_RUNGS,
    proposal: f.proposal, sleep: async () => undefined, idFactory: (k: string) => `${k}-${++seq}`,
  });
  if (!started.ok) return { f, startRefusal: started.reason as string, lane: null, assignments: assignmentsUnder(f) };
  const controller = started.controller;
  try {
    controller.writeStationPlan(composeStationTeam("build", {}, { tierIndex: {} }));
    const lane = lanes.find((l) => l.id === dispatch)!;
    const out = await controller.runLane(laneSpec(f, dispatch, v.specRole ?? lane?.role ?? "backend"));
    return { f, startRefusal: null, lane: out as Record<string, any>, assignments: assignmentsUnder(f) };
  } finally {
    controller.close();
  }
}

/** Refused before any assignment: either start refused, or the lane refused with no instance. */
function expectRefusedBeforeAssignment(r: Awaited<ReturnType<typeof admitLane>>) {
  expect(r.assignments).toEqual([]);
  if (r.startRefusal === null) expect(r.lane).toMatchObject({ state: "refused", instance_id: null });
  else expect(typeof r.startRefusal).toBe("string");
}

const ONE: Lane[] = [{ id: "T1", role: "backend" }];

describe("C-R1 F2 · approved plan, team decision, lane membership and authority set (TA mechanics)", () => {
  it("control: a genuinely bound plan admits the lane (assignment delivered)", async () => {
    const r = await admitLane(ONE, "T1");
    expect(r.startRefusal).toBeNull();
    expect(r.lane!.instance_id).not.toBeNull();
    expect(r.assignments.length).toBe(1);
  });

  const negatives: Array<[string, Lane[], string, Variant]> = [
    ["approved_plan_ref hash does not match the referenced bytes", ONE, "T1",
      { oracle: (p) => { p.approved_plan_ref = { ...p.approved_plan_ref, sha256: "a".repeat(64) }; } }],
    ["team_decision_ref hash does not match the referenced bytes", ONE, "T1",
      { oracle: (p) => { p.team_decision_ref = { ...p.team_decision_ref, sha256: "b".repeat(64) }; } }],
    ["approved_plan_ref names a hash-matching JSON the approved proposal does not bind", ONE, "T1",
      { oracle: (p, f) => {
        const rel = ".guild/plan/unbound.json";
        const bytes = fs.readFileSync(path.join(f.root, f.specRel));
        fs.writeFileSync(path.join(f.root, rel), bytes.toString("utf8").replace("guild.e00_approved_plan.v1", "guild.e00_unbound_plan.v1"));
        p.approved_plan_ref = { path: rel, sha256: sha256(fs.readFileSync(path.join(f.root, rel))) };
      } }],
    ["team_decision_ref names a regular file that is not the proposal's team decision", ONE, "T1",
      { oracle: (p, f) => {
        const rel = ".guild/plan/not-a-decision.json";
        fs.writeFileSync(path.join(f.root, rel), "{\"schema_version\":\"guild.team_decision.v1\"}\n");
        p.team_decision_ref = { path: rel, sha256: sha256(fs.readFileSync(path.join(f.root, rel))) };
      } }],
    ["the dispatched lane is absent from the approved work_items", ONE, "T1", { workItems: [{ id: "T9", owner: "backend" }] }],
    ["the approved work_item owner differs from the LaneSpec role", ONE, "T1", { specRole: "frontend" }],
    ["reviewer_participant_id is null but authorities_required includes reviewer_cell", ONE, "T1",
      { oracle: (p) => { p.lanes[0].authorities_required = ["deterministic_floor", "team_lead", "reviewer_cell"]; } }],
    ["reviewer_participant_id is set but authorities_required omits reviewer_cell", [{ id: "T1", role: "backend", reviewer: true }], "T1",
      { oracle: (p) => { p.lanes[0].authorities_required = ["deterministic_floor", "team_lead"]; } }],
    ["authorities_required omits team_lead", ONE, "T1",
      { oracle: (p) => { p.lanes[0].authorities_required = ["deterministic_floor"]; } }],
    ["authorities_required carries an unknown authority", ONE, "T1",
      { oracle: (p) => { p.lanes[0].authorities_required = ["deterministic_floor", "team_lead", "operator_override"]; } }],
  ];
  for (const [label, lanes, id, v] of negatives) {
    it(`${label}: refused before any assignment`, async () => {
      expectRefusedBeforeAssignment(await admitLane(lanes, id, v));
    });
  }
});

// ── F7 fixture: dead owner, a spawned handle, a recording teardown port ──────

function selfBoot(): string {
  return hostBootSession();
}

/** Negative / setup fixture: a dead owner's claim (CD5), as in e00-controller-ta. */
function plantDeadClaim(root: TempRoot) {
  const dir = path.join(root.cwd, ".guild", "runs", root.runId, "controller");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "controller.json"), JSON.stringify({
    schema_version: "guild.task_cell_controller.v1", run_id: root.runId,
    oracle_plan: { path: "oracle-plan/build.json", sha256: "a".repeat(64) },
    oracle_plan_decision: { path: "oracle-plan/build.decision.json", sha256: "b".repeat(64) },
    lead_binding_id: "lead-binding-e00", root_id: "fixture", source_id: "source:fixture", root_fingerprint: "c".repeat(64),
    source_revision: null, controller_instance_id: "ctl-cr1", pid: 2 ** 22 - 3, process_start: "Thu Jan  1 00:00:00 1970",
    boot_session: selfBoot(), operator_uid: process.getuid?.() ?? 0,
    package_identity: null, package_release_version: null, package_current_package: null, package_root: null,
    worker_trust_policy: "cooperative_local", provider: "cooperative_local", host_profile_id: null, started_at: FIXED_NOW,
  }, null, 2) + "\n", { flag: "wx" });
  fs.writeFileSync(path.join(dir, "heartbeat.json"), JSON.stringify({ state: "supervising", heartbeat_at: FIXED_NOW }) + "\n");
}

// Fake identities: these pids are never signalled (the port only records calls).
const PANE = { pane_id: "%7", pane_pid: 424242, pane_process_start: "Mon Oct 26 12:00:00 2026", server_pid: 434343, server_process_start: "Mon Oct 26 11:00:00 2026" };

async function lossOverSpawnedHandle(current: { panePid: number; paneStart: string }) {
  const recordLoss = await requireExport<(o: unknown) => any>(FACADE, "recordControllerLoss");
  const root = tempRoot("guild-e00-cr1-loss-", RUN);
  const rt = makeRuntime(root);
  const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend", stopAfterDeliver: true });
  plantDeadClaim(root);
  const handles = path.join(root.cwd, ".guild", "runs", root.runId, "controller", "handles");
  fs.mkdirSync(handles, { recursive: true });
  fs.writeFileSync(path.join(handles, `${d.instance.instance_id}.json`), JSON.stringify({
    schema_version: "guild.task_cell_controller_handle.v1", instance_id: d.instance.instance_id, state: "spawned", ...PANE,
  }, null, 2) + "\n");
  const calls: string[] = [];
  const port = {
    serverIdentity: () => { calls.push("serverIdentity"); return { pid: PANE.server_pid, process_start: PANE.server_process_start }; },
    panePid: (id: string) => { calls.push(`panePid:${id}`); return current.panePid; },
    processStart: (pid: number) => { calls.push(`processStart:${pid}`); return pid === current.panePid ? current.paneStart : null; },
    terminatePane: (id: string) => { calls.push(`terminatePane:${id}`); return { ok: true, confirmed: true, degraded: false, polls: 1, error: null }; },
  };
  const out = recordLoss({ cwd: root.cwd, runId: root.runId, now: () => FIXED_NOW, teardown: port });
  const ids = { run_id: root.runId, logical_task_id: "T1", attempt: 1, instance_id: d.instance.instance_id };
  const attempt = JSON.parse(fs.readFileSync(path.join(root.cwd, taskCellPaths(ids).attempt_path), "utf8"));
  return { out, calls, attempt };
}

describe("C-R1 F7 · record-loss verifies pane PID + process start BEFORE terminatePane (TA mechanics)", () => {
  it("control: the recorded identity reaches terminatePane exactly once", async () => {
    const { out, calls } = await lossOverSpawnedHandle({ panePid: PANE.pane_pid, paneStart: PANE.pane_process_start });
    expect(out.ok).toBe(true);
    expect(calls.filter((c) => c.startsWith("terminatePane:")).length).toBe(1);
  });

  it("control: a different current pane pid is identity_mismatch and never terminated", async () => {
    const { out, calls } = await lossOverSpawnedHandle({ panePid: PANE.pane_pid + 1, paneStart: PANE.pane_process_start });
    expect(calls.some((c) => c.startsWith("terminatePane:"))).toBe(false);
    expect(JSON.stringify(out.attempts)).toContain("identity_mismatch");
  });

  it("a respawned pane with the same pid but a different process start is never terminated (identity_mismatch, orphaned)", async () => {
    const { out, calls, attempt } = await lossOverSpawnedHandle({ panePid: PANE.pane_pid, paneStart: "Tue Oct 27 09:00:00 2026" });
    expect(calls.some((c) => c.startsWith("terminatePane:"))).toBe(false);
    expect(out.attempts.map((a: { outcome: string }) => a.outcome)).toEqual(["identity_mismatch"]);
    expect(attempt.terminal_state ?? null).toBeNull();
    expect(attempt.orphaned).toBe(true);
  });

  it("the pane process start is read fresh before terminatePane is called", async () => {
    const { calls } = await lossOverSpawnedHandle({ panePid: PANE.pane_pid, paneStart: PANE.pane_process_start });
    const kill = calls.indexOf(`terminatePane:${PANE.pane_id}`);
    expect(kill).toBeGreaterThan(-1);
    expect(calls.slice(0, kill)).toContain(`processStart:${PANE.pane_pid}`);
    expect(calls.lastIndexOf(`panePid:${PANE.pane_id}`)).toBeLessThan(kill);
  });
});

// ── F1 declaration: the start interface carries a reviewed-basis proof ──────

describe("C-R1 F1 · reviewed basis is part of the controller start contract (static declaration)", () => {
  it("the controller start options and the claim declare a reviewed basis (root Q2: claim.reviewed_basis)", () => {
    const text = fs.readFileSync(path.join(PLUGIN, "src/domains/dispatch/task-cell-controller.ts"), "utf8");
    const opts = /export interface TaskCellControllerOptions\s*\{([\s\S]*?)\n\}/.exec(text);
    const claim = /export interface TaskCellControllerClaimV1[^{]*\{([\s\S]*?)\n\}/.exec(text);
    expect(opts).not.toBeNull();
    expect(claim).not.toBeNull();
    expect(/reviewed[_A-Za-z]*[Bb]asis/.test(opts![1])).toBe(true);
    expect(/\breviewed_basis\b/.test(claim![1])).toBe(true);
  });

  it("the start refusal vocabulary names basis_unreviewed", () => {
    const text = fs.readFileSync(path.join(PLUGIN, "src/domains/dispatch/task-cell-controller.ts"), "utf8");
    expect(text.includes("basis_unreviewed")).toBe(true);
  });
});
