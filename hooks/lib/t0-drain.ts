/**
 * hooks/lib/t0-drain.ts — the lead session drains the T0 write queue (KTD33 / KTD43).
 *
 * `work-loop redirect` and `evolve-loop --apply` only enqueue a request and print a
 * `guild.t0_request.v1` receipt (src/domains/lifecycle/t0-queue.ts). This is the one
 * place the request is run through its gated writer, and it runs only when THIS tool
 * call was the lead's own enqueue invocation:
 *
 *   - this hook process's env is not a lane worker's (the host sets the hook env; a
 *     Bash command in the session cannot change it), and the payload is not a
 *     subagent's tool call (`agent_id` set);
 *   - the Bash command is ONE simple command `node <script> <args>`: no pipe, list,
 *     redirection, substitution, glob, env prefix or newline; `<script>` realpaths to
 *     the package this hook shipped in: runtime/scripts/work-loop.js (`redirect`) or evolve-loop.js
 *     (`--apply`), never a basename or suffix match;
 *   - the tool's stdout is exactly one receipt line, of that entry's kind, naming the
 *     run and root the command's own flags name;
 *   - the request was enqueued inside the call window, is unclaimed, and its bytes
 *     still hash to the receipt's sha256 (drainT0Request claims it exclusively).
 *
 * Anything else drains nothing. When a receipt-looking result is refused, a
 * `queue_drain_refused` security event is recorded: a receipt a worker planted and the
 * lead merely printed (`cat`, a look-alike script) lands there, never in a writer.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { T0DrainOutcome, drainT0Request, parseT0Receipts } from "../../src/domains/lifecycle";
import { ensureStorageLayout } from "./ensure-layout.js";
import { appendSecurityEvent, buildSecurityEvent, resolveRunDir } from "./security/events.js";
import { isLaneWorker } from "./security/lane-wiki-guard.js";
import type { GuildHookEvent } from "./guild-hook-event.js";

const RECEIPT_SCHEMA = "guild.t0_request.v1";
/** The longest a host lets one Bash call run (10 min), plus clock slack. */
const CALL_WINDOW_MS = 10 * 60 * 1000 + 30 * 1000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const ENTRIES = {
  "work-loop.js": { kind: "harvest", subcommand: (args: string[]) => args[0] === "redirect" },
  "evolve-loop.js": { kind: "evolve", subcommand: (args: string[]) => args.includes("--apply") },
} as const;

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

/**
 * The words of ONE simple shell command, or null when the command could do anything
 * else. Quotes are honoured; every operator, expansion or glob character outside
 * single quotes refuses, and so does `$`, `` ` ``, `\` or `!` inside double quotes.
 */
export function simpleCommandWords(command: string): string[] | null {
  const words: string[] = [];
  let cur = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (const ch of command) {
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if ("$`\\!\n".includes(ch)) return null;
      else cur += ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (inWord) words.push(cur);
      cur = "";
      inWord = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
      continue;
    }
    if ("|&;<>()$`\\\n\r{}*?[]~#!=".includes(ch)) return null;
    cur += ch;
    inWord = true;
  }
  if (quote) return null;
  if (inWord) words.push(cur);
  return words;
}

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/** The value of `--name <v>`; the CLIs refuse a repeat, so the first one is the one. */
function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

interface EnqueueCall {
  kind: "harvest" | "evolve";
  runId: string;
  /** The Guild root the call enqueued on, as its own --cwd names it. */
  root: string;
}

/** The enqueue call this command is, or why it is not one. */
function enqueueCallOf(command: string, shellCwd: string, pluginRoot: string): EnqueueCall | string {
  const words = simpleCommandWords(command);
  if (!words) return "not one simple command";
  if (words[0] !== "node" || words.length < 2) return "program is not node";
  const script = realpathOrNull(path.resolve(shellCwd, words[1]!));
  const name = Object.keys(ENTRIES).find(
    (n) => script !== null && script === realpathOrNull(path.join(pluginRoot, "runtime", "scripts", n)),
  ) as keyof typeof ENTRIES | undefined;
  if (!name) return "script is not this plugin's work-loop.js or evolve-loop.js";
  const args = words.slice(2);
  if (!ENTRIES[name].subcommand(args)) return "not the enqueue subcommand";
  const runId = flagValue(args, "--run-id") ?? (name === "evolve-loop.js" ? "evolve-apply" : undefined);
  if (!runId) return "no --run-id";
  const { resolveGuildRoot } = require("../../src/domains/state") as typeof import("../../src/domains/state");
  const cwdFlag = flagValue(args, "--cwd");
  const root = name === "evolve-loop.js"
    ? path.resolve(shellCwd, cwdFlag ?? ".")
    : resolveGuildRoot(path.resolve(shellCwd, cwdFlag ?? shellCwd));
  return { kind: ENTRIES[name].kind, runId, root };
}

