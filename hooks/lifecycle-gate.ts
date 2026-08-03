#!/usr/bin/env -S npx tsx
/**
 * hooks/lifecycle-gate.ts
 *
 * Events:  UserPromptSubmit (invoked from `hooks/check-skill-coverage.sh`,
 *          which owns the single registered UserPromptSubmit bash entry) and
 *          Stop (registered directly in `hooks/hooks.json`).
 *
 * Purpose: OIR issue #59 (work-item oir-wi-59) — promote lifecycle adherence
 *          from PROSE to an ACTIVE gate. All detection logic lives in
 *          `hooks/lib/lifecycle-gate.ts`; this file is stdin/stdout wiring
 *          only, mirroring `hooks/lean-lead-guard.ts` /
 *          `hooks/session-reanchor.ts`.
 *
 *          Mode is chosen from the payload's `hook_event_name`, so ONE bundle
 *          serves both surfaces:
 *
 *          - UserPromptSubmit → the ACTIVE gate, which emits ONE of two
 *            envelopes. On a crossing: `{"decision":"block","reason":…}` — the
 *            UserPromptSubmit contract's genuine block (the prompt is not
 *            processed and the reason is surfaced to the USER) — plus the same
 *            text on stderr. On the NEXT accepted prompt:
 *            `hookSpecificOutput.additionalContext` carrying that same body,
 *            because a block reaches the user but never the MODEL, and the
 *            model is the thing that drifted. That deferred delivery is what
 *            makes the block corrective rather than merely obstructive. The
 *            gate cannot dead-end a session: it is edge-triggered once per
 *            threshold crossing, so re-sending the prompt proceeds, and both
 *            documented overrides (`[guild:gate-override]` in the prompt,
 *            `GUILD_LIFECYCLE_GATE_OVERRIDE=1` in the env) suppress it outright.
 *          - Stop → the close-time backstop, emitted as
 *            `{"decision":"block","reason":…}`. Stop's block is the ONLY
 *            documented way to hand text back to the model at turn end
 *            (`additionalContext` is a UserPromptSubmit/SessionStart field);
 *            it does not end the session, it gives the lead one more turn to
 *            run the gate it skipped. It is kept from looping by the per-run
 *            missing-set latch, which is written ONLY on the turn the
 *            block is actually emitted, and which re-arms ONLY when the set of
 *            missing artifacts changes (bounded by a hard per-run fire cap).
 *
 * Stdin:   JSON — the Claude Code hook payload for either event.
 * Stdout:  The block/advisory envelope when a gate fires; otherwise NOTHING
 *          (zero-noise: no active run, not past build-start, no ad-hoc drift,
 *          already fired this cycle, disabled, or overridden).
 * Stderr:  The gate body (UserPromptSubmit) + diagnostics.
 * Exit:    Always 0 — the JSON envelope carries the decision. A hook crash must
 *          never wedge a prompt or a session end.
 *
 * Runner:  bundled to dist/lifecycle-gate.js via esbuild (hooks/package.json).
 */

import { resolveGuildRoot } from "./lib/guild-root.js";
import { resolveRunIdForTrace } from "./lib/run-trace.js";
// The lifecycle gate is OBSERVATIONAL (it emits a block envelope; it does not
// write to the run tree under a redirectable identity), so it resolves the
// active run from the current-run-id sentinel intake surface when GUILD_RUN_ID
// is absent — resolveRunIdForTrace is the WRITER-identity resolver (env-only,
// T3b §5) and never reads a sentinel.
import { locateCandidateRunId } from "./lib/hook-binding.js";
import { evaluateCloseGate, evaluateLifecycleGate } from "./lib/lifecycle-gate.js";
import { buildAdditionalContextEnvelope } from "./lib/reanchor.js";

interface HookPayload {
  cwd?: string;
  prompt?: string;
  session_id?: string;
  hook_event_name?: string;
  /** Stop only — true when this turn is itself a hook-continued one. */
  stop_hook_active?: boolean;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/** The UserPromptSubmit block envelope. */
export function buildBlockEnvelope(reason: string): string {
  return JSON.stringify({ decision: "block", reason });
}

export async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: HookPayload = {};
  try {
    if (raw.trim().length > 0) {
      const parsed: unknown = JSON.parse(raw.trim());
      // Type-guard the JSON boundary — valid JSON can still be null / a number
      // / an array, and casting straight to the payload interface would make
      // the field reads below throw.
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        payload = parsed as HookPayload;
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
  if (!runId) return; // no active run to gate — zero noise.

  // Mode selection. `hook_event_name` is authoritative; when a host omits it,
  // the presence of a `prompt` field identifies UserPromptSubmit. Anything else
  // falls back to the Stop-side advisory, which can only ever add context.
  const isPromptEvent =
    payload.hook_event_name === "UserPromptSubmit" ||
    (payload.hook_event_name === undefined && typeof payload.prompt === "string");

  try {
    if (isPromptEvent) {
      const promptText = typeof payload.prompt === "string" ? payload.prompt : null;
      const { block, context } = await evaluateLifecycleGate(
        guildRoot,
        runId,
        promptText,
        process.env,
      );
      if (block !== null) {
        process.stdout.write(buildBlockEnvelope(block));
        process.stderr.write(block + "\n");
      } else if (context !== null) {
        // The correction a previous block never got to show the model.
        process.stdout.write(buildAdditionalContextEnvelope("UserPromptSubmit", context));
      }
      return;
    }
    // Stop. `stop_hook_active` is NOT an unconditional early return: the very
    // turn a Stop block continues is the turn in which the lead runs the
    // missing gate, so returning here would suppress the follow-up that says
    // "review.md landed — verify.md is still absent", and the run could close
    // exactly there. The loop the flag exists to prevent is closed instead by
    // the gate's own state: it fires only when the MISSING SET CHANGES, and at
    // most MAX_CLOSE_FIRES times per run.
    const { advisory } = await evaluateCloseGate(guildRoot, runId, process.env);
    if (advisory !== null) {
      process.stdout.write(buildBlockEnvelope(advisory));
      process.stderr.write(advisory + "\n");
    }
  } catch (err) {
    process.stderr.write(
      `warn: [lifecycle-gate] evaluation failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[lifecycle-gate] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(0); // never wedge a prompt or a session end
  });
}
