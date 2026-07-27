import { getRegistryEntry, resolveRung, type HostId } from "../../host-runtime";
import {
  makePolicySkipProgress,
  makeReviewProgressEvent,
  type ReviewProgressContext,
  type ReviewProgressEvent,
} from "./review-progress";

export type ReviewPairingStatus = "selected" | "skipped" | "blocked";
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

export interface PlanReviewPairingInput extends ReviewProgressContext {
  policyAllowsSkip: boolean;
  reviewerAvailable: boolean;
  outcome?: ReviewLifecycleOutcome;
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
  const strong = Boolean(author && reviewer && author.family !== reviewer.family);
  if (reviewer && reviewer.result_adapter && input.reviewerAvailable && strong) {
    return {
      schema_version: "guild.review_pairing_plan.v1",
      author_host: input.authorHost,
      reviewer_host: input.reviewerHost,
      status: "selected",
      independence: "strong",
      reason: `different-family reviewer ${input.reviewerHost} is selectable`,
      progress: progressForOutcome(input, input.outcome ?? "succeeded"),
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
          ...input,
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
        ...input,
        reason,
        degradationReceipt: resolveRung("semantic_tool", input.authorHost),
      }),
    ],
  };
}
