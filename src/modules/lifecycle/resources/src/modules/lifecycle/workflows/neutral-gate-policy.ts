/**
 * src/modules/lifecycle/workflows/neutral-gate-policy.ts
 *
 * Host-neutral gate, capability, and policy evaluation.
 *
 * MH-02 / W1 of `multi-host-runtime-convergence`. Boundary: `host-neutral-core`.
 * Per the MH-01A capability taxonomy, every capability id has an ADAPTER owner
 * (who produces the fact) and a CORE decision boundary (who decides what the
 * fact means). This file is that decision boundary and nothing else — it
 * discovers no host, parses no native event, and executes nothing.
 *
 * The one thing this file exists to keep apart, per scenario MHRC-UNS-002:
 *
 *   unsupported  the capability is ABSENT from the immutable snapshot
 *                → guild.capability_outcome.v1 / capability_absent
 *   failed       the capability EXISTS but could not be trusted (e.g. auth)
 *                → guild.capability_outcome.v1 / authentication_failed
 *   refused      the capability exists and works; POLICY said no
 *                → guild.policy_outcome.v1 / policy_denied | approval_required
 *   refused      the capability exists and policy allows; the GATE is unmet
 *                → guild.lifecycle_outcome.v1 / gate_unsatisfied
 *
 * Collapsing any of those four into one another is the defect this file forbids.
 * A silent fallback is never implied by an unsupported or failed result.
 *
 * Declared member of the import-closed neutral core: its only import is another
 * core member (`./neutral-runtime-contracts`). No Node builtins, so no I/O, no
 * clock, no host handle — every function here is a pure function of its
 * arguments, which is what makes MH-02 acceptance 4 hold.
 *
 * Pure library module; there is no CLI entrypoint.
 */

import {
  NEUTRAL_CONTRACT_VERSION,
  neutralFingerprint,
  neutralFreeze,
  neutralOutcome,
} from "./neutral-runtime-contracts";
import type {
  NeutralLifecyclePhase,
  NeutralOutcome,
  NeutralOutcomeBinding,
} from "./neutral-runtime-contracts";

// ---------------------------------------------------------------------------
// Immutable per-run capability snapshot (CI-03)
// ---------------------------------------------------------------------------

export type NeutralOperationClass = "read_only" | "mutating";

/**
 * One capability fact. PRODUCED by a host adapter (MH-03) with evidence
 * timestamps; only ever CONSUMED here.
 */
export interface NeutralCapabilityFact {
  readonly capability_id: string;
  /** Whether the host exposes the capability at all. */
  readonly supported: boolean;
  /** Meaningful only when `supported` is true. */
  readonly authenticated: boolean;
}

export interface NeutralCapabilitySnapshotInput {
  readonly snapshot_hash: string;
  readonly host_id: string;
  readonly host_version: string;
  readonly capabilities: readonly NeutralCapabilityFact[];
}

export interface NeutralCapabilitySnapshot extends NeutralCapabilitySnapshotInput {
  readonly schema_version: "guild.host_capability_snapshot.v1";
}

/**
 * Accept an adapter-produced snapshot into the core and make it immutable. CI-03
 * requires exactly one snapshot per run; the lifecycle machine enforces the
 * "exactly one" half by binding a run to a single snapshot hash.
 */
export function freezeNeutralCapabilitySnapshot(
  input: NeutralCapabilitySnapshotInput
): NeutralCapabilitySnapshot {
  if (!input.snapshot_hash) throw new Error("capability snapshot requires a snapshot_hash");
  if (!input.host_id) throw new Error("capability snapshot requires a host_id");
  return neutralFreeze({
    schema_version: "guild.host_capability_snapshot.v1",
    snapshot_hash: input.snapshot_hash,
    host_id: input.host_id,
    host_version: input.host_version,
    capabilities: input.capabilities.map((fact) => ({
      capability_id: fact.capability_id,
      supported: fact.supported,
      authenticated: fact.authenticated,
    })),
  }) as NeutralCapabilitySnapshot;
}

/**
 * Fingerprint of the SEMANTIC capability facts only — host identity, host
 * version, and the carried `snapshot_hash` are excluded on purpose. Two
 * different hosts exposing the same capability facts therefore share this hash,
 * which is what lets MHRC-LIF-001/002 compare a host pair for equivalence
 * without comparing host-native fields.
 */
