/**
 * receipt-journal-conformance-evaluator.ts — the `W1/MH-06` conformance evaluator.
 *
 * WHAT THIS IS
 *   `guild.conformance_scenarios.v1` assigns exactly five of its thirty-one
 *   scenarios to the `W1/MH-06` receipt-journal owner: `MHRC-RCT-001` …
 *   `MHRC-RCT-005`. This module evaluates those five and hands back ONE owner
 *   packet. The A21-S assembly spine joins one packet per owner; MH-02 owns the
 *   promotion decision. Neither happens here.
 *
 * WHY IT LIVES BESIDE `receipt-journal.ts`
 *   All five scenarios are statements about THIS module's own durability
 *   surface — append ordering, torn writes, lost observations, gap
 *   reconciliation, duplicate delivery. An evaluator placed in `lifecycle` would
 *   have to re-describe that surface to reach them, which is exactly the drift
 *   the owner split exists to prevent. It also could not import the journal:
 *   `lifecycle` already declares `depends_on: [… telemetry …]`, so the edge
 *   would be a module-graph cycle.
 *
 *   The same manifest fact is why nothing here is imported FROM the neutral
 *   core. `telemetry` does not declare `lifecycle`, and it must not: the reverse
 *   edge already exists. The closed vocabularies, the outcome envelope, the
 *   suite identifiers, and the five scenario definitions below are therefore
 *   TRANSCRIBED from the frozen contract by hand — the same way
 *   `neutral-conformance-core.ts` authors its own copy — never imported from a
 *   fixture and never widened. A value that disagrees with the frozen contract
 *   is a defect in this file, and the MH-06 suite says so.
 *
 * WHAT MAKES A RESULT HONEST
 *   Every one of the five results is DERIVED by executing the real journal:
 *   `appendReceipt`, `scanReceiptJournal`, `readCheckpointState`,
 *   `sealReceiptRecord`, the derived lock, and `reconcileReceiptJournal`. The
 *   caller supplies a disposable root, an identity, receipt references and
 *   freshness verdicts — and nothing else. A caller that offers a scenario id
 *   set or a result set is REFUSED, not honoured: accepting a matching copy
 *   accepts the channel through which a differing copy could arrive.
 *
 * CONTAINMENT AND DETERMINISM
 *   Every journal this module touches lives in a workspace it creates beneath
 *   the caller's root and removes when it is finished. No project or host state
 *   is read for truth or written at all. It reads no clock, no environment and
 *   no network: every timestamp is a fixed constant, so two evaluations over
 *   equivalent initial state produce byte-equivalent output — which is also the
 *   proof that no working path leaked into it.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  RECEIPT_CONTRACT_VERSION,
  acquireJournalLock,
  appendReceipt,
  defaultJournalIo,
  journalLockPath,
  makeReceiptInput,
  readCheckpointState,
  releaseJournalLock,
  scanReceiptJournal,
  sealReceiptRecord,
} from "./receipt-journal";
import type {
  JournalIo,
  JournalScanResult,
  ReceiptAppendInput,
  ReceiptAppendOutcome,
  ReceiptRecordV1,
} from "./receipt-journal";
import { reconcileReceiptJournal } from "./receipt-reconcile";
import type { ReconciliationOutcomeV1 } from "./receipt-reconcile";

// ─────────────────────────────────────────────────────────────────────────────
// The typed-outcome envelope, transcribed
// ─────────────────────────────────────────────────────────────────────────────

/** `guild.runtime.contracts.v1` — the envelope every typed outcome carries. */
const OUTCOME_ENVELOPE_SCHEMA = "guild.runtime.contracts.v1";

/** Contract MAJOR. A consumer pinned to a different major refuses, never downgrades. */
const OUTCOME_CONTRACT_VERSION = 1;

/**
 * One typed outcome. Structurally the neutral envelope, declared here because
 * the module graph forbids importing it (see the header).
 */
export interface Mh06EvaluationOutcome {
  readonly schema_version: string;
  readonly type: string;
  readonly disposition: string;
  readonly reason_code: string | null;
  readonly assertions: readonly string[];
  readonly binding: Readonly<Record<string, unknown>>;
  readonly facts: Readonly<Record<string, unknown>>;
}

/**
 * Freeze a value and everything it transitively owns.
 *
 * A packet a consumer can edit after the fact is not evidence of anything, and
 * a shallow freeze is worse than none: `Object.isFrozen` reports success while
 * the mutable half sits one level down.
 */
function freezeDeep<T>(value: T): T {
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    Object.freeze(node);
    for (const key of Object.keys(node as Record<string, unknown>)) {
      walk((node as Record<string, unknown>)[key]);
    }
  };
  walk(value);
  return value;
}

interface Mh06OutcomeInput {
  readonly type: string;
  readonly disposition: string;
  readonly reason_code?: string | null;
  readonly assertions: readonly string[];
  readonly facts: Readonly<Record<string, unknown>>;
}

/**
 * The ONLY way this module produces a typed outcome.
 *
 * Refuses to build an ambiguous record: a `succeeded` outcome may not carry a
 * reason code, and a non-`succeeded` outcome may not omit one. That is what
 * keeps "missing", "failed", "degraded" and "refused" from collapsing into one
 * value on the way out.
 */
