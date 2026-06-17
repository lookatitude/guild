/**
 * scripts/lib/template-schema.ts
 *
 * P2-Wave-3 ADDITIVE CONTRACT — `guild.template.v1`: a product template carrying the
 * AC37 field set, with a fail-closed validator and a PURE instantiator that seeds a
 * valid `guild.explore.v1` / `guild.define.v1` skeleton (ADR step 18 / AC37, spec SC-W3-1).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §step 18 (AC37)
 *   .guild/spec/universal-host-p2-wave3.md  SC-W3-1
 *   .guild/plan/universal-host-p2-wave3.md  lane LW3-1
 *
 * WHY: AC37 names "product templates" but freezes no shape. This module designs it
 * additively as `guild.template.v1` so the producer skill (LW3-5) and the evals (LW3-6)
 * bind to ONE stable shape. Required fields (each fails closed on omission/emptiness):
 *   - id                     — STABLE template identifier (non-empty)
 *   - specialists[]          — the roster a run of this template composes (non-empty)
 *   - context_questions[]    — what to ask the operator up front (non-empty)
 *   - artifact_skeletons     — { explore, define } seeds (each instantiates to a valid
 *                              guild.explore.v1 / guild.define.v1 — VALIDATED by the W1
 *                              validators, reused here)
 *   - default_checks[]       — the checks a build of this template runs (non-empty)
 *   - docs_expectations[]    — the docs a finished run must produce (non-empty)
 *   - release_gates[]        — the gates that must pass before release (non-empty)
 *
 * CONTRACT: pure types + `validateTemplateV1()` that **fails closed** on any missing/empty
 * required field, on unknown keys (strict), and on ANY exotic input — NEVER throws. Plus
 * `instantiateTemplate()` — a PURE function that returns `{ explore, define }` artifacts
 * (no I/O, no clock, no process IO at module scope). The instantiator performs ZERO file
 * writes: it NEVER writes/edits a runtime permission, skill, or agent file (AC37 no-self-edit
 * property — proven by the LW3-6 negative test under write-deny instrumentation).
 *
 * Owned by tooling-engineer (LW3-1); consumed by LW3-5 (producer skill), LW3-6 (negatives).
 */

import {
  EXPLORE_SCHEMA_VERSION,
  validateExploreV1,
  type ExploreV1,
} from "./explore-schema.js";
import {
  DEFINE_SCHEMA_VERSION,
  validateDefineV1,
  type AcceptanceCriterion,
  type DefineV1,
} from "./define-schema.js";

// ---------------------------------------------------------------------------
// Schema constant + result shape
// ---------------------------------------------------------------------------

export const TEMPLATE_SCHEMA_VERSION = "guild.template.v1" as const;

/** Fail-closed validator result — `{ valid, errors }` (P1 convention). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Sub-shapes — the artifact skeleton seeds
// ---------------------------------------------------------------------------

/**
 * The `explore` skeleton seed — the `guild.explore.v1` field set WITHOUT `schema_version`
 * (the instantiator stamps it). Validated by reusing `validateExploreV1` after stamping.
 */
export type ExploreSkeleton = Omit<ExploreV1, "schema_version">;

/**
 * The `define` skeleton seed — the `guild.define.v1` field set WITHOUT `schema_version`
 * (the instantiator stamps it). Validated by reusing `validateDefineV1` after stamping.
 */
export type DefineSkeleton = Omit<DefineV1, "schema_version">;

export interface ArtifactSkeletons {
  explore: ExploreSkeleton;
  define: DefineSkeleton;
}

const ARTIFACT_SKELETONS_ALLOWED_KEYS = ["explore", "define"];
// Seed keys = the W1 field sets MINUS schema_version (the instantiator stamps that).
const EXPLORE_SKELETON_ALLOWED_KEYS = [
  "assumptions",
  "evidence_needs",
  "comparables",
  "risks",
  "recommended_next_step",
];
const DEFINE_SKELETON_ALLOWED_KEYS = [
  "acceptance_criteria",
  "user_stories",
  "non_goals",
  "risks",
  "affected_surfaces",
  "test_implications",
];

