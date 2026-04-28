// v1.4.0 adversarial-loops counter store.
//
// Architect contract (verbatim, see benchmark/plans/v1.4-loop-skill-contracts.md
// §counters.json concurrency contract + §"Per-lane counters — isolation
// contract"):
//
//   1. Atomic-rename writes — write to `<runDir>/counters.json.tmp`, fsync,
//      rename → `<runDir>/counters.json`. Never write to counters.json
//      directly.
//   2. Single coordination primitive — `<runDir>/logs/.lock` (the SAME
//      lockfile the JSONL writer in T3c uses). Acquired via the shared
//      `withStableLock()` helper in `v1.4-lock.ts`. DO NOT add a second
//      lockfile.
//   3. Optimistic-retry — bounded loop: 1 initial attempt + up to 3
//      retries (4 total attempts) with backoffs 10ms / 50ms / 200ms
//      applied BETWEEN attempts.
//   4. On retry exhaustion — surface to caller; orchestrator emits the
//      `tool_call status: "err"` event (out of scope here — we throw and
//      let the runner's event-emitter take over).
//   5. Crash-resume cleanup — on startup, if `counters.json.tmp` exists
//      (rename never completed), delete it; counters.json holds last-good.
//
// File schema (architect §"Per-lane counters — isolation contract"):
//
//     {
//       "schema_version": 1,
//       "run_id": "<id>",
//       "counters": {
//         "l1_round": <int>,        // global brainstorm phase cap counter
//         "l2_round": <int>,        // global plan phase cap counter
//         "<lane_id>": {            // per-lane nested object
//           "L3_round": <int>,
//           "L4_round": <int>,
//           "security_round": <int>,
//           "restart_count": <int>
//         },
//         ...
//       }
//     }
//
// L1/L2 are FLAT keys (`l1_round`, `l2_round`) per architect §L1
// "Counter file: `.guild/runs/<run-id>/counters.json` key `l1_round`"
// and §L2 "key `l2_round`". Per-lane counters are NESTED under
// `<lane_id>` per the architect's isolation-contract example.

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

import {
  initStableLockfile,
  stableLockPath,
  withStableLock,
} from "./v1.4-lock.js";

// ──────────────────────────────────────────────────────────────────────────
// File-shape contract — lane-keyed schema per architect contract
// ──────────────────────────────────────────────────────────────────────────

/**
 * Per-lane counter block. Architect contract: each lane is a JSON object
 * keyed by `<lane_id>` under `counters`, with these four integer fields.
 *
 * Layers map:
 *   L3   → `L3_round`
 *   L4   → `L4_round`
 *   security-review → `security_round`
 *   restart counter → `restart_count`
 */
export interface LaneCounters {
  L3_round: number;
  L4_round: number;
  security_round: number;
  restart_count: number;
}

/**
 * On-disk shape of `counters.json`. Lane-keyed nested object plus flat
 * `l1_round` + `l2_round` globals.
 */
export interface CounterFile {
  schema_version: 1;
  run_id: string;
  counters: CounterMap;
}

/**
 * The `counters` field is a heterogeneous map: known global keys
 * (`l1_round`, `l2_round`) carry numbers; any other key carries a
 * `LaneCounters` object.
 */
export type CounterMap = Record<string, number | LaneCounters>;

export const COUNTER_SCHEMA_VERSION = 1 as const;

/** Reserved top-level numeric keys (architect contract). */
export const GLOBAL_COUNTER_KEYS = ["l1_round", "l2_round"] as const;
export type GlobalCounterKey = (typeof GLOBAL_COUNTER_KEYS)[number];

/** The four required fields of every per-lane block. */
export const LANE_COUNTER_FIELDS = [
  "L3_round",
  "L4_round",
  "security_round",
  "restart_count",
] as const;
export type LaneCounterField = (typeof LANE_COUNTER_FIELDS)[number];

/** Canonical empty lane block. */
export function emptyLaneCounters(): LaneCounters {
  return { L3_round: 0, L4_round: 0, security_round: 0, restart_count: 0 };
}

