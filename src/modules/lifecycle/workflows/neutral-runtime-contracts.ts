/**
 * src/modules/lifecycle/workflows/neutral-runtime-contracts.ts
 *
 * `guild.runtime.contracts.v1` — the host-neutral typed contract vocabulary.
 *
 * MH-02 / W1 of the `multi-host-runtime-convergence` initiative. Provider
 * boundary: `host-neutral-core`. Consumers per the MH-01A boundary contract:
 * host-runtime-facade, host-adapters, execution-transports,
 * artifact-document-services, knowledge-facing-services, observability.
 *
 * WHAT THIS FILE IS
 *   The closed vocabularies and the single strict constructor for every typed
 *   runtime result the core emits. Typed records are the machine truth (BR-10);
 *   HTML, Markdown, hook stdout, and wrapper stdout are not.
 *
 * WHAT THIS FILE IS NOT
 *   It is not a host adapter, hook, wrapper, launcher, transport, benchmark, or
 *   website surface, and it reaches none of them. This file is a declared member
 *   of the import-closed neutral core (see `neutral-core-boundary.ts`): it has
 *   ZERO imports, including Node builtins, so it cannot perform I/O, read a
 *   clock, or observe a host. That closure is what makes MH-02 acceptance 3
 *   ("core imports no host adapter, hook, wrapper, launcher, PaneAdapter
 *   backend, benchmark, or website implementation") mechanically checkable
 *   instead of asserted.
 *
 * VOCABULARY AUTHORITY — the MH-02-R1-B05 reconciliation
 *   Every closed list below mirrors `guild.conformance_scenarios.v1`
 *   §closed_vocabularies (MH-01C). The two W0 artifacts previously declared
 *   CONTRADICTORY normalized event vocabularies. That contradiction is now
 *   resolved NORMATIVELY in both frozen contract sources, and this file mirrors
 *   the resolution as typed constants (see `NEUTRAL_NORMALIZED_EVENT_VOCABULARY`).
 *
 *   `guild.normalized_event.v2` — the 19-name vocabulary below — is NORMATIVE.
 *   `guild.normalized_event.v1` — the 8-name list the boundary contract used to
 *   carry (`session.resume` / `tool.pre` / `tool.post` / `task.transition` /
 *   `session.stop` + three unchanged names) — is SUPERSEDED.
 *
 *   The selection is evidenced by SHIPPED producer/consumer behaviour, not by
 *   preference:
 *     1. `hooks/hooks.json` ships `TaskCreated` and `TaskCompleted` as two
 *        DISTINCT hook events. v2's `task.dispatch` + `task.collect` normalizes
 *        them losslessly; v1's single `task.transition` collapses two shipped
 *        producers into one name and cannot be inverted.
 *     2. Guild's shipped state model is run-centric (`.guild/runs/<run-id>/`,
 *        `run_id` throughout the lifecycle surface), which v2's `run.resume` /
 *        `run.stop` names correctly and v1's `session.*` does not.
 *     3. Neither vocabulary has any shipped producer literal, so v1 holds no
 *        incumbency claim; and v1 cannot express the `package.*`, `receipt.*`,
 *        `runtime.verify`, or `migration.*` events the other 26 frozen scenarios
 *        require.
 *
 *   Because v1 → v2 is a PARTIAL function (`task.transition` is ambiguous) the
 *   compatibility semantics are machine-readable rather than guessed: see
 *   `mapLegacyNeutralEventName`, which returns a typed decision per legacy name
 *   instead of silently picking a replacement. MH-03 binds host-native events to
 *   the v2 list.
 *
 * There is no usable CLI here — this is a pure library module. It is reached
 * through the lifecycle module's public entrypoint (`src/modules/lifecycle`).
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const NEUTRAL_CONTRACTS_SCHEMA_VERSION = "guild.runtime.contracts.v1";

/** Contract MAJOR. A consumer pinned to a different major must refuse, not downgrade. */
export const NEUTRAL_CONTRACT_VERSION = 1;

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The six canonical lifecycle phases. */
export const NEUTRAL_LIFECYCLE_PHASES = ["init", "ideate", "plan", "build", "qa", "ops"] as const;
export type NeutralLifecyclePhase = (typeof NEUTRAL_LIFECYCLE_PHASES)[number];

