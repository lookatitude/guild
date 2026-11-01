/**
 * E00-T0 · independent reds for C-H1-1 (evidence/e00-c/post-h1-owner-review.json,
 * implementation/e00/c-post-h1-scope-decisions.json, c-post-h1-test-release.json), authored BEFORE any
 * C source change against controller 3ccd48b2.
 *
 * T1 a lane receipt holding a redactable canary is refused (handoff_secret_scrub_required) through the
 *    existing submission-refusal route BEFORE any handoff pointer, handoff-origin.json, retained receipt or
 *    validation/acceptance record; the lane receipt keeps its bytes, mtime and inode; the canary appears in
 *    no captured stdout/stderr, outcome, handle or file the run created.
 * T2 a secrets_policy redaction pattern that does not compile (applySecretsPolicy ok=false) fails closed on
 *    a clean receipt the same way.
 * T3 bytes swapped between the pointer hash and the origin read are refused (handoff_receipt_changed): no
 *    handoff-origin.json and no retained receipt that differs from the pointer's hashed bytes.
 * T4 the refusal keeps the existing termination/capacity semantics: confirmed teardown seals failed; a refused
 *    teardown leaves a nonterminal orphaned attempt (counted live by the instance cap) with no seal.
 * T5 control: a clean receipt still publishes, retains byte-identical bytes, binds them in the origin and is
 *    accepted.
 *
 * Mechanics only (CD16): startTaskCellController over the REAL FilesystemTaskCellRuntime in an owned temp
 * root, as tests/e00/support/controller-lane.ts does (copied here; support is frozen). The worker is a
 * SYNTHETIC in-process port (no owned OS process): it claims the ack and writes the receipt. T5 uses the
 * declared source-only TA seam the frozen C tests use (controller.preflight stubbed ok). T3 uses one
 * test-process seam: bun:test mock.module("fs") as a passthrough that reacts only while armed, only to the
 * pointer write; disarmed in finally and run last in this file. No secret value is printed.
 */
import { describe, it, expect, afterEach, mock } from "bun:test";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { approveOraclePlan, recordAuthorityDecision, startTaskCellController, taskCellPaths, writeAckClaim } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { composeStationTeam } from "../../src/domains/teams";
import { FIXED_NOW, FULL_RUNGS, FakeWorkerPort, ownedTempDir, receiptBytes, teardownOwned } from "./support/e00-harness";
import { writeApprovedTeam } from "./support/team-authority-fixture";

afterEach(teardownOwned);

const RUN = "run-e00-cph1";
const LEAD = "lead-binding-cph1";
const TERMINAL = ["timed_out", "rejected", "failed", "terminated", "cancelled"];
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const awsCanary = () => `AKIA${crypto.randomBytes(12).toString("hex").toUpperCase().slice(0, 16)}`;

interface PortOpts { canary?: string; refuseTerminate?: boolean }
class SyntheticPort extends FakeWorkerPort {
  receiptAbs: string | null = null;
  receiptStat: string | null = null;
  constructor(private readonly root: string, private readonly o: PortOpts) {
    super();
    this.onNotify = ({ assignment_path }) => {
      const abs = path.resolve(this.root, assignment_path);
      const a = JSON.parse(fs.readFileSync(abs, "utf8"));
      if (!writeAckClaim({ assignmentPath: abs, now: () => FIXED_NOW }).ok) throw new Error("fixture: ack claim refused");
      const receipt = path.join(this.root, ".guild", "runs", a.run_id, "handoffs", `${a.worker_role}-${a.logical_task_id}.md`);
      fs.mkdirSync(path.dirname(receipt), { recursive: true });
      let body = receiptBytes(a.run_id, a);
      if (this.o.canary) body = body.replace("- runtime collection", `- runtime collection ${this.o.canary}`);
      fs.writeFileSync(receipt, body);
      this.receiptAbs = receipt;
      const s = fs.statSync(receipt); this.receiptStat = `${s.size}/${s.mtimeMs}/${s.ino}`;
      fs.mkdirSync(path.join(this.root, "src", "out"), { recursive: true });
      fs.writeFileSync(path.join(this.root, "src", "out", `${a.logical_task_id}.txt`), "done\n");
    };
  }
  terminate(input: { instance_id: string }): { ok: boolean; reason: string | null } {
    this.terminated.push(input.instance_id);
    return this.o.refuseTerminate ? { ok: false, reason: "fixture: worker teardown refused" } : { ok: true, reason: null };
  }
}

