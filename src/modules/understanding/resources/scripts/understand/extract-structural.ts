#!/usr/bin/env -S npx tsx
/**
 * understand/extract-structural.ts — LANE G1 model-free structural extraction.
 *
 * A deterministic, ZERO-LLM, zero-network pass that walks source files and
 * emits the structural subset of guild.knowledge_graph.v1 — file/function/class
 * nodes + contains/imports/calls/inherits/implements edges, each carrying the
 * 25-feature AST structural profile (`sp`, goals.md §2.1) — merged into
 * .guild/indexes/knowledge-graph.json WITHOUT clobbering any existing LLM-tier
 * nodes (merge by deterministic id). Runs BEFORE any LLM stage so the LLM tier
 * consumes structure instead of re-deriving it.
 *
 * Determinism: the graph is a pure function of (source tree, file list). All
 * non-deterministic facts (wall-clock, generated_at) go to a sidecar
 * `<out>.meta.json`, never into the graph.
 *
 * Incremental refresh (LANE G4): `--incremental` diffs the working tree against
 * the per-file SHA-256 fingerprints stored in the bundle cache
 * (`<out>.structural-cache.json`) from the last run, re-extracts ONLY changed/new
 * files, drops deleted files, and re-assembles. The global cross-file resolution
 * still runs over the whole (cached + fresh) bundle set, so the output is
 * byte-identical to a full rebuild. No watcher/daemon — invocation-driven, run on
 * demand and by learn-diff. First run (no cache) falls back to a full build and
 * seeds the cache; subsequent `--incremental` runs reuse it.
 *
 * Usage:
 *   npx tsx extract-structural.ts --cwd <root> [--out <path>] [--incremental] [--print]
 * Exit: 0 ok · 1 write/error.
 */

import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag, writeJson, readJson, SCHEMA } from "./lib/paths";
import { headSha, isTracked } from "./lib/git";
import { walkRepo } from "./lib/walk";
import {
  assembleStructuralGraph,
  buildBundles,
  bundlesToCache,
  mergeStructuralInto,
  refreshStructuralIncremental,
  stripStructural,
  structuralSubset,
  type FileBundle,
  type RefreshStats,
  type StructuralCache,
  type StructuralGraph,
} from "./lib/structural";
import { validateGraph } from "./lib/schema";
import type { GraphEdge, GraphNode } from "./lib/schema";
import * as fs from "fs";

/**
 * FIX-T4.1-1: resolve `p` and PROVE it stays within `root` before any read/write.
 * The artifact may not exist yet, so containment is checked via the realpath of
 * the nearest EXISTING ancestor (defeating a symlink-through-an-existing-parent
 * escape) with the non-existent tail re-appended. Returns the plain resolved
 * path (location unchanged); throws on any `../`/symlink escape outside `root`.
 */
