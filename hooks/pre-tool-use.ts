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

import { appendSidecarPre, type SidecarPreEntry, TOOL_CALL_TOOL_VALUES, type ToolCallTool } from "../benchmark/src/log-jsonl.js";

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

// ── Main ───────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const runId = process.env["GUILD_RUN_ID"];
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [pre-tool-use] GUILD_RUN_ID unset — falling through (no sidecar write).\n",
    );
    return;
  }

  const raw = await readStdin();
  let payload: PreToolUsePayload = {};
  try {
    payload = JSON.parse(raw.trim()) as PreToolUsePayload;
  } catch {
    process.stderr.write("warn: [pre-tool-use] invalid JSON on stdin; skipping.\n");
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

  const cwd =
    process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
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
  if (typeof laneId === "string" && laneId.length > 0) {
    entry.lane_id = laneId;
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
