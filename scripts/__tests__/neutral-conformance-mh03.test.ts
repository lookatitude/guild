/**
 * __tests__/neutral-conformance-mh03.test.ts
 *
 * FIC-114 / A21-3 (RED-FIRST) — the executable contract for the not-yet-written
 * pure production module
 * `src/modules/host-runtime/workflows/host-adapter-conformance-evaluator.ts`.
 *
 * WHAT THIS BINDS
 *   `guild.conformance_scenarios.v1` assigns exactly FOUR of its 31 scenarios to
 *   the `W2/MH-03` host-adapter owner: `MHRC-EVT-001`, `MHRC-EVT-002`,
 *   `MHRC-UNS-001`, and `MHRC-UNS-003`. A21-S (already accepted, review packet
 *   `FIC-112-A21-SPINE-BLOCKERS-GREEN`, verdict `satisfied`) built the ASSEMBLY
 *   spine that joins one packet per owner. It deliberately evaluates nothing.
 *   This file states what the MH-03 owner's EVALUATOR must be before its packet
 *   is allowed to mean anything.
 *
 *   The only thing that makes such a packet honest is that its four results are
 *   DERIVED from the real host-adapter boundary — the immutable per-run
 *   capability snapshot, the native/wrapper event bindings, and the typed
 *   refusal paths in `host-adapter-boundary.ts`, `host-capability-snapshot.ts`,
 *   and `host-event-normalizer.ts` — rather than authored. So the contract below
 *   is written twice: once as ordinary obligations, and once as a CONTROL
 *   BATTERY that is run against a disposable conforming oracle (must pass) and
 *   against seven planted mutants (each must fail a NAMED control). A battery
 *   the mutants survive proves nothing.
 *
 * WHAT IT DELIBERATELY DOES NOT BIND
 *   No promotion decision, no signature or attestation verification, no release
 *   or channel decision, and no assembly. `evaluateNeutralConformanceDecision`
 *   (MH-02) still owns promotion; `assembleNeutralConformanceEvidence` (A21-S)
 *   still owns the join. This module only EVALUATES four scenarios and hands
 *   over one packet. §"the evaluator stays inside its boundary" scans the real
 *   source to prove it.
 *
 * THE ONE HONEST GAP THIS CONTRACT OPENS ON PURPOSE
 *   Production today has no typed AUTHENTICATION-FAILURE outcome at the adapter
 *   boundary. `host-capability-snapshot.ts` reports `authenticated: false` as a
 *   FACT, and `HOST_ADAPTER_REASON_CODES` does not list `authentication_failed`
 *   at all — so nothing currently distinguishes "the host cannot do this"
 *   (`unsupported`) from "the host could, but its credential is not usable"
 *   (`failed`). `MHRC-UNS-003` requires exactly that distinction. The core's
 *   closed reason-code vocabulary already contains `authentication_failed`, so
 *   the future evaluator introduces a SOURCE-OWNED typed classification over an
 *   existing vocabulary rather than a new dialect. This suite requires it; it
 *   does NOT edit production to provide it, and it widens no other vocabulary.
 *
 * RED EXPECTATION AT AUTHORING TIME
 *   Every `it` under §"the production MH-03 evaluator" fails with
 *   "A21-3 RED: production module not implemented yet", because the module does
 *   not exist. It must fail for that reason and no other. The anti-vacuity block
 *   (§"the control battery distinguishes good from bad") is GREEN from the first
 *   run: it exercises the same controls against a test-owned oracle and mutants,
 *   which is what makes the RED half a real gate rather than a placeholder.
 */

import * as fs from "fs";
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
  assembleNeutralConformanceEvidence,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-assembly";

// The REAL production boundary. Imported here for two distinct purposes: to
// recompute, independently of the evaluator, what the boundary actually answers
// for each scenario; and to prove by IDENTITY (`===`) that the evaluator's
// declared production port holds these exact functions rather than look-alikes.
import {
  bindHostRuntimeAdapter,
  hostRuntimeBoundaryOwnership,
} from "../../src/modules/host-runtime/workflows/host-adapter-boundary";
import type { HostRuntimeBindingResult } from "../../src/modules/host-runtime/workflows/host-adapter-boundary";
import { HOST_ADAPTER_OPERATIONS } from "../../src/modules/host-runtime/workflows/host-adapter-contract";
import {
  createHostCapabilitySnapshotStore,
  type HostCapabilityFact,
  type HostCapabilitySnapshot,
  type HostCapabilitySnapshotStore,
} from "../../src/modules/host-runtime/workflows/host-capability-snapshot";
import {
  normalizeHostEvent,
  type HostEventNormalizationResult,
} from "../../src/modules/host-runtime/workflows/host-event-normalizer";
import { HOST_REGISTRY_ROWS } from "../../src/modules/host-runtime/workflows/host-registry-schema";

// ---------------------------------------------------------------------------
// The module under contract
// ---------------------------------------------------------------------------

/**
 * The pinned future module path.
 *
 * It lives BESIDE `host-adapter-boundary.ts` because the four MH-03 scenarios
 * are statements about that boundary's own behaviour, and an evaluator that sat
 * in the lifecycle module would have to re-describe the adapter surface to reach
 * them — which is the drift the owner split exists to prevent.
 */
const EVALUATOR_REQUEST = "../../src/modules/host-runtime/workflows/host-adapter-conformance-evaluator";
const EVALUATOR_SOURCE_PATH = path.resolve(
  __dirname,
  "../../src/modules/host-runtime/workflows/host-adapter-conformance-evaluator.ts"
);

const RED = "A21-3 RED: production module not implemented yet";

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
    throw new Error(`A21-3 RED: production module does not implement the contract — missing export ${name}`);
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

const OWNER_KEY_MH03 = "W2/MH-03";

/** The four W2/MH-03 stable ids, in CANONICAL (whole-suite) order. */
const MH03_IDS: readonly string[] = ["MHRC-EVT-001", "MHRC-EVT-002", "MHRC-UNS-001", "MHRC-UNS-003"];

/**
 * The expected typed outcome of each MH-03 scenario, transcribed from the frozen
 * `guild.conformance_scenarios.v1` contract. Production must DERIVE the same
 * table from its own source-owned registry; two independent statements is the
 * point, so a drift between them is a finding rather than a shared mistake.
 */
const MH03_EXPECTED: Readonly<Record<string, { type: string; disposition: string; reason_code: string | null }>> = {
  "MHRC-EVT-001": { type: "guild.normalized_event_outcome.v1", disposition: "succeeded", reason_code: null },
  "MHRC-EVT-002": { type: "guild.normalized_event_outcome.v1", disposition: "unsupported", reason_code: "unknown_event" },
  "MHRC-UNS-001": { type: "guild.capability_outcome.v1", disposition: "unsupported", reason_code: "capability_absent" },
  "MHRC-UNS-003": { type: "guild.capability_outcome.v1", disposition: "failed", reason_code: "authentication_failed" },
};

/** The scenario categories the frozen contract assigns these four ids. */
const MH03_CATEGORY: Readonly<Record<string, string>> = {
  "MHRC-EVT-001": "normalized_event",
  "MHRC-EVT-002": "normalized_event",
  "MHRC-UNS-001": "unsupported_refusal",
  "MHRC-UNS-003": "unsupported_refusal",
};

/** The whole 31-id tuple and its owner map — needed to feed the REAL assembler. */
const CANONICAL_SCENARIO_IDS: readonly string[] = [
  "MHRC-LIF-001", "MHRC-LIF-002", "MHRC-LIF-003", "MHRC-LIF-004",
  "MHRC-EVT-001", "MHRC-EVT-002",
  "MHRC-SUP-001", "MHRC-SUP-002", "MHRC-SUP-003", "MHRC-SUP-004", "MHRC-SUP-005", "MHRC-SUP-006",
  "MHRC-UNS-001", "MHRC-UNS-002", "MHRC-UNS-003",
  "MHRC-RCT-001", "MHRC-RCT-002", "MHRC-RCT-003", "MHRC-RCT-004", "MHRC-RCT-005",
  "MHRC-MOD-001", "MHRC-MOD-002", "MHRC-MOD-003", "MHRC-MOD-004",
  "MHRC-STR-001", "MHRC-STR-002", "MHRC-STR-003", "MHRC-STR-004",
  "MHRC-VER-001", "MHRC-VER-002", "MHRC-VER-003",
];

const CANONICAL_OWNER_KEYS: readonly string[] = [
  "W1/MH-02",
  OWNER_KEY_MH03,
  "W1/MH-06",
  "W4/MH-07",
  "W4/MH-08",
  "W5/MH-09",
];

const CANONICAL_OWNER_OF: Readonly<Record<string, string>> = {
  "MHRC-LIF-001": "W1/MH-02", "MHRC-LIF-002": "W1/MH-02", "MHRC-LIF-003": "W1/MH-02",
  "MHRC-LIF-004": "W1/MH-02", "MHRC-UNS-002": "W1/MH-02",
  "MHRC-EVT-001": OWNER_KEY_MH03, "MHRC-EVT-002": OWNER_KEY_MH03,
  "MHRC-UNS-001": OWNER_KEY_MH03, "MHRC-UNS-003": OWNER_KEY_MH03,
  "MHRC-RCT-001": "W1/MH-06", "MHRC-RCT-002": "W1/MH-06", "MHRC-RCT-003": "W1/MH-06",
  "MHRC-RCT-004": "W1/MH-06", "MHRC-RCT-005": "W1/MH-06",
  "MHRC-MOD-001": "W4/MH-07", "MHRC-MOD-002": "W4/MH-07", "MHRC-MOD-003": "W4/MH-07",
  "MHRC-MOD-004": "W4/MH-07",
  "MHRC-STR-001": "W4/MH-08", "MHRC-STR-002": "W4/MH-08", "MHRC-STR-003": "W4/MH-08",
  "MHRC-STR-004": "W4/MH-08",
  "MHRC-SUP-001": "W5/MH-09", "MHRC-SUP-002": "W5/MH-09", "MHRC-SUP-003": "W5/MH-09",
  "MHRC-SUP-004": "W5/MH-09", "MHRC-SUP-005": "W5/MH-09", "MHRC-SUP-006": "W5/MH-09",
  "MHRC-VER-001": "W5/MH-09", "MHRC-VER-002": "W5/MH-09", "MHRC-VER-003": "W5/MH-09",
};

