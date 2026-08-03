// v1.4.0 adversarial-loops — shared per-run lock primitive.
//
// Single source of truth for the per-run "stable lockfile" coordination
// primitive defined in ADR-009 §Decision §4 ("Stable-lockfile race
// control architecture") and `v1.4-loop-skill-contracts.md` §"counters.json
// concurrency contract" §2 ("Lock reuse — concurrent counter-updates
// serialize on the SAME stable lockfile sidecar … per-run `.lock` is
// the single coordination primitive for ALL per-run shared state").
//
// Owners:
//   - counter-store.ts (T3a)  — counters.json updates
//   - log-jsonl.ts     (T3c)  — JSONL log appends + rotations
//
// Both MUST use this module's `withStableLock()` so the two writer
// classes mutually exclude each other (no race between a counter
// atomic-rename and a JSONL append on the same run dir).
//
// ──────────────────────────────────────────────────────────────────────
// Design — two-file contract
// ──────────────────────────────────────────────────────────────────────
//
// The architect contract names two simultaneous requirements:
//
//   (a) "Stable lockfile is created at run-init (zero-byte; permanent
//       inode; never deleted, renamed, or truncated)" — so external
//       observers (CI tooling, debuggers) can inspect the inode without
//       races against rotation.
//
//   (b) "flock(<runDir>/logs/.lock, LOCK_EX)" — POSIX advisory lock
//       semantics for cross-process serialization.
//
// Node has no built-in flock(2) binding. Without one we cannot satisfy
// (b) literally; we satisfy it via a SEPARATE sidecar O_EXCL sentinel
// at `<runDir>/logs/.lock.exclusion`. The semantics are equivalent for
// our access pattern (single-host writers, no NFS) — `O_EXCL` open is
// atomic against concurrent `O_EXCL` opens of the same path on Linux,
// macOS, and any reasonable local filesystem.
//
// The two files have distinct roles:
//
//   .lock           — permanent zero-byte inode. NEVER deleted / renamed
//                     / truncated. This is the architect's "stable
//                     lockfile" file.
//   .lock.exclusion — O_EXCL sentinel. Created on acquire, deleted on
//                     release. EEXIST = held by another process.
//
// External observers checking `.lock` see a stable inode regardless of
// whether the process is in the critical section. Concurrent writers
// race on `.lock.exclusion` and serialize cleanly.
//
// This is documented as a "fallback" path because the literal
// `flock(LOCK_EX)` is not used. The fallback is the SHIPPING path for
// v1.4 — adding a native flock binding is a follow-up (out of T3a/T3c
// scope; deferred to a post-v1.4 dependency review).
//
// ──────────────────────────────────────────────────────────────────────
// Cross-platform fallback
// ──────────────────────────────────────────────────────────────────────
//
// On Windows (no reliable POSIX semantics for `O_EXCL` between processes
// across all filesystems), specialists use per-lane log files instead
// of a shared lock — the existing `log-jsonl.ts` Windows fallback path.
// `withStableLock` is still callable on Windows (it uses the same
// O_EXCL-on-`.lock.exclusion` idiom which works on NTFS for our case),
// but the JSONL writer routes around it via `forceFallback` /
// `process.platform === "win32"`. This module documents the contract;
// individual writers decide whether to take the lock or use the
// per-lane fallback.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

// ──────────────────────────────────────────────────────────────────────
// Path helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Stable lockfile path. Permanent zero-byte inode created by
 * `initStableLockfile()`. Never deleted, renamed, or truncated.
 *
 * Both T3a (counter-store) and T3c (log-jsonl) MUST resolve to this
 * exact path so external observers see one stable inode per run.
 */
export function stableLockPath(runDir: string): string {
  return join(runDir, "logs", ".lock");
}

/**
 * Cross-process exclusion sentinel. Created with `O_EXCL` on acquire;
 * deleted on release. EEXIST = held. Sidecar to `.lock` so the
 * permanent inode is preserved.
 *
 * The name is `.lock.exclusion` (not `.lock.busy`) to make the role
 * explicit in `ls`-output and grep-evidence: "exclusion" matches the
 * architect's "exclusive lock" terminology.
 */
export function exclusionSentinelPath(runDir: string): string {
  return join(runDir, "logs", ".lock.exclusion");
}

// ──────────────────────────────────────────────────────────────────────
// Init — zero-byte permanent inode
// ──────────────────────────────────────────────────────────────────────

/**
 * Create the stable lockfile if it does not already exist. Idempotent:
 * existing inode is preserved. Writers MUST call this once at run-init
 * (orchestrator startup) before any acquire path runs.
 *
 * Implementation: open with `wx` (O_CREAT | O_EXCL); EEXIST is the
 * "already initialized" outcome and is silently swallowed. The file
 * stays zero-byte forever — never written to, never truncated.
 */
