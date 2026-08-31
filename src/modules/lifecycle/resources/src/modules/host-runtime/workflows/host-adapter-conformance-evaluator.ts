/**
 * src/modules/host-runtime/workflows/host-adapter-conformance-evaluator.ts
 *
 * W2/MH-03 — the host-adapter owner's conformance EVALUATOR.
 *
 * WHAT THIS OWNS
 *   The frozen scenario suite assigns exactly four of its scenarios to this
 *   owner: MHRC-EVT-001, MHRC-EVT-002, MHRC-UNS-001 and MHRC-UNS-003. All four
 *   are statements about the host-adapter boundary itself, so this module lives
 *   beside that boundary and answers them by DRIVING it: the immutable per-run
 *   capability snapshot, the native/wrapper event bindings, and the typed
 *   refusal paths in `host-adapter-boundary`, `host-capability-snapshot` and
 *   `host-event-normalizer`. Nothing here is authored: every disposition below
 *   is a reading of what those modules actually answered for a probe.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN
 *   No promotion decision, no signature or attestation verification, no release
 *   or channel decision, and no assembly. The promotion gate still decides; the
 *   assembly spine still joins the six owner packets. This module evaluates four
 *   scenarios and hands over ONE owner packet. It reads no clock, no
 *   environment, no network and no file, so two evaluations over equivalent
 *   inputs are byte-equivalent by construction rather than by convention.
 *
 * THE ONE CLASSIFICATION THIS MODULE ADDS
 *   The adapter boundary reports `authenticated: false` as a FACT and its own
 *   reason-code list carries no authentication code at all, so nothing there
 *   separates "the host cannot do this" from "the host could, but its credential
 *   is not usable". MHRC-UNS-003 requires exactly that separation. The neutral
 *   core's CLOSED reason-code vocabulary already contains
 *   `authentication_failed`, so the classification below is source-owned over an
 *   EXISTING vocabulary — it invents no code, and it widens no other vocabulary,
 *   least of all the shared event normalizer's.
 *
 * WHY THE BOUNDARY IS A PORT
 *   `MH03_PRODUCTION_BOUNDARY` holds the real functions, and the default path
 *   uses it. The seam exists so a caller can substitute a boundary that answers
 *   DIFFERENTLY and watch the verdict move — an evaluator whose answer is the
 *   same whatever the boundary says is not evaluating anything. It is never a
 *   substitute for the real path: the default is the real path.
 */

import { bindHostRuntimeAdapter } from "./host-adapter-boundary";
import type {
  HostAdapterProvider,
  HostRuntimeBinding,
  HostRuntimeBindingResult,
} from "./host-adapter-boundary";
import { createHostCapabilitySnapshotStore } from "./host-capability-snapshot";
import type {
  HostAuthenticationObservation,
  HostCapabilityFact,
  HostCapabilitySnapshot,
  HostCapabilitySnapshotStore,
} from "./host-capability-snapshot";
import { normalizeHostEvent } from "./host-event-normalizer";
import type { HostEventNormalizationResult } from "./host-event-normalizer";
import {
  NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  neutralFreeze,
  neutralOutcome,
} from "../../lifecycle";
import type {
  NeutralEvidenceFreshnessVerdict,
  NeutralEvidenceIdentity,
  NeutralOutcome,
  NeutralReasonCode,
  NeutralScenarioDefinition,
  NeutralScenarioResult,
} from "../../lifecycle";

// ---------------------------------------------------------------------------
// The owner's declared surface
// ---------------------------------------------------------------------------

/** The implementation-wave owner these four scenarios are assigned to. */
export const MH03_CONFORMANCE_OWNER_KEY = "W2/MH-03";

/** The wire schema of the single packet this owner hands to the assembly spine. */
export const MH03_CONFORMANCE_PACKET_SCHEMA: string = NEUTRAL_ASSEMBLY_PACKET_SCHEMA;

/**
 * The authentication-failure classification, stated once.
 *
 * It is the NEUTRAL CORE's own code. Naming it here binds MHRC-UNS-003 to the
 * closed vocabulary rather than to a dialect this module made up.
 */
export const MH03_AUTHENTICATION_FAILURE_REASON_CODE = "authentication_failed";

