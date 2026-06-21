/**
 * scripts/lib/advisory-record.ts
 *
 * guild.advisory.v1 typed record — the durable outcome of an advisory panel
 * (question, advisors + tiers, per-advisor recommendation + confidence,
 * synthesis, decision link). Bound by pointer to:
 *   docs/v2/09-adversarial-review.md §Advisory vs adversarial loops
 *   docs/knowledge/lifecycle/workflow-operating-model.md §Advisory records
 *
 * Contract (frozen, [v2-contract-only] in v2.0 — no writer shipped then):
 *   schema_version:      "guild.advisory.v1"
 *   id:                  caller-supplied opaque string (e.g. "advisory-<slug>-001")
 *   run_id:              the enclosing run, or null for out-of-run panels
 *   initiative_id:       initiative slug, or null for one-off panels
 *   phase:               lifecycle phase (ideation | planning | execution …)
 *   backend:             execution backend that ran the panel
 *   question:            the question the panel was asked
 *   advisors:            one entry per advisor (role + model_tier + host)
 *   recommendations:     per-advisor output (role + recommendation + confidence)
 *   synthesis:           reconciled panel output
 *   decision_link:       optional path to the decision artifact
 *   unresolved_questions: open questions after the panel (may be empty)
 *   confidence:          overall panel confidence
 *   recorded_at:         caller-supplied RFC3339 UTC timestamp
 *
 * Hard invariants:
 *  - Deterministic: no Date.now() / Math.random() inside exported functions.
 *    The CALLER supplies timestamps and ids.
 *  - Validators return { valid, errors } (never throw on bad input).
 *  - The append/write helper is fail-closed: it writes atomically (write to a
 *    temp file and rename to the target path) and returns {written,path} or
 *    {written:false,error}.
 *  - Reading a config key not present in read-guild-config.ts is done
 *    defensively with a safe default — no import of that module needed here.
 *
 * Owned by tooling-engineer. Panel skills wire this when they persist an
 * advisory outcome to the filesystem artifact bus.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Schema constant ───────────────────────────────────────────────────────────

export const ADVISORY_RECORD_SCHEMA = "guild.advisory.v1" as const;

// ── Closed enums ──────────────────────────────────────────────────────────────

/** Advisory panel execution backends (mirrors workflow-operating-model.md). */
export const ADVISORY_BACKENDS = [
  "tmux_team",
  "host_subagents",
  "single_agent",
] as const;
export type AdvisoryBackend = (typeof ADVISORY_BACKENDS)[number];

/**
 * Advisory SUBSTRATE — the role-resolved advisory HOST that gives the advice
 * (universal-host P1-L0, contract C1). This is a DISTINCT axis from `backend`:
 *   - `backend`   = the dispatch MECHANISM (tmux_team | host_subagents | single_agent)
 *   - `substrate` = WHICH host produces the advice (the resolved roles.advisory)
 * Do NOT overload `backend` with the provider. Additive + back-compatible: the field
 * is optional and an ABSENT `substrate` means the default local advisor —
 * `"claude-code-cli"` (legacy `"claude"` records remain valid).
 * The routing change (populate from roles.advisory) lands in P1-L8; the schema field
 * is the P1-L0 additive migration.
 */
export const ADVISORY_SUBSTRATES = [
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector",
  // Legacy substrate labels accepted for older records.
  "claude",
  "codex",
  ".agents",
  "pi",
  "antigravity",
] as const;
export type AdvisorySubstrate = (typeof ADVISORY_SUBSTRATES)[number];

/** Default advisory substrate when none is recorded (back-compat: absent ⇒ local Claude). */
export const DEFAULT_ADVISORY_SUBSTRATE: AdvisorySubstrate = "claude-code-cli";

/** Overall (and per-advisor) confidence scale. */
export const ADVISORY_CONFIDENCE = ["high", "medium", "low"] as const;
export type AdvisoryConfidence = (typeof ADVISORY_CONFIDENCE)[number];

/** Lifecycle phase tokens (superset — advisory panels may run across phases). */
export const ADVISORY_PHASES = [
  "init",
  "ideation",
  "planning",
  "execution",
  "review",
  "ops",
  "reflect",
] as const;
export type AdvisoryPhase = (typeof ADVISORY_PHASES)[number];

// ── Sub-shapes ────────────────────────────────────────────────────────────────

/** One advisor entry: the agent that participated in the panel. */
export interface AdvisorEntry {
  /** Role slug (e.g. "product", "architecture", "security", "escalation_reviewer"). */
  role: string;
  /** Cost tier hint for the advisor's model selection. */
  model_tier: "cheap" | "mid" | "powerful";
  /** Optional host family (e.g. "claude-code", "codex"). */
  host?: string;
}

