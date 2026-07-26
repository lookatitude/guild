/**
 * src/modules/telemetry/workflows/receipt-reconcile.ts
 *
 * MH-06 — interruption reconciliation for the receipt journal.
 *
 * Answers exactly one question, in typed form: after an interruption, does the
 * durable journal still account for everything the producer believes it
 * emitted — and if not, WHICH sequences are missing, WHICH were recovered, and
 * WHICH duplicate deliveries must not be replayed as new effects?
 *
 * Implements the W1/MH-06 half of the frozen conformance contract:
 *   MHRC-RCT-002  Interrupted append never produces a valid partial receipt
 *   MHRC-RCT-003  Observation loss is explicit
 *   MHRC-RCT-004  Reconciliation detects and classifies sequence gaps
 *   MHRC-RCT-005  Duplicate delivery is idempotent
 *
 * THREE AGREEMENTS MUST HOLD FOR SUCCESS (MHRC-RCT-002 evidence assertion
 * "operation outcome and journal checkpoint agree", plus CI-05):
 *
 *   1. the ON-DISK checkpoint describes the DURABLE JOURNAL exactly;
 *   2. the PRODUCER checkpoint describes the MERGED authoritative view exactly;
 *   3. the MERGED view is structurally coherent — one run, one operation lineage
 *      per correlation id, no duplicate/regressing sequence, causes before
 *      effects, and no unclean observation.
 *
 * Any disagreement is enumerated in `checkpoint_disagreements` and blocks a
 * clean close. Reconciliation is READ-ONLY by default: it computes
 * `checkpoint_after` as a PROPOSAL and does not write it. Persisting that
 * proposal is an explicit, opt-in mutation (`repair_checkpoint: true`) that is
 * permitted only when nothing else is wrong, is verified by re-reading the file,
 * and is reported in `checkpoint_repair`. An unpersisted proposal is NEVER
 * reported as completed recovery.
 *
 * DISPOSITION LADDER (closed vocabulary, most severe wins):
 *   failed     — a conflict, an INVALID recovery, a structurally incoherent
 *                merged view, or a repair that was attempted and did not verify.
 *   degraded   — gaps (even fully recovered ones), tail damage, unclean
 *                observation, or an unrepaired checkpoint/producer disagreement.
 *   succeeded  — all three agreements hold and duplicates deduped cleanly.
 *
 * BR-07 is absolute here: an unrecoverable gap stays `not_observed` and blocks
 * a clean close. Reconciliation NEVER upgrades absence into success.
 *
 * Owned by: tooling-engineer (scripts/ + src/modules scope per AGENTS.md).
 */

import {
  scanReceiptJournal,
  readCheckpoint,
  verifyReceiptRecord,
  isValidReceiptRecordShape,
  analyzeReceiptRecords,
  defaultJournalIo,
  RECEIPT_CONTRACT_VERSION,
  type JournalIo,
  type JournalIntegrity,
  type ObservationState,
  type ReceiptCheckpointV1,
  type ReceiptRecordV1,
} from "./receipt-journal";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** What the producer believes it durably emitted. */
export interface ProducerCheckpoint {
  last_sequence: number;
  record_count: number;
}

export interface SequenceGap {
  from: number;
  to: number;
  recovered: boolean;
  observation_state: ObservationState;
}

export interface DuplicateGroup {
  operation_id: string;
  event_ids: string[];
  authoritative_event_id: string;
  payload_hash: string;
  /** Always 1 — one logical receipt, one lifecycle effect (MHRC-RCT-005). */
  effects_applied: number;
}

export interface ConflictGroup {
  operation_id: string;
  event_ids: string[];
  payload_hashes: string[];
  reason: "payload_hash_mismatch";
}

/**
 * Why an offered recovery was refused.
 *
 * The first five are INVALID recoveries — the offered record is not admissible
 * evidence at all, so reconciliation fails. The last two are UNCLEAN recoveries
 * — the record is admissible evidence but is not a clean observation, so it
 * cannot close a gap; the gap stays unresolved and blocks a clean close.
 */
