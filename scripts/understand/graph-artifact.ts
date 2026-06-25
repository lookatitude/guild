#!/usr/bin/env -S npx tsx
/**
 * understand/graph-artifact.ts — LANE G6 committable team graph artifact (CLI).
 *
 * Opt-in, committable, compressed structural-graph snapshot so teammates skip the
 * cold structural pass (goals.md §G6). Two verbs:
 *
 *   --export   Package `.guild/indexes/knowledge-graph.json` (+ a flat per-file
 *              fingerprint map) into `.guild/indexes/structural-graph.json.zst`.
 *              Written ONLY when the operator opts in via
 *              `defaults.share_structural_graph` in `.guild/settings.json` (or
 *              `--force`). Default = NOT written. Fails closed (non-zero, nothing
 *              written) if a leak audit finds a secret in the payload.
 *
 *   --import   On a fresh clone: drop any preexisting local structural-cache
 *              sidecar (a clean import never inherits a stale/foreign cache —
 *              FIX-T6.1-r6), decode + integrity-check the artifact, write the
 *              bootstrap graph with its structural subset STRIPPED (so the local
 *              re-extraction is the sole author of structural data — the artifact's
 *              structural tier is never trusted), then run G4 incremental to
 *              (re)build the structural tier locally for the working tree. With the
 *              cache gone the first incremental is a full rebuild == from-scratch. A
 *              missing/corrupt artifact falls back to a full extraction — never
 *              crashes.
 *
 * ARCHITECTURAL SIMPLIFICATION (FIX-T6.1-r5): the artifact ships ONLY the canonical
 * graph + a flat `{ path: sha }` fingerprint map — NOT the per-file structural-cache
 * bundles. The local structural cache is rebuilt locally (lazily repopulated by the
 * G4 extractor) and NEVER imported from the artifact. This removes the entire
 * "validate an untrusted cache element" surface; `validateGraph` is the sole
 * structural-validation surface, and the fingerprint map is a trivially-validatable
 * flat map. The expensive LLM tier (nodes/edges/layers/tour) IS preserved on import
 * — that is the bootstrap benefit.
 *
 * File-first (NOT SQLite). Deterministic (commit/timestamp facts live in the
 * `.meta.json` sidecar only). Model-free, zero-network. Path-contained: every
 * artifact read/write is realpath-checked under `.guild/indexes/`.
 *
 * Usage:
 *   npx tsx graph-artifact.ts --cwd <root> --export [--force] [--codec=gzip|zstd]
 *   npx tsx graph-artifact.ts --cwd <root> --import
 * Exit: 0 ok (incl. opt-out skip + corrupt-artifact fallback) · 1 error.
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { guildPaths, parseCwd, parseFlag, hasFlag, writeJson, readJson } from "./lib/paths";
import { walkRepo } from "./lib/walk";
import { contentHash } from "./lib/fingerprint";
import { stripStructural } from "./lib/structural";
import {
  ARTIFACT_BASENAME,
  assertContainedPath,
  packageGraphArtifact,
  unpackGraphArtifact,
  zstdAvailable,
  SecretLeakError,
  ArtifactError,
  type Codec,
} from "./lib/graph-artifact";
import type { KnowledgeGraph } from "./lib/schema";

/** `.guild/settings.json` → `defaults.share_structural_graph === true`. */
function shareFlagEnabled(guildDir: string): boolean {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(guildDir, "settings.json"), "utf8")) as {
      defaults?: { share_structural_graph?: unknown };
    };
    return s.defaults?.share_structural_graph === true;
  } catch {
    return false;
  }
}

/**
 * Resolve the graph output path, containing any `--out` override under
 * `.guild/indexes/` (Codex FIX-T6.1 #1). `--out` is operator-supplied, so it is
 * realpath-checked under the indexes dir BEFORE any read/write/spawn touches it —
 * an absolute or `../` escape is REFUSED (returns null). The default
 * (`gp.knowledgeGraph`) is constructed under the indexes dir and trusted as-is.
 */
function resolveGraphPath(argv: string[], gp: ReturnType<typeof guildPaths>): string | null {
  const raw = parseFlag(argv, "out");
  if (raw === undefined) return gp.knowledgeGraph;
  // realpathSync(baseDir) inside assertContainedPath needs the dir to exist.
  fs.mkdirSync(gp.indexesDir, { recursive: true });
  try {
    // repo-anchor the containment base: a symlinked .guild/indexes pointing outside
    // the repo must NOT become the containment root (Codex FIX-T6.1-r3 #1).
    return assertContainedPath(raw, gp.indexesDir, gp.repoRoot);
  } catch {
    return null;
  }
}

/** Run the G4 extractor as a child process (the lane may NOT edit it — only invoke it). */
function runExtractor(cwd: string, graphPath: string, incremental: boolean): number {
  const script = path.join(__dirname, "extract-structural.ts");
  const args = ["tsx", script, "--cwd", cwd, "--out", graphPath];
  if (incremental) args.push("--incremental");
  const r = spawnSync("npx", args, { stdio: "inherit" });
  return r.status ?? 1;
}