/** Per-advisor recommendation from the panel round. */
export interface AdvisorRecommendation {
  /** Matches an AdvisorEntry.role in the same record. */
  role: string;
  /** Free-text recommendation text. */
  recommendation: string;
  /** Advisor's own confidence in their recommendation. */
  confidence: AdvisoryConfidence;
}

// ── Primary record type ───────────────────────────────────────────────────────

/** The durable guild.advisory.v1 record (panel outcome). */
export interface AdvisoryRecord {
  schema_version: typeof ADVISORY_RECORD_SCHEMA;
  /** Opaque id; caller convention: "advisory-<slug>-<NNN>". */
  id: string;
  /** Enclosing run id, or null when the panel ran outside a lifecycle run. */
  run_id: string | null;
  /** Initiative slug, or null for one-off panels. */
  initiative_id: string | null;
  /** Lifecycle phase in which the panel ran. */
  phase: string;
  /** Backend that executed the panel (dispatch mechanism — NOT the provider). */
  backend: AdvisoryBackend;
  /**
   * Role-resolved advisory substrate — WHICH host gave the advice (C1). Optional +
   * back-compatible: when absent, consumers treat it as the default local advisor
   * (`DEFAULT_ADVISORY_SUBSTRATE` = "claude-code-cli"). Distinct from `backend`.
   */
  substrate?: AdvisorySubstrate;
  /** The question the panel was asked. */
  question: string;
  /** Participants (ordered). */
  advisors: AdvisorEntry[];
  /** Per-advisor outputs (ordered, matching advisors by role). */
  recommendations: AdvisorRecommendation[];
  /** Reconciled synthesis of all recommendations. */
  synthesis: string;
  /** Path to the decision artifact, if one was written. Optional. */
  decision_link?: string;
  /** Open questions after the panel (empty array when fully resolved). */
  unresolved_questions: string[];
  /** Overall panel confidence (caller-assessed, or derived from recommendations). */
  confidence: AdvisoryConfidence;
  /** RFC3339 UTC timestamp — supplied by the caller. */
  recorded_at: string;
}

// ── Closed-enum sets (used for validation) ────────────────────────────────────

const BACKEND_SET = new Set<string>(ADVISORY_BACKENDS);
const CONFIDENCE_SET = new Set<string>(ADVISORY_CONFIDENCE);
const MODEL_TIER_SET = new Set<string>(["cheap", "mid", "powerful"]);
const SUBSTRATE_SET = new Set<string>(ADVISORY_SUBSTRATES);

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Build a fully-typed AdvisoryRecord. The caller must supply `recorded_at`
 * (an RFC3339 UTC string) and `id`; this function never calls Date.now().
 *
 * Defensive defaults:
 *  - `run_id` defaults to null when absent.
 *  - `initiative_id` defaults to null when absent.
 *  - `unresolved_questions` defaults to [].
 *  - `decision_link` is omitted when not supplied.
 */
export function makeAdvisoryRecord(input: {
  id: string;
  recorded_at: string;
  phase: string;
  backend: AdvisoryBackend;
  question: string;
  advisors: AdvisorEntry[];
  recommendations: AdvisorRecommendation[];
  synthesis: string;
  confidence: AdvisoryConfidence;
  run_id?: string | null;
  initiative_id?: string | null;
  unresolved_questions?: string[];
  decision_link?: string;
  /** C1: role-resolved advisory substrate. Omitted ⇒ absent ⇒ default local Claude. */
  substrate?: AdvisorySubstrate;
}): AdvisoryRecord {
  const rec: AdvisoryRecord = {
    schema_version: ADVISORY_RECORD_SCHEMA,
    id: input.id,
    run_id: input.run_id ?? null,
    initiative_id: input.initiative_id ?? null,
    phase: input.phase,
    backend: input.backend,
    question: input.question,
    // Shallow-copy arrays so the caller's originals are not mutated.
    advisors: input.advisors.map((a) => ({ ...a })),
    recommendations: input.recommendations.map((r) => ({ ...r })),
    synthesis: input.synthesis,
    unresolved_questions: (input.unresolved_questions ?? []).slice(),
    confidence: input.confidence,
    recorded_at: input.recorded_at,
  };
  if (input.decision_link !== undefined) {
    rec.decision_link = input.decision_link;
  }
  // C1: include substrate only when supplied — keeps existing records byte-identical
  // (absent ⇒ default "claude" semantics), so old fixtures still validate unchanged.
  if (input.substrate !== undefined) {
    rec.substrate = input.substrate;
  }
  return rec;
}

