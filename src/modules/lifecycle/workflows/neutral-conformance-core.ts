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
  NEUTRAL_CONTRACT_VERSION,
  NEUTRAL_SUPPORT_STATES,
  isNeutralDisposition,
  isNeutralEventName,
  isNeutralOutcomeType,
  isNeutralReasonCode,
  isNeutralScenarioCategory,
  isNeutralSupportStatus,
  neutralFingerprint,
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
 * The REQUIRED scenario TUPLE for this suite version — ordered, immutable, and
 * declared by the core rather than chosen by the caller.
 *
 * MH-02-R1-B04 established that a caller-picked required SET could be the empty
 * set. MH-02-R2-B03 established two further holes that a set alone cannot close:
 * the decision function still accepted a caller-supplied `scenarios` array (so a
 * caller could re-derive the required set from a one-scenario suite of its own),
 * and the comparison was set-based (so the caller could reorder both the tuple
 * and the results together and still promote). This constant is now the ONLY
 * source of the required set, and it is compared element-by-element in ORDER,
 * because an ordered tuple is what makes `results[i]` attributable to
 * `required[i]` at all.
 */
export const NEUTRAL_REQUIRED_CORE_SCENARIO_IDS: readonly string[] = neutralFreeze(
  NEUTRAL_CORE_SCENARIOS.map((scenario) => scenario.stable_id)
);

/**
 * The canonical receipt-reference form: `guild.receipt_ref.v1:<journal>#<seq>`.
 *
 * A conformance result cites the durable receipt that records it (MH-06 owns
 * the journal). Round 2 accepted the literal string `bogus` for all five
 * results, which is a reference to nothing — the check was "non-empty string",
 * and a non-empty string is not a reference. The core cannot READ the journal
 * (it performs no I/O), so what it CAN require is that the citation be a
 * well-formed, resolvable, per-scenario-distinct address into one: a schema
 * marker, a journal id, and a canonical sequence number.
 */
export const NEUTRAL_RECEIPT_REF_SCHEMA = "guild.receipt_ref.v1";

/**
 * The canonical receipt reference is `…:<journal>#<seq>@<commitment>`.
 *
 * Round 3 accepted `guild.receipt_ref.v1:forged-journal#3`: canonical SHAPE, and
 * a reference to nothing. Shape can be typed by anyone, so the reference now
 * carries a COMMITMENT — a digest over the authority's identity tuple, the
 * journal, the sequence, and the exact outcome the receipt is supposed to record
 * (see `neutralEvidenceCommitment`). A shaped label with no commitment, or with a
 * commitment over anything other than what it claims, is not a reference.
 */
const NEUTRAL_RECEIPT_REF_PATTERN = new RegExp(
  "^guild\\.receipt_ref\\.v1:([A-Za-z0-9][A-Za-z0-9._-]{2,})#(0|[1-9][0-9]*)@(nec1:[0-9a-f]{16})$"
);

/**
 * The runtime identities this core recognizes: `guild-<major>.<minor>.<patch>`
 * with an optional pre-release tail.
 *
 * The frozen suite's `support_claim` rule says a host is conformant only for the
 * EXACT runtime, contract, and scenario-suite versions its evidence names. A
 * version string the core cannot even recognize as a runtime identity cannot be
 * the exact one, so it is refused rather than accepted as opaque text.
 */
const NEUTRAL_RUNTIME_VERSION_PATTERN = new RegExp(
  "^guild-(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$"
);

/**
 * The runtime MAJOR this core implements.
 *
 * MH-02-R3-B02: pattern-matching is not recognition. Round 3 accepted
 * `guild-999.999.999` because it was syntactically a runtime identity — a
 * release that does not exist, from a major this core knows nothing about.
 * "Recognized" has to mean the core knows the identity, so the major is pinned
 * exactly as `NEUTRAL_CONTRACT_VERSION` is: advancing it is a deliberate core
 * change, never a caller's assertion.
 */
export const NEUTRAL_RECOGNIZED_RUNTIME_MAJOR = 2;

/** Platforms a conformance claim may name (`E-VERSION` requires `platform`). */
export const NEUTRAL_RECOGNIZED_PLATFORMS: readonly string[] = neutralFreeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);

/**
 * Host identities a conformance claim may name.
 *
 * MH-03 owns host DISCOVERY; this list is the closed CLAIM vocabulary, which is
 * a core concern for the same reason every other vocabulary here is: round 3
 * promoted `conformant=true` for `invented-host`. A host the core cannot name
 * cannot be the exact host the frozen `support_claim` rule binds to.
 */
export const NEUTRAL_RECOGNIZED_HOST_IDS: readonly string[] = neutralFreeze([
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity",
]);

