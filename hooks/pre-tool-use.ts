#!/usr/bin/env -S npx tsx
/**
 * hooks/pre-tool-use.ts
 *
 * Event:   PreToolUse
 * Purpose: Per architect's audit (`benchmark/plans/v1.4-claude-plugin-surface-audit.md`
 *          §"Tool-call pre/post pairing"), capture pre-tool-use sidecar
 *          entries that PostToolUse joins to compute latency_ms +
 *          status. Sidecar entry shape (4-tuple correlation key):
 *
 *            { run_id, lane_id?, tool, ts_pre, command_redacted, call_id? }
 *
 *          This handler is a thin shim over T3c's
 *          `appendSidecarPre()` API — it does NOT reimplement the
 *          sidecar writer or the lock primitive. T3c's
 *          `benchmark/src/log-jsonl.ts` owns those.
 *
 * Stdin:   JSON — Claude Code PreToolUse hook payload.
 * Stdout:  Silent (Claude Code may consume it).
 * Stderr:  Diagnostic warnings only (telemetry must not block).
 * Exit:    Always 0 — telemetry failures must not block tool execution.
 *
 * Run-id resolution: process.env.GUILD_RUN_ID (set by orchestrator).
 *   - Unset → log a warn: line to stderr and return early. The
 *     orchestrator only sets this for tracked /guild lifecycle runs;
 *     hosts running outside that contract see a clean fall-through.
 *
 * runDir resolution:
 *   1. process.env.GUILD_RUN_DIR — the runner sets this when it knows
 *      the run dir absolute path (T3a-T3d wave invariant).
 *   2. process.env.GUILD_CWD     — fallback to consuming-repo root.
 *   3. process.cwd()             — final fallback.
 *   The handler computes <runDir>/.guild/runs/<run-id>/ if no
 *   GUILD_RUN_DIR was set; this matches the existing
 *   capture-telemetry.ts convention.
 *
 * Lane-id resolution: process.env.GUILD_LANE_ID (set by the
 * specialist-dispatch wrapper). Optional — orchestrator-side
 * tool calls have no lane.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGuildRoot } from "./lib/guild-root.js";

import {
  appendSidecarPre,
  isSafeLaneId,
  isSafeRunId,
  type SidecarPreEntry,
  TOOL_CALL_TOOL_VALUES,
  type ToolCallTool,
} from "./lib/v1.4/log-jsonl.js";

// ── v2 security ADR (hook-side): capability-scope enforcement, security-event
// log, and MCP description hash-pin. Schema/settings bound BY POINTER — see
// each lib header. (ADR: v2-security-and-untrusted-content (workspace wiki))
import { readSecurityConfig, resolveRunAutonomyMode } from "./lib/security/config.js";
// HK-06: bus surface — approval_request writes go through scrubbedWrite.
import { scrubbedWrite } from "./lib/security/scrubbed-write.js";
import {
  appendSecurityEvent,
  buildSecurityEvent,
  resolveHostResolution,
  resolveRunDir,
  type SecurityEventInput,
} from "./lib/security/events.js";
import {
  effectiveBypassPolicy,
  readScopeContext,
  readScopeFile,
  resolveScopeDecision,
} from "./lib/security/enforce.js";
import { isMcpTool, verifyMcpDescription } from "./lib/security/mcp-hash-pin.js";
import {
  describeViolation,
  dispatchViolations,
  resolveDispatchAttribution,
} from "./lib/dispatch-attribution.js";
// #56 backend-degradation detector — dispatch.md's "refuse-don't-fallback" prose
// as code. Extends the #58 attribution above with the lane-brief signature and
// the resolved-backend / tmux facts. See lib/backend-degradation.ts header.
import {
  appendBackendDegradationEvent,
  AUTO_AGENT_MODE,
  BACKEND_DEGRADATION_EVENT,
  buildAllowMessage,
  buildBackendDegradationEvent,
  buildDenyMessage,
  dispatchAssertsRunId,
  resolveBlockUnmarkedLanes,
  isGuildLaneDispatch,
  isLeadProcess,
  isOverrideEngaged,
  isRunFresh,
  readSnapshotAgentMode,
  resolveBackendDegradation,
  resolveTeamSubstrate,
  type RunIdSource,
  TEAM_AGENT_MODE,
} from "./lib/backend-degradation.js";
// #60 tier-scoring guard — execute-plan's "the Agent `model` param is the only
// tiering lever, and it is REQUIRED" prose as code, plus the SKILL.md:113
// dispatch line as a run-record receipt. See lib/tier-dispatch.ts header.
import {
  appendTierDispatchEvent,
  buildDenyMessage as buildTierDenyMessage,
  buildRecordMessage as buildTierRecordMessage,
  buildTierDispatchEvent,
  isUntieredOverrideEngaged,
  readConfiguredTierModels,
  resolveTierDispatch,
  TIER_DISPATCH_EVENT,
} from "./lib/tier-dispatch.js";
import { redactField as redactTierField } from "./lib/v1.4/redact-log.js";
import { genSpanId } from "./lib/trace-v2.js";
// G5(d) — per-tool lifecycle bound (v23x-deferred-followups rf-wi-05, origin
// oir-wi-59). See lib/tool-turn-bound.ts header for the full mechanism.
import { evaluateToolTurnBound, buildToolTurnAskReason } from "./lib/tool-turn-bound.js";
// L5a: host-neutral hook payload + Claude emitter. PreToolUsePayload is now the
// shared `GuildHookEvent`; for Claude the emitter mapping is the identity, so the
// PreToolUse security behavior is preserved byte-for-byte.
import {
  emitClaudeHookEvent,
  readHookStdin,
  type GuildHookEvent,
} from "./lib/guild-hook-event.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Render a tool_input payload as a single redaction-friendly command
 * string. The redaction itself happens inside T3c's appendEvent() via
 * `redactEventFields`; here we just produce a stable single-line
 * representation the writer can pass through redaction.
 */
function renderCommand(toolName: string, toolInput: unknown): string {
  if (toolInput === undefined || toolInput === null) return toolName;
  if (typeof toolInput === "string") return `${toolName} ${toolInput}`;
  try {
    return `${toolName} ${JSON.stringify(toolInput)}`;
  } catch {
    return toolName;
  }
}

/**
 * The closed `tool_call.tool` enum is the source of truth. If the
 * incoming tool_name isn't in the enum, fall through silently (we'd
 * write an entry that the validator would reject downstream).
 */
function isKnownTool(name: string | undefined): name is ToolCallTool {
  if (typeof name !== "string") return false;
  return (TOOL_CALL_TOOL_VALUES as readonly string[]).includes(name);
}

