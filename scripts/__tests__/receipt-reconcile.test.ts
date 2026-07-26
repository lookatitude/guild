/**
 * scripts/__tests__/receipt-reconcile.test.ts
 *
 * MH-06 — interruption reconciliation
 * (src/modules/telemetry/workflows/receipt-reconcile.ts).
 *
 * Pins the W1/MH-06 slice of the frozen W0 conformance contract:
 *
 *   MHRC-RCT-004  Reconciliation detects and classifies sequence gaps
 *   MHRC-RCT-005  Duplicate delivery is idempotent
 *
 * Contract dispositions are the closed vocabulary from
 * conformance-scenarios.v1.json: succeeded | refused | unsupported | failed | degraded.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";
import {
  appendReceipt,
  sealReceiptRecord,
  makeReceiptInput,
  readCheckpoint,
  readCheckpointState,
  scanReceiptJournal,
  compareCheckpointToJournal,
  journalLockPath,
  canonicalJournalPath,
  defaultJournalIo,
  RECEIPT_CONTRACT_VERSION,
  type JournalIo,
  type ReceiptAppendInput,
  type ReceiptRecordV1,
} from "../../src/modules/telemetry/workflows/receipt-journal";
import { reconcileReceiptJournal } from "../../src/modules/telemetry/workflows/receipt-reconcile";

const VERSIONS = {
  host_id: "codex-local",
  host_version: "0.47.0",
  runtime_version: "2.3.2",
  source_version: "a53bc4c478a0be9e9eed2e14b0cf8f10ec725d85",
  contract_version: "guild.runtime_boundary_contract.v1",
};

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function mkRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-receipt-reconcile-"));
  tmpDirs.push(d);
  return d;
}

function paths(root: string) {
  return {
    journal: path.join(root, "receipts", "journal.jsonl"),
    checkpoint: path.join(root, "receipts", "checkpoint.json"),
  };
}

function input(over: Partial<ReceiptAppendInput> = {}): ReceiptAppendInput {
  const operation_id = over.operation_id ?? "op-1";
  return makeReceiptInput({
    run_id: "run-mh-06",
    operation_id,
    // MHRC-RCT-001: one correlation id resolves to exactly ONE operation
    // lineage. Fixtures derive the correlation from the operation so a
    // multi-operation journal is not silently a split-lineage journal.
    correlation_id: `corr-${operation_id}`,
    event_id: "evt-1",
    causation_id: null,
    scenario_id: "MHRC-RCT-004",
    event_name: "receipt.append",
    outcome_type: "guild.receipt_outcome.v1",
    disposition: "succeeded",
    observation_state: "checked_clean",
    input_hash: "sha256:aaa",
    output_hash: "sha256:bbb",
    terminal: false,
    recorded_at: "2026-07-26T02:00:00.000Z",
    observed_at: "2026-07-26T02:00:00.000Z",
    versions: VERSIONS,
    ...over,
  });
}

/**
 * Write an explicit list of sealed records straight to the journal file AND the
 * checkpoint that a healthy writer would have left beside it.
 *
 * The checkpoint describes the DURABLE JOURNAL, not the post-recovery merged
 * view — that distinction is what makes a missing or stale checkpoint detectable
 * (MHRC-RCT-002 / CI-05). Pass `writeCheckpoint: false` to model the exact
 * aftermath of a failed atomic checkpoint replacement.
 */
