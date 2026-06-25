#!/usr/bin/env -S npx tsx
/**
 * understand/architecture.ts — thin CLI over the model-free architecture-skeleton
 * library (Goal G9, architecture half). Loads the FROZEN KnowledgeGraph and emits
 * the deterministic skeleton (languages, entry points, hotspots, clusters, routes)
 * that an LLM can LATER narrate (narration is NOT this CLI).
 *
 * No SQLite, no model, no network — the in-process JSON scan in lib/architecture.ts
 * is the source of truth. Emitted evidence nodes are `trusted`-tier with `file:line`
 * source_refs (never instructions).
 *
 * Usage:
 *   npx tsx architecture.ts '<json-args>' [--cwd <path>] [--graph <path>]
 *
 *   '{}'                                   ← defaults
 *   '{"topHotspots":10}'                   ← cap the degree-ranked hotspot list
 *   '{"entryPoints":["function:src/cli.ts:run"]}'  ← extra public-surface entries
 *   '{"maxIterations":50}'                 ← label-propagation iteration cap
 *
 * `entryPoints` is the caller's exported/public surface (matched by node id OR
 * simple name); `main`/`__main__` are always entry points.
 *
 * `--graph <path>` (or a "graph" field in the JSON args) overrides the default
 * .guild/indexes/knowledge-graph.json location — handy for tests/fixtures. The
 * override is realpath-contained UNDER `.guild/indexes`: an in-repo file outside
 * that dir (or any `../`-escape / symlink escape) is refused, exit 1.
 *
 * Exit: 0 ok · 1 no graph / bad input.
 */

import * as fs from "fs";
import * as path from "path";

import { guildPaths, parseCwd, parseFlag, readJson } from "./lib/paths";
import {
  computeArchitecture,
  type GraphView,
  type ArchitectureOptions,
} from "./lib/architecture";

interface CliArgs {
  topHotspots?: number;
  maxIterations?: number;
  entryPoints?: string[];
  graph?: string;
}

/** Reject this run with a stderr diagnostic and a non-zero exit. */
function fail(msg: string): never {
  process.stderr.write(`[architecture] ${msg}\n`);
  process.exit(1);
  throw new Error(msg); // unreachable — keeps the type `never` for callers
}

/** True iff `rel` (a path RELATIVE to a base) escapes that base or is absolute. */
function escapesBase(rel: string): boolean {
  return rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel);
}

/**
 * Validate one optional `string[]` arg. Rejects anything that is not an array of
 * non-empty strings — so `entryPoints: "run"` (a bare string, which would
 * otherwise iterate per-CHARACTER) and `entryPoints: [1,null]` are refused BEFORE
 * they reach computeArchitecture.
 */
function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`"${field}" must be an array of strings`);
  const out: string[] = [];
  for (const v of value as unknown[]) {
    if (typeof v !== "string" || v.trim() === "") {
      fail(`"${field}" must contain only non-empty strings`);
    }
    out.push(v);
  }
  return out;
}

/**
 * Validate an optional integer arg in [min, ∞). A negative/NaN/float value must
 * be rejected, never silently passed to a `slice`/iteration bound.
 */
function asInt(value: unknown, field: string, min: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    fail(`"${field}" must be an integer >= ${min}`);
  }
  return value;
}

/**
 * Resolve `--graph`/`graph` and REFUSE any path outside the canonical indexes
 * directory `.guild/indexes` (path traversal / symlink escape). Two layers,
 * mirroring lib/similarity.ts + impact.ts: (1) lexical containment on the
 * resolved path; (2) a best-effort realpath check when both paths exist on disk.
 */
function resolveGraphUnderIndexes(indexesDir: string, graphArg: string): string {
  const root = path.resolve(indexesDir);
  const abs = path.resolve(root, graphArg);
  if (escapesBase(path.relative(root, abs))) {
    fail(`graph path escapes the indexes dir (.guild/indexes): ${graphArg}`);
  }
  try {
    const realRoot = fs.realpathSync(root);
    const realAbs = fs.realpathSync(abs);
    if (escapesBase(path.relative(realRoot, realAbs))) {
      fail(`graph path escapes the indexes dir (.guild/indexes, symlink): ${graphArg}`);
    }
  } catch {
    // Root or target absent on disk: layer 1 already proved lexical containment.
  }
  return abs;
}

/** Parse + VALIDATE the JSON args: a plain object with typed fields only. */
function parseArgs(rawJson: string): CliArgs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    fail(`invalid JSON args: ${rawJson}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("JSON args must be a plain object");
  }
  const o = parsed as Record<string, unknown>;
  if (o.graph !== undefined && typeof o.graph !== "string") fail(`"graph" must be a string`);
  return {
    topHotspots: asInt(o.topHotspots, "topHotspots", 0),
    maxIterations: asInt(o.maxIterations, "maxIterations", 1),
    entryPoints: asStringArray(o.entryPoints, "entryPoints"),
    graph: o.graph as string | undefined,
  };
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

  const args = parseArgs(rawJson);

  const cwd = parseCwd(argv);
  const paths = guildPaths(cwd);
  const graphArg = parseFlag(argv, "graph") ?? args.graph;
  // SECURITY: a caller-supplied graph path is realpath-contained under the
  // canonical indexes dir (.guild/indexes); the default knowledge-graph
  // location already lives there. An in-repo file outside .guild/indexes is
  // refused — the containment gate the header documents is actually closed.
  const graphPath = graphArg
    ? resolveGraphUnderIndexes(paths.indexesDir, graphArg)
    : paths.knowledgeGraph;
  const graph = readJson<GraphView>(graphPath);
  if (!graph || !Array.isArray(graph.nodes)) {
    fail(`no knowledge graph at ${graphPath}`);
  }

  const opts: ArchitectureOptions = {
    ...(args.topHotspots !== undefined ? { topHotspots: args.topHotspots } : {}),
    ...(args.maxIterations !== undefined ? { maxIterations: args.maxIterations } : {}),
    ...(args.entryPoints ? { entryPoints: args.entryPoints } : {}),
  };

  const result = computeArchitecture(graph, opts);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (require.main === module) {
  main();
}

export { main };
