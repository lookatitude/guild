#!/usr/bin/env -S npx tsx
/**
 * understand/graph-artifact.ts — LANE G6 committable team graph artifact (CLI).
 *
 * Opt-in, committable, compressed structural-graph snapshot so teammates skip the
 * cold structural pass (goals.md §G6). Two verbs:
 *
 *   --export   Package `.guild/indexes/knowledge-graph.json` (+ its fingerprint
 *              cache) into `.guild/indexes/structural-graph.json.zst`. Written
 *              ONLY when the operator opts in via `defaults.share_structural_graph`
 *              in `.guild/settings.json` (or `--force`). Default = NOT written.
 *              Fails closed (non-zero, nothing written) if a leak audit finds a
 *              secret in the payload.
 *
 *   --import   On a fresh clone: decode + integrity-check the artifact, write the
 *              bootstrap graph + fingerprint cache, then run G4 incremental for the
 *              local delta (bootstrap-then-incremental). A missing/corrupt artifact
 *              falls back to a full extraction — never crashes.
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
import { buildBundles, bundlesToCache, type StructuralCache } from "./lib/structural";
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
    return assertContainedPath(raw, gp.indexesDir);
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

function doExport(cwd: string, argv: string[]): number {
  const gp = guildPaths(cwd);
  const repoRoot = gp.repoRoot;
  // Path containment FIRST — refuse an escaping --out before any read/write/spawn.
  const graphPath = resolveGraphPath(argv, gp);
  if (graphPath === null) {
    process.stderr.write(`[graph-artifact] refusing --out outside .guild/indexes\n`);
    return 1;
  }
  const cachePath = `${graphPath}.structural-cache.json`;

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

  // The bootstrap fingerprint cache: prefer the sidecar the extractor already
  // wrote; else build it deterministically from the current tree so export works
  // standalone. Either way it is a pure function of the source tree.
  let cache = readJson<StructuralCache>(cachePath);
  if (!cache || !cache.files) {
    const cm = readJson<{ files: { path: string }[] }>(gp.codebaseMap);
    const relFiles = cm?.files?.map((f) => f.path) ?? walkRepo(repoRoot).files;
    const readFile = (abs: string) => fs.readFileSync(abs, "utf8");
    cache = bundlesToCache(buildBundles(repoRoot, relFiles, readFile));
  }

  let pkg;
  try {
    pkg = packageGraphArtifact(graph, cache, { codec });
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
    artifactPath = assertContainedPath(path.join(gp.indexesDir, ARTIFACT_BASENAME), gp.indexesDir);
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
  const cachePath = `${graphPath}.structural-cache.json`;

  // Decode + integrity-check the artifact. Any failure → full-extraction fallback.
  let envelope;
  try {
    const artifactPath = assertContainedPath(path.join(gp.indexesDir, ARTIFACT_BASENAME), gp.indexesDir);
    const buf = fs.readFileSync(artifactPath);
    envelope = unpackGraphArtifact(buf).envelope;
  } catch (err) {
    const why = err instanceof ArtifactError ? err.message : err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[graph-artifact] no usable artifact (${why}) → full extraction fallback (no crash)\n`,
    );
    return runExtractor(repoRoot, graphPath, /* incremental */ false);
  }

  // Bootstrap: write the snapshot graph + fingerprint cache, then incrementally
  // refresh ONLY the local delta against the working tree (bootstrap-then-incremental).
  try {
    writeJson(graphPath, envelope.graph);
    writeJson(cachePath, envelope.cache);
  } catch (err) {
    process.stderr.write(`[graph-artifact] bootstrap write error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  process.stderr.write(`[graph-artifact] bootstrapped from artifact → incremental for local delta\n`);
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
