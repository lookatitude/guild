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
 * proposal is an explicit, opt-in mutation (`repair_checkpoint: true`) that runs
 * under the canonical journal lock from its FIRST read to its last, is permitted
 * only when nothing else is wrong, is verified by re-reading the file AND
 * re-scanning the journal, and is reported in `checkpoint_repair`. An unpersisted
 * proposal is NEVER reported as completed recovery.
 *
 * DISPOSITION LADDER (closed vocabulary, most severe wins):
 *   failed     — a conflict, an INVALID recovery, a structurally incoherent
 *                merged view, or a REQUESTED repair that did not verify — whether
 *                it was attempted and failed, or was denied exclusive access and
 *                never ran at all.
 *   degraded   — gaps (even fully recovered ones), tail damage, unclean
 *                observation, or an unrepaired checkpoint/producer disagreement.
 *   succeeded  — all three agreements hold and duplicates deduped cleanly.
 *
 * A REQUESTED REPAIR THAT CANNOT LOCK IS BLOCKING (MH-06-R4-B2). Round 4 found a
 * repair whose canonical-lock acquisition failed still returning
 * `disposition: "succeeded", blocks_clean_close: false, checkpoint_disagreements: []`
 * beside `checkpoint_repair.failure.code: "repair_lock_unavailable"`, because the
 * failure test read `attempted && !verified` and an unattempted repair is not
 * attempted. Two things are wrong with that outcome and only one of them is the
 * snapshot: the caller asked for a durable mutation and did not get it. Denied
 * exclusive access therefore fails closed exactly as `appendReceipt` already does
 * for `journal_lock_unavailable`.
 *
 * BR-07 is absolute here: an unrecoverable gap stays `not_observed` and blocks
 * a clean close. Reconciliation NEVER upgrades absence into success.
 *
 * Owned by: tooling-engineer (scripts/ + src/modules scope per AGENTS.md).
 */

