/**
 * src/modules/distribution/workflows/release-conformance-integration.ts
 *
 * A21-X — the production release-conformance integration seam.
 *
 * WHAT THIS FILE IS
 *   The assembly spine (`neutral-conformance-assembly`) can join six owner
 *   packets into one frozen 31-scenario aggregate, and each owner boundary
 *   ships its own real evaluator — but until this module, nothing in
 *   production PRODUCED those six packets. This is the join's driver: ONE
 *   canonical JSON request in, six REAL owner evaluations run, six immutable
 *   packets collected under one evidence identity, and the real assembler
 *   called over them. The result is `{ outcome, evidence, packets }` — the
 *   aggregate the release emitter records and the promotion gate re-derives.
 *
 *   The owner boundaries and the assembler this module binds, by name (each is
 *   imported through its owning module's public index, which is the shape the
 *   module-boundary checker requires of a cross-module consumer):
 *
 *     neutral-conformance-core                 W1/MH-02 (driven here, see below)
 *     host-adapter-conformance-evaluator       W2/MH-03
 *     receipt-journal-conformance-evaluator    W1/MH-06
 *     module-boundary-conformance-evaluator    W4/MH-07
 *     host-cutover-controller                  W4/MH-08
 *     release-conformance-evaluator            W5/MH-09
 *     neutral-conformance-assembly             the spine
 *
 *   W1/MH-02 has no standalone packet evaluator: its five scenarios ARE the
 *   neutral lifecycle machine and gate policy. This module therefore drives
 *   the REAL machine — real phase entries, a real gate refusal, real
 *   compact/resume, a real evidence-gated close, a real policy-vs-capability
 *   distinction — and reports the machine's own typed outcomes. Nothing is
 *   manufactured: a probe whose observed outcome is not the outcome the core's
 *   scenario registry declares fails the whole integration closed.
 *
 * WHAT THIS FILE IS NOT
 *   It takes NO promotion decision of its own and verifies NO signature. The
 *   MH-02 decision (`evaluateNeutralConformanceDecision`) still owns promotion
 *   and the attestor trust root; `evaluateTransportedReleaseConformance` below
 *   is how the emitter and the channel gate re-run that decision over a
 *   transported full-suite evidence — re-deriving the six owner packets from
 *   source-owned constants and re-assembling through the REAL assembler, so a
 *   claimed verdict or a claimed count is never trusted. The repository holds
 *   no production attestor material, so the final decision still fails closed
 *   without external quorum authority; a promotable 31/31 remains an operator
 *   act even though the production owner-evaluation path itself is executable.
 *
 * THE REQUEST BOUNDARY IS TEXT
 *   Exactly as the assembly spine and MH-09: the request is ONE canonical JSON
 *   string, size- and depth-bounded BEFORE parse, refused unread when it is
 *   not a string (no key enumerated, no property read, no proxy trap
 *   reachable), and required to re-canonicalize to the exact bytes that
 *   arrived. The member vocabulary is closed: `claim` and `owner_inputs`,
 *   nothing else. Every caller channel toward outcomes is refused by name:
 *   a supplied packet set, a supplied required-scenario tuple, and any
 *   owner-input member that carries results, stable ids, or outcomes.
 *   `owner_inputs` carries RAW inputs only — a run id, receipt references and
 *   freshness verdicts (evidence BINDINGS, produced elsewhere, transported
 *   verbatim, never minted here), disposable journal roots, the module tree
 *   under evaluation, and the raw scenario evidence the MH-08/MH-09
 *   evaluators consume under their own contracts.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  applyNeutralLifecycleEvent,
  assembleNeutralConformanceEvidence,
  evaluateNeutralConformanceDecision,
  evaluateNeutralModuleBoundaries,
  freezeNeutralCapabilitySnapshot,
  NEUTRAL_ATTESTATION_CHAINS,
  NEUTRAL_ATTESTATION_TREE_HEIGHT,
  NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  NEUTRAL_CONFORMANCE_OWNER_KEYS,
  NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS,
  NEUTRAL_CONTRACT_VERSION,
  NEUTRAL_CORE_MEMBERS,
  NEUTRAL_CORE_SCENARIOS,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_OWNER_SCENARIO_IDS,
  NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT,
  NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  neutralCanonicalJson,
  neutralAttestationReference,
  neutralFreeze,
  neutralInitialLifecycleState,
  neutralJournalEntryCommitment,
  neutralJournalGenesis,
  neutralLifecycleEquivalent,
  neutralLifecycleFingerprint,
  neutralOutcome,
} from "../../lifecycle";
import type {
  NeutralCapabilitySnapshot,
  NeutralConformanceAuthority,
  NeutralConformanceEvidence,
  NeutralEvidenceIdentity,
  NeutralGate,
  NeutralLifecycleEvent,
  NeutralLifecycleState,
  NeutralOutcome,
  NeutralOwnerConformancePacket,
  NeutralPolicy,
  NeutralReasonCode,
  NeutralReceiptJournalEntry,
  NeutralScenarioResult,
} from "../../lifecycle";
import { evaluateMh03HostAdapterConformance, HOST_ADAPTER_OPERATIONS } from "../../host-runtime";
import type { Mh03ConformanceRequest } from "../../host-runtime";
import { evaluateReceiptJournalConformance } from "../../telemetry";
import type { Mh06ConformanceRequest } from "../../telemetry";
import { evaluateHostCutoverConformance } from "../../migrations";
import { evaluateReleaseConformance } from "./release-conformance-evaluator";

// ---------------------------------------------------------------------------
// The pinned public vocabulary
// ---------------------------------------------------------------------------

/** The two request members. A canonical text declaring anything else refuses. */
export const RELEASE_INTEGRATION_REQUEST_MEMBERS: readonly string[] = neutralFreeze([
  "claim",
  "owner_inputs",
]);

/** The six owners, exactly the assembly spine's tuple — never a fork of it. */
export const RELEASE_INTEGRATION_OWNER_KEYS: readonly string[] = NEUTRAL_CONFORMANCE_OWNER_KEYS;

/**
 * The owner boundaries and the assembler this integration binds, as bare
 * module filenames. A documentation constant AND a source-level statement the
 * focused suite pins: the behavioral binding is the index imports above; this
 * tuple is the greppable record that all seven are named by this file.
 */
export const RELEASE_INTEGRATION_OWNER_BOUNDARIES: readonly string[] = neutralFreeze([
  "neutral-conformance-core",
  "host-adapter-conformance-evaluator",
  "receipt-journal-conformance-evaluator",
  "module-boundary-conformance-evaluator",
  "host-cutover-controller",
  "release-conformance-evaluator",
  "neutral-conformance-assembly",
]);

/** Admission bounds. The request is refused BEFORE parsing when it exceeds them. */
export const RELEASE_INTEGRATION_MAX_REQUEST_CHARS = 2_000_000;
export const RELEASE_INTEGRATION_MAX_REQUEST_DEPTH = 64;

const CONTROL_NOT_TEXT = "integration_request_not_canonical_text";
const CONTROL_CALLER_PACKETS = "caller_supplied_packets";
const CONTROL_CALLER_REQUIRED_SET = "caller_supplied_required_set";
const CONTROL_CALLER_OUTCOMES = "caller_supplied_outcomes";
const CONTROL_OWNER_FAILED = "owner_evaluation_failed";
const CONTROL_CLAIM_INCOMPLETE = "integration_claim_incomplete";
const CONTROL_ASSEMBLY_REFUSED = "integration_assembly_refused";

/**
 * Every refusal path this module can take, named. The first five are the
 * pinned contract; the last two are this module's own diagnoses (an
 * unverifiable claim, and an aggregate the real assembler refused).
 */
export const RELEASE_INTEGRATION_REFUSAL_CONTROLS: readonly string[] = neutralFreeze([
  CONTROL_NOT_TEXT,
  CONTROL_CALLER_PACKETS,
  CONTROL_CALLER_REQUIRED_SET,
  CONTROL_CALLER_OUTCOMES,
  CONTROL_OWNER_FAILED,
  CONTROL_CLAIM_INCOMPLETE,
  CONTROL_ASSEMBLY_REFUSED,
]);

/**
 * The closed owner-input member vocabulary. Every member is a RAW input:
 * nothing here can carry a scenario id set, a result, or an outcome — those
 * arrive only as evaluator-produced packets, and a member that smuggles one is
 * refused by the forbidden-key scan before this vocabulary is even consulted.
 */
export const RELEASE_INTEGRATION_OWNER_INPUT_MEMBERS: readonly string[] = neutralFreeze([
  "run_id",
  "receipt_refs",
  "evidence_freshness",
  "journal_root",
  "migration_journal_root",
  "migration_scenario_evidence",
  "migration_scope",
  "plugin_root",
  "consumer_roots",
  "release_mode",
  "release_scenario_evidence",
]);

/**
 * Keys that NAME an outcome channel. Found at the top level of `owner_inputs`
 * or at the top level of any direct sub-record, the request is refused: a
 * caller that can hand this module a result, a covered id set, or a verdict
 * has authored the truth the evaluators exist to produce. The scan is
 * deliberately two levels deep and no deeper — below that live the raw
 * evidence documents the MH-08/MH-09 evaluators admit under their OWN closed
 * contracts, which is where their policing belongs.
 */
const FORBIDDEN_OWNER_INPUT_KEYS: readonly string[] = neutralFreeze([
  "results",
  "stable_ids",
  "outcomes",
  "outcome",
  "disposition",
  "reason_code",
  "receipt_ref",
  "packets",
  "required_scenario_ids",
]);

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface ReleaseIntegrationResult {
  readonly outcome: NeutralOutcome;
  /** The assembled 31-scenario aggregate, or `null` whenever refused. */
  readonly evidence: NeutralConformanceEvidence | null;
  /** The six owner packets the aggregate was assembled from, or `null`. */
  readonly packets: readonly NeutralOwnerConformancePacket[] | null;
}

