// v1.4.0 adversarial-loops — JSONL log writer.
//
// Implements the binding contract from
// `benchmark/plans/v1.4-jsonl-schema.md` + the architect's stable-lockfile
// race-control design (ADR-009 §Decision §4).
//
// Outputs:
//   live log:        <runDir>/logs/v1.4-events.jsonl
//   archives:        <runDir>/logs/archive/v1.4-events.<N>.jsonl.gz
//   lockfile:        <runDir>/logs/.lock              (stable, zero-byte, permanent)
//   exclusion:       <runDir>/logs/.lock.exclusion    (sibling O_EXCL sentinel)
//   sidecar:         <runDir>/logs/tool-call-pre.jsonl  (PreToolUse pairing)
//
// The lockfile coordinates with the counter-store (T3a) — both modules
// share the SAME shared-lock helper (`benchmark/src/v1.4-lock.ts`). Per
// architect §Decision §4: stable lockfile is created at run-init
// (zero-byte; permanent inode; never deleted, renamed, or truncated).
//
// Concurrency primitives:
//   - All writers (counter-store + this module) call `withStableLock()`
//     from `v1.4-lock.ts`. The shared helper uses a `.lock.exclusion`
//     O_EXCL sidecar so the `.lock` inode stays permanent. T3a and T3c
//     therefore mutually exclude each other — a counter atomic-rename
//     and a JSONL append on the same run dir cannot interleave.
//   - Rotation: same lock → rename live → gzip → recreate live with
//     O_CREAT|O_EXCL (defends rotator-rotator race; retry on EEXIST).
//   - Cross-platform fallback: on `process.platform === "win32"`,
//     specialists write per-lane log files
//     `logs/lane-<id>-events.jsonl` and the summary regen merges by ts.

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

import { redactEventFields } from "./redact-log.js";
import {
  initStableLockfile as initStableLockfileShared,
  stableLockPath,
  withStableLock,
} from "./v1.4-lock.js";

// Re-export for tests + downstream callers that imported from this module
// before the shared helper existed. The body below uses the shared impl.
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
  return join(runDir, "logs", `lane-${laneId}-events.jsonl`);
}

/** Summary file: `<runDir>/logs/summary.md`. */
export function summaryPath(runDir: string): string {
  return join(runDir, "logs", "summary.md");
}

// Lock primitives moved to the shared `v1.4-lock.ts` helper. Both T3a
// (counter-store) and T3c (this module) call `withStableLock()` so a
// single `.lock.exclusion` sidecar serializes ALL writers on the same
// run dir. Tests pin: 4-parallel-process append serialization +
// counter-store-vs-jsonl mutual exclusion.

// ──────────────────────────────────────────────────────────────────────────
// Event types — exhaustive union per schema doc §"Event types" (12)
// ──────────────────────────────────────────────────────────────────────────

export type Phase =
  | "brainstorm"
  | "team-compose"
  | "plan"
  | "context"
  | "execute"
  | "review"
  | "verify"
  | "reflect";

export type LoopLayer = "L1" | "L2" | "L3" | "L4" | "security-review";

/**
 * Closed enum for `tool_call.tool`. 17 values per schema doc §7. Validators
 * reject other values; future tools require a schema bump.
 */
export const TOOL_CALL_TOOL_VALUES = [
  "Read",
  "Write",
  "Edit",
  "Grep",
  "Glob",
  "Bash",
  "Agent",
  "Skill",
  "AskUserQuestion",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "BashOutput",
  "KillShell",
] as const;
export type ToolCallTool = (typeof TOOL_CALL_TOOL_VALUES)[number];

/**
 * The 12 canonical Claude Code hook events per schema doc §8. Validators
 * reject other values; future hooks require a schema bump.
 */
export const HOOK_EVENT_NAMES = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SubagentStop",
  "PreCompact",
  "TaskCreated",
  "TaskCompleted",
  "TeammateIdle",
] as const;
export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

