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
  query_hash: string;
  branch: string;
  top_score: number;
  threshold: number;
  read_skip_fired: boolean;
  chunk_count: number;
  lane_outcome: "success" | "failure" | "unknown";
}

/** Aggregated stats for one branch (or overall). */
export interface BranchStats {
  branch: string;
  count: number;
  /** read_skip_fired==true (or, under --threshold, top_score>=threshold) / count. */
  skipRate: number;
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
  let hits = 0;
  let misses = 0;
  for (const r of records) {
    const skipped =
      thresholdOverride === null
        ? r.read_skip_fired
        : r.chunk_count > 0 && r.top_score >= thresholdOverride;
    if (skipped) skips++;
    if (r.lane_outcome === "success") hits++;
    else if (r.lane_outcome === "failure") misses++;
  }
  const count = records.length;
  const decided = hits + misses;
  return {
    branch,
    count,
    skips,
    skipRate: count === 0 ? 0 : skips / count,
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
      const e = obj as RecallDecisionRecord;
      out.push({
        query_hash: typeof e.query_hash === "string" ? e.query_hash : "",
        branch: e.branch,
        top_score: e.top_score,
        threshold: e.threshold,
        read_skip_fired: e.read_skip_fired,
        chunk_count: e.chunk_count,
        lane_outcome:
          e.lane_outcome === "success" || e.lane_outcome === "failure" ? e.lane_outcome : "unknown",
      });
    }
  }
  return out;
}

/**
 * Read all recall-decision events from a run-set directory (`.guild/runs`).
 * Each run dir contributes `logs/v1.4-events.jsonl` (or legacy `events.ndjson`).
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
    events.push(...parseJsonlEvents(file));
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
    return `${s.branch.padEnd(14)}  ${String(s.count).padStart(5)}   ${pct(s.skipRate).padStart(8)}   ${prec}   ${s.hits}/${s.misses}`;
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