/**
 * Remove any preexisting LOCAL structural-cache sidecar before the first
 * post-import extraction (Codex FIX-T6.1-r6). A clean import must (re)build its
 * local cache FRESH from the validated bootstrap graph + live source — it must
 * NEVER inherit a stale or foreign `${graphPath}.structural-cache.json` (e.g. a
 * legacy cache left by an earlier import or a now-superseded extraction). The
 * incremental rebuild at the end of doImport keys reuse on `contentHash`, so a
 * stale bundle whose `contentHash` happens to match the live file would be reused
 * wholesale and the post-import structural tier could DIVERGE from a from-scratch
 * extraction. Removing the sidecar forces the first `--incremental` run to find no
 * usable cache → full rebuild → byte-for-byte == from-scratch, then seeds the
 * trusted local cache for LATER incrementals. The path is the extractor's own
 * cache path (derived from the already-contained graphPath), so it stays under
 * `.guild/indexes/`. Best-effort: a missing sidecar is the normal case.
 */
function removeStaleLocalCache(graphPath: string): void {
  try {
    fs.rmSync(`${graphPath}.structural-cache.json`, { force: true });
  } catch {
    /* best-effort: if it cannot be removed the extractor still re-validates every
       reused bundle, but a clean import is no longer guaranteed == from-scratch. */
  }
}

/**
 * Build the flat per-file fingerprint map `{ rel: content-sha }` packaged in the
 * artifact (FIX-T6.1-r5) — the snapshot baseline for the first incremental diff.
 * Pure function of the source tree; rel-sorted insertion for deterministic bytes.
 * Carries NO structural data (no nodes/edges/bundles) — nothing to deep-validate.
 */
