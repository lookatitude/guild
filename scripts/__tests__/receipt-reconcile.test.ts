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
    expect(out.checkpoint_after).not.toBeNull();
    expect(out.checkpoint_after!.last_sequence).toBe(1);
    expect(out.checkpoint_after!.updated_at).toBe("2026-07-26T03:00:00.000Z");
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
    expect(out.checkpoint_repair).toEqual({
      requested: false,
      attempted: false,
      persisted: false,
      verified: false,
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
