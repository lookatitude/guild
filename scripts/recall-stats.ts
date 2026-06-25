#!/usr/bin/env -S npx tsx
/**
 * scripts/recall-stats.ts — recall-quality report (G10).
 *
 * Reads `guild.trace.recall_decision.v1` events from a run-set's telemetry
 * (each run's `logs/v1.4-events.jsonl`, legacy `events.ndjson` fallback) and
 * computes a precision / skip-rate table per branch + overall, so a human can
 * tune `models.recallScoreThreshold` empirically (the reference engine's 0.75
 * threshold was *measured*, not guessed).
 *
 * Two skip-rate views:
 *   - RECORDED  — uses each event's `read_skip_fired` (the threshold that was in
 *                 effect at recall time).
 *   - SIMULATED — when `--threshold N` is given, recomputes skip = top_score >= N
 *                 over the SAME events, so you can see what the skip-rate WOULD be
 *                 at a candidate threshold without re-running anything.
 *
 * Precision uses the downstream `lane_outcome` hook: success → hit, failure →
 * miss, unknown → excluded from precision.
 *
 * No new store; reads existing JSONL telemetry. SQLite-independent.
 *
 * Usage:
 *   npx tsx recall-stats.ts [--cwd <repo>] [--runs <dir>] [--threshold N] [--json]
 *   --runs defaults to <cwd>/.guild/runs
 * Exit 0 always (empty run-set → empty table, not an error).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const RECALL_DECISION_SCHEMA = "guild.trace.recall_decision.v1";

/** One recall-decision record (the fields recall-stats consumes). */
export interface RecallDecisionRecord {
  /** Run this decision belongs to (join key for the lane-outcome join). */
  run_id: string;
  /** Lane/specialist this decision belongs to (join key → handoff task_id). */
  lane_id: string;
  query_hash: string;
  branch: string;
  top_score: number;
  threshold: number;
  read_skip_fired: boolean;
  chunk_count: number;
  /**
   * Whether `top_score` is a comparable, threshold-meaningful score. Unscored
   * events (SQLite / fs-scan wiki branches) are EXCLUDED from skip-rate and
   * threshold simulation so the index-on vs index-off skip behavior cannot
   * diverge via a coerced-0 (G10 SQLite-off==on parity). Absent in pre-parity
   * events → treated as `true` (legacy events carried a real or coerced score).
   */
  scored: boolean;
  /**
   * Downstream lane outcome. Emitted as "unknown" by recall() (the outcome is
   * not knowable at recall time); resolved in production by joining to the run's
   * handoff receipts (see readRecallDecisionEvents → joinLaneOutcomes).
   */
  lane_outcome: "success" | "failure" | "unknown";
}

/** Aggregated stats for one branch (or overall). */
export interface BranchStats {
  branch: string;
  count: number;
  /**
   * Number of SCORED events (`scored===true`) — the skip-rate denominator.
   * Unscored events (sqlite/fs-scan) carry no comparable score and are excluded.
   */
  scoredCount: number;
  /**
   * skips / scoredCount — read_skip_fired (or, under --threshold, top_score>=threshold).
   * `null` (rendered "n/a") when scoredCount===0: an all-unscored run (e.g. an
   * index:on SQLite-only branch set) has NO comparable score to skip on, so it
   * must NOT report a real-looking 0% that an index:off scored run could differ
   * from. Reporting null keeps index:on vs index:off skip-rate reports honest
   * (both n/a, or both real) instead of leaking a coerced 0 (G10 parity).
   */
  skipRate: number | null;
  skips: number;
  hits: number;
  misses: number;
  /** hits / (hits + misses); null when no decided outcomes. */
  precision: number | null;
}

export interface RecallStatsReport {
  /** When set, skipRate is SIMULATED at this threshold; else RECORDED. */
  thresholdOverride: number | null;
  overall: BranchStats;
  perBranch: BranchStats[];
}

// ---------------------------------------------------------------------------
// Pure aggregation
// ---------------------------------------------------------------------------