export function initStableLockfile(runDir: string): void {
  const path = stableLockPath(runDir);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) return;
  try {
    const fd = openSync(path, "wx");
    closeSync(fd);
  } catch (err) {
    // EEXIST means another process raced us to create it — fine, the
    // inode is now stable. Any other error propagates.
    if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Acquire / release — `.lock.exclusion` O_EXCL sidecar
// ──────────────────────────────────────────────────────────────────────

/**
 * Default backoff schedule between contended acquire attempts. Bounded
 * (no unbounded sleep); same shape both T3a and T3c independently
 * picked, now centralized.
 */
const DEFAULT_BACKOFF_MS = [2, 5, 10, 25, 50, 100, 200] as const;

/**
 * Default total wait ceiling for one acquire. 5s is generous for healthy
 * contention (counter writes p99 < 50ms; JSONL append < 5ms; rotation
 * up to ~200ms) and short enough to surface a stale lock as a clear
 * error rather than a hang.
 */
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Synchronous busy-wait. Bounded ≤200ms per call (longest entry in
 * `DEFAULT_BACKOFF_MS`). Used between exclusion-sentinel retries.
 *
 * This is a tight spin rather than `setTimeout` because the entire
 * acquire path is synchronous (so writers can use the lock from
 * non-async code paths like `appendEvent`). Total wall-clock waste is
 * bounded by `DEFAULT_TIMEOUT_MS`.
 */
function sleepSyncMs(ms: number): void {
  const end = Date.now() + ms;
  // eslint-disable-next-line no-empty
  while (Date.now() < end) {}
}

export interface WithStableLockOpts {
  /** Total wait ceiling; defaults to 5s. */
  timeoutMs?: number;
  /** Per-attempt backoff schedule; clamped to last entry beyond length. */
  backoffMs?: readonly number[];
}

/**
 * Acquire the per-run lock, run `fn`, release. `fn` must be synchronous
 * to keep the critical section bounded; both writers (atomic-rename for
 * counters, single `writeSync` for JSONL append) are synchronous.
 *
 * Timeout: throws `Error` with the path + ms-elapsed text if the
 * sentinel cannot be created within `timeoutMs`. Caller is expected
 * to surface the error up to the orchestrator (T3a's
 * `CounterStoreContentionError` or T3c's append-error path).
 *
 * Idempotent: `fn` runs exactly once per call; the lock is released
 * even if `fn` throws (try/finally).
 */
export function withStableLock<T>(
  runDir: string,
  fn: () => T,
  opts: WithStableLockOpts = {},
): T {
  initStableLockfile(runDir);
  const sentinel = exclusionSentinelPath(runDir);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;

  const start = Date.now();
  let attempt = 0;
  for (;;) {
    try {
      const fd = openSync(sentinel, "wx");
      // Best-effort PID stamp for stale-lock provenance. Failure to
      // write is non-fatal — the file's existence is the lock.
      try {
        writeSync(fd, `${process.pid}\n`);
      } catch {
        // Non-fatal — non-empty content is informational only.
      }
      closeSync(fd);
      try {
        return fn();
      } finally {
        try {
          unlinkSync(sentinel);
        } catch {
          // Already gone (e.g. crash-cleanup raced). Acceptable —
          // fn() ran; the lock had its effect.
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `v1.4-lock: timed out waiting for ${sentinel} (${timeoutMs}ms). ` +
            `Stale lock? Remove the file if you are sure no other process holds it.`,
        );
      }
      const idx = Math.min(attempt, backoff.length - 1);
      sleepSyncMs(backoff[idx] as number);
      attempt += 1;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Async wrapper — for callers that want an async-friendly interface.
// ──────────────────────────────────────────────────────────────────────

/**
 * Async wrapper around `withStableLock`. Runs `fn` (which may be
 * async) under the lock. Holds the lock for the duration of the
 * promise; the synchronous spin-wait still happens at acquire time
 * because the sentinel must be created before any async work.
 *
 * Use this only when the critical section genuinely must `await`
 * something; prefer the synchronous `withStableLock` for ms-scale
 * file ops (the lock is held shorter on average).
 */
export async function withStableLockAsync<T>(
  runDir: string,
  fn: () => Promise<T>,
  opts: WithStableLockOpts = {},
): Promise<T> {
  initStableLockfile(runDir);
  const sentinel = exclusionSentinelPath(runDir);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;

  const start = Date.now();
  let attempt = 0;
  for (;;) {
    try {
      const fd = openSync(sentinel, "wx");
      try {
        writeSync(fd, `${process.pid}\n`);
      } catch {
        // non-fatal
      }
      closeSync(fd);
      try {
        return await fn();
      } finally {
        try {
          unlinkSync(sentinel);
        } catch {
          // already gone
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `v1.4-lock: timed out waiting for ${sentinel} (${timeoutMs}ms). ` +
            `Stale lock? Remove the file if you are sure no other process holds it.`,
        );
      }
      const idx = Math.min(attempt, backoff.length - 1);
      sleepSyncMs(backoff[idx] as number);
      attempt += 1;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Crash-recovery helpers
// ──────────────────────────────────────────────────────────────────────

/**
 * Delete the exclusion sentinel if it exists. ONLY safe to call at
 * orchestrator startup, before any writer has been spawned — the
 * intent is to clear a stale sentinel left by a previous crash.
 *
 * Calling this while another writer holds the lock would silently
 * break mutual exclusion; do not use it from inside writer code.
 */
export function clearStaleExclusionSentinel(runDir: string): void {
  const sentinel = exclusionSentinelPath(runDir);
  if (existsSync(sentinel)) {
    try {
      unlinkSync(sentinel);
    } catch {
      // Race with another cleanup is acceptable.
    }
  }
}