import {
  scanReceiptJournal,
  readCheckpointState,
  compareCheckpointToJournal,
  checkpointsIdentical,
  highestSequenceRecord,
  acquireJournalAuthority,
  verifyReceiptRecord,
  isValidReceiptRecordShape,
  analyzeReceiptRecords,
  defaultJournalIo,
  RECEIPT_CONTRACT_VERSION,
  type CheckpointAgreement,
  type CheckpointAgreementCode,
  type CheckpointReadState,
  type JournalAuthorityFailure,
  type JournalIdentityFailure,
  type JournalIo,
  type JournalIntegrity,
  type ObservationState,
  type ReceiptCheckpointV1,
  type ReceiptRecordV1,
  type RetainedJournalAuthority,
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

/**
 * A concrete way the three required agreements were violated.
 *
 * The `checkpoint_*` half is the SHARED primitive `compareCheckpointToJournal`
 * (also used by the debug bundle) — a stale, forged, or malformed checkpoint has
 * to fail the same way for every consumer, or MH-06-R1-B1 stays half-closed.
 */
export type CheckpointDisagreementCode =
  | CheckpointAgreementCode
  | "producer_sequence_mismatch"
  | "producer_count_mismatch"
  | "merged_run_identity_mismatch"
  | "merged_event_identity_conflict";

export interface CheckpointDisagreement {
  code: CheckpointDisagreementCode;
  /** What the authoritative side says. */
  expected: string | number | null;
  /** What the disagreeing side says. */
  actual: string | number | null;
}

/**
 * One event id carried by more than one record in the merged view.
 *
 * MHRC-RCT-005 dedupes by operation id and payload hash; a reused EVENT id is a
 * different defect that grouping by operation cannot see, because the two
 * records sit under two different operations and are therefore counted as two
 * clean authoritative effects (MH-06-R2-B5).
 */
export interface EventIdentityConflict {
  event_id: string;
  sequences: number[];
  operation_ids: string[];
}

/**
 * The last four are DENIALS OF EXCLUSIVE ACCESS: the repair never ran, so no
 * reading taken beside it was ever frozen. They are blocking for that reason
 * alone (MH-06-R4-B2), unlike `repair_not_permitted`, which is a decision made
 * WITH exclusive access, from named blockers that drive the verdict themselves.
 */
export type CheckpointRepairFailureCode =
  | "repair_not_permitted"
  | "repair_write_failed"
  | "repair_verify_failed"
  | "repair_lock_unavailable"
  | "repair_lock_failed"
  | "repair_identity_ambiguous"
  | "repair_identity_unstable";

/** Every way a requested repair can be denied exclusive access to the journal. */
const REPAIR_ACCESS_DENIALS: ReadonlySet<CheckpointRepairFailureCode> = new Set([
  "repair_lock_unavailable",
  "repair_lock_failed",
  "repair_identity_ambiguous",
  "repair_identity_unstable",
]);

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
  /**
   * What STILL disagrees after the write, re-derived from the re-read file.
   * `verified` is true only when this is empty — a repair that leaves any
   * disagreement standing has not resolved the exact disagreement it claimed to.
   */
  residual_disagreements: CheckpointDisagreement[];
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
  /** Event ids naming more than one record — a hard failure, never a duplicate. */
  event_identity_conflicts: EventIdentityConflict[];
  /**
   * Distinct operation ids — the number of lifecycle effects that may apply.
   * Trustworthy ONLY when `event_identity_conflicts` is empty; otherwise one
   * causal identity is being counted more than once.
   */
  authoritative_effect_count: number;
  reconciled_order: Array<{ sequence: number; event_id: string }>;
  checkpoint_before: ReceiptCheckpointV1 | null;
  /** Absent, malformed, or present — malformed is damage, not absence. */
  checkpoint_before_state: CheckpointReadState;
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
  /** Bounded wait for the cross-process journal lock during a durable repair. */
  lock_max_attempts?: number;
  lock_wait_ms?: number;
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
const highest = highestSequenceRecord;

// ─────────────────────────────────────────────────────────────────────────────
// Recovery vetting — DETERMINISTIC, and independent of caller array order
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Round 2 vetted recoveries in whatever order the caller happened to pass them,
 * against the frame accepted SO FAR. For one journal holding {1,4} and the
 * hash-valid set {2 caused by 1, 3 caused by 2}, `[e2,e3]` recovered both and
 * `[e3,e2]` rejected e3 as `unknown_causation` — the same evidence, two verdicts
 * (MH-06-R2-B2). MHRC-RCT-004 requires recovered entries to "preserve original
 * identity and order", which is a property of the SEQUENCE ORDER, not of the
 * array the caller built.
 *
 * The fix is a total order plus a fixpoint:
 *
 *   sort   — by (sequence, event_id, record_hash): a total order over the
 *            offered MULTISET, so permuting the input cannot change it;
 *   pass 1 — per-candidate structural facts (shape, hash, run, gap membership),
 *            each independent of every other candidate;
 *   pass 2 — sequence/event-id uniqueness, resolved in sorted order so the
 *            SAME candidate always wins a collision;
 *   pass 3 — observation and disposition cleanliness, again per-candidate;
 *   pass 4 — causal order against the frame of journal events plus the CLEAN
 *            surviving candidates, iterated to a fixpoint so that dropping a
 *            cause also drops everything that depended on it;
 *   pass 5 — report the unclean candidates with their DEEPEST defect, so a
 *            record that is both unclean and causally broken still hard-fails
 *            exactly as it did in round 2.
 *
 * Every step is a function of the offered SET, so all n! permutations produce a
 * byte-identical verdict.
 */
function candidateSortKey(rec: ReceiptRecordV1): [number, string, string] {
  const anyRec = rec as unknown as Record<string, unknown>;
  const seq =
    typeof anyRec.sequence === "number" && Number.isFinite(anyRec.sequence)
      ? (anyRec.sequence as number)
      : Number.MAX_SAFE_INTEGER;
  const eventId = typeof anyRec.event_id === "string" ? (anyRec.event_id as string) : "";
  const recordHash = typeof anyRec.record_hash === "string" ? (anyRec.record_hash as string) : "";
  return [seq, eventId, recordHash];
}

function compareCandidates(a: ReceiptRecordV1, b: ReceiptRecordV1): number {
  const [as, ae, ah] = candidateSortKey(a);
  const [bs, be, bh] = candidateSortKey(b);
  if (as !== bs) return as - bs;
  if (ae !== be) return ae < be ? -1 : 1;
  if (ah !== bh) return ah < bh ? -1 : 1;
  return 0;
}

/** Structural facts about ONE candidate, independent of every other candidate. */
function structuralRejection(
  rec: ReceiptRecordV1,
  ctx: { run_id: string; missing: ReadonlySet<number> },
): RecoveryRejectionReason | null {
  if (!isValidReceiptRecordShape(rec)) return "schema_invalid";
  if (!verifyReceiptRecord(rec)) return "hash_mismatch";
  if (rec.run_id !== ctx.run_id) return "foreign_run";
  if (!ctx.missing.has(rec.sequence)) return "outside_declared_gap";
  return null;
}

/** Cleanliness facts about ONE candidate, independent of every other candidate. */
function cleanlinessRejection(rec: ReceiptRecordV1): RecoveryRejectionReason | null {
  if (rec.observation_state !== "checked_clean" && rec.observation_state !== "not_applicable") {
    return "unclean_observation";
  }
  if (rec.disposition === "failed" || rec.disposition === "degraded") return "unclean_disposition";
  return null;
}

interface VettedRecoveries {
  accepted: ReceiptRecordV1[];
  rejected: RejectedRecovery[];
}

function vetRecoveries(
  offered: readonly ReceiptRecordV1[],
  ctx: { run_id: string; missing: ReadonlySet<number>; journal: readonly ReceiptRecordV1[] },
): VettedRecoveries {
  const rejected: RejectedRecovery[] = [];
  const reject = (rec: ReceiptRecordV1, reason: RecoveryRejectionReason): void => {
    const anyRec = rec as unknown as Record<string, unknown>;
    rejected.push({
      sequence: typeof anyRec?.sequence === "number" ? (anyRec.sequence as number) : 0,
      event_id: typeof anyRec?.event_id === "string" ? (anyRec.event_id as string) : "",
      reason,
    });
  };

  const ordered = [...offered].sort(compareCandidates);

  // pass 1 — per-candidate structure.
  let alive: ReceiptRecordV1[] = [];
  for (const rec of ordered) {
    const reason = structuralRejection(rec, ctx);
    if (reason) reject(rec, reason);
    else alive.push(rec);
  }

  // pass 2 — uniqueness, resolved in the total order so collisions are stable.
  const journalSequences = new Set(ctx.journal.map((r) => r.sequence));
  const journalEventIds = new Set(ctx.journal.map((r) => r.event_id));
  const claimedSequences = new Set<number>(journalSequences);
  const claimedEventIds = new Set<string>(journalEventIds);
  let next: ReceiptRecordV1[] = [];
  for (const rec of alive) {
    if (claimedSequences.has(rec.sequence)) {
      reject(rec, "duplicate_sequence");
      continue;
    }
    // Event ids are the causal graph's node names — reusing one makes every
    // `causation_id` pointing at it ambiguous.
    if (claimedEventIds.has(rec.event_id)) {
      reject(rec, "duplicate_event_id");
      continue;
    }
    claimedSequences.add(rec.sequence);
    claimedEventIds.add(rec.event_id);
    next.push(rec);
  }
  alive = next;

  // pass 3 — cleanliness. Admissible evidence of a bad outcome is still not a
  // clean gap closure, so it is refused entry to the merged lineage. The reason
  // is held back until pass 5: a record can be BOTH unclean and causally
  // invalid, and the causal defect is the deeper one (it hard-fails, where
  // uncleanliness only degrades). Round 2 reported the deeper reason and this
  // must not weaken that.
  const unclean: Array<{ rec: ReceiptRecordV1; reason: RecoveryRejectionReason }> = [];
  next = [];
  for (const rec of alive) {
    const reason = cleanlinessRejection(rec);
    if (reason) unclean.push({ rec, reason });
    else next.push(rec);
  }
  alive = next;

  // pass 4 — causal order against the frame of the journal PLUS every surviving
  // candidate, iterated until stable so a dropped cause drops its dependents.
  //
  // The frame deliberately excludes unclean candidates: they never enter the
  // merged view, so a dependent that leans on one really has NO cause there —
  // admitting it would be exactly the round-1 defect where an inadmissible
  // recovery closed a gap.
  const frame = new Map<string, number>();
  for (const r of ctx.journal) if (!frame.has(r.event_id)) frame.set(r.event_id, r.sequence);
  for (const r of alive) frame.set(r.event_id, r.sequence);

  const causalRejection = (rec: ReceiptRecordV1): RecoveryRejectionReason | null => {
    if (!rec.causation_id) return null;
    const causeSeq = frame.get(rec.causation_id);
    if (causeSeq === undefined) return "unknown_causation";
    if (causeSeq >= rec.sequence) return "cause_not_before_effect";
    return null;
  };

  for (;;) {
    let changed = false;
    next = [];
    for (const rec of alive) {
      const reason = causalRejection(rec);
      if (reason) {
        reject(rec, reason);
        frame.delete(rec.event_id);
        changed = true;
        continue;
      }
      next.push(rec);
    }
    alive = next;
    if (!changed) break;
  }

  // pass 5 — now the frame is final, report the unclean candidates with their
  // DEEPEST defect: a broken causal link if they also have one, uncleanliness
  // otherwise.
  for (const { rec, reason } of unclean) reject(rec, causalRejection(rec) ?? reason);

  // The report itself must not leak the caller's order either.
  rejected.sort((a, b) => a.sequence - b.sequence || (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0) || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));

  return { accepted: alive, rejected };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconcile the durable journal against the producer's checkpoint.
 *
 * Read-only unless `repair_checkpoint` is set; see `checkpoint_repair`.
 *
 * LOCK ORDER (MH-06-R3-B2). When a durable repair is requested, the canonical
 * journal lock is taken BEFORE the scan that defines the repair proposal, and
 * held until the proposal has been written and verified. Round 3 found the
 * opposite order: reconciliation scanned, computed `checkpoint_after`, THEN took
 * the lock, and then verified the persisted file against its own pre-lock
 * snapshot. A writer that committed sequence 2 in that window was invisible —
 * repair overwrote the checkpoint with sequence 1 and returned
 * `verified: true, residual_disagreements: [], blocks_clean_close: false`. A
 * repair whose evidence predates its exclusive access is not evidence.
 *
 * A read-only reconciliation takes NO lock, deliberately: it is the diagnosis
 * path, and a journal wedged by a crashed writer's stale lock must still be
 * diagnosable. Racing a live writer can therefore make a read-only verdict
 * report a disagreement that resolves itself — a false alarm that fails CLOSED
 * (`degraded`, blocks close), never a false clean.
 *
 * IDENTITY, THEN EXCLUSION, THEN RETENTION (MH-06-R4-B1, MH-06-R5-B2). A repair
 * is a mutation, so it resolves the PHYSICAL journal before it locks anything,
 * pins that journal with an open descriptor for the whole repair, and scans the
 * canonical path the lock names rather than the caller's spelling. Round 5 stopped
 * there, and a repair that ACQUIRED the canonical lock and then lost it — to a
 * hard link, or to a renamed canonical parent that carried the lock away — still
 * reported `verified: true`, `succeeded` and `blocks_clean_close: false` while a
 * competing lock in the replacement location was held. Losing authority after
 * acquisition is now exactly as blocking as never getting it: the retained
 * authority is re-proved before the checkpoint is written and again before
 * `verified` may be set, and a loss becomes `repair_identity_ambiguous` /
 * `repair_identity_unstable` — both of which are denials of exclusive access.
 */
export function reconcileReceiptJournal(opts: ReconcileOptions): ReconciliationOutcomeV1 {
  const io = opts.io ?? defaultJournalIo;
  if (opts.repair_checkpoint !== true) return reconcileWithin(opts, io, null, opts.journalPath, null);

  const acquired = acquireJournalAuthority(
    opts.journalPath,
    io,
    { lock_max_attempts: opts.lock_max_attempts, lock_wait_ms: opts.lock_wait_ms },
    "read",
  );
  // Without exclusive access there is no trustworthy snapshot to repair FROM, so
  // the repair fails closed — but the read-only verdict is still produced and
  // still honest about what it saw.
  if (!acquired.ok) {
    return reconcileWithin(
      opts,
      io,
      accessDenial(acquired.failure),
      acquired.identity?.path ?? opts.journalPath,
      null,
    );
  }
  const authority = acquired.authority;
  try {
    return reconcileWithin(opts, io, null, authority.identity.path, authority);
  } finally {
    // A typed failure must never leak the lock and wedge every later writer — and
    // must never delete a lock belonging to whoever replaced this one.
    authority.release();
  }
}

/** A requested repair that was denied exclusive access, and why. */
interface RepairAccessDenial {
  code: CheckpointRepairFailureCode;
  message: string;
}

/** Carry a journal-identity refusal into the repair's own failure vocabulary. */
function identityDenial(failure: JournalIdentityFailure): RepairAccessDenial {
  return {
    code: failure.code === "journal_identity_ambiguous" ? "repair_identity_ambiguous" : "repair_identity_unstable",
    message: failure.message,
  };
}

/**
 * Carry ANY refusal of exclusive access — identity or lock — into the repair's
 * vocabulary. One mapping, so a new way of losing access cannot quietly land
 * outside `REPAIR_ACCESS_DENIALS` and be promoted to a verified clean repair.
 */
function accessDenial(failure: JournalAuthorityFailure): RepairAccessDenial {
  if (failure.code === "journal_lock_unavailable") return { code: "repair_lock_unavailable", message: failure.message };
  if (failure.code === "journal_lock_failed") return { code: "repair_lock_failed", message: failure.message };
  return identityDenial({ code: failure.code, message: failure.message });
}

/**
 * The verdict itself. Every read below happens under whatever exclusion the
 * caller established: with `repair_checkpoint`, that is the canonical journal
 * lock over `journalPath` (the canonical name, not the caller's spelling);
 * without it, none — and then nothing here writes.
 */
function reconcileWithin(
  opts: ReconcileOptions,
  io: JournalIo,
  denial: RepairAccessDenial | null,
  journalPath: string,
  authority: RetainedJournalAuthority | null,
): ReconciliationOutcomeV1 {
  // Every journal read goes through the retained handle when a repair holds one,
  // so a replaced parent cannot silently substitute a different physical journal
  // for the one this verdict is about. A read-only reconcile holds nothing and
  // reads by path, deliberately: it makes no durable claim.
  const journalIo = authority !== null ? authority.bind(io) : io;
  const scan = scanReceiptJournal(journalPath, journalIo);
  const checkpointRead = readCheckpointState(opts.checkpointPath, io);
  const checkpoint_before = checkpointRead.checkpoint;

  // ── 1. Which sequences should exist, and which are actually durable? ──────
  const observed = new Set(scan.records.map((r) => r.sequence));
  const expectedMax = Math.max(opts.producerCheckpoint.last_sequence, scan.last_sequence);
  const missing: number[] = [];
  for (let s = 1; s <= expectedMax; s += 1) if (!observed.has(s)) missing.push(s);
  const gapRuns = toRuns(missing);

  // ── 2. Vet each offered recovery before it can close anything ────────────
  const missingSet = new Set(missing);
  const { accepted: acceptedRecoveries, rejected: rejected_recoveries } = vetRecoveries(opts.recovered ?? [], {
    run_id: opts.run_id,
    missing: missingSet,
    journal: scan.records,
  });
  const claimed = new Set<number>(acceptedRecoveries.map((r) => r.sequence));

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

  // One event id must name exactly ONE record. Grouping by operation cannot see
  // this: the two records live under two different operations and would each be
  // counted as a clean authoritative effect (MH-06-R2-B5).
  const byEventId = new Map<string, ReceiptRecordV1[]>();
  for (const r of merged) {
    const list = byEventId.get(r.event_id);
    if (list) list.push(r);
    else byEventId.set(r.event_id, [r]);
  }
  const event_identity_conflicts: EventIdentityConflict[] = [];
  for (const [event_id, group] of byEventId) {
    if (group.length < 2) continue;
    event_identity_conflicts.push({
      event_id,
      sequences: group.map((r) => r.sequence),
      operation_ids: [...new Set(group.map((r) => r.operation_id))],
    });
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
  //
  // `updated_at` is the `recorded_at` of the record the checkpoint NAMES, not
  // the moment reconciliation ran. That is what `appendReceipt` writes, and it
  // is what makes staleness detectable without a clock — a proposal stamped with
  // `reconciled_at` would be judged stale by its own agreement test the moment
  // it was persisted, so repair could never converge.
  const mergedLast = highest(merged);
  const checkpoint_after: ReceiptCheckpointV1 = {
    schema_version: "guild.receipt_checkpoint.v1",
    run_id: opts.run_id,
    last_sequence: mergedLast?.sequence ?? 0,
    last_event_id: mergedLast?.event_id ?? null,
    record_count: merged.length,
    updated_at: mergedLast?.recorded_at ?? opts.reconciled_at,
    contract_version: RECEIPT_CONTRACT_VERSION,
  };

  // ── 5. The three agreements ──────────────────────────────────────────────
  // Agreement 1 is the SHARED primitive, so a stale, forged, or malformed
  // checkpoint fails identically here and in the debug bundle.
  const checkpoint_disagreements: CheckpointDisagreement[] = [
    ...compareCheckpointToJournal(checkpointRead, scan, opts.run_id),
  ];
  const journalLast = highest(scan.records);

  // A producer claiming durable work beside NO checkpoint at all is a breached
  // durable boundary even when the journal is empty too (MHRC-RCT-002).
  if (
    checkpointRead.state === "absent" &&
    scan.record_count === 0 &&
    (opts.producerCheckpoint.record_count > 0 || opts.producerCheckpoint.last_sequence > 0)
  ) {
    checkpoint_disagreements.push({
      code: "checkpoint_missing",
      expected: opts.producerCheckpoint.last_sequence,
      actual: null,
    });
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
  for (const conflict of event_identity_conflicts) {
    checkpoint_disagreements.push({
      code: "merged_event_identity_conflict",
      expected: conflict.event_id,
      actual: conflict.sequences.join(","),
    });
  }

  // ── 6. Verdict inputs ────────────────────────────────────────────────────
  const tailDamaged =
    scan.integrity === "truncated_tail" ||
    scan.integrity === "corrupt" ||
    scan.integrity === "order_violation" ||
    scan.integrity === "lineage_violation";
  const invalidRecovery = rejected_recoveries.some((r) => INVALID_RECOVERY_REASONS.has(r.reason));
  const hardFailure = conflicts.length > 0 || invalidRecovery || event_identity_conflicts.length > 0;
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
    residual_disagreements: [],
    failure: null,
  };

  // AUTHORITY GATE — a repair that acquired exclusive access and then LOST it
  // never froze the snapshot either, so it is the same denial (MH-06-R5-B2).
  // Evaluated before the blockers for exactly the reason the lock denial is:
  // a "not permitted" verdict derived from an unfrozen snapshot is a guess.
  const lostAuthority =
    checkpoint_repair.requested && !denial && authority !== null
      ? authority.verify("before the checkpoint repair")
      : null;

  if (checkpoint_repair.requested && (denial || lostAuthority)) {
    // No exclusive access ⇒ no repair, and no claim about what the journal holds.
    // Reported ahead of every other refusal reason on purpose: a "not permitted"
    // verdict derived from a snapshot we could not freeze would be a guess.
    const refusal = denial ?? identityDenial(lostAuthority!);
    checkpoint_repair.failure = { code: refusal.code, message: refusal.message };
  } else if (checkpoint_repair.requested) {
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
    // A single-run journal whose ONE run is not this run reads as structurally
    // intact, so without this guard repair would stamp our run id over another
    // run's durable records.
    if (foreignRun !== undefined) {
      blockers.push(`journal belongs to run "${foreignRun}", not "${opts.run_id}"`);
    }
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

    // AUTHORITY GATE — re-proved IMMEDIATELY before the mutation, not merely
    // before the decision to attempt one. The gate above establishes precedence
    // over `repair_not_permitted`; this one closes the window between them.
    const stillHeldToWrite = blockers.length === 0 && authority !== null
      ? authority.verify("before the repair write")
      : null;

    if (blockers.length > 0) {
      checkpoint_repair.failure = {
        code: "repair_not_permitted",
        message: `checkpoint repair refused: ${blockers.join("; ")}`,
      };
    } else if (stillHeldToWrite) {
      checkpoint_repair.failure = identityDenial(stillHeldToWrite);
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
        // Prove it three ways: the file must re-read as the checkpoint we wrote,
        // it must leave NO disagreement standing against the journal as it is
        // NOW — re-scanned, not the snapshot the proposal was built from — and
        // the exclusion this repair was granted must STILL be held.
        //
        // Re-scanning under the lock we already hold looks redundant, and that is
        // the point: it is the assertion that the lock did its job. If anything
        // moved the journal anyway (a lock primitive that lies, a writer that
        // never took the lock), the written checkpoint no longer describes it and
        // this fails closed instead of reporting a verified clean repair.
        //
        // Internal agreement is not authority, though: round 5 proved journal and
        // checkpoint can agree PERFECTLY at a replacement path this caller never
        // locked. So the retained authority is the third condition, not a fourth
        // opinion about the same bytes.
        const currentScan = scanReceiptJournal(journalPath, journalIo);
        const reread = readCheckpointState(opts.checkpointPath, io);
        const identical = reread.checkpoint !== null && checkpointsIdentical(reread.checkpoint, checkpoint_after);
        checkpoint_repair.residual_disagreements = compareCheckpointToJournal(reread, currentScan, opts.run_id);
        const stillHeld = authority !== null ? authority.verify("before the repair is reported verified") : null;
        checkpoint_repair.verified =
          identical && checkpoint_repair.residual_disagreements.length === 0 && stillHeld === null;
        if (!checkpoint_repair.verified) {
          checkpoint_repair.failure = stillHeld
            ? identityDenial(stillHeld)
            : {
                code: "repair_verify_failed",
                message: identical
                  ? `checkpoint was written but still disagrees with the journal: ${checkpoint_repair.residual_disagreements
                      .map((d) => d.code)
                      .join(", ")}`
                  : "checkpoint on disk does not match the reconciled checkpoint after write",
              };
        }
      }
    }
  }

  // A REQUESTED repair that was denied exclusive access never ran at all, so the
  // durable mutation the caller asked for did not happen AND nothing held the
  // journal still while this verdict was computed (MH-06-R4-B2). Round 4 found
  // the narrower reading below — `attempted && !verified` — let exactly that
  // outcome be promoted to `succeeded` with `blocks_clean_close: false` whenever
  // the unlocked snapshot happened to agree with its checkpoint. It is the same
  // fail-closed rule `appendReceipt` already applies to `journal_lock_unavailable`.
  //
  // `repair_not_permitted` is deliberately NOT in this set: that decision is made
  // WITH the lock held, from blockers that are enumerated and drive the verdict on
  // their own.
  const repairAccessDenied =
    checkpoint_repair.requested &&
    checkpoint_repair.failure !== null &&
    REPAIR_ACCESS_DENIALS.has(checkpoint_repair.failure.code);

  // A requested repair that did not verify — whether it was attempted and failed,
  // or was never allowed to start — is a durable failure, not a nit.
  const repairFailed = (checkpoint_repair.attempted || repairAccessDenied) && !checkpoint_repair.verified;
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
    event_identity_conflicts,
    authoritative_effect_count: byOperation.size,
    reconciled_order: merged.map((r) => ({ sequence: r.sequence, event_id: r.event_id })),
    checkpoint_before,
    checkpoint_before_state: checkpointRead.state,
    checkpoint_after,
    checkpoint_disagreements,
    checkpoint_repair,
    blocks_clean_close,
    contract_version: RECEIPT_CONTRACT_VERSION,
    reconciled_at: opts.reconciled_at,
  };
}
