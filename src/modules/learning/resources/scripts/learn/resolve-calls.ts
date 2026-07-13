#!/usr/bin/env -S npx tsx
/**
 * learn/resolve-calls.ts — LANE G2 accurate call-resolution post-pass.
 *
 * Refines G1's syntactic `calls` edges into import/type-aware edges:
 *   - TS/JS via the TypeScript compiler API (resolve-calls-ts.ts) — IDE-grade.
 *   - Python via an import-aware symbol table (resolve-calls-py.ts) — ≥80% target.
 *   - Any other language keeps G1's syntactic edge, re-tagged confidence "low".
 * Every emitted `calls` edge carries a `confidence` field; unresolvable/dynamic
 * calls are reported (sidecar counts) rather than silently linked to a same-named
 * local. Nodes + contains/imports/inherits/implements are preserved from G1.
 *
 * Determinism: pure function of (source tree, file list). Wall-clock/timestamp →
 * sidecar only. No model, no network, no wasm. SQLite is never consulted (JSON is
 * the source of truth), so output is identical with `index: off` and `index: on`.
 *
 * STATUS (plugin-audit-remediation G5a, 2026-07-13): experimental / on-demand-only
 * as a CLI — no skill invokes it (it post-processes the G1 extract-structural
 * graph, which is itself unwired; see that header). The exported `refineCalls`
 * is load-bearing shared fixture infrastructure for the kept G-series tests
 * (clra-conformance, graph-query-projection, resolve-calls). Keep — do not
 * delete as "unreferenced".
 *
 * Usage:
 *   npx tsx resolve-calls.ts --cwd <root> [--out <path>] [--print]
 */

import * as fs from "fs";
import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag, writeJson, readJson, SCHEMA } from "./lib/paths";
import { headSha } from "./lib/git";
import { walkRepo } from "./lib/walk";
import { extractStructuralGraph, canonicalize, structuralSubset, STRUCTURAL_EXTRACTOR } from "./lib/structural";
import { validateGraph } from "./lib/schema";
import { resolveTsCalls } from "./lib/resolve-calls-ts";
import { resolvePyCalls } from "./lib/resolve-calls-py";
import type { ResolvedCall } from "./lib/resolved-call";
import type { GraphEdge, GraphNode } from "./lib/schema";

function relpathOf(nodeId: string): string {
  const parts = nodeId.split(":");
  return parts[0] === "file" ? parts.slice(1).join(":") : parts.slice(1, -1).join(":");
}

function confWeight(c: ResolvedCall["confidence"]): number {
  return c === "high" ? 0.95 : c === "medium" ? 0.7 : 0.4;
}

export interface RefineResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** calls whose endpoints were not present as nodes (reported, not silent) */
  droppedMissingNode: number;
}

/**
 * Refine the `calls` edges of a base structural graph using accurate per-language
 * resolvers. Returns the full graph (nodes unchanged, calls edges replaced).
 */
