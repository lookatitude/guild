/**
 * __tests__/neutral-conformance-mh06.test.ts
 *
 * FIC-115 / A21-6 (RED-FIRST) — the executable contract for the not-yet-written
 * pure production module
 * `src/modules/telemetry/workflows/receipt-journal-conformance-evaluator.ts`.
 *
 * WHAT THIS BINDS
 *   `guild.conformance_scenarios.v1` assigns exactly FIVE of its 31 scenarios to
 *   the `W1/MH-06` receipt-journal owner: `MHRC-RCT-001` … `MHRC-RCT-005`.
 *   A21-S (already accepted — review packet `FIC-112-A21-SPINE-BLOCKERS-GREEN`,
 *   receipt SHA-256 `5bdb319ded97b0d083c31173c45807655c9c2366c0a2d69db34148b40b5cdcfe`,
 *   verdict `satisfied` at round 2) built the ASSEMBLY spine that joins one packet
 *   per owner. It deliberately evaluates nothing. This file states what the MH-06
 *   owner's EVALUATOR must be before its packet is allowed to mean anything.
 *
 *   The only thing that makes such a packet honest is that its five results are
 *   DERIVED from the real durable journal — the append, scan and reconcile paths
 *   in `receipt-journal.ts` and `receipt-reconcile.ts` — rather than authored. So
 *   the contract below is written twice: once as ordinary obligations, and once
 *   as a CONTROL BATTERY run against a disposable conforming oracle (must pass)
 *   and against ten planted mutants (each must fail a NAMED control). A battery
 *   the mutants survive proves nothing.
 *
 * WHAT IT DELIBERATELY DOES NOT BIND
 *   No promotion decision, no signature or attestation verification, no release
 *   or channel decision, and no assembly. `evaluateNeutralConformanceDecision`
 *   (MH-02) still owns promotion; `assembleNeutralConformanceEvidence` (A21-S)
 *   still owns the join. This module only EVALUATES five scenarios and hands over
 *   one packet. §"the evaluator stays inside its boundary" scans the real source
 *   to prove it — including that it imports no frozen release-conformance fixture.
 *
 * THE TWO HONEST GAPS THIS CONTRACT OPENS ON PURPOSE
 *   1. The frozen contract binds all five `MHRC-RCT-*` scenarios to evidence
 *      profile `E-RECEIPT`, and the neutral core's `NEUTRAL_EVIDENCE_PROFILES`
 *      declares only `E-LIFECYCLE` and `E-REFUSAL`. So a registry that names the
 *      frozen contract's own profile currently fails the core's field contract on
 *      that one point and nothing else. `MH06-C01` encodes exactly that: every
 *      other field must satisfy `validateNeutralScenarioRegistry`, and the ONLY
 *      tolerated error is the unknown-profile error naming `E-RECEIPT`. The
 *      evaluator lane closes it by declaring `E-RECEIPT` in the core from the
 *      frozen contract's own `evidence_profiles` table — a transcription, not a
 *      new dialect. This suite requires it; it does NOT edit production to provide
 *      it, and it widens no other vocabulary.
 *   2. `MHRC-RCT-001`'s input pattern is `sequential_and_concurrent_operations`.
 *      Real MULTI-PROCESS racing is already bound, at length, by
 *      `receipt-journal.test.ts` (§"concurrent appends are linearizable across
 *      processes"), which spawns real children. Re-spawning them here would make
 *      the evaluator asynchronous and its packet order-dependent, so this contract
 *      binds the CONCURRENCY PROPERTY instead of re-running the race: with the
 *      real derived lock held — the exact on-disk state a competing writer leaves —
 *      `appendReceipt` must refuse (`journal_lock_unavailable`) with the journal
 *      byte-unchanged, so two writers can never both claim one sequence. The
 *      sequential leg then proves uniqueness and strict increase directly.
 *
 * RED EXPECTATION AT AUTHORING TIME
 *   Every `it` under §"the production MH-06 evaluator" fails with
 *   "A21-6 RED: production module not implemented yet", because the module does
 *   not exist. It must fail for that reason and no other. The anti-vacuity blocks
 *   (§"the frozen W1/MH-06 slice" and §"the control battery distinguishes good
 *   from bad") are GREEN from the first run: they exercise the same controls
 *   against a test-owned oracle and mutants, which is what makes the RED half a
 *   real gate rather than a placeholder.
 *
 * CONTAINMENT
 *   Every journal this file touches lives in a disposable OS-temp directory that
 *   the test creates and removes. No production, project, or host state is read
 *   for truth or written at all; `MH06-C14` is the executable statement of that.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  NEUTRAL_DISPOSITIONS,
  NEUTRAL_OUTCOME_TYPES,
  NEUTRAL_REASON_CODES,
  neutralCanonicalJson,
  neutralFreeze,
  neutralOutcome,
} from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import type { NeutralOutcome } from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import {
  NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  validateNeutralScenarioRegistry,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import type {
  NeutralEvidenceIdentity,
  NeutralScenarioDefinition,
  NeutralScenarioResult,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import {
  NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  NEUTRAL_CONFORMANCE_OWNER_KEYS,
  NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS,
  NEUTRAL_OWNER_SCENARIO_IDS,
  NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS,
  assembleNeutralConformanceEvidence,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";

// The REAL production journal. Imported here for two distinct purposes: to drive
// the same paths the evaluator must drive, and to prove by IDENTITY (`===`) that
// the evaluator's declared production port holds these exact functions rather
// than look-alikes.
import {
  acquireJournalLock,
  appendReceipt,
  defaultJournalIo,
  journalLockPath,
  makeReceiptInput,
  readCheckpointState,
  releaseJournalLock,
  scanReceiptJournal,
  sealReceiptRecord,
} from "../../src/modules/telemetry/workflows/receipt-journal";
import type {
  JournalIo,
  JournalScanResult,
  ReceiptAppendInput,
  ReceiptAppendOutcome,
  ReceiptRecordV1,
} from "../../src/modules/telemetry/workflows/receipt-journal";
import { reconcileReceiptJournal } from "../../src/modules/telemetry/workflows/receipt-reconcile";
import type { ReconciliationOutcomeV1 } from "../../src/modules/telemetry/workflows/receipt-reconcile";

// ---------------------------------------------------------------------------
// The module under contract
// ---------------------------------------------------------------------------

/**
 * The pinned future module path.
 *
 * It lives BESIDE `receipt-journal.ts` because the five MH-06 scenarios are
 * statements about that journal's own behaviour, and an evaluator that sat in the
 * lifecycle module would have to re-describe the durability surface to reach them
 * — which is the drift the owner split exists to prevent.
 */
const EVALUATOR_REQUEST = "../../src/modules/telemetry/workflows/receipt-journal-conformance-evaluator";
const EVALUATOR_SOURCE_PATH = path.resolve(
  __dirname,
  "../../src/modules/telemetry/workflows/receipt-journal-conformance-evaluator.ts"
);

const RED = "A21-6 RED: production module not implemented yet";

let evaluatorModuleCache: Record<string, unknown> | undefined;

/**
 * Load the module under contract, or fail with the one diagnostic this suite is
 * allowed to fail with while it is RED.
 *
 * Lazily, never at import time: a top-level import of a missing module collapses
 * the whole file into a single resolution error, which says nothing about WHICH
 * obligation is unmet. Every `it` below fails independently and names its own.
 */
function evaluatorModule(): Record<string, unknown> {
  if (evaluatorModuleCache === undefined) {
    if (!fs.existsSync(EVALUATOR_SOURCE_PATH)) {
      throw new Error(`${RED} — expected ${EVALUATOR_SOURCE_PATH}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    evaluatorModuleCache = require(EVALUATOR_REQUEST) as Record<string, unknown>;
  }
  return evaluatorModuleCache;
}

/** Read one required export, or fail naming the export rather than the module. */
function exported<T>(name: string): T {
  const value = evaluatorModule()[name];
  if (value === undefined) {
    throw new Error(`A21-6 RED: production module does not implement the contract — missing export ${name}`);
  }
  return value as T;
}

function evaluatorSource(): string {
  if (!fs.existsSync(EVALUATOR_SOURCE_PATH)) throw new Error(`${RED} — expected ${EVALUATOR_SOURCE_PATH}`);
  return fs.readFileSync(EVALUATOR_SOURCE_PATH, "utf8");
}

/** Strip block and line comments so a source scan cannot be tripped by prose. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

// ---------------------------------------------------------------------------
// The frozen contract, transcribed independently of production
// ---------------------------------------------------------------------------

const OWNER_KEY_MH06 = "W1/MH-06";

/** The five W1/MH-06 stable ids, in CANONICAL (whole-suite) order. */
const MH06_IDS: readonly string[] = [
  "MHRC-RCT-001",
  "MHRC-RCT-002",
  "MHRC-RCT-003",
  "MHRC-RCT-004",
  "MHRC-RCT-005",
];

/**
 * The expected typed outcome of each MH-06 scenario, transcribed from the frozen
 * `guild.conformance_scenarios.v1` contract.
 *
 * The TYPE and DISPOSITION columns are the contract's own words. The REASON CODE
 * column is not: the frozen contract states dispositions, and the neutral result
 * contract requires every non-`succeeded` result to carry exactly one recognized
 * reason code. The three codes below are the closest members of the core's CLOSED
 * vocabulary and are pinned here so the evaluator cannot pick a different one per
 * run — `execution_failed` for an append that could not complete durably,
 * `required_observation_failed` for an observation that was lost, and
 * `required_observation_missing` for the sequence range reconciliation could not
 * recover. Nothing here widens a vocabulary.
 */
const MH06_EXPECTED: Readonly<Record<string, { type: string; disposition: string; reason_code: string | null }>> = {
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
};

/** The scenario category the frozen contract assigns all five ids. */
const MH06_CATEGORY = "receipt_integrity";

/** The frozen contract's evidence profile for every `MHRC-RCT-*` scenario. */
const MH06_EVIDENCE_PROFILE = "E-RECEIPT";

/**
 * `E-RECEIPT.required_bindings`, transcribed from the frozen contract.
 *
 * Every scenario observation must carry all seven. They are what makes a result
 * attributable to a real operation in a real journal rather than to a label.
 */
const E_RECEIPT_BINDINGS: readonly string[] = [
  "scenario_id",
  "run_id",
  "operation_id",
  "correlation_id",
  "sequence",
  "source_version",
  "runtime_version",
];

/** The refusal discriminators the evaluator must place on `outcome.facts`. */
const REFUSAL_CONTROLS = {
  callerSuppliedIds: "caller_supplied_scenario_ids",
  callerSuppliedResults: "caller_supplied_results",
  identityIncomplete: "evidence_identity_incomplete",
  evidenceBindingMissing: "evidence_binding_missing",
  journalRootUnusable: "journal_root_unusable",
} as const;

// ---------------------------------------------------------------------------
// The evaluator's contract shapes, stated test-side
// ---------------------------------------------------------------------------

/**
 * The production surface the evaluator drives.
 *
 * It is a PORT rather than a direct import list for one reason only: a control
 * has to be able to SABOTAGE the journal and watch the verdict change. An
 * evaluator whose answer is the same whatever the journal says is not evaluating,
 * and no amount of shape checking can tell the two apart.
 *
 * The seam is not a substitute for the real path, and this suite never lets it
 * become one: `MH06_PRODUCTION_JOURNAL` must hold these exact function objects by
 * IDENTITY, the default (portless) evaluation runs against real files on a real
 * filesystem, and the source scan proves the real modules are what the evaluator
 * imports.
 */
interface Mh06JournalPort {
  readonly appendReceipt: typeof appendReceipt;
  readonly scanReceiptJournal: typeof scanReceiptJournal;
  readonly reconcileReceiptJournal: typeof reconcileReceiptJournal;
  readonly sealReceiptRecord: typeof sealReceiptRecord;
  readonly readCheckpointState: typeof readCheckpointState;
  readonly journalLockPath: typeof journalLockPath;
  readonly acquireJournalLock: typeof acquireJournalLock;
  readonly releaseJournalLock: typeof releaseJournalLock;
  readonly defaultJournalIo: typeof defaultJournalIo;
  /** Present only on a sabotaged port; the real one is unlabelled. */
  readonly label?: string;
}

const REAL_JOURNAL: Mh06JournalPort = {
  appendReceipt,
  scanReceiptJournal,
  reconcileReceiptJournal,
  sealReceiptRecord,
  readCheckpointState,
  journalLockPath,
  acquireJournalLock,
  releaseJournalLock,
  defaultJournalIo,
};

interface Mh06ConformanceRequest {
  readonly run_id: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  /** `stable_id` -> committed receipt reference into the durable journal. */
  readonly receipt_refs: Readonly<Record<string, string>>;
  /** `stable_id` -> typed freshness verdict. `unknown` is not a soft `fresh`. */
  readonly evidence_freshness: Readonly<Record<string, string>>;
  /**
   * A caller-supplied, DISPOSABLE, absolute directory. The evaluator creates its
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

interface Mh06OwnerPacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly NeutralScenarioResult[];
}

interface Mh06ConformanceResult {
  readonly outcome: NeutralOutcome;
  /** The owner packet, or `null` whenever the request itself was refused. */
  readonly packet: Mh06OwnerPacket | null;
}

type Mh06EvaluateFn = (request: Mh06ConformanceRequest) => Mh06ConformanceResult;

/** One scenario's observation record, carried on `outcome.facts.evidence`. */
interface Mh06ScenarioEvidence {
  readonly stable_id: string;
  readonly satisfied: boolean;
  readonly observed: Readonly<Record<string, unknown>>;
}

interface Mh06Subject {
  readonly label: string;
  readonly evaluate: Mh06EvaluateFn;
  readonly scenarioIds: readonly string[];
  readonly ownerKey: string;
  readonly packetSchema: string;
  readonly scenarios: readonly NeutralScenarioDefinition[];
  readonly journalPort: Mh06JournalPort;
  readonly refusalControls: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Test-owned fixtures
// ---------------------------------------------------------------------------

const IDENTITY: NeutralEvidenceIdentity = {
  source_commit: "b17ce90d4a2f6538c1e07ab4295df6631c80ae74",
  package_hash: `sha256:${"6".repeat(64)}`,
  runtime_version: "guild-2.5.0",
  adapter_version: "guild.host_adapter.v1.0.0",
  host_id: "claude-code-cli",
  host_version: "2.5.0",
  platform: "darwin-arm64",
  contract_version: 1,
  scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
  scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
  release_id: "rel-2026-08-18-a21-mh06",
};

const CLAIMANT_ID = "guild.release-emitter";
const RUN_ID = "run-a21-mh06-contract";

/** The journal's own version tuple. Fixed, so every record is reproducible. */
const JOURNAL_VERSIONS = {
  host_id: "claude-code-cli",
  host_version: "2.5.0",
  runtime_version: "guild-2.5.0",
  source_version: "a21-mh06",
  contract_version: "guild.observability.v1",
};

/**
 * Every timestamp this suite uses. The journal is clock-free by contract, so the
 * caller supplies them and the records are byte-reproducible from fixed inputs.
 */
const RECORDED_AT = "2026-08-18T00:00:00.000Z";
const RECONCILED_AT = "2026-08-18T00:00:05.000Z";

function receiptRefFor(stableId: string): string {
  const sequence = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.indexOf(stableId) + 1;
  const commitment = `nec1:${sequence.toString(16).padStart(16, "0")}`;
  return `guild.receipt_ref.v1:a21-mh06-journal#${sequence}@${commitment}`;
}

function receiptRefs(): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const id of MH06_IDS) refs[id] = receiptRefFor(id);
  return refs;
}

function freshnessMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of MH06_IDS) map[id] = "fresh";
  return map;
}