function canonicalIdsFor(ownerKey: string): readonly string[] {
  return CANONICAL_SCENARIO_IDS.filter((id) => CANONICAL_OWNER_OF[id] === ownerKey);
}

/** The refusal discriminators the evaluator must place on `outcome.facts`. */
const REFUSAL_CONTROLS = {
  callerSuppliedIds: "caller_supplied_scenario_ids",
  identityIncomplete: "evidence_identity_incomplete",
  evidenceBindingMissing: "evidence_binding_missing",
} as const;

// ---------------------------------------------------------------------------
// The evaluator's contract shapes, stated test-side
// ---------------------------------------------------------------------------

/**
 * The production surface the evaluator drives.
 *
 * It is a PORT rather than a direct import list for one reason only: a control
 * has to be able to SABOTAGE the boundary and watch the verdict change. An
 * evaluator whose answer is the same whatever the boundary says is not
 * evaluating, and no amount of shape checking can tell the two apart.
 *
 * The seam is not a substitute for the real path, and this suite never lets it
 * become one: `MH03_PRODUCTION_BOUNDARY` must hold these exact function objects
 * by IDENTITY, the default (portless) evaluation is compared field by field
 * against values this file recomputes from the real modules, and the source scan
 * proves the real modules are what the evaluator imports.
 */
interface Mh03BoundaryPort {
  readonly bindHostRuntimeAdapter: typeof bindHostRuntimeAdapter;
  readonly createHostCapabilitySnapshotStore: typeof createHostCapabilitySnapshotStore;
  readonly normalizeHostEvent: typeof normalizeHostEvent;
}

const REAL_BOUNDARY: Mh03BoundaryPort = {
  bindHostRuntimeAdapter,
  createHostCapabilitySnapshotStore,
  normalizeHostEvent,
};

interface Mh03ConformanceRequest {
  readonly run_id: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  /** `stable_id` -> committed receipt reference. MH-06 owns the journal itself. */
  readonly receipt_refs: Readonly<Record<string, string>>;
  /** `stable_id` -> typed freshness verdict. `unknown` is not a soft `fresh`. */
  readonly evidence_freshness: Readonly<Record<string, string>>;
  /** The concrete `HostAdapter` provider the real boundary binds through. */
  readonly adapter_provider: (host: string) => unknown;
  /** Defaults to `MH03_PRODUCTION_BOUNDARY`. Present so a control can sabotage it. */
  readonly boundary?: Mh03BoundaryPort;
  /** Present only in a malformed request; its presence is itself the refusal. */
  readonly stable_ids?: readonly string[];
}

interface Mh03OwnerPacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly NeutralScenarioResult[];
}

interface Mh03ConformanceResult {
  readonly outcome: NeutralOutcome;
  /** The owner packet, or `null` whenever the request itself was refused. */
  readonly packet: Mh03OwnerPacket | null;
}

type Mh03EvaluateFn = (request: Mh03ConformanceRequest) => Mh03ConformanceResult;

/** One scenario's observation record, carried on `outcome.facts.evidence`. */
interface Mh03ScenarioEvidence {
  readonly stable_id: string;
  readonly satisfied: boolean;
  readonly observed: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Test-owned fixtures
// ---------------------------------------------------------------------------

const IDENTITY: NeutralEvidenceIdentity = {
  source_commit: "c0ffee11223344556677889900aabbccddeeff01",
  package_hash: `sha256:${"7".repeat(64)}`,
  runtime_version: "guild-2.5.0",
  adapter_version: "guild.host_adapter.v1.0.0",
  host_id: "claude-code-cli",
  host_version: "2.5.0",
  platform: "darwin-arm64",
  contract_version: 1,
  scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
  scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
  release_id: "rel-2026-08-18-a21-mh03",
};

const CLAIMANT_ID = "guild.release-emitter";
const RUN_ID = "run-a21-mh03-contract";

function receiptRefFor(stableId: string): string {
  const sequence = CANONICAL_SCENARIO_IDS.indexOf(stableId) + 1;
  const commitment = `nec1:${sequence.toString(16).padStart(16, "0")}`;
  return `guild.receipt_ref.v1:a21-mh03-journal#${sequence}@${commitment}`;
}

function receiptRefs(): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const id of MH03_IDS) refs[id] = receiptRefFor(id);
  return refs;
}

function freshnessMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const id of MH03_IDS) map[id] = "fresh";
  return map;
}

/**
 * A complete `HostAdapter`-shaped provider return value.
 *
 * Every operation THROWS on purpose. The boundary promises it proves the
 * interface by inspection and never runs an operation, and MH-03's four
 * scenarios are all no-side-effect scenarios — so an evaluator that reaches for
 * an adapter operation to produce its evidence detonates here rather than
 * quietly performing host work inside a conformance run.
 */
function stubAdapter(hostId: string): Record<string, unknown> {
  const adapter: Record<string, unknown> = { host: hostId, hostId };
  for (const operation of HOST_ADAPTER_OPERATIONS) {
    adapter[operation] = () => {
      throw new Error(`MH-03 conformance evaluation must not execute adapter operation ${operation}`);
    };
  }
  return adapter;
}

const ADAPTER_PROVIDER = (host: string): unknown => stubAdapter(String(host));

function baseRequest(overrides: Record<string, unknown> = {}): Mh03ConformanceRequest {
  return {
    run_id: RUN_ID,
    evidence_identity: IDENTITY,
    receipt_refs: receiptRefs(),
    evidence_freshness: freshnessMap(),
    adapter_provider: ADAPTER_PROVIDER,
    ...overrides,
  } as Mh03ConformanceRequest;
}

// ---------------------------------------------------------------------------
// Independent recomputation against the REAL boundary
// ---------------------------------------------------------------------------

/**
 * The two real event bindings `MHRC-EVT-001` is about.
 *
 * They are genuinely different producers: Claude's `UserPromptSubmit` is a hook
 * literally bound in the shipped `hooks/hooks.json` (`source_kind:
 * native_hooks`), and `guild.wrapper.prompt_submit` is the guild-run wrapper's
 * own name for the same operator action on a host with no hook surface
 * (`source_kind: wrapper`). One semantic image, two provenances — which is the
 * whole scenario.
 */
const EVT001_BINDINGS: readonly { host_id: string; native_event: string }[] = [
  { host_id: "claude-code-cli", native_event: "UserPromptSubmit" },
  { host_id: "codex-cli", native_event: "guild.wrapper.prompt_submit" },
];

/** A native name no host declares. Deliberately not a near-miss of a real one. */
const UNMAPPED_NATIVE_EVENT = "guild.mh03.unregistered-native-event";

const EVT002_HOST = "claude-code-cli";
const UNS001_HOST = "claude-code-cli";
const UNS003_HOST = "codex-cli";
const CLAUDE_HOST_VERSION = "2.5.0";
const CODEX_HOST_VERSION = "1.0.0";

/** A real snapshot, captured through an isolated store so nothing leaks per-run state. */
function realSnapshot(host: string, hostVersion: string, authentication: string): HostCapabilitySnapshot {
  const store: HostCapabilitySnapshotStore = createHostCapabilitySnapshotStore();
  const captured = store.capture({
    host,
    runId: `${RUN_ID}-recompute`,
    hostVersion,
    authentication: authentication as never,
  });
  if (captured.disposition !== "succeeded" || captured.snapshot === null) {
    throw new Error(`the real boundary refused to snapshot ${host}: ${captured.disposition}`);
  }
  return captured.snapshot;
}

function factFor(snapshot: HostCapabilitySnapshot, capabilityId: unknown): HostCapabilityFact | undefined {
  return snapshot.capabilities.find((fact) => fact.capability_id === capabilityId);
}

/** Does the frozen registry row for this host declare that it requires auth? */
function registryRequiresAuth(host: string): boolean {
  const rows = HOST_REGISTRY_ROWS as unknown as Record<string, { detection: { requires_auth: boolean } }>;
  const row = rows[host];
  return row !== undefined && row.detection.requires_auth === true;
}

/** A real binding through `bindHostRuntimeAdapter`, with the stub provider. */
function realBinding(host: string, hostVersion: string, authentication: string): HostRuntimeBindingResult {
  return bindHostRuntimeAdapter({
    host,
    runId: `${RUN_ID}-recompute-${host}`,
    provider: ADAPTER_PROVIDER as never,
    hostVersion,
    authentication: authentication as never,
    snapshots: createHostCapabilitySnapshotStore(),
  });
}

// ---------------------------------------------------------------------------
// Sabotage — a boundary that answers differently, wired consistently
// ---------------------------------------------------------------------------

interface Sabotage {
  readonly normalize?: (host: string, nativeEvent: string) => HostEventNormalizationResult;
  readonly doctorSnapshot?: (snapshot: HostCapabilitySnapshot) => HostCapabilitySnapshot;
}

/**
 * Build a boundary port whose THREE members agree with each other.
 *
 * Wiring all three matters: `binding.normalizeEvent` and `binding.snapshot` are
 * produced INSIDE the real `bindHostRuntimeAdapter`, so sabotaging only the
 * standalone functions would leave an evaluator that works through the binding
 * untouched — and the control would silently stop biting.
 */
