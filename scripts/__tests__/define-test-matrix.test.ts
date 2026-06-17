/**
 * scripts/__tests__/define-test-matrix.test.ts
 *
 * Anti-vacuous TDD suite for scripts/lib/define-test-matrix.ts — the LW2-5
 * contract-driven test-matrix generator (spec SC-W2-4 / ADR AC32 step 17).
 *
 * Wave context (BY POINTER): .guild/spec/universal-host-p2-wave2.md — SC-W2-4 (F-3).
 *
 * SC-W2-4 assigns ownership to LW2-5 (this lane). The anti-vacuous fixture below
 * uses an EXACT expected mapping — known-covered ACs map to the RIGHT tests, a
 * known-uncovered AC is flagged uncovered, and an orphan test (covers no declared
 * AC) is reported. The suite FAILS if a known-covered AC is reported uncovered, if
 * a covered AC maps to the WRONG test, or if a real orphan is missed — so a
 * "mark-everything-uncovered" (or "map-everything-covered") oracle cannot pass.
 *
 * BUILDS ON Wave-1 via NAMED imports (compile-time proof of the public interface,
 * per SC-W2-4): `acceptanceCriterionIds` (define-schema) + `checkTraceability` and
 * the trace types (define-traceability). This test imports them directly so a
 * removed/renamed export breaks the build, not just a runtime assertion.
 */

import {
  generateTestMatrix,
  runSelfCheck,
  type TestMatrixReport,
  type AcCoverage,
} from "../lib/define-test-matrix";

// Named-import contract proof (SC-W2-4): the matrix is built ON these Wave-1
// exports — importing them here is the compile-time guard that they exist with
// these names/shapes. A type-only use keeps it a pure compile-time assertion.
import { acceptanceCriterionIds } from "../lib/define-schema";
import {
  checkTraceability,
  type TraceabilityReport,
  type TraceChain,
  type TraceRow,
  type TraceUnmet,
  type TraceOrphan,
} from "../lib/define-traceability";

// A define artifact declaring FOUR acceptance criteria. AC-1/AC-2/AC-3 will be
// covered (each by a SPECIFIC, known test); AC-4 is deliberately left UNCOVERED.
const DEFINE = {
  schema_version: "guild.define.v1",
  acceptance_criteria: [
    { id: "AC-1", text: "first criterion" },
    { id: "AC-2", text: "second criterion" },
    { id: "AC-3", text: "third criterion" },
    { id: "AC-4", text: "fourth criterion — intentionally uncovered" },
  ],
  user_stories: ["x"],
  non_goals: ["x"],
  risks: ["x"],
  affected_surfaces: ["x"],
  test_implications: ["x"],
};

// EXACT-EXPECTED corpus:
//   T-alpha   covers AC-1
//   T-beta    covers AC-2, AC-3
//   T-gamma   covers AC-3            (so AC-3 has TWO covering tests, order matters)
//   T-orphan  covers AC-99 only      (orphan test + dangling ref; AC-99 not declared)
//   AC-4      has NO covering test   (uncovered)
const CORPUS = {
  tests: [
    { id: "T-alpha", covers: ["AC-1"] },
    { id: "T-beta", covers: ["AC-2", "AC-3"] },
    { id: "T-gamma", covers: ["AC-3"] },
    { id: "T-orphan", covers: ["AC-99"] },
  ],
};

// The single source of truth for "what the right answer IS" — the exact mapping.
const EXPECTED_COVERING: Record<string, string[]> = {
  "AC-1": ["T-alpha"],
  "AC-2": ["T-beta"],
  "AC-3": ["T-beta", "T-gamma"], // corpus order — T-beta before T-gamma
  "AC-4": [], // uncovered
};

function rowFor(report: TestMatrixReport, acId: string): AcCoverage {
  const row = report.coverage.find((c) => c.ac_id === acId);
  if (!row) throw new Error(`no coverage row for ${acId}`);
  return row;
}

