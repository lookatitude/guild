/**
 * learn/lib/graph.ts
 *
 * Deterministic partial-graph builder + merge (stage 2 SCRIPT phase).
 * Emits the ground-truth structural nodes/edges the LLM phase (task #24)
 * then types semantically. Node ID convention is the LOCKED invariant:
 *   <type>:<relpath>[:<name>]   (codebase-understanding.md §"KnowledgeGraph")
 *
 * Deterministic structural facts carry confidence "high" with a
 * `path#Lx-Ly` source_ref (Evidence-over-claims).
 */

import { analyzeSource } from "./extract";
import { buildImportMap } from "./import-map";
import { detectLanguage, isCodeLanguage } from "./languages";
import type { GraphEdge, GraphNode } from "./schema";

export interface PartialGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function ref(rel: string, range?: [number, number]): string[] {
  return range ? [`${rel}#L${range[0]}-L${range[1]}`] : [`${rel}`];
}

/**
 * Build the deterministic partial graph for repo-relative code files.
 * `readFile` is injected for testability.
 */
export function buildPartialGraph(
  repoRoot: string,
  relFiles: string[],
  readFile: (abs: string) => string,
): PartialGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();

  const addNode = (n: GraphNode) => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };
  const addEdge = (e: GraphEdge) => {
    const k = `${e.type}|${e.source}|${e.target}`;
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k);
    edges.push(e);
  };

  for (const rel of relFiles) {
    const lang = detectLanguage(rel);
    const fileId = `file:${rel}`;
    addNode({
      id: fileId,
      type: "file",
      name: rel.split("/").pop() ?? rel,
      source_refs: ref(rel),
      confidence: "high",
      language: lang,
    });
    if (!isCodeLanguage(lang)) continue;

    let content: string;
    try {
      content = readFile(`${repoRoot}/${rel}`);
    } catch {
      continue;
    }
    const a = analyzeSource(rel, content);
    if (!a) continue;

    for (const fn of a.functions) {
      const id = `function:${rel}:${fn.name}`;
      addNode({
        id,
        type: "function",
        name: fn.name,
        source_refs: ref(rel, fn.lineRange),
        confidence: "high",
      });
      addEdge({ source: fileId, target: id, type: "contains", direction: "out", weight: 1 });
    }
    for (const cls of a.classes) {
      const id = `class:${rel}:${cls.name}`;
      addNode({
        id,
        type: "class",
        name: cls.name,
        source_refs: ref(rel, cls.lineRange),
        confidence: "high",
      });
      addEdge({ source: fileId, target: id, type: "contains", direction: "out", weight: 1 });
    }
  }

  // Import edges from the deterministic import map (ground truth).
  for (const ie of buildImportMap(repoRoot, relFiles, readFile)) {
    const s = `file:${ie.from}`;
    const t = `file:${ie.to}`;
    if (nodeIds.has(s) && nodeIds.has(t)) {
      addEdge({
        source: s,
        target: t,
        type: "imports",
        direction: "out",
        weight: 0.7,
        description: ie.kind === "alias" ? "alias import" : undefined,
      });
    }
  }

  return { nodes, edges };
}

/**
 * Deterministic merge: union two partial graphs, dedupe nodes by id
 * (first wins) and edges by `type|source|target`. Used for batch fan-out
 * re-assembly and incremental PARTIAL updates.
 */
export function mergeGraphs(...parts: PartialGraph[]): PartialGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nIds = new Set<string>();
  const eKeys = new Set<string>();
  for (const p of parts) {
    for (const n of p.nodes) if (!nIds.has(n.id)) (nIds.add(n.id), nodes.push(n));
    for (const e of p.edges) {
      const k = `${e.type}|${e.source}|${e.target}`;
      if (!eKeys.has(k)) (eKeys.add(k), edges.push(e));
    }
  }
  return { nodes, edges };
}

/**
 * Stage-3 assemble-review SCRIPT half: produce the merge report a challenger
 * (G-init) needs — dropped node ids, dangling edges (endpoint missing from
 * node set). The LLM half recovers; the script just surfaces the deltas.
 */
export function mergeReport(g: PartialGraph): {
  danglingEdges: GraphEdge[];
  orphanNodes: string[];
} {
  const ids = new Set(g.nodes.map((n) => n.id));
  const danglingEdges = g.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
  const referenced = new Set<string>();
  for (const e of g.edges) {
    referenced.add(e.source);
    referenced.add(e.target);
  }
  const orphanNodes = g.nodes
    .filter((n) => n.type !== "file" && !referenced.has(n.id))
    .map((n) => n.id);
  return { danglingEdges, orphanNodes };
}
