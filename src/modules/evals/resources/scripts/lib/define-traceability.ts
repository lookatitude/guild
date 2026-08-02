/**
 * scripts/lib/define-traceability.ts
 *
 * LW1-5 of universal-host P2 Wave 1 (spec SC-W1-3 / ADR AC32) — the AC-id
 * TRACEABILITY CHECKER. Given a `guild.define.v1` artifact and a downstream chain
 * spanning **plan → build receipt → QA check → release gate**, it confirms that
 * every acceptance-criterion id is resolved (or flagged UNMET) at EACH stage —
 * INCLUDING the release gate — and flags any orphan id (one that appears in a
 * stage but is not declared in the define artifact).
 *
 * Usage (library — pure function, no CLI, no I/O, no process.exit):
 *   import { checkTraceability } from "./lib/define-traceability";
 *   const report = checkTraceability(defineArtifact, chain);
 *   if (!report.ok) { … report.unmet / report.orphans / report.release_unmet … }
 *
 * Contract authority (SoT):
 *   ADR: universal-host-plugin-architecture (workspace wiki) §Product loop (AC32)
 *   .guild/spec/universal-host-p2-wave1.md  SC-W1-3
 *   .guild/plan/universal-host-p2-wave1.md  lane LW1-5
 *
 * Depends on LW1-1 `define-schema.ts` for the stable AC-id set
 * (`acceptanceCriterionIds`). AC ids are validated unique + non-empty at
 * define-validate time; this checker dedupes defensively and never re-validates.
 *
 * CONTRACT:
 *  - Pure & deterministic: same (define, chain) → same report. No clock/random/fs.
 *  - NEVER throws on exotic input (missing stages, non-array fields, null) — a
 *    malformed/absent stage is treated as resolving NOTHING, so every define id is
 *    reported UNMET at that stage (fail-closed: silence is never "traced").
 *  - The release gate is a first-class stage: a define id missing from it is
 *    surfaced both in `unmet[]` (stage="release_gate") and in `release_unmet[]`.
 *  - `ok` is true iff every define id is RESOLVED at every stage AND there are no
 *    orphans AND the define declares at least one AC id.
 */

import { acceptanceCriterionIds } from "./define-schema";

// ---------------------------------------------------------------------------
// Stages — the fixed, ordered chain (declaration order = report order)
// ---------------------------------------------------------------------------

/** The four traceability stages, in chain order. The release gate is last + required. */
export const TRACE_STAGES = Object.freeze(["plan", "build_receipt", "qa", "release_gate"] as const);
export type TraceStageName = (typeof TRACE_STAGES)[number];

export type TraceStatus = "resolved" | "unmet";

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

/**
 * One stage's view of the AC ids. `resolved_ids` are the ids this stage covers;
 * the optional `unmet_ids` lets a stage EXPLICITLY assert a failure (e.g. a QA
 * check that ran and failed, or a release gate that withheld an id). When an id
 * appears in both, `unmet_ids` wins (an explicit failure is never "resolved").
 */
export interface TraceStageInput {
  resolved_ids?: string[];
  unmet_ids?: string[];
}

/** The downstream chain — each field optional; an absent stage resolves nothing. */
export interface TraceChain {
  plan?: TraceStageInput;
  build_receipt?: TraceStageInput;
  qa?: TraceStageInput;
  release_gate?: TraceStageInput;
}

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export interface TraceRow {
  /** The define AC id this row tracks. */
  id: string;
  /** Per-stage status. Every TRACE_STAGES key is present. */
  status: Record<TraceStageName, TraceStatus>;
  /** True iff resolved at ALL stages (including the release gate). */
  fully_traced: boolean;
}

export interface TraceUnmet {
  id: string;
  stage: TraceStageName;
}

export interface TraceOrphan {
  /** An id referenced by a stage but NOT declared in the define artifact. */
  id: string;
  stage: TraceStageName;
}

