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

import {
  appendSidecarPre,
  isSafeLaneId,
  isSafeRunId,
  type SidecarPreEntry,
  TOOL_CALL_TOOL_VALUES,
  type ToolCallTool,
} from "./lib/v1.4/log-jsonl.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface PreToolUsePayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

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
  const sentinelPath = path.join(cwd, ".guild", "runs", "current-run-id");
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
 * The guard. Returns true iff it surfaced the always-ask channel (caller then
 * returns without writing telemetry, keeping stdout = exactly the decision
 * JSON). The guard itself performs NO filesystem write.
 */
function runBoundaryGuard(
  payload: PreToolUsePayload,
  cwd: string,
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

  // Signature ∧ resolves-outside(.guild/) ⇒ surface the EXISTING always-ask
  // sandbox prompt. No new gate, no new prompt copy. The guard never writes;
  // atomic-write/validity rules are owned by target-architecture.md §467-494.
  const decision = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        `Guild-owned-file boundary (P5-boundary-001): a Guild-signed ` +
        `artifact would be written OUTSIDE the consuming repo's .guild/ ` +
        `(${abs}). Guild-owned files belong under .guild/ (or .guild/` +
        `agents/proposed/, .guild/skills/proposed-*). Confirm this write is ` +
        `intentional.`,
    },
  };
  process.stdout.write(JSON.stringify(decision));
  return true;
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: PreToolUsePayload = {};
  try {
    payload = JSON.parse(raw.trim()) as PreToolUsePayload;
  } catch {
    process.stderr.write("warn: [pre-tool-use] invalid JSON on stdin; skipping.\n");
    return;
  }

  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();

  // P5-boundary-001 — additive Guild-owned-file boundary guard. Runs for
  // EVERY Write/Edit regardless of the telemetry run-id gating below. If it
  // surfaces the always-ask channel it owns stdout for this event; skip the
  // sidecar write and return (the tool will re-evaluate after the prompt).
  if (runBoundaryGuard(payload, cwd)) return;

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
    path.join(cwd, ".guild", "runs", runId);
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
