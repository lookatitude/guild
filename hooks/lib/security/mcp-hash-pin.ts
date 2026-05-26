/**
 * hooks/lib/security/mcp-hash-pin.ts
 *
 * MCP tool-description hash pinning (priority 3 / D-MCP / PI-6 in the v2
 * security ADR). Threat: a malicious or compromised MCP server silently mutates
 * a tool's DESCRIPTION after the operator pinned it (a "rug-pull" / line-jumping
 * prompt-injection vector). The operator pins the expected SHA-256 of each
 * sensitive tool's description in `mcp.tool_description_hashes`; PreToolUse
 * recomputes the live description's hash and gates on drift.
 *
 * ── BIND BY POINTER ──
 * `mcp.tool_description_hashes` schema lives in scripts/read-guild-config.ts
 * (McpBlock / validateMcp). This module only consumes the resolved map.
 *
 * Description source (see followups): the PreToolUse payload does not yet carry
 * the live tool description on every Claude Code build. Resolution order:
 *   1. an explicit description passed by the handler (payload field, when present)
 *   2. a session-captured sidecar map (tool-name → description) the dispatch /
 *      SessionStart layer may write.
 * When a tool is PINNED but its live description cannot be obtained, the result
 * is "unverifiable" — the handler logs it and (by default) lets the call proceed
 * rather than block every MCP call; wiring a reliable description source is the
 * tracked followup that upgrades "unverifiable" to a true fail-closed gate.
 */

import * as crypto from "node:crypto";

/** Claude Code names MCP tools `mcp__<server>__<tool>`. */
export function isMcpTool(toolName: string): boolean {
  return typeof toolName === "string" && toolName.startsWith("mcp__");
}

/** SHA-256 hex of a description string (the canonical pin format). */
export function hashDescription(description: string): string {
  return crypto.createHash("sha256").update(description, "utf8").digest("hex");
}

export type McpVerifyStatus = "unpinned" | "match" | "mismatch" | "unverifiable";

export interface McpVerifyResult {
  status: McpVerifyStatus;
  /** The pinned hash (when one exists). */
  pinned?: string;
  /** The computed hash of the live description (when obtainable). */
  actual?: string;
}

/**
 * Verify a tool's live description against its pin. Pure.
 *
 * @param toolName          the (mcp__-prefixed) tool name
 * @param liveDescription   the live description text, or undefined if unobtainable
 * @param pins              mcp.tool_description_hashes (tool-name → SHA-256)
 */
export function verifyMcpDescription(
  toolName: string,
  liveDescription: string | undefined,
  pins: Record<string, string>,
): McpVerifyResult {
  const pinned = pins[toolName];
  if (typeof pinned !== "string" || pinned.length === 0) return { status: "unpinned" };
  if (typeof liveDescription !== "string") return { status: "unverifiable", pinned };
  const actual = hashDescription(liveDescription);
  return {
    status: actual.toLowerCase() === pinned.toLowerCase() ? "match" : "mismatch",
    pinned,
    actual,
  };
}
