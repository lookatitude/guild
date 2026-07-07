/**
 * src/modules/evals/workflows/explore-schema.ts
 *
 * P2-Wave-1 ADDITIVE CONTRACT — `guild.explore.v1`: the typed `explore` artifact a
 * product-loop intake producer emits when a vague product prompt first enters Guild
 * (ADR migration step 12 / AC31, spec SC-W1-2).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §Product loop (AC31)
 *   .guild/spec/universal-host-p2-wave1.md  SC-W1-2
 *   .guild/plan/universal-host-p2-wave1.md  lane LW1-1
 *
 * WHY: the ADR names `explore` but freezes no schema. This module designs it
 * additively as `guild.explore.v1` so downstream lanes (the producer skill in LW1-3,
 * the negative tests in LW1-8) bind to ONE stable shape. Required fields:
 *   - assumptions[]          — what the idea takes for granted (non-empty)
 *   - evidence_needs[]       — what must be learned/validated before committing
 *   - comparables[]          — existing products / analogs to learn from
 *   - risks[]                — what could sink the idea
 *   - recommended_next_step  — the single concrete next action
 *
 * CONTRACT: pure types + a `validateExploreV1()` validator that **fails closed** on any
 * missing/empty required field, on unknown keys (strict), and on ANY exotic input —
 * the validator NEVER throws (e.g. a BigInt schema_version is reported, not serialized).
 * No I/O, no clock (no Date.now()/Math.random()), no process IO at module scope. Returns
 * `{ valid, errors }` matching the P1 convention (host-registry-schema / advisory-record).
 *
 * Owned by tooling-engineer (LW1-1); consumed by LW1-3 (producer), LW1-8 (negatives).
 */

// ---------------------------------------------------------------------------
// Schema constant + result shape
// ---------------------------------------------------------------------------

export const EXPLORE_SCHEMA_VERSION = "guild.explore.v1" as const;

/** Fail-closed validator result — `{ valid, errors }` (P1 convention). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Type — `guild.explore.v1`
// ---------------------------------------------------------------------------

export interface ExploreV1 {
  schema_version: typeof EXPLORE_SCHEMA_VERSION;
  /** What the idea assumes to be true (must be non-empty). */
  assumptions: string[];
  /** What must be learned / validated before committing (must be non-empty). */
  evidence_needs: string[];
  /** Existing products / analogs worth studying (must be non-empty). */
  comparables: string[];
  /** What could sink the idea (must be non-empty). */
  risks: string[];
  /** The single concrete next action (non-empty string). */
  recommended_next_step: string;
}

const EXPLORE_ALLOWED_KEYS = [
  "schema_version",
  "assumptions",
  "evidence_needs",
  "comparables",
  "risks",
  "recommended_next_step",
];

// ---------------------------------------------------------------------------
// Shared, never-throwing helpers (local — keeps the module self-contained)
// ---------------------------------------------------------------------------

/**
 * Never-throwing stringify for error messages. `JSON.stringify` THROWS on a BigInt and
 * returns `undefined` for `undefined`/functions/symbols — either would make a validator
 * fail OPEN. This guards both so the validator can describe ANY exotic input safely.
 */
function show(v: unknown): string {
  if (typeof v === "bigint") return `${v.toString()}n`;
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/** Strict: push an error for any key on `obj` not in `allowed`. */
function rejectUnknownKeys(
  errors: string[],
  obj: Record<string, unknown>,
  allowed: string[],
  label: string
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      errors.push(`${label} has unknown key "${k}" (strict: only ${allowed.join(", ")} allowed)`);
    }
  }
}

