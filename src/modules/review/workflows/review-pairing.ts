import {
  adjudicateIndependence,
  type ReviewPartyFacts,
} from "../../capability";
import { getRegistryEntry, resolveRung, type HostId } from "../../host-runtime";
import {
  makePolicySkipProgress,
  makeReviewProgressEvent,
  type ReviewProgressContext,
  type ReviewProgressEvent,
} from "./review-progress";

export type ReviewPairingStatus = "selected" | "skipped" | "blocked";

/**
 * Host-identity trust for one side of a review pairing (model_resolution §7).
 * Only a handshake-evidenced "verified" identity may contribute to a strong
 * plan; a caller claim is "asserted". An absent/undefined value normalizes to
 * "asserted" (fail closed) — omission can never grant what assertion cannot.
 */
export type ReviewIdentityTrust = "verified" | "asserted";
export type ReviewLifecycleOutcome =
  | "succeeded"
  | "skipped"
  | "cancelled"
  | "reviewer_error"
  | "tool_error"
  | "no_output";

export interface ReviewPairingPlan {
  schema_version: "guild.review_pairing_plan.v1";
  author_host: HostId | string;
  reviewer_host: HostId | string | null;
  status: ReviewPairingStatus;
  independence: "strong" | "weak";
  reason: string;
  progress: ReviewProgressEvent[];
}

/**
 * Served-model evidence for one side of the pairing — the party's FINALIZED
 * resolution receipt facts (model_resolution §7a). Without this evidence for
 * BOTH sides a pairing can never be strong: §7a forbids provisional strong, so
 * host-family difference + verified host trust alone stays weak (pending).
 */
export interface ReviewServedEvidence {
  /** The finalized receipt's outcome.actual_model ("unknown" when unbound). */
  served_model: string;
  /** Catalog family of the SERVED model — never derived from the requested one. */
  served_model_family: string;
  /** True only when the party's resolution receipt is finalized (§8). */
  finalized: boolean;
  /** The finalized receipt's outcome.status. */
  status: string;
}

export interface PlanReviewPairingInput extends ReviewProgressContext {
  policyAllowsSkip: boolean;
  reviewerAvailable: boolean;
  outcome?: ReviewLifecycleOutcome;
  authorTrust?: ReviewIdentityTrust;
  reviewerTrust?: ReviewIdentityTrust;
  authorServed?: ReviewServedEvidence;
  reviewerServed?: ReviewServedEvidence;
}

function event(ctx: ReviewProgressContext, sequence: number, state: ReviewProgressEvent["state"], message: string): ReviewProgressEvent {
  return makeReviewProgressEvent({
    ...ctx,
    state,
    sequence,
    message,
    ...(state === "no_output" ? { errorCode: "reviewer_no_output" } : {}),
    ...(state === "reviewer_error" ? { errorCode: "reviewer_error" } : {}),
    ...(state === "tool_error" ? { errorCode: "review_tool_error" } : {}),
  });
}

export function progressForOutcome(ctx: ReviewProgressContext, outcome: ReviewLifecycleOutcome): ReviewProgressEvent[] {
  if (outcome === "skipped") {
    return [makePolicySkipProgress({ ...ctx, reason: "review skipped by policy" })];
  }

  const base = [
    event(ctx, 1, "launched", "reviewer process launched"),
    event(ctx, 2, "running", "reviewer process running"),
    event(ctx, 3, "heartbeat", "reviewer heartbeat observed"),
    event(ctx, 4, "activity", "reviewer activity observed"),
  ];
  if (outcome === "succeeded") return [...base, event(ctx, 5, "succeeded", "reviewer completed successfully")];
  if (outcome === "cancelled") return [...base, event(ctx, 5, "cancelled", "reviewer cancelled")];
  if (outcome === "reviewer_error") return [...base, event(ctx, 5, "reviewer_error", "reviewer returned an error")];
  if (outcome === "tool_error") return [...base, event(ctx, 5, "tool_error", "review launch/tooling failed")];
  return [
    event(ctx, 1, "launched", "reviewer process launched"),
    event(ctx, 2, "running", "reviewer process running"),
    event(ctx, 3, "heartbeat", "reviewer heartbeat observed"),
    event(ctx, 4, "no_output", "reviewer produced no output within the heartbeat window"),
    event(ctx, 5, "tool_error", "watchdog reported stale or missing reviewer output"),
  ];
}

