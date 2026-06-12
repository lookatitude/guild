/**
 * understand/write-knowledge-links.ts
 *
 * K6 nonce-free projection writer (SC-8).
 *
 * Writes `.guild/indexes/knowledge-recall.json` — a byte-stable recall projection
 * that is a PURE function of (graph, config). No run_id, no timestamp, no
 * wall-clock in the compared artifact.
 *
 * SC-8 byte-set (must be identical across /guild:learn knowledge, full
 * /guild:learn, and init --learn):
 *   • knowledge-graph.json  (v2, written by K1-K5 stages)
 *   • knowledge-recall.json  (v2, written by this module)
 *
 * run_id / provenance → separate sidecar `knowledge-recall-provenance.json`.
 * SC-8 excludes the sidecar from byte-identity checks.
 *
 * H1 key constraint: FIXED per-type key order on every node/edge object
 * (canonicalizer pass). JSON.stringify preserves insertion order, so we rebuild
 * each object with keys in the declared canonical order before serialising.
 *
 * Convention (L0): JSON.stringify(data, null, 2) + "\n"
 *
 * Determinism responsibility table (SC-9):
 * | Output field            | Owner                |
 * | node order in output    | deterministic-script |
 * | edge order in output    | deterministic-script |
 * | canonical key order     | deterministic-script |
 * | source_refs sort        | deterministic-script |
 * | dedup by (src,tgt,type) | deterministic-script |
 * No LLM calls in this module.
 *
 * Usage (called by K6 skill entrypoint — see L6 handoff):
 *   import { writeKnowledgeLinks } from "./write-knowledge-links";
 *   const result = writeKnowledgeLinks({ graph, repoRoot, runId, generatedAt });
 */

import * as fs from "fs";
import * as path from "path";
import type { GraphNode, GraphEdge } from "./lib/schema";
import { importanceMultiplier, confidenceBonus } from "./kg-query";

// ---------------------------------------------------------------------------
// Schema version constants
// ---------------------------------------------------------------------------

export const KNOWLEDGE_LINKS_SCHEMA_VERSION = "guild.knowledge_links.v2" as const;
export const KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION = "guild.knowledge_links.provenance.v1" as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WriteKnowledgeLinksOptions {
  /** K1-K5 assembled graph — source of truth for the projection */
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  /** Absolute path to the repo root (.guild/indexes/ will be created here) */
  repoRoot: string;
  /**
   * Run ID — written to the provenance SIDECAR ONLY.
   * NEVER written to knowledge-recall.json (SC-8 nonce-free).
   */
  runId?: string;
  /**
   * ISO 8601 timestamp — written to the provenance SIDECAR ONLY.
   * NEVER written to knowledge-recall.json (SC-8 nonce-free).
   */
  generatedAt?: string;
}

export interface WriteKnowledgeLinksResult {
  /** Absolute path to the nonce-free knowledge-recall.json */
  linksPath: string;
  /** Absolute path to the provenance sidecar */
  provenancePath: string;
  /** Number of nodes in the input graph */
  nodeCount: number;
  /** Number of unique edges written */
  edgeCount: number;
}

export interface KnowledgeLinksDoc {
  schema_version: typeof KNOWLEDGE_LINKS_SCHEMA_VERSION;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
}

// Canonical shapes (fixed key order enforced by canonicalizeNode/Edge)
export interface CanonicalNode {
  id: string;
  type: string;
  name: string;
  confidence: string;
  source_refs: string[];
  category?: string;
  importance_score?: number;
  importance?: string;
  topic_path?: string[];
  labels?: string[];
}

export interface CanonicalEdge {
  direction: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  description?: string;
}

// ---------------------------------------------------------------------------
// H1 — Canonicalizer: fixed per-type key order
// ---------------------------------------------------------------------------

/**
 * Build a node object with a fixed canonical key order.
 *
 * Required fields first (id, type, name, confidence, source_refs), then
 * optional fields in declaration order. Unknown / additive fields are excluded.
 * source_refs is sorted so the output is stable regardless of K-stage emission order.
 */
export function canonicalizeNode(node: GraphNode): CanonicalNode {
  const n = node as GraphNode & {
    category?: string;
    importance_score?: number;
    importance?: string;
    topic_path?: string[];
    labels?: string[];
  };

  // Required fields — always present in fixed order
  const result: Record<string, unknown> = {
    id: n.id,
    type: n.type,
    name: n.name,
    confidence: n.confidence,
    source_refs: [...(n.source_refs ?? [])].sort(),
  };

  // Optional fields — only included when defined (no undefined keys)
  if (n.category !== undefined) result["category"] = n.category;
  if (n.importance_score !== undefined) result["importance_score"] = n.importance_score;
  if (n.importance !== undefined) result["importance"] = n.importance;
  if (n.topic_path !== undefined) result["topic_path"] = n.topic_path;
  if (n.labels !== undefined) result["labels"] = n.labels;

  return result as unknown as CanonicalNode;
}

