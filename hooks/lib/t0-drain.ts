/**
 * hooks/lib/t0-drain.ts — the lead session drains the T0 write queue (KTD33 / KTD43).
 *
 * `work-loop redirect` and `evolve-loop --apply` only enqueue a request and print a
 * `guild.t0_request.v1` receipt (src/domains/lifecycle/t0-queue.ts). This is the one
 * place the request is run through its gated writer, and it runs only when:
 *
 *   - this hook process's env is not a lane worker's (the host sets the hook env; a
 *     Bash command in the session cannot change it), and the payload is not a
 *     subagent's tool call (`agent_id` set);
 *   - the tool was Bash and its command named the work-loop or evolve-loop entry;
 *   - the receipt is in the tool result the host handed THIS hook, and the queued
 *     bytes still hash to the receipt's sha256.
 *
 * A request file a worker planted, or swapped after enqueue, is never drained: no
 * receipt for it reaches the lead's hook, or its hash does not match.
 */

import type { T0DrainOutcome, drainT0Request, parseT0Receipts } from "../../src/domains/lifecycle";
import { ensureStorageLayout } from "./ensure-layout.js";
import { isLaneWorker } from "./security/lane-wiki-guard.js";
import type { GuildHookEvent } from "./guild-hook-event.js";

/** The enqueuing entries, compiled or source spelling. */
const QUEUE_ENTRY = /(^|[\\/\s"'])(work|evolve)-loop(\.[cm]?[jt]s)?(?=$|[\s"';|&)])/;

export interface T0DrainReport {
  drained: T0DrainOutcome[];
  refused: Array<{ request_id: string; detail: string }>;
}

function stdoutOf(resp: unknown): string {
  if (typeof resp === "string") return resp;
  if (resp && typeof resp === "object") {
    const s = (resp as Record<string, unknown>)["stdout"];
    if (typeof s === "string") return s;
  }
  return "";
}

/** Null when this call is not the lead's enqueue call, or carries no receipt. */
export function drainT0Queue(
  payload: GuildHookEvent,
  env: NodeJS.ProcessEnv,
  /** The hook bundle's own dir: the plugin root a machinery candidate parks under. */
  fromDir: string,
): T0DrainReport | null {
  if (isLaneWorker(env)) return null;
  if (typeof payload["agent_id"] === "string" && payload["agent_id"] !== "") return null;
  if (payload.tool_name !== "Bash") return null;
  const input = payload.tool_input as Record<string, unknown> | null | undefined;
  const command = input && typeof input["command"] === "string" ? input["command"] : "";
  if (!QUEUE_ENTRY.test(command)) return null;
  const stdout = stdoutOf(payload.tool_response);
  if (!stdout.includes("guild.t0_request.v1")) return null;
  // Lazy: lifecycle loads the class-graph and event-log graph; only a receipt pays for it.
  const lifecycle = require("../../src/domains/lifecycle") as {
    drainT0Request: typeof drainT0Request;
    parseT0Receipts: typeof parseT0Receipts;
  };
  const receipts = lifecycle.parseT0Receipts(stdout);
  if (receipts.length === 0) return null;
  const { resolvePluginRoot } = require("../../src/domains/kernel") as typeof import("../../src/domains/kernel");
  const pluginRoot = resolvePluginRoot(fromDir, env);

  const report: T0DrainReport = { drained: [], refused: [] };
  for (const receipt of receipts) {
    try {
      const outcome = lifecycle.drainT0Request(receipt, {
        pluginRoot,
        layoutOk: (root) => ensureStorageLayout(root, "post-tool-use:t0-drain").ok,
      });
      if (outcome) report.drained.push(outcome);
    } catch (err) {
      report.refused.push({ request_id: receipt.request_id, detail: err instanceof Error ? err.message : String(err) });
    }
  }
  return report;
}