export function progressScenariosForPair(ctx: ReviewProgressContext): Record<ReviewLifecycleOutcome, ReviewProgressEvent[]> {
  return {
    succeeded: progressForOutcome(ctx, "succeeded"),
    skipped: progressForOutcome(ctx, "skipped"),
    cancelled: progressForOutcome(ctx, "cancelled"),
    reviewer_error: progressForOutcome(ctx, "reviewer_error"),
    tool_error: progressForOutcome(ctx, "tool_error"),
    no_output: progressForOutcome(ctx, "no_output"),
  };
}

export function planReviewPairing(input: PlanReviewPairingInput): ReviewPairingPlan {
  const author = getRegistryEntry(input.authorHost);
  const reviewer = getRegistryEntry(input.reviewerHost);
  const crossFamily = Boolean(author && reviewer && author.family !== reviewer.family);
  // model_resolution section 7-7a: the verdict comes from the ONE deterministic
  // truth table (adjudicateIndependence), never a pairing-local shortcut.
  // Registry rows are asserted identity; strong requires VERIFIED host trust on
  // both sides, differing host families, AND differing model families derived
  // from the SERVED (actual) models of finalized receipts. Section 7a forbids
  // provisional strong: absent served-model evidence the pairing is weak
  // (adjudication pending), whatever the hosts and trust say.
  const toFacts = (
    entry: { family?: string } | null | undefined,
    trust: ReviewIdentityTrust | undefined,
    served: ReviewServedEvidence | undefined
  ): ReviewPartyFacts => ({
    host_family: entry?.family ?? "unknown",
    host_trust: trust ?? "asserted",
    served_model: served?.served_model ?? "unknown",
    served_model_family: served?.served_model_family ?? "unknown",
    finalized: served?.finalized === true,
    status: served?.status ?? "unresolved",
  });
  const verdict = adjudicateIndependence({
    producer: toFacts(author, input.authorTrust, input.authorServed),
    reviewer: toFacts(reviewer, input.reviewerTrust, input.reviewerServed),
  });
  const independence: ReviewPairingPlan["independence"] = verdict.independence;
  // Progress events must carry the COMPUTED independence, not a caller label.
  const ctx = { ...input, independence };
  if (reviewer && reviewer.result_adapter && input.reviewerAvailable && crossFamily) {
    return {
      schema_version: "guild.review_pairing_plan.v1",
      author_host: input.authorHost,
      reviewer_host: input.reviewerHost,
      status: "selected",
      independence,
      reason:
        independence === "strong"
          ? `different-family reviewer ${input.reviewerHost} is selectable; independence strong (section 7a adjudicated: verified hosts, cross-family served models)`
          : `different-family reviewer ${input.reviewerHost} is selectable; independence weak (section 7a truth table unsatisfied - strong needs verified trust both sides AND cross-family SERVED-model evidence from finalized receipts)`,
      progress: progressForOutcome(ctx, input.outcome ?? "succeeded"),
    };
  }

  const reason = !reviewer
    ? `reviewer ${input.reviewerHost} is not in the host registry`
    : !reviewer.result_adapter
      ? `reviewer ${input.reviewerHost} has no result_adapter`
      : !input.reviewerAvailable
        ? `reviewer ${input.reviewerHost} is unavailable`
        : "reviewer is same-family and cannot satisfy strong independence";
  if (!input.policyAllowsSkip) {
    return {
      schema_version: "guild.review_pairing_plan.v1",
      author_host: input.authorHost,
      reviewer_host: input.reviewerHost,
      status: "blocked",
      independence: "weak",
      reason: `${reason}; policy forbids skip so caller must block`,
      progress: [
        makeReviewProgressEvent({
          ...ctx,
          state: "tool_error",
          sequence: 1,
          message: `${reason}; policy forbids skip`,
          errorCode: "reviewer_unavailable",
          degradationReceipt: resolveRung("semantic_tool", input.authorHost),
        }),
      ],
    };
  }

  return {
    schema_version: "guild.review_pairing_plan.v1",
    author_host: input.authorHost,
    reviewer_host: input.reviewerHost,
    status: "skipped",
    independence: "weak",
    reason,
    progress: [
      makePolicySkipProgress({
        ...ctx,
        reason,
        degradationReceipt: resolveRung("semantic_tool", input.authorHost),
      }),
    ],
  };
}