function readCurrentRunId(cwd: string): string | undefined {
  const sentinelPath = path.join(resolveGuildRoot(cwd), ".guild", "runs", "current-run-id");
  try {
    const value = fs.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveRunId(cwd: string): string | undefined {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  return readCurrentRunId(cwd);
}

// ── HK-07: host-capability reader + approval_request writer ────────────────
//
// Implements docs/v2/security.html §enforcement degradation path:
//   host lacks PreToolUse ask  →  write approval_request to file bus
//                                  + record permission_mode: degraded
//   host supports PreToolUse ask  →  normal ask decision (unchanged behavior)
//
// The capability manifest is written at SessionStart by bootstrap.sh →
// scripts/write-host-capability.ts (RE-5).  We read it best-effort; absent
// manifest = safe fallback to the existing ask path (no regression).

/** Shape of tool_support in the guild.host_capability.v1 manifest (HK-07 slice). */
interface HostToolSupport {
  pre_tool_use_ask?: boolean;
}
interface HostCapabilitySlice {
  host_id?: string;
  host_kind?: string;
  tool_support?: HostToolSupport;
}

/**
 * Read the host capability manifest for the current host. Returns null when
 * the manifest cannot be read (missing file, bad JSON) — callers treat null
 * as "capabilities unknown; assume ask is supported" (safe fallback).
 *
 * Manifest path: <cwd>/.guild/hosts/<host-id>/capability.json where host-id
 * resolves through the same registry-id resolver used by security events.
 * Legacy family dirs (`claude`, `codex`, etc.) are also tried for compatibility.
 */
function readHostCapability(cwd: string): HostCapabilitySlice | null {
  const addCandidate = (out: string[], value: string | undefined): void => {
    const v = (value ?? "").trim();
    if (v.length > 0 && !out.includes(v)) out.push(v);
  };

  const hostRes = resolveHostResolution(process.env);
  const rawHost = (process.env["GUILD_HOST"] ?? "").trim().toLowerCase();
  const candidates: string[] = [];
  addCandidate(candidates, hostRes.id);
  addCandidate(candidates, process.env["GUILD_HOST_ID"]);
  addCandidate(candidates, rawHost);
  const legacyByRegistry: Record<string, string> = {
    "claude-code-cli": "claude",
    "codex-cli": "codex",
    "pi-cli": "pi",
    "antigravity-cli": "antigravity-2",
    "claude-code-app": "claude-code-desktop",
  };
  addCandidate(candidates, legacyByRegistry[hostRes.id]);

  for (const hostId of candidates) {
    try {
      const manifestPath = path.join(resolveGuildRoot(cwd), ".guild", "hosts", hostId, "capability.json");
      const raw = fs.readFileSync(manifestPath, "utf8");
      return JSON.parse(raw) as HostCapabilitySlice;
    } catch {
      // Try the next compatibility candidate.
    }
  }
  return null; // absent or unreadable manifest — safe fallback
}

/**
 * Write a guild.approval_request.v1 file to the agent-bus approvals directory.
 * This is the file-bus mechanism used when the host lacks a native ask primitive
 * (permission_mode: degraded). Best-effort — a write failure is logged to stderr
 * but never changes the gate decision.
 *
 * Sink: <runDir>/agent-bus/approvals/<iso-id>.json
 */
function writeApprovalRequest(
  runDir: string,
  opts: {
    runId: string;
    laneId?: string;
    tool: string;
    detail: string;
    dispatchRung?: string;
  },
): void {
  try {
    const approvalDir = path.join(runDir, "agent-bus", "approvals");
    fs.mkdirSync(approvalDir, { recursive: true });
    const ts = new Date().toISOString();
    // Deterministic file name: <ts-safe>-<tool>.json
    const safeTs = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs}-${opts.tool.toLowerCase()}.json`;
    const record: Record<string, unknown> = {
      schema_version: "guild.approval_request.v1",
      ts,
      run_id: opts.runId,
      tool: opts.tool,
      reason: opts.detail,
      permission_mode: "degraded",
    };
    if (opts.laneId) record["lane_id"] = opts.laneId;
    if (opts.dispatchRung) record["dispatch_rung"] = opts.dispatchRung;
    // HK-06 (bus surface): route through scrubbedWrite so secrets in the
    // approval_request content (e.g. leaked into the reason string) are
    // scrubbed before the file lands. scrubbedWrite handles mkdirSync.
    const content = JSON.stringify(record, null, 2) + "\n";
    scrubbedWrite(path.join(approvalDir, fileName), content, {
      surface: "bus",
      runDir,
      runId: opts.runId,
      laneId: opts.laneId,
    });
  } catch (err) {
    process.stderr.write(
      `warn: [pre-tool-use] approval_request write failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

// ── Guild-owned-file boundary guard (P5-boundary-001) ──────────────────────
//
// Behavioral contract: docs/knowledge/implementation/phases/
//   P5-boundary-config-tracking.md §#boundary-guard-spec (P5-boundary-001).
// This is the ADDITIVE enforcer of the `.guild/` ownership map
// (P1-ownership-001). It NEVER writes — it only surfaces the EXISTING
// always-ask channel (the Claude Code PreToolUse permission prompt) when a
// Guild-signed artifact would land OUTSIDE the consuming repo's `.guild/`.
// No new gate, no new prompt copy. Disabling `hasGuildSignature` reverts to
// current always-ask-only behavior (risk_rollback).

/**
 * Signature predicate — a pure content check. A payload is Guild-owned iff
 * its content carries ANY ONE of the 3 markers, each anchored to the
 * registered `guild.<ns>.v<n>` namespace (kind set is owned by
 * P1-contracts-001 / contract-map.md — schemas are NOT enumerated here):
 *
 *   1. a frontmatter `type:` key co-occurring with a guild.* kind token, OR
 *   2. a `schema_version:` value in the guild.* namespace, OR
 *   3. a `task_run`-declared artifact kind in the guild.* namespace.
 *
 * Anchoring every marker to the guild.* token keeps the no-false-positive
 * rule intact: an ordinary project/code edit carries no guild.* token and
 * passes untouched (no prompt).
 */
const GUILD_NS_TOKEN = /guild\.[A-Za-z0-9_]+\.v\d+/;

function hasGuildSignature(content: string): boolean {
  if (typeof content !== "string" || content.length === 0) return false;
  // Marker 2 — schema_version: guild.<ns>.vN (primary; VC-O4 T1).
  if (/^\s*schema_version:\s*["']?guild\.[A-Za-z0-9_]+\.v\d+/m.test(content)) {
    return true;
  }
  // Marker 1 — YAML frontmatter `type:` declaring a Guild artifact kind:
  // a frontmatter block with a `type:` key AND a guild.* kind token present.
  if (
    /^---\s*$/m.test(content) &&
    /^\s*type:\s*\S/m.test(content) &&
    GUILD_NS_TOKEN.test(content)
  ) {
    return true;
  }
  // Marker 3 — a task_run-declared artifact kind in the guild.* namespace.
  if (/task_run/.test(content) && GUILD_NS_TOKEN.test(content)) {
    return true;
  }
  return false;
}

/**
 * Path-resolution rule. The target is IN-BOUNDS iff it resolves inside the
 * consuming repo's `.guild/` (any `.guild` path segment). This naturally and
 * explicitly carves the proposed/ staging dirs
 * (`.guild/agents/proposed/<role>.md`, `.guild/skills/proposed-<role>-*`)
 * in-bounds — they are Guild-owned staging INSIDE `.guild/`. Everything else,
 * INCLUDING the plugin install dir (plugin-static, never runtime-written), is
 * out-of-bounds.
 */
function isInsideGuildDir(absPath: string): boolean {
  return path.resolve(absPath).split(path.sep).includes(".guild");
}

interface GuardToolInput {
  file_path?: unknown;
  content?: unknown;
  new_string?: unknown;
  edits?: unknown;
}

/**
 * HK-07 degrade context threaded into the boundary guard so BOTH ask-emitting
 * paths (gate-routed + boundary-guard) go through the same degrade check.
 * All fields are optional: absent = no degrade context available (safe fallback).
 */
interface BoundaryDegradeCtx {
  hostSupportsAsk: boolean;
  runId: string | undefined;
  runDir: string | undefined;
  laneId: string | undefined;
  dispatchRung: string | undefined;
}

/**
 * The guard. Returns true iff it handled the event (caller then returns without
 * writing telemetry, keeping stdout = exactly the decision JSON).
 *
 * When `ctx.hostSupportsAsk` is false the guard degrades its always-ask to the
 * file-bus approval_request path (HK-07) exactly as the gate-routed path does:
 *   1. Writes guild.approval_request.v1 (when runId is resolvable)
 *   2. Logs a `capability_scope_degrade` security event (when runId is resolvable)
 *   3. Emits `permissionDecision: "deny"` — NEVER bare `ask` on a host that
 *      cannot honor it.
 */
function runBoundaryGuard(
  payload: GuildHookEvent,
  cwd: string,
  ctx?: BoundaryDegradeCtx,
): boolean {
  const tool = payload.tool_name;
  if (tool !== "Write" && tool !== "Edit" && tool !== "MultiEdit") {
    return false;
  }
  const ti = payload.tool_input as GuardToolInput | undefined;
  if (ti === undefined || ti === null || typeof ti !== "object") return false;
  const filePath = typeof ti.file_path === "string" ? ti.file_path : undefined;
  if (filePath === undefined || filePath.length === 0) return false;

  // Gather the candidate written content across Write/Edit/MultiEdit shapes.
  let content = "";
  if (typeof ti.content === "string") content += ti.content;
  if (typeof ti.new_string === "string") content += `\n${ti.new_string}`;
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) {
      if (
        e !== null &&
        typeof e === "object" &&
        typeof (e as { new_string?: unknown }).new_string === "string"
      ) {
        content += `\n${(e as { new_string: string }).new_string}`;
      }
    }
  }

  // No-false-positive rule: no Guild signature ⇒ pass untouched, no prompt.
  if (!hasGuildSignature(content)) return false;

  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(cwd, filePath);

  // In-bounds (incl. the enumerated proposed/ staging carve-out) ⇒ no prompt.
  if (isInsideGuildDir(abs)) return false;

  // Signature ∧ resolves-outside(.guild/) → gate.
  const guardReason =
    `Guild-owned-file boundary (P5-boundary-001): a Guild-signed ` +
    `artifact would be written OUTSIDE the consuming repo's .guild/ ` +
    `(${abs}). Guild-owned files belong under .guild/ (or .guild/` +
    `agents/proposed/, .guild/skills/proposed-*). Confirm this write is ` +
    `intentional.`;
  const toolName = payload.tool_name ?? "";

  // HK-07: degrade ask→deny when host lacks PreToolUse ask primitive.
  // Covers BOTH ask-emitting paths so every degradation is observable on disk.
  if (ctx !== undefined && !ctx.hostSupportsAsk) {
    if (ctx.runId !== undefined && ctx.runDir !== undefined) {
      writeApprovalRequest(ctx.runDir, {
        runId: ctx.runId,
        laneId: ctx.laneId,
        tool: toolName,
        detail: guardReason,
        dispatchRung: ctx.dispatchRung,
      });
      appendSecurityEvent(
        ctx.runDir,
        buildSecurityEvent({
          run_id: ctx.runId,
          lane_id: ctx.laneId,
          dispatch_rung: ctx.dispatchRung,
          event_type: "capability_scope_degrade",
          decision: "deny",
          tool: toolName,
          detail: `Host lacks PreToolUse ask — boundary-guard degraded to file-bus approval_request. ${guardReason}`,
          permission_mode: "degraded",
        }),
      );
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            `Guild security (capability_scope_degrade): host lacks PreToolUse ask. ` +
            `Approval request written to agent-bus/approvals/ (permission_mode: degraded). ` +
            `Original: ${guardReason}`,
        },
      }),
    );
    return true;
  }

  // Normal path — host supports ask natively; surface the existing prompt.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: guardReason,
      },
    }),
  );
  return true;
}

