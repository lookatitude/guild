/**
 * __tests__/neutral-runtime-contracts.test.ts
 *
 * MH-02 (multi-host-runtime-convergence, W1) — host-neutral typed contract and
 * gate-policy core.
 *
 * HERMETIC BY CONSTRUCTION (MH-02-R2-B04)
 *   This suite reads NOTHING outside the plugin repository — no file, no env,
 *   no absolute path. It has no imports from `fs` or `path` at all.
 *
 *   Round 2 pinned the vocabulary assertions to two frozen contract artifacts in
 *   an umbrella worktree, addressed by absolute path. Those assertions passed
 *   only on the machine where that private worktree existed: plugin CI checks
 *   out the plugin repository alone and then runs the whole `scripts` Jest
 *   project, so a clean clone or a GitHub runner could not execute the suite at
 *   all. A test that cannot run in the gate that requires it is not evidence.
 *
 *   The reconciled vocabulary is DECLARED natively in
 *   `neutral-runtime-contracts.ts` and PINNED here by canonical fingerprint plus
 *   a field-by-field expectation, so any drift in the plugin's own copy fails
 *   this suite immediately. Cross-repository equality against the two frozen W0
 *   artifacts remains a real requirement — it is verified at the umbrella/run
 *   level, where both repositories are actually present, and recorded in the
 *   MH-02 handoff receipt. It is deliberately NOT a plugin-CI dependency and
 *   never a source import.
 *
 * Contract authorities this file mirrors (by declaration, never by reading):
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
  NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2,
  NEUTRAL_LIFECYCLE_PHASES,
  NEUTRAL_NORMALIZED_EVENT_VOCABULARY,
  NEUTRAL_OBSERVATION_STATES,
  NEUTRAL_OUTCOME_TYPES,
  NEUTRAL_REASON_CODES,
  NEUTRAL_SUPERSEDED_EVENT_NAMES_V1,
  NEUTRAL_SUPPORT_STATES,
  NEUTRAL_SUPPORT_STATUS_VALUES,
  isNeutralCleanObservation,
  isNeutralDisposition,
  isNeutralEventName,
  isNeutralLifecyclePhase,
  isNeutralReasonCode,
  mapLegacyNeutralEventName,
  neutralCanonicalDigest,
  neutralCanonicalJson,
  neutralFingerprint,
  neutralOutcome,
  neutralSha256Hex,
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
    // The SUPERSEDED guild.normalized_event.v1 spelling is not in the normative
    // vocabulary. It is not silently accepted, and it is not merely unknown
    // either — see the compatibility suite below (MH-02-R1-B05).
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

  it("declares one distinct reason code per round-2 fail-closed invariant", () => {
    // Each of these names exactly which forgery or unprovable claim was caught.
    // Collapsing any pair would re-create the ambiguity the findings were about.
    for (const code of [
      // MH-02-R2-B01 — the run-bound and evaluated snapshots must be one
      "admission_context_snapshot_mismatch",
      // MH-02-R2-B02 — closure unproven is not closure proven
      "boundary_unresolved_edge",
      "boundary_ambiguous_source",
      // MH-02-R2-B03 — nominal metadata is not evidence
      "scenario_reason_code_unrecognized",
      "scenario_receipt_reference_ambiguous",
      "scenario_contract_version_unrecognized",
      "scenario_runtime_version_unrecognized",
    ]) {
      expect(NEUTRAL_REASON_CODES).toContain(code as never);
      expect(isNeutralReasonCode(code)).toBe(true);
    }
    // A missing context and a divergent one stay different answers.
    expect(NEUTRAL_REASON_CODES).toContain("admission_context_missing");
    // A proven breach and an unprovable one stay different answers.
    expect(NEUTRAL_REASON_CODES).toContain("boundary_forbidden_edge");
    expect(NEUTRAL_REASON_CODES).toContain("boundary_unclassified_edge");
    expect(isNeutralReasonCode("invented_reason")).toBe(false);
  });

  it("declares one distinct reason code per round-3 fail-closed invariant", () => {
    for (const code of [
      // MH-02-R3-B01 — module edges were never the only way out of the core. A
      // call the scan cannot name and an ambient binding the core never declared
      // are different findings and stay different answers.
      "boundary_indirect_callee",
      "boundary_ambient_capability",
      // MH-02-R3-B02 — a bundle checked only against itself proves nothing. Each
      // code names exactly which part of the source binding was absent or forged.
      "scenario_evidence_authority_missing",
      "scenario_identity_binding_mismatch",
      "scenario_source_identity_unrecognized",
      "scenario_host_identity_unrecognized",
      "scenario_receipt_binding_unverified",
    ]) {
      expect(NEUTRAL_REASON_CODES).toContain(code as never);
      expect(isNeutralReasonCode(code)).toBe(true);
    }
    // "the identity is unrecognized" and "the identity is recognized but is not
    // the authority's" are different answers, and collapsing them would hide the
    // difference between a fabricated release and a reused one.
    expect(NEUTRAL_REASON_CODES).toContain("scenario_runtime_binding_mismatch");
    // Shape and BINDING stay separate: round 3 had only the first.
    expect(NEUTRAL_REASON_CODES).toContain("scenario_receipt_reference_missing");
  });

  it("declares one distinct reason code per round-4 fail-closed invariant", () => {
    for (const code of [
      // MH-02-R4-B01 — recognizing a call SHAPE is not recognizing a capability.
      // Where a capability ENTERS and where it is later USED are different
      // findings: the first names the mechanism, the second names the alias, and
      // collapsing them would hide which hop of a chain to fix.
      "boundary_capability_reach",
      "boundary_capability_alias",
      // MH-02-R4-B02 — an authority that NAMES a journal does not carry one. Each
      // code names exactly which half of "independently authoritative" was absent:
      // the durable record itself, the parties who observed it, or the separation
      // between those parties and the one asking to be promoted.
      "scenario_journal_chain_unverified",
      "scenario_journal_attestation_insufficient",
      "scenario_claimant_not_independent",
    ]) {
      expect(NEUTRAL_REASON_CODES).toContain(code as never);
      expect(isNeutralReasonCode(code)).toBe(true);
    }
    // A reach and an indirect callee stay different answers: round 4 had only the
    // second, and that is precisely why an aliased computed loader passed.
    expect(NEUTRAL_REASON_CODES).toContain("boundary_indirect_callee");
    // "the journal does not verify" and "a receipt does not resolve into it" stay
    // separate: one is about the authority, the other about the claim.
    expect(NEUTRAL_REASON_CODES).toContain("scenario_receipt_binding_unverified");
  });
});

// ---------------------------------------------------------------------------
// MH-02-R1-B05 — one normative event vocabulary, declared natively and PINNED
//
// MH-02-R2-B04: these assertions used to read two umbrella artifacts by
// absolute path. They now pin the plugin's OWN declared block by canonical
// fingerprint plus a field-by-field expectation. Cross-repository equality is an
// umbrella/run-level verification (see this file's header) — never a machine
// path, never a source import.
// ---------------------------------------------------------------------------

describe("MH-02-R1-B05 normalized event vocabulary reconciliation", () => {
  /**
   * The canonical fingerprint of the agreed shared block, pinned as a literal.
   *
   * This is the strongest hermetic form available: `neutralFingerprint` is a
   * pure function of the canonical JSON, so ANY change to ANY field of
   * `NEUTRAL_NORMALIZED_EVENT_VOCABULARY` — a renamed key, a reordered array, a
   * dropped rule — changes this value and fails here. It is the same value the
   * run-level cross-repository check computes over both frozen W0 artifacts.
   */
  const PINNED_VOCABULARY_FINGERPRINT = "nfp1:490c8ca92a1c7b43";
  const PINNED_CANONICAL_LENGTH = 2089;

  it("needs no file, path, or environment input to run", () => {
    // Guards the fix itself: if a future edit re-introduces a filesystem read,
    // this suite must stop claiming to be hermetic. `require` is resolved
    // lazily so the assertion is about THIS module's imports.
    expect(Object.keys(module.exports)).toEqual([]);
    expect(typeof NEUTRAL_NORMALIZED_EVENT_VOCABULARY).toBe("object");
  });

  it("pins the agreed shared block by canonical fingerprint", () => {
    expect(neutralFingerprint(NEUTRAL_NORMALIZED_EVENT_VOCABULARY)).toBe(
      PINNED_VOCABULARY_FINGERPRINT
    );
    expect(neutralCanonicalJson(NEUTRAL_NORMALIZED_EVENT_VOCABULARY)).toHaveLength(
      PINNED_CANONICAL_LENGTH
    );
  });

  it("declares guild.normalized_event.v2 normative and names its owners", () => {
    const block = NEUTRAL_NORMALIZED_EVENT_VOCABULARY as unknown as Record<string, any>;
    expect(block.block_id).toBe("guild.normalized_event_vocabulary.v1");
    expect(block.normative_version).toBe("guild.normalized_event.v2");
    expect(block.reconciles).toBe("MH-02-R1-B05");
    expect(block.vocabulary_owner).toBe("host-neutral-core");
    expect(block.native_mapping_owner).toBe("host-adapters");
    expect(block.transport_fact_owner).toBe("execution-transports");
    expect(block.consumer).toBe("host-neutral-core");
  });

  it("carries the 19-name normative list and the superseded v1 list in one block", () => {
    const block = NEUTRAL_NORMALIZED_EVENT_VOCABULARY as unknown as Record<string, any>;
    expect(block.normative_event_names).toEqual([...NEUTRAL_EVENT_NAMES]);
    expect(block.normative_event_names).toHaveLength(19);
    expect(block.superseded_versions).toEqual([
      {
        version: "guild.normalized_event.v1",
        status: "superseded",
        superseded_by: "guild.normalized_event.v2",
        event_types: [...NEUTRAL_SUPERSEDED_EVENT_NAMES_V1],
      },
    ]);
  });

  it("records the superseded v1 list exactly as the boundary contract used to carry it", () => {
    expect([...NEUTRAL_SUPERSEDED_EVENT_NAMES_V1]).toEqual([
      "session.start",
      "session.resume",
      "prompt.submit",
      "tool.pre",
      "tool.post",
      "context.compact",
      "task.transition",
      "session.stop",
    ]);
  });

  it("declares the mapping PARTIAL rather than pretending it is lossless", () => {
    const compat = (NEUTRAL_NORMALIZED_EVENT_VOCABULARY as unknown as Record<string, any>)
      .compatibility;
    expect(compat.mapping_totality).toBe("partial");
    expect(compat.policy).toBe("explicit_typed_mapping");
    // Every refusal path is declared, so no legacy name can be silently mapped.
    expect(compat.superseded_disposition).toBe("refused");
    expect(compat.superseded_reason_code).toBe("event_vocabulary_superseded");
    expect(compat.ambiguous_disposition).toBe("refused");
    expect(compat.ambiguous_reason_code).toBe("event_vocabulary_ambiguous");
    expect(compat.unmapped_disposition).toBe("refused");
    expect(compat.unmapped_reason_code).toBe("unknown_event");
    const ambiguous = compat.rules.filter((rule: any) => rule.kind === "ambiguous_split");
    expect(ambiguous).toEqual([
      {
        from: "task.transition",
        to: null,
        kind: "ambiguous_split",
        candidates: ["task.dispatch", "task.collect"],
      },
    ]);
  });

  it("gives every superseded v1 name exactly one declared compatibility rule", () => {
    const rules = (NEUTRAL_NORMALIZED_EVENT_VOCABULARY as unknown as Record<string, any>)
      .compatibility.rules;
    expect(rules.map((rule: any) => rule.from).sort()).toEqual(
      [...NEUTRAL_SUPERSEDED_EVENT_NAMES_V1].sort()
    );
    for (const rule of rules) {
      if (rule.kind === "ambiguous_split") {
        expect(rule.to).toBeNull();
        expect(rule.candidates.length).toBeGreaterThan(1);
      } else {
        expect(NEUTRAL_EVENT_NAMES).toContain(rule.to as never);
        expect(rule.candidates).toEqual([]);
      }
    }
  });

  it("maps every unchanged and renamed v1 name to exactly one normative name", () => {
    for (const [legacy, normative] of [
      ["session.resume", "run.resume"],
      ["tool.pre", "tool.before"],
      ["tool.post", "tool.after"],
      ["session.stop", "run.stop"],
    ]) {
      const outcome = mapLegacyNeutralEventName(legacy);
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("event_vocabulary_superseded");
      expect(outcome.facts.normative_event_name).toBe(normative);
      expect(NEUTRAL_EVENT_NAMES).toContain(normative as never);
    }
  });

  it("accepts a name that is already normative instead of calling it superseded", () => {
    for (const name of ["session.start", "prompt.submit", "context.compact", "tool.before"]) {
      const outcome = mapLegacyNeutralEventName(name);
      expect(outcome.disposition).toBe("succeeded");
      expect(outcome.facts.normative_event_name).toBe(name);
    }
  });

  it("REFUSES task.transition as ambiguous rather than guessing a replacement", () => {
    const outcome = mapLegacyNeutralEventName("task.transition");
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("event_vocabulary_ambiguous");
    expect(outcome.facts.normative_event_name).toBeNull();
    expect(outcome.facts.candidates).toEqual(["task.dispatch", "task.collect"]);
  });

  it("refuses a name in neither vocabulary as simply unknown", () => {
    const outcome = mapLegacyNeutralEventName("session.teleport");
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("unknown_event");
    expect(outcome.facts.in_normative_vocabulary).toBe(false);
  });

  it("names the ten v2 events that have no v1 preimage at all", () => {
    expect([...NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2]).toEqual([
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
    expect(
      (NEUTRAL_NORMALIZED_EVENT_VOCABULARY as unknown as Record<string, any>).compatibility
        .introduced_in_v2
    ).toEqual([...NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2]);
  });

  it("derives introduced_in_v2 rather than restating it, so the two cannot drift", () => {
    // Every normative name is either introduced in v2 or reachable from a v1
    // rule (as its image or as an ambiguous candidate). No name is both.
    const rules = (NEUTRAL_NORMALIZED_EVENT_VOCABULARY as unknown as Record<string, any>)
      .compatibility.rules;
    const reachableFromV1 = new Set<string>();
    for (const rule of rules) {
      if (rule.to !== null) reachableFromV1.add(rule.to);
      for (const candidate of rule.candidates) reachableFromV1.add(candidate);
    }
    const introduced = new Set(NEUTRAL_EVENT_NAMES_INTRODUCED_IN_V2);
    for (const name of NEUTRAL_EVENT_NAMES) {
      expect(introduced.has(name) !== reachableFromV1.has(name)).toBe(true);
    }
    expect(introduced.size + reachableFromV1.size).toBe(NEUTRAL_EVENT_NAMES.length);
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
// MH-02-R5-B01 — a real digest, computed rather than imported
//
// The conformance decision's trust root verifies signatures, and a signature is
// only as strong as the digest it commits to. `neutralFingerprint` is a 64-bit
// FNV-1a: correct for comparing two values the core produced, useless when an
// adversary picks the input. `neutralSha256Hex` is FIPS 180-4 SHA-256 written
// out natively — no import, so core closure is untouched — and these vectors are
// what stop a transcription slip in the round constants from shipping as a
// working hash.
// ---------------------------------------------------------------------------

describe("MH-02-R5-B01 neutralSha256Hex", () => {
  it("matches the published SHA-256 vectors", () => {
    expect(neutralSha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(neutralSha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    expect(neutralSha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
    expect(
      neutralSha256Hex(
        "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu"
      )
    ).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
    // The one-million-'a' vector: 15625 compression blocks, so a schedule or
    // state-carry bug that survives a one-block input cannot survive this.
    expect(neutralSha256Hex("a".repeat(1000000))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
    );
  });

  it("pads correctly at every block boundary", () => {
    // 55/56 and 63/64 are where the length field forces an extra block. A wrong
    // padding branch is invisible on short inputs and wrong on exactly these.
    expect(neutralSha256Hex("a".repeat(55))).toBe(
      "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318"
    );
    expect(neutralSha256Hex("a".repeat(56))).toBe(
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a"
    );
    expect(neutralSha256Hex("a".repeat(63))).toBe(
      "7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34"
    );
    expect(neutralSha256Hex("a".repeat(64))).toBe(
      "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb"
    );
    expect(neutralSha256Hex("a".repeat(65))).toBe(
      "635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0"
    );
  });

  it("hashes the UTF-8 encoding, including non-ASCII and surrogate pairs", () => {
    // Two-byte, and a four-byte astral character carried as a surrogate pair.
    expect(neutralSha256Hex("é")).toBe(
      "4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c"
    );
    expect(neutralSha256Hex("𝄞")).toBe(
      "e419efd3d6046adf7662b0daadab65047e8014a523316d7ccc8710de694aa9b6"
    );
  });

  it("is a fixed-width lowercase hex digest that separates near-identical inputs", () => {
    expect(neutralSha256Hex("x")).toMatch(/^[0-9a-f]{64}$/);
    expect(neutralSha256Hex("a")).not.toBe(neutralSha256Hex("b"));
    expect(neutralSha256Hex("ab")).not.toBe(neutralSha256Hex("ba"));
    expect(neutralSha256Hex("a")).toBe(neutralSha256Hex("a"));
  });

  it("digests the CANONICAL form, so key order cannot change the commitment", () => {
    expect(neutralCanonicalDigest({ b: 1, a: 2 })).toBe(neutralCanonicalDigest({ a: 2, b: 1 }));
    expect(neutralCanonicalDigest({ a: 1 })).not.toBe(neutralCanonicalDigest({ a: 2 }));
    expect(neutralCanonicalDigest({ a: 1 })).toBe(neutralSha256Hex('{"a":1}'));
    expect(neutralCanonicalDigest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is strictly stronger than the fingerprint it does NOT replace", () => {
    // Both remain exported: the fingerprint stays the right tool for equality
    // between values the core produced, and it is NOT collision-resistant. The
    // separation is the point — the digest is what an adversary-chosen input is
    // committed with.
    expect(neutralFingerprint({ a: 1 })).toMatch(/^nfp1:[0-9a-f]{16}$/);
    expect(neutralCanonicalDigest({ a: 1 }).length).toBe(64);
    expect(neutralCanonicalDigest({ a: 1 }).length).toBeGreaterThan(
      neutralFingerprint({ a: 1 }).length
    );
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
