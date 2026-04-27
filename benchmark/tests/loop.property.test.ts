// loop.property.test.ts
//
// v1.3 — F2 / qa (T4-qa). fast-check property coverage for the M13
// path-allowlist guard inside `loopRollback()`. Backend (T2) added 12
// example-based loopRollback tests; this file adds the property layer the
// lane scope calls out as natural for F2.
//
// Two properties:
//
//   Property A (positive). For any string `candidateId` matching
//     PROPOSAL_ID_RE = /^[a-zA-Z0-9._-]{1,128}$/, the M13 candidate-id
//     allowlist guard inside loopRollback() does NOT fire — calls may
//     still throw on later checks (missing manifest, state mismatch,
//     etc.) but NEVER with the M13 candidate-id message. This pins the
//     regex's ENTIRE positive surface, not just the seven hand-picked
//     ids the example tests cover.
//
//   Property B (negative). For any string NOT matching PROPOSAL_ID_RE
//     (contains `/`, `..`, NUL, length > 128, length 0, shell
//     metacharacters, whitespace, …), loopRollback() ALWAYS throws with
//     the M13 candidate-id message — never silently accepts a
//     path-traversal-shaped id. The example tests pin five hand-picked
//     bad ids; this property pins the whole negative surface fast-check
//     can synthesize.
//
// =============================================================================
// v1.3 TEST PLAN — what coverage each item gets and why
// =============================================================================
//
// Audit cross-walk for the v1.3 deferred-cleanup deliverables. One
// paragraph per item, in the bucket-and-rationale shape.
//
// F2 — `loop --rollback` action (loopRollback + CLI dispatch).
//   Bucket: UNIT (12 tests in loop.unit.test.ts /loopRollback) + CLI
//   PINNING (4 tests in cli.loop.test.ts) + PROPERTY (this file, 2
//   properties). Why this mix: the loopRollback business logic is pure
//   and disk-deterministic, so example-based unit tests pin the state
//   transitions cheaply (12 tests cover missing-arg, M13 path-traversal,
//   missing-manifest, wrong-state, dry-run-default, --confirm flip, git
//   revert non-zero, candidate-id mismatch, lockfile cleanup). The CLI
//   layer is a thin argv translation, so 4 tests pin the
//   shape-and-exit-code contract. The PROPERTY layer is for the M13
//   regex itself: example tests can only cover what the author thought
//   to write, and the regex `[a-zA-Z0-9._-]{1,128}` has a vast input
//   space that fast-check can sample broadly. Properties A + B together
//   pin the regex's positive AND negative surface — without them, a
//   future "fix" that subtly broadens the allowlist (e.g., adding `+` or
//   widening the length bound) could pass all 12 unit tests and slip
//   through. End-to-end / integration is intentionally out of scope: the
//   live --confirm path shells out to `git revert`, which the unit tests
//   already exercise against a real `git init` scratch repo, and any
//   higher level than that would require a real plugin install (covered
//   by the orchestrator's separate live-smoke gate).
//
// F4 — `auth_identity_hash` end-to-end (server LIST projection +
//   frontend filter).
//   Bucket: REGRESSION (1 test in server.runs.test.ts pinning the LIST
//   endpoint forwards the field when present and omits it when absent)
//   + UI (3 tests in ui/src/__tests__/RunsListPage.test.tsx pinning the
//   ?auth=<prefix> filter: filter-off, filter-on-matching,
//   filter-on-no-matches). Why this mix: the bug class (zod's `.strip`
//   silently dropping the field before it reaches the LIST projection)
//   is exactly the regression-pinning shape — one test that fails when
//   the field is stripped, passes when it's forwarded. Property testing
//   adds nothing for a single-field forward; the input is a hex string
//   the importer writes, not operator input. The UI side is a 7-char
//   prefix filter against a fetched array; example tests covering the
//   three branch arms (no filter / matching filter / non-matching
//   filter) exhaust the behaviour. Out of scope: pagination, server-
//   side filter, case-insensitive matching — all explicit non-goals
//   per the bundle and frontend's T3 receipt.
//
// F8 — `export-website` subcommand removed.
//   Bucket: REGRESSION (1 test in cli.test.ts, flipped from the v1.2
//   "deferred to P3" assertion to assert exit 1 with "Unknown
//   command"). Why this is the right bucket: F8 is a deletion. The only
//   thing worth pinning is "the operator gets a useful signal when they
//   try the old command" — which is exactly what the flipped test
//   asserts. Anything more would be testing the absence of code, which
//   is what the typecheck (running on every PR) already pins. Property
//   testing is nonsensical here (no input space), unit testing covers
//   nothing the regression test doesn't. The only check I performed on
//   F8 was confirming backend's flip happened (it did — see the test at
//   cli.test.ts:82-90).
//
// F12 — dev-team `SubagentStop` reflection gate.
//   Bucket: UNIT/INTEGRATION (6 tests in hooks/__tests__/maybe-reflect.
//   test.ts covering the gate matrix). Why this mix: the gate has three
//   meaningful guards (env opt-in, ≥ 3 dispatches threshold from
//   events.ndjson, spec presence) and the lane spec demanded ≥ 3
//   branches; backend shipped 6 (env-unset / env-set-below-threshold /
//   env-set-met-threshold-with-spec / slug-explicit / slug-points-at-
//   missing / no-spec-dir). That's already wider than the spec floor
//   and exercises every guard's positive AND negative arm. Property
//   testing would help if the dispatch-counter logic had numeric
//   subtleties (boundary off-by-one), but the threshold is a fixed
//   integer (≥ 3) and the counter is a simple `events.ndjson` line
//   count; example tests cover the boundary (2 → no-op, 3 → fires).
//   Out of scope: the actual reflection-write side effect — the gate
//   only governs whether the writer runs, not what it writes (which is
//   covered separately in the existing maybe-reflect Stop-branch
//   tests).
//
// ADR-007 RSS WARN sampler (helper added in src/runner.ts).
//   Bucket: UNIT (14 tests in tests/runner.rss-warn.test.ts pinning
//   each ADR-007 §Decision §1–§5 step). Why this is the right bucket:
//   the sampler is a pure helper with injectable seams (sampleMaxRss,
//   platform, writeWarn overrides — see backend's T2 receipt §6).
//   Example tests can hand the helper exactly the (platform, byte-
//   count, sequence-of-samples) tuples that exercise each branch:
//   macOS bytes-to-KB normalization, Linux passthrough, Windows
//   passthrough, threshold crossing, once-per-run latch, env-unset
//   no-op. fast-check would help if the sampler had timing-class bugs
//   (the runner.race.property.test.ts is the model), but the sampler
//   uses fake timers + a fixed 1Hz cadence — there is no race surface.
//   Out of scope: real `process.resourceUsage()` integration (would
//   require a real long-running spawn), real cgroups / Job Object
//   integration (per the ADR, no portable hard cap is implemented).
//
// =============================================================================

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PROPOSAL_ID_RE, loopRollback } from "../src/loop.js";
import type { LoopContext } from "../src/loop.js";
import type { LoopRollbackOptions } from "../src/types.js";

