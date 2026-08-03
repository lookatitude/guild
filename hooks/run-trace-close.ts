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
 * reopen leg below. See lib/run-trace.ts + lib/hook-binding.ts.
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
import {
  defaultResolveHost,
  emitRunClosed,
  newestPostCloseActivityMs,
  resolveRunIdForTrace,
} from "./lib/run-trace.js";
// L5a: host-neutral hook payload + Claude emitter. The local HookPayload is now
// the shared `GuildHookEvent`; for Claude the emitter mapping is the identity, so
// the run_closed trace behavior is preserved byte-for-byte.
import {
  emitClaudeHookEvent,
  readHookStdin,
  type GuildHookEvent,
} from "./lib/guild-hook-event.js";
// T3 §5: the reopen-on-activity leg re-opens the run's binding with the run's
// OWN exact nonce before re-closing (reopenRunBinding is fail-closed on
// absent/malformed/mismatched records). Rework F1: the nonce is CALLER-
// PRESENTED only — the GUILD_RUN_BINDING_REF env envelope naming this exact
// run. It is NEVER recovered from binding.json (possession of a run id +
// filesystem readability is not write authorization).
import {
  readHookBindingEnvelope,
  reopenRunBinding,
} from "../scripts/lib/run-binding.js";

/**
 * Tolerance window (ms) for the reopen-on-activity check (see header). Newer
 * activity strictly beyond this margin past `closed_at` is treated as a
 * genuinely later turn; activity within it is attributed to the close
 * operation's own second-precision timestamp + its own trace-line write.
 */
const REOPEN_TOLERANCE_MS = 2000;

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

  // Already closed? Check whether it's GENUINELY done or whether more tool
  // activity landed after the earlier close (reopen-on-activity, see header).
  const provenanceFile = path.join(runDir, "provenance.json");
  if (fs.existsSync(provenanceFile)) {
    let terminal = true; // conservative default: an unreadable provenance.json is never reopened
    let closedAtMs = 0;
    try {
      const prov = JSON.parse(fs.readFileSync(provenanceFile, "utf8")) as {
        status?: string;
        closed_at?: string;
      };
      terminal = prov.status === "closed" || prov.status === "failed";
      closedAtMs = typeof prov.closed_at === "string" ? Date.parse(prov.closed_at) : 0;
    } catch {
      /* unreadable provenance.json — terminal stays true, closedAtMs stays 0 */
    }
    if (terminal) {
      const latestActivityMs = newestPostCloseActivityMs(root, runId);
      // Tolerance absorbs two sources of same-invocation "self" lag that are
      // NOT genuine later activity: (a) `closed_at` is second-precision
      // (env.now() strips milliseconds — see lib/run-trace.ts), so it is
      // always <= the real wall-clock instant it was captured at; (b)
      // emitRunClosed's OWN run_closed trace-line append lands in
      // logs/v1.4-events.jsonl (one of the candidate files) a few ms AFTER
      // `closed_at` was computed, as an unavoidable side effect of the close
      // that just happened. REOPEN_TOLERANCE_MS is generous relative to (a)+(b)
      // (well under a second in practice) while staying far below the gap a
      // genuinely later assistant turn would produce (seconds to minutes).
      const noNewActivity =
        latestActivityMs === 0 ||
        !Number.isFinite(closedAtMs) ||
        latestActivityMs <= closedAtMs + REOPEN_TOLERANCE_MS;
      if (noNewActivity) {
        process.exit(0); // genuinely done — idempotent no-op
      }
      process.stderr.write(
        `[run-trace-close] run ${runId} received tool activity after its prior close ` +
          `(closed_at=${new Date(closedAtMs).toISOString()}) — re-closing with the latest state.\n`,
      );
      // T3 §5: the run is being REOPENED (it was not genuinely done), so its
      // binding state follows — reopen with the run's own exact nonce, fail
      // closed on absent/malformed/mismatch. Rework F1: the nonce comes ONLY
      // from the caller-presented env envelope naming this exact run — never
      // recovered from binding.json. Without it the re-close is refused
      // (emitRunClosed also fails closed downstream).
      const envelope = readHookBindingEnvelope(process.env);
      const recloseRef =
        envelope && envelope.run_id === runId ? envelope.binding_ref : undefined;
      if (recloseRef === undefined) {
        process.stderr.write(
          `[run-trace-close] WARN: binding_rejected — cannot re-close ${runId}: the ` +
            `GUILD_RUN_BINDING_REF envelope does not name this run. No write performed.\n`,
        );
        process.exit(0);
      }
      try {
        reopenRunBinding({ root, run_id: runId }, recloseRef);
      } catch (err) {
        process.stderr.write(
          `[run-trace-close] WARN: ${err instanceof Error ? err.message : String(err)} — ` +
            `re-close refused (fail closed).\n`,
        );
        process.exit(0);
      }
      // Fall through — recompute + re-emit the close below.
    }
    // terminal === false (e.g. status: "resumable") falls through unconditionally.
  }

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
