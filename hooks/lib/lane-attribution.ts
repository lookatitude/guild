/**
 * hooks/lib/lane-attribution.ts
 *
 * Single-source-of-truth "is this invocation a dispatched lane worker's own
 * session?" resolution — oir-wi-57 round-5 fix.
 *
 * Every consumer that previously computed this ad hoc (`post-tool-use.ts`,
 * `pre-compact.ts`) used `process.env["GUILD_LANE_ID"] ?? process.env["GUILD_TASK_ID"]`
 * — a bug: `??` only falls through on `null`/`undefined`, NOT on an empty
 * string or a value that fails `isSafeLaneId`. `GUILD_LANE_ID=""` (present but
 * blank) or an unsafe `GUILD_LANE_ID` would therefore mask a perfectly valid
 * `GUILD_TASK_ID` sitting right next to it, misclassifying a real worker
 * invocation as the lead's own. This module fixes it once, for every caller.
 *
 * Two separate questions, two separate exports:
 *   - `isWorkerInvocation` — PRESENCE only (is either var non-empty at all?),
 *     for gates that just need "not the lead" (Stop-hook lead-only gate,
 *     session-reanchor.ts's silent-return, the re-anchor-header gate in
 *     pre-compact.ts).
 *   - `resolveLaneAttribution` — the actual STRING to stamp as `lane_id` on a
 *     telemetry event. Tries GUILD_LANE_ID first, then GUILD_TASK_ID, using
 *     the first candidate that is both non-empty AND passes `isSafeLaneId`.
 *     If NEITHER candidate is safely stampable but `isWorkerInvocation` is
 *     still true (both present, both unsafe — a malformed environment), it
 *     falls back to a fixed sentinel rather than ever emitting a lane-LESS
 *     event for a call that is provably a worker's — a lane-less event from
 *     an identified worker would otherwise be silently miscounted as the
 *     lead's own by hooks/lib/lean-lead-guard.ts.
 */

import { isSafeLaneId } from "./v1.4/log-jsonl.js";

/** Fixed sentinel stamped only when a worker is identified but neither of
 * its own id candidates is safely stampable — guarantees an identified
 * worker's event is never lane-less. Matches LANE_ID_RE by construction. */
export const UNATTRIBUTED_WORKER_LANE_ID = "unattributed-worker";

/** True iff THIS invocation's own env identifies it as a dispatched lane
 * worker's session — presence only, regardless of whether either value is
 * safe to stamp. Empty-string values do not count as "present". */
export function isWorkerInvocation(env: NodeJS.ProcessEnv = process.env): boolean {
  const laneId = env["GUILD_LANE_ID"];
  const taskId = env["GUILD_TASK_ID"];
  return (
    (typeof laneId === "string" && laneId.length > 0) ||
    (typeof taskId === "string" && taskId.length > 0)
  );
}

/**
 * The lane_id to stamp on a telemetry event for THIS invocation.
 * `GUILD_LANE_ID` wins when it is itself a non-empty, safe candidate;
 * `GUILD_TASK_ID` is the fallback under the same rule — evaluated
 * independently, so a blank/unsafe `GUILD_LANE_ID` never masks a valid
 * `GUILD_TASK_ID`. Returns `UNATTRIBUTED_WORKER_LANE_ID` when a worker is
 * identified (`isWorkerInvocation`) but neither candidate is safely
 * stampable, and `undefined` only when this is genuinely not a worker
 * invocation at all.
 */
export function resolveLaneAttribution(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const candidate of [env["GUILD_LANE_ID"], env["GUILD_TASK_ID"]]) {
    if (typeof candidate === "string" && candidate.length > 0 && isSafeLaneId(candidate)) {
      return candidate;
    }
  }
  return isWorkerInvocation(env) ? UNATTRIBUTED_WORKER_LANE_ID : undefined;
}
