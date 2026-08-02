/**
 * src/modules/lifecycle/workflows/neutral-lifecycle-machine.ts
 *
 * The host-neutral lifecycle state machine: a pure function of
 * (state, normalized event) → (state, typed outcome).
 *
 * MH-02 / W1 of `multi-host-runtime-convergence`. Boundary: `host-neutral-core`,
 * which OWNS lifecycle state transitions and lifecycle decisions. Host adapters
 * (MH-03) hand this machine normalized events; execution transports (MH-04) hand
 * it transport facts. Neither decides anything here, and this machine reaches
 * neither of them.
 *
 * Scenarios this machine is the implementation of (guild.conformance_scenarios.v1,
 * owner W1/MH-02):
 *
 *   MHRC-LIF-001  equivalent phase entry produces equivalent lifecycle state
 *   MHRC-LIF-002  equivalent gate violation produces equivalent refusal
 *   MHRC-LIF-003  compaction and resume preserve lifecycle identity
 *   MHRC-LIF-004  run close requires equivalent terminal evidence
 *
 * DESIGN RULES, and why each one is load-bearing
 *
 *   1. Pure. No clock, no randomness, no filesystem, no env, no host handle, no
 *      Node builtin — the only import is another core member. Every identity
 *      value arrives on the event. This is what makes two hosts comparable at
 *      all: if the machine could read anything ambient, "equivalent inputs
 *      produce equivalent decisions" would be untestable.
 *   2. A refusal changes NOTHING. Every refused event returns the caller's state
 *      object unchanged, so a pre-state and post-state fingerprint match by
 *      construction rather than by careful copying.
 *   3. Idempotent by transition id. Replaying an applied transition is a
 *      no-change success, so a resumed or re-delivered event cannot double-apply
 *      (MHRC-LIF-003 "already-applied transitions are not repeated").
 *   4. One snapshot per run (CI-03). Any event carrying a different capability
 *      snapshot hash is refused, so a run's capability truth cannot drift
 *      mid-flight.
 *   5. Absence is never success (BR-07). A required observation that is missing,
 *      `not_observed`, or `observation_failed` blocks a clean close.
 *
 * RECEIPT BOUNDARY — read this before extending
 *   The machine consumes the normalized `receipt.append` event ONLY to update its
 *   own required-observation ledger, which is a lifecycle DECISION input the core
 *   owns. Durable append, atomicity, monotonic sequence, gap reconciliation, and
 *   duplicate-delivery semantics (MHRC-RCT-001..005) belong to W1/MH-06 and are
 *   deliberately NOT implemented here: this file writes and reads no journal.
 *
 * Pure library module; there is no CLI entrypoint.
 */

import {
  NEUTRAL_CONTRACT_VERSION,
  isNeutralCleanObservation,
  isNeutralEventName,
  isNeutralLifecyclePhase,
  isNeutralObservationState,
  mapLegacyNeutralEventName,
  neutralFingerprint,
  neutralFreeze,
  neutralOutcome,
} from "./neutral-runtime-contracts";
import type {
  NeutralDisposition,
  NeutralEventName,
  NeutralLifecyclePhase,
  NeutralObservationState,
  NeutralOutcome,
  NeutralReasonCode,
} from "./neutral-runtime-contracts";
import { evaluateNeutralAdmission, neutralCapabilitySnapshotHash } from "./neutral-gate-policy";
import type {
  NeutralAdmissionRequest,
  NeutralCapabilitySnapshot,
  NeutralGate,
  NeutralOperationClass,
  NeutralPolicy,
} from "./neutral-gate-policy";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** `open` is the only non-terminal status. */
export const NEUTRAL_RUN_STATUSES = Object.freeze(["open", "completed", "aborted"] as const);
export type NeutralRunStatus = (typeof NEUTRAL_RUN_STATUSES)[number];

export const NEUTRAL_TERMINAL_RUN_STATUSES: readonly NeutralRunStatus[] = Object.freeze(["completed", "aborted"]);

/**
 * The run-bound admission inputs (MH-02-R1-B01).
 *
 * These live in STATE, not on the event, and that placement is the whole fix.
 * When the caller supplied a `gate_condition` verdict on the event, the
 * lifecycle path could record a satisfied gate for an operation that
 * `evaluateNeutralAdmission` refused. Now the caller supplies only FACTS about
 * its request; capability, authentication, policy, approval, and the gate
 * verdict are all computed here from the run-bound snapshot, policy, and gate
 * declarations, so the two paths cannot disagree — they are one path.
 */
export interface NeutralAdmissionContext {
  readonly snapshot: NeutralCapabilitySnapshot;
  readonly policy: NeutralPolicy;
  readonly gates: readonly NeutralGate[];
}