const NEUTRAL_SOURCE_COMMIT_PATTERN = new RegExp("^[0-9a-f]{40}$");
const NEUTRAL_PACKAGE_HASH_PATTERN = new RegExp("^sha256:[0-9a-f]{64}$");
const NEUTRAL_ADAPTER_VERSION_PATTERN = new RegExp(
  "^guild\\.host_adapter\\.v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$"
);
const NEUTRAL_RELEASE_ID_PATTERN = new RegExp("^rel-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-z]{1,16}$");
const NEUTRAL_SEMVER_PATTERN = new RegExp(
  "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$"
);
const NEUTRAL_JOURNAL_ID_PATTERN = new RegExp("^[A-Za-z0-9][A-Za-z0-9._-]{2,}$");

/** Evidence freshness. `unknown` is not a soft `fresh`. */
export const NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS = ["fresh", "stale", "unknown"] as const;
export type NeutralEvidenceFreshnessVerdict = (typeof NEUTRAL_EVIDENCE_FRESHNESS_VERDICTS)[number];

/**
 * The COMPLETE identity a conformance claim is bound to (MH-02-R3-B02).
 *
 * The frozen contract's `support_claim` rule is explicit: "a host is conformant
 * only for the exact SOURCE, PACKAGE, RUNTIME, ADAPTER, HOST, PLATFORM,
 * CONTRACT, and SCENARIO-SUITE versions named by its evidence bundle", and the
 * `E-VERSION` profile requires `source_commit`, `package_hash`, `runtime_version`,
 * `adapter_version`, `host_version`, `contract_version`, `scenario_suite_version`,
 * and `platform` as bindings.
 *
 * Round 3's five-field record could not EXPRESS most of that, so a bundle that
 * named no source, package, adapter, or platform at all was still structurally
 * complete and still promoted. Every field the contract names is therefore
 * present here, mandatory, recognized, and compared.
 */
