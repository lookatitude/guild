#!/usr/bin/env -S npx tsx
/**
 * scripts/check-lane-liveness.ts
 *
 * Backend-agnostic lane-liveness sweeper (G-9 sweep part / SC-5) — the
 * orchestrator-side stall report for the model-driven dispatch rungs
 * (subagent / in-process `agent`) where no tmux pane-alive or `TeammateIdle`
 * watchdog exists.
 *
 * Reads, per `.guild/runs/<run-id>/`:
 *   - `run-state.json`  (`guild.run_state.v1` — lenient; may be absent, in
 *     which case the report derives lanes from receipts/heartbeats only)
 *   - `in-progress/*.json` structured heartbeats (`{timestamp, step,
 *     pct_complete?, last_action}` — same shape hooks/lib/heartbeat.ts writes;
 *     the minimal type is re-declared here, scripts do not import hooks
 *     internals for a read-only sweep)
 *   - `handoffs/*.md` receipts (`<specialist>-<task-id>.md`)
 *
 * Heartbeat join (lenient, in order): `in-progress/<laneId>.json` →
 * `in-progress/<specialist>-<laneId>.json` → `in-progress/<specialist>.json`
 * where <specialist> is derived from a matching receipt stem. An in-flight
 * lane with no joinable heartbeat falls back to the lane's run-state
 * `updated_at` for the stall verdict (reported `heartbeat_age_ms: null`).
 * Heartbeats that match no run-state lane are reported as their own rows so
 * nothing is silently dropped.
 *
 * Stall threshold: env `GUILD_HEARTBEAT_TIMEOUT_MS` (default 600000 = 10 min,
 * matching hooks/lib/heartbeat.ts DEFAULT_HEARTBEAT_TIMEOUT_MS).
 *
 * Usage:
 *   npx tsx scripts/check-lane-liveness.ts --run-dir <abs .guild/runs/<id>>
 *
 * Stdout: JSON { run_dir, run_state_present, timeout_ms, generated_at,
 *                lanes: [{ lane, status, receipt_present,
 *                          heartbeat_age_ms|null, stalled }] }
 * Exit:   0 always (report tool, not a gate) · 1 usage error only.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Constants ────────────────────────────────────────────────────────────────

/** Default stall threshold — mirrors hooks/lib/heartbeat.ts (10 min). */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;

/** Terminal lane statuses — never reported stalled. */
const TERMINAL_STATUSES = new Set(["done", "skipped", "dead", "failed"]);

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal structured-heartbeat shape (re-declared from hooks/lib/heartbeat.ts
 * `Heartbeat` — read-only consumer; do not add fields the writer doesn't emit).
 */
export interface HeartbeatRecord {
  timestamp: string;
  step?: string;
  pct_complete?: number;
  last_action?: string;
}

export interface LaneLiveness {
  lane: string;
  status: string;
  receipt_present: boolean;
  heartbeat_age_ms: number | null;
  stalled: boolean;
}

export interface LivenessReport {
  run_dir: string;
  run_state_present: boolean;
  timeout_ms: number;
  generated_at: string;
  lanes: LaneLiveness[];
}

/** Lenient slice of a `guild.run_state.v1` lane record. */
interface LaneStateLenient {
  status?: unknown;
  receipt_ref?: unknown;
  updated_at?: unknown;
}

// ── Lenient readers ──────────────────────────────────────────────────────────

function readJsonObject(p: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* corrupt → null */
  }
  return null;
}

/** Lenient run-state lanes read. Returns null when the file is absent/corrupt. */
export function readRunStateLanes(
  runDir: string
): Record<string, LaneStateLenient> | null {
  const obj = readJsonObject(path.join(runDir, "run-state.json"));
  if (obj === null) return null;
  const lanes = obj["lanes"];
  if (typeof lanes !== "object" || lanes === null || Array.isArray(lanes)) {
    return {};
  }
  return lanes as Record<string, LaneStateLenient>;
}

/**
 * Read every `in-progress/*.json` heartbeat → map of file stem → age in ms.
 * Age comes from the record's `timestamp`; an unparseable/missing timestamp
 * falls back to the file's mtime (the legacy heuristic). Never throws.
 */
export function readHeartbeatAges(
  runDir: string,
  now: number = Date.now()
): Map<string, number> {
  const ages = new Map<string, number>();
  const dir = path.join(runDir, "in-progress");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return ages;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const stem = name.slice(0, -".json".length);
    const filePath = path.join(dir, name);
    const obj = readJsonObject(filePath);
    const ts =
      obj !== null && typeof obj["timestamp"] === "string"
        ? Date.parse(obj["timestamp"] as string)
        : NaN;
    if (!Number.isNaN(ts)) {
      ages.set(stem, Math.max(0, now - ts));
      continue;
    }
    try {
      const stat = fs.statSync(filePath);
      ages.set(stem, Math.max(0, now - stat.mtimeMs));
    } catch {
      /* vanished mid-sweep — skip */
    }
  }
  return ages;
}

/** Receipt file stems under `handoffs/` (without the `.md` extension). */
export function readReceiptStems(runDir: string): string[] {
  try {
    return fs
      .readdirSync(path.join(runDir, "handoffs"))
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.slice(0, -".md".length));
  } catch {
    return [];
  }
}

// ── Stall rule ───────────────────────────────────────────────────────────────

/**
 * A lane is stalled when it has no receipt, is not in a terminal/pre-dispatch
 * state, and its freshest liveness signal is older than the timeout (or absent
 * entirely for an in_progress lane).
 */
