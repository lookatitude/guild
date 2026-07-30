#!/usr/bin/env -S npx tsx
/**
 * mcp-servers/guild-telemetry/src/index.ts
 *
 * Optional Guild MCP server — structured read/query over .guild/runs/.
 * See guild-plan.md §13.3.
 *
 * Tools:
 *   - trace_summary      { run_id }
 *       → { source: "file" | "synthesized", summary }
 *   - trace_query        { run_id?, event?, specialist?, since?, limit? }
 *       → { events: [...] }
 *   - trace_list_runs    { since?, limit? }
 *       → { runs: [{ run_id, event_count, started_at, ended_at }] }
 *   - trace_cost_rollup  { run_id?, since? }       (ADR-OBS-4)
 *       → { totals, by_tier, by_model, by_specialist }
 *
 * Run-artifact read order (ADR-OBS-4 — post telemetry-split):
 *   1. PRIMARY: <runDir>/logs/v1.4-events.jsonl  (the format the plugin records)
 *   2. FALLBACK: <runDir>/events.ndjson          (legacy pre-split runs)
 * The on-disk JSONL artifact is the contract; this server reads it by format
 * and imports no recorder code.
 *
 * CWD resolution (priority):
 *   1. Explicit per-tool `cwd` arg (wins — required for federated per-child
 *      cwd fan-out over a long-lived server)
 *   2. GUILD_TELEMETRY_CWD env var (tests, when no cwd arg is given)
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
import * as yaml from "js-yaml";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// ─── Types ───────────────────────────────────────────────────────────────

interface TraceTokens {
  input?: number;
  output?: number;
  cached?: number;
}

/**
 * Loose superset covering BOTH the legacy events.ndjson shape (ts/event/tool/
 * specialist/ok/ms) AND the v1.4 JSONL event shape (snake_case `event`, `tool`
 * with `status`/`latency_ms`, `hook_name`, plus the optional
 * guild.trace_event.v2 fields `tier`/`model`/`tokens`/`span_id`). Only `ts` and
 * `event` are guaranteed; all read paths tolerate missing fields. The index
 * signature lets unmapped v1.4 fields pass through unchanged for trace_query.
 */
interface TelemetryEvent {
  ts: string;
  event: string;
  tool?: string;
  specialist?: string;
  payload_digest?: string;
  ok?: boolean;
  ms?: number;
  prompt?: string;
  // v1.4 native fields
  status?: string;
  hook_name?: string;
  latency_ms?: number;
  duration_ms?: number;
  lane_id?: string;
  tokens_in?: number;
  tokens_out?: number;
  // guild.trace_event.v2 additive fields (D-OBS-1)
  tier?: string;
  model?: string;
  tokens?: TraceTokens;
  [key: string]: unknown;
}

// ─── CWD + runs dir ──────────────────────────────────────────────────────

/**
 * `--no-cwd-fallback` — set by a host whose launch cwd is NOT the consuming
 * project (see the identical guard in guild-memory for the full rationale).
 *
 * A Codex plugin install declares `cwd: "."` so Codex can resolve the server
 * path, which makes the launch cwd the PLUGIN payload root, and Codex passes a
 * scrubbed env with no workspace signal. Falling back to `process.cwd()` there
 * would read Guild's OWN bundled `.guild/runs` from the install cache — i.e.
 * report Guild's self-build runs as if they were the consumer's, which is a
 * data-scoping leak, not merely a wrong answer.
 *
 * Path inspection cannot separate that from a Guild developer working in the
 * checkout (identical shape, opposite intent), so the host declares it.
 */
const NO_CWD_FALLBACK = process.argv.includes("--no-cwd-fallback");

/** Flag-aware `cwd` description — REQUIRED when launched outside the project. */
const CWD_PARAM_DESCRIPTION = NO_CWD_FALLBACK
  ? "REQUIRED here — absolute path of the consuming project root. This server runs " +
    "outside the project and has no default; calls without it fail."
  : "Override consuming-repo root (defaults to the server's working directory).";

