import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { scoreRun } from "../src/scorer.js";
import type {
  Case,
  EventLine,
  ReceiptSummary,
  RunRecord,
  RunStatus,
} from "../src/types.js";
import { COMPONENT_KEYS, EXPECTED_GATES } from "../src/types.js";

// Property arbitraries — generate well-formed Case + RunRecord pairs.
//
// Why bound the space? The scoring invariants (sum-equals, bounds,
// monotonicity) hold for any well-formed RunRecord matched against any
// well-formed Case. We don't need to fuzz schema-validation here (that's
// done in artifact-importer.test.ts); we need broad coverage of the
// scorer's branches: present / absent acceptance commands, dispatched
// supersets / subsets / disjoints, gates passed / skipped, evidence
// present / absent, with / without wall-clock budget, retry / tool_error
// counts, and every status value.

const arbStatus: fc.Arbitrary<RunStatus> = fc.constantFrom(
  "pass",
  "fail",
  "timeout",
  "errored",
);

const SPECIALIST_POOL = [
  "architect",
  "backend",
  "qa",
  "technical-writer",
  "researcher",
  "devops",
  "security",
  "mobile",
];

const arbAcceptanceCommands: fc.Arbitrary<string[]> = fc
  .uniqueArray(
    fc.constantFrom(
      "npm install",
      "npm test",
      "npm run typecheck",
      "test -f a",
      "test -f b",
    ),
    { maxLength: 5 },
  );

const arbCase: fc.Arbitrary<Case> = fc.record({
  schema_version: fc.constant(1),
  id: fc.constant("prop-case"),
  title: fc.constant("Property test case"),
  timeout_seconds: fc.integer({ min: 60, max: 3600 }),
  repetitions: fc.integer({ min: 1, max: 5 }),
  fixture: fc.constant("../fixtures/synthetic-pass"),
  prompt: fc.constant("do thing"),
  expected_specialists: fc.uniqueArray(fc.constantFrom(...SPECIALIST_POOL), {
    minLength: 0,
    maxLength: 6,
  }),
  expected_stage_order: fc.constant([
    "brainstorm",
    "team",
    "plan",
    "context",
    "execute",
    "review",
    "verify",
    "reflect",
  ]),
  acceptance_commands: arbAcceptanceCommands,
  wall_clock_budget_ms: fc.option(fc.integer({ min: 1000, max: 3_000_000 }), {
    nil: undefined,
  }) as fc.Arbitrary<number | undefined>,
});

const arbReceipt: fc.Arbitrary<ReceiptSummary> = fc.record({
  task_id: fc.string({ minLength: 1, maxLength: 16 }),
  specialist: fc.constantFrom(...SPECIALIST_POOL),
  status: fc.constantFrom("complete", "blocked", "errored"),
  evidence_present: fc.boolean(),
  evidence_chars: fc.integer({ min: 0, max: 5000 }),
});

const arbDispatchedEvents = fc
  .uniqueArray(fc.constantFrom(...SPECIALIST_POOL), { maxLength: 6 })
  .map((specs) =>
    specs.map<EventLine>((s, i) => ({
      ts: `2026-04-26T05:${String(30 + i).padStart(2, "0")}:00Z`,
      type: "specialist_dispatched",
      specialist: s,
      task_id: `T${i + 1}-${s}`,
    })),
  );

const arbGateEvents = fc
  .uniqueArray(fc.constantFrom(...EXPECTED_GATES), { maxLength: 8 })
  .map((gates) =>
    gates.map<EventLine>((g, i) => ({
      ts: `2026-04-26T05:${String(30 + i).padStart(2, "0")}:30Z`,
      type: "gate_passed",
      gate: g,
    })),
  );

const arbAcceptanceEvents = (commands: string[]): fc.Arbitrary<EventLine[]> =>
  fc
    .array(fc.integer({ min: 0, max: 1 }), {
      minLength: commands.length,
      maxLength: commands.length,
    })
    .map((codes) =>
      commands.map<EventLine>((c, i) => ({
        ts: `2026-04-26T05:50:${String(i).padStart(2, "0")}Z`,
        type: "acceptance_command",
        command: c,
        exit_code: codes[i],
      })),
    );