export type RecoveryRejectionReason =
  | "schema_invalid"
  | "hash_mismatch"
  | "foreign_run"
  | "outside_declared_gap"
  | "duplicate_sequence"
  | "duplicate_event_id"
  | "unknown_causation"
  | "cause_not_before_effect"
  | "unclean_observation"
  | "unclean_disposition";

/** Rejections that make the whole reconciliation `failed`. */
const INVALID_RECOVERY_REASONS: ReadonlySet<RecoveryRejectionReason> = new Set([
  "schema_invalid",
  "hash_mismatch",
  "foreign_run",
  "outside_declared_gap",
  "duplicate_sequence",
  "duplicate_event_id",
  "unknown_causation",
  "cause_not_before_effect",
]);

export interface RejectedRecovery {
  sequence: number;
  event_id: string;
  reason: RecoveryRejectionReason;
}

/** A concrete way the three required agreements were violated. */
export type CheckpointDisagreementCode =
  | "checkpoint_missing"
  | "checkpoint_run_mismatch"
  | "checkpoint_sequence_mismatch"
  | "checkpoint_count_mismatch"
  | "checkpoint_event_mismatch"
  | "producer_sequence_mismatch"
  | "producer_count_mismatch"
  | "merged_run_identity_mismatch";

export interface CheckpointDisagreement {
  code: CheckpointDisagreementCode;
  /** What the authoritative side says. */
  expected: string | number | null;
  /** What the disagreeing side says. */
  actual: string | number | null;
}

export type CheckpointRepairFailureCode =
  | "repair_not_permitted"
  | "repair_write_failed"
  | "repair_verify_failed";

/**
 * The explicit mutation boundary. `verified` is the ONLY field that may be read
 * as "the checkpoint on disk now matches `checkpoint_after`"; it is set only
 * after the file was re-read and compared field by field.
 */
export interface CheckpointRepairOutcome {
  requested: boolean;
  attempted: boolean;
  persisted: boolean;
  verified: boolean;
  failure: { code: CheckpointRepairFailureCode; message: string } | null;
}

export interface ReconciliationOutcomeV1 {
  schema_version: "guild.reconciliation_outcome.v1";
  type: "guild.reconciliation_outcome.v1";
  disposition: "succeeded" | "degraded" | "failed";
  run_id: string;
  journal_integrity: JournalIntegrity;
  journal_observation_state: ObservationState;
  /** Observation state of the MERGED view (journal + accepted recoveries). */
  merged_observation_state: ObservationState;
  /** Structural verdict over the MERGED view — not just the parsed journal. */
  merged_integrity: "intact" | "order_violation" | "lineage_violation";
  gaps: SequenceGap[];
  recovered_sequences: number[];
  unresolved_sequences: number[];
  rejected_recoveries: RejectedRecovery[];
  duplicates: DuplicateGroup[];
  conflicts: ConflictGroup[];
  /** Distinct operation ids — the number of lifecycle effects that may apply. */
  authoritative_effect_count: number;
  reconciled_order: Array<{ sequence: number; event_id: string }>;
  checkpoint_before: ReceiptCheckpointV1 | null;
  /**
   * PROPOSAL describing the merged view. Persisted only when
   * `checkpoint_repair.verified` is true — otherwise it is evidence, not state.
   */
  checkpoint_after: ReceiptCheckpointV1;
  checkpoint_disagreements: CheckpointDisagreement[];
  checkpoint_repair: CheckpointRepairOutcome;
  blocks_clean_close: boolean;
  contract_version: string;
  reconciled_at: string;
}

export interface ReconcileOptions {
  journalPath: string;
  checkpointPath: string;
  run_id: string;
  producerCheckpoint: ProducerCheckpoint;
  reconciled_at: string;
  /** Records rescued from a side channel, offered to fill declared gaps. */
  recovered?: ReceiptRecordV1[];
  /**
   * Opt in to the durable repair of the ON-DISK checkpoint. Off by default:
   * reconciliation is a verdict producer, and silently writing state would make
   * "the checkpoint agrees" unfalsifiable.
   */
  repair_checkpoint?: boolean;
  io?: JournalIo;
}

