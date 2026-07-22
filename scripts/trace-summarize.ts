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

// ── Event normalization ───────────────────────────────────────────────────

/**
 * Bridges the canonical v1.4 `tool_call`/`hook_event` field names (`status:
 * "ok"|"err"|"n/a"`, `latency_ms`) onto the `ok`/`ms`/`tool` fields the rest
 * of this module reads, without overwriting a field already present (the
 * legacy hook-mirror shape already carries `ok`/`ms`/`tool` natively — this
 * is a no-op for those lines).
 *
 * `status` is mapped via an explicit "ok"|"err" WHITELIST, not a `!== "n/a"`
 * blacklist: other event types in the same v1.4 vocabulary reuse the
 * `status` field name with a DIFFERENT enum (e.g. `phase_end` uses
 * "ok"|"error"|"escalated" — see hooks/lib/v1.4/log-jsonl-schema.ts). A
 * blacklist would silently normalize a valid `phase_end status:"escalated"`
 * into `ok:false`, reproducing this same issue's false-ERROR defect one
 * layer up. Any status value outside the whitelist (including "n/a", and
 * any future/unrecognized value) leaves `ok` `undefined` — an unknown
 * verdict, not a failure.
 *
 * `latency_ms`/`duration_ms` must be a non-negative number to map onto `ms`:
 * the orphan-sweep producer (hooks/post-tool-use.ts) emits `latency_ms: -1`
 * as an "unmeasured" sentinel on `status:"err"` rows, not a real duration.
 *
 * `hook_name` bridges to `tool` for `hook_event` rows so a canonical
 * `hook_event status:"err"` (e.g. hooks/lib/context-compliance.ts) is
 * visible in buildTimeline() the same way a `tool_call` error is, keeping
 * the Timeline and the frontmatter error count in agreement. Mirrors
 * mcp-servers/guild-telemetry/src/index.ts's normalizeEvent — the same fix
 * already shipped there for this issue's sibling MCP-query symptom.
 */
function normalizeEvent(raw: TelemetryEvent): TelemetryEvent {
  const e: TelemetryEvent = { ...raw };
  if (e.ok === undefined && (e.status === "ok" || e.status === "err")) {
    e.ok = e.status === "ok";
  }
  if (e.ms === undefined) {
    if (typeof e.latency_ms === "number" && e.latency_ms >= 0) e.ms = e.latency_ms;
    else if (typeof e.duration_ms === "number" && e.duration_ms >= 0) e.ms = e.duration_ms;
  }
  if (e.tool === undefined && e.event === "hook_event" && typeof e.hook_name === "string") {
    e.tool = e.hook_name;
  }
  return e;
}

/** `"<n>ms"` when a numeric duration is known, else `"n/a"` — never the bare `undefined` string. */
function durationLabel(ms: unknown): string {
  return typeof ms === "number" ? `${ms}ms` : "n/a";
}

/** ERROR is only ever asserted from an explicit `ok === false` — an unknown/absent verdict is not an error. */
function errorLabel(ok: unknown): string {
  return ok === false ? " ⚠ ERROR" : "";
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

  const filesTouchedCount = events.filter(
    (e) => e.tool === "Write" || e.tool === "Edit"
  ).length;

  // ok_rate is scoped to events with a defined ok/error verdict — an
  // undefined verdict (e.g. canonical status:"n/a") must not deflate ok_rate
  // as though it were a silent success, so it's excluded from both the
  // numerator and the denominator (mirrors mcp-servers/guild-telemetry).
  const okDefined = events.filter((e) => e.ok === true || e.ok === false);
  const errors = okDefined.filter((e) => e.ok === false).length;
  const okRate = okDefined.length > 0 ? (okDefined.length - errors) / okDefined.length : 1;

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
      lines.push(`- \`${ts}\` — specialist **${spec}** completed (${durationLabel(event.ms)})`);
    } else if (event.tool === "Write" || event.tool === "Edit") {
      const spec = event.specialist ? ` [${event.specialist}]` : "";
      lines.push(`- \`${ts}\` — ${event.tool}${spec}${errorLabel(event.ok)} (${durationLabel(event.ms)})`);
    } else if (event.tool) {
      const spec = event.specialist ? ` [${event.specialist}]` : "";
      lines.push(`- \`${ts}\` — ${event.tool}${spec}${errorLabel(event.ok)} (${durationLabel(event.ms)})`);
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
    if (event.ok === false) s.errors++;
    else if (event.ok === true) s.ok++;
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

  // Errors — only an explicit ok === false is an error; unknown/absent
  // verdicts (e.g. canonical status:"n/a") are not.
  const errorEvents = events.filter((e) => e.ok === false);
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
    new Set(events.filter((e) => e.ok === false && e.specialist).map((e) => e.specialist))
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

  // Build summary — normalize canonical status/latency_ms onto ok/ms first
  // (scripts/lib/run-events.ts intentionally leaves shape interpretation to
  // the caller; see normalizeEvent's docstring above).
  const summary = buildSummary(runId, events.map(normalizeEvent));

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
