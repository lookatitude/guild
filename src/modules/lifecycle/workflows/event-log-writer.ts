/**
 * log-jsonl-writer.ts — Path helpers, event append, rotation, and reader path.
 *
 * Single responsibility: WRITING and READING the v1.4 telemetry log.
 * Split from log-jsonl.ts (M9 behavior-neutral decomposition, Wave 3 split-5).
 *
 * Consumers import from log-jsonl.ts (the re-export shim); this module is an
 * implementation detail. Do not import directly from outside hooks/lib/v1.4/.
 *
 * LOC target: ~380 (append + rotation + reader; no sidecar logic).
 *
 * Concurrency primitives:
 *   All writers call `withStableLock()` from `v1.4-lock.ts`. The shared helper
 *   uses a `.lock.exclusion` O_EXCL sidecar so the `.lock` inode stays
 *   permanent. T3a (counter-store) and T3c (this module) mutually exclude each
 *   other. Rotation runs under the same lock: rename live → gzip → recreate
 *   live with O_CREAT|O_EXCL (defends rotator-rotator race; retry on EEXIST).
 */

import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createGunzip, gzipSync } from "node:zlib";

import { redactEventFields } from "../../security";
import {
  initStableLockfile as initStableLockfileShared,
  stableLockPath,
  withStableLock,
} from "./stable-lock.js";
import { pruneUndefined, type TraceV2Fields } from "./trace-v2.js";

import {
  type JsonlEvent,
  EVENT_TYPES,
  isSafeLaneId,
  validateEventIds,
} from "./event-log-schema.js";

// Re-export for tests + downstream callers that imported from this module
// before the shared helper existed.
export { initStableLockfileShared as initStableLockfile };

// ──────────────────────────────────────────────────────────────────────────
// Path helpers — aligned with counter-store.ts (shared `.lock`)
// ──────────────────────────────────────────────────────────────────────────

/** Live log: `<runDir>/logs/v1.4-events.jsonl`. */
export function liveLogPath(runDir: string): string {
  return join(runDir, "logs", "v1.4-events.jsonl");
}

/** Archive directory: `<runDir>/logs/archive/`. */
export function archiveDir(runDir: string): string {
  return join(runDir, "logs", "archive");
}

/** Archive file for rotation N: `archive/v1.4-events.<N>.jsonl.gz`. */
export function archivePath(runDir: string, n: number): string {
  return join(archiveDir(runDir), `v1.4-events.${n}.jsonl.gz`);
}

/**
 * Stable lockfile path. Re-exports the shared helper's path so callers
 * have a log-jsonl-flavored name. Both T3a (counter-store) and T3c
 * (this module) MUST resolve to this exact path.
 *
 * Created at run-init; zero-byte; permanent inode; never deleted.
 */
export function lockPath(runDir: string): string {
  return stableLockPath(runDir);
}

/** Sidecar: `<runDir>/logs/tool-call-pre.jsonl` (T3d hook integration). */
export function sidecarPath(runDir: string): string {
  return join(runDir, "logs", "tool-call-pre.jsonl");
}

/** Per-lane fallback file (Windows): `<runDir>/logs/lane-<id>-events.jsonl`. */
export function laneFallbackPath(runDir: string, laneId: string): string {
  if (!isSafeLaneId(laneId)) {
    throw new Error(`log-jsonl: invalid lane_id ${JSON.stringify(laneId)}`);
  }
  return join(runDir, "logs", `lane-${laneId}-events.jsonl`);
}

/** Summary file: `<runDir>/logs/summary.md`. */
export function summaryPath(runDir: string): string {
  return join(runDir, "logs", "summary.md");
}

// ──────────────────────────────────────────────────────────────────────────
// Append path — single event, atomic under POSIX O_APPEND
// ──────────────────────────────────────────────────────────────────────────

/** Default rotation threshold per schema doc — 10 MiB. */
export const ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;

export interface AppendOptions {
  /** Override rotation threshold (testing). */
  rotationThresholdBytes?: number;
  /** Force per-lane fallback path even on POSIX (testing/Windows). */
  forceFallback?: boolean;
  /** Lane id used for the fallback per-lane log file. */
  laneId?: string;
  /** Override field-size cap (testing). */
  fieldCap?: number;
  /**
   * guild.trace_event.v2 additive fields (D-OBS-1). When present, the defined
   * fields are merged onto the serialized event line. The frozen v1 field set
   * is unchanged; absence is valid; values are never null. These are structured
   * (non-free-text) fields, so they are merged AFTER redaction.
   */
  traceV2?: TraceV2Fields;
}

