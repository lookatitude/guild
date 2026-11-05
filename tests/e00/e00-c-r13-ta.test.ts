/**
 * E00-T0 · independent reds for the C13 findings (review/G-lane-E00-C/result-r13.json,
 * implementation/e00/c-r13-scope-and-red-test-release.json), authored BEFORE the C r13 source change.
 *
 * F1 a PRESENT settings.json that cannot be read or is invalid (EISDIR, malformed JSON or root, invalid
 *    secrets_policy shape, non-string members, unknown policy key, invalid fail mode, symlinked file) refuses
 *    with handoff_secret_policy_unavailable before any publication, with no settings bytes in diagnostics.
 *    Controls: an absent optional settings.json keeps built-in defaults; a valid non-matching policy publishes
 *    byte-identically; a valid matching policy keeps the C6 scrub refusal.
 * F2 (R4) a receipt replaced after the controller's scan and before the pointer writer reads it creates NO
 *    new pointer, origin or retained copy.
 * F3 (R5) a receipt parent replaced by an outside symlink with identical bytes after the real pointer write
 *    yields no origin and no retained copy (the pointer may remain bound to the scanned digest).
 *
 * Mechanics only (CD16): the frozen C6 lane driver copied here (support and C6 untouched), the real
 * FilesystemTaskCellRuntime in an owned temp root, a SYNTHETIC in-process worker port (no OS worker process).
 * R4/R5 use one bun:test mock.module("fs") passthrough, armed per case and disarmed in finally, placed last.
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

const RUN = "run-e00-cr13";
const LEAD = "lead-binding-cr13";
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
  const root = ownedTempDir("guild-e00-cr13-");
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

// ── F1 · a present but unavailable or invalid settings policy refuses (handoff_secret_policy_unavailable) ──

const SETTINGS_CANARY = `e00-settings-canary-${crypto.randomBytes(6).toString("hex")}`;
type Arrange = (root: string) => void;
const settingsPath = (root: string) => path.join(root, ".guild", "settings.json");
const writeSettings = (raw: string): Arrange => (root) => fs.writeFileSync(settingsPath(root), raw);
const F1: Array<[string, Arrange]> = [
  ["settings.json is a directory (EISDIR)", (root) => { fs.mkdirSync(settingsPath(root)); fs.writeFileSync(path.join(settingsPath(root), SETTINGS_CANARY), "x\n"); }],
  ["malformed JSON", writeSettings(`{ "${SETTINGS_CANARY}": `)],
  ["non-object JSON root", writeSettings(JSON.stringify([SETTINGS_CANARY]))],
  ["non-object secrets_policy", writeSettings(JSON.stringify({ secrets_policy: SETTINGS_CANARY }))],
  ["redaction_patterns is not an array", writeSettings(JSON.stringify({ secrets_policy: { redaction_patterns: SETTINGS_CANARY } }))],
  ["redaction_patterns has a non-string member", writeSettings(JSON.stringify({ secrets_policy: { redaction_patterns: [SETTINGS_CANARY, 1] } }))],
  ["env_allowlist has a non-string member", writeSettings(JSON.stringify({ secrets_policy: { env_allowlist: [SETTINGS_CANARY, 1] } }))],
  ["unknown secrets_policy key", writeSettings(JSON.stringify({ secrets_policy: { [SETTINGS_CANARY]: true } }))],
  ["invalid fail_mode_durable", writeSettings(JSON.stringify({ secrets_policy: { fail_mode_durable: SETTINGS_CANARY } }))],
  ["settings.json is a symlink to an otherwise valid file", (root) => {
    const outside = ownedTempDir("guild-e00-cr13-settings-");
    const target = path.join(outside, "settings.json");
    fs.writeFileSync(target, JSON.stringify({ secrets_policy: { redaction_patterns: [`never-matches-${SETTINGS_CANARY}`] } }));
    fs.symlinkSync(target, settingsPath(root));
  }],
];

describe("C-r13-F1 · present but unavailable or invalid settings refuse before any publication", () => {
  for (const [label, arrange] of F1) {
    it(`${label}: refused handoff_secret_policy_unavailable; no pointer/origin/retained/validation/acceptance; no settings bytes in diagnostics`, async () => {
      const l = await runLane({ arrange });
      expect(l.port.receiptAbs !== null).toBe(true);
      expect({ reason: l.out.failure_reason ?? null, published: noPublication(l),
        settings_in_io: l.io.includes(SETTINGS_CANARY), settings_in_outcome: JSON.stringify(l.out).includes(SETTINGS_CANARY) })
        .toEqual({ reason: "handoff_secret_policy_unavailable", published: NONE, settings_in_io: false, settings_in_outcome: false });
    }, 120_000);
  }
});

describe("C-r13 · policy controls keep today's semantics", () => {
  it("control: absent optional settings.json uses built-in defaults; a clean receipt publishes byte-identically and is accepted", async () => {
    const l = await runLane({ lead: "accepted", preflightOk: true });
    expect(fs.existsSync(settingsPath(l.root))).toBe(false);
    expect(cleanPublication(l)).toEqual(CLEAN);
  }, 120_000);

  it("control: a valid non-matching policy publishes byte-identically and is accepted", async () => {
    const l = await runLane({ lead: "accepted", preflightOk: true, arrange: writeSettings(JSON.stringify({ secrets_policy: { redaction_patterns: ["never-matches-e00-r13"] } })) });
    expect(cleanPublication(l)).toEqual(CLEAN);
  }, 120_000);

  it("control: a valid matching policy refuses with the scrub reason and publishes nothing", async () => {
    const l = await runLane({ arrange: writeSettings(JSON.stringify({ secrets_policy: { redaction_patterns: ["runtime collection"] } })) });
    expect({ reason: l.out.failure_reason ?? null, published: noPublication(l) }).toEqual({ reason: "handoff_secret_scrub_required", published: NONE });
  }, 120_000);
});

// Last in this file: ONE fs module mock, a pure passthrough unless a case arms it; disarmed in finally.
describe("C-r13 · receipt replacement and parent substitution around publication", () => {
  const realRead = fs.readFileSync;
  const realWrite = fs.writeFileSync;
  const seam = { mode: null as null | "R4" | "R5", receipt: null as string | null, receiptReal: null as string | null, fired: 0, outside: null as string | null, receiptReadsBefore: 0 };
  let installed = false;
  const install = () => {
    if (installed) return;
    installed = true;
    mock.module("fs", () => ({ ...fs,
      readFileSync: (file: any, ...rest: any[]) => {
        const r = (realRead as any)(file, ...rest);
        if (seam.mode === "R4" && seam.fired === 0 && typeof file === "string" && (file === seam.receiptReal || file === seam.receipt)) {
          // Keyed on the call site, not the path form: the first receipt read made inside submitObservedHandoff
          // and outside publishSubmittedHandoffPointer is the controller's scan. Earlier stability-poll reads
          // are counted and pass through. Return the scanned bytes, then replace the receipt with clean, valid,
          // different bytes before any later reader opens it.
          const stack = String(new Error().stack);
          if (!stack.includes("submitObservedHandoff") || stack.includes("publishSubmittedHandoffPointer")) { seam.receiptReadsBefore++; return r; }
          seam.fired++;
          (realWrite as any)(seam.receipt, (realRead as any)(seam.receipt, "utf8").replace("- runtime collection", "- runtime collection replaced-before-pointer"));
        }
        return r;
      },
      writeFileSync: (file: any, data: any, opts?: any) => {
        const r = (realWrite as any)(file, data, opts);
        if (seam.mode === "R5" && seam.fired === 0 && seam.receipt && typeof file === "string" && file.endsWith(`${path.sep}handoff.json`)) {
          // Right after the real exclusive pointer write: the receipt's parent becomes a symlink to an outside
          // owned directory holding byte-identical bytes.
          seam.fired++;
          const handoffs = path.dirname(seam.receipt);
          const bytes = (realRead as any)(seam.receipt);
          (realWrite as any)(path.join(seam.outside!, path.basename(seam.receipt)), bytes);
          fs.renameSync(handoffs, `${handoffs}.moved-aside`);
          fs.symlinkSync(seam.outside!, handoffs);
        }
        return r;
      } }));
  };
  const armOnReceipt = (mode: "R4" | "R5") => (_root: string, port: SyntheticPort) => {
    const notify = port.onNotify;
    port.onNotify = (x: any) => {
      notify?.(x);
      seam.receipt = port.receiptAbs; seam.receiptReal = fs.realpathSync(port.receiptAbs!); seam.mode = mode;
    };
    return () => { port.onNotify = notify; };
  };

  it("R4 receipt replaced between the scan and the pointer writer's read: refused; NO pointer, no origin, no retained copy", async () => {
    install();
    Object.assign(seam, { mode: null, receipt: null, receiptReal: null, fired: 0, outside: null, receiptReadsBefore: 0 });
    let l: Lane;
    try { l = await runLane({ seam: armOnReceipt("R4") }); } finally { seam.mode = null; }
    // Preconditions: earlier (stability-poll) receipt reads passed through untouched, and the seam fired exactly
    // once, on the scan read inside submitObservedHandoff, before the pointer writer read the receipt.
    expect({ poll_reads_passed_through: seam.receiptReadsBefore > 0, fired: seam.fired }).toEqual({ poll_reads_passed_through: true, fired: 1 });
    expect({ refused: (l!.out.failure_reason ?? null) !== null, published: noPublication(l!) }).toEqual({ refused: true, published: NONE });
  }, 120_000);

  it("R5 parent replaced by an outside symlink with identical bytes after the real pointer write: no origin, no retained copy (pointer may remain)", async () => {
    install();
    Object.assign(seam, { mode: null, receipt: null, receiptReal: null, fired: 0, outside: ownedTempDir("guild-e00-cr13-outside-"), receiptReadsBefore: 0 });
    let l: Lane;
    try { l = await runLane({ seam: armOnReceipt("R5") }); } finally { seam.mode = null; }
    expect({ fired: seam.fired, parent_is_symlink: fs.lstatSync(path.dirname(seam.receipt!)).isSymbolicLink(),
      outside_identical: fs.readFileSync(path.join(seam.outside!, path.basename(seam.receipt!))).equals(fs.readFileSync(`${path.dirname(seam.receipt!)}.moved-aside/${path.basename(seam.receipt!)}`)) })
      .toEqual({ fired: 1, parent_is_symlink: true, outside_identical: true });
    expect({ refused: (l!.out.failure_reason ?? null) !== null, origin: exists(l!, path.join(p(l!).instance_dir, "handoff-origin.json")), retained: exists(l!, p(l!).receipt_path) })
      .toEqual({ refused: true, origin: false, retained: false });
  }, 120_000);
});
