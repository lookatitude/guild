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
import type { KnowledgeGraph, GraphNode } from "./lib/schema";

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
} from "../lib/shared/graph-scoring";
import { scoreNode, buildProximityBonuses } from "../lib/shared/graph-scoring";

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
