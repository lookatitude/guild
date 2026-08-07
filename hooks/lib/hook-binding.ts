/**
 * hooks/lib/hook-binding.ts
 *
 * T3b — the hook leg of guild.session_context.v1 §5 (run-binding authority).
 *
 * The SINGLE write-authorization guard for hook-owned runtime writers (trace,
 * telemetry, checkpoint, sidecar, run-state, reflection). Every hook writer
 * calls authorizeHookWrite() BEFORE its first write and refuses on a non-ok
 * verdict: no write, a structured `binding_rejected` diagnostic, and the
 * caller's refusal path (a session hook stays exit-0 — a trace failure must
 * never block a session; the run-trace CLI exits non-zero).
 *
 * Identity resolution (T3's published hook contract, run-binding.ts §"Hook-
 * facing run-binding contract"):
 *   1. An explicit caller-supplied runId (an explicitly-addressed run, e.g.
 *      CLI --run-id) or the GUILD_RUN_ID env of the bound run's process.
 *   2. The binding nonce is CALLER-PRESENTED ONLY (rework F1): explicit
 *      caller opt → the GUILD_RUN_BINDING_REF env envelope (accepted ONLY
 *      when it names this exact run). The guard NEVER reads binding.json to
 *      recover a nonce the caller did not present — possession of a run id
 *      plus filesystem readability is not write authorization. A missing/
 *      blank nonce refuses (`binding_absent`) even for a minted OPEN run
 *      (the open-unreferenced migration posture is deleted, run-binding.ts
 *      §T3 rework F2).
 *   3. verifyRunBinding() renders the verdict — absent / not-minted /
 *      malformed / closed / mismatched all REFUSE.
 *
 * The workspace-global sentinels (.guild/runs/current-run-id legacy AND
 * .guild/current-run-id B2) are interactive command intake ONLY
 * (locateCandidateRunId): they never resolve a write identity here and never
 * serve as a fallback binding. Moving a sentinel mid-run therefore cannot
 * redirect any hook write (SC-1).
 */

import {
  readHookBindingEnvelope,
  verifyRunBinding,
  type BindingRejectReason,
} from "../../scripts/lib/run-binding.js";

export type { BindingRejectReason } from "../../scripts/lib/run-binding.js";
export { locateCandidateRunId } from "../../scripts/lib/run-binding.js";

/** The verdict a hook writer branches on before its first write. */
export type HookWriteAuth =
  | { ok: true; run_id: string; binding_ref: string }
  | {
      ok: false;
      diagnostic: "binding_rejected";
      reason: BindingRejectReason;
      run_id: string | null;
    };

export interface AuthorizeHookWriteOpts {
  /** Explicitly-addressed run (CLI --run-id / a caller that already resolved it). */
  runId?: string;
  /** Explicit caller-held nonce (preferred over the env envelope). */
  bindingRef?: string;
  /** Env seam for tests; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

function reject(reason: BindingRejectReason, run_id: string | null): HookWriteAuth {
  return { ok: false, diagnostic: "binding_rejected", reason, run_id };
}

/**
 * Resolve + verify the write-authorizing run binding for a hook writer.
 * Never throws; never reads a sentinel. A non-ok verdict means NO WRITE.
 */
export function authorizeHookWrite(
  root: string,
  opts: AuthorizeHookWriteOpts = {},
): HookWriteAuth {
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const envelope = readHookBindingEnvelope(env);
  const envRunId = env["GUILD_RUN_ID"]?.trim();
  const runId = opts.runId ?? envelope?.run_id ?? (envRunId || undefined);
  if (!runId) return reject("binding_absent", null);

  // Rework F1: the nonce must be PRESENTED by the caller — explicit opt or
  // the env envelope naming this exact run. There is NO recovery from the
  // run's own binding.json: a caller that cannot present the pair is refused
  // (binding_absent), even when a loadable open record exists on disk.
  const ref =
    opts.bindingRef ??
    (envelope && envelope.run_id === runId ? envelope.binding_ref : undefined);
  if (ref === undefined || ref.trim().length === 0) {
    return reject("binding_absent", runId);
  }

  const verdict = verifyRunBinding({ root, run_id: runId, binding_ref: ref });
  if (verdict.ok === false) return reject(verdict.reason, runId);
  return { ok: true, run_id: runId, binding_ref: verdict.binding.binding_ref };
}

/** One-line structured refusal diagnostic every refusing writer emits. */
export function formatBindingRejected(hook: string, auth: HookWriteAuth): string {
  // `!== false` (literal comparison), not truthiness: the test runners compile
  // without a tsconfig (non-strict), where truthiness narrowing of a boolean
  // discriminant does not apply but literal comparison does.
  if (auth.ok !== false) return "";
  return (
    `[${hook}] binding_rejected (${auth.reason}) for run ` +
    `${auth.run_id ?? "<unresolved>"} — no write performed ` +
    `(session_context §5: writers fail closed; sentinels are intake-only).\n`
  );
}
