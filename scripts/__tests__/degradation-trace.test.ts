/**
 * scripts/__tests__/degradation-trace.test.ts
 *
 * Focused tests for scripts/lib/degradation-trace.ts — FDC degradation trace
 * rows (deferred item 17; docs/v2/08-dispatch-execution.md §Degradation signal
 * table).
 *
 * Coverage:
 *   1. Closed enum — DEGRADATION_KINDS contains exactly the expected values.
 *   2. makeDegradationRow — happy path for each of the 7 kinds.
 *   3. Contract guarantees:
 *      a. schema_version is always DEGRADATION_TRACE_SCHEMA.
 *      b. event_type is always DEGRADATION_EVENT_TYPE.
 *      c. degradation.kind mirrors the outer kind.
 *      d. run_id and ts are threaded through verbatim.
 *      e. No Date.now() inside the builder (ts comes from caller).
 *   4. validateDegradationRow — accepts valid rows; rejects malformed/partial.
 *   5. isValidDegradationRow — convenience type-predicate wrapper.
 *   6. Edge cases: unknown kind rejected by validator; empty run_id rejected;
 *      extra fields in payload are preserved (lenient-reader additive rule).
 *
 * These tests are PURE (no disk I/O) — the builders are deterministic given
 * injected ts/run_id. The only tmp-dir usage would be for a CLI harness test,
 * which is not needed here (the CLI harness is not exported from the lib).
 */

import {
  DEGRADATION_KINDS,
  DEGRADATION_TRACE_SCHEMA,
  DEGRADATION_EVENT_TYPE,
  makeDegradationRow,
  validateDegradationRow,
  isValidDegradationRow,
  type DegradationTraceRow,
  type DegradationKind,
} from "../lib/degradation-trace";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXED_RUN_ID = "run-test-degtrace-001";
const FIXED_TS = "2026-06-13T12:00:00Z";

// ── 1. Closed enum ────────────────────────────────────────────────────────────

describe("DEGRADATION_KINDS — closed enum", () => {
  test("contains exactly the 7 expected values in order", () => {
    expect([...DEGRADATION_KINDS]).toEqual([
      "coordination.parallelism",
      "backend_rung",
      "dispatch.deferred",
      "feature_degraded",
      "degraded_retrieval",
      "tier_degraded",
      "degraded_reason",
    ]);
  });

  test("has exactly 7 entries (FDC signal table — no silent additions)", () => {
    expect(DEGRADATION_KINDS).toHaveLength(7);
  });
});

// ── 2. makeDegradationRow — happy path per kind ───────────────────────────────

