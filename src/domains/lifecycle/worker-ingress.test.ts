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
  const CRASH = new Error("worker process lost");
  /** Trusted executor step: true when the effect ran to a journaled completion. */
  function effectStep(b: WorkerBundle, key: string, permits: EffectPermit[], effect: () => void): boolean {
    const p = permits.find((x) => x.attempt_id === b.attempt_id && x.effect_key === key);
    if (!p) return false;
    try { ing.runEffect(w, p, effect); return true; } catch (e) { if (e instanceof IngressRefusal) return false; throw e; }
  }

  it("blocks a second live attempt until fencing and effect reconciliation; never replays an uncertain effect", () => {
    let effects = 0;
    const a1 = dispatch("task-1", "att-1");
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    submitWorkerRecord(a1, { record_id: "i-1", kind: "effect_intent", effect_key: "push-main", body: {} });
    const r = ing.collect();
    // Crash after the external effect, before its completion receipt is journaled.
    expect(() => ing.runEffect(w, r.permits[0]!, () => { effects++; throw CRASH; })).toThrow(CRASH);
    expect(ing.taskState("task-1").effects).toContainEqual({ effect_key: "push-main", state: "in_flight", attempt_id: "att-1", worker_claim: null });
    expect(code(() => ing.runEffect(w, r.permits[0]!, () => effects++))).toBe("effect_refused");
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    expect(code(() => ing.releaseAttempt(w, "att-1"))).toBe("attempt_not_fenced");
    expect(code(() => ing.reconcileEffect(w, { task_id: "task-1", effect_key: "push-main", verdict: "applied", evidence_ref: "ev-1" }))).toBe("reconcile_refused");
    ing.fenceAttempt(w, "att-1");
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    const st = ing.taskState("task-1");
    expect(st.uncertain_effects).toEqual(["push-main"]);
    let err: unknown;
    try { ing.releaseAttempt(w, "att-1"); } catch (e) { err = e; }
    expect((err as IngressRefusal).code).toBe("effects_unreconciled");
    expect((err as IngressRefusal).uncertain).toEqual(["push-main"]);
    // A lost-but-alive worker writing after the fence is ignored and gets no permit.
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
    // The first attempt's permit, or one re-labelled for the second attempt, does not authorize.
    expect(code(() => ing.runEffect(w, r.permits[0]!, () => effects++))).toBe("effect_refused");
    expect(code(() => ing.runEffect(w, { ...r.permits[0]!, attempt_id: "att-2", grant_id: a2.grant.grant_id }, () => effects++))).toBe("permit_invalid");
    expect(effects).toBe(1);
  });

  it("negative control: crash after effect before receipt never yields a second effect, even across a controller restart", () => {
    let effects = 0;
    const a1 = dispatch("task-1", "att-1");
    submitWorkerRecord(a1, { record_id: "i-1", kind: "effect_intent", effect_key: "deploy", body: {} });
    submitWorkerRecord(a1, { record_id: "i-k", kind: "effect_intent", effect_key: "notify", body: {} });
    const r1 = ing.collect();
    expect(() => ing.runEffect(w, r1.permits.find((p) => p.effect_key === "deploy")!, () => { effects++; throw CRASH; })).toThrow(CRASH);
    // Controller restarts (new epoch); the old ingress is fenced and old permits are dead.
    const old = ing;
    ing = open();
    expect(code(() => old.collect())).toBe("controller_fenced");
    w = ing.controller.issueWriterGrant("lifecycle");
    expect(code(() => ing.runEffect(w, r1.permits.find((p) => p.effect_key === "notify")!, () => effects++))).toBe("permit_invalid");
    // The old worker (now reconcile_only) re-requests with fresh record ids: no permit.
    submitWorkerRecord(a1, { record_id: "i-1-again", kind: "effect_intent", effect_key: "deploy", body: {} });
    submitWorkerRecord(a1, { record_id: "i-k-again", kind: "effect_intent", effect_key: "notify", body: {} });
    const r2 = ing.collect();
    expect(r2.permits).toEqual([]);
    expect(r2.rejected.map((x) => x.code)).toEqual(["effect_replay_refused", "effect_replay_refused"]);
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    ing.fenceAttempt(w, "att-1");
    expect(ing.taskState("task-1").uncertain_effects).toEqual(["deploy"]);
    expect(code(() => ing.releaseAttempt(w, "att-1"))).toBe("effects_unreconciled");
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    expect(effects).toBe(1);
  });

  it("worker outcome claims never settle an effect; only the executor or a trusted verdict does", () => {
    let effects = 0;
    const a1 = dispatch("task-1", "att-1");
    submitWorkerRecord(a1, { record_id: "i-1", kind: "effect_intent", effect_key: "tag", body: {} });
    const p1 = ing.collect().permits[0]!;
    expect(() => ing.runEffect(w, p1, () => { throw CRASH; })).toThrow(CRASH);
    submitWorkerRecord(a1, { record_id: "r-1", kind: "effect_result", effect_key: "tag", outcome: "applied", body: {} });
    ing.collect();
    ing.fenceAttempt(w, "att-1");
    // The worker claims applied; the effect is still uncertain and release still blocks.
    expect(ing.taskState("task-1").effects).toContainEqual({ effect_key: "tag", state: "uncertain", attempt_id: "att-1", worker_claim: "applied" });
    expect(code(() => ing.releaseAttempt(w, "att-1"))).toBe("effects_unreconciled");
    ing.reconcileEffect(w, { task_id: "task-1", effect_key: "tag", verdict: "not_applied", evidence_ref: "ev-2" });
    expect(code(() => ing.reconcileEffect(w, { task_id: "task-1", effect_key: "tag", verdict: "applied", evidence_ref: "ev-3" }))).toBe("reconcile_refused");
    ing.releaseAttempt(w, "att-1");
    const a2 = dispatch("task-1", "att-2");
    submitWorkerRecord(a2, { record_id: "i-1", kind: "effect_intent", effect_key: "tag", body: {} });
    expect(effectStep(a2, "tag", ing.collect().permits, () => effects++)).toBe(true);
    ing.fenceAttempt(w, "att-2");
    ing.releaseAttempt(w, "att-2");
    expect(ing.taskState("task-1")).toMatchObject({ live_attempt: null, uncertain_effects: [] });
    // Executor-completed is terminal for the task: a third attempt cannot get the permit.
    const a3 = dispatch("task-1", "att-3");
    submitWorkerRecord(a3, { record_id: "i-1", kind: "effect_intent", effect_key: "tag", body: {} });
    expect(ing.collect().permits).toEqual([]);
    expect(effects).toBe(1);
  });

  it("an unconsumed permit settles on fence and may be re-permitted once to the next attempt", () => {
    let effects = 0;
    const a1 = dispatch("task-1", "att-1");
    submitWorkerRecord(a1, { record_id: "i-1", kind: "effect_intent", effect_key: "k", body: {} });
    const p1 = ing.collect().permits[0]!;
    ing.fenceAttempt(w, "att-1");
    expect(ing.taskState("task-1").effects[0]!.state).toBe("unstarted");
    expect(code(() => ing.runEffect(w, p1, () => effects++))).toBe("effect_refused");
    ing.releaseAttempt(w, "att-1");
    const a2 = dispatch("task-1", "att-2");
    submitWorkerRecord(a2, { record_id: "i-1", kind: "effect_intent", effect_key: "k", body: {} });
    expect(effectStep(a2, "k", ing.collect().permits, () => effects++)).toBe(true);
    expect(effects).toBe(1);
  });

  it("a worker cannot mint permits or forge results, and re-dispatch is idempotent", () => {
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
    // A permit MACed with the worker's own grant secret, or for another key, is refused.
    const crypto = require("node:crypto") as typeof import("node:crypto");
    const minted = { ...r.permits[0]!, effect_key: "other" };
    minted.mac = crypto.createHmac("sha256", a1.grant.secret).update(JSON.stringify(minted)).digest("hex");
    expect(code(() => ing.runEffect(w, minted, () => 0))).toBe("permit_invalid");
    expect(code(() => ing.runEffect(w, { ...r.permits[0]!, effect_key: "other" }, () => 0))).toBe("permit_invalid");
    expect(code(() => ing.runEffect(a1.grant as unknown as WriterGrant, r.permits[0]!, () => 0))).toBe("worker_grant_not_writer");
  });
});

