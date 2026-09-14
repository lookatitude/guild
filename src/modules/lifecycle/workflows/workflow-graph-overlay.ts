/**
 * workflow-graph-overlay.ts — merge + validate a project overlay onto a plugin
 * default class graph (`guild.workflow_graph.v1`, KTD40/KTD42/KTD56).
 *
 * The law this file exists to enforce: an overlay MAY reorder or omit nodes with
 * `required: false`. It may NEVER drop a protected node — product qa-before-release,
 * the D5 team gate, the D8 initiative close gate, or the interactive ops first run —
 * and it may never author a sixth class. The layout lint proves this BEHAVIORALLY:
 * `overlay-cannot-drop-required-nodes` imports this module and calls the validator
 * with a synthetic default graph plus an overlay missing `product.qa`. Returning a
 * clean result there is a lint failure, so this must stay a real rejection, not a
 * comment.
 *
 * The runtime router (cursor, decision routing, change_class) is NOT here — that is
 * the lifecycle runtime lane. This file loads, merges and validates data.
 */

/** The five closed classes (KTD40). A sixth is a hard rejection. */
export const WORKFLOW_CLASSES = Object.freeze(["product", "research", "debug", "ops", "init"] as const);
export type WorkflowClass = (typeof WORKFLOW_CLASSES)[number];

/** The closed decision enum an edge may fire on. */
export const WORKFLOW_EDGE_OUTCOMES = Object.freeze([
  "next", "skip", "replan", "harvest", "escalate", "change_class",
] as const);

/**
 * Nodes no overlay may remove, by id, regardless of what the overlay declares.
 * These are the KTD42 floor: qa before release, the team gate, the docs close
 * gate, and the interactive ops first run.
 */
export const PROTECTED_NODE_IDS = Object.freeze(["product.qa", "d5", "d8", "ops.first-run"] as const);

export interface WorkflowGraphNode {
  id: string;
  station?: string;
  assembler?: string;
  inner_loop?: boolean;
  required?: boolean;
  skip_when?: "recall_hit" | "operator" | "never";
}

export interface WorkflowGraphEdge {
  from: string;
  on: string;
  to: string | { class: string; entry: string };
  change_class?: string;
}

export interface WorkflowGraph {
  schema_version?: string;
  class?: string;
  graph_id?: string;
  entry?: string;
  nodes?: WorkflowGraphNode[];
  edges?: WorkflowGraphEdge[];
}

export interface OverlayViolation {
  rule:
    | "missing-required-node"
    | "unknown-class"
    | "unknown-edge-outcome"
    | "unknown-change-class"
    | "unknown-edge-endpoint";
  detail: string;
}

export interface OverlayValidationResult {
  ok: boolean;
  valid: boolean;
  violations: OverlayViolation[];
}

/**
 * The oracle calls this with graph objects, with bare id arrays, and with a single
 * argument. Normalise every one of those into a node list so the law is enforced
 * the same way whatever the caller hands over.
 */
function toNodes(value: unknown): WorkflowGraphNode[] {
  if (Array.isArray(value)) {
    return value.map((v) =>
      typeof v === "string" ? { id: v } : ((v ?? {}) as WorkflowGraphNode),
    );
  }
  if (value && typeof value === "object") {
    const nodes = (value as WorkflowGraph).nodes;
    if (Array.isArray(nodes)) return nodes.map((n) => (typeof n === "string" ? { id: n } : n));
  }
  return [];
}

function asGraph(value: unknown): WorkflowGraph {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as WorkflowGraph)
    : {};
}

/** Every node id the default graph says an overlay must keep. */
function requiredIds(defaultNodes: WorkflowGraphNode[]): string[] {
  const ids = new Set<string>(PROTECTED_NODE_IDS);
  for (const n of defaultNodes) {
    if (n && n.required === true && typeof n.id === "string") ids.add(n.id);
  }
  return [...ids];
}

/**
 * Validate `overlay` against `pluginDefault`.
 *
 * Called with one argument, the single graph is BOTH the default and the overlay:
 * a standalone graph that omits a protected node it also fails to declare is still
 * an invalid graph.
 *
 * Returns `{ ok: false, valid: false, violations: [...] }` on rejection. It does
 * not throw — a caller merging graphs wants the full violation list, not the first
 * failure.
 */
