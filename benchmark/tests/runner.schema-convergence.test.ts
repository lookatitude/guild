// runner.schema-convergence.test.ts
//
// Resolves the P1-T3 R4 follow-up at source: every line emitted to
// `events.ndjson` by the P3 runner must parse against the importer's zod
// `eventSchema` (see `benchmark/src/artifact-importer.ts`). The runner only
// emits `tool_error` events directly (in `spawnAndWait` and `copyTreeSafe`);
// the rest of the events.ndjson contents are synthesized by `claude` itself.
// We pin both shapes here:
//   (a) Every runner-emitted `tool_error` line shape parses cleanly.
//   (b) A synthetic-runner-shaped NDJSON containing every event type the
//       runner currently knows how to emit also parses (defends against
//       schema drift on the importer side).
//
// Filename is exactly `runner.schema-convergence.test.ts` because T5
// (technical-writer) cited it in `benchmark/plans/04-metrics.md` — change
// the filename only by updating that citation in the same PR.

import { describe, expect, it } from "vitest";
import { parseEventsNdjson } from "../src/artifact-importer.js";

// All event shapes the runner can directly produce. Sourced from
// `benchmark/src/runner.ts`:
//   - `spawnAndWait` emits `{type:"tool_error", tool:"process-group", exit_code:137}` on SIGKILL.
//   - `copyTreeSafe` emits `{type:"tool_error", tool:"capture", exit_code:1|17}` on path/symlink/EEXIST refusal.
//   - `runBenchmark`'s spawn-error catch emits `{type:"tool_error", tool:"spawn", exit_code:1}`.
const RUNNER_EMITTED_EVENTS = [
  '{"ts":"2026-04-26T05:30:00Z","type":"tool_error","tool":"spawn","exit_code":1}',
  '{"ts":"2026-04-26T05:30:01Z","type":"tool_error","tool":"capture","exit_code":1}',
  '{"ts":"2026-04-26T05:30:02Z","type":"tool_error","tool":"capture","exit_code":17}',
  '{"ts":"2026-04-26T05:30:03Z","type":"tool_error","tool":"process-group","exit_code":137}',
];

// Every event type the importer's discriminated union accepts. The runner
// does NOT emit most of these — claude does — but the events.ndjson the
// runner writes to disk MUST be parseable by the importer no matter which
// types appear. This catches importer/runner schema drift.
const FULL_SHAPE_EVENTS = [
  '{"ts":"2026-04-26T05:30:00Z","type":"stage_started","stage":"brainstorm"}',
  '{"ts":"2026-04-26T05:31:00Z","type":"stage_completed","stage":"brainstorm","duration_ms":60000}',
  '{"ts":"2026-04-26T05:31:02Z","type":"specialist_dispatched","specialist":"architect","task_id":"T1"}',
  '{"ts":"2026-04-26T05:35:00Z","type":"specialist_completed","specialist":"architect","task_id":"T1","status":"complete"}',
  '{"ts":"2026-04-26T05:35:01Z","type":"gate_passed","gate":"brainstorm"}',
  '{"ts":"2026-04-26T05:35:02Z","type":"gate_skipped","gate":"plan","reason":"out-of-scope"}',
  '{"ts":"2026-04-26T05:35:03Z","type":"tool_error","tool":"process-group","exit_code":137}',
  '{"ts":"2026-04-26T05:35:04Z","type":"acceptance_command","command":"npm test","exit_code":0}',
  '{"ts":"2026-04-26T05:35:05Z","type":"retry","what":"transient-network-blip"}',
];

describe("runner / schema convergence with importer eventSchema", () => {
  it("(a) every runner-emitted tool_error event parses cleanly", () => {
    const ndjson = RUNNER_EMITTED_EVENTS.join("\n") + "\n";
    const parsed = parseEventsNdjson(ndjson);
    // Schema-convergence assertion line: assert every line parsed.
    expect(parsed).toHaveLength(RUNNER_EMITTED_EVENTS.length);
    expect(parsed.every((e) => e.type === "tool_error")).toBe(true);
    // Spot-check exit_code values survived round-trip.
    const codes = parsed.map((e) => (e.type === "tool_error" ? e.exit_code : null));
    expect(codes).toEqual([1, 1, 17, 137]);
  });

  it("(b) every event type accepted by the importer parses cleanly", () => {
    const ndjson = FULL_SHAPE_EVENTS.join("\n") + "\n";
    const parsed = parseEventsNdjson(ndjson);
    expect(parsed).toHaveLength(FULL_SHAPE_EVENTS.length);
    // Tag-check the discriminated union covers every type the runner can
    // possibly write through its events.ndjson sink.
    const types = parsed.map((e) => e.type).sort();
    expect(types).toEqual(
      [
        "acceptance_command",
        "gate_passed",
        "gate_skipped",
        "retry",
        "specialist_completed",
        "specialist_dispatched",
        "stage_completed",
        "stage_started",
        "tool_error",
      ].sort(),
    );
  });

  it("rejects a malformed runner-emitted event (regression guard)", () => {
    // Sanity: if the runner ever emits a tool_error without exit_code, this
    // would slip past test (a). Guard against the schema being relaxed by
    // accident.
    const malformed =
      '{"ts":"2026-04-26T05:30:00Z","type":"tool_error","tool":"spawn"}\n';
    expect(() => parseEventsNdjson(malformed)).toThrow(/exit_code/i);
  });

  it("preserves NDJSON line ordering through the parse round-trip", () => {
    // The importer eventually feeds metrics.ts which builds gate-outcome
    // and stage-order from events.ndjson order. Pinning the parse is
    // order-preserving means a regression in parse-loop ordering surfaces
    // here, not deep in the metrics layer.
    const ndjson = RUNNER_EMITTED_EVENTS.join("\n") + "\n";
    const parsed = parseEventsNdjson(ndjson);
    expect(parsed.map((e) => (e as { ts: string }).ts)).toEqual([
      "2026-04-26T05:30:00Z",
      "2026-04-26T05:30:01Z",
      "2026-04-26T05:30:02Z",
      "2026-04-26T05:30:03Z",
    ]);
  });
});
