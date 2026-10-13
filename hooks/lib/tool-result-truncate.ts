/**
 * hooks/lib/tool-result-truncate.ts — the KTD26 tool-result firewall.
 *
 * "Tool stdout/stderr entering T1 or T0 is truncated to 2000 tokens (remainder
 * written to the run tree, pointer only)."
 *
 * The rule is about a BOUNDARY, not about a tool: a 50k-token test log is fine
 * where it is produced and fine on disk — it is only a defect once it crosses
 * into a Team Lead's or the orchestrator's context, because that context is the
 * scarce one. So the function here takes the result plus the run tree, writes
 * the whole thing down, and returns the ≤2000-token pointer that crosses.
 *
 * The full log filename is derived from the tool and a caller-supplied id rather
 * than from the content, so a rehydrating or auditing reader can find the bytes
 * for a specific call instead of grepping a pile.
 */

import * as path from "node:path";

import { KTD26_TOKEN_CAP, estimateTokens, truncateWithPointer } from "./token-cap.js";

/** Re-exported so callers state the cap they are honouring by name. */
export { KTD26_TOKEN_CAP, estimateTokens };

/** Where a truncated result's full bytes live under a run directory. */
export function toolResultLogPath(runDir: string, toolName: string, id: string): string {
  const safeTool = toolName.replace(/[^A-Za-z0-9._-]/g, "-") || "tool";
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, "-") || "call";
  return path.join(runDir, "tool-results", `${safeTool}-${safeId}.log`);
}

export interface ToolResultForParentInput {
  /** The raw tool stdout/stderr, however large. */
  text: string;
  /** Tool name, for the log filename and the pointer label. */
  toolName: string;
  /** Stable id for this call (span id, attempt id, timestamp). */
  id: string;
  /** Run directory the full bytes are written under. Absent ⇒ no log, still capped. */
  runDir?: string;
  cap?: number;
}

export interface ToolResultForParent {
  /** Safe to put in a T1/T0 context: ≤ cap tokens, pointer included. */
  text: string;
  truncated: boolean;
  original_tokens: number;
  tokens: number;
  log_path: string | null;
}

/**
 * Cap a tool result on its way to a parent tier.
 *
 * Under the cap this is the identity (no file written, no pointer added) — the
 * firewall must not tax the common small result.
 */
export function truncateToolResultForParent(
  input: ToolResultForParentInput,
): ToolResultForParent {
  const cap = input.cap ?? KTD26_TOKEN_CAP;
  const logPath =
    input.runDir === undefined
      ? undefined
      : toolResultLogPath(input.runDir, input.toolName, input.id);
  const r = truncateWithPointer({
    text: input.text,
    cap,
    ...(logPath === undefined ? {} : { logPath }),
    label: `${input.toolName} result`,
  });
  return {
    text: r.text,
    truncated: r.truncated,
    original_tokens: r.original_tokens,
    tokens: r.tokens,
    log_path: r.log_path,
  };
}

/**
 * Refuse an over-cap payload outright.
 *
 * The companion to the truncator, for a seam that should never have been handed
 * an uncapped result in the first place (the shape `assertNoSpecialistBundle`
 * takes in the knowledge domain). Throws rather than silently truncating,
 * because at that seam a big payload is a caller defect, not a big tool.
 */
export function assertToolResultCapped(payload: unknown, where = "parent context"): void {
  const text =
    typeof payload === "string" ? payload : payload === undefined ? "" : JSON.stringify(payload);
  const tokens = estimateTokens(text);
  if (tokens > KTD26_TOKEN_CAP) {
    throw new Error(
      `KTD26 violation: a ~${tokens}-token tool result reached ${where} ` +
        `(cap ${KTD26_TOKEN_CAP} + pointer). Route it through truncateToolResultForParent.`,
    );
  }
}
