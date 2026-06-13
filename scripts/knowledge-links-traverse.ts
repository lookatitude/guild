#!/usr/bin/env -S npx tsx
/**
 * knowledge-links-traverse.ts — VC-K2 connectivity runtime helper.
 *
 * Contract (cite, do not re-spell beyond the code):
 *   - Closed edge-type set + the work↔knowledge↔behavior model:
 *     decisions/continuous-knowledge-and-learning-loop.md §"CR-A #2".
 *   - VC-K2 (connectivity): §180-183 — for any completed-run task-id, one
 *     knowledge-links.json traversal reaches the 4 node kinds:
 *       (1) constraining decisions, (2) running skill/agent,
 *       (3) touched feature/component, (4) describing wiki pages.
 *   - Stage-5 engine `touches` batch: codebase-understanding.md §"5 Domain".
 *
 * The full `knowledge-links.json` is built APPEND-ONLY from two sources: the
 * stage-5 brownfield engine (understand/derive-domain.ts → domain↔file
 * `touches`) and the per-phase LearningCheckpoint `knowledge_links_batch`
 * (task↔decision/skill/component, component↔wiki). This module loads that
 * union, appends a checkpoint batch (append-only, dedupe by from|to|type,
 * mirroring lib/domain.appendKnowledgeLinks), classifies node kinds, and
 * BFS-traverses from a task-id to compute reachable kinds.
 *
 * Zero runtime deps (Node builtins only).
 */

import * as fs from "fs";
import * as path from "path";

/** Closed edge-type set — continuous-knowledge-and-learning-loop.md §"CR-A #2". */
export const CLOSED_EDGE_TYPES: ReadonlySet<string> = new Set([
  "decided_by",
  "used_for",
  "produced",
  "touches",
  "supersedes",
  "learned_from",
  "constrains",
  "opens_question",
  "resolves",
]);

/** The 4 node kinds a completed-run task-id must reach (VC-K2 §180-183). */
export type NodeKind = "decision" | "skill_agent" | "feature_component" | "wiki" | "other";

/** The 4 connectivity kinds VC-K2 requires reachable from a task-id. */
export const REQUIRED_KINDS: readonly NodeKind[] = [
  "decision",
  "skill_agent",
  "feature_component",
  "wiki",
];

export interface KnowledgeLink {
  from: string;
  to: string;
  type: string;
  run_id: string;
  /**
   * Tombstone-never-delete (docs/v2/05 §Invalidation, item 8). A superseded
   * decision or deleted artifact MARKS its edge tombstoned instead of removing
   * it — active recall skips it (see activeLinks), but the history is preserved.
   */
  tombstoned?: boolean;
  /** ISO-8601 stamp passed by the caller when the edge was tombstoned. */
  tombstoned_at?: string;
  /** Why it was tombstoned (e.g. "superseded by decision:x", "artifact deleted"). */
  tombstoned_reason?: string;
}
export interface KnowledgeLinksDoc {
  version: string;
  links: KnowledgeLink[];
}

/** Classify a node id → kind by its canonical id prefix. */
export function classifyNodeKind(id: string): NodeKind {
  if (id.startsWith("decision:")) return "decision";
  if (id.startsWith("skill:") || id.startsWith("agent:")) return "skill_agent";
  if (id.startsWith("feature:") || id.startsWith("component:")) return "feature_component";
  if (id.startsWith("wiki:")) return "wiki";
  return "other";
}

/** Load knowledge-links.json; returns an empty v1 doc if absent/corrupt. */
export function loadKnowledgeLinks(file: string): KnowledgeLinksDoc {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && Array.isArray(parsed.links)) {
      return { version: String(parsed.version ?? "guild.knowledge_links.v1"), links: parsed.links };
    }
  } catch {
    /* absent or corrupt → empty (derived index, safe) */
  }
  return { version: "guild.knowledge_links.v1", links: [] };
}

/**
 * APPEND-ONLY batch write into knowledge-links.json. Dedupes on from|to|type
 * so re-runs are idempotent (mirrors lib/domain.appendKnowledgeLinks).
 */
export function appendBatch(file: string, batch: KnowledgeLink[]): { added: number; total: number } {
  const doc = loadKnowledgeLinks(file);
  const existing = new Set(doc.links.map((l) => `${l.from}|${l.to}|${l.type}`));
  let added = 0;
  for (const link of batch) {
    const k = `${link.from}|${link.to}|${link.type}`;
    if (!existing.has(k)) {
      existing.add(k);
      doc.links.push(link);
      added++;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
  return { added, total: doc.links.length };
}

/** Active (non-tombstoned) links — what every recall/traversal path should use. */
export function activeLinks(doc: KnowledgeLinksDoc): KnowledgeLink[] {
  return doc.links.filter((l) => !l.tombstoned);
}

/**
 * Tombstone-never-delete (item 8). Marks every link matching `match`
 * (from/to/type — any subset) as tombstoned IN PLACE — it is never removed, so
 * the edge history survives and re-runs stay idempotent (a second tombstone is a
 * no-op). Returns how many links were newly tombstoned. Used when a decision is
 * superseded or an artifact is deleted, instead of pruning the edge.
 */
export function tombstoneLinks(
  file: string,
  match: { from?: string; to?: string; type?: string },
  reason: string,
  tombstonedAt: string,
): { tombstoned: number } {
  const doc = loadKnowledgeLinks(file);
  let n = 0;
  for (const l of doc.links) {
    if (l.tombstoned) continue;
    if (match.from !== undefined && l.from !== match.from) continue;
    if (match.to !== undefined && l.to !== match.to) continue;
    if (match.type !== undefined && l.type !== match.type) continue;
    l.tombstoned = true;
    l.tombstoned_at = tombstonedAt;
    l.tombstoned_reason = reason;
    n++;
  }
  if (n > 0) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + "\n", "utf8");
  }
  return { tombstoned: n };
}

/** True iff every link type is a member of the closed edge-type set. */
export function allEdgesClosed(doc: KnowledgeLinksDoc): boolean {
  return doc.links.every((l) => CLOSED_EDGE_TYPES.has(l.type));
}

/** Any link type NOT in the closed set (for diagnostics / assertions). */
export function nonClosedEdgeTypes(doc: KnowledgeLinksDoc): string[] {
  return [...new Set(doc.links.filter((l) => !CLOSED_EDGE_TYPES.has(l.type)).map((l) => l.type))];
}

/**
 * BFS over the link graph as an UNDIRECTED adjacency (from↔to), starting at
 * `start`. Returns the set of node kinds reachable (excluding the start node
 * itself and "other"). One traversal answers the VC-K2 connectivity question.
 */
export function reachableKinds(doc: KnowledgeLinksDoc, start: string): Set<NodeKind> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  // Active recall skips tombstoned edges (item 8) — a superseded/deleted edge
  // no longer keeps its endpoints connected, but stays in the file as history.
  for (const l of activeLinks(doc)) {
    link(l.from, l.to);
    link(l.to, l.from);
  }

  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  const kinds = new Set<NodeKind>();
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const k = classifyNodeKind(next);
      if (k !== "other") kinds.add(k);
      queue.push(next);
    }
  }
  return kinds;
}

/** True iff all 4 VC-K2 node kinds are reachable from the task-id. */
export function isFullyConnected(doc: KnowledgeLinksDoc, taskId: string): boolean {
  const kinds = reachableKinds(doc, taskId);
  return REQUIRED_KINDS.every((k) => kinds.has(k));
}
