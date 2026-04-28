#!/usr/bin/env -S npx tsx
/**
 * hooks/post-tool-use.ts
 *
 * Event:   PostToolUse (matcher widened to `*` per architect's
 *          v1.4-claude-plugin-surface-audit.md §"Tool-call pre/post pairing")
 * Purpose: Consume the matching sidecar Pre entry written by
 *          hooks/pre-tool-use.ts (T3c's `consumeSidecarPre()` API),
 *          compute latency_ms = ts_post - ts_pre, and emit a
 *          `tool_call` JSONL event via T3c's `appendEvent()`. Also
 *          run the orphan sweep on every fire to flush stale Pre
 *          entries (>5 min) as `tool_call status: "err"` with the
 *          architect's literal ORPHAN_RESULT_EXCERPT sentinel.
 *
 *          The legacy `capture-telemetry.ts` handler continues to
 *          run alongside this one (additive). It writes to
 *          `events.ndjson` which is the v1.3 trace channel; the v1.4
 *          tool_call event lives in `<runDir>/logs/v1.4-events.jsonl`.
 *
 * Stdin:   JSON — Claude Code PostToolUse hook payload.
 * Stdout:  Silent.
 * Stderr:  Diagnostic warnings only.
 * Exit:    Always 0 — telemetry must not block.
 */

import * as path from "node:path";

import {
  appendEvent,
  buildToolCallFromPair,
  buildToolCallFromPostOnly,
  consumeSidecarPre,
  sweepOrphanedSidecarFull,
  type SidecarMatchKey,
  type ToolCallEvent,
  TOOL_CALL_TOOL_VALUES,
  type ToolCallTool,
} from "../benchmark/src/log-jsonl.js";

interface PostToolUsePayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: { success?: boolean; error?: string } | unknown;
  duration_ms?: number;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

function isKnownTool(name: string | undefined): name is ToolCallTool {
  if (typeof name !== "string") return false;
  return (TOOL_CALL_TOOL_VALUES as readonly string[]).includes(name);
}

function isOk(payload: PostToolUsePayload): "ok" | "err" {
  const resp = payload.tool_response;
  if (resp === null || resp === undefined) return "ok";
  if (typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    if (r["success"] === false) return "err";
    if (typeof r["error"] === "string" && r["error"].length > 0) return "err";
  }
  return "ok";
}

function resultExcerpt(payload: PostToolUsePayload): string {
  const resp = payload.tool_response;
  if (resp === null || resp === undefined) return "";
  if (typeof resp === "string") return resp;
  try {
    return JSON.stringify(resp);
  } catch {
    return "";
  }
}

export async function main(): Promise<void> {
  const runId = process.env["GUILD_RUN_ID"];
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [post-tool-use] GUILD_RUN_ID unset — falling through (no tool_call emit).\n",
    );
    return;
  }

  const raw = await readStdin();
  let payload: PostToolUsePayload = {};
  try {
    payload = JSON.parse(raw.trim()) as PostToolUsePayload;
  } catch {
    process.stderr.write("warn: [post-tool-use] invalid JSON on stdin; skipping pairing.\n");
    return;
  }

  const toolName = payload.tool_name ?? "";
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const runDir =
    process.env["GUILD_RUN_DIR"] ??
    path.join(cwd, ".guild", "runs", runId);
  const laneId = process.env["GUILD_LANE_ID"];
  const tsPost = new Date().toISOString();

  // Always run the orphan sweep first — flushes stale Pre entries from
  // crashed earlier dispatches as `status: "err"` events. Architect
  // contract: every PostToolUse invocation runs this sweep.
  try {
    const sweep = sweepOrphanedSidecarFull(runDir);
    for (const ev of sweep.events) {
      try {
        appendEvent(runDir, ev);
      } catch (err) {
        process.stderr.write(
          `warn: [post-tool-use] orphan emit failed: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `warn: [post-tool-use] sweep failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }

  // If the tool isn't in the closed enum, we cannot emit a valid
  // tool_call (the validator would reject it). Fall through silently
  // after the orphan sweep so the audit channel still drains.
  if (!isKnownTool(toolName)) {
    return;
  }

  // Match by 4-tuple: (run_id, lane_id, tool, ts_pre < post_ts).
  const matchKey: SidecarMatchKey = {
    run_id: runId,
    tool: toolName,
    post_ts: tsPost,
  };
  if (typeof laneId === "string" && laneId.length > 0) {
    matchKey.lane_id = laneId;
  }

  let event: ToolCallEvent;
  try {
    const pre = consumeSidecarPre(runDir, matchKey);
    if (pre === null) {
      // POST-without-PRE: per audit lines 133-135, this is an
      // *observability gap*, not a pairing error. Emit with
      // command_redacted absent (empty string), status="ok",
      // result + latency captured from Post alone. This is distinct
      // from the orphan-sweep path (PRE-without-POST > 5 min, status="err").
      // The duration_ms from Claude Code's hook payload, when present,
      // becomes latency_ms_override so we still get a usable timing.
      event = buildToolCallFromPostOnly({
        ts_post: tsPost,
        run_id: runId,
        tool: toolName,
        result_excerpt_redacted: resultExcerpt(payload),
        ...(typeof laneId === "string" && laneId.length > 0
          ? { lane_id: laneId }
          : {}),
        ...(typeof payload.duration_ms === "number"
          ? { latency_ms_override: payload.duration_ms }
          : {}),
      });
    } else {
      event = buildToolCallFromPair(pre, {
        ts_post: tsPost,
        run_id: runId,
        status: isOk(payload),
        result_excerpt_redacted: resultExcerpt(payload),
      });
    }
    appendEvent(runDir, event);
  } catch (err) {
    process.stderr.write(
      `warn: [post-tool-use] tool_call emit failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("post-tool-use.ts") ||
    process.argv[1].endsWith("post-tool-use.js"))
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `fatal: [post-tool-use] ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(0);
  });
}