function buildFingerprintMap(repoRoot: string, relFiles: string[]): Record<string, string> {
  const fp: Record<string, string> = {};
  for (const rel of [...relFiles].sort()) {
    try {
      fp[rel] = contentHash(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
    } catch {
      /* unreadable file → omit (no fingerprint); the importer treats it as new). */
    }
  }
  return fp;
}

function doExport(cwd: string, argv: string[]): number {
  const gp = guildPaths(cwd);
  const repoRoot = gp.repoRoot;
  // Path containment FIRST — refuse an escaping --out before any read/write/spawn.
  const graphPath = resolveGraphPath(argv, gp);
  if (graphPath === null) {
    process.stderr.write(`[graph-artifact] refusing --out outside .guild/indexes\n`);
    return 1;
  }

  // Opt-out default (gate #3): never write unless the operator opted in.
  if (!hasFlag(argv, "force") && !shareFlagEnabled(gp.guildDir)) {
    process.stderr.write(
      `[graph-artifact] export skipped — opt-in only. Set defaults.share_structural_graph: true ` +
        `in .guild/settings.json (or pass --force) to write ${ARTIFACT_BASENAME}.\n`,
    );
    return 0;
  }

  // Codec: gzip by default (no dep, universally decompressible); zstd opt-in.
  const codecFlag = parseFlag(argv, "codec");
  let codec: Codec = "gzip";
  if (codecFlag !== undefined) {
    if (codecFlag !== "gzip" && codecFlag !== "zstd") {
      process.stderr.write(`[graph-artifact] invalid --codec "${codecFlag}" (gzip|zstd)\n`);
      return 1;
    }
    if (codecFlag === "zstd" && !zstdAvailable()) {
      process.stderr.write(`[graph-artifact] --codec=zstd unsupported by this runtime\n`);
      return 1;
    }
    codec = codecFlag;
  }

  const graph = readJson<KnowledgeGraph>(graphPath);
  if (!graph) {
    process.stderr.write(`[graph-artifact] no graph at ${path.relative(repoRoot, graphPath)} — run extract-structural first\n`);
    return 1;
  }

  // The bootstrap fingerprint map: a pure function of the current source tree.
  // Prefer the deterministic scan's shared inventory; else walk.
  const cm = readJson<{ files: { path: string }[] }>(gp.codebaseMap);
  const relFiles = cm?.files?.map((f) => f.path) ?? walkRepo(repoRoot).files;
  const fingerprints = buildFingerprintMap(repoRoot, relFiles);

  let pkg;
  try {
    pkg = packageGraphArtifact(graph, fingerprints, { codec });
  } catch (err) {
    if (err instanceof SecretLeakError) {
      process.stderr.write(`[graph-artifact] FAIL CLOSED: ${err.message}\n`);
      return 1;
    }
    process.stderr.write(`[graph-artifact] package error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // Path containment: realpath-check the destination is under .guild/indexes/.
  fs.mkdirSync(gp.indexesDir, { recursive: true });
  let artifactPath: string;
  try {
    artifactPath = assertContainedPath(path.join(gp.indexesDir, ARTIFACT_BASENAME), gp.indexesDir, gp.repoRoot);
  } catch (err) {
    process.stderr.write(`[graph-artifact] refusing unsafe path: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  try {
    fs.writeFileSync(artifactPath, pkg.artifact);
  } catch (err) {
    process.stderr.write(`[graph-artifact] write error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // Sidecar — nondeterministic facts ONLY (never in the artifact).
  try {
    writeJson(`${artifactPath}.meta.json`, {
      schema: "guild.structural_graph_artifact_meta.v1",
      generated_at: new Date().toISOString(),
      codec: pkg.header.codec,
      sha256: pkg.header.sha256,
      uncompressed_bytes: pkg.header.uncompressed_bytes,
      compressed_bytes: pkg.artifact.length,
      fingerprint_file_count: Object.keys(fingerprints).length,
    });
  } catch { /* sidecar best-effort */ }

  process.stderr.write(
    `[graph-artifact] exported ${path.relative(repoRoot, artifactPath)} · ${pkg.header.codec} · ` +
      `${pkg.header.uncompressed_bytes}→${pkg.artifact.length} bytes\n`,
  );
  process.stdout.write(path.relative(repoRoot, artifactPath) + "\n");
  return 0;
}

function doImport(cwd: string, argv: string[]): number {
  const gp = guildPaths(cwd);
  const repoRoot = gp.repoRoot;
  // Path containment FIRST — refuse an escaping --out before any read/write/spawn.
  const graphPath = resolveGraphPath(argv, gp);
  if (graphPath === null) {
    process.stderr.write(`[graph-artifact] refusing --out outside .guild/indexes\n`);
    return 1;
  }

  // A clean import owns its local cache: drop any preexisting (stale/foreign)
  // structural-cache sidecar BEFORE either extraction below, so neither the
  // corrupt-artifact full-rebuild fallback nor the post-bootstrap incremental
  // rebuild can reuse it. The post-import structural tier is then always == from-
  // scratch (Codex FIX-T6.1-r6).
  removeStaleLocalCache(graphPath);

  // Decode + integrity-check the artifact. Any failure (bad integrity, a graph that
  // is not a validation fixpoint, OR a malformed fingerprint map) → full-extraction
  // fallback.
  let envelope;
  try {
    const artifactPath = assertContainedPath(path.join(gp.indexesDir, ARTIFACT_BASENAME), gp.indexesDir, gp.repoRoot);
    const buf = fs.readFileSync(artifactPath);
    envelope = unpackGraphArtifact(buf).envelope;
  } catch (err) {
    const why = err instanceof ArtifactError ? err.message : err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[graph-artifact] no usable artifact (${why}) → full extraction fallback (no crash)\n`,
    );
    return runExtractor(repoRoot, graphPath, /* incremental */ false);
  }

  // Bootstrap: write the validated graph with its STRUCTURAL SUBSET STRIPPED. The
  // expensive LLM-tier nodes/edges/layers/tour are preserved (the bootstrap
  // benefit); the cheap structural tier is then re-authored locally by the G4
  // extractor below, which merges the freshly-extracted structural data into this
  // base. The artifact's structural data is therefore NEVER trusted as final — it
  // is rebuilt from the working tree, removing the untrusted-cache surface entirely.
  const base = stripStructural(envelope.graph.nodes, envelope.graph.edges);
  const bootstrap: KnowledgeGraph = { ...envelope.graph, nodes: base.nodes, edges: base.edges };
  try {
    writeJson(graphPath, bootstrap);
  } catch (err) {
    process.stderr.write(`[graph-artifact] bootstrap write error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  // The imported fingerprint map is the snapshot baseline for the first incremental
  // diff: report how the working tree differs from it (a malformed map was already
  // rejected by unpackGraphArtifact → fallback above, so this map is well-formed).
  // The structural tier is then rebuilt IN FULL locally — lossless and never
  // trusting the artifact's structural data. The local cache is seeded/repopulated
  // by this G4 run (it is the trusted, locally-produced reuse baseline for LATER
  // incrementals).
  const liveFiles = walkRepo(repoRoot).files;
  const liveSet = new Set(liveFiles);
  const fp = envelope.fingerprints;
  let changed = 0;
  let added = 0;
  for (const rel of liveFiles) {
    let live: string;
    try {
      live = contentHash(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
    } catch {
      continue;
    }
    if (!(rel in fp)) added++;
    else if (fp[rel] !== live) changed++;
  }
  let deleted = 0;
  for (const rel of Object.keys(fp)) if (!liveSet.has(rel)) deleted++;

  process.stderr.write(
    `[graph-artifact] bootstrapped from artifact (snapshot delta: ${changed} changed, ${added} new, ` +
      `${deleted} deleted) → local structural rebuild (cache never imported from artifact)\n`,
  );
  return runExtractor(repoRoot, graphPath, /* incremental */ true);
}

function main(): number {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const isExport = hasFlag(argv, "export");
  const isImport = hasFlag(argv, "import");
  if (isExport === isImport) {
    process.stderr.write(`[graph-artifact] specify exactly one of --export | --import\n`);
    return 1;
  }
  return isExport ? doExport(cwd, argv) : doImport(cwd, argv);
}

// Only run as a CLI; importing the module (tests) must not execute main().
if (require.main === module) {
  process.exit(main());
}

export { main, doExport, doImport };