export interface PhaseStartEvent {
  ts: string;
  event: "phase_start";
  run_id: string;
  phase: Phase;
}

export interface PhaseEndEvent {
  ts: string;
  event: "phase_end";
  run_id: string;
  phase: Phase;
  duration_ms: number;
  status: "ok" | "error" | "escalated";
}

export interface SpecialistDispatchEvent {
  ts: string;
  event: "specialist_dispatch";
  run_id: string;
  lane_id: string;
  specialist: string;
  task_id: string;
  prompt_excerpt: string;
}

export interface SpecialistReceiptEvent {
  ts: string;
  event: "specialist_receipt";
  run_id: string;
  lane_id: string;
  specialist: string;
  task_id: string;
  receipt_path: string;
}

export interface LoopRoundStartEvent {
  ts: string;
  event: "loop_round_start";
  run_id: string;
  lane_id: string;
  loop_layer: LoopLayer;
  round_number: number;
  cap: number;
}

export interface LoopRoundEndEvent {
  ts: string;
  event: "loop_round_end";
  run_id: string;
  lane_id: string;
  loop_layer: LoopLayer;
  round_number: number;
  terminated:
    | "satisfied"
    | "malformed_termination"
    | "cap_hit"
    | "escalation"
    | "error";
  terminator: string;
}

export interface ToolCallEvent {
  ts: string;
  event: "tool_call";
  run_id: string;
  lane_id?: string;
  tool: ToolCallTool;
  command_redacted: string;
  status: "ok" | "err" | "n/a";
  latency_ms: number;
  result_excerpt_redacted: string;
  tokens_in?: number;
  tokens_out?: number;
}

export interface HookEvent {
  ts: string;
  event: "hook_event";
  run_id: string;
  lane_id?: string;
  hook_name: HookEventName;
  payload_excerpt_redacted: string;
  latency_ms: number;
  status: "ok" | "err";
}

export interface GateDecisionEvent {
  ts: string;
  event: "gate_decision";
  run_id: string;
  /**
   * One of:
   *   - "gate-1-spec" | "gate-2-team" | "gate-3-plan"
   *   - "mid-execution-decision:<slug>" where <slug> matches /^[a-z][a-z0-9-]{0,63}$/
   */
  gate: string;
  decision: "approved" | "rejected" | "deferred";
  source: "user" | "auto-approve-mode";
}

export interface AssumptionLoggedEvent {
  ts: string;
  event: "assumption_logged";
  run_id: string;
  lane_id: string;
  specialist: string;
  assumption_text: string;
}

export interface EscalationEvent {
  ts: string;
  event: "escalation";
  run_id: string;
  lane_id?: string;
  reason: "cap_hit" | "malformed_termination_x2" | "restart_cap_hit";
  options_offered: readonly ["force-pass", "extend-cap", "rework"];
  user_choice: "force-pass" | "extend-cap" | "rework";
}

export interface CodexReviewRoundEvent {
  ts: string;
  event: "codex_review_round";
  run_id: string;
  /** One of "G-spec" | "G-plan" | "G-lane:<lane-id>" matching /^T[0-9]+[a-z]?-[a-z][a-z-]{0,32}$/. */
  gate: string;
  round_number: number;
  terminated_by_satisfied: boolean;
}

/** Discriminated union of all 12 v1.4 schema_version=1 event types. */
export type JsonlEvent =
  | PhaseStartEvent
  | PhaseEndEvent
  | SpecialistDispatchEvent
  | SpecialistReceiptEvent
  | LoopRoundStartEvent
  | LoopRoundEndEvent
  | ToolCallEvent
  | HookEvent
  | GateDecisionEvent
  | AssumptionLoggedEvent
  | EscalationEvent
  | CodexReviewRoundEvent;

