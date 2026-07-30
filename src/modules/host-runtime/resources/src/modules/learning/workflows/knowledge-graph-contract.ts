/**
 * src/modules/learning/workflows/knowledge-graph-contract.ts
 *
 * Shared type contract for Guild knowledge graph nodes and edges. The large
 * learn/lib/schema.ts validator remains the runtime schema surface for now.
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

export const NODE_CATEGORIES = new Set([
  "function", "class", "module", "config", "endpoint", "pipeline", "schema",
  "concept", "fact", "claim", "principle", "definition", "example",
  "guide", "tutorial", "reference", "overview", "changelog", "architecture",
  "decision", "standard", "recipe", "checklist",
  "component", "domain", "diagram", "index", "note",
]);