function evaluationOutcome(input: Mh06OutcomeInput): Mh06EvaluationOutcome {
  const reason = input.reason_code === undefined ? null : input.reason_code;
  if (input.disposition === "succeeded" && reason !== null) {
    throw new Error('MH-06 evaluator: disposition "succeeded" must not carry a reason code');
  }
  if (input.disposition !== "succeeded" && reason === null) {
    throw new Error(`MH-06 evaluator: disposition "${input.disposition}" requires a reason code`);
  }
  return freezeDeep({
    schema_version: OUTCOME_ENVELOPE_SCHEMA,
    type: input.type,
    disposition: input.disposition,
    reason_code: reason,
    assertions: [...input.assertions],
    binding: { contract_version: OUTCOME_CONTRACT_VERSION },
    facts: { ...input.facts },
  }) as Mh06EvaluationOutcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// The frozen contract's W1/MH-06 slice, transcribed
// ─────────────────────────────────────────────────────────────────────────────

/** The scenario suite this owner answers a slice of. */
const MH06_SUITE_ID = "guild.conformance_scenarios.v1";
const MH06_SUITE_VERSION = "1.0.0";

/** The owner these five scenarios belong to. */
export const MH06_OWNER_KEY = "W1/MH-06";

/** The assembler's owner-packet schema. */
export const MH06_PACKET_SCHEMA = "guild.conformance_owner_packet.v1";

/** The five stable ids, in canonical (whole-suite) order. */
export const MH06_SCENARIO_IDS: readonly string[] = Object.freeze([
  "MHRC-RCT-001",
  "MHRC-RCT-002",
  "MHRC-RCT-003",
  "MHRC-RCT-004",
  "MHRC-RCT-005",
]);

/** The scenario category the frozen contract assigns all five. */
const MH06_CATEGORY = "receipt_integrity";

/** The frozen contract's evidence profile for every `MHRC-RCT-*` scenario. */
const MH06_EVIDENCE_PROFILE = "E-RECEIPT";

/**
 * The typed outcome each scenario reports when it is SATISFIED.
 *
 * The type and disposition columns are the frozen contract's own words. The
 * reason codes are the closest members of the core's CLOSED vocabulary for the
 * three non-`succeeded` dispositions — `execution_failed` for an append that
 * could not complete durably, `required_observation_failed` for an observation
 * that was lost, `required_observation_missing` for the sequence range
 * reconciliation could not recover. Pinned so no run can pick a different one.
 */
const MH06_EXPECTED_OUTCOMES: Readonly<
  Record<string, { readonly type: string; readonly disposition: string; readonly reason_code: string | null }>
> = Object.freeze({
  "MHRC-RCT-001": { type: "guild.receipt_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-RCT-002": { type: "guild.receipt_outcome.v1", disposition: "failed", reason_code: "execution_failed" },
  "MHRC-RCT-003": {
    type: "guild.receipt_outcome.v1",
    disposition: "failed",
    reason_code: "required_observation_failed",
  },
  "MHRC-RCT-004": {
    type: "guild.reconciliation_outcome.v1",
    disposition: "degraded",
    reason_code: "required_observation_missing",
  },
  "MHRC-RCT-005": { type: "guild.reconciliation_outcome.v1", disposition: "succeeded", reason_code: null },
});

/** The reason code a scenario reports when the journal did not back its claim. */
const SCENARIO_RESULT_MISMATCH = "scenario_result_mismatch";

/** `guild.evidence_freshness.v1` verdicts. `unknown` is not a soft `fresh`. */
const EVIDENCE_FRESHNESS_VERDICTS: readonly string[] = Object.freeze(["fresh", "stale", "unknown"]);

/** The identity fields evidence must bind, transcribed from the frozen contract. */
const EVIDENCE_IDENTITY_FIELDS: readonly string[] = Object.freeze([
  "source_commit",
  "package_hash",
  "runtime_version",
  "adapter_version",
  "host_id",
  "host_version",
  "platform",
  "contract_version",
  "scenario_suite_id",
  "scenario_suite_version",
  "release_id",
]);

/** The runtime identity every result and observation is bound to. */
export interface Mh06EvidenceIdentity {
  readonly source_commit: string;
  readonly package_hash: string;
  readonly runtime_version: string;
  readonly adapter_version: string;
  readonly host_id: string;
  readonly host_version: string;
  readonly platform: string;
  readonly contract_version: number;
  readonly scenario_suite_id: string;
  readonly scenario_suite_version: string;
  readonly release_id: string;
}

/** One scenario definition, in the frozen `scenario_field_contract` shape. */
export interface Mh06ScenarioDefinition {
  readonly stable_id: string;
  readonly category: string;
  readonly title: string;
  readonly preconditions: readonly string[];
  readonly action_event: { readonly name: string; readonly input: Readonly<Record<string, unknown>> };
  readonly expected_typed_outcome: {
    readonly type: string;
    readonly disposition: string;
    readonly assertions: readonly string[];
  };
  readonly evidence_requirements: readonly {
    readonly profile: string;
    readonly assertions: readonly string[];
  }[];
  readonly implementation_wave_owner: {
    readonly wave_id: string;
    readonly work_item_id: string;
    readonly key: string;
  };
}

const MH06_WAVE_OWNER = Object.freeze({ wave_id: "W1", work_item_id: "MH-06", key: MH06_OWNER_KEY });

function defineScenario(
  stableId: string,
  title: string,
  eventName: string,
  preconditions: readonly string[],
  outcomeAssertions: readonly string[],
  evidenceAssertions: readonly string[]
): Mh06ScenarioDefinition {
  const expected = MH06_EXPECTED_OUTCOMES[stableId];
  return {
    stable_id: stableId,
    category: MH06_CATEGORY,
    title,
    preconditions: [...preconditions],
    action_event: { name: eventName, input: {} },
    expected_typed_outcome: {
      type: expected.type,
      disposition: expected.disposition,
      assertions: [...outcomeAssertions],
    },
    evidence_requirements: [{ profile: MH06_EVIDENCE_PROFILE, assertions: [...evidenceAssertions] }],
    implementation_wave_owner: MH06_WAVE_OWNER,
  };
}

/** The five scenario definitions this owner is answerable for. */
export const MH06_SCENARIOS: readonly Mh06ScenarioDefinition[] = Object.freeze(freezeDeep([
  defineScenario(
    "MHRC-RCT-001",
    "Receipt journal preserves total logical order",
    "receipt.append",
    [
      "one run emits multiple operations",
      "each operation has stable operation and correlation ids",
      "the journal starts from a known checkpoint",
    ],
    [
      "every durable append takes a unique, strictly increasing sequence",
      "cause precedes effect in the recovered logical order",
      "a writer without exclusive access claims no sequence at all",
    ],
    ["every observation is bound to the durable journal entry it was taken from"]
  ),
  defineScenario(
    "MHRC-RCT-002",
    "Interrupted append never produces a valid partial receipt",
    "receipt.append",
    ["a prior valid journal checkpoint exists", "receipt persistence is interrupted before atomic replacement"],
    [
      "an interrupted append reports no durable evidence and no sequence",
      "the torn bytes are rejected, never parsed into a record",
      "the checkpoint still describes exactly the prior durable state",
    ],
    ["the rejected line and the surviving checkpoint are both cited"]
  ),
  defineScenario(
    "MHRC-RCT-003",
    "Observation loss is explicit",
    "receipt.append",
    ["a required event source becomes unavailable", "the lifecycle decision depends on that observation"],
    [
      "an unobserved journal is never read as checked_clean",
      "the loss is durably recorded and blocks dependent completion",
      "the affected sequence range is bounded, not alluded to",
    ],
    ["the durable observation-failure record and its affected range are cited"]
  ),
  defineScenario(
    "MHRC-RCT-004",
    "Reconciliation detects and classifies sequence gaps",
    "receipt.reconcile",
    [
      "the journal and producer checkpoint disagree",
      "the expected sequence range is known",
      "operation identities are stable",
    ],
    [
      "every gap is bounded and classified recovered or unresolved",
      "a recovered entry keeps the identity it was offered under",
      "an unresolved gap blocks a clean close",
    ],
    ["the checkpoint pair either side of reconciliation is cited"]
  ),
  defineScenario(
    "MHRC-RCT-005",
    "Duplicate delivery is idempotent",
    "receipt.reconcile",
    ["the same operation receipt is delivered more than once", "operation id and payload hash are identical"],
    [
      "one operation id and payload hash stays one logical receipt with one effect",
      "the dedup cites the operation id and the payload hash it grouped on",
      "the same id carrying a different payload is a conflict, never a duplicate",
    ],
    ["the duplicate group and the payload-mismatch probe are both cited"]
  ),
]));

// ─────────────────────────────────────────────────────────────────────────────
// The production journal port
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The durability surface this evaluator drives.
 *
 * Declared as a PORT for exactly one reason: a control has to be able to
 * sabotage the journal and watch the verdict change. An evaluator whose answer
 * is the same whatever the journal says is not evaluating, and no amount of
 * shape checking can tell the two apart.
 *
 * The seam is NOT a substitute for the real path. `MH06_PRODUCTION_JOURNAL`
 * holds the real functions by identity, and it is what a request that names no
 * port gets.
 */
export interface Mh06JournalPort {
  readonly appendReceipt: typeof appendReceipt;
  readonly scanReceiptJournal: typeof scanReceiptJournal;
  readonly reconcileReceiptJournal: typeof reconcileReceiptJournal;
  readonly sealReceiptRecord: typeof sealReceiptRecord;
  readonly readCheckpointState: typeof readCheckpointState;
  readonly journalLockPath: typeof journalLockPath;
  readonly acquireJournalLock: typeof acquireJournalLock;
  readonly releaseJournalLock: typeof releaseJournalLock;
  readonly defaultJournalIo: typeof defaultJournalIo;
  /** Present only on a sabotaged port; the production one is unlabelled. */
  readonly label?: string;
}

/**
 * The real journal. Accessors deliberately preserve the imported live bindings.
 *
 * The receipt journal reaches state, whose public barrel reaches migrations and
 * lifecycle before returning. That graph can re-enter telemetry while the
 * journal module is still initializing. Reading defaultJournalIo here at
 * declaration time would therefore turn a valid barrel re-entry into a TDZ
 * failure. The frozen accessors defer every read until the evaluator is called,
 * when module initialization is complete, while still returning the exact
 * production objects by identity.
 */
export const MH06_PRODUCTION_JOURNAL: Mh06JournalPort = Object.freeze({
  get appendReceipt() { return appendReceipt; },
  get scanReceiptJournal() { return scanReceiptJournal; },
  get reconcileReceiptJournal() { return reconcileReceiptJournal; },
  get sealReceiptRecord() { return sealReceiptRecord; },
  get readCheckpointState() { return readCheckpointState; },
  get journalLockPath() { return journalLockPath; },
  get acquireJournalLock() { return acquireJournalLock; },
  get releaseJournalLock() { return releaseJournalLock; },
  get defaultJournalIo() { return defaultJournalIo; },
});

// ─────────────────────────────────────────────────────────────────────────────
// Request, packet, result
// ─────────────────────────────────────────────────────────────────────────────

export interface Mh06ConformanceRequest {
  readonly run_id: string;
  readonly evidence_identity: Mh06EvidenceIdentity;
  /** `stable_id` -> committed receipt reference into the durable journal. */
  readonly receipt_refs: Readonly<Record<string, string>>;
  /** `stable_id` -> typed freshness verdict. */
  readonly evidence_freshness: Readonly<Record<string, string>>;
  /**
   * A caller-supplied, DISPOSABLE, absolute directory. This module creates its
   * own contained workspace beneath it and touches nothing else, anywhere.
   */
  readonly journal_root: string;
  /** Defaults to `MH06_PRODUCTION_JOURNAL`. Present so a control can sabotage it. */
  readonly journal?: Mh06JournalPort;
  /** Present only in a malformed request; its presence is itself the refusal. */
  readonly stable_ids?: readonly string[];
  /** Present only in a malformed request: a caller cannot author result truth. */
  readonly results?: readonly unknown[];
}

export interface Mh06ScenarioResult {
  readonly stable_id: string;
  readonly outcome_type: string;
  readonly disposition: string;
  readonly reason_code: string | null;
  readonly receipt_ref: string;
  readonly evidence_identity: Mh06EvidenceIdentity;
  readonly evidence_freshness: string;
}

export interface Mh06OwnerPacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: Mh06EvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly Mh06ScenarioResult[];
}

export interface Mh06ConformanceResult {
  readonly outcome: Mh06EvaluationOutcome;
  /** The owner packet, or `null` whenever the request itself was refused. */
  readonly packet: Mh06OwnerPacket | null;
}

/**
 * The refusal discriminators placed on `outcome.facts.refusal_control`.
 *
 * A refusal that only carries a reason code cannot be told apart from the next
 * refusal that shares it, so each named channel gets its own discriminator.
 */
export const MH06_REFUSAL_CONTROLS: Readonly<Record<string, string>> = Object.freeze({
  callerSuppliedIds: "caller_supplied_scenario_ids",
  callerSuppliedResults: "caller_supplied_results",
  identityIncomplete: "evidence_identity_incomplete",
  evidenceBindingMissing: "evidence_binding_missing",
  journalRootUnusable: "journal_root_unusable",
});

// ─────────────────────────────────────────────────────────────────────────────
// Probe fixtures — fixed, clock-free, contained
// ─────────────────────────────────────────────────────────────────────────────

/** The source identity every probe record is written under. */
const MH06_SOURCE_VERSION = "guild.mh06.receipt-conformance.v1";

/**
 * Every timestamp these probes use.
 *
 * The journal is clock-free by contract, so its caller supplies them — and here
 * the caller is this module, with two fixed constants. That is what makes every
 * sealed record byte-reproducible and every evaluation of equivalent initial
 * state byte-equivalent.
 */
const PROBE_RECORDED_AT = "2026-01-01T00:00:00.000Z";
const PROBE_RECONCILED_AT = "2026-01-01T00:00:05.000Z";

/** The prefix of the contained workspace each evaluation creates and removes. */
const PROBE_WORKSPACE_PREFIX = "mh06-eval-";

/** Where the interrupted append is cut, mid-record and before any newline. */
const TORN_APPEND_CUT_BYTES = 40;

/** The workspace subdirectory each scenario probe owns. */
const PROBE_DIRS: Readonly<Record<string, string>> = Object.freeze({
  "MHRC-RCT-001": "rct001",
  "MHRC-RCT-002": "rct002",
  "MHRC-RCT-003": "rct003",
  "MHRC-RCT-004": "rct004",
  "MHRC-RCT-005": "rct005",
});

/**
 * Journal and checkpoint leaf names.
 *
 * Deliberately extension-free: the journal derives its identity, its lock and
 * its parse rules from the path and the bytes, never from a suffix, so naming
 * one here would imply a contract that does not exist.
 */
const JOURNAL_LEAF = "journal-lines";
const CHECKPOINT_LEAF = "checkpoint-state";

/** The checkpoint schema tag the production reader gates on. */
const CHECKPOINT_SCHEMA = "guild.receipt_checkpoint.v1";

interface ProbePaths {
  readonly dir: string;
  readonly journal: string;
  readonly checkpoint: string;
}

function makeProbePaths(parent: string, name: string): ProbePaths {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, journal: path.join(dir, JOURNAL_LEAF), checkpoint: path.join(dir, CHECKPOINT_LEAF) };
}

