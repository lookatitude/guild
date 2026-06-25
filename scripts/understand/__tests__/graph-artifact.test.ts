/**
 * understand/__tests__/graph-artifact.test.ts
 *
 * LANE G6 validation gate (non-vacuous). Run from plugin/scripts/:
 *   npx jest --no-coverage graph-artifact
 *
 * Gates (T6.1 brief / goals.md §G6):
 *   1. Round-trip   — export → wipe local graph+cache → import → incremental:
 *                     resulting structural graph EQUALS a from-scratch graph
 *                     (canonical equality). Non-vacuity: a LOCAL edit before
 *                     import is folded by incremental (bootstrap-then-incremental),
 *                     AND ≥1 unchanged file is reused (proves it is not a cold
 *                     full rebuild). Exercised through the REAL CLI.
 *   2. Integrity    — artifact round-trips with a checksum; a corrupt / truncated /
 *                     bad-magic / tampered artifact is REJECTED (ArtifactError);
 *                     the CLI --import falls back to full extraction (no crash).
 *   3. Opt-out      — the artifact is NOT written unless share_structural_graph is
 *                     set (or --force); enabling it writes the artifact.
 *   4. Security     — leak audit over the artifact fails closed on a seeded secret
 *                     (anti-vacuity: caught BEFORE packaging); a secret in a source
 *                     COMMENT is excluded by construction (0 findings). CLI export
 *                     of a secret-bearing graph exits 1 and writes nothing.
 *   + Determinism   — same (graph,cache) → byte-identical artifact; a stale-sha
 *                     graph normalizes to the same bytes; reversed file-input order
 *                     yields an identical artifact (cache is rel-sorted).
 *   + Containment   — artifact read/write is realpath-checked under .guild/indexes.
 *   + Model-free    — 0 model/network on the package/unpack path (import-closure).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import {
  buildBundles,
  bundlesToCache,
  assembleStructuralGraph,
  structuralSubset,
  type StructuralCache,
} from "../lib/structural";
import {
  ARTIFACT_BASENAME,
  ARTIFACT_SCHEMA,
  packageGraphArtifact,
  unpackGraphArtifact,
  auditForSecrets,
  assertContainedPath,
  ArtifactError,
  SecretLeakError,
  zstdAvailable,
} from "../lib/graph-artifact";
import type { KnowledgeGraph } from "../lib/schema";

const CLI = path.resolve(__dirname, "../graph-artifact.ts");
const EXTRACT = path.resolve(__dirname, "../extract-structural.ts");
const readFile = (abs: string) => fs.readFileSync(abs, "utf8");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpRepo(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}
function graphPathOf(dir: string): string {
  return path.join(dir, ".guild", "indexes", "knowledge-graph.json");
}
function artifactPathOf(dir: string): string {
  return path.join(dir, ".guild", "indexes", ARTIFACT_BASENAME);
}
function runCli(dir: string, args: string[]): { status: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", CLI, "--cwd", dir, ...args], { encoding: "utf8" });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: err.status ?? 1,
      out: String(err.stdout ?? "") + String(err.stderr ?? ""),
    };
  }
}
function runExtractFull(dir: string, outPath: string): void {
  execFileSync("npx", ["tsx", EXTRACT, "--cwd", dir, "--out", outPath], { encoding: "utf8" });
}

const A_TS = [
  'import { Base } from "./b";',
  "export function bar(): number { return 1; }",
  "export function foo(): number {",
  "  return bar() + bar();",
  "}",
  "export class Widget extends Base {}",
  "",
].join("\n");
const B_TS = [
  "export class Base {",
  '  greet(): string { return "hi"; }',
  "}",
  "",
].join("\n");

/** Build a real (graph, cache) pair from an in-memory-ish tree on disk. */
function buildGraphAndCache(dir: string, relFiles: string[]): { graph: KnowledgeGraph; cache: StructuralCache } {
  const bundles = buildBundles(dir, relFiles, readFile);
  const structural = assembleStructuralGraph(dir, bundles);
  const graph: KnowledgeGraph = {
    version: "guild.knowledge_graph.v1",
    kind: "codebase",
    generated_from_commit: "structural",
    project: { name: path.basename(dir), description: "" },
    nodes: structural.nodes,
    edges: structural.edges,
    layers: [],
    tour: [],
  };
  return { graph, cache: bundlesToCache(bundles) };
}