export type ReleaseIntegrationFunction = (request: unknown) => ReleaseIntegrationResult;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownField(value: unknown, field: string): unknown {
  if (!isRecord(value)) return undefined;
  if (Object.keys(value).indexOf(field) === -1) return undefined;
  return value[field];
}

function hasOwnMember(value: unknown, field: string): boolean {
  return isRecord(value) && Object.keys(value).indexOf(field) !== -1;
}

function identityIsComplete(identity: unknown): boolean {
  if (!isRecord(identity)) return false;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    const value = ownField(identity, field);
    if (field === "contract_version") {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      continue;
    }
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

/** A non-aliasing copy of exactly the identity tuple, and nothing else. */
function copyIdentity(identity: unknown): NeutralEvidenceIdentity {
  const copy: Record<string, unknown> = {};
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) copy[field] = ownField(identity, field);
  return copy as unknown as NeutralEvidenceIdentity;
}

/** A string-valued map (stable id -> string), copied without foreign members. */
function copyStringMap(value: unknown): Record<string, string> {
  const copy: Record<string, string> = {};
  if (!isRecord(value)) return copy;
  for (const key of Object.keys(value)) {
    const entry = value[key];
    if (typeof entry === "string") copy[key] = entry;
  }
  return copy;
}

/**
 * Maximum bracket-nesting depth of the raw text, computed ITERATIVELY so an
 * over-deep request is refused before anything recursive touches it. Same
 * discipline as the MH-09 admission.
 */
function textBracketDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === "}" || ch === "]") depth -= 1;
  }
  return max;
}

function refuse(
  control: string,
  reasonCode: NeutralReasonCode,
  assertions: readonly string[],
  facts: Record<string, unknown>
): ReleaseIntegrationResult {
  const merged: Record<string, unknown> = {};
  for (const key of Object.keys(facts)) merged[key] = facts[key];
  merged.refusal_control = control;
  merged.suite_id = NEUTRAL_SCENARIO_SUITE_ID;
  merged.suite_version = NEUTRAL_SCENARIO_SUITE_VERSION;
  merged.required_scenario_count = NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT;
  return neutralFreeze({
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "refused",
      reason_code: reasonCode,
      assertions: [...assertions],
      binding: { contract_version: NEUTRAL_CONTRACT_VERSION },
      facts: merged,
    }),
    evidence: null,
    packets: null,
  }) as ReleaseIntegrationResult;
}

// ---------------------------------------------------------------------------
// Request decode — canonical text, closed members, closed caller channels
// ---------------------------------------------------------------------------

interface IntegrationDecode {
  readonly claim: Record<string, unknown>;
  readonly ownerInputs: Record<string, unknown>;
  readonly refusal: ReleaseIntegrationResult | null;
}

function refusedDecode(refusal: ReleaseIntegrationResult): IntegrationDecode {
  return { claim: {}, ownerInputs: {}, refusal };
}

function notText(requestKind: string, detail: string): IntegrationDecode {
  return refusedDecode(
    refuse(
      CONTROL_NOT_TEXT,
      "scenario_contract_version_unrecognized",
      [
        "the integration request is one canonical JSON text carrying exactly the claim and the raw owner inputs",
        "a direct object, array, proxy, or accessor-bearing input is refused without being inspected: no key is enumerated, no property is read or written, no descriptor is requested",
        "a text that is not the canonical form of what it decodes to is refused, so the validated snapshot is the transmitted one",
      ],
      // `typeof` answers for a proxy without reaching a trap; the detail is
      // this module's own phrase — no fragment of the request is echoed back.
      { request_kind: requestKind, request_detail: detail }
    )
  );
}

function decodeIntegrationRequest(request: unknown): IntegrationDecode {
  if (typeof request !== "string") {
    return notText(typeof request, "the request must be one canonical JSON text");
  }
  if (request.length > RELEASE_INTEGRATION_MAX_REQUEST_CHARS) {
    return notText("string", "the request text exceeds the character admission bound");
  }
  if (textBracketDepth(request) > RELEASE_INTEGRATION_MAX_REQUEST_DEPTH) {
    return notText("string", "the request text exceeds the depth admission bound");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(request);
  } catch {
    return notText("string", "the request text is not well-formed JSON");
  }
  if (!isRecord(parsed)) {
    return notText("string", "the request text must decode to a JSON object");
  }
  let recanonicalized: string;
  try {
    recanonicalized = neutralCanonicalJson(parsed);
  } catch {
    return notText("string", "the request text could not be re-canonicalized for comparison");
  }
  if (recanonicalized !== request) {
    return notText("string", "the request text is not the canonical form of what it decodes to");
  }

  const members = Object.keys(parsed).slice().sort();
  // A packet set is the one channel with its own name: refusing it as a
  // generic shape error would hide WHICH door the caller knocked on.
  if (members.indexOf("packets") !== -1) {
    return refusedDecode(
      refuse(
        CONTROL_CALLER_PACKETS,
        "scenario_required_set_mismatch",
        [
          "owner packets are produced by the six real owner evaluations, never accepted from the caller",
          "a plausible caller-supplied packet set is refused too, because accepting a matching copy accepts the channel that can differ",
        ],
        {}
      )
    );
  }
  if (members.join("|") !== RELEASE_INTEGRATION_REQUEST_MEMBERS.slice().sort().join("|")) {
    return notText("string", "the request declares exactly the claim and the owner inputs, and nothing else");
  }

  const claim = ownField(parsed, "claim");
  if (!isRecord(claim)) {
    return refusedDecode(
      refuse(
        CONTROL_CLAIM_INCOMPLETE,
        "scenario_evidence_incomplete",
        ["an integration run needs a claim that names its claimant and its activated runtime"],
        { incomplete_field: "claim" }
      )
    );
  }
  if (hasOwnMember(claim, "required_scenario_ids")) {
    return refusedDecode(
      refuse(
        CONTROL_CALLER_REQUIRED_SET,
        "scenario_required_set_mismatch",
        [
          "the required scenario tuple has exactly one source, and it is the assembly spine",
          "a caller-supplied tuple is refused even when it agrees, because accepting a matching copy accepts the channel that can differ",
        ],
        {}
      )
    );
  }

  const ownerInputs = ownField(parsed, "owner_inputs");
  if (!isRecord(ownerInputs)) {
    return notText("string", "the owner inputs must decode to a JSON object of raw inputs");
  }

  // The two-level forbidden-key scan: the caller may not author outcomes,
  // covered id sets, results, or receipt bindings under any member name.
  const offendingKeys: string[] = [];
  for (const memberKey of Object.keys(ownerInputs)) {
    if (FORBIDDEN_OWNER_INPUT_KEYS.indexOf(memberKey) !== -1) offendingKeys.push(memberKey);
    const memberValue = ownerInputs[memberKey];
    const nestedRecords: unknown[] = Array.isArray(memberValue) ? memberValue : [memberValue];
    for (const nested of nestedRecords) {
      if (!isRecord(nested)) continue;
      for (const nestedKey of Object.keys(nested)) {
        if (FORBIDDEN_OWNER_INPUT_KEYS.indexOf(nestedKey) !== -1) {
          offendingKeys.push(`${memberKey}.${nestedKey}`);
        }
      }
    }
  }
  if (offendingKeys.length > 0) {
    return refusedDecode(
      refuse(
        CONTROL_CALLER_OUTCOMES,
        "scenario_result_mismatch",
        [
          "scenario ids, results, and outcomes are produced by the real owner evaluations, never accepted from the caller",
          "an owner-input member that carries them is the false-conformance shortcut this refusal exists for",
        ],
        { offending_member_count: offendingKeys.length }
      )
    );
  }
  for (const memberKey of Object.keys(ownerInputs)) {
    if (RELEASE_INTEGRATION_OWNER_INPUT_MEMBERS.indexOf(memberKey) === -1) {
      return notText("string", "the owner-input member vocabulary is closed; an undeclared member is a channel");
    }
  }

  return { claim, ownerInputs, refusal: null };
}

// ---------------------------------------------------------------------------
// W1/MH-02 — the five core scenarios, driven against the REAL machine
// ---------------------------------------------------------------------------

/**
 * Source-owned probe fixtures. Two hosts with byte-identical capability FACTS
 * and different host identities, one policy, two gates — the minimum surface
 * the five scenarios genuinely exercise. The values are authored here the same
 * way the assembly spine authors its control identity: this module performs
 * the drive, so it owns the probe.
 */
const MH02_SNAPSHOT_HASH = "sha256:a21x-mh02-probe-capability-snapshot";
const MH02_SUPPORTED_CAPABILITY = "guild.tool.write";
const MH02_ABSENT_CAPABILITY = "guild.a21x.absent.capability";
const MH02_DENIED_OPERATION = "a21x.policy.denied.operation";
const MH02_ALLOWED_OPERATION = "a21x.policy.allowed.operation";
const MH02_CONDITION_GATE = "a21x-conditioned-gate";
const MH02_OPEN_GATE = "a21x-open-gate";
const MH02_OBSERVATION = "a21x-required-observation";

const MH02_POLICY: NeutralPolicy = neutralFreeze({
  policy_version: "guild.a21x.probe-policy.v1",
  denied_operations: [MH02_DENIED_OPERATION],
  approval_required_operations: [],
}) as NeutralPolicy;

const MH02_GATES: readonly NeutralGate[] = neutralFreeze([
  {
    gate_id: MH02_CONDITION_GATE,
    phase: "build",
    operation_class: "mutating",
    required_conditions: ["approval_recorded"],
  },
  {
    gate_id: MH02_OPEN_GATE,
    phase: "build",
    operation_class: "mutating",
    required_conditions: [],
  },
]) as readonly NeutralGate[];

interface Mh02HostProbe {
  readonly host_id: string;
  readonly host_version: string;
}

const MH02_HOST_PROBES: readonly Mh02HostProbe[] = neutralFreeze([
  { host_id: "claude-code-cli", host_version: "0.0.0-a21x-probe" },
  { host_id: "codex-cli", host_version: "0.0.0-a21x-probe" },
]) as readonly Mh02HostProbe[];

