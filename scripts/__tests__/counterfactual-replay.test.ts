/**
 * scripts/__tests__/counterfactual-replay.test.ts
 *
 * Focused jest test for lib/counterfactual-replay.ts (item 32 — deferred v2.x
 * counterfactual trace auditing; docs/v2/12-observability.md §Replay modes).
 *
 * Coverage:
 *   1. Happy path — two non-trivial traces diffed correctly into
 *      added / removed / changed / unchanged buckets.
 *   2. Contract guarantees:
 *      a. Timestamps are never used as diff keys (two events identical except
 *         for `ts` hash to the same signature → "unchanged").
 *      b. Output is deterministic (same input → same output, no randomness).
 *      c. `all_entries` is the union of all buckets, sorted by signature.
 *      d. `base_total` and `variant_total` are correct.
 *      e. schema_version is "guild.counterfactual_diff.v1".
 *      f. Empty traces produce an empty diff with zero totals.
 *   3. validateTraceEvent — valid events pass; missing/empty required fields fail.
 *   4. parseTraceJsonl   — valid JSONL parsed; malformed lines collected without
 *                           throwing; blank lines skipped.
 *   5. Edge cases:
 *      a. Malformed / non-object elements are handled gracefully.
 *      b. Variant with more occurrences of an event kind shows positive delta.
 *      c. Base with more occurrences shows negative delta in "changed".
 *
 * Pure-function tests: no disk I/O needed (all inputs are constructed inline).
 * The CLI-integration path (fs reads) is covered by the parseTraceJsonl + temp-
 * dir test at the end, which uses real fs for completeness.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  diffTraces,
  eventSignature,
  validateTraceEvent,
  parseTraceJsonl,
  type TraceEvent,
  type CounterfactualDiff,
} from "../lib/counterfactual-replay";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RUN_A = "run-base-001";
const RUN_B = "run-variant-001";

function mkEvent(
  event: string,
  run_id: string,
  ts: string,
  extra: Record<string, unknown> = {},
): TraceEvent {
  return { event, ts, run_id, ...extra } as TraceEvent;
}

// A minimal but non-trivial base trace
const BASE_EVENTS: TraceEvent[] = [
  mkEvent("phase_start", RUN_A, "2026-01-01T00:00:00Z", { phase: "plan" }),
  mkEvent("specialist_dispatch", RUN_A, "2026-01-01T00:01:00Z", {
    lane_id: "T1a-plan",
    specialist: "planner",
    task_id: "t1",
    prompt_excerpt: "draft plan",
  }),
  mkEvent("loop_round_start", RUN_A, "2026-01-01T00:02:00Z", {
    lane_id: "T1a-plan",
    loop_layer: "L1",
    round_number: 1,
    cap: 5,
  }),
  mkEvent("loop_round_end", RUN_A, "2026-01-01T00:03:00Z", {
    lane_id: "T1a-plan",
    loop_layer: "L1",
    round_number: 1,
    terminated: "satisfied",
    terminator: "planner",
  }),
  mkEvent("phase_end", RUN_A, "2026-01-01T00:04:00Z", {
    phase: "plan",
    duration_ms: 240000,
    status: "ok",
  }),
];

// Variant trace: same structure but adds a second loop round, removes the
// specialist_dispatch, and keeps phase_start/phase_end/loop_round_end.
const VARIANT_EVENTS: TraceEvent[] = [
  mkEvent("phase_start", RUN_B, "2026-01-02T00:00:00Z", { phase: "plan" }),
  // specialist_dispatch REMOVED in variant
  mkEvent("loop_round_start", RUN_B, "2026-01-02T00:02:00Z", {
    lane_id: "T1a-plan",
    loop_layer: "L1",
    round_number: 1,
    cap: 5,
  }),
  // Extra loop round added in variant
  mkEvent("loop_round_start", RUN_B, "2026-01-02T00:05:00Z", {
    lane_id: "T1a-plan",
    loop_layer: "L1",
    round_number: 2,
    cap: 5,
  }),
  mkEvent("loop_round_end", RUN_B, "2026-01-02T00:03:00Z", {
    lane_id: "T1a-plan",
    loop_layer: "L1",
    round_number: 1,
    terminated: "satisfied",
    terminator: "planner",
  }),
  mkEvent("phase_end", RUN_B, "2026-01-02T00:04:00Z", {
    phase: "plan",
    duration_ms: 300000,
    status: "ok",
  }),
  // New event type added in variant
  mkEvent("gate_decision", RUN_B, "2026-01-02T00:06:00Z", {
    gate: "gate-3-plan",
    decision: "approved",
    source: "user",
  }),
];

// ── 1. Happy path ─────────────────────────────────────────────────────────────

describe("diffTraces — happy path", () => {
  let diff: CounterfactualDiff;

  beforeAll(() => {
    diff = diffTraces(BASE_EVENTS, VARIANT_EVENTS);
  });

  it("returns schema_version guild.counterfactual_diff.v1", () => {
    expect(diff.schema_version).toBe("guild.counterfactual_diff.v1");
  });

  it("reports correct base_total and variant_total", () => {
    expect(diff.base_total).toBe(BASE_EVENTS.length);
    expect(diff.variant_total).toBe(VARIANT_EVENTS.length);
  });

  it("detects specialist_dispatch as removed (in base, not in variant)", () => {
    const removed = diff.removed.find((e) => e.event_type === "specialist_dispatch");
    expect(removed).toBeDefined();
    expect(removed!.base_count).toBe(1);
    expect(removed!.variant_count).toBe(0);
  });

  it("detects gate_decision as added (in variant, not in base)", () => {
    const added = diff.added.find((e) => e.event_type === "gate_decision");
    expect(added).toBeDefined();
    expect(added!.base_count).toBe(0);
    expect(added!.variant_count).toBe(1);
  });

  it("detects loop_round_start as changed (1 in base, 2 in variant → delta +1)", () => {
    const changed = diff.changed.find((e) => e.event_type === "loop_round_start");
    expect(changed).toBeDefined();
    expect(changed!.base_count).toBe(1);
    expect(changed!.variant_count).toBe(2);
    expect(changed!.delta).toBe(1);
  });

  it("classifies phase_start, phase_end, loop_round_end as unchanged (count 1 in both)", () => {
    const unchangedTypes = diff.unchanged.map((e) => e.event_type).sort();
    expect(unchangedTypes).toContain("phase_start");
    expect(unchangedTypes).toContain("phase_end");
    expect(unchangedTypes).toContain("loop_round_end");
  });

  it("all_entries contains all events across all buckets", () => {
    const allFromBuckets = [
      ...diff.added,
      ...diff.removed,
      ...diff.changed,
      ...diff.unchanged,
    ].length;
    expect(diff.all_entries.length).toBe(allFromBuckets);
  });

  it("all_entries is sorted by signature (deterministic order)", () => {
    const sigs = diff.all_entries.map((e) => e.signature);
    const sorted = [...sigs].sort();
    expect(sigs).toEqual(sorted);
  });
});

// ── 2. Contract guarantees ────────────────────────────────────────────────────

describe("contract: timestamp-independence", () => {
  it("two events identical except ts have the same signature → unchanged", () => {
    const e1 = mkEvent("phase_start", "run-1", "2026-01-01T00:00:00Z", { phase: "plan" });
    const e2 = mkEvent("phase_start", "run-2", "2099-12-31T23:59:59Z", { phase: "plan" });
    const diff = diffTraces([e1], [e2]);
    expect(diff.unchanged.length).toBe(1);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.changed.length).toBe(0);
  });
});

describe("contract: determinism", () => {
  it("same inputs produce identical output on repeated calls", () => {
    const diff1 = diffTraces(BASE_EVENTS, VARIANT_EVENTS);
    const diff2 = diffTraces(BASE_EVENTS, VARIANT_EVENTS);
    expect(JSON.stringify(diff1)).toBe(JSON.stringify(diff2));
  });

  it("swapping base and variant inverts added/removed and negates deltas", () => {
    const forward = diffTraces(BASE_EVENTS, VARIANT_EVENTS);
    const reversed = diffTraces(VARIANT_EVENTS, BASE_EVENTS);
    // Signatures in removed forward === signatures in added reversed
    const fwdRemovedSigs = forward.removed.map((e) => e.signature).sort();
    const revAddedSigs = reversed.added.map((e) => e.signature).sort();
    expect(fwdRemovedSigs).toEqual(revAddedSigs);

    const fwdAddedSigs = forward.added.map((e) => e.signature).sort();
    const revRemovedSigs = reversed.removed.map((e) => e.signature).sort();
    expect(fwdAddedSigs).toEqual(revRemovedSigs);

    // Deltas are negated for changed entries
    for (const fwdEntry of forward.changed) {
      const revEntry = reversed.changed.find((e) => e.signature === fwdEntry.signature);
      expect(revEntry).toBeDefined();
      expect(revEntry!.delta).toBe(-fwdEntry.delta);
    }
  });
});

describe("contract: empty traces", () => {
  it("two empty traces produce a zero-total empty diff", () => {
    const diff = diffTraces([], []);
    expect(diff.base_total).toBe(0);
    expect(diff.variant_total).toBe(0);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.all_entries).toHaveLength(0);
  });

  it("base empty, variant non-empty → everything added", () => {
    const diff = diffTraces([], VARIANT_EVENTS);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.added.length).toBeGreaterThan(0);
    const totalVariantCount = diff.added.reduce((s, e) => s + e.variant_count, 0);
    expect(totalVariantCount).toBe(VARIANT_EVENTS.length);
  });

  it("variant empty, base non-empty → everything removed", () => {
    const diff = diffTraces(BASE_EVENTS, []);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.removed.length).toBeGreaterThan(0);
    const totalBaseCount = diff.removed.reduce((s, e) => s + e.base_count, 0);
    expect(totalBaseCount).toBe(BASE_EVENTS.length);
  });
});

// ── 3. validateTraceEvent ─────────────────────────────────────────────────────

describe("validateTraceEvent", () => {
  it("accepts a valid minimal event", () => {
    const { valid, errors } = validateTraceEvent({
      event: "phase_start",
      ts: "2026-01-01T00:00:00Z",
      run_id: "run-001",
    });
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it("accepts a valid event with extra v2 fields (lenient reader)", () => {
    const { valid } = validateTraceEvent({
      event: "loop_round_start",
      ts: "2026-01-01T00:00:00Z",
      run_id: "run-001",
      span_id: "abc123",
      parent_span_id: "root",
      tier: "mid",
      model: "claude-sonnet-4-5",
      tokens: { input: 100, output: 200 },
    });
    expect(valid).toBe(true);
  });

  it("rejects a non-object", () => {
    const { valid, errors } = validateTraceEvent("not an object");
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects null", () => {
    const { valid } = validateTraceEvent(null);
    expect(valid).toBe(false);
  });

  it("rejects an array", () => {
    const { valid } = validateTraceEvent([]);
    expect(valid).toBe(false);
  });

  it("rejects missing event field", () => {
    const { valid, errors } = validateTraceEvent({
      ts: "2026-01-01T00:00:00Z",
      run_id: "run-001",
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"event"'))).toBe(true);
  });

  it("rejects empty-string event field", () => {
    const { valid } = validateTraceEvent({
      event: "",
      ts: "2026-01-01T00:00:00Z",
      run_id: "run-001",
    });
    expect(valid).toBe(false);
  });

  it("rejects missing ts field", () => {
    const { valid, errors } = validateTraceEvent({
      event: "phase_start",
      run_id: "run-001",
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"ts"'))).toBe(true);
  });

  it("rejects missing run_id field", () => {
    const { valid, errors } = validateTraceEvent({
      event: "phase_start",
      ts: "2026-01-01T00:00:00Z",
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"run_id"'))).toBe(true);
  });

  it("collects multiple errors in one pass", () => {
    const { valid, errors } = validateTraceEvent({});
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ── 4. parseTraceJsonl ────────────────────────────────────────────────────────

describe("parseTraceJsonl", () => {
  it("parses valid JSONL into TraceEvents", () => {
    const lines = [
      JSON.stringify({ event: "phase_start", ts: "2026-01-01T00:00:00Z", run_id: "r1", phase: "plan" }),
      JSON.stringify({ event: "phase_end", ts: "2026-01-01T00:01:00Z", run_id: "r1", phase: "plan", duration_ms: 60000, status: "ok" }),
    ].join("\n");
    const { events, parseErrors } = parseTraceJsonl(lines);
    expect(events).toHaveLength(2);
    expect(parseErrors).toHaveLength(0);
  });

  it("skips blank lines without error", () => {
    const lines = "\n\n" + JSON.stringify({ event: "phase_start", ts: "2026-01-01T00:00:00Z", run_id: "r1" }) + "\n\n";
    const { events, parseErrors } = parseTraceJsonl(lines);
    expect(events).toHaveLength(1);
    expect(parseErrors).toHaveLength(0);
  });

  it("collects parse errors for malformed JSON without throwing", () => {
    const lines = [
      JSON.stringify({ event: "phase_start", ts: "2026-01-01T00:00:00Z", run_id: "r1" }),
      "{ not valid json",
      JSON.stringify({ event: "phase_end", ts: "2026-01-01T00:01:00Z", run_id: "r1", phase: "plan", duration_ms: 60000, status: "ok" }),
    ].join("\n");
    const { events, parseErrors } = parseTraceJsonl(lines);
    expect(events).toHaveLength(2);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].line).toBe(2);
  });

  it("collects errors for lines that parse but fail validation", () => {
    const lines = [
      JSON.stringify({ event: "ok", ts: "2026-01-01T00:00:00Z", run_id: "r1" }),
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", run_id: "r1" }), // missing event
    ].join("\n");
    const { events, parseErrors } = parseTraceJsonl(lines);
    expect(events).toHaveLength(1);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].error).toMatch(/invalid event/);
  });

  it("returns empty events + empty errors for an empty string", () => {
    const { events, parseErrors } = parseTraceJsonl("");
    expect(events).toHaveLength(0);
    expect(parseErrors).toHaveLength(0);
  });
});

// ── 5. Edge cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("variant with more occurrences of an event kind shows positive delta in changed", () => {
    const base = [
      mkEvent("tool_call", "r1", "2026-01-01T00:00:00Z", { lane_id: "T1a", tool: "Read", command_redacted: "", status: "ok", latency_ms: 10, result_excerpt_redacted: "" }),
    ];
    const variant = [
      mkEvent("tool_call", "r2", "2026-01-01T00:00:00Z", { lane_id: "T1a", tool: "Read", command_redacted: "", status: "ok", latency_ms: 10, result_excerpt_redacted: "" }),
      mkEvent("tool_call", "r2", "2026-01-01T00:00:01Z", { lane_id: "T1a", tool: "Read", command_redacted: "", status: "ok", latency_ms: 10, result_excerpt_redacted: "" }),
      mkEvent("tool_call", "r2", "2026-01-01T00:00:02Z", { lane_id: "T1a", tool: "Read", command_redacted: "", status: "ok", latency_ms: 10, result_excerpt_redacted: "" }),
    ];
    const diff = diffTraces(base, variant);
    const changed = diff.changed.find((e) => e.event_type === "tool_call");
    expect(changed).toBeDefined();
    expect(changed!.delta).toBe(2); // variant has 2 more
  });

  it("base with more occurrences shows negative delta in changed", () => {
    const base = [
      mkEvent("hook_event", "r1", "T1", { hook_name: "PostToolUse", payload_excerpt_redacted: "", latency_ms: 1, status: "ok" }),
      mkEvent("hook_event", "r1", "T2", { hook_name: "PostToolUse", payload_excerpt_redacted: "", latency_ms: 1, status: "ok" }),
      mkEvent("hook_event", "r1", "T3", { hook_name: "PostToolUse", payload_excerpt_redacted: "", latency_ms: 1, status: "ok" }),
    ];
    const variant = [
      mkEvent("hook_event", "r2", "T4", { hook_name: "PostToolUse", payload_excerpt_redacted: "", latency_ms: 1, status: "ok" }),
    ];
    const diff = diffTraces(base, variant);
    const changed = diff.changed.find((e) => e.event_type === "hook_event");
    expect(changed).toBeDefined();
    expect(changed!.delta).toBe(-2); // base has 2 more
  });

  it("eventSignature is actor-aware: same event type, different actor → different signatures", () => {
    const e1 = mkEvent("specialist_dispatch", "r1", "T1", {
      lane_id: "T1a-plan",
      specialist: "planner",
      task_id: "t1",
      prompt_excerpt: "x",
    });
    const e2 = mkEvent("specialist_dispatch", "r1", "T2", {
      lane_id: "T2b-build",
      specialist: "builder",
      task_id: "t2",
      prompt_excerpt: "y",
    });
    expect(eventSignature(e1)).not.toBe(eventSignature(e2));
  });

  it("events with no actor field use '_' as actor in signature", () => {
    const e = mkEvent("phase_start", "r1", "T1", { phase: "plan" });
    // phase is actor for phase events per ACTOR_FIELD_PRIORITY (phase comes after lane_id/specialist/gate)
    const sig = eventSignature(e);
    // Should not contain "__unknown__" and should not be empty
    expect(sig).toBeTruthy();
    expect(sig.split("|").length).toBe(3);
  });

  it("v2 fields (span_id, tier, model, tokens) do not affect signature", () => {
    const base = mkEvent("phase_start", "r1", "T1", { phase: "plan" });
    const withV2 = mkEvent("phase_start", "r2", "T2", {
      phase: "plan",
      span_id: "abc123",
      parent_span_id: "root",
      tier: "mid",
      model: "claude-sonnet-4-5",
      tokens: { input: 100, output: 200 },
    });
    expect(eventSignature(base)).toBe(eventSignature(withV2));
  });
});

// ── 6. Real-path integration: parseTraceJsonl from real temp file ─────────────

describe("parseTraceJsonl — real fs integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ctr-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses a real v1.4-events.jsonl file correctly", () => {
    const jsonlPath = path.join(tmpDir, "v1.4-events.jsonl");
    const events = [
      { event: "phase_start", ts: "2026-01-01T00:00:00Z", run_id: "r1", phase: "build" },
      { event: "specialist_dispatch", ts: "2026-01-01T00:01:00Z", run_id: "r1", lane_id: "T1a-build", specialist: "builder", task_id: "t1", prompt_excerpt: "build it" },
      { event: "phase_end", ts: "2026-01-01T00:02:00Z", run_id: "r1", phase: "build", duration_ms: 120000, status: "ok" },
    ];
    fs.writeFileSync(jsonlPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

    const raw = fs.readFileSync(jsonlPath, "utf8");
    const { events: parsed, parseErrors } = parseTraceJsonl(raw);

    expect(parsed).toHaveLength(3);
    expect(parseErrors).toHaveLength(0);
    expect(parsed[0].event).toBe("phase_start");
    expect(parsed[1].event).toBe("specialist_dispatch");
    expect(parsed[2].event).toBe("phase_end");

    // Confirm diffTraces works end-to-end with real-loaded events
    const diff = diffTraces(parsed, parsed); // same → all unchanged
    expect(diff.unchanged.length).toBeGreaterThan(0);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("handles a mixed file: valid + malformed + blank lines", () => {
    const jsonlPath = path.join(tmpDir, "mixed.jsonl");
    const content = [
      JSON.stringify({ event: "phase_start", ts: "2026-01-01T00:00:00Z", run_id: "r1" }),
      "",
      "NOT JSON {{{",
      JSON.stringify({ event: "phase_end", ts: "2026-01-01T00:01:00Z", run_id: "r1", phase: "plan", duration_ms: 60000, status: "ok" }),
      JSON.stringify({ run_id: "r1", ts: "T" }), // missing event field
      "",
    ].join("\n");
    fs.writeFileSync(jsonlPath, content, "utf8");

    const raw = fs.readFileSync(jsonlPath, "utf8");
    const { events, parseErrors } = parseTraceJsonl(raw);

    expect(events).toHaveLength(2);
    expect(parseErrors).toHaveLength(2); // the malformed JSON + the invalid event
  });
});