/** The reason code a scenario carries when the boundary did not answer as the frozen contract requires. */
const MH03_UNSATISFIED_REASON_CODE = "scenario_result_mismatch";

/** The typed refusal discriminators this evaluator can report. */
export const MH03_REFUSAL_CONTROL_CALLER_SUPPLIED_IDS = "caller_supplied_scenario_ids";
export const MH03_REFUSAL_CONTROL_IDENTITY_INCOMPLETE = "evidence_identity_incomplete";
export const MH03_REFUSAL_CONTROL_EVIDENCE_BINDING_MISSING = "evidence_binding_missing";

/** The wave owner every scenario below declares. */
const MH03_WAVE_OWNER = Object.freeze({
  wave_id: "W2",
  work_item_id: "MH-03",
  key: MH03_CONFORMANCE_OWNER_KEY,
});

/**
 * The four scenarios, transcribed from the frozen suite into source.
 *
 * They are DECLARED here rather than read from the generated artifact on disk:
 * an evaluator that loads its own obligations from a file it does not own can be
 * pointed at a different file, and this module performs no I/O at all. The suite
 * remains the contract; a drift between the two is a finding, which is exactly
 * what two independent statements are for.
 */
export const MH03_CONFORMANCE_SCENARIOS: readonly NeutralScenarioDefinition[] = neutralFreeze([
  {
    stable_id: "MHRC-EVT-001",
    category: "normalized_event",
    title: "Host-native events normalize to the same semantic event",
    preconditions: [
      "two adapter bindings declare the same semantic event coverage",
      "native payloads represent the same operator action",
      "adapter versions are recorded",
    ],
    action_event: { name: "prompt.submit", input: { native_event_matrix: "host-specific equivalent payloads" } },
    expected_typed_outcome: {
      type: "guild.normalized_event_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "normalized event name and semantic payload are equal",
        "host-native provenance remains attributable",
        "normalization does not add lifecycle policy",
      ],
    },
    evidence_requirements: [
      {
        profile: "E-LIFECYCLE",
        assertions: [
          "native-input hash and normalized-output hash recorded per host",
          "semantic comparison excludes declared provenance fields only",
        ],
      },
    ],
    implementation_wave_owner: MH03_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-EVT-002",
    category: "normalized_event",
    title: "Unknown native event is explicit and non-mutating",
    preconditions: [
      "the adapter receives an unregistered native event",
      "the immutable capability snapshot does not declare a mapping",
    ],
    action_event: { name: "tool.after", input: { native_event: "unmapped" } },
    expected_typed_outcome: {
      type: "guild.normalized_event_outcome.v1",
      disposition: "unsupported",
      assertions: [
        "reason code identifies unmapped_event",
        "lifecycle state is unchanged",
        "unsupported observation is durably recorded",
      ],
    },
    evidence_requirements: [
      {
        profile: "E-REFUSAL",
        assertions: ["native event provenance is retained", "no synthesized success event exists"],
      },
    ],
    implementation_wave_owner: MH03_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-UNS-001",
    category: "unsupported_refusal",
    title: "Unsupported capability returns a typed outcome",
    preconditions: [
      "the immutable capability snapshot marks the operation unsupported",
      "the caller requests that operation",
    ],
    action_event: { name: "task.dispatch", input: { required_capability: "absent" } },
    expected_typed_outcome: {
      type: "guild.capability_outcome.v1",
      disposition: "unsupported",
      assertions: ["reason code and capability id are present", "no fallback is implied", "no side effect occurs"],
    },
    evidence_requirements: [
      {
        profile: "E-REFUSAL",
        assertions: ["snapshot hash proves capability absence", "unsupported receipt is durable"],
      },
    ],
    implementation_wave_owner: MH03_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-UNS-003",
    category: "unsupported_refusal",
    title: "Authentication failure is explicit and non-degrading by default",
    preconditions: [
      "the capability exists",
      "host authentication is unavailable or invalid",
      "no approved fallback host is selected",
    ],
    action_event: { name: "task.dispatch", input: { auth_state: "invalid" } },
    expected_typed_outcome: {
      type: "guild.capability_outcome.v1",
      disposition: "failed",
      assertions: [
        "reason code identifies authentication failure",
        "the outcome is not reported as unsupported",
        "silent fallback is prohibited",
      ],
    },
    evidence_requirements: [
      {
        profile: "E-REFUSAL",
        assertions: [
          "sensitive credentials are redacted",
          "failure receipt records selected host and no side effect",
        ],
      },
    ],
    implementation_wave_owner: MH03_WAVE_OWNER,
  },
]) as readonly NeutralScenarioDefinition[];

