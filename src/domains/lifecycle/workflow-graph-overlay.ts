/**
 * workflow-graph-overlay.ts — merge + validate a project overlay onto a plugin
 * default class graph (`guild.workflow_graph.v1`, KTD40/KTD42/KTD56).
 *
 * The law this file exists to enforce: an overlay MAY reorder or omit nodes with
 * `required: false`. It may NEVER weaken a protected gate — product
 * qa-before-release, the D5 team gate, the D8 initiative close gate, or the
 * interactive ops first run — and it may never author a sixth class.
 *
 * Three codex G-lane rounds found a new bypass each time, because the rules
 * ENUMERATED the moves. Round 3 makes them structural instead:
 *
 *   - A protected gate is IMMUTABLE. An overlay may restate it verbatim or name it
 *     by `id` alone, and nothing else. That single rule subsumes station swaps,
 *     assembler swaps, `required: false` and `skip_when` — and every field anyone
 *     adds to the node schema later, which the per-field checks could not.
 *   - Ids in the merged graph are UNIQUE, so a decoy node cannot sit beside the
 *     real one and win the merge.
 *   - A protected node's ROLE (its station+assembler pair) belongs to it. No other
 *     node may wear it, so the gate cannot be impersonated.
 *   - RELEASE-shaped work is identified by role, not by id, and must sit behind
 *     every gate. A brand-new node that does release work escapes an id-keyed
 *     gated set; it cannot escape a role-keyed one.
 *   - Every edge endpoint resolves, and every gate stays reachable from the entry,
 *     so the graph cannot be stranded instead of bypassed.
 *
 * The moves those rules close, in the order codex found them:
 *   1. DROP the node.
 *   2. ROUTE AROUND it — keep `product.qa` in `nodes` but reach what the gate guards
 *      without visiting it. This is a REACHABILITY property of the whole graph, read
 *      FROM THE ENTRY: `build -> product.release` is one shape of it, but so are
 *      `spec -> build` (skips D5), `product.qa -> product.release` (skips D8), and
 *      simply declaring `entry: product.release` (skips everything). Anchoring the
 *      walk on one hard-coded `from` node caught only the first — codex G-lane r2.
 *   3. HOLLOW it out — keep the id and change its `station` from `runtime-qa` to
 *      something that does not gate (codex used `reflect`). Station is what the
 *      router dispatches on, so a renamed station is a removed gate wearing the id.
 *      The MERGE matters here: an overlay node is merged FIELD-WISE onto the default
 *      node, so `{id: "product.qa"}` alone inherits station/assembler/required rather
 *      than blanking them. Replacing the node object wholesale made a bare id both
 *      pass every check and strip the gate from the merged output — codex G-lane r2.
 *   4. Make it skippable — flip `required` off, or hand it a `skip_when` that lets
 *      an operator wave it through.
 *   5. IMPERSONATE it — declare a new entry node carrying `station: ops-runbooks,
 *      assembler: operations` and run release work from it, untouched by any
 *      id-keyed gated set (codex G-lane r3).
 *   6. SHADOW it — declare the protected id twice, once hollowed out and once bare,
 *      and keep both in the merged output (codex G-lane r3).
 *   7. STRAND it — point an edge at a `from` that does not exist, orphaning the
 *      gate rather than routing around it (codex G-lane r3).
 *
 * The layout lint proves case 1 BEHAVIORALLY:
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

/**
 * The canonical qa-before-release pair, kept for the clearer violation message on
 * the commonest shape. The general entry-relative walk below subsumes it: it is
 * not the only bypass, only the most legible one.
 */
export const RELEASE_GATE = Object.freeze({
  class: "product",
  from: "build",
  gate: "product.qa",
  releaseNodes: Object.freeze(["product.release"] as const),
} as const);

/**
 * The station each protected node must keep. An overlay may rename a node's
 * station freely EXCEPT here: the router dispatches on `station`, so
 * `{id: "product.qa", station: "reflect"}` is the qa gate deleted and its id left
 * behind as decoration.
 */
