#!/usr/bin/env -S npx tsx
/**
 * hooks/capture-telemetry.ts
 *
 * Events:  PostToolUse | SubagentStop | UserPromptSubmit
 * Purpose: Appends one NDJSON event line per invocation to
 *          .guild/runs/<run-id>/events.ndjson.
 *
 * Event schema:
 * {
 *   "ts":             "<ISO-8601>",
 *   "event":          "PostToolUse | SubagentStop | UserPromptSubmit",
 *   "tool":           "<tool name, empty for SubagentStop/UserPromptSubmit>",
 *   "specialist":     "<agent name if applicable, empty for main session>",
 *   "payload_digest": "<short signature of inputs, not full payload>",
 *   "ok":             <bool>,
 *   "ms":             <duration ms if known, 0 otherwise>,
 *   "prompt":         "<user prompt text, UserPromptSubmit only; omitted otherwise>"
 * }
 *
 * Run-id resolution (priority order):
 *   1. GUILD_RUN_ID env var (set by tests or orchestrator)
 *   2. stdin payload session_id field
 *   3. fallback: "session-<date>"
 *
 * Working directory resolution (priority order):
 *   1. GUILD_CWD env var (set by tests)
 *   2. stdin payload cwd field
 *   3. process.cwd()
 *
 * Stdin:   JSON — Claude Code hook payload (PostToolUse / SubagentStop / UserPromptSubmit).
 * Stdout:  Silent — Claude Code may consume stdout.
 * Stderr:  Error messages on failure (telemetry failures must not block tool execution).
 * Exit:    Always 0 — telemetry failures must not block tool execution.
 *
 * Runner:  npx -y tsx hooks/capture-telemetry.ts
 *
 * Retention: events.ndjson is append-only and grows unbounded. Consuming repos
 * should periodically archive/rotate `.guild/runs/<run-id>/events.ndjson` files
 * (the P5 audit flags this for a future retention/rotation policy). For now,
 * manual cleanup via `find .guild/runs -name events.ndjson -mtime +30` is a
 * reasonable default.
 *
 * Manual smoke test:
 *   mkdir -p /tmp/guild-smoke/.guild/runs/test-run
 *   cat hooks/fixtures/post-tool-use.json | \
 *     (cd /tmp/guild-smoke && GUILD_RUN_ID=test-run npx -y tsx /path/to/hooks/capture-telemetry.ts)
 *   cat /tmp/guild-smoke/.guild/runs/test-run/events.ndjson
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────

interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: { success?: boolean; error?: string } | unknown;
  agent_name?: string;
  stop_reason?: string;
  duration_ms?: number;
  prompt?: string;
}

interface TelemetryEvent {
  ts: string;
  event: string;
  tool: string;
  specialist: string;
  payload_digest: string;
  ok: boolean;
  ms: number;
  prompt?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Short deterministic digest of an arbitrary value (first 12 hex chars of sha256). */
function digest(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
}

/**
 * Determine if the tool response signals an error.
 * Treats explicit success:false or presence of error field as not-ok.
 */
function isOk(payload: HookPayload): boolean {
  const resp = payload.tool_response;
  if (resp === null || resp === undefined) return true;
  if (typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    if (r["success"] === false) return false;
    if (typeof r["error"] === "string" && r["error"].length > 0) return false;
  }
  return true;
}

/** Read all stdin into a string. */
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const raw = await readStdin();

  let payload: HookPayload = {};
  try {
    payload = JSON.parse(raw.trim()) as HookPayload;
  } catch {
    // Invalid JSON — log to stderr and exit 0 (must not block)
    process.stderr.write("[capture-telemetry] WARN: invalid JSON on stdin; skipping.\n");
    process.exit(0);
  }

  // Resolve run context.
  // Convention: run-id is `run-<session_id>` OR honored directly from GUILD_RUN_ID
  // env var (which the agent-team launcher sets per pane so hooks inside the
  // pane converge on the launcher's session manifest path). Fallback is
  // `run-session-<date>` when neither is available.
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const sessionId = payload.session_id;
  const runId =
    process.env["GUILD_RUN_ID"] ??
    (sessionId ? `run-${sessionId}` : `run-session-${new Date().toISOString().slice(0, 10)}`);

  // Build event
  const eventName = payload.hook_event_name ?? "PostToolUse";
  const tool =
    eventName === "SubagentStop" || eventName === "UserPromptSubmit"
      ? ""
      : (payload.tool_name ?? "");
  const specialist = payload.agent_name ?? "";
  const payloadDigest = digest(
    payload.tool_input ?? payload.stop_reason ?? payload.prompt ?? ""
  );
  const ok = isOk(payload);
  const ms = typeof payload.duration_ms === "number" ? payload.duration_ms : 0;

  const event: TelemetryEvent = {
    ts: new Date().toISOString(),
    event: eventName,
    tool,
    specialist,
    payload_digest: payloadDigest,
    ok,
    ms,
  };
  if (eventName === "UserPromptSubmit" && typeof payload.prompt === "string") {
    event.prompt = payload.prompt;
  }

  // Write to .guild/runs/<run-id>/events.ndjson
  const runsDir = path.join(cwd, ".guild", "runs", runId);
  const eventsFile = path.join(runsDir, "events.ndjson");

  try {
    fs.mkdirSync(runsDir, { recursive: true });
    fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(
      `[capture-telemetry] ERROR: failed to write event: ${
        err instanceof Error ? err.message : String(err)
      }\n`
    );
    // Still exit 0 — telemetry failures must not block tool execution
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[capture-telemetry] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(0); // Exit 0 always
});