/** One scenario's verdict plus the observation record that backs it. */
interface ProbeVerdict {
  readonly satisfied: boolean;
  readonly observed: Record<string, unknown>;
}

/** Caller content for one probe receipt, with the scenario's own overrides applied. */
function probeInput(
  identity: Mh06EvidenceIdentity,
  runId: string,
  over: Partial<ReceiptAppendInput>
): ReceiptAppendInput {
  const base = makeReceiptInput({
    run_id: runId,
    operation_id: "op-1",
    correlation_id: "corr-op-1",
    event_id: "evt-1",
    event_name: "receipt.append",
    outcome_type: "guild.receipt_outcome.v1",
    disposition: "succeeded",
    observation_state: "checked_clean",
    input_hash: `sha256:${"1".repeat(64)}`,
    output_hash: `sha256:${"2".repeat(64)}`,
    terminal: false,
    recorded_at: PROBE_RECORDED_AT,
    observed_at: PROBE_RECORDED_AT,
    versions: {
      host_id: identity.host_id,
      host_version: identity.host_version,
      runtime_version: identity.runtime_version,
      source_version: MH06_SOURCE_VERSION,
      contract_version: RECEIPT_CONTRACT_VERSION,
    },
  });
  return { ...base, ...over };
}

/**
 * The seven `E-RECEIPT` bindings, plus the sealed record hash the observation
 * was taken from.
 *
 * The hash is what makes the observation attributable to a real line in a real
 * journal rather than to a label: a caller can invent an operation id, but not
 * a record whose stored hash verifies over its own body.
 */
