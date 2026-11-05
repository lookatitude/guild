/**
 * R02 · fixed controller, grants and fencing (AT10, AT11).
 *
 * AT10 fencing concurrency: old writer epoch 7, writer epoch 8, retained
 * worker grant issued at 7. Old control writes reject; old worker observations
 * are accepted only in an allowed admission state; epoch 8 owns release.
 * Negative control: the retained worker grant used as a lifecycle writer
 * rejects.
 *
 * AT11 controller outage: controller unavailable mid-handoff, journal restart.
 * No new authoritative acceptance/scheduling/closure while unavailable;
 * observations replay idempotently after recovery. Negative control: an
 * automatic second-machine takeover refuses.
 *
 * W02 carry-over: the assurance ledger is controller-bound, so a rewritten
 * ledger with a recomputed ledger_hash is detected.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ControllerRefusal,
  openRunController,
  readControllerJournal,
  shareableGrantRef,
  verifyBoundArtifact,
  verifyControlReceipt,
  writeWorkerObservation,
  type AttemptGrant,
  type RunController,
  type WriterGrant,
} from "./run-controller";

let tmp: string;
let durableRoot: string;
let privateDir: string;
let clock: number;
const now = () => clock;
const LEASE = 10_000;
const RUN = "run-r02";

function open(extra: Partial<Parameters<typeof openRunController>[0]> = {}): RunController {
  return openRunController({
    privateDir, durableRoot, source_id: "source-a", run_id: RUN, host_id: "host-1",
    now, leaseMs: LEASE, pid: 4242, pidAlive: () => false, ...extra,
  });
}

function code(fn: () => unknown): string {
  try { fn(); } catch (e) { if (e instanceof ControllerRefusal) return e.code; throw e; }
  return "no-refusal";
}

/** Advance to epoch `target` by restarting the controller (each open is a new epoch). */
function openAtEpoch(target: number): RunController {
  let c = open();
  while (c.epoch < target) { c.close(); c = open(); }
  return c;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "r02-")));
  durableRoot = path.join(tmp, "project");
  privateDir = path.join(tmp, "state", "controller", RUN);
  fs.mkdirSync(path.join(durableRoot, ".guild"), { recursive: true });
  clock = 1_000_000;
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe("AT10 · fencing concurrency", () => {
  let old: RunController;
  let oldWriter: WriterGrant;
  let worker: AttemptGrant;
  let fresh: RunController;
  let writer8: WriterGrant;

  beforeEach(() => {
    old = openAtEpoch(7);
    expect(old.epoch).toBe(7);
    oldWriter = old.issueWriterGrant("scope:lifecycle");
    worker = old.issueAttemptGrant({ execution_id: "exec-a", attempt_id: "att-1", scope: "scope:exec-a", expires_at_ms: clock + 100_000 });
    writeWorkerObservation(durableRoot, RUN, worker, { observation_id: "obs-1", body: { kind: "progress", n: 1 } });
    // Old controller's process is gone (pid dead) but its object is still alive in memory.
    clock += LEASE + 1;
    fresh = open();
    writer8 = fresh.issueWriterGrant("scope:lifecycle");
  });

  it("advances to epoch 8 and fences every control write from the epoch-7 controller", () => {
    expect(fresh.epoch).toBe(8);
    expect(code(() => old.control(oldWriter, { operation_id: "op-old", action: "accept", subject: "att-1" }))).toBe("controller_fenced");
    expect(code(() => old.issueWriterGrant("scope:x"))).toBe("controller_fenced");
    expect(code(() => old.collectObservations())).toBe("controller_fenced");
    expect(fs.existsSync(path.join(durableRoot, ".guild", "runs", RUN, "controller", "receipts", "op-old.json"))).toBe(false);
  });

  it("rejects an epoch-7 writer grant presented to the epoch-8 controller", () => {
    expect(code(() => fresh.control(oldWriter, { operation_id: "op-r", action: "release", subject: "run" }))).toBe("writer_grant_fenced");
  });

  it("epoch 8 owns release", () => {
    const r = fresh.control(writer8, { operation_id: "op-release", action: "release", subject: "run" });
    expect(r.controller_epoch).toBe(8);
    expect(r.writer_grant_id).toBe(writer8.grant_id);
    expect(verifyControlReceipt({ privateDir, durableRoot, run_id: RUN, operation_id: "op-release" })).toEqual({ ok: true });
  });

  it("collects retained epoch-7 worker observations in reconcile_only admission", () => {
    const rep = fresh.collectObservations();
    expect(rep.accepted).toEqual([{ observation_id: "obs-1", execution_id: "exec-a", admission: "reconcile_only" }]);
    expect(rep.rejected).toEqual([]);
  });

  it("rejects old-segment observations once the segment is revoked or sealed", () => {
    fresh.setAdmission(writer8, "exec-a", "revoked");
    expect(fresh.collectObservations().rejected).toEqual([{ observation_id: "obs-1", code: "admission_revoked" }]);
    const c9 = (fresh.close(), open());
    const w9 = c9.issueWriterGrant("scope:lifecycle");
    const g = c9.issueAttemptGrant({ execution_id: "exec-b", attempt_id: "att-2", scope: "scope:exec-b", expires_at_ms: clock + 100_000 });
    c9.setAdmission(w9, "exec-b", "sealed");
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-late", body: { n: 2 } });
    expect(c9.collectObservations().rejected).toContainEqual({ observation_id: "obs-late", code: "admission_sealed" });
  });

  it("negative control: the retained worker grant is not a lifecycle writer", () => {
    for (const action of ["accept", "schedule", "close", "release"] as const) {
      expect(code(() => fresh.control(worker as unknown as WriterGrant, { operation_id: `op-${action}`, action, subject: "att-1" }))).toBe("worker_grant_not_writer");
    }
    // A forged writer grant shaped like a real one (unknown nonce) also rejects.
    const forged = { ...writer8, nonce: crypto.randomBytes(32).toString("hex") };
    expect(code(() => fresh.control(forged, { operation_id: "op-f", action: "release", subject: "run" }))).toBe("writer_grant_forged");
  });

  it("refuses a second attempt grant for the same attempt (grants are immutable)", () => {
    expect(code(() => fresh.issueAttemptGrant({ execution_id: "exec-a", attempt_id: "att-1", scope: "scope:other", expires_at_ms: clock + 1 }))).toBe("attempt_grant_exists");
  });
});

