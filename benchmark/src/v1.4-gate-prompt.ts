// v1.4.0 adversarial-loops — gate-prompt integration module.
//
// Wraps T3b's `loop-escalation.ts` helpers (`formatFallbackPrompt`,
// `parseFallbackChoice`, `buildEscalationPayload`) with:
//   1. Runtime AskUserQuestion-availability detection (try the call; on
//      tool-not-available → fall back to stdin).
//   2. Stdin re-prompt loop on invalid input (≤ 3 retries; the 4th
//      invalid input escalates with a stderr error + exit 2).
//   3. Unified logging via T3c's `appendEvent({event: "escalation", ...})`
//      so every gate decision (whether AskUserQuestion or stdin) lands in
//      the JSONL audit log.
//
// Architect contract (verbatim, from T3b's deferred handoff §"Followups"
// and the audit doc §"Gate substitution"):
//   - When `--loops=none`, the gate uses free-text confirmation prompts
//     (existing v1.3 behavior). The orchestrator NEVER calls this module.
//   - When `--loops=*` (any other mode), the gate calls this module's
//     `promptUserGate(question, opts)` which:
//       (a) attempts AskUserQuestion (Claude Code tool-API).
//       (b) on tool-not-available, falls back to stdin.
//       (c) re-prompts up to 3 times on invalid input (4th = exit 2).
//       (d) emits the `escalation` JSONL event regardless of path.
//
// The actual AskUserQuestion call lives in the orchestrator (it has
// access to the Agent/Tool surface). This module receives an injected
// `askUserQuestion` callback so tests can substitute a mock; in
// production the orchestrator wires the real tool.

import {
  ESCALATION_LABELS,
  type EscalationLabel,
  buildEscalationPayload,
  formatFallbackPrompt,
  parseFallbackChoice,
  type AskUserQuestionPayload,
} from "./loop-escalation.js";
import {
  appendEvent,
  type EscalationEvent as JsonlEscalationEvent,
} from "./log-jsonl.js";

/** Reason the gate is being invoked — matches the schema's `escalation.reason`. */
export type GateReason =
  | "cap_hit"
  | "malformed_termination_x2"
  | "restart_cap_hit";

/**
 * Result of `promptUserGate`. The caller routes `force-pass` /
 * `extend-cap` / `rework` per the architect's escalation flow.
 */
export interface GateResult {
  user_choice: EscalationLabel;
  /** Which path resolved the choice — useful for ops triage. */
  source: "ask-user-question" | "stdin-fallback";
  /** Number of stdin re-prompts consumed (0 on AskUserQuestion happy path). */
  retries: number;
}

/**
 * Architect-pinned literal: when stdin re-prompts hit the 4th invalid
 * input, this is the stderr message and the process exits 2. Tests grep
 * for this string verbatim.
 */
export const STDIN_RETRY_LIMIT_MSG =
  "error: gate-prompt exhausted 3 stdin retries; aborting (exit 2). Set --loops=none to disable adversarial loops.";

/**
 * Maximum stdin re-prompts before exit-2. Architect contract: 3 retries
 * total (i.e. 4 attempts: 1 initial + 3 retries = 4). The 4th invalid
 * input escalates with a stderr error + exit 2.
 */
export const STDIN_MAX_RETRIES = 3 as const;

/**
 * AskUserQuestion call shape — matches Claude Code's tool API. The
 * runtime returns either an array of selected option labels OR throws
 * a "tool-not-available" error which the wrapper catches and falls
 * back to stdin.
 */
export type AskUserQuestionCallback = (
  payload: AskUserQuestionPayload,
) => Promise<readonly string[]>;

/**
 * Stdin reader callback. Tests inject a queue of canned lines; the
 * production wiring uses Node's readline. Returns the raw line; the
 * wrapper trims/normalises via `parseFallbackChoice`.
 */
export type StdinReadLine = () => Promise<string>;

