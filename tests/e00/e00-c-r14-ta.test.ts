/**
 * E00-T0 · independent reds for the C14 finding (review/G-lane-E00-C/result-r14.json,
 * implementation/e00/c-r14-scope-and-red-test-release.json), authored BEFORE the C r14 source change.
 *
 * F1 a secrets_policy fail mode whose string conversion throws (an object without toString under
 *    fail_mode_durable or fail_mode_telemetry, or an array holding one) refuses with
 *    handoff_secret_policy_unavailable before any publication; neither controller_error nor the engine's
 *    exception message reaches the outcome or captured io. A direct call of the public submitObservedHandoff
 *    with the lane's own assignment, binding and claim returns the same refusal without throwing, and the
 *    same inputs publish once the policy is valid. Controls: valid "open"/"closed" fail modes publish
 *    byte-identically and are accepted.
 *
 * Mechanics only (CD16): the frozen C13 lane driver copied here (support, C6 and C13 untouched), the real
 * FilesystemTaskCellRuntime in an owned temp root, a SYNTHETIC in-process worker port (no OS worker process).
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { approveOraclePlan, recordAuthorityDecision, startTaskCellController, taskCellPaths, writeAckClaim } from "../../src/domains/dispatch";
// Namespace import so a missing public export fails the direct-call case instead of the module load.
import * as dispatchApi from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { composeStationTeam } from "../../src/domains/teams";
import { FIXED_NOW, FULL_RUNGS, FakeWorkerPort, ownedTempDir, receiptBytes, teardownOwned } from "./support/e00-harness";
import { writeApprovedTeam } from "./support/team-authority-fixture";

afterEach(teardownOwned);

const RUN = "run-e00-cr14";
const LEAD = "lead-binding-cr14";
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
async function runLane(o: { port?: PortOpts; lead?: "accepted"; preflightOk?: boolean; settings?: Record<string, unknown>; arrange?: (root: string) => void; seam?: (root: string, port: SyntheticPort) => () => void } = {}): Promise<Lane> {
  const root = ownedTempDir("guild-e00-cr14-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  if (o.settings) fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify(o.settings, null, 2) + "\n");
  o.arrange?.(root);
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

/** Byte-preserving clean publication, as the frozen C6 T5 control asserts it. */
const CLEAN = { pointer_hash: true, retained_identical: true, origin_hash: true, acceptance: true };
function cleanPublication(l: Lane) {
  const lane = fs.readFileSync(l.port.receiptAbs!);
  const ptr = path.join(l.root, p(l).handoff_path); const org = path.join(l.root, p(l).instance_dir, "handoff-origin.json"); const ret = path.join(l.root, p(l).receipt_path);
  return {
    pointer_hash: fs.existsSync(ptr) && JSON.parse(fs.readFileSync(ptr, "utf8")).receipt_id === `handoff-sha256:${sha(lane)}`,
    retained_identical: fs.existsSync(ret) && fs.readFileSync(ret).equals(lane),
    origin_hash: fs.existsSync(org) && JSON.parse(fs.readFileSync(org, "utf8")).receipt_sha256 === sha(lane),
    acceptance: exists(l, p(l).acceptance_path),
  };
}

// ── C14 F1 · a fail-mode value whose string conversion throws still refuses as policy-unavailable ──

/** A JSON object with no callable toString: template interpolation of it throws in the engine. */
const NO_PRIMITIVE = { toString: null };
const settingsPath = (root: string) => path.join(root, ".guild", "settings.json");
const writeSettings = (raw: string) => (root: string) => fs.writeFileSync(settingsPath(root), raw);
/** The engine's own message for converting `raw`'s offending value to a string (never taken from source). */
function engineMessage(value: unknown): string {
  try { void `${value}`; return ""; } catch (error) { return (error as Error).message; }
}
const R14: Array<[string, Record<string, unknown>, unknown]> = [
  ["fail_mode_durable is an object without toString", { fail_mode_durable: NO_PRIMITIVE }, NO_PRIMITIVE],
  ["fail_mode_telemetry is an object without toString", { fail_mode_telemetry: NO_PRIMITIVE }, NO_PRIMITIVE],
  ["fail_mode_durable is an array whose member has no toString", { fail_mode_durable: [NO_PRIMITIVE] }, [NO_PRIMITIVE]],
];

