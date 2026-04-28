// v1.4.0 adversarial-loops — sentinel detection + post-sentinel
// malformed-termination regex set.
//
// Architect contract (verbatim, see benchmark/plans/v1.4-loop-skill-contracts.md
// §"Shared termination contract"):
//
//   Sentinel — exact literal string:
//
//       ## NO MORE QUESTIONS
//
//   - Must appear on its OWN line (entire trimmed line equals the sentinel).
//   - Must appear EXACTLY ONCE (multiple occurrences = malformed_termination).
//   - Everything BEFORE the sentinel is the challenger's substantive analysis.
//   - Everything AFTER the sentinel is subject to the malformed-termination
//     regex set:
//
//   Pattern 1 — lines ending in `?` (unresolved questions):
//       /^.*\?\s*$/m
//
//   Pattern 2 — bullet lines starting with hard-blocker words:
//       /^\s*[-*]\s+(blocker|must fix|cannot proceed|MUST|BLOCKING)\b/im
//
//   Pattern 3 — TODO/FIXME/XXX markers (case-sensitive, word-boundary):
//       /\b(TODO|FIXME|XXX)\b/
//
// If ANY of the three regex patterns matches the post-sentinel region,
// the round terminates as `malformed_termination` and the loop continues.
// Two consecutive `malformed_termination` events escalate.

/**
 * The exact sentinel literal that a challenger must emit on its own line
 * to terminate the loop cleanly.
 *
 * Verbatim from the architect contract; verify-done greps for this string.
 */
export const LOOP_SENTINEL = "## NO MORE QUESTIONS" as const;

/**
 * Pattern 1 — Lines ending in `?` (unresolved questions).
 *
 * Multiline mode (`/m`): `$` matches end-of-line, not just end-of-string.
 * Catches "are you sure?" and similar leftovers in the post-sentinel region.
 *
 * Verbatim regex literal: /^.*\?\s*$/m
 */
export const POST_SENTINEL_PATTERN_1 = /^.*\?\s*$/m;

/**
 * Pattern 2 — Bullet lines starting with hard-blocker words.
 *
 * Multiline + case-insensitive (`/im`): bullets with `-` or `*` followed by
 * one of the listed hard-blocker keywords at a word boundary.
 *
 * Verbatim regex literal: /^\s*[-*]\s+(blocker|must fix|cannot proceed|MUST|BLOCKING)\b/im
 */
export const POST_SENTINEL_PATTERN_2 =
  /^\s*[-*]\s+(blocker|must fix|cannot proceed|MUST|BLOCKING)\b/im;

/**
 * Pattern 3 — TODO/FIXME/XXX markers (case-sensitive, word-boundary).
 *
 * Case-sensitive (no `/i`); word-boundary anchored. Catches dev-leftover
 * markers without false-positiving on words like `Fixmebox` or `autofixme`.
 *
 * Verbatim regex literal: /\b(TODO|FIXME|XXX)\b/
 */
export const POST_SENTINEL_PATTERN_3 = /\b(TODO|FIXME|XXX)\b/;

/**
 * The full ordered set of post-sentinel regexes the malformed-termination
 * classifier runs against the substring AFTER the sentinel.
 */
export const POST_SENTINEL_PATTERNS = [
  POST_SENTINEL_PATTERN_1,
  POST_SENTINEL_PATTERN_2,
  POST_SENTINEL_PATTERN_3,
] as const;

/**
 * Outcome of inspecting a challenger handoff body for the loop sentinel.
 *
 * - `no_sentinel`: the sentinel literal does not appear on its own line.
 *   The loop continues (round was non-terminal).
 * - `clean`: sentinel appears exactly once on its own line AND the
 *   post-sentinel region passes all three malformed regexes.
 * - `malformed_termination`: sentinel appears, but post-sentinel
 *   region matches one or more of the regex set, OR the sentinel
 *   appears multiple times (per architect: multiple occurrences =
 *   malformed_termination).
 */
export type SentinelOutcome =
  | { kind: "no_sentinel" }
  | { kind: "clean"; bodyBeforeSentinel: string; bodyAfterSentinel: string }
  | {
      kind: "malformed_termination";
      reason:
        | "multiple_sentinel_occurrences"
        | "post_sentinel_question"
        | "post_sentinel_blocker_bullet"
        | "post_sentinel_todo_marker";
      bodyBeforeSentinel: string;
      bodyAfterSentinel: string;
      matched: string; // The substring that matched the regex.
    };

