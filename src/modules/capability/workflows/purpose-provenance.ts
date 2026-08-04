/**
 * src/modules/capability/workflows/purpose-provenance.ts
 *
 * Authoritative purpose provenance + transitive, non-downgradable floors
 * (guild.model_policy.v2 §2–§3; SC-5). Lanes T1b+T5.
 *
 * Purpose is resolved from an AUTHORITATIVE source before complexity:
 * registry/skill metadata `work_class`, a lane locked to a work class, or an
 * explicit review-broker gate binding. Work that should carry authoritative
 * purpose metadata but lacks it FAILS CLOSED with `purpose_unbound` — it is
 * never silently treated as general work.
 *
 * Provenance is transitive: nested delegation, child lanes, retries,
 * resumptions, advisor calls, and generic sub-dispatches inherit the effective
 * purpose + floors. Descendants may RAISE a floor, never lower or erase an
 * inherited one (floors compose by max()). Every overridden caller/child label
 * is recorded in `rejected_labels`, never silently eaten.
 *
 * CONTRACT: pure. No I/O, no clock.
 */

import {
  COMPLEXITIES,
  POLICY_PURPOSES,
  isReviewClassPurpose,
  maxComplexity,
  purposeComplexityFloor,
  purposeTierFloor,
  tierForComplexity,
  type PolicyComplexity,
  type PolicyPurpose,
  type PolicyTier,
} from "./model-policy";

// ── Event vocabulary (dispatch-tree shapes, plan lane c5) ────────────────────

/** Sources accepted as AUTHORITATIVE purpose bindings (model_policy §2). */
export const AUTHORITATIVE_PURPOSE_SOURCES = Object.freeze([
  "skill_metadata",
  "registry_metadata",
  "lane_lock",
  "broker_gate",
] as const);

export interface DispatchTreeEvent {
  /** dispatch | delegate | retry | resume | advisor_call | sub_dispatch */
  kind: string;
  /** Root events: the authoritative metadata source. */
  source?: string;
  /** Root events: authoritative work_class (e.g. "research", "general"). */
  work_class?: string;
  /** Broker-gate root events bind a review purpose explicitly. */
  purpose?: string;
  /** Root events may carry an authoritative requested complexity. */
  complexity?: string;
  /** Descendant caller/child label — NEVER authoritative; recorded if overridden. */
  caller_label?: Record<string, unknown>;
  /** Descendants may RAISE a floor (never lower). */
  raises_floor?: string;
  /** sub_dispatch: a declared (non-authoritative) purpose label. */
  declared_purpose?: string;
  [k: string]: unknown;
}

export interface RejectedLabel {
  source: string;
  label: string;
  reason: string;
}

