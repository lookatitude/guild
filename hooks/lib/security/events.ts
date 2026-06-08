/**
 * hooks/lib/security/events.ts
 *
 * Emitter for the `guild.security_event.v1` record.
 *
 * ── BIND BY POINTER ────────────────────────────────────────────────────────
 * `guild.security_event.v1` is REGISTERED in the contract-map (§B-post) and
 * specified in docs/knowledge/decisions/v2-security-and-untrusted-content.md.
 * Those are the canonical sources of truth for the record's semantics. The
 * interface below is the hook-side runtime shape used to WRITE the record; it
 * is self-versioned via `schema_version` so the writer and the contract-map
 * stay coupled by the version token, not by re-spelling the schema.
 *
 * Sink: <runDir>/logs/security-events.jsonl — append-only NDJSON, one record
 * per line, under the resolveGuildRoot-based run dir (same convention as the
 * pre-tool-use telemetry sidecar). The `detail` free-text field is scrubbed
 * through the shared redaction policy before write so a violation record can
 * never itself leak a secret.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGuildRoot } from "../guild-root.js";
import { redactField } from "../v1.4/redact-log.js";
import type { BypassPolicy } from "./config.js";

/** Why a security record was emitted. */
export type SecurityEventType =
  | "capability_scope_violation"
  | "capability_scope_degrade"
  | "bypass_permission_allowed"
  | "mcp_description_mismatch"
  | "mcp_description_unverifiable"
  | "secret_scrub_failure"
  /** HK-08: directive/injection language detected in guild.handoff.v2 free-text. */
  | "injection_attempt_detected"
  /** HK-06: a durable .guild/ write was blocked because the secret scrub failed (fail-CLOSED). */
  | "secret_scrub_blocked";

/** The action Guild took for the gated tool call. */
export type SecurityDecision = "ask" | "deny" | "allow" | "pass"
  /** HK-06: write blocked by fail-CLOSED scrub policy. */
  | "blocked"
  /** HK-06: telemetry write continued with built-in-redacted content (fail-OPEN). */
  | "degraded";

/** Runtime shape of a `guild.security_event.v1` record (canonical: contract-map §B-post). */
export interface SecurityEventV1 {
  schema_version: "guild.security_event.v1";
  ts: string;
  run_id: string;
  /** Lane / specialist that triggered the event (omitted for lead/main-session calls). */
  lane_id?: string;
  event_type: SecurityEventType;
  decision: SecurityDecision;
  /** Tool name the decision applied to ("" when not tool-scoped). */
  tool: string;
  /** Short, redacted human-readable detail. */
  detail: string;
  /** bypass_permissions_policy in force when this was a bypass decision. */
  policy?: BypassPolicy;
  /** Claude Code permission mode at decision time (e.g. "default" | "bypassPermissions" | "degraded"). */
  permission_mode?: string;
  /**
   * HK-07: the dispatch substrate rung (1=team/tmux, 2=agent, 3=subagent, 4=serial)
   * at the time of this security decision. Sourced from GUILD_DISPATCH_RUNG env
   * (set by the orchestrator at specialist dispatch). Absent for lead-session calls.
   */
  dispatch_rung?: string;
}

/** The version token — single point of coupling to contract-map §B-post. */
export const SECURITY_EVENT_SCHEMA_VERSION = "guild.security_event.v1" as const;

/** Fields a caller supplies; the writer stamps schema_version + ts + redacts detail. */
export type SecurityEventInput = Omit<SecurityEventV1, "schema_version" | "ts" | "detail"> & {
  detail?: string;
};

/**
 * Build a fully-formed, redacted `guild.security_event.v1` record. Pure (no
 * I/O) so it is trivially unit-testable.
 */
export function buildSecurityEvent(input: SecurityEventInput): SecurityEventV1 {
  const rec: SecurityEventV1 = {
    schema_version: SECURITY_EVENT_SCHEMA_VERSION,
    ts: new Date().toISOString(),
    run_id: input.run_id,
    event_type: input.event_type,
    decision: input.decision,
    tool: input.tool,
    detail: redactField(input.detail ?? ""),
  };
  if (typeof input.lane_id === "string" && input.lane_id.length > 0) rec.lane_id = input.lane_id;
  if (input.policy !== undefined) rec.policy = input.policy;
  if (typeof input.permission_mode === "string" && input.permission_mode.length > 0) {
    rec.permission_mode = input.permission_mode;
  }
  if (typeof input.dispatch_rung === "string" && input.dispatch_rung.length > 0) {
    rec.dispatch_rung = input.dispatch_rung;
  }
  return rec;
}

/**
 * Append a `guild.security_event.v1` record to
 * `<runDir>/logs/security-events.jsonl`. Best-effort and non-throwing — a
 * logging failure must NEVER change the gate decision the caller already made.
 * Returns true on a successful write, false otherwise.
 *
 * runDir precedence mirrors the other hooks: an explicit runDir wins; callers
 * pass `path.join(resolveGuildRoot(cwd), ".guild", "runs", runId)` when they
 * have only a run id.
 */
export function appendSecurityEvent(runDir: string, record: SecurityEventV1): boolean {
  try {
    const logsDir = path.join(runDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return false;
  }
}

/** Convenience: resolve the run dir from cwd + runId the same way every hook does. */
export function resolveRunDir(cwd: string, runId: string, explicitRunDir?: string): string {
  if (typeof explicitRunDir === "string" && explicitRunDir.length > 0) return explicitRunDir;
  return path.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
}
