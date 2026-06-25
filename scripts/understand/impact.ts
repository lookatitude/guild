#!/usr/bin/env -S npx tsx
/**
 * understand/impact.ts — thin CLI over the model-free impact-analysis library
 * (Goal G9, impact half). Loads the FROZEN KnowledgeGraph and computes the
 * reverse-reachable risk set for a diff.
 *
 * No SQLite, no model, no network — the in-process JSON scan in lib/impact.ts is
 * the source of truth. Results are `trusted`-tier evidence with `file:line`
 * source_refs (never instructions).
 *
 * Usage:
 *   npx tsx impact.ts '<json-args>' [--cwd <path>] [--graph <path>]
 *
 *   '{"changedFiles":["src/b.ts"],"entryPoints":["function:src/cli.ts:run"]}'
 *   '{"changedSymbols":["function:src/b.ts:add"]}'
 *   '{"base":"main","head":"HEAD"}'   ← derive changedFiles via `git diff`
 *
 * `base`/`head` derive the changed-file list from `git diff base..head` against
 * --cwd (or $GUILD_CWD / cwd). Explicit `changedFiles` take precedence and are
 * merged with any git-derived set.
 *
 * `entryPoints` is the caller's exported/public surface (matched by node id OR
 * simple name); `main`/`__main__` are always entry points. The graph carries no
 * `exported` flag, so entryDistance reflects ONLY the heuristic + supplied set —
 * a symbol no entry point reaches reports entryDistance: null (honest, not 0).
 *
 * `--graph <path>` (or a "graph" field in the JSON args) overrides the default
 * .guild/indexes/knowledge-graph.json location — handy for tests/fixtures.
 *
 * Exit: 0 ok · 1 no graph / bad input.
 */

import { guildPaths, parseCwd, parseFlag, readJson } from "./lib/paths";
import { changedFiles as gitChangedFiles } from "./lib/git";
import { computeImpact, type GraphView, type ImpactOptions } from "./lib/impact";

interface CliArgs {
  changedFiles?: string[];
  changedSymbols?: string[];
  entryPoints?: string[];
  /** derive changedFiles from `git diff base..head`. */
  base?: string;
  head?: string;
  graph?: string;
}

function main(): void {
  const argv = process.argv.slice(2);
  const positional = argv.filter(
    (a, i) =>
      !a.startsWith("--") &&
      !(i > 0 && argv[i - 1] === "--cwd") &&
      !(i > 0 && argv[i - 1] === "--graph"),
  );
  const rawJson = positional[0] ?? "{}";

  let args: CliArgs;
  try {
    args = JSON.parse(rawJson) as CliArgs;
  } catch {
    process.stderr.write(`[impact] invalid JSON args: ${rawJson}\n`);
    process.exit(1);
    return;
  }

  const cwd = parseCwd(argv);
  const graphPath = parseFlag(argv, "graph") ?? args.graph ?? guildPaths(cwd).knowledgeGraph;
  const graph = readJson<GraphView>(graphPath);
  if (!graph || !Array.isArray(graph.nodes)) {
    process.stderr.write(`[impact] no knowledge graph at ${graphPath}\n`);
    process.exit(1);
    return;
  }

  // Derive changedFiles from a git diff when base is supplied; merge with explicit list.
  const changed = new Set<string>(args.changedFiles ?? []);
  if (typeof args.base === "string") {
    for (const f of gitChangedFiles(cwd, args.base, args.head ?? "HEAD")) changed.add(f);
  }

  const opts: ImpactOptions = {
    changedFiles: changed,
    ...(args.changedSymbols ? { changedSymbols: args.changedSymbols } : {}),
    ...(args.entryPoints ? { entryPoints: args.entryPoints } : {}),
  };

  const result = computeImpact(graph, opts);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (require.main === module) {
  main();
}

export { main };
