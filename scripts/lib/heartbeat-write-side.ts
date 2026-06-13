/**
 * scripts/lib/heartbeat-write-side.ts
 *
 * Agent-side heartbeat emission (ARCH-9 write side — scripts tier).
 *
 * ── BIND BY POINTER ──────────────────────────────────────────────────────────
 * Canonical decision + rationale:
 *   docs/knowledge/decisions/v2-runtime-and-execution-model.md
 *   §ADR-RE-3 ("Structured heartbeat protocol"). This module realizes the
 *   AGENT-SIDE WRITE half of that decision for the scripts execution tier.
 *
 * The read side that consumes these markers:
 *   scripts/check-lane-liveness.ts  (readHeartbeatAges + sweepLaneLiveness)
 *
 * The hooks-tier analog (PostToolUse path):
 *   hooks/lib/heartbeat-write.ts  (writeHeartbeatFromEnv + writeHeartbeat)
 *
 * ── What this module provides ────────────────────────────────────────────────
 *
 * writeHeartbeat(runDir, laneId, ts)
 *   Emits a per-lane heartbeat marker to
 *   `<runDir>/in-progress/<laneId>.json` that the read-side liveness
 *   checker (check-lane-liveness.ts) consumes. Record shape is identical
 *   to the hooks-side writer so the same reader works on both surfaces:
 *     { timestamp, step?, pct_complete?, last_action? }
 *   Atomic: write to a temp sibling then rename — a reader never sees a
 *   partial file. Throws on I/O failure (callers wrap fail-open as needed).
 *
 * isStale(marker, nowMs, ttlMs)
 *   Pure staleness predicate: true when `nowMs - marker.timestampMs >= ttlMs`.
 *   Caller supplies both sides of the comparison — no Date.now() inside.
 *   A negative age (future-dated marker) is clamped to 0 (treated as fresh).
 *
 * ── Hard invariants ──────────────────────────────────────────────────────────
 *
 *  - Deterministic: NO Date.now() / Math.random() inside exported lib
 *    functions. The CALLER supplies all timestamps and ids.
 *  - Real fs: writeHeartbeat touches the real filesystem (temp + rename).
 *    There is no injected fs seam in the public API — the scripts tier uses
 *    real fs directly, consistent with check-lane-liveness.ts and its peers.
 *  - Safe path component: laneId is validated against a conservative
 *    allowlist before use as a filesystem path segment (path traversal guard).
 *  - Dormant surface: this module is a new, inert write surface. It is not
 *    wired into any existing hot path; callers must explicitly invoke
 *    writeHeartbeat to produce markers.
 *
 * ── Config notes ─────────────────────────────────────────────────────────────
 *
 * There is no config key specific to this module. The staleness threshold
 * (`ttlMs`) is caller-supplied. If `defaults.heartbeat_timeout_ms` is added
 * to the closed-key settings surface, callers should read it via
 * read-guild-config.ts and pass the resolved value here.
 *
 * ── OQ-4 note ────────────────────────────────────────────────────────────────
 *
 * The heartbeat record remains an UNVERSIONED operational artifact (OQ-4 —
 * same decision as hooks/lib/heartbeat.ts: promote to a guild.heartbeat.v1
 * sibling only if a cross-host / telemetry consumer needs a stable contract).
 *
 * Tests: scripts/__tests__/heartbeat-write-side.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Default stall threshold — 10 min. Mirrors
 * hooks/lib/heartbeat.ts DEFAULT_HEARTBEAT_TIMEOUT_MS and
 * check-lane-liveness.ts DEFAULT_HEARTBEAT_TIMEOUT_MS.
 */
export const DEFAULT_HEARTBEAT_TTL_MS = 10 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * The per-lane heartbeat record written to disk.
 * Shape is identical to the hooks-side `HeartbeatWriteRecord` so the same
 * reader (readHeartbeatAges in check-lane-liveness.ts) works on both surfaces.
 */
export interface HeartbeatMarker {
  /** ISO-8601 write timestamp (the liveness signal). */
  timestamp: string;
  /** Phase/step label (e.g. "implementing", "testing"). Optional. */
  step?: string;
  /** Coarse progress 0–100. Optional. */
  pct_complete?: number;
  /** Short description of the most recent action. Optional. */
  last_action?: string;
}