/**
 * The run-bound snapshot hash carried by an admission context, or `undefined`
 * when there is no context (or a hand-built one with no snapshot at all).
 *
 * ONE SNAPSHOT PER RUN, MECHANICALLY (MH-02-R2-B01)
 *   `capability_snapshot_hash` on the state and `admission_context.snapshot`
 *   used to arrive independently: a run could CLAIM one snapshot hash and be
 *   DECIDED against another, and the outcome binding recorded the claim. That
 *   made a typed receipt attributable to a snapshot nobody evaluated. The two
 *   are now required to be the same string at construction, re-checked before
 *   every event, and the outcome binding names the EVALUATED snapshot rather
 *   than the claimed one — three independent places, because a state can be
 *   assembled without the constructor (a restored checkpoint, a fixture).
 */
export function neutralAdmissionContextSnapshotHash(
  context: NeutralAdmissionContext | null | undefined
): string | undefined {
  const carried = context?.snapshot?.snapshot_hash;
  return typeof carried === "string" && carried.length > 0 ? carried : undefined;
}

/**
 * A typed rule under which an observation is INAPPLICABLE. The frozen contract
 * defines `not_applicable` as inapplicability under an explicit typed rule
 * recorded with the operation, so an unruled `not_applicable` must fail closed
 * (MH-02-R1-B02).
 */
export interface NeutralNotApplicableRule {
  readonly rule_id: string;
  readonly applies_to_observation: string;
  readonly rationale: string;
}

/** What the ledger stores per observation: the state AND its rule binding. */
export interface NeutralObservationRecord {
  readonly state: NeutralObservationState;
  /** Required exactly when `state === "not_applicable"`; null otherwise. */
  readonly not_applicable_rule_id: string | null;
}

export interface NeutralLifecycleState {
  readonly schema_version: "guild.lifecycle_state.v1";
  readonly run_id: string;
  /** The ONE snapshot hash this run is bound to for its whole life (CI-03). */
  readonly capability_snapshot_hash: string;
  readonly phase: NeutralLifecyclePhase;
  readonly status: NeutralRunStatus;
  /** Applied transition ids, in application order. The idempotency ledger. */
  readonly applied_transitions: readonly string[];
  /** Monotonic non-decreasing checkpoint counter; advanced by compact/resume. */
  readonly checkpoint_sequence: number;
  readonly gate_outcomes: Readonly<Record<string, NeutralDisposition>>;
  readonly observations: Readonly<Record<string, NeutralObservationRecord>>;
  readonly required_gate_ids: readonly string[];
  readonly required_observations: readonly string[];
  /** Absent means `tool.before` fails closed rather than trusting the event. */
  readonly admission_context: NeutralAdmissionContext | null;
  readonly not_applicable_rules: readonly NeutralNotApplicableRule[];
}

export interface NeutralInitialLifecycleStateInput {
  readonly run_id: string;
  readonly capability_snapshot_hash: string;
  readonly phase: NeutralLifecyclePhase;
  readonly required_gate_ids?: readonly string[];
  readonly required_observations?: readonly string[];
  readonly admission_context?: NeutralAdmissionContext;
  readonly not_applicable_rules?: readonly NeutralNotApplicableRule[];
}