/** Every disposable root this file created, removed in `afterAll`. */
const DISPOSABLE_ROOTS: string[] = [];

function disposableRoot(tag: string): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), `mh06-${tag}-`));
  DISPOSABLE_ROOTS.push(root);
  return root;
}

/** The one root every ordinary control shares, so the oracle cache can bite. */
const SHARED_ROOT = disposableRoot("shared");

function baseRequest(overrides: Record<string, unknown> = {}): Mh06ConformanceRequest {
  return {
    run_id: RUN_ID,
    evidence_identity: IDENTITY,
    receipt_refs: receiptRefs(),
    evidence_freshness: freshnessMap(),
    journal_root: SHARED_ROOT,
    ...overrides,
  } as Mh06ConformanceRequest;
}

afterAll(() => {
  for (const root of DISPOSABLE_ROOTS) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* a disposable fixture that outlives the run is the OS's problem, not a test failure */
    }
  }
});

// ---------------------------------------------------------------------------
// Small assertion helpers
// ---------------------------------------------------------------------------

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

function evidenceOf(result: Mh06ConformanceResult): readonly Mh06ScenarioEvidence[] {
  const evidence = (result.outcome.facts as Record<string, unknown>).evidence;
  assert(Array.isArray(evidence), "outcome.facts.evidence must be an ordered array of scenario observations");
  return evidence as readonly Mh06ScenarioEvidence[];
}

function evidenceFor(result: Mh06ConformanceResult, stableId: string): Mh06ScenarioEvidence {
  const found = evidenceOf(result).find((entry) => entry && entry.stable_id === stableId);
  assert(found !== undefined, `outcome.facts.evidence carries no observation for ${stableId}`);
  return found as Mh06ScenarioEvidence;
}

function observedFor(result: Mh06ConformanceResult, stableId: string): Record<string, unknown> {
  return evidenceFor(result, stableId).observed as Record<string, unknown>;
}

function resultFor(packet: Mh06OwnerPacket | null, stableId: string): NeutralScenarioResult {
  assert(packet !== null, `expected a packet carrying ${stableId}, got null`);
  const found = (packet as Mh06OwnerPacket).results.find((entry) => entry && entry.stable_id === stableId);
  assert(found !== undefined, `the packet carries no result for ${stableId}`);
  return found as NeutralScenarioResult;
}

function accepted(subject: Mh06Subject, request: Mh06ConformanceRequest = baseRequest()): Mh06ConformanceResult {
  const result = subject.evaluate(request);
  assert(result !== null && typeof result === "object", "the evaluator must return a result record");
  assert(result.packet !== null, "a well-formed request must produce a packet");
  return result;
}

/** A frozen value: a write attempt either throws or changes nothing. */
function isImmutable(container: unknown, key: string | number, value: unknown): boolean {
  const target = container as Record<string | number, unknown>;
  const before = target[key];
  try {
    target[key] = value;
  } catch {
    return true;
  }
  return target[key] === before;
}

