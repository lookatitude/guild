/**
 * workflow-router.ts — the RUNTIME half of the class-graph machinery (KTD40–42,
 * R55). `workflow-graph-overlay.ts` is the data half: it loads, merges and
 * validates one authored `guild.workflow_graph.v1`. This file walks the merged
 * result: it binds `guild.workflow_cursor.v1` onto a run, and after each node it
 * applies a `guild.workflow_decision.v1` to produce the next node.
 *
 * Two rules do the load-bearing work here, and both are fail-closed:
 *
 *   1. An UNRECOGNISED outcome is `escalate` — never `next` (R55). The decision
 *      envelope is produced by T0 from a Team Lead's `goal_status`, which means a
 *      model is upstream of it. A model that emits `"continue"` instead of
 *      `"next"` must stop the run and ask, not fall through to the happy path. The
 *      same rule catches an outcome that is in the enum but has NO EDGE from this
 *      node: the graph author did not describe that transition, so the router does
 *      not invent one.
 *   2. An LLM must not rewrite nodes or edges. The decision envelope carries an
 *      OUTCOME and, for `change_class`, a target class — never a node id. The next
 *      node is read off the merged graph. There is deliberately no code path here
 *      that accepts "go to node X".
 *
 * `change_class` gets one extra check. An edge may hand off to another class, and
 * the destination has a legitimate ENTRY. Accepting the edge's `entry` verbatim
 * would let an overlay re-enter `product` at `product.release` and land past every
 * gate — the same bypass `workflow-graph-overlay.ts` closes at validation time, so
 * it is closed again here at routing time, against the real destination graph when
 * one is loaded and against `CLASS_DEFAULT_ENTRIES` when one is not.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  CLASS_DEFAULT_ENTRIES,
  WORKFLOW_CLASSES,
  WORKFLOW_EDGE_OUTCOMES,
  validateWorkflowGraphOverlay,
  type WorkflowClass,
  type WorkflowGraph,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
} from "./workflow-graph-overlay";

export const WORKFLOW_CURSOR_SCHEMA = "guild.workflow_cursor.v1" as const;
export const WORKFLOW_DECISION_SCHEMA = "guild.workflow_decision.v1" as const;

/** How the class was bound. Mirrors the intake domain's `ClassBindSource`. */
export type CursorBindSource = "typed_verb" | "class_flag" | "intake" | "change_class";

export type WorkflowOutcome = (typeof WORKFLOW_EDGE_OUTCOMES)[number];

export interface WorkflowDecision {
  schema_version: typeof WORKFLOW_DECISION_SCHEMA;
  run_id: string;
  node_id: string;
  outcome: WorkflowOutcome;
  to_class?: WorkflowClass;
  /** ≤40 tokens; T0 may surface it. */
  reason?: string;
}

export interface WorkflowCursor {
  schema_version: typeof WORKFLOW_CURSOR_SCHEMA;
  run_id: string;
  class: WorkflowClass;
  graph_id: string;
  node_id: string;
  bound_from: CursorBindSource;
  last_decision?: WorkflowDecision;
}

/**
 * The cursor file, a sibling of `binding.json` on the run record. Callers pass an
 * absolute `runDir` (`GuildStorage.project.runRecord(runId)`) rather than a cwd so
 * this module never constructs a durable path of its own.
 */
export function workflowCursorPath(runDir: string): string {
  return path.join(runDir, "workflow-cursor.json");
}

export function readWorkflowCursor(runDir: string): WorkflowCursor | null {
  const p = workflowCursorPath(runDir);
  try {
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as WorkflowCursor;
    return parsed && parsed.schema_version === WORKFLOW_CURSOR_SCHEMA ? parsed : null;
  } catch {
    // A corrupt cursor is a missing cursor: the caller re-binds from intake rather
    // than resuming a run at a node nobody can name.
    return null;
  }
}

