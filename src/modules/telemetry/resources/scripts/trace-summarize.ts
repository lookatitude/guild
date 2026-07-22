#!/usr/bin/env -S npx tsx
/**
 * scripts/trace-summarize.ts
 *
 * Reads a run's event log — canonical .guild/runs/<run-id>/logs/v1.4-events.jsonl
 * first, legacy .guild/runs/<run-id>/events.ndjson fallback (see
 * scripts/lib/run-events.ts) — and writes a structured summary.md.
 * Called by hooks/maybe-reflect.ts when a reflection is warranted.
 *
 * Usage:
 *   scripts/trace-summarize.ts --run-id <id> [--cwd <path>] [--out <path>]
 *
 * Options:
 *   --run-id <id>   (required) The run to summarize.
 *   --cwd <path>    (optional, default ".") Repo root; events are read from
 *                   <cwd>/.guild/runs/<run-id>/logs/v1.4-events.jsonl, falling
 *                   back to <cwd>/.guild/runs/<run-id>/events.ndjson.
 *   --out <path>    (optional, default <cwd>/.guild/runs/<run-id>/summary.md)
 *                   Where to write the summary.
 *
 * Exit codes:
 *   0  Success.
 *   1  Bad input (missing --run-id, no event log found, etc.). Error → stderr.
 *
 * Invariant: never writes to the wiki directory under .guild. Only writes to
 *             the run-specific summary.md at <cwd>/.guild/runs/<run-id>/summary.md.
 */

import * as fs from "fs";
import * as path from "path";
import { loadRunEvents, RunEvent } from "./lib/run-events";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * The fields this module reads, all optional (matches scripts/lib/run-events.ts's
 * RunEvent — the canonical log interleaves hook-mirror lines with
 * guild.trace_event.v1 lines that carry none of these fields; every access
 * below is defensive/undefined-safe, same as before this module read events
 * via a local unsafe `JSON.parse(...) as TelemetryEvent` cast).
 */
type TelemetryEvent = RunEvent;

// ── Event predicates ───────────────────────────────────────────────────────

/**
 * The failure statuses the v1.4 vocabulary actually uses:
 * `tool_call`/`hook_event` say `"err"`, `phase_end` says `"error"`
 * (v1.4-log-validator.ts TOOL_CALL_STATUS / HOOK_STATUS / PHASE_END_STATUS).
 */
const FAILURE_STATUSES: ReadonlySet<string> = new Set(["err", "error"]);

/**
 * #76 — an event FAILED only when it SAYS so, in whichever dialect it speaks.
 *
 * The canonical log interleaves three shapes and only one of them has `ok`:
 *   - hook-mirror lines  → `ok: boolean`
 *   - v1.4 wrapped lines → `status: "ok" | "err" | "error" | …`, NO `ok`
 *   - guild.trace.*.v1   → neither (dispatch / recall / degradation / config)
 *
 * The old `!e.ok` test collapsed all three: every `status`-dialect line and
 * every trace line became a phantom "⚠ ERROR" row, a per-specialist error
 * tally, and a bogus "skill-improvement candidates" hint — while a genuine
 * `status: "err"` was indistinguishable from a healthy `status: "ok"`. Both
 * halves are fixed here: absence of a verdict is NOT failure, and the `status`
 * dialect is now read instead of ignored. (Verified against a real run log:
 * 18 `status:"ok"` + 2 `status:"err"` tool_calls, none carrying `ok`.)
 *
 * This matters more now that the pane path (#76) puts a dispatch receipt on
 * the log for EVERY lane.
 */
function isErrorEvent(e: TelemetryEvent): boolean {
  if (e.ok === false) return true;
  return typeof e.status === "string" && FAILURE_STATUSES.has(e.status);
}

/**
 * The other half of the tri-state: an event SUCCEEDED only when it says so.
 *
 * "Not an error" is not "success". A dispatch receipt, a `run_started` marker
 * and a recall trace all carry no verdict at all — folding them into the OK
 * tally would replace one lie (every trace line is an error) with its mirror
 * image (every trace line is a passing tool call). A verdict-less event
 * contributes to NEITHER count.
 */
