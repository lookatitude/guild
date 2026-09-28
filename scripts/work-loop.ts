#!/usr/bin/env -S npx tsx
/**
 * scripts/work-loop.ts — the T0 work-loop CLI (KTD33 / KTD41–44 / KTD49 / KTD53).
 *
 * The four things the T0 session (bare `/guild`) does to a run between nodes, as
 * deterministic code rather than prose:
 *
 *   bind            --run-id <id> --class <c> [--source intake|typed_verb|class_flag]
 *       Load the class graph (plugin default + project overlay) and bind
 *       `guild.workflow_cursor.v1` on the run at the graph's entry. A run that
 *       already has a cursor keeps it.
 *   route           --run-id <id> --decision <json|@file>
 *       Apply one `guild.workflow_decision.v1` to the PERSISTED cursor. The next
 *       node is read off the merged graph; an unrecognised outcome escalates.
 *   redirect        --run-id <id> --input <file>
 *       Record a T0-routed operator correction on the redirect ledger. The count
 *       that crosses the threshold harvests the distilled decision (security-gated,
 *       journaled). A harvest that supersedes a pinned decision routes `replan`.
 *   research-packet --run-id <id> --input <file>
 *       Write `guild.research_packet.v1` on the run record.
 *
 * Every verb takes [--cwd <dir>] and prints one JSON object on stdout.
 * Exit: 0 ok · 1 usage / IO error · 3 escalated or refused (T0 must stop and ask).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, resolveGuildRoot, type GuildStorage } from "../src/domains/state";
import {
  WORKFLOW_CLASSES,
  bindWorkflowCursor,
  loadAllClassGraphs,
  loadClassGraph,
  readWorkflowCursor,
  routeWorkflowDecisionAtRun,
  writeWorkflowCursor,
  type CursorBindSource,
  type RouteResult,
  type WorkflowClass,
} from "../src/domains/lifecycle";
import { routeRedirect, writeResearchPacket, type RouteRedirectInput } from "../src/domains/knowledge";
import { ensureStorageLayout } from "./lib/state/ensure-storage-layout";

const USAGE =
  "usage: work-loop <bind|route|redirect|research-packet> --run-id <id> [--cwd <dir>]\n" +
  "  bind            --class <product|research|debug|ops|init> [--source intake|typed_verb|class_flag]\n" +
  "  route           --decision <json|@file>\n" +
  "  redirect        --input <file>   {agent_id, topic_key, correction, decision:{slug,title,body,reasoning,...}}\n" +
  "  research-packet --input <file>   {packet_id, questions, evidence, conclusions, confidence, ...}\n";

const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BIND_SOURCES: readonly CursorBindSource[] = ["intake", "typed_verb", "class_flag"];

class UsageError extends Error {}

function flag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const eq = argv.find((a) => a.startsWith(prefix));
  if (eq) return eq.slice(prefix.length);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function required(argv: readonly string[], name: string): string {
  const v = flag(argv, name);
  if (v === undefined || v === "") throw new UsageError(`--${name} is required`);
  return v;
}

/** A JSON argument, inline or `@path`. */
function readJsonArg(raw: string): unknown {
  const text = raw.startsWith("@") ? fs.readFileSync(raw.slice(1), "utf8") : raw;
  return JSON.parse(text);
}

