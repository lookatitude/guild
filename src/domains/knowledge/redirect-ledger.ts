/**
 * redirect-ledger.ts — `guild.redirect_ledger.v1` (KTD33 / R50).
 *
 * T0 records one entry each time it ROUTES A REJECTED APPROACH: the operator
 * corrected an agent on a topic and T0 had to redirect the work. Three of those
 * for the same `(agent_id, topic_key)` in one run is the signal that the correction
 * is not a one-off, and it fires auto-harvest.
 *
 * Two deliberate narrowings, both of which exist to stop the counter firing on
 * noise:
 *
 *   - "T0 ROUTES a rejected approach", not "the operator said something critical".
 *     A grumble is not a redirect. The ledger only advances when the orchestrator
 *     actually changed course, which is an observable event rather than a reading
 *     of tone.
 *   - The key is `(agent_id, topic_key)`, not `agent_id` alone. Three unrelated
 *     corrections to one busy agent are three different lessons and harvesting them
 *     as one decision would produce a page about nothing. `topic_key` is a stable
 *     slug the caller supplies; free-text prose is rejected, because prose never
 *     equals prose and the counter would never reach two.
 *
 * Each entry also records the operator's correction (the "do Y"), latest-only.
 * It is the one input the redirect path's playbook replacement is rendered
 * from (see `renderRedirectReplacement` in redirect-route.ts), so it is held
 * to a single bounded line: it cannot open a heading or a second span.
 *
 * Storage class is RUNTIME (KTD16 family): it belongs to this run, it is not
 * durable wiki, and it is not a context file.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "../state";

export const REDIRECT_LEDGER_SCHEMA = "guild.redirect_ledger.v1" as const;

/** KTD33: the third redirect on one (agent, topic) fires harvest. */
export const REDIRECT_HARVEST_THRESHOLD = 3;

/** A stable slug. Prose is refused — see the header. */
export const TOPIC_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The operator correction is one line, bounded. */
export const CORRECTION_MAX_CHARS = 500;

export interface RedirectEntry {
  agent_id: string;
  topic_key: string;
  count: number;
  last_at: string;
  /** The operator's correction on the latest redirect (the "do Y"). */
  correction: string;
}

export interface RedirectLedger {
  schema_version: typeof REDIRECT_LEDGER_SCHEMA;
  run_id: string;
  entries: RedirectEntry[];
}

export interface LedgerOptions {
  cwd?: string;
  storage?: GuildStorage;
}

function storageFor(opts: LedgerOptions): GuildStorage {
  return opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
}

export function redirectLedgerPath(storage: GuildStorage, runId: string): string {
  return storage.runtime(runId, "redirect-ledger.json");
}

export function readRedirectLedger(runId: string, opts: LedgerOptions = {}): RedirectLedger {
  const storage = storageFor(opts);
  const p = redirectLedgerPath(storage, runId);
  try {
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as RedirectLedger;
      if (parsed && parsed.schema_version === REDIRECT_LEDGER_SCHEMA && Array.isArray(parsed.entries)) {
        return parsed;
      }
    }
  } catch {
    // A corrupt ledger restarts the count. Losing a count under-fires harvest,
    // which is recoverable; trusting a corrupt count over-fires it into the wiki.
  }
  return { schema_version: REDIRECT_LEDGER_SCHEMA, run_id: runId, entries: [] };
}

export function writeRedirectLedger(ledger: RedirectLedger, opts: LedgerOptions = {}): string {
  const storage = storageFor(opts);
  const p = redirectLedgerPath(storage, ledger.run_id);
  storage.ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  return p;
}

export interface RecordRedirectInput {
  run_id: string;
  agent_id: string;
  topic_key: string;
  /** The operator's correction T0 routed ("do Y"): one line, ≤ CORRECTION_MAX_CHARS. */
  correction: string;
  at?: string;
}

export interface RecordRedirectResult {
  entry: RedirectEntry;
  /** True on the count that CROSSES the threshold — once, not on every count after. */
  fires_harvest: boolean;
  ledger: RedirectLedger;
}

export class RedirectLedgerError extends Error {}

/**
 * Record one T0-routed rejected approach.
 *
 * `fires_harvest` is true only on the crossing count. A ledger at 5 has already
 * harvested; re-firing would write the same decision page four more times and each
 * one would supersede the last.
 */
export function recordRedirect(
  input: RecordRedirectInput,
  opts: LedgerOptions = {},
): RecordRedirectResult {
  if (!TOPIC_KEY_RE.test(input.topic_key ?? "")) {
    throw new RedirectLedgerError(
      `topic_key '${input.topic_key}' is not a stable slug (${TOPIC_KEY_RE}); free-text topics never repeat and would never reach the threshold`,
    );
  }
  if (typeof input.agent_id !== "string" || input.agent_id === "") {
    throw new RedirectLedgerError("agent_id is required");
  }
  const correction = typeof input.correction === "string" ? input.correction.trim() : "";
  if (correction === "" || /[\r\n\u2028\u2029]/.test(correction) || correction.length > CORRECTION_MAX_CHARS) {
    throw new RedirectLedgerError(
      `correction must be one non-empty line of at most ${CORRECTION_MAX_CHARS} characters`,
    );
  }

  const ledger = readRedirectLedger(input.run_id, opts);
  const at = input.at ?? new Date().toISOString();
  let entry = ledger.entries.find(
    (e) => e.agent_id === input.agent_id && e.topic_key === input.topic_key,
  );
  if (!entry) {
    entry = { agent_id: input.agent_id, topic_key: input.topic_key, count: 0, last_at: at, correction };
    ledger.entries.push(entry);
  }
  entry.count += 1;
  entry.last_at = at;
  entry.correction = correction;
  writeRedirectLedger(ledger, opts);

  return { entry, fires_harvest: entry.count === REDIRECT_HARVEST_THRESHOLD, ledger };
}