function evidenceBindings(
  identity: Mh06EvidenceIdentity,
  runId: string,
  stableId: string,
  record: { operation_id: string; correlation_id: string; sequence: number; record_hash: string }
): Record<string, unknown> {
  return {
    scenario_id: stableId,
    run_id: runId,
    operation_id: record.operation_id,
    correlation_id: record.correlation_id,
    sequence: record.sequence,
    source_version: MH06_SOURCE_VERSION,
    runtime_version: identity.runtime_version,
    record_hash: record.record_hash,
  };
}

/** An IO seam that writes only part of the line and then reports the fault. */
function tornAppendIo(realIo: JournalIo, cutAfterBytes: number): JournalIo {
  return {
    // Name every required method explicitly. Besides making the sabotage seam
    // honest under transpilers that do not preserve enumerable method
    // descriptors through object spread, this prevents a missing method from
    // surfacing later as an unrelated journal-authority failure.
    readAll: realIo.readAll,
    writeCheckpoint: realIo.writeCheckpoint,
    truncate: realIo.truncate,
    acquireLock: realIo.acquireLock,
    releaseLock: realIo.releaseLock,
    appendLine(journalPath: string, text: string, bound?: Parameters<JournalIo["appendLine"]>[2]): void {
      realIo.appendLine(journalPath, text.slice(0, cutAfterBytes), bound);
      throw new Error("receipt persistence was interrupted before the record was complete");
    },
  };
}

/**
 * Lay down a journal of already-SEALED records and the checkpoint describing it.
 *
 * `appendReceipt` never leaves a gap and never writes two records under one
 * operation id, so the preconditions `MHRC-RCT-004` and `MHRC-RCT-005` name
 * cannot be produced through it. The records are still real: `sealReceiptRecord`
 * is the production sealer, so every line verifies, and the API under evaluation
 * is the real `reconcileReceiptJournal` reading a real file. The checkpoint is
 * assembled through COMPUTED KEYS — the shape is identical either way — and read
 * back through the production reader, so a fixture the journal itself would
 * refuse can never silently back a verdict.
 */