// ---------------------------------------------------------------------------
// Type — `guild.template.v1`
// ---------------------------------------------------------------------------

export interface TemplateV1 {
  schema_version: typeof TEMPLATE_SCHEMA_VERSION;
  /** STABLE template identifier (e.g. "cli-tool", "web-app"). */
  id: string;
  /** The specialist roster a run of this template composes (must be non-empty). */
  specialists: string[];
  /** What to ask the operator up front (must be non-empty). */
  context_questions: string[];
  /** Seeds that instantiate to a valid explore / define artifact. */
  artifact_skeletons: ArtifactSkeletons;
  /** The checks a build of this template runs (must be non-empty). */
  default_checks: string[];
  /** The docs a finished run must produce (must be non-empty). */
  docs_expectations: string[];
  /** The gates that must pass before release (must be non-empty). */
  release_gates: string[];
}

const TEMPLATE_ALLOWED_KEYS = [
  "schema_version",
  "id",
  "specialists",
  "context_questions",
  "artifact_skeletons",
  "default_checks",
  "docs_expectations",
  "release_gates",
];

// ---------------------------------------------------------------------------
// Shared, never-throwing helpers (local — keeps the module self-contained)
// ---------------------------------------------------------------------------

/** Never-throwing stringify for error messages (guards BigInt/undefined/exotic + throwing toString). */
function show(v: unknown): string {
  if (typeof v === "bigint") return `${v.toString()}n`;
  try {
    const s = JSON.stringify(v);
    if (s !== undefined) return s;
  } catch {
    /* fall through to a safe label */
  }
  // NB: NEVER `String(v)` here — an object with a throwing toString would re-throw.
  try {
    return Object.prototype.toString.call(v);
  } catch {
    return "[unstringifiable]";
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
  field: string,
  label: string
): void {
  const v = obj[field];
  if (!Array.isArray(v)) {
    errors.push(`${label}"${field}" must be an array of non-empty strings`);
    return;
  }
  if (v.length === 0) {
    errors.push(`${label}"${field}" must not be empty (fail-closed required field)`);
    return;
  }
  v.forEach((el, i) => {
    if (typeof el !== "string" || el.trim() === "") {
      errors.push(`${label}"${field}[${i}]" must be a non-empty string`);
    }
  });
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate an unknown value against `guild.template.v1`. Fails closed on any missing/
 * empty required field, unknown key, or an artifact skeleton that would NOT instantiate
 * to a valid explore/define (validated by reusing the W1 validators). Never throws;
 * always returns `{ valid, errors }` even for exotic input.
 */
export function validateTemplateV1(value: unknown): ValidationResult {
  // Fail-closed on hostile input: a Proxy with a throwing trap (ownKeys/get) or a
  // throwing getter must return {valid:false}, never propagate. (codex G-lane FIX.)
  try {
    return validateTemplateV1Inner(value);
  } catch (err) {
    return {
      valid: false,
      errors: [`template validation threw on exotic input: ${err instanceof Error ? err.message : "(unknown error)"}`],
    };
  }
}
function validateTemplateV1Inner(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["template artifact must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;

  rejectUnknownKeys(errors, o, TEMPLATE_ALLOWED_KEYS, "template artifact");

  if (typeof o["schema_version"] !== "string" || o["schema_version"] !== TEMPLATE_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${TEMPLATE_SCHEMA_VERSION}"; got ${show(o["schema_version"])}`);
  }

  if (typeof o["id"] !== "string" || o["id"].trim() === "") {
    errors.push(`"id" must be a non-empty stable string`);
  }

  requireNonEmptyStringArray(errors, o, "specialists", "");
  requireNonEmptyStringArray(errors, o, "context_questions", "");
  requireNonEmptyStringArray(errors, o, "default_checks", "");
  requireNonEmptyStringArray(errors, o, "docs_expectations", "");
  requireNonEmptyStringArray(errors, o, "release_gates", "");

  // artifact_skeletons — { explore, define }; each seed must instantiate to a valid
  // W1 artifact. We reuse validateExploreV1 / validateDefineV1 (the authoritative shapes).
  const sk = o["artifact_skeletons"];
  if (typeof sk !== "object" || sk === null || Array.isArray(sk)) {
    errors.push(`"artifact_skeletons" must be an object { explore, define }`);
  } else {
    const s = sk as Record<string, unknown>;
    rejectUnknownKeys(errors, s, ARTIFACT_SKELETONS_ALLOWED_KEYS, "artifact_skeletons");

    // explore seed — strict keys (no schema_version) + reuse validateExploreV1 on the stamped seed.
    const ex = s["explore"];
    if (typeof ex !== "object" || ex === null || Array.isArray(ex)) {
      errors.push(`"artifact_skeletons.explore" must be an object`);
    } else {
      rejectUnknownKeys(
        errors,
        ex as Record<string, unknown>,
        EXPLORE_SKELETON_ALLOWED_KEYS,
        "artifact_skeletons.explore"
      );
      const r = validateExploreV1({ ...(ex as object), schema_version: EXPLORE_SCHEMA_VERSION });
      for (const e of r.errors) errors.push(`artifact_skeletons.explore → ${e}`);
    }

    // define seed — strict keys (no schema_version) + reuse validateDefineV1 on the stamped seed.
    const df = s["define"];
    if (typeof df !== "object" || df === null || Array.isArray(df)) {
      errors.push(`"artifact_skeletons.define" must be an object`);
    } else {
      rejectUnknownKeys(
        errors,
        df as Record<string, unknown>,
        DEFINE_SKELETON_ALLOWED_KEYS,
        "artifact_skeletons.define"
      );
      const r = validateDefineV1({ ...(df as object), schema_version: DEFINE_SCHEMA_VERSION });
      for (const e of r.errors) errors.push(`artifact_skeletons.define → ${e}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows to TemplateV1 after passing validation. */
export function isTemplateV1(value: unknown): value is TemplateV1 {
  return validateTemplateV1(value).valid;
}

// ---------------------------------------------------------------------------
// Instantiator — PURE (no I/O, AC37 no-self-edit)
// ---------------------------------------------------------------------------

/** What `instantiateTemplate` returns: a seeded, valid explore + define skeleton pair. */
export interface InstantiateResult {
  explore: ExploreV1;
  define: DefineV1;
}

/**
 * Seed a valid `guild.explore.v1` + `guild.define.v1` skeleton from a template.
 *
 * PURE FUNCTION — AC37 no-self-edit property. It performs NO file I/O of ANY kind: it
 * NEVER writes or edits a runtime permission, skill, or agent file. It returns fresh,
 * deeply-copied data objects (the caller decides whether/where to persist them). The
 * returned artifacts are GUARANTEED valid against the W1 validators when the template is
 * valid; an invalid template throws synchronously BEFORE producing anything (fail-closed).
 *
 * @throws Error if `template` does not pass `validateTemplateV1` (fail-closed; never
 *         emits a partial/invalid artifact).
 */
export function instantiateTemplate(template: unknown): InstantiateResult {
  const v = validateTemplateV1(template);
  if (!v.valid) {
    throw new Error(`cannot instantiate invalid guild.template.v1: ${v.errors.join("; ")}`);
  }
  const t = template as TemplateV1;

  // Deep-copy the seeds (no shared mutable references with the template), stamp the
  // schema_version. No clock, no random, no fs — deterministic + pure.
  const explore: ExploreV1 = {
    schema_version: EXPLORE_SCHEMA_VERSION,
    assumptions: [...t.artifact_skeletons.explore.assumptions],
    evidence_needs: [...t.artifact_skeletons.explore.evidence_needs],
    comparables: [...t.artifact_skeletons.explore.comparables],
    risks: [...t.artifact_skeletons.explore.risks],
    recommended_next_step: t.artifact_skeletons.explore.recommended_next_step,
  };

  const define: DefineV1 = {
    schema_version: DEFINE_SCHEMA_VERSION,
    acceptance_criteria: t.artifact_skeletons.define.acceptance_criteria.map(
      (c: AcceptanceCriterion): AcceptanceCriterion => ({ id: c.id, text: c.text })
    ),
    user_stories: [...t.artifact_skeletons.define.user_stories],
    non_goals: [...t.artifact_skeletons.define.non_goals],
    risks: [...t.artifact_skeletons.define.risks],
    affected_surfaces: [...t.artifact_skeletons.define.affected_surfaces],
    test_implications: [...t.artifact_skeletons.define.test_implications],
  };

  return { explore, define };
}

// ---------------------------------------------------------------------------
// Deterministic example (for LW3-6 fixtures)
// ---------------------------------------------------------------------------

/** A valid `guild.template.v1` sample. Frozen, deterministic — no clock/random. */
export const TEMPLATE_V1_EXAMPLE: TemplateV1 = {
  schema_version: TEMPLATE_SCHEMA_VERSION,
  id: "cli-tool",
  specialists: ["architect", "backend", "qa", "doc-writer"],
  context_questions: [
    "What is the primary command the tool exposes?",
    "Who runs it — humans at a terminal, CI, or both?",
  ],
  artifact_skeletons: {
    explore: {
      assumptions: ["users live in the terminal", "the tool ships as a single binary"],
      evidence_needs: ["how many target users prefer a CLI over a GUI"],
      comparables: ["ripgrep", "fd", "gh"],
      risks: ["discoverability is lower than a GUI"],
      recommended_next_step: "draft the command surface and run a 5-user dry-run",
    },
    define: {
      acceptance_criteria: [
        { id: "AC-1", text: "The tool runs the primary command with zero config." },
        { id: "AC-2", text: "`--help` documents every flag." },
      ],
      user_stories: ["As an operator, I run one command and get the result on stdout."],
      non_goals: ["No GUI in the first release."],
      risks: ["flag surface grows unbounded"],
      affected_surfaces: ["the CLI entrypoint", "argument parsing"],
      test_implications: ["a golden-output test per subcommand"],
    },
  },
  default_checks: ["unit tests green", "`--help` snapshot matches"],
  docs_expectations: ["a README with a quickstart", "a man-page / `--help` reference"],
  release_gates: ["all tests pass", "changelog entry written"],
};

// ---------------------------------------------------------------------------
// Import-pure self-check (NO process IO at module scope — F8-F11). LW3-6 may call it.
// ---------------------------------------------------------------------------

/**
 * Deterministic smoke check. Returns `{ pass, details }`; performs NO process IO and
 * never exits. Confirms the valid sample passes, that it instantiates to artifacts the
 * W1 validators accept, that a missing required field fails closed, and that an exotic
 * non-string schema_version fails closed WITHOUT throwing.
 */
export function runSelfCheck(): { pass: boolean; details: string } {
  const good = validateTemplateV1(TEMPLATE_V1_EXAMPLE);

  // Instantiation produces W1-valid artifacts.
  let instantiatesValid = false;
  try {
    const { explore, define } = instantiateTemplate(TEMPLATE_V1_EXAMPLE);
    instantiatesValid = validateExploreV1(explore).valid && validateDefineV1(define).valid;
  } catch {
    instantiatesValid = false;
  }

  // Missing a required field fails closed.
  const { specialists: _drop, ...missing } = TEMPLATE_V1_EXAMPLE;
  const bad = validateTemplateV1(missing);

  // Exotic non-string schema_version is rejected without throwing.
  let exoticThrew = false;
  let exoticRejected = false;
  try {
    exoticRejected = !validateTemplateV1({ ...TEMPLATE_V1_EXAMPLE, schema_version: 123 as unknown }).valid;
  } catch {
    exoticThrew = true;
  }

  const pass = good.valid && instantiatesValid && !bad.valid && exoticRejected && !exoticThrew;
  return {
    pass,
    details: `valid-sample=${good.valid} instantiates-valid=${instantiatesValid} missing-field-rejected=${!bad.valid} exotic-rejected-no-throw=${exoticRejected && !exoticThrew}`,
  };
}