function portWith(sabotage: Sabotage): Mh03BoundaryPort {
  const normalize = sabotage.normalize ?? normalizeHostEvent;
  const doctor = sabotage.doctorSnapshot ?? ((snapshot: HostCapabilitySnapshot) => snapshot);

  const makeStore = (): HostCapabilitySnapshotStore => {
    const inner = createHostCapabilitySnapshotStore();
    return {
      capture(request) {
        const captured = inner.capture(request);
        if (captured.disposition !== "succeeded" || captured.snapshot === null) return captured;
        const snapshot = doctor(captured.snapshot);
        return Object.freeze({
          ...captured,
          snapshot,
          unsupported_capability_ids: Object.freeze(
            snapshot.capabilities.filter((fact) => !fact.supported).map((fact) => fact.capability_id)
          ) as readonly string[],
        }) as typeof captured;
      },
      release(runId) {
        inner.release(runId);
      },
      size() {
        return inner.size();
      },
    };
  };

  return {
    normalizeHostEvent: normalize as typeof normalizeHostEvent,
    createHostCapabilitySnapshotStore: makeStore as typeof createHostCapabilitySnapshotStore,
    bindHostRuntimeAdapter: ((request: Parameters<typeof bindHostRuntimeAdapter>[0]) => {
      const bound = bindHostRuntimeAdapter({ ...request, snapshots: request.snapshots ?? makeStore() });
      if (bound.disposition !== "succeeded" || bound.binding === null) return bound;
      const hostId = bound.binding.host_id;
      return Object.freeze({
        ...bound,
        binding: Object.freeze({
          ...bound.binding,
          snapshot: doctor(bound.binding.snapshot),
          normalizeEvent: (nativeEvent: string) => normalize(hostId, nativeEvent),
        }),
      }) as typeof bound;
    }) as typeof bindHostRuntimeAdapter,
  };
}

/** Every capability reads supported AND authenticated — the optimistic lie. */
function allSupportedAndAuthenticated(snapshot: HostCapabilitySnapshot): HostCapabilitySnapshot {
  return Object.freeze({
    ...snapshot,
    capabilities: Object.freeze(
      snapshot.capabilities.map((fact) =>
        Object.freeze({ capability_id: fact.capability_id, supported: true, authenticated: true })
      )
    ) as readonly HostCapabilityFact[],
  }) as HostCapabilitySnapshot;
}

/**
 * An unmapped native event answers `succeeded` with an invented image.
 *
 * The forged event record is assembled through computed keys rather than as an
 * object literal so this test file never contains a schema-header-shaped
 * literal; the shape it produces is identical either way.
 */
function normalizeAnythingAsSuccess(host: string, nativeEvent: string): HostEventNormalizationResult {
  const honest = normalizeHostEvent(host, nativeEvent);
  if (honest.disposition === "succeeded") return honest;
  const provenance: Record<string, unknown> = {};
  provenance["host_id"] = honest.host_id;
  provenance["native_event"] = honest.native_event;
  provenance["source_kind"] = honest.source_kind;
  const forged: Record<string, unknown> = {};
  forged["schema_version"] = "guild.normalized_host_event.v1";
  forged["name"] = "run.stop";
  forged["vocabulary_version"] = "guild.normalized_event.v2";
  forged["host_native"] = Object.freeze(provenance);
  return Object.freeze({
    ...honest,
    disposition: "succeeded",
    reason_code: null,
    event: Object.freeze(forged),
  }) as unknown as HostEventNormalizationResult;
}

// ---------------------------------------------------------------------------
// The control battery — test-owned, executable, and run against every subject
// ---------------------------------------------------------------------------