/**
 * Build an edge object with a fixed canonical key order.
 *
 * Required fields first (direction, source, target, type, weight), then
 * optional description. Unknown / additive fields are excluded.
 */
export function canonicalizeEdge(edge: GraphEdge): CanonicalEdge {
  const e = edge as GraphEdge & { description?: string };

  const result: Record<string, unknown> = {
    direction: e.direction,
    source: e.source,
    target: e.target,
    type: e.type,
    weight: e.weight,
  };

  if (e.description !== undefined) result["description"] = e.description;

  return result as unknown as CanonicalEdge;
}

// ---------------------------------------------------------------------------
// Recall ranking (L11 kg-query) — node sort order
// ---------------------------------------------------------------------------

/**
 * Sort nodes for the recall projection:
 *   1. importance_score descending (importanceMultiplier from kg-query)
 *   2. confidence bonus descending (confidenceBonus from kg-query)
 *   3. id ascending (stable tiebreaker)
 *
 * Does NOT mutate the input array.
 */
export function sortNodesByRecall(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => {
    const impA = importanceMultiplier(a);
    const impB = importanceMultiplier(b);
    if (impB !== impA) return impB - impA;

    const confA = confidenceBonus(a);
    const confB = confidenceBonus(b);
    if (confB !== confA) return confB - confA;

    return a.id.localeCompare(b.id);
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Write the nonce-free knowledge-recall.json recall projection and its
 * provenance sidecar.
 *
 * Idempotent: calling twice with the same graph + repoRoot overwrites the
 * previous output with byte-identical content.
 *
 * SC-8: knowledge-recall.json is a pure function of (graph, config).
 *   run_id / generatedAt go to the provenance sidecar ONLY.
 */
export function writeKnowledgeLinks(opts: WriteKnowledgeLinksOptions): WriteKnowledgeLinksResult {
  const { graph, repoRoot, runId, generatedAt } = opts;

  // ── Step 1: dedup edges by (source, target, type); first occurrence wins ──
  const seenEdgeKeys = new Set<string>();
  const dedupedEdges: GraphEdge[] = [];
  for (const edge of graph.edges) {
    const key = `${edge.source}→${edge.target}:${edge.type}`;
    if (!seenEdgeKeys.has(key)) {
      seenEdgeKeys.add(key);
      dedupedEdges.push(edge);
    }
  }

  // ── Step 2: sort nodes by recall score (importance desc → confidence desc → id asc) ──
  const sortedNodes = sortNodesByRecall(graph.nodes);

  // ── Step 3: sort edges by (source, target, type) for canonical ordering ──
  const sortedEdges = [...dedupedEdges].sort((a, b) =>
    a.source.localeCompare(b.source) ||
    a.target.localeCompare(b.target) ||
    a.type.localeCompare(b.type),
  );

  // ── Step 4: canonicalize (fixed key order per H1) ──
  const canonNodes = sortedNodes.map(canonicalizeNode);
  const canonEdges = sortedEdges.map(canonicalizeEdge);

  // ── Step 5: build nonce-free doc — NO run_id, NO timestamp ──
  const linksDoc: KnowledgeLinksDoc = {
    schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION,
    nodes: canonNodes,
    edges: canonEdges,
  };

  // ── Step 6: write to disk (L0 convention: JSON.stringify(.,null,2)+"\n") ──
  const indexesDir = path.join(repoRoot, ".guild", "indexes");
  fs.mkdirSync(indexesDir, { recursive: true });

  const linksPath = path.join(indexesDir, "knowledge-recall.json");
  fs.writeFileSync(linksPath, JSON.stringify(linksDoc, null, 2) + "\n", "utf8");

  // ── Step 7: write provenance sidecar (run_id + timestamps go HERE only) ──
  const provenanceDoc = {
    schema_version: KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION,
    run_id: runId ?? null,
    generated_at: generatedAt ?? null,
    node_count: graph.nodes.length,
    edge_count: dedupedEdges.length,
  };

  const provenancePath = path.join(indexesDir, "knowledge-recall-provenance.json");
  fs.writeFileSync(provenancePath, JSON.stringify(provenanceDoc, null, 2) + "\n", "utf8");

  return {
    linksPath,
    provenancePath,
    nodeCount: graph.nodes.length,
    edgeCount: dedupedEdges.length,
  };
}