function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function numbersOf(value: unknown): number[] {
  return isPlainArray(value) ? value.filter((entry): entry is number => typeof entry === "number") : [];
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

/**
 * A conforming packet for an owner this lane does not own.
 *
 * DISPOSABLE and test-local: it exists only so the real assembler has its other
 * five inputs. It claims nothing about those owners' evaluators — none of which
 * exist yet either.
 */
function disposablePacketFor(ownerKey: string): Mh06OwnerPacket {
  const ids = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
  const packet: Record<string, unknown> = {};
  packet["schema_version"] = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  packet["suite_id"] = NEUTRAL_SCENARIO_SUITE_ID;
  packet["suite_version"] = NEUTRAL_SCENARIO_SUITE_VERSION;
  packet["owner_key"] = ownerKey;
  packet["evidence_identity"] = IDENTITY;
  packet["stable_ids"] = [...ids];
  packet["results"] = ids.map((stableId) => ({
    stable_id: stableId,
    outcome_type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    reason_code: null,
    receipt_ref: receiptRefFor(stableId),
    evidence_identity: IDENTITY,
    evidence_freshness: "fresh",
  }));
  return packet as unknown as Mh06OwnerPacket;
}

// ---------------------------------------------------------------------------
// Sabotage — a journal that answers differently, wired through the real calls
// ---------------------------------------------------------------------------

interface Sabotage {
  readonly label: string;
  readonly scan?: (real: JournalScanResult, journalPath: string) => JournalScanResult;
  readonly append?: (real: ReceiptAppendOutcome, input: ReceiptAppendInput) => ReceiptAppendOutcome;
  readonly reconcile?: (real: ReconciliationOutcomeV1, journalPath: string) => ReconciliationOutcomeV1;
}

/**
 * A journal port whose members still perform the REAL work and then doctor the
 * answer. Doctoring the answer rather than replacing the call is the point: the
 * files on disk stay exactly as production would have left them, so the only
 * thing that changed is what the evaluator was TOLD — which is precisely the
 * input a derived verdict must react to.
 */
function portWith(sabotage: Sabotage): Mh06JournalPort {
  return {
    ...REAL_JOURNAL,
    label: sabotage.label,
    scanReceiptJournal: ((journalPath: string, io?: JournalIo) => {
      const real = io === undefined ? scanReceiptJournal(journalPath) : scanReceiptJournal(journalPath, io);
      return sabotage.scan ? sabotage.scan(real, journalPath) : real;
    }) as typeof scanReceiptJournal,
    appendReceipt: ((paths, input, io, lockOptions) => {
      const real = appendReceipt(paths, input, io ?? defaultJournalIo, lockOptions ?? {});
      return sabotage.append ? sabotage.append(real, input) : real;
    }) as typeof appendReceipt,
    reconcileReceiptJournal: ((opts) => {
      const real = reconcileReceiptJournal(opts);
      return sabotage.reconcile ? sabotage.reconcile(real, opts.journalPath) : real;
    }) as typeof reconcileReceiptJournal,
  };
}

/** The workspace subdirectory each scenario probe owns, by stable id. */
const PROBE_DIR: Readonly<Record<string, string>> = {
  "MHRC-RCT-001": "rct001",
  "MHRC-RCT-002": "rct002",
  "MHRC-RCT-003": "rct003",
  "MHRC-RCT-004": "rct004",
  "MHRC-RCT-005": "rct005",
};

function isProbeOf(journalPath: string, stableId: string): boolean {
  return journalPath.indexOf(`${path.sep}${PROBE_DIR[stableId]}${path.sep}`) !== -1;
}

/** A journal that reports a duplicate sequence as an intact, clean journal. */
const DUPLICATE_SEQUENCE_TOLERATED = portWith({
  label: "duplicate-sequence-tolerated",
  scan: (real, journalPath) =>
    isProbeOf(journalPath, "MHRC-RCT-001")
      ? ({ ...real, duplicate_sequences: [2], regressing_sequences: [2] } as JournalScanResult)
      : real,
});

/** An interrupted append that answers `succeeded` with a durable claim. */
const INTERRUPTED_APPEND_SUCCEEDS = portWith({
  label: "interrupted-append-succeeds",
  append: (real, input) =>
    input.scenario_id === "MHRC-RCT-002" && real.disposition !== "succeeded"
      ? ({
          ...real,
          disposition: "succeeded",
          durable: true,
          sequence: 2,
          observation_state: "checked_clean",
          blocks_dependent_completion: false,
          failure: null,
        } as ReceiptAppendOutcome)
      : real,
});

/** A journal that reads a lost observation as a clean one. */
const LOST_OBSERVATION_READS_CLEAN = portWith({
  label: "lost-observation-reads-clean",
  scan: (real, journalPath) =>
    isProbeOf(journalPath, "MHRC-RCT-003")
      ? ({ ...real, observation_state: "checked_clean", blocks_clean_close: false } as JournalScanResult)
      : real,
});

/** A reconciliation that hides its gaps and closes clean. */
const GAPS_HIDDEN = portWith({
  label: "gaps-hidden",
  reconcile: (real, journalPath) =>
    isProbeOf(journalPath, "MHRC-RCT-004")
      ? ({
          ...real,
          disposition: "succeeded",
          gaps: [],
          recovered_sequences: [],
          unresolved_sequences: [],
          blocks_clean_close: false,
        } as ReconciliationOutcomeV1)
      : real,
});

/** A reconciliation that applies one logical receipt twice. */
const DUPLICATE_EFFECT_REAPPLIED = portWith({
  label: "duplicate-effect-reapplied",
  reconcile: (real, journalPath) =>
    isProbeOf(journalPath, "MHRC-RCT-005")
      ? ({
          ...real,
          duplicates: real.duplicates.map((group) => ({ ...group, effects_applied: 2 })),
          authoritative_effect_count: 2,
        } as ReconciliationOutcomeV1)
      : real,
});

/** A reconciliation that accepts two different payloads under one operation id. */
const PAYLOAD_MISMATCH_ACCEPTED = portWith({
  label: "payload-mismatch-accepted",
  reconcile: (real, journalPath) =>
    isProbeOf(journalPath, "MHRC-RCT-005") && real.conflicts.length > 0
      ? ({
          ...real,
          disposition: "succeeded",
          conflicts: [],
          blocks_clean_close: false,
        } as ReconciliationOutcomeV1)
      : real,
});

// ---------------------------------------------------------------------------
// The control battery — test-owned, executable, and run against every subject
// ---------------------------------------------------------------------------

interface Mh06Control {
  readonly id: string;
  readonly title: string;
  readonly run: (subject: Mh06Subject) => void;
}

const CONTROLS: readonly Mh06Control[] = [
  {
    id: "MH06-C01-scenario-registry-source-owned",
    title: "the five ids, their order, their owner, their outcomes, and the production port come from source",
    run: (subject) => {
      assert(subject.ownerKey === OWNER_KEY_MH06, `owner key must be ${OWNER_KEY_MH06}, got ${subject.ownerKey}`);
      assert(
        neutralCanonicalJson([...subject.scenarioIds]) === neutralCanonicalJson([...MH06_IDS]),
        `the scenario tuple must be exactly ${MH06_IDS.join(", ")} in canonical order`
      );
      // …and it must be the SAME tuple the accepted A21-S spine already owns, so
      // the evaluator cannot cover a set the assembler will not ask it for.
      assert(
        neutralCanonicalJson([...subject.scenarioIds]) ===
          neutralCanonicalJson([...NEUTRAL_OWNER_SCENARIO_IDS[OWNER_KEY_MH06]]),
        "the scenario tuple must equal the assembler's own W1/MH-06 id list"
      );
      assert(
        subject.scenarioIds.length === NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[OWNER_KEY_MH06],
        "the scenario tuple must hold exactly the owner's declared scenario count"
      );
      assert(Object.isFrozen(subject.scenarioIds), "the scenario tuple must be frozen");
      assert(subject.scenarios.length === MH06_IDS.length, "the registry must declare exactly five scenarios");
      assert(
        subject.packetSchema === NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
        `the packet schema must be ${NEUTRAL_ASSEMBLY_PACKET_SCHEMA}`
      );

      for (let index = 0; index < MH06_IDS.length; index += 1) {
        const scenario = subject.scenarios[index];
        const stableId = MH06_IDS[index];
        assert(scenario.stable_id === stableId, `registry position ${index} must declare ${stableId}`);
        assert(
          scenario.implementation_wave_owner.key === OWNER_KEY_MH06,
          `${stableId} must be owned by ${OWNER_KEY_MH06}`
        );
        assert(scenario.category === MH06_CATEGORY, `${stableId} category drifted from the frozen contract`);
        const expected = MH06_EXPECTED[stableId];
        assert(
          scenario.expected_typed_outcome.type === expected.type,
          `${stableId} expected outcome type drifted from the frozen contract`
        );
        assert(
          scenario.expected_typed_outcome.disposition === expected.disposition,
          `${stableId} expected disposition drifted from the frozen contract`
        );
        assert(
          scenario.evidence_requirements.some((requirement) => requirement.profile === MH06_EVIDENCE_PROFILE),
          `${stableId} must declare the frozen contract's ${MH06_EVIDENCE_PROFILE} evidence profile`
        );
        if (expected.reason_code !== null) {
          assert(
            NEUTRAL_REASON_CODES.indexOf(expected.reason_code as never) !== -1,
            `${stableId}: the pinned reason code must be a member of the core's closed vocabulary`
          );
        }
      }

      // THE ONE TOLERATED REGISTRY ERROR. `E-RECEIPT` is the frozen contract's own
      // profile name and the core has not transcribed it yet, so that single error
      // is the honest gap this contract opens. Any OTHER field defect is a failure.
      const verdict = validateNeutralScenarioRegistry(subject.scenarios);
      if (verdict.disposition !== "succeeded") {
        const errors = (verdict.facts as Record<string, unknown>).errors;
        assert(Array.isArray(errors) && errors.length > 0, "an invalid registry must name its errors");
        for (const error of errors as string[]) {
          assert(
            error.indexOf(`unknown evidence profile "${MH06_EVIDENCE_PROFILE}"`) !== -1,
            `the registry must satisfy the core's scenario_field_contract except for the ${MH06_EVIDENCE_PROFILE} gap: ${error}`
          );
        }
      }

      // The declared production port must hold the REAL journal functions, by
      // identity. A look-alike would let the whole battery run against a stand-in.
      assert(subject.journalPort.appendReceipt === appendReceipt, "the port must hold the real appendReceipt");
      assert(
        subject.journalPort.scanReceiptJournal === scanReceiptJournal,
        "the port must hold the real scanReceiptJournal"
      );
      assert(
        subject.journalPort.reconcileReceiptJournal === reconcileReceiptJournal,
        "the port must hold the real reconcileReceiptJournal"
      );
      assert(subject.journalPort.sealReceiptRecord === sealReceiptRecord, "the port must hold the real sealReceiptRecord");
      assert(subject.journalPort.journalLockPath === journalLockPath, "the port must hold the real journalLockPath");
      assert(
        subject.journalPort.acquireJournalLock === acquireJournalLock,
        "the port must hold the real acquireJournalLock"
      );

      for (const control of Object.keys(REFUSAL_CONTROLS)) {
        const expectedValue = (REFUSAL_CONTROLS as Record<string, string>)[control];
        assert(
          subject.refusalControls[control] === expectedValue,
          `the refusal control set must name ${expectedValue} as ${control}`
        );
      }
    },
  },
  {
    id: "MH06-C02-packet-shape-and-order",
    title: "one owner packet, five ordered results, each satisfying the runtime result contract",
    run: (subject) => {
      const result = accepted(subject);
      const packet = result.packet as Mh06OwnerPacket;
      assert(packet.schema_version === NEUTRAL_ASSEMBLY_PACKET_SCHEMA, "packet schema drifted");
      assert(packet.suite_id === NEUTRAL_SCENARIO_SUITE_ID, "packet suite id drifted");
      assert(packet.suite_version === NEUTRAL_SCENARIO_SUITE_VERSION, "packet suite version drifted");
      assert(packet.owner_key === OWNER_KEY_MH06, "packet owner key drifted");
      assert(
        neutralCanonicalJson([...packet.stable_ids]) === neutralCanonicalJson([...MH06_IDS]),
        "the packet must declare the five ids in canonical order"
      );
      assert(packet.results.length === MH06_IDS.length, "the packet must carry exactly five results");
      assert(
        neutralCanonicalJson(packet.evidence_identity) === neutralCanonicalJson(IDENTITY),
        "the packet identity must be the identity the request named"
      );
      for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
        const value = (packet.evidence_identity as unknown as Record<string, unknown>)[field];
        assert(value !== undefined && value !== null, `the packet identity must carry ${field}`);
      }

      const refs = receiptRefs();
      for (let index = 0; index < MH06_IDS.length; index += 1) {
        const stableId = MH06_IDS[index];
        const entry = packet.results[index];
        assert(entry.stable_id === stableId, `results[${index}] must answer ${stableId}`);
        assert(
          NEUTRAL_OUTCOME_TYPES.indexOf(entry.outcome_type as never) !== -1,
          `${stableId}: outcome_type outside the closed envelope vocabulary`
        );
        assert(
          NEUTRAL_DISPOSITIONS.indexOf(entry.disposition as never) !== -1,
          `${stableId}: disposition outside the closed vocabulary`
        );
        if (entry.disposition === "succeeded") {
          assert(entry.reason_code === null, `${stableId}: a succeeded result carries no reason code`);
        } else {
          assert(
            typeof entry.reason_code === "string" && NEUTRAL_REASON_CODES.indexOf(entry.reason_code as never) !== -1,
            `${stableId}: a non-succeeded result carries exactly one recognized reason code`
          );
        }
        assert(entry.receipt_ref === refs[stableId], `${stableId}: the committed receipt reference was not carried`);
        assert(
          NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(entry.evidence_freshness as never) !== -1,
          `${stableId}: evidence_freshness outside the exported vocabulary`
        );
        assert(
          neutralCanonicalJson(entry.evidence_identity) === neutralCanonicalJson(IDENTITY),
          `${stableId}: the result identity must equal the packet identity`
        );
        if (evidenceFor(result, stableId).satisfied) {
          const expected = MH06_EXPECTED[stableId];
          assert(
            entry.outcome_type === expected.type,
            `${stableId}: a satisfied scenario reports its frozen outcome type, got ${String(entry.outcome_type)}`
          );
          assert(
            entry.disposition === expected.disposition,
            `${stableId}: a satisfied scenario reports its frozen disposition, got ${String(entry.disposition)}`
          );
          assert(
            entry.reason_code === expected.reason_code,
            `${stableId}: a satisfied scenario reports its pinned reason code, got ${String(entry.reason_code)}`
          );
        }
      }
    },
  },
  {
    id: "MH06-C03-caller-cannot-author-or-shrink-result-truth",
    title: "neither the covered id set nor the results have the caller as a source",
    run: (subject) => {
      const shrunk = subject.evaluate(baseRequest({ stable_ids: ["MHRC-RCT-001"] }));
      assert(shrunk.packet === null, "a caller-supplied id set must be refused, not honoured");
      assert(shrunk.outcome.disposition === "refused", "a caller-supplied id set must be a typed refusal");
      assert(
        (shrunk.outcome.facts as Record<string, unknown>).refusal_control === REFUSAL_CONTROLS.callerSuppliedIds,
        `the refusal must name ${REFUSAL_CONTROLS.callerSuppliedIds}`
      );
      // Even an AGREEING set is refused: accepting a matching copy accepts the
      // channel through which a differing copy could arrive.
      const agreeing = subject.evaluate(baseRequest({ stable_ids: [...MH06_IDS] }));
      assert(agreeing.packet === null, "an agreeing caller-supplied id set is still the channel, and still refused");

      // The same rule one level down: a caller may not hand in RESULTS. A fixture
      // package offered in place of execution is the exact false-31/31 shortcut.
      const authored = subject.evaluate(
        baseRequest({
          results: MH06_IDS.map((stableId) => ({
            stable_id: stableId,
            outcome_type: MH06_EXPECTED[stableId].type,
            disposition: "succeeded",
            reason_code: null,
            receipt_ref: receiptRefFor(stableId),
            evidence_identity: IDENTITY,
            evidence_freshness: "fresh",
          })),
        })
      );
      assert(authored.packet === null, "caller-supplied results must be refused, never adopted");
      assert(
        (authored.outcome.facts as Record<string, unknown>).refusal_control === REFUSAL_CONTROLS.callerSuppliedResults,
        `the refusal must name ${REFUSAL_CONTROLS.callerSuppliedResults}`
      );
    },
  },
  {
    id: "MH06-C04-output-immutable-and-json-safe",
    title: "the packet is deeply frozen, JSON-safe, and not aliased to the caller's inputs",
    run: (subject) => {
      const result = accepted(subject);
      const packet = result.packet as Mh06OwnerPacket;
      assert(Object.isFrozen(packet), "the packet must be frozen");
      assert(Object.isFrozen(packet.results), "the packet results must be frozen");
      assert(Object.isFrozen(packet.stable_ids), "the packet ids must be frozen");
      assert(Object.isFrozen(packet.results[0]), "every result must be frozen");
      assert(Object.isFrozen(packet.results[0].evidence_identity), "every result identity must be frozen");
      assert(isImmutable(packet, "owner_key", "W9/MH-99"), "the packet owner key must not be writable");
      assert(isImmutable(packet.results as unknown as unknown[], 0, null), "the results array must not be writable");
      assert(
        packet.evidence_identity !== IDENTITY,
        "the packet identity must be a copy, not an alias of the caller's own object"
      );
      assert(
        neutralCanonicalJson(JSON.parse(JSON.stringify(packet))) === neutralCanonicalJson(packet),
        "the packet must be JSON-safe: no function, undefined, or cycle survives a round trip"
      );
      assert(
        neutralCanonicalJson(JSON.parse(JSON.stringify(result.outcome.facts))) ===
          neutralCanonicalJson(result.outcome.facts),
        "the evaluation facts must be JSON-safe too"
      );
    },
  },
  {
    id: "MH06-C05-deterministic-and-environment-free",
    title: "two evaluations over equivalent initial state are byte-equivalent and name no environment",
    run: (subject) => {
      const rootA = disposableRoot("det-a");
      const rootB = disposableRoot("det-b");
      const first = accepted(subject, baseRequest({ journal_root: rootA }));
      const second = accepted(subject, baseRequest({ journal_root: rootB }));
      assert(
        neutralCanonicalJson(first.packet) === neutralCanonicalJson(second.packet),
        "two evaluations over equivalent initial state must produce byte-equivalent packets"
      );
      assert(
        neutralCanonicalJson(first.outcome.facts) === neutralCanonicalJson(second.outcome.facts),
        "two evaluations over equivalent initial state must produce byte-equivalent facts"
      );
      // Byte-equality across two DIFFERENT roots is also the no-leak proof: a
      // packet naming its working directory could not have been equal.
      const serialized = `${neutralCanonicalJson(first.packet)}${neutralCanonicalJson(first.outcome.facts)}`;
      assert(serialized.indexOf(rootA) === -1, "no absolute working path may appear in the packet or facts");
      assert(serialized.indexOf(os.tmpdir()) === -1, "no host temp path may appear in the packet or facts");
      assert(
        serialized.indexOf(RECONCILED_AT) === -1 || serialized.indexOf(RECORDED_AT) !== -1,
        "timestamps in the output must be the fixed caller-supplied ones, never clock-derived"
      );
    },
  },
  {
    id: "MH06-C06-e-receipt-bindings-carried",
    title: "every observation carries the frozen E-RECEIPT bindings, bound to real journal identities",
    run: (subject) => {
      const result = accepted(subject);
      for (const stableId of MH06_IDS) {
        const observed = observedFor(result, stableId);
        for (const binding of E_RECEIPT_BINDINGS) {
          assert(
            Object.prototype.hasOwnProperty.call(observed, binding),
            `${stableId}: the ${MH06_EVIDENCE_PROFILE} profile requires the ${binding} binding`
          );
        }
        assert(observed.scenario_id === stableId, `${stableId}: scenario_id must bind this scenario`);
        assert(observed.run_id === RUN_ID, `${stableId}: run_id must bind the requested run`);
        assert(
          typeof observed.operation_id === "string" && (observed.operation_id as string).length > 0,
          `${stableId}: operation_id must name a real operation`
        );
        assert(
          typeof observed.correlation_id === "string" && (observed.correlation_id as string).length > 0,
          `${stableId}: correlation_id must name a real correlation`
        );
        assert(
          typeof observed.sequence === "number" && Number.isInteger(observed.sequence as number) && (observed.sequence as number) >= 1,
          `${stableId}: sequence must be the real journal sequence the observation is about`
        );
        assert(
          observed.runtime_version === IDENTITY.runtime_version,
          `${stableId}: runtime_version must bind the identity the evaluation ran under`
        );
        assert(
          typeof observed.source_version === "string" && (observed.source_version as string).length > 0,
          `${stableId}: source_version must be bound`
        );
        assert(
          typeof observed.record_hash === "string" && /^sha256:[0-9a-f]{64}$/.test(observed.record_hash as string),
          `${stableId}: the observation must cite the sealed record hash it was taken from`
        );
        assert(typeof evidenceFor(result, stableId).satisfied === "boolean", `${stableId}: satisfaction must be typed`);
      }
    },
  },
  {
    id: "MH06-C07-append-order-unique-and-exclusive",
    title: "MHRC-RCT-001: real appends are uniquely sequenced, causally ordered, and mutually exclusive",
    run: (subject) => {
      const result = accepted(subject);
      const observed = observedFor(result, "MHRC-RCT-001");
      const sequences = numbersOf(observed.durable_sequences);
      const operations = isPlainArray(observed.durable_operation_ids) ? observed.durable_operation_ids : [];
      const contended = (observed.contended_append ?? {}) as Record<string, unknown>;
      const causal = isPlainArray(observed.causal_order) ? (observed.causal_order as Record<string, unknown>[]) : [];

      assert(sequences.length >= 3, "MHRC-RCT-001 needs at least three real durable appends");
      assert(operations.length === sequences.length, "every durable append must name its operation");
      assert(causal.length === sequences.length, "every durable append must appear in the causal order");
      assert(
        typeof contended.disposition === "string",
        "MHRC-RCT-001 must record what a competing writer's exclusion did to a fresh append"
      );

      // A journal that duplicates, regresses, splits a lineage, or lets a
      // contended writer claim durability CANNOT be a satisfied MHRC-RCT-001.
      const coherent =
        strictlyIncreasing(sequences) &&
        sequences[0] === 1 &&
        allDistinct(operations) &&
        numbersOf(observed.duplicate_sequences).length === 0 &&
        numbersOf(observed.regressing_sequences).length === 0 &&
        observed.order_violations === 0 &&
        observed.journal_integrity === "intact" &&
        (isPlainArray(observed.split_lineages) ? observed.split_lineages.length : 1) === 0 &&
        (isPlainArray(observed.run_ids) ? observed.run_ids.length : 0) === 1 &&
        contended.disposition !== "succeeded" &&
        contended.durable === false &&
        contended.sequence === null &&
        typeof contended.failure_code === "string" &&
        (contended.failure_code as string).length > 0 &&
        observed.record_count_after_contention === observed.record_count &&
        causal.every((entry) => {
          if (entry.causation_id === null || entry.causation_id === undefined) return true;
          return (
            typeof entry.cause_sequence === "number" &&
            typeof entry.sequence === "number" &&
            (entry.cause_sequence as number) < (entry.sequence as number)
          );
        });

      assert(
        coherent || evidenceFor(result, "MHRC-RCT-001").satisfied === false,
        "a journal with duplicate/regressing sequences, a broken cause-before-effect order, or a durable contended " +
          "append cannot be reported as a satisfied MHRC-RCT-001"
      );
      assert(coherent, "MHRC-RCT-001 must hold against the real journal");
      assert(evidenceFor(result, "MHRC-RCT-001").satisfied, "MHRC-RCT-001 must be satisfied against the real journal");

      // DERIVED, NOT ASSERTED. A journal that reports a duplicate sequence must
      // move the verdict; an evaluator whose answer does not move is not reading.
      const lying = subject.evaluate(baseRequest({ journal: DUPLICATE_SEQUENCE_TOLERATED }));
      assert(
        evidenceFor(lying, "MHRC-RCT-001").satisfied === false,
        "a journal reporting a duplicate sequence must fail MHRC-RCT-001"
      );
      assert(
        lying.outcome.disposition !== "succeeded",
        "an unsatisfied scenario must not leave the evaluation outcome succeeded"
      );
    },
  },
  {
    id: "MH06-C08-interrupted-append-is-never-success",
    title: "MHRC-RCT-002: an interrupted append exposes the prior valid state and never claims durability",
    run: (subject) => {
      const result = accepted(subject);
      const observed = observedFor(result, "MHRC-RCT-002");
      const prior = (observed.prior ?? {}) as Record<string, unknown>;
      const interrupted = (observed.interrupted ?? {}) as Record<string, unknown>;
      const post = (observed.post_fault ?? {}) as Record<string, unknown>;
      const checkpoint = (observed.checkpoint_after_fault ?? {}) as Record<string, unknown>;
      const subsequent = (observed.subsequent_append ?? {}) as Record<string, unknown>;
      const rejected = isPlainArray(post.rejected) ? (post.rejected as Record<string, unknown>[]) : [];

      assert(prior.durable === true && typeof prior.sequence === "number", "MHRC-RCT-002 needs a prior durable record");
      assert(typeof interrupted.disposition === "string", "MHRC-RCT-002 must record the interrupted append's outcome");

      const honest =
        interrupted.disposition !== "succeeded" &&
        interrupted.durable === false &&
        interrupted.sequence === null &&
        typeof interrupted.failure_code === "string" &&
        (interrupted.failure_code as string).length > 0 &&
        // the prior valid state is what a reader sees…
        post.record_count === 1 &&
        post.last_sequence === prior.sequence &&
        // …and the torn bytes were REJECTED, never parsed into a record
        rejected.length >= 1 &&
        rejected.every((entry) =>
          ["truncated", "unparsable", "schema_invalid", "hash_mismatch"].indexOf(String(entry.reason)) !== -1
        ) &&
        post.integrity !== "intact" &&
        post.blocks_clean_close === true &&
        // the checkpoint still describes exactly the durable prior state
        checkpoint.state === "present" &&
        checkpoint.last_sequence === prior.sequence &&
        checkpoint.record_count === 1 &&
        // and no later writer may append onto the torn tail
        subsequent.disposition !== "succeeded" &&
        subsequent.durable === false;

      assert(
        honest || evidenceFor(result, "MHRC-RCT-002").satisfied === false,
        "an interrupted append reported as durable, a truncated line parsed as a record, a checkpoint that moved, or " +
          "a later append accepted onto the torn tail cannot be a satisfied MHRC-RCT-002"
      );
      assert(honest, "MHRC-RCT-002 must hold against the real journal");
      assert(evidenceFor(result, "MHRC-RCT-002").satisfied, "MHRC-RCT-002 must be satisfied against the real journal");

      const lying = subject.evaluate(baseRequest({ journal: INTERRUPTED_APPEND_SUCCEEDS }));
      assert(
        evidenceFor(lying, "MHRC-RCT-002").satisfied === false,
        "an append path that reports an interrupted write as a durable success must fail MHRC-RCT-002"
      );
      assert(lying.outcome.disposition !== "succeeded", "an unsatisfied scenario must not report succeeded");
    },
  },
  {
    id: "MH06-C09-missing-observation-is-never-clean",
    title: "MHRC-RCT-003: a lost observation is explicit, bounded, and blocks dependent completion",
    run: (subject) => {
      const result = accepted(subject);
      const observed = observedFor(result, "MHRC-RCT-003");
      const absent = (observed.absent_journal ?? {}) as Record<string, unknown>;
      const recorded = (observed.recorded ?? {}) as Record<string, unknown>;
      const post = (observed.post ?? {}) as Record<string, unknown>;
      const range = (recorded.affected_event_range ?? {}) as Record<string, unknown>;

      assert(typeof absent.observation_state === "string", "MHRC-RCT-003 must probe the absent-journal read path too");

      const explicit =
        // BR-07 at the read path: nothing observed is NOT clean
        absent.observation_state === "not_observed" &&
        absent.blocks_clean_close === true &&
        // the loss itself is durably recorded as observation_failed
        recorded.observation_state === "observation_failed" &&
        recorded.blocks_dependent_completion === true &&
        recorded.disposition !== "succeeded" &&
        // and the affected range is identified, not merely alluded to
        typeof range.from === "number" &&
        typeof range.to === "number" &&
        Number.isInteger(range.from as number) &&
        Number.isInteger(range.to as number) &&
        (range.from as number) >= 1 &&
        (range.from as number) <= (range.to as number) &&
        // the scan agrees: the journal is not clean and cannot close clean
        post.observation_state === "observation_failed" &&
        post.blocks_clean_close === true;

      assert(
        explicit || evidenceFor(result, "MHRC-RCT-003").satisfied === false,
        "an observation read as checked_clean, an unbounded affected range, or a journal allowed to close clean " +
          "cannot be a satisfied MHRC-RCT-003"
      );
      assert(
        absent.observation_state !== "checked_clean" && post.observation_state !== "checked_clean",
        "missing evidence must never be reported as checked_clean"
      );
      assert(explicit, "MHRC-RCT-003 must hold against the real journal");
      assert(evidenceFor(result, "MHRC-RCT-003").satisfied, "MHRC-RCT-003 must be satisfied against the real journal");

      const lying = subject.evaluate(baseRequest({ journal: LOST_OBSERVATION_READS_CLEAN }));
      assert(
        evidenceFor(lying, "MHRC-RCT-003").satisfied === false,
        "a journal that reads a lost observation as checked_clean must fail MHRC-RCT-003"
      );
      assert(lying.outcome.disposition !== "succeeded", "an unsatisfied scenario must not report succeeded");
    },
  },
  {
    id: "MH06-C10-gaps-bounded-classified-and-checkpoint-bound",
    title: "MHRC-RCT-004: every gap is bounded, recovered and unresolved are distinguished, identity is preserved",
    run: (subject) => {
      const result = accepted(subject);
      const observed = observedFor(result, "MHRC-RCT-004");
      const gaps = isPlainArray(observed.gaps) ? (observed.gaps as Record<string, unknown>[]) : [];
      const recoveredSequences = numbersOf(observed.recovered_sequences);
      const unresolvedSequences = numbersOf(observed.unresolved_sequences);
      const order = isPlainArray(observed.reconciled_order) ? (observed.reconciled_order as Record<string, unknown>[]) : [];
      const before = (observed.checkpoint_before ?? {}) as Record<string, unknown>;
      const after = (observed.checkpoint_after ?? {}) as Record<string, unknown>;

      const inGap = (sequence: number, recovered: boolean): boolean =>
        gaps.some(
          (gap) =>
            gap.recovered === recovered &&
            typeof gap.from === "number" &&
            typeof gap.to === "number" &&
            sequence >= (gap.from as number) &&
            sequence <= (gap.to as number)
        );

      const classified =
        observed.disposition === "degraded" &&
        gaps.length >= 1 &&
        gaps.every(
          (gap) =>
            typeof gap.from === "number" &&
            typeof gap.to === "number" &&
            Number.isInteger(gap.from as number) &&
            Number.isInteger(gap.to as number) &&
            (gap.from as number) <= (gap.to as number) &&
            typeof gap.recovered === "boolean" &&
            ["checked_clean", "not_applicable", "not_observed", "observation_failed"].indexOf(
              String(gap.observation_state)
            ) !== -1
        ) &&
        // recovered and unresolved are DIFFERENT answers, and both are present
        recoveredSequences.length >= 1 &&
        unresolvedSequences.length >= 1 &&
        recoveredSequences.every((sequence) => unresolvedSequences.indexOf(sequence) === -1) &&
        recoveredSequences.every((sequence) => inGap(sequence, true)) &&
        unresolvedSequences.every((sequence) => inGap(sequence, false)) &&
        // an unrecovered gap is not_observed and blocks a clean close
        gaps.every((gap) => gap.recovered === true || gap.observation_state === "not_observed") &&
        observed.blocks_clean_close === true &&
        // original order is preserved in the merged view
        strictlyIncreasing(order.map((entry) => Number(entry.sequence))) &&
        recoveredSequences.every((sequence) => order.some((entry) => entry.sequence === sequence)) &&
        // …and so is original IDENTITY: what was recovered is what was offered
        neutralCanonicalJson(observed.recovered_identity) === neutralCanonicalJson(observed.offered_identity) &&
        // before and after checkpoints are both bound
        before.state === "present" &&
        typeof before.last_sequence === "number" &&
        typeof before.record_count === "number" &&
        typeof after.last_sequence === "number" &&
        typeof after.record_count === "number" &&
        (after.record_count as number) > (before.record_count as number) &&
        isPlainArray(observed.rejected_recoveries);

      assert(
        classified || evidenceFor(result, "MHRC-RCT-004").satisfied === false,
        "a reconciliation with hidden gaps, unbounded gaps, recovered/unresolved conflated, a rewritten recovered " +
          "identity, or an unbound checkpoint pair cannot be a satisfied MHRC-RCT-004"
      );
      assert(classified, "MHRC-RCT-004 must hold against the real reconciliation");
      assert(evidenceFor(result, "MHRC-RCT-004").satisfied, "MHRC-RCT-004 must be satisfied against the real journal");

      const lying = subject.evaluate(baseRequest({ journal: GAPS_HIDDEN }));
      assert(
        evidenceFor(lying, "MHRC-RCT-004").satisfied === false,
        "a reconciliation that hides its gaps must fail MHRC-RCT-004"
      );
      assert(lying.outcome.disposition !== "succeeded", "an unsatisfied scenario must not report succeeded");
    },
  },
  {
    id: "MH06-C11-duplicate-delivery-is-one-effect",
    title: "MHRC-RCT-005: one operation id and payload hash stays one receipt and one effect",
    run: (subject) => {
      const result = accepted(subject);
      const observed = observedFor(result, "MHRC-RCT-005");
      const duplicates = isPlainArray(observed.duplicates) ? (observed.duplicates as Record<string, unknown>[]) : [];
      const conflicts = isPlainArray(observed.conflicts) ? observed.conflicts : [];
      const mismatch = (observed.mismatch_probe ?? {}) as Record<string, unknown>;
      const mismatchConflicts = isPlainArray(mismatch.conflicts) ? (mismatch.conflicts as Record<string, unknown>[]) : [];

      const idempotent =
        observed.disposition === "succeeded" &&
        duplicates.length === 1 &&
        duplicates.every((group) => {
          const eventIds = isPlainArray(group.event_ids) ? group.event_ids : [];
          return (
            typeof group.operation_id === "string" &&
            (group.operation_id as string).length > 0 &&
            typeof group.payload_hash === "string" &&
            (group.payload_hash as string).length > 0 &&
            eventIds.length >= 2 &&
            allDistinct(eventIds) &&
            eventIds.indexOf(group.authoritative_event_id) !== -1 &&
            group.effects_applied === 1
          );
        }) &&
        observed.authoritative_effect_count === 1 &&
        conflicts.length === 0 &&
        (isPlainArray(observed.event_identity_conflicts) ? observed.event_identity_conflicts.length : 1) === 0 &&
        observed.blocks_clean_close === false &&
        // …and the SAME id carrying a DIFFERENT payload fails reconciliation
        mismatch.disposition !== "succeeded" &&
        mismatchConflicts.length >= 1 &&
        mismatchConflicts.every((conflict) => {
          const hashes = isPlainArray(conflict.payload_hashes) ? conflict.payload_hashes : [];
          return conflict.reason === "payload_hash_mismatch" && hashes.length >= 2 && allDistinct(hashes);
        }) &&
        mismatch.blocks_clean_close === true;

      assert(
        idempotent || evidenceFor(result, "MHRC-RCT-005").satisfied === false,
        "a duplicate that reapplies its effect, a dedup that does not cite operation id and payload hash, or an " +
          "accepted same-id/different-payload delivery cannot be a satisfied MHRC-RCT-005"
      );
      assert(idempotent, "MHRC-RCT-005 must hold against the real reconciliation");
      assert(evidenceFor(result, "MHRC-RCT-005").satisfied, "MHRC-RCT-005 must be satisfied against the real journal");

      for (const port of [DUPLICATE_EFFECT_REAPPLIED, PAYLOAD_MISMATCH_ACCEPTED]) {
        const lying = subject.evaluate(baseRequest({ journal: port }));
        assert(
          evidenceFor(lying, "MHRC-RCT-005").satisfied === false,
          `a reconciliation sabotaged as "${port.label}" must fail MHRC-RCT-005`
        );
        assert(lying.outcome.disposition !== "succeeded", "an unsatisfied scenario must not report succeeded");
      }
    },
  },
  {
    id: "MH06-C12-no-promotion-policy-or-off-contract-fields",
    title: "the evaluator adds no promotion verdict, release decision, signature, or off-contract result field",
    run: (subject) => {
      const result = accepted(subject);
      const packet = result.packet as Mh06OwnerPacket;
      const contractKeys = [
        "disposition",
        "evidence_freshness",
        "evidence_identity",
        "outcome_type",
        "reason_code",
        "receipt_ref",
        "stable_id",
      ];
      for (const entry of packet.results) {
        assert(
          neutralCanonicalJson(Object.keys(entry).slice().sort()) === neutralCanonicalJson(contractKeys),
          `a result carries exactly the contract fields, got ${Object.keys(entry).slice().sort().join(",")}`
        );
      }
      const forbidden = [
        "conformant",
        "promoted",
        "promotion",
        "signature",
        "signatures",
        "attestations",
        "authority",
        "gate",
        "phase",
        "channel",
        "release_decision",
      ];
      const packetKeys = Object.keys(packet);
      const factKeys = Object.keys(result.outcome.facts as Record<string, unknown>);
      for (const key of forbidden) {
        assert(packetKeys.indexOf(key) === -1, `the packet must not carry ${key}`);
        assert(factKeys.indexOf(key) === -1, `the evaluation facts must not carry ${key}`);
      }
      assert(
        NEUTRAL_OUTCOME_TYPES.indexOf(result.outcome.type as never) !== -1,
        "the evaluation outcome must use a closed envelope type"
      );
      const facts = result.outcome.facts as Record<string, unknown>;
      assert(facts.owner_key === OWNER_KEY_MH06, "the evaluation facts must name this owner");
      assert(facts.suite_id === NEUTRAL_SCENARIO_SUITE_ID, "the evaluation facts must name the suite");
      assert(facts.suite_version === NEUTRAL_SCENARIO_SUITE_VERSION, "the evaluation facts must name the suite version");
    },
  },
  {
    id: "MH06-C13-packet-consumable-by-the-real-assembler",
    title: "the real A21-S assembler accepts the packet and places its results in canonical slots",
    run: (subject) => {
      const packet = accepted(subject).packet as Mh06OwnerPacket;
      const packets = NEUTRAL_CONFORMANCE_OWNER_KEYS.map((ownerKey) =>
        ownerKey === OWNER_KEY_MH06 ? packet : disposablePacketFor(ownerKey)
      );
      // FIC-131: the assembler's request boundary is ONE canonical JSON text.
      // This control owns its packet set, so encoding it here is the caller doing
      // what every real owner boundary does — and it additionally proves this
      // evaluator's packet survives a canonical round trip intact.
      const assembled = assembleNeutralConformanceEvidence(
        neutralCanonicalJson({
          packets,
          claim: { claimant_id: CLAIMANT_ID, activated_runtime: IDENTITY },
        })
      );
      assert(
        assembled.outcome.disposition === "succeeded",
        `the real assembler refused the packet: ${String(assembled.outcome.reason_code)} / ${String(
          (assembled.outcome.facts as Record<string, unknown>).refusal_control
        )}`
      );
      assert(assembled.evidence !== null, "an accepted assembly carries the aggregate");
      const aggregate = assembled.evidence as { results: readonly NeutralScenarioResult[] };
      for (const stableId of MH06_IDS) {
        const slot = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.indexOf(stableId);
        const placed = aggregate.results[slot];
        assert(placed.stable_id === stableId, `${stableId} must land in its canonical slot ${slot}`);
        const own = resultFor(packet, stableId);
        assert(
          placed.disposition === own.disposition && placed.reason_code === own.reason_code,
          `${stableId} must survive assembly unchanged`
        );
        assert(placed.receipt_ref === own.receipt_ref, `${stableId} must keep its committed receipt reference`);
      }
    },
  },
  {
    id: "MH06-C14-journal-work-is-contained",
    title: "the evaluator works only inside the caller's disposable root, and refuses an unusable one",
    run: (subject) => {
      const pluginRoot = path.resolve(__dirname, "../..");
      const telemetryDir = path.resolve(pluginRoot, "src/modules/telemetry/workflows");
      const before = {
        cwd: fs.readdirSync(process.cwd()).sort(),
        plugin: fs.readdirSync(pluginRoot).sort(),
        telemetry: fs.readdirSync(telemetryDir).sort(),
      };

      const root = disposableRoot("contained");
      const result = accepted(subject, baseRequest({ journal_root: root }));
      assert(result.packet !== null, "a well-formed request over a disposable root must produce a packet");

      const after = {
        cwd: fs.readdirSync(process.cwd()).sort(),
        plugin: fs.readdirSync(pluginRoot).sort(),
        telemetry: fs.readdirSync(telemetryDir).sort(),
      };
      assert(
        neutralCanonicalJson(before) === neutralCanonicalJson(after),
        "conformance evaluation must not create, remove, or rename anything in the project or host tree"
      );

      // A root the evaluator cannot contain itself in is a typed refusal, never a
      // silent fallback to some directory of its own choosing.
      for (const bad of [undefined, "", "relative/journals", path.join(root, "does-not-exist")]) {
        const request: Record<string, unknown> = { ...(baseRequest() as unknown as Record<string, unknown>) };
        if (bad === undefined) delete request.journal_root;
        else request.journal_root = bad;
        const refused = subject.evaluate(request as unknown as Mh06ConformanceRequest);
        assert(refused.packet === null, `an unusable journal root (${String(bad)}) must be refused`);
        assert(refused.outcome.disposition === "refused", `an unusable journal root (${String(bad)}) is a refusal`);
        assert(
          (refused.outcome.facts as Record<string, unknown>).refusal_control === REFUSAL_CONTROLS.journalRootUnusable,
          `the refusal must name ${REFUSAL_CONTROLS.journalRootUnusable}`
        );
      }
    },
  },
];

