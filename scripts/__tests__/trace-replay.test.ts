/**
 * scripts/__tests__/trace-replay.test.ts
 *
 * Tests for scripts/lib/trace-replay.ts — pure data builders for the
 * deferred [v2.x] trace_replay_timeline and trace_context_replay MCP tools.
 *
 * Coverage strategy:
 *   - buildReplayTimeline: happy path, empty input, v2 token/span fields,
 *     mixed-run detection, single-run detection, cost aggregation, by_tier
 *     breakdown, lane deduplication, malformed/edge-case rows.
 *   - buildContextReplay: happy path (single bundle), all bundles, no
 *     context-refs (incomplete trace), task_run_id not found, drift
 *     classification (ok/changed/missing/superseded), bundle_intact flag,
 *     overall_drift summary.
 *   - validateContextRefs: valid input, missing fields, wrong schema_version,
 *     wrong types.
 *
 * All tests are PURE (no fs, no process.cwd, no Date.now). Tests that need
 * a file system verify the parser path only via temp dirs and real-parseable
 * JSONL strings (no hand-rolled fixtures on disk required by the pure builders).
 */

import {
  buildReplayTimeline,
  buildContextReplay,
  validateContextRefs,
  type TraceEventRow,
  type ContextRefs,
  type ContextBundle,
} from "../lib/trace-replay";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<TraceEventRow> = {}): TraceEventRow {
  return {
    ts: "2026-06-10T10:00:00.000Z",
    event: "tool_call",
    run_id: "run-test-001",
    ...overrides,
  };
}

function makeContextRefs(overrides: Partial<ContextRefs> = {}): ContextRefs {
  return {
    schema_version: "guild.context_refs.v1",
    run_id: "run-test-001",
    bundles: [],
    ...overrides,
  };
}

function makeBundle(overrides: Partial<ContextBundle> = {}): ContextBundle {
  return {
    task_id: "task-backend-001",
    specialist: "backend-engineer",
    path: ".guild/context/run-test-001/backend-engineer-task-backend-001.md",
    sha256: "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888",
    source_refs: [],
    ...overrides,
  };
}

// ── buildReplayTimeline ─────────────────────────────────────────────────────

