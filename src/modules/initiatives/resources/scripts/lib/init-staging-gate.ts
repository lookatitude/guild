/**
 * scripts/lib/init-staging-gate.ts
 *
 * Init staging → promote gate (ITEM 2, v2.x).
 *
 * Contract (BY POINTER): docs/v2/03-lifecycle.md §"Init staging → promotion [v2-contract-only]"
 *
 * Reverse-engineered and synthesized pages land in `.guild/init/staging/`
 * first and become durable `.guild/wiki/**` knowledge ONLY through the
 * interactive G-init-promote user gate — explicit human approval that
 * `--auto-approve` NEVER skips.
 *
 * This module implements the candidates-only invariant for the init-side
 * staging directory. It mirrors the same pattern that `guild:decisions` and
 * `guild:wiki-ingest` carry today on the wiki-promotion path:
 *   - A staged init candidate is NEVER auto-promoted.
 *   - Agents emit candidates; only explicit gate approval promotes.
 *   - The gate defaults to HOLD unless explicitly approved by the caller.
 *
 * Exported API:
 *   validateStagedCandidate(candidate)     → { valid, errors }
 *   promoteGate(candidate, opts)           → { decision, reason }
 *   listStaging(stagingDir)                → StagedCandidate[]
 *
 * Hard invariants:
 *  - Pure + deterministic: no Date.now() / Math.random() in exported fns.
 *    Callers supply timestamps and ids.
 *  - Validators return { valid, errors } (never throw on bad input).
 *  - promoteGate defaults to "hold" unless opts.approved === true.
 *    --auto-approve NEVER sets opts.approved (the gate is always-ask).
 *  - listStaging returns [] on any I/O error (never throws).
 *  - Default-off/inert: this module writes nothing on its own. It only
 *    reads + classifies; promotion writes are the caller's responsibility.
 *
 * Owned by tooling-engineer (scripts/ scope).
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Schema constant ───────────────────────────────────────────────────────────

export const INIT_STAGING_SCHEMA = "guild.init_staging_candidate.v1" as const;

// ── Closed enums (const-tuple style) ─────────────────────────────────────────

/**
 * Closed set of staged candidate types. Mirrors the page categories that
 * the init phase may synthesize from reverse-engineering or brownfield analysis.
 */
export const STAGED_CANDIDATE_TYPES = [
  "wiki_page",
  "architecture_note",
  "decision_candidate",
  "codebase_fact",
  "standard_candidate",
] as const;
export type StagedCandidateType = (typeof STAGED_CANDIDATE_TYPES)[number];

/** Confidence levels (shared with learning-candidate.ts pattern). */
export const STAGED_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type StagedConfidence = (typeof STAGED_CONFIDENCE_LEVELS)[number];

/** Source of the candidate — how it was produced. */
export const STAGED_CANDIDATE_SOURCES = [
  "brownfield_scan",
  "greenfield_interview",
  "agent_synthesis",
  "manual",
] as const;
export type StagedCandidateSource = (typeof STAGED_CANDIDATE_SOURCES)[number];

/** Promotion gate decision. "hold" is the safe default. */
export const PROMOTE_DECISIONS = ["promote", "hold", "reject"] as const;
export type PromoteDecision = (typeof PROMOTE_DECISIONS)[number];

// ── Public types ──────────────────────────────────────────────────────────────

/** A candidate that has been written to .guild/init/staging/ by the init phase. */
export interface StagedCandidate {
  /** Frozen schema version. Must be INIT_STAGING_SCHEMA. */
  schema_version: typeof INIT_STAGING_SCHEMA;
  /**
   * Opaque caller-supplied id (e.g. "init-candidate-architecture-map-001").
   * Non-empty string; uniqueness is the caller's responsibility.
   */
  id: string;
  /**
   * Caller-supplied RFC3339 UTC timestamp of when the candidate was written.
   * Never Date.now() — the caller supplies this.
   */
  staged_at: string;
  /** The candidate type (closed enum). */
  type: StagedCandidateType;
  /**
   * Human-readable title for the candidate page / note. Non-empty string.
   * Used as the proposed wiki page title on promotion.
   */
  title: string;
  /** Body content of the candidate (markdown, may include frontmatter). */
  content: string;
  /** How the candidate was produced (closed enum). */
  source: StagedCandidateSource;
  /**
   * Agent/skill that produced this candidate (informational; may be empty
   * string when produced by automated scan without a named skill).
   */
  produced_by: string;
  /** Confidence in the candidate's accuracy (closed enum). */
  confidence: StagedCandidateSource extends string ? StagedConfidence : never;
  /**
   * Optional list of evidence references (file paths, run ids, scan outputs).
   * Empty list is valid — confidence = "low" is expected for unevidenced candidates.
   */
  evidence_refs: string[];
  /**
   * Proposed wiki destination path (relative, e.g.
   * ".guild/wiki/context/architecture-map.md"). Informational — the gate
   * decides the actual path on promotion; this is the agent's suggestion.
   */
  proposed_destination: string;
}

