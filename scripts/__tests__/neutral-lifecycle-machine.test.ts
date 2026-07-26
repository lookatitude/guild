/**
 * __tests__/neutral-lifecycle-machine.test.ts
 *
 * MH-02 (multi-host-runtime-convergence, W1) — pure host-neutral lifecycle
 * transition fixtures.
 *
 * Covers MH-02 acceptance 2 (core owns lifecycle state transitions and gates)
 * and acceptance 4 (pure transition fixtures are deterministic and host
 * independent), against the four W1/MH-02 lifecycle scenarios of
 * guild.conformance_scenarios.v1:
 *
 *   MHRC-LIF-001  equivalent phase entry produces equivalent lifecycle state
 *   MHRC-LIF-002  equivalent gate violation produces equivalent refusal
 *   MHRC-LIF-003  compaction and resume preserve lifecycle identity
 *   MHRC-LIF-004  run close requires equivalent terminal evidence
 *
 * Receipt journal durability, sequence reconciliation, and observation-loss
 * persistence (MHRC-RCT-001..005) are W1/MH-06 and are deliberately absent
 * here: this core consumes observation STATE as typed input and never writes or
 * reads a journal.
 *
 * The state machine is a pure function of (state, event). Fixtures use literal
 * ids and literal snapshot hashes — no clock, randomness, filesystem, env, or
 * host handle — so both hosts in every pair are simulated by input alone.
 */

import {
  applyNeutralLifecycleEvent,
  applyNeutralLifecycleEvents,
  neutralInitialLifecycleState,
  neutralLifecycleEquivalent,
  neutralLifecycleFingerprint,
  neutralLifecycleSemanticView,
} from "../../src/modules/lifecycle/workflows/neutral-lifecycle-machine";
import type {
  NeutralLifecycleEvent,
  NeutralLifecycleState,
} from "../../src/modules/lifecycle/workflows/neutral-lifecycle-machine";
import { NEUTRAL_LIFECYCLE_PHASES } from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";
import { evaluateNeutralAdmission, freezeNeutralCapabilitySnapshot } from "../../src/modules/lifecycle/workflows/neutral-gate-policy";
import type { NeutralAdmissionContext } from "../../src/modules/lifecycle/workflows/neutral-lifecycle-machine";

// ---------------------------------------------------------------------------
// Literal fixtures
// ---------------------------------------------------------------------------

const SNAPSHOT_HASH = "nfp1:0123456789abcdef";

/**
 * The run-bound admission inputs (MH-02-R1-B01). Every `tool.before` fixture
 * decides against THIS, never against a verdict carried on the event.
 */
function admissionContext(overrides: Partial<NeutralAdmissionContext> = {}): NeutralAdmissionContext {
  return {
    snapshot: freezeNeutralCapabilitySnapshot({
      snapshot_hash: SNAPSHOT_HASH,
      host_id: "host-a",
      host_version: "1.0.0",
      capabilities: [
        { capability_id: "tool.exec", supported: true, authenticated: true },
        { capability_id: "tool.unauthenticated", supported: true, authenticated: false },
      ],
    }),
    policy: {
      policy_version: "policy-1",
      denied_operations: ["forbidden-write"],
      approval_required_operations: ["approval-write"],
    },
    gates: [
      {
        gate_id: "G-spec",
        phase: "init",
        operation_class: "mutating",
        required_conditions: ["spec_approved"],
      },
    ],
    ...overrides,
  };
}

/** The typed rule that makes `scope_diff` inapplicable (MH-02-R1-B02). */
const NA_RULE = {
  rule_id: "NA-SCOPE-DIFF-001",
  applies_to_observation: "scope_diff",
  rationale: "a documentation-only run produces no scope diff to check",
};

function openState(overrides: Partial<Parameters<typeof neutralInitialLifecycleState>[0]> = {}) {
  return neutralInitialLifecycleState({
    run_id: "run-mh02-1",
    capability_snapshot_hash: SNAPSHOT_HASH,
    phase: "init",
    required_gate_ids: ["G-spec"],
    required_observations: ["scope_diff"],
    admission_context: admissionContext(),
    not_applicable_rules: [NA_RULE],
    ...overrides,
  });
}

