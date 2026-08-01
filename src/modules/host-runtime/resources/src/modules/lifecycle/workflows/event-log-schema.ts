/**
 * log-jsonl-schema.ts — Event type definitions, constants, and ID validators.
 *
 * Single responsibility: the SCHEMA layer of the v1.4 telemetry log.
 * Split from log-jsonl.ts (M9 behavior-neutral decomposition, Wave 3 split-5).
 *
 * Consumers import from log-jsonl.ts (the re-export shim); this module is an
 * implementation detail. Do not import directly from outside hooks/lib/v1.4/.
 *
 * LOC target: ~250 (schema only; no I/O, no fs, no lock dependencies).
 */

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
export const TOOL_CALL_TOOL_VALUES = Object.freeze([
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
] as const);
export type ToolCallTool = (typeof TOOL_CALL_TOOL_VALUES)[number];

/**
 * The 12 canonical Claude Code hook events per schema doc §8. Validators
 * reject other values; future hooks require a schema bump.
 */
export const HOOK_EVENT_NAMES = Object.freeze([
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
] as const);
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
  /** One of "G-spec" | "G-plan" | "G-diagnose" | "G-lane:<lane-id>" matching /^T[0-9]+[a-z]?-[a-z][a-z-]{0,32}$/. */
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

export const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const LANE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function isSafeRunId(id: string): boolean {
  return RUN_ID_RE.test(id) && id !== "." && id !== "..";
}

export function isSafeLaneId(id: string): boolean {
  return LANE_ID_RE.test(id) && id !== "." && id !== "..";
}

export function assertSafeRunId(id: string): void {
  if (!isSafeRunId(id)) {
    throw new Error(`log-jsonl: invalid run_id ${JSON.stringify(id)}`);
  }
}

export function assertSafeLaneId(id: string): void {
  if (!isSafeLaneId(id)) {
    throw new Error(`log-jsonl: invalid lane_id ${JSON.stringify(id)}`);
  }
}

export function validateEventIds(event: JsonlEvent): void {
  assertSafeRunId(event.run_id);
  if ("lane_id" in event && event.lane_id !== undefined) {
    assertSafeLaneId(event.lane_id);
  }
}
