/**
 * src/modules/lifecycle/workflows/neutral-conformance-core.ts
 *
 * Scenario definitions, support-claim semantics, and the conformance decision.
 *
 * MH-02 / W1 of `multi-host-runtime-convergence`. Boundary: `host-neutral-core`,
 * which per MH-01A owns "receipt semantics and conformance decision semantics",
 * and is the `claim_owner` of the support-state contract. The EVIDENCE is owned
 * by observability (MH-06), the distribution OPERATIONS by execution transports,
 * and the host FACTS by adapters. This file decides; it never gathers.
 *
 * SCOPE — deliberately narrow
 *   `NEUTRAL_CORE_SCENARIOS` declares exactly the five scenarios whose
 *   `implementation_wave_owner` is W1/MH-02. The other 26 scenarios in
 *   `guild.conformance_scenarios.v1` belong to MH-03, MH-06, MH-07, MH-08, and
 *   MH-09; declaring them here would be claiming another owner's work while its
 *   `implementation_status` is still `not_implemented`.
 *
 * PROVENANCE — these definitions are AUTHORED, not imported
 *   The frozen suite lives in a different repository. Copying it in would be a
 *   cross-repository source import, which the compatibility policy prohibits.
 *   So the five definitions below are authored natively against the contract,
 *   reusing its `stable_id` values as IDENTIFIERS (which is what a stable id is
 *   for) and its closed vocabularies as the validation target. The suite id and
 *   version are pinned so a future suite revision surfaces as a drift check
 *   rather than a silent mismatch.
 *
 * Declared member of the import-closed neutral core: its only import is another
 * core member. No I/O, no clock, no host handle.
 *
 * Pure library module; there is no CLI entrypoint.
 */

import {
  NEUTRAL_SUPPORT_STATES,
  isNeutralDisposition,
  isNeutralEventName,
  isNeutralOutcomeType,
  isNeutralScenarioCategory,
  isNeutralSupportStatus,
  neutralFreeze,
  neutralOutcome,
} from "./neutral-runtime-contracts";
import type {
  NeutralDisposition,
  NeutralEventName,
  NeutralOutcome,
  NeutralOutcomeType,
  NeutralScenarioCategory,
  NeutralSupportState,
  NeutralSupportStatus,
} from "./neutral-runtime-contracts";

// ---------------------------------------------------------------------------
// Suite identity
// ---------------------------------------------------------------------------

export const NEUTRAL_SCENARIO_SUITE_ID = "guild.conformance_scenarios.v1";
export const NEUTRAL_SCENARIO_SUITE_VERSION = "1.0.0";

export interface NeutralWaveOwner {
  readonly wave_id: string;
  readonly work_item_id: string;
  readonly key: string;
}

export const NEUTRAL_CORE_WAVE_OWNER: NeutralWaveOwner = neutralFreeze({
  wave_id: "W1",
  work_item_id: "MH-02",
  key: "W1/MH-02",
});

// ---------------------------------------------------------------------------
// Evidence profiles
// ---------------------------------------------------------------------------

export interface NeutralEvidenceProfile {
  readonly required_kinds: readonly string[];
  readonly required_bindings: readonly string[];
}

/** Only the profiles the five MH-02 scenarios actually reference. */
export const NEUTRAL_EVIDENCE_PROFILES: Readonly<Record<string, NeutralEvidenceProfile>> =
  neutralFreeze({
    "E-LIFECYCLE": {
      required_kinds: ["capability_snapshot", "normalized_event_log", "typed_outcome", "receipt_journal"],
      required_bindings: [
        "run_id",
        "operation_id",
        "scenario_id",
        "host_id",
        "host_version",
        "runtime_version",
        "contract_version",
      ],
    },
    "E-REFUSAL": {
      required_kinds: ["capability_snapshot", "typed_outcome", "receipt_journal"],
      required_bindings: ["scenario_id", "operation_id", "reason_code", "host_id", "runtime_version"],
    },
  });

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

export interface NeutralScenarioEvidenceRequirement {
  readonly profile: string;
  readonly assertions: readonly string[];
}

