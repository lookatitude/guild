/**
 * scripts/lib/emit-remote-orphan.ts
 *
 * rf-wi-04 (G4) item 2 — durable observability for an ORPHANED remote lane.
 *
 * When RemoteTeamBackend.launch() rolls back a partial dispatch and its teardown
 * cannot CONFIRM every remote pane killed, the surviving pane is an orphan: a
 * live remote lane no receipt describes. The backend surfaces it in its returned
 * envelope (remoteTeardown / notes) AND calls its injectable `warn` sink at
 * detection time — because the production caller (agent-team-launcher.ts) wraps
 * launch() in bounded retry (retry-lane.ts) and a LATER successful attempt
 * DISCARDS the earlier failed attempt's envelope. A stderr-only warning would
 * then be the only trace, and if stderr is not externally captured the orphan
 * evidence is lost (rf-wi-04 codex review, round 2/3 High).
 *
 * This emitter is the durable sink the launcher wires into that `warn` seam:
 *   1. A stderr warning (immediately visible in CI / terminal).
 *   2. A full-detail NDJSON record appended to a DEDICATED run-scoped sink
 *      `.guild/runs/<run-id>/logs/remote-orphans.jsonl`. This is deliberately
 *      NOT the canonical `v1.4-events.jsonl`: that log accepts only wrapped v1.4
 *      events / hook-mirror events / `guild.trace.*.v1` records, so a custom
 *      `guild.degradation_event.v1` line there would be flagged invalid by the
 *      v1.4 log validator (rf-wi-04 codex review, round 4). The dedicated sink
 *      keeps the canonical log valid while preserving the actionable orphan
 *      identity (lane, endpoint, remoteId, teardown detail).
 *   3. A VALID `guild.trace.degradation.v1` event into the canonical log, whose
 *      `reason` carries the same actionable orphan message so telemetry over the
 *      canonical log is also actionable — not generic (best-effort).
 *
 * NEVER throws — orphan observability must not cascade into a harder failure.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { emitTraceEvent } from "./guild-trace-emit";
import { makeDegradationEvent } from "./guild-trace-events";

/** Schema version for the orphan event record. */
export const REMOTE_ORPHAN_SCHEMA = "guild.degradation_event.v1" as const;

/** Event name written into the NDJSON record + stderr message. */
export const REMOTE_ORPHAN_EVENT = "remote_lane_orphaned" as const;

/** Dedicated run-scoped sink for the full-detail orphan record (relative to runDir). */
export const REMOTE_ORPHAN_SINK_RELPATH = "logs/remote-orphans.jsonl" as const;

/** The NDJSON record shape appended to the dedicated remote-orphans sink. */
export interface RemoteOrphanRecord {
  schema_version: typeof REMOTE_ORPHAN_SCHEMA;
  event_name: typeof REMOTE_ORPHAN_EVENT;
  run_id: string;
  message: string;
  at: string;
}

/**
 * Emit the orphaned-remote-lane signal: stderr warning + durable NDJSON events
 * log record + trace degradation event. Wired into
 * `new RemoteTeamBackend({ warn })` by the launcher.
 *
 * @param cwd     The repo root (`.guild/runs/` is relative to this).
 * @param runId   The current run id (path segment under `.guild/runs/`).
 * @param message The orphan detail the backend produced (already includes lane/endpoint).
 * @param out     Optional stderr-write override (for testing). Defaults to `process.stderr.write`.
 */
export function emitRemoteOrphan(
  cwd: string,
  runId: string,
  message: string,
  out: (msg: string) => void = (msg) => process.stderr.write(msg),
): void {
  const at = new Date().toISOString();

  // 1. Stderr warning — always visible (terminal, CI log).
  try {
    out(`${message}\n`);
  } catch {
    /* never throw from the observer */
  }

  // 2. Full-detail NDJSON record in the DEDICATED remote-orphans sink (NOT the
  //    canonical v1.4 log — a custom schema there would fail the v1.4 validator).
  const runDir = path.join(cwd, ".guild", "runs", runId);
  try {
    const sink = path.join(runDir, REMOTE_ORPHAN_SINK_RELPATH);
    fs.mkdirSync(path.dirname(sink), { recursive: true });
    const record: RemoteOrphanRecord = {
      schema_version: REMOTE_ORPHAN_SCHEMA,
      event_name: REMOTE_ORPHAN_EVENT,
      run_id: runId,
      message,
      at,
    };
    fs.appendFileSync(sink, JSON.stringify(record) + "\n", "utf8");
  } catch {
    /* never throw — the sink append is best-effort */
  }

  // 3. VALID guild.trace.degradation.v1 into the canonical log — `reason` carries
  //    the actionable orphan message so telemetry over the canonical log is not
  //    generic. emitTraceEvent validates before writing and never throws.
  try {
    emitTraceEvent(
      makeDegradationEvent({
        ts: at,
        run_id: runId,
        lane_id: process.env["GUILD_LANE_ID"] ?? "",
        surface: "dispatch",
        reason: `remote lane orphaned after spawn-fail rollback: ${message}`,
        attempted: "remote pane teardown (tmux kill-session + has-session verify)",
        fallback: `orphan recorded (${REMOTE_ORPHAN_SINK_RELPATH}) for manual cleanup — no live lane silently dropped`,
        severity: "warn",
      }),
      runDir,
    );
  } catch {
    /* never throw from the observer */
  }
}
