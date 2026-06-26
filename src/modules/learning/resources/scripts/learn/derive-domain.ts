#!/usr/bin/env -S npx tsx
/**
 * learn/derive-domain.ts — Stage 5 (Domain) SCRIPT phase.
 *
 * Cheap re-use of the existing graph (NO re-scan) → Domain→Flow→Step
 * scaffold + persisted `domain` labels + the initial knowledge-links.json
 * projection batch (append-only, `guild.knowledge_links.v1`,
 * codebase-understanding.md §"5 Domain"). The LLM phase (#24) narrates the
 * domains/flows; the script fixes the structure + monotone flow_step order.
 *
 * Usage:
 *   npx tsx derive-domain.ts [--cwd <path>] [--run-id <id>] [--in <path>] [--print]
 */

import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag, writeJson, readJson } from "./lib/paths";
import { deriveDomain, appendKnowledgeLinks } from "./lib/domain";
import type { KnowledgeGraph } from "./lib/schema";

function resolveRunId(cwd: string, argv: string[]): string {
  const flag = parseFlag(argv, "run-id");
  if (flag) return flag;
  const sentinel = path.join(cwd, ".guild", "runs", "current-run-id");
  try {
    return require("fs").readFileSync(sentinel, "utf8").trim() || "run-unknown";
  } catch {
    return "run-unknown";
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const inPath = parseFlag(argv, "in");
  const target = inPath ? path.resolve(cwd, inPath) : gp.knowledgeGraph;
  const runId = resolveRunId(cwd, argv);

  const graph = readJson<KnowledgeGraph>(target);
  if (!graph) {
    process.stderr.write(`[domain] ERROR: cannot read ${target}\n`);
    process.exit(1);
  }

  const { nodes, edges } = deriveDomain(graph);
  // Splice the scaffold in (dedupe by id/key).
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const n of nodes) if (!ids.has(n.id)) graph.nodes.push(n);
  const ek = new Set(graph.edges.map((e) => `${e.type}|${e.source}|${e.target}`));
  for (const e of edges) {
    const k = `${e.type}|${e.source}|${e.target}`;
    if (!ek.has(k)) graph.edges.push(e);
  }
  writeJson(target, graph);

  const kl = appendKnowledgeLinks(gp.knowledgeLinks, graph, runId);

  process.stderr.write(
    `[domain] +${nodes.length} domain/flow/step nodes · +${edges.length} edges · ` +
    `knowledge-links +${kl.added} (total ${kl.total}) → ${path.relative(gp.repoRoot, gp.knowledgeLinks)}\n`,
  );
  if (hasFlag(argv, "print")) {
    process.stdout.write(JSON.stringify({ addedNodes: nodes.length, addedEdges: edges.length, knowledgeLinks: kl }, null, 2) + "\n");
  } else {
    process.stdout.write(`domains=${nodes.filter((n) => n.type === "domain").length} links+=${kl.added}\n`);
  }
}

main();