export const PROTECTED_NODE_STATIONS: Readonly<Record<string, string>> = Object.freeze({
  "product.qa": "runtime-qa",
  d5: "team-compose",
  d8: "initiative-close",
  "ops.first-run": "ops-runbooks",
});

/** A node's dispatch identity: what the router runs when it arrives there. */
export interface NodeRole {
  station: string;
  assembler: string;
}

/**
 * The station+assembler pair each gate OWNS. No other node may wear one of these:
 * a second `{station: "runtime-qa", assembler: "quality"}` node is the qa gate
 * impersonated, and the router cannot tell which one is the real one.
 *
 * `ops.first-run` is deliberately absent. Its pair is the RELEASE role below, which
 * its four sibling runbooks legitimately share in the shipped ops graph — it is
 * protected by `required` plus the gated-set walk, not by role uniqueness.
 */
export const PROTECTED_NODE_ROLES: Readonly<Record<string, NodeRole>> = Object.freeze({
  "product.qa": Object.freeze({ station: "runtime-qa", assembler: "quality" }),
  d5: Object.freeze({ station: "team-compose", assembler: "team-compose" }),
  d8: Object.freeze({ station: "initiative-close", assembler: "initiative" }),
});

/**
 * What RELEASE work looks like, by role rather than by id — the pair carried by
 * `product.release` and by every `ops.*` runbook in the shipped graphs.
 *
 * Identifying release work structurally is what closes the new-node escape: an
 * overlay can invent any id it likes, but the moment the node dispatches
 * `operations` at an `ops-runbooks` station it is release work and must sit behind
 * every gate.
 */
export const RELEASE_ROLE: NodeRole = Object.freeze({
  station: "ops-runbooks",
  assembler: "operations",
});

/**
 * Each class's default entry node, pinned so a cross-class edge can be resolved
 * without holding the destination class's graph.
 *
 * An overlay edge may hand off to another class (`to: {class, entry}`). Validating
 * that target needs to know where that class legitimately STARTS — otherwise
 * `{class: "product", entry: "product.release"}` reads as an ordinary handoff and
 * lands past every gate (codex G-lane r4). The five shipped graphs are asserted
 * against this table, so a graph that moves its entry fails the test instead of
 * quietly un-pinning the rule. Pass `classDefaults` to `validateWorkflowGraphOverlay`
 * to resolve targets against real graphs instead.
 */
export const CLASS_DEFAULT_ENTRIES: Readonly<Record<string, string>> = Object.freeze({
  product: "intake",
  research: "recall",
  debug: "recall",
  ops: "ops.first-run",
  init: "detect",
});

/** Does this node do release-shaped work? Either half of the pair is enough. */
export function isReleaseShaped(node: WorkflowGraphNode | undefined): boolean {
  if (!node) return false;
  return node.station === RELEASE_ROLE.station || node.assembler === RELEASE_ROLE.assembler;
}

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
    | "bypasses-required-node"
    // The structural four (codex G-lane r3).
    | "protected-node-field-override"
    | "duplicate-node-id"
    | "protected-role-reassigned"
    | "release-work-ungated"
    | "cross-class-entry-bypasses-gate"
    | "edge-endpoint-unknown"
    | "gate-unreachable"
    // The entry must name a node (codex G-lane r5): reachability is vacuous in
    // a class with no gates, so existence is checked explicitly.
    | "entry-unknown-node"
    | "cross-class-entry-unknown-node"
    // Kept as narrower ALIASES of protected-node-field-override so the r1/r2
    // fixtures keep naming the specific weakening they pin. Every case that
    // raises one of these also raises the structural rule.
    | "required-node-station-changed"
    | "required-node-made-skippable"
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

/** Every node of a graph, keyed by id (last declaration wins, as a merge would). */
function nodeIndex(nodes: WorkflowGraphNode[]): Map<string, WorkflowGraphNode> {
  const m = new Map<string, WorkflowGraphNode>();
  for (const n of nodes) if (n && typeof n.id === "string") m.set(n.id, n);
  return m;
}