export interface NeutralScenarioDefinition {
  readonly stable_id: string;
  readonly category: NeutralScenarioCategory;
  readonly title: string;
  readonly preconditions: readonly string[];
  readonly action_event: { readonly name: NeutralEventName; readonly input: Readonly<Record<string, unknown>> };
  readonly expected_typed_outcome: {
    readonly type: NeutralOutcomeType;
    readonly disposition: NeutralDisposition;
    readonly assertions: readonly string[];
  };
  readonly evidence_requirements: readonly NeutralScenarioEvidenceRequirement[];
  readonly implementation_wave_owner: NeutralWaveOwner;
}

export const NEUTRAL_CORE_SCENARIOS: readonly NeutralScenarioDefinition[] = neutralFreeze([
  {
    stable_id: "MHRC-LIF-001",
    category: "lifecycle",
    title: "Equivalent phase entry produces equivalent lifecycle state",
    preconditions: [
      "two hosts expose the required phase-entry capability",
      "both runs use byte-identical immutable capability snapshots",
      "both runs start in the same lifecycle state",
    ],
    action_event: {
      name: "prompt.submit",
      input: {
        semantic_intent: "enter_phase",
        phase_matrix: ["init", "ideate", "plan", "build", "qa", "ops"],
      },
    },
    expected_typed_outcome: {
      type: "guild.lifecycle_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "host pairs reach the same semantic phase state",
        "host pairs emit the same lifecycle decision code",
        "host-native fields are excluded from equivalence comparison",
      ],
    },
    evidence_requirements: [
      {
        profile: "E-LIFECYCLE",
        assertions: [
          "one event/outcome pair per host and phase",
          "capability snapshot hash is constant within each run",
        ],
      },
    ],
    implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-LIF-002",
    category: "lifecycle",
    title: "Equivalent gate violation produces equivalent refusal",
    preconditions: [
      "two hosts support the normalized pre-tool event",
      "the same policy and lifecycle state apply",
      "the proposed operation violates the same gate",
    ],
    action_event: {
      name: "tool.before",
      input: { operation_class: "mutating", gate_condition: "unsatisfied" },
    },
    expected_typed_outcome: {
      type: "guild.lifecycle_outcome.v1",
      disposition: "refused",
      assertions: [
        "both hosts preserve the prior state",
        "both hosts return the same refusal reason code",
        "no tool side effect occurs",
      ],
    },
    evidence_requirements: [
      {
        profile: "E-LIFECYCLE",
        assertions: [
          "pre-state and post-state hashes match",
          "refusal receipt precedes any terminal run receipt",
        ],
      },
    ],
    implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-LIF-003",
    category: "lifecycle",
    title: "Compaction and resume preserve lifecycle identity",
    preconditions: [
      "an open run has durable state and receipts",
      "the host supports compact or resume observation",
      "no capability snapshot mutation is permitted",
    ],
    action_event: { name: "context.compact", input: { then: "run.resume" } },
    expected_typed_outcome: {
      type: "guild.lifecycle_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "run_id and capability snapshot hash are unchanged",
        "resume continues from the last durable lifecycle state",
        "already-applied transitions are not repeated",
      ],
    },
    evidence_requirements: [
      {
        profile: "E-LIFECYCLE",
        assertions: [
          "pre-compact checkpoint links to post-resume event",
          "receipt sequences remain monotonic",
        ],
      },
    ],
    implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-LIF-004",
    category: "lifecycle",
    title: "Run close requires equivalent terminal evidence",
    preconditions: [
      "two runs have equivalent normalized histories",
      "all required gates have typed outcomes",
      "receipt reconciliation is complete",
    ],
    action_event: { name: "run.stop", input: { requested_terminal_state: "completed" } },
    expected_typed_outcome: {
      type: "guild.lifecycle_outcome.v1",
      disposition: "succeeded",
      assertions: [
        "both hosts reach the same terminal state",
        "completion is refused if any required observation is missing or failed",
        "terminal receipt is last in logical order",
      ],
    },
    evidence_requirements: [
      {
        profile: "E-LIFECYCLE",
        assertions: [
          "gate-outcome set is complete",
          "reconciliation checkpoint covers the terminal sequence",
        ],
      },
    ],
    implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER,
  },
  {
    stable_id: "MHRC-UNS-002",
    category: "unsupported_refusal",
    title: "Policy refusal is distinct from unsupported capability",
    preconditions: [
      "the capability exists",
      "policy denies the requested operation",
      "the caller has not supplied required approval",
    ],
    action_event: { name: "tool.before", input: { policy_decision: "deny" } },
    expected_typed_outcome: {
      type: "guild.policy_outcome.v1",
      disposition: "refused",
      assertions: [
        "reason code identifies policy denial",
        "capability remains supported",
        "no operation side effect occurs",
      ],
    },
    evidence_requirements: [
      {
        profile: "E-REFUSAL",
        assertions: [
          "policy version and decision inputs are bound",
          "receipt distinguishes refused from unsupported",
        ],
      },
    ],
    implementation_wave_owner: NEUTRAL_CORE_WAVE_OWNER,
  },
]);

