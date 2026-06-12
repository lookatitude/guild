#!/usr/bin/env -S npx tsx
/**
 * understand/kg-query.ts — grep-first, bounded KnowledgeGraph query helper.
 *
 * Context-economy protocol (codebase-understanding.md §"Relationship to the
 * wiki", research/23 §5): NEVER dump the whole graph. Deterministic token
 * scoring (no fuse.js). Hard output cap so a caller can splice results into a
 * budgeted context layer (graph sub-cap 1200 tokens upstream).
 *
 * L11 additions (SC-13 — recall ranking):
 *   Scoring extended with `importance` + `confidence` + topic proximity.
 *   - importanceMultiplier: numeric importance_score (0–1) or string importance
 *     (high→0.8, medium→0.4, low→0.1); importance_score takes precedence.
 *   - confidenceBonus: additive (high→+0.3, medium→+0.1, low/undef→+0).
 *   - Topic proximity: when a matched topic is a subtopic_of a parent, that
 *     parent gets a small bonus proportional to the child's score. Only
 *     topic-type matched nodes generate proximity; only already-matched nodes
 *     receive a proximity boost (zero-score nodes are never surfaced by
 *     proximity alone).
 *   Final score = termScore * (1 + importanceMultiplier) + confidenceBonus
 *                 + proximityBonus.
 *   Token budget unchanged: MAX_LIMIT = 50, --limit cap preserved.
 *
 * Determinism responsibility table (SC-9, all fields deterministic-script):
 * | Output field              | Owner                |
 * | term match score          | deterministic-script |
 * | importance multiplier     | deterministic-script |
 * | confidence bonus          | deterministic-script |
 * | topic proximity bonus     | deterministic-script |
 * | final sort / output order | deterministic-script |
 * No LLM calls in this module.
 *
 * Usage:
 *   npx tsx kg-query.ts [--cwd <path>] --q "<terms>" [--type file,function]
 *                       [--limit N] [--neighbors <node-id>] [--json]
 * Exit: 0 ok · 1 no graph.
 */

import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag, readJson } from "./lib/paths";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "./lib/schema";

const MAX_LIMIT = 50;

// ---------------------------------------------------------------------------
// Exported scoring helpers (SC-13 / L11)
// ---------------------------------------------------------------------------

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
 * Score a node against a set of query terms, incorporating importance and
 * confidence into the final score.
 *
 * Term scoring (unchanged):
 *   exact name match  → +5
 *   name contains     → +3
 *   haystack (name + id + source_refs) contains → +1
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
    // Intentional L11 change from v1 flat-score-1 behavior: when no query terms
    // are supplied, nodes are ranked by importance/confidence so callers receive
    // the most significant results first rather than an arbitrary set.
    // context-assemble always supplies --q, so this path is not on the hot road.
    return 1 * (1 + importanceMultiplier(node)) + confidenceBonus(node);
  }

  const hay = `${node.name} ${node.id} ${(node.source_refs ?? []).join(" ")}`.toLowerCase();
  let termScore = 0;
  for (const t of terms) {
    if (!t) continue;
    if (node.name.toLowerCase() === t)            termScore += 5;
    else if (node.name.toLowerCase().includes(t)) termScore += 3;
    else if (hay.includes(t))                      termScore += 1;
  }

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
 *   main() passes graph.nodes; unit tests omit it when the parent is absent.
 *
 * PROXIMITY_WEIGHT = 0.1 (small — proximity is a tie-breaker, not a primary
 * signal; it narrows the ranking within an already-relevant set).
 */
const PROXIMITY_WEIGHT = 0.1;

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

// ---------------------------------------------------------------------------
// Main CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const graph = readJson<KnowledgeGraph>(gp.knowledgeGraph);
  if (!graph) {
    process.stderr.write("[kg-query] ERROR: knowledge-graph.json not found\n");
    process.exit(1);
  }

  const neighborOf = parseFlag(argv, "neighbors");
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(parseFlag(argv, "limit") ?? "20", 10) || 20));
  const json = hasFlag(argv, "json");

  if (neighborOf) {
    const out = graph.edges
      .filter((e) => e.source === neighborOf || e.target === neighborOf)
      .slice(0, limit)
      .map((e) => ({ ...e }));
    process.stdout.write(
      json ? JSON.stringify(out, null, 2) + "\n"
           : out.map((e) => `${e.source} -[${e.type}/${e.direction}]-> ${e.target}`).join("\n") + "\n",
    );
    return;
  }

  const q = (parseFlag(argv, "q") ?? "").toLowerCase().trim();
  const terms = q.split(/\s+/).filter(Boolean);
  const typeFilter = (parseFlag(argv, "type") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const typeSet = new Set(typeFilter);

  let candidates = graph.nodes;
  if (typeSet.size) candidates = candidates.filter((n) => typeSet.has(n.type));

  // Step 1: score all candidates (importance + confidence baked in)
  const candidateScored = candidates
    .map((n) => ({ n, s: scoreNode(n, terms) }))
    .filter((x) => x.s > 0);

  // Step 2: build topic-proximity bonuses from graph edges (SC-13).
  // Pass graph.nodes so the target-side type guard can identify non-topic targets
  // even when those targets have score=0 and are absent from candidateScored.
  const proximityBonuses = buildProximityBonuses(candidateScored, graph.edges ?? [], graph.nodes ?? []);

  // Step 3: apply proximity bonuses and final sort
  const ranked = candidateScored
    .map((x) => ({
      n: x.n,
      s: x.s + (proximityBonuses.get(x.n.id) ?? 0),
    }))
    .sort((a, b) => b.s - a.s || a.n.id.localeCompare(b.n.id))
    .slice(0, limit);

  if (json) {
    const results = ranked.map((x) => {
      const base: Record<string, unknown> = {
        id: x.n.id,
        type: x.n.type,
        name: x.n.name,
        confidence: x.n.confidence,
        source_refs: (x.n.source_refs ?? []).slice(0, 2),
      };
      // Include importance fields when present (consumers like context-assemble
      // can use them for display without re-fetching the full graph).
      const ext = x.n as GraphNode & { importance?: unknown; importance_score?: unknown };
      if (ext.importance !== undefined) base.importance = ext.importance;
      if (typeof ext.importance_score === "number") base.importance_score = ext.importance_score;
      return base;
    });
    process.stdout.write(
      JSON.stringify(
        { count: ranked.length, capped: candidates.length > limit, results },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(
      ranked
        .map((x) => `${x.n.type}\t${x.n.id}\t${x.n.confidence}\t${(x.n.source_refs ?? [])[0] ?? ""}`)
        .join("\n") + (ranked.length ? "\n" : "(no matches)\n"),
    );
  }
}

// Guard: only run as CLI when executed directly (not when imported by tests).
if (require.main === module) {
  main();
}
