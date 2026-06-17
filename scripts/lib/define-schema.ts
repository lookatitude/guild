/**
 * scripts/lib/define-schema.ts
 *
 * P2-Wave-1 ADDITIVE CONTRACT — `guild.define.v1`: the typed `define` artifact that
 * turns an explored idea into a traceable PRD nucleus (ADR migration step 12 / AC32,
 * spec SC-W1-3 shape half).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §Product loop (AC32)
 *   .guild/spec/universal-host-p2-wave1.md  SC-W1-3
 *   .guild/plan/universal-host-p2-wave1.md  lane LW1-1 (shape) / LW1-5 (traceability)
 *
 * WHY: AC32 requires full downstream traceability — every acceptance criterion must be
 * referenceable from a plan lane, a build receipt, a QA check, AND a release gate. That
 * only works if each AC carries a **stable id** the chain can resolve. This module
 * freezes that shape. Required fields (each fails closed on omission/emptiness):
 *   - acceptance_criteria[]  — each { id (STABLE), text } ; ids must be UNIQUE
 *   - user_stories[]         — the PRD user stories
 *   - non_goals[]            — explicit out-of-scope statements
 *   - risks[]                — what could sink delivery
 *   - affected_surfaces[]    — code/product surfaces this touches
 *   - test_implications[]    — what must be tested as a result
 *
 * CONTRACT: pure types + `validateDefineV1()` that **fails closed** on any missing/empty
 * required field, duplicate AC ids, and unknown keys (strict). NEVER throws on exotic
 * input. No I/O, no clock, no process IO at module scope. Returns `{ valid, errors }`
 * matching the P1 convention.
 *
 * Owned by tooling-engineer (LW1-1); consumed by LW1-3 (producer), LW1-5 (traceability
 * checker — reads AcceptanceCriterion.id), LW1-8 (negatives).
 */

// ---------------------------------------------------------------------------
// Schema constant + result shape
// ---------------------------------------------------------------------------

export const DEFINE_SCHEMA_VERSION = "guild.define.v1" as const;

/** Fail-closed validator result — `{ valid, errors }` (P1 convention). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Sub-shape — a single acceptance criterion (stable id + text)
// ---------------------------------------------------------------------------

export interface AcceptanceCriterion {
  /** STABLE id — the token every downstream stage (plan/receipt/QA/release) resolves. */
  id: string;
  /** Human-readable criterion text. */
  text: string;
}

const ACCEPTANCE_CRITERION_ALLOWED_KEYS = ["id", "text"];

// ---------------------------------------------------------------------------
// Type — `guild.define.v1`
// ---------------------------------------------------------------------------

export interface DefineV1 {
  schema_version: typeof DEFINE_SCHEMA_VERSION;
  /** Each criterion carries a stable, unique id (must be non-empty). */
  acceptance_criteria: AcceptanceCriterion[];
  /** PRD user stories (must be non-empty). */
  user_stories: string[];
  /** Explicit out-of-scope statements (must be non-empty). */
  non_goals: string[];
  /** Delivery risks (must be non-empty). */
  risks: string[];
  /** Code/product surfaces this touches (must be non-empty). */
  affected_surfaces: string[];
  /** What must be tested as a result (must be non-empty). */
  test_implications: string[];
}

const DEFINE_ALLOWED_KEYS = [
  "schema_version",
  "acceptance_criteria",
  "user_stories",
  "non_goals",
  "risks",
  "affected_surfaces",
  "test_implications",
];

// ---------------------------------------------------------------------------
// Shared, never-throwing helpers (local — keeps the module self-contained)
// ---------------------------------------------------------------------------

/** Never-throwing stringify for error messages (guards BigInt/undefined/exotic). */
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
 * Validate an unknown value against `guild.define.v1`. Fails closed on any missing/empty
 * required field, a duplicate/empty AC id, or an unknown key. Never throws; always
 * returns `{ valid, errors }`.
 */
