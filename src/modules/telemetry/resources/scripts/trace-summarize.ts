#!/usr/bin/env -S npx tsx
/**
 * scripts/trace-summarize.ts
 *
 * Reads .guild/runs/<run-id>/events.ndjson and writes a structured summary.md.
 * Called by hooks/maybe-reflect.ts when a reflection is warranted.
 *
 * Usage:
 *   scripts/trace-summarize.ts --run-id <id> [--cwd <path>] [--out <path>]
 *
 * Options:
 *   --run-id <id>   (required) The run to summarize.
 *   --cwd <path>    (optional, default ".") Repo root; events are read from
 *                   <cwd>/.guild/runs/<run-id>/events.ndjson.
 *   --out <path>    (optional, default <cwd>/.guild/runs/<run-id>/summary.md)
 *                   Where to write the summary.
 *
 * Exit codes:
 *   0  Success.
 *   1  Bad input (missing --run-id, events file not found, etc.). Error → stderr.
 *
 * Invariant: never writes to the wiki directory under .guild. Only writes to
 *             the run-specific summary.md at <cwd>/.guild/runs/<run-id>/summary.md.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

interface TelemetryEvent {
  ts: string;
  event: string;
  tool: string;
  specialist: string;
  payload_digest: string;
  ok: boolean;
  ms: number;
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

// ── NDJSON parsing ─────────────────────────────────────────────────────────

interface ParseResult {
  events: TelemetryEvent[];
  parseErrors: number;
}

function parseNdjson(filePath: string): ParseResult {
  const content = fs.readFileSync(filePath, "utf8");
  const events: TelemetryEvent[] = [];
  let parseErrors = 0;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TelemetryEvent);
    } catch {
      parseErrors++;
      process.stderr.write(
        `[trace-summarize] WARN: parse error on line: ${trimmed.slice(0, 80)}\n`
      );
    }
  }

  return { events, parseErrors };
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
      filesTouchedCount: 0,
      errors: 0,
      okRate: 1,
    };
  }

  const startedAt = events[0].ts;
  const endedAt = events[events.length - 1].ts;
  const durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();

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

  const filesTouchedCount = events.filter(
    (e) => e.tool === "Write" || e.tool === "Edit"
  ).length;

  const errors = events.filter((e) => e.ok === false).length;
  const okRate = events.length > 0 ? (events.length - errors) / events.length : 1;

  return {
    runId,
    startedAt,
    endedAt,
    durationMs,
    eventCount: events.length,
    specialists,
    toolCounts,
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

  return [
    "---",
    `run_id: ${stats.runId}`,
    `started_at: ${stats.startedAt || "(none)"}`,
    `ended_at: ${stats.endedAt || "(none)"}`,
    `duration_ms: ${stats.durationMs}`,
    `event_count: ${stats.eventCount}`,
    `specialists_dispatched: [${specialistsLine}]`,
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
      const status = event.ok ? "" : " ⚠ ERROR";
      lines.push(`- \`${ts}\` — ${event.tool}${spec}${status} (${event.ms}ms)`);
    } else if (event.tool) {
      const spec = event.specialist ? ` [${event.specialist}]` : "";
      const status = event.ok ? "" : " ⚠ ERROR";
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
    if (!event.ok) s.errors++;
    else s.ok++;
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
  const errorEvents = events.filter((e) => !e.ok);
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
    new Set(events.filter((e) => !e.ok && e.specialist).map((e) => e.specialist))
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
  const eventsFile = path.join(cwd, ".guild", "runs", runId, "events.ndjson");
  const defaultOut = path.join(cwd, ".guild", "runs", runId, "summary.md");
  const outFile = outArg ? path.resolve(outArg) : defaultOut;

  // Validate events file exists
  if (!fs.existsSync(eventsFile)) {
    process.stderr.write(
      `[trace-summarize] ERROR: events file not found: ${eventsFile}\n`
    );
    process.exit(1);
  }

  // Parse events
  const { events, parseErrors } = parseNdjson(eventsFile);

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
