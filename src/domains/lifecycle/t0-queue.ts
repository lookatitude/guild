/**
 * t0-queue.ts — T0-owned writes go through a run queue (KTD33 / KTD35 / KTD43).
 *
 * The redirect harvest and evolve `--apply` write the wiki, the glossary, playbooks
 * and compact history. Those writes belong to the T0 session, and a CLI cannot tell
 * who launched it: a lane worker can unset its env or respell the entry. So the CLIs
 * only VALIDATE and ENQUEUE a request:
 *
 *   <runDir>/queue/<harvest|evolve>/<request_id>.json     exclusive create
 *
 * and print a receipt line carrying the request's sha256. The request is drained only
 * by the lead session's PostToolUse hook, from the receipt in THAT session's own tool
 * result (host-delivered, not a file a worker can plant), and only when the hook's env
 * is not a lane worker's. The hash binds the drained bytes to the bytes the lead's own
 * call wrote, so a worker that swaps the file between enqueue and drain is refused.
 *
 * The drain runs the existing gated writers unchanged: `routeRedirect` (D5, injection
 * probe, recall-tag refusal, scrubbedWrite, CAS, security events) and
 * `applyEvolveDelta` (the one evolve gate). A drained request is claimed once
 * (exclusive `<id>.claim`), and its outcome is recorded beside it as `<id>.result.json`.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, resolveGuildRoot, type GuildStorage } from "../state";
import { loadAllClassGraphs, loadClassGraph } from "./workflow-graph-load";
import { readWorkflowCursor, routeWorkflowDecisionAtRun, type RouteResult } from "./workflow-router";
import type { WorkflowClass } from "./workflow-graph-overlay";

const T0_REQUEST_SCHEMA = "guild.t0_request.v1" as const;
const T0_QUEUE_KINDS = ["harvest", "evolve"] as const;
type T0QueueKind = (typeof T0_QUEUE_KINDS)[number];

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface T0Request {
  schema_version: typeof T0_REQUEST_SCHEMA;
  kind: T0QueueKind;
  request_id: string;
  run_id: string;
  /** The Guild root the request writes. Validated at enqueue and again at drain. */
  root: string;
  enqueued_at: string;
  payload: Record<string, unknown>;
}

/** The one line the enqueuing CLI prints. The drain reads it from the lead's tool result. */
interface T0Receipt {
  t0_queue: typeof T0_REQUEST_SCHEMA;
  queued: true;
  kind: T0QueueKind;
  request_id: string;
  run_id: string;
  root: string;
  sha256: string;
}

/** The recorded outcome of one drained request: the exit code the CLI used to return, and its JSON. */
export interface T0DrainOutcome {
  kind: T0QueueKind;
  request_id: string;
  run_id: string;
  code: number;
  out: unknown;
}

class T0QueueError extends Error {}

function runRecord(storage: GuildStorage, runId: string, ...segments: string[]): string {
  const scope = storage.project ?? storage.workspace;
  if (!scope) throw new T0QueueError("this directory is not inside a Guild root");
  return scope.runRecord(runId, ...segments);
}

function requestPath(storage: GuildStorage, kind: T0QueueKind, runId: string, id: string, ext = ".json"): string {
  return runRecord(storage, runId, "queue", kind, `${id}${ext}`);
}

function sha256(bytes: string): string {
  return crypto.createHash("sha256").update(bytes, "utf8").digest("hex");
}

function assertIds(kind: unknown, runId: unknown, id: unknown): asserts kind is T0QueueKind {
  if (!(T0_QUEUE_KINDS as readonly unknown[]).includes(kind)) throw new T0QueueError(`unknown queue '${String(kind)}'`);
  if (typeof runId !== "string" || !SAFE_ID.test(runId)) throw new T0QueueError("unsafe run id");
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new T0QueueError("unsafe request id");
}

/** The root a request may write: an existing directory that is its own Guild root. */
function assertGuildRoot(root: unknown): string {
  if (typeof root !== "string" || !path.isAbsolute(root)) throw new T0QueueError("request root must be absolute");
  const resolved = resolveGuildRoot(root);
  if (path.resolve(resolved) !== path.resolve(root)) throw new T0QueueError(`${root} is not a Guild root`);
  return root;
}