describe("AT10 · lane worker forgeries under .guild/", () => {
  let c: RunController;
  let w: WriterGrant;
  let g: AttemptGrant;
  const obsDir = () => path.join(durableRoot, ".guild", "runs", RUN, "executions", "exec-a", "observations");

  beforeEach(() => {
    c = open();
    w = c.issueWriterGrant("scope:lifecycle");
    g = c.issueAttemptGrant({ execution_id: "exec-a", attempt_id: "att-1", scope: "scope:exec-a", expires_at_ms: clock + 50_000 });
  });

  it("rejects an observation whose grant claims were edited or invented", () => {
    writeWorkerObservation(durableRoot, RUN, { ...g, claims: { ...g.claims, scope: "scope:everything" } }, { observation_id: "obs-x", body: {} });
    writeWorkerObservation(durableRoot, RUN, { ...g, claims: { ...g.claims, grant_id: "grant-invented" } }, { observation_id: "obs-y", body: {} });
    const rej = c.collectObservations().rejected;
    expect(rej).toContainEqual({ observation_id: "obs-x", code: "grant_forged" });
    expect(rej).toContainEqual({ observation_id: "obs-y", code: "grant_forged" });
  });

  it("rejects an observation whose bytes were rewritten without the grant secret", () => {
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-1", body: { ok: true } });
    const f = path.join(obsDir(), "obs-1.json");
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    rec.body = { ok: false };
    fs.writeFileSync(f, JSON.stringify(rec));
    expect(c.collectObservations().rejected).toEqual([{ observation_id: "obs-1", code: "observation_forged" }]);
  });

  it("rejects observations collected after the grant expired", () => {
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-1", body: {} });
    for (let i = 0; i < 6; i++) { clock += 9_000; c.heartbeat(); }
    expect(c.collectObservations().rejected).toEqual([{ observation_id: "obs-1", code: "grant_expired" }]);
  });

  it("detects a collected observation rewritten afterwards (conflict, original kept)", () => {
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-1", body: { v: 1 } });
    expect(c.collectObservations().accepted.length).toBe(1);
    const f = path.join(obsDir(), "obs-1.json");
    fs.rmSync(f);
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-1", body: { v: 2 } });
    expect(c.collectObservations().rejected).toEqual([{ observation_id: "obs-1", code: "observation_conflict" }]);
  });

  it("detects a rewritten control receipt and a planted one", () => {
    c.control(w, { operation_id: "op-1", action: "accept", subject: "att-1" });
    const dir = path.join(durableRoot, ".guild", "runs", RUN, "controller", "receipts");
    const rec = JSON.parse(fs.readFileSync(path.join(dir, "op-1.json"), "utf8"));
    rec.subject = "att-9";
    fs.writeFileSync(path.join(dir, "op-1.json"), JSON.stringify(rec));
    expect(verifyControlReceipt({ privateDir, durableRoot, run_id: RUN, operation_id: "op-1" })).toEqual({ ok: false, code: "receipt_mismatch" });
    fs.writeFileSync(path.join(dir, "op-planted.json"), JSON.stringify({ ...rec, operation_id: "op-planted" }));
    expect(verifyControlReceipt({ privateDir, durableRoot, run_id: RUN, operation_id: "op-planted" })).toEqual({ ok: false, code: "receipt_unbound" });
  });

  it("replays an identical control operation idempotently and refuses a changed one", () => {
    const a = c.control(w, { operation_id: "op-1", action: "schedule", subject: "exec-b" });
    const n = readControllerJournal({ privateDir }).entries.length;
    expect(c.control(w, { operation_id: "op-1", action: "schedule", subject: "exec-b" })).toEqual(a);
    expect(readControllerJournal({ privateDir }).entries.length).toBe(n);
    expect(code(() => c.control(w, { operation_id: "op-1", action: "close", subject: "exec-b" }))).toBe("operation_conflict");
  });

  it("fails closed when a journal entry is edited, dropped, or appended without the key", () => {
    c.control(w, { operation_id: "op-1", action: "accept", subject: "att-1" });
    const jdir = path.join(privateDir, "journal");
    const files = fs.readdirSync(jdir).filter((f) => /^\d+\.json$/.test(f)).sort();
    const last = path.join(jdir, files[files.length - 1]!);
    const e = JSON.parse(fs.readFileSync(last, "utf8"));
    e.body.subject = "att-9";
    fs.writeFileSync(last, JSON.stringify(e));
    expect(code(() => readControllerJournal({ privateDir }))).toBe("journal_corrupt");
    expect(code(() => c.control(w, { operation_id: "op-2", action: "accept", subject: "x" }))).toBe("journal_corrupt");
  });

  it("refuses a gap in the journal sequence", () => {
    c.control(w, { operation_id: "op-1", action: "accept", subject: "att-1" });
    c.control(w, { operation_id: "op-2", action: "accept", subject: "att-2" });
    const jdir = path.join(privateDir, "journal");
    const files = fs.readdirSync(jdir).filter((f) => /^\d+\.json$/.test(f)).sort();
    fs.rmSync(path.join(jdir, files[files.length - 2]!));
    expect(code(() => readControllerJournal({ privateDir }))).toBe("journal_corrupt");
  });

  it("never puts the key, a grant nonce or a worker secret under .guild/", () => {
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-1", body: { n: 1 } });
    c.collectObservations();
    c.control(w, { operation_id: "op-1", action: "accept", subject: "att-1" });
    c.bindArtifact(w, { kind: "assurance-ledger", id: "ledger-1", text: '{"ledger_hash":"sha256:' + "0".repeat(64) + '"}' });
    const key = fs.readFileSync(path.join(privateDir, "controller.key"));
    const needles = [key.toString("hex"), key.toString("base64"), w.nonce, g.secret, g.claims.nonce_hash];
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]);
    for (const f of walk(path.join(durableRoot, ".guild"))) {
      const text = fs.readFileSync(f, "utf8");
      for (const n of needles) expect(text.includes(n)).toBe(false);
    }
    const ref = shareableGrantRef(g);
    expect(Object.keys(ref).sort()).toEqual(["execution_id", "grant_id", "issued_controller_epoch", "kind", "scope_hash"]);
    expect(JSON.stringify(shareableGrantRef(w))).not.toContain(w.nonce);
    expect(fs.statSync(path.join(privateDir, "controller.key")).mode & 0o077).toBe(0);
  });

  it("refuses a private controller directory inside the durable .guild/ tree", () => {
    expect(code(() => open({ privateDir: path.join(durableRoot, ".guild", "ctl") }))).toBe("private_dir_shareable");
  });
});