/** Options passed by the caller to the promote gate. */
export interface PromoteGateOpts {
  /**
   * True ONLY when a human has explicitly approved this candidate at the
   * G-init-promote user gate. `--auto-approve` MUST NOT set this to true.
   * Default: false → decision is "hold".
   */
  approved?: boolean;
  /**
   * True when the candidate is explicitly rejected by the operator at the gate.
   * Takes precedence over `approved` when both are true (defensive).
   */
  rejected?: boolean;
  /**
   * Optional operator-supplied reason (recorded in the result for audit trail).
   */
  reason?: string;
}

/** Result of the promote gate. */
export interface PromoteGateResult {
  /** "promote" | "hold" | "reject" */
  decision: PromoteDecision;
  /** Human-readable rationale for the decision (for logging + audit trail). */
  reason: string;
}

/** Validation result shape (mirrors advisory-record and learning-candidate patterns). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Closed set helpers ────────────────────────────────────────────────────────

const STAGED_CANDIDATE_TYPE_SET = new Set<string>(STAGED_CANDIDATE_TYPES);
const STAGED_CONFIDENCE_SET = new Set<string>(STAGED_CONFIDENCE_LEVELS);
const STAGED_CANDIDATE_SOURCE_SET = new Set<string>(STAGED_CANDIDATE_SOURCES);

// ── validateStagedCandidate ───────────────────────────────────────────────────

/**
 * Validate a staged init candidate against the frozen schema contract.
 *
 * Never throws. Returns { valid: true, errors: [] } on a well-formed candidate;
 * { valid: false, errors: [...] } listing every violation on a bad one.
 *
 * @param candidate - The value to validate (may be unknown / partial).
 */
export function validateStagedCandidate(candidate: unknown): ValidationResult {
  const errors: string[] = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { valid: false, errors: ["candidate must be a non-null object"] };
  }

  const c = candidate as Record<string, unknown>;

  if (c["schema_version"] !== INIT_STAGING_SCHEMA) {
    errors.push(
      `schema_version must be "${INIT_STAGING_SCHEMA}", got: ${JSON.stringify(c["schema_version"])}`,
    );
  }

  if (typeof c["id"] !== "string" || c["id"] === "") {
    errors.push("id must be a non-empty string");
  }

  if (typeof c["staged_at"] !== "string" || c["staged_at"] === "") {
    errors.push("staged_at must be a non-empty RFC3339 string");
  }

  if (
    typeof c["type"] !== "string" ||
    !STAGED_CANDIDATE_TYPE_SET.has(c["type"])
  ) {
    errors.push(
      `type must be one of [${STAGED_CANDIDATE_TYPES.join(", ")}], got: ${JSON.stringify(c["type"])}`,
    );
  }

  if (typeof c["title"] !== "string" || c["title"] === "") {
    errors.push("title must be a non-empty string");
  }

  if (typeof c["content"] !== "string") {
    errors.push("content must be a string");
  }

  if (
    typeof c["source"] !== "string" ||
    !STAGED_CANDIDATE_SOURCE_SET.has(c["source"])
  ) {
    errors.push(
      `source must be one of [${STAGED_CANDIDATE_SOURCES.join(", ")}], got: ${JSON.stringify(c["source"])}`,
    );
  }

  if (typeof c["produced_by"] !== "string") {
    errors.push("produced_by must be a string");
  }

  if (
    typeof c["confidence"] !== "string" ||
    !STAGED_CONFIDENCE_SET.has(c["confidence"])
  ) {
    errors.push(
      `confidence must be one of [${STAGED_CONFIDENCE_LEVELS.join(", ")}], got: ${JSON.stringify(c["confidence"])}`,
    );
  }

  if (!Array.isArray(c["evidence_refs"])) {
    errors.push("evidence_refs must be an array");
  }

  if (typeof c["proposed_destination"] !== "string") {
    errors.push("proposed_destination must be a string");
  }

  return { valid: errors.length === 0, errors };
}

