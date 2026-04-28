// v1.4.0 adversarial-loops — DEPRECATED test-helper module.
//
// ──────────────────────────────────────────────────────────────────────
// T3d-RECONCILIATION NOTE (post-T3c integration)
// ──────────────────────────────────────────────────────────────────────
//
// T3c shipped `benchmark/src/log-jsonl.ts` with the production
// `appendEvent()` writer. The PRODUCTION integration path is:
//
//   import { appendEvent } from "./log-jsonl.js";
//   appendEvent(runDir, { ts, event, run_id, ... });
//
// This stub now exists ONLY for two narrow purposes:
//   1. The `LoopJsonlAppender` interface remains imported as a TYPE by
//      `loop-drivers.ts` for dependency-injection ergonomics — passing
//      a typed appender into `runLoopClarify` / `runLoopPlanReview` /
//      `runLoopImplement` is a stable boundary that the production
//      orchestrator can satisfy with a thin `log-jsonl.ts` wrapper.
//   2. `InMemoryLoopJsonlAppender` is the test-only buffer the 3 loop
//      driver test files use to assert event emission without touching
//      disk. Removing it would force a 3-test-file rewrite that is
//      out of scope for T3d-backend-platform's surgical-changes
//      contract.
//
// New callers MUST import from `log-jsonl.ts` directly. The stub's
// event type definitions are kept in sync with the real schema (any
// drift is caught by the validator + observability-coverage tests).
//
// REMOVAL ROADMAP: post-v1.4, when T3b's loop-drivers and tests
// migrate to depend on `log-jsonl.ts` directly (or a thin shim like
// `LoopJsonlAppender = { append: (e: JsonlEvent) => void }`), this
// file deletes cleanly.

import type { EscalationEvent } from "./loop-escalation.js";

/**
 * `loop_round_start` event payload — v1.4-jsonl-schema.md §5.
 */
export interface LoopRoundStartEvent {
  ts: string;
  event: "loop_round_start";
  run_id: string;
  /** Synthetic for L1/L2 — `phase:brainstorm` or `phase:plan`. */
  lane_id: string;
  loop_layer: "L1" | "L2" | "L3" | "L4" | "security-review";
  round_number: number;
  cap: number;
}

/**
 * `loop_round_end` event payload — v1.4-jsonl-schema.md §6.
 */
export interface LoopRoundEndEvent {
  ts: string;
  event: "loop_round_end";
  run_id: string;
  lane_id: string;
  loop_layer: "L1" | "L2" | "L3" | "L4" | "security-review";
  round_number: number;
  terminated:
    | "satisfied"
    | "malformed_termination"
    | "cap_hit"
    | "escalation"
    | "error";
  terminator: string;
}

/**
 * `assumption_logged` event — v1.4-jsonl-schema.md §10.
 */
export interface AssumptionLoggedEvent {
  ts: string;
  event: "assumption_logged";
  run_id: string;
  lane_id: string;
  specialist: string;
  assumption_text: string;
}

/** Union of all event types this stub knows about. */
export type LoopEvent =
  | LoopRoundStartEvent
  | LoopRoundEndEvent
  | AssumptionLoggedEvent
  | EscalationEvent;

/**
 * Minimal append-event interface. T3c's real `log-jsonl.ts` will export
 * a function with this signature; loop drivers receive an instance via
 * dependency-injection so tests can substitute a buffer.
 *
 * The implementation contract (T3c's responsibility):
 *   - Append one JSON object per line to `<runDir>/logs/run.jsonl`.
 *   - Use the SAME lockfile as counter-store (`<runDir>/logs/.lock`).
 *   - Atomic-rename pattern for rotations; never partial-line writes.
 *   - Every event has the envelope `{ ts, event, run_id }` per schema.
 */
export interface LoopJsonlAppender {
  append(event: LoopEvent): void;
}

/**
 * In-memory implementation — useful for tests + as a placeholder until
 * T3c's real writer lands. Records every event in `events` for assertion;
 * never touches disk.
 */
export class InMemoryLoopJsonlAppender implements LoopJsonlAppender {
  readonly events: LoopEvent[] = [];

  append(event: LoopEvent): void {
    this.events.push(event);
  }

  byType<T extends LoopEvent["event"]>(type: T): Extract<LoopEvent, { event: T }>[] {
    return this.events.filter((e) => e.event === type) as Extract<
      LoopEvent,
      { event: T }
    >[];
  }

  clear(): void {
    this.events.length = 0;
  }
}

/**
 * No-op appender — useful for callers that want to disable JSONL logging
 * (e.g., dry-run paths, tests that don't care about the log).
 */
export class NoopLoopJsonlAppender implements LoopJsonlAppender {
  append(_event: LoopEvent): void {
    // Intentional no-op.
  }
}