function isSuccessEvent(e: TelemetryEvent): boolean {
  if (e.ok === true) return true;
  return e.status === "ok";
}

/** A dispatch receipt (guild.trace.dispatch.v1), whatever backend produced it. */
function isDispatchEvent(e: TelemetryEvent): boolean {
  return e.schema_version === "guild.trace.dispatch.v1";
}

/**
 * A CONFIRMED dispatch: the lane actually reached a backend.
 *
 * A bare `backend: "unknown"` receipt is excluded on purpose. write-task-run.ts
 * emits one per TASK before any routing decision ("backend not determinable at
 * emit time" — its own contract), so they are pre-dispatch INTENT, and they
 * count in a different unit than the per-lane receipts the backends emit.
 * Mixing the two would report `[tmux: 3, unknown: 5]` for a three-lane run.
 */
function isConfirmedDispatch(e: TelemetryEvent): boolean {
  if (!isDispatchEvent(e)) return false;
  // A surface the closed `backend` enum cannot name (cmux) rides
  // `backend: "unknown"` and identifies itself in `pane_backend`. Its presence
  // is what separates such a receipt from a pre-routing intent, which carries
  // "unknown" and nothing else. The producer-side cross-field invariant
  // (validateDispatchEvent) guarantees a `pane_backend` line really is a
  // confirmed dispatch: backend "unknown" AND backend_rung >= 1.
  if (typeof e.pane_backend === "string" && e.pane_backend !== "") return true;
  return typeof e.backend === "string" && e.backend !== "" && e.backend !== "unknown";
}

/**
 * The surface to report a dispatch under: the concrete `pane_backend` when the
 * closed `backend` enum could not name it, else `backend` itself. Absent on
 * every pre-#76 event, which simply report their `backend`.
 */
function dispatchSurface(e: TelemetryEvent): string {
  if (typeof e.pane_backend === "string" && e.pane_backend) return e.pane_backend;
  return e.backend as string;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  runId: string | null;
  cwd: string;
  out: string | null;
} {
  let runId: string | null = null;
  let cwd = ".";
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-id" && i + 1 < argv.length) {
      runId = argv[++i];
    } else if (argv[i] === "--cwd" && i + 1 < argv.length) {
      cwd = argv[++i];
    } else if (argv[i] === "--out" && i + 1 < argv.length) {
      out = argv[++i];
    }
  }

  return { runId, cwd, out };
}

// ── Statistics ─────────────────────────────────────────────────────────────

interface RunStats {
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  eventCount: number;
  specialists: string[];
  toolCounts: Array<{ tool: string; count: number }>;
  /**
   * #76 — DISTINCT LANES dispatched per surface ("tmux"/"cmux" for a visible
   * pane, "remote" for an SSH lane, "agent" for the in-session Agent path).
   * Pre-routing `unknown` intents are excluded — see isConfirmedDispatch.
   * On a pane run these ARE the specialist signal: the panes are separate host
   * sessions, so none of their tool calls land in this log.
   */
  dispatchCounts: Array<{ backend: string; count: number }>;
  /** #76 — raw receipt lines per surface, so retry volume is not hidden. */
  dispatchReceiptCounts: Array<{ backend: string; count: number }>;
  filesTouchedCount: number;
  errors: number;
  okRate: number;
}

