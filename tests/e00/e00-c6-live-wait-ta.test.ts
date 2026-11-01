/**
 * E00-C · C6 live-wait status. While acceptLane polls for a team_lead decision or
 * a reviewer_cell result, the operator status (readControllerStatus) must name
 * that wait, so a human or benchmark driver knows a decision is needed before the
 * poll times out. A timeout or refusal still records its own awaiting value; a
 * decision clears it.
 *
 * Mechanics only (CD16): a source run through the package facade over the REAL
 * FilesystemTaskCellRuntime in owned OS-temp roots. The test observes status
 * from the controller's injected sleep, i.e. inside the live poll; the private
 * CD17a preflight is replaced where a lane must pass P6 (source runs are
 * mechanics_only), exactly as the C-r2 TA does.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { readControllerStatus, recordAuthorityDecision, startTaskCellController, taskCellPaths, writeAckClaim } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { composeStationTeam } from "../../src/domains/teams";
import { FIXED_NOW, FULL_RUNGS, FakeWorkerPort, ownedTempDir, receiptBytes, teardownOwned } from "./support/e00-harness";
import { writeApprovedTeam } from "./support/team-authority-fixture";

const RUN = "run-e00-c6lw";
const LEAD = "lead-binding-c6lw";
const REVIEWER = "c6lw-review";

afterEach(teardownOwned);

/** Worker port: on delivery writes the ack claim, the receipt and the artifact oracle target. */
class LanePort extends FakeWorkerPort {
  constructor(private readonly root: string) {
    super();
    this.onNotify = ({ assignment_path }) => {
      const abs = path.resolve(this.root, assignment_path);
      const a = JSON.parse(fs.readFileSync(abs, "utf8"));
      expect(writeAckClaim({ assignmentPath: abs, now: () => FIXED_NOW }).ok).toBe(true);
      const receipt = path.join(this.root, ".guild", "runs", a.run_id, "handoffs", `${a.worker_role}-${a.logical_task_id}.md`);
      fs.mkdirSync(path.dirname(receipt), { recursive: true });
      fs.writeFileSync(receipt, receiptBytes(a.run_id, a));
      fs.mkdirSync(path.join(this.root, "src", "out"), { recursive: true });
      fs.writeFileSync(path.join(this.root, "src", "out", `${a.logical_task_id}.txt`), "done\n");
    };
  }
}

interface Live {
  root: string;
  iid: string;
  validated: boolean;
  /** Operator status awaiting for the lane's instance, read now. */
  awaiting(): unknown;
  decide(decision: "accepted" | "rejected"): void;
  leadDecided(): boolean;
}

interface LaneOpts {
  reviewer?: boolean;
  reviewTimeoutMs: number;
  /** Called from the controller's sleep, i.e. inside every live poll iteration. */
  onPoll: (live: Live) => void;
  /** Called from the replaced preflight, after both authority waits ended. */
  onPreflight?: (live: Live) => void;
  /** Keep the real CD17a preflight, so a source run stops at P6 (CD16). */
  realPreflight?: boolean;
}