interface Mh03Subject {
  readonly label: string;
  readonly evaluate: Mh03EvaluateFn;
  readonly scenarioIds: readonly string[];
  readonly ownerKey: string;
  readonly packetSchema: string;
  readonly scenarios: readonly NeutralScenarioDefinition[];
  readonly authReasonCode: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

function evidenceOf(result: Mh03ConformanceResult): readonly Mh03ScenarioEvidence[] {
  const evidence = (result.outcome.facts as Record<string, unknown>).evidence;
  assert(Array.isArray(evidence), "outcome.facts.evidence must be an ordered array of scenario observations");
  return evidence as readonly Mh03ScenarioEvidence[];
}

function evidenceFor(result: Mh03ConformanceResult, stableId: string): Mh03ScenarioEvidence {
  const found = evidenceOf(result).find((entry) => entry && entry.stable_id === stableId);
  assert(found !== undefined, `outcome.facts.evidence carries no observation for ${stableId}`);
  return found as Mh03ScenarioEvidence;
}

function resultFor(packet: Mh03OwnerPacket | null, stableId: string): NeutralScenarioResult {
  assert(packet !== null, `expected a packet carrying ${stableId}, got null`);
  const found = (packet as Mh03OwnerPacket).results.find((entry) => entry && entry.stable_id === stableId);
  assert(found !== undefined, `the packet carries no result for ${stableId}`);
  return found as NeutralScenarioResult;
}

function accepted(subject: Mh03Subject, request: Mh03ConformanceRequest = baseRequest()): Mh03ConformanceResult {
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

/**
 * A conforming packet for an owner this lane does not own.
 *
 * DISPOSABLE and test-local: it exists only so the real assembler has its other
 * five inputs. It claims nothing about those owners' evaluators — none of which
 * exist yet either.
 */
function disposablePacketFor(ownerKey: string): Mh03OwnerPacket {
  const ids = canonicalIdsFor(ownerKey);
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
  return packet as unknown as Mh03OwnerPacket;
}

interface Mh03Control {
  readonly id: string;
  readonly title: string;
  readonly run: (subject: Mh03Subject) => void;
}

const CONTROLS: readonly Mh03Control[] = [
  {
    id: "MH03-C01-scenario-registry-source-owned",
    title: "the four ids, their order, their owner, and their expected outcomes come from source",
    run: (subject) => {
      assert(subject.ownerKey === OWNER_KEY_MH03, `owner key must be ${OWNER_KEY_MH03}, got ${subject.ownerKey}`);
      assert(
        neutralCanonicalJson([...subject.scenarioIds]) === neutralCanonicalJson([...MH03_IDS]),
        `the scenario tuple must be exactly ${MH03_IDS.join(", ")} in canonical order`
      );
      assert(Object.isFrozen(subject.scenarioIds), "the scenario tuple must be frozen");
      assert(subject.scenarios.length === MH03_IDS.length, "the registry must declare exactly four scenarios");
      const verdict = validateNeutralScenarioRegistry(subject.scenarios);
      assert(
        verdict.disposition === "succeeded",
        `the registry must satisfy the core's own scenario_field_contract: ${neutralCanonicalJson(verdict.facts)}`
      );
      for (let index = 0; index < MH03_IDS.length; index += 1) {
        const scenario = subject.scenarios[index];
        const stableId = MH03_IDS[index];
        assert(scenario.stable_id === stableId, `registry position ${index} must declare ${stableId}`);
        assert(
          scenario.implementation_wave_owner.key === OWNER_KEY_MH03,
          `${stableId} must be owned by ${OWNER_KEY_MH03}`
        );
        assert(scenario.category === MH03_CATEGORY[stableId], `${stableId} category drifted from the frozen contract`);
        const expected = MH03_EXPECTED[stableId];
        assert(
          scenario.expected_typed_outcome.type === expected.type,
          `${stableId} expected outcome type drifted from the frozen contract`
        );
        assert(
          scenario.expected_typed_outcome.disposition === expected.disposition,
          `${stableId} expected disposition drifted from the frozen contract`
        );
      }
      assert(
        subject.authReasonCode === "authentication_failed" &&
          NEUTRAL_REASON_CODES.indexOf(subject.authReasonCode as never) !== -1,
        "the authentication-failure reason code must be the core's own `authentication_failed`"
      );
      assert(
        subject.packetSchema === NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
        `the packet schema must be ${NEUTRAL_ASSEMBLY_PACKET_SCHEMA}`
      );
    },
  },
  {
    id: "MH03-C02-packet-shape-and-order",
    title: "one owner packet, four ordered results, each satisfying the runtime result contract",
    run: (subject) => {
      const result = accepted(subject);
      const packet = result.packet as Mh03OwnerPacket;
      assert(packet.schema_version === NEUTRAL_ASSEMBLY_PACKET_SCHEMA, "packet schema drifted");
      assert(packet.suite_id === NEUTRAL_SCENARIO_SUITE_ID, "packet suite id drifted");
      assert(packet.suite_version === NEUTRAL_SCENARIO_SUITE_VERSION, "packet suite version drifted");
      assert(packet.owner_key === OWNER_KEY_MH03, "packet owner key drifted");
      assert(
        neutralCanonicalJson([...packet.stable_ids]) === neutralCanonicalJson([...MH03_IDS]),
        "the packet must declare the four ids in canonical order"
      );
      assert(packet.results.length === MH03_IDS.length, "the packet must carry exactly four results");
      assert(
        neutralCanonicalJson(packet.evidence_identity) === neutralCanonicalJson(IDENTITY),
        "the packet identity must be the identity the request named"
      );
      const refs = receiptRefs();
      for (let index = 0; index < MH03_IDS.length; index += 1) {
        const stableId = MH03_IDS[index];
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
        const observation = evidenceFor(result, stableId);
        if (observation.satisfied) {
          const expected = MH03_EXPECTED[stableId];
          assert(
            entry.outcome_type === expected.type,
            `${stableId}: a satisfied scenario reports its frozen outcome type`
          );
          assert(
            entry.disposition === expected.disposition,
            `${stableId}: a satisfied scenario reports its frozen disposition, got ${String(entry.disposition)}`
          );
          assert(
            entry.reason_code === expected.reason_code,
            `${stableId}: a satisfied scenario reports its frozen reason code, got ${String(entry.reason_code)}`
          );
        }
      }
    },
  },
  {
    id: "MH03-C03-caller-cannot-supply-scenario-ids",
    title: "the covered id set has exactly one source, and it is not the caller",
    run: (subject) => {
      const shrunk = subject.evaluate(baseRequest({ stable_ids: ["MHRC-EVT-001"] }));
      assert(shrunk.packet === null, "a caller-supplied id set must be refused, not honoured");
      assert(shrunk.outcome.disposition === "refused", "a caller-supplied id set must be a typed refusal");
      assert(
        (shrunk.outcome.facts as Record<string, unknown>).refusal_control === REFUSAL_CONTROLS.callerSuppliedIds,
        `the refusal must name ${REFUSAL_CONTROLS.callerSuppliedIds}`
      );
      // Even an AGREEING set is refused: accepting a matching copy accepts the
      // channel through which a differing copy could arrive.
      const agreeing = subject.evaluate(baseRequest({ stable_ids: [...MH03_IDS] }));
      assert(agreeing.packet === null, "an agreeing caller-supplied id set is still the channel, and still refused");
    },
  },
  {
    id: "MH03-C04-output-immutable-and-json-safe",
    title: "the packet is deeply frozen, JSON-safe, and not aliased to the caller's inputs",
    run: (subject) => {
      const result = accepted(subject);
      const packet = result.packet as Mh03OwnerPacket;
      assert(Object.isFrozen(packet), "the packet must be frozen");
      assert(Object.isFrozen(packet.results), "the packet results must be frozen");
      assert(Object.isFrozen(packet.stable_ids), "the packet ids must be frozen");
      assert(Object.isFrozen(packet.results[0]), "every result must be frozen");
      assert(Object.isFrozen(packet.results[0].evidence_identity), "every result identity must be frozen");
      assert(isImmutable(packet, "owner_key", "W9/MH-99"), "the packet owner key must not be writable");
      assert(isImmutable(packet.results as unknown as unknown[], 0, null), "the results array must not be writable");
      assert(
        neutralCanonicalJson(JSON.parse(JSON.stringify(packet))) === neutralCanonicalJson(packet),
        "the packet must be JSON-safe: no function, undefined, or cycle survives a round trip"
      );
    },
  },
  {
    id: "MH03-C05-deterministic-and-clock-free",
    title: "two evaluations over equivalent inputs are byte-equivalent",
    run: (subject) => {
      const first = accepted(subject);
      const second = accepted(subject);
      assert(
        neutralCanonicalJson(first.packet) === neutralCanonicalJson(second.packet),
        "two evaluations over equivalent inputs must produce byte-equivalent packets"
      );
      assert(
        neutralCanonicalJson(first.outcome.facts) === neutralCanonicalJson(second.outcome.facts),
        "two evaluations over equivalent inputs must produce byte-equivalent facts"
      );
    },
  },
  {
    id: "MH03-C06-unknown-event-is-not-success",
    title: "an unmapped native event is unsupported with `unknown_event`, and stays so under a lying boundary",
    run: (subject) => {
      const honest = accepted(subject);
      const entry = resultFor(honest.packet, "MHRC-EVT-002");
      assert(
        entry.disposition === "unsupported" && entry.reason_code === "unknown_event",
        `MHRC-EVT-002 must be unsupported/unknown_event, got ${String(entry.disposition)}/${String(entry.reason_code)}`
      );
      const observation = evidenceFor(honest, "MHRC-EVT-002");
      assert(observation.satisfied, "MHRC-EVT-002 must be satisfied against the real boundary");
      assert(
        observation.observed.normalized_event === null || observation.observed.normalized_event === undefined,
        "MHRC-EVT-002 must synthesize no success event"
      );
      // A boundary that answers `succeeded` for the unmapped event must NOT be
      // reported as a satisfied scenario. An evaluator whose verdict does not
      // move here is not reading the boundary at all.
      const lying = subject.evaluate(baseRequest({ boundary: portWith({ normalize: normalizeAnythingAsSuccess }) }));
      assert(
        evidenceFor(lying, "MHRC-EVT-002").satisfied === false,
        "a boundary that normalizes an unregistered native event to success must fail MHRC-EVT-002"
      );
      assert(
        lying.outcome.disposition !== "succeeded",
        "an unsatisfied scenario must not leave the evaluation outcome succeeded"
      );
    },
  },
  {
    id: "MH03-C07-unsupported-is-not-failed",
    title: "an absent capability is `unsupported`/`capability_absent`, never `failed`",
    run: (subject) => {
      const entry = resultFor(accepted(subject).packet, "MHRC-UNS-001");
      assert(entry.disposition === "unsupported", `MHRC-UNS-001 must be unsupported, got ${String(entry.disposition)}`);
      assert(
        entry.reason_code === "capability_absent",
        `MHRC-UNS-001 must name capability_absent, got ${String(entry.reason_code)}`
      );
      const observed = evidenceFor(accepted(subject), "MHRC-UNS-001").observed;
      assert(observed.supported === false, "MHRC-UNS-001 is about a capability the snapshot marks ABSENT");
      assert(
        observed.fallback_selected === undefined || observed.fallback_selected === false,
        "MHRC-UNS-001 implies no fallback"
      );
    },
  },
  {
    id: "MH03-C08-authentication-failure-is-not-unsupported",
    title: "an unusable credential on a SUPPORTED capability is `failed`/`authentication_failed`",
    run: (subject) => {
      const result = accepted(subject);
      const entry = resultFor(result.packet, "MHRC-UNS-003");
      assert(
        entry.disposition === "failed",
        `MHRC-UNS-003 must be failed, got ${String(entry.disposition)} — an auth failure is not an absent capability`
      );
      assert(
        entry.reason_code === subject.authReasonCode,
        `MHRC-UNS-003 must name ${subject.authReasonCode}, got ${String(entry.reason_code)}`
      );
      const observed = evidenceFor(result, "MHRC-UNS-003").observed;
      assert(observed.supported === true, "MHRC-UNS-003 is about a SUPPORTED capability");
      assert(observed.authenticated === false, "MHRC-UNS-003 is about an UNAUTHENTICATED capability");
      assert(
        observed.fallback_selected === undefined || observed.fallback_selected === false,
        "MHRC-UNS-003 forbids a silent fallback"
      );
    },
  },
  {
    id: "MH03-C09-provenance-and-snapshot-hash-bound",
    title: "event provenance and the snapshot hash are carried, not summarized away",
    run: (subject) => {
      const result = accepted(subject);
      const evt001 = evidenceFor(result, "MHRC-EVT-001").observed;
      assert(evt001.normalized_event === "prompt.submit", "MHRC-EVT-001 must normalize to prompt.submit");
      const bindings = evt001.bindings as readonly Record<string, unknown>[];
      assert(Array.isArray(bindings) && bindings.length >= 2, "MHRC-EVT-001 needs at least two real native bindings");
      const sourceKinds: string[] = [];
      for (const binding of bindings) {
        assert(
          typeof binding.host_id === "string" && (binding.host_id as string).length > 0,
          "each binding names its host"
        );
        assert(
          typeof binding.native_event === "string" && (binding.native_event as string).length > 0,
          "each binding names the host-native event it came from"
        );
        assert(binding.normalized_event === "prompt.submit", "both bindings must share the semantic image");
        assert(typeof binding.source_kind === "string", "each binding records its event source kind");
        if (sourceKinds.indexOf(binding.source_kind as string) === -1) sourceKinds.push(binding.source_kind as string);
      }
      assert(sourceKinds.length >= 2, "the two bindings must come from genuinely different producers");

      const evt002 = evidenceFor(result, "MHRC-EVT-002").observed;
      assert(typeof evt002.host_id === "string", "MHRC-EVT-002 retains the host it was observed on");
      assert(
        typeof evt002.native_event === "string" && (evt002.native_event as string).length > 0,
        "MHRC-EVT-002 retains the native event provenance"
      );

      const hashPattern = /^sha256:[0-9a-f]{64}$/;
      for (const stableId of ["MHRC-UNS-001", "MHRC-UNS-003"]) {
        const observed = evidenceFor(result, stableId).observed;
        assert(
          typeof observed.capability_id === "string" && (observed.capability_id as string).length > 0,
          `${stableId} must name the capability id`
        );
        assert(
          typeof observed.snapshot_hash === "string" && hashPattern.test(observed.snapshot_hash as string),
          `${stableId} must carry the immutable snapshot hash the fact came from`
        );
        assert(typeof observed.host_id === "string", `${stableId} must name the host it was observed on`);
      }
    },
  },
  {
    id: "MH03-C10-verdict-derived-from-boundary",
    title: "a boundary reporting every capability present and authenticated flips both capability scenarios",
    run: (subject) => {
      const optimistic = subject.evaluate(
        baseRequest({ boundary: portWith({ doctorSnapshot: allSupportedAndAuthenticated }) })
      );
      assert(
        evidenceFor(optimistic, "MHRC-UNS-001").satisfied === false,
        "a snapshot in which nothing is absent cannot satisfy MHRC-UNS-001 — the verdict is not derived"
      );
      assert(
        evidenceFor(optimistic, "MHRC-UNS-003").satisfied === false,
        "a snapshot in which everything is authenticated cannot satisfy MHRC-UNS-003 — the verdict is not derived"
      );
      assert(
        optimistic.outcome.disposition !== "succeeded",
        "an evaluation with unsatisfied scenarios must not report succeeded"
      );
    },
  },
  {
    id: "MH03-C11-no-lifecycle-policy-or-promotion-added",
    title: "the evaluator adds no lifecycle policy, promotion verdict, or off-contract result field",
    run: (subject) => {
      const result = accepted(subject);
      const packet = result.packet as Mh03OwnerPacket;
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
      const forbidden = ["conformant", "promoted", "signature", "attestations", "authority", "gate", "phase"];
      const packetKeys = Object.keys(packet);
      const factKeys = Object.keys(result.outcome.facts as Record<string, unknown>);
      for (const key of forbidden) {
        assert(packetKeys.indexOf(key) === -1, `the packet must not carry ${key}`);
        assert(factKeys.indexOf(key) === -1, `the evaluation facts must not carry ${key}`);
      }
    },
  },
  {
    id: "MH03-C12-packet-consumable-by-the-real-assembler",
    title: "the real A21-S assembler accepts the packet and places its results in canonical slots",
    run: (subject) => {
      const packet = accepted(subject).packet as Mh03OwnerPacket;
      const packets = CANONICAL_OWNER_KEYS.map((ownerKey) =>
        ownerKey === OWNER_KEY_MH03 ? packet : disposablePacketFor(ownerKey)
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
      for (const stableId of MH03_IDS) {
        const slot = CANONICAL_SCENARIO_IDS.indexOf(stableId);
        const placed = aggregate.results[slot];
        assert(placed.stable_id === stableId, `${stableId} must land in its canonical slot ${slot}`);
        const own = resultFor(packet, stableId);
        assert(
          placed.disposition === own.disposition && placed.reason_code === own.reason_code,
          `${stableId} must survive assembly unchanged`
        );
      }
    },
  },
];

/** The control ids, in declaration order. Stated once, asserted as a closed set. */
const CONTROL_IDS: readonly string[] = [
  "MH03-C01-scenario-registry-source-owned",
  "MH03-C02-packet-shape-and-order",
  "MH03-C03-caller-cannot-supply-scenario-ids",
  "MH03-C04-output-immutable-and-json-safe",
  "MH03-C05-deterministic-and-clock-free",
  "MH03-C06-unknown-event-is-not-success",
  "MH03-C07-unsupported-is-not-failed",
  "MH03-C08-authentication-failure-is-not-unsupported",
  "MH03-C09-provenance-and-snapshot-hash-bound",
  "MH03-C10-verdict-derived-from-boundary",
  "MH03-C11-no-lifecycle-policy-or-promotion-added",
  "MH03-C12-packet-consumable-by-the-real-assembler",
];

interface ControlReport {
  readonly passed: boolean;
  readonly failed_ids: readonly string[];
  readonly diagnostics: Readonly<Record<string, string>>;
}

function runControls(subject: Mh03Subject): ControlReport {
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
 * REAL host-adapter boundary.
 *
 * It exists for two reasons and neither is "reference implementation". First,
 * anti-vacuity: a battery no implementation can pass proves nothing, and a
 * battery every implementation passes proves less. Second, SATISFIABILITY: a
 * RED contract nobody can meet is a bad contract, and this oracle demonstrates
 * that all four MH-03 scenarios are genuinely evaluable against production as it
 * stands today — with exactly one addition, the typed authentication-failure
 * classification, which production does not own and the future evaluator must.
 *
 * It is DISPOSABLE. It is not the shape production must take, only evidence
 * that the shape production must take exists.
 */
const ORACLE_SCENARIO_IDS: readonly string[] = Object.freeze([...MH03_IDS]);

/** The capability the evaluator probes for absence. Source-owned, not requested. */
const UNS001_CAPABILITY_ID = "host.mcp.http";
/** The capability the evaluator probes for an unusable credential. Source-owned. */
const UNS003_CAPABILITY_ID = "host.dispatch.selectable";

function oracleScenarios(): readonly NeutralScenarioDefinition[] {
  const build = (stableId: string, title: string, eventName: string, preconditions: readonly string[]) => {
    const expected = MH03_EXPECTED[stableId];
    return {
      stable_id: stableId,
      category: MH03_CATEGORY[stableId],
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
          profile: stableId === "MHRC-EVT-001" ? "E-LIFECYCLE" : "E-REFUSAL",
          assertions: ["the observation is bound to the identity it was produced under"],
        },
      ],
      implementation_wave_owner: { wave_id: "W2", work_item_id: "MH-03", key: OWNER_KEY_MH03 },
    } as unknown as NeutralScenarioDefinition;
  };
  return Object.freeze([
    build("MHRC-EVT-001", "Host-native events normalize to the same semantic event", "prompt.submit", [
      "two adapter bindings declare the same semantic event coverage",
    ]),
    build("MHRC-EVT-002", "Unknown native event is explicit and non-mutating", "tool.after", [
      "the adapter receives an unregistered native event",
    ]),
    build("MHRC-UNS-001", "Unsupported capability returns a typed outcome", "task.dispatch", [
      "the immutable capability snapshot marks the operation unsupported",
    ]),
    build("MHRC-UNS-003", "Authentication failure is explicit and non-degrading by default", "task.dispatch", [
      "the capability exists",
      "host authentication is unavailable or invalid",
    ]),
  ]);
}

function refuseEvaluation(control: string, reasonCode: string, assertions: readonly string[]): Mh03ConformanceResult {
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode as never,
      assertions: [...assertions],
      facts: { refusal_control: control, owner_key: OWNER_KEY_MH03, evidence: [] },
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

function oracleEvaluate(request: Mh03ConformanceRequest): Mh03ConformanceResult {
  if (request !== null && typeof request === "object" && "stable_ids" in (request as object)) {
    return refuseEvaluation(REFUSAL_CONTROLS.callerSuppliedIds, "scenario_required_set_mismatch", [
      "the covered scenario set has exactly one source, and it is this module",
      "an agreeing caller-supplied set is refused too, because accepting a matching copy accepts the channel",
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

  const port = request.boundary ?? REAL_BOUNDARY;
  const store = port.createHostCapabilitySnapshotStore();
  const bind = (host: string, hostVersion: string, authentication: string) =>
    port.bindHostRuntimeAdapter({
      host,
      runId: request.run_id,
      provider: request.adapter_provider as never,
      hostVersion,
      authentication: authentication as never,
      snapshots: store,
    });

  const claude = bind(UNS001_HOST, CLAUDE_HOST_VERSION, "not_observed");
  const codex = bind(UNS003_HOST, CODEX_HOST_VERSION, "unauthenticated");
  const claudeBinding = claude.binding;
  const codexBinding = codex.binding;
  const bindingFor = (hostId: string) => (hostId === UNS003_HOST ? codexBinding : claudeBinding);

  // -- MHRC-EVT-001 ---------------------------------------------------------
  const evt001Bindings = EVT001_BINDINGS.map((declared) => {
    const bound = bindingFor(declared.host_id);
    const normalized = bound === null ? null : bound.normalizeEvent(declared.native_event);
    const event = normalized === null ? null : normalized.event;
    return {
      host_id: declared.host_id,
      native_event: declared.native_event,
      source_kind: normalized === null ? "none" : normalized.source_kind,
      normalized_event: event === null || event === undefined ? null : event.name,
      provenance_host_id: event === null || event === undefined ? null : event.host_native.host_id,
      provenance_native_event: event === null || event === undefined ? null : event.host_native.native_event,
    };
  });
  const evt001SourceKinds = evt001Bindings
    .map((entry) => entry.source_kind)
    .filter((kind, index, all) => all.indexOf(kind) === index);
  const evt001Satisfied =
    evt001Bindings.length >= 2 &&
    evt001Bindings.every(
      (entry) =>
        entry.normalized_event === "prompt.submit" &&
        entry.provenance_host_id === entry.host_id &&
        entry.provenance_native_event === entry.native_event
    ) &&
    evt001SourceKinds.length >= 2;

  // -- MHRC-EVT-002 ---------------------------------------------------------
  const evt002Normalized = claudeBinding === null ? null : claudeBinding.normalizeEvent(UNMAPPED_NATIVE_EVENT);
  const evt002Event = evt002Normalized === null ? null : evt002Normalized.event;
  const evt002Satisfied =
    evt002Normalized !== null &&
    evt002Normalized.disposition !== "succeeded" &&
    evt002Normalized.reason_code === "unknown_event" &&
    (evt002Event === null || evt002Event === undefined);

  // -- MHRC-UNS-001 ---------------------------------------------------------
  const claudeSnapshot = claudeBinding === null ? null : claudeBinding.snapshot;
  const uns001Fact = claudeSnapshot === null ? undefined : factFor(claudeSnapshot, UNS001_CAPABILITY_ID);
  const uns001Satisfied = uns001Fact !== undefined && uns001Fact.supported === false;

  // -- MHRC-UNS-003 ---------------------------------------------------------
  const codexSnapshot = codexBinding === null ? null : codexBinding.snapshot;
  const uns003Fact = codexSnapshot === null ? undefined : factFor(codexSnapshot, UNS003_CAPABILITY_ID);
  const uns003RequiresAuth = registryRequiresAuth(UNS003_HOST);
  const uns003Satisfied =
    uns003Fact !== undefined && uns003Fact.supported === true && uns003Fact.authenticated === false && uns003RequiresAuth;

  const observations: Record<string, Record<string, unknown>> = {
    "MHRC-EVT-001": {
      normalized_event: evt001Satisfied ? "prompt.submit" : null,
      bindings: evt001Bindings.map((entry) => ({
        host_id: entry.host_id,
        native_event: entry.native_event,
        source_kind: entry.source_kind,
        normalized_event: entry.normalized_event,
      })),
    },
    "MHRC-EVT-002": {
      host_id: EVT002_HOST,
      native_event: UNMAPPED_NATIVE_EVENT,
      normalized_event: evt002Event === null || evt002Event === undefined ? null : evt002Event.name,
      boundary_reason_code: evt002Normalized === null ? null : evt002Normalized.reason_code,
    },
    "MHRC-UNS-001": {
      host_id: UNS001_HOST,
      capability_id: UNS001_CAPABILITY_ID,
      supported: uns001Fact === undefined ? null : uns001Fact.supported,
      authenticated: uns001Fact === undefined ? null : uns001Fact.authenticated,
      snapshot_hash: claudeSnapshot === null ? null : claudeSnapshot.snapshot_hash,
      host_version: CLAUDE_HOST_VERSION,
      authentication: "not_observed",
      fallback_selected: false,
    },
    "MHRC-UNS-003": {
      host_id: UNS003_HOST,
      capability_id: UNS003_CAPABILITY_ID,
      supported: uns003Fact === undefined ? null : uns003Fact.supported,
      authenticated: uns003Fact === undefined ? null : uns003Fact.authenticated,
      requires_auth: uns003RequiresAuth,
      snapshot_hash: codexSnapshot === null ? null : codexSnapshot.snapshot_hash,
      host_version: CODEX_HOST_VERSION,
      authentication: "unauthenticated",
      fallback_selected: false,
    },
  };

  const satisfaction: Record<string, boolean> = {
    "MHRC-EVT-001": evt001Satisfied,
    "MHRC-EVT-002": evt002Satisfied,
    "MHRC-UNS-001": uns001Satisfied,
    "MHRC-UNS-003": uns003Satisfied,
  };

  const evidence = ORACLE_SCENARIO_IDS.map((stableId) => ({
    stable_id: stableId,
    satisfied: satisfaction[stableId],
    observed: observations[stableId],
  }));

  const results = ORACLE_SCENARIO_IDS.map((stableId) => {
    const expected = MH03_EXPECTED[stableId];
    const satisfied = satisfaction[stableId];
    return {
      stable_id: stableId,
      outcome_type: expected.type,
      disposition: satisfied ? expected.disposition : "failed",
      reason_code: satisfied ? expected.reason_code : "scenario_result_mismatch",
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: request.evidence_identity,
      evidence_freshness: request.evidence_freshness[stableId],
    };
  });

  const allSatisfied = ORACLE_SCENARIO_IDS.every((stableId) => satisfaction[stableId]);
  const packetRecord: Record<string, unknown> = {};
  packetRecord["schema_version"] = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  packetRecord["suite_id"] = NEUTRAL_SCENARIO_SUITE_ID;
  packetRecord["suite_version"] = NEUTRAL_SCENARIO_SUITE_VERSION;
  packetRecord["owner_key"] = OWNER_KEY_MH03;
  packetRecord["evidence_identity"] = { ...(request.evidence_identity as unknown as Record<string, unknown>) };
  packetRecord["stable_ids"] = [...ORACLE_SCENARIO_IDS];
  packetRecord["results"] = results;

  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: allSatisfied ? "succeeded" : "failed",
      reason_code: allSatisfied ? null : ("scenario_result_mismatch" as never),
      assertions: [
        "each of the four W2/MH-03 scenarios was evaluated against the real host-adapter boundary",
        "an unmapped native event is reported unsupported and synthesizes no success event",
        "an unusable credential on a supported capability is failed, never unsupported",
        "no lifecycle policy, promotion decision, or signature verification happens here",
      ],
      facts: {
        owner_key: OWNER_KEY_MH03,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence,
        evaluated_hosts: [UNS001_HOST, UNS003_HOST],
      },
    }),
    packet: neutralFreeze(packetRecord) as unknown as Mh03OwnerPacket,
  };
}

const ORACLE_SUBJECT: Mh03Subject = {
  label: "disposable conforming oracle",
  evaluate: oracleEvaluate,
  scenarioIds: ORACLE_SCENARIO_IDS,
  ownerKey: OWNER_KEY_MH03,
  packetSchema: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  scenarios: oracleScenarios(),
  authReasonCode: "authentication_failed",
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
function rebuilt(base: Mh03ConformanceResult, rewrite: Rewrite): Mh03ConformanceResult {
  if (base.packet === null) return base;
  const packet = base.packet as Mh03OwnerPacket;
  const observations = evidenceOf(base).map((entry) => {
    const observed = { ...(entry.observed as Record<string, unknown>) };
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
    packet: (shouldFreeze ? neutralFreeze(rebuiltPacket) : rebuiltPacket) as unknown as Mh03OwnerPacket,
  };
}

function mutantSubject(label: string, evaluate: Mh03EvaluateFn): Mh03Subject {
  return { ...ORACLE_SUBJECT, label, evaluate };
}

/**
 * MUTANT 1 — hard-coded packet output.
 *
 * The shortcut the whole evaluator exists to make impossible: never touch the
 * boundary, return four `succeeded` results, call it 4/4. It is the single most
 * dangerous mutant, because its packet is perfectly well-formed and the
 * assembler will happily place it in the aggregate.
 */
const hardCodedPacketMutant: Mh03EvaluateFn = (request) => {
  const results = MH03_IDS.map((stableId) => ({
    stable_id: stableId,
    outcome_type: MH03_EXPECTED[stableId].type,
    disposition: "succeeded",
    reason_code: null,
    receipt_ref: request.receipt_refs[stableId],
    evidence_identity: request.evidence_identity,
    evidence_freshness: request.evidence_freshness[stableId],
  }));
  const packet: Record<string, unknown> = {};
  packet["schema_version"] = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;
  packet["suite_id"] = NEUTRAL_SCENARIO_SUITE_ID;
  packet["suite_version"] = NEUTRAL_SCENARIO_SUITE_VERSION;
  packet["owner_key"] = OWNER_KEY_MH03;
  packet["evidence_identity"] = { ...(request.evidence_identity as unknown as Record<string, unknown>) };
  packet["stable_ids"] = [...MH03_IDS];
  packet["results"] = results;
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: ["asserted four scenarios without evaluating any of them"],
      facts: {
        owner_key: OWNER_KEY_MH03,
        evidence: MH03_IDS.map((stableId) => ({
          stable_id: stableId,
          satisfied: true,
          observed: { host_id: UNS001_HOST, capability_id: UNS001_CAPABILITY_ID, snapshot_hash: `sha256:${"0".repeat(64)}` },
        })),
      },
    }),
    packet: neutralFreeze(packet) as unknown as Mh03OwnerPacket,
  };
};

/** MUTANT 2 — an unmapped native event is reported as a success. */
const unknownEventAsSuccessMutant: Mh03EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    result: (entry, stableId) => {
      if (stableId !== "MHRC-EVT-002") return entry;
      entry.disposition = "succeeded";
      entry.reason_code = null;
      return entry;
    },
  });

