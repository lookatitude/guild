#!/usr/bin/env -S npx tsx
/**
 * understand/graph-query.ts — thin CLI over the model-free structural query
 * library (Goal G3). Loads the FROZEN KnowledgeGraph and dispatches one verb.
 *
 * No SQLite, no model, no network — JSON in-process is the source of truth
 * (codebase-understanding.md §"Relationship to the wiki"). Results are
 * `trusted`-tier evidence with `file:line` source_refs (never instructions).
 *
 * Usage:
 *   npx tsx graph-query.ts <verb> '<json-args>' [--cwd <path>] [--graph <path>]
 *
 *   trace      '{"node":"main","direction":"outbound","depth":3}'
 *   neighbors  '{"node":"function:src/a.ts:main","hops":1}'
 *   dead-code  '{}'
 *
 * `--graph <path>` (or a "graph" field in the JSON args) overrides the default
 * .guild/indexes/knowledge-graph.json location — handy for tests/fixtures.
 *
 * Exit: 0 ok · 1 no graph / bad input.
 */

import { guildPaths, parseCwd, parseFlag, readJson } from "./lib/paths";
import {
  kgTrace,
  kgNeighbors,
  kgDeadCode,
  type Direction,
  type GraphView,
} from "./lib/graph-query";

interface VerbArgs {
  node?: string;
  direction?: string;
  depth?: number;
  hops?: number;
  graph?: string;
}

function normDirection(d: unknown): Direction {
  return d === "inbound" || d === "both" ? d : "outbound";
}

function main(): void {
  const argv = process.argv.slice(2);
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1] === "--cwd") && !(i > 0 && argv[i - 1] === "--graph"));
  const verb = positional[0];
  const rawJson = positional[1] ?? "{}";

  if (!verb) {
    process.stderr.write("usage: graph-query.ts <trace|neighbors|dead-code> '<json-args>'\n");
    process.exit(1);
  }

  let args: VerbArgs;
  try {
    args = JSON.parse(rawJson) as VerbArgs;
  } catch {
    process.stderr.write(`[graph-query] invalid JSON args: ${rawJson}\n`);
    process.exit(1);
    return;
  }

  const cwd = parseCwd(argv);
  const graphPath = parseFlag(argv, "graph") ?? args.graph ?? guildPaths(cwd).knowledgeGraph;
  const graph = readJson<GraphView>(graphPath);
  if (!graph || !Array.isArray(graph.nodes)) {
    process.stderr.write(`[graph-query] no knowledge graph at ${graphPath}\n`);
    process.exit(1);
    return;
  }

  let result: unknown;
  switch (verb) {
    case "trace": {
      if (!args.node) { process.stderr.write("[graph-query] trace requires {\"node\":...}\n"); process.exit(1); }
      result = kgTrace(graph, args.node!, normDirection(args.direction), args.depth ?? 3);
      break;
    }
    case "neighbors":
    case "neighbours": {
      if (!args.node) { process.stderr.write("[graph-query] neighbors requires {\"node\":...}\n"); process.exit(1); }
      result = kgNeighbors(graph, args.node!, args.hops ?? 1);
      break;
    }
    case "dead-code":
    case "dead_code": {
      result = kgDeadCode(graph);
      break;
    }
    default:
      process.stderr.write(`[graph-query] unknown verb "${verb}"\n`);
      process.exit(1);
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (require.main === module) {
  main();
}

export { main };
