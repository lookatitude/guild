#!/usr/bin/env -S npx tsx
/**
 * hooks/pre-compact.ts
 *
 * Event:   PreCompact
 * Purpose: No-op log-emitter per architect's audit. PreCompact fires
 *          before Claude Code compacts conversation context (clearing
 *          the working buffer). For Guild this is a useful trace
 *          point: any in-flight phase/lane state should be flushed to
 *          .guild/runs/<run-id>/logs before the host buffers reset.
 *
 *          The handler emits a `hook_event` JSONL line via T3c's
 *          appendEvent() so the audit log captures the compact
 *          boundary. Falls through cleanly when GUILD_RUN_ID is unset
 *          (host runs outside a tracked /guild lifecycle session).
 *
 * Stdin:   JSON — Claude Code PreCompact hook payload.
 * Stdout:  Silent (Claude Code may consume it).
 * Stderr:  Diagnostic warnings only.
 * Exit:    Always 0 — telemetry must not block.
 *
 * Run-id resolution: process.env.GUILD_RUN_ID. Unset → fall through.
 *
 * runDir resolution:
 *   1. process.env.GUILD_RUN_DIR
 *   2. process.env.GUILD_CWD + .guild/runs/<run-id>
 *   3. process.cwd() + .guild/runs/<run-id>
 */

import * as path from "node:path";

import { appendEvent, type HookEvent } from "../benchmark/src/log-jsonl.js";

interface PreCompactPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  /** Optional per-host payload — the architect contract treats it as opaque. */
  payload?: unknown;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/**
 * Build a short string excerpt from an arbitrary payload value. The
 * downstream `redactEventFields` applies token-shape patterns + field
 * caps; here we only stringify so the redaction pipeline has something
 * to work with.
 */
function payloadExcerpt(payload: unknown): string {
  if (payload === undefined || payload === null) return "";
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return "";
  }
}

export async function main(): Promise<void> {
  const runId = process.env["GUILD_RUN_ID"];
  if (typeof runId !== "string" || runId.length === 0) {
    process.stderr.write(
      "warn: [pre-compact] GUILD_RUN_ID unset — falling through (no log emit).\n",
    );
    return;
  }

  const raw = await readStdin();
  let payload: PreCompactPayload = {};
  try {
    if (raw.trim().length > 0) {
      payload = JSON.parse(raw.trim()) as PreCompactPayload;
    }
  } catch {
    process.stderr.write("warn: [pre-compact] invalid JSON on stdin; emitting bare event.\n");
  }

  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const runDir =
    process.env["GUILD_RUN_DIR"] ??
    path.join(cwd, ".guild", "runs", runId);

  const event: HookEvent = {
    ts: new Date().toISOString(),
    event: "hook_event",
    run_id: runId,
    hook_name: "PreCompact",
    payload_excerpt_redacted: payloadExcerpt(payload.payload),
    latency_ms: 0,
    status: "ok",
  };

  try {
    appendEvent(runDir, event);
  } catch (err) {
    process.stderr.write(
      `warn: [pre-compact] log emit failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("pre-compact.ts") ||
    process.argv[1].endsWith("pre-compact.js"))
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `fatal: [pre-compact] ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.exit(0);
  });
}
