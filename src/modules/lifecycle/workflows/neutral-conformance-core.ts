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
  neutralCanonicalDigest,
  neutralFingerprint,
  neutralFreeze,
  neutralOutcome,
  neutralSha256Hex,
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
 * a reference to nothing. Shape can be typed by anyone, so the reference carries
 * a COMMITMENT. Round 4 then let the CLAIMANT derive that commitment from its own
 * result, which is a second way of typing it out of thin air — so the commitment
 * must now be the one the journal entry at that sequence already carries (see
 * `neutralJournalEntryCommitment` and `neutralReceiptReference`). A shaped label
 * with no commitment, or with a commitment that is not the entry's, is not a
 * reference.
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

/**
 * The host-adapter contract MAJOR this core implements.
 *
 * Same argument as `NEUTRAL_RECOGNIZED_RUNTIME_MAJOR`, and the same round-4 hole:
 * `guild.host_adapter.v999.999.999` is syntactically an adapter version and
 * semantically an adapter contract this core has never seen. Pattern-matching is
 * not recognition, so the major is pinned and advancing it is a deliberate core
 * change rather than a caller's assertion.
 */
export const NEUTRAL_RECOGNIZED_ADAPTER_MAJOR = 1;
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
  /**
   * The journal ENTRIES the verifier observed — ordered, contiguous, and
   * covering the whole declared range with no gaps (MH-02-R4-B02).
   *
   * This is the field round 4 did not have, and its absence was the entire
   * finding. An authority that names a journal without carrying it lets the
   * decision do the only thing it can with one set of facts: RECOMPUTE the
   * commitments from the claimant's own package and check they agree with
   * themselves. Carrying the entries inverts that — the commitments arrive from
   * the journal and the package is checked AGAINST them.
   */
  readonly observed_entries: readonly NeutralReceiptJournalEntry[];
  /**
   * Independent attestations over the journal ROOT. A quorum of distinct
   * recognized attestors is required, and none of them may be the claimant.
   */
  readonly attestations: readonly NeutralJournalAttestation[];
}

/**
 * One durable journal entry, as the verifier observed it being written.
 *
 * `entry_commitment` is the journal's OWN record of what it wrote. The decision
 * compares the package's receipt reference against this value; it does not
 * derive this value from the package. `previous_commitment` chains each entry to
 * the one before it, so an entry cannot be inserted, removed, re-ordered, or
 * edited without breaking every commitment after it.
 */
export interface NeutralReceiptJournalEntry {
  readonly sequence: number;
  readonly scenario_id: string;
  readonly outcome_type: NeutralOutcomeType;
  readonly disposition: NeutralDisposition;
  readonly reason_code: string | null;
  readonly entry_commitment: string;
  readonly previous_commitment: string;
}

/**
 * An independent attestation that a journal root was observed.
 *
 * MH-02-R5-B01: rounds 3 and 4 made this record carry more FIELDS; every one of
 * them was still a value the claimant could type. `attestation_signature` is the
 * first field on it that a claimant cannot produce, because verifying it needs
 * only the public key this core pins and producing it needs the private key this
 * core does not have and this repository does not contain.
 */
export interface NeutralJournalAttestation {
  /** One of `NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS`. */
  readonly attestor_id: string;
  /** The commitment of the LAST observed entry — the chain root. */
  readonly attested_journal_root: string;
  readonly attested_entry_count: number;
  /** `guild.journal_attestation.v1:<attestor>@<digest>`. */
  readonly attestation_ref: string;
  /**
   * `nas1:<challenge>:<response>` — the attestor's signature over
   * `neutralAttestationDigest`, verified against `NEUTRAL_ATTESTOR_TRUST_ROOT`.
   */
  readonly attestation_signature: string;
}

export const NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA = "guild.conformance_authority.v1";
export const NEUTRAL_ATTESTATION_REF_SCHEMA = "guild.journal_attestation.v1";

// ---------------------------------------------------------------------------
// The trust root (MH-02-R5-B01)
// ---------------------------------------------------------------------------

/**
 * THE FINDING, and why every previous answer to it was the wrong shape.
 *
 * Round 5 required the authority to CARRY a chain-linked journal, a quorum of
 * two distinct recognized attestors over its root, and a claimant that was
 * neither of them — and the reviewer defeated all of it in one move, because
 * every value being compared was a deterministic function of PUBLIC inputs. The
 * attestation reference was `neutralAttestationReference(authority, attestation)`
 * evaluated by the caller; the attestor identities were two labels chosen from a
 * published list; the chain was a fingerprint the claimant could recompute. A
 * party holding every input could therefore assemble a bundle that satisfied
 * every gate, which round 5 shipped as a PASSING test named "documents the
 * residue". Documenting a promotion path does not close it.
 *
 * WHAT ACTUALLY CLOSES IT
 *   For a decision to be unsatisfiable by the claimant, it must depend on
 *   something the claimant cannot compute from public data — and the only such
 *   thing is a secret it does not hold. So the core pins the VERIFICATION half of
 *   each recognized attestor's key material, and an attestation is admitted only
 *   if it carries a signature that verifies under it. Verification is hashing and
 *   small-integer arithmetic: no import, no I/O, no clock, no host handle, so the
 *   import closure MH-02 acceptance 3 asserts is unchanged (see
 *   `neutralSha256Hex`, which makes the same argument for the digest).
 *
 *   The roots below were generated once, off-repository. The private seeds behind
 *   them were never written to disk at all — they existed in one process, signed
 *   the fixtures the focused suite carries, and are gone. Every value here is
 *   public by construction. That is what makes those fixtures honest: they are
 *   signatures somebody holding the seeds produced, replayed as data, and nobody
 *   reading this source can re-mint one for a different bundle.
 *
 * WHAT THIS IS NOT
 *   It is not a claim that these are the PRODUCTION attestor roots. MH-09 owns
 *   real release attestation and must replace this table with roots whose seeds
 *   its attestors actually hold and keep; because the seeds behind these were
 *   discarded, this table can verify the fixtures below and can never issue
 *   anything new — which is the right property for a core that only DECIDES, and
 *   the wrong one for a shipping trust root. Rotating or adding an entry is a
 *   deliberate core change, exactly as advancing
 *   `NEUTRAL_RECOGNIZED_RUNTIME_MAJOR` is. What MH-02 owes, and now discharges, is
 *   that the DECISION is anchored to a trust root the claimant does not supply and
 *   mechanically verifies the evidence it relies on.
 */
