/** Module-owned guild.handoff.v2 schema and runtime validator. */
export type HandoffTier = "cheap" | "mid" | "powerful";
export type HandoffStatus = "done" | "blocked" | "escalate";
export interface HandoffV2 {
  schema_version: "guild.handoff.v2"; task_id: string; tier: HandoffTier;
  status: HandoffStatus; summary: string; artifacts: string[]; issues: string[];
  escalate_reason?: string; learnings?: string[]; notes?: string;
  injection_clean?: "clean" | "flagged" | "unverified";
}
export interface HandoffValidationResult { valid: boolean; errors: string[] }
export const SUMMARY_MAX_CHARS = 600;
export const NOTES_MAX_CHARS = 200;
export const ALLOWED_INJECTION_CLEAN_VALUES: ReadonlySet<string> =
  new Set(["clean", "flagged", "unverified"]);
export const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "schema_version", "task_id", "tier", "status", "summary", "artifacts", "issues",
  "escalate_reason", "learnings", "notes", "injection_clean",
]);
const VALID_TIERS = new Set(["cheap", "mid", "powerful"]);
const VALID_STATUSES = new Set(["done", "blocked", "escalate"]);

export function validateHandoffV2(value: unknown): HandoffValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { valid: false, errors: ["envelope must be a non-null object"] };
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj))
    if (!ALLOWED_TOP_LEVEL_KEYS.has(key))
      errors.push(`unknown key "${key}" — strict guild.handoff.v2 rejects extra/misspelled keys`);
  if (obj.schema_version !== "guild.handoff.v2")
    errors.push(`schema_version must be "guild.handoff.v2"; got ${JSON.stringify(obj.schema_version)}`);
  if (typeof obj.task_id !== "string" || obj.task_id.trim() === "")
    errors.push("task_id must be a non-empty string");
  if (typeof obj.tier !== "string" || !VALID_TIERS.has(obj.tier))
    errors.push(`tier must be one of cheap|mid|powerful; got ${JSON.stringify(obj.tier)}`);
  if (typeof obj.status !== "string" || !VALID_STATUSES.has(obj.status))
    errors.push(`status must be one of done|blocked|escalate; got ${JSON.stringify(obj.status)}`);
  if (typeof obj.summary !== "string") errors.push("summary must be a string");
  else if (obj.summary.trim() === "") errors.push("summary must not be empty");
  else if (obj.summary.length > SUMMARY_MAX_CHARS)
    errors.push(`summary exceeds ${SUMMARY_MAX_CHARS} char cap (bloat rejection SC-7): got ${obj.summary.length} chars`);
  validateStringArray(obj, "artifacts", true, errors);
  validateStringArray(obj, "issues", true, errors);
  validateStringArray(obj, "learnings", false, errors);
  if (obj.status === "escalate" &&
      (typeof obj.escalate_reason !== "string" || obj.escalate_reason.trim() === ""))
    errors.push("escalate_reason is required and must be non-empty when status is 'escalate'");
  else if (obj.escalate_reason !== undefined && typeof obj.escalate_reason !== "string")
    errors.push("escalate_reason must be a string when provided");
  if (obj.notes !== undefined) {
    if (typeof obj.notes !== "string") errors.push("notes must be a string when provided");
    else if (obj.notes.length > NOTES_MAX_CHARS)
      errors.push(`notes exceeds ${NOTES_MAX_CHARS} char cap (O-4 binding resolution): got ${obj.notes.length} chars`);
  }
  if (obj.injection_clean !== undefined &&
      (typeof obj.injection_clean !== "string" || !ALLOWED_INJECTION_CLEAN_VALUES.has(obj.injection_clean)))
    errors.push(`injection_clean must be one of clean|flagged|unverified; got ${JSON.stringify(obj.injection_clean)}`);
  return { valid: errors.length === 0, errors };
}

function validateStringArray(
  obj: Record<string, unknown>, key: "artifacts" | "issues" | "learnings",
  required: boolean, errors: string[]
): void {
  const value = obj[key];
  if (value === undefined && !required) return;
  if (!Array.isArray(value)) {
    errors.push(required ? `${key} must be an array (may be empty)` : `${key} must be an array when provided`);
    return;
  }
  value.forEach((item, index) => {
    if (typeof item !== "string") errors.push(`${key}[${index}] must be a string`);
  });
}
