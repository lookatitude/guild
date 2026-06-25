#!/usr/bin/env -S npx tsx
/**
 * understand/extract-structural.ts — LANE G1 model-free structural extraction.
 *
 * A deterministic, ZERO-LLM, zero-network pass that walks source files and
 * emits the structural subset of guild.knowledge_graph.v1 — file/function/class
 * nodes + contains/imports/calls/inherits/implements edges, each carrying the
 * 25-feature AST structural profile (`sp`, goals.md §2.1) — merged into
 * .guild/indexes/knowledge-graph.json WITHOUT clobbering any existing LLM-tier
 * nodes (merge by deterministic id). Runs BEFORE any LLM stage so the LLM tier
 * consumes structure instead of re-deriving it.
 *
 * Determinism: the graph is a pure function of (source tree, file list). All
 * non-deterministic facts (wall-clock, generated_at) go to a sidecar
 * `<out>.meta.json`, never into the graph.
 *
 * Usage:
 *   npx tsx extract-structural.ts --cwd <root> [--out <path>] [--print]
 * Exit: 0 ok · 1 write/error.
 */

import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag, writeJson, readJson, SCHEMA } from "./lib/paths";
import { headSha } from "./lib/git";
import { walkRepo } from "./lib/walk";
import {
  extractStructuralGraph,
  mergeStructuralInto,
  structuralSubset,
} from "./lib/structural";
import { validateGraph } from "./lib/schema";
import type { GraphEdge, GraphNode } from "./lib/schema";
import * as fs from "fs";

interface ExistingGraph {
  version?: string;
  kind?: string;
  generated_from_commit?: string;
  project?: { name: string; description: string };
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  layers?: unknown[];
  tour?: unknown[];
  [k: string]: unknown;
}

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const repoRoot = gp.repoRoot;
  const outPath = parseFlag(argv, "out") ?? gp.knowledgeGraph;
  const started = Date.now();

  // File list: prefer the deterministic scan's inventory, else a fresh walk.
  const cm = readJson<{ files: { path: string }[] }>(gp.codebaseMap);
  const relFiles = cm?.files?.map((f) => f.path) ?? walkRepo(repoRoot).files;

  const structural = extractStructuralGraph(
    repoRoot,
    relFiles,
    (abs) => fs.readFileSync(abs, "utf8"),
  );

  // Merge into the existing graph (if any) without clobbering LLM-tier nodes.
  const existing = readJson<ExistingGraph>(outPath);
  const existingNodes = existing?.nodes ?? [];
  const existingEdges = existing?.edges ?? [];
  const merged = mergeStructuralInto(existingNodes, existingEdges, structural);

  const out: Record<string, unknown> = {
    version: existing?.version ?? SCHEMA.knowledgeGraph,
    kind: existing?.kind ?? "codebase",
    // FIX G1-4: commit/run metadata lives in the SIDECAR only. The graph artifact
    // is a pure function of (source, config) — never the HEAD sha — so two
    // identical trees at different commits produce byte-identical graphs.
    generated_from_commit: existing?.generated_from_commit ?? "structural",
    project: existing?.project ?? { name: path.basename(repoRoot), description: "" },
    nodes: merged.nodes,
    edges: merged.edges,
    layers: existing?.layers ?? [],
    tour: existing?.tour ?? [],
  };

  // FIX G1-3: validate BEFORE write on the real artifact. Fail (non-zero exit) if
  // any structural node/edge is dropped or the graph is fatally invalid.
  const preCount = structuralSubset(out as { nodes: GraphNode[]; edges: GraphEdge[] });
  const validation = validateGraph(out);
  if (!validation.success || !validation.data) {
    process.stderr.write(`[extract-structural] FATAL: graph failed schema validation: ${validation.fatal}\n`);
    process.exit(1);
  }
  const postCount = structuralSubset(validation.data);
  if (postCount.nodes.length < preCount.nodes.length || postCount.edges.length < preCount.edges.length) {
    process.stderr.write(
      `[extract-structural] FATAL: validation dropped structural items ` +
      `(nodes ${preCount.nodes.length}→${postCount.nodes.length}, edges ${preCount.edges.length}→${postCount.edges.length})\n`,
    );
    process.exit(1);
  }

  try {
    writeJson(outPath, out);
  } catch (err) {
    process.stderr.write(`[extract-structural] ERROR writing graph: ${String(err)}\n`);
    process.exit(1);
  }

  // Sidecar — non-deterministic facts ONLY (never in the graph).
  const elapsedMs = Date.now() - started;
  const subset = structuralSubset(out as { nodes: GraphNode[]; edges: GraphEdge[] });
  const sidecar = {
    schema: "guild.structural_extraction_meta.v1",
    generated_at: new Date(started).toISOString(),
    generated_from_commit: headSha(repoRoot),
    wall_clock_ms: elapsedMs,
    file_count: relFiles.length,
    structural_node_count: subset.nodes.length,
    structural_edge_count: subset.edges.length,
    model_calls: 0,
    network_calls: 0,
  };
  try {
    writeJson(`${outPath}.meta.json`, sidecar);
  } catch { /* sidecar best-effort */ }

  process.stderr.write(
    `[extract-structural] ${subset.nodes.length} structural nodes · ` +
    `${subset.edges.length} structural edges · ${relFiles.length} files · ` +
    `${elapsedMs}ms · 0 model calls → ${path.relative(repoRoot, outPath)}\n`,
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else process.stdout.write(path.relative(repoRoot, outPath) + "\n");
}

// Only run as a CLI; importing the module (tests) must not execute main().
if (require.main === module) {
  main();
}

export { main };