function assertContained(root: string, p: string, label: string): string {
  const resolved = path.resolve(root, p);
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
  let existing = resolved;
  const tail: string[] = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached filesystem root
    existing = parent;
  }
  const realFinal = path.join(fs.realpathSync(existing), ...tail);
  const rel = path.relative(realRoot, realFinal);
  const contained = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (!contained) {
    throw new Error(
      `[extract-structural] refusing ${label} outside repo root: ` +
      `"${p}" → ${realFinal} (root ${realRoot})`,
    );
  }
  return resolved;
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
  const incremental = hasFlag(argv, "incremental");
  const started = Date.now();

  // FIX-T4.1-1: containment-check the (possibly user-supplied) out path BEFORE it
  // is read/written; the cache path is derived from the validated out path and so
  // is checked too. Reject `../`/symlink escapes out of the repo root.
  let outPath: string;
  let cachePath: string;
  try {
    outPath = assertContained(repoRoot, parseFlag(argv, "out") ?? gp.knowledgeGraph, "--out path");
    cachePath = assertContained(repoRoot, `${outPath}.structural-cache.json`, "cache path");
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // File list: for --incremental, ALWAYS the LIVE tree (walkRepo) so add/delete is
  // lossless even when .guild/indexes/codebase-map.json is stale (FIX-T4.1-2). A
  // full build prefers the deterministic scan's shared inventory, else a walk.
  const cm = readJson<{ files: { path: string }[] }>(gp.codebaseMap);
  const relFiles = incremental
    ? walkRepo(repoRoot).files
    : cm?.files?.map((f) => f.path) ?? walkRepo(repoRoot).files;
  const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

  const existing = readJson<ExistingGraph>(outPath);

  // ── Extract: incremental (reuse cache) or full (rebuild + seed cache) ───────
  let structural: StructuralGraph;
  let bundles: FileBundle[];
  let stats: RefreshStats | { mode: "full" } = { mode: "full" };
  // The merge base: a full run unions structural into the existing graph as-is
  // (preserves the long-standing full-path behavior). An incremental run first
  // STRIPS this extractor's prior structural items so the freshly assembled
  // subgraph replaces them wholesale (cascade-delete of changed/deleted files),
  // while every foreign (LLM-tier) node/edge is preserved.
  let mergeNodes = existing?.nodes ?? [];
  let mergeEdges = existing?.edges ?? [];

  let prior = incremental ? readJson<StructuralCache>(cachePath) : null;
  // FIX-T4.1-r7: enforce LOCAL-ONLY at reuse time, not just via .gitignore. The
  // r5 checksum-only trust model is sound ONLY because the cache is local-only;
  // .gitignore prevents *accidental* commits but is NOT an enforcement boundary —
  // a sidecar can be force-added (`git add -f`) and committed, then a victim's
  // `--incremental` would trust an attacker's committed, checksum-recomputed cache.
  // So a git-TRACKED sidecar is untrusted: drop it → re-extract (incremental ==
  // full). Layered ON TOP of the r6 gitignore + the r5 integrity checksum.
  // Degrades gracefully: no git repo / probe error ⇒ isTracked()==false ⇒ fall
  // back to the gitignore-convention + checksum trust (a non-git workspace is
  // never hard-failed).
  if (incremental && prior && isTracked(repoRoot, cachePath)) {
    process.stderr.write(
      `[extract-structural] --incremental: cache sidecar ` +
      `${path.relative(repoRoot, cachePath)} is git-tracked (shareable, not local-only) ` +
      `→ untrusted, ignoring cache → full rebuild (re-seeding cache)\n`,
    );
    prior = null;
  }
  if (incremental && prior && prior.files && Object.keys(prior.files).length > 0) {
    const r = refreshStructuralIncremental(repoRoot, relFiles, readFile, prior);
    structural = r.structural;
    bundles = r.bundles;
    stats = r.stats;
    const stripped = stripStructural(mergeNodes, mergeEdges);
    mergeNodes = stripped.nodes;
    mergeEdges = stripped.edges;
  } else {
    if (incremental) {
      process.stderr.write(
        `[extract-structural] --incremental: no usable cache at ` +
        `${path.relative(repoRoot, cachePath)} → full rebuild (seeding cache)\n`,
      );
      // An --incremental run with no USABLE cache (missing / empty / version-stale /
      // or REFUSED because git-tracked, FIX-T4.1-r7) still owes incremental == full:
      // STRIP the prior structural tier from the existing graph so the freshly
      // assembled subgraph replaces it wholesale (stale/edited/deleted structural
      // nodes do not survive the merge). A plain full run (`incremental` false)
      // keeps the long-standing union-as-is behavior and does NOT strip.
      const stripped = stripStructural(mergeNodes, mergeEdges);
      mergeNodes = stripped.nodes;
      mergeEdges = stripped.edges;
    }
    bundles = buildBundles(repoRoot, relFiles, readFile);
    structural = assembleStructuralGraph(repoRoot, bundles);
  }

  // Merge into the existing graph (if any) without clobbering LLM-tier nodes.
  const merged = mergeStructuralInto(mergeNodes, mergeEdges, structural);

  const out: Record<string, unknown> = {
    version: existing?.version ?? SCHEMA.knowledgeGraph,
    kind: existing?.kind ?? "codebase",
    // FIX G2-2 (determinism): commit/run metadata lives in the SIDECAR only. The
    // graph artifact is a pure function of (source, config) — never the HEAD sha —
    // so two identical trees at different commits produce byte-identical graphs.
    // ALWAYS write the commit-independent constant: a stale sha carried by an
    // existing (pre-fix) graph must be NORMALIZED away, not preserved.
    generated_from_commit: "structural",
    project: existing?.project ?? { name: path.basename(repoRoot), description: "" },
    nodes: merged.nodes,
    edges: merged.edges,
    layers: existing?.layers ?? [],
    tour: existing?.tour ?? [],
  };

  // FIX G1-3: validate BEFORE write on the real artifact. Fail (non-zero exit) if
  // any structural node/edge is dropped or the graph is fatally invalid.
  const preCount = structuralSubset(out as { nodes: GraphNode[]; edges: GraphEdge[] });
  const validation = validateGraph(out);
  if (!validation.success || !validation.data) {
    process.stderr.write(`[extract-structural] FATAL: graph failed schema validation: ${validation.fatal}\n`);
    process.exit(1);
  }
  const postCount = structuralSubset(validation.data);
  if (postCount.nodes.length < preCount.nodes.length || postCount.edges.length < preCount.edges.length) {
    process.stderr.write(
      `[extract-structural] FATAL: validation dropped structural items ` +
      `(nodes ${preCount.nodes.length}→${postCount.nodes.length}, edges ${preCount.edges.length}→${postCount.edges.length})\n`,
    );
    process.exit(1);
  }

  // FIX G2-3: write the VALIDATED graph (validation.data), not the original `out`.
  // Any auto-fix/normalization the validator applied is then what lands on disk —
  // we never persist an unvalidated artifact that silently differs from what the
  // validator accepted.
  try {
    writeJson(outPath, validation.data);
  } catch (err) {
    process.stderr.write(`[extract-structural] ERROR writing graph: ${String(err)}\n`);
    process.exit(1);
  }

  // Bundle cache — the reuse baseline + per-file SHA-256 fingerprints for the
  // NEXT `--incremental` run. Deterministic (no timestamps/commit); not the
  // graph and never validated — purely a metadata sidecar. Best-effort: a failed
  // cache write only forfeits the next incremental speedup, never corrupts state.
  try {
    writeJson(cachePath, bundlesToCache(bundles));
  } catch { /* cache best-effort */ }

  // Sidecar — non-deterministic facts ONLY (never in the graph).
  const elapsedMs = Date.now() - started;
  const subset = structuralSubset(out as { nodes: GraphNode[]; edges: GraphEdge[] });
  const refresh =
    stats.mode === "incremental"
      ? {
          reextracted_file_count: stats.reExtracted.length,
          reused_file_count: stats.reused.length,
          new_file_count: stats.newFiles.length,
          deleted_file_count: stats.deleted.length,
        }
      : {};
  const sidecar = {
    schema: "guild.structural_extraction_meta.v1",
    generated_at: new Date(started).toISOString(),
    generated_from_commit: headSha(repoRoot),
    wall_clock_ms: elapsedMs,
    file_count: relFiles.length,
    structural_node_count: subset.nodes.length,
    structural_edge_count: subset.edges.length,
    refresh_mode: stats.mode,
    ...refresh,
    model_calls: 0,
    network_calls: 0,
  };
  try {
    writeJson(`${outPath}.meta.json`, sidecar);
  } catch { /* sidecar best-effort */ }

  const modeNote =
    stats.mode === "incremental"
      ? `incremental (${stats.reExtracted.length} changed, ${stats.newFiles.length} new, ` +
        `${stats.deleted.length} deleted, ${stats.reused.length} reused)`
      : "full";
  process.stderr.write(
    `[extract-structural] ${subset.nodes.length} structural nodes · ` +
    `${subset.edges.length} structural edges · ${relFiles.length} files · ${modeNote} · ` +
    `${elapsedMs}ms · 0 model calls → ${path.relative(repoRoot, outPath)}\n`,
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  else process.stdout.write(path.relative(repoRoot, outPath) + "\n");
}

// Only run as a CLI; importing the module (tests) must not execute main().
if (require.main === module) {
  main();
}

export { main };
