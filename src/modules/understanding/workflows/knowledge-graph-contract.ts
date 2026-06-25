/**
 * src/modules/understanding/workflows/knowledge-graph-contract.ts
 *
 * Shared type contract for Guild knowledge graph nodes and edges. The large
 * understand/lib/schema.ts validator remains the runtime schema surface for now.
 */

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  source_refs: string[];
  confidence: "high" | "medium" | "low";
  category?: string;
  importance?: string;
  importance_score?: number;
  topic_path?: string[];
  labels?: string[];
  [k: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  direction: "out" | "in" | "bi";
  weight: number;
  description?: string;
  [k: string]: unknown;
}
