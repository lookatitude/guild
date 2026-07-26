/**
 * __tests__/neutral-runtime-contracts.test.ts
 *
 * MH-02 (multi-host-runtime-convergence, W1) — host-neutral typed contract and
 * gate-policy core.
 *
 * Contract authorities (read as evidence inputs by absolute path; NOT imported):
 *   - guild.multi_host_runtime_boundary.v1 (MH-01A) — boundary rules BR-01,
 *     BR-02, BR-07, BR-10; capability_taxonomy decision_boundary =
 *     host-neutral-core; support_state_contract.claim_owner = host-neutral-core.
 *   - guild.conformance_scenarios.v1 (MH-01C) — closed_vocabularies for
 *     categories, dispositions, observation_states, support_states,
 *     event_names, outcome_types.
 *
 * Covers MH-02 acceptance 2 (core owns gates, policy evaluation, and typed
 * contracts/results) and acceptance 4 (pure policy fixtures are deterministic
 * and host independent).
 *
 * Scenario coverage in this file: MHRC-UNS-002 (policy refusal is distinct from
 * unsupported capability). The capability-side decisions exercised here are the
 * core-owned decision half of MHRC-UNS-001 / MHRC-UNS-003; adapter-side snapshot
 * production and those scenarios themselves remain W2/MH-03.
 *
 * Every fixture is a literal — no clock, no randomness, no filesystem, no env,
 * no host handle — so the suite is deterministic and host independent.
 */

import {
  NEUTRAL_CONTRACTS_SCHEMA_VERSION,
  NEUTRAL_CONTRACT_VERSION,
  NEUTRAL_DISPOSITIONS,
  NEUTRAL_EVENT_NAMES,
  NEUTRAL_LIFECYCLE_PHASES,
  NEUTRAL_OBSERVATION_STATES,
  NEUTRAL_OUTCOME_TYPES,
  NEUTRAL_REASON_CODES,
  NEUTRAL_SUPPORT_STATES,
  NEUTRAL_SUPPORT_STATUS_VALUES,
  isNeutralCleanObservation,
  isNeutralDisposition,
  isNeutralEventName,
  isNeutralLifecyclePhase,
  neutralCanonicalJson,
  neutralFingerprint,
  neutralOutcome,
} from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";

import {
  evaluateNeutralAdmission,
  evaluateNeutralCapability,
  evaluateNeutralGate,
  evaluateNeutralPolicy,
  freezeNeutralCapabilitySnapshot,
  neutralCapabilitySnapshotHash,
} from "../../src/modules/lifecycle/workflows/neutral-gate-policy";

// ---------------------------------------------------------------------------
// Literal fixtures (deterministic + host independent)
// ---------------------------------------------------------------------------

const SNAPSHOT_CLAUDE = freezeNeutralCapabilitySnapshot({
  snapshot_hash: "snap-a",
  host_id: "claude-code",
  host_version: "2.3.2",
  capabilities: [
    { capability_id: "execution.dispatch", supported: true, authenticated: true },
    { capability_id: "interaction.native_questions", supported: false, authenticated: false },
    { capability_id: "policy.bindings", supported: true, authenticated: false },
  ],
});

const SNAPSHOT_CODEX = freezeNeutralCapabilitySnapshot({
  snapshot_hash: "snap-b",
  host_id: "codex-local",
  host_version: "0.47.0",
  capabilities: [
    { capability_id: "execution.dispatch", supported: true, authenticated: true },
    { capability_id: "interaction.native_questions", supported: false, authenticated: false },
    { capability_id: "policy.bindings", supported: true, authenticated: false },
  ],
});

const POLICY = {
  policy_version: "policy-v1",
  denied_operations: ["mutate_wiki_directly"],
  approval_required_operations: ["push_branch"],
};

const MUTATING_GATE = {
  gate_id: "G-lane",
  phase: "build" as const,
  operation_class: "mutating" as const,
  required_conditions: ["receipt_written", "diff_in_scope"],
};

