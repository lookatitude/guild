/**
 * scripts/lib/ideation-min-build.ts
 *
 * Ideation knowledge-binding — min-build spec resolver (v2.x).
 *
 * When `/guild:ideate` runs with no init wiki present, the backward-then-forward
 * resolver calls `resolveMinBuildSpec` to generate a minimal resolver-built
 * knowledge baseline rather than refusing. The returned spec object is stamped
 * `grounded_in: "init_minimal"` and surfaced to the user as a transparent
 * stopgap — it is NOT a silent substitute for real project knowledge.
 *
 * Spec pointer: docs/v2/lifecycle.html §"Phase continuity" / "A min-build spec [v2.x]"
 *
 * Design constraints:
 *   - Pure: no I/O, no Date.now(), no Math.random() in exported functions.
 *     Any dynamic values (timestamps, run-ids) must be supplied by the caller.
 *   - Default-off / inert: these functions do nothing unless explicitly called.
 *     They do not modify any existing path. Wiring into the ideation skill
 *     is a v2.x concern; this module provides the resolved baseline only.
 *   - Deterministic: same inputs → same output (validators, spec structure).
 *   - Never throws: callers receive typed results; errors surface in results.
 *
 * Usage (library):
 *   import { needsMinBuild, resolveMinBuildSpec } from './ideation-min-build'
 *   if (needsMinBuild(initState)) {
 *     const spec = resolveMinBuildSpec({ hasInitWiki: false, projectFacts })
 *   }
 */

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * The grounded_in discriminator for a resolver-built baseline.
 * Closed set — only "init_minimal" is valid for this module.
 */
export const GROUNDED_IN_INIT_MINIMAL = "init_minimal" as const;
export type GroundedIn = typeof GROUNDED_IN_INIT_MINIMAL;

/**
 * Facts the caller can supply from whatever context is available (CLI args,
 * partial guild.yaml, conversation context).  All fields are optional —
 * the resolver fills in sensible placeholders for missing values.
 */
export interface ProjectFacts {
  /** Best-effort project name (e.g. from cwd basename or partial guild.yaml). */
  name?: string;
  /** Brief description of the project if known. */
  description?: string;
  /** Known primary language/framework. */
  primaryLanguage?: string;
  /** Names of known team members or owners. */
  owners?: string[];
  /** Any constraints already surfaced in the session. */
  knownConstraints?: string[];
}

/**
 * Inputs to the min-build spec resolver.
 */
export interface MinBuildInput {
  /** Whether a usable init wiki exists under .guild/wiki/. */
  hasInitWiki: boolean;
  /** Any project facts the caller has already gathered. */
  projectFacts?: ProjectFacts;
}

/**
 * A minimal spec object produced by the resolver when no init wiki is present.
 *
 * Fields follow the .guild/spec/<slug>.md frontmatter + section conventions
 * used by guild:brainstorm (see .guild/spec/*.md for shape reference).
 * Placeholder strings are clearly marked so the ideation skill can prompt the
 * user to fill them in rather than treating them as real knowledge.
 */
export interface MinBuildSpec {
  /** Discriminator — always "init_minimal" for resolver-built baselines. */
  grounded_in: GroundedIn;
  /**
   * Resolved project goal — either from projectFacts.description or a
   * clearly-marked placeholder prompting the user to provide context.
   */
  goal: string;
  /**
   * Resolved primary audience — from projectFacts or a placeholder.
   */
  audience: string;
  /**
   * Resolved constraints — merges knownConstraints with a standard
   * "no init wiki" gap notice so downstream skills surface the risk.
   */
  constraints: string[];
  /**
   * The specific gap that triggered min-build resolution — always present.
   * Downstream skills must surface this to the user.
   */
  gap: string;
  /**
   * Project name as resolved from facts or inferred placeholder.
   */
  projectName: string;
  /**
   * Primary language/framework if known; empty string otherwise.
   */
  primaryLanguage: string;
  /**
   * ISO-8601 timestamp supplied by the CALLER — never Date.now() inside
   * this module.  Present only when the caller supplies resolvedAt.
   */
  resolvedAt?: string;
}

/**
 * Validation result for a MinBuildSpec (mirrors the validators → {valid,errors}
 * convention used in neighboring scripts/lib/*.ts files).
 */
export interface MinBuildValidation {
  valid: boolean;
  errors: string[];
}

/**
 * The init state shape the `needsMinBuild` predicate inspects.
 * Kept minimal to avoid coupling to a specific init artifact schema.
 */
export interface InitState {
  /** Whether a .guild/wiki/index.md (or equivalent wiki scaffold) exists. */
  hasInitWiki: boolean;
  /**
   * Whether .guild/guild.yaml exists (a weaker signal than hasInitWiki,
   * but relevant when partial init ran without completing the wiki scaffold).
   */
  hasGuildYaml?: boolean;
}

// ── Internal constants ────────────────────────────────────────────────────────

const PLACEHOLDER_GOAL =
  "[PLACEHOLDER — no init wiki: describe what you want to build or improve]";
const PLACEHOLDER_AUDIENCE =
  "[PLACEHOLDER — no init wiki: describe the primary users or consumers]";
