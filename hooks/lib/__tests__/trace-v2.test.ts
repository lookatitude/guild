/**
 * hooks/lib/__tests__/trace-v2.test.ts
 *
 * Unit tests for the guild.trace_event.v2 / guild.trace_payload.v1 helpers
 * (D-OBS-1 additive fields · D-OBS-6 span ids · D-OBS-2 payload sidecar).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  genSpanId,
  normalizeTokens,
  isLlmCallEvent,
  resolveTraceV2Fields,
  pruneUndefined,
  writePayloadSidecar,
  payloadSidecarPath,
  TRACE_PAYLOAD_SCHEMA,
  SIDECAR_MAX_BYTES,
} from "../trace-v2.js";

describe("genSpanId (D-OBS-6)", () => {
  it("is deterministic for identical inputs", () => {
    const a = genSpanId("run-1", "PostToolUse", "2026-05-26T00:00:00.000Z", "backend");
    const b = genSpanId("run-1", "PostToolUse", "2026-05-26T00:00:00.000Z", "backend");
    expect(a).toBe(b);
  });

  it("returns 16 hex chars", () => {
    const s = genSpanId("run-1", "PostToolUse", "2026-05-26T00:00:00.000Z", "backend");
    expect(s).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs when any component differs", () => {
    const base = genSpanId("run-1", "PostToolUse", "2026-05-26T00:00:00.000Z", "backend");
    expect(genSpanId("run-2", "PostToolUse", "2026-05-26T00:00:00.000Z", "backend")).not.toBe(base);
    expect(genSpanId("run-1", "SubagentStop", "2026-05-26T00:00:00.000Z", "backend")).not.toBe(base);
    expect(genSpanId("run-1", "PostToolUse", "2026-05-26T00:00:00.001Z", "backend")).not.toBe(base);
    expect(genSpanId("run-1", "PostToolUse", "2026-05-26T00:00:00.000Z", "frontend")).not.toBe(base);
  });

  it("falls back to 'main' for empty actor (stable)", () => {
    const empty = genSpanId("run-1", "PostToolUse", "2026-05-26T00:00:00.000Z", "");
    const main = genSpanId("run-1", "PostToolUse", "2026-05-26T00:00:00.000Z", "main");
    expect(empty).toBe(main);
  });
});

describe("normalizeTokens", () => {
  it("accepts canonical keys", () => {
    expect(normalizeTokens({ input: 10, output: 20, cached: 5, cost_usd: 0.01 })).toEqual({
      input: 10,
      output: 20,
      cached: 5,
      cost_usd: 0.01,
    });
  });

  it("maps Anthropic-style usage keys", () => {
    expect(
      normalizeTokens({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 }),
    ).toEqual({ input: 100, output: 50, cached: 30 });
  });

  it("returns undefined when no numeric field is present", () => {
    expect(normalizeTokens({})).toBeUndefined();
    expect(normalizeTokens(null)).toBeUndefined();
    expect(normalizeTokens("nope")).toBeUndefined();
    expect(normalizeTokens({ input: "x" })).toBeUndefined();
  });
});

describe("isLlmCallEvent", () => {
  it("recognizes LLM-call event types", () => {
    expect(isLlmCallEvent("SubagentStop")).toBe(true);
    expect(isLlmCallEvent("loop_round_end")).toBe(true);
  });
  it("rejects non-LLM tool/hook events", () => {
    expect(isLlmCallEvent("PostToolUse")).toBe(false);
    expect(isLlmCallEvent("hook_event")).toBe(false);
  });
});

describe("resolveTraceV2Fields (D-OBS-1)", () => {
  const base = {
    runId: "run-1",
    eventType: "PostToolUse",
    ts: "2026-05-26T00:00:00.000Z",
    actorId: "backend",
  };

  it("always sets a span_id and omits absent fields", () => {
    const f = resolveTraceV2Fields({ ...base, env: {} });
    expect(f.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(f.parent_span_id).toBeUndefined();
    expect(f.tier).toBeUndefined();
    expect(f.model).toBeUndefined();
    expect(f.tokens).toBeUndefined();
    expect(f.payload_ref).toBeUndefined();
  });

  it("threads parent_span_id, tier, model from env", () => {
    const f = resolveTraceV2Fields({
      ...base,
      env: { GUILD_PARENT_SPAN_ID: "deadbeefdeadbeef", GUILD_TIER: "mid", GUILD_MODEL: "claude-sonnet-4-6" },
    });
    expect(f.parent_span_id).toBe("deadbeefdeadbeef");
    expect(f.tier).toBe("mid");
    expect(f.model).toBe("claude-sonnet-4-6");
  });

  it("prefers GUILD_MODEL env over payloadModel fallback", () => {
    const f = resolveTraceV2Fields({ ...base, env: { GUILD_MODEL: "opus" }, payloadModel: "sonnet" });
    expect(f.model).toBe("opus");
  });

  it("falls back to payloadModel when GUILD_MODEL unset", () => {
    const f = resolveTraceV2Fields({ ...base, env: {}, payloadModel: "sonnet" });
    expect(f.model).toBe("sonnet");
  });

  it("attaches tokens when provided (caller-gated)", () => {
    const f = resolveTraceV2Fields({ ...base, env: {}, tokens: { input: 1, output: 2 } });
    expect(f.tokens).toEqual({ input: 1, output: 2 });
  });
});

describe("pruneUndefined", () => {
  it("drops undefined keys, keeps falsy-but-defined", () => {
    expect(pruneUndefined({ a: undefined, b: 0, c: "", d: false })).toEqual({ b: 0, c: "", d: false });
  });
});

describe("writePayloadSidecar (D-OBS-2)", () => {
  let runDir: string;
  const noop = (s: string) => s;

  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-v2-sidecar-"));
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("writes a guild.trace_payload.v1 file and returns the relative ref", () => {
    const ref = writePayloadSidecar(
      runDir,
      "abc123",
      {
        runId: "run-1",
        spanId: "abc123",
        eventType: "PostToolUse",
        ts: "2026-05-26T00:00:00.000Z",
        actorId: "backend",
        body: { tool: "Write", input: { file_path: "/x" } },
      },
      noop,
    );
    expect(ref).toBe("logs/payloads/abc123.json");
    const written = JSON.parse(fs.readFileSync(payloadSidecarPath(runDir, "abc123"), "utf8"));
    expect(written.schema_version).toBe(TRACE_PAYLOAD_SCHEMA);
    expect(written.evt_id).toBe("abc123");
    expect(written.run_id).toBe("run-1");
    expect(written.body.tool).toBe("Write");
  });

  it("redacts every string leaf via the injected gatekeeper", () => {
    const redact = (s: string) => s.replace(/SECRET/g, "[REDACTED]");
    writePayloadSidecar(
      runDir,
      "evt2",
      {
        runId: "run-1",
        spanId: "evt2",
        eventType: "UserPromptSubmit",
        ts: "2026-05-26T00:00:00.000Z",
        actorId: "main",
        body: { prompt: "my SECRET value", nested: { k: "SECRET too" } },
      },
      redact,
    );
    const written = JSON.parse(fs.readFileSync(payloadSidecarPath(runDir, "evt2"), "utf8"));
    expect(written.body.prompt).toBe("my [REDACTED] value");
    expect(written.body.nested.k).toBe("[REDACTED] too");
  });

  it("truncates an oversized body rather than ballooning the run dir", () => {
    const huge = "x".repeat(SIDECAR_MAX_BYTES * 2);
    writePayloadSidecar(
      runDir,
      "big",
      {
        runId: "run-1",
        spanId: "big",
        eventType: "PostToolUse",
        ts: "2026-05-26T00:00:00.000Z",
        actorId: "main",
        body: { content: huge },
      },
      (s) => s,
    );
    const raw = fs.readFileSync(payloadSidecarPath(runDir, "big"), "utf8");
    expect(Buffer.byteLength(raw, "utf8")).toBeLessThanOrEqual(SIDECAR_MAX_BYTES + 64);
    expect(JSON.parse(raw).body.truncated).toBe(true);
  });

  it("returns undefined and never throws when the path is unwritable", () => {
    // Point at a file-as-directory to force a write failure.
    const blocker = path.join(runDir, "blocker");
    fs.writeFileSync(blocker, "x");
    const ref = writePayloadSidecar(
      blocker, // runDir is actually a file → mkdir under it fails
      "evt",
      {
        runId: "run-1",
        spanId: "evt",
        eventType: "PostToolUse",
        ts: "2026-05-26T00:00:00.000Z",
        actorId: "main",
        body: {},
      },
      (s) => s,
    );
    expect(ref).toBeUndefined();
  });
});