/** MUTANT 3 — an ABSENT capability is reported as a failure. */
const unsupportedAsFailedMutant: Mh03EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    result: (entry, stableId) => {
      if (stableId !== "MHRC-UNS-001") return entry;
      entry.disposition = "failed";
      entry.reason_code = "capability_absent";
      return entry;
    },
  });

/** MUTANT 4 — an unusable credential is reported as an absent capability. */
const authAsUnsupportedMutant: Mh03EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    result: (entry, stableId) => {
      if (stableId !== "MHRC-UNS-003") return entry;
      entry.disposition = "unsupported";
      entry.reason_code = "capability_absent";
      return entry;
    },
  });

/** MUTANT 5 — provenance and the snapshot hash are summarized away. */
const missingProvenanceMutant: Mh03EvaluateFn = (request) =>
  rebuilt(oracleEvaluate(request), {
    observation: (observed) => {
      delete observed.snapshot_hash;
      if (Array.isArray(observed.bindings)) {
        observed.bindings = (observed.bindings as Record<string, unknown>[]).map((binding) => ({
          normalized_event: binding.normalized_event,
        }));
      }
      return observed;
    },
  });

/** MUTANT 6 — the caller is allowed to shrink the covered set. */
const callerShrunkIdsMutant: Mh03EvaluateFn = (request) => {
  const clean: Record<string, unknown> = { ...(request as unknown as Record<string, unknown>) };
  delete clean.stable_ids;
  const honest = oracleEvaluate(clean as unknown as Mh03ConformanceRequest);
  const requested = request.stable_ids;
  if (requested === undefined || honest.packet === null) return honest;
  const packet = honest.packet as Mh03OwnerPacket;
  const shrunk: Record<string, unknown> = { ...(packet as unknown as Record<string, unknown>) };
  shrunk["stable_ids"] = [...requested];
  shrunk["results"] = packet.results.filter((entry) => requested.indexOf(entry.stable_id) !== -1);
  return { outcome: honest.outcome, packet: neutralFreeze(shrunk) as unknown as Mh03OwnerPacket };
};

