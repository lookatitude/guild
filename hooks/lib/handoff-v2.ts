/**
 * hooks/lib/handoff-v2.ts
 *
 * Canonical TypeScript type + runtime validator for the `guild.handoff.v2`
 * dispatch envelope (ADR §5, cost-aware-tiering-and-lean-context.md).
 *
 * Composes WITH, does NOT supersede, the frozen `guild.handoff_receipt.v1`
 * (target-architecture.md §"handoff_receipt contract"). That receipt is the
 * durable review/verify linchpin; this envelope is the lighter in-flight
 * dispatch return consumed by the lead coordinator.
 *
 * Runner: imported by hooks/agent-team/task-completed.ts (tsx / esbuild dist).
 * Tests:  hooks/__tests__/handoff-v2.test.ts
 *
 * Lint/validation rules (VC-7 / SC-7):
 *   - All required fields must be present and correctly typed.
 *   - `summary` is capped at ~100 tokens (~600 chars — generous for tokens,
 *     tight enough to block prose dumps).
 *   - `notes` is optional, capped at 200 chars (O-4 binding resolution).
 *   - `escalate_reason` is required when status === "escalate".
 *   - `artifacts` and `issues` must be arrays (may be empty).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type HandoffTier = "cheap" | "mid" | "powerful";
export type HandoffStatus = "done" | "blocked" | "escalate";

/**
 * `guild.handoff.v2` — the canonical in-flight dispatch envelope.
 * Single source of truth: docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md §5
 */
export interface HandoffV2 {
  /** Self-versioned discriminator; always "guild.handoff.v2". */
  schema_version: "guild.handoff.v2";
  /** The task this envelope answers — required. */
  task_id: string;
  /** The model tier that produced this result. */
  tier: HandoffTier;
  /** Terminal disposition of the task. */
  status: HandoffStatus;
  /** Prose outcome summary — size-capped at ~100 tokens (~600 chars). Required. */
  summary: string;
  /** Pointers to produced/modified files. Format: "<file>:<line-range>". May be []. */
  artifacts: string[];
  /** Typed issue descriptors. May be []. */
  issues: string[];
  /** Sub-question to escalate to a powerful advisor. Required when status === "escalate". */
  escalate_reason?: string;
  /** Candidate learning notes for the run record (§6). */
  learnings?: string[];
  /** Optional free-text annotation, capped at 200 chars (O-4). */
  notes?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** ~100-token proxy: 600 characters. */
export const SUMMARY_MAX_CHARS = 600;

/** O-4 binding resolution: notes ≤ 200 chars. */
export const NOTES_MAX_CHARS = 200;

const VALID_TIERS = new Set<string>(["cheap", "mid", "powerful"]);
const VALID_STATUSES = new Set<string>(["done", "blocked", "escalate"]);

// ── Validation result ──────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Validator ─────────────────────────────────────────────────────────────

/**
 * Runtime validator for `guild.handoff.v2`.
 *
 * Returns `{ valid: true, errors: [] }` on a conforming envelope.
 * Returns `{ valid: false, errors: [...] }` listing every violation found,
 * so callers can surface structured rejection diagnostics.
 *
 * This is a lint/bloat-rejection step per VC-7 / SC-7.
 */
export function validateHandoffV2(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["envelope must be a non-null object"] };
  }

  const obj = value as Record<string, unknown>;

  // schema_version
  if (obj["schema_version"] !== "guild.handoff.v2") {
    errors.push(
      `schema_version must be "guild.handoff.v2"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }

  // task_id
  if (typeof obj["task_id"] !== "string" || obj["task_id"].trim() === "") {
    errors.push("task_id must be a non-empty string");
  }

  // tier
  if (typeof obj["tier"] !== "string" || !VALID_TIERS.has(obj["tier"])) {
    errors.push(`tier must be one of cheap|mid|powerful; got ${JSON.stringify(obj["tier"])}`);
  }

  // status
  if (typeof obj["status"] !== "string" || !VALID_STATUSES.has(obj["status"])) {
    errors.push(
      `status must be one of done|blocked|escalate; got ${JSON.stringify(obj["status"])}`
    );
  }

  // summary — required, size-capped
  if (typeof obj["summary"] !== "string") {
    errors.push("summary must be a string");
  } else if (obj["summary"].trim() === "") {
    errors.push("summary must not be empty");
  } else if (obj["summary"].length > SUMMARY_MAX_CHARS) {
    errors.push(
      `summary exceeds ${SUMMARY_MAX_CHARS} char cap (bloat rejection SC-7): ` +
        `got ${obj["summary"].length} chars`
    );
  }

  // artifacts — required array (may be empty)
  if (!Array.isArray(obj["artifacts"])) {
    errors.push("artifacts must be an array (may be empty)");
  } else {
    for (let i = 0; i < obj["artifacts"].length; i++) {
      if (typeof obj["artifacts"][i] !== "string") {
        errors.push(`artifacts[${i}] must be a string`);
      }
    }
  }

  // issues — required array (may be empty)
  if (!Array.isArray(obj["issues"])) {
    errors.push("issues must be an array (may be empty)");
  } else {
    for (let i = 0; i < obj["issues"].length; i++) {
      if (typeof obj["issues"][i] !== "string") {
        errors.push(`issues[${i}] must be a string`);
      }
    }
  }

  // escalate_reason — required when status === "escalate"
  if (obj["status"] === "escalate") {
    if (
      obj["escalate_reason"] === undefined ||
      obj["escalate_reason"] === null ||
      (typeof obj["escalate_reason"] === "string" && obj["escalate_reason"].trim() === "")
    ) {
      errors.push("escalate_reason is required and must be non-empty when status is 'escalate'");
    }
  }

  // escalate_reason type check (if present)
  if (obj["escalate_reason"] !== undefined && typeof obj["escalate_reason"] !== "string") {
    errors.push("escalate_reason must be a string when provided");
  }

  // learnings — optional array of strings
  if (obj["learnings"] !== undefined) {
    if (!Array.isArray(obj["learnings"])) {
      errors.push("learnings must be an array when provided");
    } else {
      for (let i = 0; i < obj["learnings"].length; i++) {
        if (typeof obj["learnings"][i] !== "string") {
          errors.push(`learnings[${i}] must be a string`);
        }
      }
    }
  }

  // notes — optional, capped at 200 chars (O-4)
  if (obj["notes"] !== undefined) {
    if (typeof obj["notes"] !== "string") {
      errors.push("notes must be a string when provided");
    } else if (obj["notes"].length > NOTES_MAX_CHARS) {
      errors.push(
        `notes exceeds ${NOTES_MAX_CHARS} char cap (O-4 binding resolution): ` +
          `got ${obj["notes"].length} chars`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Type guard: narrows an unknown value to HandoffV2 after passing validation.
 */
export function isHandoffV2(value: unknown): value is HandoffV2 {
  return validateHandoffV2(value).valid;
}