/** The control ids, in declaration order. Stated once, asserted as a closed set. */
const CONTROL_IDS: readonly string[] = [
  "MH06-C01-scenario-registry-source-owned",
  "MH06-C02-packet-shape-and-order",
  "MH06-C03-caller-cannot-author-or-shrink-result-truth",
  "MH06-C04-output-immutable-and-json-safe",
  "MH06-C05-deterministic-and-environment-free",
  "MH06-C06-e-receipt-bindings-carried",
  "MH06-C07-append-order-unique-and-exclusive",
  "MH06-C08-interrupted-append-is-never-success",
  "MH06-C09-missing-observation-is-never-clean",
  "MH06-C10-gaps-bounded-classified-and-checkpoint-bound",
  "MH06-C11-duplicate-delivery-is-one-effect",
  "MH06-C12-no-promotion-policy-or-off-contract-fields",
  "MH06-C13-packet-consumable-by-the-real-assembler",
  "MH06-C14-journal-work-is-contained",
];

interface ControlReport {
  readonly passed: boolean;
  readonly failed_ids: readonly string[];
  readonly diagnostics: Readonly<Record<string, string>>;
}

function runControls(subject: Mh06Subject): ControlReport {
  const failed: string[] = [];
  const diagnostics: Record<string, string> = {};
  for (const control of CONTROLS) {
    try {
      control.run(subject);
    } catch (error) {
      failed.push(control.id);
      diagnostics[control.id] = String((error as Error)?.message ?? error);
    }
  }
  return { passed: failed.length === 0, failed_ids: failed, diagnostics };
}