const arbRetryAndError: fc.Arbitrary<EventLine[]> = fc
  .tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 5 }))
  .map(([retries, errors]) => {
    const out: EventLine[] = [];
    for (let i = 0; i < retries; i += 1) {
      out.push({ ts: `r-${i}`, type: "retry", what: "x" });
    }
    for (let i = 0; i < errors; i += 1) {
      out.push({ ts: `e-${i}`, type: "tool_error", tool: "Bash", exit_code: 1 });
    }
    return out;
  });

interface RecordParts {
  status: RunStatus;
  wall_clock_ms: number | undefined;
  wall_clock_budget_ms: number | undefined;
  receipts: ReceiptSummary[];
  hasReview: boolean;
  hasAssumptions: boolean;
  hasReflection: boolean;
  partial: boolean;
  dispatchedEvents: EventLine[];
  gateEvents: EventLine[];
  retryAndError: EventLine[];
}

const arbRecordParts: fc.Arbitrary<RecordParts> = fc.record({
  status: arbStatus,
  wall_clock_ms: fc.option(fc.integer({ min: 0, max: 5_000_000 }), {
    nil: undefined,
  }) as fc.Arbitrary<number | undefined>,
  wall_clock_budget_ms: fc.option(fc.integer({ min: 1000, max: 3_000_000 }), {
    nil: undefined,
  }) as fc.Arbitrary<number | undefined>,
  receipts: fc.array(arbReceipt, { maxLength: 6 }),
  hasReview: fc.boolean(),
  hasAssumptions: fc.boolean(),
  hasReflection: fc.boolean(),
  partial: fc.boolean(),
  dispatchedEvents: arbDispatchedEvents,
  gateEvents: arbGateEvents,
  retryAndError: arbRetryAndError,
});

function partsToRecord(parts: RecordParts, commands: string[], acceptanceEvents: EventLine[]): RunRecord {
  return {
    run: {
      schema_version: 1,
      run_id: "prop-run",
      case_slug: "prop-case",
      plugin_ref: "abc1234",
      model_ref: { architect: "claude-opus-4-7" },
      started_at: "2026-04-26T05:30:00Z",
      completed_at: "2026-04-26T05:50:00Z",
      status: parts.status,
      wall_clock_ms: parts.wall_clock_ms,
      wall_clock_budget_ms: parts.wall_clock_budget_ms,
    },
    events: [
      ...parts.dispatchedEvents,
      ...parts.gateEvents,
      ...parts.retryAndError,
      ...acceptanceEvents,
    ],
    runDir: "/tmp/prop",
    artifactsRoot: "/tmp/prop/artifacts/.guild",
    receipts: parts.receipts,
    hasReview: parts.hasReview,
    hasAssumptions: parts.hasAssumptions,
    hasReflection: parts.hasReflection,
    partial: parts.partial,
    missing_artifacts: [],
  };
}

const arbCaseAndRecord = arbCase.chain((c) =>
  arbRecordParts.chain((parts) =>
    arbAcceptanceEvents(c.acceptance_commands).map((ae) => ({
      caseFile: c,
      record: partsToRecord(parts, c.acceptance_commands, ae),
    })),
  ),
);

// ---------------------------------------------------------------------------
// Property 1 — sum-of-weighted ≈ guild_score (R1 mitigation)
// ---------------------------------------------------------------------------

