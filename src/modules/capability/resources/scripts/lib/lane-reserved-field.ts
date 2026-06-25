/**
 * scripts/lib/lane-reserved-field.ts
 *
 * Reader for the reserved per-lane `retry:` field on the `team.yaml` lane schema.
 *
 * Contract (BY POINTER):
 *   docs/v2/08-dispatch-execution.md §"Lane retry + dead-lettering" (~line 497):
 *     > The additive optional per-lane `retry:` override on the lane schema is
 *     > `[v2.x]` — the contract reserves it, but no reader ships in v2.0
 *     > (`loadRetryOpts` consumes `defaults.retry.*` only)
 *
 *   docs/knowledge/decisions/v2-runtime-and-execution-model.md §ADR-RE-2 defines the shape:
 *     {
 *       max_attempts: number,   // int >= 1, default 1 = no retry
 *       backoff: "immediate"|"linear"|"exponential",
 *       base_delay_ms?: number  // base for linear/exponential, default 1000
 *     }
 *
 * STATUS: Dormant-until-used. This is the READER half of the v2.x per-lane
 * retry override — the WRITER half is the plan/team authoring path. Today
 * `loadRetryOpts` in scripts/retry-lane.ts consumes ONLY `defaults.retry.*`;
 * this reader is a forward-slot so callers can wire per-lane override later
 * without hunting for the parse site.
 *
 * LENIENT: any absent, null, or structurally invalid `retry:` block → undefined.
 * The caller falls back to the global `defaults.retry.*` budget (unchanged behavior).
 *
 * DETERMINISTIC: no Date.now(), no Math.random(), no I/O. Pure function over
 * whatever object is passed in — the caller supplies the lane (parsed YAML object).
 *
 * Design match: NON-THROWING, same lenient-reader contract as loadRunState /
 * readResolvedSettingsSnapshot / readActivePhase (team-file.ts).
 */

// ── Backoff strategy ──────────────────────────────────────────────────────────

/**
 * Backoff strategy for the per-lane `retry:` block.
 * SINGLE SOURCE OF TRUTH: docs/knowledge/decisions/v2-runtime-and-execution-model.md §ADR-RE-2.
 * Must stay identical to retry-lane.ts BackoffStrategy + read-guild-config.ts
 * DefaultsBlock.retry.backoff's accepted set.
 */
export type LaneRetryBackoff = "immediate" | "linear" | "exponential";

/** Valid backoff values as a const tuple (useful for validation, exhaustiveness checks). */
export const LANE_RETRY_BACKOFF_VALUES = [
  "immediate",
  "linear",
  "exponential",
] as const satisfies readonly LaneRetryBackoff[];

// ── Per-lane retry block ──────────────────────────────────────────────────────

/**
 * The per-lane `retry:` block from a `team.yaml` specialist/lane entry.
 *
 * ADR-RE-2 schema:
 *   retry:
 *     max_attempts: 1          # int >= 1; 1 = no retry (back-compat)
 *     backoff: exponential     # immediate | linear | exponential
 *     base_delay_ms: 1000      # base for linear/exponential (optional)
 *
 * All fields are optional at the TypeScript level — the reader validates and
 * returns only the subset that is well-formed (unknown/extra keys are ignored).
 */
export interface LaneRetryOverride {
  /** int >= 1. 1 = no retry (the global default). */
  max_attempts?: number;
  /** Backoff strategy. */
  backoff?: LaneRetryBackoff;
  /** Base delay in milliseconds for linear/exponential. Default 1000 when absent. */
  base_delay_ms?: number;
}

/**
 * Validation result shape — same {valid, errors} convention used across scripts/lib.
 */
export interface LaneRetryValidation {
  valid: boolean;
  errors: string[];
}

// ── Minimal lane type ─────────────────────────────────────────────────────────

/**
 * The minimal shape of a lane/specialist entry that this reader cares about.
 * A `team.yaml` specialist entry is a plain object; only `retry:` is consumed here.
 * Other fields (`name`, `tier`, `host`, etc.) are deliberately omitted — this reader
 * is focused exclusively on the reserved field.
 */
export type LaneWithOptionalRetry = Record<string, unknown>;

// ── Reader ────────────────────────────────────────────────────────────────────