export function validateDefineV1(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["define artifact must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;

  rejectUnknownKeys(errors, o, DEFINE_ALLOWED_KEYS, "define artifact");

  if (typeof o["schema_version"] !== "string" || o["schema_version"] !== DEFINE_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${DEFINE_SCHEMA_VERSION}"; got ${show(o["schema_version"])}`);
  }

  // acceptance_criteria — array of { id, text }; non-empty; ids unique + non-empty; strict keys.
  const ac = o["acceptance_criteria"];
  if (!Array.isArray(ac)) {
    errors.push(`"acceptance_criteria" must be an array of { id, text }`);
  } else if (ac.length === 0) {
    errors.push(`"acceptance_criteria" must not be empty (fail-closed required field)`);
  } else {
    const seen = new Set<string>();
    ac.forEach((el, i) => {
      if (typeof el !== "object" || el === null || Array.isArray(el)) {
        errors.push(`acceptance_criteria[${i}] must be an object { id, text }`);
        return;
      }
      const c = el as Record<string, unknown>;
      rejectUnknownKeys(errors, c, ACCEPTANCE_CRITERION_ALLOWED_KEYS, `acceptance_criteria[${i}]`);
      const id = c["id"];
      if (typeof id !== "string" || id.trim() === "") {
        errors.push(`acceptance_criteria[${i}].id must be a non-empty stable string`);
      } else if (seen.has(id)) {
        // A duplicate id breaks LW1-5 traceability (the chain resolves one of two).
        errors.push(`acceptance_criteria[${i}].id "${id}" is a duplicate; AC ids must be unique`);
      } else {
        seen.add(id);
      }
      if (typeof c["text"] !== "string" || c["text"].trim() === "") {
        errors.push(`acceptance_criteria[${i}].text must be a non-empty string`);
      }
    });
  }

  requireNonEmptyStringArray(errors, o, "user_stories");
  requireNonEmptyStringArray(errors, o, "non_goals");
  requireNonEmptyStringArray(errors, o, "risks");
  requireNonEmptyStringArray(errors, o, "affected_surfaces");
  requireNonEmptyStringArray(errors, o, "test_implications");

  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows to DefineV1 after passing validation. */
export function isDefineV1(value: unknown): value is DefineV1 {
  return validateDefineV1(value).valid;
}

/**
 * Convenience accessor: the set of stable AC ids in a define artifact. Used by the
 * LW1-5 traceability checker. Returns [] for a non-conforming value (caller validates
 * first); never throws.
 */
export function acceptanceCriterionIds(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const ac = (value as Record<string, unknown>)["acceptance_criteria"];
  if (!Array.isArray(ac)) return [];
  const ids: string[] = [];
  for (const el of ac) {
    if (el && typeof el === "object" && typeof (el as Record<string, unknown>)["id"] === "string") {
      ids.push((el as Record<string, unknown>)["id"] as string);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Deterministic example (for LW1-8 fixtures)
// ---------------------------------------------------------------------------

/** A valid `guild.define.v1` sample. Frozen, deterministic — no clock/random. */
export const DEFINE_V1_EXAMPLE: DefineV1 = {
  schema_version: DEFINE_SCHEMA_VERSION,
  acceptance_criteria: [
    { id: "AC-1", text: "A vague product prompt reaches product-loop intake with no slash command." },
    { id: "AC-2", text: "The intake classifier never hijacks a normal build/review prompt." },
  ],
  user_stories: ["As a builder, I describe an idea in plain words and Guild scopes it."],
  non_goals: ["No live-host install proof in this wave."],
  risks: ["intake classifier over-fires on non-product prompts"],
  affected_surfaces: ["scripts/lib/ intake classifier", "using-guild no-slash entry"],
  test_implications: ["precision ≥0.9 / recall ≥0.8 trigger-accuracy eval"],
};

// ---------------------------------------------------------------------------
// Import-pure self-check (NO process IO at module scope — F8-F11). LW1-8 may call it.
// ---------------------------------------------------------------------------

/**
 * Deterministic smoke check. Returns `{ pass, details }`; NO process IO, never exits.
 * Confirms the valid sample passes, a duplicate AC id fails closed, and an exotic BigInt
 * schema_version fails closed WITHOUT throwing.
 */
export function runSelfCheck(): { pass: boolean; details: string } {
  const good = validateDefineV1(DEFINE_V1_EXAMPLE);
  const dup: DefineV1 = {
    ...DEFINE_V1_EXAMPLE,
    acceptance_criteria: [
      { id: "AC-1", text: "first" },
      { id: "AC-1", text: "dup" },
    ],
  };
  const bad = validateDefineV1(dup);
  let exoticThrew = false;
  let exoticRejected = false;
  try {
    exoticRejected = !validateDefineV1({ ...DEFINE_V1_EXAMPLE, schema_version: 1n as unknown }).valid;
  } catch {
    exoticThrew = true;
  }
  const pass = good.valid && !bad.valid && exoticRejected && !exoticThrew;
  return {
    pass,
    details: `valid-sample=${good.valid} duplicate-id-rejected=${!bad.valid} bigint-rejected-no-throw=${exoticRejected && !exoticThrew}`,
  };
}