function noErrorContent(l: Lane, message: string) {
  const outcome = JSON.stringify(l.out);
  return {
    engine_message_known: message.length > 0,
    controller_error_in_outcome: outcome.includes("controller_error"), controller_error_in_io: l.io.includes("controller_error"),
    engine_message_in_outcome: message.length > 0 && outcome.includes(message), engine_message_in_io: message.length > 0 && l.io.includes(message),
  };
}
const NO_ERROR_CONTENT = { engine_message_known: true, controller_error_in_outcome: false, controller_error_in_io: false, engine_message_in_outcome: false, engine_message_in_io: false };

describe("C-r14-F1 · a throwing fail-mode value refuses handoff_secret_policy_unavailable without error content", () => {
  for (const [label, policy, offending] of R14) {
    it(`${label}: refused handoff_secret_policy_unavailable; no pointer/origin/retained/validation/acceptance; no controller_error or engine message`, async () => {
      const message = engineMessage(offending);
      const l = await runLane({ arrange: writeSettings(JSON.stringify({ secrets_policy: policy })) });
      expect(l.port.receiptAbs !== null).toBe(true);
      expect({ reason: l.out.failure_reason ?? null, published: noPublication(l), ...noErrorContent(l, message) })
        .toEqual({ reason: "handoff_secret_policy_unavailable", published: NONE, ...NO_ERROR_CONTENT });
    }, 120_000);
  }

  it("direct same-call: public submitObservedHandoff with the lane's own assignment/binding/claim returns the same refusal without throwing; the same inputs publish once the policy is valid", async () => {
    const submit = (dispatchApi as Record<string, unknown>)["submitObservedHandoff"];
    const message = engineMessage(NO_PRIMITIVE);
    const l = await runLane({ arrange: writeSettings(JSON.stringify({ secrets_policy: { fail_mode_durable: NO_PRIMITIVE } })) });
    expect(l.port.receiptAbs !== null).toBe(true);
    // The legitimate inputs the controller itself used: the persisted assignment, its binding envelope and claim.
    const assignment = JSON.parse(fs.readFileSync(path.join(l.root, p(l).assignment_path), "utf8"));
    const input = {
      cwd: l.root, assignment, binding: l.controller.binding, controllerInstanceId: l.controller.claim?.controller_instance_id,
      packageIdentity: l.controller.claim?.package_identity ?? null, now: () => FIXED_NOW,
    };
    const call = () => {
      if (typeof submit !== "function") return { threw: false, missing: true, result: null as any };
      try { return { threw: false, missing: false, result: (submit as (i: typeof input) => any)(input) }; }
      catch (error) { return { threw: true, missing: false, result: null as any, thrown: String((error as Error)?.message ?? "") }; }
    };
    const a = call();
    const afterA = noPublication(l);
    const aText = a.result === null ? "" : JSON.stringify(a.result);
    // Same inputs, valid non-matching policy: proves the inputs carry legitimate authority and only the policy differs.
    fs.writeFileSync(settingsPath(l.root), JSON.stringify({ secrets_policy: { redaction_patterns: ["never-matches-e00-r14"] } }));
    const b = call();
    expect({
      export_present: typeof submit === "function", inputs_present: typeof input.controllerInstanceId === "string" && input.binding !== undefined,
      threw: a.threw, ok: a.result?.ok ?? null, reason: a.result?.reason ?? null, reason_equals_lane: (a.result?.reason ?? null) === (l.out.failure_reason ?? null),
      has_detail: a.result !== null && a.result.detail !== undefined, error_content: aText.includes("controller_error") || (message.length > 0 && aText.includes(message)),
      published_after_refusal: afterA, valid_policy_same_inputs_ok: b.result?.ok ?? null,
    }).toEqual({
      export_present: true, inputs_present: true,
      threw: false, ok: false, reason: "handoff_secret_policy_unavailable", reason_equals_lane: true,
      has_detail: false, error_content: false,
      published_after_refusal: NONE, valid_policy_same_inputs_ok: true,
    });
  }, 120_000);
});

describe("C-r14 · valid fail modes keep today's semantics", () => {
  for (const mode of ["open", "closed"]) {
    it(`control: fail_mode_durable "${mode}" with a clean receipt publishes byte-identically and is accepted`, async () => {
      const l = await runLane({ lead: "accepted", preflightOk: true, arrange: writeSettings(JSON.stringify({ secrets_policy: { fail_mode_durable: mode } })) });
      expect(cleanPublication(l)).toEqual(CLEAN);
    }, 120_000);
  }
});