export interface TraceabilityReport {
  /** True iff every define id resolved at every stage, no orphans, ≥1 define id. */
  ok: boolean;
  /** The de-duplicated stable AC id set from the define artifact, in declared order. */
  define_ids: string[];
  /** The stage order this report uses. */
  stages: readonly TraceStageName[];
  /** One row per define id with its per-stage status. */
  matrix: TraceRow[];
  /** Flat list of every (define id, stage) pair that is UNMET. */
  unmet: TraceUnmet[];
  /** Ids that appear in a stage but are not declared in the define (flagged). */
  orphans: TraceOrphan[];
  /** Define ids NOT resolved at the RELEASE GATE specifically (AC32 emphasis). */
  release_unmet: string[];
  /** Structural problems that are not per-id (e.g. define declares no AC ids). */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers (never-throwing)
// ---------------------------------------------------------------------------

/** Coerce an unknown value to a string[] of non-empty entries; never throws. */
function asIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const el of v) {
    if (typeof el === "string" && el.trim() !== "") out.push(el);
  }
  return out;
}

/** Pull a stage's resolved/unmet id SETS from a possibly-malformed chain entry. */
function stageSets(stage: unknown): { resolved: Set<string>; unmet: Set<string> } {
  if (typeof stage !== "object" || stage === null || Array.isArray(stage)) {
    return { resolved: new Set(), unmet: new Set() };
  }
  const s = stage as Record<string, unknown>;
  return {
    resolved: new Set(asIdList(s["resolved_ids"])),
    unmet: new Set(asIdList(s["unmet_ids"])),
  };
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

/**
 * Check AC-id traceability of a define artifact across the plan→receipt→QA→release
 * chain. Pure & deterministic; never throws.
 */
export function checkTraceability(define: unknown, chain: unknown): TraceabilityReport {
  const errors: string[] = [];

  // Define id set — stable ids from LW1-1's schema accessor, de-duplicated in
  // declared order (the schema validates uniqueness; we dedupe defensively).
  const rawIds = acceptanceCriterionIds(define);
  const seen = new Set<string>();
  const define_ids: string[] = [];
  for (const id of rawIds) {
    if (!seen.has(id)) {
      seen.add(id);
      define_ids.push(id);
    }
  }
  if (define_ids.length === 0) {
    errors.push("define artifact declares no acceptance_criteria ids — nothing to trace");
  }

  // Per-stage id sets from the (possibly malformed) chain.
  const chainObj =
    typeof chain === "object" && chain !== null && !Array.isArray(chain)
      ? (chain as Record<string, unknown>)
      : {};
  const perStage: Record<TraceStageName, { resolved: Set<string>; unmet: Set<string> }> = {
    plan: stageSets(chainObj["plan"]),
    build_receipt: stageSets(chainObj["build_receipt"]),
    qa: stageSets(chainObj["qa"]),
    release_gate: stageSets(chainObj["release_gate"]),
  };

  // Matrix + unmet — for each define id, status at each stage.
  const matrix: TraceRow[] = [];
  const unmet: TraceUnmet[] = [];
  for (const id of define_ids) {
    const status = {} as Record<TraceStageName, TraceStatus>;
    let fully = true;
    for (const stage of TRACE_STAGES) {
      const { resolved, unmet: explicitUnmet } = perStage[stage];
      // Explicit failure wins; otherwise presence in resolved_ids = resolved.
      const st: TraceStatus =
        !explicitUnmet.has(id) && resolved.has(id) ? "resolved" : "unmet";
      status[stage] = st;
      if (st === "unmet") {
        unmet.push({ id, stage });
        fully = false;
      }
    }
    matrix.push({ id, status, fully_traced: fully });
  }

  // Orphans — any id referenced by a stage (resolved or explicit-unmet) that is
  // NOT a declared define id. Stable order: stage order, then id insertion order.
  const defineSet = new Set(define_ids);
  const orphans: TraceOrphan[] = [];
  for (const stage of TRACE_STAGES) {
    const { resolved, unmet: explicitUnmet } = perStage[stage];
    for (const id of [...resolved, ...explicitUnmet]) {
      if (!defineSet.has(id) && !orphans.some((o) => o.id === id && o.stage === stage)) {
        orphans.push({ id, stage });
      }
    }
  }

  // Release-gate emphasis (AC32): define ids unmet specifically at the release gate.
  const release_unmet = define_ids.filter((id) => matrix.find((r) => r.id === id)!.status.release_gate === "unmet");

  const ok = errors.length === 0 && unmet.length === 0 && orphans.length === 0;

  return {
    ok,
    define_ids,
    stages: TRACE_STAGES,
    matrix,
    unmet,
    orphans,
    release_unmet,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Deterministic example chain (for LW1-8 fixtures) + import-pure self-check
// ---------------------------------------------------------------------------

/**
 * A fully-traced chain over the DEFINE_V1_EXAMPLE ids ("AC-1", "AC-2"). Frozen,
 * deterministic — no clock/random. LW1-8 builds the authoritative fixtures.
 */
export const TRACE_CHAIN_EXAMPLE: TraceChain = {
  plan: { resolved_ids: ["AC-1", "AC-2"] },
  build_receipt: { resolved_ids: ["AC-1", "AC-2"] },
  qa: { resolved_ids: ["AC-1", "AC-2"] },
  release_gate: { resolved_ids: ["AC-1", "AC-2"] },
};

/**
 * Deterministic smoke check. Returns `{ pass, details }`; NO process IO, never exits.
 * Confirms: (1) a fully-traced chain → ok; (2) a define id missing from the release
 * gate → flagged unmet at release (and ok=false); (3) an orphan id in a stage → flagged.
 */
export function runSelfCheck(): { pass: boolean; details: string } {
  const define = {
    schema_version: "guild.define.v1",
    acceptance_criteria: [
      { id: "AC-1", text: "first" },
      { id: "AC-2", text: "second" },
    ],
    user_stories: ["x"],
    non_goals: ["x"],
    risks: ["x"],
    affected_surfaces: ["x"],
    test_implications: ["x"],
  };

  // (1) fully traced
  const full = checkTraceability(define, TRACE_CHAIN_EXAMPLE);

  // (2) AC-2 missing from the release gate → release_unmet flags it, ok=false
  const missingRelease = checkTraceability(define, {
    plan: { resolved_ids: ["AC-1", "AC-2"] },
    build_receipt: { resolved_ids: ["AC-1", "AC-2"] },
    qa: { resolved_ids: ["AC-1", "AC-2"] },
    release_gate: { resolved_ids: ["AC-1"] },
  });
  const releaseFlagged =
    !missingRelease.ok &&
    missingRelease.release_unmet.includes("AC-2") &&
    missingRelease.unmet.some((u) => u.id === "AC-2" && u.stage === "release_gate");

  // (3) orphan id present in a stage but not in define → flagged, ok=false
  const orphan = checkTraceability(define, {
    plan: { resolved_ids: ["AC-1", "AC-2", "AC-99"] },
    build_receipt: { resolved_ids: ["AC-1", "AC-2"] },
    qa: { resolved_ids: ["AC-1", "AC-2"] },
    release_gate: { resolved_ids: ["AC-1", "AC-2"] },
  });
  const orphanFlagged =
    !orphan.ok && orphan.orphans.some((o) => o.id === "AC-99" && o.stage === "plan");

  // exotic input never throws
  let exoticThrew = false;
  try {
    checkTraceability(42 as unknown, null);
  } catch {
    exoticThrew = true;
  }

  const pass = full.ok && releaseFlagged && orphanFlagged && !exoticThrew;
  return {
    pass,
    details: `fully-traced=${full.ok} release-unmet-flagged=${releaseFlagged} orphan-flagged=${orphanFlagged} exotic-no-throw=${!exoticThrew}`,
  };
}
