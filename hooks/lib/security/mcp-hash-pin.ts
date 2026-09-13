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

// ---------------------------------------------------------------------------
// Shipped pins (KTD60) — written by `bun run compile`, not by an operator
// ---------------------------------------------------------------------------

/**
 * `runtime/mcp-descriptions.pins.json`, emitted by scripts/compile.ts in the same
 * step that builds `runtime/guild-mcp.js`. Guild's OWN MCP tools are pinned by
 * construction: the binary and the hashes of the descriptions it serves are
 * produced together, so there is no separate `config update-mcp-hashes` ritual
 * and no window where a shipped tool is unpinned.
 *
 * Keyed by SERVER, never by bare tool name. A flat tool→hash map let Guild's pin
 * bind to `mcp__third_party__wiki_search` — a hostile server could take the name
 * `wiki_search` and inherit a pin it never earned, or (worse) publish a tool whose
 * description happened to hash equal. A pin is scoped to the server that declared
 * it and can never travel (codex G-lane r1).
 */
export interface ShippedMcpServerPins {
  /** The D-MCP id this server is launched under (KTD3: wiki | trace). */
  mcp_id: string;
  /** Bare tool name → SHA-256 of its description. */
  tools: Record<string, string>;
}

export interface ShippedMcpPins {
  schema_version: string;
  binary: string;
  binary_sha256: string;
  servers: Record<string, ShippedMcpServerPins>;
}

/** Why a Guild-owned MCP tool could not be verified against a shipped pin. */
export type ShippedPinFailure =
  | "pins_missing"
  | "pins_malformed"
  | "binary_hash_mismatch"
  | "tool_not_pinned";

export interface ShippedPinLookup {
  /** True when the tool belongs to a server the shipped pin file declares. */
  guildOwned: boolean;
  /** The pinned hash, when one was resolved. */
  sha256?: string;
  /** Set when `guildOwned` is true but no usable pin was resolved. */
  failure?: ShippedPinFailure;
}

/**
 * Does `segment` (the `<server>` of `mcp__<server>__<tool>`) name `serverId`?
 *
 * EXACT match only. The suffix rule this replaces (`segment.endsWith("_" + id)`)
 * was meant to tolerate a host prefix, but it let an attacker-chosen server name
 * claim Guild's identity: `mcp__third_party_guild-memory__wiki_search` ends with
 * `_guild-memory` and inherited Guild's pin (codex G-lane r2). A server name is
 * attacker-controlled input; no substring rule over it is safe.
 *
 * The accepted spellings are the closed list in `GUILD_MCP_SERVER_IDS` — the two
 * shipped server ids and the two D-MCP ids the binary is launched under (KTD3) —
 * and nothing else. A host that mangles the name differently fails CLOSED: the
 * tool reads as third-party, so Guild's pin is simply not applied.
 */
export function serverSegmentMatches(segment: string, serverId: string): boolean {
  return segment === serverId;
}

/**
 * Every spelling of a Guild MCP server this build recognises, exactly. Two shipped
 * server ids (`.mcp.json` keys) plus the two D-MCP ids `runtime/guild-mcp.js` is
 * launched under, because a host may name the server after either.
 */
export const GUILD_MCP_SERVER_IDS = [
  "guild-memory",
  "guild-telemetry",
  "wiki",
  "trace",
] as const;

/** Validate the shape the compile step writes. Anything else is malformed. */
export function isWellFormedShippedPins(doc: unknown): doc is ShippedMcpPins {
  if (typeof doc !== "object" || doc === null) return false;
  const d = doc as Partial<ShippedMcpPins>;
  if (typeof d.binary_sha256 !== "string" || d.binary_sha256.length !== 64) return false;
  if (typeof d.servers !== "object" || d.servers === null) return false;
  const entries = Object.entries(d.servers);
  if (entries.length === 0) return false;
  return entries.every(([, v]) =>
    typeof v === "object" && v !== null &&
    typeof (v as ShippedMcpServerPins).mcp_id === "string" &&
    typeof (v as ShippedMcpServerPins).tools === "object" &&
    (v as ShippedMcpServerPins).tools !== null &&
    Object.values((v as ShippedMcpServerPins).tools).every((h) => typeof h === "string" && h.length === 64),
  );
}

/**
 * Resolve a tool against the shipped pins. Pure.
 *
 * `guildOwned` is decided from the SERVER SEGMENT against the declared server ids
 * — so it stays true (and therefore fail-closed) even when the pin file itself is
 * missing or malformed, which is exactly the case where enforcement used to
 * silently switch off. Callers pass `knownServers` for that reason: it is the
 * static list of Guild's own server ids, independent of the file being readable.
 */
export function shippedPinFor(
  toolName: string,
  shipped: ShippedMcpPins | null,
  failure: ShippedPinFailure | undefined,
  knownServers: readonly string[],
): ShippedPinLookup {
  if (!isMcpTool(toolName)) return { guildOwned: false };
  const parts = toolName.split("__");
  const segment = parts[1] ?? "";
  const base = parts.slice(2).join("__");
  const owner = knownServers.find((id) => serverSegmentMatches(segment, id));
  if (!owner || !base) return { guildOwned: false };
  if (!shipped) return { guildOwned: true, failure: failure ?? "pins_missing" };
  // `owner` is a server key (`guild-memory`) or a D-MCP id (`wiki`); the pin file
  // is keyed by server key and carries the D-MCP id on each entry.
  const entry = shipped.servers[owner]
    ?? Object.values(shipped.servers).find((v) => v.mcp_id === owner);
  const sha = entry?.tools[base];
  if (typeof sha !== "string") return { guildOwned: true, failure: "tool_not_pinned" };
  return { guildOwned: true, sha256: sha };
}

/**
 * The pin map PreToolUse enforces for one tool: the project pin if the operator
 * set one, else the shipped pin. Pure; returns a map so the caller keeps using
 * `verifyMcpDescription` unchanged.
 */
export function effectivePins(
  toolName: string,
  projectPins: Record<string, string>,
  lookup: ShippedPinLookup,
): Record<string, string> {
  if (typeof projectPins[toolName] === "string" && projectPins[toolName].length > 0) return projectPins;
  return lookup.sha256 ? { ...projectPins, [toolName]: lookup.sha256 } : projectPins;
}