// ---------------------------------------------------------------------------
// Registry validation
// ---------------------------------------------------------------------------

/**
 * Enforce the frozen `scenario_field_contract` over a scenario set.
 *
 * Reported as `guild.boundary_outcome.v1` — the closed outcome vocabulary has no
 * dedicated registry-verdict type, and a boundary outcome is the family member
 * that already means "a verdict over declared definitions and their edges"
 * (its evidence kind is literally `boundary_verdict`). Inventing an eleventh
 * outcome type would break the closed vocabulary, which is worse.
 */
export function validateNeutralScenarioRegistry(
  scenarios: readonly NeutralScenarioDefinition[] = NEUTRAL_CORE_SCENARIOS
): NeutralOutcome {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const scenario of scenarios) {
    const id = scenario.stable_id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push("scenario is missing a stable_id");
      continue;
    }
    if (seen.has(id)) errors.push(`duplicate stable_id ${id}`);
    seen.add(id);

    if (!isNeutralScenarioCategory(scenario.category)) {
      errors.push(`scenario ${id}: unknown category ${JSON.stringify(scenario.category)}`);
    }
    if (typeof scenario.title !== "string" || scenario.title.length === 0) {
      errors.push(`scenario ${id}: title must be a non-empty string`);
    }
    if (!Array.isArray(scenario.preconditions) || scenario.preconditions.length === 0) {
      errors.push(`scenario ${id}: preconditions must be a non-empty array`);
    }
    if (!scenario.action_event || !isNeutralEventName(scenario.action_event.name)) {
      errors.push(
        `scenario ${id}: action_event.name ${JSON.stringify(scenario.action_event?.name)} is not a closed event name`
      );
    }

    const expected = scenario.expected_typed_outcome;
    if (!expected) {
      errors.push(`scenario ${id}: expected_typed_outcome is required`);
    } else {
      if (!isNeutralOutcomeType(expected.type)) {
        errors.push(`scenario ${id}: unknown outcome type ${JSON.stringify(expected.type)}`);
      }
      if (!isNeutralDisposition(expected.disposition)) {
        errors.push(`scenario ${id}: unknown disposition ${JSON.stringify(expected.disposition)}`);
      }
      if (!Array.isArray(expected.assertions) || expected.assertions.length === 0) {
        errors.push(`scenario ${id}: expected_typed_outcome.assertions must be non-empty`);
      }
    }

    if (!Array.isArray(scenario.evidence_requirements) || scenario.evidence_requirements.length === 0) {
      errors.push(`scenario ${id}: evidence_requirements must be a non-empty array`);
    } else {
      for (const requirement of scenario.evidence_requirements) {
        if (NEUTRAL_EVIDENCE_PROFILES[requirement.profile] === undefined) {
          errors.push(
            `scenario ${id}: unknown evidence profile ${JSON.stringify(requirement.profile)}`
          );
        }
        if (!Array.isArray(requirement.assertions) || requirement.assertions.length === 0) {
          errors.push(`scenario ${id}: evidence profile ${requirement.profile} needs assertions`);
        }
      }
    }

    const owner = scenario.implementation_wave_owner;
    if (!owner || !owner.wave_id || !owner.work_item_id) {
      errors.push(`scenario ${id}: implementation_wave_owner must name exactly one owner`);
    } else if (owner.key !== `${owner.wave_id}/${owner.work_item_id}`) {
      errors.push(`scenario ${id}: implementation_wave_owner.key disagrees with its parts`);
    }
  }

  const facts = {
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    scenario_count: scenarios.length,
    unique_stable_ids: seen.size,
    errors,
  };

  return errors.length === 0
    ? neutralOutcome({
        type: "guild.boundary_outcome.v1",
        disposition: "succeeded",
        assertions: ["every scenario satisfies the frozen scenario_field_contract"],
        facts,
      })
    : neutralOutcome({
        type: "guild.boundary_outcome.v1",
        disposition: "failed",
        reason_code: "scenario_registry_invalid",
        assertions: ["an invalid scenario registry cannot back a conformance claim"],
        facts,
      });
}