// A regex string pattern equivalent to PROPOSAL_ID_RE but written as a
// string for fc.stringMatching (which takes a RegExp). fast-check's
// stringMatching honors anchors and class boundaries.
const PROPOSAL_ID_RE_FOR_FC = PROPOSAL_ID_RE;

// Fixed valid baselineRunId for both properties — must pass its own
// regex check so the candidate-id check is reached. Using a single
// constant keeps the property's failure surface tight (only candidateId
// varies).
const VALID_BASELINE = "valid-base-id";

// ctx with non-existent dirs — we never reach disk in these properties,
// because the M13 regex check happens BEFORE any disk read. Even when
// the regex passes (Property A), the next check ("manifest not found
// at …") fires inside the synthetic temp dir, not the real filesystem.
const ctx: LoopContext = {
  runsDir: "/tmp/qa-loop-property-nonexistent-runs",
  casesDir: "/tmp/qa-loop-property-nonexistent-cases",
};

const M13_CANDIDATE_PATTERN = /is not a valid proposal_id/;

describe("loop / loopRollback — F2 M13 property surface (v1.3 / T4-qa)", () => {
  // ---- Property A — positive: any regex-matching candidateId never trips
  // the M13 candidate-id allowlist guard. (May still throw on missing
  // manifest etc. — that's not what we're checking here.)
  it("[property A] for any regex-matching candidateId, the M13 candidate-id guard does not fire", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringMatching(PROPOSAL_ID_RE_FOR_FC),
        async (candidateId) => {
          const opts: LoopRollbackOptions = {
            baselineRunId: VALID_BASELINE,
            candidateId,
            dryRun: true,
          };
          // The regex check is pure — no real fs IO required to reach
          // it. We expect EITHER no throw (very unlikely without a real
          // manifest) OR a throw whose message does NOT match the M13
          // candidate-id pattern.
          try {
            await loopRollback(opts, ctx);
            // Reaching here means no error fired at all; the regex
            // check certainly passed, so the property holds.
            return true;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Property: the M13 candidate-id allowlist message must NOT
            // appear. Any other error is fine (manifest not found, etc.).
            return !M13_CANDIDATE_PATTERN.test(msg);
          }
        },
      ),
      { numRuns: 200, verbose: false },
    );
  });

  // ---- Property B — negative: any candidateId NOT matching the regex
  // ALWAYS throws with the M13 candidate-id message.
  //
  // Generator: fc.string() (any unicode string, including empty, NUL,
  // shell metacharacters, multibyte chars, very long strings) filtered
  // to those that fail PROPOSAL_ID_RE. fast-check shrinks toward the
  // smallest counterexample — if the regex were ever loosened, the
  // shrink would surface a tiny counterexample (e.g. "/").
  it("[property B] for any non-matching candidateId, loopRollback throws with the M13 candidate-id message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string().filter((s) => !PROPOSAL_ID_RE.test(s)),
        async (candidateId) => {
          const opts: LoopRollbackOptions = {
            baselineRunId: VALID_BASELINE,
            candidateId,
            dryRun: true,
          };
          try {
            await loopRollback(opts, ctx);
            // Should never reach here — any non-matching id must throw.
            return false;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Two acceptable error shapes:
            //   - the M13 candidate-id message (the one we want to pin)
            //   - the "candidateId is required" message when the
            //     filter produced an empty string (the truthiness
            //     check fires before the regex check)
            // Both prove the path-traversal id was rejected pre-disk.
            const isM13 = M13_CANDIDATE_PATTERN.test(msg);
            const isMissingArg = /--candidate-id <id> is required/.test(msg);
            return isM13 || isMissingArg;
          }
        },
      ),
      { numRuns: 200, verbose: false },
    );
  });

  // ---- Regression seed: the example-test ids from loop.unit.test.ts
  // pinned as a hard-coded list, so a future refactor of the regex
  // can't accidentally break them silently. This complements the
  // property test by acting as a fc.examples-style boundary list.
  it("regression seeds — boundary ids that must remain accepted/rejected", () => {
    // Accepted (positive seeds from the example tests)
    expect(PROPOSAL_ID_RE.test("ref-001")).toBe(true);
    expect(PROPOSAL_ID_RE.test("a")).toBe(true);
    expect(PROPOSAL_ID_RE.test("PROPOSAL_42")).toBe(true);
    expect(PROPOSAL_ID_RE.test("a.b.c")).toBe(true);
    expect(PROPOSAL_ID_RE.test("dot-_combo.42")).toBe(true);
    expect(PROPOSAL_ID_RE.test("a".repeat(128))).toBe(true);
    // Rejected (negative seeds: M13 path-traversal + shell + NUL +
    // length boundary)
    expect(PROPOSAL_ID_RE.test("")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a".repeat(129))).toBe(false);
    expect(PROPOSAL_ID_RE.test("../etc/passwd")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a/b")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a\\b")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a;b")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a b")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a\u0000b")).toBe(false);
  });
});
