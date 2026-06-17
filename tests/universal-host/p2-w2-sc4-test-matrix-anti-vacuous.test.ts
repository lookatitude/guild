/**
 * tests/universal-host/p2-w2-sc4-test-matrix-anti-vacuous.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W2-4 (ADR AC32 step 17) — the contract-driven
 * test-matrix generator, gated anti-vacuously.
 *
 * From a `guild.define.v1` acceptance contract + a test corpus, `generateTestMatrix`
 * maps each AC id → covering test(s), flags uncovered ACs, and reports orphan tests
 * (cover no declared AC) + dangling refs. The gate is ANTI-VACUOUS: an EXACT-expected
 * fixture proves a known-covered AC maps to the RIGHT test, a known-uncovered AC is
 * flagged, and a real orphan is reported — and the suite FAILS if a covered AC is
 * reported uncovered, mapped to the wrong test, or an orphan is missed (a
 * mark-everything-uncovered OR mark-everything-covered stub cannot pass).
 *
 * It BUILDS ON Wave-1 via NAMED imports (`acceptanceCriterionIds` + `checkTraceability`
 * + the trace types) — importing them is the compile-time proof of the interface
 * (spec SC-W2-4 'named imported interface').
 */

import {
  generateTestMatrix,
  type TestMatrixReport,
} from "../../scripts/lib/define-test-matrix";
import { acceptanceCriterionIds } from "../../scripts/lib/define-schema";
import {
  checkTraceability,
  type TraceabilityReport,
  type TraceChain,
  type TraceUnmet,
  type TraceOrphan,
} from "../../scripts/lib/define-traceability";

const DEFINE = {
  schema_version: "guild.define.v1",
  acceptance_criteria: [
    { id: "AC-1", text: "first" },
    { id: "AC-2", text: "second" },
    { id: "AC-3", text: "third" },
    { id: "AC-4", text: "fourth — intentionally uncovered" },
  ],
  user_stories: ["x"],
  non_goals: ["x"],
  risks: ["x"],
  affected_surfaces: ["x"],
  test_implications: ["x"],
};

// EXACT mapping: AC-1→[T-alpha], AC-2→[T-beta], AC-3→[T-beta,T-gamma], AC-4 UNCOVERED,
// T-orphan covers only the undeclared AC-99.
const CORPUS = {
  tests: [
    { id: "T-alpha", covers: ["AC-1"] },
    { id: "T-beta", covers: ["AC-2", "AC-3"] },
    { id: "T-gamma", covers: ["AC-3"] },
    { id: "T-orphan", covers: ["AC-99"] },
  ],
};

function covering(report: TestMatrixReport, acId: string): string[] {
  return report.coverage.find((c) => c.ac_id === acId)!.covering_test_ids;
}

describe("SC-W2-4 — contract-driven test-matrix, anti-vacuous exact-expected fixture", () => {
  const report = generateTestMatrix(DEFINE, CORPUS);

  it("maps each covered AC to the RIGHT test(s) (wrong/mark-all maps FAIL)", () => {
    expect(report.ac_ids).toEqual(["AC-1", "AC-2", "AC-3", "AC-4"]);
    expect(covering(report, "AC-1")).toEqual(["T-alpha"]);
    expect(covering(report, "AC-2")).toEqual(["T-beta"]);
    expect(covering(report, "AC-3")).toEqual(["T-beta", "T-gamma"]); // corpus order
    expect(covering(report, "AC-1")).not.toContain("T-beta"); // negative
  });

  it("flags EXACTLY AC-4 uncovered (a covered AC reported uncovered FAILS)", () => {
    expect(report.uncovered_ac_ids).toEqual(["AC-4"]);
    expect(report.coverage.filter((c) => c.covered).length).toBe(3); // not all-uncovered
  });

  it("reports T-orphan with AC-99 dangling; real tests are NOT orphans", () => {
    expect(report.orphan_tests.map((o) => o.test_id)).toEqual(["T-orphan"]);
    expect(report.orphan_tests[0].dangling_ac_ids).toEqual(["AC-99"]);
    expect(report.dangling_refs.some((d) => d.id === "AC-99" && d.stage === "qa")).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("a FULLY-covering corpus → ok=true, zero uncovered/orphan (covered direction)", () => {
    const full = generateTestMatrix(DEFINE, {
      tests: [
        { id: "T-alpha", covers: ["AC-1"] },
        { id: "T-beta", covers: ["AC-2", "AC-3"] },
        { id: "T-delta", covers: ["AC-4"] },
      ],
    });
    expect(full.ok).toBe(true);
    expect(full.uncovered_ac_ids).toEqual([]);
    expect(full.orphan_tests).toEqual([]);
  });

  it("builds on the Wave-1 named interface (compile-time + runtime touch)", () => {
    expect(typeof acceptanceCriterionIds).toBe("function");
    expect(acceptanceCriterionIds(DEFINE)).toContain("AC-1");
    const chain: TraceChain = { qa: { resolved_ids: ["AC-1"] } };
    const trace: TraceabilityReport = checkTraceability(DEFINE, chain);
    const unmet: TraceUnmet[] = trace.unmet;
    const orphans: TraceOrphan[] = trace.orphans;
    expect(Array.isArray(unmet)).toBe(true);
    expect(Array.isArray(orphans)).toBe(true);
  });
});