/** A `tool.before` event that supplies REQUEST FACTS, never a verdict. */
function toolBefore(
  transitionId: string,
  input: Readonly<Record<string, unknown>> = {}
): NeutralLifecycleEvent {
  return {
    name: "tool.before",
    transition_id: transitionId,
    capability_snapshot_hash: SNAPSHOT_HASH,
    input: {
      gate_id: "G-spec",
      operation: "safe-write",
      required_capability: "tool.exec",
      operation_class: "mutating",
      satisfied_conditions: ["spec_approved"],
      approval_supplied: false,
      ...input,
    },
  };
}

function event(overrides: Partial<NeutralLifecycleEvent> = {}): NeutralLifecycleEvent {
  return {
    name: "prompt.submit",
    transition_id: "t-1",
    capability_snapshot_hash: SNAPSHOT_HASH,
    input: { semantic_intent: "enter_phase", phase: "plan" },
    ...overrides,
  } as NeutralLifecycleEvent;
}

/** Same normalized event, different host-native provenance payloads. */
function hostVariants(base: NeutralLifecycleEvent): NeutralLifecycleEvent[] {
  return [
    { ...base, host_native: { hook: "UserPromptSubmit", claude_session: "abc" } },
    { ...base, host_native: { wrapper: "guild-run", codex_thread: 42, argv: ["--json"] } },
  ];
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("neutralInitialLifecycleState", () => {
  it("produces a deeply frozen open state bound to exactly one snapshot hash", () => {
    const state = openState();
    expect(state.schema_version).toBe("guild.lifecycle_state.v1");
    expect(state.status).toBe("open");
    expect(state.phase).toBe("init");
    expect(state.capability_snapshot_hash).toBe(SNAPSHOT_HASH);
    expect(state.applied_transitions).toEqual([]);
    expect(state.checkpoint_sequence).toBe(0);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.gate_outcomes)).toBe(true);
    expect(Object.isFrozen(state.observations)).toBe(true);
  });

  it("rejects a phase outside the closed six-phase matrix", () => {
    expect(() => openState({ phase: "deploy" as never })).toThrow(/unknown lifecycle phase/i);
  });

  it("rejects an empty run id or snapshot hash", () => {
    expect(() => openState({ run_id: "" })).toThrow(/run_id/i);
    expect(() => openState({ capability_snapshot_hash: "" })).toThrow(/capability_snapshot_hash/i);
  });
});

// ---------------------------------------------------------------------------
// MHRC-LIF-001 — equivalent phase entry produces equivalent lifecycle state
// ---------------------------------------------------------------------------