describe("ingress robustness", () => {
  it("an async effect is journaled done only after it settles; a fence meanwhile keeps it uncertain", async () => {
    let effects = 0;
    const a1 = dispatch("task-1", "att-1");
    submitWorkerRecord(a1, { record_id: "i-1", kind: "effect_intent", effect_key: "slow", body: {} });
    const p = ing.collect().permits[0]!;
    let resolve!: () => void;
    const pending = ing.runEffect(w, p, () => new Promise<void>((r) => { resolve = () => { effects++; r(); }; }));
    ing.fenceAttempt(w, "att-1");
    expect(code(() => ing.releaseAttempt(w, "att-1"))).toBe("effects_unreconciled");
    expect(code(() => dispatch("task-1", "att-2"))).toBe("attempt_live");
    resolve();
    await expect(pending).rejects.toBeInstanceOf(IngressRefusal);
    expect(ing.taskState("task-1").uncertain_effects).toEqual(["slow"]);
    // A rejected async effect also stays started.
    const b = dispatch("task-2", "att-b");
    submitWorkerRecord(b, { record_id: "i-1", kind: "effect_intent", effect_key: "x", body: {} });
    const pb = ing.collect().permits[0]!;
    await expect(ing.runEffect(w, pb, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    ing.fenceAttempt(w, "att-b");
    expect(ing.taskState("task-2").uncertain_effects).toEqual(["x"]);
    expect(effects).toBe(1);
  });

  it("the leak check fails closed when a directory cannot be listed", () => {
    if (process.getuid?.() === 0) return;
    const b = dispatch("task-1", "att-1");
    const hidden = path.join(durableRoot, ".guild", "runs", RUN, "ui", "locked");
    fs.mkdirSync(hidden, { recursive: true });
    fs.writeFileSync(path.join(hidden, "leak.json"), b.grant.secret);
    fs.chmodSync(hidden, 0o000);
    try {
      const r = checkShareableLeaks({ durableRoot, run_id: RUN, grants: [b.grant] });
      expect(r).toMatchObject({ ok: false, complete: false });
    } finally {
      fs.chmodSync(hidden, 0o700);
    }
  });

  it("bounds directory scans by every entry, not only matching names", () => {
    ing.close();
    ing = open({ limits: { max_entries_scanned: 10 } });
    w = ing.controller.issueWriterGrant("lifecycle");
    const b = dispatch("task-1", "att-1");
    for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(b.ingress_dir, `.junk-${i}`), "");
    const r = ing.collect();
    expect(r.truncated).toBe(true);
  });

  it("repairs a durable copy lost between journal commit and publication", () => {
    const b = dispatch("task-1", "att-1");
    submitWorkerRecord(b, { record_id: "obs-1", kind: "observation", body: { ok: 1 } });
    ing.collect();
    const copy = path.join(durableRoot, ".guild", "runs", RUN, "attempts", "att-1", "records", "obs-1.json");
    fs.rmSync(copy);
    // The worker deletes its inbox file and the attempt is fenced: repair still comes from the journal.
    fs.rmSync(path.join(b.ingress_dir, "obs-1.json"));
    ing.fenceAttempt(w, "att-1");
    ing.collect();
    expect(ing.verifyRecordCopy("att-1", "obs-1")).toEqual({ ok: true });
    expect(fs.readFileSync(copy, "utf8").includes('"ok":1')).toBe(true);
  });
});
