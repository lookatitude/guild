/**
 * hooks/lib/bus-emit.ts
 *
 * Emitter for `guild.agent_bus_event.v1` — the inter-lane lifecycle event
 * stream at `.guild/runs/<run-id>/agent-bus/events.ndjson`.
 *
 * This stream is the PCR-Development must-exist artifact declared by CMD-007
 * (build.md output floor) — every agent-team lifecycle transition (lane
 * dispatched, completed, errored, idle) MUST produce a record here.
 *
 * ── Concurrency note ────────────────────────────────────────────────────────
 * `appendFileSync` is safe for the HOOK side (one hook fires per event,
 * serialised by Claude Code's hook dispatch — no concurrent writers from
 * the hook path). The ORCHESTRATOR side (concurrent lane dispatch via
 * execute-plan) must use the tooling bus-emit helper with the `.guild/.lock`
 * atomic-rename discipline (`docs/v2/dispatch-execution.md §Concurrency & locking`). The
 * hook-side helper documented here does NOT need that lock.
 *
 * ── Best-effort contract ─────────────────────────────────────────────────────
 * `emitBusEvent` is best-effort and never-throws. A bus-write failure logs a
 * warning to stderr and returns false; it NEVER blocks a hook.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Schema ───────────────────────────────────────────────────────────────────

/** Lifecycle event kinds written to agent-bus/events.ndjson. */
export type BusEventKind =
  | "dispatched"  // TaskCreated: a lane has been queued / assigned to a specialist
  | "completed"   // TaskCompleted (status=done): a lane finished successfully
  | "errored"     // TaskCompleted (status≠done): a lane finished with error/block
  | "idle";       // TeammateIdle: an idle heartbeat for a lane

/** The `guild.agent_bus_event.v1` schema version token. */
export const BUS_EVENT_SCHEMA_VERSION = "guild.agent_bus_event.v1" as const;

/** Runtime shape of a `guild.agent_bus_event.v1` record. */
export interface BusEventRecord {
  schema_version: typeof BUS_EVENT_SCHEMA_VERSION;
  /** ISO-8601 timestamp of the event. */
  ts: string;
  /** Run id — the root identifier for correlating all events in a build run. */
  run_id: string;
  /** Lifecycle event kind (dispatched / completed / errored / idle). */
  event: BusEventKind;
  /** Lane / specialist id (teammate_name). */
  lane_id?: string;
  /** Task id this event is bound to. */
  task_id?: string;
  /** Agent-team name (team_name from the hook payload). */
  team_name?: string;
  /** Optional short detail string (scrubbed by the caller — no raw paths/secrets). */
  detail?: string;
}

/**
 * Input fields the caller supplies. `schema_version` and `ts` are auto-stamped.
 * `run_id` is required; all other fields are optional.
 */
export type BusEventInput = Omit<BusEventRecord, "schema_version" | "ts">;

// ── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a fully-formed `guild.agent_bus_event.v1` record. Pure (no I/O).
 * Exported for tests that want to inspect the record shape without writing.
 */
export function buildBusEvent(input: BusEventInput): BusEventRecord {
  const rec: BusEventRecord = {
    schema_version: BUS_EVENT_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    run_id: input.run_id,
    event: input.event,
  };
  if (typeof input.lane_id === "string" && input.lane_id.length > 0) rec.lane_id = input.lane_id;
  if (typeof input.task_id === "string" && input.task_id.length > 0) rec.task_id = input.task_id;
  if (typeof input.team_name === "string" && input.team_name.length > 0) {
    rec.team_name = input.team_name;
  }
  if (typeof input.detail === "string" && input.detail.length > 0) rec.detail = input.detail;
  return rec;
}

// ── Emitter ──────────────────────────────────────────────────────────────────

/**
 * Append a `guild.agent_bus_event.v1` record to
 * `<runDir>/agent-bus/events.ndjson`. Best-effort and non-throwing.
 * Returns true on successful write, false otherwise.
 *
 * @param runDir  Absolute path to the run directory
 *                (`<guildRoot>/.guild/runs/<runId>`).
 * @param input   Bus event fields (schema_version + ts auto-stamped).
 */
export function emitBusEvent(runDir: string, input: BusEventInput): boolean {
  try {
    const busDir = path.join(runDir, "agent-bus");
    fs.mkdirSync(busDir, { recursive: true });
    const record = buildBusEvent(input);
    fs.appendFileSync(
      path.join(busDir, "events.ndjson"),
      JSON.stringify(record) + "\n",
      "utf8",
    );
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [bus-emit] write failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return false;
  }
}
