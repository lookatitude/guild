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
import { spawn } from "child_process";
import {
  appendReceipt,
  scanReceiptJournal,
  readCheckpoint,
  readCheckpointState,
  isValidCheckpointShape,
  compareCheckpointToJournal,
  analyzeReceiptRecords,
  journalLockPath,
  canonicalJournalPath,
  resolveJournalIdentity,
  acquireJournalAuthority,
  JournalIdentityError,
  defaultJournalIo,
  makeReceiptInput,
  sealReceiptRecord,
  repairTornTail,
  RECEIPT_CONTRACT_VERSION,
  type JournalIo,
  type JournalLockGrant,
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
  const operation_id = over.operation_id ?? "op-1";
  return makeReceiptInput({
    run_id: "run-mh-06",
    operation_id,
    // MHRC-RCT-001 requires every correlation id to resolve to exactly ONE
    // operation lineage, so the default fixture derives the correlation from the
    // operation. Tests that deliberately exercise a shared or split lineage pass
    // `correlation_id` explicitly (the `...over` spread wins).
    correlation_id: `corr-${operation_id}`,
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

  // ── MH-06-R1-B4 ───────────────────────────────────────────────────────────
  it("MH-06-R1-B4: refuses an append that would split one correlation across two operations", () => {
    const root = mkRoot();
    const p = paths(root);
    expect(
      appendReceipt(p, input({ event_id: "e1", operation_id: "op-A", correlation_id: "corr-shared" }))
        .disposition,
    ).toBe("succeeded");

    const split = appendReceipt(
      p,
      input({ event_id: "e2", operation_id: "op-B", correlation_id: "corr-shared" }),
    );

    expect(split.disposition).toBe("failed");
    expect(split.durable).toBe(false);
    expect(split.blocks_dependent_completion).toBe(true);
    // The journal is untouched — the split never reaches disk.
    expect(scanReceiptJournal(p.journal).records.map((r) => r.event_id)).toEqual(["e1"]);
  });

  it("MH-06-R1-B4: a split correlation lineage degrades integrity and blocks clean close", () => {
    // appendReceipt refuses to create this shape, so it can only arrive from
    // another writer, a merge, or a recovery — the scanner must still fail closed.
    const root = mkRoot();
    const p = paths(root);
    const recs = [
      sealReceiptRecord({
        ...input({ event_id: "e1", operation_id: "op-A", correlation_id: "corr-shared" }),
        sequence: 1,
      }),
      sealReceiptRecord({
        ...input({ event_id: "e2", operation_id: "op-B", correlation_id: "corr-shared" }),
        sequence: 2,
      }),
    ];
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.writeFileSync(p.journal, recs.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

    const scan = scanReceiptJournal(p.journal);
    expect(scan.split_lineages).toEqual(["corr-shared"]);
    expect(scan.integrity).not.toBe("intact");
    expect(scan.observation_state).not.toBe("checked_clean");
    expect(scan.blocks_clean_close).toBe(true);
  });

  it("MH-06-R1-B4: refuses an append carrying a foreign run id", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));

    const foreign = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2", run_id: "other-run" }));
    expect(foreign.disposition).toBe("failed");
    expect(foreign.failure?.code).toBe("foreign_run_id");
    expect(scanReceiptJournal(p.journal).records).toHaveLength(1);
  });

  it("MH-06-R1-B4: a journal mixing two runs is a lineage violation", () => {
    const root = mkRoot();
    const p = paths(root);
    const recs = [
      sealReceiptRecord({ ...input({ event_id: "e1", operation_id: "op-1" }), sequence: 1 }),
      sealReceiptRecord({
        ...input({ event_id: "e2", operation_id: "op-2", run_id: "other-run" }),
        sequence: 2,
      }),
    ];
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.writeFileSync(p.journal, recs.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

    const scan = scanReceiptJournal(p.journal);
    expect(scan.run_ids).toEqual(["run-mh-06", "other-run"]);
    expect(scan.integrity).toBe("lineage_violation");
    expect(scan.blocks_clean_close).toBe(true);
  });

  it("a clean single-run journal reports exactly one run id", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));
    appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    const scan = scanReceiptJournal(p.journal);
    expect(scan.run_ids).toEqual(["run-mh-06"]);
    expect(scan.integrity).toBe("intact");
    expect(scan.split_lineages).toEqual([]);
    expect(scan.blocks_clean_close).toBe(false);
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

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R2-B1 — concurrent appends are LINEARIZABLE across PROCESSES
//
// Round 2 assigned `scan.last_sequence + 1` with no lock. A synchronized
// 16-process probe produced seven outcomes reporting `disposition: "succeeded"`
// and `durable: true` over only three unique sequences, beside a checkpoint that
// described none of them. MHRC-RCT-001's input pattern is literally
// `sequential_and_concurrent_operations` and its required outcome is that
// sequence values are unique and strictly increasing, so this is contract, not
// hardening — and it cannot be closed by an in-process mutex, because the
// competing writers are separate OS processes.
// ─────────────────────────────────────────────────────────────────────────────

const TSX = path.join(__dirname, "..", "node_modules", ".bin", "tsx");
const JOURNAL_MODULE = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "modules",
  "telemetry",
  "workflows",
  "receipt-journal",
);

/**
 * A child that performs ONE append in its own OS process and prints the outcome.
 *
 * `spelling` picks how this child NAMES the one journal every child shares, and
 * `lock` optionally sets a caller-supplied `JournalPaths.lock`. Both exist so a
 * race can prove that neither an alternate spelling nor a caller-chosen lock can
 * partition serialisation (MH-06-R3-B1).
 */
function writeAppendChild(root: string): string {
  const file = path.join(root, "append-child.ts");
  fs.writeFileSync(
    file,
    `import * as path from "node:path";
import { appendReceipt, makeReceiptInput } from ${JSON.stringify(JOURNAL_MODULE)};
const [root, eventId, opId, startAt, spelling, lock] = process.argv.slice(2);
const journal = (() => {
  if (spelling === "dotdot") return path.join(root, "receipts", "..", "receipts", ".", "journal.jsonl");
  if (spelling === "symlink") return path.join(root, "link", "journal.jsonl");
  if (spelling === "relative") { process.chdir(root); return path.join("receipts", "journal.jsonl"); }
  return path.join(root, "receipts", "journal.jsonl");
})();
const paths: Record<string, string> = {
  journal,
  checkpoint: path.join(root, "receipts", "checkpoint.json"),
};
if (lock && lock !== "-") paths.lock = lock;
const out = (() => {
  const target = Number(startAt);
  while (Date.now() < target) { /* spin to the shared barrier */ }
  return appendReceipt(paths as never, makeReceiptInput({
    run_id: "run-mh-06",
    operation_id: opId,
    correlation_id: "corr-" + opId,
    event_id: eventId,
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
    versions: ${JSON.stringify(VERSIONS)},
  }));
})();
process.stdout.write(JSON.stringify({
  disposition: out.disposition,
  durable: out.durable,
  sequence: out.sequence,
  failure: out.failure ? out.failure.code : null,
}) + "\\n");
`,
    "utf8",
  );
  return file;
}

interface ChildOutcome {
  disposition: string;
  durable: boolean;
  sequence: number | null;
  failure: string | null;
}

/** Spawn `n` real processes that all append at the same wall-clock instant. */
async function raceAppends(
  root: string,
  n: number,
  opts: { spelling?: (i: number) => string; lock?: (i: number) => string } = {},
): Promise<ChildOutcome[]> {
  const child = writeAppendChild(root);
  fs.mkdirSync(path.join(root, "receipts"), { recursive: true });
  const link = path.join(root, "link");
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(root, "receipts"), link);
  const startAt = Date.now() + 4000;
  return Promise.all(
    Array.from({ length: n }, (_, i) =>
      new Promise<ChildOutcome>((resolve, reject) => {
        const args = [
          child,
          root,
          `evt-${i}`,
          `op-${i}`,
          String(startAt),
          opts.spelling?.(i) ?? "plain",
          opts.lock?.(i) ?? "-",
        ];
        const proc = spawn(TSX, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        proc.stdout.on("data", (d) => (out += String(d)));
        proc.stderr.on("data", (d) => (err += String(d)));
        proc.on("close", () => {
          const line = out.trim().split("\n").pop() ?? "";
          if (!line.startsWith("{")) {
            reject(new Error(`append child ${i} produced no outcome: ${err.slice(0, 400)}`));
            return;
          }
          resolve(JSON.parse(line) as ChildOutcome);
        });
      }),
    ),
  );
}