function mh02Snapshot(probe: Mh02HostProbe): NeutralCapabilitySnapshot {
  return freezeNeutralCapabilitySnapshot({
    snapshot_hash: MH02_SNAPSHOT_HASH,
    host_id: probe.host_id,
    host_version: probe.host_version,
    capabilities: [
      { capability_id: MH02_SUPPORTED_CAPABILITY, supported: true, authenticated: true },
    ],
  });
}

function mh02State(
  probe: Mh02HostProbe,
  runId: string,
  overrides: { required_gate_ids?: readonly string[]; required_observations?: readonly string[] } = {}
): NeutralLifecycleState {
  return neutralInitialLifecycleState({
    run_id: runId,
    capability_snapshot_hash: MH02_SNAPSHOT_HASH,
    phase: "init",
    required_gate_ids: overrides.required_gate_ids,
    required_observations: overrides.required_observations,
    admission_context: { snapshot: mh02Snapshot(probe), policy: MH02_POLICY, gates: MH02_GATES },
  });
}

function mh02Event(
  probe: Mh02HostProbe,
  name: NeutralLifecycleEvent["name"],
  transitionId: string,
  input: Record<string, unknown>
): NeutralLifecycleEvent {
  return {
    name,
    transition_id: transitionId,
    capability_snapshot_hash: MH02_SNAPSHOT_HASH,
    input,
    host_native: { host_id: probe.host_id, host_version: probe.host_version },
  };
}

interface Mh02ProbeObservation {
  readonly outcome_type: string;
  readonly disposition: string;
  readonly reason_code: string | null;
}

/** MHRC-LIF-001 — equivalent phase entry produces equivalent lifecycle state. */
function mh02ProbePhaseEquivalence(runId: string): Mh02ProbeObservation | null {
  const phases = ["ideate", "plan", "build", "qa", "ops"] as const;
  const finals: NeutralLifecycleState[] = [];
  let lastOutcome: NeutralOutcome | null = null;
  for (const probe of MH02_HOST_PROBES) {
    let state = mh02State(probe, runId);
    for (const phase of phases) {
      const transition = applyNeutralLifecycleEvent(
        state,
        mh02Event(probe, "prompt.submit", `a21x-lif001-${phase}`, {
          semantic_intent: "enter_phase",
          phase,
        })
      );
      if (transition.outcome.disposition !== "succeeded") return null;
      if (transition.outcome.facts?.lifecycle_decision !== "phase_entered") return null;
      state = transition.state;
      lastOutcome = transition.outcome;
    }
    finals.push(state);
  }
  if (finals.length !== 2 || !neutralLifecycleEquivalent(finals[0], finals[1])) return null;
  if (lastOutcome === null || lastOutcome.type !== "guild.lifecycle_outcome.v1") return null;
  return { outcome_type: lastOutcome.type, disposition: "succeeded", reason_code: null };
}

/** MHRC-LIF-002 — equivalent gate violation produces equivalent refusal. */
function mh02ProbeGateRefusal(runId: string): Mh02ProbeObservation | null {
  const observed: Mh02ProbeObservation[] = [];
  for (const probe of MH02_HOST_PROBES) {
    const state = mh02State(probe, runId);
    const before = neutralLifecycleFingerprint(state);
    const transition = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "tool.before", "a21x-lif002-violation", {
        gate_id: MH02_CONDITION_GATE,
        operation: MH02_ALLOWED_OPERATION,
        required_capability: MH02_SUPPORTED_CAPABILITY,
        operation_class: "mutating",
        satisfied_conditions: [],
      })
    );
    if (transition.state_changed) return null;
    if (neutralLifecycleFingerprint(transition.state) !== before) return null;
    if (transition.outcome.disposition !== "refused") return null;
    if (transition.outcome.type !== "guild.lifecycle_outcome.v1") return null;
    observed.push({
      outcome_type: transition.outcome.type,
      disposition: transition.outcome.disposition,
      reason_code: transition.outcome.reason_code ?? null,
    });
  }
  if (observed.length !== 2) return null;
  if (observed[0].reason_code !== observed[1].reason_code) return null;
  if (observed[0].reason_code !== "gate_unsatisfied") return null;
  return observed[0];
}

/** MHRC-LIF-003 — compaction and resume preserve lifecycle identity. */
function mh02ProbeCompactResume(runId: string): Mh02ProbeObservation | null {
  const probe = MH02_HOST_PROBES[0];
  let state = mh02State(probe, runId);
  const enter = applyNeutralLifecycleEvent(
    state,
    mh02Event(probe, "prompt.submit", "a21x-lif003-enter", { semantic_intent: "enter_phase", phase: "plan" })
  );
  if (enter.outcome.disposition !== "succeeded") return null;
  state = enter.state;
  const compact = applyNeutralLifecycleEvent(
    state,
    mh02Event(probe, "context.compact", "a21x-lif003-compact", { then: "run.resume" })
  );
  if (compact.outcome.disposition !== "succeeded") return null;
  const resume = applyNeutralLifecycleEvent(
    compact.state,
    mh02Event(probe, "run.resume", "a21x-lif003-resume", {})
  );
  if (resume.outcome.disposition !== "succeeded") return null;
  const resumed = resume.state;
  if (resumed.run_id !== state.run_id) return null;
  if (resumed.capability_snapshot_hash !== state.capability_snapshot_hash) return null;
  if (resumed.phase !== state.phase) return null;
  if (resumed.checkpoint_sequence !== state.checkpoint_sequence + 2) return null;
  // Already-applied transitions are not repeated: replaying the phase entry is
  // an idempotent no-op, never a second application.
  const replay = applyNeutralLifecycleEvent(
    resumed,
    mh02Event(probe, "prompt.submit", "a21x-lif003-enter", { semantic_intent: "enter_phase", phase: "plan" })
  );
  if (replay.state_changed || replay.outcome.disposition !== "succeeded") return null;
  if (replay.outcome.facts?.idempotent_replay !== true) return null;
  if (resume.outcome.type !== "guild.lifecycle_outcome.v1") return null;
  return { outcome_type: resume.outcome.type, disposition: "succeeded", reason_code: null };
}

/** MHRC-LIF-004 — run close requires equivalent terminal evidence. */
function mh02ProbeEvidenceGatedClose(runId: string): Mh02ProbeObservation | null {
  const terminalOutcomes: NeutralOutcome[] = [];
  for (const probe of MH02_HOST_PROBES) {
    let state = mh02State(probe, runId, {
      required_gate_ids: [MH02_OPEN_GATE],
      required_observations: [MH02_OBSERVATION],
    });
    // The negative arm first: a close with no terminal evidence refuses.
    const premature = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "run.stop", "a21x-lif004-premature", { requested_terminal_state: "completed" })
    );
    if (premature.state_changed || premature.outcome.disposition !== "refused") return null;
    if (premature.outcome.reason_code !== "required_observation_missing") return null;
    // Then satisfy the required observation and gate for real.
    const observe = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "receipt.append", "a21x-lif004-observe", {
        observation: MH02_OBSERVATION,
        observation_state: "checked_clean",
      })
    );
    if (observe.outcome.disposition !== "succeeded") return null;
    state = observe.state;
    const admit = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "tool.before", "a21x-lif004-admit", {
        gate_id: MH02_OPEN_GATE,
        operation: MH02_ALLOWED_OPERATION,
        required_capability: MH02_SUPPORTED_CAPABILITY,
        operation_class: "mutating",
        satisfied_conditions: [],
      })
    );
    if (admit.outcome.disposition !== "succeeded") return null;
    state = admit.state;
    const close = applyNeutralLifecycleEvent(
      state,
      mh02Event(probe, "run.stop", "a21x-lif004-close", { requested_terminal_state: "completed" })
    );
    if (close.outcome.disposition !== "succeeded") return null;
    if (close.state.status !== "completed") return null;
    terminalOutcomes.push(close.outcome);
  }
  if (terminalOutcomes.length !== 2) return null;
  if (terminalOutcomes[0].type !== "guild.lifecycle_outcome.v1") return null;
  if (terminalOutcomes[0].reason_code !== terminalOutcomes[1].reason_code) return null;
  return { outcome_type: terminalOutcomes[0].type, disposition: "succeeded", reason_code: null };
}

/** MHRC-UNS-002 — policy refusal is distinct from unsupported capability. */
function mh02ProbePolicyDistinction(runId: string): Mh02ProbeObservation | null {
  const probe = MH02_HOST_PROBES[0];
  const state = mh02State(probe, runId);
  const denied = applyNeutralLifecycleEvent(
    state,
    mh02Event(probe, "tool.before", "a21x-uns002-denied", {
      gate_id: MH02_OPEN_GATE,
      operation: MH02_DENIED_OPERATION,
      required_capability: MH02_SUPPORTED_CAPABILITY,
      operation_class: "mutating",
      satisfied_conditions: [],
    })
  );
  if (denied.state_changed) return null;
  if (denied.outcome.type !== "guild.policy_outcome.v1") return null;
  if (denied.outcome.disposition !== "refused") return null;
  if (denied.outcome.reason_code !== "policy_denied") return null;
  if (denied.outcome.facts?.capability_supported !== true) return null;
  // The distinction arm: an absent capability answers as UNSUPPORTED, with a
  // different typed outcome — proving refusal and unsupported never conflate.
  const absent = applyNeutralLifecycleEvent(
    state,
    mh02Event(probe, "tool.before", "a21x-uns002-absent", {
      gate_id: MH02_OPEN_GATE,
      operation: MH02_ALLOWED_OPERATION,
      required_capability: MH02_ABSENT_CAPABILITY,
      operation_class: "mutating",
      satisfied_conditions: [],
    })
  );
  if (absent.outcome.type !== "guild.capability_outcome.v1") return null;
  if (absent.outcome.disposition !== "unsupported") return null;
  return {
    outcome_type: denied.outcome.type,
    disposition: denied.outcome.disposition,
    reason_code: denied.outcome.reason_code ?? null,
  };
}

type Mh02Probe = (runId: string) => Mh02ProbeObservation | null;