// ---------------------------------------------------------------------------
// Support claim — six orthogonal dimensions
// ---------------------------------------------------------------------------

export type NeutralSupportRecord = Readonly<Record<NeutralSupportState, NeutralSupportStatus>>;

export const NEUTRAL_UNEVALUATED_SUPPORT: NeutralSupportRecord = neutralFreeze({
  recognized: "not_evaluated",
  rendered: "not_evaluated",
  installed: "not_evaluated",
  activated: "not_evaluated",
  updated: "not_evaluated",
  conformant: "not_evaluated",
}) as NeutralSupportRecord;

export interface NeutralSupportTransitionRule {
  readonly operation: string;
  /** `state:status` requirements that must already hold. */
  readonly requires: readonly string[];
  readonly may_satisfy: NeutralSupportState;
  /** Dimensions forced back to `not_evaluated` when this operation lands. */
  readonly resets: readonly NeutralSupportState[];
}

/** The five transition rules of the frozen support-state contract. */
export const NEUTRAL_SUPPORT_TRANSITIONS: readonly NeutralSupportTransitionRule[] = neutralFreeze([
  { operation: "render", requires: ["recognized:satisfied"], may_satisfy: "rendered", resets: [] },
  { operation: "install", requires: ["rendered:satisfied"], may_satisfy: "installed", resets: [] },
  { operation: "activate", requires: ["installed:satisfied"], may_satisfy: "activated", resets: [] },
  {
    operation: "update",
    requires: ["installed:satisfied"],
    may_satisfy: "updated",
    // An update invalidates any prior activation and conformance proof: the bytes
    // that were verified are no longer the bytes that are installed.
    resets: ["activated", "conformant"],
  },
  { operation: "verify", requires: ["activated:satisfied"], may_satisfy: "conformant", resets: [] },
]);

export interface NeutralSupportTransitionResult {
  readonly record: NeutralSupportRecord;
  readonly outcome: NeutralOutcome;
}

/**
 * Advance ONE support dimension. A precondition that is not yet `satisfied`
 * refuses the transition and leaves the record untouched, which is how
 * "recognition does not imply rendering" stays true structurally rather than by
 * convention.
 */
export function applyNeutralSupportTransition(
  record: NeutralSupportRecord,
  operation: string,
  result: { readonly satisfied: boolean }
): NeutralSupportTransitionResult {
  const rule = NEUTRAL_SUPPORT_TRANSITIONS.find((candidate) => candidate.operation === operation);
  if (rule === undefined) {
    throw new Error(`applyNeutralSupportTransition: unknown support operation ${JSON.stringify(operation)}`);
  }

  const unmet = rule.requires.filter((requirement) => {
    const [state, status] = requirement.split(":");
    return record[state as NeutralSupportState] !== status;
  });

  if (unmet.length > 0) {
    return {
      record,
      outcome: neutralOutcome({
        type: "guild.support_transition_outcome.v1",
        disposition: "refused",
        reason_code: "support_precondition_unproven",
        assertions: ["an unproven precondition cannot promote the next dimension"],
        facts: { operation, unmet_requirements: unmet, may_satisfy: rule.may_satisfy },
      }),
    };
  }

  const next: Record<string, NeutralSupportStatus> = { ...record };
  next[rule.may_satisfy] = result.satisfied ? "satisfied" : "failed";
  if (result.satisfied) {
    for (const reset of rule.resets) next[reset] = "not_evaluated";
  }
  const frozen = neutralFreeze(next) as NeutralSupportRecord;

  return {
    record: frozen,
    outcome: result.satisfied
      ? neutralOutcome({
          type: "guild.support_transition_outcome.v1",
          disposition: "succeeded",
          assertions: [
            `${rule.may_satisfy} is proven for this operation only`,
            "no later dimension is implied",
          ],
          facts: { operation, satisfied: rule.may_satisfy, reset: [...rule.resets] },
        })
      : neutralOutcome({
          type: "guild.support_transition_outcome.v1",
          disposition: "failed",
          reason_code: "support_operation_failed",
          assertions: ["a failed operation records failure and promotes nothing"],
          facts: { operation, failed: rule.may_satisfy },
        }),
  };
}