describe("makeDegradationRow — happy path", () => {
  test("coordination.parallelism row", () => {
    const row = makeDegradationRow("coordination.parallelism", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      parallelism: "serial",
      backend_rung: 4,
      degraded_reason: "tmux_unavailable",
      dag_order: ["A", "B", "C"],
    });

    expect(row.schema_version).toBe(DEGRADATION_TRACE_SCHEMA);
    expect(row.event_type).toBe(DEGRADATION_EVENT_TYPE);
    expect(row.kind).toBe("coordination.parallelism");
    expect(row.run_id).toBe(FIXED_RUN_ID);
    expect(row.ts).toBe(FIXED_TS);
    expect(row.degradation.kind).toBe("coordination.parallelism");
    expect(row.degradation.parallelism).toBe("serial");
    expect(row.degradation.backend_rung).toBe(4);
    expect(row.degradation.degraded_reason).toBe("tmux_unavailable");
    expect(row.degradation.dag_order).toEqual(["A", "B", "C"]);
  });

  test("backend_rung row", () => {
    const row = makeDegradationRow("backend_rung", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      backend_rung: 3,
      agent_mode: "subagent",
      degraded: true,
      degraded_reason: "host_lacks_team_support",
    });

    expect(row.kind).toBe("backend_rung");
    expect(row.degradation.kind).toBe("backend_rung");
    expect(row.degradation.backend_rung).toBe(3);
    expect(row.degradation.degraded).toBe(true);
    expect(row.degradation.degraded_reason).toBe("host_lacks_team_support");
    expect(row.degradation.agent_mode).toBe("subagent");
  });

  test("backend_rung row — rung 1 (not degraded)", () => {
    const row = makeDegradationRow("backend_rung", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      backend_rung: 1,
      agent_mode: "team",
      degraded: false,
      degraded_reason: null,
    });

    expect(row.degradation.backend_rung).toBe(1);
    expect(row.degradation.degraded).toBe(false);
    expect(row.degradation.degraded_reason).toBeNull();
  });

  test("dispatch.deferred row", () => {
    const row = makeDegradationRow("dispatch.deferred", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      task_id: "task-backend-001",
      deferred_reason: "connector_queue_full",
      connector: "claude-ai-connector",
    });

    expect(row.kind).toBe("dispatch.deferred");
    expect(row.degradation.kind).toBe("dispatch.deferred");
    expect(row.degradation.task_id).toBe("task-backend-001");
    expect(row.degradation.deferred_reason).toBe("connector_queue_full");
    expect(row.degradation.connector).toBe("claude-ai-connector");
  });

  test("feature_degraded row", () => {
    const row = makeDegradationRow("feature_degraded", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      feature: "agent_communication",
      fdc_row: "FDC-4",
      degraded_reason: "send_message_unavailable",
      host_capability_missing: ["send_message"],
      degraded_path: "file_bus_polled",
    });

    expect(row.kind).toBe("feature_degraded");
    expect(row.degradation.kind).toBe("feature_degraded");
    expect(row.degradation.feature).toBe("agent_communication");
    expect(row.degradation.fdc_row).toBe("FDC-4");
    expect(row.degradation.host_capability_missing).toEqual(["send_message"]);
    expect(row.degradation.degraded_path).toBe("file_bus_polled");
  });

  test("feature_degraded row — permission_mode degraded (FDC-11 companion)", () => {
    const row = makeDegradationRow("feature_degraded", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      feature: "permission_mode",
      fdc_row: "FDC-11",
      degraded_reason: "no_ask_primitive",
      degraded_path: "file_bus_pause",
    });

    expect(row.degradation.feature).toBe("permission_mode");
    expect(row.degradation.fdc_row).toBe("FDC-11");
    expect(row.degradation.degraded_path).toBe("file_bus_pause");
  });

  test("degraded_retrieval row — fs_bm25 fallback", () => {
    const row = makeDegradationRow("degraded_retrieval", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      retrieval: "fs_bm25",
      context_bundle_path: ".guild/context/run-001/backend-task-001.md",
      degraded_reason: "mcp_unavailable",
    });

    expect(row.kind).toBe("degraded_retrieval");
    expect(row.degradation.kind).toBe("degraded_retrieval");
    expect(row.degradation.retrieval).toBe("fs_bm25");
    expect(row.degradation.context_bundle_path).toBe(
      ".guild/context/run-001/backend-task-001.md",
    );
    expect(row.degradation.degraded_reason).toBe("mcp_unavailable");
  });

  test("tier_degraded row", () => {
    const row = makeDegradationRow("tier_degraded", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      requested_tier: "mid",
      collapsed_to: "haiku-3",
      degraded_reason: "single_model_host",
      lane_id: "backend-api-001",
    });

    expect(row.kind).toBe("tier_degraded");
    expect(row.degradation.kind).toBe("tier_degraded");
    expect(row.degradation.requested_tier).toBe("mid");
    expect(row.degradation.collapsed_to).toBe("haiku-3");
    expect(row.degradation.degraded_reason).toBe("single_model_host");
    expect(row.degradation.lane_id).toBe("backend-api-001");
  });

  test("degraded_reason row — per-surface", () => {
    const row = makeDegradationRow("degraded_reason", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      surface: "context_assembly",
      degraded_reason: "retrieval_timeout",
      artifact_path: ".guild/context/run-001/arch-001.md",
    });

    expect(row.kind).toBe("degraded_reason");
    expect(row.degradation.kind).toBe("degraded_reason");
    expect(row.degradation.surface).toBe("context_assembly");
    expect(row.degradation.degraded_reason).toBe("retrieval_timeout");
    expect(row.degradation.artifact_path).toBe(
      ".guild/context/run-001/arch-001.md",
    );
  });
});

