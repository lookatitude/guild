/**
 * scripts/lib/run-events.ts
 *
 * ONE shared run-event reader for `.guild/runs/<run-id>/`.
 *
 * Audit: plugin-implementation-audit-2026-07-12 (GENERALIZE) — "Extract
 * recall-stats.ts's canonical-first/legacy-fallback event-log reader into a
 * shared lib helper and use it in shadow-mode.ts, trace-summarize.ts ... so
 * every consumer tracks the v1.4 log format uniformly."
 *
 * A run directory's event log has two possible physical locations:
 *   - CANONICAL: <runDir>/logs/v1.4-events.jsonl  (v1.4 log format — current)
 *   - LEGACY:    <runDir>/events.ndjson           (pre-v1.4 mirror; hooks/
 *                capture-telemetry.ts still writes this best-effort, labeled
 *                "LEGACY MIRROR ONLY" — its write is allowed to fail silently)
 *
 * `loadRunEvents(runDir)` resolves canonical-first / legacy-fallback (the same
 * precedence recall-stats.ts::readRecallDecisionEvents already implements —
 * see recall-stats.ts's own inline canonical/legacy pair, kept as-is there
 * since it also does a per-run handoff join this module does not need),
 * parses the JSONL, and returns every event alongside which source was used.
 *
 * The canonical file may interleave two physical event shapes:
 *   - a hook-mirror line:        {ts, event, tool, specialist, ok, ms, ...}
 *   - a guild.trace_event.v1 line: {schema_version, event_id, event_name, at, ...}
 *     (no `event` or `ts` field — see v1.4-log-validator.ts's EVENT_TYPES gap).
 * This module does NOT normalize between the two shapes; it returns raw
 * parsed objects (all fields optional) and leaves shape interpretation to the
 * caller. Both shadow-mode.ts and trace-summarize.ts already treat every
 * field defensively (undefined-safe), so a guild.trace_event.v1 line is
 * silently ignored by their event-shape-specific logic rather than crashing.
 *
 * READ-SIDE successor to scripts/lib/telemetry-redirect.ts (deleted — see
 * git history / the plugin-audit-remediation G9 lane report): that module's
 * DURABLE_CLASS_PRIMARY_PATHS["trace_events"] constant
 * ("runs/<run-id>/logs/v1.4-events.jsonl") is now CANONICAL_EVENTS_RELPATH
 * below. telemetry-redirect.ts's WRITE-side full-class worktree-redirect
 * table (every durable class, not just trace_events) had zero production
 * consumers and was deleted rather than wired — the sink-path constants for
 * OTHER durable classes (knowledge_graph, provenance, run_records, ...) and
 * the write side of trace_events remain separately hardcoded in
 * hooks/capture-telemetry.ts, hooks/lib/guild-trace-emit.ts, and
 * learn/lib/paths.ts (per the audit's GENERALIZE note); unifying THAT is
 * hooks-tier work and out of this module's scope.
 *
 * Pure I/O helper: reads only, never writes. No Date.now()/Math.random() in
 * any exported function (a CLI `if (require.main === module)` block may use
 * Date.now() for its own diagnostic timestamp).
 *
 * Usage (library):
 *   import { loadRunEvents } from "./lib/run-events";
 *   const { events, source, parseErrors } = loadRunEvents(runDir);
 *
 * Usage (CLI — diagnostics only):
 *   npx tsx scripts/lib/run-events.ts <runDir>
 */

import * as fs from "fs";
import * as path from "path";

// ── Event shape ──────────────────────────────────────────────────────────────

/**
 * A single parsed JSONL event. Every field is optional and unvalidated —
 * callers narrow to the fields their own shape needs (see file header: the
 * canonical file interleaves the hook-mirror shape and the guild.trace_event.v1
 * shape; this type is the union's superset).
 */
export interface RunEvent {
  ts?: string;
  event?: string;
  tool?: string;
  specialist?: string;
  prompt?: string;
  ok?: boolean;
  ms?: number;
  payload_digest?: string;
  run_id?: string;
  schema_version?: string;
  event_id?: string;
  event_name?: string;
  at?: string;
  [key: string]: unknown;
}

/** Which physical file backed a loadRunEvents() call. */
export type RunEventsSource = "canonical" | "legacy" | "none";

/** Result of loading a run directory's event log. */
export interface LoadRunEventsResult {
  /** Parsed events, in file order. Empty when neither file exists, or the file is empty. */
  events: RunEvent[];
  /** Which file was read. "none" when neither canonical nor legacy exists. */
  source: RunEventsSource;
  /** Absolute path of the file that was read (the canonical path when source is "none"). */
  filePath: string;
  /** Count of lines that failed JSON.parse and were skipped (never throws). */
  parseErrors: number;
}

// ── Canonical path constants ─────────────────────────────────────────────────

/** The canonical v1.4 event-log path, relative to a run directory. */
export const CANONICAL_EVENTS_RELPATH = path.join("logs", "v1.4-events.jsonl");

/** The legacy mirror event-log path, relative to a run directory. */
export const LEGACY_EVENTS_RELPATH = "events.ndjson";

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Resolve which physical event file backs `runDir`, canonical-first.
 * Never throws. Returns source "none" (with the canonical path, for a clear
 * caller-side error message) when neither file exists on disk.
 */
export function resolveRunEventsFile(
  runDir: string,
): { filePath: string; source: RunEventsSource } {
  const canonical = path.join(runDir, CANONICAL_EVENTS_RELPATH);
  const legacy = path.join(runDir, LEGACY_EVENTS_RELPATH);
  if (fs.existsSync(canonical)) return { filePath: canonical, source: "canonical" };
  if (fs.existsSync(legacy)) return { filePath: legacy, source: "legacy" };
  return { filePath: canonical, source: "none" };
}

// ── Parsing ───────────────────────────────────────────────────────────────────

/**
 * Parse a JSONL event file. Malformed lines are skipped and counted in
 * `parseErrors`; a missing or unreadable file returns an empty result
 * (never throws).
 */
export function parseRunEventsJsonl(
  filePath: string,
): { events: RunEvent[]; parseErrors: number } {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return { events: [], parseErrors: 0 };
  }

  const events: RunEvent[] = [];
  let parseErrors = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as RunEvent);
    } catch {
      parseErrors++;
    }
  }
  return { events, parseErrors };
}

// ── Public entrypoint ─────────────────────────────────────────────────────────

/**
 * Load every event for one run directory, canonical-first / legacy-fallback.
 * Never throws: a run dir with neither file present returns
 * `{ events: [], source: "none", parseErrors: 0 }`.
 *
 * @param runDir  Absolute (or cwd-relative) path to `.guild/runs/<run-id>/`.
 */
export function loadRunEvents(runDir: string): LoadRunEventsResult {
  const { filePath, source } = resolveRunEventsFile(runDir);
  if (source === "none") {
    return { events: [], source, filePath, parseErrors: 0 };
  }
  const { events, parseErrors } = parseRunEventsJsonl(filePath);
  return { events, source, filePath, parseErrors };
}

// ── CLI (diagnostics only; never called from lib consumers) ──────────────────

if (require.main === module) {
  const runDir = process.argv[2];
  if (!runDir) {
    process.stderr.write("Usage: npx tsx scripts/lib/run-events.ts <runDir>\n");
    process.exit(1);
  }
  const result = loadRunEvents(path.resolve(runDir));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.source === "none" ? 1 : 0);
}