export function neutralInitialLifecycleState(
  input: NeutralInitialLifecycleStateInput
): NeutralLifecycleState {
  if (!input.run_id) {
    throw new Error("neutralInitialLifecycleState: run_id must be a non-empty string");
  }
  if (!input.capability_snapshot_hash) {
    throw new Error(
      "neutralInitialLifecycleState: capability_snapshot_hash must be a non-empty string"
    );
  }
  if (!isNeutralLifecyclePhase(input.phase)) {
    throw new Error(
      `neutralInitialLifecycleState: unknown lifecycle phase ${JSON.stringify(input.phase)}`
    );
  }
  for (const rule of input.not_applicable_rules ?? []) {
    if (!rule.rule_id || !rule.applies_to_observation) {
      throw new Error(
        "neutralInitialLifecycleState: every not_applicable rule needs a rule_id and an applies_to_observation"
      );
    }
  }
  // CI-03, at the only moment a run's snapshot identity is chosen: the snapshot
  // the run BINDS to and the snapshot its admission decisions will be EVALUATED
  // against must be one snapshot. Accepting two here is what let a later outcome
  // name a snapshot that was never consulted (MH-02-R2-B01).
  if (input.admission_context !== undefined) {
    const contextHash = neutralAdmissionContextSnapshotHash(input.admission_context);
    if (contextHash !== input.capability_snapshot_hash) {
      throw new Error(
        "neutralInitialLifecycleState: admission_context.snapshot.snapshot_hash " +
          `${JSON.stringify(contextHash ?? null)} must equal capability_snapshot_hash ` +
          `${JSON.stringify(input.capability_snapshot_hash)} — exactly one snapshot binds a run`
      );
    }
  }
  return neutralFreeze({
    schema_version: "guild.lifecycle_state.v1",
    run_id: input.run_id,
    capability_snapshot_hash: input.capability_snapshot_hash,
    phase: input.phase,
    status: "open",
    applied_transitions: [],
    checkpoint_sequence: 0,
    gate_outcomes: {},
    observations: {},
    required_gate_ids: [...(input.required_gate_ids ?? [])],
    required_observations: [...(input.required_observations ?? [])],
    admission_context: input.admission_context ?? null,
    not_applicable_rules: [...(input.not_applicable_rules ?? [])],
  }) as NeutralLifecycleState;
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export interface NeutralLifecycleEvent {
  readonly name: NeutralEventName;
  /** Stable id for this transition attempt. Re-delivery MUST reuse it. */
  readonly transition_id: string;
  readonly capability_snapshot_hash: string;
  readonly input: Readonly<Record<string, unknown>>;
  /**
   * Adapter-owned host-native provenance. The machine never reads this, and it
   * never enters state, so it cannot influence a decision or a fingerprint.
   */
  readonly host_native?: Readonly<Record<string, unknown>>;
}

export interface NeutralTransition {
  readonly state: NeutralLifecycleState;
  readonly outcome: NeutralOutcome;
  readonly state_changed: boolean;
}

// ---------------------------------------------------------------------------
// Semantic view / equivalence
// ---------------------------------------------------------------------------

/**
 * The comparable projection of a state. Contains only core-owned semantic
 * fields; host-native provenance is structurally absent because it is never
 * stored. MHRC-LIF-001 requires host-native fields to be excluded from
 * equivalence comparison — here that is a property of the type, not a filter.
 */
export function neutralLifecycleSemanticView(
  state: NeutralLifecycleState
): Readonly<Record<string, unknown>> {
  return {
    run_id: state.run_id,
    capability_snapshot_hash: state.capability_snapshot_hash,
    phase: state.phase,
    status: state.status,
    applied_transitions: [...state.applied_transitions],
    checkpoint_sequence: state.checkpoint_sequence,
    gate_outcomes: { ...state.gate_outcomes },
    observations: neutralObservationLedgerView(state),
    required_gate_ids: [...state.required_gate_ids],
    required_observations: [...state.required_observations],
    admission_context: neutralAdmissionContextSemanticView(state.admission_context),
    not_applicable_rules: state.not_applicable_rules.map((rule) => ({
      rule_id: rule.rule_id,
      applies_to_observation: rule.applies_to_observation,
      rationale: rule.rationale,
    })),
  };
}

/** Stable, order-independent projection of the observation ledger. */
function neutralObservationLedgerView(
  state: NeutralLifecycleState
): Readonly<Record<string, unknown>> {
  const view: Record<string, unknown> = {};
  for (const key of Object.keys(state.observations).sort()) {
    const record = state.observations[key];
    view[key] = {
      state: record.state,
      not_applicable_rule_id: record.not_applicable_rule_id,
    };
  }
  return view;
}

/**
 * The comparable projection of the admission context. `host_id`, `host_version`,
 * and the adapter-carried `snapshot_hash` are EXCLUDED: two hosts running the
 * same policy against the same capability facts must fingerprint identically, or
 * MHRC-LIF-001's cross-host equivalence comparison would be defeated by host
 * identity alone. What remains is the semantic capability hash plus the policy
 * and gate declarations, which are exactly the inputs a decision depends on.
 */
export function neutralAdmissionContextSemanticView(
  context: NeutralAdmissionContext | null
): Readonly<Record<string, unknown>> | null {
  if (context === null) return null;
  return {
    capability_facts_hash: neutralCapabilitySnapshotHash(context.snapshot),
    policy_version: context.policy.policy_version,
    denied_operations: [...context.policy.denied_operations].sort(),
    approval_required_operations: [...context.policy.approval_required_operations].sort(),
    gates: context.gates
      .map((gate) => ({
        gate_id: gate.gate_id,
        phase: gate.phase,
        operation_class: gate.operation_class,
        required_conditions: [...gate.required_conditions],
      }))
      .sort((a, b) => (a.gate_id < b.gate_id ? -1 : a.gate_id > b.gate_id ? 1 : 0)),
  };
}

/** Deterministic pre/post-state hash used by the LIF scenarios. */
export function neutralLifecycleFingerprint(state: NeutralLifecycleState): string {
  return neutralFingerprint(neutralLifecycleSemanticView(state));
}

/** True iff two states are semantically equivalent, ignoring host provenance. */
export function neutralLifecycleEquivalent(
  left: NeutralLifecycleState,
  right: NeutralLifecycleState
): boolean {
  return neutralLifecycleFingerprint(left) === neutralLifecycleFingerprint(right);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function bindingFor(state: NeutralLifecycleState, event: NeutralLifecycleEvent) {
  return {
    run_id: state.run_id,
    operation_id: event.transition_id,
    capability_snapshot_hash: state.capability_snapshot_hash,
    contract_version: NEUTRAL_CONTRACT_VERSION,
  };
}

/** A refusal: the caller's state is returned untouched. */
function refuse(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent,
  reason: NeutralReasonCode,
  facts: Record<string, unknown>,
  assertions: readonly string[]
): NeutralTransition {
  return neutralFreeze({
    state,
    state_changed: false,
    outcome: neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "refused",
      reason_code: reason,
      assertions: [...assertions],
      binding: bindingFor(state, event),
      facts: { event_name: event.name, side_effect: false, ...facts },
    }),
  }) as NeutralTransition;
}