/** Stable identity of a receipt's payload — the dedup key with operation_id. */
function payloadHash(record: ReceiptRecordV1): string {
  return `${record.input_hash}|${record.output_hash ?? "null"}`;
}

/** Collapse a sorted list of missing sequences into contiguous [from,to] runs. */
function toRuns(missing: number[]): Array<{ from: number; to: number }> {
  const runs: Array<{ from: number; to: number }> = [];
  for (const n of missing) {
    const last = runs[runs.length - 1];
    if (last && n === last.to + 1) last.to = n;
    else runs.push({ from: n, to: n });
  }
  return runs;
}

/** The record carrying the highest sequence — the one a checkpoint names. */
function highest(records: ReceiptRecordV1[]): ReceiptRecordV1 | null {
  let best: ReceiptRecordV1 | null = null;
  for (const r of records) if (!best || r.sequence > best.sequence) best = r;
  return best;
}

function checkpointsEqual(a: ReceiptCheckpointV1, b: ReceiptCheckpointV1): boolean {
  return (
    a.schema_version === b.schema_version &&
    a.run_id === b.run_id &&
    a.last_sequence === b.last_sequence &&
    a.last_event_id === b.last_event_id &&
    a.record_count === b.record_count &&
    a.updated_at === b.updated_at &&
    a.contract_version === b.contract_version
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recovery vetting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide whether ONE offered recovery may enter the merged lineage.
 *
 * Checks run most-fundamental first so the reported reason is the deepest
 * defect: shape → hash → run identity → gap membership → duplicate sequence →
 * duplicate event id → causal order → observation cleanliness → disposition
 * cleanliness.
 *
 * `causes` maps event_id → sequence over the records already trusted (journal +
 * previously accepted recoveries), which is what makes causal order checkable
 * against the MERGED view rather than the original scan alone — and what makes
 * a reused event id detectable.
 */
function rejectRecovery(
  rec: ReceiptRecordV1,
  ctx: {
    run_id: string;
    missing: ReadonlySet<number>;
    claimed: ReadonlySet<number>;
    causes: ReadonlyMap<string, number>;
  },
): RecoveryRejectionReason | null {
  if (!isValidReceiptRecordShape(rec)) return "schema_invalid";
  if (!verifyReceiptRecord(rec)) return "hash_mismatch";
  if (rec.run_id !== ctx.run_id) return "foreign_run";
  if (!ctx.missing.has(rec.sequence)) return "outside_declared_gap";
  if (ctx.claimed.has(rec.sequence)) return "duplicate_sequence";
  // Event ids are the causal graph's node names — reusing one makes every
  // `causation_id` pointing at it ambiguous.
  if (ctx.causes.has(rec.event_id)) return "duplicate_event_id";
  if (rec.causation_id) {
    const causeSeq = ctx.causes.get(rec.causation_id);
    if (causeSeq === undefined) return "unknown_causation";
    if (causeSeq >= rec.sequence) return "cause_not_before_effect";
  }
  if (rec.observation_state !== "checked_clean" && rec.observation_state !== "not_applicable") {
    return "unclean_observation";
  }
  if (rec.disposition === "failed" || rec.disposition === "degraded") return "unclean_disposition";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconcile the durable journal against the producer's checkpoint.
 *
 * Read-only unless `repair_checkpoint` is set; see `checkpoint_repair`.
 */
export function reconcileReceiptJournal(opts: ReconcileOptions): ReconciliationOutcomeV1 {
  const io = opts.io ?? defaultJournalIo;
  const scan = scanReceiptJournal(opts.journalPath, io);
  const checkpoint_before = readCheckpoint(opts.checkpointPath);

  // ── 1. Which sequences should exist, and which are actually durable? ──────
  const observed = new Set(scan.records.map((r) => r.sequence));
  const expectedMax = Math.max(opts.producerCheckpoint.last_sequence, scan.last_sequence);
  const missing: number[] = [];
  for (let s = 1; s <= expectedMax; s += 1) if (!observed.has(s)) missing.push(s);
  const gapRuns = toRuns(missing);

  // ── 2. Vet each offered recovery before it can close anything ────────────
  const rejected_recoveries: RejectedRecovery[] = [];
  const acceptedRecoveries: ReceiptRecordV1[] = [];
  const missingSet = new Set(missing);
  const claimed = new Set<number>();
  // Causal frame: the journal's own events plus recoveries accepted so far.
  const causes = new Map<string, number>();
  for (const r of scan.records) if (!causes.has(r.event_id)) causes.set(r.event_id, r.sequence);

  for (const rec of opts.recovered ?? []) {
    const reason = rejectRecovery(rec, { run_id: opts.run_id, missing: missingSet, claimed, causes });
    if (reason) {
      rejected_recoveries.push({
        sequence: typeof rec?.sequence === "number" ? rec.sequence : 0,
        event_id: typeof rec?.event_id === "string" ? rec.event_id : "",
        reason,
      });
      continue;
    }
    claimed.add(rec.sequence);
    causes.set(rec.event_id, rec.sequence);
    acceptedRecoveries.push(rec);
  }

  const recovered_sequences = acceptedRecoveries.map((r) => r.sequence).sort((a, b) => a - b);
  const unresolved_sequences = missing.filter((s) => !claimed.has(s));

  // A gap closes only when EVERY sequence inside it is genuinely recovered.
  const gaps: SequenceGap[] = gapRuns.map((run) => {
    let recovered = true;
    for (let s = run.from; s <= run.to; s += 1) if (!claimed.has(s)) recovered = false;
    return {
      from: run.from,
      to: run.to,
      recovered,
      observation_state: recovered ? ("checked_clean" as const) : ("not_observed" as const),
    };
  });

  // ── 3. Merge the trusted view and RE-ANALYZE it as one lineage ───────────
  const merged = [...scan.records, ...acceptedRecoveries].sort((a, b) => a.sequence - b.sequence);
  const mergedAnalysis = analyzeReceiptRecords(merged);

  const byOperation = new Map<string, ReceiptRecordV1[]>();
  for (const r of merged) {
    const list = byOperation.get(r.operation_id);
    if (list) list.push(r);
    else byOperation.set(r.operation_id, [r]);
  }

  const duplicates: DuplicateGroup[] = [];
  const conflicts: ConflictGroup[] = [];
  for (const [operation_id, group] of byOperation) {
    if (group.length < 2) continue;
    const hashes = group.map(payloadHash);
    const allEqual = hashes.every((h) => h === hashes[0]);
    if (allEqual) {
      duplicates.push({
        operation_id,
        event_ids: group.map((r) => r.event_id),
        authoritative_event_id: group[0].event_id, // lowest sequence is authoritative
        payload_hash: hashes[0],
        effects_applied: 1,
      });
    } else {
      conflicts.push({
        operation_id,
        event_ids: group.map((r) => r.event_id),
        payload_hashes: hashes,
        reason: "payload_hash_mismatch",
      });
    }
  }

  // ── 4. Checkpoint proposal reflecting ONLY what was actually observed ────
  const mergedLast = highest(merged);
  const checkpoint_after: ReceiptCheckpointV1 = {
    schema_version: "guild.receipt_checkpoint.v1",
    run_id: opts.run_id,
    last_sequence: mergedLast?.sequence ?? 0,
    last_event_id: mergedLast?.event_id ?? null,
    record_count: merged.length,
    updated_at: opts.reconciled_at,
    contract_version: RECEIPT_CONTRACT_VERSION,
  };

  // ── 5. The three agreements ──────────────────────────────────────────────
  const checkpoint_disagreements: CheckpointDisagreement[] = [];
  const journalLast = highest(scan.records);

  if (checkpoint_before === null) {
    // Absent journal AND absent checkpoint AND an empty producer claim is the
    // one consistent "nothing happened yet" shape. Anything else means the
    // durable checkpoint boundary did not land (MHRC-RCT-002).
    if (
      scan.record_count > 0 ||
      opts.producerCheckpoint.record_count > 0 ||
      opts.producerCheckpoint.last_sequence > 0
    ) {
      checkpoint_disagreements.push({
        code: "checkpoint_missing",
        expected: journalLast?.sequence ?? opts.producerCheckpoint.last_sequence,
        actual: null,
      });
    }
  } else {
    if (checkpoint_before.run_id !== opts.run_id) {
      checkpoint_disagreements.push({
        code: "checkpoint_run_mismatch",
        expected: opts.run_id,
        actual: checkpoint_before.run_id,
      });
    }
    if (checkpoint_before.last_sequence !== scan.last_sequence) {
      checkpoint_disagreements.push({
        code: "checkpoint_sequence_mismatch",
        expected: scan.last_sequence,
        actual: checkpoint_before.last_sequence,
      });
    }
    if (checkpoint_before.record_count !== scan.record_count) {
      checkpoint_disagreements.push({
        code: "checkpoint_count_mismatch",
        expected: scan.record_count,
        actual: checkpoint_before.record_count,
      });
    }
    if (checkpoint_before.last_event_id !== (journalLast?.event_id ?? null)) {
      checkpoint_disagreements.push({
        code: "checkpoint_event_mismatch",
        expected: journalLast?.event_id ?? null,
        actual: checkpoint_before.last_event_id,
      });
    }
  }

  if (opts.producerCheckpoint.last_sequence !== checkpoint_after.last_sequence) {
    checkpoint_disagreements.push({
      code: "producer_sequence_mismatch",
      expected: checkpoint_after.last_sequence,
      actual: opts.producerCheckpoint.last_sequence,
    });
  }
  if (opts.producerCheckpoint.record_count !== checkpoint_after.record_count) {
    checkpoint_disagreements.push({
      code: "producer_count_mismatch",
      expected: checkpoint_after.record_count,
      actual: opts.producerCheckpoint.record_count,
    });
  }
  const foreignRun = mergedAnalysis.run_ids.find((id) => id !== opts.run_id);
  if (foreignRun !== undefined) {
    checkpoint_disagreements.push({
      code: "merged_run_identity_mismatch",
      expected: opts.run_id,
      actual: foreignRun,
    });
  }

  // ── 6. Verdict inputs ────────────────────────────────────────────────────
  const tailDamaged =
    scan.integrity === "truncated_tail" ||
    scan.integrity === "corrupt" ||
    scan.integrity === "order_violation" ||
    scan.integrity === "lineage_violation";
  const invalidRecovery = rejected_recoveries.some((r) => INVALID_RECOVERY_REASONS.has(r.reason));
  const hardFailure = conflicts.length > 0 || invalidRecovery;
  const mergedIncoherent = mergedAnalysis.structural_integrity !== "intact";

  // BR-07: a merged view that never observed anything, or that carries a failed
  // observation, must NOT reconcile to "succeeded" just because the sequence
  // arithmetic happens to balance. Absence is not agreement.
  const observationUnclean = mergedAnalysis.observation_state !== "checked_clean";

  // ── 7. Explicit durable repair of the on-disk checkpoint ─────────────────
  const checkpoint_repair: CheckpointRepairOutcome = {
    requested: opts.repair_checkpoint === true,
    attempted: false,
    persisted: false,
    verified: false,
    failure: null,
  };

  if (checkpoint_repair.requested) {
    // Repair may correct exactly ONE thing: an on-disk checkpoint that does not
    // describe the durable journal. It must never paper over damage, and it must
    // never write a checkpoint claiming records that are not in the journal —
    // an accepted side-channel recovery is a proposal, not durable state.
    const blockers: string[] = [];
    if (hardFailure) blockers.push("conflicting or invalid records");
    if (unresolved_sequences.length > 0) blockers.push(`unresolved sequences ${unresolved_sequences.join(",")}`);
    if (tailDamaged) blockers.push(`journal integrity is "${scan.integrity}"`);
    if (mergedIncoherent) blockers.push(`merged lineage is "${mergedAnalysis.structural_integrity}"`);
    if (observationUnclean) blockers.push(`merged observation state is "${mergedAnalysis.observation_state}"`);
    if (acceptedRecoveries.length > 0) {
      blockers.push(
        `${acceptedRecoveries.length} recovered record(s) are not durable in the journal — ` +
          "the checkpoint may only describe durable content",
      );
    }
    if (
      opts.producerCheckpoint.last_sequence !== checkpoint_after.last_sequence ||
      opts.producerCheckpoint.record_count !== checkpoint_after.record_count
    ) {
      blockers.push("producer checkpoint does not describe the merged view");
    }

    if (blockers.length > 0) {
      checkpoint_repair.failure = {
        code: "repair_not_permitted",
        message: `checkpoint repair refused: ${blockers.join("; ")}`,
      };
    } else {
      checkpoint_repair.attempted = true;
      try {
        io.writeCheckpoint(opts.checkpointPath, `${JSON.stringify(checkpoint_after, null, 2)}\n`);
        checkpoint_repair.persisted = true;
      } catch (err) {
        checkpoint_repair.failure = {
          code: "repair_write_failed",
          message: err instanceof Error ? err.message : String(err),
        };
      }
      if (checkpoint_repair.persisted) {
        // Prove it: re-read from disk and compare, never trust the write call.
        const reread = readCheckpoint(opts.checkpointPath);
        checkpoint_repair.verified = reread !== null && checkpointsEqual(reread, checkpoint_after);
        if (!checkpoint_repair.verified) {
          checkpoint_repair.failure = {
            code: "repair_verify_failed",
            message: "checkpoint on disk does not match the reconciled checkpoint after write",
          };
        }
      }
    }
  }

  // An attempted repair that did not verify is a durable failure, not a nit.
  const repairFailed = checkpoint_repair.attempted && !checkpoint_repair.verified;
  // Only a VERIFIED repair may clear the disagreements it was permitted to fix.
  const checkpointUnresolved = checkpoint_disagreements.length > 0 && !checkpoint_repair.verified;

  // ── 8. Verdict ───────────────────────────────────────────────────────────
  let disposition: ReconciliationOutcomeV1["disposition"] = "succeeded";
  if (hardFailure || mergedIncoherent || repairFailed) disposition = "failed";
  else if (gaps.length > 0 || tailDamaged || observationUnclean || checkpointUnresolved) {
    disposition = "degraded";
  }

  const blocks_clean_close =
    hardFailure ||
    mergedIncoherent ||
    repairFailed ||
    rejected_recoveries.length > 0 ||
    unresolved_sequences.length > 0 ||
    tailDamaged ||
    observationUnclean ||
    checkpointUnresolved;

  return {
    schema_version: "guild.reconciliation_outcome.v1",
    type: "guild.reconciliation_outcome.v1",
    disposition,
    run_id: opts.run_id,
    journal_integrity: scan.integrity,
    journal_observation_state: scan.observation_state,
    merged_observation_state: mergedAnalysis.observation_state,
    merged_integrity: mergedAnalysis.structural_integrity,
    gaps,
    recovered_sequences,
    unresolved_sequences,
    rejected_recoveries,
    duplicates,
    conflicts,
    authoritative_effect_count: byOperation.size,
    reconciled_order: merged.map((r) => ({ sequence: r.sequence, event_id: r.event_id })),
    checkpoint_before,
    checkpoint_after,
    checkpoint_disagreements,
    checkpoint_repair,
    blocks_clean_close,
    contract_version: RECEIPT_CONTRACT_VERSION,
    reconciled_at: opts.reconciled_at,
  };
}
