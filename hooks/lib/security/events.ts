/**
 * hooks/lib/security/events.ts
 *
 * Emitter for the `guild.security_event.v1` record.
 *
 * ── BIND BY POINTER ────────────────────────────────────────────────────────
 * `guild.security_event.v1` is REGISTERED in the contract-map (§B-post) and
 * specified in ADR: v2-security-and-untrusted-content (workspace wiki).
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
  | "secret_scrub_blocked"
  /**
   * D-AUDIT / D-RECALL / D-PROBE-recall: a recalled chunk was flagged by the
   * recall-probe defense and quarantined before reaching the agent context.
   * Emitted by the recall-time probe path (producer: D-RECALL / D-PROBE-recall
   * — being scoped by architect). The event type is registered here so the
   * audit-event family is whole and the host: field (HK-05) is auto-stamped.
   */
  | "recall_quarantine"
  /**
   * #58: a Guild specialist-lane `Agent` dispatch claimed a project-specialist
   * persona (adoption prompt / GUILD_SPECIALIST+GUILD_TASK_ID) but was dispatched
   * as subagent_type="general-purpose" WITHOUT a matching GUILD_AGENT_DEFINITION
   * — a silently persona-stripped dispatch. Blocked fail-closed by the
   * PreToolUse dispatch-integrity guard.
   */
  | "dispatch_attribution_missing"
  /**
   * #56: a Guild specialist lane was dispatched through the in-session `Agent`
   * tool while the run's backend resolves to "team" (agent_mode "team", or
   * "auto" that the D5 ladder resolves to team) AND a team substrate — tmux OR
   * cmux — is available. That is a silent BACKEND DEGRADATION (no pane/surface,
   * no named specialist). Blocked fail-closed by the PreToolUse
   * backend-degradation detector; recorded with decision "allow" when the
   * operator consciously overrode it via GUILD_ALLOW_BACKEND_DEGRADE, or when
   * the downgrade is observable but not blockable (agent_mode "team" with no
   * substrate — the launcher downgrades that case itself; or a lane recognised
   * from prompt text alone). The full receipt, with the reason code, the
   * lane-evidence tier, the substrate kind, and — when a team backend was
   * reachable — the effective backend, is the
   * `guild.backend_degradation.v1` record at
   * `<runDir>/logs/backend-degradation.jsonl`; this security record is the
   * audit-rail twin of the gate decision.
   */
  | "backend_degradation";

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
  /**
   * HK-05 (D-AUDIT): registry host id for cross-host forensics.
   * Auto-resolved by `buildSecurityEvent` from:
   *   GUILD_HOST_ID env  >  GUILD_HOST env (normalized to registry id)  >  "claude-code-cli" (default).
   * Carried on EVERY security event so audit consumers can correlate events
   * across hosts (capability_scope_deviation, bypass, secret_scrub_blocked, etc.).
   */
  host: string;
}

/** The version token — single point of coupling to contract-map §B-post. */
export const SECURITY_EVENT_SCHEMA_VERSION = "guild.security_event.v1" as const;

/**
 * Fields a caller supplies; the writer stamps schema_version, ts, redacts
 * detail, and auto-resolves `host` from the environment.
 * Callers may override `host` explicitly (e.g. in tests).
 */
export type SecurityEventInput = Omit<SecurityEventV1, "schema_version" | "ts" | "detail" | "host"> & {
  detail?: string;
  /** Override the auto-resolved host id. Defaults to GUILD_HOST_ID / GUILD_HOST / "claude-code-cli". */
  host?: string;
};

/**
 * The 9 canonical registry host ids Guild's host-adapter contract supports (HK-10).
 * This intentionally mirrors the host registry, not the legacy HostKind union.
 */
export const KNOWN_GUILD_HOST_KINDS = [
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector",
] as const;

const KNOWN_GUILD_HOST_ID_SET = new Set<string>(KNOWN_GUILD_HOST_KINDS);
const LEGACY_HOST_ALIASES: Record<string, string> = {
  claude: "claude-code-cli",
  "claude-code-desktop": "claude-code-app",
  codex: "codex-cli",
  "codex-plugin": "codex-cli",
  agents: "agents-file",
  ".agents": "agents-file",
  pi: "pi-cli",
  antigravity: "antigravity-cli",
  "antigravity-2": "antigravity-cli",
};