// ──────────────────────────────────────────────────────────────────────────
// Path helpers
// ──────────────────────────────────────────────────────────────────────────

/** `<runDir>/counters.json` — canonical counters file. */
export function counterFilePath(runDir: string): string {
  return join(runDir, "counters.json");
}

/** Sibling tmp file used by the atomic-rename writer. */
export function counterTmpPath(runDir: string): string {
  return join(runDir, "counters.json.tmp");
}

/**
 * Shared lockfile path. Re-exports `stableLockPath()` so callers/tests
 * have a stable counter-store-flavored name. Both T3a (this module)
 * and T3c (log-jsonl.ts) MUST resolve to this exact path.
 */
export function counterLockPath(runDir: string): string {
  return stableLockPath(runDir);
}

// ──────────────────────────────────────────────────────────────────────────
// Errors surfaced to the caller / orchestrator
// ──────────────────────────────────────────────────────────────────────────

/**
 * Thrown when the bounded retry loop exhausts. Carries `attempts` so the
 * orchestrator can include it in the `tool_call status: "err"` event the
 * architect specifies for retry exhaustion.
 */
export class CounterStoreContentionError extends Error {
  readonly attempts: number;
  override readonly cause: unknown;
  constructor(attempts: number, cause: unknown) {
    super(
      `counter-store: failed to update counters.json after ${attempts} attempt(s): ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    this.name = "CounterStoreContentionError";
    this.attempts = attempts;
    this.cause = cause;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Crash-resume cleanup — delete orphaned counters.json.tmp
// ──────────────────────────────────────────────────────────────────────────

/**
 * On startup, delete `counters.json.tmp` if it exists. The architect
 * contract: a stranded tmp file means a previous run crashed between
 * write-tmp and rename, so `counters.json` (if present) holds the last
 * good state. Calling this is idempotent and safe even when no tmp
 * exists.
 *
 * MUST be called UNDER the shared lock — otherwise it could race a
 * concurrent live writer mid-write. The internal helper exists for that
 * reason; `readCounters()` and `updateCounters()` call it under their
 * own lock.
 */
export function cleanupOrphanedTmp(runDir: string): void {
  const tmp = counterTmpPath(runDir);
  if (existsSync(tmp)) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // Ignore — racing with another cleanup is a no-op
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Read path
// ──────────────────────────────────────────────────────────────────────────

function emptyCounterFile(runId: string): CounterFile {
  return {
    schema_version: COUNTER_SCHEMA_VERSION,
    run_id: runId,
    counters: {},
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v);
}

function parseLaneBlock(key: string, raw: unknown): LaneCounters {
  if (!isPlainObject(raw)) {
    throw new Error(
      `counter-store: lane '${key}' must be a JSON object with the four required fields`,
    );
  }
  const out: LaneCounters = emptyLaneCounters();
  for (const field of LANE_COUNTER_FIELDS) {
    const v = raw[field];
    if (!isInteger(v)) {
      throw new Error(
        `counter-store: lane '${key}' field '${field}' must be an integer (got ${String(v)})`,
      );
    }
    out[field] = v;
  }
  // Reject extra keys to catch typos (defensive — not strictly required by
  // the contract, but lane blocks are closed-shape).
  for (const k of Object.keys(raw)) {
    if (!(LANE_COUNTER_FIELDS as readonly string[]).includes(k)) {
      throw new Error(
        `counter-store: lane '${key}' contains unknown field '${k}'; expected only ${LANE_COUNTER_FIELDS.join(", ")}`,
      );
    }
  }
  return out;
}

function parseCounterFile(text: string, runId: string): CounterFile {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `counter-store: counters.json is not valid JSON (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }
  if (!isPlainObject(obj)) {
    throw new Error("counter-store: counters.json must be a JSON object");
  }
  const file = obj as Partial<CounterFile> & { counters?: unknown };
  if (file.schema_version !== COUNTER_SCHEMA_VERSION) {
    throw new Error(
      `counter-store: counters.json schema_version=${String(
        file.schema_version,
      )} but expected ${COUNTER_SCHEMA_VERSION}`,
    );
  }
  if (typeof file.run_id !== "string" || file.run_id.length === 0) {
    throw new Error("counter-store: counters.json missing run_id");
  }
  if (!isPlainObject(file.counters)) {
    throw new Error("counter-store: counters.json `counters` must be an object");
  }

  const counters: CounterMap = {};
  for (const [k, v] of Object.entries(file.counters)) {
    if ((GLOBAL_COUNTER_KEYS as readonly string[]).includes(k)) {
      if (!isInteger(v)) {
        throw new Error(
          `counter-store: global counter '${k}' must be an integer (got ${String(v)})`,
        );
      }
      counters[k] = v;
    } else {
      // Lane key.
      counters[k] = parseLaneBlock(k, v);
    }
  }

  if (file.run_id !== runId) {
    throw new Error(
      `counter-store: counters.json run_id mismatch ` +
        `(file=${file.run_id}, expected=${runId})`,
    );
  }
  return {
    schema_version: COUNTER_SCHEMA_VERSION,
    run_id: file.run_id,
    counters,
  };
}

/**
 * Read counters.json under the shared per-run lock. Returns a fresh
 * empty structure if the file doesn't exist (first read of a run).
 * Cleans up any orphaned tmp file as part of the read transaction.
 */
export function readCounters(runDir: string, runId: string): CounterFile {
  mkdirSync(runDir, { recursive: true });
  initStableLockfile(runDir);
  return withStableLock(runDir, () => {
    cleanupOrphanedTmp(runDir);
    const path = counterFilePath(runDir);
    if (!existsSync(path)) {
      return emptyCounterFile(runId);
    }
    const text = readFileSync(path, "utf8");
    return parseCounterFile(text, runId);
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Write path — atomic-rename + bounded retry
// ──────────────────────────────────────────────────────────────────────────

/**
 * Architect retry contract: 3 retries after the initial attempt
 * (4 total attempts), with backoffs 10ms / 50ms / 200ms applied
 * BETWEEN attempts.
 *
 * Schedule:
 *   attempt 1 (initial)  → on EBUSY/EIO/EAGAIN/ENOSPC → sleep 10ms
 *   attempt 2 (retry 1)  → on EBUSY/...                → sleep 50ms
 *   attempt 3 (retry 2)  → on EBUSY/...                → sleep 200ms
 *   attempt 4 (retry 3)  → on EBUSY/...                → throw CounterStoreContentionError
 */
export const RETRY_BACKOFFS_MS = [10, 50, 200] as const;
export const MAX_RETRIES = 3;
/** Total attempts = initial + retries. Exposed for tests. */
export const MAX_ATTEMPTS = MAX_RETRIES + 1;

function sleepSyncMs(ms: number): void {
  const end = Date.now() + ms;
  // eslint-disable-next-line no-empty
  while (Date.now() < end) {}
}

/**
 * Write `data` atomically: tmp → fsync → rename.
 * Caller MUST hold the shared lock for the whole call — readers see
 * either the pre- or post-rename file, never a half-written one.
 */
function writeCountersAtomic(runDir: string, data: CounterFile): void {
  mkdirSync(runDir, { recursive: true });
  const tmp = counterTmpPath(runDir);
  const final = counterFilePath(runDir);
  const json = `${JSON.stringify(data, null, 2)}\n`;

  // O_WRONLY|O_CREAT|O_TRUNC per the contract — `'w'` flag.
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, json);
    // Architect: fsync before rename so the rename can't expose a
    // zero-length file on crash.
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, final);
}

/**
 * Mutator signature. Receives the current `counters` map (deep-copied
 * before invocation); returns the new `counters` map (or mutates the
 * argument in place — both are accepted).
 */
export type CounterMutator = (counters: CounterMap) => CounterMap;

function deepCopyCounters(counters: CounterMap): CounterMap {
  const out: CounterMap = {};
  for (const [k, v] of Object.entries(counters)) {
    if (typeof v === "number") {
      out[k] = v;
    } else {
      out[k] = { ...v };
    }
  }
  return out;
}

/**
 * Read-modify-write a counter under the shared per-run lock with the
 * architect's bounded retry budget (initial + 3 retries; backoffs
 * 10ms / 50ms / 200ms).
 *
 * On retry exhaustion: throws CounterStoreContentionError. The orchestrator
 * is expected to catch this and emit the `tool_call status: "err"` event
 * + AskUserQuestion fallback per the contract.
 *
 * The lock + atomic-rename guarantees:
 *   - serialised writes across PIDs (lockfile shared with JSONL writer)
 *   - readers always see a complete file (rename is atomic on POSIX)
 *   - crash mid-write never corrupts counters.json (tmp is the casualty)
 */
export function updateCounters(
  runDir: string,
  runId: string,
  mutate: CounterMutator,
): CounterFile {
  let lastErr: unknown = null;
  // 1 initial attempt + MAX_RETRIES retries === MAX_ATTEMPTS total.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      mkdirSync(runDir, { recursive: true });
      initStableLockfile(runDir);
      return withStableLock(runDir, () => {
        cleanupOrphanedTmp(runDir);
        // Read current state.
        let current: CounterFile;
        const path = counterFilePath(runDir);
        if (existsSync(path)) {
          current = parseCounterFile(readFileSync(path, "utf8"), runId);
        } else {
          current = emptyCounterFile(runId);
        }
        // Apply mutation against a deep copy so accidental aliasing in
        // the mutator can't corrupt the on-disk view if the write fails.
        const nextCounters = mutate(deepCopyCounters(current.counters));
        const next: CounterFile = {
          schema_version: COUNTER_SCHEMA_VERSION,
          run_id: runId,
          counters: nextCounters,
        };
        writeCountersAtomic(runDir, next);
        return next;
      });
    } catch (err) {
      lastErr = err;
      // Don't retry on invariant violations (bad mutator output, schema
      // mismatch). Only retry on ephemeral fs errors. The architect names
      // EBUSY/EIO; we add ENOSPC + EAGAIN as the same class of transient
      // fs error.
      const code = (err as NodeJS.ErrnoException)?.code;
      const retryable =
        code === "EBUSY" ||
        code === "EIO" ||
        code === "ENOSPC" ||
        code === "EAGAIN";
      if (!retryable) {
        throw err;
      }
      // Apply backoff BETWEEN attempts (not after the final attempt).
      // attempt=1 → backoff[0] (10ms); attempt=2 → backoff[1] (50ms);
      // attempt=3 → backoff[2] (200ms); attempt=4 → no backoff (throws).
      if (attempt < MAX_ATTEMPTS) {
        const backoff = RETRY_BACKOFFS_MS[attempt - 1] as number;
        sleepSyncMs(backoff);
        continue;
      }
    }
  }
  throw new CounterStoreContentionError(MAX_ATTEMPTS, lastErr);
}

// ──────────────────────────────────────────────────────────────────────────
// Lane-aware helpers — the v1.4 schema's lane-keyed nested objects
// ──────────────────────────────────────────────────────────────────────────

function ensureLaneBlock(counters: CounterMap, laneId: string): LaneCounters {
  if ((GLOBAL_COUNTER_KEYS as readonly string[]).includes(laneId)) {
    throw new Error(
      `counter-store: '${laneId}' is a reserved global counter key; ` +
        `lane ids must not collide with ${GLOBAL_COUNTER_KEYS.join(", ")}`,
    );
  }
  const existing = counters[laneId];
  if (existing === undefined) {
    const block = emptyLaneCounters();
    counters[laneId] = block;
    return block;
  }
  if (typeof existing === "number") {
    throw new Error(
      `counter-store: counter '${laneId}' is currently a global integer ` +
        `but a lane block was requested; refusing to overwrite`,
    );
  }
  return existing;
}

/**
 * Increment the global L1 counter (`l1_round`). Returns the new value.
 *
 * Per architect §L1 "Counter file: `.guild/runs/<run-id>/counters.json`
 * key `l1_round`."
 */
export function incrementL1(runDir: string, runId: string, by = 1): number {
  if (!Number.isInteger(by)) {
    throw new Error(`counter-store: L1 increment 'by' must be an integer (got ${by})`);
  }
  const file = updateCounters(runDir, runId, (c) => {
    const cur = (c.l1_round as number | undefined) ?? 0;
    c.l1_round = cur + by;
    return c;
  });
  return file.counters.l1_round as number;
}

/**
 * Increment the global L2 counter (`l2_round`). Returns the new value.
 */
export function incrementL2(runDir: string, runId: string, by = 1): number {
  if (!Number.isInteger(by)) {
    throw new Error(`counter-store: L2 increment 'by' must be an integer (got ${by})`);
  }
  const file = updateCounters(runDir, runId, (c) => {
    const cur = (c.l2_round as number | undefined) ?? 0;
    c.l2_round = cur + by;
    return c;
  });
  return file.counters.l2_round as number;
}

/**
 * Read a global counter (`l1_round` or `l2_round`). Returns 0 if unset.
 */
export function getGlobal(
  runDir: string,
  runId: string,
  key: GlobalCounterKey,
): number {
  const file = readCounters(runDir, runId);
  const v = file.counters[key];
  return typeof v === "number" ? v : 0;
}

/**
 * Increment a single lane-counter field by `by`. Returns the new value
 * of that field for the lane.
 *
 * Lane fields:
 *   - `L3_round` (per-lane L3 counter)
 *   - `L4_round` (per-lane L4 counter)
 *   - `security_round` (per-lane security-review counter)
 *   - `restart_count` (per-lane restart counter)
 */
export function incrementLaneCounter(
  runDir: string,
  runId: string,
  laneId: string,
  field: LaneCounterField,
  by: number = 1,
): number {
  if (!Number.isInteger(by)) {
    throw new Error(
      `counter-store: lane increment 'by' must be an integer (got ${by})`,
    );
  }
  const file = updateCounters(runDir, runId, (c) => {
    const block = ensureLaneBlock(c, laneId);
    block[field] = block[field] + by;
    return c;
  });
  const block = file.counters[laneId];
  if (typeof block !== "object" || block === null) return 0;
  return block[field];
}

/**
 * Read one lane field. Returns 0 if the lane block is absent.
 */
export function getLaneCounter(
  runDir: string,
  runId: string,
  laneId: string,
  field: LaneCounterField,
): number {
  const file = readCounters(runDir, runId);
  const block = file.counters[laneId];
  if (typeof block !== "object" || block === null) return 0;
  return block[field];
}

/**
 * Read the entire lane block. Returns an empty block if absent.
 */
export function getLaneCounters(
  runDir: string,
  runId: string,
  laneId: string,
): LaneCounters {
  const file = readCounters(runDir, runId);
  const block = file.counters[laneId];
  if (typeof block !== "object" || block === null) {
    return emptyLaneCounters();
  }
  return { ...block };
}

/**
 * Reset the per-lane L3/L4/security counters for `laneId`, PRESERVING
 * `restart_count`. Architect contract: security restart "Reset L3/L4/
 * security counters for this lane" but "Increment restart counter" — so
 * the restart counter must survive the reset.
 *
 * If the lane block is absent, this is a no-op.
 */
export function resetLaneCounters(
  runDir: string,
  runId: string,
  laneId: string,
): CounterFile {
  return updateCounters(runDir, runId, (c) => {
    const existing = c[laneId];
    if (typeof existing === "object" && existing !== null) {
      const preservedRestart = existing.restart_count;
      c[laneId] = {
        L3_round: 0,
        L4_round: 0,
        security_round: 0,
        restart_count: preservedRestart,
      };
    }
    return c;
  });
}