describe("AT11 · controller outage", () => {
  it("suspends authoritative writes while unavailable and replays observations idempotently after restart", () => {
    const c1 = open();
    const w1 = c1.issueWriterGrant("scope:lifecycle");
    const g = c1.issueAttemptGrant({ execution_id: "exec-a", attempt_id: "att-1", scope: "scope:exec-a", expires_at_ms: clock + 1_000_000 });
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-1", body: { step: "handoff-prepared" } });
    c1.control(w1, { operation_id: "handoff-1-begin", action: "schedule", subject: "exec-b" });

    // Mid-handoff: the controller misses its lease (hung / host asleep).
    clock += LEASE + 1;
    for (const action of ["accept", "schedule", "close", "release"] as const) {
      expect(code(() => c1.control(w1, { operation_id: `handoff-1-${action}`, action, subject: "exec-b" }))).toBe("controller_unavailable");
    }
    expect(code(() => c1.collectObservations())).toBe("controller_unavailable");
    expect(code(() => c1.issueAttemptGrant({ execution_id: "exec-b", attempt_id: "att-2", scope: "s", expires_at_ms: clock + 1 }))).toBe("controller_unavailable");
    // Workers keep producing observations; they are files, not authority.
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-2", body: { step: "still-running" } });
    const before = readControllerJournal({ privateDir }).entries.length;

    // Journal restart on the same host.
    const c2 = open();
    expect(c2.epoch).toBe(c1.epoch + 1);
    const rep = c2.collectObservations();
    expect(rep.accepted.map((a) => a.observation_id).sort()).toEqual(["obs-1", "obs-2"]);
    const after = readControllerJournal({ privateDir }).entries.length;
    const again = c2.collectObservations();
    expect(again.accepted).toEqual([]);
    expect(again.replayed.sort()).toEqual(["obs-1", "obs-2"]);
    expect(readControllerJournal({ privateDir }).entries.length).toBe(after);
    expect(after).toBeGreaterThan(before);

    // The handoff completes only under the new epoch.
    const w2 = c2.issueWriterGrant("scope:lifecycle");
    expect(c2.control(w2, { operation_id: "handoff-1-accept", action: "accept", subject: "exec-b" }).controller_epoch).toBe(c2.epoch);
    expect(code(() => c1.control(w1, { operation_id: "handoff-1-late", action: "close", subject: "exec-b" }))).toBe("controller_fenced");
  });

  it("explicit suspend stops authoritative writes until a new epoch opens", () => {
    const c = open();
    const w = c.issueWriterGrant("s");
    c.suspend();
    expect(code(() => c.control(w, { operation_id: "op", action: "close", subject: "run" }))).toBe("controller_unavailable");
    const c2 = open();
    expect(c2.epoch).toBe(c.epoch + 1);
  });

  it("a live controller on the same host blocks a second controller", () => {
    open({ pidAlive: () => true });
    expect(code(() => open({ pid: 777, pidAlive: () => true }))).toBe("controller_busy");
  });

  it("PID reuse: an alive pid with a stale heartbeat does not keep the lease", () => {
    const c1 = open({ pidAlive: () => true });
    clock += LEASE + 1;
    const c2 = open({ pid: 777, pidAlive: () => true });
    expect(c2.epoch).toBe(c1.epoch + 1);
  });

  it("negative control: automatic second-machine takeover refuses, even with a stale lease", () => {
    const c = open();
    c.close();
    clock += LEASE * 10;
    expect(code(() => open({ host_id: "host-2" }))).toBe("controller_failover_refused");
    expect(readControllerJournal({ privateDir }).epoch).toBe(c.epoch);
  });

  it("refuses to re-key: a journal without its key is unavailable, not reset", () => {
    open().close();
    fs.rmSync(path.join(privateDir, "controller.key"));
    expect(code(() => open())).toBe("controller_key_missing");
  });

  it("refuses a journal opened for another run or source", () => {
    open().close();
    expect(code(() => open({ run_id: "run-other" }))).toBe("journal_identity_mismatch");
    expect(code(() => open({ source_id: "source-b" }))).toBe("journal_identity_mismatch");
  });
});