/**
 * The covered id tuple, in canonical suite order.
 *
 * DERIVED from the registry above so the two can never disagree, and frozen so
 * the tuple this owner declares cannot be edited by anything that receives it.
 */
export const MH03_CONFORMANCE_SCENARIO_IDS: readonly string[] = Object.freeze(
  MH03_CONFORMANCE_SCENARIOS.map((scenario) => scenario.stable_id)
);

/**
 * The reason code each SATISFIED scenario reports.
 *
 * Three of the four are the boundary's own codes for what it observed; the
 * fourth is the classification this module owns. A scenario the boundary did not
 * satisfy never reaches this table — it reports `MH03_UNSATISFIED_REASON_CODE`.
 */
const MH03_SATISFIED_REASON_CODES: Readonly<Record<string, string | null>> = Object.freeze({
  "MHRC-EVT-001": null,
  "MHRC-EVT-002": "unknown_event",
  "MHRC-UNS-001": "capability_absent",
  "MHRC-UNS-003": MH03_AUTHENTICATION_FAILURE_REASON_CODE,
});

// ---------------------------------------------------------------------------
// The production port
// ---------------------------------------------------------------------------

/**
 * The production surface this evaluator drives.
 *
 * Stated as a port so a caller can hand in a boundary that answers differently
 * and observe the verdict change. `MH03_PRODUCTION_BOUNDARY` holds the REAL
 * functions by identity, and it is the default.
 */
export interface Mh03BoundaryPort {
  readonly bindHostRuntimeAdapter: typeof bindHostRuntimeAdapter;
  readonly createHostCapabilitySnapshotStore: typeof createHostCapabilitySnapshotStore;
  readonly normalizeHostEvent: typeof normalizeHostEvent;
}

export const MH03_PRODUCTION_BOUNDARY: Mh03BoundaryPort = Object.freeze({
  bindHostRuntimeAdapter,
  createHostCapabilitySnapshotStore,
  normalizeHostEvent,
});

// ---------------------------------------------------------------------------
// Request / result shapes
// ---------------------------------------------------------------------------

export type Mh03AdapterProvider = (host: string) => unknown;

export interface Mh03ConformanceRequest {
  readonly run_id: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  /** `stable_id` -> committed receipt reference. The receipt journal is MH-06's. */
  readonly receipt_refs: Readonly<Record<string, string>>;
  /** `stable_id` -> typed freshness verdict. `unknown` is not a soft `fresh`. */
  readonly evidence_freshness: Readonly<Record<string, string>>;
  /** The concrete adapter provider the real boundary binds through. */
  readonly adapter_provider: Mh03AdapterProvider;
  /** Defaults to `MH03_PRODUCTION_BOUNDARY`. */
  readonly boundary?: Mh03BoundaryPort;
  /** Present only in a malformed request; its presence is itself the refusal. */
  readonly stable_ids?: readonly string[];
}

export interface Mh03OwnerPacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly NeutralScenarioResult[];
}

/** One scenario's observation record, carried on `outcome.facts.evidence`. */
export interface Mh03ScenarioEvidence {
  readonly stable_id: string;
  readonly satisfied: boolean;
  readonly observed: Readonly<Record<string, unknown>>;
}

export interface Mh03ConformanceResult {
  readonly outcome: NeutralOutcome;
  /** The owner packet, or `null` whenever the request itself was refused. */
  readonly packet: Mh03OwnerPacket | null;
}

// ---------------------------------------------------------------------------
// Source-owned probes
// ---------------------------------------------------------------------------

/**
 * A host to observe the boundary through.
 *
 * The version is a PROBE label, not a live observation: this module reads no
 * environment, so it cannot know a running host's version, and pretending to
 * would make the snapshot hash a claim about a machine nobody inspected. It
 * varies nothing the capability facts depend on.
 */
