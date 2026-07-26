/**
 * scripts/__tests__/receipt-journal.test.ts
 *
 * MH-06 — atomic receipt journal (src/modules/telemetry/workflows/receipt-journal.ts).
 *
 * Pins the W1/MH-06 slice of the frozen W0 conformance contract
 * (conformance-scenarios.v1.json), scenarios:
 *
 *   MHRC-RCT-001  Receipt journal preserves total logical order
 *   MHRC-RCT-002  Interrupted append never produces a valid partial receipt
 *   MHRC-RCT-003  Observation loss is explicit
 *
 * and boundary rule BR-07 ("An absent observation or receipt MUST NOT be
 * interpreted as success, cleanliness, support, or conformance") plus
 * invariant CI-05.
 *
 * Every test fixes its inputs (no Date.now(), no randomness in assertions) and
 * asserts on typed outputs only.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendReceipt,
  scanReceiptJournal,
  readCheckpoint,
  defaultJournalIo,
  makeReceiptInput,
  sealReceiptRecord,
  repairTornTail,
  RECEIPT_CONTRACT_VERSION,
  type JournalIo,
  type ReceiptAppendInput,
} from "../../src/modules/telemetry/workflows/receipt-journal";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — fully deterministic
// ─────────────────────────────────────────────────────────────────────────────

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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-receipt-journal-"));
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
    scenario_id: "MHRC-RCT-001",
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

// ─────────────────────────────────────────────────────────────────────────────
// MHRC-RCT-001 — total logical order
// ─────────────────────────────────────────────────────────────────────────────

describe("MHRC-RCT-001 — receipt journal preserves total logical order", () => {
  it("assigns unique, strictly increasing sequence values across appends", () => {
    const root = mkRoot();
    const p = paths(root);
    const outs = ["evt-1", "evt-2", "evt-3"].map((id, i) =>
      appendReceipt(p, input({ event_id: id, operation_id: `op-${i + 1}` })),
    );

    expect(outs.map((o) => o.disposition)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(outs.map((o) => o.sequence)).toEqual([1, 2, 3]);
    expect(outs.every((o) => o.durable)).toBe(true);

    const scan = scanReceiptJournal(p.journal);
    expect(scan.integrity).toBe("intact");
    expect(scan.records.map((r) => r.sequence)).toEqual([1, 2, 3]);
    expect(scan.duplicate_sequences).toEqual([]);
    expect(scan.regressing_sequences).toEqual([]);
    expect(scan.order_violations).toEqual([]);
  });

  it("binds every E-RECEIPT field required by the frozen evidence profile", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input());
    const [rec] = scanReceiptJournal(p.journal).records;

    // E-RECEIPT required_bindings
    for (const k of [
      "scenario_id",
      "run_id",
      "operation_id",
      "correlation_id",
      "sequence",
    ] as const) {
      expect(rec[k]).not.toBeNull();
      expect(rec[k]).toBeDefined();
    }
    expect(rec.versions.source_version).toBe(VERSIONS.source_version);
    expect(rec.versions.runtime_version).toBe(VERSIONS.runtime_version);
    // Acceptance 2: host/runtime/contract versions, hashes, timestamps, outcome, observation state
    expect(rec.versions.host_version).toBe(VERSIONS.host_version);
    expect(rec.versions.contract_version).toBe(VERSIONS.contract_version);
    expect(rec.input_hash).toBe("sha256:aaa");
    expect(rec.output_hash).toBe("sha256:bbb");
    expect(rec.recorded_at).toBe("2026-07-26T02:00:00.000Z");
    expect(rec.disposition).toBe("succeeded");
    expect(rec.observation_state).toBe("checked_clean");
    expect(rec.event_id).toBe("evt-1");
    expect(rec.record_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(rec.schema_version).toBe("guild.receipt_record.v1");
  });

  it("resolves every correlation id to exactly one operation lineage", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1", operation_id: "op-A", correlation_id: "c-A" }));
    appendReceipt(p, input({ event_id: "e2", operation_id: "op-A", correlation_id: "c-A", causation_id: "e1" }));
    appendReceipt(p, input({ event_id: "e3", operation_id: "op-B", correlation_id: "c-B" }));

    const scan = scanReceiptJournal(p.journal);
    expect(scan.lineages).toEqual([
      { correlation_id: "c-A", operation_ids: ["op-A"], event_ids: ["e1", "e2"] },
      { correlation_id: "c-B", operation_ids: ["op-B"], event_ids: ["e3"] },
    ]);
    expect(scan.split_lineages).toEqual([]);
  });

  it("flags a terminal receipt that precedes its cause as an order violation", () => {
    // appendReceipt() PREVENTS this shape (see the unknown_causation test below),
    // so the violation can only reach a journal produced by another writer, a
    // merge, or a recovery. The scanner must still detect it.
    const root = mkRoot();
    const p = paths(root);
    const sealed = [
      sealReceiptRecord({ ...input({ event_id: "e1", causation_id: "e2", terminal: true }), sequence: 1 }),
      sealReceiptRecord({ ...input({ event_id: "e2" }), sequence: 2 }),
    ];
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.writeFileSync(p.journal, sealed.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

    const scan = scanReceiptJournal(p.journal);
    expect(scan.records).toHaveLength(2); // both records are individually valid
    expect(scan.order_violations).toEqual([
      {
        event_id: "e1",
        sequence: 1,
        reason: "cause_not_before_effect",
        causation_id: "e2",
        cause_sequence: 2,
      },
    ]);
    expect(scan.integrity).toBe("order_violation");
    expect(scan.blocks_clean_close).toBe(true);
  });

  it("rejects an append whose causation id is unknown to the journal", () => {
    const root = mkRoot();
    const p = paths(root);
    const out = appendReceipt(p, input({ event_id: "e1", causation_id: "missing-cause" }));
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("unknown_causation");
    expect(out.durable).toBe(false);
    expect(fs.existsSync(p.journal)).toBe(false);
  });

  it("refuses a duplicate event id rather than writing a second record", () => {
    const root = mkRoot();
    const p = paths(root);
    expect(appendReceipt(p, input({ event_id: "e1" })).disposition).toBe("succeeded");
    const dup = appendReceipt(p, input({ event_id: "e1" }));
    expect(dup.disposition).toBe("refused");
    expect(dup.failure?.code).toBe("duplicate_event_id");
    expect(scanReceiptJournal(p.journal).records).toHaveLength(1);
  });

  it("keeps the checkpoint in agreement with the journal after each append", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1", operation_id: "op-1" }));
    appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    const cp = readCheckpoint(p.checkpoint);
    expect(cp).toEqual({
      schema_version: "guild.receipt_checkpoint.v1",
      run_id: "run-mh-06",
      last_sequence: 2,
      last_event_id: "e2",
      record_count: 2,
      updated_at: "2026-07-26T02:00:00.000Z",
      contract_version: RECEIPT_CONTRACT_VERSION,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MHRC-RCT-002 — interrupted append never produces a valid partial receipt
// ─────────────────────────────────────────────────────────────────────────────

describe("MHRC-RCT-002 — interrupted append never produces a valid partial receipt", () => {
  /** IO seam that writes a truncated prefix of the line, then throws. */
  function tornWriteIo(realIo: JournalIo, cutAfterBytes: number): JournalIo {
    return {
      ...realIo,
      appendLine(journalPath: string, line: string) {
        realIo.appendLine(journalPath, line.slice(0, cutAfterBytes));
        throw new Error("EIO: simulated interruption before durable replacement");
      },
    };
  }

  it("returns an explicit typed failure — never success — when the append is interrupted", () => {
    const root = mkRoot();
    const p = paths(root);
    const realIo = defaultJournalIo;
    appendReceipt(p, input({ event_id: "e1" }));

    const out = appendReceipt(p, input({ event_id: "e2" }), tornWriteIo(realIo, 40));
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.sequence).toBeNull();
    expect(out.failure?.code).toBe("journal_append_failed");
    expect(out.observation_state).toBe("observation_failed");
  });

  it("readers see the prior valid journal and never accept the truncated record", () => {
    const root = mkRoot();
    const p = paths(root);
    const realIo = defaultJournalIo;
    appendReceipt(p, input({ event_id: "e1" }));
    appendReceipt(p, input({ event_id: "e2" }), tornWriteIo(realIo, 40));

    const scan = scanReceiptJournal(p.journal);
    expect(scan.records.map((r) => r.event_id)).toEqual(["e1"]); // prior valid journal only
    expect(scan.integrity).toBe("truncated_tail");
    expect(scan.rejected).toHaveLength(1);
    expect(scan.rejected[0].reason).toBe("truncated");
    expect(scan.rejected[0].line_number).toBe(2);
  });

  it("rejects a tail record whose bytes were corrupted rather than truncated", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));
    appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    // Flip one field in the last line without recomputing record_hash.
    const lines = fs.readFileSync(p.journal, "utf8").trimEnd().split("\n");
    const tampered = JSON.parse(lines[1]);
    tampered.input_hash = "sha256:TAMPERED";
    lines[1] = JSON.stringify(tampered);
    fs.writeFileSync(p.journal, lines.join("\n") + "\n", "utf8");

    const scan = scanReceiptJournal(p.journal);
    expect(scan.records.map((r) => r.event_id)).toEqual(["e1"]);
    expect(scan.rejected[0].reason).toBe("hash_mismatch");
    expect(scan.integrity).toBe("corrupt");
  });

  it("leaves the checkpoint agreeing with the last durable record after interruption", () => {
    const root = mkRoot();
    const p = paths(root);
    const realIo = defaultJournalIo;
    appendReceipt(p, input({ event_id: "e1" }));
    const before = readCheckpoint(p.checkpoint);

    appendReceipt(p, input({ event_id: "e2" }), tornWriteIo(realIo, 40));
    const after = readCheckpoint(p.checkpoint);

    expect(after).toEqual(before);
    expect(after?.last_sequence).toBe(1);
    expect(after?.last_event_id).toBe("e1");
  });

  it("refuses a later append onto a torn tail instead of corrupting both records", () => {
    // Appending after a newline-less partial line would concatenate into it and
    // destroy BOTH the partial and the new record. Fail closed instead.
    const root = mkRoot();
    const p = paths(root);
    const realIo = defaultJournalIo;
    appendReceipt(p, input({ event_id: "e1" }));
    appendReceipt(p, input({ event_id: "e2" }), tornWriteIo(realIo, 40));

    const out = appendReceipt(p, input({ event_id: "e3", operation_id: "op-3" }));
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_not_reconciled");
    expect(out.durable).toBe(false);

    // The torn journal is untouched: still exactly one valid record.
    const scan = scanReceiptJournal(p.journal);
    expect(scan.records.map((r) => r.event_id)).toEqual(["e1"]);
    expect(scan.integrity).toBe("truncated_tail");
  });

  it("repairTornTail removes only the torn bytes and restores appendability", () => {
    const root = mkRoot();
    const p = paths(root);
    const realIo = defaultJournalIo;
    appendReceipt(p, input({ event_id: "e1" }));
    const intactBytes = fs.statSync(p.journal).size;
    appendReceipt(p, input({ event_id: "e2" }), tornWriteIo(realIo, 40));

    const repair = repairTornTail(p.journal);
    expect(repair.disposition).toBe("succeeded");
    expect(repair.integrity_before).toBe("truncated_tail");
    expect(repair.integrity_after).toBe("intact");
    expect(repair.removed_bytes).toBe(40);
    expect(fs.statSync(p.journal).size).toBe(intactBytes);

    // The durable record survived untouched, and appends work again.
    const resumed = appendReceipt(p, input({ event_id: "e3", operation_id: "op-3" }));
    expect(resumed.disposition).toBe("succeeded");
    expect(resumed.sequence).toBe(2);
    expect(scanReceiptJournal(p.journal).records.map((r) => r.event_id)).toEqual(["e1", "e3"]);
  });

  it("repairTornTail cuts on a BYTE offset, preserving a record with non-ASCII fields", () => {
    // Regression: lastIndexOf() returns a UTF-16 CHARACTER index but truncate(2)
    // takes BYTES. Without the conversion, a journal holding any multi-byte
    // field is cut mid-record and the durable receipt is destroyed.
    const root = mkRoot();
    const p = paths(root);
    const realIo = defaultJournalIo;
    appendReceipt(p, input({ event_id: "e1", scenario_id: "MHRC-RCT-002-日本語-Ünïcøde" }));
    const intactBytes = fs.statSync(p.journal).size;
    expect(intactBytes).toBeGreaterThan(
      fs.readFileSync(p.journal, "utf8").length, // multi-byte content is really present
    );

    appendReceipt(p, input({ event_id: "e2" }), tornWriteIo(realIo, 40));
    const repair = repairTornTail(p.journal);

    expect(repair.disposition).toBe("succeeded");
    expect(repair.integrity_after).toBe("intact");
    expect(fs.statSync(p.journal).size).toBe(intactBytes);
    const scan = scanReceiptJournal(p.journal);
    expect(scan.records).toHaveLength(1);
    expect(scan.records[0].scenario_id).toBe("MHRC-RCT-002-日本語-Ünïcøde");
  });

  it("repairTornTail refuses a corrupt journal — that needs reconciliation, not truncation", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));
    appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));
    const lines = fs.readFileSync(p.journal, "utf8").trimEnd().split("\n");
    const tampered = JSON.parse(lines[1]);
    tampered.input_hash = "sha256:TAMPERED";
    fs.writeFileSync(p.journal, [lines[0], JSON.stringify(tampered)].join("\n") + "\n", "utf8");

    const repair = repairTornTail(p.journal);
    expect(repair.disposition).toBe("refused");
    expect(repair.failure?.code).toBe("not_repairable");
    expect(repair.removed_bytes).toBe(0);
  });

  it("fails closed when the record is durable but the checkpoint write fails", () => {
    const root = mkRoot();
    const p = paths(root);
    const realIo = defaultJournalIo;
    const io: JournalIo = {
      ...realIo,
      writeCheckpoint() {
        throw new Error("ENOSPC: simulated checkpoint failure");
      },
    };

    const out = appendReceipt(p, input({ event_id: "e1" }), io);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("checkpoint_write_failed");
    expect(out.observation_state).toBe("observation_failed");
    // The operation cannot report success without durable evidence of BOTH.
    expect(readCheckpoint(p.checkpoint)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MHRC-RCT-003 — observation loss is explicit (BR-07 / CI-05)
// ─────────────────────────────────────────────────────────────────────────────

describe("MHRC-RCT-003 — observation loss is explicit", () => {
  it("records observation_failed with a failed disposition and blocks dependent completion", () => {
    const root = mkRoot();
    const p = paths(root);
    const out = appendReceipt(
      p,
      input({
        event_id: "e1",
        scenario_id: "MHRC-RCT-003",
        observation_state: "observation_failed",
        disposition: "failed",
        output_hash: null,
        affected_event_range: { from: 4, to: 9 },
      }),
    );

    expect(out.disposition).toBe("failed");
    expect(out.observation_state).toBe("observation_failed");
    expect(out.blocks_dependent_completion).toBe(true);
    // The failure signal itself IS durable — that is what makes the loss explicit.
    expect(out.durable).toBe(true);

    const [rec] = scanReceiptJournal(p.journal).records;
    expect(rec.observation_state).toBe("observation_failed");
    expect(rec.affected_event_range).toEqual({ from: 4, to: 9 });
  });

  it("fails closed when the observation-failure signal itself cannot be made durable", () => {
    const root = mkRoot();
    const p = paths(root);
    const realIo = defaultJournalIo;
    const io: JournalIo = {
      ...realIo,
      appendLine() {
        throw new Error("EIO: simulated durable-write failure");
      },
    };

    const out = appendReceipt(
      p,
      input({ event_id: "e1", observation_state: "observation_failed", disposition: "failed" }),
      io,
    );
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.blocks_dependent_completion).toBe(true);
    expect(out.failure?.code).toBe("journal_append_failed");
  });

  it("BR-07: an absent journal reads as not_observed, never as checked_clean", () => {
    const root = mkRoot();
    const p = paths(root);
    const scan = scanReceiptJournal(p.journal);

    expect(scan.records).toEqual([]);
    expect(scan.observation_state).toBe("not_observed");
    expect(scan.observation_state).not.toBe("checked_clean");
    expect(scan.integrity).toBe("absent");
    expect(scan.last_sequence).toBe(0);
  });

  it("BR-07: a journal carrying an observation_failed record never reads as checked_clean", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));
    appendReceipt(
      p,
      input({ event_id: "e2", observation_state: "observation_failed", disposition: "failed" }),
    );

    const scan = scanReceiptJournal(p.journal);
    expect(scan.observation_state).toBe("observation_failed");
    expect(scan.blocks_clean_close).toBe(true);
  });

  it("an intact fully-observed journal is the only shape that reads checked_clean", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));
    appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    const scan = scanReceiptJournal(p.journal);
    expect(scan.observation_state).toBe("checked_clean");
    expect(scan.blocks_clean_close).toBe(false);
  });

  it("rejects a record whose observation_state is outside the closed vocabulary", () => {
    const root = mkRoot();
    const p = paths(root);
    const out = appendReceipt(
      p,
      input({ event_id: "e1", observation_state: "probably_fine" as never }),
    );
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("invalid_record");
    expect(fs.existsSync(p.journal)).toBe(false);
  });

  it("rejects a record whose disposition is outside the closed vocabulary", () => {
    const root = mkRoot();
    const p = paths(root);
    const out = appendReceipt(p, input({ event_id: "e1", disposition: "kinda_ok" as never }));
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("invalid_record");
  });
});
