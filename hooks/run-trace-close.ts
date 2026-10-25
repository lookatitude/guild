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
 *   - either it is not yet closed (provenance.json absent), OR it WAS closed
 *     but received more tool activity since (see "Reopen-on-activity" below).
 * A bare chat session, or a run whose entrypoint never called startRun, is a
 * silent no-op — we never fabricate a close for a run that was never started
 * (NN#7: every close needs a started run).
 *
 * Reopen-on-activity (hooks.json Stop-per-turn finding): Stop fires at the end
 * of EVERY assistant turn, not at session end, so a multi-turn /guild
 * lifecycle (e.g. guild:ideate's Socratic clarify loop yielding to the user,
 * or separate /guild:<phase> commands sharing one sentinel-resolved run-id)
 * gets its run marked `closed` after the FIRST turn — and every later turn's
 * tool activity would otherwise attach to a run whose provenance is already
 * frozen. Rather than guess at "is this phase terminal" (a run's phase set
 * varies by command), this hook detects the SYMPTOM directly: if the run was
 * previously closed but `newestPostCloseActivityMs()` shows tool/telemetry
 * activity strictly after the recorded `closed_at`, the earlier close was
 * premature — re-run the close path so provenance.json, the terminal learning
 * checkpoint, and the run_closed trace line all reflect the LATEST state. A
 * run that has genuinely gone quiet since its close is left alone (idempotent
 * no-op, same as before). This composes with the pre-existing self-heal guard
 * (closeStalePriorOpenRun, invoked when the NEXT run starts) for runs that
 * never reach a later Stop at all — that guard finalizes truly-abandoned
 * still-open runs; this one keeps a still-active run's CLOSED record current.
 *
 * Run-id resolution: GUILD_RUN_ID env ONLY (session_context §5 / T3b —
 * sentinels are interactive intake, never a writer identity); the close write
 * is verified against the run's minted binding inside emitRunClosed and the
 * reopen leg. The close path itself is lib/run-close.ts closeGuildRun, shared
 * with `run-trace close` (#277). See lib/run-trace.ts + lib/hook-binding.ts.
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

import { resolveGuildRoot } from "./lib/guild-root.js";
import { resolveRunIdForTrace } from "./lib/run-trace.js";
// #277: the close path is shared with the `run-trace close` CLI.
import { closeGuildRun } from "./lib/run-close.js";
// L5a: host-neutral hook payload + Claude emitter. The local HookPayload is now
// the shared `GuildHookEvent`; for Claude the emitter mapping is the identity, so
// the run_closed trace behavior is preserved byte-for-byte.
import {
  emitClaudeHookEvent,
  readHookStdin,
  type GuildHookEvent,
} from "./lib/guild-hook-event.js";
// T10 (KTD23/R45): the layout bootstrap, fail-open wrapper for hook entries.
import { ensureStorageLayout } from "./lib/ensure-layout.js";

// Re-exported for the pinning tests; the implementations live in lib/run-close.ts.
export {
  collectCorroboratedTouchedTasks,
  findActiveWork,
  findTerminalCheckpoint,
  recoverPrematureClose,
} from "./lib/run-close.js";

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

  // T10 (KTD23): layout bootstrap on a write-capable entry. A hook can be the
  // first thing to touch a root after an upgrade landed, so it runs the
  // bootstrap itself; on a current root this is a stat plus one marker read.
  // Fail-open by contract — a refused root still exits 0.
  const layout = ensureStorageLayout(root, "run-trace-close");
  // KTD23 fails CLOSED on a layout this build does not understand: a future
  // marker means every write below would land in a root that is not ours.
  if (!layout.ok) {
    // Silent: this hook's stderr budget is 0 bytes
    // (hooks/__tests__/hook-output-budget.test.ts). The refusal is in the
    // process memo; activation is where an operator is told.
    return;
  }

  const runId = resolveRunIdForTrace(root, { GUILD_RUN_ID: process.env["GUILD_RUN_ID"] });
  if (!runId) process.exit(0); // no active run

  // Every outcome exits 0: a close-trace failure must never block session end.
  closeGuildRun(root, runId, { tag: "run-trace-close" });
  process.exit(0);
}

// T3b rework F4 / #74: main() runs ONLY when this file is the actual process
// entrypoint (the `npx tsx` shebang invocation, or the bundled
// dist/run-trace-close.js run directly via hooks.json). Without this guard,
// merely `import`/`require`-ing this module (e.g. a test pulling in
// `findTerminalCheckpoint`) executes main() as a side effect of module load:
// it reads stdin, fails to parse it, and hits the catch at line 137, which
// calls `process.exit(0)` — killing the whole jest worker mid-run and
// truncating the reporter before its Tests:/Suites: summary, turning
// `npm test` into a false green. This file isn't imported into any other
// hook's bundle, so `require.main === module` is safe here (see
// emit-learning-checkpoint.ts for the case where it isn't).
if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[run-trace-close] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(0);
  });
}