export interface EffectivePurposeResolution {
  purpose: PolicyPurpose;
  requested_complexity: PolicyComplexity;
  effective_complexity: PolicyComplexity;
  tier: PolicyTier;
  forced_floor_reason: string | null;
  /** Root authoritative source (model_resolution §1 request.purpose_origin). */
  purpose_origin: string;
  /** Transitive chain of events walked to reach this resolution. */
  dispatch_ancestry: string[];
  /** Every caller/child label overridden by floors — never silently eaten. */
  rejected_labels: RejectedLabel[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isComplexity(v: unknown): v is PolicyComplexity {
  return (COMPLEXITIES as readonly string[]).includes(v as string);
}

/** Map an authoritative work_class to the closed purpose enum. */
function purposeForWorkClass(workClass: string): PolicyPurpose | null {
  return (POLICY_PURPOSES as readonly string[]).includes(workClass)
    ? (workClass as PolicyPurpose)
    : null;
}

const COMPLEXITY_RANK: Record<PolicyComplexity, number> = { easy: 0, medium: 1, hard: 2 };

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve the effective purpose + floors for a dispatch chain. Throws
 * `purpose_unbound` (fail closed) when the root event carries no authoritative
 * purpose binding — missing metadata is NEVER treated as general work.
 */
export function resolveEffectivePurpose(input: {
  events: DispatchTreeEvent[];
}): EffectivePurposeResolution {
  const events = input?.events;
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("purpose_unbound: empty dispatch chain — no authoritative purpose metadata");
  }

  // Root binding (authoritative source required).
  const root = events[0];
  if (root.kind !== "dispatch") {
    throw new Error(
      `purpose_unbound: chain root must be an authoritative dispatch (got kind "${root.kind}")`
    );
  }
  const source = typeof root.source === "string" ? root.source : "";
  if (!(AUTHORITATIVE_PURPOSE_SOURCES as readonly string[]).includes(source)) {
    throw new Error(
      `purpose_unbound: dispatch source "${source || "<absent>"}" is not an authoritative purpose source ` +
        `(${AUTHORITATIVE_PURPOSE_SOURCES.join(", ")}) — refusing to default to general work`
    );
  }
  const boundLabel =
    typeof root.work_class === "string"
      ? root.work_class
      : typeof root.purpose === "string"
        ? root.purpose
        : null;
  if (boundLabel === null) {
    throw new Error(
      `purpose_unbound: authoritative source "${source}" carries no work_class/purpose binding`
    );
  }
  const purpose = purposeForWorkClass(boundLabel);
  if (purpose === null) {
    throw new Error(
      `purpose_unbound: work_class "${boundLabel}" is outside the closed purpose enum — fail closed`
    );
  }
  const requested: PolicyComplexity = isComplexity(root.complexity) ? root.complexity : "easy";

  // Floors compose by max(); nothing composes downward.
  let floor: PolicyComplexity = maxComplexity(requested, purposeComplexityFloor(purpose));
  const rejected: RejectedLabel[] = [];
  const ancestry: string[] = [`dispatch:0:${source}`];

  for (let i = 1; i < events.length; i++) {
    const ev = events[i];
    ancestry.push(`${ev.kind}:${i}`);

    // Descendants may RAISE a floor, never lower one.
    if (isComplexity(ev.raises_floor)) {
      floor = maxComplexity(floor, ev.raises_floor);
    }

    // A declared purpose on a sub-dispatch is a caller label, not authority.
    if (typeof ev.declared_purpose === "string" && ev.declared_purpose !== purpose) {
      rejected.push({
        source: `${ev.kind}:${i}`,
        label: `purpose=${ev.declared_purpose}`,
        reason: "inherited_purpose_non_downgradable",
      });
    }

    const label = ev.caller_label;
    if (label && typeof label === "object") {
      const labelPurpose = (label as Record<string, unknown>)["purpose"];
      if (typeof labelPurpose === "string" && labelPurpose !== purpose) {
        rejected.push({
          source: `${ev.kind}:${i}`,
          label: `purpose=${labelPurpose}`,
          reason: "inherited_purpose_non_downgradable",
        });
      }
      const labelComplexity = (label as Record<string, unknown>)["complexity"];
      if (isComplexity(labelComplexity)) {
        if (COMPLEXITY_RANK[labelComplexity] < COMPLEXITY_RANK[floor]) {
          rejected.push({
            source: `${ev.kind}:${i}`,
            label: `complexity=${labelComplexity}`,
            reason: "floor_non_downgradable",
          });
        } else {
          // A label may RAISE the floor (max composition).
          floor = maxComplexity(floor, labelComplexity);
        }
      }
    }
  }

  const effective = floor;
  const tierFloor = purposeTierFloor(purpose);
  const tier: PolicyTier =
    tierFloor === "powerful" ? "powerful" : tierForComplexity(effective);

  const forcedFloorReason =
    purpose === "research"
      ? "research_always_hard"
      : isReviewClassPurpose(purpose)
        ? "purpose_floor_powerful"
        : null;

  return {
    purpose,
    requested_complexity: requested,
    effective_complexity: effective,
    tier,
    forced_floor_reason: forcedFloorReason,
    purpose_origin: source,
    dispatch_ancestry: ancestry,
    rejected_labels: rejected,
  };
}