// ── v2 security enforcement (PreToolUse) ────────────────────────────────────
//
// Priority order (v2-security-and-untrusted-content ADR, hook side):
//   1. capability-scope enforcement (per-lane allow-set AND-masked with the
//      autonomy_contract) — gate out-of-scope calls through the EXISTING
//      always-ask channel. Fail-closed. Only engages for a scoped lane
//      (GUILD_CAPABILITY_SCOPE present).
//   3. MCP tool-description hash-pin — gate on description drift for a pinned
//      MCP tool.
// Every policy decision/violation is logged as a guild.security_event.v1 to
// <runDir>/logs/security-events.jsonl. The gate decision NEVER depends on the
// log write succeeding.

/** Obtain a live MCP tool description: payload field, else session sidecar. */
function readMcpDescription(
  payload: GuildHookEvent,
  runDir: string | undefined,
  toolName: string,
): string | undefined {
  if (typeof payload.tool_description === "string" && payload.tool_description.length > 0) {
    return payload.tool_description;
  }
  if (runDir !== undefined) {
    try {
      const p = path.join(runDir, "logs", "mcp-tool-descriptions.json");
      const map = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
      const d = map[toolName];
      if (typeof d === "string") return d;
    } catch {
      /* no sidecar — description unobtainable */
    }
  }
  return undefined;
}

/**
 * Run capability-scope enforcement + MCP description hash-pin. Returns true iff
 * it emitted a PreToolUse permission decision (the caller then owns nothing
 * further and must return). Returns false to let the rest of the hook proceed.
 */