/**
 * Options for writeHeartbeat; all optional metadata fields.
 * The caller owns the timestamp — pass it in as an ISO-8601 string.
 */
export interface WriteHeartbeatOpts {
  /** Phase/step label. */
  step?: string;
  /** Coarse progress 0–100. */
  pct_complete?: number;
  /** Short label of the most recent action (e.g. a tool name). */
  last_action?: string;
}

/** Result returned by writeHeartbeat on success. */
export interface HeartbeatWriteResult {
  /** Absolute path of the written heartbeat file. */
  path: string;
}

// ── Path helper ───────────────────────────────────────────────────────────────

/**
 * Canonical per-lane heartbeat path: `<runDir>/in-progress/<laneId>.json`.
 * Matches the `<laneId>` join key used by readHeartbeatAges
 * (check-lane-liveness.ts).
 */
export function heartbeatPath(runDir: string, laneId: string): string {
  return path.join(runDir, "in-progress", `${laneId}.json`);
}

// ── Id hygiene ────────────────────────────────────────────────────────────────

/**
 * Conservative path-component allowlist: laneId is used as a filesystem path
 * segment, so anything with separators, traversal dots, or exotic characters
 * is refused. Mirrors the identical check in hooks/lib/heartbeat-write.ts.
 */
const SAFE_PATH_COMPONENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * True iff `id` is safe to use as a single directory-name component.
 * Export for callers that want to pre-validate before calling writeHeartbeat.
 */
export function isSafeLaneId(id: string): boolean {
  return SAFE_PATH_COMPONENT_RE.test(id) && id !== "." && id !== "..";
}

// ── Pure predicate ─────────────────────────────────────────────────────────────

/**
 * Pure staleness predicate.
 *
 * Returns true when `nowMs - marker.timestampMs >= ttlMs` (the marker is at
 * or past its time-to-live). The caller supplies both sides of the comparison;
 * this function never calls Date.now().
 *
 * Contract:
 *  - A negative age (future-dated marker) is clamped to 0 → treated as fresh.
 *  - A NaN `timestampMs` → treated as a stale marker (unknown age ≥ ttl).
 *  - `ttlMs ≤ 0` is treated as an immediately-stale threshold (always stale
 *    unless the marker is from the future).
 *
 * @param marker     The heartbeat marker to evaluate.
 * @param nowMs      Current time in milliseconds (caller-supplied).
 * @param ttlMs      Time-to-live threshold in milliseconds (default 600000).
 */
export function isStale(
  marker: HeartbeatMarker,
  nowMs: number,
  ttlMs: number = DEFAULT_HEARTBEAT_TTL_MS
): boolean {
  const ts = Date.parse(marker.timestamp);
  if (Number.isNaN(ts)) return true; // unparseable timestamp → assume stale
  const ageMs = Math.max(0, nowMs - ts);
  return ageMs >= ttlMs;
}

// ── Atomic write ──────────────────────────────────────────────────────────────

/**
 * Emit a per-lane heartbeat marker.
 *
 * Writes (or overwrites) `<runDir>/in-progress/<laneId>.json` atomically:
 * a temp sibling is written first, then renamed to the target — a reader
 * never observes a partial file.
 *
 * The caller supplies the timestamp `ts` (ISO-8601 string) and the run
 * directory. Optional metadata (step, pct_complete, last_action) may be
 * passed via `opts`.
 *
 * Throws on I/O failure. Callers that need fail-open behavior should wrap
 * this in a try/catch.
 *
 * Path-traversal guard: throws with a clear message if `laneId` is not a
 * safe single path component (use `isSafeLaneId` to pre-validate if needed).
 *
 * @param runDir  Absolute path to `.guild/runs/<run-id>/`.
 * @param laneId  Lane/specialist identifier (used as the file stem under
 *                `in-progress/`). Must satisfy `isSafeLaneId`.
 * @param ts      ISO-8601 write timestamp (caller-supplied — no Date.now here).
 * @param opts    Optional metadata fields to include in the marker.
 * @returns       { path } — the absolute path of the written file.
 */