/** Validate and enqueue one request (exclusive create). Writes nothing else. */
export function enqueueT0Request(input: {
  kind: T0QueueKind;
  runId: string;
  root: string;
  payload: Record<string, unknown>;
  storage?: GuildStorage;
}): T0Receipt {
  const root = assertGuildRoot(input.root);
  const request_id = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}`;
  assertIds(input.kind, input.runId, request_id);
  const storage = input.storage ?? createGuildStorage(root);
  const req: T0Request = {
    schema_version: T0_REQUEST_SCHEMA,
    kind: input.kind,
    request_id,
    run_id: input.runId,
    root,
    enqueued_at: new Date().toISOString(),
    payload: input.payload,
  };
  const bytes = `${JSON.stringify(req, null, 2)}\n`;
  const file = requestPath(storage, input.kind, input.runId, request_id);
  storage.ensureDir(path.dirname(file));
  fs.writeFileSync(file, bytes, { encoding: "utf8", flag: "wx" });
  return {
    t0_queue: T0_REQUEST_SCHEMA,
    queued: true,
    kind: input.kind,
    request_id,
    run_id: input.runId,
    root,
    sha256: sha256(bytes),
  };
}

/** Every well-formed receipt line in a tool's stdout. */
export function parseT0Receipts(stdout: string): T0Receipt[] {
  const out: T0Receipt[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{") || !t.includes(T0_REQUEST_SCHEMA)) continue;
    try {
      const r = JSON.parse(t) as Partial<T0Receipt>;
      if (
        r.t0_queue === T0_REQUEST_SCHEMA && r.queued === true && typeof r.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(r.sha256) && typeof r.root === "string"
      ) {
        assertIds(r.kind, r.run_id, r.request_id);
        out.push(r as T0Receipt);
      }
    } catch {
      /* not a receipt */
    }
  }
  return out;
}

/** Read the request a receipt names; its bytes must hash to the receipt's sha256. */
function readT0Request(receipt: T0Receipt, storage: GuildStorage): T0Request {
  const file = requestPath(storage, receipt.kind, receipt.run_id, receipt.request_id);
  const bytes = fs.readFileSync(file, "utf8");
  if (sha256(bytes) !== receipt.sha256) {
    throw new T0QueueError(`request ${receipt.request_id} does not match the enqueued bytes (sha256 mismatch)`);
  }
  const req = JSON.parse(bytes) as T0Request;
  if (
    req.schema_version !== T0_REQUEST_SCHEMA || req.kind !== receipt.kind || req.request_id !== receipt.request_id ||
    req.run_id !== receipt.run_id || req.root !== receipt.root || !req.payload || typeof req.payload !== "object"
  ) {
    throw new T0QueueError(`request ${receipt.request_id} does not match its receipt`);
  }
  return req;
}

/** Route one decision against the run's persisted cursor on the merged class graph. */
export function routeAtPersistedCursor(runDir: string, cwd: string, klass: WorkflowClass, decision: unknown): RouteResult {
  const graph = loadClassGraph(klass, { cwd }).graph;
  let classGraphs: Parameters<typeof routeWorkflowDecisionAtRun>[1]["classGraphs"] = {};
  try {
    classGraphs = loadAllClassGraphs({ cwd });
  } catch {
    // A sibling class that fails to load only loses the real change_class entry;
    // the router falls back to the pinned default table for it.
  }
  return routeWorkflowDecisionAtRun(runDir, { graph, decision, classGraphs });
}

function drainHarvest(req: T0Request, storage: GuildStorage): { code: number; out: unknown } {
  const { routeRedirect } = require("../knowledge") as typeof import("../knowledge");
  const runDir = runRecord(storage, req.run_id);
  const result = routeRedirect({
    ...(req.payload as unknown as Omit<import("../knowledge").RouteRedirectInput, "run_id" | "runDir" | "storage" | "cwd">),
    run_id: req.run_id,
    runDir,
    storage,
  });
  // KTD53: a harvest that superseded a pinned decision is a replan, routed on the
  // cursor as a workflow decision — never a silent rewrite of the spec or plan.
  let replan: RouteResult | null = null;
  const at = result.harvest?.replan_queued ? readWorkflowCursor(runDir) : null;
  if (result.harvest && at) {
    replan = routeAtPersistedCursor(runDir, req.root, at.class, {
      run_id: req.run_id,
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

function drainEvolve(req: T0Request, storage: GuildStorage, pluginRoot: string): { code: number; out: unknown } {
  const { applyEvolveDelta, EvolveTargetRefusal } = require("../evolve") as typeof import("../evolve");
  const p = req.payload as { delta?: unknown; auto?: unknown; run_id?: unknown };
  const runId = typeof p.run_id === "string" ? p.run_id : undefined;
  try {
    const result = applyEvolveDelta(p.delta as import("../evolve").EvolveDelta, {
      cwd: req.root,
      storage,
      auto: p.auto === true,
      pluginRoot,
      ...(runId ? { runId, runDir: runRecord(storage, runId) } : {}),
    });
    return { code: 0, out: result };
  } catch (err) {
    if (err instanceof EvolveTargetRefusal) {
      return { code: 3, out: { applied: false, refused: true, next_need: "operator", detail: err.message } };
    }
    throw err;
  }
}

/**
 * Drain one receipt: verify, claim once, run the gated writer, record the outcome.
 * The CALLER is the lead session's hook and has already refused a lane worker's env;
 * `layoutOk` is the caller's layout bootstrap verdict for `receipt.root`.
 * Null when the request was already claimed.
 */
export function drainT0Request(
  receipt: T0Receipt,
  opts: { pluginRoot: string; layoutOk: (root: string) => boolean },
): T0DrainOutcome | null {
  const root = assertGuildRoot(receipt.root);
  if (!opts.layoutOk(root)) throw new T0QueueError(`${root}: storage layout refused`);
  const storage = createGuildStorage(root);
  const req = readT0Request(receipt, storage);
  try {
    fs.writeFileSync(requestPath(storage, req.kind, req.run_id, req.request_id, ".claim"), new Date().toISOString(), {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw err;
  }
  const { code, out } = req.kind === "harvest" ? drainHarvest(req, storage) : drainEvolve(req, storage, opts.pluginRoot);
  const outcome: T0DrainOutcome = { kind: req.kind, request_id: req.request_id, run_id: req.run_id, code, out };
  fs.writeFileSync(
    requestPath(storage, req.kind, req.run_id, req.request_id, ".result.json"),
    `${JSON.stringify(outcome, null, 2)}\n`,
    "utf8",
  );
  return outcome;
}
