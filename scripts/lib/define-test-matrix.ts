/**
 * scripts/lib/define-test-matrix.ts
 *
 * LW2-5 of universal-host P2 Wave 2 (spec SC-W2-4 / ADR AC32 step 17) — the
 * CONTRACT-DRIVEN TEST-MATRIX GENERATOR. Given a `guild.define.v1` acceptance
 * contract and a test corpus, it:
 *   - maps each acceptance-criterion id → the test(s)/QA-check(s) that cover it,
 *   - flags any AC id with **no** covering test (uncovered),
 *   - reports **orphan tests** (tests that cover no declared AC), and
 *   - surfaces **dangling references** (a test pointing at an AC id the define
 *     never declared).
 *
 * Usage (library — pure function, no CLI, no I/O, no process.exit):
 *   import { generateTestMatrix } from "./lib/define-test-matrix";
 *   const report = generateTestMatrix(defineArtifact, corpus);
 *   if (!report.ok) { … report.uncovered_ac_ids / report.orphan_tests … }
 *
 * Contract authority (SoT):
 *   ADR: universal-host-plugin-architecture (workspace wiki) §Product loop (AC32)
 *   .guild/spec/universal-host-p2-wave2.md  SC-W2-4
 *   .guild/plan/universal-host-p2-wave2.md  lane LW2-5
 *
 * BUILDS ON Wave-1 — no parallel re-implementation (spec SC-W2-4):
 *   - `acceptanceCriterionIds()` from `./define-schema` supplies the stable AC id set.
 *   - `checkTraceability()` from `./define-traceability` is the engine for the
 *     id-centric half: the corpus is projected onto its **qa** stage (each AC id a
 *     test references becomes a qa `resolved_id`), and the traceability report's
 *     qa-stage `unmet[]` IS the uncovered-AC set while its qa-stage `orphans[]` IS
 *     the dangling-reference set. The trace types (`TraceChain`/`TraceabilityReport`/
 *     `TraceRow`/`TraceUnmet`/`TraceOrphan`) are all load-bearing below — importing
 *     this module is itself the compile-time proof of those exports.
 *   The genuinely NEW concept this module adds over the checker is the
 *   **test-centric** view (covering_test_ids per AC + orphan_tests), which the
 *   id-centric traceability checker does not model.
 *
 * CONTRACT:
 *  - Pure & deterministic: same (define, corpus) → same report. No clock/random/fs.
 *  - NEVER throws on exotic input (non-object define, non-array tests, null, etc.) —
 *    malformed entries resolve NOTHING (fail-closed: a test that cannot be parsed
 *    covers no AC; an AC with no parsable covering test is reported uncovered).
 *  - `ok` is true iff the define declares ≥1 AC id, every AC id is covered, there are
 *    no orphan tests, and no dangling references.
 *
 * Owned by tooling-engineer (LW2-5); the anti-vacuous exact-expected fixture is
 * authored by LW2-6 (eval-engineer). This module ships the generator + a smoke check.
 */

import { acceptanceCriterionIds } from "./define-schema";
import {
  checkTraceability,
  type TraceChain,
  type TraceabilityReport,
  type TraceRow,
  type TraceUnmet,
  type TraceOrphan,
} from "./define-traceability";

// ---------------------------------------------------------------------------
// Input shapes — the test corpus
// ---------------------------------------------------------------------------

/**
 * One test / QA-check in the corpus. `id` is the stable test identifier; `covers`
 * lists the acceptance-criterion ids this test claims to exercise. Both optional so
 * a malformed entry never throws — it simply resolves nothing.
 */
export interface TestCaseInput {
  id?: string;
  covers?: string[];
}

/** The test corpus — each field optional; an absent/malformed corpus covers nothing. */
export interface TestCorpus {
  tests?: TestCaseInput[];
}

// ---------------------------------------------------------------------------
// Report shapes
// ---------------------------------------------------------------------------

/** Per-AC coverage row: which tests cover this AC, and whether any do. */
export interface AcCoverage {
  /** The declared acceptance-criterion id. */
  ac_id: string;
  /** Stable test ids that cover this AC (de-duplicated, in corpus order). */
  covering_test_ids: string[];
  /** True iff ≥1 test covers this AC. */
  covered: boolean;
}

/** A test that covers no DECLARED acceptance criterion. */
export interface OrphanTest {
  /** The orphan test's id. */
  test_id: string;
  /** Every AC id this test referenced (declared or not), in declaration order. */
  covers: string[];
  /** Referenced ids that the define artifact does NOT declare (may be empty). */
  dangling_ac_ids: string[];
}