export interface NeutralAttestorVerificationKey {
  readonly attestor_id: string;
  /**
   * The Merkle root over this attestor's one-time verification keys — 64 lowercase
   * hex characters. This single value is the whole of what the core trusts.
   */
  readonly verification_root: string;
}

/**
 * THE SCHEME, and why it is this one.
 *
 * `guild.journal_attestation.v1` signatures are WOTS+ one-time signatures under a
 * Merkle authentication path: the construction RFC 8391 standardizes as XMSS,
 * with position/step hash tweaks in place of bitmasks. Verification is
 * `neutralSha256Hex` and small-integer arithmetic — nothing else.
 *
 * A discrete-log or RSA scheme would need multi-precision arithmetic. This
 * repository ships no `tsconfig.json`, so its TypeScript is type-checked below
 * ES2020, where BigInt literals are a compile error; and `BigInt` is deliberately
 * absent from `NEUTRAL_PURE_INTRINSIC_ROOTS`, so reaching for it would be an
 * ambient capability by this core's own boundary rule. Widening either to fit the
 * signature scheme would be the tail wagging the dog. A hash-based scheme needs
 * neither: it is built from the digest the core already computes, so it stays
 * inside the toolchain and inside the boundary as they are.
 *
 * WHAT IS TRUSTED, EXACTLY
 *   One 32-byte root per attestor, below. From it the core can VERIFY any of the
 *   2^`NEUTRAL_ATTESTATION_TREE_HEIGHT` one-time keys beneath it, and can PRODUCE
 *   none of them. The private seeds were generated off-repository, were never
 *   written into it, and are not recoverable from anything here.
 *
 * THE ONE OBLIGATION THIS PUTS ON THE SIGNER
 *   A WOTS+ key is one-time. An attestor that signs two different messages under
 *   the same `key_index` leaks enough chain values to let a third message be
 *   forged. That is inherent to hash-based signatures and is a property of the
 *   SIGNER's state, which a stateless decision cannot check — MH-09 owns it, and
 *   it is recorded as an open risk rather than implied away.
 */
export const NEUTRAL_ATTESTATION_SCHEME = "guild.wots_merkle.v1";

/** Winternitz chain length: one chain per hex digit of the signed digest. */
export const NEUTRAL_ATTESTATION_CHAIN_LENGTH = 16;

/** 64 message chains for a 256-bit digest, plus 3 for the checksum. */
export const NEUTRAL_ATTESTATION_MESSAGE_CHAINS = 64;
export const NEUTRAL_ATTESTATION_CHECKSUM_CHAINS = 3;
export const NEUTRAL_ATTESTATION_CHAINS =
  NEUTRAL_ATTESTATION_MESSAGE_CHAINS + NEUTRAL_ATTESTATION_CHECKSUM_CHAINS;

/** Merkle height: 2^4 one-time keys per attestor. */
export const NEUTRAL_ATTESTATION_TREE_HEIGHT = 4;

/** The pinned verification roots. Recognition IS the presence of a root here. */
export const NEUTRAL_ATTESTOR_TRUST_ROOT: readonly NeutralAttestorVerificationKey[] = neutralFreeze([
  {
    attestor_id: "guild.release-attestor",
    verification_root: "2cd0a7a8986e79ec2cb25b5752d5a85a80d10c4d133d6590b91417bf976f3539",
  },
  {
    attestor_id: "guild.host-conformance-witness",
    verification_root: "584d8e28a2a5c109a2b892b627a3154fef9da46efc45eb79d042611bf09d09ef",
  },
  {
    attestor_id: "guild.distribution-notary",
    verification_root: "4dd9eb1f20a5194d38c6ac9cf308dac017ceebac0e85bcd7fbfa26fc43945f37",
  },
]);

/**
 * The parties whose attestation the core recognizes, and the claimant vocabulary
 * they must be distinct from.
 *
 * MH-03 owns host discovery and MH-09 owns release attestation; this is the
 * closed CLAIM vocabulary, for the same reason every other vocabulary in this
 * core is closed. It is DERIVED from the trust root rather than written out
 * beside it, so "recognized attestor" cannot drift away from "attestor this core
 * can actually verify" — round 5's list was a set of labels with nothing behind
 * them, which is precisely why naming two of them was enough to promote.
 */