describe("MHRC-LIF-001 equivalent phase entry", () => {
  it("advances the semantic phase and records the lifecycle decision", () => {
    const result = applyNeutralLifecycleEvent(openState(), event());
    expect(result.outcome.type).toBe("guild.lifecycle_outcome.v1");
    expect(result.outcome.disposition).toBe("succeeded");
    expect(result.state.phase).toBe("plan");
    expect(result.state_changed).toBe(true);
    expect(result.state.applied_transitions).toEqual(["t-1"]);
  });

  it("reaches the same semantic state and decision code on both hosts, for every phase", () => {
    for (const phase of NEUTRAL_LIFECYCLE_PHASES) {
      const [a, b] = hostVariants(
        event({ input: { semantic_intent: "enter_phase", phase } })
      ).map((evt) => applyNeutralLifecycleEvent(openState(), evt));

      expect(b.state.phase).toBe(a.state.phase);
      expect(b.outcome.disposition).toBe(a.outcome.disposition);
      expect(b.outcome.reason_code).toBe(a.outcome.reason_code);
      // Host-native fields are excluded from equivalence comparison.
      expect(neutralLifecycleFingerprint(b.state)).toBe(neutralLifecycleFingerprint(a.state));
      expect(neutralLifecycleEquivalent(a.state, b.state)).toBe(true);
    }
  });

  it("excludes host-native provenance from the semantic view", () => {
    const view = neutralLifecycleSemanticView(
      applyNeutralLifecycleEvent(openState(), hostVariants(event())[0]).state
    );
    expect(JSON.stringify(view)).not.toMatch(/claude_session|codex_thread|guild-run/);
  });

  it("refuses an unknown phase without mutating state", () => {
    const before = openState();
    const result = applyNeutralLifecycleEvent(
      before,
      event({ input: { semantic_intent: "enter_phase", phase: "deploy" } })
    );
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("unknown_phase");
    expect(result.state_changed).toBe(false);
    expect(neutralLifecycleFingerprint(result.state)).toBe(neutralLifecycleFingerprint(before));
  });

  it("refuses an event name outside the closed vocabulary", () => {
    const result = applyNeutralLifecycleEvent(openState(), event({ name: "not.an.event" as never }));
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("unknown_event");
    expect(result.state_changed).toBe(false);
  });

  it("refuses a SUPERSEDED v1 name with its normative replacement named (MH-02-R1-B05)", () => {
    const result = applyNeutralLifecycleEvent(openState(), event({ name: "tool.pre" as never }));
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("event_vocabulary_superseded");
    expect(result.outcome.facts.normative_event_name).toBe("tool.before");
    expect(result.outcome.facts.superseded_version).toBe("guild.normalized_event.v1");
    expect(result.outcome.facts.normative_version).toBe("guild.normalized_event.v2");
    expect(result.state_changed).toBe(false);
  });

  it("refuses the AMBIGUOUS v1 name rather than choosing a replacement", () => {
    const result = applyNeutralLifecycleEvent(
      openState(),
      event({ name: "task.transition" as never })
    );
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("event_vocabulary_ambiguous");
    expect(result.outcome.facts.normative_event_name).toBeNull();
    expect(result.outcome.facts.candidates).toEqual(["task.dispatch", "task.collect"]);
    expect(result.state_changed).toBe(false);
  });

  it("refuses any event carrying a different capability snapshot hash (CI-03)", () => {
    const before = openState();
    const result = applyNeutralLifecycleEvent(
      before,
      event({ capability_snapshot_hash: "nfp1:ffffffffffffffff" })
    );
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("capability_snapshot_mismatch");
    expect(neutralLifecycleFingerprint(result.state)).toBe(neutralLifecycleFingerprint(before));
  });
});

// ---------------------------------------------------------------------------
// MHRC-LIF-002 — equivalent gate violation produces equivalent refusal
// ---------------------------------------------------------------------------

