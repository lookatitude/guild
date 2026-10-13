/**
 * hooks/lib/loop-events.ts — the four T09 work-loop event kinds, hook side
 * (KTD38 / R53).
 *
 *     Harvest is observable on the EXISTING JSONL. Additive structured events:
 *     harvest, redirect, CAS, curator. No third plugin↔benchmark log.
 *
 * That last sentence is the whole point of this module. The four kinds already
 * exist on `guild.jsonl_event` and the knowledge domain already emits them from
 * its own writers; what was missing was a hook-side door, and the risk of adding
 * one is that it grows into a second log. So this module has no writer of its
 * own: it validates the kind and hands the event to `appendEvent`, the same
 * function `tool_call` and `hook_event` go through, landing on the same
 * `<runDir>/logs/v1.4-events.jsonl`.
 *
 * Validation is a closed set, not a schema check. The reader on the other end is
 * LENIENT by design (an unknown kind is skipped, not fatal), which is exactly
 * why the WRITE side must be strict: a typo'd kind would be silently dropped by
 * the reader and the event would simply never exist.
 */

import { appendEvent, type JsonlEvent } from "./v1.4/log-jsonl.js";

/** The four additive kinds. Nothing else may be emitted through this door. */
export const LOOP_EVENT_KINDS = Object.freeze([
  "harvest_event",
  "redirect_event",
  "cas_event",
  "curator_event",
] as const);

export type LoopEventKind = (typeof LOOP_EVENT_KINDS)[number];

export type LoopEvent = Extract<JsonlEvent, { event: LoopEventKind }>;

export function isLoopEventKind(value: unknown): value is LoopEventKind {
  return typeof value === "string" && (LOOP_EVENT_KINDS as readonly string[]).includes(value);
}

export type EmitLoopEventResult =
  | { emitted: true }
  | { emitted: false; reason: string };

/**
 * Append one work-loop event to the run's EXISTING event log.
 *
 * Never throws: observability may not take a hook down. A refusal names its
 * reason so a test can tell "the kind was rejected" from "the append failed",
 * which a boolean could not.
 */
export function emitLoopEvent(runDir: string, event: LoopEvent): EmitLoopEventResult {
  if (!isLoopEventKind((event as { event?: unknown }).event)) {
    return {
      emitted: false,
      reason: `not a work-loop event kind: ${String((event as { event?: unknown }).event)}`,
    };
  }
  try {
    appendEvent(runDir, event as JsonlEvent);
    return { emitted: true };
  } catch (err) {
    return { emitted: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
