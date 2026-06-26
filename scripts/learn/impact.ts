#!/usr/bin/env -S npx tsx
/**
 * learn/impact.ts — thin CLI over the model-free impact-analysis library
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
 * .guild/indexes/knowledge-graph.json location — handy for tests/fixtures. The
 * override is realpath-contained UNDER `.guild/indexes`: an in-repo file outside
 * that dir (or any `../`-escape / symlink escape) is refused, exit 1.
 *
 * Exit: 0 ok · 1 no graph / bad input.
 */

import * as fs from "fs";
import * as path from "path";

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

/** Reject this run with a stderr diagnostic and a non-zero exit. */
function fail(msg: string): never {
  process.stderr.write(`[impact] ${msg}\n`);
  process.exit(1);
  throw new Error(msg); // unreachable — keeps the type `never` for callers
}

/** True iff `rel` (a path RELATIVE to a base) escapes that base or is absolute. */
function escapesBase(rel: string): boolean {
  return rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel);
}

/**
 * Validate one optional `string[]` arg. Rejects (via {@link fail}) anything that
 * is not an array of non-empty strings — so e.g. `changedFiles: "src/b.ts"` (a
 * bare string, which would otherwise iterate into a per-CHARACTER set) and
 * `changedSymbols: [1,null]` are refused BEFORE they reach computeImpact.
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
 * Normalize a repo-relative changed-file path and refuse anything that is not a
 * legitimate repo-relative path (absolute, or `../`-escaping). Path separators
 * are normalized to `/` to match the node-id relpath convention.
 */
function normalizeChangedFile(f: string): string {
  const norm = path.normalize(f).replace(/\\/g, "/").replace(/^\.\//, "");
  if (escapesBase(path.normalize(norm))) {
    fail(`"changedFiles" entry escapes the repo: ${f}`);
  }
  return norm;
}

/**
 * Resolve `--graph`/`graph` and REFUSE any path outside the canonical indexes
 * directory `.guild/indexes` (path traversal / symlink escape). The default
 * graph lives at `.guild/indexes/knowledge-graph.json`, so a caller-supplied
 * override is constrained to that SAME trusted directory — an in-repo file
 * outside `.guild/indexes` (e.g. `<repo>/knowledge-graph.json`) is refused, not
 * just `../`-escapes. Returns the absolute path or refuses.
 *
 * The user arg is resolved against the REPO ROOT (or, when absolute, taken
 * as-is) — NOT against the indexes dir, which would double a repo-relative
 * `.guild/indexes/...` into `.guild/indexes/.guild/indexes/...`. Containment is
 * then enforced against `indexesDir`. Two layers, mirroring lib/similarity.ts:
 * (1) a lexical containment check on the resolved path; (2) a best-effort
 * realpath check when both paths exist on disk.
 */
function resolveGraphUnderIndexes(
  repoRoot: string,
  indexesDir: string,
  graphArg: string,
): string {
  const indexesRoot = path.resolve(indexesDir);
  // Resolve relative to the repo root (absolute args pass through path.resolve
  // unchanged); containment below decides acceptance — never the resolve base.
  const abs = path.resolve(repoRoot, graphArg);
  if (escapesBase(path.relative(indexesRoot, abs))) {
    fail(`graph path escapes the indexes dir (.guild/indexes): ${graphArg}`);
  }
  try {
    const realRoot = fs.realpathSync(indexesRoot);
    const realAbs = fs.realpathSync(abs);
    if (escapesBase(path.relative(realRoot, realAbs))) {
      fail(`graph path escapes the indexes dir (.guild/indexes, symlink): ${graphArg}`);
    }
  } catch {
    // Root or target absent on disk: layer 1 already proved lexical containment.
  }
  return abs;
}

/** Parse + VALIDATE the JSON args: a plain object with arrays-of-strings only. */
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
  for (const k of ["base", "head", "graph"] as const) {
    if (o[k] !== undefined && typeof o[k] !== "string") fail(`"${k}" must be a string`);
  }
  return {
    changedFiles: asStringArray(o.changedFiles, "changedFiles")?.map(normalizeChangedFile),
    changedSymbols: asStringArray(o.changedSymbols, "changedSymbols"),
    entryPoints: asStringArray(o.entryPoints, "entryPoints"),
    base: o.base as string | undefined,
    head: o.head as string | undefined,
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
    ? resolveGraphUnderIndexes(paths.repoRoot, paths.indexesDir, graphArg)
    : paths.knowledgeGraph;
  const graph = readJson<GraphView>(graphPath);
  if (!graph || !Array.isArray(graph.nodes)) {
    fail(`no knowledge graph at ${graphPath}`);
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