// ── Validator ─────────────────────────────────────────────────────────────────

/**
 * Structural + closed-enum validation of an AdvisoryRecord.
 * Returns `{ valid: true, errors: [] }` on a well-formed record, or
 * `{ valid: false, errors: string[] }` listing every violation found.
 *
 * Contract: never throws on any input — always returns { valid, errors }.
 */
export function validateAdvisoryRecord(x: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!x || typeof x !== "object" || Array.isArray(x)) {
    return { valid: false, errors: ["advisory record is not an object"] };
  }
  const r = x as Record<string, unknown>;

  // schema_version
  if (r["schema_version"] !== ADVISORY_RECORD_SCHEMA) {
    errors.push(
      `schema_version must be "${ADVISORY_RECORD_SCHEMA}" (got ${JSON.stringify(r["schema_version"])})`
    );
  }

  // id
  if (typeof r["id"] !== "string" || r["id"] === "") {
    errors.push(`"id" must be a non-empty string`);
  }

  // run_id (string or null)
  if (r["run_id"] !== null && typeof r["run_id"] !== "string") {
    errors.push(`"run_id" must be a string or null`);
  }

  // initiative_id (string or null)
  if (r["initiative_id"] !== null && typeof r["initiative_id"] !== "string") {
    errors.push(`"initiative_id" must be a string or null`);
  }

  // phase
  if (typeof r["phase"] !== "string" || r["phase"] === "") {
    errors.push(`"phase" must be a non-empty string`);
  }

  // backend
  if (!BACKEND_SET.has(r["backend"] as string)) {
    errors.push(
      `"backend" must be one of ${ADVISORY_BACKENDS.join(" | ")} (got ${JSON.stringify(r["backend"])})`
    );
  }

  // substrate (C1) — OPTIONAL; when present must be a known substrate. Absent is
  // valid + means the default local Claude (back-compat: pre-P1 records have no substrate).
  if (r["substrate"] !== undefined && !SUBSTRATE_SET.has(r["substrate"] as string)) {
    errors.push(
      `"substrate" (when present) must be one of ${ADVISORY_SUBSTRATES.join(" | ")} (got ${JSON.stringify(r["substrate"])})`
    );
  }

  // question
  if (typeof r["question"] !== "string" || r["question"] === "") {
    errors.push(`"question" must be a non-empty string`);
  }

  // advisors
  if (!Array.isArray(r["advisors"])) {
    errors.push(`"advisors" must be an array`);
  } else {
    (r["advisors"] as unknown[]).forEach((a, i) => {
      if (!a || typeof a !== "object" || Array.isArray(a)) {
        errors.push(`advisors[${i}] is not an object`);
        return;
      }
      const ae = a as Record<string, unknown>;
      if (typeof ae["role"] !== "string" || ae["role"] === "") {
        errors.push(`advisors[${i}].role must be a non-empty string`);
      }
      if (!MODEL_TIER_SET.has(ae["model_tier"] as string)) {
        errors.push(
          `advisors[${i}].model_tier must be cheap | mid | powerful (got ${JSON.stringify(ae["model_tier"])})`
        );
      }
    });
  }

  // recommendations
  if (!Array.isArray(r["recommendations"])) {
    errors.push(`"recommendations" must be an array`);
  } else {
    (r["recommendations"] as unknown[]).forEach((rec, i) => {
      if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
        errors.push(`recommendations[${i}] is not an object`);
        return;
      }
      const rv = rec as Record<string, unknown>;
      if (typeof rv["role"] !== "string" || rv["role"] === "") {
        errors.push(`recommendations[${i}].role must be a non-empty string`);
      }
      if (typeof rv["recommendation"] !== "string" || rv["recommendation"] === "") {
        errors.push(`recommendations[${i}].recommendation must be a non-empty string`);
      }
      if (!CONFIDENCE_SET.has(rv["confidence"] as string)) {
        errors.push(
          `recommendations[${i}].confidence must be high | medium | low (got ${JSON.stringify(rv["confidence"])})`
        );
      }
    });
  }

  // synthesis
  if (typeof r["synthesis"] !== "string" || r["synthesis"] === "") {
    errors.push(`"synthesis" must be a non-empty string`);
  }

  // unresolved_questions
  if (!Array.isArray(r["unresolved_questions"])) {
    errors.push(`"unresolved_questions" must be an array`);
  }

  // confidence
  if (!CONFIDENCE_SET.has(r["confidence"] as string)) {
    errors.push(
      `"confidence" must be high | medium | low (got ${JSON.stringify(r["confidence"])})`
    );
  }

  // recorded_at
  if (typeof r["recorded_at"] !== "string" || r["recorded_at"] === "") {
    errors.push(`"recorded_at" must be a non-empty string`);
  }

  return { valid: errors.length === 0, errors };
}

