// v1.4.0 adversarial-loops — escalation copy + AskUserQuestion payload +
// backwards-compat fallback.
//
// Architect contract (verbatim, see benchmark/plans/v1.4-loop-skill-contracts.md
// §"Cap-hit escalation copy" + §"AskUserQuestion payload shape" +
// §"Backwards-compat fallback").
//
// Three escalation labels — exact strings — used at every escalation site:
//   force-pass   → accept artifact as-is, log unresolved questions to
//                  assumptions.md, proceed to the next phase.
//   extend-cap   → extend cap by N rounds (user supplies N), continue.
//   rework       → abort current loop, return control to the producing
//                  skill with the unresolved questions as input.
//
// Verify-done greps for `force-pass`, `extend-cap`, `rework` literally.

/**
 * The three escalation option labels — verbatim, in canonical order.
 * Verify-done greps for each literal.
 */
export const ESCALATION_LABELS = ["force-pass", "extend-cap", "rework"] as const;
export type EscalationLabel = (typeof ESCALATION_LABELS)[number];

/**
 * Architect-pinned description text for each option. qa pins these
 * strings literally; do not edit without updating the contract doc.
 */
export const ESCALATION_DESCRIPTIONS = {
  "force-pass":
    "Accept the artifact as-is; log unresolved questions to assumptions.md; proceed.",
  "extend-cap": "Extend the cap by N rounds (you'll be asked for N).",
  rework:
    "Abort the current loop; return control to the producing skill with the unresolved questions.",
} as const;

/** AskUserQuestion option shape — matches Claude Code's tool-API. */
export interface AskUserQuestionOption {
  label: EscalationLabel;
  description: string;
}

/** Single AskUserQuestion question record. */
export interface AskUserQuestionQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: AskUserQuestionOption[];
}

/** Top-level AskUserQuestion payload shape. */
export interface AskUserQuestionPayload {
  questions: AskUserQuestionQuestion[];
}

/**
 * Build the binding AskUserQuestion payload for the primary escalation
 * dialog (cap-hit / malformed-termination ×2 / restart-cap-hit).
 *
 * `questionText` is the context-specific question string the orchestrator
 * supplies — it should name the lane/phase + reason. `header`, `multiSelect`,
 * and the three `options` are fixed by the contract.
 */
export function buildEscalationPayload(
  questionText: string,
): AskUserQuestionPayload {
  return {
    questions: [
      {
        question: questionText,
        header: "Loop escalation",
        multiSelect: false,
        options: [
          {
            label: "force-pass",
            description: ESCALATION_DESCRIPTIONS["force-pass"],
          },
          {
            label: "extend-cap",
            description: ESCALATION_DESCRIPTIONS["extend-cap"],
          },
          {
            label: "rework",
            description: ESCALATION_DESCRIPTIONS.rework,
          },
        ],
      },
    ],
  };
}

/**
 * Two-step `extend-cap` follow-up: when the user picks `extend-cap`,
 * the orchestrator dispatches a second AskUserQuestion asking for N.
 *
 * The 4 default options are fixed: 4 / 8 / 16 / custom.
 * `custom` triggers a third AskUserQuestion asking for a free-text
 * positive integer ≤ 256 (parsed with up-to-3 retries before falling
 * back to a default of +4 rounds).
 */
export interface ExtendCapOption {
  label: "4" | "8" | "16" | "custom";
  description: string;
}

export interface ExtendCapPayload {
  questions: Array<{
    question: string;
    header: string;
    multiSelect: boolean;
    options: ExtendCapOption[];
  }>;
}

export function buildExtendCapPayload(): ExtendCapPayload {
  return {
    questions: [
      {
        question:
          "How many additional rounds to extend the cap by? (positive integer ≤ 256)",
        header: "Loop escalation — extend cap",
        multiSelect: false,
        options: [
          { label: "4", description: "+4 rounds (typical small extension)" },
          { label: "8", description: "+8 rounds (medium)" },
          { label: "16", description: "+16 rounds (full additional cap)" },
          {
            label: "custom",
            description: "Provide a different positive integer (≤ 256)",
          },
        ],
      },
    ],
  };
}

