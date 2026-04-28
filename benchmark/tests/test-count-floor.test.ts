// test-count-floor.test.ts — aggregate growth regression guard.
//
// Per spec SC8 + T5-qa lane block: "Total `npm test` count grows; no
// skipped beyond the documented `runner.live.smoke.test.ts` operator-
// only file."
//
// The v1.3 final test count was 474 (377 + 37 + 60 across the v1.3
// release lanes). v1.4 grew this to 777+ via the T3a/T3b/T3c/T3d/T4 lanes.
// This test enforces the FLOOR — if the cross-test inventory drops below
// 474 across `benchmark/tests/`, the suite has regressed against the
// v1.3 baseline and we should fail merge.
//
// IMPLEMENTATION — counts every `it(...)` / `it.each(...)` invocation
// across `benchmark/tests/*.test.ts` (excluding this file). Greppable +
// cheap; no test framework introspection.
//
// PURE: walks the on-disk test files; no spawn, no network. The floor
// is intentionally LAX (only 474, not the current 777) to avoid
// thrashing on every legitimate test addition; this guards the
// catastrophic-regression case (e.g., accidental mass deletion).

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const TESTS_DIR = resolve(__dirname);
const SELF = "test-count-floor.test.ts";

/** v1.3 final test count — see spec §"Tests pin" + lane bundle. */
export const V13_BASELINE_TEST_COUNT = 474;

/**
 * Count the number of `it(...)` and `it.each(...)` call sites in the
 * given source. We tolerate both `it("desc", ...)` and `it.each(...)("...
 * desc...", ...)` as the literal grammar that vitest exposes, plus the
 * permissive `\bit\s*[(.]` boundary.
 *
 * Skip patterns we treat as "tests" too: `describe.each`, `test(`,
 * `test.each`, since vitest's `test` is a `it` alias.
 */
function countTestCases(source: string): number {
  // Strip block comments + line comments (best-effort) so that test-IDs
  // appearing in comments don't inflate the count. Quick & dirty regex
  // is fine for a counting pass; it intentionally over-strips rather
  // than under-strips.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, (_m, p1) => p1);
  // Match `it(` / `it.each(` / `test(` / `test.each(` at word-boundary.
  const pattern = /\b(it|test)(\.each)?\s*\(/g;
  const matches = stripped.match(pattern);
  return matches ? matches.length : 0;
}

describe("test-count-floor / aggregate inventory", () => {
  it("counts test-cases across every `benchmark/tests/*.test.ts`", () => {
    const entries = readdirSync(TESTS_DIR).filter(
      (n) => n.endsWith(".test.ts") || n.endsWith(".test.tsx"),
    );
    const perFile: Array<{ file: string; cases: number }> = [];
    let total = 0;
    for (const e of entries) {
      if (e === SELF) continue;
      const text = readFileSync(join(TESTS_DIR, e), "utf8");
      const cases = countTestCases(text);
      perFile.push({ file: e, cases });
      total += cases;
    }
    // Per the spec: any drop below the v1.3 baseline is a regression.
    expect(
      total,
      `total test-case count (${total}) dropped below the v1.3 baseline (${V13_BASELINE_TEST_COUNT}). ` +
        `This suite has regressed; the lane block forbids removing or weakening existing tests.`,
    ).toBeGreaterThanOrEqual(V13_BASELINE_TEST_COUNT);
  });

  it("at least 30 distinct test files exist under benchmark/tests/", () => {
    // Loose floor on file count; v1.4 has 44+. This catches mass-deletion
    // regressions (e.g., a checkout that nukes the whole tests directory).
    const entries = readdirSync(TESTS_DIR).filter((n) =>
      n.endsWith(".test.ts"),
    );
    expect(entries.length).toBeGreaterThanOrEqual(30);
  });

  it("exposes V13_BASELINE_TEST_COUNT as the documented threshold (474)", () => {
    expect(V13_BASELINE_TEST_COUNT).toBe(474);
  });
});
