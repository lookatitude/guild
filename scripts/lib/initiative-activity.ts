/**
 * lib/initiative-activity.ts — the frozen initiative activity event schema +
 * append helper (deferred item 12; docs/v2/06-initiatives.md §Directory).
 *
 * The per-initiative `activity.jsonl` shipped as manual-capture appends with no
 * frozen schema. This defines `guild.initiative_activity.v1` (one JSON object per
 * line) + a validator + a deterministic appender, so activity rows are uniform
 * and machine-readable (consumed by /guild:status and the registry rollup).
 */
import * as fs from "fs";
import * as path from "path";

export const ACTIVITY_SCHEMA = "guild.initiative_activity.v1";

/** Closed activity-event vocabulary. */
export const ACTIVITY_EVENTS = [
  "created",
  "status_change",
  "definition_updated",
  "work_item_added",
  "work_item_closed",
  "run_attached",
  "summary_updated",
  "released",
  "closed",
  "archived",
  "note",
] as const;
export type ActivityEvent = (typeof ACTIVITY_EVENTS)[number];

export interface ActivityRow {
  schema_version: typeof ACTIVITY_SCHEMA;
  ts: string;            // ISO-8601 (caller-supplied — deterministic, no Date here)
  initiative_id: string;
  event: ActivityEvent;
  detail: string;
  actor?: string;        // e.g. "orchestrator" | a sub-verb name
  ref?: string;          // optional source/evidence ref
}

const SET = new Set<string>(ACTIVITY_EVENTS);

export function isValidActivityRow(x: unknown): x is ActivityRow {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    r["schema_version"] === ACTIVITY_SCHEMA &&
    typeof r["ts"] === "string" && r["ts"] !== "" &&
    typeof r["initiative_id"] === "string" && r["initiative_id"] !== "" &&
    typeof r["event"] === "string" && SET.has(r["event"]) &&
    typeof r["detail"] === "string"
  );
}

/** Build a validated activity row (caller supplies the timestamp). */
export function makeActivityRow(input: {
  ts: string;
  initiative_id: string;
  event: ActivityEvent;
  detail: string;
  actor?: string;
  ref?: string;
}): ActivityRow {
  const row: ActivityRow = {
    schema_version: ACTIVITY_SCHEMA,
    ts: input.ts,
    initiative_id: input.initiative_id,
    event: input.event,
    detail: input.detail,
  };
  if (input.actor) row.actor = input.actor;
  if (input.ref) row.ref = input.ref;
  return row;
}

/** Append one row to an initiative's activity.jsonl (one JSON object per line). */
export function appendActivity(activityFile: string, row: ActivityRow): void {
  if (!isValidActivityRow(row)) {
    throw new Error(`[initiative-activity] refusing to append an invalid ${ACTIVITY_SCHEMA} row`);
  }
  fs.mkdirSync(path.dirname(activityFile), { recursive: true });
  fs.appendFileSync(activityFile, JSON.stringify(row) + "\n", "utf8");
}

/** Read + parse an activity.jsonl, skipping malformed lines (advisory log). */
export function readActivity(activityFile: string): ActivityRow[] {
  let raw = "";
  try { raw = fs.readFileSync(activityFile, "utf8"); } catch { return []; }
  const rows: ActivityRow[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (isValidActivityRow(r)) rows.push(r);
    } catch { /* skip malformed line */ }
  }
  return rows;
}