/** The five probes, positionally aligned with the owner's canonical id slice. */
const MH02_PROBES: readonly Mh02Probe[] = [
  mh02ProbePhaseEquivalence,
  mh02ProbeGateRefusal,
  mh02ProbeCompactResume,
  mh02ProbeEvidenceGatedClose,
  mh02ProbePolicyDistinction,
];

/**
 * Drive the five W1/MH-02 scenarios against the real machine and hand back one
 * owner packet, or `null` with a detail when any probe's observed outcome is
 * not the outcome the core's scenario registry declares. The registry is the
 * cross-check: probe `i` answers the scenario at position `i` of the owner's
 * canonical slice, and its observed type/disposition must equal that
 * scenario's `expected_typed_outcome` — a drift between the two is a failure,
 * never a repair.
 */
function evaluateMh02CoreConformance(
  runId: string,
  identity: NeutralEvidenceIdentity,
  receiptRefs: Readonly<Record<string, string>>,
  freshness: Readonly<Record<string, string>>
): { packet: NeutralOwnerConformancePacket | null; detail: string | null } {
  const ownerKey = NEUTRAL_CONFORMANCE_OWNER_KEYS[0];
  const ownerIds = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
  const registryIds = NEUTRAL_CORE_SCENARIOS.map((scenario) => scenario.stable_id);
  if (ownerIds.length !== MH02_PROBES.length || registryIds.join("|") !== ownerIds.join("|")) {
    return { packet: null, detail: "core scenario registry and owner slice disagree" };
  }
  const results: NeutralScenarioResult[] = [];
  for (let index = 0; index < ownerIds.length; index += 1) {
    const stableId = ownerIds[index];
    const expected = NEUTRAL_CORE_SCENARIOS[index].expected_typed_outcome;
    const receiptRef = receiptRefs[stableId];
    const freshnessVerdict = freshness[stableId];
    if (typeof receiptRef !== "string" || receiptRef.length === 0) {
      return { packet: null, detail: "a scenario has no receipt reference binding" };
    }
    if (typeof freshnessVerdict !== "string" || freshnessVerdict.length === 0) {
      return { packet: null, detail: "a scenario has no freshness verdict binding" };
    }
    const observed = MH02_PROBES[index](runId);
    if (observed === null) {
      return { packet: null, detail: "a core scenario probe did not demonstrate its expected behavior" };
    }
    if (observed.outcome_type !== expected.type || observed.disposition !== expected.disposition) {
      return { packet: null, detail: "a core scenario's observed outcome is not its declared expected outcome" };
    }
    results.push({
      stable_id: stableId,
      outcome_type: observed.outcome_type,
      disposition: observed.disposition,
      reason_code: observed.reason_code,
      receipt_ref: receiptRef,
      evidence_identity: copyIdentity(identity),
      evidence_freshness: freshnessVerdict,
    } as unknown as NeutralScenarioResult);
  }
  const packet = neutralFreeze({
    schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: ownerKey,
    evidence_identity: copyIdentity(identity),
    stable_ids: [...ownerIds],
    results,
  }) as unknown as NeutralOwnerConformancePacket;
  return { packet, detail: null };
}

// ---------------------------------------------------------------------------
// The other five owners — thin drivers over the shipped real evaluators
// ---------------------------------------------------------------------------

/**
 * The MH-03 adapter provider is SOURCE-OWNED: a complete `HostAdapter`-shaped
 * value whose every operation throws. The boundary proves the interface by
 * inspection and MH-03's four scenarios are no-side-effect scenarios, so an
 * evaluation that reaches for an operation detonates rather than quietly
 * performing host work inside a conformance run. A provider cannot cross the
 * text boundary, so the caller could never have supplied one anyway.
 */
function mh03InertAdapterProvider(host: string): unknown {
  const adapter: Record<string, unknown> = { host: String(host), hostId: String(host) };
  for (const operation of HOST_ADAPTER_OPERATIONS) {
    adapter[operation] = () => {
      throw new Error(`A21-X conformance evaluation must not execute adapter operation ${operation}`);
    };
  }
  return adapter;
}

interface OwnerEvaluationInputs {
  readonly runId: string;
  readonly claimantId: string;
  readonly identity: NeutralEvidenceIdentity;
  readonly receiptRefs: Readonly<Record<string, string>>;
  readonly freshness: Readonly<Record<string, string>>;
  readonly ownerInputs: Record<string, unknown>;
}

interface OwnerEvaluation {
  readonly packet: NeutralOwnerConformancePacket | null;
  readonly detail: string | null;
}

function packetOrDetail(result: { packet: unknown }, refusedDetail: string): OwnerEvaluation {
  const packet = result.packet;
  if (!isRecord(packet)) return { packet: null, detail: refusedDetail };
  return { packet: packet as unknown as NeutralOwnerConformancePacket, detail: null };
}

function evaluateOwner(ownerKey: string, inputs: OwnerEvaluationInputs): OwnerEvaluation {
  const { runId, claimantId, identity, receiptRefs, freshness, ownerInputs } = inputs;
  try {
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[0]) {
      return evaluateMh02CoreConformance(runId, identity, receiptRefs, freshness);
    }
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[1]) {
      const result = evaluateMh03HostAdapterConformance({
        run_id: runId,
        evidence_identity: identity,
        receipt_refs: receiptRefs,
        evidence_freshness: freshness,
        adapter_provider: mh03InertAdapterProvider,
      } as Mh03ConformanceRequest);
      return packetOrDetail(result, "the host-adapter owner evaluation refused its request");
    }
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[2]) {
      const journalRoot = ownField(ownerInputs, "journal_root");
      const result = evaluateReceiptJournalConformance({
        run_id: runId,
        evidence_identity: identity,
        receipt_refs: receiptRefs,
        evidence_freshness: freshness,
        journal_root: typeof journalRoot === "string" ? journalRoot : "",
      } as unknown as Mh06ConformanceRequest);
      return packetOrDetail(result, "the receipt-journal owner evaluation refused its request");
    }
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[3]) {
      const pluginRoot = ownField(ownerInputs, "plugin_root");
      const consumerRoots = ownField(ownerInputs, "consumer_roots");
      const result = evaluateNeutralModuleBoundaries({
        run_id: runId,
        plugin_root: typeof pluginRoot === "string" ? pluginRoot : "",
        consumer_roots: copyStringMap(consumerRoots),
        evidence_identity: identity,
        receipt_refs: receiptRefs,
        evidence_freshness: freshness,
      } as never);
      return packetOrDetail(
        result as { packet: unknown },
        "the module-boundary owner evaluation refused its request"
      );
    }
    if (ownerKey === NEUTRAL_CONFORMANCE_OWNER_KEYS[4]) {
      const migrationRoot = ownField(ownerInputs, "migration_journal_root");
      const scenarioEvidence = ownField(ownerInputs, "migration_scenario_evidence");
      const scope = ownField(ownerInputs, "migration_scope");
      const result = evaluateHostCutoverConformance({
        run_id: runId,
        journal_root: typeof migrationRoot === "string" ? migrationRoot : "",
        evidence_identity: identity,
        receipt_refs: receiptRefs,
        evidence_freshness: freshness,
        scenario_evidence: isRecord(scenarioEvidence) ? scenarioEvidence : {},
        scope: isRecord(scope) ? scope : undefined,
      });
      return packetOrDetail(result, "the host-cutover owner evaluation refused its request");
    }
    // W5/MH-09 — its boundary is itself canonical text; this module is the
    // caller and encodes data it owns.
    const releaseMode = ownField(ownerInputs, "release_mode");
    const releaseEvidence = ownField(ownerInputs, "release_scenario_evidence");
    const requestText = neutralCanonicalJson({
      run_id: runId,
      claimant_id: claimantId,
      mode: typeof releaseMode === "string" ? releaseMode : "fixture",
      evidence_identity: identity,
      receipt_refs: receiptRefs,
      evidence_freshness: freshness,
      scenario_evidence: isRecord(releaseEvidence) ? releaseEvidence : {},
    });
    const result = evaluateReleaseConformance(requestText);
    return packetOrDetail(result, "the release owner evaluation refused its request");
  } catch {
    return { packet: null, detail: "the owner evaluation raised instead of answering" };
  }
}

// ---------------------------------------------------------------------------
// The integration
// ---------------------------------------------------------------------------

/**
 * Run the full A21-X integration over ONE canonical JSON request text.
 *
 * The fixed order: text admission → caller-channel refusals → claim identity
 * → all six real owner evaluations in canonical owner order → packet
 * count/identity verification → the REAL assembler → one frozen result. Any
 * incomplete or inconsistent step refuses closed with a named control; no
 * outcome, receipt reference, or scenario id is ever manufactured here.
 */
