/**
 * tests/e00/support/controller-lane.ts — one source-run controller lane over the
 * REAL FilesystemTaskCellRuntime (mechanics only, CD16), for TA regressions.
 *
 * The package facade startTaskCellController (packageRoot null) drives a lane in an
 * owned OS-temp root whose team authority comes from the existing contracts
 * (support/team-authority-fixture.ts). The worker port is a test port: it can
 * claim the ack and write the receipt, withhold either, write a receipt the
 * deterministic floor rejects, and refuse termination. Nothing here is review,
 * package or host evidence.
 */
import * as fs from "fs";
import * as path from "path";

import { approveOraclePlan, recordAuthorityDecision, startTaskCellController, taskCellPaths, writeAckClaim } from "../../../src/domains/dispatch";
import { mintRunBinding } from "../../../src/domains/lifecycle";
import { composeStationTeam } from "../../../src/domains/teams";
import { FIXED_NOW, FULL_RUNGS, FakeWorkerPort, ownedTempDir, receiptBytes } from "./e00-harness";
import { writeApprovedTeam } from "./team-authority-fixture";

export const LANE_RUN = "run-e00-lane";
export const LANE_LEAD = "lead-binding-lane";

export interface PortBehavior {
  ack?: boolean;
  /** "floor_fail": in-scope receipt claiming another acceptance test (deterministic floor fails);
   * "foreign": a receipt for another task id (the controller-observed submission refuses it). */
  receipt?: "valid" | "floor_fail" | "foreign" | "none";
  /** terminate() returns ok:false (worker teardown cannot be confirmed). */
  refuseTerminate?: boolean;
}

export class LanePort extends FakeWorkerPort {
  constructor(private readonly root: string, private readonly behavior: PortBehavior) {
    super();
    this.onNotify = ({ assignment_path }) => {
      const abs = path.resolve(this.root, assignment_path);
      const a = JSON.parse(fs.readFileSync(abs, "utf8"));
      if (this.behavior.ack !== false && !writeAckClaim({ assignmentPath: abs, now: () => FIXED_NOW }).ok) throw new Error("fixture: ack claim refused");
      const mode = this.behavior.receipt ?? "valid";
      if (mode === "none") return;
      const receipt = path.join(this.root, ".guild", "runs", a.run_id, "handoffs", `${a.worker_role}-${a.logical_task_id}.md`);
      fs.mkdirSync(path.dirname(receipt), { recursive: true });
      const body = mode === "foreign" ? { ...a, logical_task_id: "T-OTHER", task_run_id: "T-OTHER.tr1" }
        : mode === "floor_fail" ? { ...a, acceptance_tests: ["a different test"] } : a;
      fs.writeFileSync(receipt, receiptBytes(a.run_id, body));
      fs.mkdirSync(path.join(this.root, "src", "out"), { recursive: true });
      fs.writeFileSync(path.join(this.root, "src", "out", `${a.logical_task_id}.txt`), "done\n");
    };
  }
  terminate(input: { instance_id: string }): { ok: boolean; reason: string | null } {
    this.terminated.push(input.instance_id);
    return this.behavior.refuseTerminate ? { ok: false, reason: "fixture: worker teardown refused" } : { ok: true, reason: null };
  }
}

export interface LaneRun {
  root: string;
  controller: any;
  port: LanePort;
  out: Record<string, any>;
  ids: { run_id: string; logical_task_id: string; attempt: number; instance_id: string } | null;
}

export interface LaneOptions {
  port?: PortBehavior;
  /** team_lead decision recorded while the controller polls, once a validation exists. */
  lead?: "accepted" | "rejected";
  /** Wrap the controller's real runtime before the lane runs (method-boundary faults). */
  wrap?: (runtime: any, root: string) => void;
  /** Explicit TA seams on the source-only controller (e.g. preflight stub, private cleanup wrapper). */
  controllerHook?: (controller: any, root: string) => void;
}

export async function runControllerLane(opts: LaneOptions = {}): Promise<LaneRun> {
  const root = ownedTempDir("guild-e00-lane-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: LANE_RUN }).binding_ref;
  const team = writeApprovedTeam(root, LANE_RUN, [{ id: "T1", role: "backend" }], { reviewerId: "lane-review", planRel: ".guild/plan/e00-lane.spec.json" });
  const dir = path.join(root, ".guild", "runs", LANE_RUN, "oracle-plan");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify({
    schema_version: "guild.task_oracle_plan.v1", approved_plan_ref: team.approvedPlanRef, team_decision_ref: team.teamDecisionRef,
    lead_binding_id: LANE_LEAD, acceptance_policy_version: "E00.1",
    lanes: [{ logical_task_id: "T1", authorities_required: ["deterministic_floor", "team_lead"], reviewer_participant_id: null,
      done_when: [{ id: "artifact", oracle: "artifact_exists", target: JSON.stringify({ path: "src/out/T1.txt", sha256: null }) }] }],
  }, null, 2) + "\n");
  if (!approveOraclePlan({ cwd: root, runId: LANE_RUN, phase: "build", decidedBy: "lane-operator", now: () => FIXED_NOW }).ok) throw new Error("fixture: approval refused");

  const port = new LanePort(root, opts.port ?? {});
  let seq = 0;
  let controller: any = null;
  const sleep = async () => {
    if (!opts.lead || !controller) return;
    const inst = controller.instances?.[0]?.handle;
    if (!inst) return;
    const ids = { run_id: LANE_RUN, logical_task_id: "T1", attempt: inst.attempt, instance_id: inst.instance_id };
    if (!fs.existsSync(path.join(root, taskCellPaths(ids).validation_path))) return;
    if (fs.existsSync(path.join(root, ".guild", "runs", LANE_RUN, "controller", "decisions", inst.instance_id, "team_lead.json"))) return;
    recordAuthorityDecision({ cwd: root, runId: LANE_RUN, instanceId: inst.instance_id, leadBindingId: LANE_LEAD, decision: opts.lead,
      reason: opts.lead === "rejected" ? "fixture lead rejection" : null, now: () => FIXED_NOW } as never);
  };
  const started = startTaskCellController({
    cwd: root, runId: LANE_RUN, phase: "build", workerTrustPolicy: "cooperative_local", now: () => FIXED_NOW,
    binding: { binding_ref: bindingRef }, worker: port, rungPlan: FULL_RUNGS, proposal: team.proposal as never,
    sleep, idFactory: (k: string) => `${k}-${++seq}`,
  } as never) as any;
  if (!started.ok) throw new Error(`fixture: start refused ${started.reason}`);
  controller = started.controller;
  try {
    opts.wrap?.(controller.runtime, root);
    opts.controllerHook?.(controller, root);
    controller.writeStationPlan(composeStationTeam("build", {}, { tierIndex: {} }));
    const contextRel = `.guild/context/${LANE_RUN}/backend-T1.md`;
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
      ready_timeout_ms: 0, ack_timeout_ms: 0, receipt_timeout_ms: 0, review_timeout_ms: opts.lead ? 60_000 : 0,
    });
    const handle = controller.instances?.[0]?.handle ?? null;
    const iid = handle?.instance_id ?? out.instance_id;
    const ids = iid ? { run_id: LANE_RUN, logical_task_id: "T1", attempt: 1, instance_id: iid } : null;
    return { root, controller, port, out, ids };
  } finally {
    controller.close();
  }
}

export function attemptOf(run: LaneRun): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(run.root, taskCellPaths(run.ids!).attempt_path), "utf8"));
}
