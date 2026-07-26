/**
 * src/modules/telemetry/workflows/receipt-journal.ts
 *
 * MH-06 — the atomic receipt journal (the `observability` boundary of
 * runtime-boundary-contract.v1, public API id `guild.observability.v1`).
 *
 * WHAT THIS OWNS (per the frozen W0 contract, boundary `observability`):
 *   - a durable, ordered operation/lifecycle receipt trail;
 *   - monotonic sequence + checkpoint semantics;
 *   - operation / correlation / source / runtime / contract version binding;
 *   - observation-state semantics;
 *   - atomic append-failure semantics.
 *
 * WHAT THIS DOES NOT OWN (MH-02 / MH-03 / MH-04 territory — do not add here):
 *   - lifecycle transition decisions or policy evaluation;
 *   - host-native event acquisition;
 *   - transport mechanics;
 *   - human presentation rendering.
 *
 * THE CENTRAL RULE (BR-07 / CI-05): an absent observation or receipt is NEVER
 * success, cleanliness, support, or conformance. Every read path here defaults
 * to `not_observed`, and every write path either lands durably or returns an
 * explicit typed failure. There is no third answer.
 *
 * DURABILITY MODEL
 *   The journal is append-only JSONL. Each line is a self-contained record
 *   carrying `record_hash` over its own canonical body, so a torn tail is
 *   detectable by the reader instead of being silently accepted. A write is
 *   "durable" only when the line was appended AND fsync'd AND the checkpoint
 *   was atomically replaced. If any of those fails, `appendReceipt` returns
 *   `disposition: "failed"` — it never reports success without durable evidence.
 *
 *   Because an interrupted append can leave a newline-less partial line, a
 *   subsequent append onto that tail would concatenate into the partial line
 *   and destroy BOTH records. `appendReceipt` therefore refuses to append to a
 *   journal that is not `intact` or `absent`; the caller must run
 *   `reconcileReceiptJournal` first. Failing closed is the point.
 *
 * CONCURRENCY MODEL (MHRC-RCT-001 input pattern
 * `sequential_and_concurrent_operations`)
 *   Sequence assignment is a read-modify-write: scan the journal, take
 *   `last_sequence + 1`, append, replace the checkpoint. Run that unguarded from
 *   two processes and both read the same prior state, both write the same
 *   sequence, and BOTH report durable success — the journal then holds duplicate
 *   sequences and the checkpoint describes neither writer. An in-process mutex
 *   cannot fix this: the competing writers are separate OS processes.
 *
 *   The whole transaction therefore runs under a CROSS-PROCESS advisory lock —
 *   an `mkdir` on `<journal>.lock`, which is the one filesystem primitive that
 *   is atomic on every platform Guild targets (APFS, ext4, NFS, Windows).
 *   A writer that cannot take the lock within a bounded number of attempts
 *   returns `journal_lock_unavailable`; it never proceeds optimistically. The
 *   lock is released in a `finally`, so a typed failure never leaks it.
 *
 *   A lock only excludes writers that agree on its identity, so the identity is
 *   DERIVED, never chosen: `journalLockPath` canonicalizes the journal path and
 *   appends `.lock`. There is no caller-supplied override — a public API that let
 *   each caller pick its own lock path would let two writers hold "the" lock for
 *   one journal at the same time and both report durable success, which is the
 *   exact defect the lock exists to prevent.
 *
 *   Canonicalizing a NAME is not the same as identifying a FILE, and round 4
 *   proved the gap is exploitable both ways. Two hard links to one inode are two
 *   canonical names, so a name-keyed lock partitions them; and a symlinked parent
 *   swapped between lock derivation and the write sends the append to a
 *   destination whose own lock somebody else holds. Both are closed by
 *   `resolveJournalIdentity`, which binds the lock AND the write to the physical
 *   file: it refuses a journal that has more than one name at all, it re-derives
 *   under the lock and again before any durable claim, and every read and write of
 *   the guarded transaction goes through the canonical path the lock names rather
 *   than the caller's mutable spelling. Where a stable identity cannot be
 *   established, the operation fails closed BEFORE the append — it never guesses.
 *
 *   Durability is then PROVEN, not assumed: after the append the journal is
 *   re-scanned for the exact sealed record, and after the checkpoint write the
 *   checkpoint file is re-read and compared field by field. A write that lands
 *   nothing, or lands something else, is `journal_append_unverified` /
 *   `checkpoint_write_unverified` — a typed failure, never success.
 *
 * DETERMINISM
 *   No Date.now(), no randomness. Every timestamp is supplied by the caller,
 *   so records and checkpoints are byte-reproducible from fixed inputs.
 *
 * Usage:
 *   import { appendReceipt, scanReceiptJournal } from "../../telemetry";
 *   const out = appendReceipt({ journal, checkpoint }, makeReceiptInput({...}));
 *   if (out.disposition !== "succeeded") { /* explicit typed failure *\/ }
 *
 * Owned by: tooling-engineer (scripts/ + src/modules scope per AGENTS.md).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
// Cross-module import MUST target the state module's public index, never a
// private workflow path (module-ownership gate; contract BR-06 / CI-07).
import { atomicWrite } from "../../state";

// ─────────────────────────────────────────────────────────────────────────────
// Closed vocabularies — verbatim from conformance-scenarios.v1.json
// ─────────────────────────────────────────────────────────────────────────────

/** Public API id this module implements (runtime-boundary-contract.v1). */
export const RECEIPT_CONTRACT_VERSION = "guild.observability.v1";

export const RECEIPT_DISPOSITIONS = [
  "succeeded",
  "refused",
  "unsupported",
  "failed",
  "degraded",
] as const;
export type ReceiptDisposition = (typeof RECEIPT_DISPOSITIONS)[number];

export const OBSERVATION_STATES = [
  "checked_clean",
  "not_applicable",
  "not_observed",
  "observation_failed",
] as const;
export type ObservationState = (typeof OBSERVATION_STATES)[number];

export const RECEIPT_EVENT_NAMES = [
  "session.start",
  "prompt.submit",
  "tool.before",
  "tool.after",
  "context.compact",
  "task.dispatch",
  "task.collect",
  "run.resume",
  "run.stop",
  "package.render",
  "package.install",
  "package.activate",
  "package.update",
  "runtime.verify",
  "receipt.append",
  "receipt.reconcile",
  "migration.shadow",
  "migration.cutover",
  "migration.rollback",
] as const;
export type ReceiptEventName = (typeof RECEIPT_EVENT_NAMES)[number];