export const NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS: readonly string[] = neutralFreeze(
  NEUTRAL_ATTESTOR_TRUST_ROOT.map((key) => key.attestor_id)
);

/** How many DISTINCT recognized attestors must observe the same journal root. */
export const NEUTRAL_MINIMUM_ATTESTOR_QUORUM = 2;

/** Domain separator. Binds every hash below to this scheme and version. */
export const NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN = "guild.journal_attestation.v1/wots_merkle/1";

const NEUTRAL_ATTESTATION_REF_PATTERN = new RegExp(
  "^guild\\.journal_attestation\\.v1:([A-Za-z0-9][A-Za-z0-9._-]{2,})@(nad1:[0-9a-f]{64})$"
);
/** `nws1:<key index>:<67 chain values>:<4 authentication-path nodes>`. */
const NEUTRAL_ATTESTATION_SIGNATURE_PATTERN = new RegExp(
  `^nws1:([0-9a-f]{2}):([0-9a-f]{${NEUTRAL_ATTESTATION_CHAINS * 64}}):([0-9a-f]{${NEUTRAL_ATTESTATION_TREE_HEIGHT * 64}})$`
);
const NEUTRAL_COMMITMENT_PATTERN = new RegExp("^nec1:[0-9a-f]{16}$");
const NEUTRAL_CLAIMANT_ID_PATTERN = new RegExp("^[A-Za-z0-9][A-Za-z0-9._-]{2,}$");

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
  /**
   * WHO is asking to be promoted (MH-02-R4-B02).
   *
   * Round 4's package was anonymous, so "the claimant does not author the
   * authority" could not be checked — it was a property of the intended usage,
   * not of the inputs. Naming the claimant makes separation of duties a
   * mechanical comparison against the attestor set.
   */
  readonly claimant_id: string;
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
  const adapter = NEUTRAL_ADAPTER_VERSION_PATTERN.exec(identity.adapter_version ?? "");
  if (adapter === null || adapter[1] !== `${NEUTRAL_RECOGNIZED_ADAPTER_MAJOR}`) note("adapter_version");
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

/**
 * Build the canonical receipt reference for one JOURNAL ENTRY.
 *
 * WHY THIS TAKES AN ENTRY AND NOT A RESULT (MH-02-R4-B02)
 *   Round 4's helper took the claimant's own result and DERIVED a commitment
 *   from it, which is precisely the mechanism the reviewer defeated: the same
 *   party authored both sides of the comparison, so the comparison held for a
 *   wholly invented release. An honest producer does not mint a commitment — it
 *   CITES the one the journal already wrote. This helper therefore reads
 *   `entry.entry_commitment` rather than computing anything, and a reference
 *   built any other way is refused by `evaluateNeutralConformanceDecision`.
 *
 * WHAT THE COMMITMENT IS NOT — the honest limit, stated where the code is
 *   `neutralJournalEntryCommitment` is a deterministic UNKEYED digest built with
 *   `neutralFingerprint`. It is NOT a cryptographic MAC and carries no secret,
 *   because the core is import-closed and `crypto` is a forbidden edge. It makes
 *   the journal tamper-EVIDENT — no entry can be inserted, removed, re-ordered,
 *   re-scoped to another release, or edited without breaking the chain and the
 *   attested root — but it cannot resist a party that fabricates the whole
 *   journal and names its attestors. Closing THAT residue needs a signed durable
 *   journal, which is MH-06's to build and is carried as an open risk and a
 *   followup rather than quietly claimed here.
 */
export function neutralReceiptReference(
  authority: NeutralConformanceAuthority,
  entry: NeutralReceiptJournalEntry
): string {
  return `${NEUTRAL_RECEIPT_REF_SCHEMA}:${authority.receipt_journal_id}#${entry.sequence}@${entry.entry_commitment}`;
}

// ---------------------------------------------------------------------------
// The durable journal chain (MH-02-R4-B02)
// ---------------------------------------------------------------------------

/**
 * The anchor the observed journal must chain from.
 *
 * It is derived from the authority's identity, journal id, and the FIRST
 * observed sequence, so a chain cannot be lifted out of one release, journal, or
 * window and re-presented under another. It is deterministic and public, which
 * is the same honest limit `neutralReceiptReference` documents: it makes the
 * chain tamper-EVIDENT, not unforgeable.
 */
export function neutralJournalGenesis(authority: NeutralConformanceAuthority): string {
  const canonical: Record<string, unknown> = {
    schema: NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
    anchor: "journal_genesis",
    journal: authority.receipt_journal_id,
    first_sequence: authority.receipt_sequence_range?.first ?? null,
  };
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    canonical[field] = (authority.identity as unknown as Record<string, unknown>)[field] ?? null;
  }
  return `nec1:${neutralFingerprint(canonical).slice("nfp1:".length)}`;
}

/**
 * The commitment a journal entry must carry, given the entry BEFORE it.
 *
 * Because `previous` is an input, editing any entry changes every commitment
 * after it. That is what turns a list of five numbers into a spine: the claimant
 * cannot swap one scenario's recorded outcome without re-deriving the tail and
 * the root, and the root is what the attestors signed off on.
 */