// ===========================================================================
// Gate 1 — Round-trip through the real CLI (export → wipe → import → incremental)
// ===========================================================================

describe("G6 gate 1 — round-trip == from-scratch (CLI, bootstrap-then-incremental)", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpRepo("g6-roundtrip-");
    write(dir, "a.ts", A_TS);
    write(dir, "b.ts", B_TS);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("export, edit locally, wipe, import+incremental → equals a from-scratch graph", () => {
    // 1) Full extraction at S0 + export the snapshot (opt-in via --force).
    runExtractFull(dir, graphPathOf(dir));
    const exp = runCli(dir, ["--export", "--force"]);
    expect(exp.status).toBe(0);
    expect(fs.existsSync(artifactPathOf(dir))).toBe(true);

    // 2) Simulate a fresh clone WITH a local delta: edit a.ts (S1), then wipe the
    //    locally-derived graph + cache but KEEP the committed artifact.
    write(dir, "a.ts", A_TS.replace("return bar() + bar();", "return bar() + bar() + bar();"));
    fs.rmSync(graphPathOf(dir), { force: true });
    fs.rmSync(`${graphPathOf(dir)}.structural-cache.json`, { force: true });
    expect(fs.existsSync(graphPathOf(dir))).toBe(false);

    // 3) Import: bootstrap from artifact, then incremental for the local delta.
    const imp = runCli(dir, ["--import"]);
    expect(imp.status).toBe(0);
    const imported = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;

    // 4) From-scratch on the SAME final tree (S1), to a side path.
    const scratchPath = path.join(dir, ".guild", "indexes", "scratch-graph.json");
    runExtractFull(dir, scratchPath);
    const scratch = JSON.parse(readFile(scratchPath)) as KnowledgeGraph;

    // Canonical equality of the structural subset (== `diff` exits 0).
    expect(JSON.stringify(structuralSubset(imported))).toBe(JSON.stringify(structuralSubset(scratch)));

    // Non-vacuity: the incremental sidecar proves a delta refresh, not a cold full
    // rebuild — b.ts (unchanged) was reused from the bootstrapped cache.
    const sidecar = JSON.parse(readFile(`${graphPathOf(dir)}.meta.json`)) as {
      refresh_mode: string;
      reused_file_count?: number;
    };
    expect(sidecar.refresh_mode).toBe("incremental");
    expect(sidecar.reused_file_count ?? 0).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Gate 2 — Integrity + corrupt rejection
// ===========================================================================

describe("G6 gate 2 — integrity / corrupt artifact rejected", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpRepo("g6-integrity-");
    write(dir, "a.ts", A_TS);
    write(dir, "b.ts", B_TS);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("package → unpack round-trips the graph (checksum verified)", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const { artifact, header } = packageGraphArtifact(graph, cache);
    expect(header.format).toBe(ARTIFACT_SCHEMA);
    const { envelope } = unpackGraphArtifact(artifact);
    expect(JSON.stringify(structuralSubset(envelope.graph))).toBe(
      JSON.stringify(structuralSubset(graph)),
    );
    expect(envelope.cache.schema).toBe("guild.structural_cache.v1");
  });

  test("zstd codec round-trips when available", () => {
    if (!zstdAvailable()) return; // runtime without zstd — gzip default covered elsewhere
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const { artifact, header } = packageGraphArtifact(graph, cache, { codec: "zstd" });
    expect(header.codec).toBe("zstd");
    const { envelope } = unpackGraphArtifact(artifact);
    expect(JSON.stringify(envelope.graph)).toBe(JSON.stringify(graph));
  });

  test("corrupt / truncated / bad-magic / tampered artifacts are REJECTED", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const { artifact } = packageGraphArtifact(graph, cache);

    // anti-vacuity: the pristine buffer unpacks fine, so each rejection below bites.
    expect(() => unpackGraphArtifact(artifact)).not.toThrow();

    // flip a byte deep in the compressed payload → sha/decompress mismatch.
    const corrupt = Buffer.from(artifact);
    corrupt[corrupt.length - 1] ^= 0xff;
    expect(() => unpackGraphArtifact(corrupt)).toThrow(ArtifactError);

    // truncate.
    expect(() => unpackGraphArtifact(artifact.subarray(0, 20))).toThrow(ArtifactError);

    // bad magic.
    const badMagic = Buffer.from(artifact);
    badMagic[0] ^= 0xff;
    expect(() => unpackGraphArtifact(badMagic)).toThrow(ArtifactError);

    // tamper a content byte (not the trailing one) — still caught by the SHA-256.
    const tampered = Buffer.from(artifact);
    tampered[Math.floor(tampered.length / 2)] ^= 0x01;
    expect(() => unpackGraphArtifact(tampered)).toThrow(ArtifactError);
  });

  test("CLI --import falls back to full extraction on a corrupt artifact (no crash)", () => {
    fs.mkdirSync(path.dirname(artifactPathOf(dir)), { recursive: true });
    fs.writeFileSync(artifactPathOf(dir), Buffer.from("not a real artifact"));
    const imp = runCli(dir, ["--import"]);
    expect(imp.status).toBe(0); // fell back, did not crash
    expect(fs.existsSync(graphPathOf(dir))).toBe(true); // full extraction produced a graph
    const g = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;
    expect(g.nodes.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Gate 3 — Opt-out default
// ===========================================================================

describe("G6 gate 3 — opt-out default (not written unless enabled)", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpRepo("g6-optout-");
    write(dir, "a.ts", A_TS);
    write(dir, "b.ts", B_TS);
    runExtractFull(dir, graphPathOf(dir));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("export without the flag writes NOTHING and exits 0", () => {
    const r = runCli(dir, ["--export"]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(artifactPathOf(dir))).toBe(false);
  });

  test("--force writes the artifact", () => {
    const r = runCli(dir, ["--export", "--force"]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(artifactPathOf(dir))).toBe(true);
  });

  test("defaults.share_structural_graph: true writes without --force", () => {
    write(dir, ".guild/settings.json", JSON.stringify({ defaults: { share_structural_graph: true } }));
    const r = runCli(dir, ["--export"]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(artifactPathOf(dir))).toBe(true);
  });
});

// ===========================================================================
// Gate 4 — Security (leak audit, fail closed)
// ===========================================================================

describe("G6 gate 4 — leak audit over the artifact", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpRepo("g6-secrets-");
    write(dir, "a.ts", A_TS);
    write(dir, "b.ts", B_TS);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("seeded secret in the payload is caught BEFORE packaging (fail closed)", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    // anti-vacuity: clean graph packages with zero findings...
    expect(() => packageGraphArtifact(graph, cache)).not.toThrow();
    // ...inject a known secret into a human field → packaging refuses.
    const seeded: KnowledgeGraph = {
      ...graph,
      project: { ...graph.project, description: 'api_key = "AKIAIOSFODNN7EXAMPLE"' },
    };
    let thrown: unknown;
    try {
      packageGraphArtifact(seeded, cache);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SecretLeakError);
    expect((thrown as SecretLeakError).findings.length).toBeGreaterThan(0);
  });

  test("the benign per-file SHA-256 fingerprints do NOT false-positive", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    // cache.files[*].contentHash are 64-char hex SHA-256 — must not be flagged.
    expect(Object.values(cache.files).every((b) => /^[0-9a-f]{64}$/.test(b.contentHash))).toBe(true);
    expect(auditForSecrets(JSON.stringify({ graph, cache }))).toEqual([]);
  });

  test("a secret in a source COMMENT is excluded by construction (0 findings)", () => {
    // Structural extraction carries no comments/snippets — only names + paths.
    write(dir, "c.ts", '// password = "supersecret123"\nexport function safe(): void {}\n');
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts", "c.ts"]);
    const { artifact } = packageGraphArtifact(graph, cache); // no throw
    const { envelope } = unpackGraphArtifact(artifact);
    const text = JSON.stringify(envelope);
    expect(text.includes("supersecret123")).toBe(false);
  });

  test("CLI export of a secret-bearing graph exits 1 and writes nothing", () => {
    runExtractFull(dir, graphPathOf(dir));
    const g = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;
    g.project.description = 'password = "hunter2xyz"';
    fs.writeFileSync(graphPathOf(dir), JSON.stringify(g, null, 2) + "\n");
    const r = runCli(dir, ["--export", "--force"]);
    expect(r.status).toBe(1);
    expect(fs.existsSync(artifactPathOf(dir))).toBe(false);
  });
});

// ===========================================================================
// Determinism
// ===========================================================================

describe("G6 determinism", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpRepo("g6-determ-");
    write(dir, "a.ts", A_TS);
    write(dir, "b.ts", B_TS);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("same (graph,cache) → byte-identical artifact", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const x = packageGraphArtifact(graph, cache).artifact;
    const y = packageGraphArtifact(graph, cache).artifact;
    expect(x.equals(y)).toBe(true);
  });

  test("a stale generated_from_commit normalizes → same bytes as a clean graph", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const clean = packageGraphArtifact(graph, cache).artifact;
    const stale = packageGraphArtifact(
      { ...graph, generated_from_commit: "deadbeefcafef00ddeadbeefcafef00ddeadbeef" },
      cache,
    ).artifact;
    expect(stale.equals(clean)).toBe(true);
  });

  test("reversed file-input order yields an identical artifact (cache is rel-sorted)", () => {
    const forward = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const reversed = buildGraphAndCache(dir, ["b.ts", "a.ts"]);
    const x = packageGraphArtifact(forward.graph, forward.cache).artifact;
    const y = packageGraphArtifact(reversed.graph, reversed.cache).artifact;
    expect(x.equals(y)).toBe(true);
  });
});