export function isStalled(
  status: string,
  receiptPresent: boolean,
  signalAgeMs: number | null,
  timeoutMs: number
): boolean {
  if (receiptPresent) return false;
  if (TERMINAL_STATUSES.has(status)) return false;
  if (status === "pending" && signalAgeMs === null) return false; // not started
  if (status === "in_progress") {
    return signalAgeMs === null || signalAgeMs >= timeoutMs;
  }
  // unknown / pending-with-signal: stall only on an actually-stale signal.
  return signalAgeMs !== null && signalAgeMs >= timeoutMs;
}

// ── The sweep ────────────────────────────────────────────────────────────────

export function sweepLaneLiveness(
  runDir: string,
  timeoutMs: number = DEFAULT_HEARTBEAT_TIMEOUT_MS,
  now: number = Date.now()
): LivenessReport {
  const lanes = readRunStateLanes(runDir);
  const heartbeats = readHeartbeatAges(runDir, now);
  const receipts = readReceiptStems(runDir);
  const consumedHeartbeats = new Set<string>();
  const rows: LaneLiveness[] = [];

  if (lanes !== null) {
    for (const [laneId, lane] of Object.entries(lanes)) {
      const status = typeof lane.status === "string" ? lane.status : "unknown";
      const receiptStem = receipts.find((s) => s.endsWith(`-${laneId}`));
      const receiptPresent =
        receiptStem !== undefined ||
        (typeof lane.receipt_ref === "string" && lane.receipt_ref.length > 0);

      // Heartbeat join: <laneId> → <specialist>-<laneId> → receipt-derived
      // <specialist>.
      let hbKey: string | undefined;
      if (heartbeats.has(laneId)) {
        hbKey = laneId;
      } else {
        hbKey = [...heartbeats.keys()].find((k) => k.endsWith(`-${laneId}`));
        if (hbKey === undefined && receiptStem !== undefined) {
          const specialist = receiptStem.slice(
            0,
            receiptStem.length - laneId.length - 1
          );
          if (heartbeats.has(specialist)) hbKey = specialist;
        }
      }
      const heartbeatAgeMs = hbKey !== undefined ? heartbeats.get(hbKey)! : null;
      if (hbKey !== undefined) consumedHeartbeats.add(hbKey);

      // Stall signal: heartbeat first, else the lane's own updated_at stamp.
      let signalAgeMs: number | null = heartbeatAgeMs;
      if (signalAgeMs === null && typeof lane.updated_at === "string") {
        const ts = Date.parse(lane.updated_at);
        if (!Number.isNaN(ts)) signalAgeMs = Math.max(0, now - ts);
      }

      rows.push({
        lane: laneId,
        status,
        receipt_present: receiptPresent,
        heartbeat_age_ms: heartbeatAgeMs,
        stalled: isStalled(status, receiptPresent, signalAgeMs, timeoutMs),
      });
    }
  } else {
    // No run-state: report from receipts (each receipt stem = a finished lane).
    for (const stem of receipts) {
      const hbKey = [...heartbeats.keys()].find(
        (k) => k === stem || stem.startsWith(`${k}-`)
      );
      const heartbeatAgeMs = hbKey !== undefined ? heartbeats.get(hbKey)! : null;
      if (hbKey !== undefined) consumedHeartbeats.add(hbKey);
      rows.push({
        lane: stem,
        status: "unknown",
        receipt_present: true,
        heartbeat_age_ms: heartbeatAgeMs,
        stalled: false,
      });
    }
  }

  // Heartbeats that joined no lane row — surface them, never drop silently.
  for (const [stem, ageMs] of heartbeats) {
    if (consumedHeartbeats.has(stem)) continue;
    const receiptPresent = receipts.some(
      (s) => s === stem || s.startsWith(`${stem}-`)
    );
    rows.push({
      lane: stem,
      status: "unknown",
      receipt_present: receiptPresent,
      heartbeat_age_ms: ageMs,
      stalled: isStalled("unknown", receiptPresent, ageMs, timeoutMs),
    });
  }

  return {
    run_dir: runDir,
    run_state_present: lanes !== null,
    timeout_ms: timeoutMs,
    generated_at: new Date(now).toISOString(),
    lanes: rows,
  };
}

/** Resolve the stall threshold from env (tolerant — bad values → default). */
export function resolveTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env["GUILD_HEARTBEAT_TIMEOUT_MS"];
  if (raw === undefined) return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_HEARTBEAT_TIMEOUT_MS;
}

// ── CLI entry ────────────────────────────────────────────────────────────────

const USAGE = "usage: check-lane-liveness.ts --run-dir <abs .guild/runs/<id>>";

export function runCheckLaneLivenessCli(argv: string[] = process.argv.slice(2)): number {
  let runDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir" && argv[i + 1] !== undefined) {
      runDir = argv[++i];
    } else if (arg.startsWith("--run-dir=")) {
      runDir = arg.slice("--run-dir=".length);
    } else {
      process.stderr.write(`unknown argument: ${arg}\n${USAGE}\n`);
      return 1;
    }
  }
  if (!runDir) {
    process.stderr.write(USAGE + "\n");
    return 1;
  }

  const report = sweepLaneLiveness(runDir, resolveTimeoutMs());
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return 0; // report tool — never gates
}

if (require.main === module) {
  process.exit(runCheckLaneLivenessCli());
}