export function writeHeartbeat(
  runDir: string,
  laneId: string,
  ts: string,
  opts: WriteHeartbeatOpts = {}
): HeartbeatWriteResult {
  if (!isSafeLaneId(laneId)) {
    throw new Error(
      `[heartbeat-write-side] writeHeartbeat: unsafe laneId ${JSON.stringify(laneId)} — ` +
        `must be a non-empty safe path component (alphanumeric, ".", "-", "_"; ` +
        `no path separators, no "..")`
    );
  }

  const marker: HeartbeatMarker = { timestamp: ts };
  if (typeof opts.step === "string") marker.step = opts.step;
  if (typeof opts.pct_complete === "number") marker.pct_complete = opts.pct_complete;
  if (typeof opts.last_action === "string") marker.last_action = opts.last_action;

  const finalPath = heartbeatPath(runDir, laneId);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });

  // Atomic temp + rename.
  // The temp file name uses the current process pid + the supplied ts (no
  // Math.random — the ts is supplied by the caller and is already unique
  // enough for temp-file uniqueness within a process).
  const safeTsToken = ts.replace(/[^A-Za-z0-9]/g, "");
  const tmpPath = `${finalPath}.tmp-${process.pid}-${safeTsToken}`;

  fs.writeFileSync(tmpPath, JSON.stringify(marker, null, 2) + "\n", "utf8");
  try {
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    // Never leave a partial temp file behind.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best-effort */
    }
    throw err;
  }

  return { path: finalPath };
}

// ── Lenient marker reader ─────────────────────────────────────────────────────

/**
 * Read and parse a heartbeat marker from disk.
 *
 * Returns null when the file is absent, unreadable, or malformed — callers
 * treat null as "no signal" (same lenient behavior as the hooks-side reader
 * `readHeartbeat` in hooks/lib/heartbeat.ts). Never throws.
 *
 * @param runDir  Absolute path to `.guild/runs/<run-id>/`.
 * @param laneId  Lane identifier (file stem).
 */
export function readHeartbeatMarker(
  runDir: string,
  laneId: string
): HeartbeatMarker | null {
  let raw: string;
  try {
    raw = fs.readFileSync(heartbeatPath(runDir, laneId), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["timestamp"] !== "string" || obj["timestamp"].trim() === "") {
    return null;
  }
  const marker: HeartbeatMarker = { timestamp: obj["timestamp"] };
  if (typeof obj["step"] === "string") marker.step = obj["step"];
  if (typeof obj["pct_complete"] === "number") marker.pct_complete = obj["pct_complete"];
  if (typeof obj["last_action"] === "string") marker.last_action = obj["last_action"];
  return marker;
}

// ── CLI entry (if (require.main === module)) ──────────────────────────────────

if (require.main === module) {
  // Minimal CLI: write a heartbeat using env-supplied context.
  // Usage: npx tsx scripts/lib/heartbeat-write-side.ts --run-dir <path> --lane-id <id>
  const argv = process.argv.slice(2);
  let runDir: string | undefined;
  let laneId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--run-dir" && argv[i + 1] !== undefined) {
      runDir = argv[++i];
    } else if (arg.startsWith("--run-dir=")) {
      runDir = arg.slice("--run-dir=".length);
    } else if (arg === "--lane-id" && argv[i + 1] !== undefined) {
      laneId = argv[++i];
    } else if (arg.startsWith("--lane-id=")) {
      laneId = arg.slice("--lane-id=".length);
    }
  }

  if (!runDir || !laneId) {
    process.stderr.write(
      "usage: heartbeat-write-side.ts --run-dir <abs-path> --lane-id <lane>\n"
    );
    process.exit(1);
  }

  // CLI block is the ONLY place Date.now() is called.
  const ts = new Date().toISOString();
  const step = process.env["GUILD_STEP"];
  const lastAction = process.env["GUILD_LAST_ACTION"];
  const opts: WriteHeartbeatOpts = {};
  if (step) opts.step = step;
  if (lastAction) opts.last_action = lastAction;

  try {
    const result = writeHeartbeat(runDir, laneId, ts, opts);
    process.stdout.write(JSON.stringify({ written: true, path: result.path }) + "\n");
  } catch (err) {
    process.stderr.write(
      `[heartbeat-write-side] error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }
}
