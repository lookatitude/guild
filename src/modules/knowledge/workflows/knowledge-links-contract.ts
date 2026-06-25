/**
 * src/modules/knowledge/workflows/knowledge-links-contract.ts
 *
 * Canonical type contract for the nonce-free knowledge recall projection.
 */

export const KNOWLEDGE_LINKS_SCHEMA_VERSION = "guild.knowledge_links.v2" as const;
export const KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION = "guild.knowledge_links.provenance.v1" as const;

export interface KnowledgeLinksDoc {
  schema_version: typeof KNOWLEDGE_LINKS_SCHEMA_VERSION;
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