function normalizeSecurityHostId(value: string): string | null {
  const s = value.trim();
  if (KNOWN_GUILD_HOST_ID_SET.has(s)) return s;
  return LEGACY_HOST_ALIASES[s] ?? null;
}

/**
 * Result of host-id resolution with degradation detection (HK-10).
 * Callers that need to emit an observable degradation event check `degraded`.
 */
export interface HostResolution {
  /** Resolved host id to stamp on the security event. Defaults to "claude-code-cli". */
  id: string;
  /**
   * True when GUILD_HOST was set to an unrecognized value (not a registry host
   * id or supported alias). The `id` preserves the raw host value so audit
   * consumers never see a false Claude attribution. Pre-tool-use.ts emits a
   * `capability_scope_degrade` event when true.
   */
  degraded: boolean;
  /** The unrecognized raw GUILD_HOST value. Non-empty only when degraded=true. */
  rawUnknown: string;
}

/**
 * Resolve the execution host from an env bag with full degradation detection.
 * Resolution order:
 *   1. GUILD_HOST_ID env (explicit, any string) → id=value, degraded=false
 *   2. GUILD_HOST env normalized to the registry HostId namespace → id=host_id, degraded=false
 *   3. GUILD_HOST env set but not recognized → id=raw host, degraded=true
 *   4. GUILD_HOST absent/empty → id="claude-code-cli", degraded=false
 *
 * Exported for callers that need to detect and emit degradation (HK-10).
 * `buildSecurityEvent` uses this via the internal `resolveHostId()` wrapper.
 */
export function resolveHostResolution(env: NodeJS.ProcessEnv): HostResolution {
  const explicit = (env["GUILD_HOST_ID"] ?? "").trim();
  if (explicit.length > 0) return { id: explicit, degraded: false, rawUnknown: "" };
  const rawHost = (env["GUILD_HOST"] ?? "").trim().toLowerCase();
  if (rawHost.length === 0) return { id: "claude-code-cli", degraded: false, rawUnknown: "" };
  const normalized = normalizeSecurityHostId(rawHost);
  if (normalized) return { id: normalized, degraded: false, rawUnknown: "" };
  // GUILD_HOST set but not recognized: preserve raw attribution and flag degradation.
  return { id: rawHost, degraded: true, rawUnknown: rawHost };
}

/**
 * Internal: resolve the host id for stamping onto a security event record.
 * Wraps resolveHostResolution so buildSecurityEvent stays a one-liner.
 */
function resolveHostId(): string {
  return resolveHostResolution(process.env).id;
}

/**
 * Build a fully-formed, redacted `guild.security_event.v1` record. Pure (no
 * I/O) so it is trivially unit-testable.
 * `host` is auto-stamped from the environment (HK-05) unless overridden by the caller.
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
    host: (typeof input.host === "string" && input.host.length > 0) ? input.host : resolveHostId(),
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

/**
 * Emit a `recall_quarantine` security event to `<runDir>/logs/security-events.jsonl`.
 * Called by the recall-probe defense path (D-RECALL / D-PROBE-recall) when a
 * recalled chunk is flagged and quarantined before reaching the agent context.
 *
 * `host:` is auto-stamped by `buildSecurityEvent` (HK-05) — no caller action needed.
 * Best-effort and non-throwing (same contract as `appendSecurityEvent`).
 * Returns true on a successful write, false otherwise.
 *
 * @param runDir  Absolute path to the run directory (same as `appendSecurityEvent`).
 * @param opts    Recall-quarantine context: run_id is required; others are optional.
 */
export function emitRecallQuarantine(
  runDir: string,
  opts: {
    run_id: string;
    lane_id?: string;
    detail?: string;
    dispatch_rung?: string;
  },
): boolean {
  return appendSecurityEvent(
    runDir,
    buildSecurityEvent({
      run_id: opts.run_id,
      lane_id: opts.lane_id,
      dispatch_rung: opts.dispatch_rung,
      event_type: "recall_quarantine",
      decision: "blocked",
      tool: "",
      detail: opts.detail ?? "recalled chunk flagged and quarantined by recall-probe defense.",
    }),
  );
}