describe("property: sum of weighted components equals guild_score (R1)", () => {
  it("for any well-formed Case + RunRecord, |Σweighted − guild_score| < 1e-2", () => {
    fc.assert(
      fc.property(arbCaseAndRecord, ({ caseFile, record }) => {
        const { score } = scoreRun(record, caseFile);
        const sum =
          score.components.outcome.weighted +
          score.components.delegation.weighted +
          score.components.gates.weighted +
          score.components.evidence.weighted +
          score.components.loop_response.weighted +
          score.components.efficiency.weighted;
        // The scorer rounds guild_score to 2dp via round2(); the round
        // happens after summing the already-rounded weighted values, so the
        // absolute difference cannot exceed 1e-2.
        expect(Math.abs(score.guild_score - sum)).toBeLessThan(1e-2);
      }),
      { numRuns: 200, seed: 0xdeadbeef, verbose: false },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 — bounds (R1 mitigation, scorer.ts clamps in makeComponent)
// ---------------------------------------------------------------------------

describe("property: every score is bounded (R1)", () => {
  it("for any well-formed Case + RunRecord, 0 ≤ guild_score ≤ 100 and 0 ≤ raw_subscore ≤ max_subscore for each component", () => {
    fc.assert(
      fc.property(arbCaseAndRecord, ({ caseFile, record }) => {
        const { score } = scoreRun(record, caseFile);
        expect(score.guild_score).toBeGreaterThanOrEqual(0);
        expect(score.guild_score).toBeLessThanOrEqual(100);
        for (const k of COMPONENT_KEYS) {
          const c = score.components[k];
          expect(c.raw_subscore).toBeGreaterThanOrEqual(0);
          expect(c.raw_subscore).toBeLessThanOrEqual(c.max_subscore);
          expect(c.weighted).toBeGreaterThanOrEqual(0);
          expect(c.weighted).toBeLessThanOrEqual(c.weight);
        }
      }),
      { numRuns: 200, seed: 0xc0ffee, verbose: false },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3 — monotonicity on the evidence component (R1 mitigation)
// ---------------------------------------------------------------------------
//
// Improvement operator (precise per the bundle's instruction):
//   pick any one receipt R in `record.receipts` whose `evidence_present`
//   is false; flip it to true (and bump `evidence_chars` to 40 so it
//   crosses the backend heuristic threshold). The resulting record's
//   `evidence` raw_subscore must be ≥ the original's. This respects the
//   "≥40 chars in `## Evidence` section" boundary backend documented in
//   T2's receipt; we operate at the post-import ReceiptSummary level so
//   the improvement is local and observable in one place.

describe("property: evidence component is monotone under the documented improvement operator (R1)", () => {
  const arbReceiptList = fc.array(arbReceipt, { minLength: 1, maxLength: 6 });

  it("flipping any one receipt's evidence_present false→true never decreases evidence.raw_subscore", () => {
    fc.assert(
      fc.property(
        arbReceiptList,
        fc.integer({ min: 0, max: 5 }),
        arbStatus,
        (receipts, idx, status) => {
          const baseRecord: RunRecord = {
            run: {
              schema_version: 1,
              run_id: "mono",
              case_slug: "mono",
              plugin_ref: "abc1234",
              model_ref: { architect: "claude-opus-4-7" },
              started_at: "2026-04-26T05:30:00Z",
              completed_at: "2026-04-26T05:40:00Z",
              status,
            },
            events: [
              { ts: "t", type: "stage_started", stage: "execute" },
            ],
            runDir: "/tmp/mono",
            artifactsRoot: "/tmp/mono/artifacts/.guild",
            receipts,
            hasReview: false,
            hasAssumptions: false,
            hasReflection: false,
            partial: false,
            missing_artifacts: [],
          };
          const caseFile: Case = {
            schema_version: 1,
            id: "mono",
            title: "mono",
            timeout_seconds: 600,
            repetitions: 1,
            fixture: "../fixtures/synthetic-pass",
            prompt: "do",
            expected_specialists: [],
            expected_stage_order: ["execute"],
            acceptance_commands: [],
          };
          const before = scoreRun(baseRecord, caseFile).score.components.evidence
            .raw_subscore;
          const target = idx % receipts.length;
          if (receipts[target].evidence_present) {
            // Operator only flips false→true; nothing to assert on a
            // receipt that was already true.
            return;
          }
          const improvedReceipts = receipts.map((r, i) =>
            i === target
              ? { ...r, evidence_present: true, evidence_chars: 40 }
              : r,
          );
          const after = scoreRun(
            { ...baseRecord, receipts: improvedReceipts },
            caseFile,
          ).score.components.evidence.raw_subscore;
          expect(after).toBeGreaterThanOrEqual(before);
        },
      ),
      { numRuns: 200, seed: 0xfee1900d, verbose: false },
    );
  });
});
