#!/usr/bin/env -S npx tsx
/**
 * understand/diff-understanding.ts — P2 diff blast-radius (SCRIPT, no LLM).
 *
 * Changed files (git base..head) → affected graph nodes → affected layers →
 * blast-radius/risk → .guild/runs/<run-id>/diff-understanding.json
 * (`guild.diff_understanding.v1`, codebase-understanding.md
 * §"DiffUnderstanding", contract-map.md §A row 13). Feeds P2 plan-impact +
 * P3 verify scope check.
 *
 * Usage:
 *   npx tsx diff-understanding.ts [--cwd <path>] --base <sha> [--head <sha>] [--run-id <id>] [--print]
 */

import * as fs from "fs";
import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag, writeJson, readJson, SCHEMA } from "./lib/paths";
import { changedFiles, headSha } from "./lib/git";
import type { KnowledgeGraph } from "./lib/schema";

function resolveRunId(cwd: string, argv: string[]): string {
  const flag = parseFlag(argv, "run-id");
  if (flag) return flag;
  try {
    return fs.readFileSync(path.join(cwd, ".guild", "runs", "current-run-id"), "utf8").trim() || "run-adhoc";
  } catch {
    return "run-adhoc";
  }
}

function relOfNode(srcRefs: string[] | undefined): string | null {
  const r = srcRefs?.[0];
  return r ? r.split("#")[0] : null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const base = parseFlag(argv, "base");
  const head = parseFlag(argv, "head") ?? "HEAD";
  if (!base) {
    process.stderr.write("[diff] ERROR: --base <sha> required\n");
    process.exit(1);
  }
  const runId = resolveRunId(cwd, argv);

  const graph = readJson<KnowledgeGraph>(gp.knowledgeGraph);
  if (!graph) {
    process.stderr.write(`[diff] ERROR: knowledge-graph.json not found (build it first)\n`);
    process.exit(1);
  }

  const changed = changedFiles(gp.repoRoot, base, head);
  const changedSet = new Set(changed);

  const affectedNodes: string[] = [];
  const tracedFiles = new Set<string>();
  for (const n of graph.nodes) {
    const rel = relOfNode(n.source_refs);
    if (rel && changedSet.has(rel)) {
      affectedNodes.push(n.id);
      tracedFiles.add(rel);
    }
  }
  const affectedNodeSet = new Set(affectedNodes);
  const affectedLayers = graph.layers
    .filter((l) => l.nodeIds.some((id) => affectedNodeSet.has(id)))
    .map((l) => l.id);

  const untraced = changed.filter((f) => !tracedFiles.has(f));

  const nodeCount = affectedNodes.length;
  const layerCount = affectedLayers.length;
  let risk: "low" | "medium" | "high" = "low";
  if (layerCount >= 4 || nodeCount > 40) risk = "high";
  else if (layerCount >= 2 || nodeCount > 10) risk = "medium";

  const artifact = {
    version: SCHEMA.diffUnderstanding,
    base: base === "HEAD" ? headSha(gp.repoRoot) : base,
    head: head === "HEAD" ? headSha(gp.repoRoot) : head,
    changed_files: changed,
    affected_nodes: affectedNodes,
    affected_layers: affectedLayers,
    blast_radius: { node_count: nodeCount, layer_count: layerCount, risk },
    untraced_files: untraced,
  };

  const outPath = path.join(gp.runsDir, runId, "diff-understanding.json");
  writeJson(outPath, artifact);
  process.stderr.write(
    `[diff] changed=${changed.length} affected_nodes=${nodeCount} layers=${layerCount} ` +
    `risk=${risk} untraced=${untraced.length} → ${path.relative(gp.repoRoot, outPath)}\n`,
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(artifact, null, 2) + "\n");
  else process.stdout.write(path.relative(gp.repoRoot, outPath) + "\n");
}

main();
