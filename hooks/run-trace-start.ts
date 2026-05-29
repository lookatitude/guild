#!/usr/bin/env -S npx tsx
/**
 * hooks/run-trace-start.ts
 *
 * Event:   UserPromptSubmit
 * Purpose: Emit the run_started guild.trace_event.v1 marker into the active
 *          run's logs/v1.4-events.jsonl exactly once per run (SC-B, Lane B3).
 *
 * Why UserPromptSubmit (not SessionStart): a Claude session may host several
 * distinct /guild runs, and the run-id sentinel is only written once an
 * entrypoint has called B2's startRun. UserPromptSubmit fires after that, and
 * emitRunStarted is idempotent (a run_started already present short-circuits),
 * so the FIRST prompt of a run emits the marker and subsequent prompts are
 * no-ops. If no run-id is resolvable yet (no /guild run started), this is a
 * silent no-op.
 *
 * Run-id resolution: GUILD_RUN_ID → .guild/runs/current-run-id (legacy) →
 *                    .guild/current-run-id (B2 sentinel). See lib/run-trace.ts.
 *
 * Stdin:  Claude Code UserPromptSubmit hook payload (JSON). cwd is read from it.
 * Stdout: Silent (Claude Code may consume it).
 * Stderr: Diagnostics only.
 * Exit:   Always 0 — a trace failure must never block the session.
 *
 * Runner: bundled to dist/run-trace-start.js via esbuild (hooks/package.json).
 */

import { resolveGuildRoot } from "./lib/guild-root.js";
import { emitRunStarted, resolveRunIdForTrace } from "./lib/run-trace.js";

interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: HookPayload = {};
  try {
    payload = JSON.parse(raw.trim()) as HookPayload;
  } catch {
    process.exit(0); // no payload → nothing to do
  }

  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const root = resolveGuildRoot(cwd);

  const runId = resolveRunIdForTrace(root, { GUILD_RUN_ID: process.env["GUILD_RUN_ID"] });
  if (!runId) {
    // No active /guild run — silent no-op (a bare chat session emits nothing).
    process.exit(0);
  }

  emitRunStarted(root, runId);
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[run-trace-start] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(0);
});