export const RECEIPT_OUTCOME_TYPES = [
  "guild.lifecycle_outcome.v1",
  "guild.normalized_event_outcome.v1",
  "guild.support_transition_outcome.v1",
  "guild.capability_outcome.v1",
  "guild.policy_outcome.v1",
  "guild.receipt_outcome.v1",
  "guild.reconciliation_outcome.v1",
  "guild.boundary_outcome.v1",
  "guild.migration_outcome.v1",
  "guild.version_compatibility_outcome.v1",
] as const;
export type ReceiptOutcomeType = (typeof RECEIPT_OUTCOME_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Record shape
// ─────────────────────────────────────────────────────────────────────────────

/** Version identities bound to every receipt (E-RECEIPT + acceptance 2). */
export interface ReceiptVersions {
  host_id: string;
  host_version: string;
  runtime_version: string;
  source_version: string;
  contract_version: string;
}

/** Inclusive sequence bounds an observation failure affects. */
export interface SequenceRange {
  from: number;
  to: number;
}

/** Caller-supplied receipt content. `sequence` is assigned by the journal. */
export interface ReceiptAppendInput {
  run_id: string;
  operation_id: string;
  correlation_id: string;
  event_id: string;
  causation_id: string | null;
  scenario_id: string | null;
  event_name: ReceiptEventName;
  outcome_type: ReceiptOutcomeType;
  disposition: ReceiptDisposition;
  observation_state: ObservationState;
  input_hash: string;
  output_hash: string | null;
  terminal: boolean;
  recorded_at: string;
  observed_at: string | null;
  versions: ReceiptVersions;
  affected_event_range: SequenceRange | null;
}

/** One durable, self-verifying journal record. */
export interface ReceiptRecordV1 extends ReceiptAppendInput {
  schema_version: "guild.receipt_record.v1";
  sequence: number;
  record_hash: string;
}

/**
 * Normalize caller input, filling the optional fields with their explicit
 * null defaults. Deliberately PERMISSIVE about values — validation happens in
 * `appendReceipt` so an invalid record produces a typed `invalid_record`
 * failure rather than a thrown exception at construction time.
 */
export function makeReceiptInput(
  input: Omit<ReceiptAppendInput, "causation_id" | "scenario_id" | "output_hash" | "observed_at" | "affected_event_range"> &
    Partial<Pick<ReceiptAppendInput, "causation_id" | "scenario_id" | "output_hash" | "observed_at" | "affected_event_range">>,
): ReceiptAppendInput {
  return {
    run_id: input.run_id,
    operation_id: input.operation_id,
    correlation_id: input.correlation_id,
    event_id: input.event_id,
    causation_id: input.causation_id ?? null,
    scenario_id: input.scenario_id ?? null,
    event_name: input.event_name,
    outcome_type: input.outcome_type,
    disposition: input.disposition,
    observation_state: input.observation_state,
    input_hash: input.input_hash,
    output_hash: input.output_hash ?? null,
    terminal: input.terminal,
    recorded_at: input.recorded_at,
    observed_at: input.observed_at ?? null,
    versions: input.versions,
    affected_event_range: input.affected_event_range ?? null,
  };
}

/** Deterministic, key-sorted JSON — the canonical form the hash is taken over. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function sha256(text: string): string {
  return `sha256:${crypto.createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * Seal a record: attach `schema_version` and the integrity hash taken over the
 * canonical body (every field EXCEPT `record_hash` itself).
 *
 * Exported because reconciliation and recovery producers must be able to build
 * a verifiable record without going through the append path.
 */
export function sealReceiptRecord(input: ReceiptAppendInput & { sequence: number }): ReceiptRecordV1 {
  const body = {
    ...makeReceiptInput(input),
    schema_version: "guild.receipt_record.v1" as const,
    sequence: input.sequence,
  };
  return { ...body, record_hash: sha256(canonicalJson(body)) };
}

/** Recompute a record's hash and compare it to the stored one. */
export function verifyReceiptRecord(record: ReceiptRecordV1): boolean {
  const { record_hash, ...body } = record;
  return typeof record_hash === "string" && sha256(canonicalJson(body)) === record_hash;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint
// ─────────────────────────────────────────────────────────────────────────────

export interface ReceiptCheckpointV1 {
  schema_version: "guild.receipt_checkpoint.v1";
  run_id: string;
  last_sequence: number;
  last_event_id: string | null;
  record_count: number;
  updated_at: string;
  contract_version: string;
}

/**
 * Full structural gate for a checkpoint.
 *
 * `schema_version` alone is NOT enough: a file carrying the right tag but a
 * missing `record_count`, a string `last_sequence`, or a forged
 * `contract_version` still parses, and treating it as a real checkpoint lets a
 * fabricated durability claim through the boundary (CI-05).
 */
export function isValidCheckpointShape(value: unknown): value is ReceiptCheckpointV1 {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  if (c.schema_version !== "guild.receipt_checkpoint.v1") return false;
  if (typeof c.run_id !== "string" || c.run_id.length === 0) return false;
  if (typeof c.last_sequence !== "number" || !Number.isInteger(c.last_sequence) || c.last_sequence < 0) return false;
  if (typeof c.record_count !== "number" || !Number.isInteger(c.record_count) || c.record_count < 0) return false;
  if (c.last_event_id !== null && (typeof c.last_event_id !== "string" || c.last_event_id.length === 0)) return false;
  if (typeof c.updated_at !== "string" || c.updated_at.length === 0) return false;
  if (typeof c.contract_version !== "string" || c.contract_version.length === 0) return false;
  return true;
}

/**
 * Three distinguishable outcomes. Collapsing `malformed` into `absent` hides the
 * difference between "no writer ever got here" and "a writer left damage", and
 * only the second one means the durable boundary was breached.
 */
export type CheckpointReadState = "absent" | "malformed" | "present";

export interface CheckpointReadResult {
  state: CheckpointReadState;
  checkpoint: ReceiptCheckpointV1 | null;
}

/** Read a checkpoint and say EXACTLY which of the three states it is in. */
export function readCheckpointState(
  checkpointPath: string,
  io: JournalIo = defaultJournalIo,
): CheckpointReadResult {
  const raw = io.readAll(checkpointPath);
  if (raw === null) return { state: "absent", checkpoint: null };
  // A zero-byte file is damage, not absence: something opened it and wrote nothing.
  if (raw.trim().length === 0) return { state: "malformed", checkpoint: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "malformed", checkpoint: null };
  }
  if (!isValidCheckpointShape(parsed)) return { state: "malformed", checkpoint: null };
  return { state: "present", checkpoint: parsed };
}

/** Read a checkpoint, or null when absent/malformed (never a guessed value). */
export function readCheckpoint(
  checkpointPath: string,
  io: JournalIo = defaultJournalIo,
): ReceiptCheckpointV1 | null {
  return readCheckpointState(checkpointPath, io).checkpoint;
}

/**
 * Every concrete way an on-disk checkpoint can fail to describe the durable
 * journal beside it.
 *
 * `checkpoint_timestamp_mismatch` is the clock-free staleness test: the writer
 * sets `updated_at` to the `recorded_at` of the record it names, so a checkpoint
 * whose timestamp does not equal that record's is provably not the checkpoint
 * that record's append produced — no wall clock required.
 */
export type CheckpointAgreementCode =
  | "checkpoint_missing"
  | "checkpoint_malformed"
  | "checkpoint_run_mismatch"
  | "checkpoint_sequence_mismatch"
  | "checkpoint_count_mismatch"
  | "checkpoint_event_mismatch"
  | "checkpoint_timestamp_mismatch"
  | "checkpoint_contract_mismatch";

export interface CheckpointAgreement {
  code: CheckpointAgreementCode;
  /** What the authoritative side (the durable journal) says. */
  expected: string | number | null;
  /** What the disagreeing side (the checkpoint file) says. */
  actual: string | number | null;
}

/** Field-by-field checkpoint equality — the only sanctioned "same checkpoint". */
export function checkpointsIdentical(a: ReceiptCheckpointV1, b: ReceiptCheckpointV1): boolean {
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

/** The record a checkpoint names: the one carrying the highest sequence. */
export function highestSequenceRecord(records: ReceiptRecordV1[]): ReceiptRecordV1 | null {
  let best: ReceiptRecordV1 | null = null;
  for (const r of records) if (!best || r.sequence >= best.sequence) best = r;
  return best;
}

/**
 * Compare an on-disk checkpoint against the durable journal it claims to
 * describe. Shared by reconciliation and the debug bundle so both consumers
 * apply the SAME agreement test — MH-06-R1-B1 was only half-closed because they
 * did not (MH-06-R2-B3).
 */
export function compareCheckpointToJournal(
  read: CheckpointReadResult,
  scan: JournalScanResult,
  run_id: string,
): CheckpointAgreement[] {
  const journalLast = highestSequenceRecord(scan.records);

  if (read.state === "malformed") {
    return [{ code: "checkpoint_malformed", expected: run_id, actual: null }];
  }
  if (read.state === "absent" || read.checkpoint === null) {
    // Nothing durable and no checkpoint is the one coherent "nothing happened".
    if (scan.record_count === 0) return [];
    return [{ code: "checkpoint_missing", expected: scan.last_sequence, actual: null }];
  }

  const cp = read.checkpoint;
  const out: CheckpointAgreement[] = [];
  if (cp.run_id !== run_id) out.push({ code: "checkpoint_run_mismatch", expected: run_id, actual: cp.run_id });
  if (cp.contract_version !== RECEIPT_CONTRACT_VERSION) {
    out.push({ code: "checkpoint_contract_mismatch", expected: RECEIPT_CONTRACT_VERSION, actual: cp.contract_version });
  }
  if (cp.last_sequence !== scan.last_sequence) {
    out.push({ code: "checkpoint_sequence_mismatch", expected: scan.last_sequence, actual: cp.last_sequence });
  }
  if (cp.record_count !== scan.record_count) {
    out.push({ code: "checkpoint_count_mismatch", expected: scan.record_count, actual: cp.record_count });
  }
  if (cp.last_event_id !== (journalLast?.event_id ?? null)) {
    out.push({ code: "checkpoint_event_mismatch", expected: journalLast?.event_id ?? null, actual: cp.last_event_id });
  }
  if (journalLast && cp.updated_at !== journalLast.recorded_at) {
    out.push({ code: "checkpoint_timestamp_mismatch", expected: journalLast.recorded_at, actual: cp.updated_at });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// IO seam — real fs by default, injectable so faults are testable
// ─────────────────────────────────────────────────────────────────────────────

export interface JournalIo {
  /** Append EXACTLY `text` and make it durable (fsync). Throws on failure. */
  appendLine(journalPath: string, text: string): void;
  /** Full journal contents, or null when the file does not exist. */
  readAll(journalPath: string): string | null;
  /** Atomically replace the checkpoint file. Throws on failure. */
  writeCheckpoint(checkpointPath: string, content: string): void;
  /** Shrink the journal to `size` bytes. Throws on failure. */
  truncate(journalPath: string, size: number): void;
  /**
   * ATOMICALLY take the cross-process lock. `true` when this caller now holds
   * it, `false` when another holder has it. Throws only on a real IO fault
   * (which must fail the operation closed, not be read as "not held").
   *
   * Optional so existing `JournalIo` fakes keep type-checking; the default
   * implementation is used whenever a seam does not supply one.
   */
  acquireLock?(lockPath: string): boolean;
  /** Release a lock this caller holds. Must not throw when it is already gone. */
  releaseLock?(lockPath: string): void;
}

export const defaultJournalIo: JournalIo = {
  appendLine(journalPath, text) {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    const fd = fs.openSync(journalPath, "a");
    try {
      fs.writeSync(fd, text, null, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  },
  readAll(journalPath) {
    try {
      return fs.readFileSync(journalPath, "utf8");
    } catch {
      return null;
    }
  },
  writeCheckpoint(checkpointPath, content) {
    atomicWrite(checkpointPath, content);
  },
  truncate(journalPath, size) {
    fs.truncateSync(journalPath, size);
  },
  // `mkdir` is the portable atomic test-and-set: it either creates the
  // directory or fails EEXIST, with no window in between. `open(O_CREAT|O_EXCL)`
  // has the same guarantee locally but is famously unreliable over NFS, and
  // Guild journals can live on a shared volume.
  acquireLock(lockPath) {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    try {
      fs.mkdirSync(lockPath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  },
  releaseLock(lockPath) {
    try {
      fs.rmdirSync(lockPath);
    } catch {
      /* already released — releasing twice is not an error */
    }
  },
};

export interface JournalPaths {
  journal: string;
  checkpoint: string;
}

/**
 * Bounded so a symlink cycle cannot spin. No real journal path is 32 links deep,
 * and one that is has a defect of its own — it gets a deterministic answer here,
 * never a hang.
 */
const CANONICAL_PATH_MAX_LINK_HOPS = 32;

function realpathOrNull(target: string): string | null {
  try {
    // `.native` resolves symlinks AND returns the on-disk spelling, so a
    // case-variant name on a case-insensitive volume lands on one identity.
    return (fs.realpathSync.native ?? fs.realpathSync)(target);
  } catch {
    return null;
  }
}

function readlinkOrNull(target: string): string | null {
  try {
    return fs.readlinkSync(target);
  } catch {
    return null;
  }
}

/**
 * The single canonical name of a journal — the identity everything about that
 * journal is keyed to.
 *
 * One file can be named many ways: relative or absolute, with `.` / `..` / `//`
 * segments, through a symlinked directory, through a symlink to the file itself,
 * or (on a case-insensitive volume) with different case. Every one of those must
 * produce the SAME identity, or two writers holding "the" lock for one journal is
 * a legal state.
 *
 * The derivation is: resolve to absolute, then `realpath` the longest existing
 * prefix and re-attach the segments that do not exist yet. A dangling symlink is
 * followed by hand, because a symlink to a not-yet-created journal still names
 * that journal. The unresolved segments are plain names, so creating them later
 * cannot change the answer — the derivation is stable over time, which matters:
 * a lock identity that changed the moment the journal was created would partition
 * the first writer from every later one.
 *
 * Never throws and reads no clock; an unresolvable path degrades to
 * `path.resolve`, which is still deterministic.
 */
export function canonicalJournalPath(journalPath: string): string {
  let current = path.resolve(journalPath);
  for (let hop = 0; hop < CANONICAL_PATH_MAX_LINK_HOPS; hop += 1) {
    const real = realpathOrNull(current);
    if (real !== null) return real;

    const link = readlinkOrNull(current);
    if (link !== null) {
      // A dangling symlink: resolve its target relative to the link's directory.
      const next = path.resolve(path.dirname(current), link);
      if (next === current) return current; // self-referential link
      current = next;
      continue;
    }

    const parent = path.dirname(current);
    if (parent === current) return current; // reached the root
    return path.join(canonicalJournalPath(parent), path.basename(current));
  }
  return current;
}

/**
 * Why a journal has no single lock identity.
 *
 * `journal_identity_ambiguous` — the physical file has MORE THAN ONE name (hard
 * links). Every name canonicalizes to itself, so a path-keyed lock gives each one
 * its own exclusion and neither excludes the other. No portable primitive keys a
 * lock to `(device, inode)`: a lock beside the canonical path partitions the
 * moment the links live in different directories, and a machine-global lock root
 * stops working the moment the journal lives on a shared volume. There is no
 * correct single answer, so the honest one is to refuse — before any durable
 * claim — rather than to invent one.
 *
 * `journal_identity_unstable` — the canonical name does not hold still, or does
 * not name a lockable regular file: a parent symlink was repointed, a symlink
 * appeared at the canonical name, or the physical file behind it was replaced.
 * Binding write authority to something that moves is how an append lands in a
 * journal whose own lock is held by somebody else.
 */
export type JournalIdentityFailureCode = "journal_identity_ambiguous" | "journal_identity_unstable";

export interface JournalIdentityFailure {
  code: JournalIdentityFailureCode;
  message: string;
}

/**
 * The physical journal an operation is authorised over: one canonical name, one
 * lock derived from it, and the filesystem identity of the file behind it.
 *
 * `device`/`inode` are null when the journal does not exist yet — that is a legal
 * state (the first writer creates it), and the canonical name is stable across
 * creation because its unresolved tail is a plain name under a fully resolved
 * parent. `links` is the hard-link count that made the identity admissible.
 */
export interface JournalIdentity {
  path: string;
  lock: string;
  device: number | null;
  inode: number | null;
  links: number | null;
}

export type JournalIdentityResult =
  | { ok: true; identity: JournalIdentity; failure: null }
  | { ok: false; identity: null; failure: JournalIdentityFailure };

/** Thrown by `journalLockPath` when a journal has no single lock identity. */
export class JournalIdentityError extends Error {
  readonly code: JournalIdentityFailureCode;
  constructor(failure: JournalIdentityFailure) {
    super(failure.message);
    this.name = "JournalIdentityError";
    this.code = failure.code;
  }
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * Resolve the PHYSICAL journal an operation may lock and write, or say exactly
 * why it cannot be resolved. Never throws, reads no clock.
 *
 * Three things are established, in this order:
 *
 *   1. the canonical name is a FIXED POINT — canonicalizing it again lands on
 *      itself. A name that resolves further on the second pass is a name that
 *      moved between the two derivations, and locking it would be locking a
 *      guess;
 *   2. the canonical name is not a symlink and is a regular file (or does not
 *      exist yet) — a symlink at the canonical name is another indirection that
 *      can be repointed after the lock is taken;
 *   3. the physical file has exactly ONE name. `nlink > 1` is refused, because a
 *      path-keyed advisory lock cannot serialise two names for one inode and
 *      pretending otherwise is what let two writers both report durable success.
 *
 * `appendReceipt`, `repairTornTail` and a durable reconciliation repair all call
 * this BEFORE taking the lock and again UNDER it; the append calls it once more
 * before it reports success.
 */
export function resolveJournalIdentity(journalPath: string): JournalIdentityResult {
  const refuse = (code: JournalIdentityFailureCode, message: string): JournalIdentityResult => ({
    ok: false,
    identity: null,
    failure: { code, message },
  });

  const canonical = canonicalJournalPath(journalPath);
  if (canonicalJournalPath(canonical) !== canonical) {
    return refuse(
      "journal_identity_unstable",
      `journal path "${journalPath}" canonicalizes to "${canonical}", which itself resolves further — ` +
        "the name is moving and cannot be bound to a lock",
    );
  }

  const stat = lstatOrNull(canonical);
  if (stat === null) {
    // Not created yet. The unresolved tail is a plain name under a fully resolved
    // parent, so the identity a writer computes now is the identity every later
    // writer computes — creating the file cannot change the answer.
    return { ok: true, identity: { path: canonical, lock: `${canonical}.lock`, device: null, inode: null, links: null }, failure: null };
  }
  if (stat.isSymbolicLink()) {
    return refuse(
      "journal_identity_unstable",
      `a symlink appeared at the canonical journal name "${canonical}" after it was resolved`,
    );
  }
  if (!stat.isFile()) {
    return refuse(
      "journal_identity_unstable",
      `canonical journal name "${canonical}" does not name a regular file`,
    );
  }
  if (stat.nlink > 1) {
    return refuse(
      "journal_identity_ambiguous",
      `journal at "${canonical}" is one physical file with ${stat.nlink} names (hard links) — ` +
        "a path-keyed lock cannot serialise writers that name it differently, so this operation is refused " +
        "(remove the extra link, or give each producer its own journal)",
    );
  }
  return {
    ok: true,
    identity: { path: canonical, lock: `${canonical}.lock`, device: stat.dev, inode: stat.ino, links: stat.nlink },
    failure: null,
  };
}

/**
 * Compare the identity a lock was taken over against the identity the caller's
 * path resolves to NOW. Returns the drift, or null when they are the same file.
 *
 * A null `inode` on the LOCKED side means the journal did not exist when the lock
 * was taken, so any file that has since appeared at that canonical name appeared
 * under our exclusion and is ours. The reverse — a locked inode that is now gone
 * or different — means the file we were authorised over was replaced.
 *
 * Exported so the append path and the reconciliation repair path apply the SAME
 * test. Two copies of this rule would drift apart, and the one that drifted would
 * be the one holding a lock over the wrong file.
 */
export function journalIdentityDrift(locked: JournalIdentity, current: JournalIdentity): string | null {
  if (current.path !== locked.path) {
    return (
      `the journal path now resolves to "${current.path}" while the lock is held on "${locked.path}" — ` +
      "refusing to write to a destination this writer does not hold"
    );
  }
  if (locked.inode !== null && (current.inode !== locked.inode || current.device !== locked.device)) {
    return (
      `the journal at "${locked.path}" was replaced under the lock ` +
      `(device/inode ${locked.device}/${locked.inode} → ${current.device}/${current.inode})`
    );
  }
  return null;
}

/**
 * Where the append/repair transaction serialises — DERIVED from the journal, never
 * supplied by the caller.
 *
 * `JournalPaths` deliberately carries no `lock` field. Round 3 found that a
 * caller-selected lock path partitions serialisation: twelve processes alternating
 * two legal overrides for one journal duplicated a sequence, left the journal
 * `order_violation`, and returned nine `durable: true` successes. A journal has
 * exactly one lock because it has exactly one canonical name.
 *
 * THROWS `JournalIdentityError` when the journal has no single lock identity.
 * Round 4 called this function on two hard links to one inode and got two lock
 * paths back, then held both at once. A function that cannot give a correct answer
 * must not give a wrong one, so this one refuses instead of returning a lock that
 * excludes nobody. Workflow paths use the non-throwing `resolveJournalIdentity`
 * and turn the same refusal into a typed failure.
 */
export function journalLockPath(paths: JournalPaths): string {
  const resolved = resolveJournalIdentity(paths.journal);
  if (!resolved.ok) throw new JournalIdentityError(resolved.failure);
  return resolved.identity.lock;
}

/** How long a writer waits for a contended journal before failing closed. */
export const JOURNAL_LOCK_MAX_ATTEMPTS = 600;
export const JOURNAL_LOCK_WAIT_MS = 20;

export interface JournalLockOptions {
  lock_max_attempts?: number;
  lock_wait_ms?: number;
}

/**
 * Sleep synchronously without reading a clock into any output. `Atomics.wait`
 * on a never-signalled SharedArrayBuffer is the only portable synchronous sleep
 * in Node; busy-spinning would burn a core per contending writer.
 */
function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export type LockFailureCode = "journal_lock_unavailable" | "journal_lock_failed";

export interface LockFailure {
  code: LockFailureCode;
  message: string;
}

/**
 * Take the journal lock, retrying a BOUNDED number of times.
 *
 * Returns `null` when the lock is HELD by this caller, or the typed reason it
 * could not be taken. Never returns "probably fine": a caller that cannot prove
 * exclusive access must fail closed.
 */
export function acquireJournalLock(
  lockPath: string,
  io: JournalIo = defaultJournalIo,
  options: JournalLockOptions = {},
): LockFailure | null {
  const acquire = io.acquireLock ?? defaultJournalIo.acquireLock!;
  const attempts = Math.max(1, options.lock_max_attempts ?? JOURNAL_LOCK_MAX_ATTEMPTS);
  const wait = Math.max(0, options.lock_wait_ms ?? JOURNAL_LOCK_WAIT_MS);

  for (let i = 0; i < attempts; i += 1) {
    let got: boolean;
    try {
      got = acquire(lockPath);
    } catch (err) {
      // A real IO fault on the lock itself is a durability failure, not a
      // reason to proceed unguarded.
      return {
        code: "journal_lock_failed",
        message: `journal lock could not be evaluated at ${lockPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (got) return null;
    if (i < attempts - 1) sleepSync(wait);
  }
  return {
    code: "journal_lock_unavailable",
    message:
      `journal lock at ${lockPath} is held by another writer after ${attempts} attempts — ` +
      "refusing to append without exclusive access (remove the lock only after confirming no writer is live)",
  };
}

/** Release the journal lock. Never throws. */
export function releaseJournalLock(lockPath: string, io: JournalIo = defaultJournalIo): void {
  const release = io.releaseLock ?? defaultJournalIo.releaseLock!;
  try {
    release(lockPath);
  } catch {
    /* releasing must never mask the outcome of the guarded transaction */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan / read path
// ─────────────────────────────────────────────────────────────────────────────

export type RejectionReason = "truncated" | "unparsable" | "schema_invalid" | "hash_mismatch";

export interface RejectedLine {
  line_number: number;
  reason: RejectionReason;
}

/**
 * `lineage_violation` covers the three ways a journal's IDENTITY graph can be
 * incoherent even though every individual record verifies: one correlation id
 * spanning more than one operation, one journal mixing more than one run, or
 * one event id reused across records.
 *
 * MHRC-RCT-001 asserts "all correlation ids resolve to one operation lineage",
 * so a split lineage is an integrity defect — reporting it while still returning
 * `intact` would be exactly the "exposes the defect, returns the clean shape"
 * failure BR-07 forbids. A reused event id is the same class of defect one level
 * down: event ids are the causal graph's NODE NAMES, so reusing one makes every
 * `causation_id` pointing at it ambiguous and lets ONE causal identity be
 * counted as TWO clean lifecycle effects (MHRC-RCT-005).
 */
export type JournalIntegrity =
  | "absent"
  | "intact"
  | "truncated_tail"
  | "corrupt"
  | "order_violation"
  | "lineage_violation";

export interface OrderViolation {
  event_id: string;
  sequence: number;
  reason: "cause_not_before_effect" | "cause_missing";
  causation_id: string;
  cause_sequence: number | null;
}

export interface Lineage {
  correlation_id: string;
  operation_ids: string[];
  event_ids: string[];
}

export interface JournalScanResult {
  schema_version: "guild.receipt_scan.v1";
  records: ReceiptRecordV1[];
  rejected: RejectedLine[];
  integrity: JournalIntegrity;
  observation_state: ObservationState;
  blocks_clean_close: boolean;
  last_sequence: number;
  record_count: number;
  duplicate_sequences: number[];
  regressing_sequences: number[];
  /** Event ids carried by more than one record — one causal node, two names. */
  duplicate_event_ids: string[];
  order_violations: OrderViolation[];
  lineages: Lineage[];
  split_lineages: string[];
  /** Distinct run ids present. More than one means the journal mixes runs. */
  run_ids: string[];
}

/**
 * The structural verdict over a SET OF RECORDS, independent of how they were
 * obtained (parsed from disk, or merged with side-channel recoveries).
 *
 * Exported because reconciliation must re-derive this over the MERGED lineage:
 * judging a recovery only by its own hash, and cleanliness only by the original
 * scan, is what let an invalid recovery close a gap (MHRC-RCT-003/004).
 */
export interface ReceiptRecordAnalysis {
  duplicate_sequences: number[];
  regressing_sequences: number[];
  duplicate_event_ids: string[];
  order_violations: OrderViolation[];
  lineages: Lineage[];
  split_lineages: string[];
  run_ids: string[];
  structural_integrity: "intact" | "order_violation" | "lineage_violation";
  observation_state: ObservationState;
}

/**
 * Derive sequence integrity, causal order, lineage coherence, and observation
 * state from records alone. Pure: no IO, no clock, order-stable.
 */
export function analyzeReceiptRecords(records: ReceiptRecordV1[]): ReceiptRecordAnalysis {
  // ── sequence integrity ──────────────────────────────────────────────────
  const seen = new Map<number, number>();
  const duplicate_sequences: number[] = [];
  const regressing_sequences: number[] = [];
  let prev = 0;
  for (const r of records) {
    seen.set(r.sequence, (seen.get(r.sequence) ?? 0) + 1);
    if ((seen.get(r.sequence) ?? 0) === 2) duplicate_sequences.push(r.sequence);
    if (r.sequence <= prev) regressing_sequences.push(r.sequence);
    prev = Math.max(prev, r.sequence);
  }

  // ── causal identity: an event id names exactly ONE node ─────────────────
  // Keeping the first sequence for a repeated name (and saying nothing) is what
  // let one identity be read as two clean effects — MH-06-R2-B5.
  const eventCounts = new Map<string, number>();
  const duplicate_event_ids: string[] = [];
  for (const r of records) {
    const n = (eventCounts.get(r.event_id) ?? 0) + 1;
    eventCounts.set(r.event_id, n);
    if (n === 2) duplicate_event_ids.push(r.event_id);
  }

  // ── causal order: a cause must sit strictly before its effect ───────────
  const bySequence = new Map<string, number>();
  for (const r of records) if (!bySequence.has(r.event_id)) bySequence.set(r.event_id, r.sequence);
  const order_violations: OrderViolation[] = [];
  for (const r of records) {
    if (!r.causation_id) continue;
    const causeSeq = bySequence.get(r.causation_id) ?? null;
    if (causeSeq === null) {
      order_violations.push({
        event_id: r.event_id,
        sequence: r.sequence,
        reason: "cause_missing",
        causation_id: r.causation_id,
        cause_sequence: null,
      });
    } else if (causeSeq >= r.sequence) {
      order_violations.push({
        event_id: r.event_id,
        sequence: r.sequence,
        reason: "cause_not_before_effect",
        causation_id: r.causation_id,
        cause_sequence: causeSeq,
      });
    }
  }

  // ── lineages: one correlation id resolves to ONE operation lineage ──────
  const lineageMap = new Map<string, Lineage>();
  const run_ids: string[] = [];
  for (const r of records) {
    if (!run_ids.includes(r.run_id)) run_ids.push(r.run_id);
    let l = lineageMap.get(r.correlation_id);
    if (!l) {
      l = { correlation_id: r.correlation_id, operation_ids: [], event_ids: [] };
      lineageMap.set(r.correlation_id, l);
    }
    if (!l.operation_ids.includes(r.operation_id)) l.operation_ids.push(r.operation_id);
    l.event_ids.push(r.event_id);
  }
  const lineages = [...lineageMap.values()];
  const split_lineages = lineages.filter((l) => l.operation_ids.length > 1).map((l) => l.correlation_id);

  // ── structural verdict (most severe wins) ──────────────────────────────
  let structural_integrity: ReceiptRecordAnalysis["structural_integrity"] = "intact";
  if (order_violations.length > 0 || duplicate_sequences.length > 0 || regressing_sequences.length > 0) {
    structural_integrity = "order_violation";
  } else if (split_lineages.length > 0 || run_ids.length > 1 || duplicate_event_ids.length > 0) {
    structural_integrity = "lineage_violation";
  }

  // ── observation state (BR-07: never infer cleanliness) ─────────────────
  let observation_state: ObservationState = "checked_clean";
  if (records.length === 0) observation_state = "not_observed";
  else if (records.some((r) => r.observation_state === "observation_failed")) observation_state = "observation_failed";
  else if (records.some((r) => r.observation_state === "not_observed")) observation_state = "not_observed";

  return {
    duplicate_sequences,
    regressing_sequences,
    duplicate_event_ids,
    order_violations,
    lineages,
    split_lineages,
    run_ids,
    structural_integrity,
    observation_state,
  };
}

const REQUIRED_STRING_FIELDS = [
  "run_id",
  "operation_id",
  "correlation_id",
  "event_id",
  "input_hash",
  "recorded_at",
] as const;

/**
 * Structural + closed-vocabulary gate for one record.
 *
 * Exported because `record_hash` verification is NOT a substitute: a producer
 * can seal a record carrying an out-of-vocabulary disposition and the hash will
 * verify perfectly. Any path that admits a record from outside the journal
 * (recovery, merge) must run this first.
 */
export function isValidReceiptRecordShape(value: unknown): value is ReceiptRecordV1 {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  if (r.schema_version !== "guild.receipt_record.v1") return false;
  if (typeof r.sequence !== "number" || !Number.isInteger(r.sequence) || r.sequence < 1) return false;
  for (const f of REQUIRED_STRING_FIELDS) {
    if (typeof r[f] !== "string" || (r[f] as string).length === 0) return false;
  }
  if (!RECEIPT_DISPOSITIONS.includes(r.disposition as ReceiptDisposition)) return false;
  if (!OBSERVATION_STATES.includes(r.observation_state as ObservationState)) return false;
  if (!RECEIPT_EVENT_NAMES.includes(r.event_name as ReceiptEventName)) return false;
  if (!RECEIPT_OUTCOME_TYPES.includes(r.outcome_type as ReceiptOutcomeType)) return false;
  const v = r.versions as Record<string, unknown> | undefined;
  if (!v || typeof v !== "object") return false;
  for (const f of ["host_id", "host_version", "runtime_version", "source_version", "contract_version"]) {
    if (typeof v[f] !== "string" || (v[f] as string).length === 0) return false;
  }
  return true;
}

/**
 * Parse the journal. A record is ACCEPTED only when it parses, matches the
 * schema, and its `record_hash` verifies. Everything else is reported in
 * `rejected` and excluded from `records` — a truncated or tampered record is
 * never accepted (MHRC-RCT-002).
 */
export function scanReceiptJournal(journalPath: string, io: JournalIo = defaultJournalIo): JournalScanResult {
  const raw = io.readAll(journalPath);

  const empty = (integrity: JournalIntegrity): JournalScanResult => ({
    schema_version: "guild.receipt_scan.v1",
    records: [],
    rejected: [],
    integrity,
    observation_state: "not_observed",
    blocks_clean_close: true,
    last_sequence: 0,
    record_count: 0,
    duplicate_sequences: [],
    regressing_sequences: [],
    duplicate_event_ids: [],
    order_violations: [],
    lineages: [],
    split_lineages: [],
    run_ids: [],
  });

  if (raw === null) return empty("absent");
  if (raw.length === 0) return empty("absent");

  const endsWithNewline = raw.endsWith("\n");
  const lines = raw.split("\n");
  if (endsWithNewline) lines.pop(); // trailing "" after the final newline

  const records: ReceiptRecordV1[] = [];
  const rejected: RejectedLine[] = [];

  lines.forEach((line, i) => {
    const lineNumber = i + 1;
    const isLast = i === lines.length - 1;
    // A final line with no terminating newline is a torn append, not a record.
    const isTornTail = isLast && !endsWithNewline;

    if (line.length === 0) {
      if (!isTornTail) rejected.push({ line_number: lineNumber, reason: "unparsable" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      rejected.push({ line_number: lineNumber, reason: isTornTail ? "truncated" : "unparsable" });
      return;
    }
    if (!isValidReceiptRecordShape(parsed)) {
      rejected.push({ line_number: lineNumber, reason: isTornTail ? "truncated" : "schema_invalid" });
      return;
    }
    if (!verifyReceiptRecord(parsed)) {
      rejected.push({ line_number: lineNumber, reason: isTornTail ? "truncated" : "hash_mismatch" });
      return;
    }
    records.push(parsed);
  });

  // ── structure, lineage, causal order, observation (shared primitive) ──────
  const analysis = analyzeReceiptRecords(records);

  // ── integrity verdict (most severe wins) ──────────────────────────────────
  let integrity: JournalIntegrity = analysis.structural_integrity;
  if (rejected.some((r) => r.reason === "hash_mismatch" || r.reason === "unparsable" || r.reason === "schema_invalid")) {
    integrity = "corrupt";
  } else if (rejected.some((r) => r.reason === "truncated")) {
    integrity = "truncated_tail";
  }

  // ── observation state (BR-07: never infer cleanliness) ────────────────────
  const observation_state: ObservationState =
    analysis.observation_state === "checked_clean" && integrity !== "intact"
      ? "not_observed"
      : analysis.observation_state;

  return {
    schema_version: "guild.receipt_scan.v1",
    records,
    rejected,
    integrity,
    observation_state,
    blocks_clean_close: observation_state !== "checked_clean" || integrity !== "intact",
    last_sequence: records.reduce((m, r) => Math.max(m, r.sequence), 0),
    record_count: records.length,
    duplicate_sequences: analysis.duplicate_sequences,
    regressing_sequences: analysis.regressing_sequences,
    duplicate_event_ids: analysis.duplicate_event_ids,
    order_violations: analysis.order_violations,
    lineages: analysis.lineages,
    split_lineages: analysis.split_lineages,
    run_ids: analysis.run_ids,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Append path
// ─────────────────────────────────────────────────────────────────────────────

export type AppendFailureCode =
  | "invalid_record"
  | "duplicate_event_id"
  | "unknown_causation"
  | "journal_not_reconciled"
  | "journal_append_failed"
  | "journal_append_unverified"
  | "checkpoint_write_failed"
  | "checkpoint_write_unverified"
  | "correlation_lineage_split"
  | "foreign_run_id"
  | "journal_lock_unavailable"
  | "journal_lock_failed"
  | "journal_identity_ambiguous"
  | "journal_identity_unstable";

export interface ReceiptAppendOutcome {
  schema_version: "guild.receipt_outcome.v1";
  type: "guild.receipt_outcome.v1";
  disposition: ReceiptDisposition;
  event_id: string;
  operation_id: string;
  sequence: number | null;
  observation_state: ObservationState;
  durable: boolean;
  blocks_dependent_completion: boolean;
  checkpoint: ReceiptCheckpointV1 | null;
  record: ReceiptRecordV1 | null;
  failure: { code: AppendFailureCode; message: string } | null;
}

function validateInput(input: ReceiptAppendInput): string | null {
  for (const f of REQUIRED_STRING_FIELDS) {
    const v = (input as unknown as Record<string, unknown>)[f];
    if (typeof v !== "string" || v.length === 0) return `missing or empty field: ${f}`;
  }
  if (!RECEIPT_DISPOSITIONS.includes(input.disposition)) return `disposition outside closed vocabulary: ${String(input.disposition)}`;
  if (!OBSERVATION_STATES.includes(input.observation_state)) return `observation_state outside closed vocabulary: ${String(input.observation_state)}`;
  if (!RECEIPT_EVENT_NAMES.includes(input.event_name)) return `event_name outside closed vocabulary: ${String(input.event_name)}`;
  if (!RECEIPT_OUTCOME_TYPES.includes(input.outcome_type)) return `outcome_type outside closed vocabulary: ${String(input.outcome_type)}`;
  if (!input.versions || typeof input.versions !== "object") return "missing versions";
  for (const f of ["host_id", "host_version", "runtime_version", "source_version", "contract_version"] as const) {
    if (typeof input.versions[f] !== "string" || input.versions[f].length === 0) return `missing or empty versions.${f}`;
  }
  return null;
}

/** An outcome that reports NO durable evidence — the fail-closed shape. */
function failed(
  input: ReceiptAppendInput,
  code: AppendFailureCode,
  message: string,
  disposition: ReceiptDisposition = "failed",
): ReceiptAppendOutcome {
  return {
    schema_version: "guild.receipt_outcome.v1",
    type: "guild.receipt_outcome.v1",
    disposition,
    event_id: input.event_id,
    operation_id: input.operation_id,
    sequence: null,
    observation_state: "observation_failed",
    durable: false,
    blocks_dependent_completion: true,
    checkpoint: null,
    record: null,
    failure: { code, message },
  };
}

/**
 * Append one receipt atomically, or fail explicitly.
 *
 * Success requires ALL of: exclusive cross-process access for the whole
 * read-modify-write, the fsync'd journal line, a re-scan proving that exact
 * record is durable, the atomically replaced checkpoint, and a re-read proving
 * the checkpoint on disk is the one we wrote. Anything less returns
 * `disposition: "failed"` with `durable: false` — the operation cannot report
 * success without durable evidence (MHRC-RCT-002).
 *
 * Concurrency is real, not theoretical: MHRC-RCT-001's input pattern is
 * `sequential_and_concurrent_operations`, and its required outcome is that
 * sequence values are unique and strictly increasing. Two unguarded processes
 * break that while both reporting success, so the lock is part of the contract,
 * not an optimisation.
 *
 * IDENTITY IS ESTABLISHED BEFORE EXCLUSION, AND RE-ESTABLISHED THREE TIMES
 * (MH-06-R4-B1). A lock is only exclusive over a resource it names uniquely, so
 * the physical journal is resolved before any lock is taken; the identity is
 * re-derived once the lock is HELD, because the caller's path may have been
 * repointed while this writer waited; the guarded transaction reads and writes
 * the canonical path the lock names rather than the caller's mutable spelling;
 * and the identity is checked once more before any durable claim. A journal with
 * more than one name, or a name that moved, fails closed with a typed reason and
 * no record is reported durable.
 */
export function appendReceipt(
  paths: JournalPaths,
  input: ReceiptAppendInput,
  io: JournalIo = defaultJournalIo,
  lockOptions: JournalLockOptions = {},
): ReceiptAppendOutcome {
  const invalid = validateInput(input);
  if (invalid) return failed(input, "invalid_record", invalid);

  const authorised = resolveJournalIdentity(paths.journal);
  if (!authorised.ok) return failed(input, authorised.failure.code, authorised.failure.message);
  const locked = authorised.identity;

  const lockFailure = acquireJournalLock(locked.lock, io, lockOptions);
  if (lockFailure) return failed(input, lockFailure.code, lockFailure.message);
  try {
    // The caller's path may mean something else now than it did a moment ago —
    // a swapped parent symlink is enough. Refuse rather than write into a
    // destination whose own lock is held by somebody else.
    const underLock = resolveJournalIdentity(paths.journal);
    if (!underLock.ok) return failed(input, underLock.failure.code, underLock.failure.message);
    const drift = journalIdentityDrift(locked, underLock.identity);
    if (drift) return failed(input, "journal_identity_unstable", drift);

    // Write authority is bound to the identity we hold: every read and the append
    // itself go through the canonical path, so a swap AFTER this point cannot
    // redirect the bytes either.
    const outcome = appendLocked({ journal: locked.path, checkpoint: paths.checkpoint }, input, io);
    if (outcome.disposition !== "succeeded") return outcome;

    // Last gate before the durable claim: the caller's journal must STILL be the
    // one this transaction was authorised over.
    const afterWrite = resolveJournalIdentity(paths.journal);
    if (!afterWrite.ok) return failed(input, afterWrite.failure.code, afterWrite.failure.message);
    const lateDrift = journalIdentityDrift(locked, afterWrite.identity);
    if (lateDrift) return failed(input, "journal_identity_unstable", lateDrift);
    return outcome;
  } finally {
    // A typed failure must never leak the lock and wedge every later writer.
    releaseJournalLock(locked.lock, io);
  }
}

/**
 * The guarded transaction. Every read here is inside the lock, so the sequence
 * this assigns cannot be assigned by anyone else.
 */
function appendLocked(
  paths: JournalPaths,
  input: ReceiptAppendInput,
  io: JournalIo,
): ReceiptAppendOutcome {
  const scan = scanReceiptJournal(paths.journal, io);

  // Refuse to append onto a tail we cannot safely extend. Appending after a
  // torn (newline-less) line would concatenate into it and destroy both
  // records; reconciliation must resolve the journal first.
  if (scan.integrity !== "intact" && scan.integrity !== "absent") {
    return failed(
      input,
      "journal_not_reconciled",
      `journal integrity is "${scan.integrity}" — reconcile before appending`,
    );
  }

  if (scan.records.some((r) => r.event_id === input.event_id)) {
    return {
      ...failed(input, "duplicate_event_id", `event_id already present: ${input.event_id}`, "refused"),
      observation_state: input.observation_state,
      blocks_dependent_completion: false,
    };
  }

  if (input.causation_id && !scan.records.some((r) => r.event_id === input.causation_id)) {
    return failed(input, "unknown_causation", `causation_id not present in journal: ${input.causation_id}`);
  }

  // A journal belongs to exactly ONE run. Mixing runs makes every downstream
  // identity binding (E-RECEIPT run_id, the checkpoint's run_id) ambiguous.
  const foreignRun = scan.records.find((r) => r.run_id !== input.run_id);
  if (foreignRun) {
    return failed(
      input,
      "foreign_run_id",
      `journal belongs to run "${foreignRun.run_id}" — refusing to append run "${input.run_id}"`,
    );
  }

  // MHRC-RCT-001: all correlation ids resolve to ONE operation lineage. Refuse
  // to CREATE the split rather than only reporting it after the fact — an
  // accepted split is a durable defect no reader can undo.
  const otherOperation = scan.records.find(
    (r) => r.correlation_id === input.correlation_id && r.operation_id !== input.operation_id,
  );
  if (otherOperation) {
    return failed(
      input,
      "correlation_lineage_split",
      `correlation_id "${input.correlation_id}" already resolves to operation "${otherOperation.operation_id}" — ` +
        `refusing to split it across "${input.operation_id}"`,
    );
  }

  const record = sealReceiptRecord({ ...input, sequence: scan.last_sequence + 1 });

  try {
    io.appendLine(paths.journal, `${JSON.stringify(record)}\n`);
  } catch (err) {
    return failed(input, "journal_append_failed", err instanceof Error ? err.message : String(err));
  }

  // PROVE the line is durable rather than trusting the write call: re-scan and
  // demand this exact sealed record, at this exact sequence, in an intact
  // journal. A write that landed nothing, landed twice, or raced someone else
  // into the same sequence is caught here instead of being reported as success.
  const after = scanReceiptJournal(paths.journal, io);
  const landed = after.records.find((r) => r.sequence === record.sequence && r.event_id === record.event_id);
  if (!landed || landed.record_hash !== record.record_hash) {
    return failed(
      input,
      "journal_append_unverified",
      `journal does not hold the sealed record for sequence ${record.sequence} after the append`,
    );
  }
  if (after.integrity !== "intact" || after.record_count !== scan.record_count + 1) {
    return failed(
      input,
      "journal_append_unverified",
      `journal reads "${after.integrity}" with ${after.record_count} records after appending sequence ${record.sequence} ` +
        `(expected "intact" with ${scan.record_count + 1})`,
    );
  }

  const checkpoint: ReceiptCheckpointV1 = {
    schema_version: "guild.receipt_checkpoint.v1",
    run_id: record.run_id,
    last_sequence: record.sequence,
    last_event_id: record.event_id,
    record_count: scan.record_count + 1,
    updated_at: record.recorded_at,
    contract_version: RECEIPT_CONTRACT_VERSION,
  };

  try {
    io.writeCheckpoint(paths.checkpoint, `${JSON.stringify(checkpoint, null, 2)}\n`);
  } catch (err) {
    // The line is on disk but the checkpoint is not. Reconciliation resolves
    // the disagreement; this operation must NOT claim success.
    return failed(input, "checkpoint_write_failed", err instanceof Error ? err.message : String(err));
  }

  // Same rule for the checkpoint: a write that returned is not a write that
  // landed. Re-read and compare, or fail closed.
  const persisted = readCheckpointState(paths.checkpoint, io);
  if (persisted.state !== "present" || !checkpointsIdentical(persisted.checkpoint!, checkpoint)) {
    return failed(
      input,
      "checkpoint_write_unverified",
      `checkpoint on disk reads "${persisted.state}" and does not match the checkpoint written for sequence ${record.sequence}`,
    );
  }

  const blocked =
    input.observation_state === "not_observed" || input.observation_state === "observation_failed";

  return {
    schema_version: "guild.receipt_outcome.v1",
    type: "guild.receipt_outcome.v1",
    disposition: input.disposition,
    event_id: record.event_id,
    operation_id: record.operation_id,
    sequence: record.sequence,
    observation_state: record.observation_state,
    durable: true,
    blocks_dependent_completion: blocked,
    checkpoint,
    record,
    failure: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Explicit repair — the ONLY sanctioned mutation of an existing journal
// ─────────────────────────────────────────────────────────────────────────────

export interface TornTailRepairOutcome {
  schema_version: "guild.receipt_repair_outcome.v1";
  disposition: "succeeded" | "refused" | "failed";
  integrity_before: JournalIntegrity;
  integrity_after: JournalIntegrity;
  removed_bytes: number;
  failure: { code: TornTailRepairFailureCode; message: string } | null;
}

export type TornTailRepairFailureCode =
  | "repair_failed"
  | "not_repairable"
  | "journal_lock_unavailable"
  | "journal_lock_failed"
  | JournalIdentityFailureCode;

/**
 * Drop a torn (newline-less) trailing partial line so the journal can be
 * appended to again.
 *
 * This is the exact inverse of an interrupted append: it removes ONLY the bytes
 * after the last complete record and never touches a durable record. It is
 * deliberately narrow — a `corrupt` or `order_violation` journal is REFUSED,
 * because those need a reconciliation decision, not a byte truncation.
 *
 * Callers must run this consciously; `appendReceipt` will not self-heal.
 *
 * It mutates the journal, so it takes the SAME cross-process lock the append
 * transaction uses, over the SAME physical identity: truncating under a
 * concurrent writer would delete a record that writer just made durable and
 * reported as success, and truncating a file this caller does not hold the lock
 * for is the same defect through a different name (MH-06-R4-B1).
 */
export function repairTornTail(
  journalPath: string,
  io: JournalIo = defaultJournalIo,
  lockOptions: JournalLockOptions = {},
): TornTailRepairOutcome {
  const refused = (code: TornTailRepairFailureCode, message: string, target: string): TornTailRepairOutcome => {
    const integrity = scanReceiptJournal(target, io).integrity;
    return {
      schema_version: "guild.receipt_repair_outcome.v1",
      disposition: "failed",
      integrity_before: integrity,
      integrity_after: integrity,
      removed_bytes: 0,
      failure: { code, message },
    };
  };

  const authorised = resolveJournalIdentity(journalPath);
  if (!authorised.ok) return refused(authorised.failure.code, authorised.failure.message, journalPath);
  const locked = authorised.identity;

  const lockFailure = acquireJournalLock(locked.lock, io, lockOptions);
  if (lockFailure) return refused(lockFailure.code, lockFailure.message, locked.path);
  try {
    const underLock = resolveJournalIdentity(journalPath);
    if (!underLock.ok) return refused(underLock.failure.code, underLock.failure.message, locked.path);
    const drift = journalIdentityDrift(locked, underLock.identity);
    if (drift) return refused("journal_identity_unstable", drift, locked.path);
    // Truncation is bound to the identity the lock names, never to the spelling.
    return repairTornTailLocked(locked.path, io);
  } finally {
    releaseJournalLock(locked.lock, io);
  }
}

function repairTornTailLocked(journalPath: string, io: JournalIo): TornTailRepairOutcome {
  const before = scanReceiptJournal(journalPath, io);

  if (before.integrity !== "truncated_tail") {
    return {
      schema_version: "guild.receipt_repair_outcome.v1",
      disposition: "refused",
      integrity_before: before.integrity,
      integrity_after: before.integrity,
      removed_bytes: 0,
      failure: {
        code: "not_repairable",
        message: `journal integrity is "${before.integrity}" — only a torn tail is repairable here`,
      },
    };
  }

  const raw = io.readAll(journalPath) ?? "";
  // `truncate(2)` takes a BYTE length, but lastIndexOf returns a UTF-16 CHARACTER
  // index. Converting is mandatory: a journal holding any non-ASCII field (a
  // run_id, operation_id, or scenario_id with a non-Latin character) would
  // otherwise be cut mid-record and a durable receipt destroyed.
  const keepChars = raw.lastIndexOf("\n") + 1; // 0 when there is no complete line at all
  const totalBytes = Buffer.byteLength(raw, "utf8");
  const keep = Buffer.byteLength(raw.slice(0, keepChars), "utf8");
  try {
    io.truncate(journalPath, keep);
  } catch (err) {
    return {
      schema_version: "guild.receipt_repair_outcome.v1",
      disposition: "failed",
      integrity_before: before.integrity,
      integrity_after: before.integrity,
      removed_bytes: 0,
      failure: { code: "repair_failed", message: err instanceof Error ? err.message : String(err) },
    };
  }

  return {
    schema_version: "guild.receipt_repair_outcome.v1",
    disposition: "succeeded",
    integrity_before: before.integrity,
    integrity_after: scanReceiptJournal(journalPath, io).integrity,
    removed_bytes: totalBytes - keep,
    failure: null,
  };
}
