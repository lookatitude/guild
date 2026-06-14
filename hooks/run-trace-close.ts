#!/usr/bin/env -S npx tsx
/**
 * hooks/run-trace-close.ts
 *
 * Event:   Stop
 * Purpose: Close the active run via B2's closeRun and emit the terminal
 *          run_closed guild.trace_event.v1 marker (SC-B, Lane B3).
 *
 * This is a SEPARATE Stop hook from maybe-reflect.js — it runs alongside it so
 * the reflect heuristic gate is untouched (no regression). closeRun is the
 * authority for provenance.json + the terminal-event pointer + the run.yaml
 * status flip; emitRunClosed then appends the run_closed JSONL line carrying the
 * SAME event_id the pointer references (B1 ordering note).
 *
 * Only fires when:
 *   - a run-id is resolvable (an active /guild run), AND
 *   - run.yaml exists for it (a run B2's startRun actually opened), AND
 *   - it is not already closed (provenance.json absent ⇒ still open).
 * A bare chat session, or a run whose entrypoint never called startRun, is a
 * silent no-op — we never fabricate a close for a run that was never started
 * (NN#7: every close needs a started run).
 *
 * Run-id resolution: GUILD_RUN_ID → .guild/runs/current-run-id (legacy) →
 *                    .guild/current-run-id (B2 sentinel). See lib/run-trace.ts.
 *
 * Host: resolved host-neutrally via defaultResolveHost (GUILD_HOST-driven,
 * never claude-pinned in logic), passed to createRealEnv inside emitRunClosed.
 *
 * Stdin:  Claude Code Stop hook payload (JSON).
 * Stdout: Silent.
 * Stderr: Diagnostics only.
 * Exit:   Always 0 — a close-trace failure must never block session end.
 *
 * Runner: bundled to dist/run-trace-close.js via esbuild (hooks/package.json).
 */

import * as fs from "fs";
import * as path from "path";

import { resolveGuildRoot } from "./lib/guild-root.js";
import { defaultResolveHost, emitRunClosed, resolveRunIdForTrace } from "./lib/run-trace.js";
// L5a: host-neutral hook payload + Claude emitter. The local HookPayload is now
// the shared `GuildHookEvent`; for Claude the emitter mapping is the identity, so
// the run_closed trace behavior is preserved byte-for-byte.
import {
  emitClaudeHookEvent,
  readHookStdin,
  type GuildHookEvent,
} from "./lib/guild-hook-event.js";

// ── HK-09 — terminal learning checkpoint resolution ───────────────────────

/**
 * Find the terminal `guild.learning_checkpoint.v1` YAML for the given run.
 *
 * Preference order:
 *   1. `reflection-<runId>.yaml` (the terminal phase) — preferred regardless
 *      of mtime, as reflection is always the last phase in the lifecycle.
 *   2. Last-modified `.yaml` file in the `learning/` directory — fallback
 *      when no reflection-phase checkpoint was written (e.g. run stopped
 *      mid-lifecycle).
 *
 * Returns `null` when:
 *   - the `learning/` directory does not exist, or
 *   - the `learning/` directory has no `.yaml` files.
 *
 * EXPORTED: consumed by tests (TDD) and callable by future tooling.
 */
export function findTerminalCheckpoint(runDir: string, runId: string): string | null {
  const learningDir = path.join(runDir, "learning");
  if (!fs.existsSync(learningDir)) return null;

  // 1. Prefer the reflection-phase checkpoint (always the terminal phase).
  const reflectionFile = path.join(learningDir, `reflection-${runId}.yaml`);
  if (fs.existsSync(reflectionFile)) return reflectionFile;

  // 2. Fall back to the last-modified .yaml file.
  let yamlFiles: string[];
  try {
    yamlFiles = fs.readdirSync(learningDir).filter((f) => f.endsWith(".yaml"));
  } catch {
    return null;
  }
  if (yamlFiles.length === 0) return null;

  const sorted = yamlFiles
    .map((f) => path.join(learningDir, f))
    .sort((a, b) => {
      try {
        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
      } catch {
        return 0;
      }
    });

  return sorted[0] ?? null;
}

async function main(): Promise<void> {
  const raw = await readHookStdin();
  let payload: GuildHookEvent = {};
  try {
    payload = emitClaudeHookEvent(raw);
  } catch {
    process.exit(0);
  }

  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const root = resolveGuildRoot(cwd);

  const runId = resolveRunIdForTrace(root, { GUILD_RUN_ID: process.env["GUILD_RUN_ID"] });
  if (!runId) process.exit(0); // no active run

  const runDir = path.join(root, ".guild", "runs", runId);
  // NN#7 guard — only close a run B2's startRun actually opened.
  if (!fs.existsSync(path.join(runDir, "run.yaml"))) process.exit(0);
  // Already closed (provenance exists) — idempotent no-op.
  if (fs.existsSync(path.join(runDir, "provenance.json"))) process.exit(0);

  // HK-09: populate provenance.json.final_learning_checkpoint
  const finalLearningCheckpoint = findTerminalCheckpoint(runDir, runId);
  emitRunClosed(root, runId, defaultResolveHost, {
    status: "closed",
    ...(finalLearningCheckpoint !== null
      ? { final_learning_checkpoint: finalLearningCheckpoint }
      : {}),
  });
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[run-trace-close] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(0);
});