/** A success that leaves state alone (a no-op or an idempotent replay). */
function unchanged(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent,
  facts: Record<string, unknown>,
  assertions: readonly string[]
): NeutralTransition {
  return neutralFreeze({
    state,
    state_changed: false,
    outcome: neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "succeeded",
      assertions: [...assertions],
      binding: bindingFor(state, event),
      facts: { event_name: event.name, ...facts },
    }),
  }) as NeutralTransition;
}

/**
 * A success that advances state; records the transition id for idempotency.
 *
 * `bindingOverride` exists for one reason: an admission success must name the
 * snapshot the evaluator actually consulted (MH-02-R2-B01), which is a property
 * of the decision, not of the state record.
 */
function advance(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent,
  patch: Partial<NeutralLifecycleState>,
  facts: Record<string, unknown>,
  assertions: readonly string[],
  bindingOverride?: Record<string, unknown>
): NeutralTransition {
  const next = neutralFreeze({
    ...state,
    ...patch,
    applied_transitions: [...state.applied_transitions, event.transition_id],
  }) as NeutralLifecycleState;
  return neutralFreeze({
    state: next,
    state_changed: true,
    outcome: neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "succeeded",
      assertions: [...assertions],
      binding: { ...bindingFor(next, event), ...(bindingOverride ?? {}) },
      facts: { event_name: event.name, ...facts },
    }),
  }) as NeutralTransition;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// ---------------------------------------------------------------------------
// Per-event handlers
// ---------------------------------------------------------------------------

function handlePromptSubmit(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent
): NeutralTransition {
  if (event.input.semantic_intent !== "enter_phase") {
    // A prompt the core takes no lifecycle decision on. Explicitly a no-op, not
    // a silently-dropped event.
    return unchanged(state, event, { no_op: true }, ["core takes no lifecycle decision"]);
  }
  const phase = event.input.phase;
  if (!isNeutralLifecyclePhase(phase)) {
    return refuse(
      state,
      event,
      "unknown_phase",
      { requested_phase: phase },
      ["the prior state is preserved", "the phase matrix is closed"]
    );
  }
  return advance(
    state,
    event,
    { phase },
    { semantic_intent: "enter_phase", phase, lifecycle_decision: "phase_entered" },
    [
      "host pairs reach the same semantic phase state",
      "host pairs emit the same lifecycle decision code",
      "host-native fields are excluded from equivalence comparison",
    ]
  );
}

/**
 * `tool.before` — ONE coherent typed admission decision (MH-02-R1-B01).
 *
 * The event no longer carries a verdict. It carries a REQUEST, and this handler
 * asks `evaluateNeutralAdmission` — the same evaluator any other caller would
 * use — what that request means against the run-bound snapshot, policy, and gate
 * declaration. Whatever the evaluator says is what the lifecycle records, so
 * capability absence, authentication failure, policy denial, missing approval,
 * gate refusal, and success stay six distinct outcomes and cannot diverge from
 * the core's own admission answer.
 *
 * A caller-supplied `gate_condition` is IGNORED entirely; supplying one is
 * reported in the facts so a stale adapter is visible rather than silently
 * tolerated.
 */