/**
 * Append a single JSONL event to the run's live log. Applies redaction
 * to all redactable string fields before serializing.
 *
 * POSIX path: take the lock → write one line → unlock.
 * Windows / fallback: write to per-lane file (no shared lock; no race).
 *
 * Rotation is handled by `maybeRotate` internally — when the live log
 * exceeds the threshold AFTER this append, a rotation runs under the
 * same lock.
 */
export function appendEvent(
  runDir: string,
  event: JsonlEvent,
  opts: AppendOptions = {},
): void {
  validateEventIds(event);
  const cap = opts.fieldCap;
  // Redact + serialize FIRST so any error in encoding is surfaced before
  // we acquire the lock.
  const redacted = redactEventFields(event as unknown as Record<string, unknown>, cap);
  // D-OBS-1: merge the OPTIONAL guild.trace_event.v2 fields (span_id,
  // parent_span_id, tier, model, tokens, payload_ref) AFTER redaction — they
  // are structured, not free-text. pruneUndefined keeps absence valid (no null).
  const withV2 =
    opts.traceV2 !== undefined
      ? { ...redacted, ...pruneUndefined(opts.traceV2 as unknown as Record<string, unknown>) }
      : redacted;
  const line = JSON.stringify(withV2) + "\n";

  // Cross-platform fallback — per-lane file, no shared lock.
  if (opts.forceFallback || process.platform === "win32") {
    const laneId = opts.laneId ?? "global";
    const path = laneFallbackPath(runDir, laneId);
    mkdirSync(dirname(path), { recursive: true });
    // O_APPEND so concurrent writers within the same lane (rare) still
    // see whole-line writes.
    const fd = openSync(path, "a");
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
    return;
  }

  // POSIX path — shared lock + live log.
  const live = liveLogPath(runDir);
  mkdirSync(dirname(live), { recursive: true });
  withStableLock(runDir, () => {
    const fd = openSync(live, "a");
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
    // Check rotation under the same lock so we never observe a partial
    // rename. The rotation function expects to be called UNDER the lock.
    maybeRotateLocked(runDir, opts.rotationThresholdBytes ?? ROTATION_THRESHOLD_BYTES);
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Rotation path — rename + gzip + recreate with O_EXCL
// ──────────────────────────────────────────────────────────────────────────

/**
 * Discover the next rotation index N. Scans `archive/` for existing
 * `v1.4-events.<N>.jsonl.gz`; returns max(N) + 1, starting at 1.
 */
export function nextRotationIndex(runDir: string): number {
  const dir = archiveDir(runDir);
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const entry of readdirSync(dir)) {
    const m = /^v1\.4-events\.(\d+)\.jsonl\.gz$/.exec(entry);
    if (m && m[1] !== undefined) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * Rotation under the lock. Called by `appendEvent` when the live log
 * exceeds the threshold; also exposed for explicit operator-driven
 * rotations (e.g., end-of-run).
 *
 * MUST be called UNDER the write lock — does not take its own lock.
 */
function maybeRotateLocked(runDir: string, thresholdBytes: number): void {
  const live = liveLogPath(runDir);
  if (!existsSync(live)) return;
  const size = statSync(live).size;
  if (size < thresholdBytes) return;
  rotateLocked(runDir);
}

/**
 * Rotate the live log under an already-held write lock. Steps:
 *   1. rename live → temp rotation file (within the lock).
 *   2. gzip temp → archive/v1.4-events.<N>.jsonl.gz (synchronous).
 *   3. recreate live with O_CREAT|O_EXCL. On EEXIST another rotator
 *      already created it → no-op (we still own the lock; any concurrent
 *      claim is impossible, so EEXIST means a leftover from a previous
 *      crash and we recover by reusing it).
 *
 * The "rotator-rotator race" the architect mentions: two PROCESSES both
 * see size > threshold and both attempt rotation. The lock serializes
 * them. The O_EXCL on recreate is belt-and-braces against a previous
 * crash leaving a partial live file the rotator now wants to recreate.
 */
function rotateLocked(runDir: string): void {
  const live = liveLogPath(runDir);
  const archive = archiveDir(runDir);
  mkdirSync(archive, { recursive: true });

  // Step 1 — rename live to a staging path inside archive/. The staging
  // name is the final archive name minus the .gz extension; we delete it
  // after gzip succeeds.
  const n = nextRotationIndex(runDir);
  const stagingPath = join(archive, `v1.4-events.${n}.jsonl`);
  const finalArchive = archivePath(runDir, n);
  renameSync(live, stagingPath);

  // Step 2 — gzip staging → final archive (sync via Node's zlib gzipSync
  // for determinism; the archive is small relative to memory budgets at
  // 10 MiB threshold).
  const raw = readFileSync(stagingPath);
  const gzipped = gzipSync(raw);
  writeFileSync(finalArchive, gzipped);
  unlinkSync(stagingPath);

  // Step 3 — recreate live with O_CREAT|O_EXCL. On EEXIST (would be a
  // crash-leftover; we already hold the lock so no concurrent rotator
  // exists), retry by deleting the leftover and re-creating. This is the
  // rotator-rotator EEXIST retry the architect names.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = openSync(live, "wx");
      closeSync(fd);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw err;
      // Leftover — drop and retry.
      try {
        unlinkSync(live);
      } catch {
        // Race with another cleanup is acceptable.
      }
    }
  }
  throw new Error(
    `log-jsonl: failed to recreate live log at ${live} with O_EXCL after 5 retries`,
  );
}

/**
 * Public rotation entrypoint — takes the lock and rotates regardless of
 * size. Useful for end-of-run flush and tests.
 */
export function rotate(runDir: string): void {
  withStableLock(runDir, () => {
    if (!existsSync(liveLogPath(runDir))) return;
    rotateLocked(runDir);
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Reader path — snapshot live + decompress archives
// ──────────────────────────────────────────────────────────────────────────

/**
 * Snapshot the live log under the read lock. Per architect §Decision §4
 * reader path: flock → snapshot live to buffer → unlock → read archives
 * read-only.
 *
 * Archives are immutable post-rotation, so no lock is required for them.
 */
export function snapshotLiveLog(runDir: string): string {
  const live = liveLogPath(runDir);
  // Take the lock only if logs/ exists; otherwise return empty.
  if (!existsSync(dirname(live))) return "";
  return withStableLock(runDir, () => {
    if (!existsSync(live)) return "";
    return readFileSync(live, "utf8");
  });
}

/**
 * List archive files in chronological (rotation-N ascending) order.
 * Returns absolute paths.
 */
export function listArchives(runDir: string): string[] {
  const dir = archiveDir(runDir);
  if (!existsSync(dir)) return [];
  const entries: { n: number; path: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const m = /^v1\.4-events\.(\d+)\.jsonl\.gz$/.exec(entry);
    if (m && m[1] !== undefined) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n)) entries.push({ n, path: join(dir, entry) });
    }
  }
  entries.sort((a, b) => a.n - b.n);
  return entries.map((e) => e.path);
}

/**
 * Decompress an archive file and return its UTF-8 text. Streams via
 * `zlib.createGunzip` to avoid loading large gzip blobs entirely; the
 * underlying file is small (≤ 10 MiB compressed) so the buffer is
 * bounded.
 */
export async function readArchive(path: string): Promise<string> {
  const chunks: Buffer[] = [];
  const src = createReadStream(path);
  const gunzip = createGunzip();
  src.pipe(gunzip);
  for await (const chunk of gunzip) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Skip-record callback signature passed to `readAllEvents`. Architect
 * schema doc lines 386-401: "every line that fails validation must be
 * skipped with a callback reason; the read itself proceeds."
 */
export interface ReadSkipRecord {
  source: string;
  /** Source-relative line number (1-indexed). */
  line: number;
  /** Index in the merged stream this line WOULD have occupied (0-based). */
  streamIndex: number;
  raw: string;
  reason: string;
}

export interface ReadAllOptions {
  /** Callback invoked on every skipped line (parse error, unknown event, schema-validate fail). */
  onSkip?: (record: ReadSkipRecord) => void;
  /**
   * Optional schema validator. Called for every JSON-parsed line whose
   * `event` field is in `EVENT_TYPES`. Returning `{ ok: false, reason }`
   * causes the line to be skipped via `onSkip`. Pass
   * `validateEvent` from `scripts/v1.4-log-validator.ts` to enforce the
   * architect schema doc lines 402-406; pass nothing to keep the
   * legacy "JSON-parse + event-type whitelist" check.
   */
  validate?: (parsed: unknown) => { ok: true } | { ok: false; reason: string };
}

/**
 * Read every event from the run.
 *
 * Source-priority order (architect schema doc §6.1 §"Determinism"):
 *   1. Archives in N-ascending order (rotation 1, 2, 3, ...).
 *   2. Live log.
 *   3. Per-lane fallback files (Windows / cross-platform), alphabetically.
 *
 * Within each source, append-order is preserved verbatim. The schema
 * doc §6.2: "Append-order is the primary key; `ts` is the tie-breaker
 * for same-millisecond events from parallel processes." This function
 * returns events IN SOURCE-PRIORITY ORDER — callers that want the
 * full chronological merge should sort with `ts` as a tie-breaker
 * ONLY (NOT a primary key — see schema lines 386-401).
 *
 * Each line is:
 *   1. JSON-parsed (parse failure → skip + onSkip).
 *   2. Event-type checked against `EVENT_TYPES` (unknown → skip + onSkip).
 *   3. Schema-validated via `opts.validate` if supplied (failure → skip + onSkip).
 *
 * Backward-compat shim: callers who passed an `onSkip` function as the
 * 2nd positional argument still work — the function detects the legacy
 * shape and routes to `opts.onSkip`.
 */
export async function readAllEvents(
  runDir: string,
  optsOrLegacyOnSkip?:
    | ReadAllOptions
    | ((record: ReadSkipRecord) => void)
    | ((legacy: {
        source: string;
        line: number;
        raw: string;
        reason: string;
      }) => void),
): Promise<JsonlEvent[]> {
  // Normalise the legacy 2nd-positional-onSkip shape into ReadAllOptions.
  let opts: ReadAllOptions = {};
  if (typeof optsOrLegacyOnSkip === "function") {
    opts = {
      onSkip: optsOrLegacyOnSkip as (record: ReadSkipRecord) => void,
    };
  } else if (optsOrLegacyOnSkip !== undefined) {
    opts = optsOrLegacyOnSkip;
  }
  const out: JsonlEvent[] = [];
  // Archives first.
  for (const archive of listArchives(runDir)) {
    const text = await readArchive(archive);
    appendParsedLines(text, archive, out, opts);
  }
  // Live log next (snapshot under lock).
  const liveText = snapshotLiveLog(runDir);
  appendParsedLines(liveText, liveLogPath(runDir), out, opts);
  // Per-lane fallback files last, alphabetically. Source-order is
  // preserved within each file (no inter-file sort) per architect
  // schema doc lines 386-401.
  const logsDir = dirname(liveLogPath(runDir));
  if (existsSync(logsDir)) {
    for (const entry of readdirSync(logsDir).sort()) {
      const m = /^lane-.+-events\.jsonl$/.exec(entry);
      if (!m) continue;
      const text = readFileSync(join(logsDir, entry), "utf8");
      appendParsedLines(text, join(logsDir, entry), out, opts);
    }
  }
  return out;
}

function appendParsedLines(
  text: string,
  source: string,
  out: JsonlEvent[],
  opts: ReadAllOptions,
): void {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined || raw.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      opts.onSkip?.({
        source,
        line: i + 1,
        streamIndex: out.length,
        raw,
        reason: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { event?: unknown }).event !== "string" ||
      !EVENT_TYPES.has((parsed as { event: string }).event as JsonlEvent["event"])
    ) {
      opts.onSkip?.({
        source,
        line: i + 1,
        streamIndex: out.length,
        raw,
        reason: "unknown or missing event type",
      });
      continue;
    }
    if (opts.validate) {
      const result = opts.validate(parsed);
      if (!result.ok) {
        // `in`-narrowing works under the loose (no base tsconfig) ts-jest
        // compiler options where `!result.ok` flow-narrowing does not.
        const reason = "reason" in result ? result.reason : "unknown";
        opts.onSkip?.({
          source,
          line: i + 1,
          streamIndex: out.length,
          raw,
          reason: `schema validation failed: ${reason}`,
        });
        continue;
      }
    }
    out.push(parsed as JsonlEvent);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Lockfile inode helpers — used by tests that pin permanence
// ──────────────────────────────────────────────────────────────────────────

/**
 * Return the inode number of the stable lockfile. Used by tests that
 * pin the architect's "permanent inode" contract — the inode must not
 * change across rotations or appends.
 */
export function lockfileInode(runDir: string): number | null {
  const path = lockPath(runDir);
  if (!existsSync(path)) return null;
  return statSync(path).ino;
}

/**
 * Ensure the lockfile is still zero-byte. Used by tests that pin the
 * architect's "never truncated, never written to" contract.
 */
export function lockfileSize(runDir: string): number {
  const path = lockPath(runDir);
  return statSync(path).size;
}