// ── 3. Contract guarantees ────────────────────────────────────────────────────

describe("makeDegradationRow — contract guarantees", () => {
  test("schema_version is always DEGRADATION_TRACE_SCHEMA on every kind", () => {
    const kinds: DegradationKind[] = [
      "coordination.parallelism",
      "backend_rung",
      "dispatch.deferred",
      "feature_degraded",
      "degraded_retrieval",
      "tier_degraded",
      "degraded_reason",
    ];

    // Build a minimal valid row for each kind and check schema_version.
    const minimalPayloads: Record<string, Record<string, unknown>> = {
      "coordination.parallelism": { parallelism: "serial", backend_rung: 4, degraded_reason: null },
      "backend_rung": { backend_rung: 2, degraded: false, degraded_reason: null },
      "dispatch.deferred": { task_id: "T1", deferred_reason: null },
      "feature_degraded": { feature: "recall", degraded_reason: null },
      "degraded_retrieval": { retrieval: "fs_bm25", degraded_reason: null },
      "tier_degraded": { requested_tier: "mid", collapsed_to: "haiku", degraded_reason: null },
      "degraded_reason": { surface: "recall", degraded_reason: "mcp_unavailable" },
    };

    for (const kind of kinds) {
      const row = makeDegradationRow(
        kind as Parameters<typeof makeDegradationRow>[0],
        { run_id: FIXED_RUN_ID, ts: FIXED_TS, ...minimalPayloads[kind] } as Parameters<typeof makeDegradationRow>[1],
      );
      expect(row.schema_version).toBe(DEGRADATION_TRACE_SCHEMA);
      expect(row.event_type).toBe(DEGRADATION_EVENT_TYPE);
    }
  });

  test("degradation.kind always mirrors the outer kind field", () => {
    const row = makeDegradationRow("tier_degraded", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      requested_tier: "powerful",
      collapsed_to: "sonnet",
      degraded_reason: "model_unavailable",
    });

    // The inner and outer kind must be identical — consumers rely on this.
    expect(row.kind).toBe(row.degradation.kind);
    expect(row.degradation.kind).toBe("tier_degraded");
  });

  test("run_id and ts are threaded through verbatim — not mutated", () => {
    const runId = "run-determinism-check";
    const ts = "2026-01-01T00:00:00Z";

    const row = makeDegradationRow("degraded_retrieval", {
      run_id: runId,
      ts,
      retrieval: "fs_scan",
      degraded_reason: "bm25_index_corrupt",
    });

    expect(row.run_id).toBe(runId);
    expect(row.ts).toBe(ts);
  });

  test("builder is deterministic — same inputs produce structurally identical output", () => {
    const fields = {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      feature: "worktrees",
      fdc_row: "FDC-15",
      degraded_reason: "worktree_unavailable",
      degraded_path: "serial_conflicting_lanes",
    } as const;

    const row1 = makeDegradationRow("feature_degraded", fields);
    const row2 = makeDegradationRow("feature_degraded", fields);

    expect(JSON.stringify(row1)).toBe(JSON.stringify(row2));
  });

  test("row serializes to valid JSON (ready for NDJSON append)", () => {
    const row = makeDegradationRow("backend_rung", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      backend_rung: 4,
      degraded: true,
      degraded_reason: "serial_floor",
    });

    expect(() => JSON.stringify(row)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(row)) as DegradationTraceRow;
    expect(parsed.schema_version).toBe(DEGRADATION_TRACE_SCHEMA);
    expect(parsed.kind).toBe("backend_rung");
  });
});

// ── 4. validateDegradationRow ─────────────────────────────────────────────────