describe("buildReplayTimeline", () => {
  describe("empty input", () => {
    it("returns empty entries for an empty array", () => {
      const result = buildReplayTimeline([]);
      expect(result.entries).toEqual([]);
    });

    it("returns event_count 0 for an empty array", () => {
      const result = buildReplayTimeline([]);
      expect(result.event_count).toBe(0);
    });

    it("returns zero cost totals for an empty array", () => {
      const result = buildReplayTimeline([]);
      expect(result.cost.total_input_tokens).toBe(0);
      expect(result.cost.total_output_tokens).toBe(0);
      expect(result.cost.total_cached_tokens).toBe(0);
      expect(result.cost.total_cost_usd).toBe(0);
    });

    it("returns empty lanes for an empty array", () => {
      const result = buildReplayTimeline([]);
      expect(result.lanes).toEqual([]);
    });

    it("returns single_run false and run_id undefined for an empty array", () => {
      const result = buildReplayTimeline([]);
      expect(result.single_run).toBe(false);
      expect(result.run_id).toBeUndefined();
    });
  });

  describe("happy path — basic event list", () => {
    const events: TraceEventRow[] = [
      makeEvent({ ts: "2026-06-10T10:00:00.000Z", event: "phase_start" }),
      makeEvent({ ts: "2026-06-10T10:01:00.000Z", event: "specialist_dispatch", lane_id: "lane-A" }),
      makeEvent({ ts: "2026-06-10T10:02:00.000Z", event: "tool_call", lane_id: "lane-B" }),
      makeEvent({ ts: "2026-06-10T10:03:00.000Z", event: "phase_end" }),
    ];

    it("returns all events in input order", () => {
      const result = buildReplayTimeline(events);
      expect(result.entries).toHaveLength(4);
      expect(result.entries[0]!.event).toBe("phase_start");
      expect(result.entries[3]!.event).toBe("phase_end");
    });

    it("assigns sequential index values starting at 0", () => {
      const result = buildReplayTimeline(events);
      expect(result.entries.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    });

    it("preserves ts from input rows", () => {
      const result = buildReplayTimeline(events);
      expect(result.entries[1]!.ts).toBe("2026-06-10T10:01:00.000Z");
    });

    it("promotes lane_id from input rows", () => {
      const result = buildReplayTimeline(events);
      expect(result.entries[1]!.lane_id).toBe("lane-A");
      expect(result.entries[0]!.lane_id).toBeUndefined();
    });

    it("deduplicates and sorts lanes alphabetically", () => {
      const result = buildReplayTimeline(events);
      expect(result.lanes).toEqual(["lane-A", "lane-B"]);
    });

    it("correctly reports event_count", () => {
      const result = buildReplayTimeline(events);
      expect(result.event_count).toBe(4);
    });

    it("reports single_run true when all events share the same run_id", () => {
      const result = buildReplayTimeline(events);
      expect(result.single_run).toBe(true);
      expect(result.run_id).toBe("run-test-001");
    });

    it("carries the raw row on each entry", () => {
      const result = buildReplayTimeline(events);
      expect(result.entries[0]!.raw).toBe(events[0]);
    });
  });

  describe("v2 fields — span/tier/model/tokens", () => {
    it("promotes span_id when present", () => {
      const ev = makeEvent({ span_id: "abc123def456" });
      const result = buildReplayTimeline([ev]);
      expect(result.entries[0]!.span_id).toBe("abc123def456");
    });

    it("promotes parent_span_id when present", () => {
      const ev = makeEvent({ parent_span_id: "parentspan001" });
      const result = buildReplayTimeline([ev]);
      expect(result.entries[0]!.parent_span_id).toBe("parentspan001");
    });

    it("promotes tier when present", () => {
      const ev = makeEvent({ tier: "mid" });
      const result = buildReplayTimeline([ev]);
      expect(result.entries[0]!.tier).toBe("mid");
    });

    it("promotes model when present", () => {
      const ev = makeEvent({ model: "claude-sonnet-4-6" });
      const result = buildReplayTimeline([ev]);
      expect(result.entries[0]!.model).toBe("claude-sonnet-4-6");
    });

    it("leaves span_id undefined when absent", () => {
      const ev = makeEvent();
      const result = buildReplayTimeline([ev]);
      expect(result.entries[0]!.span_id).toBeUndefined();
    });

    it("accumulates input/output/cached/cost_usd from tokens blocks", () => {
      const events: TraceEventRow[] = [
        makeEvent({ tokens: { input: 100, output: 50, cached: 10, cost_usd: 0.01 } }),
        makeEvent({ tokens: { input: 200, output: 80, cached: 0, cost_usd: 0.02 } }),
      ];
      const result = buildReplayTimeline(events);
      expect(result.cost.total_input_tokens).toBe(300);
      expect(result.cost.total_output_tokens).toBe(130);
      expect(result.cost.total_cached_tokens).toBe(10);
      expect(result.cost.total_cost_usd).toBeCloseTo(0.03, 10);
    });

    it("events without tokens contribute 0 to cost totals", () => {
      const events: TraceEventRow[] = [
        makeEvent({ tokens: { input: 100, output: 50 } }),
        makeEvent(), // no tokens
      ];
      const result = buildReplayTimeline(events);
      expect(result.cost.total_input_tokens).toBe(100);
      expect(result.cost.total_output_tokens).toBe(50);
    });

    it("builds correct by_tier breakdown", () => {
      const events: TraceEventRow[] = [
        makeEvent({ tier: "cheap", tokens: { input: 50, output: 20, cost_usd: 0.001 } }),
        makeEvent({ tier: "mid", tokens: { input: 200, output: 100, cost_usd: 0.01 } }),
        makeEvent({ tier: "cheap", tokens: { input: 30, output: 10 } }),
        makeEvent(), // no tier/tokens
      ];
      const result = buildReplayTimeline(events);
      expect(result.cost.by_tier["cheap"]).toBeDefined();
      expect(result.cost.by_tier["cheap"]!.input).toBe(80);
      expect(result.cost.by_tier["cheap"]!.output).toBe(30);
      expect(result.cost.by_tier["mid"]!.input).toBe(200);
      expect(result.cost.by_tier["mid"]!.output).toBe(100);
    });

    it("does NOT add a by_tier entry for events with tokens but no tier", () => {
      const ev = makeEvent({ tokens: { input: 100 } }); // no tier field
      const result = buildReplayTimeline([ev]);
      expect(Object.keys(result.cost.by_tier)).toHaveLength(0);
    });
  });

  describe("single_run detection", () => {
    it("single_run is false when events have different run_ids", () => {
      const events: TraceEventRow[] = [
        makeEvent({ run_id: "run-aaa" }),
        makeEvent({ run_id: "run-bbb" }),
      ];
      const result = buildReplayTimeline(events);
      expect(result.single_run).toBe(false);
      expect(result.run_id).toBeUndefined();
    });

    it("single_run is true when all events share one run_id", () => {
      const events = [makeEvent({ run_id: "run-xyz" }), makeEvent({ run_id: "run-xyz" })];
      const result = buildReplayTimeline(events);
      expect(result.single_run).toBe(true);
      expect(result.run_id).toBe("run-xyz");
    });

    it("single_run is false when run_id is absent from all rows", () => {
      const events: TraceEventRow[] = [
        { ts: "2026-06-10T10:00:00.000Z", event: "tool_call" },
        { ts: "2026-06-10T10:01:00.000Z", event: "hook_event" },
      ];
      const result = buildReplayTimeline(events);
      expect(result.single_run).toBe(false);
      expect(result.run_id).toBeUndefined();
    });
  });

  describe("malformed / edge-case rows", () => {
    it("includes rows with missing ts (ts empty string)", () => {
      const ev = { event: "tool_call", run_id: "run-1" } as unknown as TraceEventRow;
      const result = buildReplayTimeline([ev]);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.ts).toBe("");
    });

    it("handles a row with no tokens field gracefully", () => {
      const ev = makeEvent();
      delete (ev as Record<string, unknown>)["tokens"];
      const result = buildReplayTimeline([ev]);
      expect(result.entries[0]!.tokens).toBeUndefined();
      expect(result.cost.total_input_tokens).toBe(0);
    });

    it("ignores a tokens field that is not a plain object", () => {
      const ev = makeEvent({ tokens: "bad" as unknown as TraceEventRow["tokens"] });
      const result = buildReplayTimeline([ev]);
      expect(result.entries[0]!.tokens).toBeUndefined();
      expect(result.cost.total_input_tokens).toBe(0);
    });

    it("ignores a lane_id that is an empty string", () => {
      const ev = makeEvent({ lane_id: "" });
      const result = buildReplayTimeline([ev]);
      expect(result.entries[0]!.lane_id).toBeUndefined();
      expect(result.lanes).toEqual([]);
    });

    it("handles non-finite token numbers without crashing", () => {
      const ev = makeEvent({ tokens: { input: NaN, output: Infinity } });
      const result = buildReplayTimeline([ev]);
      expect(result.cost.total_input_tokens).toBe(0);
      expect(result.cost.total_output_tokens).toBe(0);
    });
  });
});