export function neutralJournalEntryCommitment(
  authority: NeutralConformanceAuthority,
  previous: string,
  entry: NeutralReceiptJournalEntry
): string {
  const canonical: Record<string, unknown> = {
    schema: NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
    anchor: "journal_entry",
    journal: authority.receipt_journal_id,
    previous,
    sequence: entry.sequence,
    scenario_id: entry.scenario_id,
    outcome_type: entry.outcome_type,
    disposition: entry.disposition,
    reason_code: entry.reason_code ?? null,
  };
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    canonical[field] = (authority.identity as unknown as Record<string, unknown>)[field] ?? null;
  }
  return `nec1:${neutralFingerprint(canonical).slice("nfp1:".length)}`;
}

/**
 * The digest an attestation over a journal root must carry — and the exact
 * message the attestor signs.
 *
 * It binds the attestor, the journal, the chain root, the entry count, the
 * observed range, and every field of the identity, so a signature cannot be
 * lifted onto another journal, another window of the same journal, another
 * release, or another attestor's name.
 *
 * MH-02-R5-B01 changed the digest from a 64-bit `neutralFingerprint` to SHA-256.
 * A fingerprint is the right tool for comparing two values the core itself
 * produced; it is the wrong tool for a value an ADVERSARY chooses, because
 * finding a second preimage for a 64-bit FNV-1a is cheap, and a signature is
 * only as strong as the digest it commits to.
 */
export function neutralAttestationDigest(
  authority: NeutralConformanceAuthority,
  attestation: NeutralJournalAttestation
): string {
  const canonical: Record<string, unknown> = {
    schema: NEUTRAL_ATTESTATION_REF_SCHEMA,
    attestor: attestation.attestor_id,
    journal: authority.receipt_journal_id,
    root: attestation.attested_journal_root,
    entry_count: attestation.attested_entry_count,
    first_sequence: authority.receipt_sequence_range?.first ?? null,
    last_sequence: authority.receipt_sequence_range?.last ?? null,
  };
  for (const field of NEUTRAL_EVIDENCE_IDENTITY_FIELDS) {
    canonical[field] = (authority.identity as unknown as Record<string, unknown>)[field] ?? null;
  }
  return `nad1:${neutralCanonicalDigest(canonical)}`;
}

/** Build the canonical attestation reference. */
export function neutralAttestationReference(
  authority: NeutralConformanceAuthority,
  attestation: NeutralJournalAttestation
): string {
  return `${NEUTRAL_ATTESTATION_REF_SCHEMA}:${attestation.attestor_id}@${neutralAttestationDigest(authority, attestation)}`;
}

// ---------------------------------------------------------------------------
// Signature verification against the pinned trust root (MH-02-R5-B01)
// ---------------------------------------------------------------------------

/** The pinned verification root for one attestor, or `null` if it has none. */
export function neutralAttestorVerificationKey(attestorId: unknown): string | null {
  const pinned = NEUTRAL_ATTESTOR_TRUST_ROOT.find((key) => key.attestor_id === attestorId);
  return pinned === undefined ? null : pinned.verification_root;
}

const NEUTRAL_HEX_ALPHABET = "0123456789abcdef";
const NEUTRAL_SHA256_HEX_PATTERN = new RegExp("^[0-9a-f]{64}$");

/**
 * One step along a Winternitz chain.
 *
 * The chain position and the step are hashed in, so a value revealed for chain
 * `i` at step `t` is useless at any other position — the tweak that WOTS+ gets
 * from bitmasks, obtained here from domain separation instead.
 */
function chainStep(value: string, chain: number, step: number): string {
  return neutralSha256Hex(
    `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|F|${chain}|${step}|${value}`
  );
}

/** Walk a chain forward from `step` to the end, yielding the chain's tip. */
function chainTo(value: string, chain: number, step: number): string {
  let current = value;
  for (let at = step; at < NEUTRAL_ATTESTATION_CHAIN_LENGTH - 1; at += 1) {
    current = chainStep(current, chain, at);
  }
  return current;
}

/**
 * The Winternitz code word: one 4-bit symbol per hex digit of the message,
 * followed by a base-16 checksum of the complements.
 *
 * The checksum is what stops the trivial forgery: without it, an attacker can
 * advance any revealed chain value forward and sign any message whose symbols are
 * all larger. Advancing a message symbol always DECREASES the checksum, and the
 * checksum symbols would then have to be walked backwards, which is the preimage
 * problem.
 */
function codeWord(message: string): number[] | null {
  if (message.length !== NEUTRAL_ATTESTATION_MESSAGE_CHAINS) return null;
  const symbols: number[] = [];
  let checksum = 0;
  for (let index = 0; index < message.length; index += 1) {
    const symbol = NEUTRAL_HEX_ALPHABET.indexOf(message.charAt(index));
    if (symbol === -1) return null;
    symbols.push(symbol);
    checksum += NEUTRAL_ATTESTATION_CHAIN_LENGTH - 1 - symbol;
  }
  for (let index = NEUTRAL_ATTESTATION_CHECKSUM_CHAINS - 1; index >= 0; index -= 1) {
    const shift = Math.pow(NEUTRAL_ATTESTATION_CHAIN_LENGTH, index);
    symbols.push(Math.floor(checksum / shift) % NEUTRAL_ATTESTATION_CHAIN_LENGTH);
  }
  return symbols;
}