describe("MH-06-R2-B1 — concurrent appends are linearizable across processes", () => {
  it("never lets two SEPARATE PROCESSES claim durable success for one sequence", async () => {
    const root = mkRoot();
    const p = paths(root);
    const outcomes = await raceAppends(root, 8);

    const durable = outcomes.filter((o) => o.disposition === "succeeded" && o.durable);
    const sequences = durable.map((o) => o.sequence);

    // Every reported durable success is a DISTINCT sequence…
    expect(new Set(sequences).size).toBe(durable.length);
    // …and the journal holds exactly those records, in a strictly increasing run.
    const scan = scanReceiptJournal(p.journal);
    expect(scan.integrity).toBe("intact");
    expect(scan.duplicate_sequences).toEqual([]);
    expect(scan.regressing_sequences).toEqual([]);
    expect(scan.record_count).toBe(durable.length);
    expect(scan.records.map((r) => r.sequence)).toEqual(
      Array.from({ length: scan.record_count }, (_, i) => i + 1),
    );
    // …and the checkpoint describes the journal, not some earlier writer's view.
    const cp = readCheckpoint(p.checkpoint);
    expect(cp).not.toBeNull();
    expect(cp!.record_count).toBe(scan.record_count);
    expect(cp!.last_sequence).toBe(scan.last_sequence);
    // Whatever did NOT succeed must be an explicit typed failure, never silence.
    for (const o of outcomes.filter((x) => !(x.disposition === "succeeded" && x.durable))) {
      expect(o.durable).toBe(false);
      expect(o.sequence).toBeNull();
      expect(o.failure).not.toBeNull();
    }
  }, 60_000);

  it("every one of 8 concurrent processes succeeds when the lock wait is generous", async () => {
    const root = mkRoot();
    const p = paths(root);
    const outcomes = await raceAppends(root, 8);

    expect(outcomes.every((o) => o.disposition === "succeeded" && o.durable)).toBe(true);
    expect([...outcomes.map((o) => o.sequence)].sort((a, b) => (a as number) - (b as number))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(scanReceiptJournal(p.journal).record_count).toBe(8);
  }, 60_000);

  it("fails closed — never optimistically — when the lock cannot be taken", () => {
    const root = mkRoot();
    const p = paths(root);
    // Another writer already holds it.
    fs.mkdirSync(path.dirname(journalLockPath(p)), { recursive: true });
    fs.mkdirSync(journalLockPath(p));

    const out = appendReceipt(p, input({ event_id: "e1" }), defaultJournalIo, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.sequence).toBeNull();
    expect(out.failure?.code).toBe("journal_lock_unavailable");
    expect(out.blocks_dependent_completion).toBe(true);
    expect(fs.existsSync(p.journal)).toBe(false);
  });

  it("fails closed when the lock itself raises an IO fault", () => {
    const root = mkRoot();
    const p = paths(root);
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock() {
        throw new Error("EROFS: cannot create lock");
      },
    };

    const out = appendReceipt(p, input({ event_id: "e1" }), io);
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_lock_failed");
    expect(fs.existsSync(p.journal)).toBe(false);
  });

  it("releases the lock after a typed failure instead of wedging every later writer", () => {
    const root = mkRoot();
    const p = paths(root);
    // An append that fails deep inside the guarded transaction…
    const bad = appendReceipt(p, input({ event_id: "e1", causation_id: "nope" }));
    expect(bad.failure?.code).toBe("unknown_causation");
    expect(fs.existsSync(journalLockPath(p))).toBe(false);

    // …must not stop the next writer.
    const good = appendReceipt(p, input({ event_id: "e2" }), defaultJournalIo, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });
    expect(good.disposition).toBe("succeeded");
    expect(good.sequence).toBe(1);
  });

  it("releases the lock even when the IO seam throws", () => {
    const root = mkRoot();
    const p = paths(root);
    const io: JournalIo = {
      ...defaultJournalIo,
      appendLine() {
        throw new Error("EIO");
      },
    };
    expect(appendReceipt(p, input({ event_id: "e1" }), io).failure?.code).toBe("journal_append_failed");
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });

  it("refuses a torn-tail repair it cannot serialise against a live writer", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));
    fs.mkdirSync(journalLockPath(p));

    const repair = repairTornTail(p.journal, defaultJournalIo, { lock_max_attempts: 2, lock_wait_ms: 1 });
    expect(repair.disposition).toBe("failed");
    expect(repair.failure?.code).toBe("journal_lock_unavailable");
    expect(repair.removed_bytes).toBe(0);
  });

  it("fails closed when the journal line does not actually land", () => {
    const root = mkRoot();
    const p = paths(root);
    const io: JournalIo = {
      ...defaultJournalIo,
      appendLine() {
        /* silently drops the write and returns as if it worked */
      },
    };

    const out = appendReceipt(p, input({ event_id: "e1" }), io);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_append_unverified");
    expect(readCheckpoint(p.checkpoint)).toBeNull();
  });

  it("takes the lock exactly once and releases it, around the WHOLE transaction", () => {
    const root = mkRoot();
    const p = paths(root);
    // Round 4: the guarded transaction reads and writes the CANONICAL journal the
    // lock names, never the caller's spelling — so that is what must reach the IO
    // seam. Keying this fake on `p.journal` would silently stop firing.
    const canonical = canonicalJournalPath(p.journal);
    const calls: string[] = [];
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        calls.push(`acquire:${path.basename(lockPath)}`);
        return defaultJournalIo.acquireLock!(lockPath);
      },
      releaseLock(lockPath) {
        calls.push(`release:${path.basename(lockPath)}`);
        defaultJournalIo.releaseLock!(lockPath);
      },
      readAll(journalPath) {
        // Every read that decides the sequence must happen INSIDE the lock.
        if (journalPath === canonical) calls.push("scan");
        else if (journalPath !== p.checkpoint) calls.push(`stray-read:${journalPath}`);
        return defaultJournalIo.readAll(journalPath);
      },
      appendLine(journalPath, text) {
        calls.push(journalPath === canonical ? "append" : `stray-append:${journalPath}`);
        defaultJournalIo.appendLine(journalPath, text);
      },
      writeCheckpoint(cpPath, content) {
        calls.push("checkpoint");
        defaultJournalIo.writeCheckpoint(cpPath, content);
      },
    };

    const out = appendReceipt(p, input({ event_id: "e1" }), io);
    expect(out.disposition).toBe("succeeded");

    expect(calls[0]).toBe("acquire:journal.jsonl.lock");
    expect(calls[calls.length - 1]).toBe("release:journal.jsonl.lock");
    expect(calls.filter((c) => c.startsWith("acquire:"))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("release:"))).toHaveLength(1);
    // The planning scan, the append, the verification scan and the checkpoint
    // all sit strictly between them.
    for (const step of ["scan", "append", "checkpoint"]) expect(calls).toContain(step);
    // …and NOTHING reached the journal under any other name.
    expect(calls.filter((c) => c.startsWith("stray-"))).toEqual([]);
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });

  it("derives the lock path from the journal, with no override to derive it from", () => {
    expect(journalLockPath({ journal: "/x/journal.jsonl", checkpoint: "/x/cp.json" })).toBe(
      "/x/journal.jsonl.lock",
    );
    // Round 2 accepted a caller-supplied `lock` and returned it verbatim. Round 3
    // proved that partitions serialisation, so the field is GONE from the type —
    // and a runtime object still carrying one is inert, not honoured.
    expect(
      journalLockPath({
        journal: "/x/journal.jsonl",
        checkpoint: "/x/cp.json",
        lock: "/y/other.lock",
      } as unknown as Parameters<typeof journalLockPath>[0]),
    ).toBe("/x/journal.jsonl.lock");
  });

  it("fails closed when the checkpoint write lands DIFFERENT content", () => {
    const root = mkRoot();
    const p = paths(root);
    const io: JournalIo = {
      ...defaultJournalIo,
      writeCheckpoint(cpPath) {
        defaultJournalIo.writeCheckpoint(
          cpPath,
          `${JSON.stringify(
            {
              schema_version: "guild.receipt_checkpoint.v1",
              run_id: "run-mh-06",
              last_sequence: 99,
              last_event_id: "not-ours",
              record_count: 99,
              updated_at: "2026-07-26T02:00:00.000Z",
              contract_version: RECEIPT_CONTRACT_VERSION,
            },
            null,
            2,
          )}\n`,
        );
      },
    };

    const out = appendReceipt(p, input({ event_id: "e1" }), io);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("checkpoint_write_unverified");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R3-B1 — one journal, exactly ONE lock identity
//
// Round 2 put the whole append transaction under `<journal>.lock`, and round 3
// showed that is only a lock if every writer computes the same one. `JournalPaths`
// let each caller pass its own `lock`, so twelve processes alternating two legal
// overrides for ONE journal produced a duplicated sequence 10, integrity
// `order_violation`, eleven records beside a checkpoint counting nine — with nine
// callers already told `disposition: "succeeded", durable: true`.
//
// The identity is therefore DERIVED from the canonical journal path and cannot be
// supplied. A journal has one lock because it has one canonical name.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R3-B1 — the journal lock identity is derived, never chosen", () => {
  /** Every legal way to name one journal, including a caller-picked lock. */
  function spellings(root: string): Array<[string, Record<string, string>]> {
    const p = paths(root);
    return [
      ["`..` and `.` segments", { journal: path.join(root, "receipts", "..", "receipts", ".", "journal.jsonl"), checkpoint: p.checkpoint }],
      ["a symlinked directory", { journal: path.join(root, "link", "journal.jsonl"), checkpoint: p.checkpoint }],
      ["a doubled separator", { journal: `${path.dirname(p.journal)}//journal.jsonl`, checkpoint: p.checkpoint }],
      ["a caller-picked lock", { journal: p.journal, checkpoint: p.checkpoint, lock: path.join(root, "elsewhere.lock") }],
      ["a caller-picked lock outside the tree", { journal: p.journal, checkpoint: p.checkpoint, lock: "/tmp/whatever-i-like.lock" }],
    ];
  }

  it("derives ONE lock path from every legal spelling of one journal", () => {
    const root = mkRoot();
    const p = paths(root);
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.symlinkSync(path.join(root, "receipts"), path.join(root, "link"));

    const canonical = journalLockPath(p);
    // Labelled so a failure says WHICH spelling partitioned.
    const derived = spellings(root).map(([label, variant]) => [
      label,
      journalLockPath(variant as unknown as Parameters<typeof journalLockPath>[0]),
    ]);
    expect(derived).toEqual(spellings(root).map(([label]) => [label, canonical]));
    // …and a symlink to a journal that does not exist yet still names that journal.
    const dangling = path.join(root, "receipts", "dangling.jsonl");
    fs.symlinkSync(p.journal, dangling);
    expect(journalLockPath({ journal: dangling, checkpoint: p.checkpoint })).toBe(canonical);
  });

  it("derives the SAME identity before and after the journal exists", () => {
    // A lock identity that changed when the file appeared would partition the
    // first writer from every later one — the defect, one level down.
    const root = mkRoot();
    const p = paths(root);
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    const before = journalLockPath(p);
    expect(appendReceipt(p, input({ event_id: "e1" })).disposition).toBe("succeeded");
    expect(journalLockPath(p)).toBe(before);
    // …and that one identity is the journal's REAL path, not the caller's spelling.
    expect(journalLockPath(p)).toBe(`${fs.realpathSync(p.journal)}.lock`);
  });

  it("resolves a relative journal path against the process cwd", () => {
    const root = mkRoot();
    const p = paths(root);
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    const cwd = process.cwd();
    try {
      process.chdir(root);
      expect(journalLockPath({ journal: path.join("receipts", "journal.jsonl"), checkpoint: p.checkpoint })).toBe(
        journalLockPath(p),
      );
    } finally {
      process.chdir(cwd);
    }
  });

  it("blocks an append when the lock is held under a DIFFERENT spelling", () => {
    const root = mkRoot();
    const p = paths(root);
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.symlinkSync(path.join(root, "receipts"), path.join(root, "link"));
    // Another writer took the lock naming the journal through the symlink.
    fs.mkdirSync(journalLockPath({ journal: path.join(root, "link", "journal.jsonl"), checkpoint: p.checkpoint }));

    const out = appendReceipt(p, input({ event_id: "e1" }), defaultJournalIo, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_lock_unavailable");
    expect(fs.existsSync(p.journal)).toBe(false);
  });

  it("serialises 8 SEPARATE PROCESSES that each pick their own lock path", async () => {
    const root = mkRoot();
    const p = paths(root);
    // Half the writers ask for the canonical lock, half for one of their own.
    const outcomes = await raceAppends(root, 8, {
      lock: (i) => (i % 2 === 0 ? path.join(root, "receipts", "journal.jsonl.lock") : path.join(root, "alt-writer.lock")),
    });

    const durable = outcomes.filter((o) => o.disposition === "succeeded" && o.durable);
    expect(new Set(durable.map((o) => o.sequence)).size).toBe(durable.length);
    const scan = scanReceiptJournal(p.journal);
    expect(scan.integrity).toBe("intact");
    expect(scan.duplicate_sequences).toEqual([]);
    expect(scan.record_count).toBe(durable.length);
    expect(scan.records.map((r) => r.sequence)).toEqual(
      Array.from({ length: scan.record_count }, (_, i) => i + 1),
    );
    const cp = readCheckpoint(p.checkpoint);
    expect(cp!.last_sequence).toBe(scan.last_sequence);
    expect(cp!.record_count).toBe(scan.record_count);
    expect(compareCheckpointToJournal(readCheckpointState(p.checkpoint), scan, "run-mh-06")).toEqual([]);
  }, 60_000);

  it("serialises 8 SEPARATE PROCESSES naming ONE journal four different ways", async () => {
    const root = mkRoot();
    const p = paths(root);
    const forms = ["plain", "dotdot", "symlink", "relative"];
    const outcomes = await raceAppends(root, 8, { spelling: (i) => forms[i % forms.length] });

    const durable = outcomes.filter((o) => o.disposition === "succeeded" && o.durable);
    expect(new Set(durable.map((o) => o.sequence)).size).toBe(durable.length);
    const scan = scanReceiptJournal(p.journal);
    expect(scan.integrity).toBe("intact");
    expect(scan.record_count).toBe(durable.length);
    expect(scan.records.map((r) => r.sequence)).toEqual(
      Array.from({ length: scan.record_count }, (_, i) => i + 1),
    );
    expect(compareCheckpointToJournal(readCheckpointState(p.checkpoint), scan, "run-mh-06")).toEqual([]);
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R4-B1 — one PHYSICAL journal, one lock identity
//
// Round 3 made the lock identity DERIVED instead of caller-chosen, and round 4
// showed that canonicalizing a NAME is still not identifying a FILE. Two hard
// links to one inode are two canonical names, so `journalLockPath` returned
// `journal-a.jsonl.lock` and `journal-b.jsonl.lock` for one physical journal and
// BOTH were acquired at once. And a symlinked parent repointed inside
// `acquireLock` let an append that had derived directory A's lock write through
// the caller's alias into directory B — returning `succeeded / durable / 1` while
// B's own canonical lock was held by somebody else.
//
// The identity is therefore bound to the FILE, not the name: `resolveJournalIdentity`
// refuses a journal with more than one name outright, is re-derived under the lock
// and again before any durable claim, and the guarded transaction reads and writes
// the canonical path the lock names.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R4-B1 — the lock identity is bound to the physical journal", () => {
  /** One durable record, so the journal exists as a real file to alias. */
  function seeded() {
    const root = mkRoot();
    const p = paths(root);
    expect(appendReceipt(p, input({ event_id: "seed", operation_id: "op-seed" })).disposition).toBe("succeeded");
    return { root, ...p };
  }

  it("refuses to name a lock for a journal that has more than one name", () => {
    const p = seeded();
    const alias = path.join(path.dirname(p.journal), "alias.jsonl");
    fs.linkSync(p.journal, alias);
    // Same device, same inode, two names — the fixture the reviewer built.
    expect(fs.statSync(p.journal).ino).toBe(fs.statSync(alias).ino);
    expect(fs.statSync(p.journal).dev).toBe(fs.statSync(alias).dev);

    for (const name of [p.journal, alias]) {
      const resolved = resolveJournalIdentity(name);
      expect(resolved.ok).toBe(false);
      expect(resolved.failure?.code).toBe("journal_identity_ambiguous");
      // …and the derivation API refuses rather than returning a lock that
      // excludes nobody. Round 4 got two acquirable paths out of exactly this.
      expect(() => journalLockPath({ journal: name, checkpoint: p.checkpoint })).toThrow(JournalIdentityError);
      try {
        journalLockPath({ journal: name, checkpoint: p.checkpoint });
      } catch (err) {
        expect((err as JournalIdentityError).code).toBe("journal_identity_ambiguous");
      }
    }
  });

  it("fails an append through EITHER hard link, before anything durable is claimed", () => {
    const p = seeded();
    const alias = path.join(path.dirname(p.journal), "alias.jsonl");
    fs.linkSync(p.journal, alias);
    const bytesBefore = fs.readFileSync(p.journal, "utf8");

    for (const name of [p.journal, alias]) {
      const out = appendReceipt({ journal: name, checkpoint: p.checkpoint }, input({ event_id: "e-alias" }));
      expect(out.disposition).toBe("failed");
      expect(out.durable).toBe(false);
      expect(out.sequence).toBeNull();
      expect(out.failure?.code).toBe("journal_identity_ambiguous");
      expect(out.blocks_dependent_completion).toBe(true);
    }
    // Nothing was written, and no lock was left behind for either name.
    expect(fs.readFileSync(p.journal, "utf8")).toBe(bytesBefore);
    expect(fs.existsSync(`${p.journal}.lock`)).toBe(false);
    expect(fs.existsSync(`${alias}.lock`)).toBe(false);
  });

  it("recovers the moment the extra name is removed", () => {
    // The refusal is a property of the journal, not a latch on the module.
    const p = seeded();
    const alias = path.join(path.dirname(p.journal), "alias.jsonl");
    fs.linkSync(p.journal, alias);
    expect(appendReceipt(p, input({ event_id: "e2" })).failure?.code).toBe("journal_identity_ambiguous");
    fs.unlinkSync(alias);
    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));
    expect(out.disposition).toBe("succeeded");
    expect(out.sequence).toBe(2);
  });

  it("refuses a torn-tail repair on a multi-named journal too", () => {
    const p = seeded();
    fs.appendFileSync(p.journal, '{"schema_version":"guild.receipt_record.v1","seq', "utf8");
    const alias = path.join(path.dirname(p.journal), "alias.jsonl");
    fs.linkSync(p.journal, alias);
    const bytesBefore = fs.readFileSync(p.journal, "utf8");

    const repair = repairTornTail(p.journal);
    expect(repair.disposition).toBe("failed");
    expect(repair.failure?.code).toBe("journal_identity_ambiguous");
    expect(repair.removed_bytes).toBe(0);
    // A truncation this caller was not authorised for did NOT happen.
    expect(fs.readFileSync(p.journal, "utf8")).toBe(bytesBefore);
  });

  it("refuses when a parent is swapped DURING lock acquisition", () => {
    const root = mkRoot();
    const dirA = path.join(root, "A");
    const dirB = path.join(root, "B");
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    const alias = path.join(root, "alias");
    fs.symlinkSync(dirA, alias);
    // B's canonical journal lock is already held by another writer.
    fs.mkdirSync(journalLockPath({ journal: path.join(dirB, "journal.jsonl"), checkpoint: path.join(dirB, "cp.json") }));

    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        // The reviewer's exact interleaving: the alias is repointed at B after
        // this writer derived A's lock and before it holds anything.
        if (fs.readlinkSync(alias) === dirA) {
          fs.unlinkSync(alias);
          fs.symlinkSync(dirB, alias);
        }
        return defaultJournalIo.acquireLock!(lockPath);
      },
    };

    const out = appendReceipt(
      { journal: path.join(alias, "journal.jsonl"), checkpoint: path.join(alias, "cp.json") },
      input({ event_id: "e-swap" }),
      io,
      { lock_max_attempts: 2, lock_wait_ms: 1 },
    );

    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.sequence).toBeNull();
    expect(out.failure?.code).toBe("journal_identity_unstable");
    // …and B — whose lock this writer never held — is untouched.
    expect(fs.existsSync(path.join(dirB, "journal.jsonl"))).toBe(false);
  });

  it("never lands a record in a destination the swap moved it to", () => {
    const root = mkRoot();
    const dirA = path.join(root, "A");
    const dirB = path.join(root, "B");
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    const alias = path.join(root, "alias");
    fs.symlinkSync(dirA, alias);
    fs.mkdirSync(journalLockPath({ journal: path.join(dirB, "journal.jsonl"), checkpoint: path.join(dirB, "cp.json") }));

    let swapped = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(target) {
        const content = defaultJournalIo.readAll(target);
        // Fire once this writer already HOLDS A's lock and is scanning.
        if (!swapped && path.basename(target) === "journal.jsonl") {
          swapped = true;
          fs.unlinkSync(alias);
          fs.symlinkSync(dirB, alias);
        }
        return content;
      },
    };

    const out = appendReceipt(
      { journal: path.join(alias, "journal.jsonl"), checkpoint: path.join(alias, "cp.json") },
      input({ event_id: "e-swap2" }),
      io,
      { lock_max_attempts: 2, lock_wait_ms: 1 },
    );

    expect(swapped).toBe(true);
    // The write is bound to the identity the lock names, so B stays empty…
    expect(scanReceiptJournal(path.join(dirB, "journal.jsonl")).record_count).toBe(0);
    // …and no durable claim is made for a path that no longer means what it did.
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_identity_unstable");
  });

  it("refuses when the physical journal is REPLACED under the lock", () => {
    const p = seeded();
    let swapped = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(target) {
        const content = defaultJournalIo.readAll(target);
        if (!swapped && path.basename(target) === "journal.jsonl") {
          swapped = true;
          // Same name, different inode — the file we were authorised over is gone.
          const replacement = path.join(path.dirname(p.journal), "replacement.jsonl");
          fs.writeFileSync(replacement, content ?? "", "utf8");
          fs.renameSync(replacement, p.journal);
        }
        return content;
      },
    };
    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io);
    expect(swapped).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_identity_unstable");
  });

  it("still resolves ONE honest identity for every legal spelling, before and after creation", () => {
    // The refusals above must not have cost the round-3 property: a journal named
    // many legal ways is still exactly one journal.
    const root = mkRoot();
    const p = paths(root);
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.symlinkSync(path.join(root, "receipts"), path.join(root, "link"));

    const before = resolveJournalIdentity(p.journal);
    expect(before.ok).toBe(true);
    expect(before.identity).toEqual({
      path: canonicalJournalPath(p.journal),
      lock: `${canonicalJournalPath(p.journal)}.lock`,
      device: null,
      inode: null,
      links: null,
    });

    expect(appendReceipt(p, input({ event_id: "e1" })).disposition).toBe("succeeded");

    const after = resolveJournalIdentity(p.journal);
    expect(after.ok).toBe(true);
    // The name did not move when the file appeared…
    expect(after.identity!.path).toBe(before.identity!.path);
    expect(after.identity!.lock).toBe(before.identity!.lock);
    // …and it now carries the REAL file's identity, with exactly one name.
    const st = fs.statSync(fs.realpathSync(p.journal));
    expect(after.identity!.device).toBe(st.dev);
    expect(after.identity!.inode).toBe(st.ino);
    expect(after.identity!.links).toBe(1);

    // Every legal spelling lands on that one identity.
    for (const spelling of [
      path.join(root, "receipts", "..", "receipts", ".", "journal.jsonl"),
      path.join(root, "link", "journal.jsonl"),
      `${path.dirname(p.journal)}//journal.jsonl`,
    ]) {
      expect(resolveJournalIdentity(spelling).identity).toEqual(after.identity);
    }
  });

  it("keeps the guarded transaction on the canonical journal, not the caller's spelling", () => {
    const root = mkRoot();
    const p = paths(root);
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.symlinkSync(path.join(root, "receipts"), path.join(root, "link"));
    const viaLink = { journal: path.join(root, "link", "journal.jsonl"), checkpoint: p.checkpoint };
    const canonical = canonicalJournalPath(p.journal);

    const touched: string[] = [];
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(target) {
        if (target !== p.checkpoint) touched.push(target);
        return defaultJournalIo.readAll(target);
      },
      appendLine(target, text) {
        touched.push(target);
        defaultJournalIo.appendLine(target, text);
      },
    };

    expect(appendReceipt(viaLink, input({ event_id: "e1" }), io).disposition).toBe("succeeded");
    expect(touched.length).toBeGreaterThan(0);
    // Not one read or write reached the journal through the symlinked spelling.
    expect([...new Set(touched)]).toEqual([canonical]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R2-B5 — one event id names exactly ONE causal node
//
// Round 2 kept the FIRST sequence for a repeated event id and said nothing, so a
// two-record journal reusing `event-shared` under two operations scanned as
// `intact` with `blocks_clean_close: false`. Event ids are the causal graph's
// node names; reusing one makes every `causation_id` pointing at it ambiguous.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R2-B5 — a reused event id is an identity violation", () => {
  function reusedIdJournal(root: string) {
    const p = paths(root);
    const recs = [
      sealReceiptRecord({
        ...input({ event_id: "event-shared", operation_id: "op-A", input_hash: "sha256:one" }),
        sequence: 1,
      }),
      sealReceiptRecord({
        ...input({ event_id: "event-shared", operation_id: "op-B", input_hash: "sha256:two" }),
        sequence: 2,
      }),
    ];
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.writeFileSync(p.journal, recs.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    return p;
  }

  it("never reads a journal reusing one event id across two operations as intact", () => {
    const scan = scanReceiptJournal(reusedIdJournal(mkRoot()).journal);

    expect(scan.records).toHaveLength(2); // both records verify individually…
    expect(scan.duplicate_event_ids).toEqual(["event-shared"]);
    expect(scan.integrity).toBe("lineage_violation"); // …but the identity graph does not
    expect(scan.observation_state).not.toBe("checked_clean");
    expect(scan.blocks_clean_close).toBe(true);
  });

  it("reports the reuse from the shared analysis primitive, not just the scanner", () => {
    const recs = [
      sealReceiptRecord({ ...input({ event_id: "dup", operation_id: "op-A" }), sequence: 1 }),
      sealReceiptRecord({ ...input({ event_id: "dup", operation_id: "op-B" }), sequence: 2 }),
      sealReceiptRecord({ ...input({ event_id: "solo", operation_id: "op-C" }), sequence: 3 }),
    ];
    const analysis = analyzeReceiptRecords(recs);

    expect(analysis.duplicate_event_ids).toEqual(["dup"]);
    expect(analysis.structural_integrity).toBe("lineage_violation");
    // Reported ONCE per reused id, however many times it repeats.
    expect(
      analyzeReceiptRecords([...recs, sealReceiptRecord({ ...input({ event_id: "dup", operation_id: "op-D" }), sequence: 4 })])
        .duplicate_event_ids,
    ).toEqual(["dup"]);
  });

  it("a journal with all-distinct event ids reports none", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1", operation_id: "op-1" }));
    appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    const scan = scanReceiptJournal(p.journal);
    expect(scan.duplicate_event_ids).toEqual([]);
    expect(scan.integrity).toBe("intact");
  });

  it("refuses to APPEND a reused event id, so the defect cannot be created here", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "event-shared", operation_id: "op-A" }));
    const dup = appendReceipt(p, input({ event_id: "event-shared", operation_id: "op-B" }));

    expect(dup.disposition).toBe("refused");
    expect(dup.failure?.code).toBe("duplicate_event_id");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R2-B3 — a checkpoint is validated on its CONTENT, not its tag