export function writeWorkflowCursor(runDir: string, cursor: WorkflowCursor): void {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(workflowCursorPath(runDir), JSON.stringify(cursor, null, 2) + "\n", "utf8");
}

export interface BindCursorInput {
  run_id: string;
  class: WorkflowClass;
  graph: WorkflowGraph;
  bound_from: CursorBindSource;
}

/** Bind a run to a class graph at that graph's declared entry. */
export function bindWorkflowCursor(input: BindCursorInput): WorkflowCursor {
  const entry =
    typeof input.graph.entry === "string" && input.graph.entry !== ""
      ? input.graph.entry
      : CLASS_DEFAULT_ENTRIES[input.class];
  return {
    schema_version: WORKFLOW_CURSOR_SCHEMA,
    run_id: input.run_id,
    class: input.class,
    graph_id: typeof input.graph.graph_id === "string" ? input.graph.graph_id : `${input.class}.default`,
    node_id: entry,
    bound_from: input.bound_from,
  };
}

/**
 * Coerce an arbitrary object into a decision envelope. An outcome outside the
 * closed enum becomes `escalate` HERE, so every downstream consumer sees a legal
 * envelope and the coercion happens exactly once.
 */
export function normalizeWorkflowDecision(raw: unknown, fallbackRunId = ""): WorkflowDecision {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rawOutcome = String(o.outcome ?? "");
  const known = (WORKFLOW_EDGE_OUTCOMES as readonly string[]).includes(rawOutcome);
  const decision: WorkflowDecision = {
    schema_version: WORKFLOW_DECISION_SCHEMA,
    run_id: typeof o.run_id === "string" ? o.run_id : fallbackRunId,
    node_id: typeof o.node_id === "string" ? o.node_id : "",
    outcome: known ? (rawOutcome as WorkflowOutcome) : "escalate",
  };
  if (!known && rawOutcome !== "") {
    decision.reason = `unrecognized decision outcome '${rawOutcome}'`;
  } else if (typeof o.reason === "string") {
    decision.reason = o.reason;
  }
  const toClass = String(o.to_class ?? "");
  if ((WORKFLOW_CLASSES as readonly string[]).includes(toClass)) {
    decision.to_class = toClass as WorkflowClass;
  }
  return decision;
}

export type RouteRejection =
  | "unrecognized-outcome"
  /** The decision's `node_id` is not the node the persisted cursor sits on. */
  | "source-cursor-mismatch"
  /** The loaded graph does not survive the T03 overlay validator. */
  | "graph-invalid"
  | "no-edge-for-outcome"
  | "unknown-node"
  | "change-class-missing-target"
  | "change-class-not-authored"
  | "change-class-entry-bypass"
  | "explicit-escalate";

export interface RouteResult {
  /** The cursor after routing. On an escalation the node does NOT move. */
  cursor: WorkflowCursor;
  /** True when T0 must stop and surface the decision to the operator. */
  escalated: boolean;
  rejection?: RouteRejection;
  detail?: string;
}

function nodeIds(graph: WorkflowGraph): Set<string> {
  return new Set((graph.nodes ?? []).map((n: WorkflowGraphNode) => n?.id).filter(Boolean) as string[]);
}

function edgesFrom(graph: WorkflowGraph, node: string, outcome: string): WorkflowGraphEdge[] {
  return (graph.edges ?? []).filter((e) => e && e.from === node && e.on === outcome);
}

export interface RouteInput {
  /**
   * The PERSISTED cursor. Callers that have a run dir should use
   * `routeWorkflowDecisionAtRun`, which reads it off disk so the current node can
   * never come from the decision payload.
   */
  cursor: WorkflowCursor;
  /** The MERGED graph for the cursor's class. */
  graph: WorkflowGraph;
  decision: unknown;
  /**
   * The merged graphs of the other classes, when the caller has them. Supplying
   * them resolves a `change_class` target against the destination's REAL entry
   * instead of the pinned default table.
   */
  classGraphs?: Partial<Record<WorkflowClass, WorkflowGraph>>;
}