// ===========================================================================
// Path containment
// ===========================================================================

describe("G6 path containment", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpRepo("g6-contain-");
    fs.mkdirSync(path.join(dir, ".guild", "indexes"), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("an in-dir path resolves; a ../ escape is rejected", () => {
    const base = path.join(dir, ".guild", "indexes");
    expect(assertContainedPath(path.join(base, ARTIFACT_BASENAME), base)).toBe(
      path.join(base, ARTIFACT_BASENAME),
    );
    expect(() => assertContainedPath(path.join(base, "..", "..", "escape"), base)).toThrow(
      ArtifactError,
    );
    expect(() => assertContainedPath("/etc/passwd", base)).toThrow(ArtifactError);
  });
});

// ===========================================================================
// Model-free / zero-network (import-closure scan)
// ===========================================================================

describe("G6 model-free", () => {
  test("the lib's transitive import closure performs no network/model I/O", () => {
    const seen = new Set<string>();
    const banned = /\b(require|from)\s*\(?\s*["'](https?|node:https?|http|https|net|tls|dgram|@anthropic|openai)/;
    const isFile = (p: string): boolean => {
      try { return fs.statSync(p).isFile(); } catch { return false; }
    };
    const visit = (file: string): void => {
      const real = path.resolve(file);
      if (seen.has(real) || !isFile(real)) return;
      seen.add(real);
      const src = readFile(real);
      expect(src).not.toMatch(banned);
      const dir = path.dirname(real);
      const importRe = /(?:from|require\()\s*["'](\.[^"']+)["']/g;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(src)) !== null) {
        const cand = path.resolve(dir, m[1]);
        for (const target of [cand + ".ts", cand + ".tsx", path.join(cand, "index.ts"), cand + ".js", cand]) {
          if (isFile(target)) { visit(target); break; }
        }
      }
    };
    visit(path.resolve(__dirname, "../lib/graph-artifact.ts"));
    expect(seen.size).toBeGreaterThan(1);
  });
});