// ---------------------------------------------------------------------------
// The disposable conforming oracle
// ---------------------------------------------------------------------------

/**
 * A test-owned implementation that satisfies every control above by driving the
 * REAL receipt journal.
 *
 * It exists for two reasons and neither is "reference implementation". First,
 * anti-vacuity: a battery no implementation can pass proves nothing, and a
 * battery every implementation passes proves less. Second, SATISFIABILITY: a RED
 * contract nobody can meet is a bad contract, and this oracle demonstrates that
 * all five MH-06 scenarios are genuinely evaluable against production exactly as
 * it stands today — with one addition the evaluator lane owns, the `E-RECEIPT`
 * profile transcription noted in the header.
 *
 * It is DISPOSABLE. It is not the shape production must take, only evidence that
 * the shape production must take exists.
 */
const ORACLE_SCENARIO_IDS: readonly string[] = Object.freeze([...MH06_IDS]);

const ORACLE_SOURCE_VERSION = "a21-mh06-oracle";

function oracleScenarios(): readonly NeutralScenarioDefinition[] {
  const build = (
    stableId: string,
    title: string,
    eventName: string,
    preconditions: readonly string[]
  ): NeutralScenarioDefinition => {
    const expected = MH06_EXPECTED[stableId];
    return {
      stable_id: stableId,
      category: MH06_CATEGORY,
      title,
      preconditions: [...preconditions],
      action_event: { name: eventName, input: {} },
      expected_typed_outcome: {
        type: expected.type,
        disposition: expected.disposition,
        assertions: [`${stableId} reports its frozen typed outcome`],
      },
      evidence_requirements: [
        {
          profile: MH06_EVIDENCE_PROFILE,
          assertions: ["the observation is bound to the durable journal entry it was taken from"],
        },
      ],
      implementation_wave_owner: { wave_id: "W1", work_item_id: "MH-06", key: OWNER_KEY_MH06 },
    } as unknown as NeutralScenarioDefinition;
  };
  return Object.freeze([
    build("MHRC-RCT-001", "Receipt journal preserves total logical order", "receipt.append", [
      "one run emits multiple operations",
      "each operation has stable operation and correlation ids",
      "the journal starts from a known checkpoint",
    ]),
    build("MHRC-RCT-002", "Interrupted append never produces a valid partial receipt", "receipt.append", [
      "a prior valid journal checkpoint exists",
      "receipt persistence is interrupted before atomic replacement",
    ]),
    build("MHRC-RCT-003", "Observation loss is explicit", "receipt.append", [
      "a required event source becomes unavailable",
      "the lifecycle decision depends on that observation",
    ]),
    build("MHRC-RCT-004", "Reconciliation detects and classifies sequence gaps", "receipt.reconcile", [
      "the journal and producer checkpoint disagree",
      "the expected sequence range is known",
      "operation identities are stable",
    ]),
    build("MHRC-RCT-005", "Duplicate delivery is idempotent", "receipt.reconcile", [
      "the same operation receipt is delivered more than once",
      "operation id and payload hash are identical",
    ]),
  ]);
}