function writeJournal(
  paths_: { journal: string; checkpoint: string },
  records: ReceiptRecordV1[],
  opts: { checkpoint?: boolean } = {},
): void {
  fs.mkdirSync(path.dirname(paths_.journal), { recursive: true });
  fs.writeFileSync(paths_.journal, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  if (opts.checkpoint === false || records.length === 0) return;
  const last = records[records.length - 1];
  fs.writeFileSync(
    paths_.checkpoint,
    JSON.stringify(
      {
        schema_version: "guild.receipt_checkpoint.v1",
        run_id: last.run_id,
        last_sequence: records.reduce((m, r) => Math.max(m, r.sequence), 0),
        last_event_id: last.event_id,
        record_count: records.length,
        updated_at: "2026-07-26T02:00:00.000Z",
        contract_version: RECEIPT_CONTRACT_VERSION,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function sealed(seq: number, over: Partial<ReceiptAppendInput> = {}): ReceiptRecordV1 {
  return sealReceiptRecord({ ...input(over), sequence: seq });
}

/** Overwrite the checkpoint file with a deliberately disagreeing shape. */
function writeCheckpointFile(
  paths_: { checkpoint: string },
  over: Partial<{
    run_id: string;
    last_sequence: number;
    last_event_id: string | null;
    record_count: number;
  }>,
): void {
  fs.mkdirSync(path.dirname(paths_.checkpoint), { recursive: true });
  fs.writeFileSync(
    paths_.checkpoint,
    JSON.stringify(
      {
        schema_version: "guild.receipt_checkpoint.v1",
        run_id: "run-mh-06",
        last_sequence: 0,
        last_event_id: null,
        record_count: 0,
        updated_at: "2026-07-26T02:00:00.000Z",
        contract_version: RECEIPT_CONTRACT_VERSION,
        ...over,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MHRC-RCT-004 — gaps
// ─────────────────────────────────────────────────────────────────────────────

describe("MHRC-RCT-004 — reconciliation detects and classifies sequence gaps", () => {
  it("reports every gap with explicit bounds and degrades the outcome", () => {
    const root = mkRoot();
    const p = paths(root);
    // Producer claims 8 records; journal holds 1,2, 5, 8 → gaps [3,4] and [6,7].
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(2, { event_id: "e2", operation_id: "op-2" }),
      sealed(5, { event_id: "e5", operation_id: "op-5" }),
      sealed(8, { event_id: "e8", operation_id: "op-8" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 8, record_count: 8 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.schema_version).toBe("guild.reconciliation_outcome.v1");
    expect(out.disposition).toBe("degraded");
    expect(out.gaps).toEqual([
      { from: 3, to: 4, recovered: false, observation_state: "not_observed" },
      { from: 6, to: 7, recovered: false, observation_state: "not_observed" },
    ]);
    expect(out.unresolved_sequences).toEqual([3, 4, 6, 7]);
    expect(out.recovered_sequences).toEqual([]);
    expect(out.blocks_clean_close).toBe(true);
  });

  it("binds the before and after checkpoints to the verdict", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1", operation_id: "op-1" }));
    const before = readCheckpoint(p.checkpoint);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 3, record_count: 3 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.checkpoint_before).toEqual(before);
    expect(out.checkpoint_before_state).toBe("present");
    expect(out.checkpoint_after).not.toBeNull();
    expect(out.checkpoint_after!.last_sequence).toBe(1);
    // A checkpoint's `updated_at` is the `recorded_at` of the record it NAMES —
    // that is what appendReceipt writes, and it is the clock-free staleness
    // test. Stamping the proposal with `reconciled_at` instead would make every
    // repaired checkpoint fail its own agreement test the moment it landed.
    expect(out.checkpoint_after!.updated_at).toBe("2026-07-26T02:00:00.000Z");
    expect(out.gaps).toEqual([{ from: 2, to: 3, recovered: false, observation_state: "not_observed" }]);
  });

  it("marks a gap recovered when recovered entries preserve identity and order", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(4, { event_id: "e4", operation_id: "op-4" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 4, record_count: 4 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      recovered: [
        sealed(2, { event_id: "e2", operation_id: "op-2" }),
        sealed(3, { event_id: "e3", operation_id: "op-3" }),
      ],
    });

    expect(out.disposition).toBe("degraded");
    expect(out.recovered_sequences).toEqual([2, 3]);
    expect(out.unresolved_sequences).toEqual([]);
    expect(out.gaps).toEqual([{ from: 2, to: 3, recovered: true, observation_state: "checked_clean" }]);
    expect(out.blocks_clean_close).toBe(false);
    // Recovered entries keep their ORIGINAL identity and land in sequence order.
    expect(out.reconciled_order).toEqual([
      { sequence: 1, event_id: "e1" },
      { sequence: 2, event_id: "e2" },
      { sequence: 3, event_id: "e3" },
      { sequence: 4, event_id: "e4" },
    ]);
  });

  it("rejects a recovered entry that does not fill a declared gap", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      recovered: [sealed(9, { event_id: "e9", operation_id: "op-9" })],
    });

    expect(out.disposition).toBe("failed");
    expect(out.rejected_recoveries).toEqual([
      { sequence: 9, event_id: "e9", reason: "outside_declared_gap" },
    ]);
    expect(out.blocks_clean_close).toBe(true);
  });

  it("rejects a recovered entry whose record hash does not verify", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);
    const forged = { ...sealed(2, { event_id: "e2", operation_id: "op-2" }), input_hash: "sha256:FORGED" };

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      recovered: [forged],
    });

    expect(out.disposition).toBe("failed");
    expect(out.rejected_recoveries).toEqual([
      { sequence: 2, event_id: "e2", reason: "hash_mismatch" },
    ]);
    expect(out.blocks_clean_close).toBe(true);
  });

  it("succeeds cleanly when journal and producer checkpoint already agree", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1", operation_id: "op-1" }));
    appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.disposition).toBe("succeeded");
    expect(out.gaps).toEqual([]);
    expect(out.blocks_clean_close).toBe(false);
  });

  it("BR-07: an absent journal reconciles to not_observed, never to a clean close", () => {
    const root = mkRoot();
    const p = paths(root);
    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 3, record_count: 3 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.disposition).toBe("degraded");
    expect(out.journal_observation_state).toBe("not_observed");
    expect(out.gaps).toEqual([{ from: 1, to: 3, recovered: false, observation_state: "not_observed" }]);
    expect(out.blocks_clean_close).toBe(true);
  });

  it("BR-07: never reports succeeded when the journal recorded a failed observation", () => {
    // The sequence arithmetic balances perfectly (2 expected, 2 durable) — but
    // one observation failed, so reconciliation must not call that success.
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(2, {
        event_id: "e2",
        operation_id: "op-2",
        observation_state: "observation_failed",
        disposition: "failed",
      }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.gaps).toEqual([]); // nothing missing…
    expect(out.disposition).toBe("degraded"); // …but still not success
    expect(out.journal_observation_state).toBe("observation_failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("BR-07: an empty journal with nothing expected still refuses to report success", () => {
    const root = mkRoot();
    const p = paths(root);
    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 0, record_count: 0 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.gaps).toEqual([]);
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });

  // ── MH-06-R1-B1 ───────────────────────────────────────────────────────────
  it("MH-06-R1-B1: never reconciles a failed checkpoint replacement into clean success", () => {
    const root = mkRoot();
    const p = paths(root);
    const io: JournalIo = {
      ...defaultJournalIo,
      writeCheckpoint() {
        throw new Error("ENOSPC: simulated checkpoint failure");
      },
    };

    // The append lands the line but cannot replace the checkpoint → failed.
    const appended = appendReceipt(p, input({ event_id: "e1" }), io);
    expect(appended.disposition).toBe("failed");
    expect(appended.durable).toBe(false);
    expect(appended.failure?.code).toBe("checkpoint_write_failed");
    expect(readCheckpoint(p.checkpoint)).toBeNull();

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 0, record_count: 0 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    // The checkpoint is STILL absent — reconciliation may not launder that
    // failed durable boundary into a clean success (MHRC-RCT-002 / CI-05).
    expect(out.checkpoint_before).toBeNull();
    expect(readCheckpoint(p.checkpoint)).toBeNull();
    expect(out.disposition).not.toBe("succeeded");
    expect(out.blocks_clean_close).toBe(true);
  });

  // ── MH-06-R1-B2 ───────────────────────────────────────────────────────────
  it("MH-06-R1-B2: rejects a hash-valid recovery from a foreign run with a missing cause and a failed observation", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(3, { event_id: "e3", operation_id: "op-3" }),
    ]);

    // Independently sealed, so its record_hash verifies — hash validity alone
    // must NOT be enough to close a gap.
    const foreign = sealed(2, {
      event_id: "e2",
      operation_id: "op-2",
      run_id: "other-run",
      causation_id: "missing-cause",
      observation_state: "observation_failed",
      disposition: "failed",
    });

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 3, record_count: 3 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      recovered: [foreign],
    });

    expect(out.rejected_recoveries.length).toBeGreaterThan(0);
    expect(out.recovered_sequences).toEqual([]);
    expect(out.unresolved_sequences).toEqual([2]);
    expect(out.gaps.every((g) => g.observation_state !== "checked_clean")).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("degrades and blocks clean close when the journal tail is truncated", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);
    fs.appendFileSync(p.journal, '{"schema_version":"guild.receipt_rec', "utf8");

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.journal_integrity).toBe("truncated_tail");
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MHRC-RCT-005 — duplicate delivery is idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe("MHRC-RCT-005 — duplicate delivery is idempotent", () => {
  it("keeps exactly one authoritative receipt and applies the effect once", () => {
    const root = mkRoot();
    const p = paths(root);
    // Same operation_id + identical payload hashes delivered twice.
    writeJournal(p, [
      sealed(1, { event_id: "d1", operation_id: "op-dup", input_hash: "sha256:x", output_hash: "sha256:y" }),
      sealed(2, { event_id: "d2", operation_id: "op-dup", input_hash: "sha256:x", output_hash: "sha256:y" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.disposition).toBe("succeeded");
    expect(out.duplicates).toEqual([
      {
        operation_id: "op-dup",
        event_ids: ["d1", "d2"],
        authoritative_event_id: "d1", // lowest sequence wins
        payload_hash: "sha256:x|sha256:y",
        effects_applied: 1,
      },
    ]);
    expect(out.conflicts).toEqual([]);
    expect(out.blocks_clean_close).toBe(false);
  });

  it("state transition count remains one no matter how many times it is delivered", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(
      p,
      [1, 2, 3, 4].map((s) =>
        sealed(s, {
          event_id: `d${s}`,
          operation_id: "op-dup",
          input_hash: "sha256:x",
          output_hash: "sha256:y",
        }),
      ),
    );

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 4, record_count: 4 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.disposition).toBe("succeeded");
    expect(out.duplicates[0].effects_applied).toBe(1);
    expect(out.duplicates[0].event_ids).toEqual(["d1", "d2", "d3", "d4"]);
    expect(out.authoritative_effect_count).toBe(1);
  });

  it("fails reconciliation when one operation id carries mismatched payload hashes", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "d1", operation_id: "op-dup", input_hash: "sha256:x", output_hash: "sha256:y" }),
      sealed(2, { event_id: "d2", operation_id: "op-dup", input_hash: "sha256:x", output_hash: "sha256:DIFFERENT" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.disposition).toBe("failed");
    expect(out.conflicts).toEqual([
      {
        operation_id: "op-dup",
        event_ids: ["d1", "d2"],
        payload_hashes: ["sha256:x|sha256:y", "sha256:x|sha256:DIFFERENT"],
        reason: "payload_hash_mismatch",
      },
    ]);
    expect(out.duplicates).toEqual([]);
    expect(out.blocks_clean_close).toBe(true);
  });

  it("distinct operation ids are never collapsed as duplicates", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "a1", operation_id: "op-A", input_hash: "sha256:x", output_hash: "sha256:y" }),
      sealed(2, { event_id: "b1", operation_id: "op-B", input_hash: "sha256:x", output_hash: "sha256:y" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.disposition).toBe("succeeded");
    expect(out.duplicates).toEqual([]);
    expect(out.authoritative_effect_count).toBe(2);
  });

  it("classifies duplicates and gaps together without losing either verdict", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "d1", operation_id: "op-dup", input_hash: "sha256:x", output_hash: "sha256:y" }),
      sealed(2, { event_id: "d2", operation_id: "op-dup", input_hash: "sha256:x", output_hash: "sha256:y" }),
      sealed(5, { event_id: "e5", operation_id: "op-5" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 5, record_count: 5 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.disposition).toBe("degraded"); // gap degrades even though dedup succeeded
    expect(out.gaps).toEqual([{ from: 3, to: 4, recovered: false, observation_state: "not_observed" }]);
    expect(out.duplicates[0].effects_applied).toBe(1);
    expect(out.blocks_clean_close).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MHRC-RCT-003/004 — recovery vetting against the MERGED lineage
//
// Hash validity alone is not admissibility. A recovery enters the merged view
// only after run identity, gap membership, causal order, and observation
// cleanliness all hold — and the merged view is then re-analysed as one journal.
// ─────────────────────────────────────────────────────────────────────────────

describe("recovery vetting — run identity, causal order, and cleanliness", () => {
  /** Journal holding sequences 1 and 3, so sequence 2 is the declared gap. */
  function gapAtTwo() {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(3, { event_id: "e3", operation_id: "op-3" }),
    ]);
    return p;
  }

  function reconcileWith(p: { journal: string; checkpoint: string }, recovered: ReceiptRecordV1[]) {
    return reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 3, record_count: 3 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      recovered,
    });
  }

  it("rejects a recovery sealed under a foreign run id", () => {
    const out = reconcileWith(gapAtTwo(), [
      sealed(2, { event_id: "e2", operation_id: "op-2", run_id: "other-run" }),
    ]);
    expect(out.rejected_recoveries).toEqual([{ sequence: 2, event_id: "e2", reason: "foreign_run" }]);
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
    // The foreign record never enters the merged lineage.
    expect(out.reconciled_order).toEqual([
      { sequence: 1, event_id: "e1" },
      { sequence: 3, event_id: "e3" },
    ]);
  });

  it("rejects a recovery whose cause is absent from the merged lineage", () => {
    const out = reconcileWith(gapAtTwo(), [
      sealed(2, { event_id: "e2", operation_id: "op-2", causation_id: "missing-cause" }),
    ]);
    expect(out.rejected_recoveries).toEqual([
      { sequence: 2, event_id: "e2", reason: "unknown_causation" },
    ]);
    expect(out.disposition).toBe("failed");
    expect(out.unresolved_sequences).toEqual([2]);
  });

  it("rejects a recovery whose cause does not precede it", () => {
    // e3 sits at sequence 3 — it cannot have caused sequence 2.
    const out = reconcileWith(gapAtTwo(), [
      sealed(2, { event_id: "e2", operation_id: "op-2", causation_id: "e3" }),
    ]);
    expect(out.rejected_recoveries).toEqual([
      { sequence: 2, event_id: "e2", reason: "cause_not_before_effect" },
    ]);
    expect(out.disposition).toBe("failed");
  });

  it("rejects a recovery that hash-verifies but is outside the closed vocabulary", () => {
    const bogus = sealReceiptRecord({
      ...input({ event_id: "e2", operation_id: "op-2", disposition: "vibes" as never }),
      sequence: 2,
    });
    const out = reconcileWith(gapAtTwo(), [bogus]);
    expect(out.rejected_recoveries).toEqual([{ sequence: 2, event_id: "e2", reason: "schema_invalid" }]);
    expect(out.disposition).toBe("failed");
  });

  it.each(["observation_failed", "not_observed"] as const)(
    "BR-07: an %s recovery cannot close a gap cleanly",
    (observation_state) => {
      const out = reconcileWith(gapAtTwo(), [
        sealed(2, { event_id: "e2", operation_id: "op-2", observation_state }),
      ]);
      expect(out.rejected_recoveries).toEqual([
        { sequence: 2, event_id: "e2", reason: "unclean_observation" },
      ]);
      expect(out.recovered_sequences).toEqual([]);
      expect(out.unresolved_sequences).toEqual([2]);
      expect(out.gaps).toEqual([{ from: 2, to: 2, recovered: false, observation_state: "not_observed" }]);
      expect(out.blocks_clean_close).toBe(true);
    },
  );

  it.each(["failed", "degraded"] as const)(
    "a %s recovery cannot close a gap cleanly",
    (disposition) => {
      const out = reconcileWith(gapAtTwo(), [
        sealed(2, { event_id: "e2", operation_id: "op-2", disposition }),
      ]);
      expect(out.rejected_recoveries).toEqual([
        { sequence: 2, event_id: "e2", reason: "unclean_disposition" },
      ]);
      expect(out.unresolved_sequences).toEqual([2]);
      expect(out.blocks_clean_close).toBe(true);
    },
  );

  it("rejects a recovery that reuses an event id already in the journal", () => {
    // Reusing an event id makes every causation_id pointing at it ambiguous.
    const out = reconcileWith(gapAtTwo(), [sealed(2, { event_id: "e1", operation_id: "op-2" })]);
    expect(out.rejected_recoveries).toEqual([
      { sequence: 2, event_id: "e1", reason: "duplicate_event_id" },
    ]);
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("re-analyses the MERGED lineage: an accepted recovery that splits a correlation fails closed", () => {
    // Individually admissible — right run, right gap, clean, causally fine —
    // but it drags a second operation under an existing correlation id.
    const out = reconcileWith(gapAtTwo(), [
      sealed(2, { event_id: "e2", operation_id: "op-2", correlation_id: "corr-op-1" }),
    ]);
    expect(out.rejected_recoveries).toEqual([]);
    expect(out.recovered_sequences).toEqual([2]);
    expect(out.merged_integrity).toBe("lineage_violation");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("merged_observation_state reports the merged view, not the original scan", () => {
    const p = gapAtTwo();
    const clean = reconcileWith(p, [sealed(2, { event_id: "e2", operation_id: "op-2" })]);
    expect(clean.merged_observation_state).toBe("checked_clean");
    expect(clean.recovered_sequences).toEqual([2]);
    expect(clean.gaps).toEqual([{ from: 2, to: 2, recovered: true, observation_state: "checked_clean" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MHRC-RCT-002 / CI-05 — checkpoint agreement and the explicit repair boundary
// ─────────────────────────────────────────────────────────────────────────────

describe("checkpoint agreement and the durable repair boundary", () => {
  /** The exact aftermath of a failed atomic checkpoint replacement. */
  function checkpointlessJournal() {
    const root = mkRoot();
    const p = paths(root);
    const io: JournalIo = {
      ...defaultJournalIo,
      writeCheckpoint() {
        throw new Error("ENOSPC: simulated checkpoint failure");
      },
    };
    const appended = appendReceipt(p, input({ event_id: "e1" }), io);
    expect(appended.failure?.code).toBe("checkpoint_write_failed");
    expect(readCheckpoint(p.checkpoint)).toBeNull();
    return p;
  }

  function reconcileCheckpointless(
    p: { journal: string; checkpoint: string },
    over: Record<string, unknown> = {},
  ) {
    return reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      // The producer re-derives its belief from the durable journal: 1 record.
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      ...over,
    });
  }

  it("names the missing checkpoint and refuses to close cleanly without a repair", () => {
    const p = checkpointlessJournal();
    const out = reconcileCheckpointless(p);

    expect(out.checkpoint_disagreements).toEqual([
      { code: "checkpoint_missing", expected: 1, actual: null },
    ]);
    expect(out.checkpoint_before_state).toBe("absent");
    expect(out.checkpoint_repair).toEqual({
      requested: false,
      attempted: false,
      persisted: false,
      verified: false,
      residual_disagreements: [],
      failure: null,
    });
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
    // Read-only by default: the proposal was NOT written.
    expect(readCheckpoint(p.checkpoint)).toBeNull();
  });

  it("an explicit, verified repair persists the checkpoint and only then closes cleanly", () => {
    const p = checkpointlessJournal();
    const out = reconcileCheckpointless(p, { repair_checkpoint: true });

    expect(out.checkpoint_repair).toEqual({
      requested: true,
      attempted: true,
      persisted: true,
      verified: true,
      // Verified means NOTHING still disagrees, re-derived from the re-read file.
      residual_disagreements: [],
      failure: null,
    });
    // Proven by re-reading the file, not by the write call returning.
    expect(readCheckpoint(p.checkpoint)).toEqual(out.checkpoint_after);
    expect(out.checkpoint_after.last_sequence).toBe(1);
    expect(out.checkpoint_after.record_count).toBe(1);
    expect(out.checkpoint_after.last_event_id).toBe("e1");
    expect(out.disposition).toBe("succeeded");
    expect(out.blocks_clean_close).toBe(false);
  });

  it("a repair that cannot be written fails closed and leaves no checkpoint behind", () => {
    const p = checkpointlessJournal();
    const out = reconcileCheckpointless(p, {
      repair_checkpoint: true,
      io: {
        ...defaultJournalIo,
        writeCheckpoint() {
          throw new Error("EROFS: read-only file system");
        },
      } as JournalIo,
    });

    expect(out.checkpoint_repair.attempted).toBe(true);
    expect(out.checkpoint_repair.persisted).toBe(false);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_write_failed");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
    expect(readCheckpoint(p.checkpoint)).toBeNull();
  });

  it("a repair whose write does not land verifiably fails closed", () => {
    const p = checkpointlessJournal();
    const out = reconcileCheckpointless(p, {
      repair_checkpoint: true,
      io: {
        ...defaultJournalIo,
        writeCheckpoint(checkpointPath: string) {
          // Writes something — but not what reconciliation computed.
          defaultJournalIo.writeCheckpoint(
            checkpointPath,
            JSON.stringify({
              schema_version: "guild.receipt_checkpoint.v1",
              run_id: "run-mh-06",
              last_sequence: 99,
              last_event_id: "not-e1",
              record_count: 99,
              updated_at: "2026-07-26T03:00:00.000Z",
              contract_version: RECEIPT_CONTRACT_VERSION,
            }) + "\n",
          );
        },
      } as JournalIo,
    });

    expect(out.checkpoint_repair.persisted).toBe(true);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_verify_failed");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("refuses to repair a checkpoint that would claim non-durable recovered records", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(4, { event_id: "e4", operation_id: "op-4" }),
    ]);
    const before = readCheckpoint(p.checkpoint);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 4, record_count: 4 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      recovered: [
        sealed(2, { event_id: "e2", operation_id: "op-2" }),
        sealed(3, { event_id: "e3", operation_id: "op-3" }),
      ],
      repair_checkpoint: true,
    });

    // The gap IS recovered in the merged view — but those records are not in the
    // journal, so persisting a checkpoint that counts them would be a lie.
    expect(out.recovered_sequences).toEqual([2, 3]);
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_not_permitted");
    expect(out.checkpoint_repair.failure?.message).toContain("not durable in the journal");
    expect(readCheckpoint(p.checkpoint)).toEqual(before); // untouched
  });

  it("refuses to repair over a damaged journal", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);
    fs.appendFileSync(p.journal, '{"schema_version":"guild.receipt_rec', "utf8");
    const before = readCheckpoint(p.checkpoint);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      repair_checkpoint: true,
    });

    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_not_permitted");
    expect(out.blocks_clean_close).toBe(true);
    expect(readCheckpoint(p.checkpoint)).toEqual(before);
  });

  it("detects a stale checkpoint that under-counts the durable journal", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(2, { event_id: "e2", operation_id: "op-2" }),
    ]);
    writeCheckpointFile(p, { last_sequence: 1, last_event_id: "e1", record_count: 1 });

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.checkpoint_disagreements).toEqual([
      { code: "checkpoint_sequence_mismatch", expected: 2, actual: 1 },
      { code: "checkpoint_count_mismatch", expected: 2, actual: 1 },
      { code: "checkpoint_event_mismatch", expected: "e2", actual: "e1" },
    ]);
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("detects a checkpoint belonging to a different run", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);
    writeCheckpointFile(p, { run_id: "other-run", last_sequence: 1, last_event_id: "e1", record_count: 1 });

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.checkpoint_disagreements).toEqual([
      { code: "checkpoint_run_mismatch", expected: "run-mh-06", actual: "other-run" },
    ]);
    expect(out.blocks_clean_close).toBe(true);
  });

  it("detects a producer checkpoint that disagrees with the merged view", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      // Producer believes it emitted one record at sequence 1 — but claims two.
      producerCheckpoint: { last_sequence: 1, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.checkpoint_disagreements).toEqual([
      { code: "producer_count_mismatch", expected: 1, actual: 2 },
    ]);
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R2-B2 — recovery vetting is SEQUENCE-order deterministic
//
// Round 2 vetted recoveries in caller array order against the frame accepted so
// far. For a journal holding {1,4} and the hash-valid set {2 caused by e1,
// 3 caused by e2}, `[e2,e3]` recovered both with no rejection while `[e3,e2]`
// rejected e3 as `unknown_causation` — the same evidence, two verdicts.
// MHRC-RCT-004 requires recovered entries to preserve original identity and
// ORDER, which is a property of the sequence, not of the caller's array.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R2-B2 — recovery verdicts do not depend on caller array order", () => {
  /** Journal holds sequences 1 and 4; 2 and 3 are the declared gap. */
  function gapJournal() {
    const p = paths(mkRoot());
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(4, { event_id: "e4", operation_id: "op-4", causation_id: "e3" }),
    ]);
    return p;
  }

  function reconcileWith(recovered: ReceiptRecordV1[]) {
    const p = gapJournal();
    return reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 4, record_count: 4 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      recovered,
    });
  }

  /** The order-sensitive slice of the verdict, as a comparable value. */
  function verdict(out: ReturnType<typeof reconcileReceiptJournal>) {
    return {
      disposition: out.disposition,
      recovered_sequences: out.recovered_sequences,
      unresolved_sequences: out.unresolved_sequences,
      rejected_recoveries: out.rejected_recoveries,
      gaps: out.gaps,
      reconciled_order: out.reconciled_order,
      merged_integrity: out.merged_integrity,
      merged_observation_state: out.merged_observation_state,
      blocks_clean_close: out.blocks_clean_close,
      checkpoint_after: out.checkpoint_after,
      authoritative_effect_count: out.authoritative_effect_count,
    };
  }

  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    const out: T[][] = [];
    items.forEach((item, i) => {
      for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) {
        out.push([item, ...rest]);
      }
    });
    return out;
  }

  const e2 = sealed(2, { event_id: "e2", operation_id: "op-2", causation_id: "e1" });
  const e3 = sealed(3, { event_id: "e3", operation_id: "op-3", causation_id: "e2" });

  it("gives the reviewer's exact [e2,e3] and [e3,e2] probes the SAME verdict", () => {
    const forward = reconcileWith([e2, e3]);
    const reverse = reconcileWith([e3, e2]);

    expect(verdict(reverse)).toEqual(verdict(forward));
    // …and that shared verdict admits both, because both are genuinely valid.
    expect(forward.rejected_recoveries).toEqual([]);
    expect(forward.recovered_sequences).toEqual([2, 3]);
    expect(forward.reconciled_order.map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
    // The gap is closed, but a side-channel recovery is never a clean close:
    // the records are still not durable in the journal.
    expect(forward.disposition).toBe("degraded");
    expect(forward.blocks_clean_close).toBe(true);
  });

  it("gives ALL SIX permutations of a three-record chain a byte-identical verdict", () => {
    const e2b = sealed(2, { event_id: "e2", operation_id: "op-2", causation_id: "e1" });
    const e3b = sealed(3, { event_id: "e3", operation_id: "op-3", causation_id: "e2" });
    const p = paths(mkRoot());
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(5, { event_id: "e5", operation_id: "op-5" }),
    ]);
    const e4b = sealed(4, { event_id: "e4", operation_id: "op-4", causation_id: "e3" });

    const verdicts = permutations([e2b, e3b, e4b]).map((order) =>
      JSON.stringify(
        verdict(
          reconcileReceiptJournal({
            journalPath: p.journal,
            checkpointPath: p.checkpoint,
            run_id: "run-mh-06",
            producerCheckpoint: { last_sequence: 5, record_count: 5 },
            reconciled_at: "2026-07-26T03:00:00.000Z",
            recovered: order,
          }),
        ),
      ),
    );

    expect(verdicts).toHaveLength(6);
    expect(new Set(verdicts).size).toBe(1);
    expect(JSON.parse(verdicts[0]).recovered_sequences).toEqual([2, 3, 4]);
  });

  it("drops a chain whose ROOT cause is unknown, in every order, not just one", () => {
    // e2's cause is not in the journal and not offered, so e2 is inadmissible —
    // and e3 depends on e2, so it must fall with it via the fixpoint.
    const orphan = sealed(2, { event_id: "e2", operation_id: "op-2", causation_id: "never-happened" });
    const dependent = sealed(3, { event_id: "e3", operation_id: "op-3", causation_id: "e2" });

    for (const order of [
      [orphan, dependent],
      [dependent, orphan],
    ]) {
      const out = reconcileWith(order);
      expect(out.rejected_recoveries).toEqual([
        { sequence: 2, event_id: "e2", reason: "unknown_causation" },
        { sequence: 3, event_id: "e3", reason: "unknown_causation" },
      ]);
      expect(out.recovered_sequences).toEqual([]);
      expect(out.unresolved_sequences).toEqual([2, 3]);
      expect(out.disposition).toBe("failed");
      expect(out.blocks_clean_close).toBe(true);
    }
  });

  it("resolves a sequence collision the same way whichever copy is offered first", () => {
    const a = sealed(2, { event_id: "e2a", operation_id: "op-2a" });
    const b = sealed(2, { event_id: "e2b", operation_id: "op-2b" });

    const first = reconcileWith([a, b]);
    const second = reconcileWith([b, a]);

    expect(verdict(second)).toEqual(verdict(first));
    // The total order is (sequence, event_id, record_hash), so "e2a" always wins.
    expect(first.rejected_recoveries).toEqual([
      { sequence: 2, event_id: "e2b", reason: "duplicate_sequence" },
    ]);
    expect(first.disposition).toBe("failed");
  });

  it("reports the DEEPEST defect when a recovery is both unclean and causally broken", () => {
    // Uncleanliness only degrades; a broken causal link hard-fails. A record
    // carrying both must be reported with the causal reason, in every order —
    // deterministic ordering must not quietly downgrade a hard failure.
    const both = sealed(2, {
      event_id: "e2",
      operation_id: "op-2",
      causation_id: "never-happened",
      observation_state: "observation_failed",
      disposition: "failed",
    });
    const uncleanOnly = sealed(3, {
      event_id: "e3",
      operation_id: "op-3",
      causation_id: "e1",
      observation_state: "observation_failed",
      disposition: "failed",
    });

    const out = reconcileWith([uncleanOnly, both]);
    expect(out.rejected_recoveries).toEqual([
      { sequence: 2, event_id: "e2", reason: "unknown_causation" },
      { sequence: 3, event_id: "e3", reason: "unclean_observation" },
    ]);
    // The causal defect makes the whole reconciliation fail, not merely degrade.
    expect(out.disposition).toBe("failed");
    expect(reconcileWith([both, uncleanOnly]).rejected_recoveries).toEqual(out.rejected_recoveries);
  });

  it("drops a dependent whose only cause is an UNCLEAN recovery, in every order", () => {
    // The unclean record never enters the merged view, so its dependent really
    // has no cause there — admitting it would be the round-1 defect again.
    const uncleanCause = sealed(2, {
      event_id: "e2",
      operation_id: "op-2",
      causation_id: "e1",
      observation_state: "observation_failed",
      disposition: "failed",
    });
    const dependent = sealed(3, { event_id: "e3", operation_id: "op-3", causation_id: "e2" });

    for (const order of [
      [uncleanCause, dependent],
      [dependent, uncleanCause],
    ]) {
      const out = reconcileWith(order);
      expect(out.rejected_recoveries).toEqual([
        { sequence: 2, event_id: "e2", reason: "unclean_observation" },
        { sequence: 3, event_id: "e3", reason: "unknown_causation" },
      ]);
      expect(out.recovered_sequences).toEqual([]);
      expect(out.disposition).toBe("failed");
      expect(out.blocks_clean_close).toBe(true);
    }
  });

  it("reports rejections in deterministic sequence order, not arrival order", () => {
    const foreignHigh = sealed(3, { event_id: "z-late", operation_id: "op-3", run_id: "OTHER" });
    const foreignLow = sealed(2, { event_id: "a-early", operation_id: "op-2", run_id: "OTHER" });

    expect(reconcileWith([foreignHigh, foreignLow]).rejected_recoveries).toEqual([
      { sequence: 2, event_id: "a-early", reason: "foreign_run" },
      { sequence: 3, event_id: "z-late", reason: "foreign_run" },
    ]);
    expect(reconcileWith([foreignLow, foreignHigh]).rejected_recoveries).toEqual([
      { sequence: 2, event_id: "a-early", reason: "foreign_run" },
      { sequence: 3, event_id: "z-late", reason: "foreign_run" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R2-B3 — stale, forged, malformed, or absent checkpoints fail closed
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R2-B3 — a checkpoint must actually describe the journal", () => {
  function oneRecordJournal() {
    const p = paths(mkRoot());
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);
    return p;
  }
  function reconcile(p: { journal: string; checkpoint: string }, over: Record<string, unknown> = {}) {
    return reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      ...over,
    });
  }

  it("refuses to reconcile cleanly over the reviewer's stale, forged checkpoint", () => {
    const p = oneRecordJournal();
    // run / sequence / count / event all AGREE. Only the timestamp and the
    // contract version are forged — and round 2 checked neither.
    fs.writeFileSync(
      p.checkpoint,
      JSON.stringify(
        {
          schema_version: "guild.receipt_checkpoint.v1",
          run_id: "run-mh-06",
          last_sequence: 1,
          last_event_id: "e1",
          record_count: 1,
          updated_at: "1900-01-01T00:00:00.000Z",
          contract_version: "forged.contract.v999",
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );

    const out = reconcile(p);
    expect(out.checkpoint_disagreements.map((d) => d.code)).toEqual([
      "checkpoint_contract_mismatch",
      "checkpoint_timestamp_mismatch",
    ]);
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("treats a malformed checkpoint as damage, distinguishable from absence", () => {
    const p = oneRecordJournal();
    fs.writeFileSync(p.checkpoint, "{ not json at all", "utf8");

    const out = reconcile(p);
    expect(out.checkpoint_before_state).toBe("malformed");
    expect(out.checkpoint_before).toBeNull();
    expect(out.checkpoint_disagreements.map((d) => d.code)).toEqual(["checkpoint_malformed"]);
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("a verified repair RESOLVES the exact disagreement — proven by reconciling again", () => {
    const p = oneRecordJournal();
    fs.rmSync(p.checkpoint, { force: true });

    const repaired = reconcile(p, { repair_checkpoint: true });
    expect(repaired.checkpoint_repair.verified).toBe(true);
    expect(repaired.checkpoint_repair.residual_disagreements).toEqual([]);
    expect(repaired.disposition).toBe("succeeded");

    // The convergence test: reconciling the repaired state finds NOTHING wrong.
    // A proposal stamped with `reconciled_at` would fail here forever.
    const again = reconcile(p, { reconciled_at: "2026-07-26T09:00:00.000Z" });
    expect(again.checkpoint_before_state).toBe("present");
    expect(again.checkpoint_disagreements).toEqual([]);
    expect(again.disposition).toBe("succeeded");
    expect(again.blocks_clean_close).toBe(false);
  });

  it("repairs a malformed checkpoint, and only then closes cleanly", () => {
    const p = oneRecordJournal();
    fs.writeFileSync(p.checkpoint, "", "utf8");

    expect(reconcile(p).blocks_clean_close).toBe(true);
    const repaired = reconcile(p, { repair_checkpoint: true });
    expect(repaired.checkpoint_repair.verified).toBe(true);
    expect(repaired.blocks_clean_close).toBe(false);
    expect(readCheckpointState(p.checkpoint).state).toBe("present");
  });

  it("REFUSES to stamp this run's id over another run's durable journal", () => {
    const p = paths(mkRoot());
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1", run_id: "OTHER-RUN" })]);

    const out = reconcile(p, { repair_checkpoint: true });
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_not_permitted");
    expect(out.checkpoint_repair.failure?.message).toContain("OTHER-RUN");
    expect(out.checkpoint_disagreements.map((d) => d.code)).toContain("merged_run_identity_mismatch");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("a repair whose write lands a STILL-DISAGREEING checkpoint fails closed", () => {
    const p = oneRecordJournal();
    fs.rmSync(p.checkpoint, { force: true });
    const io: JournalIo = {
      ...defaultJournalIo,
      writeCheckpoint(cpPath) {
        // Valid shape, wrong content: it does not describe the journal.
        defaultJournalIo.writeCheckpoint(
          cpPath,
          JSON.stringify(
            {
              schema_version: "guild.receipt_checkpoint.v1",
              run_id: "run-mh-06",
              last_sequence: 7,
              last_event_id: "e7",
              record_count: 7,
              updated_at: "2026-07-26T02:00:00.000Z",
              contract_version: RECEIPT_CONTRACT_VERSION,
            },
            null,
            2,
          ) + "\n",
        );
      },
    };

    const out = reconcile(p, { repair_checkpoint: true, io });
    expect(out.checkpoint_repair.persisted).toBe(true);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_verify_failed");
    expect(out.checkpoint_repair.residual_disagreements.map((d) => d.code)).toEqual([
      "checkpoint_sequence_mismatch",
      "checkpoint_count_mismatch",
      "checkpoint_event_mismatch",
    ]);
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("refuses a durable repair it cannot serialise against a live writer", () => {
    const p = oneRecordJournal();
    fs.rmSync(p.checkpoint, { force: true });
    fs.mkdirSync(`${p.journal}.lock`);

    const out = reconcile(p, { repair_checkpoint: true, lock_max_attempts: 2, lock_wait_ms: 1 });
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_lock_unavailable");
    expect(readCheckpointState(p.checkpoint).state).toBe("absent");
    expect(out.blocks_clean_close).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R2-B5 — one causal identity is never two clean authoritative effects
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R3-B2 — a repair is only as good as the exclusion it was built under
//
// Round 2 gave the durable repair the same cross-process lock the append uses.
// Round 3 showed the lock was taken TOO LATE: reconciliation scanned the journal,
// computed `checkpoint_after`, THEN locked, wrote, and verified the persisted file
// against its own pre-lock snapshot. In the reviewer's interleaving a separate
// writer committed sequence 2 in exactly that window and repair still returned
// `disposition: "succeeded", verified: true, residual_disagreements: [],
// blocks_clean_close: false` — after overwriting the checkpoint with sequence 1.
//
// So the lock now comes FIRST (before the scan that defines the proposal), and the
// verification re-scans the journal instead of trusting the snapshot.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R3-B2 — repair locks before it scans, and verifies against the current journal", () => {
  const TSX = path.join(__dirname, "..", "node_modules", ".bin", "tsx");
  const JOURNAL_MODULE = path.join(__dirname, "..", "..", "src", "modules", "telemetry", "workflows", "receipt-journal");

  /** A genuinely separate OS process that appends ONE record and exits. */
  function landRecordFromAnotherProcess(root: string, seq: number): Record<string, unknown> {
    const file = path.join(root, `writer-${seq}.ts`);
    fs.writeFileSync(
      file,
      `import * as path from "node:path";
import { appendReceipt, makeReceiptInput } from ${JSON.stringify(JOURNAL_MODULE)};
const root = process.argv[2];
const out = appendReceipt(
  { journal: path.join(root, "receipts", "journal.jsonl"), checkpoint: path.join(root, "receipts", "checkpoint.json") },
  makeReceiptInput({
    run_id: "run-mh-06",
    operation_id: "op-${seq}",
    correlation_id: "corr-op-${seq}",
    event_id: "e${seq}",
    scenario_id: "MHRC-RCT-002",
    event_name: "receipt.append",
    outcome_type: "guild.receipt_outcome.v1",
    disposition: "succeeded",
    observation_state: "checked_clean",
    input_hash: "sha256:aaa",
    output_hash: "sha256:bbb",
    terminal: false,
    recorded_at: "2026-07-26T02:00:00.000Z",
    observed_at: "2026-07-26T02:00:00.000Z",
    versions: ${JSON.stringify(VERSIONS)},
  }),
);
process.stdout.write(JSON.stringify({ disposition: out.disposition, durable: out.durable, sequence: out.sequence, failure: out.failure?.code ?? null }) + "\\n");
`,
      "utf8",
    );
    const res = spawnSync(TSX, [file, root], { encoding: "utf8" });
    const line = (res.stdout ?? "").trim().split("\n").pop() ?? "";
    if (!line.startsWith("{")) throw new Error(`interleaved writer produced no outcome: ${(res.stderr ?? "").slice(0, 400)}`);
    return JSON.parse(line) as Record<string, unknown>;
  }

  /** One durable record beside a deliberately damaged checkpoint. */
  function oneRecordDamagedCheckpoint() {
    const root = mkRoot();
    const p = paths(root);
    expect(appendReceipt(p, input({ event_id: "e1", operation_id: "op-1" })).disposition).toBe("succeeded");
    fs.writeFileSync(p.checkpoint, "{ not a checkpoint", "utf8");
    return { root, ...p };
  }

  function reconcileRepair(p: { journal: string; checkpoint: string }, over: Record<string, unknown> = {}) {
    return reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      repair_checkpoint: true,
      ...over,
    });
  }

  it("takes the lock BEFORE the first journal read and releases it last", () => {
    const p = oneRecordDamagedCheckpoint();
    const calls: string[] = [];
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        calls.push("acquire");
        return defaultJournalIo.acquireLock!(lockPath);
      },
      releaseLock(lockPath) {
        calls.push("release");
        defaultJournalIo.releaseLock!(lockPath);
      },
      readAll(target) {
        // Round 4: a repair scans the CANONICAL journal the lock names, so that
        // is the read this fake must recognise — a fake keyed on the caller's
        // spelling would stop firing and quietly stop testing anything.
        calls.push(target === canonicalJournalPath(p.journal) ? "scan" : "read-checkpoint");
        return defaultJournalIo.readAll(target);
      },
      writeCheckpoint(cpPath, content) {
        calls.push("write");
        defaultJournalIo.writeCheckpoint(cpPath, content);
      },
    };

    const out = reconcileRepair(p, { io });
    expect(out.checkpoint_repair.verified).toBe(true);
    // The scan that DEFINES the proposal is inside the lock, not before it.
    expect(calls[0]).toBe("acquire");
    expect(calls[calls.length - 1]).toBe("release");
    expect(calls.filter((c) => c === "acquire")).toHaveLength(1);
    expect(calls.filter((c) => c === "release")).toHaveLength(1);
    expect(calls.indexOf("scan")).toBeGreaterThan(calls.indexOf("acquire"));
    expect(calls.indexOf("write")).toBeGreaterThan(calls.indexOf("scan"));
    // …and the journal is re-scanned AFTER the write to verify the result.
    expect(calls.lastIndexOf("scan")).toBeGreaterThan(calls.indexOf("write"));
  });

  it("a read-only reconcile takes NO lock, so a wedged journal stays diagnosable", () => {
    const p = oneRecordDamagedCheckpoint();
    // A crashed writer's lock is still sitting there.
    fs.mkdirSync(journalLockPath({ journal: p.journal, checkpoint: p.checkpoint }));
    let locks = 0;
    const io: JournalIo = { ...defaultJournalIo, acquireLock() { locks += 1; return false; } };

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      io,
    });

    expect(locks).toBe(0);
    expect(out.checkpoint_before_state).toBe("malformed");
    expect(out.checkpoint_disagreements.map((d) => d.code)).toEqual(["checkpoint_malformed"]);
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("INCLUDES a writer that lands between the preflight read and the lock", () => {
    const p = oneRecordDamagedCheckpoint();
    let landed: Record<string, unknown> | null = null;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        // The reviewer's exact interleaving: sequence 2 commits from another
        // process in the window before repair holds the lock.
        if (landed === null) landed = landRecordFromAnotherProcess(p.root, 2);
        return defaultJournalIo.acquireLock!(lockPath);
      },
    };

    const out = reconcileRepair(p, { io });

    expect(landed).toEqual({ disposition: "succeeded", durable: true, sequence: 2, failure: null });
    // The scan under the lock SEES that record, so the producer's belief (1) no
    // longer describes the merged view and the repair is refused outright.
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.persisted).toBe(false);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_not_permitted");
    expect(out.disposition).not.toBe("succeeded");
    expect(out.blocks_clean_close).toBe(true);
    // …and nothing overwrote the durable boundary with the stale view.
    const scan = scanReceiptJournal(p.journal);
    expect(scan.record_count).toBe(2);
    expect(compareCheckpointToJournal(readCheckpointState(p.checkpoint), scan, "run-mh-06")).toEqual([]);
  }, 60_000);

  it("EXCLUDES a writer that arrives once repair holds the lock, and still converges", () => {
    const p = oneRecordDamagedCheckpoint();
    let landed: Record<string, unknown> | null = null;
    let reads = 0;
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(target) {
        const content = defaultJournalIo.readAll(target);
        // Fire after the FIRST journal read, which is now inside the lock — and
        // which reaches the seam as the canonical journal, not p.journal.
        if (target === canonicalJournalPath(p.journal) && ++reads === 1) {
          landed = landRecordFromAnotherProcess(p.root, 2);
        }
        return content;
      },
    };

    const out = reconcileRepair(p, { io });

    expect(landed).toEqual({
      disposition: "failed",
      durable: false,
      sequence: null,
      failure: "journal_lock_unavailable",
    });
    expect(out.checkpoint_repair.verified).toBe(true);
    expect(out.checkpoint_repair.residual_disagreements).toEqual([]);
    expect(out.disposition).toBe("succeeded");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
  }, 120_000);

  it("fails closed when the journal moves under a lock that LIES about holding it", () => {
    const p = oneRecordDamagedCheckpoint();
    let landed: Record<string, unknown> | null = null;
    const io: JournalIo = {
      ...defaultJournalIo,
      // A primitive that reports exclusive access it never took.
      acquireLock() {
        return true;
      },
      releaseLock() {
        /* nothing was taken */
      },
      writeCheckpoint(cpPath, content) {
        if (landed === null) landed = landRecordFromAnotherProcess(p.root, 2);
        defaultJournalIo.writeCheckpoint(cpPath, content);
      },
    };

    const out = reconcileRepair(p, { io });

    // The write landed exactly what reconciliation computed…
    expect(out.checkpoint_repair.persisted).toBe(true);
    expect(landed).toMatchObject({ disposition: "succeeded", sequence: 2 });
    // …and is still refused, because the CURRENT journal no longer matches it.
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_verify_failed");
    // Sequence, count and named event all disagree. `updated_at` does NOT: both
    // fixture records carry the same `recorded_at`, which is exactly why staleness
    // must be checked on the identity of the record named, not on a timestamp
    // alone.
    expect(out.checkpoint_repair.residual_disagreements.map((d) => d.code)).toEqual([
      "checkpoint_sequence_mismatch",
      "checkpoint_count_mismatch",
      "checkpoint_event_mismatch",
    ]);
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  }, 60_000);

  it("reports the lock failure AHEAD of any refusal derived from an unfrozen snapshot", () => {
    // A journal with unresolved gaps AND a held lock. Round 2's order reported
    // `repair_not_permitted` from a snapshot it could not freeze; without
    // exclusive access there is no trustworthy snapshot to judge at all.
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" }), sealed(4, { event_id: "e4", operation_id: "op-4" })]);
    fs.mkdirSync(journalLockPath(p));

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 4, record_count: 4 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      repair_checkpoint: true,
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_lock_unavailable");
    // The read-only verdict is still produced, and still honest.
    expect(out.unresolved_sequences).toEqual([2, 3]);
    // Round 3 pinned `degraded` here, derived from the gaps alone. Round 4 found
    // that reading let a lock-denied repair over a CLEAN journal reach
    // `succeeded`, so the denial itself is now the failure: the caller asked for
    // a durable mutation and did not get one. The ordering this test exists for —
    // the lock failure ahead of `repair_not_permitted` — is unchanged.
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("fails closed when the lock primitive itself raises an IO fault", () => {
    const p = oneRecordDamagedCheckpoint();
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock() {
        throw new Error("EROFS: cannot create lock");
      },
    };
    const out = reconcileRepair(p, { io });
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_lock_failed");
    expect(readCheckpointState(p.checkpoint).state).toBe("malformed");
  });

  it("releases the lock after a repair, so the next writer is not wedged", () => {
    const p = oneRecordDamagedCheckpoint();
    expect(reconcileRepair(p).checkpoint_repair.verified).toBe(true);
    expect(fs.existsSync(journalLockPath({ journal: p.journal, checkpoint: p.checkpoint }))).toBe(false);
    const next = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), defaultJournalIo, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });
    expect(next.disposition).toBe("succeeded");
    expect(next.sequence).toBe(2);
  });

  it("releases the lock even when the repair write throws", () => {
    const p = oneRecordDamagedCheckpoint();
    const io: JournalIo = {
      ...defaultJournalIo,
      writeCheckpoint() {
        throw new Error("EROFS: read-only file system");
      },
    };
    const out = reconcileRepair(p, { io });
    expect(out.checkpoint_repair.failure?.code).toBe("repair_write_failed");
    expect(fs.existsSync(journalLockPath({ journal: p.journal, checkpoint: p.checkpoint }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R4-B2 — a requested repair that cannot lock is a BLOCKING outcome
//
// Round 3 put the repair under the canonical journal lock and reported
// `repair_lock_unavailable` ahead of every snapshot-derived refusal. Round 4
// found the verdict never listened: `repairFailed` was `attempted && !verified`,
// and a repair denied the lock is never attempted. So a clean journal beside an
// agreeing checkpoint returned `disposition: "succeeded"`,
// `blocks_clean_close: false`, `checkpoint_disagreements: []` — the exact clean
// shape the packet forbids — while also reporting `repair_lock_unavailable`.
//
// Two things are wrong with that and only one of them is the unfrozen snapshot:
// the caller asked for a durable mutation and did not get it. Denied exclusive
// access now fails closed exactly as `appendReceipt` already does for
// `journal_lock_unavailable`.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R4-B2 — a lock-denied repair can never report clean success", () => {
  const DENY: JournalIo = { ...defaultJournalIo, acquireLock: () => false };
  const FAULT: JournalIo = {
    ...defaultJournalIo,
    acquireLock() {
      throw new Error("EROFS: cannot create lock");
    },
  };

  /** One durable record beside the checkpoint a healthy writer left. */
  function clean() {
    const root = mkRoot();
    const p = paths(root);
    expect(appendReceipt(p, input({ event_id: "e1", operation_id: "op-1" })).disposition).toBe("succeeded");
    return { root, ...p };
  }

  function repair(p: { journal: string; checkpoint: string }, over: Record<string, unknown> = {}) {
    return reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      repair_checkpoint: true,
      lock_max_attempts: 1,
      lock_wait_ms: 1,
      ...over,
    });
  }

  it("refuses the reviewer's exact probe: clean journal, clean checkpoint, no lock", () => {
    const p = clean();
    const out = repair(p, { io: DENY });

    // Everything the reviewer observed about the repair is unchanged…
    expect(out.checkpoint_repair.requested).toBe(true);
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.persisted).toBe(false);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_lock_unavailable");
    // …and the outcome is no longer the clean shape it forbids.
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("treats a lock IO fault the same way", () => {
    const p = clean();
    const out = repair(p, { io: FAULT });
    expect(out.checkpoint_repair.failure?.code).toBe("repair_lock_failed");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("blocks against a REAL competing lock holder through the default IO seam", () => {
    // No injected seam at all: another writer's lock directory is simply there.
    const p = clean();
    const lock = journalLockPath({ journal: p.journal, checkpoint: p.checkpoint });
    fs.mkdirSync(lock, { recursive: true });
    const out = repair(p);
    fs.rmdirSync(lock);

    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_lock_unavailable");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("blocks whatever the unlocked snapshot happens to look like", () => {
    // Clean, malformed-checkpoint, absent, and torn-tail journals all reach the
    // same verdict, because the verdict is about the DENIAL, not the snapshot.
    const cases: Array<[string, { journal: string; checkpoint: string }, Record<string, unknown>]> = [];

    cases.push(["clean", clean(), {}]);

    const dirty = clean();
    fs.writeFileSync(dirty.checkpoint, "{ not a checkpoint", "utf8");
    cases.push(["malformed checkpoint", dirty, {}]);

    const torn = clean();
    fs.appendFileSync(torn.journal, '{"schema_version":"guild.receipt_record.v1","seq', "utf8");
    cases.push(["torn tail", torn, {}]);

    const absent = paths(mkRoot());
    cases.push(["absent journal", absent, { producerCheckpoint: { last_sequence: 0, record_count: 0 } }]);

    for (const [label, p, over] of cases) {
      const out = repair(p, { io: DENY, ...over });
      expect(`${label}: ${out.checkpoint_repair.failure?.code}`).toBe(`${label}: repair_lock_unavailable`);
      expect(`${label}: ${out.disposition}`).toBe(`${label}: failed`);
      expect(`${label}: ${out.blocks_clean_close}`).toBe(`${label}: true`);
      expect(`${label}: ${out.checkpoint_repair.attempted}`).toBe(`${label}: false`);
    }
  });

  it("refuses a repair on a journal with more than one name, before it locks", () => {
    const p = clean();
    const alias = path.join(path.dirname(p.journal), "alias.jsonl");
    fs.linkSync(p.journal, alias);
    let locks = 0;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        locks += 1;
        return defaultJournalIo.acquireLock!(lockPath);
      },
    };

    const out = repair(p, { io });
    expect(locks).toBe(0);
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_identity_ambiguous");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("still lets a repair that DOES take the lock converge and report clean", () => {
    // The discriminator. If this went blocking too, the rule above would just be
    // "reconciliation never succeeds", which pins nothing.
    const p = clean();
    fs.writeFileSync(p.checkpoint, "{ not a checkpoint", "utf8");
    const out = repair(p);

    expect(out.checkpoint_repair.attempted).toBe(true);
    expect(out.checkpoint_repair.verified).toBe(true);
    expect(out.checkpoint_repair.residual_disagreements).toEqual([]);
    expect(out.disposition).toBe("succeeded");
    expect(out.blocks_clean_close).toBe(false);
  });

  it("leaves a READ-ONLY reconcile of the same journal clean, and lock-free", () => {
    // The repair flag is what makes the denial blocking. Diagnosis must stay
    // available on a journal wedged by a crashed writer's stale lock.
    const p = clean();
    fs.mkdirSync(journalLockPath({ journal: p.journal, checkpoint: p.checkpoint }), { recursive: true });
    let locks = 0;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock() {
        locks += 1;
        return false;
      },
    };

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      io,
    });

    expect(locks).toBe(0);
    expect(out.checkpoint_repair.requested).toBe(false);
    expect(out.checkpoint_repair.failure).toBeNull();
    expect(out.disposition).toBe("succeeded");
    expect(out.blocks_clean_close).toBe(false);
  });

  it("keeps `repair_not_permitted` driven by its OWN blockers, not by the denial rule", () => {
    // A permitted-but-refused repair holds the lock, enumerates real blockers and
    // degrades on them. Widening the denial rule to cover it would erase that
    // distinction; this pins that it did not happen.
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" }), sealed(4, { event_id: "e4", operation_id: "op-4" })]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 4, record_count: 4 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      repair_checkpoint: true,
    });

    expect(out.checkpoint_repair.failure?.code).toBe("repair_not_permitted");
    expect(out.unresolved_sequences).toEqual([2, 3]);
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("releases the lock after a denial-free repair, so the next writer is not wedged", () => {
    const p = clean();
    fs.writeFileSync(p.checkpoint, "{ not a checkpoint", "utf8");
    expect(repair(p).checkpoint_repair.verified).toBe(true);
    expect(fs.existsSync(journalLockPath({ journal: p.journal, checkpoint: p.checkpoint }))).toBe(false);
  });
});

describe("MH-06-R2-B5 — duplicate event ids fail reconciliation", () => {
  it("refuses the reviewer's two-record journal reusing one event id", () => {
    const p = paths(mkRoot());
    writeJournal(p, [
      sealed(1, { event_id: "event-shared", operation_id: "op-A", input_hash: "sha256:one" }),
      sealed(2, { event_id: "event-shared", operation_id: "op-B", input_hash: "sha256:two" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.event_identity_conflicts).toEqual([
      { event_id: "event-shared", sequences: [1, 2], operation_ids: ["op-A", "op-B"] },
    ]);
    expect(out.checkpoint_disagreements.map((d) => d.code)).toContain("merged_event_identity_conflict");
    expect(out.merged_integrity).toBe("lineage_violation");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
    // The raw operation count is still 2, which is exactly why it must not be
    // read as two CLEAN effects — the verdict, not the count, carries the truth.
    expect(out.authoritative_effect_count).toBe(2);
  });

  it("keeps genuine duplicate DELIVERY (same operation, same payload) idempotent", () => {
    // MHRC-RCT-005's shape is unchanged: one operation, one payload, two event
    // ids. That is a duplicate, not an identity conflict.
    const p = paths(mkRoot());
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(2, { event_id: "e1-redelivered", operation_id: "op-1" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 2, record_count: 2 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
    });

    expect(out.event_identity_conflicts).toEqual([]);
    expect(out.duplicates).toHaveLength(1);
    expect(out.duplicates[0].effects_applied).toBe(1);
    expect(out.disposition).toBe("succeeded");
  });

  it("refuses a recovery that would introduce the conflict from a side channel", () => {
    const p = paths(mkRoot());
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(3, { event_id: "e3", operation_id: "op-3" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 3, record_count: 3 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      recovered: [sealed(2, { event_id: "e1", operation_id: "op-2" })],
    });

    expect(out.rejected_recoveries).toEqual([{ sequence: 2, event_id: "e1", reason: "duplicate_event_id" }]);
    expect(out.event_identity_conflicts).toEqual([]);
    expect(out.disposition).toBe("failed");
    expect(out.unresolved_sequences).toEqual([2]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R5-B2 — a repair that LOSES canonical authority is not a clean repair
//
// Round 4 made an explicitly DENIED repair blocking. Round 5's review then found
// the other half: a repair that successfully acquired the canonical lock and
// then lost that authority never became a denial at all. A hard link added after
// the sole under-lock identity check, and a canonical-parent replacement that
// carried the acquired lock away, both produced
// `attempted: true, persisted: true, verified: true, disposition: "succeeded",
// blocks_clean_close: false, residual_disagreements: []` — while a competing lock
// in the replacement location was still held, and the `finally` deleted THAT
// writer's lock.
//
// Verifying that the journal and the checkpoint agree at the replacement path is
// not proof of retained exclusion. Authority must be re-proved before the
// checkpoint is written and again before `verified` may be set.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R5-B2 — checkpoint repair cannot report clean after losing authority", () => {
  /** One durable record beside a checkpoint damaged enough to REQUIRE repair. */
  function damaged() {
    const root = mkRoot();
    const p = paths(root);
    expect(appendReceipt(p, input({ event_id: "e1", operation_id: "op-1" })).disposition).toBe("succeeded");
    fs.writeFileSync(p.checkpoint, "{ not a checkpoint", "utf8");
    return { root, ...p };
  }

  function repair(p: { journal: string; checkpoint: string }, over: Record<string, unknown> = {}) {
    return reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      repair_checkpoint: true,
      lock_max_attempts: 2,
      lock_wait_ms: 1,
      ...over,
    });
  }

  /** Fire `inject` exactly once, on the first read of the journal itself. */
  function onFirstJournalRead(inject: () => void): { io: JournalIo; fired: () => boolean } {
    let fired = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(target) {
        const content = defaultJournalIo.readAll(target);
        if (!fired && path.basename(target) === "journal.jsonl") {
          fired = true;
          inject();
        }
        return content;
      },
    };
    return { io, fired: () => fired };
  }

  /** Rename the canonical parent away (the acquired lock goes with it) and
   * install a replacement holding a copy of everything plus its own held lock. */
  function replaceCanonicalParent(p: { journal: string; checkpoint: string }) {
    const parent = path.dirname(fs.realpathSync(p.journal));
    const moved = `${parent}-moved`;
    const journalBytes = fs.readFileSync(p.journal);
    const checkpointBytes = fs.existsSync(p.checkpoint) ? fs.readFileSync(p.checkpoint) : null;

    fs.renameSync(parent, moved);
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(path.join(parent, path.basename(p.journal)), journalBytes);
    if (checkpointBytes) fs.writeFileSync(path.join(parent, path.basename(p.checkpoint)), checkpointBytes);
    const replacementLock = `${path.join(parent, path.basename(p.journal))}.lock`;
    fs.mkdirSync(replacementLock);
    return { moved, replacementLock, strandedLock: `${path.join(moved, path.basename(p.journal))}.lock` };
  }

  it("refuses when a hard link appears AFTER the under-lock identity check", () => {
    const p = damaged();
    const alias = path.join(path.dirname(p.journal), "alias.jsonl");
    const aliasLock = `${alias}.lock`;
    const { io, fired } = onFirstJournalRead(() => {
      fs.linkSync(p.journal, alias);
      fs.mkdirSync(aliasLock);
    });

    const out = repair(p, { io });

    expect(fired()).toBe(true);
    expect(fs.statSync(p.journal).nlink).toBe(2);
    expect(out.checkpoint_repair.requested).toBe(true);
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.persisted).toBe(false);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_identity_ambiguous");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
    // The checkpoint was never written under a partitioned exclusion domain…
    expect(readCheckpointState(p.checkpoint).state).toBe("malformed");
    // …and the other name's writer still holds its lock.
    expect(fs.existsSync(aliasLock)).toBe(true);
    expect(fs.existsSync(`${fs.realpathSync(p.journal)}.lock`)).toBe(false);
  });

  it("refuses when the canonical PARENT is replaced after the identity check", () => {
    const p = damaged();
    let swap: ReturnType<typeof replaceCanonicalParent> | null = null;
    const { io, fired } = onFirstJournalRead(() => {
      swap = replaceCanonicalParent(p);
    });

    const out = repair(p, { io });
    const moved = swap as unknown as ReturnType<typeof replaceCanonicalParent>;

    expect(fired()).toBe(true);
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.persisted).toBe(false);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_identity_unstable");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
    // The replacement's checkpoint is untouched, and its writer keeps its lock.
    expect(readCheckpointState(p.checkpoint).state).toBe("malformed");
    expect(fs.existsSync(moved.replacementLock)).toBe(true);
    // The lock this caller acquired travelled with the renamed parent; it is
    // left there rather than a stranger's lock being deleted in its place.
    expect(fs.existsSync(moved.strandedLock)).toBe(true);
  });

  it("refuses when the lock directory itself is replaced under the repair", () => {
    const p = damaged();
    const lock = journalLockPath({ journal: p.journal, checkpoint: p.checkpoint });
    const { io, fired } = onFirstJournalRead(() => {
      fs.rmdirSync(lock);
      fs.mkdirSync(lock); // same name, a different writer's exclusion
    });

    const out = repair(p, { io });

    expect(fired()).toBe(true);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_identity_unstable");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
    expect(readCheckpointState(p.checkpoint).state).toBe("malformed");
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmdirSync(lock);
  });

  it("still converges and reports clean when authority is RETAINED", () => {
    // The discriminator: without it, "never repair" would satisfy every
    // assertion above.
    const p = damaged();
    const out = repair(p);

    expect(out.checkpoint_repair.attempted).toBe(true);
    expect(out.checkpoint_repair.persisted).toBe(true);
    expect(out.checkpoint_repair.verified).toBe(true);
    expect(out.checkpoint_repair.residual_disagreements).toEqual([]);
    expect(out.disposition).toBe("succeeded");
    expect(out.blocks_clean_close).toBe(false);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    expect(fs.existsSync(journalLockPath({ journal: p.journal, checkpoint: p.checkpoint }))).toBe(false);
  });

  it("keeps `repair_not_permitted` distinct from a loss of authority", () => {
    // A repair that HOLDS its authority the whole way and is refused on its own
    // enumerated blockers still degrades, and still says exactly that. Collapsing
    // the two would turn the new rule into "reconciliation never succeeds".
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p, [
      sealed(1, { event_id: "e1", operation_id: "op-1" }),
      sealed(4, { event_id: "e4", operation_id: "op-4" }),
    ]);

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 4, record_count: 4 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      repair_checkpoint: true,
    });

    expect(out.checkpoint_repair.failure?.code).toBe("repair_not_permitted");
    expect(out.unresolved_sequences).toEqual([2, 3]);
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("leaves a READ-ONLY reconcile of a multi-named journal diagnosable", () => {
    // Reads make no durable claim, so they still take no lock and apply no
    // identity gate — a hard-linked or wedged journal must stay diagnosable.
    const p = damaged();
    fs.linkSync(p.journal, path.join(path.dirname(p.journal), "alias.jsonl"));
    let locks = 0;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        locks += 1;
        return defaultJournalIo.acquireLock!(lockPath);
      },
    };

    const out = reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      io,
    });

    expect(locks).toBe(0);
    expect(out.checkpoint_repair.requested).toBe(false);
    expect(out.journal_integrity).toBe("intact");
    expect(out.checkpoint_before_state).toBe("malformed");
    expect(out.checkpoint_disagreements.map((d) => d.code)).toEqual(["checkpoint_malformed"]);
    expect(out.disposition).toBe("degraded");
    expect(out.blocks_clean_close).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R6-B3 — the checkpoint this repair mutates is held, wherever it lives
//
// Round 6 pinned `dirname(identity.path)` — the JOURNAL's parent — and wrote the
// checkpoint by pathname. Round 6's review replaced a checkpoint parent that sits
// somewhere else entirely, left every journal-side check satisfiable, and got
// `attempted: true`, `persisted: true`, `verified: true`, `succeeded` and
// `blocks_clean_close: false` for a checkpoint written into a directory the
// repair never held.
//
// A repair is a mutation of the checkpoint FILE, so the exclusion domain has to
// cover the checkpoint's own parent whenever that differs from the journal's —
// before the write, and again before `verified` may be set.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R6-B3 — a checkpoint outside the journal's directory is held too", () => {
  /** Journal and checkpoint in DIFFERENT directories — the uncovered layout. */
  function splitPaths(root: string) {
    const p = {
      journal: path.join(root, "receipts", "journal.jsonl"),
      checkpoint: path.join(root, "state", "checkpoint.json"),
    };
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.mkdirSync(path.dirname(p.checkpoint), { recursive: true });
    return p;
  }

  /** One durable record and NO checkpoint — a disagreement a repair may fix. */
  function repairable() {
    const p = splitPaths(mkRoot());
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);
    fs.rmSync(p.checkpoint, { force: true });
    return p;
  }

  /** Swap the checkpoint's own parent for a different directory object. */
  function replaceCheckpointParent(p: { checkpoint: string }) {
    const parent = fs.realpathSync(path.dirname(p.checkpoint));
    const moved = `${parent}-moved`;
    fs.renameSync(parent, moved);
    fs.mkdirSync(parent, { recursive: true });
    return { parent, moved };
  }

  function repair(p: { journal: string; checkpoint: string }, over: Record<string, unknown> = {}) {
    return reconcileReceiptJournal({
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      run_id: "run-mh-06",
      producerCheckpoint: { last_sequence: 1, record_count: 1 },
      reconciled_at: "2026-07-26T03:00:00.000Z",
      repair_checkpoint: true,
      lock_max_attempts: 2,
      lock_wait_ms: 1,
      ...over,
    });
  }

  it("refuses a requested repair when the FOREIGN checkpoint parent is replaced before the write", () => {
    const p = repairable();
    let swap: { parent: string; moved: string } | null = null;
    let fired = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(...args: Parameters<JournalIo["readAll"]>) {
        const content = defaultJournalIo.readAll(...args);
        if (!fired && path.basename(args[0]) === "journal.jsonl") {
          fired = true;
          swap = replaceCheckpointParent(p);
        }
        return content;
      },
    };

    const out = repair(p, { io });
    const swapped = swap as unknown as { parent: string; moved: string };

    expect(fired).toBe(true);
    expect(swapped).not.toBeNull();
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.persisted).toBe(false);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_identity_unstable");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
    // THE POINT: the replacement was not modified. Round 6 wrote the repaired
    // checkpoint into it and called that a verified clean success.
    expect(fs.readdirSync(swapped.parent)).toEqual([]);
    expect(readCheckpointState(p.checkpoint).state).toBe("absent");
  });

  it("refuses to report VERIFIED when the FOREIGN checkpoint parent is replaced after the write", () => {
    const p = repairable();
    let swap: { parent: string; moved: string } | null = null;
    let fired = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      writeCheckpoint(...args: Parameters<JournalIo["writeCheckpoint"]>) {
        defaultJournalIo.writeCheckpoint(...args);
        if (!fired) {
          fired = true;
          const written = fs.readFileSync(args[0]);
          swap = replaceCheckpointParent(p);
          // The replacement agrees with the journal PERFECTLY — internal
          // agreement is exactly what round 5 proved is not authority.
          fs.writeFileSync(p.checkpoint, written);
        }
      },
    };

    const out = repair(p, { io });

    expect(fired).toBe(true);
    expect(swap).not.toBeNull();
    expect(out.checkpoint_repair.attempted).toBe(true);
    expect(out.checkpoint_repair.persisted).toBe(true);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_identity_unstable");
    expect(out.checkpoint_repair.residual_disagreements).toEqual([]);
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("still repairs, verifies and closes cleanly over a checkpoint that lives elsewhere", () => {
    // The discriminator: covering a foreign parent must not mean refusing one.
    const p = repairable();
    const out = repair(p);

    expect(out.checkpoint_repair.attempted).toBe(true);
    expect(out.checkpoint_repair.persisted).toBe(true);
    expect(out.checkpoint_repair.verified).toBe(true);
    expect(out.checkpoint_repair.failure).toBeNull();
    expect(out.checkpoint_repair.residual_disagreements).toEqual([]);
    expect(out.disposition).toBe("succeeded");
    expect(out.blocks_clean_close).toBe(false);
    expect(readCheckpointState(p.checkpoint).state).toBe("present");
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
  });

  it("keeps `repair_not_permitted` distinct when the foreign parent is held throughout", () => {
    // The deliberate distinction, re-pinned in the split layout: a refusal made
    // WITH authority is not a denial OF authority.
    const p = splitPaths(mkRoot());
    writeJournal(p, [sealed(1, { event_id: "e1", operation_id: "op-1", run_id: "OTHER-RUN" })]);

    const out = repair(p);
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_not_permitted");
    expect(out.checkpoint_repair.failure?.message).toContain("OTHER-RUN");
    expect(out.blocks_clean_close).toBe(true);
  });

  it("still refuses when the JOURNAL parent moves and the checkpoint parent does not", () => {
    // The neighbouring interleaving: covering the checkpoint's parent must not
    // weaken the journal-side pin that round 5 established.
    const p = repairable();
    let fired = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(...args: Parameters<JournalIo["readAll"]>) {
        const content = defaultJournalIo.readAll(...args);
        if (!fired && path.basename(args[0]) === "journal.jsonl") {
          fired = true;
          const parent = fs.realpathSync(path.dirname(p.journal));
          const bytes = fs.readFileSync(p.journal);
          fs.renameSync(parent, `${parent}-moved`);
          fs.mkdirSync(parent, { recursive: true });
          fs.writeFileSync(p.journal, bytes);
        }
        return content;
      },
    };

    const out = repair(p, { io });
    expect(fired).toBe(true);
    expect(out.checkpoint_repair.attempted).toBe(false);
    expect(out.checkpoint_repair.verified).toBe(false);
    expect(out.checkpoint_repair.failure?.code).toBe("repair_identity_unstable");
    expect(out.disposition).toBe("failed");
    expect(out.blocks_clean_close).toBe(true);
    expect(readCheckpointState(p.checkpoint).state).toBe("absent");
  });
});