function readJsonFile(file: string): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`${file} must hold a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function runDirOf(storage: GuildStorage, runId: string): string {
  const scope = storage.project ?? storage.workspace;
  if (!scope) throw new UsageError("this directory is not inside a Guild root");
  return scope.runRecord(runId);
}

function classGraphs(cwd: string): Partial<Record<WorkflowClass, ReturnType<typeof loadClassGraph>["graph"]>> {
  try {
    return loadAllClassGraphs({ cwd });
  } catch {
    // A sibling class that fails to load only loses the real change_class entry;
    // the router falls back to the pinned default table for it.
    return {};
  }
}

/** Route against the persisted cursor. The caller has checked that one exists. */
function route(runDir: string, cwd: string, klass: WorkflowClass, decision: unknown): RouteResult {
  const graph = loadClassGraph(klass, { cwd }).graph;
  return routeWorkflowDecisionAtRun(runDir, { graph, decision, classGraphs: classGraphs(cwd) });
}

export function runWorkLoop(argv: readonly string[]): { code: number; out: unknown } {
  const verb = argv[0];
  const cwd = path.resolve(flag(argv, "cwd") ?? process.env["GUILD_CWD"] ?? process.cwd());
  const root = resolveGuildRoot(cwd);
  ensureStorageLayout(root, { detectOnly: true });
  const runId = required(argv, "run-id");
  if (!SAFE_RUN_ID.test(runId)) throw new UsageError(`--run-id '${runId}' is not a safe run id`);
  const storage = createGuildStorage(root);
  const runDir = runDirOf(storage, runId);

  if (verb === "bind") {
    const klass = required(argv, "class");
    if (!(WORKFLOW_CLASSES as readonly string[]).includes(klass)) {
      throw new UsageError(`--class '${klass}' is not one of ${WORKFLOW_CLASSES.join(" | ")}`);
    }
    const source = (flag(argv, "source") ?? "intake") as CursorBindSource;
    if (!BIND_SOURCES.includes(source)) throw new UsageError(`--source '${source}' is not ${BIND_SOURCES.join(" | ")}`);
    const existing = readWorkflowCursor(runDir);
    if (existing) return { code: 0, out: { bound: false, cursor: existing } };
    const loaded = loadClassGraph(klass as WorkflowClass, { cwd: root });
    const cursor = bindWorkflowCursor({ run_id: runId, class: loaded.class, graph: loaded.graph, bound_from: source });
    writeWorkflowCursor(runDir, cursor);
    return { code: 0, out: { bound: true, cursor, overlay: loaded.overlayPath !== null } };
  }

  if (verb === "route") {
    const decision = readJsonArg(required(argv, "decision"));
    const at = readWorkflowCursor(runDir);
    if (!at) {
      return { code: 3, out: { escalated: true, detail: "the run has no workflow cursor; bind a class first" } };
    }
    const result = route(runDir, root, at.class, decision);
    return { code: result.escalated ? 3 : 0, out: result };
  }

  if (verb === "redirect") {
    const input = readJsonFile(required(argv, "input"));
    const result = routeRedirect({
      ...(input as unknown as Omit<RouteRedirectInput, "run_id" | "runDir" | "storage" | "cwd">),
      run_id: runId,
      runDir,
      storage,
    });
    // KTD53: a harvest that superseded a pinned decision is a replan, emitted by T0
    // as a workflow decision — never a silent rewrite of the spec or plan.
    let replan: RouteResult | null = null;
    const at = result.harvest?.replan_queued ? readWorkflowCursor(runDir) : null;
    if (result.harvest && at) {
      replan = route(runDir, root, at.class, {
        run_id: runId,
        node_id: at.node_id,
        outcome: "replan",
        reason: `harvest superseded pinned ${result.harvest.stale_decision_ids.join(", ")}`,
      });
    }
    const refused = result.harvest !== null && !result.harvest.promoted;
    return {
      code: refused || replan?.escalated ? 3 : 0,
      out: { redirect: { entry: result.redirect.entry, fires_harvest: result.redirect.fires_harvest }, harvest: result.harvest, replan },
    };
  }

  if (verb === "research-packet") {
    const input = readJsonFile(required(argv, "input"));
    const packetId = String(input["packet_id"] ?? "");
    if (!SAFE_RUN_ID.test(packetId)) throw new UsageError("input.packet_id must be a safe id");
    const written = writeResearchPacket({ ...(input as object), run_id: runId, packet_id: packetId }, { storage });
    return { code: 0, out: written };
  }

  throw new UsageError(`unknown verb '${verb ?? ""}'`);
}

if (
  typeof module !== "undefined" && require.main === module &&
  /^work-loop\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")
) {
  try {
    const { code, out } = runWorkLoop(process.argv.slice(2));
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(code);
  } catch (err) {
    const usage = err instanceof UsageError;
    process.stderr.write(`[work-loop] ${usage ? "ERROR" : "FATAL"}: ${(err as Error).message}\n${usage ? USAGE : ""}`);
    process.exit(1);
  }
}
