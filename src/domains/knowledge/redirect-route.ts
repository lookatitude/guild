/**
 * redirect-route.ts — the T0 redirect trigger (KTD33 / R50).
 *
 * T0 calls `routeRedirect` each time it routes a rejected approach. It advances
 * the redirect ledger, mirrors the advance onto the run's JSONL as a
 * `redirect_event`, and on the count that crosses the threshold harvests the
 * decision T0 distilled from the repeated correction. Below the threshold
 * nothing is written to the wiki.
 */

import { appendEvent } from "../lifecycle";
import type { GuildStorage } from "../state";
import { harvestDecision, type HarvestInput, type HarvestResult } from "./harvest";
import { recordRedirect, type RecordRedirectInput, type RecordRedirectResult } from "./redirect-ledger";

export interface RouteRedirectInput extends RecordRedirectInput {
  /** The run record dir the events and the harvest journal belong to. */
  runDir: string;
  cwd?: string;
  storage?: GuildStorage;
  /** The decision harvested on the crossing count. */
  decision: Omit<HarvestInput, "run_id" | "runDir" | "cwd" | "storage" | "trigger">;
}

export interface RouteRedirectResult {
  redirect: RecordRedirectResult;
  /** Null below the threshold and after it has already fired. */
  harvest: HarvestResult | null;
}

export function routeRedirect(input: RouteRedirectInput): RouteRedirectResult {
  const { runDir, cwd, storage, decision } = input;
  const redirect = recordRedirect(
    { run_id: input.run_id, agent_id: input.agent_id, topic_key: input.topic_key, at: input.at },
    { cwd, storage },
  );
  appendEvent(runDir, {
    ts: redirect.entry.last_at,
    event: "redirect_event",
    run_id: input.run_id,
    agent_id: input.agent_id,
    topic_key: input.topic_key,
    count: redirect.entry.count,
    fired: redirect.fires_harvest,
  });
  const harvest = redirect.fires_harvest
    ? harvestDecision({ ...decision, run_id: input.run_id, runDir, cwd, storage, trigger: "redirect_threshold" })
    : null;
  return { redirect, harvest };
}