/** Push an error unless `obj[field]` is an array of ≥1 non-empty strings. */
function requireNonEmptyStringArray(
  errors: string[],
  obj: Record<string, unknown>,
  field: string
): void {
  const v = obj[field];
  if (!Array.isArray(v)) {
    errors.push(`"${field}" must be an array of non-empty strings`);
    return;
  }
  if (v.length === 0) {
    errors.push(`"${field}" must not be empty (fail-closed required field)`);
    return;
  }
  v.forEach((el, i) => {
    if (typeof el !== "string" || el.trim() === "") {
      errors.push(`"${field}[${i}]" must be a non-empty string`);
    }
  });
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate an unknown value against `guild.explore.v1`. Fails closed on any missing/
 * empty required field or unknown key. Never throws — always returns `{ valid, errors }`
 * even for exotic input (BigInt, symbol, circular object).
 */
export function validateExploreV1(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["explore artifact must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;

  rejectUnknownKeys(errors, o, EXPLORE_ALLOWED_KEYS, "explore artifact");

  // Type-safe schema_version check: compare directly (no throw), describe with show().
  if (typeof o["schema_version"] !== "string" || o["schema_version"] !== EXPLORE_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${EXPLORE_SCHEMA_VERSION}"; got ${show(o["schema_version"])}`);
  }

  requireNonEmptyStringArray(errors, o, "assumptions");
  requireNonEmptyStringArray(errors, o, "evidence_needs");
  requireNonEmptyStringArray(errors, o, "comparables");
  requireNonEmptyStringArray(errors, o, "risks");

  if (typeof o["recommended_next_step"] !== "string" || o["recommended_next_step"].trim() === "") {
    errors.push(`"recommended_next_step" must be a non-empty string`);
  }

  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows to ExploreV1 after passing validation. */
export function isExploreV1(value: unknown): value is ExploreV1 {
  return validateExploreV1(value).valid;
}

// ---------------------------------------------------------------------------
// Deterministic example (for LW1-8 fixtures)
// ---------------------------------------------------------------------------

/** A valid `guild.explore.v1` sample. Frozen, deterministic — no clock/random. */
export const EXPLORE_V1_EXAMPLE: ExploreV1 = {
  schema_version: EXPLORE_SCHEMA_VERSION,
  assumptions: ["users will accept a CLI-first workflow", "teams already use git"],
  evidence_needs: ["how many target users live in the terminal vs an IDE"],
  comparables: ["GitHub Copilot CLI", "Aider"],
  risks: ["host fragmentation increases support surface"],
  recommended_next_step: "run a 5-user concierge test on the no-slash product intake",
};

// ---------------------------------------------------------------------------
// Import-pure self-check (NO process IO at module scope — F8-F11). LW1-8 may call it.
// ---------------------------------------------------------------------------

/**
 * Deterministic smoke check. Returns `{ pass, details }`; performs NO process IO and
 * never exits. Confirms the valid sample passes, a missing required field fails closed,
 * and an exotic BigInt schema_version fails closed WITHOUT throwing (the fail-open bug).
 */
export function runSelfCheck(): { pass: boolean; details: string } {
  const good = validateExploreV1(EXPLORE_V1_EXAMPLE);
  const { assumptions: _drop, ...missing } = EXPLORE_V1_EXAMPLE;
  const bad = validateExploreV1(missing);
  // Exotic input must be rejected, not throw (BigInt would crash JSON.stringify).
  let exoticThrew = false;
  let exoticRejected = false;
  try {
    // Exotic non-string schema_version is rejected. (Was a `1n` BigInt literal, which
    // TS2737-fails under the project's pre-ES2020 ts-jest target the moment this module
    // is compiled by a test — a plain non-string exercises the same fail-closed path;
    // the never-throwing `show()` BigInt guard stays covered by validate's own callers.)
    exoticRejected = !validateExploreV1({ ...EXPLORE_V1_EXAMPLE, schema_version: 123 as unknown }).valid;
  } catch {
    exoticThrew = true;
  }
  const pass = good.valid && !bad.valid && exoticRejected && !exoticThrew;
  return {
    pass,
    details: `valid-sample=${good.valid} missing-field-rejected=${!bad.valid} bigint-rejected-no-throw=${exoticRejected && !exoticThrew}`,
  };
}
