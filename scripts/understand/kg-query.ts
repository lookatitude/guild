#!/usr/bin/env -S npx tsx
/**
 * understand/kg-query.ts — grep-first, bounded KnowledgeGraph query helper.
 *
 * Context-economy protocol (codebase-understanding.md §"Relationship to the
 * wiki", research/23 §5): NEVER dump the whole graph. Deterministic token
 * scoring (no fuse.js). Hard output cap so a caller can splice results into a
 * budgeted context layer (graph sub-cap 1200 tokens upstream).
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

function score(node: GraphNode, terms: string[]): number {
  const hay = `${node.name} ${node.id} ${(node.source_refs ?? []).join(" ")}`.toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (!t) continue;
    if (node.name.toLowerCase() === t) s += 5;
    else if (node.name.toLowerCase().includes(t)) s += 3;
    else if (hay.includes(t)) s += 1;
  }
  return s;
}

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

  const ranked = candidates
    .map((n) => ({ n, s: terms.length ? score(n, terms) : 1 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.n.id.localeCompare(b.n.id))
    .slice(0, limit)
    .map((x) => ({
      id: x.n.id,
      type: x.n.type,
      name: x.n.name,
      confidence: x.n.confidence,
      source_refs: (x.n.source_refs ?? []).slice(0, 2),
    }));

  if (json) {
    process.stdout.write(JSON.stringify({ count: ranked.length, capped: candidates.length > limit, results: ranked }, null, 2) + "\n");
  } else {
    process.stdout.write(
      ranked.map((r) => `${r.type}\t${r.id}\t${r.confidence}\t${r.source_refs[0] ?? ""}`).join("\n") +
      (ranked.length ? "\n" : "(no matches)\n"),
    );
  }
}

main();
