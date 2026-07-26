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
 *   MHRC-RCT-004  Reconciliation detects and classifies sequence gaps
 *   MHRC-RCT-005  Duplicate delivery is idempotent
 *
 * DISPOSITION LADDER (closed vocabulary, most severe wins):
 *   failed     — a conflict or a rejected recovery: the journal cannot be trusted.
 *   degraded   — gaps exist (even fully recovered ones) or the tail is damaged.
 *   succeeded  — journal and producer checkpoint agree; duplicates deduped cleanly.
 *
 * BR-07 is absolute here: an unrecoverable gap stays `not_observed` and blocks
 * a clean close. Reconciliation NEVER upgrades absence into success.
 *
 * This module is a pure verdict producer — it reads, it does not mutate. The
 * one explicit repair (`repairTornTail`) lives in receipt-journal.ts and must
 * be called deliberately.
 *
 * Owned by: tooling-engineer (scripts/ + src/modules scope per AGENTS.md).
 */

import {
  scanReceiptJournal,
  readCheckpoint,
  verifyReceiptRecord,
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

export type RecoveryRejectionReason = "hash_mismatch" | "outside_declared_gap" | "duplicate_sequence";

export interface RejectedRecovery {
  sequence: number;
  event_id: string;
  reason: RecoveryRejectionReason;
}

export interface ReconciliationOutcomeV1 {
  schema_version: "guild.reconciliation_outcome.v1";
  type: "guild.reconciliation_outcome.v1";
  disposition: "succeeded" | "degraded" | "failed";
  run_id: string;
  journal_integrity: JournalIntegrity;
  journal_observation_state: ObservationState;
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
  checkpoint_after: ReceiptCheckpointV1 | null;
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

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconcile the durable journal against the producer's checkpoint.
 *
 * Read-only: computes `checkpoint_after` as evidence but never writes it.
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

  for (const rec of opts.recovered ?? []) {
    if (!verifyReceiptRecord(rec)) {
      rejected_recoveries.push({ sequence: rec.sequence, event_id: rec.event_id, reason: "hash_mismatch" });
      continue;
    }
    if (!missingSet.has(rec.sequence)) {
      rejected_recoveries.push({ sequence: rec.sequence, event_id: rec.event_id, reason: "outside_declared_gap" });
      continue;
    }
    if (claimed.has(rec.sequence)) {
      rejected_recoveries.push({ sequence: rec.sequence, event_id: rec.event_id, reason: "duplicate_sequence" });
      continue;
    }
    claimed.add(rec.sequence);
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

  // ── 3. Merge the trusted view and classify duplicate delivery ────────────
  const merged = [...scan.records, ...acceptedRecoveries].sort((a, b) => a.sequence - b.sequence);

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

  // ── 4. Evidence checkpoint reflecting ONLY what was actually observed ────
  const last = merged[merged.length - 1] ?? null;
  const checkpoint_after: ReceiptCheckpointV1 = {
    schema_version: "guild.receipt_checkpoint.v1",
    run_id: opts.run_id,
    last_sequence: last?.sequence ?? 0,
    last_event_id: last?.event_id ?? null,
    record_count: merged.length,
    updated_at: opts.reconciled_at,
    contract_version: RECEIPT_CONTRACT_VERSION,
  };

  // ── 5. Verdict ───────────────────────────────────────────────────────────
  const tailDamaged = scan.integrity === "truncated_tail" || scan.integrity === "corrupt" || scan.integrity === "order_violation";
  const hardFailure = conflicts.length > 0 || rejected_recoveries.length > 0;

  // BR-07: a journal that never observed anything, or that recorded a failed
  // observation, must NOT reconcile to "succeeded" just because the sequence
  // arithmetic happens to balance. Absence is not agreement.
  const observationUnclean =
    scan.observation_state === "not_observed" || scan.observation_state === "observation_failed";

  let disposition: ReconciliationOutcomeV1["disposition"] = "succeeded";
  if (hardFailure) disposition = "failed";
  else if (gaps.length > 0 || tailDamaged || observationUnclean) disposition = "degraded";

  const blocks_clean_close =
    hardFailure || unresolved_sequences.length > 0 || tailDamaged || observationUnclean;

  return {
    schema_version: "guild.reconciliation_outcome.v1",
    type: "guild.reconciliation_outcome.v1",
    disposition,
    run_id: opts.run_id,
    journal_integrity: scan.integrity,
    journal_observation_state: scan.observation_state,
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
    blocks_clean_close,
    contract_version: RECEIPT_CONTRACT_VERSION,
    reconciled_at: opts.reconciled_at,
  };
}