/**
 * Detect the sentinel + classify the post-sentinel region.
 *
 * Implementation notes:
 * - The sentinel must equal the entire trimmed line (no leading bullet,
 *   no inline-with-other-text variants).
 * - Multiple sentinel occurrences (any count > 1) is a defect — the
 *   architect calls this out explicitly: "a challenger that emits the
 *   sentinel twice has not committed cleanly".
 * - Empty post-sentinel region (sentinel as the last line, nothing
 *   after) is `clean` — boundary case is intentional.
 */
export function detectSentinel(body: string): SentinelOutcome {
  // Find every line whose entire trimmed content equals the sentinel.
  const lines = body.split("\n");
  const sentinelLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === LOOP_SENTINEL) {
      sentinelLineIndices.push(i);
    }
  }

  if (sentinelLineIndices.length === 0) {
    return { kind: "no_sentinel" };
  }

  // Reconstruct the before/after substrings around the FIRST occurrence
  // (so we can report the matched text on the malformed branch even when
  // the same regex would match earlier text the challenger included as
  // legitimate audit trail).
  const firstIdx = sentinelLineIndices[0] as number;
  const bodyBeforeSentinel = lines.slice(0, firstIdx).join("\n");
  const bodyAfterSentinel = lines.slice(firstIdx + 1).join("\n");

  if (sentinelLineIndices.length > 1) {
    return {
      kind: "malformed_termination",
      reason: "multiple_sentinel_occurrences",
      bodyBeforeSentinel,
      bodyAfterSentinel,
      matched: LOOP_SENTINEL,
    };
  }

  // Apply the three regexes ONLY to the post-sentinel region.
  const m1 = POST_SENTINEL_PATTERN_1.exec(bodyAfterSentinel);
  if (m1) {
    return {
      kind: "malformed_termination",
      reason: "post_sentinel_question",
      bodyBeforeSentinel,
      bodyAfterSentinel,
      matched: m1[0],
    };
  }
  const m2 = POST_SENTINEL_PATTERN_2.exec(bodyAfterSentinel);
  if (m2) {
    return {
      kind: "malformed_termination",
      reason: "post_sentinel_blocker_bullet",
      bodyBeforeSentinel,
      bodyAfterSentinel,
      matched: m2[0],
    };
  }
  const m3 = POST_SENTINEL_PATTERN_3.exec(bodyAfterSentinel);
  if (m3) {
    return {
      kind: "malformed_termination",
      reason: "post_sentinel_todo_marker",
      bodyBeforeSentinel,
      bodyAfterSentinel,
      matched: m3[0],
    };
  }

  return { kind: "clean", bodyBeforeSentinel, bodyAfterSentinel };
}

/**
 * Track consecutive malformed_termination events at a single layer.
 * Two consecutive escalate per the architect contract.
 *
 * Usage: callers maintain an instance per (lane × layer) — or, for L1/L2
 * which have a single global counter, per phase. Calling `record(outcome)`
 * with the result of `detectSentinel` and inspecting the returned
 * `consecutiveMalformed` field tells the caller when to escalate.
 */
export class MalformedRunCounter {
  private streak = 0;

  /**
   * Update the counter from a sentinel outcome and return the new state.
   *
   * - `clean`         → resets streak to 0.
   * - `no_sentinel`   → resets streak to 0 (round was non-terminal; the
   *                     malformed counter only tracks terminal-but-malformed
   *                     rounds, per architect).
   * - `malformed_termination` → streak += 1.
   */
  record(outcome: SentinelOutcome): {
    consecutiveMalformed: number;
    shouldEscalate: boolean;
  } {
    if (outcome.kind === "malformed_termination") {
      this.streak += 1;
    } else {
      this.streak = 0;
    }
    return {
      consecutiveMalformed: this.streak,
      shouldEscalate: this.streak >= 2,
    };
  }

  /** Read the current consecutive-malformed streak without mutating. */
  get consecutive(): number {
    return this.streak;
  }

  /** Reset the streak (e.g., on layer or lane boundary). */
  reset(): void {
    this.streak = 0;
  }
}
