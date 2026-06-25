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
  readHandoffOutcomes,
  joinLaneOutcomes,
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
    run_id: "run-1",
    lane_id: "",
    query_hash: "0000000000000000",
    branch: "kg-query",
    top_score: 5,
    threshold: 0.4,
    read_skip_fired: true,
    chunk_count: 3,
    scored: true,
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

// ---------------------------------------------------------------------------
// FINDING 1 — precision populates from a REAL lane-outcome JOIN (not hand-seeded)
// ---------------------------------------------------------------------------

describe("G10 FINDING-1 — lane-outcome join makes precision non-vacuous in production", () => {
  /** Write a recall_decision event (production-shaped: lane_outcome ALWAYS "unknown"). */
  function eventLine(runId: string, laneId: string): string {
    return JSON.stringify({
      schema_version: RECALL_DECISION_SCHEMA,
      ts: "2026-06-25T00:00:00Z",
      run_id: runId,
      lane_id: laneId,
      query_hash: "abcdef0123456789",
      query_preview: "",
      branch: "kg-query",
      top_score: 5,
      threshold: 0.4,
      read_skip_fired: true,
      chunk_count: 3,
      scored: true,
      lane_outcome: "unknown", // <-- production: recall() never knows the outcome
    });
  }

  /** Write a guild.handoff.v2 receipt the join reads. */
  function writeHandoff(runDir: string, file: string, taskId: string, status: string): void {
    const dir = path.join(runDir, "handoffs");
    fs.mkdirSync(dir, { recursive: true });
    const env = JSON.stringify(
      { schema_version: "guild.handoff.v2", task_id: taskId, tier: "mid", status, summary: "s", artifacts: [], issues: [] },
      null,
      2,
    );
    fs.writeFileSync(path.join(dir, file), `# Receipt\n\n\`\`\`guild.handoff.v2\n${env}\n\`\`\`\n`, "utf8");
  }

  test("join derives success/failure from handoff receipts — precision populates although events are all 'unknown'", () => {
    const runs = fs.mkdtempSync(path.join(os.tmpdir(), "g10-join-"));
    TEMP_DIRS.push(runs);
    const runId = "run-join";
    const runDir = path.join(runs, runId);

    // Two production recall events, BOTH lane_outcome "unknown".
    const logFile = path.join(runDir, "logs", "v1.4-events.jsonl");
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, [eventLine(runId, "L1"), eventLine(runId, "L2")].join("\n") + "\n", "utf8");

    // Real lane outcomes: L1 succeeded (done), L2 failed (blocked).
    writeHandoff(runDir, "backend-L1.md", "L1", "done");
    writeHandoff(runDir, "developer-L2.md", "L2", "blocked");

    const events = readRecallDecisionEvents(runs);
    // Precision is REAL: derived from the join, not from any seeded outcome.
    const report = computeRecallStats(events);
    expect(report.overall.hits).toBe(1); // L1 → done → success
    expect(report.overall.misses).toBe(1); // L2 → blocked → failure
    expect(report.overall.precision).toBeCloseTo(0.5, 6);
    expect(report.overall.precision).not.toBeNull();
  });

  test("ANTI-VACUITY: without the join precision is n/a — proving the join is what populates it", () => {
    // Same two 'unknown' events, but NO handoff receipts → nothing to join.
    const recs: RecallDecisionRecord[] = [
      rec({ lane_id: "L1", lane_outcome: "unknown" }),
      rec({ lane_id: "L2", lane_outcome: "unknown" }),
    ];
    expect(computeRecallStats(recs).overall.precision).toBeNull();

    // Apply the join with real outcomes → precision becomes decidable.
    const outcomes = new Map<string, "success" | "failure">([["L1", "success"], ["L2", "failure"]]);
    const joined = joinLaneOutcomes(recs, outcomes);
    expect(computeRecallStats(joined).overall.precision).toBeCloseTo(0.5, 6);
  });

  test("join leaves an already-decided outcome untouched (only 'unknown' is resolved)", () => {
    const recs = [rec({ lane_id: "L1", lane_outcome: "failure" })];
    const joined = joinLaneOutcomes(recs, new Map([["L1", "success"]]));
    expect(joined[0]!.lane_outcome).toBe("failure"); // not overwritten
  });

  test("readHandoffOutcomes maps done→success, blocked/escalate→failure; ignores malformed", () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "g10-ho-"));
    TEMP_DIRS.push(runDir);
    writeHandoff(runDir, "a-T1.md", "T1", "done");
    writeHandoff(runDir, "b-T2.md", "T2", "blocked");
    writeHandoff(runDir, "c-T3.md", "T3", "escalate");
    // Malformed: no fence → skipped.
    fs.writeFileSync(path.join(runDir, "handoffs", "d-T4.md"), "# no fence here\n", "utf8");

    const m = readHandoffOutcomes(runDir);
    expect(m.get("T1")).toBe("success");
    expect(m.get("T2")).toBe("failure");
    expect(m.get("T3")).toBe("failure");
    expect(m.has("T4")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FINDING 2 — unscored events are EXCLUDED from skip-rate + threshold simulation
// ---------------------------------------------------------------------------

describe("G10 FINDING-2 — skip-rate excludes unscored (sqlite/fs-scan) events", () => {
  test("an unscored event never inflates/deflates the skip-rate denominator", () => {
    const events = [
      rec({ branch: "file-bm25", scored: true, top_score: 5, read_skip_fired: true, chunk_count: 2 }),
      // sqlite/fs-scan: no comparable score → scored:false, placeholder top_score 0.
      rec({ branch: "sqlite", scored: false, top_score: 0, read_skip_fired: false, chunk_count: 2 }),
    ];
    const report = computeRecallStats(events);
    // count = both; scoredCount = 1; skip-rate = 1 scored skip / 1 scored = 1.0
    // (NOT 0.5, which is what counting the unscored event in the denominator gives).
    expect(report.overall.count).toBe(2);
    expect(report.overall.scoredCount).toBe(1);
    expect(report.overall.skipRate).toBeCloseTo(1.0, 6);
  });

  test("threshold simulation also excludes unscored events (placeholder-0 never simulated)", () => {
    const events = [
      rec({ branch: "file-bm25", scored: true, top_score: 0.5, chunk_count: 2 }),
      rec({ branch: "sqlite", scored: false, top_score: 0, chunk_count: 2 }),
    ];
    // At threshold 0.1: the scored 0.5 clears it; the unscored 0 is excluded
    // entirely (not simulated as 0 >= 0.1 == false in the denominator).
    const report = computeRecallStats(events, { threshold: 0.1 });
    expect(report.overall.scoredCount).toBe(1);
    expect(report.overall.skipRate).toBeCloseTo(1.0, 6);
  });

  test("all-unscored run → skip-rate n/a (null), NOT a coerced 0% (no divide-by-zero, no parity leak)", () => {
    const report = computeRecallStats([rec({ scored: false, top_score: 0, read_skip_fired: false })]);
    expect(report.overall.scoredCount).toBe(0);
    // REGRESSION (FIX-G10-r2 finding 1): an empty scored denominator must report
    // null/n/a, never 0 — a 0.0% would let an all-unscored index:on run look like
    // a genuine "0% skipped" next to a scored index:off run (parity leak).
    expect(report.overall.skipRate).toBeNull();
  });

  test("renderTable shows 'n/a' (not '0.0%') for an all-unscored run's skip-rate", () => {
    const out = renderTable(computeRecallStats([rec({ scored: false, top_score: 0, read_skip_fired: false })]));
    // The overall row must carry an n/a skip-rate, never a misleading 0.0%.
    const overallLine = out.split("\n").find((l) => l.startsWith("overall"))!;
    expect(overallLine).toContain("n/a");
    // Anti-vacuity: a SCORED 0%-skip run still renders a real 0.0% (n/a is only
    // for the empty-denominator case, not "nothing skipped").
    const scored = renderTable(
      computeRecallStats([rec({ scored: true, top_score: 0.1, threshold: 0.4, read_skip_fired: false, lane_outcome: "success" })]),
    );
    const scoredOverall = scored.split("\n").find((l) => l.startsWith("overall"))!;
    expect(scoredOverall).toContain("0.0%");
  });

  test("index:on (all-unscored sqlite) vs index:off (scored bm25) skip-rate reports are consistent — on=n/a, off=real, neither a coerced 0", () => {
    // Separate per-mode reports over the SAME corpus, exactly as `recall-stats`
    // would render for an index:on run-set vs an index:off run-set.
    const onReport = computeRecallStats([
      rec({ branch: "sqlite", scored: false, top_score: 0, read_skip_fired: false }),
      rec({ branch: "sqlite", scored: false, top_score: 0, read_skip_fired: false }),
    ]);
    const offReport = computeRecallStats([
      rec({ branch: "file-bm25", scored: true, top_score: 5, read_skip_fired: true }),
      rec({ branch: "file-bm25", scored: true, top_score: 0.1, threshold: 0.4, read_skip_fired: false }),
    ]);
    // index:on has no comparable score → n/a, NOT 0% (which would falsely read as
    // "consistent with a 0%-skip scored run"). index:off reports its real rate.
    expect(onReport.overall.skipRate).toBeNull();
    expect(offReport.overall.skipRate).toBeCloseTo(0.5, 6);
    // The two reports never both claim a numeric skip-rate that could silently
    // diverge: the unscored side is explicitly n/a.
    expect(onReport.overall.skipRate).not.toBe(0);
  });
});