export function runNeutralConformanceReleaseIntegration(request: unknown): ReleaseIntegrationResult {
  const decoded = decodeIntegrationRequest(request);
  if (decoded.refusal !== null) return decoded.refusal;

  const claimantId = ownField(decoded.claim, "claimant_id");
  if (typeof claimantId !== "string" || claimantId.length === 0) {
    return refuse(
      CONTROL_CLAIM_INCOMPLETE,
      "scenario_evidence_incomplete",
      ["an anonymous claim cannot be checked against anything downstream"],
      { incomplete_field: "claimant_id" }
    );
  }
  const identityValue = ownField(decoded.claim, "activated_runtime");
  if (!identityIsComplete(identityValue)) {
    return refuse(
      CONTROL_CLAIM_INCOMPLETE,
      "scenario_evidence_incomplete",
      ["the claimed activated runtime must name every field of the identity tuple"],
      { incomplete_source: "claim.activated_runtime" }
    );
  }
  const identity = copyIdentity(identityValue);

  const runIdValue = ownField(decoded.ownerInputs, "run_id");
  if (typeof runIdValue !== "string" || runIdValue.length === 0) {
    return refuse(
      CONTROL_OWNER_FAILED,
      "scenario_evidence_incomplete",
      ["every owner evaluation is attributed to one run id, which the raw inputs must name"],
      { incomplete_field: "owner_inputs.run_id" }
    );
  }
  const receiptRefs = copyStringMap(ownField(decoded.ownerInputs, "receipt_refs"));
  const freshness = copyStringMap(ownField(decoded.ownerInputs, "evidence_freshness"));

  const inputs: OwnerEvaluationInputs = {
    runId: runIdValue,
    claimantId,
    identity,
    receiptRefs,
    freshness,
    ownerInputs: decoded.ownerInputs,
  };

  // -- all six owners, canonical order, fail closed on the first refusal -----
  const packets: NeutralOwnerConformancePacket[] = [];
  for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
    const evaluation = evaluateOwner(ownerKey, inputs);
    if (evaluation.packet === null) {
      return refuse(
        CONTROL_OWNER_FAILED,
        "scenario_evidence_incomplete",
        [
          "the aggregate covers the whole suite or it covers nothing",
          "an owner evaluation that refuses or raises fails the whole integration closed",
        ],
        { owner_key: ownerKey, owner_detail: evaluation.detail }
      );
    }
    packets.push(evaluation.packet);
  }

  // -- the collected packets: exact counts, one exact identity ---------------
  for (const packet of packets) {
    const ownerKey = String(ownField(packet, "owner_key"));
    const expectedCount = NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey];
    const stableIds = ownField(packet, "stable_ids");
    const results = ownField(packet, "results");
    const idCount = Array.isArray(stableIds) ? stableIds.length : -1;
    const resultCount = Array.isArray(results) ? results.length : -1;
    if (expectedCount === undefined || idCount !== expectedCount || resultCount !== expectedCount) {
      return refuse(
        CONTROL_OWNER_FAILED,
        "scenario_required_set_mismatch",
        ["each owner covers exactly the scenarios the closed table assigns it"],
        { owner_key: ownerKey, expected_scenario_count: expectedCount ?? null, declared_id_count: idCount }
      );
    }
    const packetIdentity = ownField(packet, "evidence_identity");
    for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
      if (ownField(packetIdentity, field) !== ownField(identity, field)) {
        return refuse(
          CONTROL_OWNER_FAILED,
          "scenario_identity_binding_mismatch",
          ["one exact evidence identity binds every packet to the claim"],
          { owner_key: ownerKey, differing_field: field }
        );
      }
    }
  }

  // -- the REAL assembler over the six packets -------------------------------
  const assemblyText = neutralCanonicalJson({
    packets,
    claim: { claimant_id: claimantId, activated_runtime: identity },
  });
  const assembled = assembleNeutralConformanceEvidence(assemblyText);
  if (assembled.evidence === null) {
    return refuse(
      CONTROL_ASSEMBLY_REFUSED,
      "scenario_evidence_incomplete",
      ["an aggregate the real assembler refuses is not evidence, whatever produced its packets"],
      {
        assembly_refusal_control:
          typeof assembled.outcome.facts?.refusal_control === "string"
            ? assembled.outcome.facts.refusal_control
            : null,
      }
    );
  }

  return neutralFreeze({
    outcome: neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "all six real owner evaluations ran from raw inputs; no outcome, id, or receipt reference was manufactured",
        "the six packets carry exactly the closed per-owner scenario counts under one exact evidence identity",
        "the 31-scenario aggregate was built by the real assembler over the source-owned required tuple",
        "this integration takes no promotion decision and verifies no signature",
      ],
      binding: { contract_version: NEUTRAL_CONTRACT_VERSION },
      facts: {
        owner_keys: [...NEUTRAL_CONFORMANCE_OWNER_KEYS],
        packet_count: packets.length,
        result_count: assembled.evidence.results.length,
        required_scenario_count: NEUTRAL_REQUIRED_SUITE_SCENARIO_COUNT,
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        claimant_id: claimantId,
      },
    }),
    evidence: assembled.evidence,
    packets: neutralFreeze(packets) as readonly NeutralOwnerConformancePacket[],
  }) as ReleaseIntegrationResult;
}

// ---------------------------------------------------------------------------
// The transported decision — what the emitter and the channel gate re-run
// ---------------------------------------------------------------------------

export interface TransportedReleaseDecision {
  /** True only when the production decision itself promoted. */
  readonly promotable: boolean;
  /** Which stage answered: full-suite coverage, re-assembly, or the decision. */
  readonly stage: "coverage" | "assembly" | "decision";
  /** A source-owned diagnostic phrase (plus the decision's reason code). */
  readonly detail: string;
  /** The production decision outcome, when the decision stage was reached. */
  readonly outcome: NeutralOutcome | null;
}

function transportedRefusal(stage: "coverage" | "assembly", detail: string): TransportedReleaseDecision {
  return { promotable: false, stage, detail, outcome: null };
}

/** A non-aliasing copy of exactly the scenario-result contract fields. */
function copyTransportedResult(result: unknown): NeutralScenarioResult {
  const reason = ownField(result, "reason_code");
  return {
    stable_id: ownField(result, "stable_id"),
    outcome_type: ownField(result, "outcome_type"),
    disposition: ownField(result, "disposition"),
    reason_code: reason === undefined ? null : reason,
    receipt_ref: ownField(result, "receipt_ref"),
    evidence_identity: copyIdentity(ownField(result, "evidence_identity")),
    evidence_freshness: ownField(result, "evidence_freshness"),
  } as unknown as NeutralScenarioResult;
}

/**
 * Re-run the full integration/assembly decision over a TRANSPORTED evidence
 * and authority — the seam `emit-release-conformance.ts` and
 * `check-channel-integrity.ts promotion` share, so the two cannot drift.
 *
 * Nothing about the transported record is trusted: the evidence must cover
 * exactly the source-owned 31-id tuple in canonical order; the six owner
 * packets are RE-DERIVED from the source-owned owner slices (never read from
 * the record); the REAL assembler re-joins them; and the production
 * `evaluateNeutralConformanceDecision` — including the attestor trust-root
 * verification no claimant can satisfy — takes the only decision. A claimed
 * count, a claimed coverage block, or a claimed verdict changes nothing here.
 */
export function evaluateTransportedReleaseConformance(
  evidence: unknown,
  authority: unknown
): TransportedReleaseDecision {
  if (!isRecord(evidence)) {
    return transportedRefusal("coverage", "the transported evidence is not a record");
  }
  const required = ownField(evidence, "required_scenario_ids");
  const results = ownField(evidence, "results");
  const canonical = NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS;
  if (!Array.isArray(required) || required.length !== canonical.length) {
    return transportedRefusal(
      "coverage",
      "the evidence does not cover the full frozen suite: the required tuple is not the 31-id canonical tuple"
    );
  }
  for (let index = 0; index < canonical.length; index += 1) {
    if (required[index] !== canonical[index]) {
      return transportedRefusal(
        "coverage",
        "the evidence does not cover the full frozen suite: the required tuple is not the 31-id canonical tuple"
      );
    }
  }
  if (!Array.isArray(results) || results.length !== canonical.length) {
    return transportedRefusal(
      "coverage",
      "the evidence does not carry exactly one result per required scenario"
    );
  }
  for (let index = 0; index < canonical.length; index += 1) {
    if (ownField(results[index], "stable_id") !== canonical[index]) {
      return transportedRefusal(
        "coverage",
        "the evidence results are not ordered against the canonical required tuple"
      );
    }
  }
  const claimantId = ownField(evidence, "claimant_id");
  if (typeof claimantId !== "string" || claimantId.length === 0) {
    return transportedRefusal("coverage", "the evidence names no claimant");
  }
  const identity = copyIdentity(ownField(evidence, "activated_runtime"));
  if (!identityIsComplete(identity)) {
    return transportedRefusal("coverage", "the evidence names no complete activated-runtime identity");
  }

  // Re-derive the six owner packets from the SOURCE-OWNED slices.
  const packets: NeutralOwnerConformancePacket[] = [];
  for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
    const ownerIds = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
    const ownerResults: NeutralScenarioResult[] = [];
    for (const stableId of ownerIds) {
      const at = canonical.indexOf(stableId);
      ownerResults.push(copyTransportedResult(results[at]));
    }
    packets.push({
      schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      owner_key: ownerKey,
      evidence_identity: copyIdentity(identity),
      stable_ids: [...ownerIds],
      results: ownerResults,
    } as unknown as NeutralOwnerConformancePacket);
  }

  const assembled = assembleNeutralConformanceEvidence(
    neutralCanonicalJson({ packets, claim: { claimant_id: claimantId, activated_runtime: identity } })
  );
  if (assembled.evidence === null) {
    const control = assembled.outcome.facts?.refusal_control;
    return transportedRefusal(
      "assembly",
      `the real assembler refused the re-derived packets (${typeof control === "string" ? control : "unnamed control"})`
    );
  }

  const outcome = evaluateNeutralConformanceDecision(assembled.evidence as never, authority as never);
  const promotable = outcome.disposition === "succeeded" && outcome.facts?.may_promote_conformant === true;
  return {
    promotable,
    stage: "decision",
    detail: promotable
      ? "the production decision promoted the re-assembled full-suite evidence"
      : `the production decision refused: disposition=${outcome.disposition}, reason_code=${String(outcome.reason_code ?? "none")}`,
    outcome,
  };
}

// ---------------------------------------------------------------------------
// The control battery
// ---------------------------------------------------------------------------

/**
 * Battery fixtures are AUTHORED and BUILT here: a disposable workspace with a
 * real MH-06 journal root, a real MH-08 migration-journal root, and a small
 * conforming module workspace (plugin + the two named consumer siblings) whose
 * lifecycle module carries the REAL core member bytes — so the MH-07 drive
 * scans genuine production rules over a tree the battery owns, in any
 * checkout, including a plugin-only CI checkout with no sibling repositories.
 * Built once per process and reused: every input is constant, and every
 * evaluator either cleans up after itself (MH-06) or writes nothing for the
 * battery's evidence-free scenarios (MH-08), so repeat evaluations are
 * byte-deterministic.
 */
interface BatteryWorkspace {
  readonly journalRoot: string;
  readonly migrationJournalRoot: string;
  readonly pluginRoot: string;
  readonly consumerRoots: Readonly<Record<string, string>>;
}

