/**
 * scripts/__tests__/v1.4-log-validator.test.ts
 *
 * FIX (2026-07-12 audit): the shipped validator previously hard-failed the
 * majority of lines a REAL run's canonical `.guild/runs/<id>/logs/v1.4-events.jsonl`
 * actually contains:
 *   - hooks/capture-telemetry.ts hook-name mirror lines (`event` is a raw
 *     Claude Code hook name — PostToolUse / SubagentStop / UserPromptSubmit —
 *     not one of the 12 wrapped v1.4 EVENT_TYPES).
 *   - guild.trace.*.v1 R-TRACE lines, which carry `schema_version` instead of
 *     `event` at all.
 *
 * This spec uses line SHAPES taken directly from real run directories in
 * this repo (`.guild/runs/<run-id>/logs/v1.4-events.jsonl`) rather than
 * hand-invented fixtures, per the fix instructions. Field VALUES are
 * synthetic; the SHAPE (key set + types) matches what capture-telemetry.ts
 * and guild-trace-emit.ts actually write.
 */

import { validateEvent, validateText } from "../v1.4-log-validator";

describe("v1.4-log-validator — hook-name mirror lines (hooks/capture-telemetry.ts)", () => {
  it("accepts a real-shape PostToolUse mirror line (no run_id, no `hook_event` wrapper)", () => {
    // Shape lifted from .guild/runs/*/logs/v1.4-events.jsonl (a real run dir
    // in this repo) — capture-telemetry.ts's flat TelemetryEvent shape.
    const line = {
      ts: "2026-06-12T19:39:57.418Z",
      event: "PostToolUse",
      tool: "Read",
      specialist: "",
      payload_digest: "2029a340095e",
      ok: true,
      ms: 279,
      span_id: "bf81f13dceccc9ca",
      payload_ref: "logs/payloads/bf81f13dceccc9ca.json",
    };
    const result = validateEvent(line);
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("accepts a real-shape SubagentStop mirror line", () => {
    const line = {
      ts: "2026-06-14T21:06:12.400Z",
      event: "SubagentStop",
      tool: "",
      specialist: "backend",
      payload_digest: "a06879657593",
      ok: true,
      ms: 0,
    };
    expect(validateEvent(line)).toEqual({ ok: true, errors: [] });
  });

  it("accepts a real-shape UserPromptSubmit mirror line", () => {
    const line = {
      ts: "2026-06-14T21:06:12.400Z",
      event: "UserPromptSubmit",
      tool: "",
      specialist: "",
      payload_digest: "0273bf96cb44",
      ok: true,
      ms: 0,
      prompt: "/guild:build",
    };
    expect(validateEvent(line)).toEqual({ ok: true, errors: [] });
  });

  it("accepts optional R-TRACE v2 fields (span_id, tier, tokens, payload_ref)", () => {
    const line = {
      ts: "2026-06-12T19:39:57.418Z",
      event: "PostToolUse",
      tool: "Bash",
      specialist: "backend",
      payload_digest: "a06879657593",
      ok: true,
      ms: 234,
      span_id: "b4a5d8bea7b68f89",
      parent_span_id: "root",
      tier: "mid",
      tokens: { input: 120, output: 45, cached: 0, cost_usd: 0.002 },
      payload_ref: "logs/payloads/b4a5d8bea7b68f89.json",
    };
    expect(validateEvent(line)).toEqual({ ok: true, errors: [] });
  });

  it("rejects a mirror line with a non-boolean ok", () => {
    const line = {
      ts: "2026-06-12T19:39:57.418Z",
      event: "PostToolUse",
      tool: "Read",
      specialist: "",
      payload_digest: "2029a340095e",
      ok: "true",
      ms: 279,
    };
    const result = validateEvent(line);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith("ok:"))).toBe(true);
  });

  it("rejects a mirror line with a malformed tokens block", () => {
    const line = {
      ts: "2026-06-12T19:39:57.418Z",
      event: "PostToolUse",
      tool: "Read",
      specialist: "",
      payload_digest: "2029a340095e",
      ok: true,
      ms: 279,
      tokens: { input: "not-a-number" },
    };
    const result = validateEvent(line);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith("tokens:"))).toBe(true);
  });
});