async function runLane(opts: LaneOpts) {
  const root = ownedTempDir("guild-e00-c6lw-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: RUN }).binding_ref;
  const team = writeApprovedTeam(root, RUN, [{ id: "T1", role: "backend" }], { reviewerId: REVIEWER, planRel: ".guild/plan/e00-c6lw.spec.json" });
  const dir = path.join(root, ".guild", "runs", RUN, "oracle-plan");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify({
    schema_version: "guild.task_oracle_plan.v1", approved_plan_ref: team.approvedPlanRef, team_decision_ref: team.teamDecisionRef,
    lead_binding_id: LEAD, acceptance_policy_version: "E00.1",
    lanes: [{ logical_task_id: "T1",
      authorities_required: opts.reviewer ? ["deterministic_floor", "team_lead", "reviewer_cell"] : ["deterministic_floor", "team_lead"],
      reviewer_participant_id: opts.reviewer ? REVIEWER : null,
      done_when: [{ id: "artifact", oracle: "artifact_exists", target: JSON.stringify({ path: "src/out/T1.txt", sha256: null }) }] }],
  }, null, 2) + "\n");
  const { approveOraclePlan } = await import("../../src/domains/dispatch");
  expect(approveOraclePlan({ cwd: root, runId: RUN, phase: "build", decidedBy: "c6lw-operator", now: () => FIXED_NOW }).ok).toBe(true);

  const port = new LanePort(root);
  let seq = 0;
  let controller: any = null;
  const live = (): Live | null => {
    const handle = controller?.instances?.[0]?.handle;
    if (!handle) return null;
    const ids = { run_id: RUN, logical_task_id: "T1", attempt: handle.attempt, instance_id: handle.instance_id };
    const decisionAbs = path.join(root, ".guild", "runs", RUN, "controller", "decisions", handle.instance_id, "team_lead.json");
    return {
      root, iid: handle.instance_id,
      validated: fs.existsSync(path.join(root, taskCellPaths(ids).validation_path)),
      awaiting: () => {
        const s = readControllerStatus({ cwd: root, runId: RUN, consumerPolicy: "cooperative_local" }) as { instances?: Array<Record<string, unknown>> };
        return s.instances?.find((i) => i.instance_id === handle.instance_id)?.awaiting;
      },
      decide: (decision) => {
        expect(recordAuthorityDecision({ cwd: root, runId: RUN, instanceId: handle.instance_id, leadBindingId: LEAD, decision, reason: decision === "rejected" ? "c6lw rejects" : null, now: () => FIXED_NOW } as never).ok).toBe(true);
      },
      leadDecided: () => fs.existsSync(decisionAbs),
    };
  };
  const sleep = async () => {
    const l = live();
    if (l) opts.onPoll(l);
    await new Promise((r) => setTimeout(r, 5));
  };
  const started = startTaskCellController({
    cwd: root, runId: RUN, phase: "build", workerTrustPolicy: "cooperative_local", now: () => FIXED_NOW,
    binding: { binding_ref: bindingRef }, worker: port, rungPlan: FULL_RUNGS, proposal: team.proposal as never,
    sleep, idFactory: (k: string) => `${k}-${++seq}`,
  } as never) as any;
  expect(started.ok).toBe(true);
  controller = started.controller;
  try {
    if (!opts.realPreflight) {
      controller.preflight = () => {
        const l = live();
        if (l) opts.onPreflight?.(l);
        return { ok: true };
      };
    }
    controller.writeStationPlan(composeStationTeam("build", {}, { tierIndex: {} }));
    const contextRel = `.guild/context/${RUN}/backend-T1.md`;
    fs.mkdirSync(path.dirname(path.join(root, contextRel)), { recursive: true });
    fs.writeFileSync(path.join(root, contextRel), "# context T1\n");
    const out = await controller.runLane({
      logical_task_id: "T1", worker_role: "backend",
      specialist: { type_id: "backend", type_version: "1", type_hash: "sha256:type", profile_id: "backend", profile_hash: "sha256:profile" },
      host: { host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:caps", host_family: "anthropic" },
      model: { tier: "mid", model_id: "fixture-model" }, context_bundle_id: contextRel, objective: "implement T1", non_goals: [],
      scope_paths: ["src"], acceptance_tests: ["fixture"], dependencies: [],
      projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, autonomy_policy: "supervised", deadline: null,
      ready_timeout_ms: 0, ack_timeout_ms: 0, receipt_timeout_ms: 0, review_timeout_ms: opts.reviewTimeoutMs,
    });
    return { out, final: live()!.awaiting(), root, iid: live()!.iid };
  } finally {
    controller.close();
  }
}

describe("C6 · operator status names the live authority wait before any timeout", () => {
  it("team_lead: awaited while polling, cleared once the decision is accepted", async () => {
    const seen: unknown[] = [];
    let atPreflight: unknown = "unset";
    const r = await runLane({
      reviewTimeoutMs: 60_000,
      onPoll: (l) => {
        if (!l.validated || l.leadDecided()) return;
        seen.push(l.awaiting());
        l.decide("accepted");
      },
      onPreflight: (l) => { atPreflight = l.awaiting(); },
    });
    expect(seen).toEqual(["team_lead"]);
    expect(atPreflight).toBeNull();
    expect(r.out.awaiting).not.toBe("team_lead");
  });

  it("team_lead timeout: awaited throughout the wait, then the recorded timeout value", async () => {
    const seen = new Set<unknown>();
    const r = await runLane({ reviewTimeoutMs: 300, onPoll: (l) => { if (l.validated) seen.add(l.awaiting()); } });
    expect([...seen]).toEqual(["team_lead"]);
    expect(r.out).toMatchObject({ state: "handoff_validated", awaiting: "team_lead" });
    expect(r.final).toBe("team_lead");
  });

  it("team_lead refusal: the refusal reason replaces the live wait", async () => {
    const seen: unknown[] = [];
    const r = await runLane({
      reviewTimeoutMs: 60_000,
      onPoll: (l) => {
        if (!l.validated || l.leadDecided()) return;
        seen.push(l.awaiting());
        const abs = path.join(l.root, ".guild", "runs", RUN, "controller", "decisions", l.iid, "team_lead.json");
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, "{not json");
      },
    });
    expect(seen).toEqual(["team_lead"]);
    expect(r.out.awaiting).toBe("team_lead:team_lead_decision_malformed");
    expect(r.final).toBe("team_lead:team_lead_decision_malformed");
  });

  it("team_lead rejection: the live wait is cleared and never left as team_lead", async () => {
    const seen: unknown[] = [];
    const r = await runLane({
      reviewTimeoutMs: 60_000,
      onPoll: (l) => {
        if (!l.validated || l.leadDecided()) return;
        seen.push(l.awaiting());
        l.decide("rejected");
      },
    });
    expect(seen).toEqual(["team_lead"]);
    expect(r.out.awaiting).not.toBe("team_lead");
    expect(r.final).not.toBe("team_lead");
  });

  it("reviewer_cell: awaited after the team_lead decision while the broker result is outstanding, then the timeout value", async () => {
    const seen = new Set<unknown>();
    const r = await runLane({
      reviewer: true,
      reviewTimeoutMs: 400,
      onPoll: (l) => {
        if (!l.validated) return;
        if (!l.leadDecided()) {
          expect(l.awaiting()).toBe("team_lead");
          l.decide("accepted");
          return;
        }
        seen.add(l.awaiting());
      },
    });
    expect([...seen]).toEqual(["reviewer_cell"]);
    expect(r.out).toMatchObject({ state: "handoff_validated", awaiting: "reviewer_cell" });
    expect(r.final).toBe("reviewer_cell");
  });
});