function handleToolBefore(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent
): NeutralTransition {
  const suppliedVerdict = event.input.gate_condition;
  const gateId = asString(event.input.gate_id);

  // Fail closed: with no run-bound admission context there is nothing to decide
  // against, and trusting the event is exactly the defect being closed.
  if (state.admission_context === null) {
    return refuse(
      state,
      event,
      "admission_context_missing",
      {
        gate_id: gateId ?? null,
        supplied_gate_condition: suppliedVerdict ?? null,
        caller_supplied_verdict_ignored: suppliedVerdict !== undefined,
      },
      [
        "a lifecycle admission decision requires a run-bound capability snapshot, policy, and gate",
        "a caller-supplied gate verdict is never trusted",
        "no tool side effect occurs",
      ]
    );
  }

  const context = state.admission_context;
  // The snapshot this decision will actually be taken against. `applyNeutral-
  // LifecycleEvent` has already refused any state where this disagrees with the
  // run-bound hash, so from here the two are the same string — and every
  // binding below names THIS one, so the outcome can never attribute a decision
  // to a snapshot that was not consulted (MH-02-R2-B01).
  const evaluatedSnapshotHash = neutralAdmissionContextSnapshotHash(context);
  const gate = context.gates.find((candidate) => candidate.gate_id === gateId);
  if (gateId === undefined || gate === undefined) {
    return refuse(
      state,
      event,
      "gate_unsatisfied",
      {
        gate_id: gateId ?? null,
        supplied_gate_condition: suppliedVerdict ?? null,
        caller_supplied_verdict_ignored: suppliedVerdict !== undefined,
        declared_gate_ids: context.gates.map((candidate) => candidate.gate_id),
      },
      [
        "an undeclared gate cannot be proven satisfied",
        "both hosts preserve the prior state",
        "no tool side effect occurs",
      ]
    );
  }

  const request: NeutralAdmissionRequest = {
    operation_id: event.transition_id,
    operation: asString(event.input.operation) ?? "",
    required_capability: asString(event.input.required_capability) ?? "",
    operation_class: (asString(event.input.operation_class) ?? gate.operation_class) as NeutralOperationClass,
    satisfied_conditions: Array.isArray(event.input.satisfied_conditions)
      ? (event.input.satisfied_conditions as readonly unknown[]).filter(
          (value): value is string => typeof value === "string"
        )
      : [],
    approval_supplied: event.input.approval_supplied === true,
  };

  const admission = evaluateNeutralAdmission({
    request,
    snapshot: context.snapshot,
    policy: context.policy,
    gate,
  });

  const sharedFacts = {
    gate_id: gate.gate_id,
    operation: request.operation,
    operation_class: request.operation_class,
    caller_supplied_verdict_ignored: suppliedVerdict !== undefined,
    admission_outcome_type: admission.type,
    admission_disposition: admission.disposition,
    admission_reason_code: admission.reason_code,
    // Stated in the facts as well as the binding, so a receipt reader can see
    // WHICH snapshot produced the answer without trusting the binding merge.
    evaluated_capability_snapshot_hash: evaluatedSnapshotHash ?? null,
    run_bound_capability_snapshot_hash: state.capability_snapshot_hash,
  };
  const evaluatedBinding = { capability_snapshot_hash: evaluatedSnapshotHash };

  if (admission.disposition !== "succeeded") {
    // The admission answer IS the lifecycle answer. Its own outcome type is
    // preserved (capability vs policy vs lifecycle), because collapsing an
    // unsupported capability into a gate refusal is the very conflation
    // MHRC-UNS-002 forbids. State is untouched.
    return neutralFreeze({
      state,
      state_changed: false,
      outcome: neutralOutcome({
        type: admission.type,
        disposition: admission.disposition,
        reason_code: admission.reason_code,
        assertions: [
          ...admission.assertions,
          "the outcome names the capability snapshot that was evaluated",
        ],
        // Order matters: `bindingFor` supplies the run/operation identity, and
        // `evaluatedBinding` then RE-asserts the evaluated snapshot hash so the
        // state's own field can never overwrite it (that overwrite was the
        // defect — the claimed hash won over the evaluated one).
        binding: { ...admission.binding, ...bindingFor(state, event), ...evaluatedBinding },
        facts: {
          event_name: event.name,
          side_effect: false,
          ...admission.facts,
          ...sharedFacts,
        },
      }),
    }) as NeutralTransition;
  }

  return advance(
    state,
    event,
    { gate_outcomes: { ...state.gate_outcomes, [gate.gate_id]: "succeeded" } },
    { ...sharedFacts, lifecycle_decision: "gate_satisfied" },
    [
      "the gate produced a typed satisfied outcome",
      "capability, authentication, policy, approval, and gate were all decided by the core",
      "the outcome names the capability snapshot that was evaluated",
    ],
    evaluatedBinding
  );
}

