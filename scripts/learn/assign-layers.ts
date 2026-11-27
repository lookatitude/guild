#!/usr/bin/env -S npx tsx
/**
 * learn/assign-layers.ts — Stage 4 (Architecture) SCRIPT phase.
 *
 * Topology signal → assign every file node to exactly one layer (LOCKED
 * invariant) and persist the `component` knowledge label on each node
 * (codebase-understanding.md §"One connected knowledge model" — must not be
 * discarded). The LLM phase (#24) may relabel layer names; the script
 * guarantees the partition. Mutates .guild/indexes/knowledge-graph.json.
 *
 * Usage: npx tsx assign-layers.ts [--cwd <path>] [--in <path>] [--print]
 */

import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag } from "./lib/paths";
import { assignLayers } from "./lib/layers";
import type { KnowledgeGraph } from "./lib/schema";
import { ensureStorageLayout } from "../lib/state/ensure-storage-layout";
import { runGraphStage } from "./lib/publish";

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  ensureStorageLayout(cwd, { detectOnly: true });
  const gp = guildPaths(cwd);
  const inPath = parseFlag(argv, "in");
  const target = inPath ? path.resolve(cwd, inPath) : gp.knowledgeGraph;

  // K03: the owner graph is read from and published to the generation store.
  const graph = runGraphStage<KnowledgeGraph>(gp, {
    target: inPath ? target : null,
    who: "layers",
    channels: ["semantic_graph"],
    transform: (g) => {
      g.layers = assignLayers(g);
      return g;
    },
  });
  if (!graph) {
    process.stderr.write(`[layers] ERROR: cannot read ${target}\n`);
    process.exit(1);
  }

  // Invariant check: every file node in exactly one layer.
  const fileNodes = graph.nodes.filter((n) => n.type === "file").map((n) => n.id);
  const seen = new Map<string, number>();
  for (const l of graph.layers) for (const id of l.nodeIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  const missing = fileNodes.filter((id) => !seen.has(id));
  const dup = fileNodes.filter((id) => (seen.get(id) ?? 0) > 1);
  if (missing.length || dup.length) {
    process.stderr.write(`[layers] WARN invariant: missing=${missing.length} dup=${dup.length}\n`);
  }

  process.stderr.write(
    `[layers] ${graph.layers.length} layers over ${fileNodes.length} file nodes → ${path.relative(gp.repoRoot, target)}\n`,
  );
  if (hasFlag(argv, "print")) {
    process.stdout.write(JSON.stringify(graph.layers, null, 2) + "\n");
  } else {
    process.stdout.write(graph.layers.map((l) => `${l.name} (${l.nodeIds.length})`).join(", ") + "\n");
  }
}

main();
