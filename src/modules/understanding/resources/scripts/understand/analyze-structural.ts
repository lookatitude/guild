#!/usr/bin/env -S npx tsx
/**
 * understand/analyze-structural.ts — Stage 2 (Analyze) SCRIPT phase.
 *
 * tree-sitter-equivalent structural extract + deterministic merge → the
 * partial graph (file/function/class nodes + contains/imports edges, all
 * confidence "high" with `path#Lx-Ly` source_refs). The LLM phase (#24)
 * adds semantic node/edge typing under "trust the script".
 *
 * Output: .guild/indexes/understand-partial-graph.json (intermediate).
 * Usage: npx tsx analyze-structural.ts [--cwd <path>] [--print]
 */

import * as fs from "fs";
import * as path from "path";
import { guildPaths, parseCwd, hasFlag, writeJson, readJson, SCHEMA } from "./lib/paths";
import { headSha } from "./lib/git";
import { walkRepo } from "./lib/walk";
import { buildPartialGraph, mergeReport } from "./lib/graph";

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);

  // Prefer the scan's file list; fall back to a fresh walk.
  const cm = readJson<{ files: { path: string }[] }>(gp.codebaseMap);
  const relFiles = cm?.files?.map((f) => f.path) ?? walkRepo(gp.repoRoot).files;

  const partial = buildPartialGraph(
    gp.repoRoot,
    relFiles,
    (abs) => fs.readFileSync(abs, "utf8"),
  );
  const report = mergeReport(partial);

  const out = {
    version: SCHEMA.knowledgeGraph,
    kind: "codebase" as const,
    generated_from_commit: headSha(gp.repoRoot),
    project: { name: path.basename(gp.repoRoot), description: "" },
    nodes: partial.nodes,
    edges: partial.edges,
    layers: [],
    tour: [],
    _merge_report: report, // consumed by stage-3 challenger; stripped on validate
  };

  writeJson(gp.partialGraph, out);
  process.stderr.write(
    `[analyze] ${partial.nodes.length} nodes · ${partial.edges.length} edges · ` +
    `${report.danglingEdges.length} dangling → ${path.relative(gp.repoRoot, gp.partialGraph)}\n`,
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else process.stdout.write(path.relative(gp.repoRoot, gp.partialGraph) + "\n");
}

main();
