/**
 * scripts/lib/guild-trace-emit.ts
 *
 * R-TRACE (Wave 6 observability) — lightweight emit wrapper.
 *
 * Writes guild.trace.*.v1 events to the run's v1.4 JSONL log. This module
 * is the ONLY place that performs I/O for trace events. All validators and
 * factories in guild-trace-events.ts are pure (no I/O).
 *
 * BEHAVIOR-NEUTRAL contract:
 * - emitTraceEvent() NEVER throws. It wraps all I/O in try/catch.
 * - A trace failure is silently swallowed (stderr warning only) so a broken
 *   trace path can NEVER affect the real call path.
 * - The emit is ADDITIVE: callers emit AFTER their core logic completes,
 *   using the result already computed. The trace event carries measured
 *   data; it does not influence the result.
 * - No imports from hooks/ — this module is scripts/lib, not hooks/lib.
 *   It writes to the log path directly using the same path convention as
 *   log-jsonl-writer.ts (liveLogPath), without requiring a full writer import.
 *
 * Emit path:
 *   <runDir>/logs/v1.4-events.jsonl  (POSIX append, O_APPEND)
 *
 * If runDir is not available (e.g. recall called outside a run context),
 * the event is silently dropped — never an error.
 *
 * Usage:
 *   import { emitTraceEvent } from './guild-trace-emit';
 *   // After recall() completes:
 *   emitTraceEvent(makeRecallEvent({ ... }), runDir);
 *
 * Owned by: tooling-engineer (scripts/ scope per AGENTS.md)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { GuildTraceEvent } from "./guild-trace-events";
import { validateGuildTraceEvent } from "./guild-trace-events";

/**
 * Live log path — must match liveLogPath() in hooks/lib/v1.4/log-jsonl-writer.ts.
 * Kept in sync by convention (same `logs/v1.4-events.jsonl` suffix).
 */
function liveLogPath(runDir: string): string {
  return path.join(runDir, "logs", "v1.4-events.jsonl");
}

/**
 * Emit a guild.trace.*.v1 event to the run's live log.
 *
 * Behavior-neutral: returns void, never throws, never affects the caller's
 * return value. All I/O errors are caught and written to stderr only.
 *
 * @param event   A GuildTraceEvent (built by a make*Event factory).
 * @param runDir  Absolute path to the run directory (e.g. .guild/runs/run-xxx).
 *                Pass undefined/null to silently skip emission.
 */
export function emitTraceEvent(
  event: GuildTraceEvent,
  runDir: string | null | undefined,
): void {
  // Guard: no runDir → skip silently.
  if (!runDir) return;

  // Validate before writing — a malformed event must never land in the log.
  const validationResult = validateGuildTraceEvent(event);
  if (!validationResult.ok) {
    const schemaVersion = (event as unknown as Record<string, unknown>)["schema_version"];
    // `validationResult` is narrowed to `{ ok: false; reason: string }` in this branch
    // but ts-jest with a stricter tsconfig may not narrow through the external module.
    // Use type assertion to be explicit.
    const failResult = validationResult as { ok: false; reason: string };
    process.stderr.write(
      `[guild-trace-emit] WARN: dropping invalid trace event (${schemaVersion}): ${failResult.reason}\n`,
    );
    return;
  }

  try {
    const live = liveLogPath(runDir);
    const dir = path.dirname(live);

    // Ensure logs/ exists — mkdirSync with recursive is idempotent.
    fs.mkdirSync(dir, { recursive: true });

    // Append O_APPEND line. JSON.stringify is deterministic for plain objects.
    const line = JSON.stringify(event) + "\n";

    // O_APPEND write — atomic on POSIX for writes < PIPE_BUF (~4 KiB).
    // Trace events are small (<1 KiB) so this is safe without an explicit lock.
    // For writes above PIPE_BUF, appendFileSync uses multiple syscalls and can
    // interleave — acceptable for advisory trace events (never run data).
    fs.appendFileSync(live, line, "utf8");
  } catch (err) {
    // Trace failures must never surface to callers.
    process.stderr.write(
      `[guild-trace-emit] WARN: could not write trace event to ${runDir}/logs/v1.4-events.jsonl: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}