export interface NeutralEvidenceIdentity {
  /** The exact immutable source revision the evidence was produced from. */
  readonly source_commit: string;
  /** The exact rendered package the runtime was activated from. */
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

/**
 * Retained name for the identity tuple. Round 3's `NeutralRuntimeBinding` named
 * five runtime labels; the same slot now carries the whole frozen identity, so
 * the alias exists to say plainly that the OLD shape is no longer sufficient
 * rather than to keep it working.
 */
export type NeutralRuntimeBinding = NeutralEvidenceIdentity;

/**
 * The AUTHORITATIVE input a promotion decision is verified against.
 *
 * WHY A SECOND INPUT AT ALL (MH-02-R3-B02)
 *   Round 3's decision read exactly one argument: the claimant's own bundle. A
 *   bundle that agrees with itself proves only that its author was consistent,
 *   which is why an entirely invented, internally coherent package promoted
 *   `conformant=true`. Evidence has to be checked against something the claimant
 *   does not author, so the identity the verifier itself observed — the activated
 *   release, and the durable journal it watched being written — is supplied
 *   separately and is what the bundle must match.
 *
 *   Ownership is unchanged: MH-09 owns release-bound distribution evidence and
 *   MH-06 owns the durable journal. This core still only DECIDES; it never
 *   gathers, and it performs no I/O to obtain either.
 */
export interface NeutralConformanceAuthority {
  readonly schema_version: typeof NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA;
  /** The identity the verifier independently observed for the activated runtime. */
  readonly identity: NeutralEvidenceIdentity;
  /** The durable journal the verifier observed (MH-06 owns it). */
  readonly receipt_journal_id: string;
  /** The contiguous sequence range the verifier observed in that journal. */
  readonly receipt_sequence_range: { readonly first: number; readonly last: number };
}

export const NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA = "guild.conformance_authority.v1";

/** One ordered, typed, source-bound, receipt-committed scenario result. */
export interface NeutralScenarioResult {
  readonly stable_id: string;
  readonly outcome_type: NeutralOutcomeType;
  readonly disposition: NeutralDisposition;
  readonly reason_code: string | null;
  /**
   * `guild.receipt_ref.v1:<journal>#<sequence>@<commitment>` — a committed
   * address into the durable receipt journal (MH-06 owns the journal).
   */
  readonly receipt_ref: string;
  /** The complete identity this single result was produced under. */
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly evidence_freshness: NeutralEvidenceFreshnessVerdict;
}

/** The whole evidence package a promotion decision is taken against. */
export interface NeutralConformanceEvidence {
  readonly suite_id: string;
  readonly suite_version: string;
  readonly required_scenario_ids: readonly string[];
  /** The identity the CLAIMANT asserts for the activated runtime. */
  readonly activated_runtime: NeutralEvidenceIdentity;
  /** Ordered: `results[i]` MUST correspond to `required_scenario_ids[i]`. */
  readonly results: readonly NeutralScenarioResult[];
}

/** Every field of the identity tuple, in canonical order. All are compared. */
export const NEUTRAL_EVIDENCE_IDENTITY_FIELDS: readonly string[] = neutralFreeze([
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

function identityComplete(identity: NeutralEvidenceIdentity | undefined): boolean {
  if (identity === undefined || identity === null || typeof identity !== "object") return false;
  if (typeof identity.contract_version !== "number") return false;
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    if (field === "contract_version") continue;
    const value = (identity as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || value.length === 0) return false;
  }
  return true;
}

function sameIdentity(a: NeutralEvidenceIdentity, b: NeutralEvidenceIdentity): boolean {
  return NEUTRAL_EVIDENCE_IDENTITY_FIELDS.every(
    (field) =>
      (a as unknown as Record<string, unknown>)[field] ===
      (b as unknown as Record<string, unknown>)[field]
  );
}

function differingIdentityFields(
  a: NeutralEvidenceIdentity,
  b: NeutralEvidenceIdentity
): readonly string[] {
  return NEUTRAL_EVIDENCE_IDENTITY_FIELDS.filter(
    (field) =>
      (a as unknown as Record<string, unknown>)[field] !==
      (b as unknown as Record<string, unknown>)[field]
  );
}

/** Is this runtime version one the core RECOGNIZES, not merely one it can parse? */
export function isNeutralRecognizedRuntimeVersion(value: unknown): boolean {
  if (typeof value !== "string" || !NEUTRAL_RUNTIME_VERSION_PATTERN.test(value)) return false;
  const major = NEUTRAL_RUNTIME_VERSION_PATTERN.exec(value);
  return major !== null && major[1] === `${NEUTRAL_RECOGNIZED_RUNTIME_MAJOR}`;
}

/**
 * Which identity fields name something the core does not recognize.
 *
 * `source_commit` and `package_hash` must be object-identifier FORMS rather than
 * labels: a 40-hex revision and a `sha256:` digest each denote one immutable
 * artifact, whereas `invented-release` denotes whatever its author wants. That is
 * the difference between naming evidence and asserting it.
 */
export function unrecognizedNeutralIdentityFields(
  identity: NeutralEvidenceIdentity
): Array<{ field: string; value: unknown }> {
  const offenders: Array<{ field: string; value: unknown }> = [];
  const note = (field: string): void => {
    offenders.push({ field, value: (identity as unknown as Record<string, unknown>)[field] ?? null });
  };
  if (!NEUTRAL_SOURCE_COMMIT_PATTERN.test(identity.source_commit)) note("source_commit");
  if (!NEUTRAL_PACKAGE_HASH_PATTERN.test(identity.package_hash)) note("package_hash");
  if (!NEUTRAL_ADAPTER_VERSION_PATTERN.test(identity.adapter_version)) note("adapter_version");
  if (NEUTRAL_RECOGNIZED_PLATFORMS.indexOf(identity.platform) === -1) note("platform");
  if (!NEUTRAL_RELEASE_ID_PATTERN.test(identity.release_id)) note("release_id");
  if (identity.scenario_suite_id !== NEUTRAL_SCENARIO_SUITE_ID) note("scenario_suite_id");
  if (identity.scenario_suite_version !== NEUTRAL_SCENARIO_SUITE_VERSION) {
    note("scenario_suite_version");
  }
  return offenders;
}

/** Which HOST identity fields the core does not recognize. */
export function unrecognizedNeutralHostFields(
  identity: NeutralEvidenceIdentity
): Array<{ field: string; value: unknown }> {
  const offenders: Array<{ field: string; value: unknown }> = [];
  if (NEUTRAL_RECOGNIZED_HOST_IDS.indexOf(identity.host_id) === -1) {
    offenders.push({ field: "host_id", value: identity.host_id ?? null });
  }
  if (!NEUTRAL_SEMVER_PATTERN.test(identity.host_version)) {
    offenders.push({ field: "host_version", value: identity.host_version ?? null });
  }
  return offenders;
}

// ---------------------------------------------------------------------------
// The source/receipt commitment
// ---------------------------------------------------------------------------

/** What a single receipt reference is committed to. */
export interface NeutralReceiptCommitmentInput {
  readonly stable_id: string;
  readonly outcome_type: NeutralOutcomeType;
  readonly disposition: NeutralDisposition;
  readonly reason_code: string | null;
  readonly sequence: number;
}

/**
 * The commitment that binds a receipt reference to its source.
 *
 * WHAT IT IS
 *   A deterministic digest over the AUTHORITY's complete identity tuple, the
 *   authority's journal id, the sequence, and the exact outcome the receipt
 *   claims to record. Change the release, the source commit, the package, the
 *   host, the platform, the scenario, the sequence, the outcome type, the
 *   disposition, or the reason code, and the commitment changes — so a receipt
 *   reference cannot be transplanted between releases, scenarios, sequence
 *   positions, or verdicts, and cannot be typed out of thin air the way
 *   `guild.receipt_ref.v1:forged-journal#3` was.
 *
 * WHAT IT IS NOT — the honest limit
 *   It is not a cryptographic MAC. The core is import-closed (`crypto` is a
 *   forbidden edge), so this is `neutralFingerprint`, and it carries no secret.
 *   It therefore proves BINDING to an authoritative input, not unforgeability
 *   against a party that already holds that authority. Closing that residue
 *   needs a signed durable journal, which is MH-06's to build and is recorded as
 *   a blocking followup rather than quietly claimed here.
 */
export function neutralEvidenceCommitment(
  authority: NeutralConformanceAuthority,
  result: NeutralReceiptCommitmentInput
): string {
  const canonical: Record<string, unknown> = {
    schema: NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
    journal: authority.receipt_journal_id,
    sequence: result.sequence,
    scenario_id: result.stable_id,
    outcome_type: result.outcome_type,
    disposition: result.disposition,
    reason_code: result.reason_code ?? null,
  };
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    canonical[field] = (authority.identity as unknown as Record<string, unknown>)[field] ?? null;
  }
  return `nec1:${neutralFingerprint(canonical).slice("nfp1:".length)}`;
}

/** Build the canonical committed receipt reference for one result. */
export function neutralReceiptReference(
  authority: NeutralConformanceAuthority,
  result: NeutralReceiptCommitmentInput
): string {
  return `${NEUTRAL_RECEIPT_REF_SCHEMA}:${authority.receipt_journal_id}#${result.sequence}@${neutralEvidenceCommitment(authority, result)}`;
}

function authorityWellFormed(authority: NeutralConformanceAuthority | undefined): boolean {
  if (authority === undefined || authority === null || typeof authority !== "object") return false;
  if (authority.schema_version !== NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA) return false;
  if (!identityComplete(authority.identity)) return false;
  if (
    typeof authority.receipt_journal_id !== "string" ||
    !NEUTRAL_JOURNAL_ID_PATTERN.test(authority.receipt_journal_id)
  ) {
    return false;
  }
  const range = authority.receipt_sequence_range;
  if (range === undefined || range === null || typeof range !== "object") return false;
  if (typeof range.first !== "number" || typeof range.last !== "number") return false;
  if (!Number.isInteger(range.first) || !Number.isInteger(range.last)) return false;
  return range.first >= 0 && range.last >= range.first;
}

function refuseConformance(
  reason:
    | "scenario_suite_version_mismatch"
    | "scenario_required_set_mismatch"
    | "scenario_results_unordered"
    | "scenario_evidence_incomplete"
    | "scenario_receipt_reference_missing"
    | "scenario_receipt_reference_ambiguous"
    | "scenario_reason_code_unrecognized"
    | "scenario_contract_version_unrecognized"
    | "scenario_runtime_version_unrecognized"
    | "scenario_runtime_binding_mismatch"
    | "scenario_evidence_authority_missing"
    | "scenario_identity_binding_mismatch"
    | "scenario_source_identity_unrecognized"
    | "scenario_host_identity_unrecognized"
    | "scenario_receipt_binding_unverified"
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
 * Decide whether `conformant` may be promoted (MH-02-R1-B04, MH-02-R2-B03).
 *
 * There is still deliberately NO scenario-set parameter. Round 2 kept one —
 * defaulted to the core's set, so it looked harmless — and it was the whole hole:
 * a caller passing a one-scenario array got a one-scenario "required set", ran
 * that one scenario, and promoted `conformant`. A suite the claimant chooses is
 * not a suite. The pinned tuple is read from the core constant and nothing else.
 *
 * The SECOND parameter is not a scenario set and cannot be used as one. It is the
 * AUTHORITY (`guild.conformance_authority.v1`) — the identity the verifier itself
 * observed, plus the durable journal it watched. Anything that is not a
 * well-formed authority is refused outright, so smuggling a scenario array into
 * that slot fails closed instead of narrowing the suite.
 *
 * Every gate below exists because its absence was demonstrably exploitable:
 *
 *    0. an AUTHORITATIVE input must be supplied and well-formed (MH-02-R3-B02:
 *       a bundle checked only against itself proves only self-consistency)
 *    1. the suite id + version must be the pinned pair         (no silent drift)
 *    2. the required tuple must EQUAL the core tuple, in order (no narrowing,
 *                                                              no re-ordering)
 *    3. results must be ordered against that tuple             (no re-association)
 *    4. each result must be a typed outcome, not a string      (no bare verdicts)
 *    5. each non-succeeded reason code must be in the closed
 *       vocabulary                                             (no invented reasons)
 *    6. each outcome TYPE must be the scenario's expected type (no wrong-but-
 *                                                              closed types)
 *    7. each receipt reference must be well-formed AND distinct(no "bogus")
 *    8. the contract version must be the one this core implements
 *    9. the runtime version must be a RECOGNIZED identity, not merely a parseable
 *       one                                                    (no guild-999.999.999)
 *   10. every identity field the frozen contract names must be present and
 *       recognized — source, package, adapter, platform, host, suite
 *                                                              (no source-less bundle)
 *   11. the bundle's identity and EVERY result's identity must equal the
 *       AUTHORITY's identity, field by field                   (no self-certification)
 *   12. every receipt reference must be COMMITTED to that authority: its journal,
 *       a sequence inside the observed range, strictly increasing in tuple order,
 *       and a digest that recomputes over the authority's identity plus this
 *       result's outcome                                       (no shaped labels)
 *   13. every result's freshness verdict must be `fresh`       (no stale evidence)
 *   14. each disposition must match the scenario's expectation (the original check)
 *
 * An expected REFUSAL that actually refused is still a pass — explicitly
 * refusing is the correct behaviour for the refusal scenarios, and it is what
 * "passed or explicitly refused every required scenario" means.
 */
export function evaluateNeutralConformanceDecision(
  evidence: NeutralConformanceEvidence,
  authority: NeutralConformanceAuthority
): NeutralOutcome {
  const scenarios: readonly NeutralScenarioDefinition[] = NEUTRAL_CORE_SCENARIOS;
  const required = evidence?.required_scenario_ids ?? [];
  const results = evidence?.results ?? [];
  const expectedRequired = NEUTRAL_REQUIRED_CORE_SCENARIO_IDS;

  const baseFacts = {
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    submitted_suite_id: evidence?.suite_id ?? null,
    submitted_suite_version: evidence?.suite_version ?? null,
    required_count: required.length,
    result_count: results.length,
  };

  // 0 — the authoritative input. Without it there is nothing to verify AGAINST,
  // and round 3 proved that verifying a bundle against itself promotes forgery.
  if (!authorityWellFormed(authority)) {
    return refuseConformance(
      "scenario_evidence_authority_missing",
      [
        "a promotion decision is verified against an authoritative input the claimant does not author",
        "a bundle that agrees only with itself proves consistency, never conformance",
        `an authority declares ${NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA}, one complete identity, one journal id, and one observed sequence range`,
      ],
      { ...baseFacts, submitted_authority_schema: (authority as { schema_version?: unknown })?.schema_version ?? null }
    );
  }
  // The authority itself must name identities the core RECOGNIZES. An authority
  // is an independent input, not an exemption from the closed vocabularies.
  const authorityUnrecognized = unrecognizedNeutralIdentityFields(authority.identity);
  if (authorityUnrecognized.length > 0) {
    return refuseConformance(
      "scenario_source_identity_unrecognized",
      [
        "the authoritative identity must name a source revision, package digest, adapter, platform, and suite the core recognizes",
        "a label the core cannot recognize cannot be the exact identity the frozen support_claim rule binds to",
      ],
      { ...baseFacts, scope: "authority", unrecognized_identity_fields: authorityUnrecognized }
    );
  }
  const authorityHostUnrecognized = unrecognizedNeutralHostFields(authority.identity);
  if (authorityHostUnrecognized.length > 0) {
    return refuseConformance(
      "scenario_host_identity_unrecognized",
      [
        "a conformance claim names a host identity the core recognizes and a real host version",
        "an unrecognized host cannot be the exact host the claim is bound to",
      ],
      {
        ...baseFacts,
        scope: "authority",
        recognized_host_ids: [...NEUTRAL_RECOGNIZED_HOST_IDS],
        unrecognized_host_fields: authorityHostUnrecognized,
      }
    );
  }
  if (authority.identity.contract_version !== NEUTRAL_CONTRACT_VERSION) {
    return refuseConformance(
      "scenario_contract_version_unrecognized",
      [
        `a conformance claim binds to contract version ${NEUTRAL_CONTRACT_VERSION}, the one this core implements`,
        "a consumer pinned to a different contract major refuses rather than downgrades",
      ],
      {
        ...baseFacts,
        scope: "authority",
        recognized_contract_version: NEUTRAL_CONTRACT_VERSION,
        unrecognized_contract_versions: [
          { scope: "authority", contract_version: authority.identity.contract_version ?? null },
        ],
      }
    );
  }
  if (!isNeutralRecognizedRuntimeVersion(authority.identity.runtime_version)) {
    return refuseConformance(
      "scenario_runtime_version_unrecognized",
      [
        "a conformance claim names a runtime identity the core recognizes",
        `the core recognizes runtime major ${NEUTRAL_RECOGNIZED_RUNTIME_MAJOR}; a parseable version from an unknown major is not recognized`,
      ],
      {
        ...baseFacts,
        scope: "authority",
        recognized_runtime_major: NEUTRAL_RECOGNIZED_RUNTIME_MAJOR,
        unrecognized_runtime_versions: [
          { scope: "authority", runtime_version: authority.identity.runtime_version ?? null },
        ],
      }
    );
  }

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

  // 2 — the required tuple IS the core's tuple, element-by-element, in order
  const missingRequired = expectedRequired.filter((id) => required.indexOf(id) === -1);
  const extraRequired = required.filter((id) => expectedRequired.indexOf(id) === -1);
  const tupleMisordered =
    required.length === expectedRequired.length &&
    missingRequired.length === 0 &&
    extraRequired.length === 0 &&
    expectedRequired.some((id, index) => required[index] !== id);
  if (
    required.length !== expectedRequired.length ||
    missingRequired.length > 0 ||
    extraRequired.length > 0 ||
    tupleMisordered
  ) {
    return refuseConformance(
      "scenario_required_set_mismatch",
      [
        "the required scenario tuple is declared by the core for this suite version",
        "an empty, narrowed, inflated, or re-ordered required tuple cannot back a conformance claim",
      ],
      {
        ...baseFacts,
        declared_required_scenario_ids: [...expectedRequired],
        submitted_required_scenario_ids: [...required],
        omitted_required_scenarios: missingRequired,
        undeclared_scenarios: extraRequired,
        tuple_misordered: tupleMisordered,
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

  // 4 — typed outcomes, not bare dispositions
  const untyped: Array<Record<string, unknown>> = [];
  const invented: Array<Record<string, unknown>> = [];
  const receiptless: Array<Record<string, unknown>> = [];
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
      continue;
    }
    // 5 — a non-succeeded reason code must be IN the closed vocabulary. Round 2
    // required only "a non-empty string", so `invented_reason` passed and the
    // refusal it labelled meant nothing.
    if (result.disposition !== "succeeded" && !isNeutralReasonCode(result.reason_code)) {
      invented.push({ stable_id: result.stable_id, reason_code: result.reason_code ?? null });
    }
    // 7a — a receipt reference must be a REFERENCE, not merely a string.
    if (
      typeof result.receipt_ref !== "string" ||
      !NEUTRAL_RECEIPT_REF_PATTERN.test(result.receipt_ref)
    ) {
      receiptless.push({
        stable_id: result.stable_id,
        receipt_ref: (result.receipt_ref as unknown) ?? null,
      });
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
  if (invented.length > 0) {
    return refuseConformance(
      "scenario_reason_code_unrecognized",
      [
        "every non-succeeded result names one reason code from the closed vocabulary",
        "an invented reason code cannot be compared across hosts and proves nothing",
      ],
      { ...baseFacts, unrecognized_reason_codes: invented }
    );
  }

  // 6 — the outcome TYPE must be the one the scenario declares. A closed-but-
  // wrong type (round 2 promoted five `guild.migration_outcome.v1` results for
  // four lifecycle scenarios and a policy scenario) is evidence of a different
  // experiment, not of this suite.
  const mistyped = results
    .map((result) => {
      const definition = scenarios.find((scenario) => scenario.stable_id === result.stable_id);
      return {
        stable_id: result.stable_id,
        expected_outcome_type: definition?.expected_typed_outcome.type ?? null,
        observed_outcome_type: result.outcome_type,
      };
    })
    .filter((entry) => entry.expected_outcome_type !== entry.observed_outcome_type);
  if (mistyped.length > 0) {
    return neutralOutcome({
      type: "guild.support_transition_outcome.v1",
      disposition: "failed",
      reason_code: "scenario_result_mismatch",
      assertions: [
        "each result carries the typed outcome envelope its scenario declares",
        "a closed but wrong outcome type is not the scenario's expected outcome",
      ],
      facts: { ...baseFacts, mistyped_scenarios: mistyped, may_promote_conformant: false },
    });
  }

  // 7b — receipt references: well-formed, and DISTINCT per scenario. Two
  // scenarios citing one journal entry attribute neither.
  if (receiptless.length > 0) {
    return refuseConformance(
      "scenario_receipt_reference_missing",
      [
        "every scenario result cites the receipt that records it",
        `a receipt reference has the canonical form ${NEUTRAL_RECEIPT_REF_SCHEMA}:<journal>#<sequence>`,
        "a result whose receipt reference resolves to nothing is unverifiable",
      ],
      { ...baseFacts, results_without_receipt_reference: receiptless }
    );
  }
  const duplicateReceipts = results
    .map((result, index) => ({ stable_id: result.stable_id, receipt_ref: result.receipt_ref, index }))
    .filter(
      (entry) =>
        results.findIndex((other) => other.receipt_ref === entry.receipt_ref) !== entry.index
    )
    .map((entry) => ({ stable_id: entry.stable_id, receipt_ref: entry.receipt_ref }));
  if (duplicateReceipts.length > 0) {
    return refuseConformance(
      "scenario_receipt_reference_ambiguous",
      [
        "each scenario result cites its own receipt entry",
        "one receipt entry cited by two scenarios attributes neither",
      ],
      { ...baseFacts, duplicate_receipt_references: duplicateReceipts }
    );
  }

  // 8 — the contract version on the bundle and on every result
  const activatedContractVersion = evidence.activated_runtime?.contract_version;
  const contractOffenders = [
    ...(activatedContractVersion === NEUTRAL_CONTRACT_VERSION
      ? []
      : [{ scope: "activated_runtime", contract_version: activatedContractVersion ?? null }]),
    ...results
      .filter((result) => result.evidence_identity?.contract_version !== NEUTRAL_CONTRACT_VERSION)
      .map((result) => ({
        scope: result.stable_id,
        contract_version: result.evidence_identity?.contract_version ?? null,
      })),
  ];
  if (contractOffenders.length > 0) {
    return refuseConformance(
      "scenario_contract_version_unrecognized",
      [
        `a conformance claim binds to contract version ${NEUTRAL_CONTRACT_VERSION}, the one this core implements`,
        "a consumer pinned to a different contract major refuses rather than downgrades",
      ],
      {
        ...baseFacts,
        recognized_contract_version: NEUTRAL_CONTRACT_VERSION,
        unrecognized_contract_versions: contractOffenders,
      }
    );
  }

  // 9 — the runtime version must be RECOGNIZED, not merely parseable. Round 3
  // accepted `guild-999.999.999` because it matched the shape.
  const runtimeOffenders = [
    ...(isNeutralRecognizedRuntimeVersion(evidence.activated_runtime?.runtime_version)
      ? []
      : [
          {
            scope: "activated_runtime",
            runtime_version: evidence.activated_runtime?.runtime_version ?? null,
          },
        ]),
    ...results
      .filter((result) => !isNeutralRecognizedRuntimeVersion(result.evidence_identity?.runtime_version))
      .map((result) => ({
        scope: result.stable_id,
        runtime_version: result.evidence_identity?.runtime_version ?? null,
      })),
  ];
  if (runtimeOffenders.length > 0) {
    return refuseConformance(
      "scenario_runtime_version_unrecognized",
      [
        "a conformance claim names a runtime identity the core recognizes",
        `the core recognizes runtime major ${NEUTRAL_RECOGNIZED_RUNTIME_MAJOR}; a parseable version from an unknown major is not recognized`,
      ],
      {
        ...baseFacts,
        recognized_runtime_major: NEUTRAL_RECOGNIZED_RUNTIME_MAJOR,
        unrecognized_runtime_versions: runtimeOffenders,
      }
    );
  }

  // 10 — the complete frozen identity, present and recognized, everywhere. Round
  // 3's bundle carried no source, package, adapter, or platform at all.
  const incomplete = [
    ...(identityComplete(evidence.activated_runtime) ? [] : ["activated_runtime"]),
    ...results
      .filter((result) => !identityComplete(result.evidence_identity))
      .map((result) => result.stable_id),
  ];
  if (incomplete.length > 0) {
    return refuseConformance(
      "scenario_runtime_binding_mismatch",
      [
        "a conformance claim names the exact source, package, runtime, adapter, host, platform, contract, and scenario-suite identity",
        "an incomplete identity cannot be compared, and an absent field is never a satisfied one",
      ],
      {
        ...baseFacts,
        required_identity_fields: [...NEUTRAL_EVIDENCE_IDENTITY_FIELDS],
        incomplete_identities: incomplete,
        activated_runtime: evidence.activated_runtime ?? null,
      }
    );
  }
  const unrecognizedIdentity = [
    ...unrecognizedNeutralIdentityFields(evidence.activated_runtime).map((entry) => ({
      scope: "activated_runtime",
      ...entry,
    })),
    ...results.flatMap((result) =>
      unrecognizedNeutralIdentityFields(result.evidence_identity).map((entry) => ({
        scope: result.stable_id,
        ...entry,
      }))
    ),
  ];
  if (unrecognizedIdentity.length > 0) {
    return refuseConformance(
      "scenario_source_identity_unrecognized",
      [
        "source and package identities must name one immutable artifact, not a label",
        "adapter, platform, and scenario-suite identities must be ones the core recognizes",
      ],
      { ...baseFacts, unrecognized_identity_fields: unrecognizedIdentity }
    );
  }
  const unrecognizedHost = [
    ...unrecognizedNeutralHostFields(evidence.activated_runtime).map((entry) => ({
      scope: "activated_runtime",
      ...entry,
    })),
    ...results.flatMap((result) =>
      unrecognizedNeutralHostFields(result.evidence_identity).map((entry) => ({
        scope: result.stable_id,
        ...entry,
      }))
    ),
  ];
  if (unrecognizedHost.length > 0) {
    return refuseConformance(
      "scenario_host_identity_unrecognized",
      [
        "a conformance claim names a host identity the core recognizes and a real host version",
        "an unrecognized host cannot be the exact host the claim is bound to",
      ],
      {
        ...baseFacts,
        recognized_host_ids: [...NEUTRAL_RECOGNIZED_HOST_IDS],
        unrecognized_host_fields: unrecognizedHost,
      }
    );
  }

  // 11 — the claimant's identity must EQUAL the authority's, and so must every
  // result's. This is the step round 3 had no way to take: with one input there
  // was nothing to compare against.
  const bundleDrift = differingIdentityFields(evidence.activated_runtime, authority.identity);
  if (bundleDrift.length > 0) {
    return refuseConformance(
      "scenario_identity_binding_mismatch",
      [
        "the claimed activated identity must equal the identity the verifier observed",
        "a self-asserted identity is not evidence of the release it names",
      ],
      {
        ...baseFacts,
        authority_identity: authority.identity,
        claimed_identity: evidence.activated_runtime,
        differing_identity_fields: [...bundleDrift],
      }
    );
  }
  const misbound = results
    .filter((result) => !sameIdentity(result.evidence_identity, authority.identity))
    .map((result) => ({
      stable_id: result.stable_id,
      differing_identity_fields: [
        ...differingIdentityFields(result.evidence_identity, authority.identity),
      ],
    }));
  if (misbound.length > 0) {
    return refuseConformance(
      "scenario_identity_binding_mismatch",
      [
        "every result must have been produced under the exact authoritative identity",
        "evidence from another source revision, package, release, or runtime cannot be reused",
      ],
      { ...baseFacts, authority_identity: authority.identity, misbound_results: misbound }
    );
  }

  // 12 — the receipt references must be COMMITTED to that authority. Shape was
  // already checked at step 7; this is the binding round 3 never had.
  const unbound: Array<Record<string, unknown>> = [];
  let previousSequence = -1;
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const parsed = NEUTRAL_RECEIPT_REF_PATTERN.exec(result.receipt_ref);
    if (parsed === null) {
      unbound.push({ stable_id: result.stable_id, reason: "unparseable_reference" });
      continue;
    }
    const journal = parsed[1];
    const sequence = parseInt(parsed[2], 10);
    const commitment = parsed[3];
    if (journal !== authority.receipt_journal_id) {
      unbound.push({ stable_id: result.stable_id, reason: "foreign_journal", journal });
      continue;
    }
    if (
      sequence < authority.receipt_sequence_range.first ||
      sequence > authority.receipt_sequence_range.last
    ) {
      unbound.push({ stable_id: result.stable_id, reason: "sequence_outside_observed_range", sequence });
      continue;
    }
    // The journal is an ORDERED spine, so a later scenario cannot cite an earlier
    // entry: that would be a receipt written before the result it records.
    if (sequence <= previousSequence) {
      unbound.push({ stable_id: result.stable_id, reason: "sequence_not_increasing", sequence });
      continue;
    }
    previousSequence = sequence;
    const expected = neutralEvidenceCommitment(authority, {
      stable_id: result.stable_id,
      outcome_type: result.outcome_type,
      disposition: result.disposition,
      reason_code: result.reason_code ?? null,
      sequence,
    });
    if (commitment !== expected) {
      unbound.push({
        stable_id: result.stable_id,
        reason: "commitment_mismatch",
        submitted_commitment: commitment,
        expected_commitment: expected,
      });
    }
  }
  if (unbound.length > 0) {
    return refuseConformance(
      "scenario_receipt_binding_unverified",
      [
        "a receipt reference is bound to one journal, one observed sequence, and one exact outcome",
        "a reference that merely has the canonical shape addresses nothing",
        "receipt sequences increase with the required tuple, so a receipt cannot precede the result it records",
      ],
      {
        ...baseFacts,
        authority_journal_id: authority.receipt_journal_id,
        authority_sequence_range: authority.receipt_sequence_range,
        unbound_receipt_references: unbound,
      }
    );
  }

  // 13 — explicit freshness verdict
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

  // 14 — disposition matches the scenario's expectation
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
      "every identity field the frozen support_claim rule names is present, recognized, and equal to the authority's",
      "every receipt reference is committed to that authority's identity, journal, sequence, and outcome",
    ],
    facts: {
      ...baseFacts,
      activated_runtime: evidence.activated_runtime,
      authority_identity: authority.identity,
      authority_journal_id: authority.receipt_journal_id,
      evaluated_scenarios: results.map((result) => ({
        stable_id: result.stable_id,
        disposition: result.disposition,
        receipt_ref: result.receipt_ref,
      })),
      may_promote_conformant: true,
    },
  });
}