/** MUTANT 7 — the packet is handed back mutable. */
const mutableOutputMutant: Mh03EvaluateFn = (request) => rebuilt(oracleEvaluate(request), { freeze: false });

/** MUTANT 8 — the output varies between two evaluations of the same inputs. */
let nondeterministicSequence = 0;
const nondeterministicMutant: Mh03EvaluateFn = (request) => {
  nondeterministicSequence += 1;
  const sequence = nondeterministicSequence;
  return rebuilt(oracleEvaluate(request), {
    result: (entry) => {
      entry.receipt_ref = `${String(entry.receipt_ref)}#observation-${sequence}`;
      return entry;
    },
  });
};

/** MUTANT 9 — a promotion verdict and an off-contract result field ride along. */
const promotionVerdictMutant: Mh03EvaluateFn = (request) => {
  const honest = rebuilt(oracleEvaluate(request), {
    result: (entry) => {
      entry.conformant = true;
      return entry;
    },
  });
  if (honest.packet === null) return honest;
  const packet: Record<string, unknown> = { ...(honest.packet as unknown as Record<string, unknown>) };
  packet["conformant"] = true;
  return { outcome: honest.outcome, packet: neutralFreeze(packet) as unknown as Mh03OwnerPacket };
};

/** MUTANT 10 — the packet claims another owner's key. */
const foreignOwnerKeyMutant: Mh03EvaluateFn = (request) => {
  const honest = oracleEvaluate(request);
  if (honest.packet === null) return honest;
  const packet: Record<string, unknown> = { ...(honest.packet as unknown as Record<string, unknown>) };
  packet["owner_key"] = "W1/MH-06";
  return { outcome: honest.outcome, packet: neutralFreeze(packet) as unknown as Mh03OwnerPacket };
};