export function neutralCapabilitySnapshotHash(snapshot: NeutralCapabilitySnapshot): string {
  const semantic = snapshot.capabilities
    .map((fact) => ({
      capability_id: fact.capability_id,
      supported: fact.supported,
      authenticated: fact.authenticated,
    }))
    .sort((a, b) => (a.capability_id < b.capability_id ? -1 : a.capability_id > b.capability_id ? 1 : 0));
  return neutralFingerprint(semantic);
}

function findFact(
  snapshot: NeutralCapabilitySnapshot,
  capabilityId: string
): NeutralCapabilityFact | undefined {
  return snapshot.capabilities.find((fact) => fact.capability_id === capabilityId);
}

// ---------------------------------------------------------------------------
// Policy + gate declarations
// ---------------------------------------------------------------------------

/**
 * The policy inputs a refusal is bound to. `policy_version` is carried into every
 * refusal so a receipt can prove WHICH policy refused (MHRC-UNS-002 evidence).
 */
export interface NeutralPolicy {
  readonly policy_version: string;
  readonly denied_operations: readonly string[];
  readonly approval_required_operations: readonly string[];
}

/** A gate is data, not a host branch: an id, a phase, and required conditions. */
export interface NeutralGate {
  readonly gate_id: string;
  readonly phase: NeutralLifecyclePhase;
  readonly operation_class: NeutralOperationClass;
  readonly required_conditions: readonly string[];
}

export interface NeutralAdmissionRequest {
  readonly operation_id: string;
  /** Logical operation name; never a host-native command string. */
  readonly operation: string;
  readonly required_capability: string;
  readonly operation_class: NeutralOperationClass;
  readonly satisfied_conditions: readonly string[];
  readonly approval_supplied: boolean;
}