interface Lane { root: string; controller: any; port: SyntheticPort; out: Record<string, any>; ids: { run_id: string; logical_task_id: string; attempt: number; instance_id: string } | null; io: string }
async function runLane(o: { port?: PortOpts; lead?: "accepted"; preflightOk?: boolean; settings?: Record<string, unknown>; seam?: (root: string, port: SyntheticPort) => () => void } = {}): Promise<Lane> {
  const root = ownedTempDir("guild-e00-cph1-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  if (o.settings) fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify(o.settings, null, 2) + "\n");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: RUN }).binding_ref;
  const team = writeApprovedTeam(root, RUN, [{ id: "T1", role: "backend" }], { reviewerId: "cph1-review", planRel: ".guild/plan/e00-cph1.spec.json" });
  const dir = path.join(root, ".guild", "runs", RUN, "oracle-plan");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "build.json"), JSON.stringify({
    schema_version: "guild.task_oracle_plan.v1", approved_plan_ref: team.approvedPlanRef, team_decision_ref: team.teamDecisionRef,
    lead_binding_id: LEAD, acceptance_policy_version: "E00.1",
    lanes: [{ logical_task_id: "T1", authorities_required: ["deterministic_floor", "team_lead"], reviewer_participant_id: null,
      done_when: [{ id: "artifact", oracle: "artifact_exists", target: JSON.stringify({ path: "src/out/T1.txt", sha256: null }) }] }],
  }, null, 2) + "\n");
  if (!approveOraclePlan({ cwd: root, runId: RUN, phase: "build", decidedBy: "cph1-operator", now: () => FIXED_NOW }).ok) throw new Error("fixture: approval refused");
  const port = new SyntheticPort(root, o.port ?? {});
  let seq = 0;
  let controller: any = null;
  const sleep = async () => {
    if (!o.lead || !controller) return;
    const inst = controller.instances?.[0]?.handle;
    if (!inst) return;
    const ids = { run_id: RUN, logical_task_id: "T1", attempt: inst.attempt, instance_id: inst.instance_id };
    if (!fs.existsSync(path.join(root, taskCellPaths(ids).validation_path))) return;
    if (fs.existsSync(path.join(root, ".guild", "runs", RUN, "controller", "decisions", inst.instance_id, "team_lead.json"))) return;
    recordAuthorityDecision({ cwd: root, runId: RUN, instanceId: inst.instance_id, leadBindingId: LEAD, decision: o.lead, reason: null, now: () => FIXED_NOW } as never);
  };
  const started = startTaskCellController({
    cwd: root, runId: RUN, phase: "build", workerTrustPolicy: "cooperative_local", now: () => FIXED_NOW,
    binding: { binding_ref: bindingRef }, worker: port, rungPlan: FULL_RUNGS, proposal: team.proposal as never,
    sleep, idFactory: (k: string) => `${k}-${++seq}`,
  } as never) as any;
  if (!started.ok) throw new Error(`fixture: start refused ${started.reason}`);
  controller = started.controller;
  if (o.preflightOk) controller.preflight = () => ({ ok: true });
  let io = "";
  const ow = process.stdout.write.bind(process.stdout); const ew = process.stderr.write.bind(process.stderr);
  const restoreSeam = o.seam?.(root, port);
  (process.stdout as any).write = (c: any, ...a: any[]) => { io += String(c); return ow(c, ...a); };
  (process.stderr as any).write = (c: any, ...a: any[]) => { io += String(c); return ew(c, ...a); };
  try {
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
      ready_timeout_ms: 0, ack_timeout_ms: 0, receipt_timeout_ms: 0, review_timeout_ms: o.lead ? 60_000 : 0,
    });
    const handle = controller.instances?.[0]?.handle ?? null;
    const iid = handle?.instance_id ?? out.instance_id;
    return { root, controller, port, out, ids: iid ? { run_id: RUN, logical_task_id: "T1", attempt: 1, instance_id: iid } : null, io };
  } finally {
    (process.stdout as any).write = ow; (process.stderr as any).write = ew;
    restoreSeam?.();
    controller.close();
  }
}
const p = (l: Lane) => taskCellPaths(l.ids!);
const exists = (l: Lane, rel: string) => fs.existsSync(path.join(l.root, rel));
const attemptOf = (l: Lane) => JSON.parse(fs.readFileSync(path.join(l.root, p(l).attempt_path), "utf8"));
/** Every regular file under `dir` except `skip` (booleans only; bytes never printed). */
function anyFileContains(dir: string, needle: string, skip: string | null): boolean {
  for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
    const f = path.join(dir, String(rel));
    if (f === skip) continue;
    try { if (fs.lstatSync(f).isFile() && fs.readFileSync(f).includes(needle)) return true; } catch { /* not a hit */ }
  }
  return false;
}
const noPublication = (l: Lane) => ({
  pointer: exists(l, p(l).handoff_path), origin: exists(l, path.join(p(l).instance_dir, "handoff-origin.json")), retained: exists(l, p(l).receipt_path),
  validation: exists(l, p(l).validation_path), acceptance: exists(l, p(l).acceptance_path),
});
const NONE = { pointer: false, origin: false, retained: false, validation: false, acceptance: false };