interface Mh03HostProbe {
  readonly host_id: string;
  readonly host_version: string;
  readonly authentication: HostAuthenticationObservation;
}

const MH03_PROBE_HOST_VERSION = "0.0.0-mh03-probe";

/** A host with a NATIVE hook surface, and no credential observation at all. */
const MH03_NATIVE_HOOK_PROBE: Mh03HostProbe = Object.freeze({
  host_id: "claude-code-cli",
  host_version: MH03_PROBE_HOST_VERSION,
  authentication: "not_observed",
});

/** A host reached through the wrapper, observed with an unusable credential. */
const MH03_WRAPPER_PROBE: Mh03HostProbe = Object.freeze({
  host_id: "codex-cli",
  host_version: MH03_PROBE_HOST_VERSION,
  authentication: "unauthenticated",
});

/**
 * The two bindings MHRC-EVT-001 is about: one hook the host itself emits, one
 * wrapper name for the same operator action on a host with no hook surface. Two
 * genuinely different producers, one semantic image — which is the scenario.
 */
const MH03_SHARED_SEMANTIC_EVENT = "prompt.submit";

const MH03_EVENT_BINDING_PROBES: readonly { readonly host: Mh03HostProbe; readonly native_event: string }[] =
  Object.freeze([
    Object.freeze({ host: MH03_NATIVE_HOOK_PROBE, native_event: "UserPromptSubmit" }),
    Object.freeze({ host: MH03_WRAPPER_PROBE, native_event: "guild.wrapper.prompt_submit" }),
  ]);

/** A native name no host declares. Deliberately not a near-miss of a real one. */
const MH03_UNREGISTERED_NATIVE_EVENT = "guild.mh03.probe.unregistered-native-event";

/** The capability MHRC-UNS-001 probes for ABSENCE on the native-hook host. */
const MH03_ABSENT_CAPABILITY_ID = "host.mcp.http";

/** The capability MHRC-UNS-003 probes for an UNUSABLE CREDENTIAL on the wrapper host. */
const MH03_CREDENTIALED_CAPABILITY_ID = "host.dispatch.selectable";

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

/**
 * Does the caller declare the covered id set?
 *
 * An inherited or accessor-backed tuple is the same channel wearing a different
 * shape, so both count. Only an OWN property whose value is explicitly
 * `undefined` is not a channel.
 */
function declaresCallerScenarioSet(request: unknown): boolean {
  if (request === null || typeof request !== "object") return false;
  if (!("stable_ids" in (request as object))) return false;
  const descriptor = Object.getOwnPropertyDescriptor(request, "stable_ids");
  if (descriptor === undefined) return true;
  if (descriptor.get !== undefined || descriptor.set !== undefined) return true;
  return descriptor.value !== undefined;
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

/** Copy the identity into a fresh record carrying exactly the contract's fields. */
function copyIdentity(identity: NeutralEvidenceIdentity): NeutralEvidenceIdentity {
  const source = identity as unknown as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) copy[field] = source[field];
  return copy as unknown as NeutralEvidenceIdentity;
}

function refuseEvaluation(
  control: string,
  reasonCode: NeutralReasonCode,
  assertions: readonly string[]
): Mh03ConformanceResult {
  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode,
      assertions: [...assertions],
      facts: {
        refusal_control: control,
        owner_key: MH03_CONFORMANCE_OWNER_KEY,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence: [],
      },
    }),
    packet: null,
  };
}

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

interface Mh03BoundHost {
  readonly probe: Mh03HostProbe;
  readonly result: HostRuntimeBindingResult;
  readonly binding: HostRuntimeBinding | null;
}

function bindProbe(
  port: Mh03BoundaryPort,
  store: HostCapabilitySnapshotStore,
  runId: string,
  provider: Mh03AdapterProvider,
  probe: Mh03HostProbe
): Mh03BoundHost {
  const result = port.bindHostRuntimeAdapter({
    host: probe.host_id,
    runId,
    provider: provider as HostAdapterProvider,
    hostVersion: probe.host_version,
    authentication: probe.authentication,
    snapshots: store,
  });
  const binding = result.disposition === "succeeded" ? result.binding : null;
  return { probe, result, binding };
}