let batteryWorkspaceSingleton: BatteryWorkspace | null = null;

const BATTERY_MODULE_PUBLIC_API =
  'export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;';

// Assembled through COMPUTED KEYS rather than object literals: the shape is
// identical either way, but a literal schema header would make this module's
// own bytes look like a Guild-signed artifact to the workspace write guard.
// The MH-03/MH-07 focused suites use the same construction for the same reason.
function batteryManifestJson(id: string, kind: string, dependsOn?: readonly string[]): string {
  const manifest: Record<string, unknown> = {};
  manifest["schema_version"] = ["guild", "module_manifest", "v1"].join(".");
  manifest["id"] = id;
  manifest["title"] = id;
  manifest["kind"] = kind;
  manifest["implementation_mode"] = "workflow-backed";
  manifest["description"] = `A21-X battery fixture module ${id}`;
  if (dependsOn !== undefined) manifest["depends_on"] = [...dependsOn];
  manifest["owns"] = {};
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function batteryResourcesJson(moduleId: string): string {
  const resources: Record<string, unknown> = {};
  resources["schema_version"] = ["guild", "module_resources", "v1"].join(".");
  resources["module_id"] = moduleId;
  resources["generated_from"] = ["guild", "inventory", "v1"].join(".");
  resources["entries"] = [];
  return `${JSON.stringify(resources, null, 2)}\n`;
}

function buildBatteryModuleWorkspace(base: string): void {
  const files: Record<string, string> = {};
  files["plugin/.claude-plugin/plugin.json"] = `${JSON.stringify(
    { name: "guild-a21x-battery-fixture", version: "0.0.0" },
    null,
    2
  )}\n`;

  const coreDir = path.resolve(__dirname, "../../lifecycle/workflows");
  const coreWorkflows: Record<string, string> = {};
  for (const member of NEUTRAL_CORE_MEMBERS) {
    coreWorkflows[member] = fs.readFileSync(path.join(coreDir, member), "utf8");
  }
  coreWorkflows["lifecycle-ports.ts"] = [
    'export const LIFECYCLE_PORT_VERSION = "guild.lifecycle.ports.v1" as const;',
    "",
    "export function decideLifecycleSelection(candidate: string): string {",
    "  return candidate;",
    "}",
    "",
  ].join("\n");

  const modules: ReadonlyArray<{
    id: string;
    kind: string;
    depends_on?: readonly string[];
    index: string;
    workflows: Readonly<Record<string, string>>;
  }> = [
    {
      id: "lifecycle",
      kind: "capability",
      depends_on: ["kernel"],
      index: [
        BATTERY_MODULE_PUBLIC_API,
        ...NEUTRAL_CORE_MEMBERS.map(
          (member) => `export * from "./workflows/${member.replace(/\.ts$/, "")}";`
        ),
        'export * from "./workflows/lifecycle-ports";',
        "",
      ].join("\n"),
      workflows: coreWorkflows,
    },
    {
      id: "kernel",
      kind: "substrate",
      index: [BATTERY_MODULE_PUBLIC_API, 'export * from "./workflows/module-contracts";', ""].join("\n"),
      workflows: {
        "module-contracts.ts": ['export const MODULE_CONTRACT_VERSION = "guild.module.v1" as const;', ""].join(
          "\n"
        ),
      },
    },
    {
      id: "host-runtime",
      kind: "capability",
      depends_on: ["lifecycle"],
      index: [BATTERY_MODULE_PUBLIC_API, 'export * from "./workflows/adapter";', ""].join("\n"),
      workflows: {
        "adapter.ts": [
          'import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";',
          "",
          "export function bindNativeHostEvent(nativeEvent: string): string {",
          "  return `${LIFECYCLE_PORT_VERSION}:${nativeEvent}`;",
          "}",
          "",
        ].join("\n"),
      },
    },
    {
      id: "dispatch",
      kind: "capability",
      depends_on: ["lifecycle"],
      index: [BATTERY_MODULE_PUBLIC_API, 'export * from "./workflows/transport";', ""].join("\n"),
      workflows: {
        "transport.ts": [
          'import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";',
          "",
          'export * from "./transport-errors";',
          "",
          "export async function runTransport(command: string): Promise<string> {",
          '  const errors = await import("./transport-errors");',
          "  return `${LIFECYCLE_PORT_VERSION}:${errors.TRANSPORT_ERROR_TYPE}:${command}`;",
          "}",
          "",
        ].join("\n"),
        "transport-errors.ts": [
          'export const TRANSPORT_ERROR_TYPE = "guild.transport_outcome.v1" as const;',
          "",
        ].join("\n"),
      },
    },
    {
      id: "documents",
      kind: "capability",
      depends_on: ["lifecycle"],
      index: [BATTERY_MODULE_PUBLIC_API, 'export * from "./workflows/service";', ""].join("\n"),
      workflows: {
        "service.ts": [
          'import { LIFECYCLE_PORT_VERSION } from "../../lifecycle";',
          "",
          "export function renderDocument(body: string): string {",
          "  return `${LIFECYCLE_PORT_VERSION}:${body}`;",
          "}",
          "",
        ].join("\n"),
      },
    },
  ];

  for (const module of modules) {
    const moduleBase = `plugin/src/modules/${module.id}`;
    files[`${moduleBase}/module.manifest.json`] = batteryManifestJson(module.id, module.kind, module.depends_on);
    files[`${moduleBase}/index.ts`] = module.index;
    files[`${moduleBase}/resources/.generated-by-guild-module-resources`] = "generated by the A21-X battery\n";
    files[`${moduleBase}/resources/module-resources.json`] = batteryResourcesJson(module.id);
    for (const [name, source] of Object.entries(module.workflows)) {
      files[`${moduleBase}/workflows/${name}`] = source;
    }
  }

  files["website/src/render.ts"] = [
    'export const WEBSITE_CONTRACT_VERSION = "guild.website.contract.v1" as const;',
    "",
  ].join("\n");
  files["benchmark/src/run.ts"] = [
    'export const BENCHMARK_CONTRACT_VERSION = "guild.benchmark.contract.v1" as const;',
    "",
  ].join("\n");

  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(base, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function batteryWorkspace(): BatteryWorkspace {
  if (batteryWorkspaceSingleton !== null) return batteryWorkspaceSingleton;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "a21x-integration-battery-"));
  const journalRoot = path.join(base, "journal-root");
  const migrationJournalRoot = path.join(base, "migration-journal-root");
  fs.mkdirSync(journalRoot, { recursive: true });
  fs.mkdirSync(migrationJournalRoot, { recursive: true });
  const moduleBase = path.join(base, "module-workspace");
  buildBatteryModuleWorkspace(moduleBase);
  batteryWorkspaceSingleton = {
    journalRoot,
    migrationJournalRoot,
    pluginRoot: path.join(moduleBase, "plugin"),
    consumerRoots: {
      website: path.join(moduleBase, "website"),
      benchmark: path.join(moduleBase, "benchmark"),
    },
  };
  return batteryWorkspaceSingleton;
}

/** The battery's own identity — shaped like a real one, owned by this module. */
const BATTERY_IDENTITY: NeutralEvidenceIdentity = {
  source_commit: "9c2f4b7d1e85a0361fc48ad92b57e610c3d8f2a4",
  package_hash: "sha256:5b8e02c7d4a1f9636e80cb15d2a7943f0c6e18db5a29f47031ce86bd94a25e70",
  runtime_version: "guild-2.5.0",
  adapter_version: "guild.host_adapter.v1.0.0",
  host_id: "claude-code-cli",
  host_version: "2.5.0",
  platform: "darwin-arm64",
  contract_version: NEUTRAL_CONTRACT_VERSION,
  scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
  scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
  release_id: "rel-2026-08-19-a21xbattery",
} as unknown as NeutralEvidenceIdentity;

const BATTERY_CLAIMANT = "guild.release-emitter";
const BATTERY_RUN_ID = "run-a21x-integration-battery";

function batteryCommitment(sequence: number): string {
  let hex = (sequence >>> 0).toString(16);
  while (hex.length < 16) hex = `0${hex}`;
  return `nec1:${hex}`;
}

function batteryReceiptRefs(): Record<string, string> {
  const refs: Record<string, string> = {};
  for (let index = 0; index < NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length; index += 1) {
    const sequence = index + 1;
    refs[NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index]] =
      `guild.receipt_ref.v1:a21x-integration#${sequence}@${batteryCommitment(sequence)}`;
  }
  return refs;
}

/**
 * Build a complete, valid journal chain but deliberately provide no
 * attestations. This makes the final decision reach — and refuse at — the
 * quorum boundary instead of satisfying this control through an earlier,
 * unrelated journal-shape failure.
 */
function batteryAuthorityBelowQuorum(
  results: readonly NeutralScenarioResult[]
): NeutralConformanceAuthority {
  const base = {
    schema_version: "guild.conformance_authority.v1",
    identity: BATTERY_IDENTITY,
    receipt_journal_id: "jrn-a21x-battery",
    receipt_sequence_range: { first: 1, last: results.length },
    observed_entries: [] as NeutralReceiptJournalEntry[],
    attestations: [],
  } as unknown as NeutralConformanceAuthority;
  const entries: NeutralReceiptJournalEntry[] = [];
  let previous = neutralJournalGenesis(base);
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const draft = {
      sequence: index + 1,
      scenario_id: result.stable_id,
      outcome_type: result.outcome_type,
      disposition: result.disposition,
      reason_code: result.reason_code ?? null,
      entry_commitment: "",
      previous_commitment: previous,
    } as NeutralReceiptJournalEntry;
    const committed = {
      ...draft,
      entry_commitment: neutralJournalEntryCommitment(base, previous, draft),
    } as NeutralReceiptJournalEntry;
    entries.push(committed);
    previous = committed.entry_commitment;
  }
  const authorityWithJournal = {
    ...base,
    observed_entries: entries,
  } as NeutralConformanceAuthority;
  const draftAttestation = {
    attestor_id: "guild.release-attestor",
    attested_journal_root: previous,
    attested_entry_count: entries.length,
    attestation_ref: "",
    // Structurally valid but deliberately not a real signature. The decision
    // must stop at quorum=1 before signature verification; no private material
    // is present in the control battery.
    attestation_signature:
      `nws1:00:${"11".repeat(32 * NEUTRAL_ATTESTATION_CHAINS)}:${"22".repeat(
        32 * NEUTRAL_ATTESTATION_TREE_HEIGHT
      )}`,
  };
  return {
    ...authorityWithJournal,
    attestations: [
      {
        ...draftAttestation,
        attestation_ref: neutralAttestationReference(
          authorityWithJournal,
          draftAttestation
        ),
      },
    ],
  } as NeutralConformanceAuthority;
}