function runSecurityEnforcement(payload: GuildHookEvent, cwd: string): boolean {
  // Read settings first — sec.allowed_tools feeds the scope baseline (R-020)
  // and sec.tool_description_hashes feeds the MCP pin check. Both are needed
  // before the early-exit below, so the read is unconditional (the file is
  // already opened here, not further down, to avoid a second cold read).
  const sec = readSecurityConfig(cwd);
  const toolName = payload.tool_name ?? "";
  // Pass defaults.allowed_tools as the project-wide capability baseline so
  // enforce.ts unions it with the per-lane GUILD_CAPABILITY_SCOPE (R-020).
  let scope = readScopeContext(process.env, sec.allowed_tools);

  // D-CAP file-fallback (belt-and-suspenders): when GUILD_CAPABILITY_SCOPE is
  // absent from env but GUILD_TASK_ID + GUILD_RUN_ID are set, try to read the
  // scope from the per-task file written by the orchestrator at dispatch time.
  // The env-injection path (D-CAP primary) is always tried first; the file path
  // is a secondary fallback for cross-host SSH or env-injection gaps.
  if (scope === null) {
    const envRunId = process.env["GUILD_RUN_ID"];
    const envTaskId = process.env["GUILD_TASK_ID"];
    if (
      typeof envRunId === "string" && envRunId.length > 0 &&
      typeof envTaskId === "string" && envTaskId.length > 0
    ) {
      const scopeFilePath = path.join(
        resolveGuildRoot(cwd), ".guild", "runs", envRunId, "scope", `${envTaskId}.json`,
      );
      scope = readScopeFile(scopeFilePath, sec.allowed_tools);
    }
  }

  const mcpPinned = isMcpTool(toolName) && sec.tool_description_hashes[toolName] !== undefined;

  // Clean fall-through: not a scoped lane AND no pin for this tool ⇒ nothing
  // to enforce (lead/orchestrator + non-Guild sessions unaffected).
  if (scope === null && !mcpPinned) return false;

  const runId = resolveRunId(cwd);
  const runDir =
    runId !== undefined ? (process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId)) : undefined;
  const laneEnv = process.env["GUILD_LANE_ID"];
  const laneId =
    typeof laneEnv === "string" && laneEnv.length > 0 && isSafeLaneId(laneEnv) ? laneEnv : undefined;
  const permissionMode = payload.permission_mode;
  // HK-07: dispatch.rung from orchestrator env (set by specialist-dispatch wrapper).
  const dispatchRung =
    (process.env["GUILD_DISPATCH_RUNG"] ?? "").trim() || undefined;

  // HK-07: read the host capability manifest (written at SessionStart by bootstrap.sh).
  // Absent manifest = assume ask is supported (safe fallback, no regression).
  const hostCap = readHostCapability(cwd);
  const hostSupportsAsk = hostCap?.tool_support?.pre_tool_use_ask !== false;

  const emit = (input: Omit<SecurityEventInput, "run_id" | "lane_id">): void => {
    if (runId === undefined || runDir === undefined) {
      process.stderr.write(
        `warn: [pre-tool-use] security event '${input.event_type}' not logged (no run id resolvable).\n`,
      );
      return;
    }
    appendSecurityEvent(
      runDir,
      buildSecurityEvent({
        run_id: runId,
        lane_id: laneId,
        dispatch_rung: dispatchRung,
        ...input,
      }),
    );
  };

  /**
   * Gate function — decides whether to use native ask or the degraded file-bus
   * approval_request path, per HK-07 (docs/v2/security.html §enforcement).
   *
   * When `permissionDecision === "ask"` AND the host lacks `pre_tool_use_ask`,
   * the gate degrades:
   *   1. Writes guild.approval_request.v1 to agent-bus/approvals/
   *   2. Logs a `capability_scope_degrade` security event with
   *      `permission_mode: degraded` + `dispatch_rung` (if set)
   *   3. Emits `permissionDecision: "deny"` (the tool must not run until the
   *      lead approves via the file bus — the deny IS the observable pause)
   * Otherwise emits the decision unchanged (native host behavior).
   */
  const gate = (permissionDecision: "ask" | "deny", eventType: string, reason: string): boolean => {
    if (permissionDecision === "ask" && !hostSupportsAsk && runId !== undefined && runDir !== undefined) {
      // Degraded path — host lacks PreToolUse ask primitive.
      writeApprovalRequest(runDir, {
        runId,
        laneId,
        tool: toolName,
        detail: reason,
        dispatchRung,
      });
      emit({
        event_type: "capability_scope_degrade",
        decision: "deny",
        tool: toolName,
        detail: `Host lacks PreToolUse ask — degraded to file-bus approval_request. Original: ${reason}`,
        permission_mode: "degraded",
      });
      // Emit deny so the tool call is blocked pending file-bus approval.
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              `Guild security (capability_scope_degrade): host lacks PreToolUse ask. ` +
              `Approval request written to agent-bus/approvals/ (permission_mode: degraded). ` +
              `Original: ${reason}`,
          },
        }),
      );
      return true;
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision,
          permissionDecisionReason: `Guild security (${eventType}): ${reason}`,
        },
      }),
    );
    return true;
  };

  // HK-10: if the execution host is unrecognized, emit an observable degradation
  // event NOW so the attribution gap is on disk. Fired at most once per
  // security-enforcement session (only when enforcement is actually active, i.e.
  // we didn't early-exit above). The tool call is NOT blocked — this is purely
  // an audit signal.
  const hostRes = resolveHostResolution(process.env);
  if (hostRes.degraded) {
    emit({
      event_type: "capability_scope_degrade",
      decision: "degraded",
      tool: "",
      detail:
        `Host resolution degraded (HK-10): GUILD_HOST="${hostRes.rawUnknown}" is not a ` +
        `recognized registry host id or alias. Security-event host is preserved as ` +
        `"${hostRes.id}" with degraded attribution. Set GUILD_HOST_ID or use a ` +
        `canonical GUILD_HOST value.`,
      permission_mode: permissionMode,
    });
  }

  // 1. Capability-scope (only for a declared scoped lane).
  if (scope !== null) {
    // D-BYPASS autonomy-mode forcing (docs/v2/security.html §bypassPermissions
    // governance): under a non-interactive autonomy mode the policy is FORCED
    // to `deny`. Resolved ONLY when the call is actually under bypassPermissions
    // (the policy is irrelevant otherwise — keeps the hot path free of extra
    // fs reads).
    const underBypass = permissionMode === "bypassPermissions";
    const bypass = underBypass
      ? effectiveBypassPolicy(
          sec.bypass_permissions_policy,
          resolveRunAutonomyMode({ cwd, env: process.env }),
        )
      : { policy: sec.bypass_permissions_policy, forced: false as const };
    const d = resolveScopeDecision({
      scope,
      toolName,
      toolInput: payload.tool_input,
      policy: bypass.policy,
      permissionMode,
      policyForced: bypass.forced,
    });
    if (d.eventType !== null) {
      emit({
        event_type: d.eventType,
        decision: d.recordedDecision,
        tool: toolName,
        detail: d.reason,
        policy: underBypass ? bypass.policy : undefined,
        permission_mode: permissionMode,
      });
    }
    if (d.gate && d.permissionDecision !== undefined) {
      return gate(d.permissionDecision, d.eventType ?? "capability_scope_violation", d.reason);
    }
  }

  // 3. MCP description hash-pin (independent of scope; only for pinned tools).
  if (mcpPinned) {
    const live = readMcpDescription(payload, runDir, toolName);
    const r = verifyMcpDescription(toolName, live, sec.tool_description_hashes);
    if (r.status === "mismatch") {
      const reason =
        `MCP tool "${toolName}" description hash mismatch (pinned ${r.pinned?.slice(0, 12)}…, ` +
        `live ${r.actual?.slice(0, 12)}…) — possible description rug-pull (PI-6).`;
      emit({ event_type: "mcp_description_mismatch", decision: "ask", tool: toolName, detail: reason, permission_mode: permissionMode });
      return gate("ask", "mcp_description_mismatch", `${reason} Confirm before allowing.`);
    }
    if (r.status === "unverifiable") {
      // Pinned but no live description source — record + proceed (do not brick
      // every pinned MCP call). Wiring a description source is the followup
      // that upgrades this to a fail-closed gate.
      emit({
        event_type: "mcp_description_unverifiable",
        decision: "allow",
        tool: toolName,
        detail: `MCP tool "${toolName}" pinned but live description unobtainable — cannot verify; proceeding.`,
        permission_mode: permissionMode,
      });
    }
  }

  return false;
}

