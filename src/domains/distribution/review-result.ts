/**
 * src/domains/distribution/review-result.ts
 *
 * Lenient consume-only reader for review_result.v1. The gate-pass CLI remains at
 * scripts/verify-gate-pass.ts; this module owns the pure parser contract.
 */

/** The minimal field set the gate-pass reads from `review_result.v1` (frozen
 * schema -- bound by pointer; this is a lenient consume-only reader, not a
 * redefinition). */
export interface ReviewResultMinimal {
  packet_id: string;
  artifact_sha256_reviewed: string;
  verdict: string;
  blocking_findings: unknown[];
  schema_version?: string;
}

/** One blocking finding — every field required, no others (pinned schema). */
export interface ReviewFindingV1 {
  id: string;
  path: string;
  line: number;
  title: string;
  trigger: string;
  impact: string;
  required: string;
}

/** The complete closed `review_result.v1` record (schemas/review_result.v1.schema.json). */
export interface ReviewResultV1 {
  schema_version: "review_result.v1";
  packet_id: string;
  artifact_sha256_reviewed: string;
  verdict: "satisfied" | "issues";
  blocking_findings: ReviewFindingV1[];
  verification: string[];
  limits: string[];
}

const RESULT_KEYS = [
  "schema_version",
  "packet_id",
  "artifact_sha256_reviewed",
  "verdict",
  "blocking_findings",
  "verification",
  "limits",
] as const;
const FINDING_STRING_KEYS = ["id", "path", "title", "trigger", "impact", "required"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function isFinding(v: unknown): v is ReviewFindingV1 {
  if (!isPlainObject(v) || !hasExactKeys(v, [...FINDING_STRING_KEYS, "line"])) return false;
  return FINDING_STRING_KEYS.every((k) => typeof v[k] === "string") && Number.isInteger(v["line"]);
}

/**
 * Strict closed-shape validator for `review_result.v1` (CD12 e): every required
 * property present with its pinned type, no additional properties at either
 * level. Authority paths validate with THIS before the unchanged lenient
 * five-condition evaluator runs. Returns the typed record or null.
 */
export function validateReviewResultV1Strict(value: unknown): ReviewResultV1 | null {
  if (!isPlainObject(value) || !hasExactKeys(value, RESULT_KEYS)) return null;
  if (value["schema_version"] !== "review_result.v1") return null;
  if (typeof value["packet_id"] !== "string" || typeof value["artifact_sha256_reviewed"] !== "string") return null;
  if (value["verdict"] !== "satisfied" && value["verdict"] !== "issues") return null;
  const findings = value["blocking_findings"];
  if (!Array.isArray(findings) || !findings.every(isFinding)) return null;
  if (!isStringArray(value["verification"]) || !isStringArray(value["limits"])) return null;
  return value as unknown as ReviewResultV1;
}

/**
 * Lenient `review_result.v1` reader. Returns the minimal envelope or null with
 * reasons. Required: packet_id, artifact_sha256_reviewed (non-empty strings),
 * verdict (string), blocking_findings (array). A present `schema_version` must
 * be exactly "review_result.v1"; an absent one is tolerated (lenient).
 */
export function parseReviewResult(raw: string): {
  result: ReviewResultMinimal | null;
  reasons: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { result: null, reasons: ["result is not valid JSON"] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { result: null, reasons: ["result is not a JSON object"] };
  }
  const obj = parsed as Record<string, unknown>;
  const reasons: string[] = [];

  const schemaVersion = obj["schema_version"];
  if (schemaVersion !== undefined && schemaVersion !== "review_result.v1") {
    reasons.push(
      `schema_version is ${JSON.stringify(schemaVersion)} (expected "review_result.v1")`
    );
  }
  if (typeof obj["packet_id"] !== "string" || obj["packet_id"].trim() === "") {
    reasons.push("missing required field: packet_id");
  }
  if (
    typeof obj["artifact_sha256_reviewed"] !== "string" ||
    obj["artifact_sha256_reviewed"].trim() === ""
  ) {
    reasons.push("missing required field: artifact_sha256_reviewed");
  }
  if (typeof obj["verdict"] !== "string" || obj["verdict"].trim() === "") {
    reasons.push("missing required field: verdict");
  }
  if (!Array.isArray(obj["blocking_findings"])) {
    reasons.push("missing required field: blocking_findings (must be an array)");
  }
  if (reasons.length > 0) return { result: null, reasons };

  const result: ReviewResultMinimal = {
    packet_id: obj["packet_id"] as string,
    artifact_sha256_reviewed: obj["artifact_sha256_reviewed"] as string,
    verdict: obj["verdict"] as string,
    blocking_findings: obj["blocking_findings"] as unknown[],
  };
  if (typeof schemaVersion === "string") result.schema_version = schemaVersion;
  return { result, reasons: [] };
}
