/**
 * hooks/lib/handoff-v2.ts
 *
 * Canonical TypeScript type + runtime validator for the `guild.handoff.v2`
 * dispatch envelope.
 *
 * ## Handoff receipt contract (OD-2, operator-confirmed 2026-06-02)
 *
 * Canonical reference:
 *   ADR: communication-format-policy (workspace wiki) §"Handoff contract"
 *
 * The normative rule (communication-format-policy §7):
 *   `guild.handoff_receipt.v1` is the durable human-review wrapper. Its YAML
 *   frontmatter (frozen field set) is human/review metadata and is preserved
 *   unchanged. A valid v1 receipt MUST embed exactly ONE fenced
 *   `guild.handoff.v2` JSON block — that single embedded block is the
 *   canonical machine truth. The "external pointer / dereference" option is
 *   REJECTED: `extractHandoffEnvelope` accepts ONLY an embedded fenced block,
 *   never a pointer to an out-of-file envelope. A frontmatter-only message
 *   (no embedded v2 block) is NOT a valid machine receipt.
 *
 * NORMATIVE vs. CURRENT EXTRACTOR: the contract above is the normative OD-2
 *   target. `extractHandoffEnvelope` implements the EXTRACTION step only: it
 *   returns the FIRST matching fenced block (first-match regex) and does not
 *   count or reject duplicate blocks. Duplicate-block rejection is enforced in
 *   U5b (lint), not here. Caller rejection of a null (missing/invalid) envelope
 *   is also NOT uniform today — `task-completed.ts` logs a note and continues
 *   for legacy receipts. Making callers fail-closed on a missing envelope is
 *   the behavior-changing scope of lane U3.
 *
 * This file owns the v2 schema + validator; it does NOT supersede the frozen
 * `guild.handoff_receipt.v1` wrapper. The two compose — v1 wraps v2 via the
 * embedded block; they do not compete.
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
 *
 * This is the machine-truth schema embedded inside a `guild.handoff_receipt.v1`
 * wrapper as a fenced JSON block. Schema authority:
 *   ADR: communication-format-policy (workspace wiki) §"Handoff contract" (OD-2)
 *
 * Field definitions: ADR: cost-aware-tiering-and-lean-context (workspace wiki) §5
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
  /**
   * HK-08: injection safety classification for this envelope's free-text fields.
   * Additive-optional (absent ⇒ read as "unverified").
   *   - "clean"      → no directive language detected
   *   - "flagged"    → directive language found; security event emitted by task-completed
   *   - "unverified" → classification not run; task-completed will compute it
   */
  injection_clean?: "clean" | "flagged" | "unverified";
}

// ── Constants ──────────────────────────────────────────────────────────────

/** ~100-token proxy: 600 characters. */
export const SUMMARY_MAX_CHARS = 600;

/** O-4 binding resolution: notes ≤ 200 chars. */
export const NOTES_MAX_CHARS = 200;

const VALID_TIERS = new Set<string>(["cheap", "mid", "powerful"]);
const VALID_STATUSES = new Set<string>(["done", "blocked", "escalate"]);

/**
 * Exhaustive allowed top-level key set (spec §2). Any key not in this set is
 * rejected — catches `schema:` (p2-3 drift) and any misspelled/extra key.
 */
export const ALLOWED_TOP_LEVEL_KEYS = new Set<string>([
  "schema_version",
  "task_id",
  "tier",
  "status",
  "summary",
  "artifacts",
  "issues",
  "escalate_reason",
  "learnings",
  "notes",
  "injection_clean", // HK-08 additive-optional
]);

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

  // Unknown-key rejection — strict guild.handoff.v2 (spec §2)
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) {
      errors.push(
        `unknown key "${k}" — strict guild.handoff.v2 rejects extra/misspelled keys`
      );
    }
  }

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

  // injection_clean — HK-08 additive-optional; absent ⇒ unverified (no error)
  if (obj["injection_clean"] !== undefined) {
    const validValues = new Set(["clean", "flagged", "unverified"]);
    if (!validValues.has(obj["injection_clean"] as string)) {
      errors.push(
        `injection_clean must be one of clean|flagged|unverified; got ${JSON.stringify(obj["injection_clean"])}`
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

/**
 * Extract a `guild.handoff.v2` envelope from a markdown receipt string.
 *
 * Implements the extraction step of the OD-2 rule
 * (ADR: communication-format-policy (workspace wiki) §"Handoff contract"):
 * looks ONLY for an embedded fenced JSON block tagged `guild.handoff.v2`:
 *
 * ```guild.handoff.v2
 * { ... }
 * ```
 *
 * What this function does:
 *   - Returns the FIRST matching fenced block parsed as JSON.
 *   - Returns `null` when no block is found or the block is not valid JSON
 *     (including receipts that contain only YAML frontmatter with no fenced
 *     block — those produce no regex match and therefore return `null`).
 *   - Performs NO pointer resolution.
 *
 * What this function does NOT do:
 *   - It does not count or reject duplicate embedded blocks. Duplicate-block
 *     rejection is enforced by lint in lane U5b, not here.
 *   - It does not itself reject a null return as invalid. Caller behavior
 *     varies: `task-completed.ts` logs a note and continues for legacy
 *     receipts (envelope optional today). Making callers fail-closed on a
 *     missing envelope is the behavior-changing scope of lane U3.
 *
 * Shared by task-completed.ts and teammate-idle.ts so the extraction logic
 * stays in one place.
 */
export function extractHandoffEnvelope(content: string): unknown | null {
  const pattern = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/;
  const match = pattern.exec(content);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}
