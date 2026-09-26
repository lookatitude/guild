/**
 * The T0/T1/T2 bus contract (KTD19).
 *
 * This lives in the kernel rather than in `dispatch` for one reason: the rule has
 * to be enforced where the messages actually pass, and that is the communication
 * domain's artifact bus. `dispatch` already depends on `communication`, so a bus
 * that imported the rule from `dispatch` would close a cycle. Both domains depend
 * on the kernel, so the rule sits here and each imports it.
 *
 * The bus is DIRECTED. A specialist reports to its own Team Lead and to nothing
 * else; a Team Lead reports to the orchestrator and carries only a status
 * envelope. Those two edges are the entire upward surface. Everything else — a
 * specialist reaching the orchestrator, a specialist reaching a sibling, a lead
 * forwarding a receipt upward — is a DEFECT, refused here, not discouraged in a
 * prompt somewhere a model can ignore.
 */
import { deepFreeze, frozenList } from "./sealed-collections";

export const BUS_TIERS = frozenList(["T0", "T1", "T2"] as const);
export type BusTier = (typeof BUS_TIERS)[number];

export interface BusMessage {
  from_tier: BusTier;
  to_tier: BusTier;
  /** Instance/cell id of the sender; the lead's binding id when `from_tier` is T1. */
  from_id: string;
  to_id: string;
  /** The envelope the sender is carrying. */
  envelope: string;
}

export type BusDefect =
  | "specialist_addressed_orchestrator"
  | "specialist_addressed_sibling"
  | "wrong_envelope"
  | "unauthenticated_publisher"
  | "tier_spoofed";

export type BusVerdict = { ok: true } | { ok: false; defect: BusDefect; reason: string };

/** Narrowing predicate for the refusal arm (the repo's test transform is non-strict). */
export function busRefused(verdict: BusVerdict): verdict is Extract<BusVerdict, { ok: false }> {
  return !verdict.ok;
}

/** The two legal upward edges, and the one envelope each may carry. */
export function checkBusMessage(msg: BusMessage): BusVerdict {
  if (msg.from_tier === "T2" && msg.to_tier === "T0") {
    return {
      ok: false,
      defect: "specialist_addressed_orchestrator",
      reason:
        `specialist ${msg.from_id} addressed the orchestrator directly — ` +
        `structural isolation defect (KTD19). A specialist reports only to its ` +
        `Team Lead, as guild.handoff.v2.`,
    };
  }
  if (msg.from_tier === "T2" && msg.to_tier === "T2") {
    return {
      ok: false,
      defect: "specialist_addressed_sibling",
      reason:
        `specialist ${msg.from_id} addressed specialist ${msg.to_id} — specialists ` +
        `never message each other (KTD19); shared results cross as accepted ` +
        `artifacts through the lead.`,
    };
  }
  if (msg.from_tier === "T2" && msg.to_tier === "T1" && msg.envelope !== "guild.handoff.v2") {
    return {
      ok: false,
      defect: "wrong_envelope",
      reason: `T2 → T1 carries guild.handoff.v2, not ${msg.envelope}`,
    };
  }
  if (msg.from_tier === "T1" && msg.to_tier === "T0" && msg.envelope !== "guild.goal_status.v1") {
    return {
      ok: false,
      defect: "wrong_envelope",
      reason:
        `T1 → T0 carries guild.goal_status.v1, not ${msg.envelope} — a receipt, ` +
        `transcript, or assignment must not cross the orchestrator boundary (R33).`,
    };
  }
  return { ok: true };
}

/**
 * Roles that speak as T1 or above.
 *
 * A small closed list, not "anything that is not a known specialist": the default
 * for an unrecognised role must be the LEAST authority, so a role id nobody wired
 * up is treated as a worker rather than silently granted a lead's reach.
 */
export const LEAD_ROLE_IDS = frozenList(["team-lead", "lead", "orchestrator"] as const);

export function busTierForRole(role: string): BusTier {
  return (LEAD_ROLE_IDS as readonly string[]).includes(role) ? "T1" : "T2";
}

/**
 * Which tier a bus topic addresses. Topics are `<type>/<scope>/<resource>`:
 *
 *  - `status/…` is the roll-up channel the orchestrator reads → T0.
 *  - `handoff/…` is the worker's report to its lead → T1.
 *
 * `context`, `review`, `approval` and `heartbeat` are intra-cell plumbing, not
 * addressed upward edges, so they are not gated.
 */
export function busTierForTopic(topic: string): BusTier | null {
  const type = topic.split("/")[0];
  if (type === "status") return "T0";
  if (type === "handoff") return "T1";
  return null;
}

// ── Authentication ───────────────────────────────────────────────────────────

/**
 * WHO a publisher claims to be. Never a tier — a tier is derived, not asserted.
 *
 * Round 2 found the gate reading `tier` straight off the payload, so anything
 * that could publish could also declare itself a Team Lead. The two identities
 * below are the only ones the runtime actually issues:
 *
 *  - `attempt` — a worker instance, proved by its own attempt record on disk.
 *    Worker instances are T2 by construction; there is no attempt record that
 *    belongs to a lead.
 *  - `runtime` — the machinery writing a cell's records, proved by the run's
 *    minted `binding_ref`. That value is created by `mintRunBinding` and lives
 *    on the run record; it is the private-bus identity the runtime holds.
 */