interface PlantedMutant {
  readonly label: string;
  readonly evaluate: Mh03EvaluateFn;
  /** Declared-surface damage, for mutants that lie about the registry rather than the run. */
  readonly overrides?: Partial<Mh03Subject>;
  /** The controls this mutant MUST fail. A mutant that survives one is a defect in the control. */
  readonly mustFail: readonly string[];
}

const PLANTED_MUTANTS: readonly PlantedMutant[] = [
  {
    label: "hard-coded packet output",
    evaluate: hardCodedPacketMutant,
    mustFail: [
      "MH03-C06-unknown-event-is-not-success",
      "MH03-C07-unsupported-is-not-failed",
      "MH03-C08-authentication-failure-is-not-unsupported",
      "MH03-C10-verdict-derived-from-boundary",
    ],
  },
  {
    label: "unknown-event-as-success",
    evaluate: unknownEventAsSuccessMutant,
    mustFail: ["MH03-C06-unknown-event-is-not-success"],
  },
  {
    label: "unsupported-as-failed",
    evaluate: unsupportedAsFailedMutant,
    mustFail: ["MH03-C07-unsupported-is-not-failed"],
  },
  {
    label: "auth-as-unsupported",
    evaluate: authAsUnsupportedMutant,
    mustFail: ["MH03-C08-authentication-failure-is-not-unsupported"],
  },
  {
    label: "missing provenance / snapshot-hash binding",
    evaluate: missingProvenanceMutant,
    mustFail: ["MH03-C09-provenance-and-snapshot-hash-bound"],
  },
  {
    label: "caller-shrunk scenario ids",
    evaluate: callerShrunkIdsMutant,
    mustFail: ["MH03-C03-caller-cannot-supply-scenario-ids"],
  },
  {
    label: "mutable packet output",
    evaluate: mutableOutputMutant,
    mustFail: ["MH03-C04-output-immutable-and-json-safe"],
  },
  {
    label: "nondeterministic output",
    evaluate: nondeterministicMutant,
    mustFail: ["MH03-C05-deterministic-and-clock-free"],
  },
  {
    label: "promotion verdict and off-contract result field",
    evaluate: promotionVerdictMutant,
    mustFail: ["MH03-C11-no-lifecycle-policy-or-promotion-added"],
  },
  {
    label: "packet claiming another owner's key",
    evaluate: foreignOwnerKeyMutant,
    mustFail: ["MH03-C12-packet-consumable-by-the-real-assembler"],
  },
  {
    label: "registry declaring three of the four frozen ids",
    evaluate: oracleEvaluate,
    overrides: {
      scenarioIds: Object.freeze(["MHRC-EVT-001", "MHRC-EVT-002", "MHRC-UNS-001"]),
      scenarios: oracleScenarios().slice(0, 3),
    },
    mustFail: ["MH03-C01-scenario-registry-source-owned"],
  },
];

// ---------------------------------------------------------------------------
// The production subject
// ---------------------------------------------------------------------------

function productionSubject(): Mh03Subject {
  return {
    label: "production MH-03 evaluator",
    evaluate: exported<Mh03EvaluateFn>("evaluateMh03HostAdapterConformance"),
    scenarioIds: exported<readonly string[]>("MH03_CONFORMANCE_SCENARIO_IDS"),
    ownerKey: exported<string>("MH03_CONFORMANCE_OWNER_KEY"),
    packetSchema: exported<string>("MH03_CONFORMANCE_PACKET_SCHEMA"),
    scenarios: exported<readonly NeutralScenarioDefinition[]>("MH03_CONFORMANCE_SCENARIOS"),
    authReasonCode: exported<string>("MH03_AUTHENTICATION_FAILURE_REASON_CODE"),
  };
}

// ---------------------------------------------------------------------------