/**
 * Successors of each node WITHIN this graph.
 *
 * An object edge target (`{class, entry}`) normally leaves the graph — except when
 * it names THIS class, which makes it an ordinary intra-class jump wearing a
 * cross-class costume. Codex G-lane r4 used exactly that: an `intake` edge to
 * `{class: "product", entry: "product.release"}` inside the product graph. Treating
 * it as an exit made it invisible to every traversal, so it is resolved here.
 */
function adjacency(
  edges: readonly WorkflowGraphEdge[],
  ownClass?: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = out.get(from) ?? [];
    list.push(to);
    out.set(from, list);
  };
  for (const e of edges) {
    if (!e || typeof e.from !== "string") continue;
    if (typeof e.to === "string") {
      add(e.from, e.to);
      continue;
    }
    if (e.to && typeof e.to === "object" && ownClass !== undefined && e.to.class === ownClass) {
      const entry = typeof e.to.entry === "string" ? e.to.entry : CLASS_DEFAULT_ENTRIES[ownClass];
      if (typeof entry === "string") add(e.from, entry);
    }
  }
  return out;
}

/** Every object edge target on a graph, with the class it hands off to. */
function crossClassTargets(
  edges: readonly WorkflowGraphEdge[],
): Array<{ from: string; class: string; entry?: string }> {
  const out: Array<{ from: string; class: string; entry?: string }> = [];
  for (const e of edges) {
    if (!e || typeof e.to !== "object" || e.to === null) continue;
    out.push({
      from: String(e.from),
      class: String(e.to.class),
      entry: typeof e.to.entry === "string" ? e.to.entry : undefined,
    });
  }
  return out;
}

/**
 * Every node reachable from `from`, following intra-class edges, optionally with
 * one node removed from the graph. Cycles terminate on the visited set. `from`
 * itself is always in the result.
 */