function batteryFreshness(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const stableId of NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS) map[stableId] = "fresh";
  return map;
}

const BATTERY_CLAIM = { claimant_id: BATTERY_CLAIMANT, activated_runtime: BATTERY_IDENTITY };

function batteryOwnerInputs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const workspace = batteryWorkspace();
  const inputs: Record<string, unknown> = {
    run_id: BATTERY_RUN_ID,
    receipt_refs: batteryReceiptRefs(),
    evidence_freshness: batteryFreshness(),
    journal_root: workspace.journalRoot,
    migration_journal_root: workspace.migrationJournalRoot,
    migration_scenario_evidence: {},
    plugin_root: workspace.pluginRoot,
    consumer_roots: workspace.consumerRoots,
    release_mode: "fixture",
    release_scenario_evidence: {},
  };
  for (const key of Object.keys(overrides)) {
    if (overrides[key] === undefined) delete inputs[key];
    else inputs[key] = overrides[key];
  }
  return inputs;
}

function batteryRequestText(
  claim: unknown = BATTERY_CLAIM,
  ownerInputs: unknown = batteryOwnerInputs()
): string {
  return neutralCanonicalJson({ claim, owner_inputs: ownerInputs });
}

/** A plausible packet set for the smuggling probe — content is irrelevant. */
function batterySmuggledPackets(): unknown[] {
  return NEUTRAL_CONFORMANCE_OWNER_KEYS.map((ownerKey) => {
    const ids = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
    const refs = batteryReceiptRefs();
    return {
      schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      owner_key: ownerKey,
      evidence_identity: BATTERY_IDENTITY,
      stable_ids: [...ids],
      results: ids.map((stableId) => ({
        stable_id: stableId,
        outcome_type: "guild.lifecycle_outcome.v1",
        disposition: "succeeded",
        reason_code: null,
        receipt_ref: refs[stableId],
        evidence_identity: BATTERY_IDENTITY,
        evidence_freshness: "fresh",
      })),
    };
  });
}

/** The six packets a REAL integration must return: recomputed independently. */
let batteryRecomputedPacketsSingleton: readonly NeutralOwnerConformancePacket[] | null = null;

function batteryRecomputedPackets(): readonly NeutralOwnerConformancePacket[] {
  if (batteryRecomputedPacketsSingleton !== null) return batteryRecomputedPacketsSingleton;
  const inputs: OwnerEvaluationInputs = {
    runId: BATTERY_RUN_ID,
    claimantId: BATTERY_CLAIMANT,
    identity: copyIdentity(BATTERY_IDENTITY),
    receiptRefs: batteryReceiptRefs(),
    freshness: batteryFreshness(),
    ownerInputs: batteryOwnerInputs(),
  };
  const packets: NeutralOwnerConformancePacket[] = [];
  for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
    const evaluation = evaluateOwner(ownerKey, inputs);
    if (evaluation.packet === null) {
      throw new Error(`battery recomputation failed for ${ownerKey}: ${String(evaluation.detail)}`);
    }
    packets.push(evaluation.packet);
  }
  batteryRecomputedPacketsSingleton = packets;
  return packets;
}

interface BatteryEvaluation {
  readonly result: ReleaseIntegrationResult | null;
}

/** One cached success-path evaluation per battery run, per implementation. */
function evaluateOnce(
  cache: Map<string, BatteryEvaluation>,
  implementation: ReleaseIntegrationFunction
): ReleaseIntegrationResult | null {
  const cached = cache.get("valid");
  if (cached !== undefined) return cached.result;
  let result: ReleaseIntegrationResult | null;
  try {
    const produced = implementation(batteryRequestText());
    result =
      isRecord(produced) && isRecord(produced.outcome) && produced.outcome.disposition === "succeeded"
        ? produced
        : null;
  } catch {
    result = null;
  }
  cache.set("valid", { result });
  return result;
}

function refusesWithControl(
  implementation: ReleaseIntegrationFunction,
  request: unknown,
  control: string
): boolean {
  let result: ReleaseIntegrationResult;
  try {
    result = implementation(request);
  } catch {
    return false;
  }
  if (!isRecord(result) || result.evidence !== null || result.packets !== null) return false;
  if (!isRecord(result.outcome) || result.outcome.disposition !== "refused") return false;
  return ownField(result.outcome.facts, "refusal_control") === control;
}

interface ReleaseIntegrationControlDefinition {
  readonly id: string;
  readonly title: string;
  readonly check: (
    implementation: ReleaseIntegrationFunction,
    cache: Map<string, BatteryEvaluation>
  ) => boolean;
}

/**
 * The battery, in declaration order. ANTI-VACUITY: every control is written so
 * a fabricator, a caller-packet passthrough, an object acceptor, a count liar,
 * a mutable-output implementation, a nondeterministic implementation, and a
 * refuse-everything implementation each fail at least one row — the focused
 * suite proves exactly that against seven planted mutants.
 */