// ── Dispatch-integrity guard (#58) ──────────────────────────────────────────
//
// Make specialist type-erasure DETECTABLE. During an active Guild run, an
// `Agent` dispatch that CLAIMS a project-specialist persona (its prompt carries
// the `.guild/agents/<role>.md` adoption instruction / the "dispatched as the
// Guild <role> specialist" prose, OR it carries GUILD_SPECIALIST+GUILD_TASK_ID)
// but is dispatched as `subagent_type: "general-purpose"` WITHOUT a matching
// GUILD_AGENT_DEFINITION env is a silently persona-stripped dispatch — the
// intended (definition-carrying) call and the defective one were otherwise
// byte-identical. Fail closed: deny it with a loud, actionable message.
//
// Scope is deliberately tight (NEVER interfere with a non-Guild Agent call):
//   - only tool_name === "Agent";
//   - only inside a resolvable Guild run (GUILD_RUN_ID / current-run-id);
//   - only when isPersonaStrippedDispatch — i.e. generic type ∧ specialist
//     adoption ∧ no GUILD_AGENT_DEFINITION.
// A correctly-carried project dispatch (definition present), a shipped agent
// dispatched by name (non-generic), a generic learn/fan-out lane (no adoption
// signature), and any non-Guild Agent call all fall through untouched.

/**
 * Returns true iff it handled the event (emitted a deny decision on stdout; the
 * caller must then return without writing telemetry, keeping stdout = exactly
 * the decision JSON). A best-effort guild.security_event.v1 is recorded, but the
 * deny NEVER depends on the log write succeeding.
 */
function runDispatchIntegrityGuard(payload: GuildHookEvent, cwd: string): boolean {
  if (payload.tool_name !== "Agent") return false;

  // Only inside an active Guild run — non-Guild sessions are never gated.
  const runId = resolveRunId(cwd);
  if (typeof runId !== "string" || runId.length === 0) return false;

  const attr = resolveDispatchAttribution(payload.tool_input);
  if (attr === null) return false;
  const violations = dispatchViolations(attr);
  if (violations.length === 0) return false;

  const role = attr.specialist ?? "<unknown>";
  // The message names the invariant(s) that ACTUALLY failed — telling an
  // operator "GUILD_AGENT_DEFINITION is missing" when it is present and correct
  // is worse than useless for an observability rail (adversarial review r6).
  const detail = violations.map((v) => describeViolation(v, role, attr)).join("; ");
  const reason =
    `Guild dispatch integrity (#58): a lane claiming the Guild "${role}" specialist ` +
    `is being dispatched as subagent_type="general-purpose", but ${detail}. ` +
    `The specialist's persona, scoped skills, tool permissions, and ` +
    `TRIGGER/DO-NOT-TRIGGER boundaries would be silently stripped — a real ` +
    `"${role}" lane and a bare generic agent would be indistinguishable. ` +
    `guild:execute-plan's backend descriptor (composeInProcessDispatch + ` +
    `buildPrompt) sets every required carrier; re-dispatch through it. ` +
    `Blocking this dispatch. [violations: ${violations.join(",")}]`;

  // Best-effort audit record — never gate on the write.
  try {
    const runDir = process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId);
    const laneEnv = process.env["GUILD_LANE_ID"];
    const laneId =
      typeof laneEnv === "string" && laneEnv.length > 0 && isSafeLaneId(laneEnv)
        ? laneEnv
        : undefined;
    appendSecurityEvent(
      runDir,
      buildSecurityEvent({
        run_id: runId,
        lane_id: laneId,
        event_type: "dispatch_attribution_missing",
        decision: "deny",
        tool: "Agent",
        detail: reason,
      }),
    );
  } catch {
    /* telemetry must never block the gate */
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  return true;
}

// ── Backend-degradation detector (#56) ──────────────────────────────────────
//
// Convert `dispatch.md §"Backend choice"`'s refuse-don't-fallback PROSE into a
// runtime detector. When the run's backend resolves to team (agent_mode "team",
// or "auto" that the D5 ladder resolves to team) and a team substrate (tmux or
// cmux) IS available, a Guild specialist lane dispatched through the in-session
// `Agent` tool is a silent BACKEND DEGRADATION — the exact ~26h collapse issue
// #56 documents. Deny it loudly, or (with GUILD_ALLOW_BACKEND_DEGRADE) allow it
// CONSCIOUSLY. Two cases are RECORDED but never blocked: team-with-no-substrate
// (the launcher downgrades that itself), and a lane identified from prompt text
// ALONE (indistinguishable from a prompt quoting a live brief). See
// `BackendDegradationReason` / `LaneEvidence` for the per-row rationale.
//
// EVERY non-pass decision writes a `guild.backend_degradation.v1` receipt to
// `<runDir>/logs/backend-degradation.jsonl` — a durable, greppable record of the
// downgrade. (Consumer wiring in verify-done/reflect is a followup; the receipt
// is auditable by path today.)
//
// Scope is as tight as the #58 guard's (never interfere with a non-Guild call):
//   - only tool_name === "Agent";
//   - only inside a resolvable, SAFE, and FRESH Guild run (a stale
//     current-run-id sentinel from a long-finished run never gates);
//   - only when the run's resolved-settings snapshot proves the configured
//     agent_mode (no snapshot ⇒ no proof ⇒ no gate);
//   - only when the dispatching process is the LEAD (a specialist already
//     running in a pane that spawns a helper is not degrading anything);
//   - only for a Guild LANE dispatch, and only STRUCTURED lane evidence blocks.
// A learn-lane generic fan-out, an Explore sweep, an `agent`/`subagent`-mode run
// (where Agent dispatch is the DESIGNED path), and any non-Guild Agent call all
// fall through untouched.