function reachableFrom(
  adj: Map<string, string[]>,
  from: string,
  without?: string,
): Set<string> {
  const seen = new Set<string>();
  if (from === without) return seen;
  seen.add(from);
  const stack = [from];
  while (stack.length > 0) {
    const at = stack.pop()!;
    for (const next of adj.get(at) ?? []) {
      if (next === without || seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

/**
 * Does `gate` DOMINATE `node` from `entry` — is every path to it through the gate?
 *
 * Computed on the MERGED graph, which is the whole point: "what did the default
 * guard" could only ever protect nodes the shipped graph already named, so a new
 * node slipped past it (codex G-lane r3) and a legitimate new node placed AFTER
 * the release was wrongly refused (codex G-lane r4). Dominance asks the question
 * directly — delete the gate, and see whether the node is still reachable.
 */
function dominates(
  adj: Map<string, string[]>,
  entry: string,
  gate: string,
  node: string,
): boolean {
  if (node === gate) return true;
  return !reachableFrom(adj, entry, gate).has(node);
}

/**
 * Merge one overlay node ONTO its default node, field by field.
 *
 * An overlay names a node to CHANGE it, not to redefine it from nothing: an entry
 * of `{id: "product.qa"}` means "keep the qa node as shipped". Spreading the
 * default first and the overlay second means an unstated field is inherited and a
 * stated one wins — and, critically, the station / required / skip_when checks then
 * run on what the router will actually see.
 */
function mergeNode(
  base: WorkflowGraphNode | undefined,
  over: WorkflowGraphNode | undefined,
): WorkflowGraphNode | undefined {
  if (base === undefined) return over;
  if (over === undefined) return base;
  return { ...base, ...over };
}

/** The overlay's node list, each entry merged onto its default counterpart. */
function mergeNodeList(
  defaultNodes: WorkflowGraphNode[],
  overlayNodes: WorkflowGraphNode[],
): WorkflowGraphNode[] {
  const base = nodeIndex(defaultNodes);
  return overlayNodes.map((n) => (n && typeof n.id === "string" ? mergeNode(base.get(n.id), n)! : n));
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
  /**
   * The other classes' default graphs, when the caller has them. Present, a
   * cross-class handoff is resolved against the real destination; absent, it is
   * resolved against `CLASS_DEFAULT_ENTRIES` and a non-default target is refused
   * rather than assumed safe.
   */
  classDefaults?: Readonly<Record<string, WorkflowGraph>>,
): OverlayValidationResult {
  const defaultGraph = asGraph(pluginDefault);
  const defaultNodes = toNodes(pluginDefault);
  const hasOverlay = overlay !== undefined && overlay !== null;
  const overlayGraph = asGraph(hasOverlay ? overlay : pluginDefault);
  const rawOverlayNodes = hasOverlay ? toNodes(overlay) : defaultNodes;
  // Field-wise merge (codex G-lane r2): the checks below, and the graph the router
  // ends up with, must both see the node AFTER inheritance — not the bare stub an
  // overlay may have written.
  const overlayNodes = mergeNodeList(defaultNodes, rawOverlayNodes);

  const violations: OverlayViolation[] = [];
  const present = new Set(overlayNodes.map((n) => n?.id).filter((id): id is string => !!id));

  // Only enforce a protected id the composition actually knows about: a debug
  // overlay is not missing `product.qa`. An id that is protected AND present in
  // the default (or in the protected floor the default itself declares) must
  // survive the overlay.
  const defaultIds = new Set(defaultNodes.map((n) => n?.id).filter(Boolean) as string[]);
  const defaultIndex = nodeIndex(defaultNodes);
  const overlayIndex = nodeIndex(overlayNodes);
  const gates = requiredIds(defaultNodes).filter((id) => defaultIds.has(id));
  // A protected id is only a GATE in a class whose default declares it (codex
  // G-lane r4). `ops.first-run` dropped into the product class is not the ops
  // first run — it is a new node wearing a reserved name, and every rule for new
  // nodes applies to it.
  const classProtectedIds = new Set<string>(gates);
  const reservedButForeign = (id: string): boolean =>
    (PROTECTED_NODE_IDS as readonly string[]).includes(id) && !classProtectedIds.has(id);
  const ownClass =
    typeof overlayGraph.class === "string" ? overlayGraph.class
    : typeof defaultGraph.class === "string" ? defaultGraph.class
    : undefined;

  // ── Ids are unique (codex G-lane r3) ──────────────────────────────────────
  //
  // `[{id: "product.qa", station: "reflect", skip_when: "operator"}, {id: "product.qa"}]`
  // put a hollowed-out node beside a clean one: the checks read whichever the index
  // happened to keep and the merged output carried BOTH, so the router could pick
  // the decoy. A merged graph with two nodes of one id has no single answer to
  // "what is product.qa", which is reason enough to refuse it.
  const idCounts = new Map<string, number>();
  for (const n of rawOverlayNodes) {
    if (!n || typeof n.id !== "string") continue;
    idCounts.set(n.id, (idCounts.get(n.id) ?? 0) + 1);
  }
  for (const [id, count] of [...idCounts.entries()].sort()) {
    if (count > 1) {
      violations.push({
        rule: "duplicate-node-id",
        detail: `overlay declares node id '${id}' ${count} times`,
      });
    }
  }

  // ── Protected gates are immutable (codex G-lane r3) ───────────────────────
  //
  // An overlay may reorder a gate, restate it verbatim, or name it by `id` alone.
  // It may not change ANY field on it. Enumerating the fields is what let r1 and r2
  // through one at a time; this covers `assembler`, and every field added later.
  for (const id of gates) {
    if (!present.has(id)) {
      violations.push({
        rule: "missing-required-node",
        detail: `overlay drops required node '${id}'`,
      });
      continue;
    }
    const before = defaultIndex.get(id);
    if (before === undefined) continue;
    // EVERY declaration of the id, not the one an index happened to keep. With a
    // duplicate present, indexing by id picks a winner and the loser's fields go
    // unchecked — which is precisely how the shadowed decoy passed (r3).
    for (const stated of rawOverlayNodes.filter((n) => n && n.id === id)) {
    for (const key of Object.keys(stated) as Array<keyof WorkflowGraphNode>) {
      if (key === "id") continue;
      if (stated[key] === before[key]) continue; // restating the shipped value is a no-op
      violations.push({
        rule: "protected-node-field-override",
        detail:
          `overlay overrides '${key}' on protected node '${id}' ` +
          `(${JSON.stringify(before[key])} -> ${JSON.stringify(stated[key])}); ` +
          `a protected node may carry only its id`,
      });
      // Narrower aliases, so a fixture can still pin the specific weakening.
      if (key === "station") {
        violations.push({
          rule: "required-node-station-changed",
          detail: `overlay changes required node '${id}' station '${String(before.station)}' -> '${String(stated.station)}'`,
        });
      }
      if (key === "required" && stated.required === false) {
        violations.push({
          rule: "required-node-made-skippable",
          detail: `overlay clears required on '${id}'`,
        });
      }
      if (key === "skip_when" && stated.skip_when !== "never") {
        violations.push({
          rule: "required-node-made-skippable",
          detail: `overlay gives required node '${id}' skip_when '${String(stated.skip_when)}'`,
        });
      }
    }
    }
  }

  // A gate must also still carry the role it owns, however the node got that way.
  for (const [id, role] of Object.entries(PROTECTED_NODE_ROLES)) {
    const node = overlayIndex.get(id);
    if (node === undefined || !defaultIds.has(id)) continue;
    if (node.station !== undefined && node.station !== role.station) {
      violations.push({
        rule: "required-node-station-changed",
        detail: `merged node '${id}' station is '${node.station}', not its own '${role.station}'`,
      });
    }
    if (node.assembler !== undefined && node.assembler !== role.assembler) {
      violations.push({
        rule: "protected-role-reassigned",
        detail: `merged node '${id}' assembler is '${node.assembler}', not its own '${role.assembler}'`,
      });
    }
  }

  // ── A gate's role belongs to the gate (codex G-lane r3) ───────────────────
  for (const node of overlayNodes) {
    if (!node || typeof node.id !== "string" || classProtectedIds.has(node.id)) continue;
    // A reserved gate id in a class that never declared that gate is an identity
    // claim, not a gate: the node answers to a protected name while obeying none
    // of the protections (codex G-lane r4).
    if (reservedButForeign(node.id)) {
      violations.push({
        rule: "protected-role-reassigned",
        detail:
          `node '${node.id}' uses the reserved id of a protected gate in class ` +
          `'${String(ownClass)}', whose default does not declare it ` +
          `(station '${String(node.station)}', assembler '${String(node.assembler)}')`,
      });
    }
    for (const [ownerId, role] of Object.entries(PROTECTED_NODE_ROLES)) {
      if (!defaultIds.has(ownerId)) continue;
      const stationClash = node.station !== undefined && node.station === role.station;
      const assemblerClash = node.assembler !== undefined && node.assembler === role.assembler;
      if (!stationClash && !assemblerClash) continue;
      violations.push({
        rule: "protected-role-reassigned",
        detail:
          `node '${node.id}' claims ${stationClash ? `station '${role.station}'` : `assembler '${role.assembler}'`}, ` +
          `which belongs to protected node '${ownerId}'`,
      });
    }
  }

  // ── Gating is DOMINANCE on the merged graph (codex G-lane r4) ─────────────
  //
  // One question answers every ordering rule: from the effective entry, is this
  // node still reachable once the gate is deleted? If yes, some route skips the
  // gate. Asking it on the MERGED graph — never on "what the default guarded" —
  // is what makes it cover nodes the shipped graph never declared, and what stops
  // it refusing a legitimate new node placed AFTER the release (r4 P2).
  const mergedEdges = overlayGraph.edges ?? defaultGraph.edges ?? [];
  const mergedAdj = adjacency(mergedEdges, ownClass);
  const defaultEntry = typeof defaultGraph.entry === "string" ? defaultGraph.entry : undefined;
  const overlayEntry = typeof overlayGraph.entry === "string" ? overlayGraph.entry : undefined;
  const effectiveEntry = overlayEntry ?? defaultEntry;

  // The entry must NAME A NODE (codex G-lane r5). Reachability cannot notice an
  // entry that exists nowhere — in a class with no gates every ordering rule is
  // vacuous — so the merged graph would carry an entry that the router cannot
  // start from.
  if (effectiveEntry !== undefined && !present.has(effectiveEntry)) {
    violations.push({
      rule: "entry-unknown-node",
      detail: `entry '${effectiveEntry}' names no node in the merged graph`,
    });
  }

  // ── Cross-class handoffs resolve to the destination's entry ───────────────
  //
  // A handoff may only land where that class legitimately STARTS, or upstream of
  // every gate it has. `{class: "product", entry: "product.release"}` lands past
  // all three product gates and read as an ordinary handoff before r4.
  for (const target of crossClassTargets(mergedEdges)) {
    if (!(WORKFLOW_CLASSES as readonly string[]).includes(target.class)) continue; // unknown-change-class covers it
    if (target.entry === undefined) continue; // omitted = that class's own default
    const destGraph = classDefaults?.[target.class];
    const destEntry =
      (typeof destGraph?.entry === "string" ? destGraph.entry : undefined) ??
      CLASS_DEFAULT_ENTRIES[target.class];
    // Existence FIRST, shortcut second (codex G-lane r6): a same-class handoff
    // to the pinned default entry is still dangling when the overlay deleted
    // that node, so the merged node set is consulted before the default-entry
    // shortcut can wave it through.
    if (target.class === ownClass && !present.has(target.entry)) {
      violations.push({
        rule: "cross-class-entry-unknown-node",
        detail:
          `edge ${target.from} hands off to class '${target.class}' at '${target.entry}', ` +
          `which names no node in the merged graph`,
      });
      continue;
    }
    if (target.entry === destEntry) continue;

    if (destGraph !== undefined && destEntry !== undefined) {
      // With the destination graph in hand, a non-default entry is legal only
      // when it is upstream of every gate there — i.e. no gate dominates it.
      const destNodes = toNodes(destGraph);
      if (!destNodes.some((n) => n?.id === target.entry)) {
        violations.push({
          rule: "cross-class-entry-unknown-node",
          detail:
            `edge ${target.from} hands off to class '${target.class}' at '${target.entry}', ` +
            `which names no node in that class`,
        });
        continue;
      }
      const destAdj = adjacency(destGraph.edges ?? [], target.class);
      const destGates = requiredIds(destNodes).filter((g) =>
        destNodes.some((n) => n?.id === g),
      );
      const behind = destGates.filter((g) => dominates(destAdj, destEntry, g, target.entry!));
      if (behind.length === 0) continue;
      violations.push({
        rule: "cross-class-entry-bypasses-gate",
        detail:
          `edge ${target.from} hands off to class '${target.class}' at '${target.entry}', ` +
          `which is behind required node(s) ${behind.map((g) => `'${g}'`).join(", ")}`,
      });
      continue;
    }

    violations.push({
      rule: "cross-class-entry-bypasses-gate",
      detail:
        `edge ${target.from} hands off to class '${target.class}' at '${target.entry}', ` +
        `which is not that class's entry ('${String(destEntry)}') and cannot be shown ` +
        `to be upstream of its gates`,
    });
  }

  if (effectiveEntry !== undefined) {
    const fromEntry = reachableFrom(mergedAdj, effectiveEntry);
    const liveGates = gates.filter((g) => present.has(g));

    // A stranded gate is as good as a dropped one (codex G-lane r3). Declaring a
    // later entry strands every gate upstream of it, so this is also what catches
    // `entry: product.release` and `entry: ops.release`.
    for (const gate of liveGates) {
      if (fromEntry.has(gate)) continue;
      violations.push({
        rule: "gate-unreachable",
        detail:
          `required node '${gate}' is not reachable from entry '${effectiveEntry}'` +
          (overlayEntry !== undefined && overlayEntry !== defaultEntry
            ? `; the overlay entry starts the run past it`
            : ""),
      });
      violations.push({
        rule: "bypasses-required-node",
        detail:
          `entry '${effectiveEntry}' is downstream of required node '${gate}', ` +
          `so the run starts past it`,
      });
    }

    // Rule A — RELEASE work must be dominated by every gate. Release-shaped is a
    // ROLE test, so an invented id cannot escape it; dominance is a merged-graph
    // test, so a node placed after the release passes.
    for (const node of overlayNodes) {
      if (!node || typeof node.id !== "string") continue;
      if (classProtectedIds.has(node.id)) continue; // a gate of THIS class
      if (!isReleaseShaped(node)) continue;
      if (!fromEntry.has(node.id)) continue; // unreachable: it runs nothing
      for (const gate of liveGates) {
        if (dominates(mergedAdj, effectiveEntry, gate, node.id)) continue;
        violations.push({
          rule: "release-work-ungated",
          detail:
            `node '${node.id}' does release work (station '${String(node.station)}', ` +
            `assembler '${String(node.assembler)}') but required node '${gate}' does not ` +
            `dominate it from entry '${effectiveEntry}'`,
        });
        violations.push({
          rule: "bypasses-required-node",
          detail:
            `overlay routes '${effectiveEntry}' -> '${node.id}' without passing ` +
            `through required node '${gate}'`,
        });
      }
    }

    // Rule B — the gates keep their order relative to EACH OTHER. Only the gate
    // set is consulted, so this stays a statement about the protected floor: if
    // D5 dominated QA as shipped, an overlay may not route around D5 into QA.
    if (defaultEntry !== undefined) {
      const defaultAdj = adjacency(defaultGraph.edges ?? [], ownClass);
      for (const outer of liveGates) {
        for (const inner of liveGates) {
          if (outer === inner) continue;
          if (!dominates(defaultAdj, defaultEntry, outer, inner)) continue;
          if (dominates(mergedAdj, effectiveEntry, outer, inner)) continue;
          violations.push({
            rule: "bypasses-required-node",
            detail:
              `overlay reaches required node '${inner}' without passing through ` +
              `required node '${outer}', which gated it in the class default`,
          });
        }
      }
    }
  }

  const cls = overlayGraph.class;
  if (typeof cls === "string" && !(WORKFLOW_CLASSES as readonly string[]).includes(cls)) {
    violations.push({ rule: "unknown-class", detail: `'${cls}' is not one of the five classes` });
  }

  for (const e of overlayGraph.edges ?? []) {
    if (!e) continue;
    // BOTH endpoints, not just `to` (codex G-lane r3): an edge whose `from` names
    // no node is dead routing — the nodes it was supposed to lead out of are
    // stranded, which reaches the same place as bypassing them.
    if (present.size > 0) {
      for (const [side, id] of [["from", e.from], ["to", typeof e.to === "string" ? e.to : undefined]] as const) {
        if (typeof id !== "string" || present.has(id)) continue;
        violations.push({
          rule: "edge-endpoint-unknown",
          detail: `edge ${side} '${id}' names a node the merged graph does not declare`,
        });
      }
    }
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
  // Nodes merge FIELD-WISE onto their default counterpart, not wholesale: an
  // overlay entry of `{id: "product.qa"}` keeps the shipped station, assembler and
  // `required: true`. Replacing the object stripped the gate while every id check
  // still passed (codex G-lane r2). Graph-level fields and the edge list stay
  // whole-value — an overlay that declares `edges` is redefining the routing.
  const merged: WorkflowGraph = overlay
    ? {
        ...pluginDefault,
        ...overlay,
        nodes: overlay.nodes ? mergeNodeList(pluginDefault.nodes ?? [], overlay.nodes) : pluginDefault.nodes,
        edges: overlay.edges ?? pluginDefault.edges,
      }
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