export interface NeutralSupportClaim {
  readonly states: NeutralSupportRecord;
  /** Always false: this shape exists so a claim CANNOT be collapsed. */
  readonly collapsed: false;
  readonly proven: readonly NeutralSupportState[];
  readonly unproven: readonly NeutralSupportState[];
}

/**
 * Derive the public support claim. There is intentionally NO boolean
 * `supported` field: the claim rule forbids collapsing missing, unsupported,
 * failed, stale, and satisfied evidence into one undifferentiated value, so the
 * only thing a caller can read is the six-dimension record plus which
 * dimensions are proven.
 */
export function deriveNeutralSupportClaim(record: NeutralSupportRecord): NeutralSupportClaim {
  for (const state of NEUTRAL_SUPPORT_STATES) {
    if (!isNeutralSupportStatus(record[state])) {
      throw new Error(
        `deriveNeutralSupportClaim: ${state} has invalid status ${JSON.stringify(record[state])}`
      );
    }
  }
  const proven = NEUTRAL_SUPPORT_STATES.filter((state) => record[state] === "satisfied");
  const unproven = NEUTRAL_SUPPORT_STATES.filter((state) => record[state] !== "satisfied");
  return neutralFreeze({
    states: { ...record },
    collapsed: false as const,
    proven: [...proven],
    unproven: [...unproven],
  }) as NeutralSupportClaim;
}

// ---------------------------------------------------------------------------
// Conformance decision
// ---------------------------------------------------------------------------

/**
 * The REQUIRED scenario set for this suite version. Declared by the core, not
 * chosen by the caller (MH-02-R1-B04): when the caller picked the required set,
 * it could pick the empty set and promote `conformant` without running anything.
 */
export const NEUTRAL_REQUIRED_CORE_SCENARIO_IDS: readonly string[] = neutralFreeze(
  NEUTRAL_CORE_SCENARIOS.map((scenario) => scenario.stable_id)
);

/** Evidence freshness. `unknown` is not a soft `fresh`. */
export const NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS = ["fresh", "stale", "unknown"] as const;
export type NeutralEvidenceFreshnessVerdict = (typeof NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS)[number];

/**
 * The exact activated runtime a conformance claim is bound to. CI-06 requires a
 * claim to bind conformance to exact release AND runtime identities, so every
 * field is mandatory and every field is compared.
 */
export interface NeutralRuntimeBinding {
  readonly host_id: string;
  readonly host_version: string;
  readonly runtime_version: string;
  readonly release_id: string;
  readonly contract_version: number;
}

/** One ordered, typed, receipt-bound scenario result. */
export interface NeutralScenarioResult {
  readonly stable_id: string;
  readonly outcome_type: NeutralOutcomeType;
  readonly disposition: NeutralDisposition;
  readonly reason_code: string | null;
  /** A reference into the durable receipt journal (MH-06 owns the journal). */
  readonly receipt_ref: string;
  readonly runtime_binding: NeutralRuntimeBinding;
  readonly evidence_freshness: NeutralEvidenceFreshnessVerdict;
}

/** The whole evidence package a promotion decision is taken against. */
export interface NeutralConformanceEvidence {
  readonly suite_id: string;
  readonly suite_version: string;
  readonly required_scenario_ids: readonly string[];
  readonly activated_runtime: NeutralRuntimeBinding;
  /** Ordered: `results[i]` MUST correspond to `required_scenario_ids[i]`. */
  readonly results: readonly NeutralScenarioResult[];
}

const RUNTIME_BINDING_FIELDS: readonly string[] = [
  "host_id",
  "host_version",
  "runtime_version",
  "release_id",
  "contract_version",
];