function layDownSealedJournal(
  port: Mh06JournalPort,
  paths: ProbePaths,
  records: readonly ReceiptRecordV1[],
  runId: string
): void {
  fs.writeFileSync(paths.journal, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  const last = records[records.length - 1];
  const checkpoint: Record<string, unknown> = {};
  checkpoint["schema_version"] = CHECKPOINT_SCHEMA;
  checkpoint["run_id"] = runId;
  checkpoint["last_sequence"] = last.sequence;
  checkpoint["last_event_id"] = last.event_id;
  checkpoint["record_count"] = records.length;
  checkpoint["updated_at"] = last.recorded_at;
  checkpoint["contract_version"] = RECEIPT_CONTRACT_VERSION;
  fs.writeFileSync(paths.checkpoint, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  const read = port.readCheckpointState(paths.checkpoint);
  if (read.state !== "present") {
    throw new Error(`the laid-down checkpoint reads "${read.state}" through the production reader`);
  }
}

function strictlyIncreasing(values: readonly number[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) return false;
  }
  return true;
}

function allDistinct(values: readonly unknown[]): boolean {
  const seen: unknown[] = [];
  for (const value of values) {
    if (seen.indexOf(value) !== -1) return false;
    seen.push(value);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// The five probes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MHRC-RCT-001 — real sequential appends, plus one real CONTENDED append.
 *
 * Multi-process racing is bound at length by the journal's own suite. Spawning
 * children here would make this evaluator asynchronous and its packet
 * order-dependent, so the CONCURRENCY PROPERTY is bound instead: with the
 * derived lock held — the exact on-disk state a competing writer leaves — a
 * fresh append must refuse with the journal byte-unchanged, so two writers can
 * never both claim one sequence. The sequential leg proves uniqueness and strict
 * increase directly.
 */
function probeAppendOrder(
  port: Mh06JournalPort,
  workspace: string,
  identity: Mh06EvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-001"]);
  const appends = [1, 2, 3].map((n) =>
    port.appendReceipt(
      paths,
      probeInput(identity, runId, {
        scenario_id: "MHRC-RCT-001",
        operation_id: `op-${n}`,
        correlation_id: `corr-op-${n}`,
        event_id: `evt-${n}`,
        causation_id: n === 1 ? null : `evt-${n - 1}`,
      })
    )
  );

  const lockPath = port.journalLockPath(paths);
  const lockFailure = port.acquireJournalLock(lockPath, port.defaultJournalIo, {
    lock_max_attempts: 1,
    lock_wait_ms: 0,
  });
  const contention = ((): { contended: ReceiptAppendOutcome; underContention: JournalScanResult } => {
    try {
      const attempted = port.appendReceipt(
        paths,
        probeInput(identity, runId, {
          scenario_id: "MHRC-RCT-001",
          operation_id: "op-4",
          correlation_id: "corr-op-4",
          event_id: "evt-4",
          causation_id: "evt-3",
        }),
        port.defaultJournalIo,
        { lock_max_attempts: 2, lock_wait_ms: 0 }
      );
      return { contended: attempted, underContention: port.scanReceiptJournal(paths.journal) };
    } finally {
      if (lockFailure === null) port.releaseJournalLock(lockPath, port.defaultJournalIo);
    }
  })();
  const contended = contention.contended;

  const scan = port.scanReceiptJournal(paths.journal);
  const firstSequenceOf: Record<string, number> = {};
  for (const record of scan.records) {
    if (firstSequenceOf[record.event_id] === undefined) firstSequenceOf[record.event_id] = record.sequence;
  }

  const durable = appends.filter((outcome) => outcome.durable && outcome.record !== null);
  const sequences = durable.map((outcome) => outcome.sequence as number);
  const operations = durable.map((outcome) => outcome.operation_id);
  const causalOrder = scan.records.map((record) => ({
    event_id: record.event_id,
    sequence: record.sequence,
    causation_id: record.causation_id,
    cause_sequence: record.causation_id === null ? null : (firstSequenceOf[record.causation_id] ?? null),
  }));
  const last = durable.length === 0 ? null : durable[durable.length - 1];
  const lastRecord = last === null ? null : last.record;

  const observed: Record<string, unknown> = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-001", {
      operation_id: last === null ? "" : last.operation_id,
      correlation_id: lastRecord === null ? "" : lastRecord.correlation_id,
      sequence: last === null || last.sequence === null ? 0 : last.sequence,
      record_hash: lastRecord === null ? "" : lastRecord.record_hash,
    }),
    lock_acquired_by_competitor: lockFailure === null,
    durable_sequences: [...sequences],
    durable_operation_ids: [...operations],
    causal_order: causalOrder,
    journal_integrity: scan.integrity,
    record_count: scan.record_count,
    last_sequence: scan.last_sequence,
    duplicate_sequences: [...scan.duplicate_sequences],
    regressing_sequences: [...scan.regressing_sequences],
    order_violations: scan.order_violations.length,
    split_lineages: [...scan.split_lineages],
    run_ids: [...scan.run_ids],
    contended_append: {
      disposition: contended.disposition,
      durable: contended.durable,
      sequence: contended.sequence,
      failure_code: contended.failure === null ? null : contended.failure.code,
    },
    record_count_after_contention: contention.underContention.record_count,
  };

  const satisfied =
    sequences.length >= 3 &&
    sequences[0] === 1 &&
    strictlyIncreasing(sequences) &&
    allDistinct(operations) &&
    scan.duplicate_sequences.length === 0 &&
    scan.regressing_sequences.length === 0 &&
    scan.order_violations.length === 0 &&
    scan.integrity === "intact" &&
    scan.split_lineages.length === 0 &&
    scan.run_ids.length === 1 &&
    lockFailure === null &&
    contended.disposition !== "succeeded" &&
    contended.durable === false &&
    contended.sequence === null &&
    contended.failure !== null &&
    contention.underContention.record_count === scan.record_count &&
    causalOrder.every(
      (entry) =>
        entry.causation_id === null || (entry.cause_sequence !== null && entry.cause_sequence < entry.sequence)
    );

  return { satisfied, observed };
}

/** MHRC-RCT-002 — a real interrupted append over a real prior valid state. */
function probeInterruptedAppend(
  port: Mh06JournalPort,
  workspace: string,
  identity: Mh06EvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-002"]);
  const prior = port.appendReceipt(
    paths,
    probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-002",
      operation_id: "op-1",
      correlation_id: "corr-op-1",
      event_id: "evt-1",
    })
  );
  const interrupted = port.appendReceipt(
    paths,
    probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-002",
      operation_id: "op-2",
      correlation_id: "corr-op-2",
      event_id: "evt-2",
      causation_id: "evt-1",
    }),
    tornAppendIo(port.defaultJournalIo, TORN_APPEND_CUT_BYTES)
  );
  const post = port.scanReceiptJournal(paths.journal);
  const checkpoint = port.readCheckpointState(paths.checkpoint);
  const subsequent = port.appendReceipt(
    paths,
    probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-002",
      operation_id: "op-3",
      correlation_id: "corr-op-3",
      event_id: "evt-3",
    })
  );

  const priorRecord = prior.record;
  const observed: Record<string, unknown> = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-002", {
      operation_id: prior.operation_id,
      correlation_id: priorRecord === null ? "" : priorRecord.correlation_id,
      sequence: prior.sequence === null ? 0 : prior.sequence,
      record_hash: priorRecord === null ? "" : priorRecord.record_hash,
    }),
    prior: { disposition: prior.disposition, durable: prior.durable, sequence: prior.sequence },
    interrupted: {
      disposition: interrupted.disposition,
      durable: interrupted.durable,
      sequence: interrupted.sequence,
      failure_code: interrupted.failure === null ? null : interrupted.failure.code,
      observation_state: interrupted.observation_state,
      blocks_dependent_completion: interrupted.blocks_dependent_completion,
    },
    post_fault: {
      integrity: post.integrity,
      record_count: post.record_count,
      last_sequence: post.last_sequence,
      rejected: post.rejected.map((entry) => ({ line_number: entry.line_number, reason: entry.reason })),
      observation_state: post.observation_state,
      blocks_clean_close: post.blocks_clean_close,
    },
    checkpoint_after_fault: {
      state: checkpoint.state,
      last_sequence: checkpoint.checkpoint === null ? null : checkpoint.checkpoint.last_sequence,
      record_count: checkpoint.checkpoint === null ? null : checkpoint.checkpoint.record_count,
      last_event_id: checkpoint.checkpoint === null ? null : checkpoint.checkpoint.last_event_id,
    },
    subsequent_append: {
      disposition: subsequent.disposition,
      durable: subsequent.durable,
      failure_code: subsequent.failure === null ? null : subsequent.failure.code,
    },
  };

  const satisfied =
    prior.durable === true &&
    interrupted.disposition !== "succeeded" &&
    interrupted.durable === false &&
    interrupted.sequence === null &&
    interrupted.failure !== null &&
    post.record_count === 1 &&
    post.last_sequence === prior.sequence &&
    post.rejected.length >= 1 &&
    post.integrity !== "intact" &&
    post.blocks_clean_close === true &&
    checkpoint.state === "present" &&
    checkpoint.checkpoint !== null &&
    checkpoint.checkpoint.last_sequence === prior.sequence &&
    checkpoint.checkpoint.record_count === 1 &&
    subsequent.disposition !== "succeeded" &&
    subsequent.durable === false;

  return { satisfied, observed };
}