/** Set of valid `event` field values. The validator uses this. */
export const EVENT_TYPES: ReadonlySet<JsonlEvent["event"]> = new Set([
  "phase_start",
  "phase_end",
  "specialist_dispatch",
  "specialist_receipt",
  "loop_round_start",
  "loop_round_end",
  "tool_call",
  "hook_event",
  "gate_decision",
  "assumption_logged",
  "escalation",
  "codex_review_round",
]);

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
  const cap = opts.fieldCap;
  // Redact + serialize FIRST so any error in encoding is surfaced before
  // we acquire the lock.
  const redacted = redactEventFields(event as unknown as Record<string, unknown>, cap);
  const line = JSON.stringify(redacted) + "\n";

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
        opts.onSkip?.({
          source,
          line: i + 1,
          streamIndex: out.length,
          raw,
          reason: `schema validation failed: ${result.reason}`,
        });
        continue;
      }
    }
    out.push(parsed as JsonlEvent);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PreToolUse / PostToolUse pairing — sidecar protocol (T3d wires hooks)
//
// Architect audit (`v1.4-claude-plugin-surface-audit.md` §1b):
//   "Both hooks share a per-(`run_id`, `lane_id`, `tool`, `pre_ts`)
//    correlation key so the post-handler can resolve the pre-handler's
//    captured `command_redacted` and timestamp."
//
// "PostToolUse fires →
//    tool-call-pre.jsonl is scanned for the matching pre-record
//    (same run_id+lane_id+tool, pre_ts < post_ts, oldest unmatched)."
// ──────────────────────────────────────────────────────────────────────────

/**
 * Sidecar entry shape — written by PreToolUse, consumed by PostToolUse.
 *
 * Correlation key per architect audit §1b:
 *   `(run_id, lane_id, tool, pre_ts)` 4-tuple, with oldest-unmatched
 *   selection when more than one pre-record matches the first three
 *   fields.
 *
 * `call_id` is retained (informational; useful for ops debugging) but
 * is NOT the correlation key — the four-field tuple is.
 */
export interface SidecarPreEntry {
  /** Run id (correlation key field 1). */
  run_id: string;
  /** Lane id (correlation key field 2). Optional for top-level calls outside a lane. */
  lane_id?: string;
  /** Tool name (correlation key field 3). */
  tool: ToolCallTool;
  /**
   * ISO timestamp of the PreToolUse fire (correlation key field 4).
   * `pre_ts` < `post_ts` and oldest-unmatched among ties.
   */
  ts_pre: string;
  command_redacted: string;
  /** Informational id; may aid debugging but is not the correlation key. */
  call_id?: string;
}

/**
 * Match-key fields used by `consumeSidecarPre` for oldest-unmatched
 * lookup. The four-field tuple is the binding contract.
 */
export interface SidecarMatchKey {
  run_id: string;
  lane_id?: string;
  tool: ToolCallTool;
  /** Optional upper bound — only entries with `ts_pre < post_ts` are eligible. */
  post_ts?: string;
}

/**
 * Append a PreToolUse sidecar entry. Uses the same shared lock as the
 * live log because the sidecar lives under the same `logs/` dir; we do
 * NOT want a partial sidecar write to interleave with a rotation pass.
 */
export function appendSidecarPre(runDir: string, entry: SidecarPreEntry): void {
  const path = sidecarPath(runDir);
  mkdirSync(dirname(path), { recursive: true });
  const line = JSON.stringify(entry) + "\n";
  if (process.platform === "win32") {
    const fd = openSync(path, "a");
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
    return;
  }
  withStableLock(runDir, () => {
    const fd = openSync(path, "a");
    try {
      writeSync(fd, line);
    } finally {
      closeSync(fd);
    }
  });
}

/**
 * Architect contract field-equality for the correlation key. Same
 * `run_id` + same `tool` + same `lane_id` (treating both `undefined`
 * as a match — no-lane PreToolUse pairs with no-lane PostToolUse).
 */