/** Terminal dispositions. Exactly one per typed outcome. */
export const NEUTRAL_DISPOSITIONS = [
  "succeeded",
  "refused",
  "unsupported",
  "failed",
  "degraded",
] as const;
export type NeutralDisposition = (typeof NEUTRAL_DISPOSITIONS)[number];

/**
 * Observation states. BR-07: an absent or untrustworthy observation MUST NOT be
 * read as success, cleanliness, support, or conformance.
 */
export const NEUTRAL_OBSERVATION_STATES = [
  "checked_clean",
  "not_applicable",
  "not_observed",
  "observation_failed",
] as const;
export type NeutralObservationState = (typeof NEUTRAL_OBSERVATION_STATES)[number];

/** The ten typed outcome envelopes. */
export const NEUTRAL_OUTCOME_TYPES = [
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
export type NeutralOutcomeType = (typeof NEUTRAL_OUTCOME_TYPES)[number];

/**
 * Normalized event names. The core OWNS this vocabulary; host adapters (MH-03)
 * own native→normalized binding, and execution transports (MH-04) own transport
 * facts. `receipt.append` / `receipt.reconcile` appear here because the
 * vocabulary is core-owned — their DURABILITY, ordering, and reconciliation
 * semantics belong to W1/MH-06 and are not implemented by this core.
 */
export const NEUTRAL_EVENT_NAMES = [
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
export type NeutralEventName = (typeof NEUTRAL_EVENT_NAMES)[number];

/** The six orthogonal support-evidence dimensions. Never collapse them. */
export const NEUTRAL_SUPPORT_STATES = [
  "recognized",
  "rendered",
  "installed",
  "activated",
  "updated",
  "conformant",
] as const;
export type NeutralSupportState = (typeof NEUTRAL_SUPPORT_STATES)[number];

/** Per-dimension status. `not_evaluated` is not a soft `satisfied`. */
export const NEUTRAL_SUPPORT_STATUS_VALUES = [
  "not_evaluated",
  "unsupported",
  "failed",
  "satisfied",
] as const;
export type NeutralSupportStatus = (typeof NEUTRAL_SUPPORT_STATUS_VALUES)[number];

/** Conformance scenario categories. */
export const NEUTRAL_SCENARIO_CATEGORIES = [
  "lifecycle",
  "normalized_event",
  "support_state",
  "unsupported_refusal",
  "receipt_integrity",
  "module_boundary",
  "strangler_migration",
  "version_drift",
] as const;
export type NeutralScenarioCategory = (typeof NEUTRAL_SCENARIO_CATEGORIES)[number];

/**
 * Reason codes. Every non-succeeded outcome carries exactly one, so a caller can
 * always tell UNSUPPORTED (capability absent) from REFUSED (policy or gate said
 * no) from FAILED (it was tried and could not be trusted). There is deliberately
 * no undifferentiated `supported` / `ok` code.
 */
export const NEUTRAL_REASON_CODES = [
  // lifecycle + gate
  "gate_unsatisfied",
  "unknown_event",
  "unknown_phase",
  "unknown_observation_state",
  "unknown_terminal_state",
  "run_already_closed",
  "capability_snapshot_mismatch",
  "required_observation_missing",
  "required_observation_failed",
  "required_gate_outcome_missing",
  // capability + policy
  "capability_absent",
  "authentication_failed",
  "policy_denied",
  "approval_required",
  // admission (MH-02-R1-B01): the lifecycle path decides, it never trusts a verdict
  "admission_context_missing",
  "execution_failed",
  // not-applicable rule binding (MH-02-R1-B02)
  "not_applicable_rule_missing",
  "not_applicable_rule_unknown",
  "not_applicable_rule_mismatch",
  // normalized-event vocabulary compatibility (MH-02-R1-B05)
  "event_vocabulary_superseded",
  "event_vocabulary_ambiguous",
  // support + conformance
  "support_precondition_unproven",
  "support_operation_failed",
  "scenario_evidence_incomplete",
  "scenario_result_mismatch",
  "scenario_registry_invalid",
  // conformance evidence binding (MH-02-R1-B04)
  "scenario_suite_version_mismatch",
  "scenario_required_set_mismatch",
  "scenario_results_unordered",
  "scenario_receipt_reference_missing",
  "scenario_runtime_binding_mismatch",
  "scenario_evidence_stale",
  // core boundary
  "boundary_forbidden_edge",
  "boundary_unclassified_edge",
  "boundary_membership_mismatch",
] as const;
export type NeutralReasonCode = (typeof NEUTRAL_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function includes(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.indexOf(value) !== -1;
}

export function isNeutralLifecyclePhase(value: unknown): value is NeutralLifecyclePhase {
  return includes(NEUTRAL_LIFECYCLE_PHASES, value);
}

export function isNeutralDisposition(value: unknown): value is NeutralDisposition {
  return includes(NEUTRAL_DISPOSITIONS, value);
}

export function isNeutralObservationState(value: unknown): value is NeutralObservationState {
  return includes(NEUTRAL_OBSERVATION_STATES, value);
}

export function isNeutralOutcomeType(value: unknown): value is NeutralOutcomeType {
  return includes(NEUTRAL_OUTCOME_TYPES, value);
}

export function isNeutralEventName(value: unknown): value is NeutralEventName {
  return includes(NEUTRAL_EVENT_NAMES, value);
}

export function isNeutralSupportState(value: unknown): value is NeutralSupportState {
  return includes(NEUTRAL_SUPPORT_STATES, value);
}

export function isNeutralSupportStatus(value: unknown): value is NeutralSupportStatus {
  return includes(NEUTRAL_SUPPORT_STATUS_VALUES, value);
}

export function isNeutralScenarioCategory(value: unknown): value is NeutralScenarioCategory {
  return includes(NEUTRAL_SCENARIO_CATEGORIES, value);
}

export function isNeutralReasonCode(value: unknown): value is NeutralReasonCode {
  return includes(NEUTRAL_REASON_CODES, value);
}

/**
 * True only for observation states that permit a clean close. `not_observed` and
 * `observation_failed` are never clean (BR-07 / CI-05).
 */
export function isNeutralCleanObservation(value: unknown): boolean {
  return value === "checked_clean" || value === "not_applicable";
}

// ---------------------------------------------------------------------------
// Deterministic canonicalization + fingerprinting (no crypto, no clock)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: object keys sorted, `undefined`-valued keys dropped so an
 * absent key and an explicitly-undefined key canonicalize identically. Array
 * order is significant and preserved.
 */
export function neutralCanonicalJson(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "number") return Number.isFinite(value as number) ? JSON.stringify(value) : "null";
  if (kind === "boolean" || kind === "string") return JSON.stringify(value);
  if (kind === "undefined" || kind === "function" || kind === "symbol") return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => neutralCanonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${neutralCanonicalJson(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash ^ input.charCodeAt(i)) >>> 0;
    // hash *= 16777619, in 32-bit shift-add form to stay exact in JS numbers.
    hash =
      (((hash << 1) >>> 0) +
        ((hash << 4) >>> 0) +
        ((hash << 7) >>> 0) +
        ((hash << 8) >>> 0) +
        ((hash << 24) >>> 0) +
        hash) >>>
      0;
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  let out = (value >>> 0).toString(16);
  while (out.length < 8) out = `0${out}`;
  return out;
}

/**
 * Versioned, fixed-width, pure fingerprint over the canonical form. Used for
 * pre/post-state equality and cross-host equivalence comparison. Deliberately
 * NOT a cryptographic digest: importing `crypto` would break core import
 * closure, and this value proves equivalence, not integrity.
 */
export function neutralFingerprint(value: unknown): string {
  const canonical = neutralCanonicalJson(value);
  return `nfp1:${hex8(fnv1a32(canonical, 0x811c9dc5))}${hex8(fnv1a32(canonical, 0x01000193))}`;
}

// ---------------------------------------------------------------------------
// Typed outcome
// ---------------------------------------------------------------------------

/**
 * Evidence bindings an outcome carries. Which subset is REQUIRED is decided by
 * the scenario's evidence profile, not by this constructor.
 */
export interface NeutralOutcomeBinding {
  readonly run_id?: string;
  readonly operation_id?: string;
  readonly correlation_id?: string;
  readonly scenario_id?: string;
  readonly host_id?: string;
  readonly host_version?: string;
  readonly runtime_version?: string;
  readonly capability_snapshot_hash?: string;
  readonly contract_version?: number;
}

export interface NeutralOutcome {
  readonly schema_version: typeof NEUTRAL_CONTRACTS_SCHEMA_VERSION;
  readonly type: NeutralOutcomeType;
  readonly disposition: NeutralDisposition;
  /** Exactly one reason code for every non-succeeded disposition; null otherwise. */
  readonly reason_code: NeutralReasonCode | null;
  readonly assertions: readonly string[];
  readonly binding: NeutralOutcomeBinding;
  readonly facts: Readonly<Record<string, unknown>>;
}

export interface NeutralOutcomeInput {
  readonly type: NeutralOutcomeType;
  readonly disposition: NeutralDisposition;
  readonly reason_code?: NeutralReasonCode | null;
  readonly assertions?: readonly string[];
  readonly binding?: NeutralOutcomeBinding;
  readonly facts?: Readonly<Record<string, unknown>>;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Freeze a value and everything it transitively owns. Exported for core reuse. */
export function neutralFreeze<T>(value: T): T {
  return deepFreeze(value);
}

/**
 * The ONLY way the core produces a typed result. Refuses to build a record that
 * would be ambiguous: a `succeeded` outcome may not carry a reason code, and a
 * non-`succeeded` outcome may not omit one. That is what stops "missing,
 * unsupported, failed, stale, satisfied" from collapsing into one value.
 */
export function neutralOutcome(input: NeutralOutcomeInput): NeutralOutcome {
  if (!isNeutralOutcomeType(input.type)) {
    throw new Error(`neutralOutcome: unknown outcome type ${JSON.stringify(input.type)}`);
  }
  if (!isNeutralDisposition(input.disposition)) {
    throw new Error(`neutralOutcome: unknown disposition ${JSON.stringify(input.disposition)}`);
  }
  const reason = input.reason_code === undefined ? null : input.reason_code;
  if (input.disposition === "succeeded") {
    if (reason !== null) {
      throw new Error(
        `neutralOutcome: disposition "succeeded" must not carry a reason_code (got ${JSON.stringify(reason)})`
      );
    }
  } else {
    if (reason === null) {
      throw new Error(
        `neutralOutcome: disposition ${JSON.stringify(input.disposition)} requires a reason_code`
      );
    }
    if (!isNeutralReasonCode(reason)) {
      throw new Error(`neutralOutcome: unknown reason code ${JSON.stringify(reason)}`);
    }
  }

  return deepFreeze({
    schema_version: NEUTRAL_CONTRACTS_SCHEMA_VERSION,
    type: input.type,
    disposition: input.disposition,
    reason_code: reason,
    assertions: [...(input.assertions ?? [])],
    binding: {
      ...(input.binding ?? {}),
      contract_version: input.binding?.contract_version ?? NEUTRAL_CONTRACT_VERSION,
    },
    facts: { ...(input.facts ?? {}) },
  }) as NeutralOutcome;
}

// ---------------------------------------------------------------------------
// Normalized-event vocabulary: normative version + machine-readable compatibility
// (the MH-02-R1-B05 reconciliation)
// ---------------------------------------------------------------------------

/** How a superseded (v1) event name relates to the normative (v2) vocabulary. */
export const NEUTRAL_EVENT_COMPATIBILITY_KINDS = [
  "unchanged",
  "renamed",
  "ambiguous_split",
] as const;
export type NeutralEventCompatibilityKind = (typeof NEUTRAL_EVENT_COMPATIBILITY_KINDS)[number];

export interface NeutralEventCompatibilityRule {
  readonly from: string;
  /** The single normative replacement, or `null` when no lossless one exists. */
  readonly to: string | null;
  readonly kind: NeutralEventCompatibilityKind;
  /** Populated only for `ambiguous_split`: the candidates that cannot be chosen between. */
  readonly candidates: readonly string[];
}

/**
 * The v1 → v2 mapping, stated per legacy name. It is deliberately a PARTIAL
 * function: `task.transition` has two normative images and therefore NO lossless
 * mapping, which is recorded as `ambiguous_split` rather than resolved by guess.
 */
export const NEUTRAL_EVENT_COMPATIBILITY_RULES: readonly NeutralEventCompatibilityRule[] = [
  { from: "session.start", to: "session.start", kind: "unchanged", candidates: [] },
  { from: "prompt.submit", to: "prompt.submit", kind: "unchanged", candidates: [] },
  { from: "context.compact", to: "context.compact", kind: "unchanged", candidates: [] },
  { from: "session.resume", to: "run.resume", kind: "renamed", candidates: [] },
  { from: "tool.pre", to: "tool.before", kind: "renamed", candidates: [] },
  { from: "tool.post", to: "tool.after", kind: "renamed", candidates: [] },
  { from: "session.stop", to: "run.stop", kind: "renamed", candidates: [] },
  {
    from: "task.transition",
    to: null,
    kind: "ambiguous_split",
    candidates: ["task.dispatch", "task.collect"],
  },
];

/** The superseded 8-name list, exactly as `guild.normalized_event.v1` declared it. */
export const NEUTRAL_SUPERSEDED_EVENT_NAMES_V1 = [
  "session.start",
  "session.resume",
  "prompt.submit",
  "tool.pre",
  "tool.post",
  "context.compact",
  "task.transition",
  "session.stop",
] as const;

/**
 * v2 names with NO v1 preimage at all. A name reachable only as an ambiguous
 * `candidate` (`task.dispatch`, `task.collect`) is deliberately NOT counted as
 * introduced: it has a v1 preimage, just not an invertible one.
 */
export const NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2: readonly string[] = NEUTRAL_EVENT_NAMES.filter(
  (name) =>
    !NEUTRAL_EVENT_COMPATIBILITY_RULES.some(
      (rule) => rule.to === name || rule.candidates.indexOf(name) !== -1
    )
);

/**
 * The shared normative block. This object is mirrored BYTE-FOR-BYTE by the
 * `normalized_event_vocabulary` key in BOTH frozen W0 contract artifacts. It is
 * declared natively here — the plugin never imports umbrella source — and the
 * focused tests prove field equality against both artifacts read as data.
 */
export const NEUTRAL_NORMALIZED_EVENT_VOCABULARY = neutralFreeze({
  block_id: "guild.normalized_event_vocabulary.v1",
  normative_version: "guild.normalized_event.v2",
  reconciles: "MH-02-R1-B05",
  vocabulary_owner: "host-neutral-core",
  native_mapping_owner: "host-adapters",
  transport_fact_owner: "execution-transports",
  consumer: "host-neutral-core",
  normative_event_names: [...NEUTRAL_EVENT_NAMES],
  superseded_versions: [
    {
      version: "guild.normalized_event.v1",
      status: "superseded",
      superseded_by: "guild.normalized_event.v2",
      event_types: [...NEUTRAL_SUPERSEDED_EVENT_NAMES_V1],
    },
  ],
  compatibility: {
    policy: "explicit_typed_mapping",
    mapping_totality: "partial",
    superseded_disposition: "refused",
    superseded_reason_code: "event_vocabulary_superseded",
    ambiguous_disposition: "refused",
    ambiguous_reason_code: "event_vocabulary_ambiguous",
    unmapped_disposition: "refused",
    unmapped_reason_code: "unknown_event",
    rules: NEUTRAL_EVENT_COMPATIBILITY_RULES.map((rule) => ({
      from: rule.from,
      to: rule.to,
      kind: rule.kind,
      candidates: [...rule.candidates],
    })),
    introduced_in_v2: [...NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2],
  },
});

/**
 * Decide what a SUPERSEDED event name means under the normative vocabulary.
 *
 * Every answer is typed, and none of them is "quietly use the replacement". A
 * name with a lossless image is refused WITH that image named, so an adapter is
 * told exactly what to send; `task.transition` is refused as ambiguous with both
 * candidates named, because choosing one would be the silent guess the frozen
 * contract's rule 3 forbids.
 */
export function mapLegacyNeutralEventName(name: unknown): NeutralOutcome {
  // The three `unchanged` names are members of BOTH versions. A name that is
  // already normative is not legacy at all, so it resolves to itself and is
  // accepted — checking this FIRST is what stops `session.start` from being
  // reported as superseded merely because it also existed in v1.
  if (isNeutralEventName(name)) {
    return neutralOutcome({
      type: "guild.version_compatibility_outcome.v1",
      disposition: "succeeded",
      assertions: ["the submitted name is already a normative event name"],
      facts: {
        submitted_event_name: name,
        normative_version: "guild.normalized_event.v2",
        normative_event_name: name,
        candidates: [],
        compatibility_kind: "unchanged",
      },
    });
  }

  const rule = NEUTRAL_EVENT_COMPATIBILITY_RULES.find((candidate) => candidate.from === name);

  if (rule === undefined) {
    return neutralOutcome({
      type: "guild.version_compatibility_outcome.v1",
      disposition: "refused",
      reason_code: "unknown_event",
      assertions: [
        "the normalized event vocabulary is closed",
        "the event is not silently skipped",
      ],
      facts: {
        submitted_event_name: name ?? null,
        normative_version: "guild.normalized_event.v2",
        in_normative_vocabulary: isNeutralEventName(name),
      },
    });
  }

  if (rule.kind === "ambiguous_split") {
    return neutralOutcome({
      type: "guild.version_compatibility_outcome.v1",
      disposition: "refused",
      reason_code: "event_vocabulary_ambiguous",
      assertions: [
        "a superseded name with two normative images has no lossless mapping",
        "the core refuses rather than choosing a replacement",
      ],
      facts: {
        submitted_event_name: rule.from,
        superseded_version: "guild.normalized_event.v1",
        normative_version: "guild.normalized_event.v2",
        normative_event_name: null,
        candidates: [...rule.candidates],
        compatibility_kind: rule.kind,
      },
    });
  }

  return neutralOutcome({
    type: "guild.version_compatibility_outcome.v1",
    disposition: "refused",
    reason_code: "event_vocabulary_superseded",
    assertions: [
      "the submitted name belongs to a superseded vocabulary version",
      "its single normative replacement is named, and no substitution is performed",
    ],
    facts: {
      submitted_event_name: rule.from,
      superseded_version: "guild.normalized_event.v1",
      normative_version: "guild.normalized_event.v2",
      normative_event_name: rule.to,
      candidates: [],
      compatibility_kind: rule.kind,
    },
  });
}