// ── buildContextReplay ───────────────────────────────────────────────────────

describe("buildContextReplay", () => {
  describe("missing context-refs (null input)", () => {
    it("returns complete=false when contextRefs is null", () => {
      const result = buildContextReplay(null, undefined);
      expect(result.complete).toBe(false);
    });

    it("returns an empty bundles array when contextRefs is null", () => {
      const result = buildContextReplay(null, undefined);
      expect(result.bundles).toEqual([]);
    });

    it("returns a human-readable incomplete_reason when contextRefs is null", () => {
      const result = buildContextReplay(null, undefined);
      expect(result.incomplete_reason).toBeDefined();
      expect(result.incomplete_reason).toMatch(/incomplete trace/i);
    });

    it("never fabricates context — run_id is empty string", () => {
      const result = buildContextReplay(null, undefined);
      expect(result.run_id).toBe("");
    });
  });

  describe("no-match for task_run_id", () => {
    it("returns complete=false when requested task_run_id has no matching bundle", () => {
      const refs = makeContextRefs({
        bundles: [makeBundle({ task_id: "task-001" })],
      });
      const result = buildContextReplay(refs, "task-NONEXISTENT");
      expect(result.complete).toBe(false);
    });

    it("returns an incomplete_reason naming the missing task_id", () => {
      const refs = makeContextRefs({
        bundles: [makeBundle({ task_id: "task-001" })],
      });
      const result = buildContextReplay(refs, "task-NONEXISTENT");
      expect(result.incomplete_reason).toMatch(/task-NONEXISTENT/);
    });

    it("returns the correct run_id even when the task is not found", () => {
      const refs = makeContextRefs({ run_id: "run-xyz", bundles: [] });
      const result = buildContextReplay(refs, "task-missing");
      expect(result.run_id).toBe("run-xyz");
    });
  });

  describe("happy path — single bundle", () => {
    const bundle = makeBundle({
      task_id: "task-backend-001",
      specialist: "backend-engineer",
      source_refs: [
        {
          path: ".guild/wiki/decisions/auth-flow.md",
          sha256: "1111aaaa2222bbbb3333cccc4444dddd5555eeee6666ffff7777aaaa8888bbbb",
        },
      ],
    });
    const refs = makeContextRefs({ bundles: [bundle] });

    it("returns complete=true when the task is found", () => {
      const result = buildContextReplay(refs, "task-backend-001");
      expect(result.complete).toBe(true);
    });

    it("returns incomplete_reason undefined on success", () => {
      const result = buildContextReplay(refs, "task-backend-001");
      expect(result.incomplete_reason).toBeUndefined();
    });

    it("returns the matching bundle", () => {
      const result = buildContextReplay(refs, "task-backend-001");
      expect(result.bundles).toHaveLength(1);
      expect(result.bundles[0]!.task_id).toBe("task-backend-001");
      expect(result.bundles[0]!.specialist).toBe("backend-engineer");
    });

    it("bundle_path and bundle_sha256 match the input", () => {
      const result = buildContextReplay(refs, "task-backend-001");
      expect(result.bundles[0]!.bundle_path).toBe(bundle.path);
      expect(result.bundles[0]!.bundle_sha256).toBe(bundle.sha256);
    });

    it("bundle_intact defaults to true when no sha map is supplied", () => {
      const result = buildContextReplay(refs, "task-backend-001");
      expect(result.bundles[0]!.bundle_intact).toBe(true);
    });

    it("source_drifts has one entry matching the source_ref", () => {
      const result = buildContextReplay(refs, "task-backend-001");
      expect(result.bundles[0]!.source_drifts).toHaveLength(1);
      expect(result.bundles[0]!.source_drifts[0]!.path).toBe(
        ".guild/wiki/decisions/auth-flow.md",
      );
    });

    it("source drift is 'ok' when no sha map is provided (cannot verify = ok)", () => {
      const result = buildContextReplay(refs, "task-backend-001");
      expect(result.bundles[0]!.source_drifts[0]!.drift).toBe("ok");
    });

    it("overall_drift is 'ok' when all source refs are ok", () => {
      const result = buildContextReplay(refs, "task-backend-001");
      expect(result.bundles[0]!.overall_drift).toBe("ok");
    });

    it("returns the correct run_id from context-refs", () => {
      const result = buildContextReplay(refs, "task-backend-001");
      expect(result.run_id).toBe("run-test-001");
    });
  });

  describe("all-bundles mode (task_run_id undefined)", () => {
    const refs = makeContextRefs({
      bundles: [
        makeBundle({ task_id: "task-A" }),
        makeBundle({ task_id: "task-B", specialist: "frontend-engineer" }),
      ],
    });

    it("returns complete=true and both bundles when task_run_id is undefined", () => {
      const result = buildContextReplay(refs, undefined);
      expect(result.complete).toBe(true);
      expect(result.bundles).toHaveLength(2);
    });

    it("preserves input order of bundles", () => {
      const result = buildContextReplay(refs, undefined);
      expect(result.bundles[0]!.task_id).toBe("task-A");
      expect(result.bundles[1]!.task_id).toBe("task-B");
    });
  });

  describe("drift classification with sha map", () => {
    const sha = "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888";
    const bundle = makeBundle({
      source_refs: [
        { path: "docs/known.md", sha256: sha },
        { path: "docs/changed.md", sha256: sha },
        { path: "docs/gone.md", sha256: sha },
        { path: "docs/super.md", sha256: sha },
      ],
    });
    const refs = makeContextRefs({ bundles: [bundle] });

    const shaMap: Record<string, string | null | undefined> = {
      "docs/known.md": sha,                  // matches → ok
      "docs/changed.md": "differenthash000", // different → changed
      "docs/gone.md": null,                  // deleted → missing
      "docs/super.md": "SUPERSEDED",         // superseded
    };

    let result: ReturnType<typeof buildContextReplay>;

    beforeAll(() => {
      result = buildContextReplay(refs, bundle.task_id, shaMap);
    });

    it("classifies 'ok' when sha matches", () => {
      const d = result.bundles[0]!.source_drifts.find((s) => s.path === "docs/known.md");
      expect(d).toBeDefined();
      expect(d!.drift).toBe("ok");
      expect(d!.current_sha256).toBe(sha);
    });

    it("classifies 'changed' when sha differs", () => {
      const d = result.bundles[0]!.source_drifts.find((s) => s.path === "docs/changed.md");
      expect(d!.drift).toBe("changed");
      expect(d!.current_sha256).toBe("differenthash000");
    });

    it("classifies 'missing' when sha map has null", () => {
      const d = result.bundles[0]!.source_drifts.find((s) => s.path === "docs/gone.md");
      expect(d!.drift).toBe("missing");
      expect(d!.current_sha256).toBeUndefined();
    });

    it("classifies 'superseded' when sha map has 'SUPERSEDED'", () => {
      const d = result.bundles[0]!.source_drifts.find((s) => s.path === "docs/super.md");
      expect(d!.drift).toBe("superseded");
      expect(d!.current_sha256).toBeUndefined();
    });

    it("overall_drift is 'missing' (worst drift class) when at least one source is missing", () => {
      // missing > changed > superseded > stale > ok
      expect(result.bundles[0]!.overall_drift).toBe("missing");
    });

    it("overall_drift is 'changed' when worst is changed (no missing)", () => {
      const bundleNoMissing = makeBundle({
        source_refs: [
          { path: "docs/known.md", sha256: sha },
          { path: "docs/changed.md", sha256: sha },
        ],
      });
      const refsNoMissing = makeContextRefs({ bundles: [bundleNoMissing] });
      const shaMapNoMissing: Record<string, string | null | undefined> = {
        "docs/known.md": sha,
        "docs/changed.md": "differenthash",
      };
      const r = buildContextReplay(refsNoMissing, bundleNoMissing.task_id, shaMapNoMissing);
      expect(r.bundles[0]!.overall_drift).toBe("changed");
    });
  });

  describe("bundle_intact flag", () => {
    const sha = "bundlesha1111222233334444555566667777888899990000aaaabbbbccccdddd";
    const bundle = makeBundle({ sha256: sha });
    const refs = makeContextRefs({ bundles: [bundle] });

    it("bundle_intact is true when sha map matches bundle sha", () => {
      const result = buildContextReplay(refs, bundle.task_id, { [bundle.path]: sha });
      expect(result.bundles[0]!.bundle_intact).toBe(true);
    });

    it("bundle_intact is false when sha map differs from bundle sha", () => {
      const result = buildContextReplay(refs, bundle.task_id, {
        [bundle.path]: "differentsha",
      });
      expect(result.bundles[0]!.bundle_intact).toBe(false);
    });

    it("bundle_intact is false when sha map has null for bundle path", () => {
      const result = buildContextReplay(refs, bundle.task_id, { [bundle.path]: null });
      expect(result.bundles[0]!.bundle_intact).toBe(false);
    });
  });
});