function aggregate(
  branch: string,
  records: RecallDecisionRecord[],
  thresholdOverride: number | null,
): BranchStats {
  let skips = 0;
  let scoredCount = 0;
  let hits = 0;
  let misses = 0;
  for (const r of records) {
    // Parity (G10): only scored events have a threshold-comparable top_score, so
    // only they participate in the skip-rate (recorded OR simulated). An unscored
    // event's read_skip_fired is always false and its top_score is a placeholder
    // 0 — including it would let index-on (sqlite, unscored) and index-off
    // (file-bm25, scored) report different skip behavior for the same recall.
    if (r.scored) {
      scoredCount++;
      const skipped =
        thresholdOverride === null
          ? r.read_skip_fired
          : r.chunk_count > 0 && r.top_score >= thresholdOverride;
      if (skipped) skips++;
    }
    if (r.lane_outcome === "success") hits++;
    else if (r.lane_outcome === "failure") misses++;
  }
  const count = records.length;
  const decided = hits + misses;
  return {
    branch,
    count,
    scoredCount,
    skips,
    // Empty scored denominator → n/a (null), NEVER a coerced 0: a 0.0% would be
    // indistinguishable from a genuine "nothing skipped" and lets an all-unscored
    // index:on run masquerade as scored-0% next to an index:off scored report.
    skipRate: scoredCount === 0 ? null : skips / scoredCount,
    hits,
    misses,
    precision: decided === 0 ? null : hits / decided,
  };
}

/**
 * Compute the recall-stats report from a list of recall-decision records.
 * Pure — no I/O. `opts.threshold` switches skipRate from recorded to simulated.
 */
export function computeRecallStats(
  events: RecallDecisionRecord[],
  opts: { threshold?: number } = {},
): RecallStatsReport {
  const thresholdOverride = typeof opts.threshold === "number" ? opts.threshold : null;

  const byBranch = new Map<string, RecallDecisionRecord[]>();
  for (const e of events) {
    const list = byBranch.get(e.branch) ?? [];
    list.push(e);
    byBranch.set(e.branch, list);
  }

  const perBranch = [...byBranch.keys()]
    .sort()
    .map((b) => aggregate(b, byBranch.get(b)!, thresholdOverride));

  return {
    thresholdOverride,
    overall: aggregate("overall", events, thresholdOverride),
    perBranch,
  };
}

// ---------------------------------------------------------------------------
// Event reader
// ---------------------------------------------------------------------------

function isRecallDecision(o: unknown): o is RecallDecisionRecord {
  if (typeof o !== "object" || o === null) return false;
  const e = o as Record<string, unknown>;
  return (
    e["schema_version"] === RECALL_DECISION_SCHEMA &&
    typeof e["branch"] === "string" &&
    typeof e["top_score"] === "number" &&
    typeof e["threshold"] === "number" &&
    typeof e["read_skip_fired"] === "boolean" &&
    typeof e["chunk_count"] === "number"
  );
}