function computeStats(runId: string, events: TelemetryEvent[]): RunStats {
  if (events.length === 0) {
    return {
      runId,
      startedAt: "",
      endedAt: "",
      durationMs: 0,
      eventCount: 0,
      specialists: [],
      toolCounts: [],
      dispatchCounts: [],
      dispatchReceiptCounts: [],
      filesTouchedCount: 0,
      errors: 0,
      okRate: 1,
    };
  }

  // Canonical logs interleave shapes: v1.4 lines carry `ts`, while the
  // guild.trace_event.v1 lifecycle markers (run_started first / run_closed
  // last) carry `at` — normalize so boundary markers still anchor the window.
  const eventTs = (e: { ts?: string; at?: string }): string => e.ts ?? e.at ?? "";
  const startedAt = eventTs(events[0] as { ts?: string; at?: string });
  const endedAt = eventTs(events[events.length - 1] as { ts?: string; at?: string });
  const durationMs = startedAt && endedAt
    ? new Date(endedAt).getTime() - new Date(startedAt).getTime()
    : 0;

  // Specialists: alphabetically sorted, non-empty values
  const specialists = Array.from(
    new Set(events.map((e) => e.specialist).filter(Boolean))
  ).sort();

  // Tool counts: exclude empty-tool entries (SubagentStop), sort by count desc then alpha
  const toolMap = new Map<string, number>();
  for (const event of events) {
    if (!event.tool) continue;
    toolMap.set(event.tool, (toolMap.get(event.tool) ?? 0) + 1);
  }
  const toolCounts = Array.from(toolMap.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));

  // #76: CONFIRMED dispatches grouped by surface, sorted count-desc then alpha
  // (same ordering contract as toolCounts). BOTH numbers are reported, because
  // they answer different questions and neither may hide the other:
  //   dispatched_lanes   — distinct lanes (keyed task_id, else specialist).
  //                        "How many specialists ran?" A retry must not inflate.
  //   dispatch_receipts  — raw receipt lines. "How many dispatch attempts were
  //                        committed?" Retry volume stays visible.
  const dispatchLanes = new Map<string, Set<string>>();
  const receiptMap = new Map<string, number>();
  for (const event of events) {
    if (!isConfirmedDispatch(event)) continue;
    const surface = dispatchSurface(event);
    receiptMap.set(surface, (receiptMap.get(surface) ?? 0) + 1);
    const lane =
      (typeof event.task_id === "string" && event.task_id) ||
      (typeof event.specialist === "string" && event.specialist) ||
      "";
    if (!lane) continue;
    if (!dispatchLanes.has(surface)) dispatchLanes.set(surface, new Set());
    dispatchLanes.get(surface)!.add(lane);
  }
  const bySurface = (a: { backend: string; count: number }, b: { backend: string; count: number }) =>
    b.count - a.count || a.backend.localeCompare(b.backend);
  const dispatchCounts = Array.from(dispatchLanes.entries())
    .map(([backend, lanes]) => ({ backend, count: lanes.size }))
    .sort(bySurface);
  const dispatchReceiptCounts = Array.from(receiptMap.entries())
    .map(([backend, count]) => ({ backend, count }))
    .sort(bySurface);

  const filesTouchedCount = events.filter(
    (e) => e.tool === "Write" || e.tool === "Edit"
  ).length;

  const errors = events.filter(isErrorEvent).length;
  // ok_rate is a rate over events that ACTUALLY REPORT AN OUTCOME. The old
  // denominator was every line, so a verdict-less event silently scored as a
  // success — and #76 makes that worse by putting one dispatch receipt per lane
  // on the log: a pane-only run would read `ok_rate: 1` having verified nothing,
  // and any mixed run's rate would be diluted upward by its own receipts.
  // No verdict, no vote (same tri-state buildSpecialistActivity uses).
  const verdictBearing = events.filter((e) => isErrorEvent(e) || isSuccessEvent(e)).length;
  const okRate = verdictBearing > 0 ? (verdictBearing - errors) / verdictBearing : 1;

  return {
    runId,
    startedAt,
    endedAt,
    durationMs,
    eventCount: events.length,
    specialists,
    toolCounts,
    dispatchCounts,
    dispatchReceiptCounts,
    filesTouchedCount,
    errors,
    okRate: Math.round(okRate * 1000) / 1000,
  };
}

// ── Summary sections ───────────────────────────────────────────────────────

