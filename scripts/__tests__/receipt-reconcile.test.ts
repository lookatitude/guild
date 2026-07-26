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
  return makeReceiptInput({
    run_id: "run-mh-06",
    operation_id: "op-1",
    correlation_id: "corr-1",
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

/** Write an explicit list of sealed records straight to the journal file. */
function writeJournal(journalPath: string, records: ReceiptRecordV1[]): void {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.writeFileSync(journalPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

function sealed(seq: number, over: Partial<ReceiptAppendInput> = {}): ReceiptRecordV1 {
  return sealReceiptRecord({ ...input(over), sequence: seq });
}

// ─────────────────────────────────────────────────────────────────────────────
// MHRC-RCT-004 — gaps
// ─────────────────────────────────────────────────────────────────────────────

describe("MHRC-RCT-004 — reconciliation detects and classifies sequence gaps", () => {
  it("reports every gap with explicit bounds and degrades the outcome", () => {
    const root = mkRoot();
    const p = paths(root);
    // Producer claims 8 records; journal holds 1,2, 5, 8 → gaps [3,4] and [6,7].
    writeJournal(p.journal, [
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
    writeJournal(p.journal, [
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
    writeJournal(p.journal, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);

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
    writeJournal(p.journal, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);
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
    writeJournal(p.journal, [
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

  it("degrades and blocks clean close when the journal tail is truncated", () => {
    const root = mkRoot();
    const p = paths(root);
    writeJournal(p.journal, [sealed(1, { event_id: "e1", operation_id: "op-1" })]);
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
    writeJournal(p.journal, [
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
      p.journal,
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
    writeJournal(p.journal, [
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
    writeJournal(p.journal, [
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
    writeJournal(p.journal, [
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