describe("define-test-matrix: exact-expected mapping (SC-W2-4, anti-vacuous F-3)", () => {
  const report = generateTestMatrix(DEFINE, CORPUS);

  it("enumerates exactly the 4 declared AC ids in declared order", () => {
    expect(report.ac_ids).toEqual(["AC-1", "AC-2", "AC-3", "AC-4"]);
  });

  it("maps each COVERED AC to the RIGHT test(s) — wrong mapping FAILS", () => {
    // AC-1 → exactly [T-alpha]; a mark-everything oracle that put T-beta here FAILS.
    expect(rowFor(report, "AC-1").covering_test_ids).toEqual(EXPECTED_COVERING["AC-1"]);
    expect(rowFor(report, "AC-2").covering_test_ids).toEqual(EXPECTED_COVERING["AC-2"]);
    // AC-3 covered by TWO tests in corpus order — order-sensitive equality.
    expect(rowFor(report, "AC-3").covering_test_ids).toEqual(EXPECTED_COVERING["AC-3"]);
  });

  it("does NOT mis-map a covered AC to a test that doesn't cover it", () => {
    // Negative assertions: the WRONG test must not appear under an AC.
    expect(rowFor(report, "AC-1").covering_test_ids).not.toContain("T-beta");
    expect(rowFor(report, "AC-2").covering_test_ids).not.toContain("T-alpha");
    expect(rowFor(report, "AC-1").covering_test_ids).not.toContain("T-orphan");
  });

  it("marks AC-1/AC-2/AC-3 covered and AC-4 uncovered (NOT vacuously all-uncovered)", () => {
    expect(rowFor(report, "AC-1").covered).toBe(true);
    expect(rowFor(report, "AC-2").covered).toBe(true);
    expect(rowFor(report, "AC-3").covered).toBe(true);
    expect(rowFor(report, "AC-4").covered).toBe(false);
  });

  it("flags EXACTLY AC-4 as uncovered — a covered AC reported uncovered FAILS", () => {
    expect(report.uncovered_ac_ids).toEqual(["AC-4"]);
    // Anti-vacuity, stated as direct negatives: the covered ACs must NOT be flagged.
    expect(report.uncovered_ac_ids).not.toContain("AC-1");
    expect(report.uncovered_ac_ids).not.toContain("AC-2");
    expect(report.uncovered_ac_ids).not.toContain("AC-3");
  });

  it("reports T-orphan as an orphan test with AC-99 as its dangling ref", () => {
    expect(report.orphan_tests.map((o) => o.test_id)).toEqual(["T-orphan"]);
    const orphan = report.orphan_tests[0];
    expect(orphan.covers).toEqual(["AC-99"]);
    expect(orphan.dangling_ac_ids).toEqual(["AC-99"]);
    // A real test that DOES cover a declared AC must NOT be an orphan.
    expect(report.orphan_tests.map((o) => o.test_id)).not.toContain("T-alpha");
    expect(report.orphan_tests.map((o) => o.test_id)).not.toContain("T-beta");
  });

  it("surfaces AC-99 as a qa-stage dangling reference", () => {
    expect(report.dangling_refs.some((d) => d.id === "AC-99" && d.stage === "qa")).toBe(true);
    // The declared ids are NEVER dangling.
    for (const declared of ["AC-1", "AC-2", "AC-3", "AC-4"]) {
      expect(report.dangling_refs.some((d) => d.id === declared)).toBe(false);
    }
  });

  it("ok=false (uncovered AC + orphan both present)", () => {
    expect(report.ok).toBe(false);
  });

  it("the derived qa-stage traceability agrees with the matrix (no divergence)", () => {
    // The matrix is BUILT ON checkTraceability — assert the two views agree, so a
    // future refactor that desyncs them is caught.
    const matrixByAc = new Map(report.coverage.map((c) => [c.ac_id, c.covered]));
    for (const row of report.traceability.matrix as TraceRow[]) {
      if (matrixByAc.has(row.id)) {
        expect(matrixByAc.get(row.id)).toBe(row.status.qa === "resolved");
      }
    }
  });
});

describe("define-test-matrix: a mark-everything-uncovered oracle would FAIL this fixture", () => {
  // This test ENCODES the anti-vacuity guarantee directly: it asserts the generator
  // distinguishes covered from uncovered. If generateTestMatrix were replaced by a
  // vacuous stub that marks every AC uncovered, the covered-count assertion below
  // (and the EXACT uncovered set above) would fail.
  const report = generateTestMatrix(DEFINE, CORPUS);

  it("at least 3 of 4 ACs are covered (a stub marking all-uncovered cannot pass)", () => {
    const coveredCount = report.coverage.filter((c) => c.covered).length;
    expect(coveredCount).toBe(3);
    expect(report.uncovered_ac_ids.length).toBe(1);
  });

  it("a FULLY-covering corpus yields ok=true with zero uncovered (covered direction)", () => {
    const fullCorpus = {
      tests: [
        { id: "T-alpha", covers: ["AC-1"] },
        { id: "T-beta", covers: ["AC-2", "AC-3"] },
        { id: "T-delta", covers: ["AC-4"] },
      ],
    };
    const full = generateTestMatrix(DEFINE, fullCorpus);
    expect(full.ok).toBe(true);
    expect(full.uncovered_ac_ids).toEqual([]);
    expect(full.orphan_tests).toEqual([]);
    expect(full.dangling_refs).toEqual([]);
  });
});

describe("define-test-matrix: structural + build-on contract", () => {
  it("flags a define with NO acceptance criteria (ok=false, structural error)", () => {
    const report = generateTestMatrix(
      { schema_version: "guild.define.v1", acceptance_criteria: [] },
      CORPUS,
    );
    expect(report.ok).toBe(false);
    expect(report.ac_ids).toEqual([]);
    expect(report.errors.some((e) => /no acceptance_criteria/.test(e))).toBe(true);
  });

  it("never throws on exotic input (fail-closed)", () => {
    expect(() => generateTestMatrix(42 as unknown, null)).not.toThrow();
    expect(() =>
      generateTestMatrix(DEFINE, {
        tests: [42, null, { id: "" }, { id: "ok", covers: "nope" }] as unknown,
      }),
    ).not.toThrow();
  });

  it("consumes the Wave-1 public interface by NAMED import (compile-time proof)", () => {
    // Runtime touch so the imports are not elided; the REAL guarantee is that this
    // file compiles — `acceptanceCriterionIds` / `checkTraceability` + trace types
    // must exist with these names (SC-W2-4 'named imported interface').
    expect(typeof acceptanceCriterionIds).toBe("function");
    expect(typeof checkTraceability).toBe("function");
    const ids = acceptanceCriterionIds(DEFINE);
    expect(ids).toContain("AC-1");
    const chain: TraceChain = { qa: { resolved_ids: ["AC-1"] } };
    const trace: TraceabilityReport = checkTraceability(DEFINE, chain);
    const unmet: TraceUnmet[] = trace.unmet;
    const orphans: TraceOrphan[] = trace.orphans;
    expect(Array.isArray(unmet)).toBe(true);
    expect(Array.isArray(orphans)).toBe(true);
  });

  it("the module's own runSelfCheck passes", () => {
    const { pass, details } = runSelfCheck();
    expect(pass).toBe(true);
    expect(details).toContain("uncovered-flagged=true");
  });
});