function buildFrontmatter(stats: RunStats): string {
  const toolsLine =
    stats.toolCounts.length > 0
      ? stats.toolCounts.map(({ tool, count }) => `${tool}: ${count}`).join(", ")
      : "(none)";

  const specialistsLine =
    stats.specialists.length > 0
      ? stats.specialists.join(", ")
      : "(none)";

  // #76: a pane run's dispatch signal, so "10 lanes ran" is answerable from the
  // frontmatter alone even though no pane tool call reached this log.
  const surfaceLine = (rows: Array<{ backend: string; count: number }>): string =>
    rows.length > 0
      ? rows.map(({ backend, count }) => `${backend}: ${count}`).join(", ")
      : "(none)";
  const dispatchedLanesLine = surfaceLine(stats.dispatchCounts);
  const dispatchReceiptsLine = surfaceLine(stats.dispatchReceiptCounts);

  return [
    "---",
    `run_id: ${stats.runId}`,
    `started_at: ${stats.startedAt || "(none)"}`,
    `ended_at: ${stats.endedAt || "(none)"}`,
    `duration_ms: ${stats.durationMs}`,
    `event_count: ${stats.eventCount}`,
    `specialists_dispatched: [${specialistsLine}]`,
    `dispatched_lanes: [${dispatchedLanesLine}]`,
    `dispatch_receipts: [${dispatchReceiptsLine}]`,
    `tools_used: [${toolsLine}]`,
    `files_touched_count: ${stats.filesTouchedCount}`,
    `errors: ${stats.errors}`,
    `ok_rate: ${stats.okRate}`,
    "---",
  ].join("\n");
}

function buildTimeline(events: TelemetryEvent[]): string {
  if (events.length === 0) return "No events recorded.";

  const lines: string[] = [];
  for (const event of events) {
    const ts = event.ts;
    if (event.event === "SubagentStop") {
      const spec = event.specialist || "(main session)";
      lines.push(`- \`${ts}\` — specialist **${spec}** completed (${event.ms}ms)`);
    } else if (event.tool === "Write" || event.tool === "Edit") {
      const spec = event.specialist ? ` [${event.specialist}]` : "";
      const status = isErrorEvent(event) ? " ⚠ ERROR" : "";
      lines.push(`- \`${ts}\` — ${event.tool}${spec}${status} (${event.ms}ms)`);
    } else if (event.tool) {
      const spec = event.specialist ? ` [${event.specialist}]` : "";
      const status = isErrorEvent(event) ? " ⚠ ERROR" : "";
      lines.push(`- \`${ts}\` — ${event.tool}${spec}${status} (${event.ms}ms)`);
    }
  }
  return lines.join("\n");
}

function buildSpecialistActivity(events: TelemetryEvent[]): string {
  if (events.length === 0) return "No specialist activity recorded.";

  // Collect per-specialist stats
  const specialistMap = new Map<
    string,
    { toolCalls: number; fileOps: number; errors: number; ok: number }
  >();

  for (const event of events) {
    const key = event.specialist || "(main session)";
    if (!specialistMap.has(key)) {
      specialistMap.set(key, { toolCalls: 0, fileOps: 0, errors: 0, ok: 0 });
    }
    const s = specialistMap.get(key)!;
    if (event.event === "PostToolUse" && event.tool) {
      s.toolCalls++;
      if (event.tool === "Write" || event.tool === "Edit") s.fileOps++;
    }
    // Tri-state: failed / succeeded / no verdict at all (counted in neither).
    if (isErrorEvent(event)) s.errors++;
    else if (isSuccessEvent(event)) s.ok++;
  }

  // Sort: named specialists alphabetically first, then (main session)
  const keys = Array.from(specialistMap.keys()).sort((a, b) => {
    if (a === "(main session)") return 1;
    if (b === "(main session)") return -1;
    return a.localeCompare(b);
  });

  const lines: string[] = [];
  for (const key of keys) {
    const s = specialistMap.get(key)!;
    lines.push(`### ${key}`);
    lines.push(`- Tool calls: ${s.toolCalls}`);
    lines.push(`- Files touched (Write/Edit): ${s.fileOps}`);
    lines.push(`- OK: ${s.ok}, Errors: ${s.errors}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function buildNotableEvents(events: TelemetryEvent[]): string {
  const notable: string[] = [];

  // Errors
  const errorEvents = events.filter(isErrorEvent);
  for (const e of errorEvents) {
    notable.push(
      `- ERROR at \`${e.ts}\`: tool **${e.tool || "(none)"}** by ${e.specialist || "(main session)"} — digest: ${e.payload_digest}`
    );
  }

  // Very long tool calls (> 2000ms for tool use events, heuristic)
  const longCalls = events.filter(
    (e) => e.event === "PostToolUse" && e.ms > 2000
  );
  for (const e of longCalls) {
    notable.push(
      `- SLOW at \`${e.ts}\`: tool **${e.tool}** by ${e.specialist || "(main session)"} took ${e.ms}ms`
    );
  }

  return notable.length > 0 ? notable.join("\n") : "No notable events.";
}

