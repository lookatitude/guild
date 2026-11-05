/**
 * R04 · AT15 transfer races and AT16 transfer crash matrix.
 *
 * AT15 fixture: two operation ids transfer the same source revision to two
 * roots. Expected: at most one destination executable; the expected
 * disposition revision CAS reserves the source exclusively; the same operation
 * with the same payload recovers. Negative control: reusing an operation id
 * with a different destination is rejected.
 *
 * AT16 fixture: crash at reserve, prepare, source commit, target activate and
 * ack. Expected: a prepared target is not executable; the source's clean close
 * waits for the ack; recovery keeps exactly one destination and the work
 * lineage. Negative control: an unreachable target is never reported as
 * committed.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { openRunController, type RunController, type WriterGrant } from "./run-controller";
import type { Entity } from "./execution-identity";
import { canonicalJson, hashOf } from "./durable-once";
import {
  FOLLOWUP_TRANSFER_SCHEMA,
  TRANSFER_POINTS,
  TransferRefusal,
  abortTransfer,
  isFollowupExecutable,
  openWorkDisposition,
  readWorkDisposition,
  reconcileTransfer,
  reserveWorkDisposition,
  runTransfer,
  transferCloseBlocker,
  validateFollowupTransfer,
  type TransferPoint,
  type TransferRequest,
} from "./followup-transfer";

const PLUGIN_ROOT = path.resolve(__dirname, "../../..");
const A02_ROOT = process.env["A02_CONTRACT_ROOT"] ?? path.resolve(PLUGIN_ROOT, "../contracts/guild-stack/v2");
const A02_PRESENT = fs.existsSync(path.join(A02_ROOT, "contract-bundle.json"));
const VENDORED = JSON.parse(fs.readFileSync(path.join(__dirname, "followup-transfer.a02-cases.json"), "utf8")) as {
  cases: Array<{ id: string; valid: boolean; expected_errors: string[]; instance: Record<string, unknown> }>;
};

const H = (c: string) => `sha256:${c.repeat(64)}`;
const SRC = "source-a";
const RUN = "run-1";
const WORK: Entity = { source_id: SRC, kind: "logical_task", id: "task-1", revision: H("a") };
const dest = (id: string): Entity => ({ source_id: "source-b", kind: "logical_task", id, revision: H("b") });

let tmp: string;
let sourceRoot: string;
let targetA: string;
let targetB: string;
let ctl: RunController;
let grant: WriterGrant;
let clock: number;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r04-xfer-"));
  sourceRoot = path.join(tmp, "source");
  targetA = path.join(tmp, "target-a");
  targetB = path.join(tmp, "target-b");
  for (const d of [sourceRoot, targetA, targetB]) fs.mkdirSync(d);
  clock = Date.parse("2026-11-05T00:00:00.000Z");
  ctl = openRunController({ privateDir: path.join(tmp, "state"), durableRoot: sourceRoot, source_id: SRC, run_id: RUN, host_id: "host-a", now: () => clock });
  grant = ctl.issueWriterGrant("scope:lifecycle");
});
afterEach(() => {
  ctl.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function req(operation_id: string, expected: string, destination = dest("follow-1"), payload: unknown = { title: "follow up", n: 1 }): TransferRequest {
  return { operation_id, source_work: WORK, expected_disposition_revision: expected, destination_work: destination, destination_policy_hash: H("1"), payload };
}
function ports(targetRoot: string, at?: (p: TransferPoint) => void) {
  return { controller: ctl, grant, sourceRoot, targetRoot, controllerPrivateDir: path.join(tmp, "state"), now: () => (clock += 1), at };
}
function code(fn: () => unknown): string {
  try { fn(); } catch (e) { return e instanceof TransferRefusal ? e.code : `other:${(e as Error).message}`; }
  return "no-throw";
}
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(path.relative(root, p));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}
const exec = (targetRoot: string, op: string) => isFollowupExecutable({ sourceRoot, targetRoot, source_id: SRC, run_id: RUN, operation_id: op });

// ajv over the frozen schemas + the A02 semantic rule for this schema.
let ajvValidate: ((v: unknown) => boolean) | null = null;
if (A02_PRESENT) {
  const r = createRequire(path.join(PLUGIN_ROOT, "scripts", "package.json"));
  const Ajv2020 = r("ajv/dist/2020").default;
  const addFormats = r("ajv-formats").default;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const dir = path.join(A02_ROOT, "schemas");
  for (const f of fs.readdirSync(dir)) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  ajvValidate = ajv.getSchema("https://guildstack.dev/contracts/guild-stack/v2/followup-transfer.schema.json");
}
function expectFrozenValid(rec: unknown): void {
  const v = validateFollowupTransfer(rec);
  expect(v).toEqual({ ok: true });
  if (ajvValidate) expect(ajvValidate(rec)).toBe(true);
}

describe("followup_transfer.v1 parity with the frozen A02 contract", () => {
  it("matches every vendored A02 followup-transfer case", () => {
    expect(VENDORED.cases.length).toBeGreaterThanOrEqual(14);
    for (const c of VENDORED.cases) {
      const v = validateFollowupTransfer(c.instance);
      expect({ id: c.id, ok: v.ok }).toEqual({ id: c.id, ok: c.valid });
      if (!v.ok && c.expected_errors.length) expect(v.errors).toEqual(expect.arrayContaining(c.expected_errors));
    }
  });
  it.if(A02_PRESENT)("vendored cases equal the frozen A02 fixtures", () => {
    const fx = path.join(A02_ROOT, "fixtures");
    const live = [
      ...JSON.parse(fs.readFileSync(path.join(fx, "cases.json"), "utf8")).filter((c: { schema: string }) => c.schema === "followup-transfer").map((c: { id: string; instance: unknown }) => [c.id, c.instance]),
      ...JSON.parse(fs.readFileSync(path.join(fx, "regressions.json"), "utf8")).cases.filter((c: { schema: string }) => c.schema === "followup-transfer").map((c: { id: string; instance: unknown }) => [c.id, c.instance]),
    ];
    expect(VENDORED.cases.map((c) => [c.id, c.instance])).toEqual(live);
  });
});

describe("AT15 · transfer races", () => {
  it("two operation ids on one source revision: one destination executable, the other aborted", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    const a = runTransfer(req("xfer-a", rev, dest("follow-a")), ports(targetA));
    const b = runTransfer(req("xfer-b", rev, dest("follow-b")), ports(targetB));
    expect(a.state).toBe("acknowledged");
    expect(b.state).toBe("aborted");
    expect(b.refusal).toBe("disposition_conflict");
    expect([exec(targetA, "xfer-a"), exec(targetB, "xfer-b")]).toEqual([true, false]);
    expect(listFiles(targetB)).toEqual([]);
    expectFrozenValid(a.record);
    expectFrozenValid(b.record);
  });

  it("interleaved claimants: the loser of the reservation link aborts, exactly one destination", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    let inner: ReturnType<typeof runTransfer> | null = null;
    const a = runTransfer(req("xfer-a", rev, dest("follow-a")), ports(targetA, (p) => {
      if (p === "reserve_link" && !inner) inner = runTransfer(req("xfer-b", rev, dest("follow-b")), ports(targetB));
    }));
    expect(inner!.state).toBe("acknowledged");
    expect(a.state).toBe("aborted");
    expect(a.refusal).toBe("reservation_lost");
    expect([exec(targetA, "xfer-a"), exec(targetB, "xfer-b")]).toEqual([false, true]);
    // The losing reservation's controller receipt exists but no disposition entry names it.
    expect(readWorkDisposition(sourceRoot, RUN, WORK).entries.map((e) => [e.state, e.operation_id])).toEqual([
      ["open", null], ["transfer_reserved", "xfer-b"], ["transferred", "xfer-b"],
    ]);
  });

  it("concurrent processes racing the disposition CAS: exactly one reservation wins", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    const N = 6;
    const start = Date.now() + 1500;
    const script = `
      const m = require(${JSON.stringify(path.join(__dirname, "followup-transfer.ts"))});
      while (Date.now() < ${start}) {}
      const r = m.reserveWorkDisposition(${JSON.stringify(sourceRoot)}, ${JSON.stringify(RUN)}, ${JSON.stringify(WORK)}, {
        operation_id: process.argv[1], expected_revision: ${JSON.stringify(rev)}, intent_hash: ${JSON.stringify(H("9"))},
        destination_work: ${JSON.stringify(dest("follow-x"))}, target_root_digest: ${JSON.stringify(H("8"))} });
      process.stdout.write(r.outcome);`;
    const procs = Array.from({ length: N }, (_, i) =>
      Bun.spawn([Bun.which("bun") ?? "bun", "-e", script, `race-${i}`], { stdout: "pipe", stderr: "pipe" }));
    return Promise.all(procs.map(async (p) => { await p.exited; return `${(await new Response(p.stdout).text()).trim()}${(await new Response(p.stderr).text()).trim()}`; })).then((results) => {
      expect(results.filter((r) => r === "reserved").length, JSON.stringify(results)).toBe(1);
      expect(results.filter((r) => r === "conflict").length).toBe(N - 1);
      const entries = readWorkDisposition(sourceRoot, RUN, WORK).entries;
      expect(entries.length).toBe(2);
      expect(entries[1]!.state).toBe("transfer_reserved");
    });
  }, 30_000);

  it("the same operation with the same payload recovers without new effects", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    const a1 = runTransfer(req("xfer-a", rev), ports(targetA));
    const filesSrc = listFiles(sourceRoot);
    const filesTgt = listFiles(targetA);
    const a2 = runTransfer(req("xfer-a", rev), ports(targetA));
    expect(a2.state).toBe("acknowledged");
    expect(a2.record).toEqual(a1.record);
    expect(listFiles(sourceRoot)).toEqual(filesSrc);
    expect(listFiles(targetA)).toEqual(filesTgt);
  });

  it("negative control: reusing an operation id with a different destination or payload is rejected", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    runTransfer(req("xfer-a", rev, dest("follow-a")), ports(targetA));
    expect(code(() => runTransfer(req("xfer-a", rev, dest("follow-z")), ports(targetA)))).toBe("operation_conflict");
    expect(code(() => runTransfer(req("xfer-a", rev, dest("follow-a")), ports(targetB)))).toBe("operation_conflict");
    expect(code(() => runTransfer(req("xfer-a", rev, dest("follow-a"), { title: "other" }), ports(targetA)))).toBe("operation_conflict");
    expect(listFiles(targetB)).toEqual([]);
  });

  it("a stale or unknown expected revision is refused after the source moved", () => {
    const rev0 = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(runTransfer(req("xfer-a", rev0), ports(targetA)).state).toBe("acknowledged");
    const late = runTransfer(req("xfer-c", rev0, dest("follow-c")), ports(targetB));
    expect([late.state, late.refusal]).toEqual(["aborted", "disposition_conflict"]);
    const head = readWorkDisposition(sourceRoot, RUN, WORK).head_revision;
    // Even the current head refuses: a transferred source is terminal.
    expect(runTransfer(req("xfer-d", head, dest("follow-d")), ports(targetB)).refusal).toBe("disposition_conflict");
    expect(runTransfer(req("xfer-e", H("7"), dest("follow-e")), ports(targetB)).refusal).toBe("disposition_conflict");
    expect(listFiles(targetB)).toEqual([]);
  });

  it("replayed or foreign records are not executable and fail closed on read", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    runTransfer(req("xfer-a", rev, dest("follow-a")), ports(targetA));
    // Replay A's inbound records into B under A's operation id: B is not the reserved destination.
    const inbound = path.join(".guild", "transfers", "inbound", SRC, "xfer-a");
    fs.cpSync(path.join(targetA, inbound), path.join(targetB, inbound), { recursive: true });
    expect(exec(targetB, "xfer-a")).toBe(false);
    // Replay A's inbound records under another operation id.
    fs.cpSync(path.join(targetA, inbound), path.join(targetA, ".guild", "transfers", "inbound", SRC, "xfer-forged"), { recursive: true });
    expect(exec(targetA, "xfer-forged")).toBe(false);
    // Tamper with a source stage record: reconcile refuses instead of trusting it.
    const stage = path.join(sourceRoot, ".guild", "runs", RUN, "transfers", "xfer-a", "04-target_activated.json");
    const rec = JSON.parse(fs.readFileSync(stage, "utf8"));
    rec.destination_work.id = "follow-z";
    fs.chmodSync(stage, 0o644);
    fs.writeFileSync(stage, JSON.stringify(rec));
    expect(code(() => reconcileTransfer({ sourceRoot, targetRoot: targetA, source_id: SRC, run_id: RUN, operation_id: "xfer-a" }))).toBe("journal_corrupt");
  });
});

// ── AT16 ─────────────────────────────────────────────────────────────────────

const STAGE_AFTER: Record<TransferPoint, string> = {
  intent: "none", reserve_receipt: "none", reserve_link: "none", reserve: "reserved", reserved_record: "reserved",
  prepare: "target_prepared", prepared_record: "target_prepared",
  commit_receipt: "target_prepared", source_commit: "source_committed", source_committed_record: "source_committed",
  activate: "target_activated", activated_record: "target_activated",
  target_ack: "target_activated", ack_receipt: "target_activated", ack: "acknowledged",
};

describe("AT16 · transfer crash matrix", () => {
  for (const point of TRANSFER_POINTS) {
    it(`crash at ${point}: non-executable until activation, close waits for ack, recovery keeps one destination`, () => {
      const rev = openWorkDisposition(sourceRoot, RUN, WORK);
      expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === point) throw new Error(`crash@${point}`); })))).toBe(`other:crash@${point}`);

      const activated = ["activate", "activated_record", "target_ack", "ack_receipt", "ack"].includes(point);
      expect(exec(targetA, "xfer-a")).toBe(activated);
      const view = reconcileTransfer({ sourceRoot, targetRoot: targetA, source_id: SRC, run_id: RUN, operation_id: "xfer-a" });
      expect(view === null ? "none" : view.journal_state).toBe(STAGE_AFTER[point]);
      if (view?.record) expectFrozenValid(view.record);
      const reservedYet = !["intent", "reserve_receipt", "reserve_link"].includes(point);
      if (reservedYet && point !== "ack") expect(transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state"))).not.toBeNull();
      else expect(transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state"))).toBeNull();

      // A competing claimant cannot take the source while this one is in flight.
      const rival = runTransfer(req("xfer-b", rev, dest("follow-b")), ports(targetB));
      if (["intent", "reserve_receipt", "reserve_link"].includes(point)) {
        // Nothing reserved yet: the rival wins and the crashed op later aborts.
        expect(rival.state).toBe("acknowledged");
        expect(runTransfer(req("xfer-a", rev), ports(targetA)).state).toBe("aborted");
        expect([exec(targetA, "xfer-a"), exec(targetB, "xfer-b")]).toEqual([false, true]);
        return;
      }
      expect(rival.state).toBe("aborted");

      const done = runTransfer(req("xfer-a", rev), ports(targetA));
      expect(done.state).toBe("acknowledged");
      expectFrozenValid(done.record);
      expect([exec(targetA, "xfer-a"), exec(targetB, "xfer-b")]).toEqual([true, false]);
      expect(transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state"))).toBeNull();
      expect(readWorkDisposition(sourceRoot, RUN, WORK).entries.map((e) => e.state)).toEqual(["open", "transfer_reserved", "transferred"]);
      // Work lineage survives into the destination.
      const prepared = JSON.parse(fs.readFileSync(path.join(targetA, ".guild", "transfers", "inbound", SRC, "xfer-a", "prepared.json"), "utf8"));
      expect(prepared.source_work).toEqual(WORK);
      expect(prepared.source_run_id).toBe(RUN);
      expect(prepared.executable).toBe(false);
      expect(listFiles(targetB)).toEqual([]);
    });
  }

  it("a prepared target can be abandoned before the source commit and stays non-executable", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "prepared_record") throw new Error("crash"); })))).toBe("other:crash");
    const ab = abortTransfer({ operation_id: "xfer-a", source_work: WORK }, ports(targetA));
    expect(ab.state).toBe("aborted");
    expectFrozenValid(ab.record);
    expect(exec(targetA, "xfer-a")).toBe(false);
    // Resuming the aborted op never revives it.
    expect(runTransfer(req("xfer-a", rev), ports(targetA)).state).toBe("aborted");
    expect(exec(targetA, "xfer-a")).toBe(false);
    // The stale revision is refused; the released revision transfers elsewhere.
    expect(runTransfer(req("xfer-b", rev, dest("follow-b")), ports(targetB)).refusal).toBe("disposition_conflict");
    const head = readWorkDisposition(sourceRoot, RUN, WORK).head_revision!;
    expect(runTransfer(req("xfer-c", head, dest("follow-c")), ports(targetB)).state).toBe("acknowledged");
    expect([exec(targetA, "xfer-a"), exec(targetB, "xfer-b"), exec(targetB, "xfer-c")]).toEqual([false, false, true]);
    expect(transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state"))).toBeNull();
  });

  it("abort after the source commit is refused", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "source_committed_record") throw new Error("crash"); })))).toBe("other:crash");
    expect(code(() => abortTransfer({ operation_id: "xfer-a", source_work: WORK }, ports(targetA)))).toBe("already_committed");
  });

  it("negative control: an unreachable target is never reported committed", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    const gone = path.join(tmp, "missing-target");
    const r = runTransfer(req("xfer-a", rev), ports(gone));
    expect(r.state).toBe("recovery_needed");
    expect(r.record.source_commit).toBeNull();
    expect(r.record.target_ack).toBeNull();
    expectFrozenValid(r.record);
    expect(transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state"))).not.toBeNull();
  });

  it("negative control: a target lost after the source commit stays recovery_needed, never acknowledged", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "source_committed_record") throw new Error("crash"); })))).toBe("other:crash");
    fs.rmSync(targetA, { recursive: true, force: true });
    const r = runTransfer(req("xfer-a", rev), ports(targetA));
    expect(r.state).toBe("recovery_needed");
    expect(r.record.source_commit).not.toBeNull();
    expect(r.record.target_activation).toBeNull();
    expect(r.record.target_ack).toBeNull();
    expectFrozenValid(r.record);
    const v = reconcileTransfer({ sourceRoot, targetRoot: targetA, source_id: SRC, run_id: RUN, operation_id: "xfer-a" });
    expect(v?.record.state).toBe("recovery_needed");
    expect(transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state"))).not.toBeNull();
  });

  it("a fenced (older-epoch) controller cannot advance the source journal", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "prepared_record") throw new Error("crash"); })))).toBe("other:crash");
    ctl.close();
    const next = openRunController({ privateDir: path.join(tmp, "state"), durableRoot: sourceRoot, source_id: SRC, run_id: RUN, host_id: "host-a", now: () => clock });
    try {
      // The old grant is from the superseded epoch.
      expect(code(() => runTransfer(req("xfer-a", rev), { ...ports(targetA), controller: next }))).toBe("controller_refused");
      const g2 = next.issueWriterGrant("scope:lifecycle");
      expect(runTransfer(req("xfer-a", rev), { ...ports(targetA), controller: next, grant: g2 }).state).toBe("acknowledged");
    } finally {
      next.close();
    }
  });

  it("codex r1 F2: a fabricated ack record does not clear the close blocker", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "source_committed_record") throw new Error("crash"); })))).toBe("other:crash");
    const dir = path.join(sourceRoot, ".guild", "runs", RUN, "transfers", "xfer-a");
    const rec = JSON.parse(fs.readFileSync(path.join(dir, "03-source_committed.json"), "utf8"));
    const fake = { ...rec.source_commit, path: ".guild/transfers/inbound/source-a/xfer-a/ack.json", sha256: H("5"), schema_version: "guild.followup_inbound.v1", source_id: "source-b" };
    for (const [f, st, ev] of [["04-target_activated.json", "target_activated", { target_activation: { ...fake, path: ".guild/transfers/inbound/source-a/xfer-a/activated.json" }, target_ack: null }], ["05-acknowledged.json", "acknowledged", { target_activation: { ...fake, path: ".guild/transfers/inbound/source-a/xfer-a/activated.json" }, target_ack: fake }]] as const) {
      fs.writeFileSync(path.join(dir, f), JSON.stringify({ ...rec, ...ev, state: st }));
    }
    expect(code(() => transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state")))).toBe("journal_corrupt");
  });

  it("an ack counts only when this run's controller journal authorized it", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(runTransfer(req("xfer-a", rev), ports(targetA)).state).toBe("acknowledged");
    const otherRoot = path.join(tmp, "other");
    fs.mkdirSync(otherRoot);
    const other = openRunController({ privateDir: path.join(tmp, "other-state"), durableRoot: otherRoot, source_id: SRC, run_id: RUN, host_id: "host-b", now: () => clock });
    other.close();
    expect(code(() => transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "other-state")))).toBe("journal_corrupt");
    expect(transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state"))).toBeNull();
  });

  it("codex r1 F3: a symlinked disposition directory fails closed", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "reserved_record") throw new Error("crash"); })))).toBe("other:crash");
    const disp = path.join(sourceRoot, ".guild", "runs", RUN, "work", "logical_task", "task-1", "disposition");
    const empty = path.join(sourceRoot, "empty");
    fs.mkdirSync(empty);
    fs.renameSync(disp, path.join(tmp, "moved"));
    fs.symlinkSync(empty, disp);
    expect(code(() => transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state")))).toBe("storage_refused");
    expect(exec(targetA, "xfer-a")).toBe(false);
  });

  it("codex r1 F5: a malformed target activation does not advance reconciliation", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "source_commit") throw new Error("crash"); })))).toBe("other:crash");
    fs.writeFileSync(path.join(targetA, ".guild", "transfers", "inbound", SRC, "xfer-a", "activated.json"), "not JSON");
    expect(reconcileTransfer({ sourceRoot, targetRoot: targetA, source_id: SRC, run_id: RUN, operation_id: "xfer-a" })?.journal_state).toBe("source_committed");
    expect(exec(targetA, "xfer-a")).toBe(false);
    // Resume refuses to adopt the foreign activation: the target is in conflict, never committed.
    expect(runTransfer(req("xfer-a", rev), ports(targetA)).state).toBe("recovery_needed");
  });

  it("codex r2 F1: an unauthenticated closed tail does not hide an unacknowledged transfer", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "source_committed_record") throw new Error("crash"); })))).toBe("other:crash");
    const dir = path.join(sourceRoot, ".guild", "runs", RUN, "work", "logical_task", "task-1", "disposition");
    const prev = fs.readFileSync(path.join(dir, "000002.json"), "utf8");
    const forged = { schema_version: "guild.work_disposition.v1", source_id: SRC, run_id: RUN, work: WORK, seq: 3, prev_revision: hashOf(prev), state: "closed",
      operation_id: "close-forged", intent_hash: H("6"), destination_work: null, target_root_digest: null, prepared_sha256: null };
    fs.writeFileSync(path.join(dir, "000003.json"), `${canonicalJson(forged)}\n`);
    expect(code(() => transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state")))).toBe("journal_corrupt");
  });

  it("codex r3 F1: an unauthenticated release does not free the source", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "prepared_record") throw new Error("crash"); })))).toBe("other:crash");
    const dir = path.join(sourceRoot, ".guild", "runs", RUN, "work", "logical_task", "task-1", "disposition");
    const raw = fs.readFileSync(path.join(dir, "000001.json"), "utf8");
    const forged = { ...JSON.parse(raw), seq: 2, prev_revision: hashOf(raw), state: "released" };
    fs.writeFileSync(path.join(dir, "000002.json"), `${canonicalJson(forged)}\n`);
    expect(code(() => transferCloseBlocker(sourceRoot, RUN, WORK, path.join(tmp, "state")))).toBe("journal_corrupt");
    expect(code(() => runTransfer(req("xfer-b", hashOf(`${canonicalJson(forged)}\n`), dest("follow-b")), ports(targetB)))).toBe("journal_corrupt");
  });

  it("codex r3 F2: an unreadable target is reported recovery_needed, not committed", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    expect(code(() => runTransfer(req("xfer-a", rev), ports(targetA, (p) => { if (p === "source_committed_record") throw new Error("crash"); })))).toBe("other:crash");
    const inbound = path.join(targetA, ".guild", "transfers", "inbound", SRC, "xfer-a");
    fs.chmodSync(inbound, 0o000);
    try {
      const v = reconcileTransfer({ sourceRoot, targetRoot: targetA, source_id: SRC, run_id: RUN, operation_id: "xfer-a" });
      expect(v?.target_reachable).toBe(false);
      expect(v?.record?.state).toBe("recovery_needed");
    } finally {
      fs.chmodSync(inbound, 0o755);
    }
  });

  it("codex r2 F3: a reshaped activation is not executable", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    runTransfer(req("xfer-a", rev), ports(targetA));
    expect(exec(targetA, "xfer-a")).toBe(true);
    const f = path.join(targetA, ".guild", "transfers", "inbound", SRC, "xfer-a", "activated.json");
    const a = JSON.parse(fs.readFileSync(f, "utf8"));
    delete a.schema_version;
    fs.writeFileSync(f, `${canonicalJson(a)}\n`);
    expect(exec(targetA, "xfer-a")).toBe(false);
  });

  it("shareable bytes carry no absolute root path and no secret", () => {
    const rev = openWorkDisposition(sourceRoot, RUN, WORK);
    runTransfer(req("xfer-a", rev), ports(targetA));
    for (const root of [sourceRoot, targetA]) {
      for (const f of listFiles(root)) {
        const text = fs.readFileSync(path.join(root, f), "utf8");
        expect(text.includes(tmp)).toBe(false);
        expect(text.includes(grant.nonce)).toBe(false);
      }
    }
    expect(FOLLOWUP_TRANSFER_SCHEMA).toBe("guild.followup_transfer.v1");
  });
});
