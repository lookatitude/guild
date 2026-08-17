/**
 * src/modules/distribution/workflows/review-result.ts
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
