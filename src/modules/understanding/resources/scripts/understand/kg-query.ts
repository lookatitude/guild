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
import type { GraphNode } from "./lib/schema";
import type { KnowledgeLinksDoc } from "./write-knowledge-links";

const MAX_LIMIT = 50;

// ---------------------------------------------------------------------------
// Exported scoring helpers (SC-13 / L11)
//
// Re-arch WAVE 1: the scorers were moved to the canonical single-source module
// scripts/lib/shared/graph-scoring.ts (recall.ts shares the same primitives).
// Re-exported here so kg-query.ts's historical export surface (consumed by
// scripts/__tests__/kg-query-ranking.test.ts) is unchanged.
// ---------------------------------------------------------------------------

export {
  importanceMultiplier,
  confidenceBonus,
  scoreNode,
  buildProximityBonuses,
  rankKgNodes,
} from "../lib/shared/graph-scoring";
import { rankKgNodes } from "../lib/shared/graph-scoring";
import type { GraphEdge } from "./lib/schema";

// ---------------------------------------------------------------------------
// Main CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  // METRIC 6 (DECISION=B): read the recall-optimised projection instead of the raw graph.
  // Graceful-empty: if knowledge-recall.json is absent or malformed, return an empty
  // successful result (exit 0) — consistent with recall.ts's absent-projection branch.
  const graph = readJson<KnowledgeLinksDoc>(gp.knowledgeRecall);
  if (!graph) {
    const neighborOf = parseFlag(argv, "neighbors");
    const json = hasFlag(argv, "json");
    if (json) {
      process.stdout.write(
        JSON.stringify({ count: 0, capped: false, results: [] }, null, 2) + "\n",
      );
    } else if (neighborOf) {
      process.stdout.write("");
    } else {
      process.stdout.write("(no matches)\n");
    }
    return;
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

  // CanonicalNode is structurally compatible with GraphNode for scoring purposes;
  // cast via unknown so the scorers (which expect GraphNode) accept the projection nodes.
  let candidates = graph.nodes as unknown as GraphNode[];
  if (typeSet.size) candidates = candidates.filter((n) => typeSet.has(n.type));

  // Score → topic-proximity → sort → cap, via the SINGLE shared ranking pipeline
  // (rankKgNodes) that recall.ts's KG branch also calls — so the bundle ranking
  // and this CLI ranking are identical (G15). `candidates` is the (optionally
  // type-filtered) set; the full graph.nodes is passed as the proximity guard set.
  const ranked = rankKgNodes(
    candidates,
    (graph.edges ?? []) as unknown as GraphEdge[],
    terms,
    limit,
    (graph.nodes as unknown as GraphNode[]) ?? [],
  );

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
