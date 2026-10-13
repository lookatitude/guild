/**
 * hooks/lib/token-cap.ts — the KTD26 context-firewall cap, hook side.
 *
 * KTD26: "Tool results into T1/T0 ≤2000 tokens + pointer." The same cap governs
 * a verify-fail stderr excerpt: "Verify-fail stderr follows the same cap; the
 * oracle itself is not truncated on disk."
 *
 * Two rules the shape of this module enforces:
 *
 *  1. **The cap is on what reaches a PARENT, never on what reaches disk.** A
 *     truncation either writes the full bytes to `logPath` first and then hands
 *     back a pointer, or names a `pointer` the caller already streamed the bytes
 *     to. A cap that loses the evidence is a cap that makes the next failure
 *     unreadable.
 *  2. **The pointer is inside the cap.** A "≤2000 token" excerpt plus a footer is
 *     2000-and-a-bit tokens, and the caller that trusted the number is the one
 *     that blows the budget. The head is sized so head + footer fits.
 *
 * The estimator is the shared 4-chars-per-token one every Guild cap is measured
 * with (`src/modules/knowledge` `estimateTokens`). Bound by pointer and kept
 * byte-identical here rather than imported, because this module is linked into
 * the PostToolUse hot path (≤250ms, KTD29) and the knowledge barrel is not.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** KTD26: what a tool result may cost a parent's context. */
export const KTD26_TOKEN_CAP = 2000;

/** The shared 4-chars-per-token estimate every Guild cap is measured with. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

export interface TruncateInput {
  /** The full text. Never mutated, never written to a parent as-is when over cap. */
  text: string;
  /** Token cap for the RETURNED text, footer included. Defaults to KTD26. */
  cap?: number;
  /**
   * Absolute path the full text is written to when truncation happens. The
   * pointer names it, so a reader can get the bytes the excerpt dropped.
   * Omitted (or unwritable) → the pointer says so rather than implying a file.
   */
  logPath?: string;
  /** Short label for the pointer line, e.g. `Bash stdout` or `verify.after_edit`. */
  label?: string;
  /**
   * A log this text is ALREADY on disk in. Names it in the pointer and writes
   * nothing — the case where the bytes were streamed straight to a file and
   * re-writing them from a (possibly tail-only) buffer would replace a complete
   * log with a partial one.
   *
   * Mutually exclusive with `logPath`; when both are given this one wins.
   */
  pointer?: string;
}

export interface TruncateResult {
  /** True when the returned text is an excerpt, not the whole thing. */
  truncated: boolean;
  /** Text safe to put in a parent's context: ≤ cap tokens, footer included. */
  text: string;
  /** Estimated tokens of the ORIGINAL text. */
  original_tokens: number;
  /** Estimated tokens of the returned text. Always ≤ cap. */
  tokens: number;
  /** Where the full text landed, when it did. */
  log_path: string | null;
}

/**
 * Write the full bytes somewhere a reader can find them.
 *
 * Best-effort on purpose: a truncation whose log write fails must still truncate
 * (the cap is a budget, not a favour), and the pointer then reports no file
 * rather than naming one that is not there.
 */
function writeFullLog(logPath: string, text: string): string | null {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, text, "utf8");
    return logPath;
  } catch {
    return null;
  }
}

/**
 * Cap `text` for a parent's context, with the dropped remainder on disk.
 *
 * Under the cap: returned unchanged, nothing written, `truncated: false`.
 * Over the cap: the full text goes to `logPath` and the return is
 * `<head>\n<footer>` where the footer names the log and the dropped size.
 */
export function truncateWithPointer(input: TruncateInput): TruncateResult {
  const cap = input.cap ?? KTD26_TOKEN_CAP;
  const text = input.text;
  const originalTokens = estimateTokens(text);
  if (originalTokens <= cap) {
    return {
      truncated: false,
      text,
      original_tokens: originalTokens,
      tokens: originalTokens,
      log_path: null,
    };
  }

  const written =
    input.pointer !== undefined
      ? input.pointer
      : input.logPath === undefined
        ? null
        : writeFullLog(input.logPath, text);
  const label = input.label ?? "tool result";
  const footer =
    `\n[guild: ${label} truncated to the KTD26 ${cap}-token cap — ` +
    `~${originalTokens} tokens total; full output: ${written ?? "not written (log unavailable)"}]`;

  // Size the head so head + footer is inside the cap. `estimateTokens` trims, so
  // budget on raw length and re-check rather than trusting the arithmetic.
  const footerChars = footer.length;
  const budgetChars = Math.max(0, cap * 4 - footerChars);
  let out = text.slice(0, budgetChars) + footer;
  // Defensive shrink: a footer longer than the whole budget leaves the footer
  // alone, and a hard slice is still better than handing a parent 50k tokens.
  while (estimateTokens(out) > cap && out.length > footerChars) {
    out = text.slice(0, Math.max(0, out.length - footerChars - 64)) + footer;
  }
  if (estimateTokens(out) > cap) out = out.slice(0, cap * 4);

  return {
    truncated: true,
    text: out,
    original_tokens: originalTokens,
    tokens: estimateTokens(out),
    log_path: written,
  };
}