export type BusIdentity =
  | { kind: "attempt"; logical_task_id: string; attempt: number; instance_id: string }
  | { kind: "runtime"; binding_ref: string };

/** Durable facts the caller read for this identity. Absent ⇒ unproven. */
export interface BusIdentityFacts {
  /** `instance_id` named by the attempt record the identity points at. */
  attempt_instance_id?: string | null;
  /** The run's minted `binding_ref`, read from the run binding record. */
  run_binding_ref?: string | null;
}

export type BusAuthResult =
  | { ok: true; tier: BusTier; subject: string }
  | { ok: false; reason: string };

/** Narrowing predicate for the refusal arm (the repo's test transform is non-strict). */
export function busAuthFailed(
  result: BusAuthResult,
): result is Extract<BusAuthResult, { ok: false }> {
  return !result.ok;
}

/**
 * Resolve a tier from durable state. Pure: the caller does the reads, this holds
 * the rule, so the rule is testable without a filesystem and the reads happen
 * where the run directory is already known.
 */
export function authenticateBusTier(
  identity: BusIdentity,
  facts: BusIdentityFacts,
): BusAuthResult {
  if (identity.kind === "attempt") {
    const recorded = facts.attempt_instance_id;
    if (typeof recorded !== "string" || recorded.length === 0) {
      return {
        ok: false,
        reason:
          `no attempt record for ${identity.logical_task_id} attempt ${identity.attempt} ` +
          `instance ${identity.instance_id} — an unproven publisher has no tier`,
      };
    }
    if (recorded !== identity.instance_id) {
      return {
        ok: false,
        reason:
          `attempt record names instance ${recorded}, not ${identity.instance_id} — ` +
          `identity mismatch`,
      };
    }
    // A worker instance is T2. There is no attempt record for a lead: a lead is a
    // binding on the cell, never an instance of its own (TaskCell D3/decision 2).
    return { ok: true, tier: "T2", subject: identity.instance_id };
  }
  const minted = facts.run_binding_ref;
  if (typeof minted !== "string" || minted.length === 0) {
    return { ok: false, reason: "no minted run binding on this run — runtime identity unprovable" };
  }
  if (minted !== identity.binding_ref) {
    return { ok: false, reason: "binding_ref does not match this run's minted binding" };
  }
  return { ok: true, tier: "T1", subject: "runtime" };
}

/**
 * The gate the artifact bus calls on every publish.
 *
 * A specialist publishing to a `status/` topic IS "a specialist addressed the
 * orchestrator", and this is where that stops being advisory.
 *
 * On a gated topic the tier MUST come from `authenticated`. An unauthenticated
 * publisher is refused, and a payload that declares a tier different from the
 * authenticated one is a defect in its own right — reported as `tier_spoofed`
 * rather than quietly corrected, because a component asserting a tier it does
 * not hold is a bug someone needs to see.
 */
export function checkBusPublish(input: {
  topic: string;
  publisher: { role: string; tier?: BusTier };
  /** The envelope schema, when the publisher names one. */
  envelope?: string;
  /** The result of `authenticateBusTier`. Required for a gated topic. */
  authenticated?: BusAuthResult;
}): BusVerdict {
  const toTier = busTierForTopic(input.topic);
  if (toTier === null) return { ok: true };
  const auth = input.authenticated;
  if (!auth) {
    return {
      ok: false,
      defect: "unauthenticated_publisher",
      reason:
        `publish to the gated topic ${input.topic} carries no runtime-issued ` +
        `identity — the tier must be proved from the attempt record or the run ` +
        `binding, never taken from the payload (KTD19).`,
    };
  }
  if (busAuthFailed(auth)) {
    return { ok: false, defect: "unauthenticated_publisher", reason: auth.reason };
  }
  if (input.publisher.tier !== undefined && input.publisher.tier !== auth.tier) {
    return {
      ok: false,
      defect: "tier_spoofed",
      reason:
        `publisher declared tier ${input.publisher.tier} but the authenticated ` +
        `identity (${auth.subject}) is ${auth.tier} — refusing the publish and ` +
        `recording the mismatch.`,
    };
  }
  return checkBusMessage({
    from_tier: auth.tier,
    to_tier: toTier,
    from_id: auth.subject,
    to_id: toTier === "T0" ? "orchestrator" : "team-lead",
    envelope: input.envelope ?? (toTier === "T0" ? "guild.goal_status.v1" : "guild.handoff.v2"),
  });
}

export const TIER_BUS_CONTRACT = deepFreeze({
  tiers: BUS_TIERS,
  upward_envelopes: { T2: "guild.handoff.v2", T1: "guild.goal_status.v1" },
  lead_roles: LEAD_ROLE_IDS,
  tier_source: "the attempt record on disk, or the run's minted binding_ref — never the payload",
});
