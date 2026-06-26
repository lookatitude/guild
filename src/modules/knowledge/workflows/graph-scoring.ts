/**
 * src/modules/knowledge/workflows/graph-scoring.ts
 *
 * CANONICAL, single-source KnowledgeGraph node-scoring helpers (re-arch WAVE 1,
 * M9 single-source floor). The ONE place these scorers live. Consumers:
 *   - scripts/learn/kg-query.ts  (re-exports + uses the full scoreNode path)
 *   - scripts/lib/recall.ts           (uses termMatchScore for its KG branch)
 *
 * Determinism (SC-9): every field here is deterministic-script; no LLM calls.
 * Behaviour is byte-for-byte the same as the former kg-query.ts copy — the
 * term-match loop that recall.ts had inlined (scoreKgNode) is now the shared
 * `termMatchScore` primitive. Guarded by scripts/__tests__/graph-scoring-parity.test.ts.
 */

import type { GraphNode, GraphEdge } from "../../learning";

/**
 * Compute an importance multiplier in [0, 1] from a node's fields.
 *
 * Priority:
 *   1. numeric `importance_score` (0–1) — used directly (clamped).
 *   2. string `importance` — mapped: high→0.8, medium→0.4, low→0.1.
 *   3. Neither present → 0 (no boost).
 *
 * The multiplier is MULTIPLICATIVE on the base term score:
 *   finalTermScore = baseTermScore * (1 + importanceMultiplier(node))
 * A node with importance_score=0 gets 1× (no boost); importance_score=1 gets 2×.
 */
export function importanceMultiplier(node: GraphNode): number {
  const n = node as GraphNode & { importance_score?: unknown; importance?: unknown };
  if (typeof n.importance_score === "number") {
    return Math.max(0, Math.min(1, n.importance_score));
  }
  switch (n.importance) {
    case "high":   return 0.8;
    case "medium": return 0.4;
    case "low":    return 0.1;
    default:       return 0;
  }
}

/**
 * Compute an additive confidence bonus [0, 0.3].
 *
 * high → +0.3 · medium → +0.1 · low / undefined → +0.
 * Additive (not multiplicative) — confidence is a fine-grained tie-breaker,
 * not a primary ranking signal; it never overrides a substantial importance gap.
 */
export function confidenceBonus(node: GraphNode): number {
  switch (node.confidence) {
    case "high":   return 0.3;
    case "medium": return 0.1;
    default:       return 0;
  }
}

/**
 * Term-match score primitive (grep-first):
 *   exact name match  → +5
 *   name contains     → +3
 *   haystack (name + id + source_refs) contains → +1
 *
 * Pure term scoring with NO importance/confidence applied — the shared building
 * block used by both kg-query's full scoreNode and recall.ts's KG branch (which
 * intentionally ranks on term match alone).
 */
export function termMatchScore(node: GraphNode, terms: string[]): number {
  const hay = `${node.name} ${node.id} ${(node.source_refs ?? []).join(" ")}`.toLowerCase();
  let termScore = 0;
  for (const t of terms) {
    if (!t) continue;
    if (node.name.toLowerCase() === t)            termScore += 5;
    else if (node.name.toLowerCase().includes(t)) termScore += 3;
    else if (hay.includes(t))                      termScore += 1;
  }
  return termScore;
}

/**
 * Score a node against a set of query terms, incorporating importance and
 * confidence into the final score.
 *
 * If terms is empty, all nodes return a base score of 1 (ranked by
 * importance + confidence only).
 *
 * If no term matches, returns 0 regardless of importance (importance
 * cannot surface a node with no semantic relevance).
 *
 * Final: termScore * (1 + importanceMultiplier) + confidenceBonus
 */
export function scoreNode(node: GraphNode, terms: string[]): number {
  if (terms.length === 0) {
    // No-terms mode: base score 1 × (1 + importance) + confidence.
    return 1 * (1 + importanceMultiplier(node)) + confidenceBonus(node);
  }

  const termScore = termMatchScore(node, terms);

  if (termScore === 0) return 0; // no term match — importance cannot rescue

  const imp  = importanceMultiplier(node);
  const conf = confidenceBonus(node);
  return termScore * (1 + imp) + conf;
}

/**
 * Build a topic-proximity bonus map: { nodeId → bonus }.
 *
 * For each matched topic node (s > 0 AND type === "topic"), follow its
 * outbound `subtopic_of` edge(s) to find its parent topic(s). Each parent
 * receives a bonus = child.score × PROXIMITY_WEIGHT.
 *
 * When multiple children point to the same parent, the parent receives the
 * MAX bonus (not the sum — prevents noisy over-accumulation).
 *
 * Rules:
 *   - Only TYPE === "topic" SOURCE nodes generate proximity (not file/function/etc).
 *   - Only MATCHED SOURCE nodes (s > 0) generate proximity.
 *   - Only TYPE === "topic" TARGET nodes receive proximity. A malformed or
 *     cross-type subtopic_of edge pointing to a file/function/etc. node must
 *     not cause non-topic nodes to receive topic-proximity scoring.
 *     Guard: if the target node is known (present in scored or allNodes) and
 *     its type is not "topic", the bonus is suppressed. Unknown targets (not
 *     present in any supplied set) are allowed through (benefit of the doubt).
 *   - Bonuses are only useful for nodes that also appear in the calling
 *     context's scored set — a bonus for a zero-score node is a no-op.
 *
 * @param allNodes - optional full node list from the graph, used to look up
 *   target node types. When omitted the lookup falls back to the scored set.
 *
 * PROXIMITY_WEIGHT = 0.1 (small — proximity is a tie-breaker, not a primary
 * signal; it narrows the ranking within an already-relevant set).
 */
