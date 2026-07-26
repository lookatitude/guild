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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** `open` is the only non-terminal status. */
export const NEUTRAL_RUN_STATUSES = ["open", "completed", "aborted"] as const;
export type NeutralRunStatus = (typeof NEUTRAL_RUN_STATUSES)[number];

export const NEUTRAL_TERMINAL_RUN_STATUSES: readonly NeutralRunStatus[] = ["completed", "aborted"];

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
  readonly observations: Readonly<Record<string, NeutralObservationState>>;
  readonly required_gate_ids: readonly string[];
  readonly required_observations: readonly string[];
}

export interface NeutralInitialLifecycleStateInput {
  readonly run_id: string;
  readonly capability_snapshot_hash: string;
  readonly phase: NeutralLifecyclePhase;
  readonly required_gate_ids?: readonly string[];
  readonly required_observations?: readonly string[];
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
    observations: { ...state.observations },
    required_gate_ids: [...state.required_gate_ids],
    required_observations: [...state.required_observations],
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

/** A success that advances state; records the transition id for idempotency. */
function advance(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent,
  patch: Partial<NeutralLifecycleState>,
  facts: Record<string, unknown>,
  assertions: readonly string[]
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
      binding: bindingFor(next, event),
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

function handleToolBefore(
  state: NeutralLifecycleState,
  event: NeutralLifecycleEvent
): NeutralTransition {
  const gateId = asString(event.input.gate_id);
  const condition = event.input.gate_condition;

  // An unnamed gate cannot be proven satisfied, so it is refused rather than
  // waved through. A gate outcome is recorded ONLY on satisfaction: a refused
  // gate must leave state byte-identical (MHRC-LIF-002), which also means it can
  // never later be mistaken for a satisfied close gate (MHRC-LIF-004).
  if (gateId === undefined || condition !== "satisfied") {
    return refuse(
      state,
      event,
      "gate_unsatisfied",
      {
        gate_id: gateId ?? null,
        gate_condition: condition ?? null,
        operation_class: event.input.operation_class ?? null,
      },
      [
        "both hosts preserve the prior state",
        "both hosts return the same refusal reason code",
        "no tool side effect occurs",
      ]
    );
  }

  return advance(
    state,
    event,
    { gate_outcomes: { ...state.gate_outcomes, [gateId]: "succeeded" } },
    { gate_id: gateId, lifecycle_decision: "gate_satisfied" },
    ["the gate produced a typed satisfied outcome"]
  );
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
  return advance(
    state,
    event,
    { observations: { ...state.observations, [observation]: observationState } },
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
    (id) => !isNeutralCleanObservation(state.observations[id])
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
 *   snapshot binding → event vocabulary → idempotent replay → terminal status
 *
 * Snapshot binding first, because a run whose capability truth changed cannot be
 * reasoned about at all. Idempotent replay BEFORE the terminal-status check, so
 * re-delivering the very event that closed a run is a harmless replay rather
 * than a spurious `run_already_closed` refusal.
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

  if (!isNeutralEventName(event.name)) {
    return refuse(
      state,
      event,
      "unknown_event",
      { observed_event_name: event.name },
      ["the normalized event vocabulary is closed", "the event is not silently skipped"]
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