function normalizeThrough(bound: Mh03BoundHost, nativeEvent: string): HostEventNormalizationResult | null {
  return bound.binding === null ? null : bound.binding.normalizeEvent(nativeEvent);
}

function snapshotOf(bound: Mh03BoundHost): HostCapabilitySnapshot | null {
  return bound.binding === null ? null : bound.binding.snapshot;
}

function factOf(snapshot: HostCapabilitySnapshot | null, capabilityId: string): HostCapabilityFact | null {
  if (snapshot === null) return null;
  const found = snapshot.capabilities.find((fact) => fact.capability_id === capabilityId);
  return found === undefined ? null : found;
}

function hostIdOf(bound: Mh03BoundHost): string {
  return bound.binding === null ? bound.probe.host_id : bound.binding.host_id;
}

function hostVersionOf(bound: Mh03BoundHost): string {
  const snapshot = snapshotOf(bound);
  return snapshot === null ? bound.probe.host_version : snapshot.host_version;
}

/** Does the registry row behind this binding declare that the host needs a credential? */
function requiresAuth(bound: Mh03BoundHost): boolean {
  return bound.binding === null ? false : bound.binding.entry_point.requires_auth === true;
}

// ---------------------------------------------------------------------------
// The evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the four W2/MH-03 scenarios and hand back one owner packet.
 *
 * Never throws: an unbindable host, an unmapped event and an absent capability
 * are all TYPED answers here, and a malformed request is a typed refusal with no
 * packet at all.
 */