function buildReflectionHints(stats: RunStats, events: TelemetryEvent[]): string {
  const hints: string[] = [];

  // Skill-improvement candidates: specialists with errors
  const specialistsWithErrors = Array.from(
    new Set(events.filter((e) => isErrorEvent(e) && e.specialist).map((e) => e.specialist))
  ).sort();
  if (specialistsWithErrors.length > 0) {
    hints.push(
      `- skill-improvement candidates: ${specialistsWithErrors.join(", ")} had errors — review tool-call patterns`
    );
  }

  // Missing-specialist candidates: events from main session (empty specialist) with tool use
  const mainSessionToolCalls = events.filter(
    (e) => e.event === "PostToolUse" && !e.specialist && e.tool
  );
  if (mainSessionToolCalls.length > 0) {
    hints.push(
      `- missing-specialist candidates: ${mainSessionToolCalls.length} tool call(s) ran in main session — consider routing to a specialist`
    );
  }

  // Context-bundle issues: any tool calls over 5000ms
  const verySlowCalls = events.filter(
    (e) => e.event === "PostToolUse" && e.ms > 5000
  );
  if (verySlowCalls.length > 0) {
    hints.push(
      `- context-bundle issues: ${verySlowCalls.length} tool call(s) exceeded 5000ms — possible large context or slow tool`
    );
  }

  // ok_rate summary
  if (stats.okRate < 1) {
    hints.push(
      `- ok_rate ${stats.okRate} — ${stats.errors} error(s) in ${stats.eventCount} event(s); review error events above`
    );
  }

  if (hints.length === 0) {
    hints.push("- No actionable hints detected.");
  }

  return hints.join("\n");
}

function buildSummary(runId: string, events: TelemetryEvent[]): string {
  const stats = computeStats(runId, events);

  const sections = [
    buildFrontmatter(stats),
    "",
    `# Run ${runId} summary`,
    "",
    "## Timeline",
    "",
    buildTimeline(events),
    "",
    "## Specialist activity",
    "",
    buildSpecialistActivity(events),
    "",
    "## Notable events",
    "",
    buildNotableEvents(events),
    "",
    "## Reflection hints",
    "",
    buildReflectionHints(stats, events),
    "",
  ];

  return sections.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const { runId, cwd: cwdArg, out: outArg } = parseArgs(args);

  // Validate --run-id
  if (!runId) {
    process.stderr.write("[trace-summarize] ERROR: --run-id <id> is required\n");
    process.exit(1);
  }

  // Resolve paths
  const cwd = path.resolve(cwdArg);
  const runDir = path.join(cwd, ".guild", "runs", runId);
  const defaultOut = path.join(runDir, "summary.md");
  const outFile = outArg ? path.resolve(outArg) : defaultOut;

  // Load events: canonical logs/v1.4-events.jsonl first, legacy events.ndjson fallback.
  const { events, source, filePath, parseErrors } = loadRunEvents(runDir);

  // Validate an event log was found
  if (source === "none") {
    process.stderr.write(
      `[trace-summarize] ERROR: no event log found for run ${runId} ` +
        `(looked for ${filePath} and ${path.join(runDir, "events.ndjson")})\n`
    );
    process.exit(1);
  }

  if (parseErrors > 0) {
    process.stderr.write(
      `[trace-summarize] WARN: ${parseErrors} line(s) failed to parse and were skipped\n`
    );
  }

  // Build summary
  const summary = buildSummary(runId, events);

  // Write output
  const outDir = path.dirname(outFile);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, summary, "utf8");

  process.stderr.write(
    `[trace-summarize] wrote summary for run ${runId} → ${outFile}\n`
  );
  process.exit(0);
}

main();
