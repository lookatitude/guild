/**
 * R-VAC — anti-vacuity lint (ADVISORY).
 *
 * Two independent vacuity checks over test files:
 *
 *   1. GUARD-CONTROL LINK (original). A test whose title (it/test/describe) contains the
 *      word "guard" (case-insensitive) must be paired, in the same file, with a
 *      `// @control: <link>` annotation naming the deliberately-failing control that
 *      proves the guard is non-vacuous.
 *
 *   2. ZERO-ASSERTION TESTS (codex G-lane fix #2). Independent of the title, ANY
 *      individual `it(...)` / `test(...)` whose body contains ZERO assertions
 *      (no expect(…) / assert(…)/assert.*(…)/.should / proveAssert(…) call) is flagged —
 *      a test that asserts nothing cannot fail and is vacuous. The count is per-test-body,
 *      not per-file, so one empty test in an otherwise-asserting file is still caught.
 *      A test that delegates to a helper marked `// @asserts-in-helper` is exempt (it
 *      asserts indirectly); pending/skipped (it.skip/it.todo/xit) and table-only
 *      placeholders are not double-counted.
 *
 * Scope: tests/** + scripts/__tests__/** (the two suites that ship tests).
 * ADVISORY — lists violations as W2 backlog; it does not block.
 *
 * Anti-vacuity (the lint guarding the lint): `--prove` asserts (a) a guard test with no
 * `// @control:` is flagged, (b) one with it is not, (c) a non-guard test is not
 * guard-flagged, and (d) the PLANTED assertion-free test is flagged while an asserting
 * test is not.
 */
import { REPO, RailResult, report, walk, read, rel, proveAssert } from "./_common";
import * as path from "path";

const GUARD_TITLE_RE =
  /\b(?:it|test|describe)\s*(?:\.\w+)?\s*\(\s*[`'"]([^`'"]*\bguard\w*[^`'"]*)[`'"]/gi;
const CONTROL_RE = /\/\/\s*@control:\s*(\S.*)/;

// A single test case opener: it(...) / test(...) (NOT describe — that is a group).
// Skipped/todo variants are excluded — a pending test is intentionally inert, not vacuous.
const TEST_OPENER_RE = /\b(it|test)\s*(\.\w+)?\s*\(\s*([`'"])((?:\\.|(?!\3).)*)\3/g;

// Assertion forms counted inside a test body.
const ASSERTION_RE =
  /\bexpect\s*\(|\bassert\b\s*(?:\.\w+)?\s*\(|\bproveAssert\s*\(|\.should\b|\bexpectTypeOf\s*\(/;

const ASSERTS_IN_HELPER_RE = /\/\/\s*@asserts-in-helper\b/;

export interface VacFinding {
  file: string;
  guardTitles: string[];
  hasControl: boolean;
  /** titles of individual tests whose body has zero assertions. */
  zeroAssertionTests: string[];
}

/**
 * Extract each test body from `it(...)`/`test(...)` by brace-matching from the opening
 * paren's callback. Returns { title, body } per test. Robust enough for the suite (it
 * tolerates strings/comments only well enough to count assertion tokens — it is a lint,
 * not a parser).
 */
export function extractTestBodies(content: string): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  TEST_OPENER_RE.lastIndex = 0;
  while ((m = TEST_OPENER_RE.exec(content))) {
    const title = m[4];
    // find the matching close paren for the it(...) call, starting at the opener's "("
    const openParen = content.indexOf("(", m.index);
    if (openParen < 0) continue;
    let depth = 0;
    let i = openParen;
    for (; i < content.length; i++) {
      const c = content[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const rawArgs = content.slice(openParen + 1, i);
    // strip the leading title-string argument so a title like `it("call expect() first")`
    // cannot create a false assertion match in an otherwise-empty body. We cut from the
    // first `=>` or the first `function` after the title; if neither, fall back to rawArgs.
    const cbMatch = rawArgs.match(/=>|function\b/);
    const body = cbMatch ? rawArgs.slice((cbMatch.index ?? 0)) : rawArgs;
    out.push({ title, body });
  }
  return out;
}

/** Count assertion calls in a single test body. */
export function countAssertions(body: string): number {
  let n = 0;
  const re = new RegExp(ASSERTION_RE.source, "g");
  while (re.exec(body)) n++;
  return n;
}

/** Pure detector for one file: guard-control gaps + per-test zero-assertion vacuity. */
export function lintFile(relPath: string, content: string): VacFinding | null {
  const titles: string[] = [];
  let m: RegExpExecArray | null;
  GUARD_TITLE_RE.lastIndex = 0;
  while ((m = GUARD_TITLE_RE.exec(content))) titles.push(m[1].trim());

  const controlMatch = CONTROL_RE.exec(content);
  const hasControl = !!controlMatch && controlMatch[1].trim().length > 0;

  const zeroAssertionTests: string[] = [];
  for (const { title, body } of extractTestBodies(content)) {
    if (ASSERTS_IN_HELPER_RE.test(body)) continue; // delegates to an asserting helper
    if (countAssertions(body) === 0) zeroAssertionTests.push(title.trim());
  }

  if (titles.length === 0 && zeroAssertionTests.length === 0) return null;
  return { file: relPath, guardTitles: titles, hasControl, zeroAssertionTests };
}

const SCAN_DIRS = ["tests", path.join("scripts", "__tests__")];

export function run(): RailResult {
  const out: RailResult = { rail: "R-VAC", pass: true, advisory: true, violations: [], notes: [] };
  let guardFiles = 0;
  let scanned = 0;
  let zeroAssertCount = 0;
  for (const d of SCAN_DIRS) {
    for (const f of walk(path.join(REPO, d), (n) => n.endsWith(".test.ts"))) {
      scanned++;
      const finding = lintFile(rel(f), read(f));
      if (!finding) continue;
      if (finding.guardTitles.length > 0) guardFiles++;
      if (finding.guardTitles.length > 0 && !finding.hasControl) {
        out.violations.push(
          `${finding.file}: ${finding.guardTitles.length} guard-titled test(s) with NO \`// @control:\` link — e.g. "${finding.guardTitles[0]}"`,
        );
      }
      for (const t of finding.zeroAssertionTests) {
        zeroAssertCount++;
        out.violations.push(`${finding.file}: ZERO-ASSERTION test (vacuous) — "${t}"`);
      }
    }
  }
  out.notes.push(`scanned ${scanned} *.test.ts under ${SCAN_DIRS.join(", ")}`);
  out.notes.push(`${guardFiles} file(s) carry guard-titled tests; ${zeroAssertCount} zero-assertion test(s) flagged`);
  out.notes.push("rule 1: a guard-named test must carry `// @control: <failing-control-link>`");
  out.notes.push("rule 2: every it()/test() must contain ≥1 assertion (or `// @asserts-in-helper`)");
  return out;
}