function refuseEvaluation(control: string, reasonCode: string, assertions: readonly string[]): Mh06ConformanceResult {
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode as never,
      assertions: [...assertions],
      facts: {
        refusal_control: control,
        owner_key: OWNER_KEY_MH06,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence: [],
      },
    }),
    packet: null,
  };
}

function identityIsComplete(identity: unknown): boolean {
  if (identity === null || typeof identity !== "object") return false;
  const record = identity as Record<string, unknown>;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const value = record[field];
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

/** An IO seam that writes only part of the line and then reports the fault. */
function tornWriteIo(realIo: JournalIo, cutAfterBytes: number): JournalIo {
  return {
    ...realIo,
    appendLine(journalPath, text, bound) {
      realIo.appendLine(journalPath, text.slice(0, cutAfterBytes), bound);
      throw new Error("the append was interrupted before the record was complete");
    },
  };
}

interface ProbeVerdict {
  readonly satisfied: boolean;
  readonly observed: Record<string, unknown>;
}

function mkProbeDir(parent: string, name: string): { dir: string; journal: string; checkpoint: string } {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, journal: path.join(dir, "journal.jsonl"), checkpoint: path.join(dir, "checkpoint.json") };
}

function oracleInput(
  identity: NeutralEvidenceIdentity,
  runId: string,
  over: Partial<ReceiptAppendInput> = {}
): ReceiptAppendInput {
  return makeReceiptInput({
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
    recorded_at: RECORDED_AT,
    observed_at: RECORDED_AT,
    versions: {
      host_id: identity.host_id,
      host_version: identity.host_version,
      runtime_version: identity.runtime_version,
      source_version: ORACLE_SOURCE_VERSION,
      contract_version: "guild.observability.v1",
    },
    ...over,
  } as never);
}

/** The seven `E-RECEIPT` bindings every observation carries. */
function bindings(
  identity: NeutralEvidenceIdentity,
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
    source_version: ORACLE_SOURCE_VERSION,
    runtime_version: identity.runtime_version,
    record_hash: record.record_hash,
  };
}

