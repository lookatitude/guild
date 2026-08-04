#!/usr/bin/env -S npx tsx
/**
 * hooks/lean-lead-guard.ts
 *
 * Event:   Stop
 * Purpose: OIR issue #57 (work-item oir-wi-57) — the advisory half of the
 *          lean-lead inline-shortcut EXPIRY codified in
 *          `skills/meta/execute-plan/SKILL.md §"Inline shortcut under high
 *          autonomy" → "### Expiry"`. The Stop hook sees every turn end, so it
 *          is the right observation point for "has the lead kept editing
 *          inline past its budget while lanes are still open" — SubagentStop
 *          only fires for dispatched subagents, and PreToolUse would have to
 *          guess at "still open" state on every single tool call instead of
 *          once per turn.
 *
 *          ADVISORY, NOT A HARD BLOCK — it never denies a tool call and
 *          never forces a specific corrective action, unlike a PreToolUse
 *          deny. It emits `hookSpecificOutput.additionalContext` (the same
 *          envelope `hooks/lib/reanchor.ts` uses for the PreCompact/
 *          SessionStart re-anchor). Per Claude Code's Stop-hook contract,
 *          `additionalContext` on Stop IS non-error, model-visible feedback
 *          that continues the conversation for one more turn so the lead can
 *          read and act on it — it does not silently log and vanish the way
 *          a bare stderr message on a Stop hook would. That is a deliberate,
 *          honestly-described tradeoff for this guard: the lead gets exactly
 *          one more turn to see the advisory and decide what to do with it;
 *          nothing about the advisory forces WHAT it does next. All detection
 *          logic (open-lane count, hands-on-edit count, compaction boundary,
 *          fire-once/override gating) lives in `hooks/lib/lean-lead-guard.ts`
 *          — this file is stdin/stdout wiring only, mirroring
 *          `hooks/pre-compact.ts` / `hooks/session-reanchor.ts`.
 *
 * Stdin:   JSON — Claude Code Stop hook payload (carries `cwd`).
 * Stdout:  The additionalContext envelope when the advisory fires;
 *          otherwise NOTHING (zero-noise: no active run, no open lanes,
 *          under threshold, already fired this cycle, or overridden).
 * Stderr:  Diagnostics only.
 * Exit:    Always 0 — an advisory failure must never block session end.
 *
 * Runner:  bundled to dist/lean-lead-guard.js via esbuild (hooks/package.json).
 */

import { resolveGuildRoot } from "./lib/guild-root.js";
import { resolveRunIdForTrace } from "./lib/run-trace.js";
// Observational guard (emits a Stop additionalContext envelope; no run-tree
// write under a redirectable identity): resolve the active run from the
// current-run-id sentinel intake surface when GUILD_RUN_ID is absent.
// resolveRunIdForTrace is the WRITER-identity resolver (env-only, T3b §5).
import { locateCandidateRunId } from "./lib/hook-binding.js";
import { evaluateLeanLeadGuard } from "./lib/lean-lead-guard.js";
import { buildAdditionalContextEnvelope } from "./lib/reanchor.js";

interface StopPayload {
  cwd?: string;
  session_id?: string;
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

export async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: StopPayload = {};
  try {
    if (raw.trim().length > 0) {
      const parsed: unknown = JSON.parse(raw.trim());
      // Type-guard the JSON boundary — valid JSON can still be null / a number /
      // an array, and casting straight to the payload interface would make the
      // `payload.cwd` read below throw. Only a plain object is usable.
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as StopPayload;
      }
    }
  } catch {
    // Malformed stdin has no `cwd` we can trust — fall through to env/process.
  }

  const payloadCwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
  const cwd = process.env["GUILD_CWD"] ?? payloadCwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);

  const runId =
    resolveRunIdForTrace(guildRoot, { GUILD_RUN_ID: process.env["GUILD_RUN_ID"] }) ??
    locateCandidateRunId(guildRoot)?.run_id ??
    null;
  if (!runId) return; // no active run to guard — zero noise.

  try {
    const { advisory } = await evaluateLeanLeadGuard(guildRoot, runId, process.env);
    if (advisory !== null) {
      process.stdout.write(buildAdditionalContextEnvelope("Stop", advisory));
    }
  } catch (err) {
    process.stderr.write(
      `warn: [lean-lead-guard] evaluation failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[lean-lead-guard] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(0); // never block session end
  });
}
