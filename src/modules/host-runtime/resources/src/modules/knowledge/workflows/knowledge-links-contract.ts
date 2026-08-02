/**
 * src/modules/knowledge/workflows/knowledge-links-contract.ts
 *
 * Canonical type contract for the knowledge tier's two derived projections.
 * This module owns BOTH schema versions so the naming is unambiguous:
 *
 *   - KNOWLEDGE_RECALL_SCHEMA_VERSION ("guild.knowledge_links.v2") — the
 *     nonce-free recall projection written to `.guild/indexes/knowledge-recall.json`
 *     (a pure function of (graph, config); see write-knowledge-links.ts). This is
 *     what `KnowledgeLinksDoc` below describes.
 *   - KNOWLEDGE_LINKS_EDGE_SCHEMA_VERSION ("guild.knowledge_links.v1") — the v1
 *     edge layer written to `.guild/indexes/knowledge-links.json` by
 *     knowledge-links-builder.ts (which carries its own `KnowledgeLinkDoc` shape).
 *
 * The two are distinct on-disk artifacts; the constant was historically misnamed
 * `KNOWLEDGE_LINKS_SCHEMA_VERSION` even though it pins the v2 recall projection.
 */

export const KNOWLEDGE_RECALL_SCHEMA_VERSION = "guild.knowledge_links.v2" as const;
/** v1 edge-layer (`knowledge-links.json`) schema version, written by knowledge-links-builder.ts. */
export const KNOWLEDGE_LINKS_EDGE_SCHEMA_VERSION = "guild.knowledge_links.v1" as const;
export const KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION = "guild.knowledge_links.provenance.v1" as const;

export interface KnowledgeLinksDoc {
  schema_version: typeof KNOWLEDGE_RECALL_SCHEMA_VERSION;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
}

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