/**
 * `tool.after` — records EXECUTION outcome, kept distinct from admission.
 *
 * An operation that was admitted and then failed is neither a refusal nor a
 * success. Recording the failure against the gate is what stops a failed
 * execution from riding a previously-satisfied gate into a clean close.
 */
function handleToolAfter(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent
): NeutralTransition {
  const gateId = asString(event.input.gate_id);
  const status = asString(event.input.execution_status);

  if (gateId === undefined || status === undefined) {
    return unchanged(state, event, { no_op: true }, [
      "no gate-bound execution result was supplied",
    ]);
  }

  if (state.gate_outcomes[gateId] === undefined) {
    return refuse(
      state,
      event,
      "required_gate_outcome_missing",
      { gate_id: gateId, execution_status: status },
      ["an execution result cannot be recorded for a gate that was never admitted"]
    );
  }

  if (status === "succeeded") {
    return advance(
      state,
      event,
      {},
      { gate_id: gateId, execution_status: status, lifecycle_decision: "execution_succeeded" },
      ["the admitted operation completed and the gate remains satisfied"]
    );
  }

  return neutralFreeze({
    state: neutralFreeze({
      ...state,
      gate_outcomes: { ...state.gate_outcomes, [gateId]: "failed" },
      applied_transitions: [...state.applied_transitions, event.transition_id],
    }) as NeutralLifecycleState,
    state_changed: true,
    outcome: neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "failed",
      reason_code: "execution_failed",
      assertions: [
        "an execution failure is distinct from a refusal and from a success",
        "a failed execution downgrades its gate so it cannot back a clean close",
      ],
      binding: bindingFor(state, event),
      facts: {
        event_name: event.name,
        gate_id: gateId,
        execution_status: status,
        lifecycle_decision: "execution_failed",
      },
    }),
  }) as NeutralTransition;
}

function handleCheckpoint(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent
): NeutralTransition {
  // Compaction and resume advance the checkpoint counter and touch nothing else:
  // run identity, snapshot hash, phase, gates, and observations all survive.
  return advance(
    state,
    event,
    { checkpoint_sequence: state.checkpoint_sequence + 1 },
    {
      lifecycle_decision: event.name === "context.compact" ? "compacted" : "resumed",
      checkpoint_sequence: state.checkpoint_sequence + 1,
    },
    [
      "run_id and capability snapshot hash are unchanged",
      "resume continues from the last durable lifecycle state",
      "already-applied transitions are not repeated",
    ]
  );
}

/**
 * Resolve the typed rule that makes an observation inapplicable, or say exactly
 * why it does not resolve (MH-02-R1-B02). Shared by the record path and the
 * close path so the two cannot drift.
 */
function resolveNotApplicableRule(
  state: NeutralLifecycleState,
  observation: string,
  ruleId: string | null
): { readonly rule?: NeutralNotApplicableRule; readonly reason?: NeutralReasonCode } {
  if (ruleId === null || ruleId.length === 0) return { reason: "not_applicable_rule_missing" };
  const rule = state.not_applicable_rules.find((candidate) => candidate.rule_id === ruleId);
  if (rule === undefined) return { reason: "not_applicable_rule_unknown" };
  if (rule.applies_to_observation !== observation) return { reason: "not_applicable_rule_mismatch" };
  return { rule };
}

