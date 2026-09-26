// CANONICAL: Guild telemetry recorder (F-3 / ADR v2-observability §F-3).
// Single source of truth; scripts import this copy via ../hooks/lib/v1.4/.
// Do not re-vendor.
//
// v1.4.0 adversarial-loops — JSONL log writer.
//
// Implements the binding contract from
// `guild-benchmark/plans/v1.4-jsonl-schema.md` + the architect's stable-lockfile
// race-control design (ADR-009 §Decision §4).
//
// Outputs:
//   live log:        <runDir>/logs/v1.4-events.jsonl
//   archives:        <runDir>/logs/archive/v1.4-events.<N>.jsonl.gz
//   lockfile:        <runDir>/logs/.lock              (stable, zero-byte, permanent)
//   exclusion:       <runDir>/logs/.lock.exclusion    (sibling O_EXCL sentinel)
//   sidecar:         <runDir>/logs/tool-call-pre.jsonl  (PreToolUse pairing)
//
// ── Wave 3 split-5: M9 behavior-neutral decomposition ──────────────────
// This file is now a THIN RE-EXPORT SHIM. The implementation is split across:
//   log-jsonl-schema.ts  — event types, constants, ID validators
//   log-jsonl-writer.ts  — path helpers, append/rotate/reader
//   log-jsonl-sidecar.ts — PreToolUse/PostToolUse pairing
//
// The PUBLIC API (every symbol below) is IDENTICAL to the pre-split surface.
// ──────────────────────────────────────────────────────────────────────────

// ── Schema (types, constants, ID validators) ──────────────────────────────
export type {
  Phase,
  LoopLayer,
  ToolCallTool,
  HookEventName,
  PhaseStartEvent,
  PhaseEndEvent,
  SpecialistDispatchEvent,
  SpecialistReceiptEvent,
  LoopRoundStartEvent,
  LoopRoundEndEvent,
  ToolCallEvent,
  HookEvent,
  GateDecisionEvent,
  AssumptionLoggedEvent,
  EscalationEvent,
  CodexReviewRoundEvent,
  JsonlEvent,
} from "./event-log-schema.js";

export {
  TOOL_CALL_TOOL_VALUES,
  HOOK_EVENT_NAMES,
  EVENT_TYPES,
  RUN_ID_RE,
  LANE_ID_RE,
  isSafeRunId,
  isSafeLaneId,
} from "./event-log-schema.js";

// ── Writer (path helpers, append, rotate, reader) ─────────────────────────
export type {
  AppendOptions,
  ReadSkipRecord,
  ReadAllOptions,
} from "./event-log-writer.js";

export {
  initStableLockfile,
  liveLogPath,
  archiveDir,
  archivePath,
  lockPath,
  sidecarPath,
  laneFallbackPath,
  summaryPath,
  ROTATION_THRESHOLD_BYTES,
  appendEvent,
  nextRotationIndex,
  rotate,
  snapshotLiveLog,
  listArchives,
  readArchive,
  readAllEvents,
  lockfileInode,
  lockfileSize,
} from "./event-log-writer.js";

// ── Sidecar (PreToolUse/PostToolUse pairing) ──────────────────────────────
export type {
  SidecarPreEntry,
  SidecarAppendOptions,
  SidecarMatchKey,
  OrphanSweepResult,
} from "./event-log-sidecar.js";

export {
  SIDECAR_MAX_BYTES,
  appendSidecarPre,
  consumeSidecarPre,
  buildToolCallFromPair,
  ORPHAN_RESULT_EXCERPT,
  ORPHAN_LATENCY_MS,
  buildOrphanedToolCall,
  buildToolCallFromPostOnly,
  sweepOrphanedSidecar,
  sweepOrphanedSidecarFull,
} from "./event-log-sidecar.js";
