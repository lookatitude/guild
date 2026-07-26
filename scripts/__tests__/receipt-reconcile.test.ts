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
import {
  appendReceipt,
  sealReceiptRecord,
  makeReceiptInput,
  readCheckpoint,
  readCheckpointState,
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