export interface TestMatrixReport {
  /** True iff ≥1 AC declared, all covered, no orphan tests, no dangling refs. */
  ok: boolean;
  /** The de-duplicated stable AC id set from the define artifact, in declared order. */
  ac_ids: string[];
  /** One coverage row per declared AC id. */
  coverage: AcCoverage[];
  /** AC ids with NO covering test (sourced from the qa-stage traceability `unmet`). */
  uncovered_ac_ids: string[];
  /** Tests that cover no declared AC. */
  orphan_tests: OrphanTest[];
  /** Ids a test referenced but the define never declared (qa-stage traceability orphans). */
  dangling_refs: TraceOrphan[];
  /** The underlying qa-stage traceability report this matrix is derived from. */
  traceability: TraceabilityReport;
  /** Structural problems that are not per-id (e.g. define declares no AC ids, dropped tests). */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers (never-throwing)
// ---------------------------------------------------------------------------

/** Coerce an unknown value to a string[] of non-empty, trimmed-non-empty entries. */
function asIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const el of v) {
    if (typeof el === "string" && el.trim() !== "") out.push(el);
  }
  return out;
}

/** A normalized test: a usable id + its referenced AC ids. */
interface NormalizedTest {
  id: string;
  refs: string[];
}

/** Pull normalized tests from a possibly-malformed corpus; records dropped entries. */
function normalizeTests(corpus: unknown, errors: string[]): NormalizedTest[] {
  const obj =
    typeof corpus === "object" && corpus !== null && !Array.isArray(corpus)
      ? (corpus as Record<string, unknown>)
      : {};
  const raw = obj["tests"];
  if (!Array.isArray(raw)) return [];
  const out: NormalizedTest[] = [];
  raw.forEach((el, i) => {
    if (typeof el !== "object" || el === null || Array.isArray(el)) {
      errors.push(`tests[${i}] must be an object { id, covers } — dropped`);
      return;
    }
    const t = el as Record<string, unknown>;
    const id = t["id"];
    if (typeof id !== "string" || id.trim() === "") {
      errors.push(`tests[${i}].id must be a non-empty string — dropped (cannot map an unidentified test)`);
      return;
    }
    out.push({ id, refs: asIdList(t["covers"]) });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate the contract-driven test-matrix for a define artifact + test corpus.
 * Pure & deterministic; never throws.
 */
export function generateTestMatrix(define: unknown, corpus: unknown): TestMatrixReport {
  const errors: string[] = [];

  // Stable AC id set from LW1-1's accessor, de-duplicated in declared order.
  const rawIds = acceptanceCriterionIds(define);
  const seen = new Set<string>();
  const ac_ids: string[] = [];
  for (const id of rawIds) {
    if (!seen.has(id)) {
      seen.add(id);
      ac_ids.push(id);
    }
  }
  if (ac_ids.length === 0) {
    errors.push("define artifact declares no acceptance_criteria ids — nothing to map");
  }
  const acSet = new Set(ac_ids);

  // Normalize the corpus (never throws; malformed entries dropped + recorded).
  const tests = normalizeTests(corpus, errors);

  // ---- BUILD-ON: project the corpus onto checkTraceability's `qa` stage. ----
  // Each AC id referenced by ANY test becomes a qa resolved_id; the engine then
  // tells us (a) which declared ACs went unmet at qa = uncovered, and (b) which
  // referenced ids are orphans (referenced but not declared) = dangling refs.
  const referenced: string[] = [];
  const refSeen = new Set<string>();
  for (const t of tests) {
    for (const r of t.refs) {
      if (!refSeen.has(r)) {
        refSeen.add(r);
        referenced.push(r);
      }
    }
  }
  const chain: TraceChain = { qa: { resolved_ids: referenced } };
  const traceability: TraceabilityReport = checkTraceability(define, chain);

  // Uncovered ACs come straight from the qa-stage traceability `unmet[]`.
  const qaUnmet: TraceUnmet[] = traceability.unmet.filter((u) => u.stage === "qa");
  const uncovered_ac_ids = qaUnmet.map((u) => u.id);

  // Dangling references come straight from the qa-stage traceability `orphans[]`.
  const dangling_refs: TraceOrphan[] = traceability.orphans.filter((o) => o.stage === "qa");

  // ---- Test-centric view (the NEW concept over the id-centric checker). ----
  // Per-AC covering test ids (de-duplicated, in corpus order).
  const coveringByAc = new Map<string, string[]>();
  const coveringSeen = new Map<string, Set<string>>();
  for (const id of ac_ids) {
    coveringByAc.set(id, []);
    coveringSeen.set(id, new Set());
  }
  for (const t of tests) {
    for (const r of t.refs) {
      if (acSet.has(r)) {
        const seenSet = coveringSeen.get(r)!;
        if (!seenSet.has(t.id)) {
          seenSet.add(t.id);
          coveringByAc.get(r)!.push(t.id);
        }
      }
    }
  }

  // Coverage rows — `covered` sourced from the traceability matrix (load-bearing
  // cross-check that the engine and the test-centric view agree by construction).
  const qaStatusById = new Map<string, boolean>();
  for (const row of traceability.matrix as TraceRow[]) {
    qaStatusById.set(row.id, row.status.qa === "resolved");
  }
  const coverage: AcCoverage[] = ac_ids.map((id) => ({
    ac_id: id,
    covering_test_ids: coveringByAc.get(id) ?? [],
    covered: qaStatusById.get(id) ?? false,
  }));

  // Orphan tests — a test whose referenced ids include NO declared AC.
  const orphan_tests: OrphanTest[] = [];
  for (const t of tests) {
    const coversDeclared = t.refs.some((r) => acSet.has(r));
    if (!coversDeclared) {
      orphan_tests.push({
        test_id: t.id,
        covers: t.refs,
        dangling_ac_ids: t.refs.filter((r) => !acSet.has(r)),
      });
    }
  }

  const ok =
    errors.length === 0 &&
    ac_ids.length > 0 &&
    uncovered_ac_ids.length === 0 &&
    orphan_tests.length === 0 &&
    dangling_refs.length === 0;

  return {
    ok,
    ac_ids,
    coverage,
    uncovered_ac_ids,
    orphan_tests,
    dangling_refs,
    traceability,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Deterministic example corpus (for LW2-6 fixtures) + import-pure self-check
// ---------------------------------------------------------------------------

/**
 * A fully-covering corpus over the DEFINE_V1_EXAMPLE ids ("AC-1", "AC-2"). Frozen,
 * deterministic — no clock/random. LW2-6 builds the authoritative anti-vacuous fixture.
 */
export const TEST_CORPUS_EXAMPLE: TestCorpus = {
  tests: [
    { id: "T-precision", covers: ["AC-2"] },
    { id: "T-noslash-intake", covers: ["AC-1"] },
    { id: "T-both", covers: ["AC-1", "AC-2"] },
  ],
};

/**
 * Deterministic smoke check. Returns `{ pass, details }`; NO process IO, never exits.
 * Confirms: (1) a fully-covering corpus → ok, every AC covered, no orphans/dangling;
 * (2) a corpus that leaves an AC uncovered → flagged uncovered + ok=false;
 * (3) a test covering only a non-declared id → orphan test + dangling ref + ok=false;
 * (4) the anti-vacuous direction — a known-covered AC is NOT reported uncovered;
 * (5) exotic input never throws.
 */
export function runSelfCheck(): { pass: boolean; details: string } {
  const define = {
    schema_version: "guild.define.v1",
    acceptance_criteria: [
      { id: "AC-1", text: "first" },
      { id: "AC-2", text: "second" },
      { id: "AC-3", text: "third" },
    ],
    user_stories: ["x"],
    non_goals: ["x"],
    risks: ["x"],
    affected_surfaces: ["x"],
    test_implications: ["x"],
  };

  // (1) fully covered (AC-1,2,3 each covered) → ok
  const full = generateTestMatrix(define, {
    tests: [
      { id: "T1", covers: ["AC-1"] },
      { id: "T2", covers: ["AC-2", "AC-3"] },
    ],
  });
  const fullOk =
    full.ok &&
    full.uncovered_ac_ids.length === 0 &&
    full.orphan_tests.length === 0 &&
    full.dangling_refs.length === 0;

  // (2) AC-3 uncovered → flagged, ok=false; AND anti-vacuous: AC-1/AC-2 NOT uncovered.
  const partial = generateTestMatrix(define, {
    tests: [
      { id: "T1", covers: ["AC-1"] },
      { id: "T2", covers: ["AC-2"] },
    ],
  });
  const uncoveredFlagged =
    !partial.ok &&
    partial.uncovered_ac_ids.includes("AC-3") &&
    !partial.uncovered_ac_ids.includes("AC-1") &&
    !partial.uncovered_ac_ids.includes("AC-2") &&
    partial.coverage.find((c) => c.ac_id === "AC-1")!.covering_test_ids.includes("T1");

  // (3) orphan test (covers a non-declared id only) → orphan + dangling, ok=false
  const orphan = generateTestMatrix(define, {
    tests: [
      { id: "T1", covers: ["AC-1"] },
      { id: "T2", covers: ["AC-2", "AC-3"] },
      { id: "T-orphan", covers: ["AC-99"] },
    ],
  });
  const orphanFlagged =
    !orphan.ok &&
    orphan.orphan_tests.some((o) => o.test_id === "T-orphan" && o.dangling_ac_ids.includes("AC-99")) &&
    orphan.dangling_refs.some((d) => d.id === "AC-99" && d.stage === "qa");

  // (5) exotic input never throws
  let exoticThrew = false;
  try {
    generateTestMatrix(42 as unknown, null);
    generateTestMatrix(define, { tests: [42, null, { id: "" }, { id: "ok", covers: "nope" }] as unknown });
  } catch {
    exoticThrew = true;
  }

  const pass = fullOk && uncoveredFlagged && orphanFlagged && !exoticThrew;
  return {
    pass,
    details: `full-covered=${fullOk} uncovered-flagged=${uncoveredFlagged} orphan-flagged=${orphanFlagged} exotic-no-throw=${!exoticThrew}`,
  };
}