export function evaluateMh03HostAdapterConformance(request: Mh03ConformanceRequest): Mh03ConformanceResult {
  if (declaresCallerScenarioSet(request)) {
    return refuseEvaluation(
      MH03_REFUSAL_CONTROL_CALLER_SUPPLIED_IDS,
      "scenario_required_set_mismatch",
      [
        "the covered scenario set has exactly one source, and it is this module",
        "an agreeing caller-supplied set is refused too, because accepting a matching copy accepts the channel",
      ]
    );
  }
  if (!identityIsComplete(request.evidence_identity)) {
    return refuseEvaluation(MH03_REFUSAL_CONTROL_IDENTITY_INCOMPLETE, "scenario_evidence_incomplete", [
      "evidence that names no complete identity is bound to no runtime",
    ]);
  }
  for (const stableId of MH03_CONFORMANCE_SCENARIO_IDS) {
    const receiptRef = request.receipt_refs === undefined ? undefined : request.receipt_refs[stableId];
    const freshness = request.evidence_freshness === undefined ? undefined : request.evidence_freshness[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return refuseEvaluation(MH03_REFUSAL_CONTROL_EVIDENCE_BINDING_MISSING, "scenario_receipt_reference_missing", [
        "every scenario result commits to a receipt reference",
      ]);
    }
    if (NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS.indexOf(freshness as NeutralEvidenceFreshnessVerdict) === -1) {
      return refuseEvaluation(MH03_REFUSAL_CONTROL_EVIDENCE_BINDING_MISSING, "scenario_evidence_incomplete", [
        "every scenario result carries a typed freshness verdict",
      ]);
    }
  }

  const port = request.boundary === undefined ? MH03_PRODUCTION_BOUNDARY : request.boundary;
  const runId = String(request.run_id === undefined || request.run_id === null ? "" : request.run_id);
  const store = port.createHostCapabilitySnapshotStore();
  const nativeHookHost = bindProbe(port, store, runId, request.adapter_provider, MH03_NATIVE_HOOK_PROBE);
  const wrapperHost = bindProbe(port, store, runId, request.adapter_provider, MH03_WRAPPER_PROBE);
  const boundFor = (probe: Mh03HostProbe): Mh03BoundHost =>
    probe === MH03_WRAPPER_PROBE ? wrapperHost : nativeHookHost;

  // -- MHRC-EVT-001 ---------------------------------------------------------
  // Two real producers, one semantic image. Provenance must survive: an image
  // that no longer names the host and native event it came from is not evidence
  // that THOSE two bindings agree.
  const evt001Bindings = MH03_EVENT_BINDING_PROBES.map((probe) => {
    const bound = boundFor(probe.host);
    const normalized = normalizeThrough(bound, probe.native_event);
    const event = normalized === null ? null : normalized.event;
    return {
      host_id: hostIdOf(bound),
      native_event: probe.native_event,
      source_kind: normalized === null ? "none" : normalized.source_kind,
      normalized_event: event === null || event === undefined ? null : event.name,
      succeeded: normalized !== null && normalized.disposition === "succeeded",
      provenance_host_id: event === null || event === undefined ? null : event.host_native.host_id,
      provenance_native_event: event === null || event === undefined ? null : event.host_native.native_event,
    };
  });
  const evt001SourceKinds = evt001Bindings
    .map((entry) => entry.source_kind)
    .filter((kind, index, all) => all.indexOf(kind) === index);
  const evt001Satisfied =
    evt001Bindings.length >= 2 &&
    evt001SourceKinds.length >= 2 &&
    evt001Bindings.every(
      (entry) =>
        entry.succeeded &&
        entry.normalized_event === MH03_SHARED_SEMANTIC_EVENT &&
        entry.provenance_host_id === entry.host_id &&
        entry.provenance_native_event === entry.native_event
    );

  // -- MHRC-EVT-002 ---------------------------------------------------------
  // The normalizer answers an unregistered native name with a typed REFUSAL
  // carrying `unknown_event`. The frozen scenario states the same fact as an
  // `unsupported` capability_outcome-family disposition, so the mapping happens
  // HERE, at the owner that reports the scenario — never by widening the shared
  // event normalizer, whose four typed answers other consumers depend on.
  const evt002Normalized = normalizeThrough(nativeHookHost, MH03_UNREGISTERED_NATIVE_EVENT);
  const evt002Event = evt002Normalized === null ? null : evt002Normalized.event;
  const evt002ReasonCode = evt002Normalized === null ? null : evt002Normalized.reason_code;
  const evt002Satisfied =
    evt002Normalized !== null &&
    evt002Normalized.disposition !== "succeeded" &&
    evt002ReasonCode === MH03_SATISFIED_REASON_CODES["MHRC-EVT-002"] &&
    (evt002Event === null || evt002Event === undefined);

  // -- MHRC-UNS-001 ---------------------------------------------------------
  const uns001Snapshot = snapshotOf(nativeHookHost);
  const uns001Fact = factOf(uns001Snapshot, MH03_ABSENT_CAPABILITY_ID);
  const uns001Satisfied = uns001Fact !== null && uns001Fact.supported === false;

  // -- MHRC-UNS-003 ---------------------------------------------------------
  // A SUPPORTED capability whose credential is not usable, on a host whose own
  // registry row says a credential is required. Absence would be MHRC-UNS-001;
  // conflating the two is the whole defect this scenario exists to catch.
  const uns003Snapshot = snapshotOf(wrapperHost);
  const uns003Fact = factOf(uns003Snapshot, MH03_CREDENTIALED_CAPABILITY_ID);
  const uns003RequiresAuth = requiresAuth(wrapperHost);
  const uns003Satisfied =
    uns003Fact !== null &&
    uns003Fact.supported === true &&
    uns003Fact.authenticated === false &&
    uns003RequiresAuth;

  const observations: Readonly<Record<string, Record<string, unknown>>> = {
    "MHRC-EVT-001": {
      normalized_event: evt001Satisfied ? MH03_SHARED_SEMANTIC_EVENT : null,
      bindings: evt001Bindings.map((entry) => ({
        host_id: entry.host_id,
        native_event: entry.native_event,
        source_kind: entry.source_kind,
        normalized_event: entry.normalized_event,
        provenance_host_id: entry.provenance_host_id,
        provenance_native_event: entry.provenance_native_event,
      })),
      source_kinds: [...evt001SourceKinds],
    },
    "MHRC-EVT-002": {
      host_id: hostIdOf(nativeHookHost),
      native_event: MH03_UNREGISTERED_NATIVE_EVENT,
      normalized_event: evt002Event === null || evt002Event === undefined ? null : evt002Event.name,
      boundary_disposition: evt002Normalized === null ? null : evt002Normalized.disposition,
      boundary_reason_code: evt002ReasonCode,
    },
    "MHRC-UNS-001": {
      host_id: hostIdOf(nativeHookHost),
      host_version: hostVersionOf(nativeHookHost),
      authentication: nativeHookHost.probe.authentication,
      capability_id: MH03_ABSENT_CAPABILITY_ID,
      supported: uns001Fact === null ? null : uns001Fact.supported,
      authenticated: uns001Fact === null ? null : uns001Fact.authenticated,
      snapshot_hash: uns001Snapshot === null ? null : uns001Snapshot.snapshot_hash,
      fallback_selected: false,
    },
    "MHRC-UNS-003": {
      host_id: hostIdOf(wrapperHost),
      host_version: hostVersionOf(wrapperHost),
      authentication: wrapperHost.probe.authentication,
      capability_id: MH03_CREDENTIALED_CAPABILITY_ID,
      supported: uns003Fact === null ? null : uns003Fact.supported,
      authenticated: uns003Fact === null ? null : uns003Fact.authenticated,
      requires_auth: uns003RequiresAuth,
      snapshot_hash: uns003Snapshot === null ? null : uns003Snapshot.snapshot_hash,
      fallback_selected: false,
    },
  };

  const satisfaction: Readonly<Record<string, boolean>> = {
    "MHRC-EVT-001": evt001Satisfied,
    "MHRC-EVT-002": evt002Satisfied,
    "MHRC-UNS-001": uns001Satisfied,
    "MHRC-UNS-003": uns003Satisfied,
  };

  const evidence: Mh03ScenarioEvidence[] = MH03_CONFORMANCE_SCENARIO_IDS.map((stableId) => ({
    stable_id: stableId,
    satisfied: satisfaction[stableId] === true,
    observed: observations[stableId],
  }));

  const results: NeutralScenarioResult[] = MH03_CONFORMANCE_SCENARIOS.map((scenario) => {
    const stableId = scenario.stable_id;
    const satisfied = satisfaction[stableId] === true;
    return {
      stable_id: stableId,
      outcome_type: scenario.expected_typed_outcome.type,
      disposition: satisfied ? scenario.expected_typed_outcome.disposition : "failed",
      reason_code: satisfied ? MH03_SATISFIED_REASON_CODES[stableId] : MH03_UNSATISFIED_REASON_CODE,
      receipt_ref: request.receipt_refs[stableId],
      evidence_identity: copyIdentity(request.evidence_identity),
      evidence_freshness: request.evidence_freshness[stableId] as NeutralEvidenceFreshnessVerdict,
    };
  });

  const allSatisfied = evidence.every((entry) => entry.satisfied);

  const packet: Record<string, unknown> = {
    schema_version: MH03_CONFORMANCE_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: MH03_CONFORMANCE_OWNER_KEY,
    evidence_identity: copyIdentity(request.evidence_identity),
    stable_ids: [...MH03_CONFORMANCE_SCENARIO_IDS],
    results,
  };

  return {
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: allSatisfied ? "succeeded" : "failed",
      reason_code: allSatisfied ? null : (MH03_UNSATISFIED_REASON_CODE as NeutralReasonCode),
      assertions: [
        "each of the four W2/MH-03 scenarios was evaluated against the real host-adapter boundary",
        "two host-native producers were normalized through their own bindings, provenance retained",
        "an unregistered native event is reported unsupported and synthesizes no success event",
        "an unusable credential on a supported capability is failed, never unsupported",
        "no lifecycle policy, promotion decision, assembly, or signature verification happens here",
      ],
      binding: { run_id: runId },
      facts: {
        owner_key: MH03_CONFORMANCE_OWNER_KEY,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        evidence,
        evaluated_hosts: [hostIdOf(nativeHookHost), hostIdOf(wrapperHost)],
        binding_dispositions: {
          [hostIdOf(nativeHookHost)]: nativeHookHost.result.disposition,
          [hostIdOf(wrapperHost)]: wrapperHost.result.disposition,
        },
      },
    }),
    packet: neutralFreeze(packet) as unknown as Mh03OwnerPacket,
  };
}
