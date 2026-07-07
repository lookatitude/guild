/**
 * hooks/lib/v1.4/__tests__/append-trace-v2.test.ts
 *
 * Proves the v1.4 structured-log path (appendEvent) accepts the OPTIONAL
 * guild.trace_event.v2 fields ADDITIVELY (D-OBS-1):
 *   - v2 fields merge onto the serialized line,
 *   - the FROZEN v1 field set is unchanged,
 *   - the line STILL passes the (tooling-engineer-owned) strict v1.4 validator,
 *   - absence is valid (no traceV2 ⇒ no v2 keys, no nulls).
 *
 * Uses forceFallback to avoid the shared lockfile in a bare temp dir; the v2
 * merge happens before the fallback/POSIX branch so behavior is identical.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { appendEvent, laneFallbackPath, type ToolCallEvent } from "../log-jsonl.js";
// Bind the frozen validator BY IMPORT (read-only) to assert additive-safety.
import { validateEvent } from "../../../../scripts/v1.4-log-validator.js";

function readFallback(runDir: string): any[] {
  const file = laneFallbackPath(runDir, "global");
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const baseEvent: ToolCallEvent = {
  ts: "2026-05-26T00:00:00.000Z",
  event: "tool_call",
  run_id: "run-1",
  tool: "Agent",
  command_redacted: "dispatch backend",
  status: "ok",
  latency_ms: 1200,
  result_excerpt_redacted: "ok",
};

describe("appendEvent + guild.trace_event.v2 (D-OBS-1 additive)", () => {
  let runDir: string;
  beforeEach(() => {
    runDir = fs.mkdtempSync(path.join(os.tmpdir(), "append-trace-v2-"));
  });
  afterEach(() => {
    fs.rmSync(runDir, { recursive: true, force: true });
  });

  it("merges defined v2 fields onto the line and keeps v1 fields intact", () => {
    appendEvent(runDir, baseEvent, {
      forceFallback: true,
      traceV2: {
        span_id: "abcdef0123456789",
        parent_span_id: "0011223344556677",
        tier: "mid",
        model: "claude-sonnet-4-6",
        tokens: { input: 100, output: 50, cached: 20, cost_usd: 0.01 },
      },
    });
    const [line] = readFallback(runDir);
    // v1 frozen fields unchanged
    expect(line.event).toBe("tool_call");
    expect(line.tool).toBe("Agent");
    expect(line.command_redacted).toBe("dispatch backend");
    expect(line.latency_ms).toBe(1200);
    // v2 additive fields present
    expect(line.span_id).toBe("abcdef0123456789");
    expect(line.parent_span_id).toBe("0011223344556677");
    expect(line.tier).toBe("mid");
    expect(line.model).toBe("claude-sonnet-4-6");
    expect(line.tokens).toEqual({ input: 100, output: 50, cached: 20, cost_usd: 0.01 });
  });

  it("the v2-augmented line STILL passes the strict v1.4 validator", () => {
    appendEvent(runDir, baseEvent, {
      forceFallback: true,
      traceV2: { span_id: "abcdef0123456789", tier: "powerful" },
    });
    const [line] = readFallback(runDir);
    const result = validateEvent(line);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("absence is valid — no traceV2 ⇒ no v2 keys and no nulls", () => {
    appendEvent(runDir, baseEvent, { forceFallback: true });
    const [line] = readFallback(runDir);
    expect(line.span_id).toBeUndefined();
    expect(line.tier).toBeUndefined();
    expect(line.tokens).toBeUndefined();
    expect("payload_ref" in line).toBe(false);
    for (const v of Object.values(line)) expect(v).not.toBeNull();
    expect(validateEvent(line).ok).toBe(true);
  });

  it("prunes undefined v2 fields (never serializes null)", () => {
    appendEvent(runDir, baseEvent, {
      forceFallback: true,
      traceV2: { span_id: "abcdef0123456789", parent_span_id: undefined, tier: undefined },
    });
    const [line] = readFallback(runDir);
    expect(line.span_id).toBe("abcdef0123456789");
    expect("parent_span_id" in line).toBe(false);
    expect("tier" in line).toBe(false);
  });
});