describe("R02 · codex r1 regressions", () => {
  it("F1: lease expiring between fsync and link commits nothing", () => {
    const c = open();
    const w = c.issueWriterGrant("s");
    const n = readControllerJournal({ privateDir }).entries.length;
    const real = fs.fsyncSync;
    const spy = spyOn(fs, "fsyncSync").mockImplementation((fd: number) => { clock += LEASE + 1; real(fd); });
    try {
      expect(code(() => c.control(w, { operation_id: "op-late", action: "release", subject: "run" }))).toBe("controller_unavailable");
    } finally { spy.mockRestore(); }
    expect(readControllerJournal({ privateDir }).entries.length).toBe(n);
    expect(readControllerJournal({ privateDir }).operations.has("op-late")).toBe(false);
  });

  it("F1: a provisional entry is inert when the lease expires before its commit", () => {
    const c = open();
    const w = c.issueWriterGrant("s");
    const real = fs.linkSync;
    let journalLinks = 0;
    const spy = spyOn(fs, "linkSync").mockImplementation((a: fs.PathLike, b: fs.PathLike) => { real(a, b); if (String(b).includes(`${path.sep}journal${path.sep}`) && ++journalLinks === 1) clock += LEASE + 1; });
    try {
      expect(code(() => c.control(w, { operation_id: "op-late", action: "release", subject: "run" }))).toBe("controller_unavailable");
    } finally { spy.mockRestore(); }
    const v = readControllerJournal({ privateDir });
    expect(v.entries[v.entries.length - 1]!.kind).toBe("control");
    expect(v.operations.has("op-late")).toBe(false);
    expect(fs.existsSync(path.join(durableRoot, ".guild", "runs", RUN, "controller", "receipts", "op-late.json"))).toBe(false);
    // The next epoch sees no effect and can perform the operation itself.
    const c2 = open();
    const w2 = c2.issueWriterGrant("s");
    expect(c2.control(w2, { operation_id: "op-late", action: "release", subject: "run" }).controller_epoch).toBe(c2.epoch);
  });

  it("F1: a crash between the provisional entry and its commit leaves no effect after restart", () => {
    const c = open();
    const w = c.issueWriterGrant("s");
    const real = fs.linkSync;
    let journalLinks = 0;
    const spy = spyOn(fs, "linkSync").mockImplementation((a: fs.PathLike, b: fs.PathLike) => {
      if (String(b).includes(`${path.sep}journal${path.sep}`) && ++journalLinks === 2) throw Object.assign(new Error("crash"), { code: "EIO" });
      real(a, b);
    });
    try { expect(() => c.control(w, { operation_id: "op-x", action: "accept", subject: "a" })).toThrow("crash"); } finally { spy.mockRestore(); }
    clock += LEASE + 1;
    open();
    expect(readControllerJournal({ privateDir }).operations.has("op-x")).toBe(false);
  });

  it("F1: a newer epoch taking the commit's sequence leaves the late entry inert", () => {
    const c = open();
    const w = c.issueWriterGrant("s");
    const real = fs.linkSync;
    let journalLinks = 0;
    let c2: RunController | null = null;
    const spy = spyOn(fs, "linkSync").mockImplementation((a: fs.PathLike, b: fs.PathLike) => {
      const isJournal = String(b).includes(`${path.sep}journal${path.sep}`);
      if (isJournal && ++journalLinks === 2) { spy.mockRestore(); clock += LEASE + 1; c2 = open(); }
      real(a, b);
    });
    try {
      // The commit link happens after its precommit check passed, then loses the sequence to epoch_open.
      expect(code(() => c.control(w, { operation_id: "op-y", action: "close", subject: "run" }))).toMatch(/controller_fenced|controller_unavailable/);
    } finally { spy.mockRestore(); }
    expect(c2).not.toBeNull();
    expect(readControllerJournal({ privateDir }).operations.has("op-y")).toBe(false);
  });

  it("F2: suspend that misses its lease does not corrupt the journal", () => {
    const c = open();
    clock += LEASE + 1;
    c.suspend();
    const w = (() => { try { return c.issueWriterGrant("s"); } catch (e) { return (e as ControllerRefusal).code; } })();
    expect(w).toBe("controller_unavailable");
    const c2 = open();
    expect(c2.epoch).toBe(c.epoch + 1);
    expect(readControllerJournal({ privateDir }).epoch).toBe(c2.epoch);
  });

  it("F2: a stale epoch's lease write or removal does not wedge the current epoch", () => {
    const c1 = open();
    clock += LEASE + 1;
    const c2 = open();
    const w = c2.issueWriterGrant("s");
    const leaseFile = path.join(privateDir, "lease.json");
    fs.writeFileSync(leaseFile, JSON.stringify({ pid: 4242, host_id: "host-1", token: "old", heartbeat_ms: clock, epoch: c1.epoch }));
    expect(c2.control(w, { operation_id: "op-1", action: "accept", subject: "a" }).controller_epoch).toBe(c2.epoch);
    expect(JSON.parse(fs.readFileSync(leaseFile, "utf8")).epoch).toBe(c2.epoch);
    fs.rmSync(leaseFile);
    expect(c2.control(w, { operation_id: "op-2", action: "accept", subject: "a" }).controller_epoch).toBe(c2.epoch);
    expect(code(() => c1.heartbeat())).toBe("controller_fenced");
  });

  it("F3: an attempt grant lost before delivery is re-delivered by an identical request", () => {
    const c1 = open();
    const req = { execution_id: "exec-a", attempt_id: "att-1", scope: "scope:a", expires_at_ms: clock + 100_000 };
    const g1 = c1.issueAttemptGrant(req);
    c1.close();
    const c2 = open();
    const g2 = c2.issueAttemptGrant(req);
    expect(g2).toEqual(g1);
    expect(code(() => c2.issueAttemptGrant({ ...req, scope: "scope:b" }))).toBe("attempt_grant_exists");
    writeWorkerObservation(durableRoot, RUN, g2, { observation_id: "obs-1", body: {} });
    expect(c2.collectObservations().accepted.map((a) => a.observation_id)).toEqual(["obs-1"]);
  });

  it("F4: a prefix of junk files cannot starve a later observation", () => {
    const c = open({ maxObservationsPerCollect: 3 });
    const g = c.issueAttemptGrant({ execution_id: "zzz", attempt_id: "att-1", scope: "s", expires_at_ms: clock + 100_000 });
    const junk = path.join(durableRoot, ".guild", "runs", RUN, "executions", "aaa", "observations");
    fs.mkdirSync(junk, { recursive: true });
    for (let i = 0; i < 7; i++) fs.writeFileSync(path.join(junk, `j${i}.json`), "{}");
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-1", body: {} });
    const accepted: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = c.collectObservations();
      accepted.push(...r.accepted.map((a) => a.observation_id));
      expect(r.rejected.length + r.accepted.length + r.replayed.length).toBeLessThanOrEqual(3);
    }
    expect(accepted).toEqual(["obs-1"]);
  });

  it("F3: cursor order matches traversal order for prefix execution ids", () => {
    const c = open({ maxObservationsPerCollect: 1 });
    const ga = c.issueAttemptGrant({ execution_id: "a", attempt_id: "att-a", scope: "s", expires_at_ms: clock + 100_000 });
    const gb = c.issueAttemptGrant({ execution_id: "a-1", attempt_id: "att-b", scope: "s", expires_at_ms: clock + 100_000 });
    writeWorkerObservation(durableRoot, RUN, ga, { observation_id: "obs-a", body: {} });
    writeWorkerObservation(durableRoot, RUN, gb, { observation_id: "obs-b", body: {} });
    const accepted = new Set<string>();
    for (let i = 0; i < 2; i++) for (const a of c.collectObservations().accepted) accepted.add(a.observation_id);
    expect([...accepted].sort()).toEqual(["obs-a", "obs-b"]);
  });

  it("F4: a planted file in place of an observations directory does not abort collection", () => {
    const c = open();
    const g = c.issueAttemptGrant({ execution_id: "zzz", attempt_id: "att-1", scope: "s", expires_at_ms: clock + 100_000 });
    const bad = path.join(durableRoot, ".guild", "runs", RUN, "executions", "aaa");
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, "observations"), "not a dir");
    writeWorkerObservation(durableRoot, RUN, g, { observation_id: "obs-1", body: {} });
    expect(c.collectObservations().accepted.map((a) => a.observation_id)).toEqual(["obs-1"]);
  });
});