export function validateWorkflowGraphOverlay(
  pluginDefault: unknown,
  overlay?: unknown,
): OverlayValidationResult {
  const defaultNodes = toNodes(pluginDefault);
  const hasOverlay = overlay !== undefined && overlay !== null;
  const overlayNodes = hasOverlay ? toNodes(overlay) : defaultNodes;
  const overlayGraph = asGraph(hasOverlay ? overlay : pluginDefault);

  const violations: OverlayViolation[] = [];
  const present = new Set(overlayNodes.map((n) => n?.id).filter((id): id is string => !!id));

  // Only enforce a protected id the composition actually knows about: a debug
  // overlay is not missing `product.qa`. An id that is protected AND present in
  // the default (or in the protected floor the default itself declares) must
  // survive the overlay.
  const defaultIds = new Set(defaultNodes.map((n) => n?.id).filter(Boolean) as string[]);
  for (const id of requiredIds(defaultNodes)) {
    if (!defaultIds.has(id)) continue;
    if (!present.has(id)) {
      violations.push({
        rule: "missing-required-node",
        detail: `overlay drops required node '${id}'`,
      });
    }
  }

  const cls = overlayGraph.class;
  if (typeof cls === "string" && !(WORKFLOW_CLASSES as readonly string[]).includes(cls)) {
    violations.push({ rule: "unknown-class", detail: `'${cls}' is not one of the five classes` });
  }

  for (const e of overlayGraph.edges ?? []) {
    if (!e) continue;
    if (typeof e.on === "string" && !(WORKFLOW_EDGE_OUTCOMES as readonly string[]).includes(e.on)) {
      violations.push({
        rule: "unknown-edge-outcome",
        detail: `edge ${String(e.from)} -> on:'${e.on}' is not in the decision enum`,
      });
    }
    const target = e.to;
    const toClass =
      e.change_class ?? (target && typeof target === "object" ? target.class : undefined);
    if (toClass !== undefined && !(WORKFLOW_CLASSES as readonly string[]).includes(toClass)) {
      violations.push({
        rule: "unknown-change-class",
        detail: `edge ${String(e.from)} changes class to '${toClass}', which is not one of the five`,
      });
    }
    if (typeof target === "string" && present.size > 0 && !present.has(target)) {
      violations.push({
        rule: "unknown-edge-endpoint",
        detail: `edge ${String(e.from)} -> '${target}' names a node the merged graph does not declare`,
      });
    }
  }

  const ok = violations.length === 0;
  return { ok, valid: ok, violations };
}

/**
 * Merge a project overlay onto the plugin default and validate the result.
 * Throws on rejection — the merge path has nothing sensible to return when the
 * merged graph is illegal.
 */
export function applyWorkflowGraphOverlay(
  pluginDefault: WorkflowGraph,
  overlay?: WorkflowGraph,
): WorkflowGraph {
  const merged: WorkflowGraph = overlay
    ? { ...pluginDefault, ...overlay, nodes: overlay.nodes ?? pluginDefault.nodes, edges: overlay.edges ?? pluginDefault.edges }
    : { ...pluginDefault };
  const result = validateWorkflowGraphOverlay(pluginDefault, merged);
  if (!result.ok) {
    throw new Error(
      `guild.workflow_graph.v1 overlay rejected: ${result.violations.map((v) => v.detail).join("; ")}`,
    );
  }
  return merged;
}

/**
 * Validate one authored `guild.workflow_graph.v1` document against the frozen
 * shape (schema_version, closed class, entry resolves, node/edge fields, closed
 * decision enum, closed change_class). This is the load half of "lifecycle owns
 * load/merge/validate"; `validateWorkflowGraphOverlay` is the merge half.
 */
export function validateWorkflowGraphDocument(doc: unknown): OverlayValidationResult {
  const violations: OverlayViolation[] = [];
  const g = asGraph(doc);
  const nodes = toNodes(g);
  const ids = new Set(nodes.map((n) => n?.id).filter(Boolean) as string[]);

  if (g.schema_version !== "guild.workflow_graph.v1") {
    violations.push({ rule: "unknown-class", detail: `schema_version '${String(g.schema_version)}' is not guild.workflow_graph.v1` });
  }
  if (!(WORKFLOW_CLASSES as readonly string[]).includes(String(g.class))) {
    violations.push({ rule: "unknown-class", detail: `'${String(g.class)}' is not one of the five classes` });
  }
  if (nodes.length === 0) {
    violations.push({ rule: "missing-required-node", detail: "graph declares no nodes" });
  }
  if (typeof g.entry !== "string" || !ids.has(g.entry)) {
    violations.push({ rule: "unknown-edge-endpoint", detail: `entry '${String(g.entry)}' is not a declared node` });
  }
  for (const e of g.edges ?? []) {
    if (!e || typeof e.from !== "string" || !ids.has(e.from)) {
      violations.push({ rule: "unknown-edge-endpoint", detail: `edge from '${String(e?.from)}' is not a declared node` });
    }
    if (!(WORKFLOW_EDGE_OUTCOMES as readonly string[]).includes(String(e?.on))) {
      violations.push({ rule: "unknown-edge-outcome", detail: `edge outcome '${String(e?.on)}' is not in the decision enum` });
    }
    const to = e?.to;
    if (typeof to === "string") {
      if (!ids.has(to)) violations.push({ rule: "unknown-edge-endpoint", detail: `edge to '${to}' is not a declared node` });
    } else if (to && typeof to === "object") {
      if (!(WORKFLOW_CLASSES as readonly string[]).includes(String(to.class))) {
        violations.push({ rule: "unknown-change-class", detail: `edge crosses to class '${String(to.class)}', which is not one of the five` });
      }
    } else {
      violations.push({ rule: "unknown-edge-endpoint", detail: `edge from '${String(e?.from)}' has no target` });
    }
    if (e?.change_class !== undefined && !(WORKFLOW_CLASSES as readonly string[]).includes(e.change_class)) {
      violations.push({ rule: "unknown-change-class", detail: `change_class '${e.change_class}' is not one of the five` });
    }
  }
  const ok = violations.length === 0;
  return { ok, valid: ok, violations };
}