/** The detector's outcome, when it produced one. */
interface BackendGuardOutcome {
  /** True when the dispatch must be denied and this message shown. */
  deny: boolean;
  message: string;
}

/**
 * Evaluate the detector AND emit its receipts. Returns null when the dispatch is
 * clean (or unprovable) and undecided otherwise.
 *
 * Receipt emission is deliberately SEPARATE from the deny emission: the #58
 * dispatch-integrity guard may own stdout for the same event, and a dispatch
 * that is both persona-stripped AND backend-degraded must still leave a
 * `backend_degradation` receipt (adversarial review round 1, finding 6).
 */
function evaluateBackendDegradation(
  payload: GuildHookEvent,
  cwd: string,
): BackendGuardOutcome | null {
  if (payload.tool_name !== "Agent") return null;

  // The run id's PROVENANCE decides whether a freshness test applies: an
  // explicit GUILD_RUN_ID is session-bound identity; the current-run-id sentinel
  // outlives the run that wrote it (closeRun never clears it).
  const envRunId = process.env["GUILD_RUN_ID"];
  const runId = resolveRunId(cwd);
  if (typeof runId !== "string" || runId.length === 0 || !isSafeRunId(runId)) return null;
  // Trusted identity = an exported GUILD_RUN_ID, OR the dispatch itself naming
  // this run in its descriptor env (the `/guild:build` sentinel-only shape).
  const runIdSource: RunIdSource =
    (typeof envRunId === "string" && envRunId.length > 0) ||
    dispatchAssertsRunId(payload.tool_input, runId)
      ? "env"
      : "sentinel";

  const attr = resolveDispatchAttribution(payload.tool_input);
  if (attr === null) return null;
  const ti = payload.tool_input as Record<string, unknown> | undefined;
  const prompt = typeof ti?.["prompt"] === "string" ? (ti["prompt"] as string) : "";

  // Cheap-first short-circuits — these only avoid work. `resolveBackendDegradation`
  // re-checks every condition and remains the single authority on the matrix.
  if (!isLeadProcess(process.env)) return null;
  if (!isGuildLaneDispatch(payload.tool_input, attr, prompt, runId)) return null;

  const guildRoot = resolveGuildRoot(cwd);
  const agentMode = readSnapshotAgentMode(guildRoot, runId);
  if (agentMode !== TEAM_AGENT_MODE && agentMode !== AUTO_AGENT_MODE) return null;
  const runFresh = isRunFresh(guildRoot, runId, runIdSource);
  if (!runFresh) return null;

  // Only now pay for the subprocess probe.
  const substrate = resolveTeamSubstrate(agentMode, process.env);
  const result = resolveBackendDegradation({
    toolInput: payload.tool_input,
    attr,
    prompt,
    runId,
    agentMode,
    substrate,
    overrideEngaged: isOverrideEngaged(process.env),
    isLead: true,
    runFresh,
    // #93: the RESOLVED `defaults.dispatch.block_unmarked_lanes`, read from the
    // same U6 snapshot file `readSnapshotAgentMode` above consulted — a SECOND
    // readFileSync of that file, not a free ride on the first. It is paid only
    // here, past every cheap-first short-circuit above, so it costs nothing on
    // the overwhelming majority of tool calls that never reach this line.
    // GUILD_BLOCK_UNMARKED_LANES is retained as the per-session override.
    blockUnmarked: resolveBlockUnmarkedLanes(guildRoot, runId, process.env),
  });
  if (result.decision === "pass" || result.reason === undefined) return null;

  const role = result.specialist ?? "<unattributed>";
  const message =
    result.decision === "deny"
      ? buildDenyMessage(result.reason, role, result.subagentType, substrate, result.evidence)
      : buildAllowMessage(
          result.reason,
          role,
          result.subagentType,
          substrate,
          result.evidence,
          result.decision,
        );

  // ── Receipt: the run-record artifact (the #56 acceptance criterion) ───────
  // Written for EVERY non-pass decision — an allowed downgrade is exactly the
  // silent degrade this issue is about, so it must leave a trail too.
  const ts = new Date().toISOString();
  const laneEnv = process.env["GUILD_LANE_ID"];
  const laneId =
    typeof laneEnv === "string" && laneEnv.length > 0 && isSafeLaneId(laneEnv)
      ? laneEnv
      : undefined;
  const runDir = process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId);
  try {
    appendBackendDegradationEvent(
      runDir,
      buildBackendDegradationEvent({
        runId,
        ts,
        spanId: genSpanId(runId, BACKEND_DEGRADATION_EVENT, ts, result.specialist ?? "main"),
        decision: result.decision,
        reason: result.reason,
        specialist: result.specialist ?? "",
        subagentType: result.subagentType,
        agentMode,
        effectiveBackend: result.effectiveBackend,
        substrate,
        evidence: result.evidence,
        detail: message,
        laneId,
      }),
    );
  } catch {
    /* telemetry must never block the gate */
  }

  // Audit-rail twin of the decision, alongside the #58 guard's records. `detail`
  // is redacted by buildSecurityEvent before it reaches disk.
  try {
    appendSecurityEvent(
      runDir,
      buildSecurityEvent({
        run_id: runId,
        lane_id: laneId,
        event_type: "backend_degradation",
        decision: result.decision === "deny" ? "deny" : "allow",
        tool: "Agent",
        detail: message,
      }),
    );
  } catch {
    /* telemetry must never block the gate */
  }

  if (result.decision !== "deny") {
    // Loud on stderr, but the dispatch proceeds.
    process.stderr.write(`warn: [pre-tool-use] ${message}\n`);
  }
  return { deny: result.decision === "deny", message };
}

/** Emit the #56 deny decision. The caller must then own stdout for this event. */
function emitBackendDegradationDeny(message: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: message,
      },
    }),
  );
}