/**
 * Whether the request a receipt names was written inside this call's window: both the
 * hash-bound `enqueued_at` and the file's mtime. The hash is re-checked at drain.
 */
function createdInWindow(receipt: { kind: string; run_id: string; request_id: string; root: string }): boolean {
  const { createGuildStorage } = require("../../src/domains/state") as typeof import("../../src/domains/state");
  const storage = createGuildStorage(receipt.root);
  const scope = storage.project ?? storage.workspace;
  if (!scope) return false;
  const file = scope.runRecord(receipt.run_id, "queue", receipt.kind, `${receipt.request_id}.json`);
  const now = Date.now();
  const inWindow = (t: number): boolean => t >= now - CALL_WINDOW_MS && t <= now + 5_000;
  try {
    const at = Date.parse(String((JSON.parse(fs.readFileSync(file, "utf8")) as { enqueued_at?: unknown }).enqueued_at));
    return inWindow(at) && inWindow(fs.statSync(file).mtimeMs);
  } catch {
    return false;
  }
}

function recordRefusal(guildRoot: string, env: NodeJS.ProcessEnv, stdout: string, detail: string): void {
  const envRun = env["GUILD_RUN_ID"];
  const receiptRun = /"run_id"\s*:\s*"([^"]+)"/.exec(stdout)?.[1];
  const runId = [envRun, receiptRun].find((r) => typeof r === "string" && SAFE_ID.test(r)) ?? "t0-drain";
  appendSecurityEvent(
    resolveRunDir(guildRoot, runId),
    buildSecurityEvent({
      run_id: runId,
      event_type: "queue_drain_refused",
      decision: "blocked",
      tool: "Bash",
      detail: `T0 receipt in a tool result was not drained: ${detail}`,
    }),
  );
}

/** Null when this call is not the lead's enqueue call, or carries no receipt. */
export function drainT0Queue(
  payload: GuildHookEvent,
  env: NodeJS.ProcessEnv,
  /** The hook bundle's own dir: the plugin root a machinery candidate parks under. */
  fromDir: string,
  /** Where a refusal's security event lands. */
  guildRoot: string,
): T0DrainReport | null {
  if (isLaneWorker(env)) return null;
  if (typeof payload["agent_id"] === "string" && payload["agent_id"] !== "") return null;
  if (payload.tool_name !== "Bash") return null;
  const stdout = stdoutOf(payload.tool_response);
  if (!stdout.includes(RECEIPT_SCHEMA)) return null;

  // Lazy: lifecycle loads the class-graph and event-log graph; only a receipt pays for it.
  const lifecycle = require("../../src/domains/lifecycle") as {
    drainT0Request: typeof drainT0Request;
    parseT0Receipts: typeof parseT0Receipts;
  };
  const receipts = lifecycle.parseT0Receipts(stdout);
  if (receipts.length === 0) return null;

  const input = payload.tool_input as Record<string, unknown> | null | undefined;
  const command = input && typeof input["command"] === "string" ? input["command"] : "";
  const shellCwd = typeof payload.cwd === "string" && path.isAbsolute(payload.cwd) ? payload.cwd : guildRoot;
  const kernel = require("../../src/domains/kernel") as typeof import("../../src/domains/kernel");
  const pluginRoot = kernel.resolvePluginRoot(fromDir, env);
  const refuse = (detail: string): null => {
    recordRefusal(guildRoot, env, stdout, detail);
    return null;
  };

  // The entry is compared against the package THIS hook shipped in (env ignored):
  // the code the host is actually running, not a root a variable points at.
  const call = enqueueCallOf(command, shellCwd, kernel.ownPluginRoot(fromDir));
  if (typeof call === "string") return refuse(call);
  const lines = stdout.split("\n").filter((l) => l.trim() !== "");
  if (lines.length !== 1 || receipts.length !== 1) return refuse("the result is not exactly one receipt line");
  const receipt = receipts[0]!;
  if (receipt.kind !== call.kind || receipt.run_id !== call.runId || path.resolve(receipt.root) !== path.resolve(call.root)) {
    return refuse(`receipt ${receipt.request_id} does not name this call's kind, run and root`);
  }
  if (!createdInWindow(receipt)) return refuse(`request ${receipt.request_id} was not created by this call`);

  const report: T0DrainReport = { drained: [], refused: [] };
  try {
    const outcome = lifecycle.drainT0Request(receipt, {
      pluginRoot,
      layoutOk: (root) => ensureStorageLayout(root, "post-tool-use:t0-drain").ok,
    });
    if (outcome) report.drained.push(outcome);
  } catch (err) {
    report.refused.push({ request_id: receipt.request_id, detail: err instanceof Error ? err.message : String(err) });
  }
  return report;
}