/** MHRC-RCT-003 — a real, durably recorded observation failure. */
function probeObservationLoss(
  port: Mh06JournalPort,
  workspace: string,
  identity: Mh06EvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-003"]);
  // BR-07 at the READ path first: a journal nobody wrote is `not_observed`.
  const absent = port.scanReceiptJournal(paths.journal);
  const recorded = port.appendReceipt(
    paths,
    probeInput(identity, runId, {
      scenario_id: "MHRC-RCT-003",
      operation_id: "op-observation-loss",
      correlation_id: "corr-op-observation-loss",
      event_id: "evt-observation-loss",
      disposition: "failed",
      observation_state: "observation_failed",
      affected_event_range: { from: 2, to: 4 },
      output_hash: null,
      observed_at: null,
    })
  );
  const post = port.scanReceiptJournal(paths.journal);
  const record = recorded.record;

  const observed: Record<string, unknown> = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-003", {
      operation_id: recorded.operation_id,
      correlation_id: record === null ? "" : record.correlation_id,
      sequence: recorded.sequence === null ? 0 : recorded.sequence,
      record_hash: record === null ? "" : record.record_hash,
    }),
    absent_journal: {
      integrity: absent.integrity,
      observation_state: absent.observation_state,
      blocks_clean_close: absent.blocks_clean_close,
      record_count: absent.record_count,
    },
    recorded: {
      disposition: recorded.disposition,
      durable: recorded.durable,
      observation_state: recorded.observation_state,
      blocks_dependent_completion: recorded.blocks_dependent_completion,
      affected_event_range: record === null ? null : record.affected_event_range,
    },
    post: {
      integrity: post.integrity,
      observation_state: post.observation_state,
      blocks_clean_close: post.blocks_clean_close,
      record_count: post.record_count,
    },
  };

  const range = record === null ? null : record.affected_event_range;
  const satisfied =
    absent.observation_state === "not_observed" &&
    absent.blocks_clean_close === true &&
    recorded.durable === true &&
    recorded.disposition !== "succeeded" &&
    recorded.observation_state === "observation_failed" &&
    recorded.blocks_dependent_completion === true &&
    range !== null &&
    Number.isInteger(range.from) &&
    Number.isInteger(range.to) &&
    range.from >= 1 &&
    range.from <= range.to &&
    post.observation_state === "observation_failed" &&
    post.blocks_clean_close === true;

  return { satisfied, observed };
}

/** MHRC-RCT-004 — a real gapped journal reconciled with one recovery offered. */
function probeSequenceGaps(
  port: Mh06JournalPort,
  workspace: string,
  identity: Mh06EvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-004"]);
  const seal = (sequence: number): ReceiptRecordV1 =>
    port.sealReceiptRecord({
      ...probeInput(identity, runId, {
        scenario_id: "MHRC-RCT-004",
        operation_id: `op-${sequence}`,
        correlation_id: `corr-op-${sequence}`,
        event_id: `evt-${sequence}`,
      }),
      sequence,
    });

  // Sequences 2 and 4 are missing; the producer believes it emitted five.
  layDownSealedJournal(port, paths, [seal(1), seal(3), seal(5)], runId);
  const offered = seal(2);
  const out = port.reconcileReceiptJournal({
    journalPath: paths.journal,
    checkpointPath: paths.checkpoint,
    run_id: runId,
    producerCheckpoint: { last_sequence: 5, record_count: 5 },
    reconciled_at: PROBE_RECONCILED_AT,
    recovered: [offered],
  });

  const placed = out.reconciled_order.find((entry) => entry.sequence === offered.sequence);
  const offeredIdentity = {
    sequence: offered.sequence,
    event_id: offered.event_id,
    operation_id: offered.operation_id,
    correlation_id: offered.correlation_id,
  };
  // Resolved from the OFFERED record only when the reconciliation reports the
  // identity it was handed; a renamed entry resolves to null and the comparison
  // below fails, which is the whole point of asking.
  const recoveredIdentity =
    placed === undefined
      ? null
      : {
          sequence: placed.sequence,
          event_id: placed.event_id,
          operation_id: placed.event_id === offered.event_id ? offered.operation_id : null,
          correlation_id: placed.event_id === offered.event_id ? offered.correlation_id : null,
        };

  const observed: Record<string, unknown> = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-004", {
      operation_id: offered.operation_id,
      correlation_id: offered.correlation_id,
      sequence: offered.sequence,
      record_hash: offered.record_hash,
    }),
    disposition: out.disposition,
    gaps: out.gaps.map((gap) => ({
      from: gap.from,
      to: gap.to,
      recovered: gap.recovered,
      observation_state: gap.observation_state,
    })),
    recovered_sequences: [...out.recovered_sequences],
    unresolved_sequences: [...out.unresolved_sequences],
    rejected_recoveries: out.rejected_recoveries.map((entry) => ({
      sequence: entry.sequence,
      event_id: entry.event_id,
      reason: entry.reason,
    })),
    reconciled_order: out.reconciled_order.map((entry) => ({ sequence: entry.sequence, event_id: entry.event_id })),
    offered_identity: offeredIdentity,
    recovered_identity: recoveredIdentity,
    checkpoint_before: {
      state: out.checkpoint_before_state,
      last_sequence: out.checkpoint_before === null ? null : out.checkpoint_before.last_sequence,
      record_count: out.checkpoint_before === null ? null : out.checkpoint_before.record_count,
      last_event_id: out.checkpoint_before === null ? null : out.checkpoint_before.last_event_id,
    },
    checkpoint_after: {
      last_sequence: out.checkpoint_after.last_sequence,
      record_count: out.checkpoint_after.record_count,
      last_event_id: out.checkpoint_after.last_event_id,
    },
    checkpoint_disagreements: out.checkpoint_disagreements.map((entry) => ({
      code: entry.code,
      expected: entry.expected,
      actual: entry.actual,
    })),
    blocks_clean_close: out.blocks_clean_close,
    merged_observation_state: out.merged_observation_state,
    merged_integrity: out.merged_integrity,
  };

  const inGap = (sequence: number, recovered: boolean): boolean =>
    out.gaps.some((gap) => gap.recovered === recovered && sequence >= gap.from && sequence <= gap.to);

  const satisfied =
    out.disposition === "degraded" &&
    out.gaps.length >= 1 &&
    out.gaps.every((gap) => Number.isInteger(gap.from) && Number.isInteger(gap.to) && gap.from <= gap.to) &&
    out.gaps.every((gap) => gap.recovered === true || gap.observation_state === "not_observed") &&
    out.recovered_sequences.length >= 1 &&
    out.unresolved_sequences.length >= 1 &&
    out.recovered_sequences.every((sequence) => out.unresolved_sequences.indexOf(sequence) === -1) &&
    out.recovered_sequences.every((sequence) => inGap(sequence, true)) &&
    out.unresolved_sequences.every((sequence) => inGap(sequence, false)) &&
    out.rejected_recoveries.length === 0 &&
    strictlyIncreasing(out.reconciled_order.map((entry) => entry.sequence)) &&
    out.recovered_sequences.every((sequence) =>
      out.reconciled_order.some((entry) => entry.sequence === sequence)
    ) &&
    recoveredIdentity !== null &&
    recoveredIdentity.event_id === offeredIdentity.event_id &&
    recoveredIdentity.sequence === offeredIdentity.sequence &&
    recoveredIdentity.operation_id === offeredIdentity.operation_id &&
    recoveredIdentity.correlation_id === offeredIdentity.correlation_id &&
    out.checkpoint_before_state === "present" &&
    out.checkpoint_before !== null &&
    out.checkpoint_after.record_count > out.checkpoint_before.record_count &&
    out.blocks_clean_close === true;

  return { satisfied, observed };
}

