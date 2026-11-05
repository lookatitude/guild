/**
 * R03 · worker ingress and safe remote execution (AT12, AT13).
 *
 * Threat model: the worker is hostile. Its records, paths, sizes, replays and
 * effect claims are attacker input; the controller and in-process callers are
 * trusted.
 *
 * AT12 remote isolation: a worker in an isolated workspace with scoped ingress
 * has no durable-root write capability and no release credential; foreign
 * source, oversized payload and expired/revoked grants reject. Negative
 * control: a private grant secret planted in a UI/share-set fixture fails the
 * leak check. The "qualified second host" here is simulated locally; real
 * second-host qualification is V01 (CW-36).
 *
 * AT13 attempt ownership: worker lost after an external side effect, retry
 * requested. A second live attempt is blocked until the old attempt is fenced
 * and its effects reconciled; an uncertain effect is surfaced, never replayed.
 * Negative control: a crash after the effect and before its receipt cannot
 * cause a second effect.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ControllerRefusal, type WriterGrant } from "./run-controller";
import {
  ADAPTER_CAPABILITY_SCHEMA,
  IngressRefusal,
  checkShareableLeaks,
  openWorkerIngress,
  shareableBundleRef,
  submitWorkerRecord,
  verifyEffectPermit,
  type AdapterCapabilityProof,
  type EffectPermit,
  type WorkerBundle,
  type WorkerIngress,
} from "./worker-ingress";

let tmp: string;
let durableRoot: string;
let privateDir: string;
let workspaceRoot: string;
let clock: number;
const now = () => clock;
const RUN = "run-r03";
const HOST = "host-1";
const FAR = 10_000_000;

const ENV = { PATH: "/usr/bin", LANG: "C", GH_TOKEN: "ghp_secretsecretsecretsecret", NPM_TOKEN: "npm_secretsecret", HOME: "/home/x" };

function open(extra: Partial<Parameters<typeof openWorkerIngress>[0]> = {}): WorkerIngress {
  return openWorkerIngress({
    privateDir, durableRoot, workspaceRoot, source_id: "source-a", run_id: RUN, host_id: HOST,
    now, leaseMs: 1_000_000, pid: 4242, pidAlive: () => false, env: ENV, ...extra,
  });
}

function cap(over: Partial<AdapterCapabilityProof> = {}): AdapterCapabilityProof {
  return {
    schema_version: ADAPTER_CAPABILITY_SCHEMA, adapter_id: "local-node", transport: "local_process", host_id: HOST,
    workspace: "isolated", durable_root_access: "none", credential_forwarding: "none", env_allowlist: ["PATH", "LANG"], ...over,
  };
}

function code(fn: () => unknown): string {
  try { fn(); } catch (e) { if (e instanceof IngressRefusal || e instanceof ControllerRefusal) return e.code; throw e; }
  return "no-refusal";
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

let ing: WorkerIngress;
let w: WriterGrant;
const dispatch = (task_id: string, attempt_id: string, over: { effects?: boolean; expires_at_ms?: number; capability?: AdapterCapabilityProof; execution_id?: string } = {}): WorkerBundle =>
  ing.dispatchAttempt(w, { task_id, attempt_id, execution_id: over.execution_id ?? `exec-${task_id}`, effects: over.effects ?? true, expires_at_ms: over.expires_at_ms ?? FAR, capability: over.capability ?? cap() });

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "r03-")));
  durableRoot = path.join(tmp, "project");
  privateDir = path.join(tmp, "state", "controller");
  workspaceRoot = path.join(tmp, "workers");
  fs.mkdirSync(path.join(durableRoot, ".guild"), { recursive: true });
  clock = 1_000;
  ing = open();
  w = ing.controller.issueWriterGrant("lifecycle");
});
afterEach(() => {
  ing.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("AT12 · remote isolation", () => {
  it("hands the worker an isolated workspace with no durable-root path, writer grant, key or credentials", () => {
    const b = dispatch("task-1", "att-1");
    expect(b.workspace.startsWith(workspaceRoot + path.sep)).toBe(true);
    const text = JSON.stringify(b);
    expect(text.includes(durableRoot)).toBe(false);
    expect(text.includes(privateDir)).toBe(false);
    expect(text.includes(w.nonce)).toBe(false);
    expect(text.includes(fs.readFileSync(path.join(privateDir, "controller.key")).toString("hex"))).toBe(false);
    expect(text.includes('"writer"')).toBe(false);
    expect(b.env).toEqual({ PATH: "/usr/bin", LANG: "C" });
    expect(text.includes("ghp_")).toBe(false);
    // The worker submits into its own workspace; nothing it writes lands in the durable root.
    const before = walk(path.join(durableRoot, ".guild"));
    submitWorkerRecord(b, { record_id: "obs-1", kind: "observation", body: { ok: 1 } });
    expect(walk(path.join(durableRoot, ".guild"))).toEqual(before);
    const r = ing.collect();
    expect(r.accepted.map((a) => a.record_id)).toEqual(["obs-1"]);
    // The durable copy is controller-written and carries no MAC or secret.
    const copy = path.join(durableRoot, ".guild", "runs", RUN, "attempts", "att-1", "records", "obs-1.json");
    expect(fs.existsSync(copy)).toBe(true);
    expect(fs.readFileSync(copy, "utf8").includes(b.grant.secret)).toBe(false);
    expect(ing.verifyRecordCopy("att-1", "obs-1")).toEqual({ ok: true });
    fs.writeFileSync(copy, fs.readFileSync(copy, "utf8").replace('"ok":1', '"ok":2'));
    expect(ing.verifyRecordCopy("att-1", "obs-1")).toEqual({ ok: false, code: "record_copy_mismatch" });
  });

  it("refuses adapters that expose the durable root, forward credentials, or are unqualified remotes", () => {
    expect(code(() => dispatch("t", "a1", { capability: cap({ durable_root_access: "read_write" }) }))).toBe("durable_root_exposed");
    expect(code(() => dispatch("t", "a2", { capability: cap({ durable_root_access: "read_only" }) }))).toBe("durable_root_exposed");
    expect(code(() => dispatch("t", "a3", { capability: cap({ credential_forwarding: "env" }) }))).toBe("credential_forwarding_refused");
    expect(code(() => dispatch("t", "a4", { capability: cap({ env_allowlist: ["PATH", "GH_TOKEN"] }) }))).toBe("credential_forwarding_refused");
    expect(code(() => dispatch("t", "a5", { capability: cap({ env_allowlist: ["GUILD_CONTROLLER_KEY"] }) }))).toBe("credential_forwarding_refused");
    expect(code(() => dispatch("t", "a6", { capability: cap({ transport: "remote_host", host_id: "host-2" }) }))).toBe("remote_unqualified");
    expect(code(() => dispatch("t", "a7", { capability: cap({ host_id: "host-2" }) }))).toBe("capability_refused");
    expect(code(() => dispatch("t", "a8", { capability: { ...cap(), extra: true } as unknown as AdapterCapabilityProof }))).toBe("capability_refused");
    // Nothing was bound by a refused dispatch: the task is still free.
    expect(ing.taskState("t").live_attempt).toBeNull();
  });

  it("dispatches to a qualified (locally simulated) second host with the same scoped ingress", () => {
    ing.close();
    ing = open({ qualifiedRemoteHosts: ["host-2"] });
    w = ing.controller.issueWriterGrant("lifecycle");
    const b = dispatch("task-r", "att-r", { capability: cap({ transport: "remote_host", host_id: "host-2" }) });
    submitWorkerRecord(b, { record_id: "o1", kind: "observation", body: {} });
    expect(ing.collect().accepted).toHaveLength(1);
    expect(code(() => dispatch("task-r2", "att-r2", { capability: cap({ transport: "remote_host", host_id: "host-2", durable_root_access: "read_write" }) }))).toBe("durable_root_exposed");
  });

  it("refuses a workspace root that overlaps the durable root or the controller state", () => {
    for (const bad of [path.join(durableRoot, "workers"), tmp, path.join(privateDir, "w"), path.join(tmp, "state")]) {
      ing.close();
      ing = open({ workspaceRoot: bad });
      w = ing.controller.issueWriterGrant("lifecycle");
      expect(code(() => dispatch("t", `a-${path.basename(bad)}`))).toBe("workspace_not_isolated");
    }
    // A symlinked workspace root that resolves into the project is refused too.
    fs.symlinkSync(path.join(durableRoot, ".guild"), path.join(tmp, "sneaky"));
    ing.close();
    ing = open({ workspaceRoot: path.join(tmp, "sneaky") });
    w = ing.controller.issueWriterGrant("lifecycle");
    expect(code(() => dispatch("t", "a-sym"))).toBe("workspace_not_isolated");
  });

  it("rejects foreign-source, oversized, forged, mismatched, expired and revoked submissions", () => {
    const b = dispatch("task-1", "att-1", { expires_at_ms: 5_000 });
    const other = dispatch("task-2", "att-2");
    submitWorkerRecord(b, { record_id: "ok-1", kind: "observation", body: { n: 1 } });
    submitWorkerRecord({ ...b, source_id: "source-evil" }, { record_id: "foreign-1", kind: "observation", body: {} });
    submitWorkerRecord({ ...b, run_id: "run-evil" }, { record_id: "foreign-2", kind: "observation", body: {} });
    // Oversized: written raw so the worker helper's own bound does not stop it.
    fs.writeFileSync(path.join(b.ingress_dir, "big-1.json"), "x".repeat(b.limits.max_record_bytes + 1));
    // Forged: a record whose MAC does not verify.
    submitWorkerRecord({ ...b, grant: { ...b.grant, secret: "0".repeat(64) } }, { record_id: "forged-1", kind: "observation", body: {} });
    // Another attempt's valid record planted in this attempt's ingress.
    submitWorkerRecord({ ...other, ingress_dir: b.ingress_dir }, { record_id: "planted-1", kind: "observation", body: {} });
    // A symlink to the controller key and a FIFO: rejected without following or blocking.
    fs.symlinkSync(path.join(privateDir, "controller.key"), path.join(b.ingress_dir, "link-1.json"));
    if (process.platform !== "win32") require("node:child_process").execFileSync("mkfifo", [path.join(b.ingress_dir, "fifo-1.json")]);
    fs.writeFileSync(path.join(b.ingress_dir, "evil name.json"), "{}");
    const r = ing.collect();
    const by = Object.fromEntries(r.rejected.map((x) => [x.record_id, x.code]));
    expect(r.accepted.map((a) => a.record_id)).toEqual(["ok-1"]);
    expect(by).toMatchObject({
      "foreign-1": "foreign_source", "foreign-2": "foreign_source", "big-1": "payload_oversized",
      "forged-1": "record_forged", "planted-1": "grant_mismatch", "link-1": "record_invalid", "fifo-1": "record_invalid",
    });
    // Expired grant.
    clock = 6_000;
    submitWorkerRecord(b, { record_id: "late-1", kind: "observation", body: {} });
    expect(ing.collect().rejected).toContainEqual({ attempt_id: "att-1", record_id: "late-1", code: "grant_expired" });
    // Revoked execution.
    submitWorkerRecord(other, { record_id: "o-1", kind: "observation", body: {} });
    ing.controller.setAdmission(w, other.execution_id, "revoked");
    expect(ing.collect().rejected).toContainEqual({ attempt_id: "att-2", record_id: "o-1", code: "admission_revoked" });
    // A replayed, already-ingested record is idempotent and a rewrite cannot change it.
    expect(ing.collect().replayed).toContain("att-1/ok-1");
  });

  it("enforces scope and per-attempt bounds", () => {
    const b = dispatch("task-1", "att-1", { effects: false });
    submitWorkerRecord(b, { record_id: "i-1", kind: "effect_intent", effect_key: "push-1", body: {} });
    expect(ing.collect().rejected).toContainEqual({ attempt_id: "att-1", record_id: "i-1", code: "scope_denied" });
    ing.close();
    ing = open({ limits: { max_records_per_collect: 2, max_records_per_attempt: 3 } });
    w = ing.controller.issueWriterGrant("lifecycle");
    const c = dispatch("task-q", "att-q");
    for (let i = 0; i < 5; i++) submitWorkerRecord(c, { record_id: `r-${i}`, kind: "observation", body: { i } });
    const r1 = ing.collect();
    expect(r1.accepted).toHaveLength(2);
    expect(r1.truncated).toBe(true);
    const r2 = ing.collect();
    expect(r2.accepted).toHaveLength(1);
    expect(r2.rejected.filter((x) => x.code === "quota_exceeded").length).toBeGreaterThan(0);
  });

  it("never treats the worker's attempt grant as a writer or release credential", () => {
    const b = dispatch("task-1", "att-1");
    const asWriter = b.grant as unknown as WriterGrant;
    expect(code(() => ing.fenceAttempt(asWriter, "att-1"))).toBe("worker_grant_not_writer");
    expect(code(() => ing.releaseAttempt(asWriter, "att-1"))).toBe("worker_grant_not_writer");
    expect(code(() => ing.controller.control(asWriter, { operation_id: "op-rel", action: "release", subject: "task-1" }))).toBe("worker_grant_not_writer");
    // The controller's own attempt issuance cannot bypass ingress binding.
    expect(code(() => ing.controller.issueAttemptGrant({ execution_id: "exec-x", attempt_id: "att-rogue", scope: "ingress.observe", expires_at_ms: FAR }))).toBe("attempt_unbound");
  });

  it("negative control: a grant secret leaked into a UI/share-set fixture fails the leak check", () => {
    const b = dispatch("task-1", "att-1");
    submitWorkerRecord(b, { record_id: "obs-1", kind: "observation", body: { ok: 1 } });
    ing.collect();
    ing.controller.control(w, { operation_id: "op-1", action: "accept", subject: "task-1" });
    const shared = path.join(durableRoot, ".guild", "runs", RUN, "ui");
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, "projection.json"), JSON.stringify({ bundle: shareableBundleRef(b) }));
    expect(checkShareableLeaks({ durableRoot, run_id: RUN, grants: [w, b.grant] }).findings).toEqual([]);
    fs.writeFileSync(path.join(shared, "leak.json"), JSON.stringify({ grant: b.grant }));
    fs.writeFileSync(path.join(shared, "share-set.txt"), `nonce=${w.nonce}`);
    const res = checkShareableLeaks({ durableRoot, run_id: RUN, grants: [w, b.grant] });
    expect(res.ok).toBe(false);
    expect(res.findings.map((f) => path.basename(f.file)).sort()).toEqual(["leak.json", "share-set.txt"]);
    expect(code(() => checkShareableLeaks({ durableRoot, run_id: RUN, grants: [], secrets: ["short"] }))).toBe("request_invalid");
  });
});

describe("AT13 · attempt ownership", () => {
  /** Cooperative worker: intent, wait for permit, effect, result. */
  function effectStep(b: WorkerBundle, key: string, permits: EffectPermit[], effect: () => void): boolean {
    const p = permits.find((x) => x.attempt_id === b.attempt_id && x.effect_key === key);
    if (!p || !verifyEffectPermit(b, p)) return false;
    effect();
    return true;
  }

  it("blocks a second live attempt until fencing and effect reconciliation; never replays an uncertain effect", () => {
    let effects = 0;
    const a1 = dispatch("task-1", "att-1");
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    submitWorkerRecord(a1, { record_id: "i-1", kind: "effect_intent", effect_key: "push-main", body: {} });
    const r = ing.collect();
    expect(effectStep(a1, "push-main", r.permits, () => effects++)).toBe(true);
    // Crash after the effect, before the result receipt. Retry requested:
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    expect(code(() => ing.releaseAttempt(w, "att-1"))).toBe("attempt_not_fenced");
    expect(code(() => ing.reconcileEffect(w, { task_id: "task-1", effect_key: "push-main", verdict: "applied", evidence_ref: "ev-1" }))).toBe("reconcile_refused");
    ing.fenceAttempt(w, "att-1");
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    const st = ing.taskState("task-1");
    expect(st.uncertain_effects).toEqual(["push-main"]);
    expect(st.effects).toContainEqual({ effect_key: "push-main", state: "uncertain", attempt_id: "att-1" });
    let err: unknown;
    try { ing.releaseAttempt(w, "att-1"); } catch (e) { err = e; }
    expect((err as IngressRefusal).code).toBe("effects_unreconciled");
    expect((err as IngressRefusal).uncertain).toEqual(["push-main"]);
    // A lost-but-alive worker writing after the fence is ignored, gets no permit.
    submitWorkerRecord(a1, { record_id: "r-1", kind: "effect_result", effect_key: "push-main", outcome: "applied", body: {} });
    submitWorkerRecord(a1, { record_id: "i-2", kind: "effect_intent", effect_key: "push-other", body: {} });
    const late = ing.collect();
    expect(late.accepted).toEqual([]);
    expect(late.permits).toEqual([]);
    // Operator reconciles with evidence, then the attempt releases and a retry may start.
    ing.reconcileEffect(w, { task_id: "task-1", effect_key: "push-main", verdict: "applied", evidence_ref: "ev-1" });
    ing.releaseAttempt(w, "att-1");
    expect(ing.taskState("task-1").receipt_loss_reconciled).toBe(true);
    const a2 = dispatch("task-1", "att-2");
    submitWorkerRecord(a2, { record_id: "i-1", kind: "effect_intent", effect_key: "push-main", body: {} });
    const r2 = ing.collect();
    expect(r2.rejected).toContainEqual({ attempt_id: "att-2", record_id: "i-1", code: "effect_replay_refused" });
    expect(effectStep(a2, "push-main", r2.permits, () => effects++)).toBe(false);
    // A permit from the first attempt does not authorize the second.
    expect(effectStep(a2, "push-main", r.permits.map((p) => ({ ...p, attempt_id: "att-2" })), () => effects++)).toBe(false);
    expect(effects).toBe(1);
  });

  it("negative control: crash after effect before receipt never yields a second effect, even across a controller restart", () => {
    let effects = 0;
    const a1 = dispatch("task-1", "att-1");
    submitWorkerRecord(a1, { record_id: "i-1", kind: "effect_intent", effect_key: "deploy", body: {} });
    expect(effectStep(a1, "deploy", ing.collect().permits, () => effects++)).toBe(true);
    // Controller restarts (new epoch); the old ingress is fenced.
    const old = ing;
    ing = open();
    expect(code(() => old.collect())).toBe("controller_fenced");
    w = ing.controller.issueWriterGrant("lifecycle");
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    ing.fenceAttempt(w, "att-1");
    expect(ing.taskState("task-1").uncertain_effects).toEqual(["deploy"]);
    expect(code(() => ing.releaseAttempt(w, "att-1"))).toBe("effects_unreconciled");
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    // Re-submitting the old intent (replay) cannot re-mint a permit.
    expect(ing.collect().permits).toEqual([]);
    expect(effects).toBe(1);
  });

  it("a worker-reported failure is untrusted: it stays uncertain until a trusted not_applied verdict frees one replay", () => {
    let effects = 0;
    const a1 = dispatch("task-1", "att-1");
    submitWorkerRecord(a1, { record_id: "i-1", kind: "effect_intent", effect_key: "tag", body: {} });
    ing.collect();
    submitWorkerRecord(a1, { record_id: "r-1", kind: "effect_result", effect_key: "tag", outcome: "failed", body: {} });
    ing.collect();
    ing.fenceAttempt(w, "att-1");
    expect(ing.taskState("task-1").uncertain_effects).toEqual(["tag"]);
    expect(code(() => ing.releaseAttempt(w, "att-1"))).toBe("effects_unreconciled");
    ing.reconcileEffect(w, { task_id: "task-1", effect_key: "tag", verdict: "not_applied", evidence_ref: "ev-2" });
    expect(code(() => ing.reconcileEffect(w, { task_id: "task-1", effect_key: "tag", verdict: "applied", evidence_ref: "ev-3" }))).toBe("reconcile_refused");
    ing.releaseAttempt(w, "att-1");
    const a2 = dispatch("task-1", "att-2");
    submitWorkerRecord(a2, { record_id: "i-1", kind: "effect_intent", effect_key: "tag", body: {} });
    expect(effectStep(a2, "tag", ing.collect().permits, () => effects++)).toBe(true);
    submitWorkerRecord(a2, { record_id: "r-1", kind: "effect_result", effect_key: "tag", outcome: "applied", body: {} });
    ing.collect();
    ing.fenceAttempt(w, "att-2");
    ing.releaseAttempt(w, "att-2");
    expect(ing.taskState("task-1")).toMatchObject({ live_attempt: null, uncertain_effects: [] });
    // Applied is terminal for the task: a third attempt cannot get the permit.
    const a3 = dispatch("task-1", "att-3");
    submitWorkerRecord(a3, { record_id: "i-1", kind: "effect_intent", effect_key: "tag", body: {} });
    expect(ing.collect().permits).toEqual([]);
    expect(effects).toBe(1);
  });

  it("a worker cannot forge a result or intent for an effect another attempt owns, and re-dispatch is idempotent", () => {
    const a1 = dispatch("task-1", "att-1");
    const again = dispatch("task-1", "att-1");
    expect(again.grant.grant_id).toBe(a1.grant.grant_id);
    expect(code(() => ing.dispatchAttempt(w, { task_id: "task-1", attempt_id: "att-1", execution_id: "exec-task-1", effects: false, expires_at_ms: FAR, capability: cap() }))).toBe("attempt_exists");
    submitWorkerRecord(a1, { record_id: "r-0", kind: "effect_result", effect_key: "never-intended", outcome: "applied", body: {} });
    expect(ing.collect().rejected).toContainEqual({ attempt_id: "att-1", record_id: "r-0", code: "effect_result_unmatched" });
    submitWorkerRecord(a1, { record_id: "i-1", kind: "effect_intent", effect_key: "k", body: {} });
    submitWorkerRecord(a1, { record_id: "i-1b", kind: "effect_intent", effect_key: "k", body: {} });
    const r = ing.collect();
    // A second intent for the same key from the owner re-delivers the same permit.
    expect(r.permits).toHaveLength(2);
    expect(r.permits[0]!.mac).toBe(r.permits[1]!.mac);
    expect(verifyEffectPermit(a1, { ...r.permits[0]!, mac: "0".repeat(64) })).toBe(false);
  });
});