function sidecarKeyMatches(
  entry: SidecarPreEntry,
  key: SidecarMatchKey,
): boolean {
  if (entry.run_id !== key.run_id) return false;
  if (entry.tool !== key.tool) return false;
  if ((entry.lane_id ?? undefined) !== (key.lane_id ?? undefined)) return false;
  if (key.post_ts !== undefined) {
    const preMs = Date.parse(entry.ts_pre);
    const postMs = Date.parse(key.post_ts);
    if (Number.isFinite(preMs) && Number.isFinite(postMs) && preMs >= postMs) {
      return false;
    }
  }
  return true;
}

/**
 * Find the matching sidecar pre-record for a PostToolUse fire and
 * remove it from the sidecar file. Match by the architect's 4-tuple
 * (`run_id`, `lane_id`, `tool`, `pre_ts < post_ts`) with oldest-
 * unmatched selection.
 *
 * Returns the matched entry (or `null` when no match exists — caller
 * decides whether to orphan-emit).
 *
 * The legacy `call_id`-only signature is retained as a convenience
 * overload for backward compatibility with existing callers/tests; the
 * 4-tuple form is the authoritative contract.
 */
export function consumeSidecarPre(
  runDir: string,
  matchOrCallId: SidecarMatchKey | string,
): SidecarPreEntry | null {
  const path = sidecarPath(runDir);
  if (!existsSync(path)) return null;

  const apply = (
    text: string,
  ): { match: SidecarPreEntry | null; rest: string } => {
    const lines = text.split("\n");
    // Build (rawLine, parsed) pairs to preserve untouched lines verbatim
    // (including malformed ones — they're flushed by sweep, not consumed
    // here).
    type ParsedLine = { raw: string; parsed: SidecarPreEntry | null };
    const parsedLines: ParsedLine[] = [];
    for (const raw of lines) {
      if (raw.length === 0) continue;
      try {
        parsedLines.push({ raw, parsed: JSON.parse(raw) as SidecarPreEntry });
      } catch {
        parsedLines.push({ raw, parsed: null });
      }
    }
    // Find the oldest-unmatched eligible entry.
    let pickIdx = -1;
    let pickTs = Number.POSITIVE_INFINITY;
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (!p || p.parsed === null) continue;
      const eligible =
        typeof matchOrCallId === "string"
          ? p.parsed.call_id === matchOrCallId
          : sidecarKeyMatches(p.parsed, matchOrCallId);
      if (!eligible) continue;
      const ts = Date.parse(p.parsed.ts_pre);
      // Treat unparseable ts as "least old" so a parseable-ts entry wins.
      const tsForSort = Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
      if (tsForSort < pickTs) {
        pickTs = tsForSort;
        pickIdx = i;
      }
    }
    let match: SidecarPreEntry | null = null;
    const remainingLines: string[] = [];
    for (let i = 0; i < parsedLines.length; i++) {
      const p = parsedLines[i];
      if (!p) continue;
      if (i === pickIdx && p.parsed !== null) {
        match = p.parsed;
        continue;
      }
      remainingLines.push(p.raw);
    }
    const rest =
      remainingLines.length === 0 ? "" : remainingLines.join("\n") + "\n";
    return { match, rest };
  };

  if (process.platform === "win32") {
    const text = readFileSync(path, "utf8");
    const { match, rest } = apply(text);
    writeFileSync(path, rest);
    return match;
  }
  return withStableLock(runDir, () => {
    const text = readFileSync(path, "utf8");
    const { match, rest } = apply(text);
    writeFileSync(path, rest);
    return match;
  });
}

/**
 * Build a `tool_call` event from a paired sidecar pre + post-data.
 * The architect contract: latency_ms = ts_post - ts_pre; status from
 * the post path; result_excerpt_redacted captured at post.
 *
 * If the sidecar entry is missing (orphan), the caller emits a
 * synthetic event with `status: "err"` and the literal sentinel
 * `result_excerpt_redacted: "<orphaned — pre/post pairing failed>"`.
 */