/** Split fixed-width hex into `count` 64-character words. */
function hexWords(value: string, count: number): string[] {
  const words: string[] = [];
  for (let index = 0; index < count; index += 1) {
    words.push(value.slice(index * 64, index * 64 + 64));
  }
  return words;
}

/**
 * Verify a WOTS+ signature under a Merkle authentication path (MH-02-R5-B01).
 *
 * The signature reveals, for each symbol of the code word, the chain value at
 * exactly that position. Verification walks each chain the rest of the way to its
 * tip, hashes the 67 tips into the one-time public key, folds that leaf up the
 * authentication path, and requires the result to equal the root this core PINS.
 *
 * Forging one needs a preimage of SHA-256 — every value the claimant would have
 * to produce is a hash preimage of something it can only see the image of. That
 * is the asymmetry: recognizing a valid signature needs only the pinned root,
 * producing one needs the private seeds, and no bundle a single party assembles
 * contains them.
 *
 * Every failure mode is a `false`, never a throw: unparseable, wrong length, out
 * of range, or simply wrong is an unverified signature, and unverified is refused.
 */
export function neutralVerifyAttestationSignature(
  verificationRoot: unknown,
  digest: unknown,
  signature: unknown
): boolean {
  if (typeof verificationRoot !== "string") return false;
  if (!NEUTRAL_SHA256_HEX_PATTERN.test(verificationRoot)) return false;
  if (typeof digest !== "string" || typeof signature !== "string") return false;
  const parsed = NEUTRAL_ATTESTATION_SIGNATURE_PATTERN.exec(signature);
  if (parsed === null) return false;
  const keyIndex = parseInt(parsed[1], 16);
  const chains = hexWords(parsed[2], NEUTRAL_ATTESTATION_CHAINS);
  const authPath = hexWords(parsed[3], NEUTRAL_ATTESTATION_TREE_HEIGHT);
  if (!Number.isInteger(keyIndex) || keyIndex < 0) return false;
  if (keyIndex >= Math.pow(2, NEUTRAL_ATTESTATION_TREE_HEIGHT)) return false;

  // The signed message binds the attested digest to the root it will be checked
  // against and to the one-time key it was signed with, so a signature cannot be
  // re-presented for another attestor, another key index, or another digest.
  const symbols = codeWord(
    neutralSha256Hex(
      `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|M|${verificationRoot}|${keyIndex}|${digest}`
    )
  );
  if (symbols === null || symbols.length !== NEUTRAL_ATTESTATION_CHAINS) return false;

  const tips: string[] = [];
  for (let index = 0; index < NEUTRAL_ATTESTATION_CHAINS; index += 1) {
    tips.push(chainTo(chains[index], index, symbols[index]));
  }
  const oneTimeKey = neutralSha256Hex(
    `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|PK|${tips.join("|")}`
  );
  let node = neutralSha256Hex(
    `${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|LEAF|${keyIndex}|${oneTimeKey}`
  );
  for (let level = 0; level < NEUTRAL_ATTESTATION_TREE_HEIGHT; level += 1) {
    const sibling = authPath[level];
    const onTheLeft = Math.floor(keyIndex / Math.pow(2, level)) % 2 === 0;
    const left = onTheLeft ? node : sibling;
    const right = onTheLeft ? sibling : node;
    node = neutralSha256Hex(`${NEUTRAL_ATTESTATION_SIGNATURE_DOMAIN}|NODE|${level}|${left}|${right}`);
  }
  return node === verificationRoot;
}

/**
 * Is this attestation one a recognized attestor actually issued for this exact
 * authority? The digest is rebuilt from the AUTHORITY, never read off the
 * attestation, so a signature over a different journal, range, or identity
 * verifies against nothing.
 */
export function neutralAttestationVerifies(
  authority: NeutralConformanceAuthority,
  attestation: NeutralJournalAttestation
): boolean {
  const publicKey = neutralAttestorVerificationKey(attestation?.attestor_id);
  if (publicKey === null) return false;
  return neutralVerifyAttestationSignature(
    publicKey,
    neutralAttestationDigest(authority, attestation),
    attestation?.attestation_signature
  );
}

function isCommitmentShaped(value: unknown): boolean {
  return typeof value === "string" && NEUTRAL_COMMITMENT_PATTERN.test(value);
}

function entryWellFormed(entry: NeutralReceiptJournalEntry | undefined): boolean {
  if (entry === undefined || entry === null || typeof entry !== "object") return false;
  if (typeof entry.sequence !== "number" || !Number.isInteger(entry.sequence)) return false;
  if (typeof entry.scenario_id !== "string" || entry.scenario_id.length === 0) return false;
  if (!isNeutralOutcomeType(entry.outcome_type)) return false;
  if (!isNeutralDisposition(entry.disposition)) return false;
  if (entry.reason_code !== null && typeof entry.reason_code !== "string") return false;
  return isCommitmentShaped(entry.entry_commitment) && isCommitmentShaped(entry.previous_commitment);
}