describe("C-H1-1 · a secret-bearing controller-observed receipt is refused before any publication", () => {
  it("T1 canary receipt: refused handoff_secret_scrub_required; no pointer/origin/retained/validation/acceptance; receipt untouched; canary nowhere else", async () => {
    const canary = awsCanary();
    const l = await runLane({ port: { canary } });
    // Precondition: the synthetic worker delivered the canary receipt.
    expect(l.port.receiptAbs !== null && fs.readFileSync(l.port.receiptAbs!).includes(canary)).toBe(true);
    const s = fs.statSync(l.port.receiptAbs!);
    expect({
      reason: l.out.failure_reason ?? null, published: noPublication(l),
      receipt_unchanged: `${s.size}/${s.mtimeMs}/${s.ino}` === l.port.receiptStat,
      canary_in_io: l.io.includes(canary), canary_in_outcome: JSON.stringify(l.out).includes(canary),
      canary_in_handle: JSON.stringify(l.controller.instances?.[0]?.handle ?? null).includes(canary),
      canary_in_other_files: anyFileContains(l.root, canary, l.port.receiptAbs),
    }).toEqual({ reason: "handoff_secret_scrub_required", published: NONE, receipt_unchanged: true,
      canary_in_io: false, canary_in_outcome: false, canary_in_handle: false, canary_in_other_files: false });
  }, 120_000);

  it("T2 clean receipt with a non-compiling secrets_policy redaction pattern: fails closed the same way", async () => {
    const l = await runLane({ settings: { secrets_policy: { redaction_patterns: ["("] } } });
    expect(l.port.receiptAbs !== null).toBe(true);
    expect({ reason: l.out.failure_reason ?? null, published: noPublication(l) }).toEqual({ reason: "handoff_secret_scrub_required", published: NONE });
  }, 120_000);
});

