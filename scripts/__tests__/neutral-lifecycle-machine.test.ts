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

// ---------------------------------------------------------------------------
// Literal fixtures
// ---------------------------------------------------------------------------

const SNAPSHOT_HASH = "nfp1:0123456789abcdef";

function openState(overrides: Partial<Parameters<typeof neutralInitialLifecycleState>[0]> = {}) {
  return neutralInitialLifecycleState({
    run_id: "run-mh02-1",
    capability_snapshot_hash: SNAPSHOT_HASH,
    phase: "init",
    required_gate_ids: ["G-spec"],
    required_observations: ["scope_diff"],
    ...overrides,
  });
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
    const result = applyNeutralLifecycleEvent(openState(), event({ name: "tool.pre" as never }));
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("unknown_event");
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
  const violation = event({
    name: "tool.before",
    transition_id: "t-gate",
    input: { gate_id: "G-spec", operation_class: "mutating", gate_condition: "unsatisfied" },
  });

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
  });

  it("returns the same refusal reason code on both hosts", () => {
    const [a, b] = hostVariants(violation).map((evt) =>
      applyNeutralLifecycleEvent(openState(), evt)
    );
    expect(b.outcome.reason_code).toBe(a.outcome.reason_code);
    expect(b.outcome.disposition).toBe(a.outcome.disposition);
    expect(neutralLifecycleFingerprint(b.state)).toBe(neutralLifecycleFingerprint(a.state));
  });

  it("records a satisfied gate outcome when the gate condition holds", () => {
    const result = applyNeutralLifecycleEvent(
      openState(),
      event({
        name: "tool.before",
        transition_id: "t-gate-ok",
        input: { gate_id: "G-spec", operation_class: "mutating", gate_condition: "satisfied" },
      })
    );
    expect(result.outcome.disposition).toBe("succeeded");
    expect(result.state.gate_outcomes).toEqual({ "G-spec": "succeeded" });
  });

  it("refuses a gate event that names no gate", () => {
    const result = applyNeutralLifecycleEvent(
      openState(),
      event({ name: "tool.before", input: { gate_condition: "satisfied" } })
    );
    expect(result.outcome.disposition).toBe("refused");
    expect(result.outcome.reason_code).toBe("gate_unsatisfied");
    expect(result.state_changed).toBe(false);
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
      event({
        name: "tool.before",
        transition_id: "t-gate-ok",
        input: { gate_id: "G-spec", gate_condition: "satisfied" },
      })
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
      event({
        name: "tool.before",
        transition_id: "t-gate-ok",
        input: { gate_id: "G-spec", gate_condition: "satisfied" },
      })
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
      event({
        name: "tool.before",
        transition_id: "t-gate-ok",
        input: { gate_id: "G-spec", gate_condition: "satisfied" },
      })
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

  it("accepts not_applicable as a close-eligible observation state", () => {
    const gated = applyNeutralLifecycleEvent(
      openState(),
      event({
        name: "tool.before",
        transition_id: "t-gate-ok",
        input: { gate_id: "G-spec", gate_condition: "satisfied" },
      })
    ).state;
    const observed = applyNeutralLifecycleEvent(
      gated,
      event({
        name: "receipt.append",
        transition_id: "t-obs-na",
        input: { observation: "scope_diff", observation_state: "not_applicable" },
      })
    ).state;
    expect(applyNeutralLifecycleEvent(observed, closeEvent).state.status).toBe("completed");
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