/**
 * Maximum extension allowed, matching the `--loop-cap` ceiling per
 * v1.4-config.ts (LOOP_CAP_MAX). Re-declared here to keep this module
 * dependency-free.
 */
export const EXTEND_CAP_MAX = 256;

/**
 * Default extension applied when the free-text custom path fails after
 * 3 invalid retries. Architect contract: "fall back to a default
 * extension of 4 rounds + an `assumption_logged` event noting the fall-back".
 */
export const EXTEND_CAP_DEFAULT_FALLBACK = 4;

/**
 * Parse a free-text custom extension. Accepts a base-10 positive integer
 * in [1, EXTEND_CAP_MAX]. Returns null on invalid (caller retries up to
 * 3 times before falling back).
 */
export function parseCustomExtension(raw: string): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(n) || n <= 0 || n > EXTEND_CAP_MAX) return null;
  return n;
}

/**
 * Backwards-compat fallback: AskUserQuestion is unavailable in the
 * runtime. The orchestrator prints the three options to stderr and
 * reads a single line from stdin.
 *
 * This module exposes a pure formatter for the stderr block + a pure
 * parser for the stdin line; the actual stdio plumbing lives in the
 * orchestrator (where it can be mocked).
 */
export interface FallbackPrompt {
  stderrLines: string[];
  expectedLabels: readonly EscalationLabel[];
}

/**
 * Format the stderr prompt block per the architect's contract: a
 * numbered list followed by the three literal labels.
 */
export function formatFallbackPrompt(questionText: string): FallbackPrompt {
  const stderrLines: string[] = [
    `[loop-escalation] ${questionText}`,
    `  1. force-pass — ${ESCALATION_DESCRIPTIONS["force-pass"]}`,
    `  2. extend-cap — ${ESCALATION_DESCRIPTIONS["extend-cap"]}`,
    `  3. rework — ${ESCALATION_DESCRIPTIONS.rework}`,
    `Enter one of: force-pass | extend-cap | rework`,
  ];
  return { stderrLines, expectedLabels: ESCALATION_LABELS };
}

/**
 * Parse a free-text stdin line in the fallback path. Trim + lowercase
 * (case-insensitive match per architect). Return null on no-match —
 * caller re-prompts.
 */
export function parseFallbackChoice(raw: string): EscalationLabel | null {
  if (typeof raw !== "string") return null;
  const norm = raw.trim().toLowerCase();
  if ((ESCALATION_LABELS as readonly string[]).includes(norm)) {
    return norm as EscalationLabel;
  }
  return null;
}

/**
 * The `escalation` JSONL event payload shape (from v1.4-jsonl-schema.md
 * §11). Re-declared here so loop drivers can build the event without
 * dragging in T3c's full schema module (T3c owns the JSONL writer).
 */
export interface EscalationEvent {
  ts: string; // ISO-8601 timestamp.
  event: "escalation";
  run_id: string;
  lane_id?: string; // Absent for L1/L2.
  reason: "cap_hit" | "malformed_termination_x2" | "restart_cap_hit";
  options_offered: readonly EscalationLabel[];
  user_choice: EscalationLabel;
}

/**
 * Build a JSONL `escalation` event. options_offered is ALWAYS the three
 * literal labels in canonical order — the architect contract is explicit:
 * "Always [force-pass, extend-cap, rework]".
 */
export function buildEscalationEvent(args: {
  ts: string;
  run_id: string;
  lane_id?: string;
  reason: EscalationEvent["reason"];
  user_choice: EscalationLabel;
}): EscalationEvent {
  const out: EscalationEvent = {
    ts: args.ts,
    event: "escalation",
    run_id: args.run_id,
    reason: args.reason,
    options_offered: ESCALATION_LABELS,
    user_choice: args.user_choice,
  };
  if (args.lane_id !== undefined) out.lane_id = args.lane_id;
  return out;
}