describe("MH-03 conformance evaluation — the controls themselves bite", () => {
  it("declares a closed, ordered control battery", () => {
    expect(CONTROLS.map((control) => control.id)).toEqual([...CONTROL_IDS]);
    expect(new Set(CONTROL_IDS).size).toBe(CONTROL_IDS.length);
    for (const control of CONTROLS) expect(typeof control.title).toBe("string");
  });

  it("passes the disposable conforming oracle", () => {
    const report = runControls(ORACLE_SUBJECT);
    expect(report.diagnostics).toEqual({});
    expect([...report.failed_ids]).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it.each(PLANTED_MUTANTS.map((mutant) => [mutant.label, mutant] as const))(
    "rejects the planted mutant: %s",
    (_label, mutant) => {
      const report = runControls({
        ...mutantSubject(mutant.label, mutant.evaluate),
        ...(mutant.overrides ?? {}),
      });
      expect(report.passed).toBe(false);
      for (const controlId of mutant.mustFail) {
        expect([...report.failed_ids]).toContain(controlId);
      }
    }
  );

  /**
   * The oracle is only meaningful if it is reading the REAL boundary. Every
   * value below is recomputed here from the production modules and compared, so
   * an oracle that quietly hard-coded its answers would fail this too — which is
   * what keeps the mutant results above from being a closed loop.
   */
  it("derives the oracle's four observations from the real host-adapter boundary", () => {
    const result = oracleEvaluate(baseRequest());

    for (const declared of EVT001_BINDINGS) {
      const real = normalizeHostEvent(declared.host_id, declared.native_event);
      expect(real.disposition).toBe("succeeded");
      expect(real.event === null ? null : real.event.name).toBe("prompt.submit");
    }
    const observedBindings = evidenceFor(result, "MHRC-EVT-001").observed.bindings as Record<string, unknown>[];
    expect(observedBindings.map((binding) => binding.host_id)).toEqual(
      EVT001_BINDINGS.map((declared) => declared.host_id)
    );
    expect(observedBindings.map((binding) => binding.source_kind).slice().sort()).toEqual(["native_hooks", "wrapper"]);

    const realUnknown = normalizeHostEvent(EVT002_HOST, UNMAPPED_NATIVE_EVENT);
    expect(realUnknown.event).toBeNull();
    expect(realUnknown.reason_code).toBe("unknown_event");

    const claudeSnapshot = realSnapshot(UNS001_HOST, CLAUDE_HOST_VERSION, "not_observed");
    const absent = factFor(claudeSnapshot, UNS001_CAPABILITY_ID);
    expect(absent === undefined ? null : absent.supported).toBe(false);
    expect(evidenceFor(result, "MHRC-UNS-001").observed.snapshot_hash).toBe(claudeSnapshot.snapshot_hash);

    const codexSnapshot = realSnapshot(UNS003_HOST, CODEX_HOST_VERSION, "unauthenticated");
    const unusable = factFor(codexSnapshot, UNS003_CAPABILITY_ID);
    expect(unusable === undefined ? null : unusable.supported).toBe(true);
    expect(unusable === undefined ? null : unusable.authenticated).toBe(false);
    expect(evidenceFor(result, "MHRC-UNS-003").observed.snapshot_hash).toBe(codexSnapshot.snapshot_hash);

    // And the binding path — not just the standalone functions — really binds.
    const bound = realBinding(UNS003_HOST, CODEX_HOST_VERSION, "unauthenticated");
    expect(bound.disposition).toBe("succeeded");
    expect(bound.binding === null ? null : bound.binding.snapshot.snapshot_hash).toBe(codexSnapshot.snapshot_hash);
  });

  it("keeps lifecycle policy outside the boundary the evaluator reports on", () => {
    const ownership = hostRuntimeBoundaryOwnership();
    expect([...ownership.not_owned]).toContain("lifecycle_state");
    expect([...ownership.not_owned]).toContain("gate_policy");
    expect([...ownership.owned]).toContain("host_capability_snapshot");
    expect([...ownership.owned]).toContain("host_native_event_normalization");
  });
});

// ---------------------------------------------------------------------------
// RED — the production evaluator does not exist yet
// ---------------------------------------------------------------------------

describe("the production MH-03 evaluator", () => {
  it("exists at the pinned module path", () => {
    expect(fs.existsSync(EVALUATOR_SOURCE_PATH)).toBe(true);
  });

  it("declares the source-owned MH-03 registry of exactly the four frozen ids", () => {
    const subject = productionSubject();
    expect([...subject.scenarioIds]).toEqual([...MH03_IDS]);
    expect(subject.ownerKey).toBe(OWNER_KEY_MH03);
    expect(subject.packetSchema).toBe(NEUTRAL_ASSEMBLY_PACKET_SCHEMA);
    expect(subject.scenarios.length).toBe(4);
    expect(validateNeutralScenarioRegistry(subject.scenarios).disposition).toBe("succeeded");
    for (const scenario of subject.scenarios) {
      expect(scenario.implementation_wave_owner.key).toBe(OWNER_KEY_MH03);
      expect(scenario.expected_typed_outcome.type).toBe(MH03_EXPECTED[scenario.stable_id].type);
      expect(scenario.expected_typed_outcome.disposition).toBe(MH03_EXPECTED[scenario.stable_id].disposition);
    }
  });

  it("owns a typed authentication-failure outcome production does not have today", () => {
    // The gap is real and deliberate: `HOST_ADAPTER_REASON_CODES` does not list
    // `authentication_failed`, so nothing at the adapter boundary currently
    // distinguishes MHRC-UNS-003 from MHRC-UNS-001. The evaluator introduces the
    // classification over the CORE's existing closed vocabulary — it invents no
    // code and widens no other neutral vocabulary.
    const reasonCode = exported<string>("MH03_AUTHENTICATION_FAILURE_REASON_CODE");
    expect(reasonCode).toBe("authentication_failed");
    expect(NEUTRAL_REASON_CODES.indexOf(reasonCode as never)).toBeGreaterThanOrEqual(0);
  });

  it("binds its declared production port to the real boundary functions by identity", () => {
    const port = exported<Mh03BoundaryPort>("MH03_PRODUCTION_BOUNDARY");
    expect(port.normalizeHostEvent).toBe(normalizeHostEvent);
    expect(port.bindHostRuntimeAdapter).toBe(bindHostRuntimeAdapter);
    expect(port.createHostCapabilitySnapshotStore).toBe(createHostCapabilitySnapshotStore);
  });

  it("passes the whole control battery", () => {
    const report = runControls(productionSubject());
    expect(report.diagnostics).toEqual({});
    expect([...report.failed_ids]).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("MHRC-EVT-001: two real native/wrapper bindings share one semantic event", () => {
    const result = productionSubject().evaluate(baseRequest());
    const observed = evidenceFor(result, "MHRC-EVT-001").observed;
    const bindings = observed.bindings as Record<string, unknown>[];
    expect(bindings.length).toBeGreaterThanOrEqual(2);
    const kinds: string[] = [];
    for (const binding of bindings) {
      const real = normalizeHostEvent(String(binding.host_id), String(binding.native_event));
      expect(real.disposition).toBe("succeeded");
      expect(real.event === null ? null : real.event.name).toBe(binding.normalized_event);
      expect(binding.normalized_event).toBe("prompt.submit");
      expect(binding.source_kind).toBe(real.source_kind);
      if (kinds.indexOf(String(binding.source_kind)) === -1) kinds.push(String(binding.source_kind));
    }
    expect(kinds.length).toBeGreaterThanOrEqual(2);
    expect(resultFor(result.packet, "MHRC-EVT-001").disposition).toBe("succeeded");
  });

  it("MHRC-EVT-002: an unmapped native event is unsupported, provenance-retaining, and non-mutating", () => {
    const result = productionSubject().evaluate(baseRequest());
    const observed = evidenceFor(result, "MHRC-EVT-002").observed;
    const real = normalizeHostEvent(String(observed.host_id), String(observed.native_event));
    expect(real.event).toBeNull();
    expect(real.reason_code).toBe("unknown_event");
    expect(real.host_id).toBe(observed.host_id);
    const entry = resultFor(result.packet, "MHRC-EVT-002");
    expect(entry.disposition).toBe("unsupported");
    expect(entry.reason_code).toBe("unknown_event");
  });

  it("MHRC-UNS-001: an absent capability is unsupported, with its id and the real snapshot hash", () => {
    const result = productionSubject().evaluate(baseRequest());
    const observed = evidenceFor(result, "MHRC-UNS-001").observed;
    const snapshot = realSnapshot(
      String(observed.host_id),
      String(observed.host_version),
      String(observed.authentication)
    );
    const fact = factFor(snapshot, observed.capability_id);
    expect(fact === undefined ? null : fact.supported).toBe(false);
    expect(observed.snapshot_hash).toBe(snapshot.snapshot_hash);
    const entry = resultFor(result.packet, "MHRC-UNS-001");
    expect(entry.disposition).toBe("unsupported");
    expect(entry.reason_code).toBe("capability_absent");
  });

  it("MHRC-UNS-003: an unusable credential on a supported capability is failed, not unsupported", () => {
    const result = productionSubject().evaluate(baseRequest());
    const observed = evidenceFor(result, "MHRC-UNS-003").observed;
    const snapshot = realSnapshot(
      String(observed.host_id),
      String(observed.host_version),
      String(observed.authentication)
    );
    const fact = factFor(snapshot, observed.capability_id);
    expect(fact === undefined ? null : fact.supported).toBe(true);
    expect(fact === undefined ? null : fact.authenticated).toBe(false);
    expect(observed.snapshot_hash).toBe(snapshot.snapshot_hash);
    const entry = resultFor(result.packet, "MHRC-UNS-003");
    expect(entry.disposition).toBe("failed");
    expect(entry.reason_code).toBe("authentication_failed");
    expect(entry.disposition).not.toBe("unsupported");
  });

  it("refuses a caller-supplied scenario set, an incomplete identity, and a missing evidence binding", () => {
    const evaluate = productionSubject().evaluate;

    const supplied = evaluate(baseRequest({ stable_ids: [...MH03_IDS] }));
    expect(supplied.packet).toBeNull();
    expect(supplied.outcome.disposition).toBe("refused");
    expect(supplied.outcome.facts.refusal_control).toBe(REFUSAL_CONTROLS.callerSuppliedIds);

    const incomplete = { ...(IDENTITY as unknown as Record<string, unknown>) };
    delete incomplete.platform;
    const identityRefusal = evaluate(baseRequest({ evidence_identity: incomplete }));
    expect(identityRefusal.packet).toBeNull();
    expect(identityRefusal.outcome.facts.refusal_control).toBe(REFUSAL_CONTROLS.identityIncomplete);

    const refs = receiptRefs();
    delete refs["MHRC-UNS-003"];
    const receiptRefusal = evaluate(baseRequest({ receipt_refs: refs }));
    expect(receiptRefusal.packet).toBeNull();
    expect(receiptRefusal.outcome.facts.refusal_control).toBe(REFUSAL_CONTROLS.evidenceBindingMissing);

    const freshness = freshnessMap();
    freshness["MHRC-EVT-001"] = "probably-fine";
    const freshnessRefusal = evaluate(baseRequest({ evidence_freshness: freshness }));
    expect(freshnessRefusal.packet).toBeNull();
    expect(freshnessRefusal.outcome.facts.refusal_control).toBe(REFUSAL_CONTROLS.evidenceBindingMissing);

    for (const refusal of [supplied, identityRefusal, receiptRefusal, freshnessRefusal]) {
      expect(NEUTRAL_REASON_CODES.indexOf(refusal.outcome.reason_code as never)).toBeGreaterThanOrEqual(0);
    }
  });

  it("hands the real A21-S assembler a packet it accepts", () => {
    const packet = productionSubject().evaluate(baseRequest()).packet as Mh03OwnerPacket;
    const packets = CANONICAL_OWNER_KEYS.map((ownerKey) =>
      ownerKey === OWNER_KEY_MH03 ? packet : disposablePacketFor(ownerKey)
    );
    // FIC-131: encoded as ONE canonical JSON text, the assembler's only input.
    const assembled = assembleNeutralConformanceEvidence(
      neutralCanonicalJson({
        packets,
        claim: { claimant_id: CLAIMANT_ID, activated_runtime: IDENTITY },
      })
    );
    expect(assembled.outcome.disposition).toBe("succeeded");
    expect(assembled.evidence).not.toBeNull();
    const aggregate = assembled.evidence as { results: readonly NeutralScenarioResult[] };
    expect(aggregate.results.length).toBe(31);
    for (const stableId of MH03_IDS) {
      expect(aggregate.results[CANONICAL_SCENARIO_IDS.indexOf(stableId)].stable_id).toBe(stableId);
    }
  });
});

describe("the evaluator stays inside its boundary", () => {
  it("never reads the frozen release-conformance fixture", () => {
    const source = withoutComments(evaluatorSource());
    for (const forbidden of ["conformance-scenarios.v1", "release-conformance", "__tests__", "fixtures", ".json"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("imports the real production boundary and nothing that performs I/O", () => {
    const source = withoutComments(evaluatorSource());
    const specifiers: string[] = [];
    const pattern = /(?:from|require\()\s*["']([^"']+)["']/g;
    let match = pattern.exec(source);
    while (match !== null) {
      specifiers.push(match[1]);
      match = pattern.exec(source);
    }
    expect(specifiers).toContain("./host-adapter-boundary");
    for (const specifier of specifiers) {
      expect(specifier.startsWith(".")).toBe(true);
      for (const forbidden of ["fs", "node:fs", "path", "node:path", "child_process", "node:child_process", "http", "https"]) {
        expect(specifier).not.toBe(forbidden);
      }
    }
  });

  it("reads no clock, no environment, and no network", () => {
    const source = withoutComments(evaluatorSource());
    for (const forbidden of [
      "Date.now",
      "new Date",
      "Math.random",
      "process.env",
      "process.argv",
      "readFileSync",
      "writeFileSync",
      "existsSync",
      "execSync",
      "spawnSync",
      "fetch(",
      "setTimeout",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("takes no promotion, signature, assembly, or release decision", () => {
    const source = withoutComments(evaluatorSource());
    for (const forbidden of [
      "evaluateNeutralConformanceDecision",
      "assembleNeutralConformanceEvidence",
      "NEUTRAL_ATTESTOR_TRUST_ROOT",
      "NEUTRAL_MINIMUM_ATTESTOR_QUORUM",
      "neutralAttestationVerifies",
      "neutralVerifyAttestationSignature",
      "neutralAttestationDigest",
      "NeutralConformanceAuthority",
      "NeutralJournalAttestation",
      "release-distribution-contract",
      "check-channel-integrity",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