function parseJsonlEvents(filePath: string): RecallDecisionRecord[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const out: RecallDecisionRecord[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }
    if (isRecallDecision(obj)) {
      const e = obj as unknown as Record<string, unknown>;
      out.push({
        run_id: typeof e["run_id"] === "string" ? (e["run_id"] as string) : "",
        lane_id: typeof e["lane_id"] === "string" ? (e["lane_id"] as string) : "",
        query_hash: typeof e["query_hash"] === "string" ? (e["query_hash"] as string) : "",
        branch: e["branch"] as string,
        top_score: e["top_score"] as number,
        threshold: e["threshold"] as number,
        read_skip_fired: e["read_skip_fired"] as boolean,
        chunk_count: e["chunk_count"] as number,
        // Absent (pre-parity event) → treated as scored; see RecallDecisionRecord.scored.
        scored: typeof e["scored"] === "boolean" ? (e["scored"] as boolean) : true,
        lane_outcome:
          e["lane_outcome"] === "success" || e["lane_outcome"] === "failure"
            ? (e["lane_outcome"] as "success" | "failure")
            : "unknown",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lane-outcome join (G10 — real precision wiring, NOT hand-seeded)
// ---------------------------------------------------------------------------
//
// recall() emits recall_decision events with lane_outcome="unknown" — the outcome
// is genuinely unknowable at recall time (recall runs BEFORE the lane executes).
// The real signal lands later, when the lane writes its `guild.handoff.v2` receipt
// to `.guild/runs/<id>/handoffs/<owner>-<task-id>.md`. recall-stats JOINS the two
// (on run + lane/task id) so precision populates in production from real receipts.

/** Extract the `guild.handoff.v2` fenced JSON from a receipt's markdown. */
function extractHandoffFence(content: string): Record<string, unknown> | null {
  // Mirror of hooks/lib/handoff-v2.ts:extractHandoffEnvelope (kept local so
  // recall-stats stays self-contained, as reaping.ts does the same).
  const m = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/.exec(content);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]!.trim());
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Read lane outcomes from one run dir's handoff receipts. Maps each receipt's
 * `task_id` → "success" (status "done") / "failure" (status "blocked"|"escalate").
 * Receipts without a parseable envelope / task_id / status are skipped. Never throws.
 */
export function readHandoffOutcomes(runDir: string): Map<string, "success" | "failure"> {
  const out = new Map<string, "success" | "failure">();
  const handoffsDir = path.join(runDir, "handoffs");
  let files: string[];
  try {
    files = fs.readdirSync(handoffsDir).filter((f) => f.endsWith(".md"));
  } catch {
    return out;
  }
  for (const f of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(handoffsDir, f), "utf8");
    } catch {
      continue;
    }
    const env = extractHandoffFence(content);
    if (!env) continue;
    const taskId = typeof env["task_id"] === "string" ? (env["task_id"] as string) : "";
    const status = env["status"];
    if (!taskId) continue;
    if (status === "done") out.set(taskId, "success");
    else if (status === "blocked" || status === "escalate") out.set(taskId, "failure");
  }
  return out;
}

/**
 * Resolve each record's lane_outcome from a (lane_id → outcome) map — but ONLY
 * for records still "unknown" (the production case). Records that already carry
 * an explicit success/failure (e.g. a caller wired it via opts.laneOutcome) are
 * left untouched. Pure; returns new records.
 */
export function joinLaneOutcomes(
  records: RecallDecisionRecord[],
  outcomes: Map<string, "success" | "failure">,
): RecallDecisionRecord[] {
  return records.map((r) => {
    if (r.lane_outcome !== "unknown") return r;
    const joined = outcomes.get(r.lane_id);
    return joined ? { ...r, lane_outcome: joined } : r;
  });
}

/**
 * Read all recall-decision events from a run-set directory (`.guild/runs`).
 * Each run dir contributes `logs/v1.4-events.jsonl` (or legacy `events.ndjson`),
 * and its `handoffs/*.md` receipts supply the lane-outcome join so precision can
 * populate from REAL run telemetry (not hand-seeded outcomes).
 * Missing/unreadable files are skipped. Never throws.
 */
export function readRecallDecisionEvents(runsDir: string): RecallDecisionRecord[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const events: RecallDecisionRecord[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const runDir = path.join(runsDir, ent.name);
    const canonical = path.join(runDir, "logs", "v1.4-events.jsonl");
    const legacy = path.join(runDir, "events.ndjson");
    const file = fs.existsSync(canonical) ? canonical : legacy;
    // Join each run dir's events to its OWN handoff receipts (same physical run).
    const outcomes = readHandoffOutcomes(runDir);
    events.push(...joinLaneOutcomes(parseJsonlEvents(file), outcomes));
  }
  return events;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function renderTable(report: RecallStatsReport): string {
  const lines: string[] = [];
  const mode = report.thresholdOverride === null
    ? "recorded read_skip_fired"
    : `simulated @ threshold ${report.thresholdOverride}`;
  lines.push(`Recall-quality report (skip-rate: ${mode})`);
  lines.push("");
  lines.push("branch          count   skip-rate   precision   hits/miss");
  lines.push("------          -----   ---------   ---------   ---------");
  const row = (s: BranchStats): string => {
    const prec = s.precision === null ? "  n/a  " : pct(s.precision).padStart(7);
    // null skip-rate (no scored events) renders "n/a", not a misleading 0.0%.
    const skip = s.skipRate === null ? "   n/a  " : pct(s.skipRate).padStart(8);
    return `${s.branch.padEnd(14)}  ${String(s.count).padStart(5)}   ${skip}   ${prec}   ${s.hits}/${s.misses}`;
  };
  for (const b of report.perBranch) lines.push(row(b));
  lines.push("------          -----   ---------   ---------   ---------");
  lines.push(row(report.overall));
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function runRecallStatsCli(argv: string[]): void {
  let cwd = process.cwd();
  let runsDir = "";
  let threshold: number | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--cwd" && argv[i + 1]) cwd = argv[++i]!;
    else if (a === "--runs" && argv[i + 1]) runsDir = argv[++i]!;
    else if (a === "--threshold" && argv[i + 1]) threshold = parseFloat(argv[++i]!);
    else if (a === "--json") json = true;
    else if (a.startsWith("--cwd=")) cwd = a.slice("--cwd=".length);
    else if (a.startsWith("--runs=")) runsDir = a.slice("--runs=".length);
    else if (a.startsWith("--threshold=")) threshold = parseFloat(a.slice("--threshold=".length));
  }

  const resolvedRuns = runsDir || path.join(cwd, ".guild", "runs");
  const events = readRecallDecisionEvents(resolvedRuns);
  const report = computeRecallStats(
    events,
    typeof threshold === "number" && !isNaN(threshold) ? { threshold } : {},
  );

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(renderTable(report));
  }
}

if (typeof module !== "undefined" && require.main === module) {
  runRecallStatsCli(process.argv.slice(2));
}
