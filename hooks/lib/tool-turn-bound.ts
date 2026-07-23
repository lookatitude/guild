/**
 * hooks/lib/tool-turn-bound.ts
 *
 * G5(d) — PreToolUse per-tool lifecycle bound (v23x-deferred-followups
 * rf-wi-05, origin oir-wi-59).
 *
 * The existing UserPromptSubmit gate (hooks/lib/lifecycle-gate.ts) bounds the
 * LEAD's ad-hoc edit activity ACROSS turns (a running count of Bash/Edit/
 * Write/NotebookEdit calls since the last lifecycle touch). Nothing bounds
 * how many tool calls a SINGLE agentic turn can make before it returns
 * control — wi-59 named that per-turn spiral as the real limit that matters:
 * a turn can make dozens of tool calls in a row with no checkpoint at all.
 *
 * Mechanism — deliberately the smallest one that bounds a turn without a new
 * source of truth or a new gate class:
 *
 *   - Turn boundary = the most recent `UserPromptSubmit` line in the run's
 *     OWN canonical event log (`logs/v1.4-events.jsonl`), which
 *     capture-telemetry.ts already writes on every prompt. No new counter
 *     file, no new sentinel.
 *   - Count = completed tool calls strictly after that boundary. Both the
 *     canonical `tool_call` shape (hooks/post-tool-use.ts, the sole canonical
 *     writer) and the legacy `PostToolUse` shape are recognized — the same
 *     dual-shape reasoning hooks/maybe-reflect.ts's gateCheck() already uses,
 *     since the log can carry lines from either era.
 *   - Reading is LENIENT (parse-or-skip each line), mirroring
 *     maybe-reflect.ts's loadEvents — NOT the strict schema-validated
 *     readTraceEvents() reader lifecycle-gate.ts uses, because this file also
 *     legitimately carries the ad-hoc `UserPromptSubmit`/`SubagentStop`
 *     shapes capture-telemetry.ts writes, which do not conform to the strict
 *     v1.4 JsonlEvent union and would be silently dropped by that reader.
 *   - Decision: (calls-so-far + 1) > threshold ⇒ a soft `ask`, NEVER `deny`.
 *     A legitimate wide turn (a big refactor, a broad search) must still be
 *     able to proceed with one confirmation, not get hard-blocked — this is
 *     an advisory checkpoint, not a security gate.
 *   - Fail-open: a missing/unreadable/corrupt log ⇒ count 0 ⇒ never asks.
 *     Bounding a turn must never be the reason a tool call fails.
 *
 * Threshold: GUILD_TOOL_TURN_MAX env override, default DEFAULT_TOOL_TURN_MAX
 * — the same env-override-over-config posture lifecycle-gate.ts's
 * GUILD_LIFECYCLE_GATE_RECENCY_MS uses. Deliberately NOT a new
 * `.guild/settings.json` schema key: the config surface (config-schema.ts /
 * CONFIG_UI_METADATA) is being registered by a PARALLEL lane in the same
 * rollout (rf-wi-01) — this lane stays out of that file entirely.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Default per-turn tool-call bound before a soft confirmation is asked. */
export const DEFAULT_TOOL_TURN_MAX = 40;

/** Resolve the effective per-turn bound: GUILD_TOOL_TURN_MAX env, else the default. */
export function toolTurnMax(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["GUILD_TOOL_TURN_MAX"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_TOOL_TURN_MAX;
}

/** The minimal shape read off each NDJSON line — every field optional (lenient). */
export interface LenientTurnEvent {
  event?: string;
  tool?: string;
}

/**
 * Lenient NDJSON line reader — same posture as maybe-reflect.ts's loadEvents:
 * parse each non-blank line as JSON, silently skip anything that fails to
 * parse. Never throws; a missing file resolves to `[]`.
 */
export function loadTurnEventLines(eventsFile: string): LenientTurnEvent[] {
  let content: string;
  try {
    content = fs.readFileSync(eventsFile, "utf8");
  } catch {
    return [];
  }
  const out: LenientTurnEvent[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as LenientTurnEvent);
    } catch {
      // skip malformed lines — never let a corrupt line throw.
    }
  }
  return out;
}

/**
 * Count of completed tool calls strictly after the most recent
 * `UserPromptSubmit` line — i.e. the current turn's tool-call count SO FAR
 * (not counting the call about to be gated). A run with no recorded prompt
 * boundary counts every tool call seen (run start is the conservative
 * boundary default).
 */
export function countToolCallsThisTurn(events: readonly LenientTurnEvent[]): number {
  let boundary = -1;
  events.forEach((e, i) => {
    if (e.event === "UserPromptSubmit") boundary = i;
  });
  let count = 0;
  for (let i = boundary + 1; i < events.length; i++) {
    const e = events[i];
    if (e.event === "tool_call" || e.event === "PostToolUse") count++;
  }
  return count;
}

export interface ToolTurnBoundResult {
  /** True iff the caller should emit a soft `ask` decision. */
  ask: boolean;
  countSoFar: number;
  wouldBeCount: number;
  threshold: number;
}

/**
 * Evaluate the per-tool turn bound for the run at `runDir`. Never throws — an
 * unreadable/missing log resolves to a non-asking result (fail-open).
 */
export function evaluateToolTurnBound(
  runDir: string,
  env: NodeJS.ProcessEnv = process.env,
): ToolTurnBoundResult {
  const threshold = toolTurnMax(env);
  const eventsFile = path.join(runDir, "logs", "v1.4-events.jsonl");
  const events = loadTurnEventLines(eventsFile);
  const countSoFar = countToolCallsThisTurn(events);
  const wouldBeCount = countSoFar + 1;
  return { ask: wouldBeCount > threshold, countSoFar, wouldBeCount, threshold };
}

/** Render the `ask` reason shown to the user for a per-turn-bound crossing. */
export function buildToolTurnAskReason(result: ToolTurnBoundResult, toolName: string): string {
  return (
    `Guild lifecycle (per-tool bound, G5d): this turn has made ${result.countSoFar} tool ` +
    `call(s); "${toolName}" would be call #${result.wouldBeCount}, over the ` +
    `${result.threshold}-call soft bound (GUILD_TOOL_TURN_MAX). Confirm to continue this ` +
    `turn, or wrap up and return control to the user.`
  );
}