describe("C-H1-1 · the refusal keeps the existing termination and capacity semantics", () => {
  it("T4a confirmed teardown: the lane reports failed with the scrub reason and the attempt is sealed failed", async () => {
    const l = await runLane({ port: { canary: awsCanary() } });
    expect({ reason: l.out.failure_reason ?? null, terminate_called: l.port.terminated.length > 0, lane_state: l.out.state,
      terminal: attemptOf(l).terminal_state ?? null, sealed: exists(l, p(l).terminal_path) })
      .toEqual({ reason: "handoff_secret_scrub_required", terminate_called: true, lane_state: "failed", terminal: "failed", sealed: true });
  }, 120_000);

  it("T4b refused teardown: nonterminal orphaned attempt (still a live cap slot), no seal, no terminal lane state", async () => {
    const l = await runLane({ port: { canary: awsCanary(), refuseTerminate: true } });
    const a = attemptOf(l);
    expect({ reason: l.out.failure_reason ?? null, terminate_called: l.port.terminated.length > 0, attempt_terminal: a.terminal_state ?? null, orphaned: a.orphaned === true,
      sealed: exists(l, p(l).terminal_path), lane_terminal: TERMINAL.includes(l.out.state), awaiting: l.out.awaiting ?? null })
      .toEqual({ reason: "handoff_secret_scrub_required", terminate_called: true, attempt_terminal: null, orphaned: true, sealed: false, lane_terminal: false, awaiting: "teardown" });
  }, 120_000);
});

describe("C-H1-1 · clean control", () => {
  it("T5 clean receipt: pointer, byte-identical retained receipt, origin bound to those bytes, accepted", async () => {
    const l = await runLane({ lead: "accepted", preflightOk: true });
    const lane = fs.readFileSync(l.port.receiptAbs!);
    const pointer = JSON.parse(fs.readFileSync(path.join(l.root, p(l).handoff_path), "utf8"));
    const origin = JSON.parse(fs.readFileSync(path.join(l.root, p(l).instance_dir, "handoff-origin.json"), "utf8"));
    expect({
      pointer_hash: pointer.receipt_id === `handoff-sha256:${sha(lane)}`,
      retained_identical: fs.readFileSync(path.join(l.root, p(l).receipt_path)).equals(lane),
      origin_hash: origin.receipt_sha256 === sha(lane),
      acceptance: exists(l, p(l).acceptance_path),
    }).toEqual({ pointer_hash: true, retained_identical: true, origin_hash: true, acceptance: true });
  }, 120_000);
});

// Last in this file: the fs module mock below stays installed as a pure passthrough once disarmed.
describe("C-H1-1 · bytes raced between the pointer hash and the origin read", () => {
  it("T3 bytes swapped right after the pointer write: refused handoff_receipt_changed; no origin; nothing retained beyond the hashed bytes", async () => {
    const realWrite = fs.writeFileSync;
    const state = { armed: false, fired: 0, receipt: null as string | null };
    mock.module("fs", () => ({ ...fs, writeFileSync: (file: any, data: any, opts?: any) => {
      const r = (realWrite as any)(file, data, opts);
      if (state.armed && state.receipt && typeof file === "string" && file.endsWith(`${path.sep}handoff.json`)) {
        state.fired++;
        (realWrite as any)(state.receipt, (fs.readFileSync(state.receipt, "utf8") as string).replace("- runtime collection", "- runtime collection swapped-after-hash"));
      }
      return r;
    } }));
    let l: Lane;
    try {
      l = await runLane({ seam: (_root, port) => {
        // Arm synchronously once the synthetic worker has written the real receipt.
        const notify = port.onNotify;
        port.onNotify = (x: any) => { notify?.(x); state.receipt = port.receiptAbs; state.armed = true; };
        return () => { port.onNotify = notify; };
      } });
    } finally {
      state.armed = false;
    }
    // Precondition: the seam fired once, at the real pointer write.
    expect(state.fired).toBe(1);
    const pointer = exists(l!, p(l!).handoff_path) ? JSON.parse(fs.readFileSync(path.join(l!.root, p(l!).handoff_path), "utf8")) : null;
    const retainedPath = path.join(l!.root, p(l!).receipt_path);
    const retainedMatchesPointer = !fs.existsSync(retainedPath) || (pointer !== null && `handoff-sha256:${sha(fs.readFileSync(retainedPath))}` === pointer.receipt_id);
    expect({ reason: l!.out.failure_reason ?? null, origin: exists(l!, path.join(p(l!).instance_dir, "handoff-origin.json")), retained: fs.existsSync(retainedPath), retained_matches_pointer: retainedMatchesPointer })
      .toEqual({ reason: "handoff_receipt_changed", origin: false, retained: false, retained_matches_pointer: true });
  }, 120_000);
});