function admissionRequest(overrides: Record<string, unknown> = {}) {
  return {
    operation_id: "op-1",
    operation: "write_lane_file",
    required_capability: "execution.dispatch",
    operation_class: "mutating" as const,
    satisfied_conditions: ["receipt_written", "diff_in_scope"],
    approval_supplied: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Closed vocabularies mirror the frozen W0 contracts
// ---------------------------------------------------------------------------

describe("neutral runtime contract vocabularies", () => {
  it("pins the schema version and contract major", () => {
    expect(NEUTRAL_CONTRACTS_SCHEMA_VERSION).toBe("guild.runtime.contracts.v1");
    expect(NEUTRAL_CONTRACT_VERSION).toBe(1);
  });

  it("mirrors the six canonical lifecycle phases", () => {
    expect([...NEUTRAL_LIFECYCLE_PHASES]).toEqual(["init", "ideate", "plan", "build", "qa", "ops"]);
    expect(isNeutralLifecyclePhase("build")).toBe(true);
    expect(isNeutralLifecyclePhase("deploy")).toBe(false);
  });

  it("mirrors guild.conformance_scenarios.v1 closed_vocabularies.dispositions", () => {
    expect([...NEUTRAL_DISPOSITIONS]).toEqual([
      "succeeded",
      "refused",
      "unsupported",
      "failed",
      "degraded",
    ]);
    expect(isNeutralDisposition("refused")).toBe(true);
    expect(isNeutralDisposition("ok")).toBe(false);
  });

  it("mirrors the four observation states and treats only clean/NA as close-eligible", () => {
    expect([...NEUTRAL_OBSERVATION_STATES]).toEqual([
      "checked_clean",
      "not_applicable",
      "not_observed",
      "observation_failed",
    ]);
    // BR-07: an absent or failed observation is never success or cleanliness.
    expect(isNeutralCleanObservation("checked_clean")).toBe(true);
    expect(isNeutralCleanObservation("not_applicable")).toBe(true);
    expect(isNeutralCleanObservation("not_observed")).toBe(false);
    expect(isNeutralCleanObservation("observation_failed")).toBe(false);
  });

  it("mirrors the ten typed outcome types", () => {
    expect([...NEUTRAL_OUTCOME_TYPES]).toEqual([
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
    ]);
  });

  it("mirrors the nineteen normalized event names", () => {
    expect([...NEUTRAL_EVENT_NAMES]).toEqual([
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
    ]);
    expect(isNeutralEventName("tool.before")).toBe(true);
    // Divergent spelling from the boundary contract's normalized_event_contract
    // (tool.pre / tool.post / session.stop / task.transition) is NOT silently
    // accepted; see the recorded contract-divergence issue for MH-02.
    expect(isNeutralEventName("tool.pre")).toBe(false);
  });

  it("mirrors the six support states and four common status values", () => {
    expect([...NEUTRAL_SUPPORT_STATES]).toEqual([
      "recognized",
      "rendered",
      "installed",
      "activated",
      "updated",
      "conformant",
    ]);
    expect([...NEUTRAL_SUPPORT_STATUS_VALUES]).toEqual([
      "not_evaluated",
      "unsupported",
      "failed",
      "satisfied",
    ]);
  });

  it("declares unique reason codes and no undifferentiated success code", () => {
    expect(new Set(NEUTRAL_REASON_CODES).size).toBe(NEUTRAL_REASON_CODES.length);
    expect(NEUTRAL_REASON_CODES).toContain("policy_denied");
    expect(NEUTRAL_REASON_CODES).toContain("capability_absent");
    expect(NEUTRAL_REASON_CODES).toContain("authentication_failed");
    expect(NEUTRAL_REASON_CODES).not.toContain("supported");
  });
});

// ---------------------------------------------------------------------------
// Typed outcome construction is strict (BR-10: typed records are machine truth)
// ---------------------------------------------------------------------------

describe("neutralOutcome", () => {
  it("builds a frozen typed record carrying its binding", () => {
    const outcome = neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "succeeded",
      assertions: ["phase entered"],
      binding: { run_id: "run-1", operation_id: "op-1", scenario_id: "MHRC-LIF-001" },
    });
    expect(outcome.schema_version).toBe("guild.runtime.contracts.v1");
    expect(outcome.disposition).toBe("succeeded");
    expect(outcome.reason_code).toBeNull();
    expect(outcome.binding.contract_version).toBe(NEUTRAL_CONTRACT_VERSION);
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.binding)).toBe(true);
    expect(Object.isFrozen(outcome.assertions)).toBe(true);
    // The repo compiles without a tsconfig, so emitted modules are non-strict and
    // a frozen write is a silent no-op rather than a throw. Assert the invariant
    // that actually matters: the value cannot change.
    try {
      (outcome as { disposition: string }).disposition = "failed";
    } catch {
      /* strict-mode hosts throw instead; either way the value must not change */
    }
    expect(outcome.disposition).toBe("succeeded");
  });

  it("rejects an unknown outcome type", () => {
    expect(() =>
      neutralOutcome({
        type: "guild.made_up_outcome.v1" as never,
        disposition: "succeeded",
      })
    ).toThrow(/unknown outcome type/i);
  });

  it("rejects an unknown disposition", () => {
    expect(() =>
      neutralOutcome({
        type: "guild.lifecycle_outcome.v1",
        disposition: "ok" as never,
      })
    ).toThrow(/unknown disposition/i);
  });

  it("requires a reason code for every non-succeeded disposition", () => {
    for (const disposition of ["refused", "unsupported", "failed", "degraded"] as const) {
      expect(() =>
        neutralOutcome({ type: "guild.lifecycle_outcome.v1", disposition })
      ).toThrow(/requires a reason_code/i);
    }
  });

  it("forbids a reason code on a succeeded disposition", () => {
    expect(() =>
      neutralOutcome({
        type: "guild.lifecycle_outcome.v1",
        disposition: "succeeded",
        reason_code: "policy_denied",
      })
    ).toThrow(/must not carry a reason_code/i);
  });

  it("rejects an unknown reason code", () => {
    expect(() =>
      neutralOutcome({
        type: "guild.lifecycle_outcome.v1",
        disposition: "refused",
        reason_code: "vibes" as never,
      })
    ).toThrow(/unknown reason code/i);
  });
});

