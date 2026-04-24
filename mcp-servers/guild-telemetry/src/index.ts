#!/usr/bin/env -S npx tsx
/**
 * mcp-servers/guild-telemetry/src/index.ts
 *
 * Optional Guild MCP server — structured read/query over .guild/runs/.
 * See guild-plan.md §13.3.
 *
 * Tools:
 *   - trace_summary   { run_id }
 *       → { source: "file" | "synthesized", summary }
 *   - trace_query     { run_id?, event?, specialist?, since?, limit? }
 *       → { events: [...] }
 *   - trace_list_runs { since?, limit? }
 *       → { runs: [{ run_id, event_count, started_at, ended_at }] }
 *
 * CWD resolution (priority):
 *   1. GUILD_TELEMETRY_CWD env var (tests)
 *   2. per-tool `cwd` arg
 *   3. process.cwd()
 *
 * Invariants:
 *   - Read-only. Source intentionally imports no fs-write APIs. Scope per §13.3.
 *   - Deterministic output — stable sort on runs and events.
 *
 * Summarization logic mirrors scripts/trace-summarize.ts but is reimplemented
 * inline so this MCP has no cross-package runtime dep.
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ─── Types ───────────────────────────────────────────────────────────────

interface TelemetryEvent {
  ts: string;
  event: string;
  tool: string;
  specialist: string;
  payload_digest: string;
  ok: boolean;
  ms: number;
  prompt?: string;
}

// ─── CWD + runs dir ──────────────────────────────────────────────────────

function resolveCwd(cwdArg?: string): string {
  if (process.env.GUILD_TELEMETRY_CWD) {
    return path.resolve(process.env.GUILD_TELEMETRY_CWD);
  }
  return cwdArg ? path.resolve(cwdArg) : process.cwd();
}

function runsDir(cwd: string): string {
  return path.join(cwd, ".guild", "runs");
}

function readEvents(runDir: string): TelemetryEvent[] {
  const file = path.join(runDir, "events.ndjson");
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf8");
  const events: TelemetryEvent[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(JSON.parse(t) as TelemetryEvent);
    } catch {
      // skip malformed lines; stay consistent with scripts/trace-summarize.ts
    }
  }
  return events;
}

function listRunIds(cwd: string): string[] {
  const root = runsDir(cwd);
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// ─── Summarization (mirrors scripts/trace-summarize.ts) ─────────────────

interface RunStats {
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  eventCount: number;
  specialists: string[];
  toolCounts: { tool: string; count: number }[];
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
  const durationMs =
    new Date(endedAt).getTime() - new Date(startedAt).getTime();

  const specialists = Array.from(
    new Set(events.map((e) => e.specialist).filter(Boolean))
  ).sort();

  const toolMap = new Map<string, number>();
  for (const e of events) {
    if (!e.tool) continue;
    toolMap.set(e.tool, (toolMap.get(e.tool) ?? 0) + 1);
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

function buildSummary(runId: string, events: TelemetryEvent[]): string {
  const stats = computeStats(runId, events);
  const toolsLine =
    stats.toolCounts.length > 0
      ? stats.toolCounts.map(({ tool, count }) => `${tool}: ${count}`).join(", ")
      : "(none)";
  const specialistsLine =
    stats.specialists.length > 0 ? stats.specialists.join(", ") : "(none)";

  const frontmatter = [
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

  const timeline =
    events.length === 0
      ? "No events recorded."
      : events
          .map((e) => {
            const ts = e.ts;
            if (e.event === "SubagentStop") {
              const spec = e.specialist || "(main session)";
              return `- \`${ts}\` — specialist **${spec}** completed (${e.ms}ms)`;
            }
            if (e.tool) {
              const spec = e.specialist ? ` [${e.specialist}]` : "";
              const status = e.ok ? "" : " ERROR";
              return `- \`${ts}\` — ${e.tool}${spec}${status} (${e.ms}ms)`;
            }
            return `- \`${ts}\` — ${e.event}`;
          })
          .join("\n");

  return [
    frontmatter,
    "",
    `# Run ${runId} summary`,
    "",
    "## Timeline",
    "",
    timeline,
    "",
    "## Stats",
    "",
    `- Specialists: ${specialistsLine}`,
    `- Tools used: ${toolsLine}`,
    `- Files touched (Write/Edit): ${stats.filesTouchedCount}`,
    `- Errors: ${stats.errors}`,
    `- ok_rate: ${stats.okRate}`,
    "",
  ].join("\n");
}

// ─── MCP result helpers ──────────────────────────────────────────────────

function jsonResult(value: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(message: string): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

// ─── MCP server ──────────────────────────────────────────────────────────

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "guild-telemetry", version: "0.1.0" },
    {
      instructions:
        "Read-only structured query over .guild/runs/. Use trace_list_runs " +
        "first to discover run ids, then trace_summary or trace_query.",
    }
  );

  // ─── trace_summary ────────────────────────────────────────────────
  server.registerTool(
    "trace_summary",
    {
      title: "Summarize a Guild run",
      description:
        "Return the stored summary.md for a run if present, otherwise " +
        "synthesize one from events.ndjson using the same logic as " +
        "scripts/trace-summarize.ts. Does not write anything.",
      inputSchema: {
        run_id: z.string().min(1).describe("The run identifier"),
        cwd: z.string().optional().describe("Override consuming-repo root"),
      },
    },
    async ({ run_id, cwd }) => {
      const base = resolveCwd(cwd);
      const runDir = path.join(runsDir(base), run_id);
      if (!fs.existsSync(runDir)) {
        return errorResult(`Run not found: ${run_id}`);
      }
      const existing = path.join(runDir, "summary.md");
      if (fs.existsSync(existing)) {
        const summary = fs.readFileSync(existing, "utf8");
        return jsonResult({ run_id, source: "file", summary });
      }
      const events = readEvents(runDir);
      if (events.length === 0) {
        return errorResult(`No events.ndjson found for run: ${run_id}`);
      }
      const summary = buildSummary(run_id, events);
      return jsonResult({ run_id, source: "synthesized", summary });
    }
  );

  // ─── trace_query ──────────────────────────────────────────────────
  server.registerTool(
    "trace_query",
    {
      title: "Query Guild run events",
      description:
        "Filter telemetry events across runs by run_id, event type, " +
        "specialist, or ISO-date `since` cutoff. Returns events annotated " +
        "with their run_id. Deterministic sort: run_id then ts.",
      inputSchema: {
        run_id: z.string().optional().describe("Restrict to one run"),
        event: z
          .string()
          .optional()
          .describe("Filter by event type (e.g. 'PostToolUse')"),
        specialist: z
          .string()
          .optional()
          .describe("Filter by specialist name"),
        since: z
          .string()
          .optional()
          .describe("ISO date/time; keep events on/after this timestamp"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .optional()
          .describe("Max number of events returned"),
        cwd: z.string().optional().describe("Override consuming-repo root"),
      },
    },
    async ({ run_id, event, specialist, since, limit, cwd }) => {
      const base = resolveCwd(cwd);
      const runIds = run_id ? [run_id] : listRunIds(base);
      const cutoff = since ? new Date(since).getTime() : null;

      const all: (TelemetryEvent & { run_id: string })[] = [];
      for (const rid of runIds) {
        const runDir = path.join(runsDir(base), rid);
        if (!fs.existsSync(runDir)) {
          if (run_id) return errorResult(`Run not found: ${rid}`);
          continue;
        }
        for (const e of readEvents(runDir)) {
          all.push({ ...e, run_id: rid });
        }
      }

      const filtered = all.filter((e) => {
        if (event && e.event !== event) return false;
        if (specialist && e.specialist !== specialist) return false;
        if (cutoff !== null) {
          const t = new Date(e.ts).getTime();
          if (Number.isNaN(t) || t < cutoff) return false;
        }
        return true;
      });

      filtered.sort(
        (a, b) =>
          a.run_id.localeCompare(b.run_id) ||
          a.ts.localeCompare(b.ts)
      );

      const trimmed = typeof limit === "number" ? filtered.slice(0, limit) : filtered;
      return jsonResult({ events: trimmed, total: filtered.length });
    }
  );

  // ─── trace_list_runs ──────────────────────────────────────────────
  server.registerTool(
    "trace_list_runs",
    {
      title: "List Guild runs",
      description:
        "List known runs under .guild/runs/ with event count + date range. " +
        "Filter by `since` (ISO date) to narrow to recent runs.",
      inputSchema: {
        since: z
          .string()
          .optional()
          .describe(
            "ISO date/time; keep runs whose ended_at (or started_at if no events) is on/after this"
          ),
        limit: z.number().int().min(1).max(1000).optional().describe("Max runs"),
        cwd: z.string().optional().describe("Override consuming-repo root"),
      },
    },
    async ({ since, limit, cwd }) => {
      const base = resolveCwd(cwd);
      const ids = listRunIds(base);
      const cutoff = since ? new Date(since).getTime() : null;

      const runs = ids
        .map((rid) => {
          const events = readEvents(path.join(runsDir(base), rid));
          const started = events[0]?.ts ?? "";
          const ended = events[events.length - 1]?.ts ?? "";
          return {
            run_id: rid,
            event_count: events.length,
            started_at: started,
            ended_at: ended,
          };
        })
        .filter((r) => {
          if (cutoff === null) return true;
          const ref = r.ended_at || r.started_at;
          if (!ref) return false;
          const t = new Date(ref).getTime();
          return !Number.isNaN(t) && t >= cutoff;
        })
        .sort((a, b) => a.run_id.localeCompare(b.run_id));

      const trimmed = typeof limit === "number" ? runs.slice(0, limit) : runs;
      return jsonResult({ runs: trimmed, total: runs.length });
    }
  );

  return server;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[guild-telemetry] ready\n");
}

main().catch((err) => {
  process.stderr.write(`[guild-telemetry] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