export function refineCalls(
  repoRoot: string,
  relFiles: string[],
  readFile: (abs: string) => string,
  base: { nodes: GraphNode[]; edges: GraphEdge[] },
): RefineResult {
  const resolved: ResolvedCall[] = [
    ...resolveTsCalls(repoRoot, relFiles),
    ...resolvePyCalls(repoRoot, relFiles, readFile),
  ];

  const nodeIds = new Set(base.nodes.map((n) => n.id));
  const isPyRel = (rel: string) => rel.toLowerCase().endsWith(".py");

  const nonCall = base.edges.filter((e) => e.type !== "calls");

  // FIX G2-1 (BLOCKER): partition the existing `calls` edges by provenance. ONLY
  // our own G1 syntactic edges (extractor "structural-v1") are eligible for G2
  // replacement/re-tag. EVERY other `calls` edge — LLM-tier, future extractors —
  // is "unrelated" and preserved verbatim, even on a fully-enriched graph. The
  // previous code dropped non-handled foreign calls into the re-tag bucket (and
  // dropped handled-file foreign calls entirely), corrupting/erasing enrichment.
  const isG1Call = (e: GraphEdge) =>
    e.type === "calls" && (e as Record<string, unknown>).extractor === STRUCTURAL_EXTRACTOR;
  const foreignCalls: GraphEdge[] = base.edges.filter((e) => e.type === "calls" && !isG1Call(e));

  // FIX G2-r2-1 (BLOCKER): retain G1 syntactic calls as a LOW-confidence recall
  // net for every language EXCEPT Python. A refined (G2) edge overwrites the
  // matching key below, so a G1 call the resolver REPRODUCES is upgraded to its
  // accurate confidence, while a G1 TS/JS call the compiler resolver canNOT
  // resolve (unimported/dynamic/symbol-less) SURVIVES as `g1-syntactic` low —
  // it no longer vanishes. This is the documented G2 contract ("keeps G1's
  // syntactic edge, re-tagged confidence low") and matches the round-2 finding.
  //
  // Python is deliberately EXCLUDED (precision-first, FIX G2-6): its import-aware
  // resolver suppresses unimported names ON PURPOSE, and re-admitting G1's
  // global-unique guesses here would reintroduce exactly the cross-file false
  // links that the Python lane and its negative oracles forbid. So Python G1
  // calls on handled files are dropped — the py resolver's edges replace them.
  const keptG1: GraphEdge[] = base.edges
    .filter((e) => isG1Call(e) && !isPyRel(relpathOf(e.source)))
    .map((e) => ({ ...e, confidence: "low", resolution: "g1-syntactic", backend: "g1-syntactic" }));

  let droppedMissingNode = 0;
  const refined: GraphEdge[] = [];
  for (const rc of resolved) {
    if (!nodeIds.has(rc.from) || !nodeIds.has(rc.to)) { droppedMissingNode++; continue; }
    refined.push({
      source: rc.from,
      target: rc.to,
      type: "calls",
      direction: "out",
      weight: confWeight(rc.confidence),
      confidence: rc.confidence,
      resolution: rc.kind,
      cross_file: rc.crossFile,
      backend: rc.backend,
      extractor: STRUCTURAL_EXTRACTOR,
    });
  }

  // union by type|source|target. Resolved (G2) wins over any kept G1 collision;
  // foreign (non-structural) calls are applied LAST so an enriched/LLM-tier edge
  // is NEVER clobbered — it is "unrelated" to G2 and must survive intact (G2-1).
  const ekey = (e: GraphEdge) => `${e.type}|${e.source}|${e.target}`;
  const byKey = new Map<string, GraphEdge>();
  for (const e of nonCall) byKey.set(ekey(e), e);
  for (const e of keptG1) byKey.set(ekey(e), e);
  for (const e of refined) byKey.set(ekey(e), e);
  for (const e of foreignCalls) byKey.set(ekey(e), e);

  const g = canonicalize({ nodes: base.nodes, edges: [...byKey.values()] });
  return { nodes: g.nodes, edges: g.edges, droppedMissingNode };
}

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

  const cm = readJson<{ files: { path: string }[] }>(gp.codebaseMap);
  const relFiles = cm?.files?.map((f) => f.path) ?? walkRepo(repoRoot).files;
  const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

  // Base graph: prefer G1's output at outPath; else build it now.
  const existing = readJson<ExistingGraph>(outPath);
  let base: { nodes: GraphNode[]; edges: GraphEdge[] };
  if (existing?.nodes && existing.nodes.length) {
    base = { nodes: existing.nodes, edges: existing.edges ?? [] };
  } else {
    base = extractStructuralGraph(repoRoot, relFiles, readFile);
  }

  const refined = refineCalls(repoRoot, relFiles, readFile, base);

  const out: Record<string, unknown> = {
    version: existing?.version ?? SCHEMA.knowledgeGraph,
    kind: existing?.kind ?? "codebase",
    // FIX G2-2 (determinism): commit metadata lives in the sidecar only; ALWAYS
    // write the commit-independent constant so a stale sha on a pre-fix graph is
    // normalized away rather than carried forward.
    generated_from_commit: "structural",
    project: existing?.project ?? { name: path.basename(repoRoot), description: "" },
    nodes: refined.nodes,
    edges: refined.edges,
    layers: existing?.layers ?? [],
    tour: existing?.tour ?? [],
  };

  // FIX G1-3: validate BEFORE write; fail if the refined graph drops structural items.
  const preCount = structuralSubset(out as { nodes: GraphNode[]; edges: GraphEdge[] });
  const validation = validateGraph(out);
  if (!validation.success || !validation.data) {
    process.stderr.write(`[resolve-calls] FATAL: graph failed schema validation: ${validation.fatal}\n`);
    process.exit(1);
  }
  const postCount = structuralSubset(validation.data);
  if (postCount.edges.length < preCount.edges.length || postCount.nodes.length < preCount.nodes.length) {
    process.stderr.write(
      `[resolve-calls] FATAL: validation dropped structural items ` +
      `(nodes ${preCount.nodes.length}→${postCount.nodes.length}, edges ${preCount.edges.length}→${postCount.edges.length})\n`,
    );
    process.exit(1);
  }

  // FIX G2-3: persist the VALIDATED graph (validation.data), not the original
  // `out` — never write an artifact that differs from what the validator accepted.
  try {
    writeJson(outPath, validation.data);
  } catch (err) {
    process.stderr.write(`[resolve-calls] ERROR writing graph: ${String(err)}\n`);
    process.exit(1);
  }

  const callEdges = refined.edges.filter((e) => e.type === "calls");
  const byConf = (c: string) => callEdges.filter((e) => (e as Record<string, unknown>).confidence === c).length;
  const elapsedMs = Date.now() - started;
  const sidecar = {
    schema: "guild.call_resolution_meta.v1",
    generated_at: new Date(started).toISOString(),
    generated_from_commit: headSha(repoRoot),
    wall_clock_ms: elapsedMs,
    calls_total: callEdges.length,
    calls_high: byConf("high"),
    calls_medium: byConf("medium"),
    calls_low: byConf("low"),
    dropped_missing_node: refined.droppedMissingNode,
    model_calls: 0,
    network_calls: 0,
  };
  try { writeJson(`${outPath}.calls-meta.json`, sidecar); } catch { /* best-effort */ }

  process.stderr.write(
    `[resolve-calls] ${callEdges.length} calls (high ${byConf("high")}/med ${byConf("medium")}/low ${byConf("low")}) · ` +
    `${elapsedMs}ms · 0 model calls → ${path.relative(repoRoot, outPath)}\n`,
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else process.stdout.write(path.relative(repoRoot, outPath) + "\n");
}

if (require.main === module) {
  main();
}

export { main };