function runtimeBindingComplete(binding: NeutralRuntimeBinding | undefined): boolean {
  if (binding === undefined || binding === null) return false;
  if (typeof binding.contract_version !== "number") return false;
  for (const field of RUNTIME_BINDING_FIELDS) {
    if (field === "contract_version") continue;
    const value = (binding as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

function sameRuntimeBinding(a: NeutralRuntimeBinding, b: NeutralRuntimeBinding): boolean {
  return RUNTIME_BINDING_FIELDS.every(
    (field) =>
      (a as unknown as Record<string, unknown>)[field] ===
      (b as unknown as Record<string, unknown>)[field]
  );
}

function refuseConformance(
  reason:
    | "scenario_suite_version_mismatch"
    | "scenario_required_set_mismatch"
    | "scenario_results_unordered"
    | "scenario_evidence_incomplete"
    | "scenario_receipt_reference_missing"
    | "scenario_runtime_binding_mismatch"
    | "scenario_evidence_stale",
  assertions: readonly string[],
  facts: Readonly<Record<string, unknown>>
): NeutralOutcome {
  return neutralOutcome({
    type: "guild.support_transition_outcome.v1",
    disposition: "refused",
    reason_code: reason,
    assertions: [...assertions],
    facts: { ...facts, may_promote_conformant: false },
  });
}

/**
 * Decide whether `conformant` may be promoted (MH-02-R1-B04).
 *
 * Round 1 accepted `({}, [])` and five bare `{disposition}` strings, which meant
 * a caller could publish a conformance claim without running a scenario. Every
 * gate below exists because its absence was exploitable:
 *
 *   1. the suite version tuple must be the pinned one          (no silent drift)
 *   2. the required set must be the CORE's set, non-empty      (no empty suite)
 *   3. results must be ordered against that set                (no re-association)
 *   4. each result must be a typed outcome, not a string       (no bare verdicts)
 *   5. each result must cite a receipt reference               (no evidence-free pass)
 *   6. each result must bind the EXACT activated runtime       (no cross-release reuse)
 *   7. every result's freshness verdict must be `fresh`        (no stale evidence)
 *   8. each disposition must match the scenario's expectation  (the original check)
 *
 * An expected REFUSAL that actually refused is still a pass — explicitly
 * refusing is the correct behaviour for the refusal scenarios, and it is what
 * "passed or explicitly refused every required scenario" means.
 */
export function evaluateNeutralConformanceDecision(
  evidence: NeutralConformanceEvidence,
  scenarios: readonly NeutralScenarioDefinition[] = NEUTRAL_CORE_SCENARIOS
): NeutralOutcome {
  const required = evidence?.required_scenario_ids ?? [];
  const results = evidence?.results ?? [];
  const expectedRequired = scenarios.map((scenario) => scenario.stable_id);

  const baseFacts = {
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    submitted_suite_id: evidence?.suite_id ?? null,
    submitted_suite_version: evidence?.suite_version ?? null,
    required_count: required.length,
    result_count: results.length,
  };

  // 1 — suite identity
  if (
    evidence?.suite_id !== NEUTRAL_SCENARIO_SUITE_ID ||
    evidence?.suite_version !== NEUTRAL_SCENARIO_SUITE_VERSION
  ) {
    return refuseConformance(
      "scenario_suite_version_mismatch",
      [
        "a conformance claim is bound to one exact suite id and version",
        "a claim against an unpinned suite proves nothing",
      ],
      baseFacts
    );
  }

  // 2 — the required set is the core's, and it is not empty
  const missingRequired = expectedRequired.filter((id) => required.indexOf(id) === -1);
  const extraRequired = required.filter((id) => expectedRequired.indexOf(id) === -1);
  if (required.length === 0 || missingRequired.length > 0 || extraRequired.length > 0) {
    return refuseConformance(
      "scenario_required_set_mismatch",
      [
        "the required scenario set is declared by the core for this suite version",
        "an empty or caller-selected required set cannot back a conformance claim",
      ],
      {
        ...baseFacts,
        declared_required_scenario_ids: [...expectedRequired],
        omitted_required_scenarios: missingRequired,
        undeclared_scenarios: extraRequired,
      }
    );
  }

  // 3 — ordered results, one per required scenario, in the same order
  if (results.length !== required.length) {
    return refuseConformance(
      "scenario_evidence_incomplete",
      [
        "every required scenario needs exactly one result",
        "absence of evidence is never success",
      ],
      { ...baseFacts, declared_required_scenario_ids: [...expectedRequired] }
    );
  }
  const outOfOrder = required
    .map((id, index) => ({ index, expected: id, observed: results[index]?.stable_id ?? null }))
    .filter((entry) => entry.expected !== entry.observed);
  if (outOfOrder.length > 0) {
    return refuseConformance(
      "scenario_results_unordered",
      [
        "ordered results are what makes a result attributable to its scenario",
        "an unordered result set cannot be attributed",
      ],
      { ...baseFacts, out_of_order: outOfOrder }
    );
  }

  // 4/5 — typed outcomes with receipt references
  const untyped: Array<Record<string, unknown>> = [];
  const receiptless: string[] = [];
  for (const result of results) {
    const typedOk =
      isNeutralOutcomeType(result.outcome_type) &&
      isNeutralDisposition(result.disposition) &&
      (result.disposition === "succeeded"
        ? result.reason_code === null || result.reason_code === undefined
        : typeof result.reason_code === "string" && result.reason_code.length > 0);
    if (!typedOk) {
      untyped.push({
        stable_id: result.stable_id,
        outcome_type: result.outcome_type ?? null,
        disposition: result.disposition ?? null,
        reason_code: result.reason_code ?? null,
      });
    }
    if (typeof result.receipt_ref !== "string" || result.receipt_ref.length === 0) {
      receiptless.push(result.stable_id);
    }
  }
  if (untyped.length > 0) {
    return refuseConformance(
      "scenario_evidence_incomplete",
      [
        "a scenario result is a typed outcome, not a bare disposition string",
        "a succeeded result carries no reason code and a non-succeeded result must carry one",
      ],
      { ...baseFacts, untyped_results: untyped }
    );
  }
  if (receiptless.length > 0) {
    return refuseConformance(
      "scenario_receipt_reference_missing",
      [
        "every scenario result cites the receipt that records it",
        "a result with no receipt reference is unverifiable",
      ],
      { ...baseFacts, results_without_receipt_reference: receiptless }
    );
  }

  // 6 — exact activated-runtime binding
  if (!runtimeBindingComplete(evidence.activated_runtime)) {
    return refuseConformance(
      "scenario_runtime_binding_mismatch",
      [
        "a conformance claim names the exact activated runtime",
        "an incomplete runtime binding cannot be compared",
      ],
      { ...baseFacts, activated_runtime: evidence.activated_runtime ?? null }
    );
  }
  const misbound = results
    .filter(
      (result) =>
        !runtimeBindingComplete(result.runtime_binding) ||
        !sameRuntimeBinding(result.runtime_binding, evidence.activated_runtime)
    )
    .map((result) => ({ stable_id: result.stable_id, runtime_binding: result.runtime_binding ?? null }));
  if (misbound.length > 0) {
    return refuseConformance(
      "scenario_runtime_binding_mismatch",
      [
        "every result must have been produced by the exact activated runtime",
        "evidence from another release or runtime cannot be reused",
      ],
      { ...baseFacts, activated_runtime: evidence.activated_runtime, misbound_results: misbound }
    );
  }

  // 7 — explicit freshness verdict
  const notFresh = results
    .filter((result) => result.evidence_freshness !== "fresh")
    .map((result) => ({ stable_id: result.stable_id, evidence_freshness: result.evidence_freshness ?? null }));
  if (notFresh.length > 0) {
    return refuseConformance(
      "scenario_evidence_stale",
      [
        "every required scenario needs an explicit fresh evidence verdict",
        "stale or unknown freshness is never read as fresh",
      ],
      { ...baseFacts, non_fresh_results: notFresh }
    );
  }

  // 8 — disposition matches the scenario's expectation
  const mismatched = results
    .map((result) => {
      const definition = scenarios.find((scenario) => scenario.stable_id === result.stable_id);
      const expected = definition?.expected_typed_outcome.disposition;
      return { stable_id: result.stable_id, expected: expected ?? null, observed: result.disposition };
    })
    .filter((entry) => entry.expected !== entry.observed);
  if (mismatched.length > 0) {
    return neutralOutcome({
      type: "guild.support_transition_outcome.v1",
      disposition: "failed",
      reason_code: "scenario_result_mismatch",
      assertions: ["any required failed scenario prevents promotion"],
      facts: { ...baseFacts, mismatched_scenarios: mismatched, may_promote_conformant: false },
    });
  }

  return neutralOutcome({
    type: "guild.support_transition_outcome.v1",
    disposition: "succeeded",
    assertions: [
      "conformant may be promoted only for the exact evidence-bound version tuple",
      "constructed adapter smoke cannot satisfy lifecycle conformance",
      "every required scenario passed or explicitly refused under fresh, receipt-bound evidence",
    ],
    facts: {
      ...baseFacts,
      activated_runtime: evidence.activated_runtime,
      evaluated_scenarios: results.map((result) => ({
        stable_id: result.stable_id,
        disposition: result.disposition,
        receipt_ref: result.receipt_ref,
      })),
      may_promote_conformant: true,
    },
  });
}