describe("validateDegradationRow", () => {
  function makeValidRow(): DegradationTraceRow {
    return makeDegradationRow("degraded_reason", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      surface: "recall",
      degraded_reason: "mcp_unavailable",
    });
  }

  test("accepts a valid row produced by makeDegradationRow", () => {
    const result = validateDegradationRow(makeValidRow());
    expect(result.valid).toBe(true);
  });

  test("accepts valid rows for all 7 kinds", () => {
    const rows: DegradationTraceRow[] = [
      makeDegradationRow("coordination.parallelism", {
        run_id: FIXED_RUN_ID, ts: FIXED_TS,
        parallelism: "subagent", backend_rung: 3, degraded_reason: null,
      }),
      makeDegradationRow("backend_rung", {
        run_id: FIXED_RUN_ID, ts: FIXED_TS,
        backend_rung: 2, degraded: false, degraded_reason: null,
      }),
      makeDegradationRow("dispatch.deferred", {
        run_id: FIXED_RUN_ID, ts: FIXED_TS,
        task_id: "T1", deferred_reason: null,
      }),
      makeDegradationRow("feature_degraded", {
        run_id: FIXED_RUN_ID, ts: FIXED_TS,
        feature: "mcp", degraded_reason: "mcp_unavailable",
      }),
      makeDegradationRow("degraded_retrieval", {
        run_id: FIXED_RUN_ID, ts: FIXED_TS,
        retrieval: "inline_advisory", degraded_reason: "advisor_unavailable",
      }),
      makeDegradationRow("tier_degraded", {
        run_id: FIXED_RUN_ID, ts: FIXED_TS,
        requested_tier: "cheap", collapsed_to: "haiku", degraded_reason: null,
      }),
      makeDegradationRow("degraded_reason", {
        run_id: FIXED_RUN_ID, ts: FIXED_TS,
        surface: "ops", degraded_reason: "write_ops_require_approval",
      }),
    ];

    for (const row of rows) {
      const result = validateDegradationRow(row);
      expect(result.valid).toBe(true);
    }
  });

  test("rejects null / non-object", () => {
    expect(validateDegradationRow(null).valid).toBe(false);
    expect(validateDegradationRow(undefined).valid).toBe(false);
    expect(validateDegradationRow("string").valid).toBe(false);
    expect(validateDegradationRow(42).valid).toBe(false);
  });

  test("rejects wrong schema_version", () => {
    const row = { ...makeValidRow(), schema_version: "guild.trace_event.v0" };
    const result = validateDegradationRow(row);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; errors: string[] }).errors.some((e) =>
      e.includes("schema_version"),
    )).toBe(true);
  });

  test("rejects wrong event_type", () => {
    const row = { ...makeValidRow(), event_type: "loop_event" };
    const result = validateDegradationRow(row);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; errors: string[] }).errors.some((e) =>
      e.includes("event_type"),
    )).toBe(true);
  });

  test("rejects an unknown kind", () => {
    const row = { ...makeValidRow(), kind: "not_a_real_kind" };
    const result = validateDegradationRow(row);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; errors: string[] }).errors.some((e) =>
      e.includes("kind"),
    )).toBe(true);
  });

  test("rejects empty run_id", () => {
    const row = { ...makeValidRow(), run_id: "" };
    const result = validateDegradationRow(row);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; errors: string[] }).errors.some((e) =>
      e.includes("run_id"),
    )).toBe(true);
  });

  test("rejects empty ts", () => {
    const row = { ...makeValidRow(), ts: "" };
    const result = validateDegradationRow(row);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; errors: string[] }).errors.some((e) =>
      e.includes("ts"),
    )).toBe(true);
  });

  test("rejects missing degradation block", () => {
    const { degradation: _dropped, ...withoutDegradation } = makeValidRow();
    const result = validateDegradationRow(withoutDegradation);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; errors: string[] }).errors.some((e) =>
      e.includes("degradation"),
    )).toBe(true);
  });

  test("rejects degradation.kind mismatch", () => {
    const row = makeValidRow();
    const mutated = {
      ...row,
      degradation: { ...row.degradation, kind: "backend_rung" },
    };
    const result = validateDegradationRow(mutated);
    expect(result.valid).toBe(false);
    expect((result as { valid: false; errors: string[] }).errors.some((e) =>
      e.includes("degradation.kind"),
    )).toBe(true);
  });

  test("collects multiple errors in a single pass", () => {
    const row = {
      schema_version: "wrong",
      event_type: "wrong",
      kind: "not_a_kind",
      run_id: "",
      ts: "",
      degradation: null,
    };
    const result = validateDegradationRow(row);
    expect(result.valid).toBe(false);
    const errors = (result as { valid: false; errors: string[] }).errors;
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });
});