// ── Append/write helper ───────────────────────────────────────────────────────

/** Result of an appendAdvisoryRecord call. */
export interface AppendResult {
  /** True iff the record was written successfully. */
  written: boolean;
  /** Absolute path to the written file (present iff written === true). */
  path?: string;
  /** Error message (present iff written === false). */
  error?: string;
}

/**
 * Validate and write a single AdvisoryRecord as a JSON object to `outPath`.
 *
 * - Validates the record first; returns `{written:false, error}` on invalid input.
 * - Writes atomically: writes to a sibling temp file then renames to `outPath`.
 *   This ensures the target is either absent or contains a complete record — a
 *   partial write cannot corrupt a prior durable record.
 * - Creates parent directories as needed (mkdirSync recursive).
 * - Returns `{ written: true, path: outPath }` on success.
 * - Returns `{ written: false, error }` on any failure; never throws.
 *
 * Caller note: the advisory record is ONE JSON object per file. The naming
 * convention for panel skills is:
 *   `.guild/runs/<run-id>/advisory/<advisory-id>.json`
 *
 * @param record   The record to persist.
 * @param outPath  Absolute destination path.
 * @param fsImpl   Optional injectable fs seam (for tests). Defaults to real fs.
 */
export function appendAdvisoryRecord(
  record: AdvisoryRecord,
  outPath: string,
  fsImpl?: AppendFsSeam
): AppendResult {
  const { valid, errors } = validateAdvisoryRecord(record);
  if (!valid) {
    return { written: false, error: `validation failed: ${errors.join("; ")}` };
  }

  const fsOps = fsImpl ?? realFsSeam();
  try {
    fsOps.mkdirp(path.dirname(outPath));
    const contents = JSON.stringify(record, null, 2) + "\n";
    // Atomic write: temp file → rename.
    const tmp = outPath + ".tmp-advisory-" + Math.random().toString(36).slice(2);
    try {
      fsOps.writeFile(tmp, contents);
      fsOps.rename(tmp, outPath);
    } catch (writeErr) {
      // Best-effort cleanup of the temp file on failure.
      try { fsOps.unlink(tmp); } catch { /* ignore */ }
      throw writeErr;
    }
    return { written: true, path: outPath };
  } catch (err) {
    return {
      written: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Fs seam (injectable for tests) ───────────────────────────────────────────

/** Minimal fs surface used by appendAdvisoryRecord. */
export interface AppendFsSeam {
  mkdirp(absPath: string): void;
  writeFile(absPath: string, contents: string): void;
  rename(src: string, dest: string): void;
  unlink(absPath: string): void;
}

/** Real-fs implementation of AppendFsSeam. */
function realFsSeam(): AppendFsSeam {
  return {
    mkdirp(absPath: string): void {
      fs.mkdirSync(absPath, { recursive: true });
    },
    writeFile(absPath: string, contents: string): void {
      fs.writeFileSync(absPath, contents, "utf8");
    },
    rename(src: string, dest: string): void {
      fs.renameSync(src, dest);
    },
    unlink(absPath: string): void {
      fs.unlinkSync(absPath);
    },
  };
}

// ── CLI entry point (not part of the library contract) ───────────────────────

if (require.main === module) {
  // Minimal CLI: print a skeleton record to stdout for inspection.
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const skeleton = makeAdvisoryRecord({
    id: `advisory-example-001`,
    recorded_at: now,
    phase: "ideation",
    backend: "single_agent",
    question: "Which architecture path should this initiative take?",
    advisors: [
      { role: "product", model_tier: "cheap" },
      { role: "architecture", model_tier: "mid" },
    ],
    recommendations: [
      { role: "product", recommendation: "Prefer the simpler layered approach.", confidence: "medium" },
      { role: "architecture", recommendation: "Event-driven boundary fits better for scale.", confidence: "high" },
    ],
    synthesis: "Use event-driven boundaries at service edges; keep internal domain logic layered.",
    confidence: "high",
    unresolved_questions: [],
  });
  process.stdout.write(JSON.stringify(skeleton, null, 2) + "\n");
}