// ── Tier-scoring guard (#60) ────────────────────────────────────────────────
//
// Convert `execute-plan/SKILL.md §"Tier resolution"`'s two PROSE mandates into
// runtime behavior:
//
//   1. the Agent `model` param is the ONLY tiering lever and is REQUIRED on
//      every lane dispatch (default cheap; `powerful` must be justified) — a
//      Guild lane dispatched WITHOUT it silently inherits the dispatching
//      process's model, which is exactly how a post-/compact opus orchestrator
//      turned 48 cheap/mid lanes into opus lanes;
//   2. the dispatch line `lane <task-id> · score N · tier <tier> · model <model>`
//      is printed and recorded — "never silent" (SKILL.md:113) — which vanished
//      along with the param.
//
// A `guild.tier_dispatch.v1` receipt is written to
// `<runDir>/logs/tier-dispatch.jsonl` for EVERY Guild-lane dispatch decision,
// compliant ones included: "48 dispatches, none tiered" is only answerable
// post-hoc when the compliant lines are on the record too. (Consumer wiring in
// verify-done/reflect is a followup; the sink is auditable by path today.)
//
// Scope mirrors the #58 guard's, plus #56's stale-sentinel defense:
//   - only tool_name === "Agent";
//   - only inside a resolvable, SAFE, and FRESH Guild run;
//   - only for a Guild LANE dispatch, and only STRUCTURED lane evidence blocks.
// Deliberately NOT lead-only (unlike #56): the tier contract binds the DISPATCH,
// not the dispatcher — a helper spawned from inside a lane with no `model` param
// inherits that lane's model just as silently.

/** The guard's outcome, when it produced one. */
interface TierGuardOutcome {
  /** True when the dispatch must be denied and this message shown. */
  deny: boolean;
  message: string;
}

/**
 * Evaluate the tier guard AND emit its receipts. Returns null when the dispatch
 * is not a gateable Guild lane.
 *
 * Receipt emission is deliberately SEPARATE from the deny emission, for the same
 * reason #56's is: the #58 or #56 guard may own stdout for the same event, and a
 * dispatch that is both persona-stripped/backend-degraded AND untiered must
 * still leave its tier receipt — they are independent audit dimensions.
 */
function evaluateTierDispatch(
  payload: GuildHookEvent,
  cwd: string,
): TierGuardOutcome | null {
  if (payload.tool_name !== "Agent") return null;

  // Same run-identity provenance rule as #56: an exported GUILD_RUN_ID (or a
  // dispatch naming this run in its own descriptor env) is trusted identity; a
  // `current-run-id` sentinel must additionally prove freshness, since closeRun
  // never clears it.
  const envRunId = process.env["GUILD_RUN_ID"];
  const runId = resolveRunId(cwd);
  if (typeof runId !== "string" || runId.length === 0 || !isSafeRunId(runId)) return null;
  const runIdSource: RunIdSource =
    (typeof envRunId === "string" && envRunId.length > 0) ||
    dispatchAssertsRunId(payload.tool_input, runId)
      ? "env"
      : "sentinel";

  const attr = resolveDispatchAttribution(payload.tool_input);
  if (attr === null) return null;
  const ti = payload.tool_input as Record<string, unknown> | undefined;
  const prompt = typeof ti?.["prompt"] === "string" ? (ti["prompt"] as string) : "";

  // Cheap-first short-circuit — `resolveTierDispatch` re-checks both conditions
  // and remains the single authority on the matrix.
  if (!isGuildLaneDispatch(payload.tool_input, attr, prompt, runId)) return null;
  const guildRoot = resolveGuildRoot(cwd);
  const runFresh = isRunFresh(guildRoot, runId, runIdSource);
  if (!runFresh) return null;

  const tierModels = readConfiguredTierModels(
    guildRoot,
    resolveHostResolution(process.env).id,
  );
  const result = resolveTierDispatch({
    toolInput: payload.tool_input,
    attr,
    prompt,
    runId,
    tierModels,
    overrideEngaged: isUntieredOverrideEngaged(process.env),
    runFresh,
  });
  if (!result.recorded) return null;

  const message =
    result.decision === "deny"
      ? buildTierDenyMessage(result, tierModels)
      : buildTierRecordMessage(result, tierModels);

  // ── Receipt: the resurrected SKILL.md:113 dispatch line ──────────────────
  const ts = new Date().toISOString();
  const laneEnv = process.env["GUILD_LANE_ID"];
  const laneId =
    typeof laneEnv === "string" && laneEnv.length > 0 && isSafeLaneId(laneEnv)
      ? laneEnv
      : undefined;
  const runDir = process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId);
  try {
    appendTierDispatchEvent(
      runDir,
      buildTierDispatchEvent({
        runId,
        ts,
        spanId: genSpanId(runId, TIER_DISPATCH_EVENT, ts, result.specialist ?? "main"),
        result,
        detail: message,
        ...(laneId !== undefined ? { laneId } : {}),
      }),
    );
  } catch {
    /* telemetry must never block the gate */
  }

  // Audit-rail twin — ONLY for a genuine untiered violation (reason
  // "missing_model"): that is the one case the `tier_dispatch_untiered` event
  // name is accurate for (adversarial review finding #6). A `tier_unverifiable`
  // or `tier_model_mismatch` record carries an explicit model — it is NOT
  // untiered, so labeling it so would poison security analytics. Compliant
  // dispatches never emit a twin (the tier-dispatch sink already carries the
  // complete per-dispatch record).
  if (result.reason === "missing_model" && result.decision !== "pass") {
    try {
      appendSecurityEvent(
        runDir,
        buildSecurityEvent({
          run_id: runId,
          lane_id: laneId,
          event_type: "tier_dispatch_untiered",
          decision: result.decision === "deny" ? "deny" : "allow",
          tool: "Agent",
          detail: message,
        }),
      );
    } catch {
      /* telemetry must never block the gate */
    }
  }

  // The print half of the "never silent" mandate — restore the dispatch line on
  // stderr for every Guild-lane dispatch, not just the violations. The message
  // is built only from bounded identifiers (role, model, tier tokens, bounded
  // config values), but pass it through the shared redaction anyway so no path
  // out of this guard can print an unredacted config/detail value (round 2, P1).
  const safeMessage = redactTierField(message);
  process.stderr.write(
    result.decision === "pass"
      ? `[pre-tool-use] guild-tier: ${result.model} · ${result.decision} — ${safeMessage}\n`
      : `warn: [pre-tool-use] ${safeMessage}\n`,
  );
  return { deny: result.decision === "deny", message };
}