/** Thrown when no project root can be determined and guessing would be wrong. */
export class UnresolvedProjectRootError extends Error {
  constructor() {
    super(
      "guild-telemetry: no project root available. This host launches the MCP server " +
        "outside the consuming project (--no-cwd-fallback), so the working directory " +
        "cannot be used. Pass `cwd` with the absolute path of the project root on the " +
        "tool call, or set GUILD_TELEMETRY_CWD to the project root."
    );
    this.name = "UnresolvedProjectRootError";
  }
}

/** Thrown when a root arrives but is RELATIVE, which would resolve to the payload. */
export class RelativeProjectRootError extends Error {
  constructor(source: string, value: string) {
    super(
      `guild-telemetry: ${source} must be an ABSOLUTE path here (got "${value}"). This server runs ` +
        "outside the consuming project, so a relative path would resolve against the plugin " +
        "payload and return the plugin's own data. Pass the absolute project root."
    );
    this.name = "RelativeProjectRootError";
  }
}

/** Thrown when a root points AT (or inside) this server's own payload tree. */
export class PayloadScopedRootError extends Error {
  constructor(source: string, value: string) {
    super(
      `guild-telemetry: ${source} resolves inside this server's own plugin payload ("${value}"). ` +
        "That would return the plugin's bundled data instead of the consuming project's. " +
        "Pass the absolute root of the project you are working in."
    );
    this.name = "PayloadScopedRootError";
  }
}

/**
 * The payload tree this server was launched from, canonicalized once.
 * Only meaningful in flagged mode, where cwd IS the plugin payload.
 */
const PAYLOAD_ROOT: string | null = NO_CWD_FALLBACK ? realpathOrSelf(process.cwd()) : null;

function realpathOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Reject a root that is the payload itself, lives beneath it, or reaches it
 * through a symlink. `path.isAbsolute` alone is not enough: an absolute path
 * naming the payload (directly or via a link) still returned the plugin's own
 * wiki/runs (gate r5, reproduced live against the shipped bundles).
 */
function assertNotPayloadScoped(candidate: string, source: string): void {
  if (PAYLOAD_ROOT === null) return;
  const real = realpathOrSelf(candidate);
  if (real === PAYLOAD_ROOT || real.startsWith(PAYLOAD_ROOT + path.sep)) {
    throw new PayloadScopedRootError(source, candidate);
  }
}

function resolveCwd(cwdArg?: string): string {
  if (cwdArg) {
    // See guild-memory: a relative root resolves against the plugin payload in
    // flagged mode, which is the leak wearing a different hat.
    if (NO_CWD_FALLBACK && !path.isAbsolute(cwdArg)) {
      throw new RelativeProjectRootError("cwd", cwdArg);
    }
    assertNotPayloadScoped(cwdArg, "cwd");
    return path.resolve(cwdArg);
  }
  const envRoot = process.env.GUILD_TELEMETRY_CWD;
  if (envRoot) {
    if (NO_CWD_FALLBACK && !path.isAbsolute(envRoot)) {
      throw new RelativeProjectRootError("GUILD_TELEMETRY_CWD", envRoot);
    }
    assertNotPayloadScoped(envRoot, "GUILD_TELEMETRY_CWD");
    return path.resolve(envRoot);
  }
  if (NO_CWD_FALLBACK) {
    throw new UnresolvedProjectRootError();
  }
  return process.cwd();
}

function runsDir(cwd: string): string {
  return path.join(cwd, ".guild", "runs");
}

/**
 * ADR-OBS-4 read order: prefer the recorded v1.4 live log; fall back to the
 * legacy events.ndjson for pre-split runs. Returns null when neither exists.
 */