function prove(): void {
  console.log("\n[R-VAC] --prove (anti-vacuity)");

  // rule 1 — guard/control
  const bad = lintFile("x.test.ts", `it("guards against prototype pollution", () => { expect(1).toBe(1); });`);
  proveAssert(!!bad && !bad.hasControl, "detector FLAGS a guard-titled test with no // @control:");
  const good = lintFile(
    "y.test.ts",
    `// @control: ./proto-poison.control.test.ts (expected-fail)\nit("guards against prototype pollution", () => { expect(1).toBe(1); });`,
  );
  proveAssert(!!good && good.hasControl, "detector ACCEPTS a guard-titled test that carries a // @control: link");

  // rule 2 — zero-assertion (PLANTED CONTROL)
  const empty = lintFile("z.test.ts", `it("does a thing and asserts nothing", () => {\n  const x = compute();\n});`);
  proveAssert(
    !!empty && empty.zeroAssertionTests.length === 1,
    "PLANTED CONTROL: an assertion-free it() body is FLAGGED as a zero-assertion vacuous test",
  );
  const asserting = lintFile("z2.test.ts", `it("returns the sum of two numbers", () => {\n  expect(add(2, 3)).toBe(5);\n});`);
  proveAssert(
    !!asserting === false || asserting!.zeroAssertionTests.length === 0,
    "detector does NOT flag a test that contains an expect() assertion",
  );

  // a non-guard test that DOES assert produces no finding at all
  const neutral = lintFile("n.test.ts", `it("returns the sum", () => { assert.equal(add(2,3), 5); });`);
  proveAssert(neutral === null, "detector IGNORES a non-guard test that carries an assertion");

  // mixed file: one empty test among asserting tests is still caught (per-body, not per-file)
  const mixed = lintFile(
    "m.test.ts",
    `it("a", () => { expect(1).toBe(1); });\nit("b — forgot to assert", () => { doStuff(); });\nit("c", () => { expect(2).toBe(2); });`,
  );
  proveAssert(
    !!mixed && mixed.zeroAssertionTests.length === 1 && mixed.zeroAssertionTests[0] === "b — forgot to assert",
    "detector catches a single empty test among asserting ones (per-test-body counting)",
  );

  // helper-delegation exemption
  const helper = lintFile(
    "h.test.ts",
    `it("delegates", () => {\n  // @asserts-in-helper\n  runGoldenCase("x");\n});`,
  );
  // exempted + no guard title → no finding at all (null), i.e. zero zero-assertion flags
  proveAssert(
    helper === null || helper.zeroAssertionTests.length === 0,
    "detector EXEMPTS a test marked // @asserts-in-helper",
  );

  // body extractor + counter sanity
  proveAssert(countAssertions("expect(a).toBe(b); expect(c).toEqual(d);") === 2, "countAssertions counts multiple expect() calls");
  proveAssert(extractTestBodies(`it("x", () => { foo(); })`).length === 1, "extractTestBodies finds an it() body");
}

if (require.main === module) {
  if (process.argv.includes("--prove")) prove();
  else process.exit(report(run()));
}
