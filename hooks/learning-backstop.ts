#!/usr/bin/env -S npx tsx
/**
 * hooks/learning-backstop.ts
 *
 * Event:   Stop (wired AFTER maybe-reflect.js and run-trace-close.js in
 *          hooks/hooks.json — the backstop is the last word on the run's
 *          learning trail for this turn).
 * Purpose: G-7 (SC-3) — guarantee a `guild.learning_checkpoint.v1` record
 *          exists for EVERY phase recorded in run.yaml's `phases_log`, even
 *          when the model forgot to emit one at the phase boundary. The
 *          emitted record is the no-op all-`none` 12-target verdict, marked
 *          `backstop: true` (see hooks/lib/learning-backstop.ts for the
 *          sweep + phase-token mapping).
 *
 * Only fires when:
 *   - a run-id is resolvable (GUILD_RUN_ID → current-run-id sentinels), AND
 *   - `<runDir>/run.yaml` exists (a run that was actually started).
 * A bare chat session is a silent no-op. Idempotent: existing checkpoint
 * files (model-emitted or prior backstop) are never overwritten.
 *
 * Stdin:  Claude Code Stop hook payload (JSON).
 * Stdout: Silent.
 * Stderr: Diagnostics only.
 * Exit:   Always 0 — a backstop failure must never block session end.
 *
 * Runner: bundled to dist/learning-backstop.js via esbuild (hooks/package.json).
 */

import { resolveGuildRoot } from "./lib/guild-root.js";
import { resolveRunIdForTrace } from "./lib/run-trace.js";
import { runLearningBackstop } from "./lib/learning-backstop.js";

interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  stop_reason?: string;
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
    process.exit(0); // invalid payload — silent no-op
  }

  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  // Walk up from cwd to find the repo root — .guild/ lives at the repo root.
  const guildRoot = resolveGuildRoot(cwd);

  const runId = resolveRunIdForTrace(guildRoot, {
    GUILD_RUN_ID: process.env["GUILD_RUN_ID"],
  });
  if (!runId) process.exit(0); // no active run — nothing to backstop

  const result = runLearningBackstop({ guildRoot, runId });

  if (result.written.length > 0) {
    process.stderr.write(
      `[learning-backstop] wrote ${result.written.length} backstop checkpoint(s) ` +
        `for run ${runId}: [${result.written.join(", ")}]\n`,
    );
  }
  if (result.unknownTokens.length > 0) {
    process.stderr.write(
      `[learning-backstop] WARN: unknown phases_log token(s) skipped: ` +
        `[${result.unknownTokens.join(", ")}]\n`,
    );
  }
  for (const err of result.errors) {
    process.stderr.write(`[learning-backstop] WARN: ${err}\n`);
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[learning-backstop] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(0); // never block session end
});