/**
 * Apply one decision to the cursor. Never throws; every refusal comes back as
 * `escalated: true` with the cursor parked on the node it could not leave, so a
 * crash-resumed run reads the same node it was stuck on.
 */
export function routeWorkflowDecision(input: RouteInput): RouteResult {
  const decision = normalizeWorkflowDecision(input.decision, input.cursor.run_id);
  const parked = (rejection: RouteRejection, detail: string): RouteResult => ({
    cursor: { ...input.cursor, last_decision: decision },
    escalated: true,
    rejection,
    detail,
  });

  // The CURRENT node is the cursor's, always. A decision envelope is produced by
  // T0 from a model's `goal_status`, so a `node_id` in it is a CLAIM about where
  // the run is, never the answer: taking it as the source let a forged
  // `node_id: product.release` advance an `intake` cursor straight past every
  // gate, because the edge lookup ran from the node the payload named. The claim
  // is now only ever compared against the cursor, and a disagreement is a
  // refusal — T0 must resolve which one is wrong before the run moves.
  const from = input.cursor.node_id;
  if (decision.node_id !== "" && decision.node_id !== from) {
    return parked(
      "source-cursor-mismatch",
      `decision names source '${decision.node_id}' but the cursor is on '${from}'`,
    );
  }

  if (decision.outcome === "escalate") {
    const unrecognized = (decision.reason ?? "").startsWith("unrecognized decision outcome");
    return parked(
      unrecognized ? "unrecognized-outcome" : "explicit-escalate",
      decision.reason ?? "decision outcome is escalate",
    );
  }

  // Every advance is validated against the loaded graph through the SAME T03
  // validator the overlay merge uses, with the sibling class graphs passed as
  // `classDefaults` so a cross-class edge resolves against the real destination.
  // The result is not returned immediately: the per-decision checks below name
  // the precise weakening, and they must keep doing so. It gates the two places
  // this function can actually MOVE the cursor, which is the only thing an
  // invalid graph must not be allowed to do.
  const validation = validateWorkflowGraphOverlay(input.graph, undefined, input.classGraphs as
    | Readonly<Record<string, WorkflowGraph>>
    | undefined);
  const invalid = (): RouteResult =>
    parked(
      "graph-invalid",
      `graph '${input.cursor.graph_id}' fails overlay validation: ` +
        validation.violations.map((v) => `${v.rule}: ${v.detail}`).join("; "),
    );

  const ids = nodeIds(input.graph);
  if (!ids.has(from)) {
    return parked("unknown-node", `cursor sits on node '${from}', which is not in graph '${input.cursor.graph_id}'`);
  }

  const candidates = edgesFrom(input.graph, from, decision.outcome);
  if (candidates.length === 0) {
    return parked(
      "no-edge-for-outcome",
      `graph '${input.cursor.graph_id}' has no '${decision.outcome}' edge from '${from}'`,
    );
  }

  if (decision.outcome === "change_class") {
    if (!decision.to_class) {
      return parked("change-class-missing-target", "change_class decision carries no to_class");
    }
    const edge = candidates.find(
      (e) => e.change_class === decision.to_class ||
        (typeof e.to === "object" && e.to !== null && e.to.class === decision.to_class),
    );
    if (!edge) {
      return parked(
        "change-class-not-authored",
        `no authored change_class edge from '${from}' to '${decision.to_class}'`,
      );
    }
    const destGraph = input.classGraphs?.[decision.to_class];
    const legitimateEntry =
      (destGraph && typeof destGraph.entry === "string" ? destGraph.entry : undefined) ??
      CLASS_DEFAULT_ENTRIES[decision.to_class];
    const declared =
      typeof edge.to === "object" && edge.to !== null && typeof edge.to.entry === "string"
        ? edge.to.entry
        : legitimateEntry;
    if (declared !== legitimateEntry) {
      return parked(
        "change-class-entry-bypass",
        `change_class edge enters '${decision.to_class}' at '${declared}', not its entry '${legitimateEntry}'`,
      );
    }
    if (!validation.valid) return invalid();
    return {
      cursor: {
        ...input.cursor,
        class: decision.to_class,
        graph_id:
          destGraph && typeof destGraph.graph_id === "string"
            ? destGraph.graph_id
            : `${decision.to_class}.default`,
        node_id: legitimateEntry,
        bound_from: "change_class",
        last_decision: decision,
      },
      escalated: false,
    };
  }

  const edge = candidates.find((e) => typeof e.to === "string");
  if (!edge || typeof edge.to !== "string") {
    return parked(
      "no-edge-for-outcome",
      `'${decision.outcome}' edge from '${from}' has no in-class target`,
    );
  }
  if (!ids.has(edge.to)) {
    return parked("unknown-node", `edge target '${edge.to}' is not a node of '${input.cursor.graph_id}'`);
  }
  if (!validation.valid) return invalid();

  return {
    cursor: { ...input.cursor, node_id: edge.to, last_decision: decision },
    escalated: false,
  };
}

