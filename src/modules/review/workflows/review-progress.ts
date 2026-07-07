import type { DegradationReceipt } from "../../host-runtime";

export const REVIEW_PROGRESS_SCHEMA = "guild.review_progress.v1" as const;

export const REVIEW_PROGRESS_STATES = [
  "launched",
  "running",
  "heartbeat",
  "activity",
  "no_output",
  "reviewer_error",
  "tool_error",
  "cancelled",
  "skipped",
  "succeeded",
] as const;

export type ReviewProgressState = (typeof REVIEW_PROGRESS_STATES)[number];
export type ReviewIndependence = "strong" | "weak";

export interface ReviewProgressEvent {
  schema_version: typeof REVIEW_PROGRESS_SCHEMA;
  run_id: string;
  gate: string;
  round_number: number;
  author_host: string;
  reviewer_host: string;
  independence: ReviewIndependence;
  state: ReviewProgressState;
  timestamp: string;
  sequence: number;
  message: string;
  artifact_path: string;
  packet_path: string;
  result_path?: string;
  tool_name?: string;
  exit_code?: number;
  stdout_summary?: string;
  stderr_summary?: string;
  error_code?: string;
  policy_reason?: string;
  degradation_receipt?: DegradationReceipt;
}

export interface ReviewProgressInput {
  runId: string;
  gate: string;
  roundNumber: number;
  authorHost: string;
  reviewerHost: string;
  independence: ReviewIndependence;
  state: ReviewProgressState;
  timestamp: string;
  sequence: number;
  message: string;
  artifactPath: string;
  packetPath: string;
  resultPath?: string;
  toolName?: string;
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
  errorCode?: string;
  policyReason?: string;
  degradationReceipt?: DegradationReceipt;
}

const STATE_SET = new Set<string>(REVIEW_PROGRESS_STATES);

export function isReviewProgressState(value: unknown): value is ReviewProgressState {
  return typeof value === "string" && STATE_SET.has(value);
}

export function makeReviewProgressEvent(input: ReviewProgressInput): ReviewProgressEvent {
  return {
    schema_version: REVIEW_PROGRESS_SCHEMA,
    run_id: input.runId,
    gate: input.gate,
    round_number: input.roundNumber,
    author_host: input.authorHost,
    reviewer_host: input.reviewerHost,
    independence: input.independence,
    state: input.state,
    timestamp: input.timestamp,
    sequence: input.sequence,
    message: input.message,
    artifact_path: input.artifactPath,
    packet_path: input.packetPath,
    ...(input.resultPath !== undefined ? { result_path: input.resultPath } : {}),
    ...(input.toolName !== undefined ? { tool_name: input.toolName } : {}),
    ...(input.exitCode !== undefined ? { exit_code: input.exitCode } : {}),
    ...(input.stdoutSummary !== undefined ? { stdout_summary: input.stdoutSummary } : {}),
    ...(input.stderrSummary !== undefined ? { stderr_summary: input.stderrSummary } : {}),
    ...(input.errorCode !== undefined ? { error_code: input.errorCode } : {}),
    ...(input.policyReason !== undefined ? { policy_reason: input.policyReason } : {}),
    ...(input.degradationReceipt !== undefined ? { degradation_receipt: input.degradationReceipt } : {}),
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateReviewProgressEvent(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["review progress event must be a non-null object"] };
  }
  const event = value as Record<string, unknown>;
  if (event["schema_version"] !== REVIEW_PROGRESS_SCHEMA) {
    errors.push(`schema_version must be ${REVIEW_PROGRESS_SCHEMA}`);
  }
  for (const key of [
    "run_id",
    "gate",
    "author_host",
    "reviewer_host",
    "independence",
    "timestamp",
    "message",
    "artifact_path",
    "packet_path",
  ]) {
    if (typeof event[key] !== "string" || (event[key] as string).trim() === "") {
      errors.push(`${key} must be a non-empty string`);
    }
  }
  if (event["independence"] !== "strong" && event["independence"] !== "weak") {
    errors.push("independence must be strong|weak");
  }
  if (!isReviewProgressState(event["state"])) {
    errors.push(`state must be one of ${REVIEW_PROGRESS_STATES.join("|")}`);
  }
  for (const key of ["round_number", "sequence"]) {
    if (!Number.isInteger(event[key]) || (event[key] as number) < 0) {
      errors.push(`${key} must be a non-negative integer`);
    }
  }
  if (event["exit_code"] !== undefined && !Number.isInteger(event["exit_code"])) {
    errors.push("exit_code must be an integer when present");
  }
  return { valid: errors.length === 0, errors };
}

export interface ReviewProgressContext {
  runId: string;
  gate: string;
  roundNumber: number;
  authorHost: string;
  reviewerHost: string;
  independence: ReviewIndependence;
  artifactPath: string;
  packetPath: string;
  timestamp: string;
}

export function makePolicySkipProgress(ctx: ReviewProgressContext & {
  reason: string;
  degradationReceipt?: DegradationReceipt;
}): ReviewProgressEvent {
  return makeReviewProgressEvent({
    ...ctx,
    state: "skipped",
    sequence: 1,
    message: ctx.reason,
    policyReason: ctx.reason,
    degradationReceipt: ctx.degradationReceipt,
  });
}