/**
 * Logging callback. Production uses T3c's `appendEvent`; tests inject
 * an in-memory recorder. The default routes to `appendEvent` directly.
 */
export type EscalationLogger = (params: {
  runDir: string;
  ts: string;
  run_id: string;
  lane_id?: string;
  reason: GateReason;
  user_choice: EscalationLabel;
}) => void;

export interface PromptUserGateOptions {
  runDir: string;
  run_id: string;
  lane_id?: string;
  reason: GateReason;
  /** When undefined → tool unavailable → straight to stdin fallback. */
  askUserQuestion?: AskUserQuestionCallback;
  /** When undefined → cannot fall back; throws on AskUserQuestion failure. */
  readStdinLine?: StdinReadLine;
  /** Override logger; defaults to T3c's appendEvent. */
  logger?: EscalationLogger;
  /** Override stderr writer; defaults to process.stderr. */
  stderr?: { write: (s: string) => void };
  /** Override exit-2 hook; defaults to process.exit(2). Tests inject a throw. */
  abort?: () => never;
}

/**
 * Default logger — routes to T3c's appendEvent directly.
 *
 * Builds the JSONL `escalation` event in the schema's exact shape
 * (`options_offered` as the canonical 3-tuple) — `loop-escalation.ts`'s
 * `buildEscalationEvent` returns a wider `readonly EscalationLabel[]`
 * type that doesn't satisfy the JSONL writer's stricter tuple. We
 * construct the tuple inline to keep both modules' contracts intact.
 */
function defaultLogger(params: {
  runDir: string;
  ts: string;
  run_id: string;
  lane_id?: string;
  reason: GateReason;
  user_choice: EscalationLabel;
}): void {
  const event: JsonlEscalationEvent = {
    ts: params.ts,
    event: "escalation",
    run_id: params.run_id,
    reason: params.reason,
    options_offered: ["force-pass", "extend-cap", "rework"] as const,
    user_choice: params.user_choice,
    ...(params.lane_id !== undefined ? { lane_id: params.lane_id } : {}),
  };
  appendEvent(params.runDir, event);
}

/**
 * Detect "AskUserQuestion is unavailable" from a thrown error. The host
 * runtime signals unavailability via either:
 *   - throwing an Error whose .message contains "tool-not-available"
 *     (case-insensitive), OR
 *   - throwing an Error whose .name is "ToolNotAvailableError", OR
 *   - the callback being undefined (host opts out of providing it).
 *
 * The first two cases let the orchestrator decide HOW to signal
 * unavailability without locking us to a single error shape; the third
 * is the explicit opt-out path.
 */
export function isToolUnavailable(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (err instanceof Error) {
    if (err.name === "ToolNotAvailableError") return true;
    const msg = err.message.toLowerCase();
    if (msg.includes("tool-not-available") || msg.includes("tool not available")) {
      return true;
    }
    if (msg.includes("askuserquestion") && msg.includes("unavailable")) {
      return true;
    }
  }
  return false;
}

/**
 * Extract the chosen label from an AskUserQuestion result. The tool
 * returns an array of selected option labels; multiSelect is false in
 * `buildEscalationPayload`, so the array has exactly one entry.
 *
 * Defensive: empty array, missing label, off-enum label all return
 * `null` — caller falls back to stdin.
 */
export function extractAskUserChoice(
  selected: readonly string[],
): EscalationLabel | null {
  if (!Array.isArray(selected) || selected.length === 0) return null;
  const first = selected[0];
  if (typeof first !== "string") return null;
  const norm = first.trim().toLowerCase();
  if ((ESCALATION_LABELS as readonly string[]).includes(norm)) {
    return norm as EscalationLabel;
  }
  return null;
}

/**
 * Format the question text. The architect contract supplies a phase /
 * lane / reason context; we render a single string the user sees in
 * both AskUserQuestion (as `question` field) and stdin fallback (as
 * the leading line of the stderr block).
 */