export const PROXIMITY_WEIGHT = 0.1;

/**
 * Rank KnowledgeGraph nodes for recall — the SINGLE canonical ranking pipeline
 * shared by BOTH `kg-query.ts` (the CLI) and `recall.ts`'s KG branch (the
 * context bundle), so an agent gets IDENTICAL KG recall ordering through either
 * surface (G15 — closes the bundle-vs-CLI scoring drift documented in
 * goals.md §2.2).
 *
 * Before G15 the bundle KG branch ranked on flat `termMatchScore` + id tiebreak
 * while the CLI used the full `scoreNode` (importance + confidence) plus
 * topic-proximity — so the bundle silently gave WORSE KG recall. This function
 * is the one ranking both now call.
 *
 * Pipeline (byte-identical to the former kg-query.ts inline steps 1–3):
 *   1. score every candidate with `scoreNode` (importance + confidence baked
 *      in), drop zero-score nodes;
 *   2. build topic-proximity bonuses over `subtopic_of` edges (SC-13);
 *   3. add the proximity bonus, sort by score desc then id asc, cap at `limit`.
 *
 * Determinism (SC-9): pure arithmetic; no LLM calls; stable id tiebreak.
 *
 * @param candidates  nodes to score (caller MAY pre-filter by type, e.g. the
 *                    CLI's `--type`; recall passes the whole projection).
 * @param edges       graph edges (used for `subtopic_of` proximity). `[]` is fine.
 * @param terms       lowercased query terms.
 * @param limit       max ranked results.
 * @param allNodes    full node set for the proximity target-type guard;
 *                    defaults to `candidates` (correct when no pre-filtering).
 */
export function rankKgNodes(
  candidates: GraphNode[],
  edges: GraphEdge[],
  terms: string[],
  limit: number,
  allNodes: GraphNode[] = candidates,
): Array<{ n: GraphNode; s: number }> {
  // Step 1: score all candidates (importance + confidence baked in), drop zeros.
  const candidateScored = candidates
    .map((n) => ({ n, s: scoreNode(n, terms) }))
    .filter((x) => x.s > 0);

  // Step 2: topic-proximity bonuses (subtopic_of traversal). Pass allNodes so the
  // target-side type guard can identify non-topic targets absent from the scored set.
  const proximityBonuses = buildProximityBonuses(candidateScored, edges, allNodes);

  // Step 3: apply proximity bonus, final sort (score desc, id asc), cap.
  return candidateScored
    .map((x) => ({ n: x.n, s: x.s + (proximityBonuses.get(x.n.id) ?? 0) }))
    .sort((a, b) => b.s - a.s || a.n.id.localeCompare(b.n.id))
    .slice(0, limit);
}

export function buildProximityBonuses(
  scored: Array<{ n: GraphNode; s: number }>,
  edges: GraphEdge[],
  allNodes: GraphNode[] = [],
): Map<string, number> {
  const bonuses = new Map<string, number>();

  // Only topic nodes with s > 0 generate proximity
  const matchedTopics = scored.filter((x) => x.s > 0 && x.n.type === "topic");
  if (matchedTopics.length === 0) return bonuses;

  // Build a lookup to enforce the target-side type guard.
  // allNodes (from graph.nodes) takes precedence; scored fills in anything missing.
  // If a target id is not found in either set, we allow the bonus (unknown = permitted).
  const nodeById = new Map<string, GraphNode>([
    ...scored.map((x): [string, GraphNode] => [x.n.id, x.n]),
    ...allNodes.map((n): [string, GraphNode] => [n.id, n]),
  ]);

  for (const { n: node, s } of matchedTopics) {
    for (const e of edges) {
      if (e.type !== "subtopic_of" || e.source !== node.id) continue;
      const parentId = e.target as string;
      // Target-side guard: if the parent is a known non-topic node, suppress bonus.
      const parentNode = nodeById.get(parentId);
      if (parentNode !== undefined && parentNode.type !== "topic") continue;
      const bonus = s * PROXIMITY_WEIGHT;
      const current = bonuses.get(parentId) ?? 0;
      // MAX bonus per parent — prevent noisy accumulation from many children
      bonuses.set(parentId, Math.max(current, bonus));
    }
  }

  return bonuses;
}
