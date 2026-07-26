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

/** Read a checkpoint, or null when absent/unparsable (never a guessed value). */
export function readCheckpoint(checkpointPath: string): ReceiptCheckpointV1 | null {
  let raw: string;
  try {
    raw = fs.readFileSync(checkpointPath, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ReceiptCheckpointV1;
    return parsed?.schema_version === "guild.receipt_checkpoint.v1" ? parsed : null;
  } catch {
    return null;
  }
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
};

export interface JournalPaths {
  journal: string;
  checkpoint: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan / read path
// ─────────────────────────────────────────────────────────────────────────────

export type RejectionReason = "truncated" | "unparsable" | "schema_invalid" | "hash_mismatch";

export interface RejectedLine {
  line_number: number;
  reason: RejectionReason;
}

export type JournalIntegrity = "absent" | "intact" | "truncated_tail" | "corrupt" | "order_violation";

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
  order_violations: OrderViolation[];
  lineages: Lineage[];
  split_lineages: string[];
}

const REQUIRED_STRING_FIELDS = [
  "run_id",
  "operation_id",
  "correlation_id",
  "event_id",
  "input_hash",
  "recorded_at",
] as const;

function isValidRecordShape(value: unknown): value is ReceiptRecordV1 {
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
    order_violations: [],
    lineages: [],
    split_lineages: [],
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
    if (!isValidRecordShape(parsed)) {
      rejected.push({ line_number: lineNumber, reason: isTornTail ? "truncated" : "schema_invalid" });
      return;
    }
    if (!verifyReceiptRecord(parsed)) {
      rejected.push({ line_number: lineNumber, reason: isTornTail ? "truncated" : "hash_mismatch" });
      return;
    }
    records.push(parsed);
  });

  // ── sequence integrity ────────────────────────────────────────────────────
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

  // ── causal order: a cause must sit strictly before its effect ─────────────
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

  // ── lineages: one correlation id should resolve to one operation lineage ──
  const lineageMap = new Map<string, Lineage>();
  for (const r of records) {
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

  // ── integrity verdict (most severe wins) ──────────────────────────────────
  let integrity: JournalIntegrity = "intact";
  if (rejected.some((r) => r.reason === "hash_mismatch" || r.reason === "unparsable" || r.reason === "schema_invalid")) {
    integrity = "corrupt";
  } else if (rejected.some((r) => r.reason === "truncated")) {
    integrity = "truncated_tail";
  } else if (order_violations.length > 0 || duplicate_sequences.length > 0 || regressing_sequences.length > 0) {
    integrity = "order_violation";
  }

  // ── observation state (BR-07: never infer cleanliness) ────────────────────
  let observation_state: ObservationState = "checked_clean";
  if (records.length === 0) observation_state = "not_observed";
  else if (records.some((r) => r.observation_state === "observation_failed")) observation_state = "observation_failed";
  else if (records.some((r) => r.observation_state === "not_observed")) observation_state = "not_observed";
  else if (integrity !== "intact") observation_state = "not_observed";

  return {
    schema_version: "guild.receipt_scan.v1",
    records,
    rejected,
    integrity,
    observation_state,
    blocks_clean_close: observation_state !== "checked_clean" || integrity !== "intact",
    last_sequence: records.reduce((m, r) => Math.max(m, r.sequence), 0),
    record_count: records.length,
    duplicate_sequences,
    regressing_sequences,
    order_violations,
    lineages,
    split_lineages,
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
  | "checkpoint_write_failed";

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
 * Success requires BOTH the fsync'd journal line AND the atomically replaced
 * checkpoint. Anything less returns `disposition: "failed"` with `durable:
 * false` — the operation cannot report success without durable evidence
 * (MHRC-RCT-002).
 */
export function appendReceipt(
  paths: JournalPaths,
  input: ReceiptAppendInput,
  io: JournalIo = defaultJournalIo,
): ReceiptAppendOutcome {
  const invalid = validateInput(input);
  if (invalid) return failed(input, "invalid_record", invalid);

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

  const record = sealReceiptRecord({ ...input, sequence: scan.last_sequence + 1 });

  try {
    io.appendLine(paths.journal, `${JSON.stringify(record)}\n`);
  } catch (err) {
    return failed(input, "journal_append_failed", err instanceof Error ? err.message : String(err));
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
  failure: { code: "repair_failed" | "not_repairable"; message: string } | null;
}

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
 */
export function repairTornTail(journalPath: string, io: JournalIo = defaultJournalIo): TornTailRepairOutcome {
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