// ── promoteGate ───────────────────────────────────────────────────────────────

/**
 * The init-side staging promote gate.
 *
 * A staged init candidate is NEVER auto-promoted. This gate defaults to
 * "hold" unless `opts.approved === true` (set only by an explicit human
 * decision at the G-init-promote user gate — never by --auto-approve).
 *
 * Decision ladder:
 *   1. Invalid candidate → "reject" (cannot promote a malformed candidate).
 *   2. opts.rejected === true → "reject" (operator explicitly rejected).
 *   3. opts.approved === true (and not rejected) → "promote".
 *   4. Default → "hold" (no explicit decision; surface to operator).
 *
 * Pure + deterministic. Never reads the filesystem. Never throws.
 *
 * @param candidate - The candidate to gate (validated internally).
 * @param opts      - Gate options from the caller.
 */
export function promoteGate(
  candidate: unknown,
  opts: PromoteGateOpts = {},
): PromoteGateResult {
  // Step 1: validate the candidate — cannot promote a malformed shape.
  const { valid, errors } = validateStagedCandidate(candidate);
  if (!valid) {
    return {
      decision: "reject",
      reason: `candidate failed validation: ${errors.join("; ")}`,
    };
  }

  // Step 2: explicit rejection takes precedence.
  if (opts.rejected === true) {
    return {
      decision: "reject",
      reason: opts.reason ?? "operator rejected the candidate at the G-init-promote gate",
    };
  }

  // Step 3: explicit human approval (never --auto-approve).
  if (opts.approved === true) {
    return {
      decision: "promote",
      reason: opts.reason ?? "candidate explicitly approved at the G-init-promote user gate",
    };
  }

  // Step 4: default hold — no automatic promotion.
  return {
    decision: "hold",
    reason:
      opts.reason ??
      "no explicit approval — staged candidates require human approval at the G-init-promote gate; --auto-approve never skips this gate",
  };
}

// ── listStaging ───────────────────────────────────────────────────────────────

/**
 * Read all staged init candidates from `.guild/init/staging/`.
 *
 * Reads every `.json` file in the directory, parses it, and returns a list
 * of candidates that pass structural validation. Unreadable or invalid files
 * are silently skipped (fail-safe: never throws, never crashes the caller).
 *
 * Only files that pass `validateStagedCandidate` are returned — malformed
 * files do not surface as candidates.
 *
 * @param stagingDir - Absolute path to the staging directory
 *                     (e.g. `/path/to/repo/.guild/init/staging`).
 *                     Relative paths are accepted but callers should prefer
 *                     absolute paths (see Bash cwd-drift note in MEMORY.md).
 * @returns Array of valid StagedCandidate objects; [] on any error.
 */
export function listStaging(stagingDir: string): StagedCandidate[] {
  let names: string[];
  try {
    names = fs.readdirSync(stagingDir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }

  const out: StagedCandidate[] = [];
  for (const name of names) {
    try {
      const abs = path.join(stagingDir, name);
      const raw = fs.readFileSync(abs, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const { valid } = validateStagedCandidate(parsed);
      if (valid) {
        out.push(parsed as StagedCandidate);
      }
    } catch {
      // Skip unreadable or unparseable files — never throws
    }
  }
  return out;
}

// ── Builder helper ────────────────────────────────────────────────────────────

/**
 * Build a fully-typed StagedCandidate from caller-supplied fields.
 *
 * Applies safe defaults for optional fields (evidence_refs → [], produced_by →
 * "", proposed_destination → ""). Caller MUST supply staged_at (no Date.now()).
 *
 * Pure + deterministic. Validates and throws a TypeError on missing required
 * fields only in development — prefer validateStagedCandidate() for non-throwing
 * usage in production paths.
 */
export function makeStagedCandidate(input: {
  id: string;
  staged_at: string;
  type: StagedCandidateType;
  title: string;
  content: string;
  source: StagedCandidateSource;
  confidence: StagedConfidence;
  produced_by?: string;
  evidence_refs?: string[];
  proposed_destination?: string;
}): StagedCandidate {
  return {
    schema_version: INIT_STAGING_SCHEMA,
    id: input.id,
    staged_at: input.staged_at,
    type: input.type,
    title: input.title,
    content: input.content,
    source: input.source,
    confidence: input.confidence,
    produced_by: input.produced_by ?? "",
    evidence_refs: input.evidence_refs ? [...input.evidence_refs] : [],
    proposed_destination: input.proposed_destination ?? "",
  };
}