function handleObservation(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent
): NeutralTransition {
  const observation = asString(event.input.observation);
  const observationState = event.input.observation_state;
  if (observation === undefined) {
    return unchanged(state, event, { no_op: true }, ["no observation id was supplied"]);
  }
  if (!isNeutralObservationState(observationState)) {
    return refuse(
      state,
      event,
      "unknown_observation_state",
      { observation, observation_state: observationState ?? null },
      ["the observation vocabulary is closed"]
    );
  }

  const suppliedRuleId = asString(event.input.not_applicable_rule_id) ?? null;

  if (observationState === "not_applicable") {
    // `not_applicable` is the ONLY observation state that asserts a requirement
    // does not apply. The frozen contract defines it as inapplicability under an
    // explicit typed rule, so an unruled, unknown, or wrongly-bound rule is
    // refused and nothing is recorded — arbitrary not_applicable fails closed.
    const resolved = resolveNotApplicableRule(state, observation, suppliedRuleId);
    if (resolved.reason !== undefined) {
      return refuse(
        state,
        event,
        resolved.reason,
        {
          observation,
          observation_state: observationState,
          supplied_not_applicable_rule_id: suppliedRuleId,
          declared_rule_ids: state.not_applicable_rules.map((rule) => rule.rule_id),
        },
        [
          "not_applicable asserts inapplicability under an explicit typed rule",
          "an unsubstantiated not_applicable is refused, not recorded",
        ]
      );
    }
    return advance(
      state,
      event,
      {
        observations: {
          ...state.observations,
          [observation]: { state: observationState, not_applicable_rule_id: suppliedRuleId },
        },
      },
      {
        observation,
        observation_state: observationState,
        not_applicable_rule_id: suppliedRuleId,
        not_applicable_rationale: resolved.rule?.rationale ?? null,
        lifecycle_decision: "observation_recorded",
      },
      [
        "the observation state is recorded as a lifecycle decision input",
        "the typed inapplicability rule is recorded with the operation",
      ]
    );
  }

  // A rule id is meaningless for any other state; carrying one would let a later
  // reader believe a rule justified something it did not.
  if (suppliedRuleId !== null) {
    return refuse(
      state,
      event,
      "not_applicable_rule_mismatch",
      {
        observation,
        observation_state: observationState,
        supplied_not_applicable_rule_id: suppliedRuleId,
      },
      ["a not_applicable rule may only bind a not_applicable observation"]
    );
  }

  return advance(
    state,
    event,
    {
      observations: {
        ...state.observations,
        [observation]: { state: observationState, not_applicable_rule_id: null },
      },
    },
    { observation, observation_state: observationState, lifecycle_decision: "observation_recorded" },
    ["the observation state is recorded as a lifecycle decision input"]
  );
}

function handleRunStop(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent
): NeutralTransition {
  const requested = event.input.requested_terminal_state ?? "completed";

  if (requested === "aborted") {
    // An abort is an explicit, evidence-free terminal state. It never claims
    // completion, so it is not gated on terminal evidence.
    return advance(
      state,
      event,
      { status: "aborted" },
      { terminal_state: "aborted", lifecycle_decision: "run_aborted" },
      ["an aborted run makes no completion claim"]
    );
  }

  if (requested !== "completed") {
    return refuse(
      state,
      event,
      "unknown_terminal_state",
      { requested_terminal_state: requested },
      ["the terminal-state vocabulary is closed"]
    );
  }

  const closeAssertions = [
    "both hosts reach the same terminal state",
    "completion is refused if any required observation is missing or failed",
    "terminal receipt is last in logical order",
  ];

  const missingObservations = state.required_observations.filter(
    (id) => state.observations[id] === undefined
  );
  if (missingObservations.length > 0) {
    return refuse(
      state,
      event,
      "required_observation_missing",
      { missing_observations: missingObservations, requested_terminal_state: "completed" },
      closeAssertions
    );
  }

  const failedObservations = state.required_observations.filter(
    (id) => !isNeutralCleanObservation(state.observations[id]?.state)
  );
  if (failedObservations.length > 0) {
    return refuse(
      state,
      event,
      "required_observation_failed",
      { failed_observations: failedObservations, requested_terminal_state: "completed" },
      closeAssertions
    );
  }

  // Re-validate every not_applicable binding at the close sentinel itself
  // (MH-02-R1-B02). The record path already refuses an unruled assertion; this
  // second check means a state assembled by any other route — a restored
  // checkpoint, a hand-built fixture — still cannot close on an inapplicability
  // that no declared rule supports.
  const unruled: Array<{ observation: string; reason: NeutralReasonCode; rule_id: string | null }> = [];
  for (const id of state.required_observations) {
    const record = state.observations[id];
    if (record === undefined || record.state !== "not_applicable") continue;
    const resolved = resolveNotApplicableRule(state, id, record.not_applicable_rule_id);
    if (resolved.reason !== undefined) {
      unruled.push({ observation: id, reason: resolved.reason, rule_id: record.not_applicable_rule_id });
    }
  }
  if (unruled.length > 0) {
    return refuse(
      state,
      event,
      unruled[0].reason,
      {
        unruled_not_applicable_observations: unruled,
        requested_terminal_state: "completed",
      },
      [
        ...closeAssertions,
        "every not_applicable observation resolves to a declared typed rule bound to that observation",
      ]
    );
  }

  const missingGateIds = state.required_gate_ids.filter(
    (id) => state.gate_outcomes[id] !== "succeeded"
  );
  if (missingGateIds.length > 0) {
    return refuse(
      state,
      event,
      "required_gate_outcome_missing",
      { missing_gate_ids: missingGateIds, requested_terminal_state: "completed" },
      closeAssertions
    );
  }

  return advance(
    state,
    event,
    { status: "completed" },
    {
      terminal_state: "completed",
      lifecycle_decision: "run_completed",
      gate_outcome_set_complete: true,
    },
    closeAssertions
  );
}