/** Emit the #60 deny decision. The caller must then own stdout for this event. */
function emitTierDispatchDeny(message: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: message,
      },
    }),
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const raw = await readHookStdin();
  let payload: GuildHookEvent = {};
  try {
    payload = emitClaudeHookEvent(raw);
  } catch {
    process.stderr.write("warn: [pre-tool-use] invalid JSON on stdin; skipping.\n");
    return;
  }

  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();

  // Both dispatch guards run BEFORE capability enforcement so an `Agent`
  // dispatch defect is DENIED outright and can never be downgraded to an `ask`
  // (and then approved) by a capability-scope gate. Each is scoped tightly to
  // the `Agent` tool inside an active run and falls through untouched otherwise.
  // Whichever denies owns stdout for this event, so the rest is skipped.
  //
  // #56 backend-degradation detector. EVALUATED FIRST (before #58 can own
  // stdout) so its receipt is written even when the same dispatch is ALSO
  // persona-stripped — the two defects are independent audit dimensions and a
  // #58 deny must not swallow the #56 record. It does not emit its decision
  // here, only its receipts.
  const backend = evaluateBackendDegradation(payload, cwd);

  // #60 tier-scoring guard. Evaluated alongside #56 and for the same reason: its
  // receipt is the run-record dispatch line and must exist even when another
  // guard owns stdout for this event. It emits its decision LAST of the three —
  // a stripped persona (#58) and a wrong backend (#56) are the more specific
  // defects, and under the team backend the lane never takes a `model` param at
  // all (panes carry the tier on the teammate definition).
  const tier = evaluateTierDispatch(payload, cwd);

  // #58 dispatch-integrity guard — fail closed on a persona-stripped Guild
  // specialist dispatch. It emits first when both fire: a stripped persona is
  // the more specific defect, and the #56 receipt is already on disk.
  if (runDispatchIntegrityGuard(payload, cwd)) return;

  // #56 deny — runs before capability enforcement for the same reason the #58
  // guard does: a backend downgrade must not be reachable through an `ask` a
  // capability gate could approve. A recorded/overridden allow falls through so
  // the rest of the hook (telemetry sidecar) still runs.
  if (backend !== null && backend.deny) {
    emitBackendDegradationDeny(backend.message);
    return;
  }

  // #60 deny — before capability enforcement for the same reason as the two
  // above: an untiered dispatch must not be reachable through an `ask` a
  // capability gate could approve. A recorded/overridden allow falls through so
  // the rest of the hook (telemetry sidecar) still runs.
  if (tier !== null && tier.deny) {
    emitTierDispatchDeny(tier.message);
    return;
  }

  // v2 security ADR — capability-scope enforcement + MCP description hash-pin.
  // Runs BEFORE the boundary guard so a security gate owns stdout for this
  // event. If it emits a permission decision, skip everything else and return.
  if (runSecurityEnforcement(payload, cwd)) return;

  // P5-boundary-001 — additive Guild-owned-file boundary guard. Runs for
  // EVERY Write/Edit regardless of the telemetry run-id gating below. If it
  // surfaces the always-ask/deny channel it owns stdout for this event; skip
  // the sidecar write and return.
  //
  // HK-07: thread degrade context so the boundary-guard ask is also covered
  // (both ask-emitting paths must degrade when the host lacks PreToolUse ask).
  {
    const bgHostCap = readHostCapability(cwd);
    const bgHostSupportsAsk = bgHostCap?.tool_support?.pre_tool_use_ask !== false;
    const bgRunId = resolveRunId(cwd);
    const bgRunDir =
      bgRunId !== undefined
        ? (process.env["GUILD_RUN_DIR"] ??
            path.join(resolveGuildRoot(cwd), ".guild", "runs", bgRunId))
        : undefined;
    const bgLaneEnv = process.env["GUILD_LANE_ID"];
    const bgLaneId =
      typeof bgLaneEnv === "string" && bgLaneEnv.length > 0 ? bgLaneEnv : undefined;
    const bgDispatchRung = (process.env["GUILD_DISPATCH_RUNG"] ?? "").trim() || undefined;
    if (
      runBoundaryGuard(payload, cwd, {
        hostSupportsAsk: bgHostSupportsAsk,
        runId: bgRunId,
        runDir: bgRunDir,
        laneId: bgLaneId,
        dispatchRung: bgDispatchRung,
      })
    )
      return;
  }

  const runId = resolveRunId(cwd);
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [pre-tool-use] GUILD_RUN_ID unset and current-run-id missing — falling through (no sidecar write).\n",
    );
    return;
  }
  if (!isSafeRunId(runId)) {
    process.stderr.write(
      "warn: [pre-tool-use] invalid GUILD_RUN_ID/current-run-id — falling through (no sidecar write).\n",
    );
    return;
  }

  const toolName = payload.tool_name ?? "";
  if (!isKnownTool(toolName)) {
    // Unknown tool — log + bail. We do NOT write a sidecar with an
    // off-enum tool because the post-handler/orphan-sweep would emit
    // an event that fails validation downstream.
    process.stderr.write(
      `warn: [pre-tool-use] tool '${toolName}' not in closed enum; skipping.\n`,
    );
    return;
  }

  const runDir =
    process.env["GUILD_RUN_DIR"] ??
    path.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
  const laneId = process.env["GUILD_LANE_ID"];

  const entry: SidecarPreEntry = {
    run_id: runId,
    tool: toolName,
    ts_pre: new Date().toISOString(),
    command_redacted: renderCommand(toolName, payload.tool_input),
  };
  if (typeof laneId === "string" && laneId.length > 0 && isSafeLaneId(laneId)) {
    entry.lane_id = laneId;
  } else if (typeof laneId === "string" && laneId.length > 0) {
    process.stderr.write(
      "warn: [pre-tool-use] invalid GUILD_LANE_ID — omitting lane_id.\n",
    );
  }

  try {
    fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
    appendSidecarPre(runDir, entry);
  } catch (err) {
    process.stderr.write(
      `warn: [pre-tool-use] sidecar write failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }

  // G5(d): per-tool lifecycle bound — a soft advisory checkpoint when a SINGLE
  // agentic turn has made an unbounded number of tool calls with no
  // checkpoint back to the user. Runs LAST (lowest priority) — every guard
  // above it may already have claimed stdout and returned before this point;
  // this is advisory-only (`ask`, never `deny`) and must never override a
  // security decision. Fail-open: evaluateToolTurnBound never throws, but the
  // whole block is wrapped anyway so a future change to it can never turn an
  // advisory checkpoint into a blocked tool call.
  try {
    const bound = evaluateToolTurnBound(runDir);
    if (bound.ask) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: buildToolTurnAskReason(bound, toolName),
          },
        }),
      );
    }
  } catch (err) {
    process.stderr.write(
      `warn: [pre-tool-use] tool-turn-bound eval failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

// Allow tests to import without auto-executing.
if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("pre-tool-use.ts")
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `fatal: [pre-tool-use] ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(0); // never block.
  });
} else if (
  process.argv[1] !== undefined &&
  process.argv[1].endsWith("pre-tool-use.js")
) {
  // dist build entrypoint
  main().catch((err: unknown) => {
    process.stderr.write(
      `fatal: [pre-tool-use] ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(0);
  });
}