const GAP_NOTICE =
  "Missing init wiki: this spec was resolver-built and lacks real project knowledge. " +
  "Run /guild:init to replace this baseline with grounded context.";

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Predicate: true when `/guild:ideate` should trigger the min-build resolver.
 *
 * The sole trigger is the absence of a usable init wiki.  A partial guild.yaml
 * without a wiki still returns true — the wiki is the canonical knowledge
 * baseline for ideation (ref: lifecycle.md §Ideation row, "Required upstream").
 *
 * Pure and deterministic.  No I/O.
 *
 * @param initState  Current init state as observed by the caller.
 * @returns          true when the min-build resolver must run before ideation.
 */
export function needsMinBuild(initState: InitState): boolean {
  return !initState.hasInitWiki;
}

/**
 * Resolve a minimal spec baseline for ideation when no init wiki is present.
 *
 * The caller supplies any project facts already gathered (from CLI args, partial
 * guild.yaml, or conversation context); the resolver fills placeholders for
 * missing values.  The returned spec is stamped `grounded_in: "init_minimal"`
 * and includes a `gap` field that downstream ideation skills must surface to
 * the user.
 *
 * Pure and deterministic: same inputs → identical output.
 * Never throws.  Does not read/write the filesystem.
 * Does not call Date.now() or Math.random().
 *
 * @param input  hasInitWiki flag + optional project facts.
 * @param resolvedAt  Optional ISO-8601 timestamp supplied by the caller to
 *                    stamp the returned spec (for traceability in run artifacts).
 * @returns      A MinBuildSpec the ideation skill can consume directly.
 */
export function resolveMinBuildSpec(
  input: MinBuildInput,
  resolvedAt?: string,
): MinBuildSpec {
  const facts = input.projectFacts ?? {};

  const goal =
    typeof facts.description === "string" && facts.description.trim().length > 0
      ? facts.description.trim()
      : PLACEHOLDER_GOAL;

  const audience =
    Array.isArray(facts.owners) && facts.owners.length > 0
      ? `Known owners/stakeholders: ${facts.owners.join(", ")}`
      : PLACEHOLDER_AUDIENCE;

  const knownConstraints: string[] =
    Array.isArray(facts.knownConstraints) && facts.knownConstraints.length > 0
      ? [...facts.knownConstraints]
      : [];

  // Always append the gap notice so downstream consumers see it even if they
  // only read constraints[], not gap separately.
  const constraints: string[] = [...knownConstraints, GAP_NOTICE];

  const projectName =
    typeof facts.name === "string" && facts.name.trim().length > 0
      ? facts.name.trim()
      : "[unknown-project]";

  const primaryLanguage =
    typeof facts.primaryLanguage === "string" && facts.primaryLanguage.trim().length > 0
      ? facts.primaryLanguage.trim()
      : "";

  const spec: MinBuildSpec = {
    grounded_in: GROUNDED_IN_INIT_MINIMAL,
    goal,
    audience,
    constraints,
    gap: GAP_NOTICE,
    projectName,
    primaryLanguage,
  };

  if (typeof resolvedAt === "string" && resolvedAt.length > 0) {
    spec.resolvedAt = resolvedAt;
  }

  return spec;
}

/**
 * Validate a MinBuildSpec object against the contract requirements.
 *
 * Follows the validators → {valid, errors} convention used in neighboring
 * scripts/lib/*.ts files.  Pure and deterministic.
 *
 * Contract requirements:
 *   - grounded_in must be "init_minimal"
 *   - goal must be a non-empty string
 *   - audience must be a non-empty string
 *   - constraints must be a non-empty array of strings
 *   - gap must be a non-empty string that appears in constraints
 *   - projectName must be a non-empty string
 *
 * @param spec  The spec object to validate.
 * @returns     { valid: boolean, errors: string[] }
 */
export function validateMinBuildSpec(spec: unknown): MinBuildValidation {
  const errors: string[] = [];

  if (spec === null || typeof spec !== "object") {
    return { valid: false, errors: ["spec must be a non-null object"] };
  }

  const s = spec as Record<string, unknown>;

  if (s["grounded_in"] !== GROUNDED_IN_INIT_MINIMAL) {
    errors.push(`grounded_in must be "${GROUNDED_IN_INIT_MINIMAL}", got: ${String(s["grounded_in"])}`);
  }

  if (typeof s["goal"] !== "string" || s["goal"].trim().length === 0) {
    errors.push("goal must be a non-empty string");
  }

  if (typeof s["audience"] !== "string" || s["audience"].trim().length === 0) {
    errors.push("audience must be a non-empty string");
  }

  if (!Array.isArray(s["constraints"]) || s["constraints"].length === 0) {
    errors.push("constraints must be a non-empty array");
  } else {
    const gap = typeof s["gap"] === "string" ? s["gap"] : "";
    const constraintsArr = s["constraints"] as unknown[];
    const allStrings = constraintsArr.every((c) => typeof c === "string");
    if (!allStrings) {
      errors.push("all constraints entries must be strings");
    }
    if (gap.length > 0 && !constraintsArr.includes(gap)) {
      errors.push("gap must appear in constraints[]");
    }
  }

  if (typeof s["gap"] !== "string" || s["gap"].trim().length === 0) {
    errors.push("gap must be a non-empty string");
  }

  if (typeof s["projectName"] !== "string" || s["projectName"].trim().length === 0) {
    errors.push("projectName must be a non-empty string");
  }

  return { valid: errors.length === 0, errors };
}
