/**
 * scripts/lib/emit-readback-degradation.ts
 *
 * W2-A2(d) — observable degradation signal for task_run readback failures.
 *
 * When the W2-A2 pre-routing readback (`readTaskRunCapReqs`) returns undefined
 * after a successful write, the launcher falls back to in-memory
 * capabilityRequirements (benign — the launcher is the sole writer, so the
 * fallback equals what was just written). But a SILENT fallback violates
 * Guild's never-silent-degradation principle.
 *
 * This module makes the fallback OBSERVABLE:
 *   1. A stderr warning (immediately visible in CI / terminal).
 *   2. A NDJSON record appended to the run's v1.4-events.jsonl log so
 *      guild-telemetry can surface it and the operator can diagnose it.
 *
 * The emitter NEVER throws — degradation observability must not cascade into
 * a harder failure than the original benign fallback.
 *
 * Usage:
 *   import { emitReadbackDegradation } from './lib/emit-readback-degradation'
 *   // On read-failure fallback:
 *   emitReadbackDegradation(cwd, runId, taskId, specialistName)
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Schema version for the degradation event record. */
export const READBACK_DEGRADATION_SCHEMA = "guild.degradation_event.v1" as const;

/** Event name written into the NDJSON record + stderr message. */
export const READBACK_DEGRADATION_EVENT = "task_run_readback_failed" as const;

/** The NDJSON record shape appended to v1.4-events.jsonl. */
export interface ReadbackDegradationRecord {
  schema_version: typeof READBACK_DEGRADATION_SCHEMA;
  event_name: typeof READBACK_DEGRADATION_EVENT;
  run_id: string;
  task_id: string;
  specialist: string;
  message: string;
  at: string;
}

/**
 * Emit the W2-A2(d) degradation signal: stderr warning + NDJSON events log record.
 *
 * Called by the launcher's W2-A2 readback block when `readTaskRunCapReqs`
 * returns `undefined` after a successful write. The caller KEEPS the in-memory
 * fallback (no hard-fail) — this function only makes the degradation visible.
 *
 * @param cwd          The repo root (`.guild/runs/` is relative to this).
 * @param runId        The current run id (path segment under `.guild/runs/`).
 * @param taskId       The task-id whose task_run file could not be read back.
 * @param specialist   The specialist name (for the diagnostic message).
 * @param out          Optional stderr-write override (for testing). Defaults to `process.stderr.write`.
 */
export function emitReadbackDegradation(
  cwd: string,
  runId: string,
  taskId: string,
  specialist: string,
  out: (msg: string) => void = (msg) => process.stderr.write(msg),
): void {
  const at = new Date().toISOString();
  const message =
    `routing ${taskId}/${specialist} from in-memory capability_requirements ` +
    `(equals written value — benign, but readback missed)`;

  // 1. Stderr warning — always visible (terminal, CI log).
  try {
    out(
      `[W2-A2] task_run_readback_failed: ${message}\n`,
    );
  } catch {
    /* never throw from the observer */
  }

  // 2. NDJSON record in the run's v1.4-events.jsonl — queryable by guild-telemetry.
  try {
    const eventsLog = path.join(
      cwd,
      ".guild",
      "runs",
      runId,
      "logs",
      "v1.4-events.jsonl",
    );
    fs.mkdirSync(path.dirname(eventsLog), { recursive: true });
    const record: ReadbackDegradationRecord = {
      schema_version: READBACK_DEGRADATION_SCHEMA,
      event_name: READBACK_DEGRADATION_EVENT,
      run_id: runId,
      task_id: taskId,
      specialist,
      message,
      at,
    };
    fs.appendFileSync(eventsLog, JSON.stringify(record) + "\n", "utf8");
  } catch {
    /* never throw — the events log append is best-effort */
  }
}