export function buildQuestionText(args: {
  reason: GateReason;
  lane_id?: string;
  context?: string;
}): string {
  const subject =
    args.lane_id !== undefined ? `lane '${args.lane_id}'` : "phase";
  const reasonText = (() => {
    switch (args.reason) {
      case "cap_hit":
        return "the loop hit its cap";
      case "malformed_termination_x2":
        return "the producing skill emitted two consecutive malformed terminations";
      case "restart_cap_hit":
        return "the restart counter exhausted its cap";
    }
  })();
  const tail = args.context !== undefined && args.context.length > 0
    ? ` — ${args.context}`
    : "";
  return `Adversarial loop on ${subject}: ${reasonText}${tail}. How do you want to proceed?`;
}

/**
 * Top-level gate entry. Tries AskUserQuestion first; on tool-not-available
 * falls back to stdin with up to 3 re-prompts; emits an `escalation`
 * JSONL event for every resolved choice.
 *
 * Throws a TypeError if no `readStdinLine` is provided AND
 * `askUserQuestion` is unavailable — there's no path to a choice.
 */
export async function promptUserGate(
  question: string,
  opts: PromptUserGateOptions,
): Promise<GateResult> {
  const logger = opts.logger ?? defaultLogger;
  const stderr = opts.stderr ?? process.stderr;
  const abort =
    opts.abort ??
    (() => {
      process.exit(2);
    });

  // ── Path 1: AskUserQuestion ────────────────────────────────────────
  if (opts.askUserQuestion !== undefined) {
    try {
      const payload = buildEscalationPayload(question);
      const selected = await opts.askUserQuestion(payload);
      const choice = extractAskUserChoice(selected);
      if (choice !== null) {
        logger({
          runDir: opts.runDir,
          ts: new Date().toISOString(),
          run_id: opts.run_id,
          ...(opts.lane_id !== undefined ? { lane_id: opts.lane_id } : {}),
          reason: opts.reason,
          user_choice: choice,
        });
        return {
          user_choice: choice,
          source: "ask-user-question",
          retries: 0,
        };
      }
      // Empty / off-enum selection — fall through to stdin (treated as
      // "host returned an unusable response").
    } catch (err) {
      if (!isToolUnavailable(err)) {
        // Unexpected error — re-throw. We don't silently swallow real
        // tool failures (different from "tool not present").
        throw err;
      }
      // Tool unavailable — fall through to stdin.
    }
  }

  // ── Path 2: stdin fallback ─────────────────────────────────────────
  if (opts.readStdinLine === undefined) {
    throw new TypeError(
      "promptUserGate: AskUserQuestion unavailable and no readStdinLine fallback provided",
    );
  }

  const prompt = formatFallbackPrompt(question);
  for (const line of prompt.stderrLines) {
    stderr.write(line + "\n");
  }
  for (let attempt = 0; attempt <= STDIN_MAX_RETRIES; attempt++) {
    const raw = await opts.readStdinLine();
    const choice = parseFallbackChoice(raw);
    if (choice !== null) {
      logger({
        runDir: opts.runDir,
        ts: new Date().toISOString(),
        run_id: opts.run_id,
        ...(opts.lane_id !== undefined ? { lane_id: opts.lane_id } : {}),
        reason: opts.reason,
        user_choice: choice,
      });
      return {
        user_choice: choice,
        source: "stdin-fallback",
        retries: attempt,
      };
    }
    // Invalid — re-prompt unless we've used the last retry.
    if (attempt < STDIN_MAX_RETRIES) {
      stderr.write(
        `Invalid choice. Enter one of: ${ESCALATION_LABELS.join(" | ")}\n`,
      );
    }
  }

  // 4th invalid input — exit 2.
  stderr.write(STDIN_RETRY_LIMIT_MSG + "\n");
  abort();
  // Unreachable — `abort` is `never`. Keep TypeScript happy.
  throw new Error("unreachable: abort() did not exit");
}
