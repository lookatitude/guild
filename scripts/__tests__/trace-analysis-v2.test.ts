import {
  ANALYSIS_EVENT_CLASSES,
  makeAnalysisTraceEvent,
  validateGuildTraceEvent,
} from "../../src/modules/telemetry/workflows/guild-trace-events";

describe("guild.trace.analysis.v2", () => {
  it("accepts every closed event class with the analysis identity envelope", () => {
    for (const eventClass of ANALYSIS_EVENT_CLASSES) {
      const classFields = {
        ...(eventClass === "run_started" ? { run_scope: "independent" as const } : {}),
        ...(eventClass === "run_attachment_resolved" ? { run_scope: "independent" as const, signature: "independent:analysis" } : {}),
        ...(eventClass === "config_snapshot_written" ? { config_snapshot_ref: "plugin-config-snapshot.json" } : {}),
        ...(["prompt_received", "prompt_normalized", "clarifying_question_asked", "agent_prompt_sent"].includes(eventClass)
          ? { prompt_hash: "abc123", redaction: "omitted" as const, span_id: "span-1" } : {}),
        ...(eventClass.startsWith("knowledge_lookup_") || eventClass.startsWith("memory_lookup_") ? { span_id: "span-1", prompt_hash: "abc123" } : {}),
        ...(eventClass.startsWith("tool_call_") ? { span_id: "span-1" } : {}),
        ...(["tool_call_finished", "tool_call_failed"].includes(eventClass) ? { duration_ms: 1 } : {}),
        ...(["agent_dispatched", "agent_prompt_sent", "agent_handoff_written"].includes(eventClass) ? { task_id: "T1", span_id: "span-1" } : {}),
        ...(eventClass === "agent_handoff_written" ? { payload_ref: "handoffs/T1.json" } : {}),
        ...(eventClass === "agent_response_received" ? { span_id: "span-1" } : {}),
        ...(eventClass.startsWith("loop_") ? { span_id: "span-1", signature: "loop:L3" } : {}),
        ...(eventClass.startsWith("phase_") ? { span_id: "span-1", phase: "build" } : {}),
        ...(eventClass.startsWith("gate_") ? { span_id: "span-1", signature: "gate:review" } : {}),
        ...(["instruction_violation_detected", "user_steering_received", "correction_applied", "repeated_failure_detected",
          "recommendation_created", "recommendation_routed", "bug_report_prompted"].includes(eventClass)
          ? { span_id: "span-1", signature: "finding:test" } : {}),
      };
      const event = makeAnalysisTraceEvent({
        ts: "2026-08-12T01:00:00Z",
        run_id: "run-20260812-010000-analysis",
        lane_id: "",
        event_class: eventClass,
        actor_type: "lead",
        actor_id: "main",
        status: "ok",
        ...classFields,
      });
      expect(validateGuildTraceEvent(event)).toEqual({ ok: true });
    }
  });

  it("rejects unknown event classes and missing actor identity", () => {
    const base = {
      schema_version: "guild.trace.analysis.v2",
      ts: "2026-08-12T01:00:00Z",
      run_id: "run-20260812-010000-analysis",
      lane_id: "",
      event_class: "not_real",
      actor_type: "lead",
      actor_id: "main",
      status: "ok",
    };
    expect(validateGuildTraceEvent(base).ok).toBe(false);
    expect(validateGuildTraceEvent({ ...base, event_class: "prompt_received", actor_id: "" }).ok).toBe(false);
  });

  it("rejects raw inline payloads and class-specific missing evidence fields", () => {
    const base = {
      schema_version: "guild.trace.analysis.v2",
      ts: "2026-08-12T01:00:00Z",
      run_id: "run-20260812-010000-analysis",
      lane_id: "",
      actor_type: "user",
      actor_id: "operator",
      status: "ok",
    };
    expect(validateGuildTraceEvent({ ...base, event_class: "prompt_received" }).ok).toBe(false);
    expect(validateGuildTraceEvent({ ...base, event_class: "prompt_received", prompt_hash: "abc", redaction: "omitted", prompt: "raw" }).ok).toBe(false);
    expect(validateGuildTraceEvent({ ...base, event_class: "prompt_received", prompt_hash: "abc", redaction: "omitted", span_id: "span", tool_result: "raw" }).ok).toBe(false);
    expect(validateGuildTraceEvent({ ...base, actor_type: "tool", event_class: "tool_call_finished", span_id: "span" }).ok).toBe(false);
    expect(validateGuildTraceEvent({ ...base, event_class: "gate_concluded", span_id: "span" }).ok).toBe(false);
  });
});