//
// Round 2's `readCheckpoint` accepted anything carrying the right
// `schema_version`, so a checkpoint with `updated_at: 1900-01-01` and
// `contract_version: forged.contract.v999` was read as authoritative and
// produced zero disagreements.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R2-B3 — checkpoint validity and agreement", () => {
  function put(p: { checkpoint: string }, cp: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(p.checkpoint), { recursive: true });
    fs.writeFileSync(p.checkpoint, JSON.stringify(cp, null, 2) + "\n", "utf8");
  }
  function goodCheckpoint(over: Record<string, unknown> = {}) {
    return {
      schema_version: "guild.receipt_checkpoint.v1",
      run_id: "run-mh-06",
      last_sequence: 1,
      last_event_id: "e1",
      record_count: 1,
      updated_at: "2026-07-26T02:00:00.000Z",
      contract_version: RECEIPT_CONTRACT_VERSION,
      ...over,
    };
  }

  it("distinguishes absent from malformed — damage is not absence", () => {
    const root = mkRoot();
    const p = paths(root);
    expect(readCheckpointState(p.checkpoint)).toEqual({ state: "absent", checkpoint: null });

    fs.mkdirSync(path.dirname(p.checkpoint), { recursive: true });
    fs.writeFileSync(p.checkpoint, "{ not json", "utf8");
    expect(readCheckpointState(p.checkpoint).state).toBe("malformed");

    fs.writeFileSync(p.checkpoint, "", "utf8");
    expect(readCheckpointState(p.checkpoint).state).toBe("malformed");

    put(p, goodCheckpoint());
    expect(readCheckpointState(p.checkpoint).state).toBe("present");
  });

  it("rejects a checkpoint that carries the right tag but the wrong shape", () => {
    expect(isValidCheckpointShape(goodCheckpoint())).toBe(true);
    expect(isValidCheckpointShape(goodCheckpoint({ last_sequence: "1" }))).toBe(false);
    expect(isValidCheckpointShape(goodCheckpoint({ record_count: -1 }))).toBe(false);
    expect(isValidCheckpointShape(goodCheckpoint({ run_id: "" }))).toBe(false);
    expect(isValidCheckpointShape(goodCheckpoint({ updated_at: "" }))).toBe(false);
    expect(isValidCheckpointShape(goodCheckpoint({ contract_version: "" }))).toBe(false);
    const { record_count, ...missingCount } = goodCheckpoint();
    void record_count;
    expect(isValidCheckpointShape(missingCount)).toBe(false);
    // null last_event_id is legitimate for an empty journal.
    expect(isValidCheckpointShape(goodCheckpoint({ last_event_id: null }))).toBe(true);
  });

  it("names a stale timestamp and a forged contract version as disagreements", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));
    // Every field the round-2 probe kept in agreement…
    put(
      p,
      goodCheckpoint({ updated_at: "1900-01-01T00:00:00.000Z", contract_version: "forged.contract.v999" }),
    );

    const codes = compareCheckpointToJournal(
      readCheckpointState(p.checkpoint),
      scanReceiptJournal(p.journal),
      "run-mh-06",
    ).map((d) => d.code);

    // …and the two it forged are now named. `updated_at` is checked against the
    // recorded_at of the record the checkpoint NAMES, so staleness is detectable
    // with no clock at all.
    expect(codes).toEqual(["checkpoint_contract_mismatch", "checkpoint_timestamp_mismatch"]);
  });

  it("agrees with the checkpoint a real append writes", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1", operation_id: "op-1" }));
    appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    expect(
      compareCheckpointToJournal(
        readCheckpointState(p.checkpoint),
        scanReceiptJournal(p.journal),
        "run-mh-06",
      ),
    ).toEqual([]);
  });

  it("names an absent checkpoint beside a non-empty journal, and stays silent over an empty one", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));
    fs.rmSync(p.checkpoint, { force: true });
    expect(
      compareCheckpointToJournal(readCheckpointState(p.checkpoint), scanReceiptJournal(p.journal), "run-mh-06"),
    ).toEqual([{ code: "checkpoint_missing", expected: 1, actual: null }]);

    const empty = paths(mkRoot());
    expect(
      compareCheckpointToJournal(
        readCheckpointState(empty.checkpoint),
        scanReceiptJournal(empty.journal),
        "run-mh-06",
      ),
    ).toEqual([]);
  });

  it("a malformed checkpoint is a single explicit disagreement, never a clean read", () => {
    const root = mkRoot();
    const p = paths(root);
    appendReceipt(p, input({ event_id: "e1" }));
    fs.writeFileSync(p.checkpoint, '{"schema_version":"guild.receipt_checkpoint.v1"}', "utf8");

    expect(readCheckpoint(p.checkpoint)).toBeNull();
    expect(
      compareCheckpointToJournal(readCheckpointState(p.checkpoint), scanReceiptJournal(p.journal), "run-mh-06").map(
        (d) => d.code,
      ),
    ).toEqual(["checkpoint_malformed"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R5-B1 — authority is RETAINED through the mutation, not just checked
//
// Round 4 bound the lock to the physical journal and round 5 re-derived that
// identity once the lock was held. Round 5's review then showed a check is not
// authority: everything after it still ran through a MUTABLE PATHNAME.
//
//   - a hard link added after the under-lock check gave one inode two names, and
//     the other name's lock was already held — yet the append still landed
//     sequence 2 and replaced the checkpoint before the post-transaction check
//     noticed `nlink=2` and returned `failed`;
//   - renaming the canonical PARENT carried the acquired lock away with it, and a
//     replacement parent (with its own pre-held lock) then received the append,
//     the checkpoint and the torn-tail truncation — after which the `finally`
//     removed the REPLACEMENT writer's lock by pathname and stranded the lock
//     this caller actually holds.
//
// So the requirement is behavioural and it is about ORDER: a link-count change,
// a parent replacement or a competing lock must fail the operation BEFORE the
// append, the checkpoint or the truncation — and the release must never delete a
// lock this caller does not hold.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R5-B1 — mutation authority is retained from acquisition to release", () => {
  /** One durable record, so the journal is a real file with a real inode. */
  function seeded() {
    const root = mkRoot();
    const p = paths(root);
    expect(appendReceipt(p, input({ event_id: "seed", operation_id: "op-seed" })).disposition).toBe("succeeded");
    return { root, ...p };
  }

  const TORN = '{"schema_version":"guild.receipt_record.v1","seq';

  /** Fire `inject` exactly once, on the first read of the journal itself. */
  function onFirstJournalRead(inject: () => void): { io: JournalIo; fired: () => boolean } {
    let fired = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(target) {
        // Read BEFORE injecting, so the caller still sees the pre-race bytes —
        // exactly what a writer that already read the file would hold.
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

  /** Give the physical journal a SECOND name whose own lock is already held. */
  function aliasWithHeldLock(p: { journal: string }) {
    const alias = path.join(path.dirname(p.journal), "alias.jsonl");
    const aliasLock = `${alias}.lock`;
    return {
      alias,
      aliasLock,
      inject: () => {
        fs.linkSync(p.journal, alias);
        fs.mkdirSync(aliasLock);
      },
    };
  }

  /**
   * Rename the canonical parent out from under the lock — the acquired lock
   * directory travels WITH it — and install a replacement parent holding a copy
   * of the journal, a copy of the checkpoint, and a lock a different writer
   * already holds.
   */
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
    return {
      moved,
      replacementLock,
      strandedLock: `${path.join(moved, path.basename(p.journal))}.lock`,
    };
  }

  it("refuses the append when a hard link appears AFTER the under-lock check", () => {
    const p = seeded();
    const { alias, aliasLock, inject } = aliasWithHeldLock(p);
    const { io, fired } = onFirstJournalRead(inject);

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(fired()).toBe(true);
    expect(fs.statSync(p.journal).nlink).toBe(2); // the race really happened
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.sequence).toBeNull();
    expect(out.failure?.code).toBe("journal_identity_ambiguous");

    // THE POINT: the mutation never happened. Round 5 appended sequence 2 and
    // replaced the checkpoint with `last_sequence: 2` before failing the claim.
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    expect(readCheckpoint(p.checkpoint)!.record_count).toBe(1);
    // The other name's writer still holds its lock…
    expect(fs.existsSync(aliasLock)).toBe(true);
    // The alias is a SECOND canonical name for one inode — the whole defect.
    expect(canonicalJournalPath(alias)).toBe(fs.realpathSync(alias));
    expect(canonicalJournalPath(alias)).not.toBe(canonicalJournalPath(p.journal));
    expect(fs.statSync(alias).ino).toBe(fs.statSync(p.journal).ino);
    // …and this caller's own lock — still the one it acquired — was released.
    expect(fs.existsSync(`${fs.realpathSync(p.journal)}.lock`)).toBe(false);
  });

  it("refuses a torn-tail repair when a hard link appears AFTER the under-lock check", () => {
    const p = seeded();
    fs.appendFileSync(p.journal, TORN, "utf8");
    const bytesBefore = fs.readFileSync(p.journal, "utf8");
    const { aliasLock, inject } = aliasWithHeldLock(p);
    const { io, fired } = onFirstJournalRead(inject);

    const repair = repairTornTail(p.journal, io, { lock_max_attempts: 2, lock_wait_ms: 1 });

    expect(fired()).toBe(true);
    expect(repair.disposition).toBe("failed");
    expect(repair.failure?.code).toBe("journal_identity_ambiguous");
    expect(repair.removed_bytes).toBe(0);
    // A truncation under a partitioned exclusion domain did NOT happen.
    expect(fs.readFileSync(p.journal, "utf8")).toBe(bytesBefore);
    expect(fs.existsSync(aliasLock)).toBe(true);
  });

  it("refuses the append when the canonical PARENT is replaced after the check", () => {
    const p = seeded();
    let swap: ReturnType<typeof replaceCanonicalParent> | null = null;
    const { io, fired } = onFirstJournalRead(() => {
      swap = replaceCanonicalParent(p);
    });

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });
    const moved = swap as unknown as ReturnType<typeof replaceCanonicalParent>;

    expect(fired()).toBe(true);
    expect(moved).not.toBeNull();
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_identity_unstable");

    // Nothing was written into the replacement this writer never locked.
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    // The replacement's own writer still holds its lock — round 5's `finally`
    // deleted it by pathname.
    expect(fs.existsSync(moved.replacementLock)).toBe(true);
    // The lock this caller really holds went with the renamed parent. It cannot
    // be removed by name any more, so it is LEFT rather than a stranger's lock
    // being deleted in its place: fail closed, never delete somebody else's.
    expect(fs.existsSync(moved.strandedLock)).toBe(true);
  });

  it("refuses a torn-tail repair when the canonical PARENT is replaced after the check", () => {
    const p = seeded();
    fs.appendFileSync(p.journal, TORN, "utf8");
    const bytesBefore = fs.readFileSync(p.journal, "utf8");
    let swap: ReturnType<typeof replaceCanonicalParent> | null = null;
    const { io, fired } = onFirstJournalRead(() => {
      swap = replaceCanonicalParent(p);
    });

    const repair = repairTornTail(p.journal, io, { lock_max_attempts: 2, lock_wait_ms: 1 });
    const moved = swap as unknown as ReturnType<typeof replaceCanonicalParent>;

    expect(fired()).toBe(true);
    expect(repair.disposition).toBe("failed");
    expect(repair.failure?.code).toBe("journal_identity_unstable");
    expect(repair.removed_bytes).toBe(0);
    // Round 5 truncated the replacement and returned `succeeded`.
    expect(fs.readFileSync(p.journal, "utf8")).toBe(bytesBefore);
    expect(scanReceiptJournal(p.journal).integrity).toBe("truncated_tail");
    expect(fs.existsSync(moved.replacementLock)).toBe(true);
    expect(fs.existsSync(moved.strandedLock)).toBe(true);
  });

  it("refuses when a hard link appears between the append and the checkpoint", () => {
    // The window one step further in: authority is re-proved before EVERY
    // mutation, so the checkpoint cannot be replaced under a partitioned domain
    // even when the record itself was already appended under a sound one.
    const p = seeded();
    const { aliasLock, inject } = aliasWithHeldLock(p);
    let linked = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      appendLine(target, text) {
        defaultJournalIo.appendLine(target, text);
        if (!linked) {
          linked = true;
          inject();
        }
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(linked).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_identity_ambiguous");
    // The record IS on disk — it was appended under sound authority, and this is
    // the same shape as the round-1 `checkpoint_write_failed` sentinel: a durable
    // line with no durable CLAIM. What must not happen is the checkpoint moving.
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    expect(fs.existsSync(aliasLock)).toBe(true);
  });

  it("still appends, checkpoints and releases when authority is RETAINED", () => {
    // The discriminator. Without this, "refuse everything" would pass every
    // assertion above and pin nothing.
    const p = seeded();
    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    expect(out.disposition).toBe("succeeded");
    expect(out.durable).toBe(true);
    expect(out.sequence).toBe(2);
    expect(scanReceiptJournal(p.journal).record_count).toBe(2);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(2);
    expect(fs.existsSync(journalLockPath(p))).toBe(false);

    // …and a torn tail is still repaired, by byte length, through the same path.
    fs.appendFileSync(p.journal, TORN, "utf8");
    const repair = repairTornTail(p.journal);
    expect(repair.disposition).toBe("succeeded");
    expect(repair.removed_bytes).toBe(Buffer.byteLength(TORN, "utf8"));
    expect(scanReceiptJournal(p.journal).integrity).toBe("intact");
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });

  it("pins the physical journal by descriptor, and refuses one with a second name", () => {
    // The primitive itself, directly: authority is a HANDLE on an inode plus the
    // lock beside it, not a re-reading of a name.
    const p = seeded();
    const acquired = acquireJournalAuthority(p.journal, defaultJournalIo, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });
    expect(acquired.ok).toBe(true);
    try {
      const handle = acquired.authority!.handle;
      expect(handle).not.toBeNull();
      expect(handle!.inode).toBe(fs.statSync(p.journal).ino);
      expect(handle!.device).toBe(fs.statSync(p.journal).dev);
      expect(acquired.authority!.verify("in a control")).toBeNull();
      // Pinning is about identity, not permission: a read-only pin still holds
      // the file, and the WRITE falls back to the pathname so it fails with its
      // own errno instead of being misreported as a name that moved.
      expect(handle!.writable).toBe(false);
      defaultJournalIo.appendLine(canonicalJournalPath(p.journal), "not-a-record\n", handle);
      expect(fs.readFileSync(p.journal, "utf8").endsWith("not-a-record\n")).toBe(true);
      // A second name added under the handle is caught by the handle itself.
      fs.linkSync(p.journal, path.join(path.dirname(p.journal), "alias.jsonl"));
      expect(acquired.authority!.verify("in a control")?.code).toBe("journal_identity_ambiguous");
    } finally {
      acquired.authority!.release();
    }
    expect(fs.existsSync(`${fs.realpathSync(p.journal)}.lock`)).toBe(false);

    // …and the refusal is made BEFORE any lock is taken when the journal already
    // has two names when authority is requested.
    let locks = 0;
    const counting: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        locks += 1;
        return defaultJournalIo.acquireLock!(lockPath);
      },
    };
    const refused = acquireJournalAuthority(p.journal, counting, { lock_max_attempts: 2, lock_wait_ms: 1 });
    expect(refused.ok).toBe(false);
    expect(refused.failure?.code).toBe("journal_identity_ambiguous");
    expect(locks).toBe(0);
  });

  it("never removes a lock directory that is not the one it acquired", () => {
    // Release is identity-bound too: a lock replaced under us belongs to whoever
    // created it, and deleting it would hand two writers the same journal.
    const p = seeded();
    const lock = journalLockPath(p);
    let replaced = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(target) {
        const content = defaultJournalIo.readAll(target);
        if (!replaced && path.basename(target) === "journal.jsonl") {
          replaced = true;
          // Our lock is swapped for a different directory at the same name.
          fs.rmdirSync(lock);
          fs.mkdirSync(lock);
        }
        return content;
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(replaced).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_identity_unstable");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    // The directory now at that name is somebody else's exclusion, not ours.
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmdirSync(lock);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R6-B1 / MH-06-R6-B2 — the lock object is identified BY the acquisition,
// and every mutation gate sits in the same frame as its syscall
//
// Round 6 kept authority as a set of stat comparisons taken AFTER the acquiring
// call returned, and re-proved them one function call before each mutation. The
// round-6 review occupied both intervals:
//
//   - B1: the lock directory was replaced between `acquireJournalLock` returning
//     and the `lstat` that sampled it. The replacement became this caller's
//     recorded identity, every later check agreed with it, the append landed, and
//     the release deleted the REPLACEMENT holder's lock;
//   - B2: a competing hard link was introduced after `verify("before the append")`
//     and before the append syscall. The claim failed — after the journal had
//     already gained the second record.
//
// So the requirement is mechanical, not diligent: the identity must come OUT of
// the acquisition, and the last proof before a mutation must be inside the call
// frame that performs it. A refusal that arrives after the bytes changed is not
// a refusal.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R6-B1/B2 — acquisition yields the identity, and the gate is in the syscall frame", () => {
  /** One durable record, so the journal is a real file with a real inode. */
  function seeded() {
    const root = mkRoot();
    const p = paths(root);
    expect(appendReceipt(p, input({ event_id: "seed", operation_id: "op-seed" })).disposition).toBe("succeeded");
    return { root, ...p };
  }

  const TORN = '{"schema_version":"guild.receipt_record.v1","seq';

  /** Give the physical journal a SECOND name whose own lock is already held. */
  function aliasWithHeldLock(p: { journal: string }) {
    const alias = path.join(path.dirname(p.journal), "alias.jsonl");
    const aliasLock = `${alias}.lock`;
    return {
      alias,
      aliasLock,
      inject: () => {
        fs.linkSync(p.journal, alias);
        fs.mkdirSync(aliasLock);
      },
    };
  }

  /**
   * Replace the lock object in the EXACT window the review used: after the
   * acquiring primitive returned, before the caller could look at what it got.
   * The seam wrapper is the only code that can occupy that interval, which is
   * precisely why the identity has to be produced by the primitive itself.
   */
  function swapLockDuringAcquisition(): { io: JournalIo; swapped: () => boolean } {
    let swapped = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        const got = defaultJournalIo.acquireLock!(lockPath);
        if (got && !swapped) {
          swapped = true;
          fs.rmSync(lockPath, { recursive: true, force: true });
          fs.mkdirSync(lockPath);
        }
        return got;
      },
    };
    return { io, swapped: () => swapped };
  }

  it("never adopts a lock object substituted after its own acquisition", () => {
    const p = seeded();
    const lock = journalLockPath(p);
    const { io, swapped } = swapLockDuringAcquisition();

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(swapped()).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_identity_unstable");
    // THE POINT: nothing was mutated under an exclusion this caller never held.
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    // …and the replacement holder's lock is still THEIRS. Round 6 deleted it.
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("refuses authority outright when its own lock object is replaced mid-acquisition", () => {
    // The primitive, directly: `acquireJournalAuthority` must not hand back an
    // authority whose lock is a directory somebody else created.
    const p = seeded();
    const lock = journalLockPath(p);
    const { io, swapped } = swapLockDuringAcquisition();
    const replacementInode = (() => {
      const acquired = acquireJournalAuthority(p.journal, io, { lock_max_attempts: 2, lock_wait_ms: 1 }, "append");
      expect(swapped()).toBe(true);
      expect(acquired.ok).toBe(false);
      expect(acquired.failure?.code).toBe("journal_identity_unstable");
      return fs.statSync(lock).ino;
    })();

    // The lock at that name was never this caller's, so it is left intact.
    expect(fs.existsSync(lock)).toBe(true);
    expect(fs.statSync(lock).ino).toBe(replacementInode);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("refuses BEFORE the append syscall when a link appears after the final check", () => {
    const p = seeded();
    const { aliasLock, inject } = aliasWithHeldLock(p);
    let fired = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      // The seam wrapper occupies the whole interval between the caller's last
      // gate and the write itself — the exact interleaving of MH-06-R6-B2.
      appendLine(...args: Parameters<JournalIo["appendLine"]>) {
        if (!fired) {
          fired = true;
          inject();
        }
        defaultJournalIo.appendLine(...args);
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(fired).toBe(true);
    expect(fs.statSync(p.journal).nlink).toBe(2); // the race really happened
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_identity_ambiguous");
    // THE POINT: the journal never gained the second record. Round 6 returned
    // this same typed failure with `journal_records: 2` already on disk.
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    expect(fs.existsSync(aliasLock)).toBe(true);
  });

  it("refuses BEFORE the append syscall when the canonical parent is replaced after the final check", () => {
    const p = seeded();
    let fired = false;
    let replacementLock = "";
    const io: JournalIo = {
      ...defaultJournalIo,
      appendLine(...args: Parameters<JournalIo["appendLine"]>) {
        if (!fired) {
          fired = true;
          const parent = path.dirname(fs.realpathSync(p.journal));
          const bytes = fs.readFileSync(p.journal);
          fs.renameSync(parent, `${parent}-moved`);
          fs.mkdirSync(parent, { recursive: true });
          fs.writeFileSync(path.join(parent, path.basename(p.journal)), bytes);
          replacementLock = `${path.join(parent, path.basename(p.journal))}.lock`;
          fs.mkdirSync(replacementLock);
        }
        defaultJournalIo.appendLine(...args);
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(fired).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_identity_unstable");
    // Nothing landed in the replacement this writer never locked…
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    // …and the replacement holder's lock survives.
    expect(fs.existsSync(replacementLock)).toBe(true);
  });

  it("refuses BEFORE the checkpoint write when the domain detaches after the final check", () => {
    const p = seeded();
    const { aliasLock, inject } = aliasWithHeldLock(p);
    let fired = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      writeCheckpoint(...args: Parameters<JournalIo["writeCheckpoint"]>) {
        if (!fired) {
          fired = true;
          inject();
        }
        defaultJournalIo.writeCheckpoint(...args);
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(fired).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_identity_ambiguous");
    // The record was appended under a sound domain — the round-1 shape of a
    // durable line with no durable CLAIM — but the checkpoint did NOT move.
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    expect(readCheckpoint(p.checkpoint)!.record_count).toBe(1);
    expect(fs.existsSync(aliasLock)).toBe(true);
  });

  it("refuses BEFORE the truncation syscall when a link appears after the final check", () => {
    const p = seeded();
    fs.appendFileSync(p.journal, TORN, "utf8");
    const bytesBefore = fs.readFileSync(p.journal, "utf8");
    const { aliasLock, inject } = aliasWithHeldLock(p);
    let fired = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      truncate(...args: Parameters<JournalIo["truncate"]>) {
        if (!fired) {
          fired = true;
          inject();
        }
        defaultJournalIo.truncate(...args);
      },
    };

    const repair = repairTornTail(p.journal, io, { lock_max_attempts: 2, lock_wait_ms: 1 });

    expect(fired).toBe(true);
    expect(repair.disposition).toBe("failed");
    expect(repair.failure?.code).toBe("journal_identity_ambiguous");
    expect(repair.removed_bytes).toBe(0);
    // THE POINT: the destructive syscall never ran.
    expect(fs.readFileSync(p.journal, "utf8")).toBe(bytesBefore);
    expect(scanReceiptJournal(p.journal).integrity).toBe("truncated_tail");
    expect(fs.existsSync(aliasLock)).toBe(true);
  });

  it("still appends, checkpoints and truncates when the domain is held THROUGH the syscall", () => {
    // The discriminator for both gates: a guard that refused everything would
    // pass every assertion above and pin nothing.
    const p = seeded();
    let appends = 0;
    let checkpoints = 0;
    let truncations = 0;
    const io: JournalIo = {
      ...defaultJournalIo,
      appendLine(...args: Parameters<JournalIo["appendLine"]>) {
        appends += 1;
        defaultJournalIo.appendLine(...args);
      },
      writeCheckpoint(...args: Parameters<JournalIo["writeCheckpoint"]>) {
        checkpoints += 1;
        defaultJournalIo.writeCheckpoint(...args);
      },
      truncate(...args: Parameters<JournalIo["truncate"]>) {
        truncations += 1;
        defaultJournalIo.truncate(...args);
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io);
    expect(out.disposition).toBe("succeeded");
    expect(out.durable).toBe(true);
    expect(out.sequence).toBe(2);
    expect(appends).toBe(1);
    expect(checkpoints).toBe(1);
    expect(scanReceiptJournal(p.journal).record_count).toBe(2);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(2);

    fs.appendFileSync(p.journal, TORN, "utf8");
    const repair = repairTornTail(p.journal, io);
    expect(repair.disposition).toBe("succeeded");
    expect(repair.removed_bytes).toBe(Buffer.byteLength(TORN, "utf8"));
    expect(truncations).toBe(1);
    expect(scanReceiptJournal(p.journal).integrity).toBe("intact");
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R6-B3 — the append's checkpoint parent is part of the exclusion domain
//
// `appendReceipt` replaces the checkpoint too. When the caller puts it outside
// the journal's own directory, the journal-parent pin says nothing about it, so
// the domain has to name it explicitly.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R6-B3 — an append holds the checkpoint's parent when it lives elsewhere", () => {
  function splitPaths(root: string) {
    const p = {
      journal: path.join(root, "receipts", "journal.jsonl"),
      checkpoint: path.join(root, "state", "checkpoint.json"),
    };
    fs.mkdirSync(path.dirname(p.journal), { recursive: true });
    fs.mkdirSync(path.dirname(p.checkpoint), { recursive: true });
    return p;
  }

  it("refuses when the FOREIGN checkpoint parent is replaced under the transaction", () => {
    const p = splitPaths(mkRoot());
    expect(appendReceipt(p, input({ event_id: "seed", operation_id: "op-seed" })).disposition).toBe("succeeded");

    let fired = false;
    let replacement = "";
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(...args: Parameters<JournalIo["readAll"]>) {
        const content = defaultJournalIo.readAll(...args);
        if (!fired && path.basename(args[0]) === "journal.jsonl") {
          fired = true;
          replacement = fs.realpathSync(path.dirname(p.checkpoint));
          fs.renameSync(replacement, `${replacement}-moved`);
          fs.mkdirSync(replacement, { recursive: true });
        }
        return content;
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(fired).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_identity_unstable");
    // Nothing was mutated on either side of the split layout.
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(fs.readdirSync(replacement)).toEqual([]);
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });

  it("refuses when the checkpoint's parent SYMLINK is repointed at an untouched directory", () => {
    // The neighbouring bypass: no physical directory is replaced at all. `<root>/a`
    // and `<root>/b` both exist and neither is modified — only the NAME between
    // the caller and the destination moves, so a device/inode pin alone sees
    // nothing. `atomicWrite` renames into `dirname(checkpointPath)`, so that is
    // the directory this transaction was granted and the only one it may use.
    const root = mkRoot();
    const p = {
      journal: path.join(root, "receipts", "journal.jsonl"),
      checkpoint: path.join(root, "link", "checkpoint.json"),
    };
    fs.mkdirSync(path.join(root, "receipts"), { recursive: true });
    fs.mkdirSync(path.join(root, "a"), { recursive: true });
    fs.mkdirSync(path.join(root, "b"), { recursive: true });
    fs.symlinkSync(path.join(root, "a"), path.join(root, "link"));
    expect(appendReceipt(p, input({ event_id: "seed", operation_id: "op-seed" })).disposition).toBe("succeeded");

    let fired = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      readAll(...args: Parameters<JournalIo["readAll"]>) {
        const content = defaultJournalIo.readAll(...args);
        if (!fired && path.basename(args[0]) === "journal.jsonl") {
          fired = true;
          fs.unlinkSync(path.join(root, "link"));
          fs.symlinkSync(path.join(root, "b"), path.join(root, "link"));
        }
        return content;
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(fired).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_identity_unstable");
    // Nothing was written into the directory this writer was never granted…
    expect(fs.readdirSync(path.join(root, "b"))).toEqual([]);
    // …and the one it WAS granted still holds only the seed's checkpoint.
    expect(fs.readdirSync(path.join(root, "a"))).toEqual(["checkpoint.json"]);
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
  });

  it("still appends and checkpoints across a split layout that is held throughout", () => {
    const p = splitPaths(mkRoot());
    expect(appendReceipt(p, input({ event_id: "seed", operation_id: "op-seed" })).disposition).toBe("succeeded");
    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    expect(out.disposition).toBe("succeeded");
    expect(out.durable).toBe(true);
    expect(out.sequence).toBe(2);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(2);
    expect(scanReceiptJournal(p.journal).record_count).toBe(2);
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R7-NB1 — an acquisition that names no lock object cannot mutate, and
// cannot be released by pathname
//
// Round 6 was closed by making the acquiring primitive name what it created, and
// round 7 kept that identity alive across a wrapper that discards the returned
// grant by ALSO publishing it out of band. Both fixes assumed the acquisition
// would leave an identity somewhere. The round-7 review supplied one that does
// not: a fully custom `JournalIo.acquireLock` that really does `mkdir` the lock,
// replaces the directory before returning, and reports success as a bare `true`.
//
// With no returned grant and no publication the module recorded `grant: null`,
// which it read as "an injected seam — skip the lock checks". So the lock-object
// comparison never ran, the append and the checkpoint landed under a directory
// this writer never created, and the release deleted it by pathname: the
// REPLACEMENT holder's exclusion, taken away by a writer that could not name
// either lock. The reviewer measured disposition=succeeded, durable=true,
// sequence=2, journal and checkpoint at 2, and the replacement gone.
//
// "I hold it but I cannot tell you what I took" is therefore not a success this
// module may act on. It fails closed at the acquisition, before any journal,
// checkpoint, truncation or repair mutation, and it LEAKS the object at that
// name rather than deleting an exclusion it cannot recognise — a wedged journal
// needs an operator, two writers sharing one journal need a forensics team.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R7-NB1 — a grantless acquisition fails closed and is never released by pathname", () => {
  /** One durable record, so the journal is a real file with a real inode. */
  function seeded() {
    const root = mkRoot();
    const p = paths(root);
    expect(appendReceipt(p, input({ event_id: "seed", operation_id: "op-seed" })).disposition).toBe("succeeded");
    return { root, ...p };
  }

  const TORN_TAIL = '{"schema_version":"guild.receipt_record.v1","seq';

  /**
   * The reviewer's exact seam. Nothing here is a stub: it takes a real
   * `mkdir`-based lock, it reports contention as `false`, it raises real IO
   * faults, and it releases by pathname. The one thing it never does is say WHAT
   * it took — and, optionally, it hands the name to a different directory in the
   * instant before it returns.
   */
  function bareBooleanSeam(opts: { substitute: boolean }): {
    io: JournalIo;
    acquired: () => boolean;
    substituted: () => boolean;
    released: () => boolean;
  } {
    let acquired = false;
    let substituted = false;
    let released = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        try {
          fs.mkdirSync(lockPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
          throw err;
        }
        acquired = true;
        if (opts.substitute && !substituted) {
          substituted = true;
          // Another holder takes the NAME in the window only the seam can occupy.
          fs.rmSync(lockPath, { recursive: true, force: true });
          fs.mkdirSync(lockPath);
        }
        return true; // …and the caller is told nothing about the object.
      },
      releaseLock(lockPath) {
        released = true;
        fs.rmSync(lockPath, { recursive: true, force: true });
      },
    };
    return { io, acquired: () => acquired, substituted: () => substituted, released: () => released };
  }

  it("refuses the bare-boolean substitution instead of appending and deleting the replacement", () => {
    const p = seeded();
    const lock = journalLockPath(p);
    const seam = bareBooleanSeam({ substitute: true });

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), seam.io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(seam.acquired()).toBe(true);
    expect(seam.substituted()).toBe(true); // the race really happened

    // One assertion, so a regression prints the reviewer's whole observation at
    // once: on the round-7 bytes this reads succeeded/true/2/2/2/false/true.
    expect({
      disposition: out.disposition,
      durable: out.durable,
      sequence: out.sequence,
      failure_code: out.failure?.code ?? null,
      journal_records: scanReceiptJournal(p.journal).record_count,
      checkpoint_sequence: readCheckpoint(p.checkpoint)?.last_sequence ?? null,
      replacement_lock_still_exists: fs.existsSync(lock),
      released_by_pathname: seam.released(),
    }).toEqual({
      disposition: "failed",
      durable: false,
      sequence: null,
      failure_code: "journal_lock_failed",
      journal_records: 1,
      checkpoint_sequence: 1,
      replacement_lock_still_exists: true,
      released_by_pathname: false,
    });

    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("refuses a grantless acquisition even when nothing substitutes it, and leaks rather than deletes", () => {
    // No substitution at all: the seam holds the very directory it created. It
    // still cannot be adopted, because the module has no way to tell this case
    // apart from the substituted one — that indistinguishability IS the defect.
    const p = seeded();
    const lock = journalLockPath(p);
    const seam = bareBooleanSeam({ substitute: false });

    const acquired = acquireJournalAuthority(p.journal, seam.io, { lock_max_attempts: 2, lock_wait_ms: 1 }, "append");

    expect(seam.acquired()).toBe(true);
    expect(acquired.ok).toBe(false);
    expect(acquired.authority).toBeNull();
    expect(acquired.failure?.code).toBe("journal_lock_failed");
    // Releasing by pathname is precisely how a replacement holder's exclusion
    // gets deleted, so an unidentifiable lock is left exactly where it is.
    expect(seam.released()).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("refuses a torn-tail repair under a grantless acquisition, with every byte untouched", () => {
    const p = seeded();
    fs.appendFileSync(p.journal, TORN_TAIL);
    const before = fs.readFileSync(p.journal);
    const lock = journalLockPath(p);
    const seam = bareBooleanSeam({ substitute: true });

    const repair = repairTornTail(p.journal, seam.io, { lock_max_attempts: 2, lock_wait_ms: 1 });

    expect(seam.substituted()).toBe(true);
    expect(repair.disposition).toBe("failed");
    expect(repair.failure?.code).toBe("journal_lock_failed");
    expect(repair.removed_bytes).toBe(0);
    // A truncation is irreversible; refusing after it has run is not refusing.
    expect(fs.readFileSync(p.journal).equals(before)).toBe(true);
    expect(seam.released()).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("refuses a returned grant that contradicts the primitive which created the lock", () => {
    // The neighbouring shape: the seam DOES return a well-formed grant, but it
    // calls the default primitive first and then names the replacement it put
    // at that name instead. Believing the returned object over the primitive's
    // own publication reinstates the whole round-6 substitution — with a valid
    // identity attached, so every later check agrees and the release deletes the
    // stranger's directory.
    const p = seeded();
    const lock = journalLockPath(p);
    let contradicted = false;
    let released = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        const real = defaultJournalIo.acquireLock!(lockPath);
        if (typeof real !== "object") return real;
        fs.rmSync(lockPath, { recursive: true, force: true });
        fs.mkdirSync(lockPath);
        const replacement = fs.lstatSync(lockPath);
        contradicted = true;
        return { path: lockPath, device: replacement.dev, inode: replacement.ino, fd: null };
      },
      releaseLock(lockPath) {
        released = true;
        fs.rmSync(lockPath, { recursive: true, force: true });
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(contradicted).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_lock_failed");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    expect(released).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("refuses a malformed grant claim instead of repairing it from the pathname", () => {
    const p = seeded();
    const lock = journalLockPath(p);
    let released = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        fs.mkdirSync(lockPath);
        // Shaped like a grant, names nothing: no device, no inode, no descriptor.
        return { path: lockPath } as unknown as JournalLockGrant;
      },
      releaseLock(lockPath) {
        released = true;
        fs.rmSync(lockPath, { recursive: true, force: true });
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_lock_failed");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(released).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  // ── Controls. These separate "a grantless acquisition fails closed" from
  //    "custom lock seams stopped working", which is the way a fail-closed rule
  //    usually goes wrong.

  it("still appends under a wrapper that calls the default primitive and returns bare true", () => {
    // The attempt-7 shape, kept alive: the returned grant is thrown away, but the
    // primitive published it out of band, so the identity is still claimed and
    // still verified.
    const p = seeded();
    let discarded = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        const got = defaultJournalIo.acquireLock!(lockPath);
        if (!got) return false;
        discarded = true;
        return true;
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(discarded).toBe(true);
    expect(out.disposition).toBe("succeeded");
    expect(out.durable).toBe(true);
    expect(out.sequence).toBe(2);
    expect(scanReceiptJournal(p.journal).record_count).toBe(2);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(2);
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });

  it("still catches a substitution under that same discarding wrapper", () => {
    const p = seeded();
    const lock = journalLockPath(p);
    let swapped = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        const got = defaultJournalIo.acquireLock!(lockPath);
        if (!got) return false;
        swapped = true;
        fs.rmSync(lockPath, { recursive: true, force: true });
        fs.mkdirSync(lockPath);
        return true; // the grant is discarded — the publication is not
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(swapped).toBe(true);
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_identity_unstable");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("still appends under a custom seam that returns its own valid grant", () => {
    const p = seeded();
    let granted = false;
    let released = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        try {
          fs.mkdirSync(lockPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
          throw err;
        }
        // Named inside the frame that created it, with nothing in between — the
        // same discipline the default primitive follows. `fd: null` is the
        // platform that will not open a directory.
        const created = fs.lstatSync(lockPath);
        granted = true;
        return { path: lockPath, device: created.dev, inode: created.ino, fd: null };
      },
      releaseLock(lockPath) {
        released = true;
        fs.rmSync(lockPath, { recursive: true, force: true });
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(granted).toBe(true);
    expect(out.disposition).toBe("succeeded");
    expect(out.durable).toBe(true);
    expect(out.sequence).toBe(2);
    expect(scanReceiptJournal(p.journal).record_count).toBe(2);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(2);
    // A lock this writer CAN name is the one it is allowed to take away again.
    expect(released).toBe(true);
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });

  it("keeps ordinary contention typed, bounded and non-mutating", () => {
    const p = seeded();
    let attempts = 0;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock() {
        attempts += 1;
        return false; // somebody else holds it — not a grantless success
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 3,
      lock_wait_ms: 1,
    });

    expect(attempts).toBe(3); // bounded, and every attempt was made
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.failure?.code).toBe("journal_lock_unavailable");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
  });

  it("keeps a thrown lock IO fault typed, unretried and non-mutating", () => {
    const p = seeded();
    let calls = 0;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock() {
        calls += 1;
        throw new Error("EROFS: read-only file system, mkdir");
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 3,
      lock_wait_ms: 1,
    });

    expect(calls).toBe(1); // a fault is not contention, so it is not retried
    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_lock_failed");
    expect(out.failure?.message).toContain("EROFS");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });

  it("still appends under the untouched default primitive", () => {
    // The plain path, last, so a failure here says the fix reached past the seams.
    const p = seeded();
    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }));

    expect(out.disposition).toBe("succeeded");
    expect(out.durable).toBe(true);
    expect(out.sequence).toBe(2);
    expect(scanReceiptJournal(p.journal).record_count).toBe(2);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(2);
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MH-06-R8-C1 — a published grant authorises ONE call, and dies with it
//
// Round 7 kept the discarding wrapper working by letting the default primitive
// publish the identity it created OUT OF BAND, keyed by the lock path. Round 8's
// review found the neighbour that opened: a wrapper is not obliged to tell the
// truth about what it just did. A seam that calls `defaultJournalIo.acquireLock`,
// REALLY creates the lock, and then returns `false` left the grant sitting in
// that module-level map — the `false` branch retried and the exhaustion path
// returned `journal_lock_unavailable` without ever draining it.
//
// The reviewer then made a wholly separate call whose `acquireLock` acquires
// nothing and answers with a bare `true`. It claimed the abandoned publication,
// satisfied every identity check with it (the object really did exist), appended
// durably as sequence 2, replaced the checkpoint, and released — deleting a lock
// the first caller had created and this one had never taken:
//
//   first_failure_code=journal_lock_unavailable, lock_exists_before_second=true,
//   second_disposition=succeeded, second_durable=true, second_sequence=2,
//   journal_records_after_second=2, released=true, lock_exists_after_second=false
//
// A grant is therefore CALL-SCOPED. The publication window opens immediately
// before one `acquireLock` invocation and closes immediately after it, whatever
// that invocation returned; a refusal — `false`, a throw, a contradiction, a
// malformed claim — takes its publication with it, and a publication made while
// no acquisition is in flight belongs to nobody. What sits at the lock's
// pathname is left exactly where it is: this module still never deletes an
// object it cannot recognise as its own.
// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06-R8-C1 — a published lock grant authorises only the acquisition call that created it", () => {
  function seedAt(p: { journal: string; checkpoint: string }, tag: string) {
    expect(appendReceipt(p, input({ event_id: `seed-${tag}`, operation_id: `op-seed-${tag}` })).disposition).toBe(
      "succeeded",
    );
    return p;
  }

  /** One durable record, so the journal is a real file with a real inode. */
  function seeded() {
    return seedAt(paths(mkRoot()), "one");
  }

  /** A seam that acquires NOTHING and claims the lock anyway. */
  function grantlessSeam(): { io: JournalIo; calls: () => number; released: () => boolean } {
    let calls = 0;
    let released = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock() {
        calls += 1;
        return true; // no mkdir, no object, no identity — just the word "yes"
      },
      releaseLock(lockPath) {
        released = true;
        fs.rmSync(lockPath, { recursive: true, force: true });
      },
    };
    return { io, calls: () => calls, released: () => released };
  }

  it("refuses the reviewer's cross-call bypass: a false-returning wrapper seeds no later acquisition", () => {
    const p = seeded();
    const lock = journalLockPath(p);

    // CALL ONE. The wrapper really takes the lock through the default primitive —
    // the directory is created and the grant is published — and then says `false`.
    let lied = false;
    const liar: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        const real = defaultJournalIo.acquireLock!(lockPath);
        if (!real) return false; // later attempts: EEXIST, ordinary contention
        lied = true;
        return false;
      },
    };
    const first = appendReceipt(p, input({ event_id: "e-first", operation_id: "op-2" }), liar, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    // CALL TWO. Wholly separate, acquires nothing, and reports that it holds it.
    const second = grantlessSeam();
    const lockExistsBeforeSecond = fs.existsSync(lock);
    const out = appendReceipt(p, input({ event_id: "e-second", operation_id: "op-3" }), second.io, {
      lock_max_attempts: 1,
      lock_wait_ms: 1,
    });

    expect(lied).toBe(true);
    expect(second.calls()).toBe(1);

    // One assertion in the reviewer's own field names, so a regression prints the
    // whole probe at once: on the attempt-8 bytes this reads
    // unavailable/true/succeeded/true/2/null/2/true/false.
    expect({
      first_failure_code: first.failure?.code ?? null,
      lock_exists_before_second: lockExistsBeforeSecond,
      second_disposition: out.disposition,
      second_durable: out.durable,
      second_sequence: out.sequence,
      second_failure_code: out.failure?.code ?? null,
      journal_records_after_second: scanReceiptJournal(p.journal).record_count,
      released: second.released(),
      lock_exists_after_second: fs.existsSync(lock),
    }).toEqual({
      first_failure_code: "journal_lock_unavailable",
      lock_exists_before_second: true,
      second_disposition: "failed",
      second_durable: false,
      second_sequence: null,
      second_failure_code: "journal_lock_failed",
      journal_records_after_second: 1,
      released: false,
      lock_exists_after_second: true,
    });
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);

    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("does not seed a later bare-true attempt inside the same acquisition loop", () => {
    // The same lie, one retry apart instead of one call apart. A loop that hands
    // attempt N's publication to attempt N+1 is the cross-call defect in miniature.
    const p = seeded();
    const lock = journalLockPath(p);
    let calls = 0;
    let released = false;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        calls += 1;
        if (calls === 1) {
          defaultJournalIo.acquireLock!(lockPath); // really taken, really published…
          return false; // …and denied to the very caller that asked for it
        }
        return true; // the next attempt claims to hold what it never took
      },
      releaseLock(lockPath) {
        released = true;
        fs.rmSync(lockPath, { recursive: true, force: true });
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(calls).toBe(2);
    expect(out.disposition).toBe("failed");
    expect(out.durable).toBe(false);
    expect(out.sequence).toBeNull();
    expect(out.failure?.code).toBe("journal_lock_failed");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(1);
    expect(released).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("cannot claim a publication made while no acquisition was in flight at all", () => {
    // Nothing is acquiring here. A cleanup helper, a release seam, or a harness
    // touching the primitive directly all land in this shape: the lock object is
    // real, and it authorises precisely nobody.
    const p = seeded();
    const lock = journalLockPath(p);
    const stray = defaultJournalIo.acquireLock!(lock);
    expect(typeof stray).toBe("object");

    const seam = grantlessSeam();
    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), seam.io, {
      lock_max_attempts: 1,
      lock_wait_ms: 1,
    });

    expect(out.disposition).toBe("failed");
    expect(out.failure?.code).toBe("journal_lock_failed");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(seam.released()).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);

    if (typeof stray === "object" && stray.fd !== null) fs.closeSync(stray.fd);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("leaves nothing claimable behind when the release itself fails", () => {
    // A release that throws leaves the lock on disk. That wreckage is a reason for
    // the NEXT writer to fail closed, never a stock of authority it can draw on.
    const p = seeded();
    const lock = journalLockPath(p);
    let releaseAttempted = false;
    const failingRelease: JournalIo = {
      ...defaultJournalIo,
      releaseLock() {
        releaseAttempted = true;
        throw new Error("EBUSY: lock directory could not be removed");
      },
    };

    const first = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), failingRelease, {
      lock_max_attempts: 2,
      lock_wait_ms: 1,
    });

    expect(first.disposition).toBe("succeeded");
    expect(first.sequence).toBe(2);
    expect(releaseAttempted).toBe(true);
    expect(fs.existsSync(lock)).toBe(true);

    const seam = grantlessSeam();
    const second = appendReceipt(p, input({ event_id: "e3", operation_id: "op-3" }), seam.io, {
      lock_max_attempts: 1,
      lock_wait_ms: 1,
    });

    expect(second.disposition).toBe("failed");
    expect(second.failure?.code).toBe("journal_lock_failed");
    expect(scanReceiptJournal(p.journal).record_count).toBe(2);
    expect(seam.released()).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  it("cannot claim a publication that belongs to a different journal's lock", () => {
    // Two journals, two locks, one process. A grant published for B is not a grant
    // for A, and it is not a grant for B's next writer either.
    const root = mkRoot();
    const a = seedAt(
      { journal: path.join(root, "a", "journal.jsonl"), checkpoint: path.join(root, "a", "cp.json") },
      "a",
    );
    const b = seedAt(
      { journal: path.join(root, "b", "journal.jsonl"), checkpoint: path.join(root, "b", "cp.json") },
      "b",
    );
    const lockA = journalLockPath(a);
    const lockB = journalLockPath(b);

    let crossed = false;
    const crossing: JournalIo = {
      ...defaultJournalIo,
      acquireLock() {
        if (!crossed) {
          crossed = true;
          defaultJournalIo.acquireLock!(lockB); // asked about A, takes B
        }
        return true; // …and answers for A with a bare `true`
      },
    };
    const outA = appendReceipt(a, input({ event_id: "e-a", operation_id: "op-a2" }), crossing, {
      lock_max_attempts: 1,
      lock_wait_ms: 1,
    });

    const seam = grantlessSeam();
    const outB = appendReceipt(b, input({ event_id: "e-b", operation_id: "op-b2" }), seam.io, {
      lock_max_attempts: 1,
      lock_wait_ms: 1,
    });

    expect(crossed).toBe(true);
    expect(outA.failure?.code).toBe("journal_lock_failed");
    expect(outB.failure?.code).toBe("journal_lock_failed");
    expect(scanReceiptJournal(a.journal).record_count).toBe(1);
    expect(scanReceiptJournal(b.journal).record_count).toBe(1);
    expect(seam.released()).toBe(false);
    expect(fs.existsSync(lockA)).toBe(false); // never created — nothing to leak
    expect(fs.existsSync(lockB)).toBe(true); // the seam's own doing, left alone
    fs.rmSync(lockB, { recursive: true, force: true });
  });

  it("refuses an overlapping inner acquisition rather than lending it this call's grant", () => {
    // Two acquisitions for ONE lock path in flight at once: the seam re-enters the
    // append while its own acquisition is still open. The inner call took nothing,
    // so it must hold nothing — and the outer call's own grant must survive it.
    const p = seeded();
    const lock = journalLockPath(p);
    let reentered = false;
    let innerDisposition: string | null = null;
    let innerFailure: string | null = null;

    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        if (reentered) return true; // the INNER acquisition: overlapping and grantless
        reentered = true;
        const real = defaultJournalIo.acquireLock!(lockPath); // this call's own object
        const nested = appendReceipt(p, input({ event_id: "e-inner", operation_id: "op-inner" }), io, {
          lock_max_attempts: 1,
          lock_wait_ms: 1,
        });
        innerDisposition = nested.disposition;
        innerFailure = nested.failure?.code ?? null;
        return real; // …reported honestly, exactly as the primitive named it
      },
    };

    const out = appendReceipt(p, input({ event_id: "e-outer", operation_id: "op-outer" }), io, {
      lock_max_attempts: 1,
      lock_wait_ms: 1,
    });

    expect(reentered).toBe(true);
    expect(innerDisposition).toBe("failed");
    expect(innerFailure).toBe("journal_lock_failed");
    // …and the call that really did acquire is unharmed by the one that did not.
    expect(out.disposition).toBe("succeeded");
    expect(out.sequence).toBe(2);
    const after = scanReceiptJournal(p.journal);
    expect(after.record_count).toBe(2);
    expect(after.records.some((r) => r.event_id === "e-inner")).toBe(false);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("keeps a fault thrown after a real acquisition typed, unretried and unclaimable", () => {
    const p = seeded();
    const lock = journalLockPath(p);
    let calls = 0;
    const faulty: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        calls += 1;
        defaultJournalIo.acquireLock!(lockPath); // the lock is really taken…
        throw new Error("EIO: lock bookkeeping failed"); // …and the call still faults
      },
    };

    const first = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), faulty, {
      lock_max_attempts: 3,
      lock_wait_ms: 1,
    });

    expect(calls).toBe(1); // a fault is not contention, so it is not retried
    expect(first.failure?.code).toBe("journal_lock_failed");
    expect(first.failure?.message).toContain("EIO");

    const seam = grantlessSeam();
    const second = appendReceipt(p, input({ event_id: "e3", operation_id: "op-3" }), seam.io, {
      lock_max_attempts: 1,
      lock_wait_ms: 1,
    });

    expect(second.failure?.code).toBe("journal_lock_failed");
    expect(scanReceiptJournal(p.journal).record_count).toBe(1);
    expect(seam.released()).toBe(false);
    expect(fs.existsSync(lock)).toBe(true);
    fs.rmSync(lock, { recursive: true, force: true });
  });

  // ── Control. Call-scoping must not cost the discarding wrapper its support,
  //    including when the acquisition it wraps lands on a RETRY rather than first.

  it("still appends when a later attempt in the same loop acquires and returns bare true", () => {
    const p = seeded();
    let calls = 0;
    const io: JournalIo = {
      ...defaultJournalIo,
      acquireLock(lockPath) {
        calls += 1;
        if (calls === 1) return false; // ordinary contention: nothing published
        return defaultJournalIo.acquireLock!(lockPath) ? true : false; // grant discarded
      },
    };

    const out = appendReceipt(p, input({ event_id: "e2", operation_id: "op-2" }), io, {
      lock_max_attempts: 3,
      lock_wait_ms: 1,
    });

    expect(calls).toBe(2);
    expect(out.disposition).toBe("succeeded");
    expect(out.durable).toBe(true);
    expect(out.sequence).toBe(2);
    expect(scanReceiptJournal(p.journal).record_count).toBe(2);
    expect(readCheckpoint(p.checkpoint)!.last_sequence).toBe(2);
    expect(fs.existsSync(journalLockPath(p))).toBe(false);
  });
});