/** MHRC-RCT-005 — real duplicate delivery, plus the payload-mismatch control. */
function probeDuplicateDelivery(
  port: Mh06JournalPort,
  workspace: string,
  identity: Mh06EvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = makeProbePaths(workspace, PROBE_DIRS["MHRC-RCT-005"]);
  const seal = (sequence: number, eventId: string, over: Partial<ReceiptAppendInput> = {}): ReceiptRecordV1 =>
    port.sealReceiptRecord({
      ...probeInput(identity, runId, {
        scenario_id: "MHRC-RCT-005",
        operation_id: "op-duplicated",
        correlation_id: "corr-op-duplicated",
        event_id: eventId,
        ...over,
      }),
      sequence,
    });

  // One operation id, one payload hash, delivered twice.
  const first = seal(1, "evt-delivery-a");
  const second = seal(2, "evt-delivery-b");
  layDownSealedJournal(port, paths, [first, second], runId);
  const out = port.reconcileReceiptJournal({
    journalPath: paths.journal,
    checkpointPath: paths.checkpoint,
    run_id: runId,
    producerCheckpoint: { last_sequence: 2, record_count: 2 },
    reconciled_at: PROBE_RECONCILED_AT,
  });

  // The same operation id carrying a DIFFERENT payload must fail reconciliation.
  const mismatchPaths = makeProbePaths(paths.dir, "payload-mismatch");
  const conflicting = seal(2, "evt-delivery-c", { input_hash: `sha256:${"3".repeat(64)}` });
  layDownSealedJournal(port, mismatchPaths, [first, conflicting], runId);
  const mismatch = port.reconcileReceiptJournal({
    journalPath: mismatchPaths.journal,
    checkpointPath: mismatchPaths.checkpoint,
    run_id: runId,
    producerCheckpoint: { last_sequence: 2, record_count: 2 },
    reconciled_at: PROBE_RECONCILED_AT,
  });

  const observed: Record<string, unknown> = {
    ...evidenceBindings(identity, runId, "MHRC-RCT-005", {
      operation_id: first.operation_id,
      correlation_id: first.correlation_id,
      sequence: first.sequence,
      record_hash: first.record_hash,
    }),
    disposition: out.disposition,
    duplicates: out.duplicates.map((group) => ({
      operation_id: group.operation_id,
      event_ids: [...group.event_ids],
      authoritative_event_id: group.authoritative_event_id,
      payload_hash: group.payload_hash,
      effects_applied: group.effects_applied,
    })),
    conflicts: out.conflicts.map((group) => ({
      operation_id: group.operation_id,
      payload_hashes: [...group.payload_hashes],
      reason: group.reason,
    })),
    event_identity_conflicts: out.event_identity_conflicts.map((entry) => ({
      event_id: entry.event_id,
      sequences: [...entry.sequences],
    })),
    authoritative_effect_count: out.authoritative_effect_count,
    blocks_clean_close: out.blocks_clean_close,
    mismatch_probe: {
      disposition: mismatch.disposition,
      duplicates: mismatch.duplicates.length,
      conflicts: mismatch.conflicts.map((group) => ({
        operation_id: group.operation_id,
        payload_hashes: [...group.payload_hashes],
        reason: group.reason,
      })),
      blocks_clean_close: mismatch.blocks_clean_close,
    },
  };

  const satisfied =
    out.disposition === "succeeded" &&
    out.duplicates.length === 1 &&
    out.duplicates.every(
      (group) =>
        group.operation_id.length > 0 &&
        group.payload_hash.length > 0 &&
        group.event_ids.length >= 2 &&
        allDistinct(group.event_ids) &&
        group.event_ids.indexOf(group.authoritative_event_id) !== -1 &&
        group.effects_applied === 1
    ) &&
    out.authoritative_effect_count === 1 &&
    out.conflicts.length === 0 &&
    out.event_identity_conflicts.length === 0 &&
    out.blocks_clean_close === false &&
    mismatch.disposition !== "succeeded" &&
    mismatch.conflicts.length >= 1 &&
    mismatch.conflicts.every(
      (group) =>
        group.reason === "payload_hash_mismatch" &&
        group.payload_hashes.length >= 2 &&
        allDistinct(group.payload_hashes)
    ) &&
    mismatch.blocks_clean_close === true;

  return { satisfied, observed };
}

const PROBES: Readonly<
  Record<
    string,
    (port: Mh06JournalPort, workspace: string, identity: Mh06EvidenceIdentity, runId: string) => ProbeVerdict
  >
> = Object.freeze({
  "MHRC-RCT-001": probeAppendOrder,
  "MHRC-RCT-002": probeInterruptedAppend,
  "MHRC-RCT-003": probeObservationLoss,
  "MHRC-RCT-004": probeSequenceGaps,
  "MHRC-RCT-005": probeDuplicateDelivery,
});