export function buildToolCallFromPair(
  pre: SidecarPreEntry,
  post: {
    ts_post: string;
    run_id: string;
    status: ToolCallEvent["status"];
    result_excerpt_redacted: string;
    tokens_in?: number;
    tokens_out?: number;
  },
): ToolCallEvent {
  const tsPostMs = Date.parse(post.ts_post);
  const tsPreMs = Date.parse(pre.ts_pre);
  const latency = Number.isFinite(tsPostMs) && Number.isFinite(tsPreMs)
    ? Math.max(0, tsPostMs - tsPreMs)
    : 0;
  const out: ToolCallEvent = {
    ts: post.ts_post,
    event: "tool_call",
    run_id: post.run_id,
    tool: pre.tool,
    command_redacted: pre.command_redacted,
    status: post.status,
    latency_ms: latency,
    result_excerpt_redacted: post.result_excerpt_redacted,
  };
  if (pre.lane_id !== undefined) out.lane_id = pre.lane_id;
  if (post.tokens_in !== undefined) out.tokens_in = post.tokens_in;
  if (post.tokens_out !== undefined) out.tokens_out = post.tokens_out;
  return out;
}

/**
 * Sentinel value emitted when the PostToolUse hook fires without a
 * matching PreToolUse sidecar entry (orphan handling). Architect
 * contract: `status: "err"`, this exact literal in result_excerpt.
 */
export const ORPHAN_RESULT_EXCERPT = "<orphaned — pre/post pairing failed>";

/**
 * Sentinel `latency_ms` value emitted for orphans flushed by the sweep.
 * Architect audit §1b: "stale pre-records flush after 5 minutes with
 * `latency_ms: -1` and `status: "err"`".
 */
export const ORPHAN_LATENCY_MS = -1 as const;

/**
 * Build the synthetic `tool_call` event the orphan-sweep contract
 * requires. Architect audit: `status: "err"`, `latency_ms: -1`,
 * `result_excerpt_redacted: ORPHAN_RESULT_EXCERPT`. The orphan's
 * `ts_pre` is preserved as the event `ts` so the audit trail surfaces
 * "this is when the unmatched Pre fired".
 */
export function buildOrphanedToolCall(
  pre: SidecarPreEntry,
): ToolCallEvent {
  const out: ToolCallEvent = {
    ts: pre.ts_pre,
    event: "tool_call",
    run_id: pre.run_id,
    tool: pre.tool,
    command_redacted: pre.command_redacted,
    status: "err",
    latency_ms: ORPHAN_LATENCY_MS,
    result_excerpt_redacted: ORPHAN_RESULT_EXCERPT,
  };
  if (pre.lane_id !== undefined) out.lane_id = pre.lane_id;
  return out;
}

/**
 * Build the `tool_call` event for the **POST-without-PRE** path —
 * distinct from the **PRE-without-POST** orphan-sweep path above. Per
 * `benchmark/plans/v1.4-claude-plugin-surface-audit.md` lines 133-135:
 *
 *   "If not found: emit a tool_call event with command_redacted absent
 *    (treat as observability gap; status=\"ok\"; result and latency
 *    captured from Post alone)."
 *
 * `command_redacted` is the empty string (the audit calls this
 * "absent"; the schema's required-string field carries empty). Status
 * is literal `"ok"` per the audit — the missing-Pre case is an
 * *observability* gap, not a tool error; the tool's actual outcome is
 * preserved verbatim in `result_excerpt_redacted`. `latency_ms` is 0
 * because no Pre means no measurable Pre→Post duration; callers that
 * have Post-side `duration_ms` from Claude Code's hook payload may
 * pass it via `latency_ms_override`.
 *
 * This function is the single non-paired emit path for the post
 * handler; `buildOrphanedToolCall` covers the inverse case (sweep of
 * unmatched Pre records older than 5 min). Conflating the two is the
 * audit-conformance bug Codex G-lane round 2 caught.
 */