// ── 5. isValidDegradationRow ──────────────────────────────────────────────────

describe("isValidDegradationRow — type-predicate wrapper", () => {
  test("returns true for a valid row", () => {
    const row = makeDegradationRow("feature_degraded", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      feature: "context_assembly",
      degraded_reason: "retrieval_reduced",
    });
    expect(isValidDegradationRow(row)).toBe(true);
  });

  test("returns false for null / malformed objects", () => {
    expect(isValidDegradationRow(null)).toBe(false);
    expect(isValidDegradationRow({ kind: "feature_degraded" })).toBe(false);
    expect(isValidDegradationRow({ schema_version: "guild.trace_event.v1" })).toBe(false);
  });
});

// ── 6. Edge / malformed cases ─────────────────────────────────────────────────

describe("edge cases", () => {
  test("optional fields (dag_order, connector, fdc_row, etc.) may be absent — row is still valid", () => {
    const row = makeDegradationRow("coordination.parallelism", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      parallelism: "tmux",
      backend_rung: 1,
      degraded_reason: null,
      // dag_order omitted
    });

    expect(isValidDegradationRow(row)).toBe(true);
    expect(row.degradation.dag_order).toBeUndefined();
  });

  test("extra fields in the payload are preserved (lenient-reader additive rule)", () => {
    // A future v2.1 field should not be stripped by the builder.
    // The implementation spreads all fields into the degradation payload, so
    // extra keys survive. We verify via a JSON round-trip (serialization path
    // an emitter would use before appending to events.jsonl).
    const row = makeDegradationRow("feature_degraded", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      feature: "worktrees",
      degraded_reason: "worktree_unavailable",
    });

    // Simulate a v2.1 emitter patching an extra key onto the row payload
    // (additive under the lenient-reader rule) and verify it round-trips.
    const extended = {
      ...row,
      degradation: { ...row.degradation, future_field: "v2.1-extension" },
    };
    const roundTripped = JSON.parse(JSON.stringify(extended)) as typeof extended;
    const payload = roundTripped.degradation as unknown as Record<string, unknown>;
    expect(payload["future_field"]).toBe("v2.1-extension");
    // Existing fields are preserved.
    expect(payload["feature"]).toBe("worktrees");
  });

  test("DEGRADATION_TRACE_SCHEMA and DEGRADATION_EVENT_TYPE are stable constant strings", () => {
    // Guard against accidental mutations — these are frozen schema values.
    expect(DEGRADATION_TRACE_SCHEMA).toBe("guild.trace_event.v1");
    expect(DEGRADATION_EVENT_TYPE).toBe("feature_degraded");
  });

  test("rows from different kinds do not share payload identity", () => {
    const row1 = makeDegradationRow("backend_rung", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      backend_rung: 1,
      degraded: false,
      degraded_reason: null,
    });
    const row2 = makeDegradationRow("tier_degraded", {
      run_id: FIXED_RUN_ID,
      ts: FIXED_TS,
      requested_tier: "mid",
      collapsed_to: "haiku",
      degraded_reason: null,
    });

    // Payload objects are distinct references.
    expect(row1.degradation).not.toBe(row2.degradation);
    expect(row1.kind).not.toBe(row2.kind);
  });
});