function bindingFor(
  request: NeutralAdmissionRequest,
  snapshot?: NeutralCapabilitySnapshot
): NeutralOutcomeBinding {
  return {
    operation_id: request.operation_id,
    host_id: snapshot?.host_id,
    host_version: snapshot?.host_version,
    capability_snapshot_hash: snapshot?.snapshot_hash,
    contract_version: NEUTRAL_CONTRACT_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Capability decision
// ---------------------------------------------------------------------------

/**
 * Decide what an immutable capability fact means for this request.
 *
 * An absent capability is `unsupported`; a present-but-unauthenticated one is
 * `failed`. They are NOT interchangeable: reporting an auth loss as
 * `unsupported` would let a caller believe the host can never do the thing, and
 * would invite exactly the silent fallback MHRC-UNS-003 prohibits.
 */
export function evaluateNeutralCapability(
  request: NeutralAdmissionRequest,
  snapshot: NeutralCapabilitySnapshot
): NeutralOutcome {
  const fact = findFact(snapshot, request.required_capability);
  const binding = bindingFor(request, snapshot);

  if (fact === undefined || !fact.supported) {
    return neutralOutcome({
      type: "guild.capability_outcome.v1",
      disposition: "unsupported",
      reason_code: "capability_absent",
      assertions: [
        "reason code and capability id are present",
        "no fallback is implied",
        "no side effect occurs",
      ],
      binding,
      facts: {
        capability_id: request.required_capability,
        capability_supported: false,
        capability_declared: fact !== undefined,
        fallback_implied: false,
        side_effect: false,
      },
    });
  }

  if (!fact.authenticated) {
    return neutralOutcome({
      type: "guild.capability_outcome.v1",
      disposition: "failed",
      reason_code: "authentication_failed",
      assertions: [
        "reason code identifies authentication failure",
        "the outcome is not reported as unsupported",
        "silent fallback is prohibited",
      ],
      binding,
      facts: {
        capability_id: request.required_capability,
        capability_supported: true,
        silent_fallback_permitted: false,
        side_effect: false,
      },
    });
  }

  return neutralOutcome({
    type: "guild.capability_outcome.v1",
    disposition: "succeeded",
    assertions: ["capability is present and authenticated"],
    binding,
    facts: {
      capability_id: request.required_capability,
      capability_supported: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Policy decision
// ---------------------------------------------------------------------------

/**
 * Decide whether policy permits the operation. A denial and an unmet approval
 * are distinct refusals: the first can never be satisfied by the caller, the
 * second can.
 */
export function evaluateNeutralPolicy(
  request: NeutralAdmissionRequest,
  policy: NeutralPolicy,
  snapshot?: NeutralCapabilitySnapshot
): NeutralOutcome {
  const binding = bindingFor(request, snapshot);
  const decisionInputs = {
    operation: request.operation,
    operation_class: request.operation_class,
    approval_supplied: request.approval_supplied,
  };

  if (policy.denied_operations.indexOf(request.operation) !== -1) {
    return neutralOutcome({
      type: "guild.policy_outcome.v1",
      disposition: "refused",
      reason_code: "policy_denied",
      assertions: [
        "reason code identifies policy denial",
        "no operation side effect occurs",
      ],
      binding,
      facts: {
        operation: request.operation,
        policy_version: policy.policy_version,
        decision_inputs: decisionInputs,
        side_effect: false,
      },
    });
  }

  if (
    policy.approval_required_operations.indexOf(request.operation) !== -1 &&
    !request.approval_supplied
  ) {
    return neutralOutcome({
      type: "guild.policy_outcome.v1",
      disposition: "refused",
      reason_code: "approval_required",
      assertions: [
        "reason code identifies a missing required approval",
        "no operation side effect occurs",
      ],
      binding,
      facts: {
        operation: request.operation,
        policy_version: policy.policy_version,
        decision_inputs: decisionInputs,
        side_effect: false,
      },
    });
  }

  return neutralOutcome({
    type: "guild.policy_outcome.v1",
    disposition: "succeeded",
    assertions: ["policy permits the requested operation"],
    binding,
    facts: {
      operation: request.operation,
      policy_version: policy.policy_version,
      decision_inputs: decisionInputs,
    },
  });
}

// ---------------------------------------------------------------------------
// Gate decision
// ---------------------------------------------------------------------------

/**
 * Decide whether a gate's required conditions hold. The unsatisfied set is
 * enumerated so a refusal is actionable rather than opaque, and is returned in
 * the gate's declared condition order so two hosts produce byte-identical facts.
 */
export function evaluateNeutralGate(
  gate: NeutralGate,
  request: NeutralAdmissionRequest,
  snapshot?: NeutralCapabilitySnapshot
): NeutralOutcome {
  const binding = bindingFor(request, snapshot);
  const unsatisfied = gate.required_conditions.filter(
    (condition) => request.satisfied_conditions.indexOf(condition) === -1
  );

  if (unsatisfied.length > 0) {
    return neutralOutcome({
      type: "guild.lifecycle_outcome.v1",
      disposition: "refused",
      reason_code: "gate_unsatisfied",
      assertions: [
        "the prior lifecycle state is preserved",
        "the same refusal reason code is returned for the same gate violation",
        "no tool side effect occurs",
      ],
      binding,
      facts: {
        gate_id: gate.gate_id,
        gate_phase: gate.phase,
        operation_class: request.operation_class,
        unsatisfied_conditions: unsatisfied,
        side_effect: false,
      },
    });
  }

  return neutralOutcome({
    type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    assertions: ["every required gate condition is satisfied"],
    binding,
    facts: {
      gate_id: gate.gate_id,
      gate_phase: gate.phase,
      operation_class: request.operation_class,
    },
  });
}

// ---------------------------------------------------------------------------
// Ordered admission
// ---------------------------------------------------------------------------

export interface NeutralAdmissionInput {
  readonly request: NeutralAdmissionRequest;
  readonly snapshot: NeutralCapabilitySnapshot;
  readonly policy: NeutralPolicy;
  readonly gate: NeutralGate;
}

/**
 * Compose the three decisions in the only order that keeps their meanings
 * distinct: capability truth, then policy, then gate conditions.
 *
 * The order is load-bearing. Evaluating policy first would report a
 * host that CANNOT do something as a host that MAY NOT do it, destroying the
 * MHRC-UNS-002 distinction. Evaluating the gate first would refuse on a
 * condition the host could never have satisfied.
 *
 * When policy refuses, the returned facts carry `capability_supported: true`,
 * because reaching the policy step is itself proof the capability check passed.
 */
export function evaluateNeutralAdmission(input: NeutralAdmissionInput): NeutralOutcome {
  const capability = evaluateNeutralCapability(input.request, input.snapshot);
  if (capability.disposition !== "succeeded") return capability;

  const policy = evaluateNeutralPolicy(input.request, input.policy, input.snapshot);
  if (policy.disposition !== "succeeded") {
    return neutralOutcome({
      type: policy.type,
      disposition: policy.disposition,
      reason_code: policy.reason_code,
      assertions: [...policy.assertions, "capability remains supported"],
      binding: policy.binding,
      facts: { ...policy.facts, capability_supported: true },
    });
  }

  return evaluateNeutralGate(input.gate, input.request, input.snapshot);
}
