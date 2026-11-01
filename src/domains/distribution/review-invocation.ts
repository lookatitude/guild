/**
 * src/domains/distribution/review-invocation.ts
 *
 * Verifier for the broker invocation record (guild.review_invocation.v1, CD12 c).
 * Root's broker path PRODUCES the record; the plugin only verifies it. The record
 * is the per-invocation join between a review request, its candidate, the packet
 * text, the adapter exit record and the review_result.v1 — an adapter exit record
 * alone never grants authority.
 */

export const REVIEW_INVOCATION_SCHEMA = "guild.review_invocation.v1" as const;

export interface FileRefV1 {
  path: string;
  sha256: string;
}

export interface ReviewInvocationV1 {
  schema_version: typeof REVIEW_INVOCATION_SCHEMA;
  invocation_id: string;
  packet_id: string;
  request_id: string;
  reviewer_participant_id: string;
  participation_kind: string;
  role_ref: string;
  request: FileRefV1;
  candidate: FileRefV1;
  packet: FileRefV1;
  result: FileRefV1;
  adapter_exit: FileRefV1;
  started_at: string;
  finished_at: string;
  exit: number;
  reviewer_family: string;
  author_family: string;
  independence: string;
  requested_model: string;
  served_model: string;
}

const STRING_FIELDS = [
  "invocation_id",
  "packet_id",
  "request_id",
  "reviewer_participant_id",
  "participation_kind",
  "role_ref",
  "started_at",
  "finished_at",
  "reviewer_family",
  "author_family",
  "independence",
  "requested_model",
  "served_model",
] as const;
const REF_FIELDS = ["request", "candidate", "packet", "result", "adapter_exit"] as const;

/** The fields an invocation record must repeat verbatim from its adapter exit record. */
export const INVOCATION_ADAPTER_JOIN_FIELDS = [
  "exit",
  "reviewer_family",
  "author_family",
  "independence",
  "served_model",
  "started_at",
  "finished_at",
] as const;

const HEX64 = /^[0-9a-f]{64}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFileRef(v: unknown): v is FileRefV1 {
  return (
    isObject(v) &&
    typeof v["path"] === "string" &&
    v["path"].length > 0 &&
    typeof v["sha256"] === "string" &&
    HEX64.test(v["sha256"])
  );
}

/**
 * Validate a broker invocation record. Every declared field is required and
 * non-empty; the five file refs carry a path and a lowercase hex sha256; exit is
 * an integer; started_at and finished_at parse as instants. Returns the typed
 * record or null. It does not judge the exit value: a nonzero exit is a valid
 * forensic record that never grants authority (the caller refuses it).
 */
export function validateReviewInvocationV1(value: unknown): ReviewInvocationV1 | null {
  if (!isObject(value)) return null;
  if (value["schema_version"] !== REVIEW_INVOCATION_SCHEMA) return null;
  for (const k of STRING_FIELDS) {
    if (typeof value[k] !== "string" || (value[k] as string).length === 0) return null;
  }
  for (const k of REF_FIELDS) if (!isFileRef(value[k])) return null;
  if (!Number.isInteger(value["exit"])) return null;
  for (const k of ["started_at", "finished_at"] as const) {
    if (!Number.isFinite(Date.parse(value[k] as string))) return null;
  }
  return value as unknown as ReviewInvocationV1;
}

/**
 * CD12 (c) adapter join: the invocation repeats the adapter exit record's exit,
 * families, independence, served model and times. Returns the first mismatching
 * field, or null when every join field is equal.
 */
export function invocationAdapterMismatch(
  invocation: ReviewInvocationV1,
  adapterExit: Record<string, unknown>
): string | null {
  for (const k of INVOCATION_ADAPTER_JOIN_FIELDS) {
    if (adapterExit[k] !== invocation[k]) return k;
  }
  return null;
}
