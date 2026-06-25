/**
 * understand/lib/tour.ts — stage 6 SCRIPT phase (dependency-BFS ordering).
 *
 * Produces a deterministic 5–15 step tour skeleton ordered by dependency BFS
 * from entrypoint files (fewest incoming `imports` edges = roots). The LLM
 * phase (#24) writes narration; the script fixes the pedagogical order.
 */

import type { KnowledgeGraph, TourStep } from "./schema";

export function buildTourOrder(graph: KnowledgeGraph): TourStep[] {
  const fileNodes = graph.nodes.filter((n) => n.type === "file");
  if (fileNodes.length === 0) return [];

  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const f of fileNodes) {
    inDeg.set(f.id, 0);
    adj.set(f.id, []);
  }
  for (const e of graph.edges) {
    if (e.type !== "imports") continue;
    if (!inDeg.has(e.source) || !inDeg.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }

  // Roots: lowest in-degree first, then by id for determinism.
  const queue = [...fileNodes]
    .sort((a, b) => (inDeg.get(a.id)! - inDeg.get(b.id)!) || a.id.localeCompare(b.id))
    .map((n) => n.id);

  const visited = new Set<string>();
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const next of (adj.get(id) ?? []).sort()) {
      if (!visited.has(next)) queue.push(next);
    }
  }

  // Bucket into 5–15 steps, ~1–5 node ids per step.
  const target = Math.max(5, Math.min(15, Math.ceil(order.length / 5)));
  const perStep = Math.max(1, Math.min(5, Math.ceil(order.length / target)));
  const steps: TourStep[] = [];
  for (let i = 0, o = 0; i < order.length; i += perStep, o++) {
    const slice = order.slice(i, i + perStep);
    steps.push({
      order: o,
      title: `Step ${o + 1}`,
      description: "",
      nodeIds: slice,
    });
    if (steps.length >= 15) break;
  }
  return steps;
}