describe("MHRC-LIF-002 equivalent gate violation", () => {
  const violation = toolBefore("t-gate", { satisfied_conditions: [] });

  it("refuses with gate_unsatisfied and preserves the prior state exactly", () => {
    const before = openState();
    const result = applyNeutralLifecycleEvent(before, violation);
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("gate_unsatisfied");
    expect(result.state_changed).toBe(false);
    // pre-state and post-state hashes match
    expect(neutralLifecycleFingerprint(result.state)).toBe(neutralLifecycleFingerprint(before));
    // no tool side effect occurs
    expect(result.outcome.facts.side_effect).toBe(false);
    // a refused gate records no gate outcome, so it cannot satisfy a close gate
    expect(result.state.gate_outcomes).toEqual({});
    expect(result.outcome.facts.unsatisfied_conditions).toEqual(["spec_approved"]);
  });

  it("returns the same refusal reason code on both hosts", () => {
    const [a, b] = hostVariants(violation).map((evt) =>
      applyNeutralLifecycleEvent(openState(), evt)
    );
    expect(b.outcome.reason_code).toBe(a.outcome.reason_code);
    expect(b.outcome.disposition).toBe(a.outcome.disposition);
    expect(neutralLifecycleFingerprint(b.state)).toBe(neutralLifecycleFingerprint(a.state));
  });

  it("records a satisfied gate outcome when the declared conditions are met", () => {
    const result = applyNeutralLifecycleEvent(openState(), toolBefore("t-gate-ok"));
    expect(result.outcome.disposition).toBe("succeeded");
    expect(result.state.gate_outcomes).toEqual({ "G-spec": "succeeded" });
  });

  it("refuses a gate event that names no declared gate", () => {
    const result = applyNeutralLifecycleEvent(
      openState(),
      toolBefore("t-no-gate", { gate_id: undefined })
    );
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("gate_unsatisfied");
    expect(result.state_changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MH-02-R1-B01 — the lifecycle path and the admission evaluator are ONE decision
// ---------------------------------------------------------------------------

describe("MH-02-R1-B01 lifecycle admission cannot diverge from evaluateNeutralAdmission", () => {
  /** The reviewer's exact probe: deny by policy, then assert a satisfied gate. */
  it("refuses a policy-denied operation even when the caller asserts gate_condition=satisfied", () => {
    const before = openState();
    const result = applyNeutralLifecycleEvent(
      before,
      toolBefore("t-deny", { operation: "forbidden-write", gate_condition: "satisfied" })
    );
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("policy_denied");
    expect(result.outcome.type).toBe("guild.policy_outcome.v1");
    expect(result.state.gate_outcomes).toEqual({});
    expect(result.state_changed).toBe(false);
    expect(result.outcome.facts.caller_supplied_verdict_ignored).toBe(true);
    expect(neutralLifecycleFingerprint(result.state)).toBe(neutralLifecycleFingerprint(before));
  });

  /**
   * The invariant behind the probe, stated directly: for every request shape,
   * the lifecycle disposition and reason code equal the admission evaluator's.
   */
  it.each([
    ["absent capability", { required_capability: "tool.missing" }, "unsupported", "capability_absent"],
    ["unauthenticated capability", { required_capability: "tool.unauthenticated" }, "failed", "authentication_failed"],
    ["policy denial", { operation: "forbidden-write" }, "refused", "policy_denied"],
    ["missing approval", { operation: "approval-write" }, "refused", "approval_required"],
    ["unmet gate condition", { satisfied_conditions: [] }, "refused", "gate_unsatisfied"],
    ["admissible", {}, "succeeded", null],
  ])("keeps %s distinct and identical on both paths", (_label, patch, disposition, reason) => {
    const state = openState();
    const evt = toolBefore("t-probe", patch as Record<string, unknown>);

    const direct = evaluateNeutralAdmission({
      request: {
        operation_id: evt.transition_id,
        operation: (evt.input.operation as string) ?? "",
        required_capability: (evt.input.required_capability as string) ?? "",
        operation_class: "mutating",
        satisfied_conditions: (evt.input.satisfied_conditions as string[]) ?? [],
        approval_supplied: evt.input.approval_supplied === true,
      },
      snapshot: admissionContext().snapshot,
      policy: admissionContext().policy,
      gate: admissionContext().gates[0],
    });

    const viaLifecycle = applyNeutralLifecycleEvent(state, evt);

    expect(direct.disposition).toBe(disposition);
    expect(direct.reason_code).toBe(reason);
    // The two paths agree — that is the whole point of the finding.
    expect(viaLifecycle.outcome.disposition).toBe(direct.disposition);
    expect(viaLifecycle.outcome.reason_code).toBe(direct.reason_code);
    expect(viaLifecycle.outcome.type).toBe(direct.type);
    // A non-succeeded admission records no gate outcome.
    expect(viaLifecycle.state.gate_outcomes).toEqual(
      disposition === "succeeded" ? { "G-spec": "succeeded" } : {}
    );
  });

  it("fails closed when the run declares no admission context", () => {
    const state = openState({ admission_context: undefined });
    const result = applyNeutralLifecycleEvent(
      state,
      toolBefore("t-nocontext", { gate_condition: "satisfied" })
    );
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("admission_context_missing");
    expect(result.state.gate_outcomes).toEqual({});
  });

  it("keeps EXECUTION failure distinct from refusal and blocks the close it would otherwise ride", () => {
    const admitted = applyNeutralLifecycleEvent(openState(), toolBefore("t-gate-ok")).state;
    expect(admitted.gate_outcomes).toEqual({ "G-spec": "succeeded" });

    const failed = applyNeutralLifecycleEvent(
      admitted,
      event({
        name: "tool.after",
        transition_id: "t-exec",
        input: { gate_id: "G-spec", execution_status: "failed" },
      })
    );
    expect(failed.outcome.disposition).toBe("failed");
    expect(failed.outcome.reason_code).toBe("execution_failed");
    expect(failed.state.gate_outcomes).toEqual({ "G-spec": "failed" });

    const observed = applyNeutralLifecycleEvent(
      failed.state,
      event({
        name: "receipt.append",
        transition_id: "t-obs",
        input: { observation: "scope_diff", observation_state: "checked_clean" },
      })
    ).state;
    const closed = applyNeutralLifecycleEvent(
      observed,
      event({ name: "run.stop", transition_id: "t-stop", input: { requested_terminal_state: "completed" } })
    );
    expect(closed.outcome.disposition).toBe("refused");
    expect(closed.outcome.reason_code).toBe("required_gate_outcome_missing");
    expect(closed.state.status).toBe("open");
  });

  it("refuses an execution result for a gate that was never admitted", () => {
    const result = applyNeutralLifecycleEvent(
      openState(),
      event({
        name: "tool.after",
        transition_id: "t-exec-orphan",
        input: { gate_id: "G-spec", execution_status: "succeeded" },
      })
    );
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("required_gate_outcome_missing");
  });
});

// ---------------------------------------------------------------------------
// MHRC-LIF-003 — compaction and resume preserve lifecycle identity
// ---------------------------------------------------------------------------

describe("MHRC-LIF-003 compaction and resume", () => {
  const sequence: NeutralLifecycleEvent[] = [
    event({ transition_id: "t-phase", input: { semantic_intent: "enter_phase", phase: "build" } }),
    event({ name: "context.compact", transition_id: "t-compact", input: {} }),
    event({ name: "run.resume", transition_id: "t-resume", input: {} }),
  ];

  it("keeps run_id and snapshot hash unchanged and resumes from the last durable state", () => {
    const before = openState();
    const results = applyNeutralLifecycleEvents(before, sequence);
    const final = results[results.length - 1].state;
    expect(results.every((r) => r.outcome.disposition === "succeeded")).toBe(true);
    expect(final.run_id).toBe(before.run_id);
    expect(final.capability_snapshot_hash).toBe(before.capability_snapshot_hash);
    expect(final.phase).toBe("build");
    expect(final.status).toBe("open");
  });

  it("advances the checkpoint sequence monotonically across compact and resume", () => {
    const results = applyNeutralLifecycleEvents(openState(), sequence);
    const sequences = results.map((r) => r.state.checkpoint_sequence);
    expect(sequences).toEqual([0, 1, 2]);
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]).toBeGreaterThanOrEqual(sequences[i - 1]);
    }
  });

  it("does not repeat an already-applied transition on replay", () => {
    const results = applyNeutralLifecycleEvents(openState(), sequence);
    const afterFirstPass = results[results.length - 1].state;
    const replay = applyNeutralLifecycleEvents(afterFirstPass, sequence);

    for (const step of replay) {
      expect(step.outcome.disposition).toBe("succeeded");
      expect(step.state_changed).toBe(false);
      expect(step.outcome.facts.idempotent_replay).toBe(true);
    }
    const afterReplay = replay[replay.length - 1].state;
    expect(neutralLifecycleFingerprint(afterReplay)).toBe(
      neutralLifecycleFingerprint(afterFirstPass)
    );
    expect(afterReplay.checkpoint_sequence).toBe(afterFirstPass.checkpoint_sequence);
    expect(afterReplay.applied_transitions).toEqual(["t-phase", "t-compact", "t-resume"]);
  });

  it("reaches an identical fingerprint on both hosts across the whole sequence", () => {
    const fingerprints = [0, 1].map((hostIndex) => {
      const evts = sequence.map((base) => hostVariants(base)[hostIndex]);
      const results = applyNeutralLifecycleEvents(openState(), evts);
      return neutralLifecycleFingerprint(results[results.length - 1].state);
    });
    expect(fingerprints[1]).toBe(fingerprints[0]);
  });

  it("refuses a snapshot mutation attempt during resume", () => {
    const results = applyNeutralLifecycleEvents(openState(), sequence.slice(0, 2));
    const durable = results[results.length - 1].state;
    const result = applyNeutralLifecycleEvent(
      durable,
      event({
        name: "run.resume",
        transition_id: "t-resume-bad",
        capability_snapshot_hash: "nfp1:aaaaaaaaaaaaaaaa",
        input: {},
      })
    );
    expect(result.outcome.reason_code).toBe("capability_snapshot_mismatch");
    expect(neutralLifecycleFingerprint(result.state)).toBe(neutralLifecycleFingerprint(durable));
  });
});

// ---------------------------------------------------------------------------
// MHRC-LIF-004 — run close requires equivalent terminal evidence
// ---------------------------------------------------------------------------

describe("MHRC-LIF-004 run close", () => {
  const closeEvent = event({
    name: "run.stop",
    transition_id: "t-stop",
    input: { requested_terminal_state: "completed" },
  });

  function readyToClose(): NeutralLifecycleState {
    const gated = applyNeutralLifecycleEvent(
      openState(),
      toolBefore("t-gate-ok")
    ).state;
    return applyNeutralLifecycleEvent(
      gated,
      event({
        name: "receipt.append",
        transition_id: "t-obs",
        input: { observation: "scope_diff", observation_state: "checked_clean" },
      })
    ).state;
  }

  it("completes when every required gate outcome and observation is present and clean", () => {
    const result = applyNeutralLifecycleEvent(readyToClose(), closeEvent);
    expect(result.outcome.disposition).toBe("succeeded");
    expect(result.state.status).toBe("completed");
    expect(result.outcome.facts.terminal_state).toBe("completed");
  });

  it("refuses completion when a required observation was never observed (BR-07)", () => {
    const gated = applyNeutralLifecycleEvent(
      openState(),
      toolBefore("t-gate-ok")
    ).state;
    const result = applyNeutralLifecycleEvent(gated, closeEvent);
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("required_observation_missing");
    expect(result.outcome.facts.missing_observations).toEqual(["scope_diff"]);
    expect(result.state.status).toBe("open");
  });

  it("refuses completion when a required observation failed", () => {
    const gated = applyNeutralLifecycleEvent(
      openState(),
      toolBefore("t-gate-ok")
    ).state;
    const observed = applyNeutralLifecycleEvent(
      gated,
      event({
        name: "receipt.append",
        transition_id: "t-obs-bad",
        input: { observation: "scope_diff", observation_state: "observation_failed" },
      })
    ).state;
    const result = applyNeutralLifecycleEvent(observed, closeEvent);
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("required_observation_failed");
    expect(result.outcome.facts.failed_observations).toEqual(["scope_diff"]);
    expect(result.state.status).toBe("open");
  });

  it("refuses completion when a required gate has no typed outcome", () => {
    const observed = applyNeutralLifecycleEvent(
      openState(),
      event({
        name: "receipt.append",
        transition_id: "t-obs",
        input: { observation: "scope_diff", observation_state: "checked_clean" },
      })
    ).state;
    const result = applyNeutralLifecycleEvent(observed, closeEvent);
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("required_gate_outcome_missing");
    expect(result.outcome.facts.missing_gate_ids).toEqual(["G-spec"]);
    expect(result.state.status).toBe("open");
  });

  it("accepts not_applicable ONLY under a declared typed rule bound to that observation", () => {
    const gated = applyNeutralLifecycleEvent(openState(), toolBefore("t-gate-ok")).state;
    const recorded = applyNeutralLifecycleEvent(
      gated,
      event({
        name: "receipt.append",
        transition_id: "t-obs-na",
        input: {
          observation: "scope_diff",
          observation_state: "not_applicable",
          not_applicable_rule_id: NA_RULE.rule_id,
        },
      })
    );
    expect(recorded.outcome.disposition).toBe("succeeded");
    expect(recorded.state.observations.scope_diff).toEqual({
      state: "not_applicable",
      not_applicable_rule_id: NA_RULE.rule_id,
    });
    expect(recorded.outcome.facts.not_applicable_rationale).toBe(NA_RULE.rationale);
    expect(applyNeutralLifecycleEvent(recorded.state, closeEvent).state.status).toBe("completed");
  });

  it("aborts on an explicitly requested aborted terminal state without evidence gating", () => {
    const result = applyNeutralLifecycleEvent(
      openState(),
      event({
        name: "run.stop",
        transition_id: "t-abort",
        input: { requested_terminal_state: "aborted" },
      })
    );
    expect(result.outcome.disposition).toBe("succeeded");
    expect(result.state.status).toBe("aborted");
  });

  it("refuses further events once the run reached a terminal state", () => {
    const closed = applyNeutralLifecycleEvent(readyToClose(), closeEvent).state;
    const result = applyNeutralLifecycleEvent(
      closed,
      event({ transition_id: "t-late", input: { semantic_intent: "enter_phase", phase: "ops" } })
    );
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("run_already_closed");
    expect(result.state_changed).toBe(false);
  });

  it("reaches the same terminal state and refusal set on both hosts", () => {
    const [a, b] = hostVariants(closeEvent).map((evt) =>
      applyNeutralLifecycleEvent(readyToClose(), evt)
    );
    expect(b.state.status).toBe(a.state.status);
    expect(neutralLifecycleFingerprint(b.state)).toBe(neutralLifecycleFingerprint(a.state));

    const [c, d] = hostVariants(closeEvent).map((evt) =>
      applyNeutralLifecycleEvent(openState(), evt)
    );
    expect(d.outcome.reason_code).toBe(c.outcome.reason_code);
    expect(d.state.status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// MH-02-R1-B02 — an unsubstantiated not_applicable must fail closed
// ---------------------------------------------------------------------------

describe("MH-02-R1-B02 not_applicable requires an explicit typed rule", () => {
  const closeEvent = event({
    name: "run.stop",
    transition_id: "t-stop",
    input: { requested_terminal_state: "completed" },
  });

  function admitted(): NeutralLifecycleState {
    return applyNeutralLifecycleEvent(openState(), toolBefore("t-gate-ok")).state;
  }

  function recordNotApplicable(input: Record<string, unknown>) {
    return applyNeutralLifecycleEvent(
      admitted(),
      event({
        name: "receipt.append",
        transition_id: "t-obs-na",
        input: { observation: "scope_diff", observation_state: "not_applicable", ...input },
      })
    );
  }

  /** The reviewer's exact probe: a bare not_applicable, then a successful close. */
  it("refuses a bare not_applicable and cannot then close the run", () => {
    const recorded = recordNotApplicable({});
    expect(recorded.outcome.disposition).toBe("refused");
    expect(recorded.outcome.reason_code).toBe("not_applicable_rule_missing");
    expect(recorded.state_changed).toBe(false);
    expect(recorded.state.observations).toEqual({});

    const closed = applyNeutralLifecycleEvent(recorded.state, closeEvent);
    expect(closed.outcome.disposition).toBe("refused");
    expect(closed.outcome.reason_code).toBe("required_observation_missing");
    expect(closed.state.status).toBe("open");
  });

  it("refuses a rule id that no declared rule matches", () => {
    const recorded = recordNotApplicable({ not_applicable_rule_id: "NA-INVENTED" });
    expect(recorded.outcome.reason_code).toBe("not_applicable_rule_unknown");
    expect(recorded.state.observations).toEqual({});
  });

  it("refuses a declared rule bound to a DIFFERENT observation", () => {
    const state = neutralInitialLifecycleState({
      run_id: "run-mh02-1",
      capability_snapshot_hash: SNAPSHOT_HASH,
      phase: "init",
      required_gate_ids: [],
      required_observations: ["scope_diff"],
      admission_context: admissionContext(),
      not_applicable_rules: [
        { rule_id: "NA-OTHER", applies_to_observation: "some_other_check", rationale: "unrelated" },
      ],
    });
    const recorded = applyNeutralLifecycleEvent(
      state,
      event({
        name: "receipt.append",
        transition_id: "t-obs-na",
        input: {
          observation: "scope_diff",
          observation_state: "not_applicable",
          not_applicable_rule_id: "NA-OTHER",
        },
      })
    );
    expect(recorded.outcome.reason_code).toBe("not_applicable_rule_mismatch");
    expect(recorded.state.observations).toEqual({});
  });

  it("refuses a rule id attached to any state other than not_applicable", () => {
    const recorded = applyNeutralLifecycleEvent(
      admitted(),
      event({
        name: "receipt.append",
        transition_id: "t-obs-clean",
        input: {
          observation: "scope_diff",
          observation_state: "checked_clean",
          not_applicable_rule_id: NA_RULE.rule_id,
        },
      })
    );
    expect(recorded.outcome.reason_code).toBe("not_applicable_rule_mismatch");
  });

  /**
   * Defence in depth: even a state assembled by some other route — a restored
   * checkpoint, a hand-built fixture — cannot close on an unruled inapplicability.
   */
  it("re-validates the rule binding at the close sentinel itself", () => {
    const gated = admitted();
    const forged = {
      ...gated,
      observations: { scope_diff: { state: "not_applicable", not_applicable_rule_id: null } },
    } as unknown as NeutralLifecycleState;
    const closed = applyNeutralLifecycleEvent(forged, closeEvent);
    expect(closed.outcome.disposition).toBe("refused");
    expect(closed.outcome.reason_code).toBe("not_applicable_rule_missing");
    expect(closed.state.status).toBe("open");
  });

  it("re-validates a rule that was revoked from the registry after recording", () => {
    const gated = admitted();
    const forged = {
      ...gated,
      observations: { scope_diff: { state: "not_applicable", not_applicable_rule_id: NA_RULE.rule_id } },
      not_applicable_rules: [],
    } as unknown as NeutralLifecycleState;
    const closed = applyNeutralLifecycleEvent(forged, closeEvent);
    expect(closed.outcome.reason_code).toBe("not_applicable_rule_unknown");
    expect(closed.state.status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// Purity — no hidden inputs, no mutation of the caller's state
// ---------------------------------------------------------------------------

describe("purity of the transition function", () => {
  it("returns byte-identical results for repeated identical calls", () => {
    const a = applyNeutralLifecycleEvent(openState(), event());
    const b = applyNeutralLifecycleEvent(openState(), event());
    expect(neutralCanonical(a)).toBe(neutralCanonical(b));
  });

  it("never mutates the input state", () => {
    const before = openState();
    const snapshotBefore = neutralLifecycleFingerprint(before);
    applyNeutralLifecycleEvent(before, event());
    applyNeutralLifecycleEvent(before, event({ name: "run.stop", input: {} }));
    expect(neutralLifecycleFingerprint(before)).toBe(snapshotBefore);
  });

  it("freezes every returned state", () => {
    const result = applyNeutralLifecycleEvent(openState(), event());
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.applied_transitions)).toBe(true);
    expect(Object.isFrozen(result.outcome)).toBe(true);
  });
});

function neutralCanonical(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.keys(val as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, key) => {
            acc[key] = (val as Record<string, unknown>)[key];
            return acc;
          }, {})
      : val
  );
}