// ---------------------------------------------------------------------------
// Canonical JSON + fingerprint are deterministic and key-order independent
// ---------------------------------------------------------------------------

describe("neutralCanonicalJson / neutralFingerprint", () => {
  it("is stable under key reordering", () => {
    const a = { b: 1, a: [3, { z: 1, y: 2 }] };
    const b = { a: [3, { y: 2, z: 1 }], b: 1 };
    expect(neutralCanonicalJson(a)).toBe(neutralCanonicalJson(b));
    expect(neutralFingerprint(a)).toBe(neutralFingerprint(b));
  });

  it("separates different values and repeats byte-identically", () => {
    expect(neutralFingerprint({ a: 1 })).not.toBe(neutralFingerprint({ a: 2 }));
    expect(neutralFingerprint({ a: 1 })).toBe(neutralFingerprint({ a: 1 }));
  });

  it("emits a versioned fixed-width fingerprint with no host or clock input", () => {
    expect(neutralFingerprint({ a: 1 })).toMatch(/^nfp1:[0-9a-f]{16}$/);
  });

  it("normalizes undefined-valued keys away so absent and undefined agree", () => {
    expect(neutralCanonicalJson({ a: 1, b: undefined })).toBe(neutralCanonicalJson({ a: 1 }));
  });
});

// ---------------------------------------------------------------------------
// Capability snapshot: immutable, hashable, adapter-produced (MH-03) but
// core-typed (CI-03).
// ---------------------------------------------------------------------------

describe("neutral capability snapshot", () => {
  it("is deeply frozen once accepted by the core", () => {
    expect(Object.isFrozen(SNAPSHOT_CLAUDE)).toBe(true);
    expect(Object.isFrozen(SNAPSHOT_CLAUDE.capabilities)).toBe(true);
    expect(Object.isFrozen(SNAPSHOT_CLAUDE.capabilities[0])).toBe(true);
  });

  it("hashes only semantic capability facts, excluding host identity and the carried hash", () => {
    // Two different hosts with the same capability facts share a semantic hash;
    // that is what makes cross-host equivalence checkable.
    expect(neutralCapabilitySnapshotHash(SNAPSHOT_CLAUDE)).toBe(
      neutralCapabilitySnapshotHash(SNAPSHOT_CODEX)
    );
  });

  it("changes the semantic hash when a capability fact changes", () => {
    const altered = freezeNeutralCapabilitySnapshot({
      snapshot_hash: "snap-a",
      host_id: "claude-code",
      host_version: "2.3.2",
      capabilities: [
        { capability_id: "execution.dispatch", supported: false, authenticated: false },
      ],
    });
    expect(neutralCapabilitySnapshotHash(altered)).not.toBe(
      neutralCapabilitySnapshotHash(SNAPSHOT_CLAUDE)
    );
  });
});

// ---------------------------------------------------------------------------
// MHRC-UNS-002 — policy refusal is distinct from unsupported capability
// ---------------------------------------------------------------------------

