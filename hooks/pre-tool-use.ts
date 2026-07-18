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