describe("W02 carry-over · authority-bound assurance ledger", () => {
  const canonical = (v: unknown): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  };
  /** Same unkeyed digest rule as W02 assuranceLedgerHash: sha256 over the body without ledger_hash. */
  const sealUnkeyed = (body: Record<string, unknown>) =>
    JSON.stringify({ ...body, ledger_hash: `sha256:${crypto.createHash("sha256").update(canonical(body)).digest("hex")}` });
  const body = { schema_version: "guild.assurance_ledger.v1", epoch: 0, obligations: [{ id: "ob-1", status: "rejected" }], invocations: [] };

  it("verifies the ledger bytes the controller bound", () => {
    const c = open();
    const w = c.issueWriterGrant("scope:assurance");
    const text = sealUnkeyed(body);
    c.bindArtifact(w, { kind: "assurance-ledger", id: "ledger-1", text });
    expect(verifyBoundArtifact({ privateDir, kind: "assurance-ledger", id: "ledger-1", text })).toEqual({ ok: true });
  });

  it("detects a worker rewrite that recomputes ledger_hash", () => {
    const c = open();
    const w = c.issueWriterGrant("scope:assurance");
    c.bindArtifact(w, { kind: "assurance-ledger", id: "ledger-1", text: sealUnkeyed(body) });
    const forged = sealUnkeyed({ ...body, obligations: [{ id: "ob-1", status: "accepted" }] });
    expect(JSON.parse(forged).ledger_hash).not.toBe(JSON.parse(sealUnkeyed(body)).ledger_hash);
    expect(verifyBoundArtifact({ privateDir, kind: "assurance-ledger", id: "ledger-1", text: forged })).toEqual({ ok: false, code: "artifact_mismatch" });
    expect(verifyBoundArtifact({ privateDir, kind: "assurance-ledger", id: "ledger-2", text: forged })).toEqual({ ok: false, code: "artifact_unbound" });
  });

  it("only the latest binding verifies; a rolled-back older ledger is stale", () => {
    const c = open();
    const w = c.issueWriterGrant("scope:assurance");
    const v1 = sealUnkeyed(body);
    const v2 = sealUnkeyed({ ...body, epoch: 1 });
    c.bindArtifact(w, { kind: "assurance-ledger", id: "ledger-1", text: v1 });
    c.bindArtifact(w, { kind: "assurance-ledger", id: "ledger-1", text: v2 });
    expect(verifyBoundArtifact({ privateDir, kind: "assurance-ledger", id: "ledger-1", text: v1 })).toEqual({ ok: false, code: "artifact_mismatch" });
    expect(verifyBoundArtifact({ privateDir, kind: "assurance-ledger", id: "ledger-1", text: v2 })).toEqual({ ok: true });
  });

  it("refuses to bind a ledger whose own ledger_hash is absent or malformed", () => {
    const c = open();
    const w = c.issueWriterGrant("scope:assurance");
    expect(code(() => c.bindArtifact(w, { kind: "assurance-ledger", id: "l", text: JSON.stringify(body) }))).toBe("artifact_invalid");
    expect(code(() => c.bindArtifact(w, { kind: "assurance-ledger", id: "l", text: "not json" }))).toBe("artifact_invalid");
  });

  it("binding is an authoritative write: a worker grant or an unavailable controller cannot bind", () => {
    const c = open();
    const g = c.issueAttemptGrant({ execution_id: "e", attempt_id: "a", scope: "s", expires_at_ms: clock + 1e6 });
    expect(code(() => c.bindArtifact(g as unknown as WriterGrant, { kind: "assurance-ledger", id: "l", text: sealUnkeyed(body) }))).toBe("worker_grant_not_writer");
    const w = c.issueWriterGrant("s");
    clock += LEASE + 1;
    expect(code(() => c.bindArtifact(w, { kind: "assurance-ledger", id: "l", text: sealUnkeyed(body) }))).toBe("controller_unavailable");
  });
});