export function buildToolCallFromPostOnly(opts: {
  ts_post: string;
  run_id: string;
  tool: ToolCallTool;
  result_excerpt_redacted: string;
  lane_id?: string;
  latency_ms_override?: number;
  tokens_in?: number;
  tokens_out?: number;
}): ToolCallEvent {
  const out: ToolCallEvent = {
    ts: opts.ts_post,
    event: "tool_call",
    run_id: opts.run_id,
    tool: opts.tool,
    command_redacted: "",
    status: "ok",
    latency_ms: typeof opts.latency_ms_override === "number"
      ? opts.latency_ms_override
      : 0,
    result_excerpt_redacted: opts.result_excerpt_redacted,
  };
  if (opts.lane_id !== undefined) out.lane_id = opts.lane_id;
  if (opts.tokens_in !== undefined) out.tokens_in = opts.tokens_in;
  if (opts.tokens_out !== undefined) out.tokens_out = opts.tokens_out;
  return out;
}

/**
 * Sweep result — both the raw orphan entries (for caller diagnostics)
 * and the contract-shaped `tool_call` events ready to append to the
 * JSONL log. Callers that respect the contract simply iterate
 * `events`; callers that want the original `ts_pre` etc. iterate
 * `orphans`.
 */
export interface OrphanSweepResult {
  orphans: SidecarPreEntry[];
  events: ToolCallEvent[];
}

/**
 * Sweep sidecar entries older than `maxAgeMs` (default 5 minutes per
 * architect contract) and return both the raw orphans AND the
 * contract-shaped `tool_call` events for direct append to the live
 * log. Architect audit §1b enforces:
 *   - `status: "err"`
 *   - `latency_ms: -1`
 *   - `result_excerpt_redacted: ORPHAN_RESULT_EXCERPT`
 *
 * Sweep is idempotent and safe to call on every PostToolUse hook
 * invocation. Malformed sidecar lines (unparseable JSON) are dropped
 * silently — there is no `ts_pre` to age them against, so they cannot
 * be triaged.
 */
export function sweepOrphanedSidecar(
  runDir: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = 5 * 60 * 1000,
): SidecarPreEntry[] {
  return sweepOrphanedSidecarFull(runDir, nowMs, maxAgeMs).orphans;
}

/**
 * Same as `sweepOrphanedSidecar` but also returns the synthesized
 * `tool_call` events. Prefer this in new callers — the architect
 * contract requires the events to be emitted, not just collected.
 */
export function sweepOrphanedSidecarFull(
  runDir: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = 5 * 60 * 1000,
): OrphanSweepResult {
  const path = sidecarPath(runDir);
  if (!existsSync(path)) return { orphans: [], events: [] };

  const apply = (text: string): { orphans: SidecarPreEntry[]; rest: string } => {
    const lines = text.split("\n");
    const orphans: SidecarPreEntry[] = [];
    const kept: string[] = [];
    for (const raw of lines) {
      if (raw.length === 0) continue;
      try {
        const parsed = JSON.parse(raw) as SidecarPreEntry;
        const tsMs = Date.parse(parsed.ts_pre);
        if (Number.isFinite(tsMs) && nowMs - tsMs > maxAgeMs) {
          orphans.push(parsed);
          continue;
        }
        kept.push(raw);
      } catch {
        // Malformed line; drop it (no way to know its age).
        continue;
      }
    }
    const rest = kept.length === 0 ? "" : kept.join("\n") + "\n";
    return { orphans, rest };
  };

  let orphans: SidecarPreEntry[];
  if (process.platform === "win32") {
    const text = readFileSync(path, "utf8");
    const out = apply(text);
    writeFileSync(path, out.rest);
    orphans = out.orphans;
  } else {
    orphans = withStableLock(runDir, () => {
      const text = readFileSync(path, "utf8");
      const out = apply(text);
      writeFileSync(path, out.rest);
      return out.orphans;
    });
  }
  const events = orphans.map(buildOrphanedToolCall);
  return { orphans, events };
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