function attestationWellFormed(attestation: NeutralJournalAttestation | undefined): boolean {
  if (attestation === undefined || attestation === null || typeof attestation !== "object") return false;
  if (typeof attestation.attestor_id !== "string") return false;
  if (!isCommitmentShaped(attestation.attested_journal_root)) return false;
  if (
    typeof attestation.attested_entry_count !== "number" ||
    !Number.isInteger(attestation.attested_entry_count)
  ) {
    return false;
  }
  if (
    typeof attestation.attestation_signature !== "string" ||
    !NEUTRAL_ATTESTATION_SIGNATURE_PATTERN.test(attestation.attestation_signature)
  ) {
    return false;
  }
  return (
    typeof attestation.attestation_ref === "string" &&
    NEUTRAL_ATTESTATION_REF_PATTERN.test(attestation.attestation_ref)
  );
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
  if (range.first < 0 || range.last < range.first) return false;
  // An authority WITHOUT its journal is the round-4 shape, and it is refused at
  // the door rather than silently treated as an authority that observed nothing.
  const entries = authority.observed_entries;
  if (!Array.isArray(entries) || entries.length === 0) return false;
  if (!entries.every((entry) => entryWellFormed(entry))) return false;
  const attestations = authority.attestations;
  if (!Array.isArray(attestations) || attestations.length === 0) return false;
  return attestations.every((attestation) => attestationWellFormed(attestation));
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
    | "scenario_journal_chain_unverified"
    | "scenario_journal_attestation_insufficient"
    | "scenario_attestation_signature_unverified"
    | "scenario_claimant_not_independent"
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
 *       a bundle checked only against itself proves only self-consistency), and
 *       it must CARRY the journal it names (MH-02-R4-B02): entries covering the
 *       declared range contiguously, a verifying commitment chain to one root, a
 *       quorum of distinct recognized attestors over that root, and a named
 *       claimant that is none of them
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
 *   12. every receipt reference must RESOLVE to a journal entry: its journal, a
 *       sequence inside the observed range, strictly increasing in tuple order,
 *       a commitment equal to that ENTRY's own transported commitment, and an
 *       outcome that does not contradict what the entry recorded
 *                                                              (no shaped labels,
 *                                                               no self-derived
 *                                                               commitments)
 *   13. every result's freshness verdict must be `fresh`       (no stale evidence)
 *   14. each disposition must match the scenario's expectation (the original check)
 *   15. a quorum of the accepted attestations must carry SIGNATURES that verify
 *       under the verification keys this core PINS                (MH-02-R5-B01:
 *                                                              no bundle a single
 *                                                              party can author)
 *
 * Gates 1-14 all compare claimant-supplied values with each other. Gate 15 is the
 * only one whose input the claimant cannot produce, and it is therefore the one
 * that makes the whole sequence mean something.
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

  // 0b — the observed journal must COVER the declared range, contiguously and in
  // order, and its chain must verify. A range with no entries in it is a claim
  // about a journal, not a journal.
  const entries = authority.observed_entries;
  const range = authority.receipt_sequence_range;
  const expectedEntryCount = range.last - range.first + 1;
  const coverageFaults: Array<Record<string, unknown>> = [];
  if (entries.length !== expectedEntryCount) {
    coverageFaults.push({
      reason: "entry_count_does_not_cover_range",
      expected_entry_count: expectedEntryCount,
      observed_entry_count: entries.length,
    });
  }
  for (let index = 0; index < entries.length; index += 1) {
    const expectedSequence = range.first + index;
    if (entries[index].sequence !== expectedSequence) {
      coverageFaults.push({
        reason: "sequence_gap_or_reorder",
        position: index,
        expected_sequence: expectedSequence,
        observed_sequence: entries[index].sequence,
      });
    }
  }
  // 0c — chain integrity. Each entry commits to its predecessor, the first
  // commits to the genesis anchor, and every commitment must be the one the
  // chain produces. Edit any entry and every commitment after it changes.
  let previousCommitment = neutralJournalGenesis(authority);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.previous_commitment !== previousCommitment) {
      coverageFaults.push({
        reason: "chain_link_broken",
        position: index,
        sequence: entry.sequence,
        expected_previous_commitment: previousCommitment,
        observed_previous_commitment: entry.previous_commitment,
      });
      break;
    }
    const expectedCommitment = neutralJournalEntryCommitment(authority, previousCommitment, entry);
    if (entry.entry_commitment !== expectedCommitment) {
      coverageFaults.push({
        reason: "entry_commitment_mismatch",
        position: index,
        sequence: entry.sequence,
        expected_entry_commitment: expectedCommitment,
        observed_entry_commitment: entry.entry_commitment,
      });
      break;
    }
    previousCommitment = entry.entry_commitment;
  }
  if (coverageFaults.length > 0) {
    return refuseConformance(
      "scenario_journal_chain_unverified",
      [
        "an authority carries the journal entries it observed, contiguously covering the range it declares",
        "each entry commits to its predecessor, so an entry cannot be inserted, removed, re-ordered, or edited in isolation",
        "a named range with no verifiable entries in it is a claim about a journal, never a journal",
      ],
      {
        ...baseFacts,
        authority_journal_id: authority.receipt_journal_id,
        authority_sequence_range: range,
        journal_genesis: neutralJournalGenesis(authority),
        journal_chain_faults: coverageFaults,
      }
    );
  }
  const journalRoot = previousCommitment;

  // 0d — a QUORUM of DISTINCT recognized attestors over that root. Two objects
  // agreeing is what round 4 accepted; this requires independently named parties
  // whose attestation binds the root, the entry count, the range, and the exact
  // identity, so an attestation cannot be moved between journals or releases.
  const attestationFaults: Array<Record<string, unknown>> = [];
  const acceptedAttestors: string[] = [];
  for (const attestation of authority.attestations) {
    if (NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS.indexOf(attestation.attestor_id) === -1) {
      attestationFaults.push({ attestor_id: attestation.attestor_id, reason: "attestor_unrecognized" });
      continue;
    }
    if (acceptedAttestors.indexOf(attestation.attestor_id) !== -1) {
      attestationFaults.push({ attestor_id: attestation.attestor_id, reason: "duplicate_attestor" });
      continue;
    }
    if (attestation.attested_journal_root !== journalRoot) {
      attestationFaults.push({
        attestor_id: attestation.attestor_id,
        reason: "attested_root_mismatch",
        expected_journal_root: journalRoot,
        attested_journal_root: attestation.attested_journal_root,
      });
      continue;
    }
    if (attestation.attested_entry_count !== entries.length) {
      attestationFaults.push({
        attestor_id: attestation.attestor_id,
        reason: "attested_entry_count_mismatch",
        expected_entry_count: entries.length,
        attested_entry_count: attestation.attested_entry_count,
      });
      continue;
    }
    const expectedRef = neutralAttestationReference(authority, attestation);
    if (attestation.attestation_ref !== expectedRef) {
      attestationFaults.push({
        attestor_id: attestation.attestor_id,
        reason: "attestation_reference_unbound",
        expected_attestation_ref: expectedRef,
        submitted_attestation_ref: attestation.attestation_ref,
      });
      continue;
    }
    acceptedAttestors.push(attestation.attestor_id);
  }
  if (acceptedAttestors.length < NEUTRAL_MINIMUM_ATTESTOR_QUORUM) {
    return refuseConformance(
      "scenario_journal_attestation_insufficient",
      [
        `a journal root is admitted only on a quorum of ${NEUTRAL_MINIMUM_ATTESTOR_QUORUM} distinct recognized attestors`,
        "an attestation binds one attestor to one root, entry count, range, and identity, so it cannot be moved between journals or releases",
        "an unrecognized, duplicated, or unbound attestation counts for nothing",
      ],
      {
        ...baseFacts,
        required_attestor_quorum: NEUTRAL_MINIMUM_ATTESTOR_QUORUM,
        recognized_journal_attestors: [...NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS],
        journal_root: journalRoot,
        accepted_attestors: acceptedAttestors,
        attestation_faults: attestationFaults,
      }
    );
  }

  // 0e — SEPARATION OF DUTIES. The claimant must name itself and must not be one
  // of the parties attesting the journal it is being judged against.
  const claimantId = evidence?.claimant_id;
  const claimantNamed =
    typeof claimantId === "string" && NEUTRAL_CLAIMANT_ID_PATTERN.test(claimantId);
  const claimantIsAttestor =
    claimantNamed &&
    (authority.attestations.some((attestation) => attestation.attestor_id === claimantId) ||
      NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS.indexOf(claimantId) !== -1);
  if (!claimantNamed || claimantIsAttestor) {
    return refuseConformance(
      "scenario_claimant_not_independent",
      [
        "the party asking to be promoted must name itself",
        "the claimant may not be one of the attestors of the journal it is judged against",
        "an anonymous claim cannot be checked for independence at all",
      ],
      {
        ...baseFacts,
        submitted_claimant_id: claimantId ?? null,
        attesting_parties: authority.attestations.map((attestation) => attestation.attestor_id),
        claimant_is_attestor: claimantIsAttestor,
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

    // THE INVERSION (MH-02-R4-B02). Round 4 recomputed the expected commitment
    // from the CLAIMANT's own result and compared it to the claimant's own
    // reference — two derivations of one set of facts, which is why a fully
    // invented package agreed with itself and promoted. The commitment is now
    // TRANSPORTED: it is read off the journal entry at that sequence, and the
    // claimant's result must match what the journal RECORDED.
    const entry = entries.find((candidate) => candidate.sequence === sequence);
    if (entry === undefined) {
      unbound.push({ stable_id: result.stable_id, reason: "no_journal_entry_at_sequence", sequence });
      continue;
    }
    if (commitment !== entry.entry_commitment) {
      unbound.push({
        stable_id: result.stable_id,
        reason: "commitment_is_not_the_journal_entry_commitment",
        submitted_commitment: commitment,
        journal_entry_commitment: entry.entry_commitment,
      });
      continue;
    }
    const recorded: Array<Record<string, unknown>> = [];
    if (entry.scenario_id !== result.stable_id) {
      recorded.push({ field: "scenario_id", journal: entry.scenario_id, claimed: result.stable_id });
    }
    if (entry.outcome_type !== result.outcome_type) {
      recorded.push({ field: "outcome_type", journal: entry.outcome_type, claimed: result.outcome_type });
    }
    if (entry.disposition !== result.disposition) {
      recorded.push({ field: "disposition", journal: entry.disposition, claimed: result.disposition });
    }
    if ((entry.reason_code ?? null) !== (result.reason_code ?? null)) {
      recorded.push({
        field: "reason_code",
        journal: entry.reason_code ?? null,
        claimed: result.reason_code ?? null,
      });
    }
    if (recorded.length > 0) {
      unbound.push({
        stable_id: result.stable_id,
        reason: "claimed_result_contradicts_the_journal_entry",
        sequence,
        contradictions: recorded,
      });
    }
  }
  if (unbound.length > 0) {
    return refuseConformance(
      "scenario_receipt_binding_unverified",
      [
        "a receipt reference resolves to an entry the journal actually carries, and cites that entry's own commitment",
        "the journal's record of the outcome is what counts; a claimed result that contradicts its entry is refused",
        "a reference that merely has the canonical shape addresses nothing",
        "receipt sequences increase with the required tuple, so a receipt cannot precede the result it records",
      ],
      {
        ...baseFacts,
        authority_journal_id: authority.receipt_journal_id,
        authority_sequence_range: authority.receipt_sequence_range,
        journal_root: journalRoot,
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

  // 15 — THE TRUST ROOT (MH-02-R5-B01). Everything above this line compares
  // values the claimant supplied against other values the claimant supplied. Each
  // such gate is worth having — a bundle that fails one is malformed — but no
  // number of them can be unsatisfiable by a party that supplies all of them,
  // which is exactly what round 5 conceded in a passing test. This gate is
  // different in kind: the quorum must carry SIGNATURES that verify under keys
  // pinned in this core, over a digest rebuilt here from the authority. A
  // claimant can choose every other input on this page and still cannot produce
  // one, because producing one needs a private exponent that is not in this
  // repository and is not derivable from anything in it.
  //
  // It runs last because it is the only expensive check and because a specific
  // structural diagnosis is more useful than "unverified" when a bundle is simply
  // malformed. Running last does not make it optional: promotion is returned
  // below this block and nowhere else.
  const signatureFaults: Array<Record<string, unknown>> = [];
  const verifiedAttestors: string[] = [];
  for (const attestation of authority.attestations) {
    if (acceptedAttestors.indexOf(attestation.attestor_id) === -1) continue;
    // DISTINCT parties, counted once each. Structural acceptance already rejects
    // a second attestation from the same attestor, but it does so by dropping the
    // duplicate from `acceptedAttestors` rather than from the list, so counting
    // list entries here would let one real attestor's signature, repeated, stand
    // in for the quorum it is supposed to be half of.
    if (verifiedAttestors.indexOf(attestation.attestor_id) !== -1) continue;
    if (neutralAttestationVerifies(authority, attestation)) {
      verifiedAttestors.push(attestation.attestor_id);
      continue;
    }
    signatureFaults.push({
      attestor_id: attestation.attestor_id,
      reason: "attestation_signature_did_not_verify",
      signed_digest: neutralAttestationDigest(authority, attestation),
    });
  }
  if (verifiedAttestors.length < NEUTRAL_MINIMUM_ATTESTOR_QUORUM) {
    return refuseConformance(
      "scenario_attestation_signature_unverified",
      [
        `promotion requires ${NEUTRAL_MINIMUM_ATTESTOR_QUORUM} attestations that VERIFY under the keys this core pins`,
        "the verification keys are core-pinned, so the trust root is not an input the claimant supplies",
        "a structurally perfect attestation that no recognized attestor signed is not evidence of anything",
        "a signature is bound to one attestor, journal, root, entry count, range, and identity, so it cannot be replayed onto another bundle",
      ],
      {
        ...baseFacts,
        attestation_scheme: NEUTRAL_ATTESTATION_SCHEME,
        required_attestor_quorum: NEUTRAL_MINIMUM_ATTESTOR_QUORUM,
        trust_root_attestors: [...NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS],
        journal_root: journalRoot,
        structurally_accepted_attestors: acceptedAttestors,
        verified_attestors: verifiedAttestors,
        signature_faults: signatureFaults,
      }
    );
  }

  return neutralOutcome({
    type: "guild.support_transition_outcome.v1",
    disposition: "succeeded",
    assertions: [
      "conformant may be promoted only for the exact evidence-bound version tuple",
      "constructed adapter smoke cannot satisfy lifecycle conformance",
      "every required scenario passed or explicitly refused under fresh, receipt-bound evidence",
      "every identity field the frozen support_claim rule names is present, recognized, and equal to the authority's",
      "the observed journal covers the declared range contiguously and its commitment chain verifies to a single root",
      "that root carries a quorum of distinct recognized attestations bound to this exact identity and range",
      "each attestation in that quorum carries a signature that VERIFIES under a verification key pinned in this core",
      "the trust root is pinned by the core, so no input the claimant supplies can stand in for it",
      "every receipt reference cites the journal entry's OWN commitment, and no claimed result contradicts its entry",
      "the claimant named itself and is none of the attesting parties",
    ],
    facts: {
      ...baseFacts,
      activated_runtime: evidence.activated_runtime,
      authority_identity: authority.identity,
      authority_journal_id: authority.receipt_journal_id,
      claimant_id: evidence.claimant_id,
      journal_root: journalRoot,
      journal_entry_count: entries.length,
      attesting_parties: acceptedAttestors,
      verified_attestors: verifiedAttestors,
      attestation_scheme: NEUTRAL_ATTESTATION_SCHEME,
      evaluated_scenarios: results.map((result) => ({
        stable_id: result.stable_id,
        disposition: result.disposition,
        receipt_ref: result.receipt_ref,
      })),
      may_promote_conformant: true,
    },
  });
}
