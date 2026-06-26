#!/usr/bin/env -S npx tsx
/**
 * learn/build-tour.ts — Stage 6 (Tour) SCRIPT phase.
 *
 * Dependency-BFS ordering → a 5–15 step tour skeleton (deterministic order;
 * the LLM phase #24 writes narration + languageLesson). Mutates
 * .guild/indexes/knowledge-graph.json `tour[]`.
 *
 * Usage: npx tsx build-tour.ts [--cwd <path>] [--in <path>] [--print]
 */

import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag, writeJson, readJson } from "./lib/paths";
import { buildTourOrder } from "./lib/tour";
import type { KnowledgeGraph } from "./lib/schema";

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const inPath = parseFlag(argv, "in");
  const target = inPath ? path.resolve(cwd, inPath) : gp.knowledgeGraph;

  const graph = readJson<KnowledgeGraph>(target);
  if (!graph) {
    process.stderr.write(`[tour] ERROR: cannot read ${target}\n`);
    process.exit(1);
  }

  graph.tour = buildTourOrder(graph);
  writeJson(target, graph);

  process.stderr.write(
    `[tour] ${graph.tour.length} steps → ${path.relative(gp.repoRoot, target)}\n`,
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(graph.tour, null, 2) + "\n");
  else process.stdout.write(`${graph.tour.length} tour steps\n`);
}

main();
