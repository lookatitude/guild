// v1.4.0 — schema validator tests for `scripts/v1.4-log-validator.ts`.
// Pins the binding contracts from `benchmark/plans/v1.4-jsonl-schema.md`:
//   - 12 event types accepted with required-field shapes.
//   - tool_call.tool is a CLOSED enum (17 values); validators reject unknowns.
//   - hook_event.hook_name is a CLOSED enum (12 values).
//   - escalation.options_offered is exactly the 3 canonical labels.
//   - gate_decision.gate accepts fixed gates + mid-execution-decision:<slug>.
//   - codex_review_round.gate accepts G-spec / G-plan / G-lane:<lane-id>.
//   - null is a violation per encoding rule #3.
//   - ts must be ISO-8601 millisecond UTC.

import { describe, expect, it } from "vitest";

import {
  EVENT_TYPES,
  HOOK_EVENT_NAMES,
  TOOL_CALL_TOOL_VALUES,
  validateEvent,
  validateText,
} from "../../scripts/v1.4-log-validator.js";

const TS = "2026-04-27T07:35:00.123Z";
const RUN_ID = "run-2026-04-27-validator-test";

// ──────────────────────────────────────────────────────────────────────────
// Per-event-type happy paths (12 events × 1 test each)
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-log-validator / happy path — every event type", () => {
  it("accepts a valid phase_start event", () => {
    const r = validateEvent({ ts: TS, event: "phase_start", run_id: RUN_ID, phase: "plan" });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid phase_end event", () => {
    const r = validateEvent({
      ts: TS,
      event: "phase_end",
      run_id: RUN_ID,
      phase: "plan",
      duration_ms: 1234,
      status: "ok",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid specialist_dispatch event", () => {
    const r = validateEvent({
      ts: TS,
      event: "specialist_dispatch",
      run_id: RUN_ID,
      lane_id: "T1-architect",
      specialist: "architect",
      task_id: "T1-architect",
      prompt_excerpt: "Implement F-1...",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid specialist_receipt event", () => {
    const r = validateEvent({
      ts: TS,
      event: "specialist_receipt",
      run_id: RUN_ID,
      lane_id: "T1-architect",
      specialist: "architect",
      task_id: "T1-architect",
      receipt_path: ".guild/runs/x/handoffs/architect-T1-architect.md",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid loop_round_start event", () => {
    const r = validateEvent({
      ts: TS,
      event: "loop_round_start",
      run_id: RUN_ID,
      lane_id: "T3a-backend-config",
      loop_layer: "L4",
      round_number: 1,
      cap: 16,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid loop_round_end event", () => {
    const r = validateEvent({
      ts: TS,
      event: "loop_round_end",
      run_id: RUN_ID,
      lane_id: "T3a-backend-config",
      loop_layer: "L4",
      round_number: 3,
      terminated: "satisfied",
      terminator: "qa",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid tool_call event", () => {
    const r = validateEvent({
      ts: TS,
      event: "tool_call",
      run_id: RUN_ID,
      tool: "Bash",
      command_redacted: "npm test",
      status: "ok",
      latency_ms: 100,
      result_excerpt_redacted: "PASS",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid hook_event event", () => {
    const r = validateEvent({
      ts: TS,
      event: "hook_event",
      run_id: RUN_ID,
      hook_name: "PreToolUse",
      payload_excerpt_redacted: "{}",
      latency_ms: 3,
      status: "ok",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid gate_decision event with fixed gate", () => {
    const r = validateEvent({
      ts: TS,
      event: "gate_decision",
      run_id: RUN_ID,
      gate: "gate-3-plan",
      decision: "approved",
      source: "user",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts gate_decision with mid-execution-decision:<slug>", () => {
    const r = validateEvent({
      ts: TS,
      event: "gate_decision",
      run_id: RUN_ID,
      gate: "mid-execution-decision:retry-plan",
      decision: "deferred",
      source: "auto-approve-mode",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid assumption_logged event", () => {
    const r = validateEvent({
      ts: TS,
      event: "assumption_logged",
      run_id: RUN_ID,
      lane_id: "T3a",
      specialist: "backend",
      assumption_text: "uses sync flock fallback",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid escalation event", () => {
    const r = validateEvent({
      ts: TS,
      event: "escalation",
      run_id: RUN_ID,
      reason: "cap_hit",
      options_offered: ["force-pass", "extend-cap", "rework"],
      user_choice: "extend-cap",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid codex_review_round event with G-spec gate", () => {
    const r = validateEvent({
      ts: TS,
      event: "codex_review_round",
      run_id: RUN_ID,
      gate: "G-spec",
      round_number: 1,
      terminated_by_satisfied: false,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts a valid codex_review_round event with G-lane:<lane-id>", () => {
    const r = validateEvent({
      ts: TS,
      event: "codex_review_round",
      run_id: RUN_ID,
      gate: "G-lane:T3a-backend-config",
      round_number: 5,
      terminated_by_satisfied: true,
    });
    expect(r.ok).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Closed-enum rejection — tool_call.tool + hook_event.hook_name
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-log-validator / closed-enum rejection", () => {
  it("rejects tool_call with unknown tool value", () => {
    const r = validateEvent({
      ts: TS,
      event: "tool_call",
      run_id: RUN_ID,
      tool: "FabricatedFutureTool",
      command_redacted: "",
      status: "ok",
      latency_ms: 1,
      result_excerpt_redacted: "",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("tool"))).toBe(true);
  });

  it("rejects hook_event with unknown hook_name value", () => {
    const r = validateEvent({
      ts: TS,
      event: "hook_event",
      run_id: RUN_ID,
      hook_name: "FutureHook",
      payload_excerpt_redacted: "",
      latency_ms: 1,
      status: "ok",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("hook_name"))).toBe(true);
  });

  it("rejects an unknown event type at the envelope", () => {
    const r = validateEvent({
      ts: TS,
      event: "future_event_v2",
      run_id: RUN_ID,
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("event");
  });

  it("rejects loop_round_end with malformed terminated enum", () => {
    const r = validateEvent({
      ts: TS,
      event: "loop_round_end",
      run_id: RUN_ID,
      lane_id: "T1",
      loop_layer: "L4",
      round_number: 1,
      terminated: "not-a-real-status",
      terminator: "qa",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects escalation with wrong options_offered ordering", () => {
    const r = validateEvent({
      ts: TS,
      event: "escalation",
      run_id: RUN_ID,
      reason: "cap_hit",
      options_offered: ["rework", "force-pass", "extend-cap"],
      user_choice: "rework",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("options_offered"))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Envelope rejections — null, missing, malformed timestamp
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-log-validator / envelope checks", () => {
  it("rejects ts that is not ISO-8601 with millisecond precision", () => {
    const r = validateEvent({
      ts: "2026-04-27T07:00:00Z", // no millis
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("ts"))).toBe(true);
  });

  it("rejects null in any field (encoding rule #3)", () => {
    const r = validateEvent({
      ts: TS,
      event: "phase_start",
      run_id: RUN_ID,
      phase: "plan",
      lane_id: null,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("null is not allowed"))).toBe(true);
  });

  it("rejects missing run_id", () => {
    const r = validateEvent({ ts: TS, event: "phase_start", phase: "plan" });
    expect(r.ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateEvent("string").ok).toBe(false);
    expect(validateEvent(42).ok).toBe(false);
    expect(validateEvent(null).ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Gate slug grammar
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-log-validator / gate slug grammar", () => {
  it("rejects gate_decision with slug starting with a digit", () => {
    const r = validateEvent({
      ts: TS,
      event: "gate_decision",
      run_id: RUN_ID,
      gate: "mid-execution-decision:1bad",
      decision: "approved",
      source: "user",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects gate_decision with slug containing uppercase", () => {
    const r = validateEvent({
      ts: TS,
      event: "gate_decision",
      run_id: RUN_ID,
      gate: "mid-execution-decision:Bad",
      decision: "approved",
      source: "user",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects codex_review_round with malformed lane-id", () => {
    const r = validateEvent({
      ts: TS,
      event: "codex_review_round",
      run_id: RUN_ID,
      gate: "G-lane:Bad-Lane-ID",
      round_number: 1,
      terminated_by_satisfied: false,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects codex_review_round with round_number > 5", () => {
    const r = validateEvent({
      ts: TS,
      event: "codex_review_round",
      run_id: RUN_ID,
      gate: "G-spec",
      round_number: 6,
      terminated_by_satisfied: false,
    });
    expect(r.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Whole-text validation
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-log-validator / validateText", () => {
  it("validates a multi-line JSONL blob", () => {
    const text = [
      JSON.stringify({ ts: TS, event: "phase_start", run_id: RUN_ID, phase: "plan" }),
      JSON.stringify({
        ts: TS,
        event: "phase_end",
        run_id: RUN_ID,
        phase: "plan",
        duration_ms: 100,
        status: "ok",
      }),
    ].join("\n") + "\n";
    const summary = validateText(text);
    expect(summary.total).toBe(2);
    expect(summary.valid).toBe(2);
    expect(summary.invalid).toBe(0);
  });

  it("counts JSON.parse failures as invalid", () => {
    const summary = validateText("not json\n");
    expect(summary.invalid).toBe(1);
    expect(summary.perLine[0]?.result.errors[0]).toContain("JSON.parse failed");
  });

  it("counts both valid + invalid lines", () => {
    const text =
      JSON.stringify({ ts: TS, event: "phase_start", run_id: RUN_ID, phase: "plan" }) +
      "\nnot json\n" +
      JSON.stringify({ ts: TS, event: "future_event", run_id: RUN_ID }) +
      "\n";
    const summary = validateText(text);
    expect(summary.total).toBe(3);
    expect(summary.valid).toBe(1);
    expect(summary.invalid).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Pinned constants
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-log-validator / pinned constants", () => {
  it("EVENT_TYPES has exactly 12", () => {
    expect(EVENT_TYPES.length).toBe(12);
  });

  it("TOOL_CALL_TOOL_VALUES has exactly 17", () => {
    expect(TOOL_CALL_TOOL_VALUES.length).toBe(17);
  });

  it("HOOK_EVENT_NAMES has exactly 12", () => {
    expect(HOOK_EVENT_NAMES.length).toBe(12);
  });
});
