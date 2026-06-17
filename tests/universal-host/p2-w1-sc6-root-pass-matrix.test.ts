/**
 * tests/universal-host/p2-w1-sc6-root-pass-matrix.test.ts
 *
 * SC-W1-6 (AC35) — AUTHORITATIVE root-PASS aggregation matrix over the SHIPPED
 * `aggregateRootVerdict()` (LW1-4). Root PASS iff EVERY affected child PASS or carries a
 * recorded reviewed_exception:
 *   - all affected PASS                → PASS
 *   - one affected FAIL, no exception  → FAIL
 *   - one affected FAIL + exception    → PASS_WITH_EXCEPTION (exception surfaced)
 *   - an affected child with NO verdict → FAIL (fail-closed; unknown ≠ PASS)
 */
import {
  aggregateRootVerdict,
  type ChildVerdict,
} from "../../scripts/lib/workspace-impact-detector";
import type { AffectedChild } from "../../scripts/lib/workspace-impact-schema";

const AFFECTED: AffectedChild[] = [
  { id: "website", path: "website", dependency_reason: "depends on plugin" },
  { id: "benchmark", path: "benchmark", dependency_reason: "transitively depends on plugin via website" },
];

describe("SC-W1-6 — root-PASS aggregation matrix", () => {
  it("all affected PASS → PASS", () => {
    const verdicts: ChildVerdict[] = [
      { id: "website", status: "PASS" },
      { id: "benchmark", status: "PASS" },
    ];
    expect(aggregateRootVerdict(AFFECTED, verdicts).verdict).toBe("PASS");
  });

  it("one affected FAIL, no exception → FAIL", () => {
    const verdicts: ChildVerdict[] = [
      { id: "website", status: "FAIL" },
      { id: "benchmark", status: "PASS" },
    ];
    const agg = aggregateRootVerdict(AFFECTED, verdicts);
    expect(agg.verdict).toBe("FAIL");
    expect(agg.failing).toContain("website");
  });

  it("one affected FAIL + reviewed_exception → PASS_WITH_EXCEPTION (exception surfaced)", () => {
    const verdicts: ChildVerdict[] = [
      { id: "website", status: "FAIL", reviewed_exception: { reason: "known-flaky, tracked", approved_by: "lead" } },
      { id: "benchmark", status: "PASS" },
    ];
    const agg = aggregateRootVerdict(AFFECTED, verdicts);
    expect(agg.verdict).toBe("PASS_WITH_EXCEPTION");
    expect(agg.exercised_exceptions.map((e) => e.id)).toContain("website");
    expect(agg.exercised_exceptions[0].exception.reason).toBe("known-flaky, tracked");
  });

  it("an affected child with NO recorded verdict → FAIL (fail-closed)", () => {
    const verdicts: ChildVerdict[] = [{ id: "website", status: "PASS" }]; // benchmark missing
    const agg = aggregateRootVerdict(AFFECTED, verdicts);
    expect(agg.verdict).toBe("FAIL");
    expect(agg.missing_verdicts).toContain("benchmark");
  });

  it("a FAIL with an EMPTY exception reason is NOT excused (fail-closed)", () => {
    const verdicts: ChildVerdict[] = [
      { id: "website", status: "FAIL", reviewed_exception: { reason: "  " } },
      { id: "benchmark", status: "PASS" },
    ];
    expect(aggregateRootVerdict(AFFECTED, verdicts).verdict).toBe("FAIL");
  });
});