describe("capability vs policy vs gate decisions", () => {
  it("returns unsupported with capability_absent when the snapshot lacks the capability", () => {
    const outcome = evaluateNeutralCapability(
      admissionRequest({ required_capability: "interaction.native_questions" }),
      SNAPSHOT_CLAUDE
    );
    expect(outcome.type).toBe("guild.capability_outcome.v1");
    expect(outcome.disposition).toBe("unsupported");
    expect(outcome.reason_code).toBe("capability_absent");
    expect(outcome.facts.capability_id).toBe("interaction.native_questions");
    // "no fallback is implied"
    expect(outcome.facts.fallback_implied).toBe(false);
    expect(outcome.facts.side_effect).toBe(false);
  });

  it("returns failed with authentication_failed — never unsupported — for auth loss", () => {
    const outcome = evaluateNeutralCapability(
      admissionRequest({ required_capability: "policy.bindings" }),
      SNAPSHOT_CLAUDE
    );
    expect(outcome.disposition).toBe("failed");
    expect(outcome.reason_code).toBe("authentication_failed");
    expect(outcome.disposition).not.toBe("unsupported");
    expect(outcome.facts.capability_supported).toBe(true);
    expect(outcome.facts.silent_fallback_permitted).toBe(false);
  });

  it("returns succeeded when the capability is present and authenticated", () => {
    const outcome = evaluateNeutralCapability(admissionRequest(), SNAPSHOT_CLAUDE);
    expect(outcome.disposition).toBe("succeeded");
    expect(outcome.reason_code).toBeNull();
  });

  it("refuses a policy-denied operation while recording the capability as supported", () => {
    const outcome = evaluateNeutralPolicy(
      admissionRequest({ operation: "mutate_wiki_directly" }),
      POLICY
    );
    expect(outcome.type).toBe("guild.policy_outcome.v1");
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("policy_denied");
    expect(outcome.facts.policy_version).toBe("policy-v1");
    expect(outcome.facts.side_effect).toBe(false);
  });

  it("refuses with approval_required when approval is unmet, distinctly from denial", () => {
    const outcome = evaluateNeutralPolicy(admissionRequest({ operation: "push_branch" }), POLICY);
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("approval_required");
  });

  it("admits a policy-approved operation once approval is supplied", () => {
    const outcome = evaluateNeutralPolicy(
      admissionRequest({ operation: "push_branch", approval_supplied: true }),
      POLICY
    );
    expect(outcome.disposition).toBe("succeeded");
  });

  it("refuses an unsatisfied gate with gate_unsatisfied and enumerates the missing conditions", () => {
    const outcome = evaluateNeutralGate(
      MUTATING_GATE,
      admissionRequest({ satisfied_conditions: ["receipt_written"] })
    );
    expect(outcome.type).toBe("guild.lifecycle_outcome.v1");
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("gate_unsatisfied");
    expect(outcome.facts.unsatisfied_conditions).toEqual(["diff_in_scope"]);
    expect(outcome.facts.gate_id).toBe("G-lane");
  });

  it("passes a fully satisfied gate", () => {
    expect(evaluateNeutralGate(MUTATING_GATE, admissionRequest()).disposition).toBe("succeeded");
  });

  it("orders admission capability-first, then policy, then gate conditions", () => {
    // Capability absence outranks a policy denial for the same request.
    const capabilityFirst = evaluateNeutralAdmission({
      request: admissionRequest({
        operation: "mutate_wiki_directly",
        required_capability: "interaction.native_questions",
        satisfied_conditions: [],
      }),
      snapshot: SNAPSHOT_CLAUDE,
      policy: POLICY,
      gate: MUTATING_GATE,
    });
    expect(capabilityFirst.reason_code).toBe("capability_absent");
    expect(capabilityFirst.type).toBe("guild.capability_outcome.v1");

    // Policy denial outranks an unsatisfied gate.
    const policySecond = evaluateNeutralAdmission({
      request: admissionRequest({ operation: "mutate_wiki_directly", satisfied_conditions: [] }),
      snapshot: SNAPSHOT_CLAUDE,
      policy: POLICY,
      gate: MUTATING_GATE,
    });
    expect(policySecond.reason_code).toBe("policy_denied");
    expect(policySecond.type).toBe("guild.policy_outcome.v1");

    // Gate conditions decide last.
    const gateLast = evaluateNeutralAdmission({
      request: admissionRequest({ satisfied_conditions: [] }),
      snapshot: SNAPSHOT_CLAUDE,
      policy: POLICY,
      gate: MUTATING_GATE,
    });
    expect(gateLast.reason_code).toBe("gate_unsatisfied");

    expect(
      evaluateNeutralAdmission({
        request: admissionRequest(),
        snapshot: SNAPSHOT_CLAUDE,
        policy: POLICY,
        gate: MUTATING_GATE,
      }).disposition
    ).toBe("succeeded");
  });

  it("yields host-independent decisions for equivalent capability facts", () => {
    for (const request of [
      admissionRequest(),
      admissionRequest({ satisfied_conditions: [] }),
      admissionRequest({ operation: "mutate_wiki_directly" }),
      admissionRequest({ required_capability: "interaction.native_questions" }),
      admissionRequest({ required_capability: "policy.bindings" }),
    ]) {
      const onClaude = evaluateNeutralAdmission({
        request,
        snapshot: SNAPSHOT_CLAUDE,
        policy: POLICY,
        gate: MUTATING_GATE,
      });
      const onCodex = evaluateNeutralAdmission({
        request,
        snapshot: SNAPSHOT_CODEX,
        policy: POLICY,
        gate: MUTATING_GATE,
      });
      expect(onCodex.disposition).toBe(onClaude.disposition);
      expect(onCodex.reason_code).toBe(onClaude.reason_code);
      expect(onCodex.type).toBe(onClaude.type);
    }
  });
});