describe("C6 · CD16 a claimed source run reads top-level mechanics_only", () => {
  const statusOf = (root: string) => readControllerStatus({ cwd: root, runId: RUN, consumerPolicy: "cooperative_local" }) as Record<string, any>;
  const sourceRunAtP6 = () => runLane({
    realPreflight: true,
    reviewTimeoutMs: 60_000,
    onPoll: (l) => { if (l.validated && !l.leadDecided()) l.decide("accepted"); },
  });

  it("P6 refuses, nothing is accepted, and status says mechanics_only with the CD16 reason", async () => {
    const r = await sourceRunAtP6();
    expect(r.out).toMatchObject({ state: "handoff_validated", awaiting: "mechanics_only", qualified_release: false });
    const s = statusOf(r.root);
    expect(s.qualification).toMatchObject({ state: "mechanics_only", reason: "source run: no verified installed package (CD16)" });
    expect(s.counts).toMatchObject({ mechanically_accepted: 0, qualified_released: 0 });
    for (const inst of s.instances) expect(inst).toMatchObject({ mechanical_acceptance: "none", qualified_release: false, awaiting: "mechanics_only" });
    const runFiles = fs.readdirSync(path.join(r.root, ".guild", "runs", RUN), { recursive: true }).map(String);
    expect(runFiles.filter((p) => p.endsWith("/pre.json") || p.endsWith("/final.json"))).toEqual([]);
    const handle = JSON.parse(fs.readFileSync(path.join(r.root, ".guild", "runs", RUN, "task-cells", "T1", "attempts", "1", "instances", r.iid, "assignment.json"), "utf8"));
    expect(fs.existsSync(path.join(r.root, taskCellPaths({ run_id: RUN, logical_task_id: "T1", attempt: handle.attempt, instance_id: r.iid }).acceptance_path))).toBe(false);
  });

  it("control: the same run under a package claim without acceptance stays unavailable", async () => {
    const r = await sourceRunAtP6();
    const claimAbs = path.join(r.root, ".guild", "runs", RUN, "controller", "controller.json");
    const claim = JSON.parse(fs.readFileSync(claimAbs, "utf8"));
    expect(claim.package_root).toBeNull();
    fs.writeFileSync(claimAbs, JSON.stringify({ ...claim, package_root: path.join(r.root, "no-installed-package") }, null, 2) + "\n");
    const s = statusOf(r.root);
    expect(s.qualification).toMatchObject({ state: "unavailable", reason: "no qualified acceptance yet" });
    expect(s.counts).toMatchObject({ mechanically_accepted: 0, qualified_released: 0 });
  });
});