const RELEASE_INTEGRATION_CONTROL_BATTERY: readonly ReleaseIntegrationControlDefinition[] = [
  {
    id: "A21X-C01-full-suite-assembly",
    title: "a valid raw-input request assembles all 31 required ids, in contract order",
    check: (implementation, cache) => {
      const result = evaluateOnce(cache, implementation);
      if (result === null || result.evidence === null || result.packets === null) return false;
      if (result.packets.length !== NEUTRAL_CONFORMANCE_OWNER_KEYS.length) return false;
      const ids = result.evidence.results.map((entry) => entry.stable_id);
      if (ids.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length) return false;
      for (let index = 0; index < ids.length; index += 1) {
        if (ids[index] !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index]) return false;
      }
      const required = result.evidence.required_scenario_ids;
      if (required.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length) return false;
      for (let index = 0; index < required.length; index += 1) {
        if (required[index] !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[index]) return false;
      }
      return true;
    },
  },
  {
    id: "A21X-C02-owner-counts",
    title: "the six packets and the aggregate carry exactly the closed per-owner counts",
    check: (implementation, cache) => {
      const result = evaluateOnce(cache, implementation);
      if (result === null || result.evidence === null || result.packets === null) return false;
      const seenOwners: string[] = [];
      for (const packet of result.packets) {
        const ownerKey = String(ownField(packet, "owner_key"));
        if (seenOwners.indexOf(ownerKey) !== -1) return false;
        seenOwners.push(ownerKey);
        const expected = NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey];
        if (expected === undefined) return false;
        const stableIds = ownField(packet, "stable_ids");
        const results = ownField(packet, "results");
        if (!Array.isArray(stableIds) || stableIds.length !== expected) return false;
        if (!Array.isArray(results) || results.length !== expected) return false;
      }
      if (seenOwners.length !== NEUTRAL_CONFORMANCE_OWNER_KEYS.length) return false;
      // And the aggregate's per-owner membership agrees with the closed table.
      for (const ownerKey of NEUTRAL_CONFORMANCE_OWNER_KEYS) {
        const ownerIds = NEUTRAL_OWNER_SCENARIO_IDS[ownerKey];
        const covered = result.evidence.results.filter(
          (entry) => ownerIds.indexOf(entry.stable_id) !== -1
        ).length;
        if (covered !== NEUTRAL_CONFORMANCE_OWNER_SCENARIO_COUNTS[ownerKey]) return false;
      }
      return true;
    },
  },
  {
    id: "A21X-C03-real-owner-evaluators",
    title: "the returned packets are byte-identical to an independent drive of the six real evaluators",
    check: (implementation, cache) => {
      const result = evaluateOnce(cache, implementation);
      if (result === null || result.packets === null) return false;
      const recomputed = batteryRecomputedPackets();
      if (result.packets.length !== recomputed.length) return false;
      for (let index = 0; index < recomputed.length; index += 1) {
        if (neutralCanonicalJson(result.packets[index]) !== neutralCanonicalJson(recomputed[index])) {
          return false;
        }
      }
      return true;
    },
  },
  {
    id: "A21X-C04-canonical-text-boundary",
    title: "non-text, malformed, padded, and undeclared-member requests refuse unread",
    check: (implementation, cache) => {
      let trapCount = 0;
      const bump = <T,>(value: T): T => {
        trapCount += 1;
        return value;
      };
      // Constructed reflectively so this module's own source carries no
      // live-object traversal machinery at the request boundary; the probe
      // exists only to prove the boundary never touches it.
      const trapProxy: unknown = Reflect.construct(Proxy, [
        {},
        {
          get: () => bump(undefined),
          has: () => bump(false),
          ownKeys: () => bump([]),
          getOwnPropertyDescriptor: () => bump(undefined),
          getPrototypeOf: () => bump(null),
        },
      ]);
      if (!refusesWithControl(implementation, trapProxy, CONTROL_NOT_TEXT)) return false;
      if (trapCount !== 0) return false;
      const canonical = batteryRequestText();
      const nonText: unknown[] = [
        { claim: BATTERY_CLAIM, owner_inputs: batteryOwnerInputs() },
        [BATTERY_CLAIM],
        null,
        undefined,
        17,
        true,
      ];
      for (const candidate of nonText) {
        if (!refusesWithControl(implementation, candidate, CONTROL_NOT_TEXT)) return false;
      }
      const malformed: unknown[] = [
        "",
        "{",
        "not json",
        "[]",
        '"a JSON string is not a request"',
        ` ${canonical}`,
        neutralCanonicalJson({ claim: BATTERY_CLAIM, owner_inputs: batteryOwnerInputs(), mode: "lenient" }),
        neutralCanonicalJson({ claim: BATTERY_CLAIM }),
      ];
      for (const candidate of malformed) {
        if (!refusesWithControl(implementation, candidate, CONTROL_NOT_TEXT)) return false;
      }
      // NON-VACUITY: refusing everything would satisfy the rows above.
      return evaluateOnce(cache, implementation) !== null;
    },
  },
  {
    id: "A21X-C05-caller-channel-closed",
    title: "supplied packets, a supplied required set, and supplied outcomes each refuse by name",
    check: (implementation) => {
      const smuggledPackets = neutralCanonicalJson({
        claim: BATTERY_CLAIM,
        owner_inputs: batteryOwnerInputs(),
        packets: batterySmuggledPackets(),
      });
      if (!refusesWithControl(implementation, smuggledPackets, CONTROL_CALLER_PACKETS)) return false;
      const suppliedRequiredSet = batteryRequestText({
        ...BATTERY_CLAIM,
        required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS],
      });
      if (!refusesWithControl(implementation, suppliedRequiredSet, CONTROL_CALLER_REQUIRED_SET)) {
        return false;
      }
      const outcomeRows: unknown[] = [
        batteryOwnerInputs({ results: [] }),
        batteryOwnerInputs({ stable_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS] }),
        batteryOwnerInputs({ outcomes: {} }),
        { ...batteryOwnerInputs(), mh06: { journal_root: batteryWorkspace().journalRoot, results: [] } },
      ];
      for (const ownerInputs of outcomeRows) {
        if (
          !refusesWithControl(
            implementation,
            batteryRequestText(BATTERY_CLAIM, ownerInputs),
            CONTROL_CALLER_OUTCOMES
          )
        ) {
          return false;
        }
      }
      return true;
    },
  },
  {
    id: "A21X-C06-single-evidence-identity",
    title: "one exact identity binds the claim, every packet, and every result; an incomplete one refuses",
    check: (implementation, cache) => {
      const result = evaluateOnce(cache, implementation);
      if (result === null || result.evidence === null || result.packets === null) return false;
      const claimed = copyIdentity(BATTERY_IDENTITY);
      for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
        if (ownField(result.evidence.activated_runtime, field) !== ownField(claimed, field)) return false;
      }
      for (const packet of result.packets) {
        for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
          if (ownField(ownField(packet, "evidence_identity"), field) !== ownField(claimed, field)) {
            return false;
          }
        }
      }
      for (const entry of result.evidence.results) {
        for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
          if (ownField(entry.evidence_identity, field) !== ownField(claimed, field)) return false;
        }
      }
      const incomplete: Record<string, unknown> = {};
      for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
        if (field === "platform") continue;
        incomplete[field] = ownField(BATTERY_IDENTITY, field);
      }
      return refusesWithControl(
        implementation,
        batteryRequestText({ claimant_id: BATTERY_CLAIMANT, activated_runtime: incomplete }),
        CONTROL_CLAIM_INCOMPLETE
      );
    },
  },
  {
    id: "A21X-C07-receipt-liveness",
    title:
      "every result carries the transported receipt reference for its scenario, all distinct; a missing binding refuses",
    check: (implementation, cache) => {
      const result = evaluateOnce(cache, implementation);
      if (result === null || result.evidence === null) return false;
      const expected = batteryReceiptRefs();
      const seen: string[] = [];
      for (const entry of result.evidence.results) {
        if (entry.receipt_ref !== expected[entry.stable_id]) return false;
        if (seen.indexOf(entry.receipt_ref) !== -1) return false;
        seen.push(entry.receipt_ref);
      }
      if (seen.length !== NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.length) return false;
      const partialRefs = batteryReceiptRefs();
      delete partialRefs[NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS[0]];
      return refusesWithControl(
        implementation,
        batteryRequestText(BATTERY_CLAIM, batteryOwnerInputs({ receipt_refs: partialRefs })),
        CONTROL_OWNER_FAILED
      );
    },
  },
  {
    id: "A21X-C08-determinism",
    title: "identical request text yields byte-identical successes and byte-identical refusals",
    check: (implementation, cache) => {
      const first = evaluateOnce(cache, implementation);
      if (first === null || first.evidence === null) return false;
      let second: ReleaseIntegrationResult;
      try {
        second = implementation(batteryRequestText());
      } catch {
        return false;
      }
      if (!isRecord(second) || second.evidence === null) return false;
      if (neutralCanonicalJson(first.evidence) !== neutralCanonicalJson(second.evidence)) return false;
      if (neutralCanonicalJson(first.outcome) !== neutralCanonicalJson(second.outcome)) return false;
      const refusingText = batteryRequestText({
        ...BATTERY_CLAIM,
        required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS],
      });
      let refusalA: ReleaseIntegrationResult;
      let refusalB: ReleaseIntegrationResult;
      try {
        refusalA = implementation(refusingText);
        refusalB = implementation(refusingText);
      } catch {
        return false;
      }
      return neutralCanonicalJson(refusalA.outcome) === neutralCanonicalJson(refusalB.outcome);
    },
  },
  {
    id: "A21X-C09-output-immutability",
    title: "the aggregate, its results, the packet set, and every packet are frozen",
    check: (implementation, cache) => {
      const result = evaluateOnce(cache, implementation);
      if (result === null || result.evidence === null || result.packets === null) return false;
      if (!Object.isFrozen(result.evidence)) return false;
      if (!Object.isFrozen(result.evidence.results)) return false;
      if (!Object.isFrozen(result.evidence.required_scenario_ids)) return false;
      if (!Object.isFrozen(result.evidence.activated_runtime)) return false;
      for (const entry of result.evidence.results) {
        if (!Object.isFrozen(entry) || !Object.isFrozen(entry.evidence_identity)) return false;
      }
      if (!Object.isFrozen(result.packets)) return false;
      for (const packet of result.packets) {
        if (!Object.isFrozen(packet)) return false;
      }
      return true;
    },
  },
  {
    id: "A21X-C10-weakened-owner-refuses",
    title: "a raw-input set that starves one owner refuses closed, naming the owner",
    check: (implementation) => {
      const starved = batteryRequestText(BATTERY_CLAIM, batteryOwnerInputs({ journal_root: undefined }));
      let result: ReleaseIntegrationResult;
      try {
        result = implementation(starved);
      } catch {
        return false;
      }
      if (!isRecord(result) || result.evidence !== null || result.packets !== null) return false;
      if (!isRecord(result.outcome) || result.outcome.disposition !== "refused") return false;
      if (ownField(result.outcome.facts, "refusal_control") !== CONTROL_OWNER_FAILED) return false;
      return ownField(result.outcome.facts, "owner_key") === NEUTRAL_CONFORMANCE_OWNER_KEYS[2];
    },
  },
  {
    id: "A21X-C11-fixture-provisioning-not-promotable",
    title:
      "fixture authority never promotes, while the production owner path executes without bypassing final authority",
    check: (implementation, cache) => {
      const result = evaluateOnce(cache, implementation);
      if (result === null || result.evidence === null) return false;
      const batteryAuthority = batteryAuthorityBelowQuorum(result.evidence.results);
      const decision = evaluateTransportedReleaseConformance(result.evidence, batteryAuthority);
      if (
        decision.promotable !== false ||
        decision.stage !== "decision" ||
        decision.outcome?.reason_code !== "scenario_journal_attestation_insufficient"
      ) {
        return false;
      }
      // Production owner evaluation must be executable from genuine raw
      // evidence. It still cannot promote here: this battery deliberately
      // supplies no external quorum attestations to the final decision.
      const productionText = batteryRequestText(
        BATTERY_CLAIM,
        batteryOwnerInputs({ release_mode: "production" })
      );
      let production: ReleaseIntegrationResult;
      try {
        production = implementation(productionText);
      } catch {
        return false;
      }
      if (production.evidence === null || production.packets === null) return false;
      const productionAuthority = batteryAuthorityBelowQuorum(production.evidence.results);
      const productionDecision = evaluateTransportedReleaseConformance(
        production.evidence,
        productionAuthority
      );
      const productionPasses =
        productionDecision.promotable === false &&
        productionDecision.stage === "decision" &&
        productionDecision.outcome?.reason_code === "scenario_journal_attestation_insufficient";
      return productionPasses;
    },
  },
];

export interface ReleaseIntegrationControl {
  readonly id: string;
  readonly title: string;
}

/** The declared control battery, in the order it runs. */
export const RELEASE_INTEGRATION_CONTROLS: readonly ReleaseIntegrationControl[] = neutralFreeze(
  RELEASE_INTEGRATION_CONTROL_BATTERY.map((control) => ({ id: control.id, title: control.title }))
);

export interface ReleaseIntegrationControlReport {
  readonly passed: boolean;
  readonly failed_ids: readonly string[];
  readonly control_count: number;
}

/**
 * Run the whole battery against ANY implementation of the integration
 * contract. Taking the implementation as a parameter is what makes the
 * battery falsifiable: the same code that certifies the real integration is
 * pointed at deliberately broken ones, and a battery a broken one survives is
 * a battery that would also have certified a false aggregate.
 */
export function runNeutralReleaseIntegrationControls(
  implementation: ReleaseIntegrationFunction
): ReleaseIntegrationControlReport {
  const cache = new Map<string, BatteryEvaluation>();
  const failed: string[] = [];
  for (const control of RELEASE_INTEGRATION_CONTROL_BATTERY) {
    let satisfied = false;
    try {
      satisfied = control.check(implementation, cache) === true;
    } catch {
      satisfied = false;
    }
    if (!satisfied) failed.push(control.id);
  }
  return neutralFreeze({
    passed: failed.length === 0,
    failed_ids: failed,
    control_count: RELEASE_INTEGRATION_CONTROL_BATTERY.length,
  }) as ReleaseIntegrationControlReport;
}
