/**
 * scripts/__tests__/recall-stats.test.ts
 *
 * G10 — recall-stats report.
 *
 * Asserts the precision / skip-rate table is non-vacuous: a known-good recall is
 * a hit and a known-miss is a miss; and that changing the threshold MEASURABLY
 * changes the skip-rate (the tuning use-case).
 *
 * Run: cd scripts && npx jest --no-coverage recall-stats
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  computeRecallStats,
  readRecallDecisionEvents,
  renderTable,
  RECALL_DECISION_SCHEMA,
  type RecallDecisionRecord,
} from "../recall-stats";

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function rec(over: Partial<RecallDecisionRecord>): RecallDecisionRecord {
  return {
    query_hash: "0000000000000000",
    branch: "kg-query",
    top_score: 5,
    threshold: 0.4,
    read_skip_fired: true,
    chunk_count: 3,
    lane_outcome: "unknown",
    ...over,
  };
}

describe("G10 — recall-stats precision/skip table", () => {
  test("2. known-good counted as hit, known-miss counted as miss (non-vacuous)", () => {
    const events = [
      rec({ lane_outcome: "success" }),
      rec({ lane_outcome: "success" }),
      rec({ lane_outcome: "failure" }), // the seeded known-miss
      rec({ lane_outcome: "unknown" }), // excluded from precision
    ];
    const report = computeRecallStats(events);

    expect(report.overall.count).toBe(4);
    expect(report.overall.hits).toBe(2);
    expect(report.overall.misses).toBe(1);
    // precision = hits / (hits + misses) = 2/3 — NOT a vacuous all-pass.
    expect(report.overall.precision).toBeCloseTo(2 / 3, 6);
    expect(report.overall.precision).toBeLessThan(1);
  });

  test("2b. precision is null when no decided outcomes (all unknown)", () => {
    const report = computeRecallStats([rec({ lane_outcome: "unknown" }), rec({ lane_outcome: "unknown" })]);
    expect(report.overall.precision).toBeNull();
  });

  test("3. changing the threshold MEASURABLY changes the skip-rate", () => {
    // top_scores spanning the candidate thresholds.
    const events = [
      rec({ top_score: 5.0, chunk_count: 2 }),
      rec({ top_score: 1.0, chunk_count: 2 }),
      rec({ top_score: 0.3, chunk_count: 2 }),
      rec({ top_score: 0.05, chunk_count: 2 }),
    ];
    // Low threshold → most events clear it → high skip-rate.
    const low = computeRecallStats(events, { threshold: 0.1 });
    // High threshold → few clear it → low skip-rate.
    const high = computeRecallStats(events, { threshold: 2.0 });

    expect(low.overall.skipRate).toBeGreaterThan(high.overall.skipRate);
    // Concretely: @0.1 → 3/4 skip (5.0,1.0,0.3); @2.0 → 1/4 skip (5.0).
    expect(low.overall.skipRate).toBeCloseTo(0.75, 6);
    expect(high.overall.skipRate).toBeCloseTo(0.25, 6);
    expect(low.thresholdOverride).toBe(0.1);
  });

  test("3b. chunk_count==0 never counts as a skip even below threshold", () => {
    const events = [rec({ top_score: 9, chunk_count: 0 })];
    const report = computeRecallStats(events, { threshold: 0.0 });
    expect(report.overall.skipRate).toBe(0);
  });

  test("per-branch breakdown groups by branch", () => {
    const events = [
      rec({ branch: "kg-query", lane_outcome: "success" }),
      rec({ branch: "file-bm25", lane_outcome: "failure" }),
      rec({ branch: "file-bm25", lane_outcome: "success" }),
    ];
    const report = computeRecallStats(events);
    const branches = report.perBranch.map((b) => b.branch);
    expect(branches).toEqual(["file-bm25", "kg-query"]); // sorted
    const bm25 = report.perBranch.find((b) => b.branch === "file-bm25")!;
    expect(bm25.count).toBe(2);
    expect(bm25.precision).toBeCloseTo(0.5, 6);
  });

  test("renderTable produces a non-empty human table", () => {
    const out = renderTable(computeRecallStats([rec({ lane_outcome: "success" })]));
    expect(out).toContain("Recall-quality report");
    expect(out).toContain("overall");
  });
});

describe("G10 — recall-stats reads JSONL telemetry from a run-set", () => {
  test("reads recall_decision events across run dirs (canonical + legacy)", () => {
    const runs = fs.mkdtempSync(path.join(os.tmpdir(), "g10-runs-"));
    TEMP_DIRS.push(runs);

    const writeEvents = (runId: string, file: "logs/v1.4-events.jsonl" | "events.ndjson", recs: RecallDecisionRecord[]) => {
      const abs = path.join(runs, runId, file);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const lines = recs.map((r) => JSON.stringify({ schema_version: RECALL_DECISION_SCHEMA, ts: "2026-06-25T00:00:00Z", run_id: runId, lane_id: "", query_preview: "", ...r }));
      // Include a non-recall line to prove filtering works.
      fs.writeFileSync(abs, [`{"schema_version":"guild.trace.recall.v1","ts":"2026-06-25T00:00:00Z"}`, ...lines].join("\n") + "\n", "utf8");
    };

    writeEvents("run-1", "logs/v1.4-events.jsonl", [rec({ lane_outcome: "success" }), rec({ lane_outcome: "failure" })]);
    writeEvents("run-2", "events.ndjson", [rec({ lane_outcome: "success" })]); // legacy fallback

    const events = readRecallDecisionEvents(runs);
    expect(events.length).toBe(3); // 2 + 1, the recall.v1 line filtered out

    const report = computeRecallStats(events);
    expect(report.overall.hits).toBe(2);
    expect(report.overall.misses).toBe(1);
  });

  test("missing run-set dir → empty report, no throw", () => {
    const events = readRecallDecisionEvents("/nonexistent/path/to/runs");
    expect(events).toEqual([]);
    expect(computeRecallStats(events).overall.count).toBe(0);
  });
});