// ── validateContextRefs ──────────────────────────────────────────────────────

describe("validateContextRefs", () => {
  it("returns valid:true for a minimal well-formed object", () => {
    const obj: ContextRefs = {
      schema_version: "guild.context_refs.v1",
      run_id: "run-abc",
      bundles: [],
    };
    expect(validateContextRefs(obj)).toEqual({ valid: true });
  });

  it("returns valid:true for an object with a full bundle", () => {
    const obj: ContextRefs = {
      schema_version: "guild.context_refs.v1",
      run_id: "run-abc",
      bundles: [
        {
          task_id: "task-1",
          specialist: "backend-engineer",
          path: ".guild/context/run-abc/backend-engineer-task-1.md",
          sha256: "1234abcd5678efgh",
          source_refs: [{ path: "docs/x.md", sha256: "sha256abc" }],
        },
      ],
    };
    expect(validateContextRefs(obj)).toEqual({ valid: true });
  });

  it("returns valid:false for non-object input", () => {
    const r = validateContextRefs(null);
    expect(r.valid).toBe(false);
  });

  it("returns valid:false for array input", () => {
    const r = validateContextRefs([]);
    expect(r.valid).toBe(false);
  });

  it("returns valid:false + error when schema_version is wrong", () => {
    const r = validateContextRefs({
      schema_version: "guild.context_refs.v2",
      run_id: "run-abc",
      bundles: [],
    });
    expect(r.valid).toBe(false);
    const errors = (r as { valid: false; errors: string[] }).errors;
    expect(errors.some((e) => /schema_version/.test(e))).toBe(true);
  });

  it("returns valid:false + error when run_id is missing", () => {
    const r = validateContextRefs({
      schema_version: "guild.context_refs.v1",
      bundles: [],
    });
    expect(r.valid).toBe(false);
    const errors = (r as { valid: false; errors: string[] }).errors;
    expect(errors.some((e) => /run_id/.test(e))).toBe(true);
  });

  it("returns valid:false + error when run_id is empty string", () => {
    const r = validateContextRefs({
      schema_version: "guild.context_refs.v1",
      run_id: "",
      bundles: [],
    });
    expect(r.valid).toBe(false);
    const errors = (r as { valid: false; errors: string[] }).errors;
    expect(errors.some((e) => /run_id/.test(e))).toBe(true);
  });

  it("returns valid:false + error when bundles is not an array", () => {
    const r = validateContextRefs({
      schema_version: "guild.context_refs.v1",
      run_id: "run-abc",
      bundles: "not-an-array",
    });
    expect(r.valid).toBe(false);
    const errors = (r as { valid: false; errors: string[] }).errors;
    expect(errors.some((e) => /bundles/.test(e))).toBe(true);
  });

  it("returns valid:false when a bundle entry is missing task_id", () => {
    const r = validateContextRefs({
      schema_version: "guild.context_refs.v1",
      run_id: "run-abc",
      bundles: [
        {
          specialist: "be",
          path: ".guild/context/x.md",
          sha256: "abc",
          source_refs: [],
        },
      ],
    });
    expect(r.valid).toBe(false);
    const errors = (r as { valid: false; errors: string[] }).errors;
    expect(errors.some((e) => /task_id/.test(e))).toBe(true);
  });

  it("returns valid:false when a source_ref entry is missing sha256", () => {
    const r = validateContextRefs({
      schema_version: "guild.context_refs.v1",
      run_id: "run-abc",
      bundles: [
        {
          task_id: "t1",
          specialist: "be",
          path: ".guild/context/x.md",
          sha256: "abc",
          source_refs: [{ path: "docs/y.md" }], // missing sha256
        },
      ],
    });
    expect(r.valid).toBe(false);
    const errors = (r as { valid: false; errors: string[] }).errors;
    expect(errors.some((e) => /sha256/.test(e))).toBe(true);
  });

  it("collects multiple errors in a single pass", () => {
    const r = validateContextRefs({
      schema_version: "wrong",
      // missing run_id
      bundles: "bad",
    });
    expect(r.valid).toBe(false);
    const errors = (r as { valid: false; errors: string[] }).errors;
    expect(errors.length).toBeGreaterThan(1);
  });
});