/**
 * Read the reserved `retry:` field from a `team.yaml` lane/specialist entry.
 *
 * Returns a validated `LaneRetryOverride` when the field is present and
 * structurally sound (at least one recognised, well-typed key). Returns
 * `undefined` when:
 *   - the `retry:` key is absent,
 *   - it is `null` or not a plain object,
 *   - it is an empty object (nothing actionable), or
 *   - all present sub-keys fail type validation.
 *
 * LENIENT: unknown keys in the retry block are silently ignored (forward-compat;
 * the v2.x caller may add `jitter:`, `timeout_ms:`, etc. without breaking this
 * reader). Only `max_attempts`, `backoff`, and `base_delay_ms` are surfaced.
 *
 * NEVER throws. A malformed lane (not an object, null) → undefined.
 *
 * @param lane  A plain object parsed from a `team.yaml` specialist/lane entry.
 * @returns     The per-lane retry override, or undefined when absent or invalid.
 */
export function readReservedLaneField(
  lane: LaneWithOptionalRetry | null | undefined,
): LaneRetryOverride | undefined {
  if (lane == null || typeof lane !== "object" || Array.isArray(lane)) {
    return undefined;
  }

  const raw = (lane as Record<string, unknown>)["retry"];
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const block = raw as Record<string, unknown>;
  const result: LaneRetryOverride = {};
  let hasValidKey = false;

  // max_attempts: int >= 1
  if ("max_attempts" in block) {
    const v = block["max_attempts"];
    if (typeof v === "number" && Number.isInteger(v) && v >= 1) {
      result.max_attempts = v;
      hasValidKey = true;
    }
    // Invalid max_attempts is silently dropped (lenient: absent key beats wrong-typed key).
  }

  // backoff: must be one of the closed set
  if ("backoff" in block) {
    const v = block["backoff"];
    if (
      typeof v === "string" &&
      (LANE_RETRY_BACKOFF_VALUES as readonly string[]).includes(v)
    ) {
      result.backoff = v as LaneRetryBackoff;
      hasValidKey = true;
    }
    // Invalid backoff is silently dropped.
  }

  // base_delay_ms: positive integer (optional)
  if ("base_delay_ms" in block) {
    const v = block["base_delay_ms"];
    if (typeof v === "number" && Number.isInteger(v) && v > 0) {
      result.base_delay_ms = v;
      hasValidKey = true;
    }
    // Invalid base_delay_ms is silently dropped.
  }

  // If no recognised key was valid, treat as absent.
  return hasValidKey ? result : undefined;
}

// ── Validator (structural + semantic) ─────────────────────────────────────────

/**
 * Validate the raw `retry:` block from a lane entry BEFORE calling
 * `readReservedLaneField`. Returns a `{valid, errors}` pair describing every
 * violation found. An absent field is VALID (not required — `[v2.x]` dormant).
 *
 * Use this in authoring-time tooling (plan linters, team-file validators) where
 * you want to surface errors rather than silently degrade. The reader itself
 * is lenient; this validator is strict.
 *
 * @param lane  Raw parsed lane object (or null/undefined for a tolerant caller).
 */
export function validateReservedLaneField(
  lane: LaneWithOptionalRetry | null | undefined,
): LaneRetryValidation {
  const errors: string[] = [];

  if (lane == null || typeof lane !== "object" || Array.isArray(lane)) {
    // Caller passed a non-object lane; this is a caller-side problem, not a
    // retry-field problem. Report it, but the retry field itself is absent = ok.
    return { valid: true, errors: [] };
  }

  const raw = (lane as Record<string, unknown>)["retry"];

  // Absent → valid (optional field).
  if (raw == null) return { valid: true, errors: [] };

  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(
      `lane.retry must be a plain object (got ${Array.isArray(raw) ? "array" : typeof raw})`,
    );
    return { valid: false, errors };
  }

  const block = raw as Record<string, unknown>;

  if ("max_attempts" in block) {
    const v = block["max_attempts"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      errors.push(
        `lane.retry.max_attempts must be an integer >= 1 (got ${JSON.stringify(v)})`,
      );
    }
  }

  if ("backoff" in block) {
    const v = block["backoff"];
    if (
      typeof v !== "string" ||
      !(LANE_RETRY_BACKOFF_VALUES as readonly string[]).includes(v)
    ) {
      errors.push(
        `lane.retry.backoff must be one of ${LANE_RETRY_BACKOFF_VALUES.join(", ")} (got ${JSON.stringify(v)})`,
      );
    }
  }

  if ("base_delay_ms" in block) {
    const v = block["base_delay_ms"];
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
      errors.push(
        `lane.retry.base_delay_ms must be a positive integer (got ${JSON.stringify(v)})`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