function eventsFilePath(runDir: string): string | null {
  const v14 = path.join(runDir, "logs", "v1.4-events.jsonl");
  if (fs.existsSync(v14)) return v14;
  const legacy = path.join(runDir, "events.ndjson");
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

/**
 * Additive normalization: maps v1.4 native fields onto the internal accessor
 * shape WITHOUT overwriting any field already present. Legacy events.ndjson
 * rows already carry tool/specialist/ok/ms, so this is a no-op for them; v1.4
 * rows gain `tool` (from hook_name), `ok` (from status), and `ms` (from
 * latency_ms/duration_ms) so the summary/query paths work unchanged.
 *
 * status "n/a" means "not applicable" — neither a success nor a failure (e.g.
 * a tool_call whose result isn't measured pass/fail). It is intentionally
 * left OUT of the tool/status -> ok mapping so `e.ok` stays `undefined`
 * rather than `false`; computeStats excludes ok-undefined events from the
 * ok_rate denominator so an "n/a" status never deflates ok_rate as an error.
 */
function normalizeEvent(raw: Record<string, unknown>): TelemetryEvent {
  const e = { ...raw } as TelemetryEvent;
  if (e.tool === undefined && e.event === "hook_event" && typeof e.hook_name === "string") {
    e.tool = e.hook_name;
  }
  if (e.ok === undefined && typeof e.status === "string" && e.status !== "n/a") {
    e.ok = e.status === "ok";
  }
  if (e.ms === undefined) {
    if (typeof e.latency_ms === "number") e.ms = e.latency_ms;
    else if (typeof e.duration_ms === "number") e.ms = e.duration_ms;
  }
  return e;
}

function readEvents(runDir: string): TelemetryEvent[] {
  const file = eventsFilePath(runDir);
  if (!file) return [];
  const content = fs.readFileSync(file, "utf8");
  const events: TelemetryEvent[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(normalizeEvent(JSON.parse(t) as Record<string, unknown>));
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
  // rf-wi-02: at PARITY with scripts/trace-summarize.ts — a pane run's dispatch
  // signal. Each pane is a separate host session whose tool calls never land in
  // this log, so the dispatch receipt is the only lane signal.
  //   dispatchCounts        — DISTINCT lanes per surface (retry must not inflate).
  //   dispatchReceiptCounts — raw receipt lines per surface (retry stays visible).
  dispatchCounts: { backend: string; count: number }[];
  dispatchReceiptCounts: { backend: string; count: number }[];
  filesTouchedCount: number;
  errors: number;
  okRate: number;
}

// ── Dispatch predicates (mirror scripts/trace-summarize.ts) ────────────────

/** A dispatch receipt (guild.trace.dispatch.v1), whatever backend produced it. */
function isDispatchEvent(e: TelemetryEvent): boolean {
  return e.schema_version === "guild.trace.dispatch.v1";
}

/**
 * A CONFIRMED dispatch: the lane actually reached a backend. A bare
 * `backend: "unknown"` receipt is pre-routing INTENT (write-task-run.ts emits one
 * per task before any routing decision) and is excluded — mixing the two would
 * report `[tmux: 3, unknown: 5]` for a three-lane run. A cmux surface rides
 * `backend: "unknown"` and identifies itself in `pane_backend`.
 */
function isConfirmedDispatch(e: TelemetryEvent): boolean {
  if (!isDispatchEvent(e)) return false;
  if (typeof e.pane_backend === "string" && e.pane_backend !== "") return true;
  return typeof e.backend === "string" && e.backend !== "" && e.backend !== "unknown";
}

/** The surface to report a dispatch under: concrete `pane_backend` else `backend`. */
function dispatchSurface(e: TelemetryEvent): string {
  if (typeof e.pane_backend === "string" && e.pane_backend) return e.pane_backend;
  return e.backend as string;
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

  // rf-wi-02: CONFIRMED dispatches grouped by surface, sorted count-desc then
  // alpha (same ordering + semantics as scripts/trace-summarize.ts). Both numbers
  // are reported — dispatched_lanes counts DISTINCT lanes (task_id, else
  // specialist) so a retry never inflates it; dispatch_receipts counts raw
  // receipt lines so retry volume stays visible.
  const dispatchLanes = new Map<string, Set<string>>();
  const receiptMap = new Map<string, number>();
  for (const e of events) {
    if (!isConfirmedDispatch(e)) continue;
    const surface = dispatchSurface(e);
    receiptMap.set(surface, (receiptMap.get(surface) ?? 0) + 1);
    const lane =
      (typeof e.task_id === "string" && e.task_id) ||
      (typeof e.specialist === "string" && e.specialist) ||
      "";
    if (!lane) continue;
    if (!dispatchLanes.has(surface)) dispatchLanes.set(surface, new Set());
    dispatchLanes.get(surface)!.add(lane);
  }
  const bySurface = (
    a: { backend: string; count: number },
    b: { backend: string; count: number }
  ) => b.count - a.count || a.backend.localeCompare(b.backend);
  const dispatchCounts = Array.from(dispatchLanes.entries())
    .map(([backend, lanes]) => ({ backend, count: lanes.size }))
    .sort(bySurface);
  const dispatchReceiptCounts = Array.from(receiptMap.entries())
    .map(([backend, count]) => ({ backend, count }))
    .sort(bySurface);

  const filesTouchedCount = events.filter(
    (e) => e.tool === "Write" || e.tool === "Edit"
  ).length;
  // ok_rate is scoped to events with a defined ok/error verdict — status
  // "n/a" (neither ok nor error, see normalizeEvent) leaves `ok` undefined
  // and must not count in either the numerator or the denominator.
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
    dispatchCounts,
    dispatchReceiptCounts,
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

  // rf-wi-02: parity with scripts/trace-summarize.ts's frontmatter — a pane run's
  // dispatch signal, answerable from the frontmatter alone even though no pane
  // tool call reached this log.
  const surfaceLine = (rows: { backend: string; count: number }[]): string =>
    rows.length > 0
      ? rows.map(({ backend, count }) => `${backend}: ${count}`).join(", ")
      : "(none)";

  const frontmatter = [
    "---",
    `run_id: ${stats.runId}`,
    `started_at: ${stats.startedAt || "(none)"}`,
    `ended_at: ${stats.endedAt || "(none)"}`,
    `duration_ms: ${stats.durationMs}`,
    `event_count: ${stats.eventCount}`,
    `specialists_dispatched: [${specialistsLine}]`,
    `dispatched_lanes: [${surfaceLine(stats.dispatchCounts)}]`,
    `dispatch_receipts: [${surfaceLine(stats.dispatchReceiptCounts)}]`,
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

// ─── Cost rollup (ADR-OBS-4) ───────────────────────────────────────────────

interface TokenTotals {
  input: number;
  output: number;
  cached: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Extract token usage from one event, merging BOTH token sources:
 *   - the guild.trace_event.v2 `tokens` object ({input,output,cached})
 *   - the v1.4 tool_call `tokens_in` / `tokens_out` scalars
 */
function eventTokens(e: TelemetryEvent): TokenTotals {
  let input = 0;
  let output = 0;
  let cached = 0;
  if (e.tokens && typeof e.tokens === "object") {
    input += num(e.tokens.input);
    output += num(e.tokens.output);
    cached += num(e.tokens.cached);
  }
  input += num(e.tokens_in);
  output += num(e.tokens_out);
  return { input, output, cached };
}

function hasTokens(t: TokenTotals): boolean {
  return t.input > 0 || t.output > 0 || t.cached > 0;
}

function addTokens(into: TokenTotals, t: TokenTotals): void {
  into.input += t.input;
  into.output += t.output;
  into.cached += t.cached;
}

function bucketAdd(
  m: Map<string, TokenTotals>,
  key: string,
  t: TokenTotals
): void {
  const cur = m.get(key) ?? { input: 0, output: 0, cached: 0 };
  addTokens(cur, t);
  m.set(key, cur);
}

/** Group key → { input, output, cached, total }, sorted by total desc then key. */
function rollupRows(
  m: Map<string, TokenTotals>,
  keyName: string
): Record<string, string | number>[] {
  return Array.from(m.entries())
    .map(([key, t]) => ({
      [keyName]: key,
      input: t.input,
      output: t.output,
      cached: t.cached,
      total: t.input + t.output,
    }))
    .sort(
      (a, b) =>
        (b.total as number) - (a.total as number) ||
        String(a[keyName]).localeCompare(String(b[keyName]))
    );
}

function specialistKey(e: TelemetryEvent): string {
  if (typeof e.specialist === "string" && e.specialist) return e.specialist;
  if (typeof e.lane_id === "string" && e.lane_id) return e.lane_id;
  return "(none)";
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

/**
 * rf-wi-02 (codex r3/r4 finding 2): does a stored summary.md carry BOTH dispatch
 * parity fields as top-level FRONTMATTER KEYS? The frontmatter block (between the
 * leading `---` and the next `---`) is parsed as YAML and checked for both keys
 * as OWN top-level properties. A line-start substring scan was bypassable by a
 * YAML multiline scalar that embeds the key names inside another value (e.g. a
 * `description:` block), so the check must understand YAML structure, not text.
 * A summary without a frontmatter block, or one that does not parse to an object,
 * returns false (→ synthesize).
 */
function summaryHasDispatchFrontmatter(summary: string): boolean {
  // The block is delimited by an opening `---` line and a closing `---` line —
  // BOTH exact (a `---not-a-delimiter` line does not close it). Anything else is
  // not a valid frontmatter block → synthesize.
  const lines = summary.split("\n");
  if (lines[0] !== "---") return false;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end < 0) return false;
  const fm = lines.slice(1, end).join("\n");
  let parsed: unknown;
  try {
    parsed = yaml.load(fm);
  } catch {
    return false; // unparseable frontmatter — cannot trust it carries the fields
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const o = parsed as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(o, "dispatched_lanes") &&
    Object.prototype.hasOwnProperty.call(o, "dispatch_receipts")
  );
}

// ─── MCP server ──────────────────────────────────────────────────────────

function buildServer(): McpServer {
  const server = new McpServer(
    { name: "guild-telemetry", version: "0.1.0" },
    {
      instructions: NO_CWD_FALLBACK
        ? "Read-only structured query over .guild/runs/. IMPORTANT: this server was " +
          "launched OUTSIDE the consuming project, so it has no default root. You MUST " +
          "pass `cwd` (absolute path of the project root) on EVERY tool call, or set " +
          "GUILD_TELEMETRY_CWD. Calls without it fail. Use trace_list_runs first to " +
          "discover run ids, then trace_summary, trace_query, or trace_cost_rollup."
        : "Read-only structured query over .guild/runs/. Reads each run's " +
          "logs/v1.4-events.jsonl (falls back to legacy events.ndjson). Use " +
          "trace_list_runs first to discover run ids, then trace_summary, " +
          "trace_query, or trace_cost_rollup (token usage by tier/model/specialist). " +
          "Pass `cwd` to override the consuming repo root per-tool.",
    }
  );

  // ─── trace_summary ────────────────────────────────────────────────
  server.registerTool(
    "trace_summary",
    {
      title: "Summarize a Guild run",
      description:
        "Return the stored summary.md for a run if present, otherwise " +
        "synthesize one from logs/v1.4-events.jsonl (falling back to legacy " +
        "events.ndjson) using the same logic as scripts/trace-summarize.ts. " +
        "Does not write anything.",
      inputSchema: {
        run_id: z.string().min(1).describe("The run identifier"),
        cwd: z.string().optional().describe(CWD_PARAM_DESCRIPTION),
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
        // rf-wi-02: PARITY guard (codex r2/r3 finding 2). A stored summary.md is
        // returned verbatim ONLY when its FRONTMATTER carries both dispatch-parity
        // keys — i.e. it was produced by the current scripts/trace-summarize.ts
        // (which always emits both, `[(none)]` when empty). A STALE summary
        // (pre-parity) or a degraded STUB (hooks/maybe-reflect.ts writeStubSummary,
        // written only when the real summarizer failed) lacks them; returning it
        // verbatim would break the parity contract, so fall through to synthesize
        // from the event log instead.
        if (summaryHasDispatchFrontmatter(summary)) {
          return jsonResult({ run_id, source: "file", summary });
        }
      }
      const events = readEvents(runDir);
      if (events.length === 0) {
        // No event log to synthesize from. If a (field-less) summary.md exists,
        // returning it is still better than an error — it is all we have.
        if (fs.existsSync(existing)) {
          return jsonResult({ run_id, source: "file", summary: fs.readFileSync(existing, "utf8") });
        }
        return errorResult(
          `No logs/v1.4-events.jsonl or events.ndjson found for run: ${run_id}`
        );
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
        cwd: z.string().optional().describe(CWD_PARAM_DESCRIPTION),
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
        cwd: z.string().optional().describe(CWD_PARAM_DESCRIPTION),
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

  // ─── trace_cost_rollup (ADR-OBS-4) ────────────────────────────────
  server.registerTool(
    "trace_cost_rollup",
    {
      title: "Roll up token cost across Guild runs",
      description:
        "Aggregate guild.trace_event.v2 token usage (input/output/cached) " +
        "across recorded events, broken down by tier, model, and specialist. " +
        "Merges the v2 `tokens` object and the v1.4 tool_call tokens_in/out " +
        "scalars. Reads logs/v1.4-events.jsonl (falls back to events.ndjson). " +
        "Read-only; deterministic sort (total desc, then key).",
      inputSchema: {
        run_id: z
          .string()
          .optional()
          .describe("Restrict to one run; omit to roll up across all runs"),
        since: z
          .string()
          .optional()
          .describe("ISO date/time; keep events on/after this timestamp"),
        cwd: z.string().optional().describe(CWD_PARAM_DESCRIPTION),
      },
    },
    async ({ run_id, since, cwd }) => {
      const base = resolveCwd(cwd);
      const runIds = run_id ? [run_id] : listRunIds(base);
      const cutoff = since ? new Date(since).getTime() : null;

      const totals: TokenTotals = { input: 0, output: 0, cached: 0 };
      const byTier = new Map<string, TokenTotals>();
      const byModel = new Map<string, TokenTotals>();
      const bySpecialist = new Map<string, TokenTotals>();
      let eventCount = 0;
      let llmEventCount = 0;

      for (const rid of runIds) {
        const runDir = path.join(runsDir(base), rid);
        if (!fs.existsSync(runDir)) {
          if (run_id) return errorResult(`Run not found: ${rid}`);
          continue;
        }
        for (const e of readEvents(runDir)) {
          if (cutoff !== null) {
            const t = new Date(e.ts).getTime();
            if (Number.isNaN(t) || t < cutoff) continue;
          }
          eventCount++;
          const tk = eventTokens(e);
          if (!hasTokens(tk)) continue;
          llmEventCount++;
          addTokens(totals, tk);
          bucketAdd(byTier, typeof e.tier === "string" && e.tier ? e.tier : "(none)", tk);
          bucketAdd(byModel, typeof e.model === "string" && e.model ? e.model : "(none)", tk);
          bucketAdd(bySpecialist, specialistKey(e), tk);
        }
      }

      return jsonResult({
        run_id: run_id ?? null,
        scope: run_id ? `run:${run_id}` : "all-runs",
        event_count: eventCount,
        llm_event_count: llmEventCount,
        totals: {
          input: totals.input,
          output: totals.output,
          cached: totals.cached,
          total: totals.input + totals.output,
        },
        by_tier: rollupRows(byTier, "tier"),
        by_model: rollupRows(byModel, "model"),
        by_specialist: rollupRows(bySpecialist, "specialist"),
      });
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
