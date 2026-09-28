/**
 * redirect-route.ts — the T0 redirect trigger (KTD33 / R50).
 *
 * T0 calls `routeRedirect` each time it routes a rejected approach. It advances
 * the redirect ledger, mirrors the advance onto the run's JSONL as a
 * `redirect_event`, and on the count that crosses the threshold harvests the
 * decision T0 distilled from the repeated correction. Below the threshold
 * nothing is written to the wiki.
 *
 * The playbook replacement on this path is never caller text (KTD37). T0 names
 * the span; the bytes are rendered from a FIXED template over the ledger entry,
 * whose only free field is the operator's recorded correction. A caller that
 * passes its own `replacement` is refused before the ledger advances.
 */

// Lazy: lifecycle sits above knowledge (its event log reaches config and js-yaml),
// so a static import would load that graph in every knowledge entry, the MCP
// binary included. Only the write paths below need it.
function lifecycleApi(): typeof import("../lifecycle") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../lifecycle");
}
import type { GuildStorage } from "../state";
import { harvestDecision, type HarvestInput, type HarvestResult } from "./harvest";
import {
  RedirectLedgerError,
  recordRedirect,
  type RecordRedirectInput,
  type RecordRedirectResult,
  type RedirectEntry,
} from "./redirect-ledger";

/** The playbook target on the redirect path: a span name, never its bytes. */
export interface RedirectPlaybookTarget {
  path: string;
  span: string;
}

export interface RouteRedirectInput extends RecordRedirectInput {
  /** The run record dir the events and the harvest journal belong to. */
  runDir: string;
  cwd?: string;
  storage?: GuildStorage;
  /** The decision harvested on the crossing count. */
  decision: Omit<HarvestInput, "run_id" | "runDir" | "cwd" | "storage" | "trigger" | "playbook"> & {
    playbook?: RedirectPlaybookTarget;
  };
}

export interface RouteRedirectResult {
  redirect: RecordRedirectResult;
  /** Null below the threshold and after it has already fired. */
  harvest: HarvestResult | null;
}

/** The fixed template. Every interpolated value comes from the ledger entry. */
export function renderRedirectReplacement(entry: RedirectEntry): string {
  return `Operator correction on \`${entry.topic_key}\` (redirected ${entry.count} times): ${entry.correction}`;
}

/** Refuse anything on the playbook target beyond `{ path, span }`. */
function assertPlaybookTarget(playbook: unknown): void {
  if (playbook === undefined) return;
  if (playbook === null || typeof playbook !== "object") {
    throw new RedirectLedgerError("redirect playbook target must be { path, span }");
  }
  const extra = Object.keys(playbook).filter((k) => k !== "path" && k !== "span");
  if (extra.length > 0) {
    throw new RedirectLedgerError(
      `a caller-supplied playbook ${extra.join(", ")} is refused on the redirect path; ` +
        `the replacement is rendered from the redirect ledger entry (KTD37)`,
    );
  }
}

export function routeRedirect(input: RouteRedirectInput): RouteRedirectResult {
  const { runDir, cwd, storage, decision } = input;
  assertPlaybookTarget(decision.playbook);
  const redirect = recordRedirect(
    {
      run_id: input.run_id,
      agent_id: input.agent_id,
      topic_key: input.topic_key,
      correction: input.correction,
      at: input.at,
    },
    { cwd, storage },
  );
  lifecycleApi().appendEvent(runDir, {
    ts: redirect.entry.last_at,
    event: "redirect_event",
    run_id: input.run_id,
    agent_id: input.agent_id,
    topic_key: input.topic_key,
    count: redirect.entry.count,
    fired: redirect.fires_harvest,
  });
  const playbook = decision.playbook
    ? {
        path: decision.playbook.path,
        span: decision.playbook.span,
        replacement: renderRedirectReplacement(redirect.entry),
      }
    : undefined;
  const harvest = redirect.fires_harvest
    ? harvestDecision({
        ...decision,
        playbook,
        run_id: input.run_id,
        runDir,
        cwd,
        storage,
        trigger: "redirect_threshold",
      })
    : null;
  return { redirect, harvest };
}