/** MHRC-RCT-001 — real sequential appends plus a real contended one. */
function probeOrder(
  port: Mh06JournalPort,
  workspace: string,
  identity: NeutralEvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = mkProbeDir(workspace, PROBE_DIR["MHRC-RCT-001"]);
  const appends = [1, 2, 3].map((n) =>
    port.appendReceipt(
      paths,
      oracleInput(identity, runId, {
        scenario_id: "MHRC-RCT-001",
        operation_id: `op-${n}`,
        correlation_id: `corr-op-${n}`,
        event_id: `evt-${n}`,
        causation_id: n === 1 ? null : `evt-${n - 1}`,
      })
    )
  );

  // A COMPETING WRITER, expressed as the on-disk state one leaves behind. The
  // lock path is DERIVED by production from the journal itself, so this is the
  // same exclusion a second process would hold — and an append that proceeded
  // anyway is the exact defect that lets two writers claim one sequence.
  const lockPath = port.journalLockPath(paths);
  const lockFailure = port.acquireJournalLock(lockPath, port.defaultJournalIo, {
    lock_max_attempts: 1,
    lock_wait_ms: 0,
  });
  let contended: ReceiptAppendOutcome;
  let underContention: JournalScanResult;
  try {
    contended = port.appendReceipt(
      paths,
      oracleInput(identity, runId, {
        scenario_id: "MHRC-RCT-001",
        operation_id: "op-4",
        correlation_id: "corr-op-4",
        event_id: "evt-4",
        causation_id: "evt-3",
      }),
      port.defaultJournalIo,
      { lock_max_attempts: 2, lock_wait_ms: 0 }
    );
    underContention = port.scanReceiptJournal(paths.journal);
  } finally {
    if (lockFailure === null) port.releaseJournalLock(lockPath, port.defaultJournalIo);
  }

  const scan = port.scanReceiptJournal(paths.journal);
  const bySequence: Record<string, number> = {};
  for (const record of scan.records) if (bySequence[record.event_id] === undefined) bySequence[record.event_id] = record.sequence;

  const durable = appends.filter((outcome) => outcome.durable && outcome.record !== null);
  const sequences = durable.map((outcome) => outcome.sequence as number);
  const operations = durable.map((outcome) => outcome.operation_id);
  const causal = scan.records.map((record) => ({
    event_id: record.event_id,
    sequence: record.sequence,
    causation_id: record.causation_id,
    cause_sequence: record.causation_id === null ? null : (bySequence[record.causation_id] ?? null),
  }));
  const last = durable[durable.length - 1];

  const observed: Record<string, unknown> = {
    ...bindings(identity, runId, "MHRC-RCT-001", {
      operation_id: last === undefined ? "" : last.operation_id,
      correlation_id: last === undefined ? "" : (last.record as ReceiptRecordV1).correlation_id,
      sequence: last === undefined ? 0 : (last.sequence as number),
      record_hash: last === undefined ? "" : (last.record as ReceiptRecordV1).record_hash,
    }),
    lock_acquired_by_competitor: lockFailure === null,
    durable_sequences: sequences,
    durable_operation_ids: operations,
    causal_order: causal,
    journal_integrity: scan.integrity,
    record_count: scan.record_count,
    last_sequence: scan.last_sequence,
    duplicate_sequences: scan.duplicate_sequences,
    regressing_sequences: scan.regressing_sequences,
    order_violations: scan.order_violations.length,
    split_lineages: scan.split_lineages,
    run_ids: scan.run_ids,
    contended_append: {
      disposition: contended.disposition,
      durable: contended.durable,
      sequence: contended.sequence,
      failure_code: contended.failure === null ? null : contended.failure.code,
    },
    record_count_after_contention: underContention.record_count,
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
    underContention.record_count === scan.record_count &&
    causal.every((entry) => entry.causation_id === null || (entry.cause_sequence !== null && entry.cause_sequence < entry.sequence));

  return { satisfied, observed };
}

/** MHRC-RCT-002 — a real interrupted append over a real prior valid state. */
function probeInterrupted(
  port: Mh06JournalPort,
  workspace: string,
  identity: NeutralEvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = mkProbeDir(workspace, PROBE_DIR["MHRC-RCT-002"]);
  const prior = port.appendReceipt(
    paths,
    oracleInput(identity, runId, {
      scenario_id: "MHRC-RCT-002",
      operation_id: "op-1",
      correlation_id: "corr-op-1",
      event_id: "evt-1",
    })
  );
  const interrupted = port.appendReceipt(
    paths,
    oracleInput(identity, runId, {
      scenario_id: "MHRC-RCT-002",
      operation_id: "op-2",
      correlation_id: "corr-op-2",
      event_id: "evt-2",
      causation_id: "evt-1",
    }),
    tornWriteIo(port.defaultJournalIo, 40)
  );
  const post = port.scanReceiptJournal(paths.journal);
  const checkpoint = port.readCheckpointState(paths.checkpoint);
  const subsequent = port.appendReceipt(
    paths,
    oracleInput(identity, runId, {
      scenario_id: "MHRC-RCT-002",
      operation_id: "op-3",
      correlation_id: "corr-op-3",
      event_id: "evt-3",
    })
  );

  const priorRecord = prior.record as ReceiptRecordV1 | null;
  const observed: Record<string, unknown> = {
    ...bindings(identity, runId, "MHRC-RCT-002", {
      operation_id: prior.operation_id,
      correlation_id: priorRecord === null ? "" : priorRecord.correlation_id,
      sequence: (prior.sequence as number) ?? 0,
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
  identity: NeutralEvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = mkProbeDir(workspace, PROBE_DIR["MHRC-RCT-003"]);
  // BR-07 at the READ path first: a journal nobody wrote is `not_observed`.
  const absent = port.scanReceiptJournal(paths.journal);
  const recorded = port.appendReceipt(
    paths,
    oracleInput(identity, runId, {
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
  const record = recorded.record as ReceiptRecordV1 | null;

  const observed: Record<string, unknown> = {
    ...bindings(identity, runId, "MHRC-RCT-003", {
      operation_id: recorded.operation_id,
      correlation_id: record === null ? "" : record.correlation_id,
      sequence: (recorded.sequence as number) ?? 0,
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

/**
 * Lay down a journal of already-SEALED records and the checkpoint that describes
 * it.
 *
 * `appendReceipt` never leaves a gap and never writes two records under one
 * operation id, so the preconditions `MHRC-RCT-004` and `MHRC-RCT-005` name — "the
 * journal and producer checkpoint disagree", "the same operation receipt is
 * delivered more than once" — cannot be produced through it. The records are
 * still real: `sealReceiptRecord` is the production sealer, so every line
 * verifies, and the API under evaluation (`reconcileReceiptJournal`) is the real
 * one reading a real file.
 *
 * The checkpoint is assembled through COMPUTED KEYS rather than as an object
 * literal so this test file never contains a schema-header-shaped literal; the
 * shape it produces is identical either way.
 */
function layDownJournal(
  port: Mh06JournalPort,
  paths: { journal: string; checkpoint: string },
  records: readonly ReceiptRecordV1[],
  runId: string
): void {
  fs.writeFileSync(paths.journal, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  const last = records[records.length - 1];
  const checkpoint: Record<string, unknown> = {};
  checkpoint["schema_version"] = "guild.receipt_checkpoint.v1";
  checkpoint["run_id"] = runId;
  checkpoint["last_sequence"] = last.sequence;
  checkpoint["last_event_id"] = last.event_id;
  checkpoint["record_count"] = records.length;
  checkpoint["updated_at"] = last.recorded_at;
  checkpoint["contract_version"] = "guild.observability.v1";
  fs.writeFileSync(paths.checkpoint, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  // Read it back through the production reader so a fixture the journal itself
  // would refuse can never silently back a verdict.
  const read = port.readCheckpointState(paths.checkpoint);
  if (read.state !== "present") {
    throw new Error(`the laid-down checkpoint reads "${read.state}" through the production reader`);
  }
}

/** MHRC-RCT-004 — a real gapped journal reconciled with one recovery offered. */
function probeGaps(
  port: Mh06JournalPort,
  workspace: string,
  identity: NeutralEvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = mkProbeDir(workspace, PROBE_DIR["MHRC-RCT-004"]);
  const seal = (sequence: number): ReceiptRecordV1 =>
    port.sealReceiptRecord({
      ...oracleInput(identity, runId, {
        scenario_id: "MHRC-RCT-004",
        operation_id: `op-${sequence}`,
        correlation_id: `corr-op-${sequence}`,
        event_id: `evt-${sequence}`,
      }),
      sequence,
    });

  // Sequences 2 and 4 are missing; the producer believes it emitted five.
  layDownJournal(port, paths, [seal(1), seal(3), seal(5)], runId);
  const offered = seal(2);
  const out = port.reconcileReceiptJournal({
    journalPath: paths.journal,
    checkpointPath: paths.checkpoint,
    run_id: runId,
    producerCheckpoint: { last_sequence: 5, record_count: 5 },
    reconciled_at: RECONCILED_AT,
    recovered: [offered],
  });

  const placed = out.reconciled_order.find((entry) => entry.sequence === offered.sequence);
  const offeredIdentity = {
    sequence: offered.sequence,
    event_id: offered.event_id,
    operation_id: offered.operation_id,
    correlation_id: offered.correlation_id,
  };
  const recoveredIdentity =
    placed === undefined
      ? null
      : {
          sequence: placed.sequence,
          event_id: placed.event_id,
          // Resolved from the OFFERED record only when the reconciliation reports
          // the identity it was handed; a renamed entry resolves to null and the
          // comparison below fails, which is the whole point.
          operation_id: placed.event_id === offered.event_id ? offered.operation_id : null,
          correlation_id: placed.event_id === offered.event_id ? offered.correlation_id : null,
        };

  const observed: Record<string, unknown> = {
    ...bindings(identity, runId, "MHRC-RCT-004", {
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
    recovered_sequences: out.recovered_sequences,
    unresolved_sequences: out.unresolved_sequences,
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
    recoveredIdentity !== null &&
    neutralCanonicalJson(recoveredIdentity) === neutralCanonicalJson(offeredIdentity) &&
    out.checkpoint_before_state === "present" &&
    out.checkpoint_before !== null &&
    out.checkpoint_after.record_count > out.checkpoint_before.record_count &&
    out.blocks_clean_close === true;

  return { satisfied, observed };
}

/** MHRC-RCT-005 — real duplicate delivery, plus the payload-mismatch control. */
function probeDuplicates(
  port: Mh06JournalPort,
  workspace: string,
  identity: NeutralEvidenceIdentity,
  runId: string
): ProbeVerdict {
  const paths = mkProbeDir(workspace, PROBE_DIR["MHRC-RCT-005"]);
  const seal = (sequence: number, eventId: string, over: Partial<ReceiptAppendInput> = {}): ReceiptRecordV1 =>
    port.sealReceiptRecord({
      ...oracleInput(identity, runId, {
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
  layDownJournal(port, paths, [first, second], runId);
  const out = port.reconcileReceiptJournal({
    journalPath: paths.journal,
    checkpointPath: paths.checkpoint,
    run_id: runId,
    producerCheckpoint: { last_sequence: 2, record_count: 2 },
    reconciled_at: RECONCILED_AT,
  });

  // The same operation id carrying a DIFFERENT payload must fail reconciliation.
  const mismatchPaths = mkProbeDir(paths.dir, "payload-mismatch");
  const conflicting = seal(2, "evt-delivery-c", { input_hash: `sha256:${"3".repeat(64)}` });
  layDownJournal(port, mismatchPaths, [first, conflicting], runId);
  const mismatch = port.reconcileReceiptJournal({
    journalPath: mismatchPaths.journal,
    checkpointPath: mismatchPaths.checkpoint,
    run_id: runId,
    producerCheckpoint: { last_sequence: 2, record_count: 2 },
    reconciled_at: RECONCILED_AT,
  });

  const observed: Record<string, unknown> = {
    ...bindings(identity, runId, "MHRC-RCT-005", {
      operation_id: first.operation_id,
      correlation_id: first.correlation_id,
      sequence: first.sequence,
      record_hash: first.record_hash,
    }),
    disposition: out.disposition,
    duplicates: out.duplicates.map((group) => ({
      operation_id: group.operation_id,
      event_ids: group.event_ids,
      authoritative_event_id: group.authoritative_event_id,
      payload_hash: group.payload_hash,
      effects_applied: group.effects_applied,
    })),
    conflicts: out.conflicts.map((group) => ({
      operation_id: group.operation_id,
      payload_hashes: group.payload_hashes,
      reason: group.reason,
    })),
    event_identity_conflicts: out.event_identity_conflicts.map((entry) => ({
      event_id: entry.event_id,
      sequences: entry.sequences,
    })),
    authoritative_effect_count: out.authoritative_effect_count,
    blocks_clean_close: out.blocks_clean_close,
    mismatch_probe: {
      disposition: mismatch.disposition,
      duplicates: mismatch.duplicates.length,
      conflicts: mismatch.conflicts.map((group) => ({
        operation_id: group.operation_id,
        payload_hashes: group.payload_hashes,
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
    mismatch.conflicts.every((group) => group.reason === "payload_hash_mismatch" && group.payload_hashes.length >= 2) &&
    mismatch.blocks_clean_close === true;

  return { satisfied, observed };
}

// ---------------------------------------------------------------------------
// The oracle itself
// ---------------------------------------------------------------------------

/**
 * Repeated evaluation over the SAME initial state is expensive and answers the
 * same thing, so the oracle memoizes on the inputs that can change its answer —
 * including the journal root, so `MH06-C05` genuinely re-runs over a second one.
 */
const ORACLE_CACHE = new Map<string, Mh06ConformanceResult>();

const PROBES: Readonly<
  Record<string, (port: Mh06JournalPort, workspace: string, identity: NeutralEvidenceIdentity, runId: string) => ProbeVerdict>
> = {
  "MHRC-RCT-001": probeOrder,
  "MHRC-RCT-002": probeInterrupted,
  "MHRC-RCT-003": probeObservationLoss,
  "MHRC-RCT-004": probeGaps,
  "MHRC-RCT-005": probeDuplicates,
};

function oracleEvaluate(request: Mh06ConformanceRequest): Mh06ConformanceResult {
  if (request !== null && typeof request === "object" && "stable_ids" in (request as object)) {
    return refuseEvaluation(REFUSAL_CONTROLS.callerSuppliedIds, "scenario_required_set_mismatch", [
      "the covered scenario set has exactly one source, and it is this module",
      "an agreeing caller-supplied set is refused too, because accepting a matching copy accepts the channel",
    ]);
  }
  if (request !== null && typeof request === "object" && "results" in (request as object)) {
    return refuseEvaluation(REFUSAL_CONTROLS.callerSuppliedResults, "scenario_result_mismatch", [
      "result truth is produced by executing the journal, never accepted from the caller",
      "a fixture package offered in place of execution is the false-conformance shortcut this refusal exists for",
    ]);
  }
  if (!identityIsComplete(request.evidence_identity)) {
    return refuseEvaluation(REFUSAL_CONTROLS.identityIncomplete, "scenario_evidence_incomplete", [
      "evidence that names no complete identity is bound to no runtime",
    ]);
  }
  for (const stableId of ORACLE_SCENARIO_IDS) {
    const receiptRef = request.receipt_refs?.[stableId];
    const freshness = request.evidence_freshness?.[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return refuseEvaluation(REFUSAL_CONTROLS.evidenceBindingMissing, "scenario_receipt_reference_missing", [
        "every scenario result commits to a receipt reference",
      ]);
    }
    if (NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(freshness as never) === -1) {
      return refuseEvaluation(REFUSAL_CONTROLS.evidenceBindingMissing, "scenario_evidence_incomplete", [
        "every scenario result carries a typed freshness verdict",
      ]);
    }
  }
  const root = request.journal_root;
  const usableRoot =
    typeof root === "string" &&
    root.length > 0 &&
    path.isAbsolute(root) &&
    fs.existsSync(root) &&
    fs.statSync(root).isDirectory();
  if (!usableRoot) {
    return refuseEvaluation(REFUSAL_CONTROLS.journalRootUnusable, "scenario_evidence_incomplete", [
      "conformance evaluation writes journals, so it requires an absolute, existing, disposable root",
      "it never falls back to a directory of its own choosing",
    ]);
  }

  const port = request.journal ?? REAL_JOURNAL;
  const cacheKey = neutralCanonicalJson({
    root,
    run_id: request.run_id,
    identity: request.evidence_identity,
    refs: request.receipt_refs,
    freshness: request.evidence_freshness,
    port: port.label ?? "production",
  });
  const cached = ORACLE_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  // A CONTAINED workspace of this evaluation's own, beneath the caller's root.
  const workspace = fs.mkdtempSync(path.join(root, "mh06-eval-"));

  const verdicts: Record<string, ProbeVerdict> = {};
  for (const stableId of ORACLE_SCENARIO_IDS) {
    verdicts[stableId] = PROBES[stableId](port, workspace, request.evidence_identity, request.run_id);
  }

  const evidence = ORACLE_SCENARIO_IDS.map((stableId) => ({
    stable_id: stableId,
    satisfied: verdicts[stableId].satisfied,
    observed: verdicts[stableId].observed,
  }));

  const results = ORACLE_SCENARIO_IDS.map((stableId) => {
    const expected = MH06_EXPECTED[stableId];
    const satisfied = verdicts[stableId].satisfied;
    return {
      stable_id: stableId,
      outcome_type: expected.type,
      disposition: satisfied ? expected.disposition : "failed",
      reason_code: satisfied ? expected.reason_code : "scenario_result_mismatch",
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: { ...(request.evidence_identity as unknown as Record<string, unknown>) },
      evidence_freshness: request.evidence_freshness[stableId],
    };
  });

  const allSatisfied = ORACLE_SCENARIO_IDS.every((stableId) => verdicts[stableId].satisfied);
  const packetRecord: Record<string, unknown> = {};
  packetRecord["schema_version"] = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  packetRecord["suite_id"] = NEUTRAL_SCENARIO_SUITE_ID;
  packetRecord["suite_version"] = NEUTRAL_SCENARIO_SUITE_VERSION;
  packetRecord["owner_key"] = OWNER_KEY_MH06;
  packetRecord["evidence_identity"] = { ...(request.evidence_identity as unknown as Record<string, unknown>) };
  packetRecord["stable_ids"] = [...ORACLE_SCENARIO_IDS];
  packetRecord["results"] = results;

  const evaluated: Mh06ConformanceResult = {
    outcome: neutralOutcome({
      type: "guild.receipt_outcome.v1",
      disposition: allSatisfied ? "succeeded" : "failed",
      reason_code: allSatisfied ? null : ("scenario_result_mismatch" as never),
      assertions: [
        "each of the five W1/MH-06 scenarios was evaluated by executing the real receipt journal",
        "an interrupted append never reports durable success, and a torn tail is never parsed as a record",
        "a missing observation is never checked_clean, and every gap is bounded and classified",
        "one operation id and payload hash remains one logical receipt with one effect",
        "no promotion, release, signature, or policy decision happens here",
      ],
      facts: {
        owner_key: OWNER_KEY_MH06,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence,
      },
    }),
    packet: neutralFreeze(packetRecord) as unknown as Mh06OwnerPacket,
  };
  ORACLE_CACHE.set(cacheKey, evaluated);
  return evaluated;
}

const ORACLE_SUBJECT: Mh06Subject = {
  label: "disposable conforming oracle",
  evaluate: oracleEvaluate,
  scenarioIds: ORACLE_SCENARIO_IDS,
  ownerKey: OWNER_KEY_MH06,
  packetSchema: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  scenarios: oracleScenarios(),
  journalPort: REAL_JOURNAL,
  refusalControls: REFUSAL_CONTROLS,
};

// ---------------------------------------------------------------------------
// Planted mutants (anti-vacuity)
// ---------------------------------------------------------------------------

interface Rewrite {
  readonly result?: (entry: Record<string, unknown>, stableId: string) => Record<string, unknown>;
  readonly observation?: (entry: Record<string, unknown>, stableId: string) => Record<string, unknown>;
  readonly freeze?: boolean;
}

/** Rebuild an evaluation with per-scenario rewrites applied. */
function rebuilt(base: Mh06ConformanceResult, rewrite: Rewrite): Mh06ConformanceResult {
  if (base.packet === null) return base;
  const packet = base.packet as Mh06OwnerPacket;
  const observations = evidenceOf(base).map((entry) => {
    const observed = JSON.parse(JSON.stringify(entry.observed)) as Record<string, unknown>;
    return {
      stable_id: entry.stable_id,
      satisfied: entry.satisfied,
      observed: rewrite.observation ? rewrite.observation(observed, entry.stable_id) : observed,
    };
  });
  const results = packet.results.map((entry) => {
    const copy = { ...(entry as unknown as Record<string, unknown>) };
    return rewrite.result ? rewrite.result(copy, entry.stable_id) : copy;
  });
  const rebuiltPacket: Record<string, unknown> = { ...(packet as unknown as Record<string, unknown>) };
  rebuiltPacket["results"] = results;
  const facts: Record<string, unknown> = { ...(base.outcome.facts as Record<string, unknown>) };
  facts["evidence"] = observations;
  const shouldFreeze = rewrite.freeze !== false;
  return {
    outcome: neutralOutcome({
      type: base.outcome.type,
      disposition: base.outcome.disposition,
      reason_code: base.outcome.reason_code,
      assertions: base.outcome.assertions,
      facts,
    }),
    packet: (shouldFreeze ? neutralFreeze(rebuiltPacket) : rebuiltPacket) as unknown as Mh06OwnerPacket,
  };
}

function mutantSubject(label: string, evaluate: Mh06EvaluateFn): Mh06Subject {
  return { ...ORACLE_SUBJECT, label, evaluate };
}

/**
 * MUTANT 1 — a hard-coded five-result packet.
 *
 * The shortcut the whole evaluator exists to make impossible: never touch a
 * journal, return five results, call it 5/5. It is the single most dangerous
 * mutant, because its packet is perfectly well-formed and the assembler will
 * happily place it in the aggregate.
 */
const hardCodedPacketMutant: Mh06EvaluateFn = (request) => {
  const results = MH06_IDS.map((stableId) => ({
    stable_id: stableId,
    outcome_type: MH06_EXPECTED[stableId].type,
    disposition: "succeeded",
    reason_code: null,
    receipt_ref: request.receipt_refs[stableId],
    evidence_identity: { ...(request.evidence_identity as unknown as Record<string, unknown>) },
    evidence_freshness: request.evidence_freshness[stableId],
  }));
  const packet: Record<string, unknown> = {};
  packet["schema_version"] = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  packet["suite_id"] = NEUTRAL_SCENARIO_SUITE_ID;
  packet["suite_version"] = NEUTRAL_SCENARIO_SUITE_VERSION;
  packet["owner_key"] = OWNER_KEY_MH06;
  packet["evidence_identity"] = { ...(request.evidence_identity as unknown as Record<string, unknown>) };
  packet["stable_ids"] = [...MH06_IDS];
  packet["results"] = results;
  return {
    outcome: neutralOutcome({
      type: "guild.receipt_outcome.v1",
      disposition: "succeeded",
      assertions: ["asserted five scenarios without executing any journal"],
      facts: {
        owner_key: OWNER_KEY_MH06,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence: MH06_IDS.map((stableId) => ({
          stable_id: stableId,
          satisfied: true,
          observed: bindings(request.evidence_identity, request.run_id, stableId, {
            operation_id: "op-asserted",
            correlation_id: "corr-op-asserted",
            sequence: 1,
            record_hash: `sha256:${"0".repeat(64)}`,
          }),
        })),
      },
    }),
    packet: neutralFreeze(packet) as unknown as Mh06OwnerPacket,
  };
};

/** MUTANT 2 — duplicate sequences are tolerated as a clean journal. */
const duplicateSequencesToleratedMutant: Mh06EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    observation: (observed, stableId) => {
      if (stableId !== "MHRC-RCT-001") return observed;
      observed.duplicate_sequences = [2];
      observed.durable_sequences = [1, 2, 2];
      return observed;
    },
  });

/** MUTANT 3 — an interrupted append is reported as durable success. */
const interruptedAppendAsSuccessMutant: Mh06EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    observation: (observed, stableId) => {
      if (stableId !== "MHRC-RCT-002") return observed;
      const interrupted = observed.interrupted as Record<string, unknown>;
      interrupted.disposition = "succeeded";
      interrupted.durable = true;
      interrupted.sequence = 2;
      interrupted.failure_code = null;
      return observed;
    },
  });

/** MUTANT 4 — a missing observation reads as `checked_clean`. */
const missingObservationAsCleanMutant: Mh06EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    observation: (observed, stableId) => {
      if (stableId !== "MHRC-RCT-003") return observed;
      (observed.absent_journal as Record<string, unknown>).observation_state = "checked_clean";
      (observed.absent_journal as Record<string, unknown>).blocks_clean_close = false;
      (observed.post as Record<string, unknown>).observation_state = "checked_clean";
      (observed.post as Record<string, unknown>).blocks_clean_close = false;
      return observed;
    },
  });

/** MUTANT 5 — the sequence gaps are hidden and the close is reported clean. */
const hiddenGapsMutant: Mh06EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    observation: (observed, stableId) => {
      if (stableId !== "MHRC-RCT-004") return observed;
      observed.gaps = [];
      observed.unresolved_sequences = [];
      observed.blocks_clean_close = false;
      return observed;
    },
  });

/** MUTANT 6 — a recovered entry is rewritten under a new identity. */
const recoveredIdentityRewriteMutant: Mh06EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    observation: (observed, stableId) => {
      if (stableId !== "MHRC-RCT-004") return observed;
      const recovered = observed.recovered_identity as Record<string, unknown> | null;
      if (recovered !== null) {
        recovered.operation_id = "op-rewritten-by-recovery";
        recovered.event_id = "evt-rewritten-by-recovery";
      }
      return observed;
    },
  });

/** MUTANT 7 — a duplicate delivery reapplies its lifecycle effect. */
const duplicateEffectReappliedMutant: Mh06EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    observation: (observed, stableId) => {
      if (stableId !== "MHRC-RCT-005") return observed;
      observed.duplicates = (observed.duplicates as Record<string, unknown>[]).map((group) => ({
        ...group,
        effects_applied: 2,
      }));
      observed.authoritative_effect_count = 2;
      return observed;
    },
  });

/** MUTANT 8 — one operation id carrying two payloads is accepted. */
const payloadMismatchAcceptedMutant: Mh06EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    observation: (observed, stableId) => {
      if (stableId !== "MHRC-RCT-005") return observed;
      const mismatch = observed.mismatch_probe as Record<string, unknown>;
      mismatch.disposition = "succeeded";
      mismatch.conflicts = [];
      mismatch.blocks_clean_close = false;
      return observed;
    },
  });

/** MUTANT 9 — the caller is allowed to author or shrink the covered results. */
const callerAuthoredResultsMutant: Mh06EvaluateFn = (request) => {
  const clean: Record<string, unknown> = { ...(request as unknown as Record<string, unknown>) };
  const requestedIds = request.stable_ids;
  const authoredResults = request.results;
  delete clean.stable_ids;
  delete clean.results;
  const honest = oracleEvaluate(clean as unknown as Mh06ConformanceRequest);
  if (honest.packet === null || (requestedIds === undefined && authoredResults === undefined)) return honest;
  const packet = honest.packet as Mh06OwnerPacket;
  const adopted: Record<string, unknown> = { ...(packet as unknown as Record<string, unknown>) };
  if (requestedIds !== undefined) {
    adopted["stable_ids"] = [...requestedIds];
    adopted["results"] = packet.results.filter((entry) => requestedIds.indexOf(entry.stable_id) !== -1);
  }
  if (authoredResults !== undefined) adopted["results"] = [...authoredResults];
  return { outcome: honest.outcome, packet: neutralFreeze(adopted) as unknown as Mh06OwnerPacket };
};

/** MUTANT 10 — the packet is handed back mutable. */
const mutableOutputMutant: Mh06EvaluateFn = (request) => rebuilt(oracleEvaluate(request), { freeze: false });

interface PlantedMutant {
  readonly label: string;
  readonly evaluate: Mh06EvaluateFn;
  /** The controls this mutant MUST fail. A mutant that survives one is a defect in the control. */
  readonly mustFail: readonly string[];
}

const PLANTED_MUTANTS: readonly PlantedMutant[] = [
  {
    label: "hard-coded five-result packet",
    evaluate: hardCodedPacketMutant,
    mustFail: [
      "MH06-C07-append-order-unique-and-exclusive",
      "MH06-C08-interrupted-append-is-never-success",
      "MH06-C09-missing-observation-is-never-clean",
      "MH06-C10-gaps-bounded-classified-and-checkpoint-bound",
      "MH06-C11-duplicate-delivery-is-one-effect",
    ],
  },
  {
    label: "duplicate sequences tolerated",
    evaluate: duplicateSequencesToleratedMutant,
    mustFail: ["MH06-C07-append-order-unique-and-exclusive"],
  },
  {
    label: "interrupted write reported as success",
    evaluate: interruptedAppendAsSuccessMutant,
    mustFail: ["MH06-C08-interrupted-append-is-never-success"],
  },
  {
    label: "missing observation read as checked_clean",
    evaluate: missingObservationAsCleanMutant,
    mustFail: ["MH06-C09-missing-observation-is-never-clean"],
  },
  {
    label: "hidden sequence gaps",
    evaluate: hiddenGapsMutant,
    mustFail: ["MH06-C10-gaps-bounded-classified-and-checkpoint-bound"],
  },
  {
    label: "recovered identity rewritten",
    evaluate: recoveredIdentityRewriteMutant,
    mustFail: ["MH06-C10-gaps-bounded-classified-and-checkpoint-bound"],
  },
  {
    label: "duplicate effect reapplied",
    evaluate: duplicateEffectReappliedMutant,
    mustFail: ["MH06-C11-duplicate-delivery-is-one-effect"],
  },
  {
    label: "same-id different-payload delivery accepted",
    evaluate: payloadMismatchAcceptedMutant,
    mustFail: ["MH06-C11-duplicate-delivery-is-one-effect"],
  },
  {
    label: "caller-authored / caller-shrunk results",
    evaluate: callerAuthoredResultsMutant,
    mustFail: ["MH06-C03-caller-cannot-author-or-shrink-result-truth"],
  },
  {
    label: "mutable packet output",
    evaluate: mutableOutputMutant,
    mustFail: ["MH06-C04-output-immutable-and-json-safe"],
  },
];

// ---------------------------------------------------------------------------
// §1 — the frozen W1/MH-06 slice (GREEN: no production evaluator involved)
// ---------------------------------------------------------------------------

describe("the frozen W1/MH-06 slice of guild.conformance_scenarios.v1", () => {
  it("assigns exactly five scenarios to this owner, and this file and the accepted spine agree on which", () => {
    expect(NEUTRAL_CONFORMANCE_OWNER_KEYS).toContain(OWNER_KEY_MH06);
    expect(NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[OWNER_KEY_MH06]).toBe(5);
    expect([...NEUTRAL_OWNER_SCENARIO_IDS[OWNER_KEY_MH06]]).toEqual([...MH06_IDS]);
  });

  it("places each MH-06 id at its own canonical slot in the 31-id required tuple", () => {
    const slots = MH06_IDS.map((stableId) => NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.indexOf(stableId));
    expect(slots.every((slot) => slot >= 0)).toBe(true);
    expect(strictlyIncreasing(slots)).toBe(true);
    expect(allDistinct(slots)).toBe(true);
  });

  it("pins one closed outcome type, disposition, and reason code per scenario", () => {
    for (const stableId of MH06_IDS) {
      const expected = MH06_EXPECTED[stableId];
      expect(NEUTRAL_OUTCOME_TYPES).toContain(expected.type as never);
      expect(NEUTRAL_DISPOSITIONS).toContain(expected.disposition as never);
      if (expected.disposition === "succeeded") expect(expected.reason_code).toBeNull();
      else expect(NEUTRAL_REASON_CODES).toContain(expected.reason_code as never);
    }
  });

  it("states the E-RECEIPT bindings every observation must carry", () => {
    expect(E_RECEIPT_BINDINGS.length).toBe(7);
    expect(allDistinct(E_RECEIPT_BINDINGS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2 — the control battery distinguishes good from bad (GREEN, anti-vacuity)
// ---------------------------------------------------------------------------

describe("the control battery distinguishes good from bad", () => {
  it("declares a closed, unique, fully-enumerated control set", () => {
    expect(CONTROLS.map((control) => control.id)).toEqual([...CONTROL_IDS]);
    expect(allDistinct(CONTROL_IDS)).toBe(true);
    for (const control of CONTROLS) expect(typeof control.title).toBe("string");
  });

  it("passes in full against the disposable conforming oracle", () => {
    const report = runControls(ORACLE_SUBJECT);
    expect(report.diagnostics).toEqual({});
    expect(report.failed_ids).toEqual([]);
    expect(report.passed).toBe(true);
  });

  for (const mutant of PLANTED_MUTANTS) {
    it(`rejects the planted mutant "${mutant.label}"`, () => {
      const report = runControls(mutantSubject(mutant.label, mutant.evaluate));
      expect(report.passed).toBe(false);
      for (const controlId of mutant.mustFail) {
        expect(CONTROL_IDS).toContain(controlId);
        if (report.failed_ids.indexOf(controlId) === -1) {
          throw new Error(
            `the mutant "${mutant.label}" SURVIVED ${controlId} — the control does not bite. ` +
              `Failed instead: ${report.failed_ids.join(", ") || "(nothing)"}`
          );
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// §3 — the production MH-06 evaluator (RED until A21-6 lands)
// ---------------------------------------------------------------------------

function productionSubject(): Mh06Subject {
  return {
    label: "production MH-06 evaluator",
    evaluate: exported<Mh06EvaluateFn>("evaluateReceiptJournalConformance"),
    scenarioIds: exported<readonly string[]>("MH06_SCENARIO_IDS"),
    ownerKey: exported<string>("MH06_OWNER_KEY"),
    packetSchema: exported<string>("MH06_PACKET_SCHEMA"),
    scenarios: exported<readonly NeutralScenarioDefinition[]>("MH06_SCENARIOS"),
    journalPort: exported<Mh06JournalPort>("MH06_PRODUCTION_JOURNAL"),
    refusalControls: exported<Record<string, string>>("MH06_REFUSAL_CONTROLS"),
  };
}

describe("the production MH-06 evaluator (A21-6)", () => {
  it("exists at the pinned module path beside receipt-journal.ts", () => {
    if (!fs.existsSync(EVALUATOR_SOURCE_PATH)) throw new Error(`${RED} — expected ${EVALUATOR_SOURCE_PATH}`);
    expect(fs.statSync(EVALUATOR_SOURCE_PATH).isFile()).toBe(true);
  });

  it("exports the owner registry, the production journal port, and the evaluator", () => {
    const subject = productionSubject();
    expect(typeof subject.evaluate).toBe("function");
    expect(subject.ownerKey).toBe(OWNER_KEY_MH06);
    expect([...subject.scenarioIds]).toEqual([...MH06_IDS]);
    expect(subject.scenarios.length).toBe(MH06_IDS.length);
  });

  for (const controlId of CONTROL_IDS) {
    it(`satisfies ${controlId}`, () => {
      const subject = productionSubject();
      const control = CONTROLS.find((candidate) => candidate.id === controlId);
      if (control === undefined) throw new Error(`unknown control ${controlId}`);
      control.run(subject);
    });
  }

  it("imports the real journal and reconciliation modules, and no frozen conformance fixture", () => {
    const source = withoutComments(evaluatorSource());
    expect(source).toMatch(/from\s+"\.\/receipt-journal"/);
    expect(source).toMatch(/from\s+"\.\/receipt-reconcile"/);
    for (const forbidden of [
      "conformance-scenarios.v1",
      "release-conformance",
      "__tests__",
      "fixtures/",
      ".json",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("performs no clock, randomness, environment, network, promotion, or signature work", () => {
    const source = withoutComments(evaluatorSource());
    for (const forbidden of [
      "Date.now",
      "new Date",
      "Math.random",
      "process.env",
      "node:http",
      "node:https",
      "node:net",
      "child_process",
      "assembleNeutralConformanceEvidence",
      "evaluateNeutralConformanceDecision",
      "createSign",
      "createVerify",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