// ---------------------------------------------------------------------------
// The transition function
// ---------------------------------------------------------------------------

/**
 * Apply one normalized event. Never mutates `state`; always returns a frozen
 * result. Check order is deliberate:
 *
 *   event snapshot binding → STATE snapshot coherence → event vocabulary
 *   → idempotent replay → terminal status
 *
 * Snapshot binding first, because a run whose capability truth changed cannot be
 * reasoned about at all. State snapshot coherence immediately after, and BEFORE
 * anything else can succeed: a state that binds one snapshot hash while carrying
 * an admission context built from a different snapshot has no single capability
 * truth, so no event applied to it — not `run.stop`, not an idempotent replay —
 * may produce an attributable outcome (MH-02-R2-B01). Idempotent replay BEFORE
 * the terminal-status check, so re-delivering the very event that closed a run
 * is a harmless replay rather than a spurious `run_already_closed` refusal.
 */
export function applyNeutralLifecycleEvent(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent
): NeutralTransition {
  if (event.capability_snapshot_hash !== state.capability_snapshot_hash) {
    return refuse(
      state,
      event,
      "capability_snapshot_mismatch",
      {
        expected_capability_snapshot_hash: state.capability_snapshot_hash,
        observed_capability_snapshot_hash: event.capability_snapshot_hash,
      },
      ["no capability snapshot mutation is permitted", "exactly one snapshot binds a run"]
    );
  }

  // The constructor already refuses this pairing; this second check is what
  // makes it hold for a state assembled by ANY other route — a restored
  // checkpoint, a deserialized record, a hand-built fixture.
  if (state.admission_context !== null) {
    const contextHash = neutralAdmissionContextSnapshotHash(state.admission_context);
    if (contextHash !== state.capability_snapshot_hash) {
      return refuse(
        state,
        event,
        "admission_context_snapshot_mismatch",
        {
          run_bound_capability_snapshot_hash: state.capability_snapshot_hash,
          admission_context_snapshot_hash: contextHash ?? null,
          side_effect: false,
        },
        [
          "exactly one snapshot binds a run",
          "a decision is never evaluated against a snapshot the run is not bound to",
          "an outcome never names a capability snapshot that was not evaluated",
          "no tool side effect occurs",
        ]
      );
    }
  }

  if (!isNeutralEventName(event.name)) {
    // Not simply "unknown". A name from the SUPERSEDED v1 vocabulary gets the
    // machine-readable compatibility answer — its normative replacement named,
    // or both candidates named when no lossless one exists — so an adapter is
    // told what to send instead of merely being rejected (MH-02-R1-B05).
    const compatibility = mapLegacyNeutralEventName(event.name);
    return refuse(
      state,
      event,
      compatibility.reason_code ?? "unknown_event",
      {
        observed_event_name: event.name,
        ...compatibility.facts,
        compatibility_outcome_type: compatibility.type,
      },
      [
        "the normalized event vocabulary is closed",
        "the event is not silently skipped",
        ...compatibility.assertions,
      ]
    );
  }

  if (state.applied_transitions.indexOf(event.transition_id) !== -1) {
    return unchanged(state, event, { idempotent_replay: true }, [
      "already-applied transitions are not repeated",
    ]);
  }

  if (NEUTRAL_TERMINAL_RUN_STATUSES.indexOf(state.status) !== -1) {
    return refuse(
      state,
      event,
      "run_already_closed",
      { status: state.status },
      ["a terminal run accepts no further lifecycle transition"]
    );
  }

  switch (event.name) {
    case "prompt.submit":
      return handlePromptSubmit(state, event);
    case "tool.before":
      return handleToolBefore(state, event);
    case "tool.after":
      return handleToolAfter(state, event);
    case "context.compact":
    case "run.resume":
      return handleCheckpoint(state, event);
    case "receipt.append":
      return handleObservation(state, event);
    case "run.stop":
      return handleRunStop(state, event);
    default:
      // In-vocabulary, but the core takes no lifecycle decision on it. Explicit
      // no-op — never a silent drop (normalized_event_contract rule 3).
      return unchanged(state, event, { no_op: true }, ["core takes no lifecycle decision"]);
  }
}

/** Fold a sequence of events, returning one transition record per event. */
export function applyNeutralLifecycleEvents(
  state: NeutralLifecycleState,
  events: readonly NeutralLifecycleEvent[]
): NeutralTransition[] {
  const results: NeutralTransition[] = [];
  let current = state;
  for (const event of events) {
    const result = applyNeutralLifecycleEvent(current, event);
    results.push(result);
    current = result.state;
  }
  return results;
}