describe("v1.4-log-validator — guild.trace.*.v1 lines (delegated to guild-trace-events)", () => {
  it.each(["run_started", "run_closed"] as const)("accepts the frozen guild.trace_event.v1 %s lifecycle marker", (eventName) => {
    expect(validateEvent({
      schema_version: "guild.trace_event.v1",
      event_id: "evt-123e4567-e89b-12d3-a456-426614174000",
      event_name: eventName,
      run_id: "run-20260821-120000-shareable-evidence",
      at: "2026-08-21T12:00:00.000Z",
    })).toEqual({ ok: true, errors: [] });
  });

  it("rejects an open or malformed guild.trace_event.v1 marker", () => {
    const result = validateEvent({
      schema_version: "guild.trace_event.v1",
      event_id: "attacker",
      event_name: "run_started",
      run_id: "run-x",
      at: "yesterday",
      injected: true,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("invalid or open member shape"),
      expect.stringContaining("event_id"),
      expect.stringContaining("at"),
    ]));
  });

  it.each([
    ["hyphen-only pseudo UUID", { event_id: `evt-${"-".repeat(36)}` }],
    ["impossible timestamp", { at: "2026-99-21T25:61:61.000Z" }],
  ])("rejects a %s lifecycle marker", (_label, override) => {
    const result = validateEvent({
      schema_version: "guild.trace_event.v1",
      event_id: "evt-123e4567-e89b-12d3-a456-426614174000",
      event_name: "run_started",
      run_id: "run-20260821-120000-shareable-evidence",
      at: "2026-08-21T12:00:00.000Z",
      ...override,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a real-shape guild.trace.dispatch.v1 line", () => {
    const line = {
      schema_version: "guild.trace.dispatch.v1",
      ts: "2026-07-01T12:00:00.000Z",
      run_id: "run-abc123",
      lane_id: "backend-api-001",
      specialist: "backend",
      phase: "execute",
      task_id: "backend-api-001",
      backend: "unknown",
      backend_rung: 0,
      dispatched_at: "2026-07-01T12:00:00.000Z",
    };
    expect(validateEvent(line)).toEqual({ ok: true, errors: [] });
  });

  it("rejects a guild.trace.dispatch.v1 line with a missing required field", () => {
    const line = {
      schema_version: "guild.trace.dispatch.v1",
      ts: "2026-07-01T12:00:00.000Z",
      run_id: "run-abc123",
      lane_id: "backend-api-001",
      specialist: "backend",
      // phase intentionally omitted
      task_id: "backend-api-001",
      backend: "unknown",
      backend_rung: 0,
      dispatched_at: "2026-07-01T12:00:00.000Z",
    };
    const result = validateEvent(line);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects an unknown guild.trace.*.v1 schema_version", () => {
    const line = {
      schema_version: "guild.trace.made_up.v1",
      ts: "2026-07-01T12:00:00.000Z",
      run_id: "run-abc123",
      lane_id: "",
    };
    const result = validateEvent(line);
    expect(result.ok).toBe(false);
  });
});

describe("v1.4-log-validator — original wrapped v1.4 EVENT_TYPES (back-compat, no regression)", () => {
  it("still accepts a real-shape wrapped tool_call line", () => {
    // Shape lifted from an older .guild/runs/*/logs/v1.4-events.jsonl in this
    // repo (the wrapped schema-doc shape, distinct from the hook-mirror family).
    const line = {
      ts: "2026-06-15T03:16:21.505Z",
      event: "tool_call",
      run_id: "run-2026-06-15T03-14-57-320Z",
      tool: "Bash",
      command_redacted: "",
      status: "ok",
      latency_ms: 42,
      result_excerpt_redacted: "{}",
      span_id: "09fc4a3d4cf8292c",
    };
    expect(validateEvent(line)).toEqual({ ok: true, errors: [] });
  });

  it("rejects an unknown event token that is neither a wrapped type, a hook name, nor a trace schema", () => {
    const result = validateEvent({ ts: "2026-06-15T03:16:21.505Z", event: "not_a_real_event" });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("event: unknown value");
  });
});

describe("v1.4-log-validator — validateText over a mixed real-shape JSONL blob", () => {
  it("validates a run log mixing lifecycle, hook-mirror, and guild.trace.dispatch.v1 lines as 100% clean", () => {
    const lines = [
      {
        schema_version: "guild.trace_event.v1",
        event_id: "evt-123e4567-e89b-12d3-a456-426614174000",
        event_name: "run_started",
        run_id: "run-f4e8fda7",
        at: "2026-06-12T19:39:00.000Z",
      },
      {
        ts: "2026-06-12T19:39:57.418Z",
        event: "PostToolUse",
        tool: "Read",
        specialist: "",
        payload_digest: "2029a340095e",
        ok: true,
        ms: 279,
        span_id: "bf81f13dceccc9ca",
      },
      {
        ts: "2026-06-12T19:40:03.953Z",
        event: "PostToolUse",
        tool: "Bash",
        specialist: "",
        payload_digest: "a06879657593",
        ok: true,
        ms: 234,
        span_id: "b4a5d8bea7b68f89",
      },
      {
        schema_version: "guild.trace.dispatch.v1",
        ts: "2026-06-12T19:40:04.000Z",
        run_id: "run-f4e8fda7",
        lane_id: "backend-api-001",
        specialist: "backend",
        phase: "execute",
        task_id: "backend-api-001",
        backend: "unknown",
        backend_rung: 0,
        dispatched_at: "2026-06-12T19:40:04.000Z",
      },
    ];
    const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const summary = validateText(text);
    expect(summary.total).toBe(4);
    expect(summary.invalid).toBe(0);
    expect(summary.valid).toBe(4);
  });
});