export interface RouteAtRunInput extends Omit<RouteInput, "cursor"> {
  /**
   * The class and bind-source to assume when the run has no persisted cursor.
   * Its `node_id` is IGNORED: a run with no cursor is at the class's entry, and
   * nothing else may name the node.
   */
  cursor?: WorkflowCursor;
}

/**
 * The cursor a run with NOTHING on disk is on: the class graph's declared entry,
 * or the pinned default for that class. Never the caller's node.
 */
function entryCursor(input: RouteAtRunInput, runId: string): WorkflowCursor {
  const cls = (input.cursor?.class ??
    (WORKFLOW_CLASSES as readonly string[]).find((c) => c === input.graph?.class) ??
    "product") as WorkflowClass;
  const entry =
    typeof input.graph?.entry === "string" && input.graph.entry !== ""
      ? input.graph.entry
      : CLASS_DEFAULT_ENTRIES[cls];
  return {
    schema_version: WORKFLOW_CURSOR_SCHEMA,
    run_id: runId,
    class: cls,
    graph_id: typeof input.graph?.graph_id === "string" ? input.graph.graph_id : `${cls}.default`,
    node_id: entry,
    bound_from: input.cursor?.bound_from ?? "intake",
  };
}

/**
 * Route one decision against the cursor PERSISTED on the run record, and persist
 * the result. This is the production entrypoint: the current node comes off disk,
 * so no caller — and no model upstream of one — can supply it.
 *
 * With NO cursor on disk the run has not moved yet, so it is at the class graph's
 * ENTRY — full stop. Falling back to the caller's cursor let the very claim the
 * persisted cursor exists to overrule name the node again on the one request
 * where nothing on disk contradicts it: a first decision naming `product.release`
 * routed from `product.release`. The entry is taken from the loaded graph, the
 * caller's node is discarded, and a decision naming any other source is refused
 * by the same `source-cursor-mismatch` check every later decision meets.
 */
export function routeWorkflowDecisionAtRun(runDir: string, input: RouteAtRunInput): RouteResult {
  const persisted =
    readWorkflowCursor(runDir) ??
    entryCursor(input, normalizeWorkflowDecision(input.decision, input.cursor?.run_id ?? "").run_id);
  const result = routeWorkflowDecision({ ...input, cursor: persisted });
  writeWorkflowCursor(runDir, result.cursor);
  return result;
}

/** The node object the cursor currently sits on, or `undefined`. */
export function currentNode(graph: WorkflowGraph, cursor: WorkflowCursor): WorkflowGraphNode | undefined {
  return (graph.nodes ?? []).find((n) => n?.id === cursor.node_id);
}