// ─────────────────────────────────────────────────────────────────────────────
// Request admission
// ─────────────────────────────────────────────────────────────────────────────

function refuseEvaluation(
  control: string,
  reasonCode: string,
  assertions: readonly string[]
): Mh06ConformanceResult {
  return {
    outcome: evaluationOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode,
      assertions,
      facts: {
        refusal_control: control,
        owner_key: MH06_OWNER_KEY,
        suite_id: MH06_SUITE_ID,
        suite_version: MH06_SUITE_VERSION,
        evidence: [],
      },
    }),
    packet: null,
  };
}

function identityIsComplete(identity: unknown): boolean {
  if (identity === null || typeof identity !== "object") return false;
  const record = identity as Record<string, unknown>;
  for (const field of EVIDENCE_IDENTITY_FIELDS) {
    const value = record[field];
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

function isExistingDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** Remove this evaluation's own workspace. Never masks the verdict it produced. */
function removeQuietly(target: string): void {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* a disposable workspace that outlives the call is the caller's root to clear */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The evaluator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate the five `W1/MH-06` scenarios and hand back ONE owner packet.
 *
 * Every result is derived by executing the real receipt journal inside a
 * workspace created beneath the caller's disposable root. Nothing here promotes,
 * releases, signs, attests, or assembles: this module answers five questions and
 * stops.
 *
 * A malformed request is a TYPED REFUSAL carrying its own discriminator on
 * `outcome.facts.refusal_control`, and never a packet — a refusal that still
 * produced results would be indistinguishable from an evaluation.
 */
export function evaluateReceiptJournalConformance(request: Mh06ConformanceRequest): Mh06ConformanceResult {
  if (request === null || typeof request !== "object") {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.journalRootUnusable, "scenario_evidence_incomplete", [
      "a request that is not a record names no journal root, and evaluation writes journals",
    ]);
  }
  if ("stable_ids" in (request as object)) {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.callerSuppliedIds, "scenario_required_set_mismatch", [
      "the covered scenario set has exactly one source, and it is this module",
      "an agreeing caller-supplied set is refused too, because accepting a matching copy accepts the channel",
    ]);
  }
  if ("results" in (request as object)) {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.callerSuppliedResults, SCENARIO_RESULT_MISMATCH, [
      "result truth is produced by executing the journal, never accepted from the caller",
      "a fixture package offered in place of execution is the false-conformance shortcut this refusal exists for",
    ]);
  }
  if (!identityIsComplete(request.evidence_identity)) {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.identityIncomplete, "scenario_evidence_incomplete", [
      "evidence that names no complete identity is bound to no runtime",
    ]);
  }
  for (const stableId of MH06_SCENARIO_IDS) {
    const receiptRef = request.receipt_refs === undefined ? undefined : request.receipt_refs[stableId];
    const freshness = request.evidence_freshness === undefined ? undefined : request.evidence_freshness[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return refuseEvaluation(
        MH06_REFUSAL_CONTROLS.evidenceBindingMissing,
        "scenario_receipt_reference_missing",
        ["every scenario result commits to a receipt reference"]
      );
    }
    if (typeof freshness !== "string" || EVIDENCE_FRESHNESS_VERDICTS.indexOf(freshness) === -1) {
      return refuseEvaluation(MH06_REFUSAL_CONTROLS.evidenceBindingMissing, "scenario_evidence_incomplete", [
        "every scenario result carries a typed freshness verdict",
      ]);
    }
  }

  const root = request.journal_root;
  const usableRoot =
    typeof root === "string" && root.length > 0 && path.isAbsolute(root) && isExistingDirectory(root);
  if (!usableRoot) {
    return refuseEvaluation(MH06_REFUSAL_CONTROLS.journalRootUnusable, "scenario_evidence_incomplete", [
      "conformance evaluation writes journals, so it requires an absolute, existing, disposable root",
      "it never falls back to a directory of its own choosing",
    ]);
  }

  const port = request.journal === undefined ? MH06_PRODUCTION_JOURNAL : request.journal;
  const identity = request.evidence_identity;
  // A CONTAINED workspace of this evaluation's own, beneath the caller's root.
  const workspace = fs.mkdtempSync(path.join(root, PROBE_WORKSPACE_PREFIX));

  const verdicts: Record<string, ProbeVerdict> = {};
  try {
    for (const stableId of MH06_SCENARIO_IDS) {
      verdicts[stableId] = PROBES[stableId](port, workspace, identity, request.run_id);
    }
  } finally {
    removeQuietly(workspace);
  }

  const evidence = MH06_SCENARIO_IDS.map((stableId) => ({
    stable_id: stableId,
    satisfied: verdicts[stableId].satisfied,
    observed: verdicts[stableId].observed,
  }));

  const results: Mh06ScenarioResult[] = MH06_SCENARIO_IDS.map((stableId) => {
    const expected = MH06_EXPECTED_OUTCOMES[stableId];
    const satisfied = verdicts[stableId].satisfied;
    return {
      stable_id: stableId,
      outcome_type: expected.type,
      disposition: satisfied ? expected.disposition : "failed",
      reason_code: satisfied ? expected.reason_code : SCENARIO_RESULT_MISMATCH,
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: { ...identity },
      evidence_freshness: request.evidence_freshness[stableId],
    };
  });

  const allSatisfied = MH06_SCENARIO_IDS.every((stableId) => verdicts[stableId].satisfied);
  const packet: Mh06OwnerPacket = {
    schema_version: MH06_PACKET_SCHEMA,
    suite_id: MH06_SUITE_ID,
    suite_version: MH06_SUITE_VERSION,
    owner_key: MH06_OWNER_KEY,
    evidence_identity: { ...identity },
    stable_ids: [...MH06_SCENARIO_IDS],
    results,
  };

  return {
    outcome: evaluationOutcome({
      type: "guild.receipt_outcome.v1",
      disposition: allSatisfied ? "succeeded" : "failed",
      reason_code: allSatisfied ? null : SCENARIO_RESULT_MISMATCH,
      assertions: [
        "each of the five W1/MH-06 scenarios was evaluated by executing the real receipt journal",
        "an interrupted append never reports durable success, and a torn tail is never parsed as a record",
        "a missing observation is never checked_clean, and every gap is bounded and classified",
        "one operation id and payload hash remains one logical receipt with one effect",
        "no promotion, release, signature, or policy decision happens here",
      ],
      facts: {
        owner_key: MH06_OWNER_KEY,
        suite_id: MH06_SUITE_ID,
        suite_version: MH06_SUITE_VERSION,
        evidence,
      },
    }),
    packet: freezeDeep(packet),
  };
}
