/**
 * understand/__tests__/graph-artifact.test.ts
 *
 * LANE G6 validation gate (non-vacuous). Run from plugin/scripts/:
 *   npx jest --no-coverage graph-artifact
 *
 * ARCHITECTURAL SIMPLIFICATION (FIX-T6.1-r5): the artifact ships ONLY the canonical
 * graph + a flat `{ path: sha }` fingerprint map — NOT the per-file structural-cache
 * bundles. `validateGraph` is the SOLE structural-validation surface; the fingerprint
 * map is a trivially-validatable flat map. The local structural cache is rebuilt
 * locally and NEVER imported from the artifact (removing the deep cache-validation
 * surface rounds 1–5 chased). The expensive LLM tier IS preserved on import — the
 * bootstrap benefit.
 *
 * Gates (T6.1-r5 brief / goals.md §G6):
 *   1. Round-trip   — export → edit locally → wipe local graph+cache → import: the
 *                     resulting structural graph EQUALS a from-scratch graph
 *                     (canonical equality), AND the snapshot's LLM-tier node survives
 *                     (proving the freshly-extracted structural tier merged INTO the
 *                     bootstrapped graph, not a cold structural-only rebuild).
 *                     Exercised through the REAL CLI.
 *   2. Integrity    — artifact round-trips with a checksum; a corrupt / truncated /
 *                     bad-magic / tampered artifact, a graph that is not a validation
 *                     fixpoint, AND a malformed fingerprint map are all REJECTED
 *                     (ArtifactError); the CLI --import falls back to full extraction
 *                     (no crash). NO code path imports cache bundles from the artifact.
 *   3. Opt-out      — the artifact is NOT written unless share_structural_graph is
 *                     set (or --force); enabling it writes the artifact.
 *   4. Security     — leak audit over the artifact fails closed on a seeded secret
 *                     (anti-vacuity: caught BEFORE packaging); a secret in a source
 *                     COMMENT is excluded by construction (0 findings). CLI export
 *                     of a secret-bearing graph exits 1 and writes nothing.
 *   + Determinism   — same (graph,fingerprints) → byte-identical artifact; a stale-sha
 *                     graph normalizes to the same bytes; reversed file-input order
 *                     yields an identical artifact (fingerprint map is rel-sorted).
 *   + Containment   — artifact read/write is realpath-checked under .guild/indexes.
 *   + Model-free    — 0 model/network on the package/unpack path (import-closure).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";
import { execFileSync, spawnSync } from "child_process";

import {
  buildBundles,
  assembleStructuralGraph,
  structuralSubset,
} from "../lib/structural";
import { contentHash } from "../lib/fingerprint";
import {
  ARTIFACT_BASENAME,
  ARTIFACT_SCHEMA,
  packageGraphArtifact,
  unpackGraphArtifact,
  auditForSecrets,
  assertContainedPath,
  canonicalJson,
  validateFingerprintMap,
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
/** Like runCli but captures stdout AND stderr regardless of exit code (the CLI's
 *  diagnostics — and the inherited extractor output — go to stderr even on exit 0). */
function runCliBoth(dir: string, args: string[]): { status: number; out: string } {
  const r = spawnSync("npx", ["tsx", CLI, "--cwd", dir, ...args], { encoding: "utf8" });
  return { status: r.status ?? 1, out: String(r.stdout ?? "") + String(r.stderr ?? "") };
}

/**
 * Manually frame an artifact buffer from a raw envelope object (test-only). Mirrors
 * the lib's container framing (MAGIC + 4-byte BE header len + JSON header + gzip
 * payload + integrity SHA-256). Used to inject a payload the lib's own packager
 * would refuse to build (a non-fixpoint graph, a malformed fingerprint map) so the
 * IMPORT-side rejection is exercised with a valid checksum.
 */
function frameArtifact(envelopeObj: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(envelopeObj, null, 2) + "\n", "utf8");
  const compressed = zlib.gzipSync(payload);
  const header = {
    format: ARTIFACT_SCHEMA,
    codec: "gzip",
    sha256: crypto.createHash("sha256").update(payload).digest("hex"),
    uncompressed_bytes: payload.length,
  };
  const headerBuf = Buffer.from(JSON.stringify(header), "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(headerBuf.length, 0);
  return Buffer.concat([Buffer.from("GLDSGA01", "ascii"), lenBuf, headerBuf, compressed]);
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

/** An LLM-tier node that structural extraction would NEVER emit — used to prove the
 *  bootstrap base (not a cold rebuild) is what the import merges into. */
const LLM_NODE = {
  id: "concept:demo-feature",
  type: "concept",
  name: "Demo Feature",
  source_refs: ["a.ts"],
  confidence: "high",
  description: "an LLM-tier node not produced by structural extraction",
};

/** Build a real (graph, fingerprints) pair from an on-disk tree. */
function buildGraphAndFingerprints(
  dir: string,
  relFiles: string[],
): { graph: KnowledgeGraph; fingerprints: Record<string, string> } {
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
  const fingerprints: Record<string, string> = {};
  for (const rel of [...relFiles].sort()) {
    fingerprints[rel] = contentHash(readFile(path.join(dir, rel)));
  }
  return { graph, fingerprints };
}

// ===========================================================================
// Gate 1 — Round-trip == from-scratch (CLI, bootstrap-then-local-rebuild)
// ===========================================================================

describe("G6 gate 1 — round-trip == from-scratch (CLI, bootstrap preserves LLM tier)", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpRepo("g6-roundtrip-");
    write(dir, "a.ts", A_TS);
    write(dir, "b.ts", B_TS);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("export (graph+fingerprints) → edit, wipe, import → equals from-scratch AND keeps the LLM node", () => {
    // 1) Full extraction at S0, then inject an LLM-tier node into the graph and
    //    export the snapshot (opt-in via --force).
    runExtractFull(dir, graphPathOf(dir));
    const g0 = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;
    g0.nodes.push(LLM_NODE as never);
    fs.writeFileSync(graphPathOf(dir), JSON.stringify(g0, null, 2) + "\n");
    const exp = runCli(dir, ["--export", "--force"]);
    expect(exp.status).toBe(0);
    expect(fs.existsSync(artifactPathOf(dir))).toBe(true);

    // 2) Simulate a fresh clone WITH a local delta: edit a.ts (S1), then wipe the
    //    locally-derived graph + any local cache but KEEP the committed artifact.
    write(dir, "a.ts", A_TS.replace("return bar() + bar();", "return bar() + bar() + bar();"));
    fs.rmSync(graphPathOf(dir), { force: true });
    fs.rmSync(`${graphPathOf(dir)}.structural-cache.json`, { force: true });
    expect(fs.existsSync(graphPathOf(dir))).toBe(false);

    // 3) Import: bootstrap from artifact (strip structural, keep LLM tier), then
    //    rebuild the structural tier locally for the working tree.
    const imp = runCli(dir, ["--import"]);
    expect(imp.status).toBe(0);
    const imported = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;

    // 4) From-scratch on the SAME final tree (S1), to a side path.
    const scratchPath = path.join(dir, ".guild", "indexes", "scratch-graph.json");
    runExtractFull(dir, scratchPath);
    const scratch = JSON.parse(readFile(scratchPath)) as KnowledgeGraph;

    // Canonical equality of the structural subset (== `diff` exits 0): the local
    // edit is folded in and the import is lossless vs a clean rebuild.
    expect(JSON.stringify(structuralSubset(imported))).toBe(JSON.stringify(structuralSubset(scratch)));

    // Non-vacuity (bootstrap benefit): the snapshot's LLM-tier node SURVIVED — the
    // freshly-extracted structural tier merged INTO the bootstrapped graph. A cold
    // structural-only rebuild (what a from-scratch run produces) does NOT carry it.
    expect(imported.nodes.some((n) => n.id === LLM_NODE.id)).toBe(true);
    expect(scratch.nodes.some((n) => n.id === LLM_NODE.id)).toBe(false);

    // Non-vacuity (no blind dump): the imported structural subset is the LIVE tree
    // (S1), NOT the snapshot's S0 structural — proving the structural tier was
    // re-extracted locally, not trusted from the artifact.
    expect(JSON.stringify(structuralSubset(imported))).not.toBe(
      JSON.stringify(structuralSubset(g0)),
    );
  });

  test("a preexisting STALE structural-cache sidecar is NOT reused on import → post-import == from-scratch (FIX-T6.1-r6)", () => {
    // 1) Seed a GENUINE local cache (V1) and export the V1 snapshot.
    runExtractFull(dir, graphPathOf(dir)); // writes graphPath.structural-cache.json (V1)
    const cachePath = `${graphPathOf(dir)}.structural-cache.json`;
    const v1Cache = JSON.parse(readFile(cachePath)) as {
      version: string;
      files: Record<string, { contentHash: string }>;
    };
    expect(v1Cache.files["a.ts"]).toBeDefined(); // setup is valid
    const exp = runCli(dir, ["--export", "--force"]);
    expect(exp.status).toBe(0);

    // 2) Evolve a.ts to V2 — a structurally DIFFERENT tree (adds exported `baz`).
    const A_V2 = A_TS + "export function baz(): number { return 42; }\n";
    write(dir, "a.ts", A_V2);
    const v2Hash = contentHash(A_V2);

    // 3) Plant a STALE cache that LIES: it still carries the V1 bundle for a.ts but
    //    stamps it with V2's contentHash. The version stamp is kept CURRENT so the
    //    whole-cache version invalidation does NOT fire — this isolates the sidecar
    //    removal as the SOLE protection. If reused, the graph would carry V1
    //    structure (NO `baz`). Wipe only the local graph; KEEP the poisoned cache +
    //    the committed artifact (mirrors a fresh clone with a leftover local cache).
    v1Cache.files["a.ts"].contentHash = v2Hash;
    fs.rmSync(graphPathOf(dir), { force: true });
    fs.writeFileSync(cachePath, JSON.stringify(v1Cache, null, 2));
    expect(fs.existsSync(cachePath)).toBe(true); // the stale sidecar is present pre-import

    // 4) Import: must drop the stale sidecar and rebuild structural from live source.
    const imp = runCli(dir, ["--import"]);
    expect(imp.status).toBe(0);
    const imported = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;

    // 5) From-scratch on the SAME V2 tree.
    const scratchPath = path.join(dir, ".guild", "indexes", "scratch-graph.json");
    runExtractFull(dir, scratchPath);
    const scratch = JSON.parse(readFile(scratchPath)) as KnowledgeGraph;

    const importedSubset = JSON.stringify(structuralSubset(imported));
    // post-import structural subset == from-scratch: the stale cache was NOT reused.
    expect(importedSubset).toBe(JSON.stringify(structuralSubset(scratch)));
    // Non-vacuity (would FAIL if the stale V1 bundle were reused): the result
    // reflects the LIVE V2 tree — it carries `baz`, which the V1 bundle lacks.
    expect(importedSubset).toContain("baz");
  });
});

// ===========================================================================
// Gate 2 — Integrity + corrupt/fixpoint/fingerprint rejection + no cache import
// ===========================================================================

describe("G6 gate 2 — integrity / rejection / no cache imported", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpRepo("g6-integrity-");
    write(dir, "a.ts", A_TS);
    write(dir, "b.ts", B_TS);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("package → unpack round-trips the graph + fingerprints (checksum verified)", () => {
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const { artifact, header } = packageGraphArtifact(graph, fingerprints);
    expect(header.format).toBe(ARTIFACT_SCHEMA);
    const { envelope } = unpackGraphArtifact(artifact);
    expect(JSON.stringify(structuralSubset(envelope.graph))).toBe(
      JSON.stringify(structuralSubset(graph)),
    );
    expect(validateFingerprintMap(envelope.fingerprints)).toBe(true);
    expect(canonicalJson(envelope.fingerprints)).toBe(canonicalJson(fingerprints));
  });

  test("the artifact carries a fingerprint map, NOT structural-cache bundles; no importer reads a cache into reuse", () => {
    // FIX-T6.1-r5: the envelope is graph + fingerprints only — there is NO `cache`
    // field, so nothing untrusted is added to the graph wholesale.
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const { envelope } = unpackGraphArtifact(packageGraphArtifact(graph, fingerprints).artifact);
    expect(envelope.fingerprints).toBeDefined();
    expect((envelope as unknown as Record<string, unknown>).cache).toBeUndefined();
    // every value is a content sha — no node/edge/bundle payload smuggled in.
    expect(Object.values(envelope.fingerprints).every((v) => /^[0-9a-f]{64}$/.test(v))).toBe(true);

    // grep (code tokens only — these never appear in prose/comments): there is
    // provably no code path that reads a cache out of the artifact envelope into
    // reuse. The envelope has no `cache`; the importer derives/seeds the local cache
    // by re-extraction (extract-structural), never from the artifact.
    const libSrc = readFile(path.resolve(__dirname, "../lib/graph-artifact.ts"));
    const cliSrc = readFile(path.resolve(__dirname, "../graph-artifact.ts"));
    expect(libSrc).not.toMatch(/validateStructuralCache\(/);
    expect(libSrc).not.toMatch(/envelope\.cache/);
    expect(libSrc).not.toMatch(/import[\s{][^;]*\bStructuralCache\b/);
    expect(cliSrc).not.toMatch(/envelope\.cache/);
    expect(cliSrc).not.toMatch(/bundlesToCache\(/);
    expect(cliSrc).not.toMatch(/import[\s{][^;]*\bStructuralCache\b/);
  });

  test("round-trip is lossless over the FULL graph envelope (not just the subset)", () => {
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const { artifact } = packageGraphArtifact(graph, fingerprints);
    const { envelope } = unpackGraphArtifact(artifact);
    const expected: KnowledgeGraph = { ...graph, generated_from_commit: "structural" };
    expect(canonicalJson(envelope.graph)).toBe(canonicalJson(expected));
    expect(canonicalJson(envelope.fingerprints)).toBe(canonicalJson(fingerprints));
    // anti-vacuity: a deliberately-different graph would NOT match.
    expect(canonicalJson(envelope.graph)).not.toBe(
      canonicalJson({ ...expected, project: { ...expected.project, name: "DIFFERENT" } }),
    );
  });

  test("packaging REFUSES a graph that schema validation would repair/drop", () => {
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    // anti-vacuity: the clean (fixpoint) graph packages without throwing.
    expect(() => packageGraphArtifact(graph, fingerprints)).not.toThrow();
    // a node with an unknown type is DROPPED by validateGraph → packaging is not
    // lossless → refuse (never silently ship the repaired graph).
    const droppy: KnowledgeGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: "bogus", type: "not_a_real_type", name: "x", source_refs: [], confidence: "high" } as never,
      ],
    };
    expect(() => packageGraphArtifact(droppy, fingerprints)).toThrow(ArtifactError);
    // an unknown top-level field is silently dropped by validateGraph → also refused.
    const extra = { ...graph, customMeta: { keep: "me" } } as unknown as KnowledgeGraph;
    expect(() => packageGraphArtifact(extra, fingerprints)).toThrow(ArtifactError);
  });

  test("packaging REFUSES a malformed fingerprint map (defensive symmetry)", () => {
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    expect(() => packageGraphArtifact(graph, fingerprints)).not.toThrow();
    expect(() => packageGraphArtifact(graph, { "a.ts": "not-a-sha" })).toThrow(ArtifactError);
    expect(() => packageGraphArtifact(graph, { "../escape.ts": "a".repeat(64) })).toThrow(ArtifactError);
    expect(() => packageGraphArtifact(graph, { "/abs.ts": "a".repeat(64) })).toThrow(ArtifactError);
  });

  test("validateFingerprintMap accepts a flat {rel: hex-sha} map and rejects everything else", () => {
    expect(validateFingerprintMap({})).toBe(true); // empty is valid
    expect(validateFingerprintMap({ "a.ts": "a".repeat(64) })).toBe(true); // sha-256
    expect(validateFingerprintMap({ "src/a.ts": "a".repeat(40) })).toBe(true); // git sha
    expect(validateFingerprintMap({ "a.ts": "xyz" })).toBe(false); // not hex
    expect(validateFingerprintMap({ "a.ts": "a".repeat(50) })).toBe(false); // wrong width
    expect(validateFingerprintMap({ "a.ts": 123 })).toBe(false); // not a string
    expect(validateFingerprintMap({ "../e.ts": "a".repeat(64) })).toBe(false); // escaping key
    expect(validateFingerprintMap({ "/abs.ts": "a".repeat(64) })).toBe(false); // absolute key
    expect(validateFingerprintMap({ "": "a".repeat(64) })).toBe(false); // empty key
    expect(validateFingerprintMap([])).toBe(false); // not an object
    expect(validateFingerprintMap(null)).toBe(false);
  });

  test("a hand-framed artifact with a MALFORMED fingerprint map is REJECTED on unpack", () => {
    // The lib's packager refuses a malformed map, so frame one by hand (valid graph,
    // valid checksum) to exercise the IMPORT-side fingerprint rejection.
    const { graph } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    // anti-vacuity: a hand-framed artifact with a WELL-FORMED map round-trips.
    const okArtifact = frameArtifact({ schema: ARTIFACT_SCHEMA, graph, fingerprints: { "a.ts": "a".repeat(64) } });
    expect(() => unpackGraphArtifact(okArtifact)).not.toThrow();

    const badArtifact = frameArtifact({ schema: ARTIFACT_SCHEMA, graph, fingerprints: { "a.ts": "deadbeef" } });
    expect(() => unpackGraphArtifact(badArtifact)).toThrow(ArtifactError);
    const escArtifact = frameArtifact({ schema: ARTIFACT_SCHEMA, graph, fingerprints: { "../escape.ts": "a".repeat(64) } });
    expect(() => unpackGraphArtifact(escArtifact)).toThrow(ArtifactError);
  });

  test("a hand-framed artifact whose GRAPH is not a validation fixpoint is REJECTED on unpack", () => {
    // validateGraph is the SOLE structural-validation surface: a graph with a node
    // that validation would DROP is not a fixpoint → rejected → fallback.
    const { graph } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const droppy: KnowledgeGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: "bogus", type: "not_a_real_type", name: "x", source_refs: [], confidence: "high" } as never,
      ],
    };
    const artifact = frameArtifact({ schema: ARTIFACT_SCHEMA, graph: droppy, fingerprints: { "a.ts": "a".repeat(64) } });
    expect(() => unpackGraphArtifact(artifact)).toThrow(ArtifactError);
  });

  test("zstd codec round-trips when available", () => {
    if (!zstdAvailable()) return; // runtime without zstd — gzip default covered elsewhere
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const { artifact, header } = packageGraphArtifact(graph, fingerprints, { codec: "zstd" });
    expect(header.codec).toBe("zstd");
    const { envelope } = unpackGraphArtifact(artifact);
    expect(canonicalJson(envelope.graph)).toBe(canonicalJson(graph));
  });

  test("corrupt / truncated / bad-magic / tampered artifacts are REJECTED", () => {
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const { artifact } = packageGraphArtifact(graph, fingerprints);

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

  test("CLI --import on a malformed-fingerprint artifact falls back == from-scratch (no crash)", () => {
    const { graph } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const artifact = frameArtifact({ schema: ARTIFACT_SCHEMA, graph, fingerprints: { "a.ts": "deadbeef" } });
    fs.mkdirSync(path.dirname(artifactPathOf(dir)), { recursive: true });
    fs.writeFileSync(artifactPathOf(dir), artifact);

    const imp = runCli(dir, ["--import"]);
    expect(imp.status).toBe(0); // rejected the bad map, fell back, did not crash
    const imported = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;

    const scratchPath = path.join(dir, ".guild", "indexes", "scratch-graph.json");
    runExtractFull(dir, scratchPath);
    const scratch = JSON.parse(readFile(scratchPath)) as KnowledgeGraph;
    expect(JSON.stringify(structuralSubset(imported))).toBe(JSON.stringify(structuralSubset(scratch)));
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
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    // anti-vacuity: clean graph packages with zero findings...
    expect(() => packageGraphArtifact(graph, fingerprints)).not.toThrow();
    // ...inject a known secret into a human field → packaging refuses.
    const seeded: KnowledgeGraph = {
      ...graph,
      project: { ...graph.project, description: 'api_key = "AKIAIOSFODNN7EXAMPLE"' },
    };
    let thrown: unknown;
    try {
      packageGraphArtifact(seeded, fingerprints);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SecretLeakError);
    expect((thrown as SecretLeakError).findings.length).toBeGreaterThan(0);
  });

  test("the benign per-file SHA-256 fingerprints do NOT false-positive", () => {
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    // fingerprints[*] are 64-char hex SHA-256 — must not be flagged.
    expect(Object.values(fingerprints).every((v) => /^[0-9a-f]{64}$/.test(v))).toBe(true);
    expect(auditForSecrets(JSON.stringify({ graph, fingerprints }))).toEqual([]);
  });

  test("a secret in a source COMMENT is excluded by construction (0 findings)", () => {
    // Structural extraction carries no comments/snippets — only names + paths.
    write(dir, "c.ts", '// password = "supersecret123"\nexport function safe(): void {}\n');
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts", "c.ts"]);
    const { artifact } = packageGraphArtifact(graph, fingerprints); // no throw
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

  test("same (graph,fingerprints) → byte-identical artifact", () => {
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const x = packageGraphArtifact(graph, fingerprints).artifact;
    const y = packageGraphArtifact(graph, fingerprints).artifact;
    expect(x.equals(y)).toBe(true);
  });

  test("a stale generated_from_commit normalizes → same bytes as a clean graph", () => {
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const clean = packageGraphArtifact(graph, fingerprints).artifact;
    const stale = packageGraphArtifact(
      { ...graph, generated_from_commit: "deadbeefcafef00ddeadbeefcafef00ddeadbeef" },
      fingerprints,
    ).artifact;
    expect(stale.equals(clean)).toBe(true);
  });

  test("reversed file-input order yields an identical artifact (fingerprint map is rel-sorted)", () => {
    const forward = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const reversed = buildGraphAndFingerprints(dir, ["b.ts", "a.ts"]);
    const x = packageGraphArtifact(forward.graph, forward.fingerprints).artifact;
    const y = packageGraphArtifact(reversed.graph, reversed.fingerprints).artifact;
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

  test("a symlinked PARENT escape is rejected even when the tail does not exist (FIX-T6.1-r2 #1)", () => {
    const base = fs.realpathSync(path.join(dir, ".guild", "indexes"));
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "g6-outside-")));
    try {
      // A symlink inside base pointing OUTSIDE; the final target (new.json) does
      // not exist, so the pre-fix realpath-only-when-target-exists check is fooled.
      const link = path.join(base, "evil");
      fs.symlinkSync(outside, link);
      // anti-vacuity: a real (non-symlinked) sibling tail under base is accepted.
      expect(assertContainedPath(path.join(base, "ok", "new.json"), base)).toBe(
        path.join(base, "ok", "new.json"),
      );
      // the symlinked-parent write would land in `outside` → refused.
      expect(() => assertContainedPath(path.join(base, "evil", "new.json"), base)).toThrow(
        ArtifactError,
      );
      // also refused for a DANGLING symlink (target removed after creation).
      fs.rmSync(outside, { recursive: true, force: true });
      expect(() => assertContainedPath(path.join(base, "evil", "new.json"), base)).toThrow(
        ArtifactError,
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a symlinked containment BASE that escapes the repo is refused when repo-anchored (FIX-T6.1-r3 #1)", () => {
    const repoRoot = fs.realpathSync(dir);
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "g6-base-outside-")));
    try {
      const linkedBase = path.join(repoRoot, "linked-indexes");
      fs.symlinkSync(outside, linkedBase); // base → outside the repo
      const candidate = "new.json"; // a relative --out under the (symlinked) base

      // anti-vacuity: WITHOUT a repoRoot anchor the relative candidate resolves
      // under the symlinked base (outside the repo) and is ACCEPTED.
      expect(assertContainedPath(candidate, linkedBase)).toBe(path.join(outside, "new.json"));
      // WITH the repo anchor: the base realpath is outside repoRoot → refused.
      expect(() => assertContainedPath(candidate, linkedBase, repoRoot)).toThrow(ArtifactError);

      // anti-vacuity: a real in-repo base under repoRoot still passes WITH the anchor.
      const realBase = path.join(repoRoot, ".guild", "indexes");
      fs.mkdirSync(realBase, { recursive: true });
      expect(assertContainedPath("new.json", realBase, repoRoot)).toBe(
        path.join(realBase, "new.json"),
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// CLI --out path containment (FIX-T6.1 #1)
// ===========================================================================

describe("G6 CLI --out containment (escaping --out refused before any write/spawn)", () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpRepo("g6-cli-out-");
    write(dir, "a.ts", A_TS);
    write(dir, "b.ts", B_TS);
    runExtractFull(dir, graphPathOf(dir));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("export with a ../ --out escape is refused (exit 1, nothing written outside)", () => {
    const escapeTarget = path.join(dir, "escape-graph.json"); // sibling of .guild → outside indexes
    const r = runCli(dir, ["--export", "--force", "--out", "../../escape-graph.json"]);
    expect(r.status).toBe(1);
    expect(fs.existsSync(escapeTarget)).toBe(false);
    expect(fs.existsSync(artifactPathOf(dir))).toBe(false);
  });

  test("export with an absolute --out outside indexes is refused", () => {
    const abs = path.join(os.tmpdir(), "g6-abs-escape-graph.json");
    fs.rmSync(abs, { force: true });
    const r = runCli(dir, ["--export", "--force", "--out", abs]);
    expect(r.status).toBe(1);
    expect(fs.existsSync(abs)).toBe(false);
  });

  test("import with a ../ --out escape is refused before any write/spawn (exit 1)", () => {
    const escapeTarget = path.join(dir, "escape-graph.json");
    const r = runCli(dir, ["--import", "--out", "../../escape-graph.json"]);
    expect(r.status).toBe(1);
    expect(fs.existsSync(escapeTarget)).toBe(false);
  });

  test("a contained --out under .guild/indexes is accepted", () => {
    const rel = "contained-graph.json";
    runExtractFull(dir, path.join(dir, ".guild", "indexes", rel)); // graph at the contained path
    const r = runCli(dir, ["--export", "--force", "--out", rel]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(artifactPathOf(dir))).toBe(true);
  });

  test("import with a symlinked-parent --out is refused before any write/spawn (FIX-T6.1-r2 #1)", () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "g6-cli-outside-")));
    try {
      fs.symlinkSync(outside, path.join(dir, ".guild", "indexes", "evil"));
      const r = runCli(dir, ["--import", "--out", "evil/new.json"]);
      expect(r.status).toBe(1); // refused at path resolution, before any write/spawn
      expect(r.out).toContain("[graph-artifact] refusing --out outside .guild/indexes");
      expect(fs.existsSync(path.join(outside, "new.json"))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// CLI symlinked-indexes base is repo-anchored (FIX-T6.1-r3 #1)
// ===========================================================================

describe("G6 CLI symlinked .guild/indexes base is refused (FIX-T6.1-r3 #1)", () => {
  let dir: string;
  let outside: string;
  beforeEach(() => {
    dir = tmpRepo("g6-symbase-");
    write(dir, "a.ts", A_TS);
    write(dir, "b.ts", B_TS);
    fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
    // .guild/indexes is a SYMLINK to a dir OUTSIDE the repo.
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "g6-symbase-outside-")));
    fs.symlinkSync(outside, path.join(dir, ".guild", "indexes"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test("import with a relative --out through a symlinked indexes dir is refused before any write (exit 1, nothing outside)", () => {
    const { graph, fingerprints } = buildGraphAndFingerprints(dir, ["a.ts", "b.ts"]);
    const { artifact } = packageGraphArtifact(graph, fingerprints);
    fs.writeFileSync(artifactPathOf(dir), artifact); // lands in `outside` via the symlink
    expect(fs.existsSync(path.join(outside, ARTIFACT_BASENAME))).toBe(true); // setup is valid

    const r = runCli(dir, ["--import", "--out", "new.json"]);
    expect(r.status).toBe(1); // refused at path resolution, before any write/spawn
    expect(r.out).toContain("[graph-artifact] refusing --out outside .guild/indexes");
    expect(fs.existsSync(path.join(outside, "new.json"))).toBe(false);
  });
});

// ===========================================================================
// CLI import cache-clearance is contained + fail-closed (FIX-T6.1-r7)
// ===========================================================================

describe("G6 CLI import cache-clearance (containment-before-delete + fail-closed)", () => {
  // #1 BLOCKER — a symlinked .guild/indexes must not let the DEFAULT-path (no --out)
  // cache deletion remove a sidecar OUTSIDE the repo. Pre-fix, removeStaleLocalCache
  // ran before any containment check on the default graphPath.
  test("symlinked indexes dir → default-path import does NOT delete an outside sidecar (refused)", () => {
    const dir = tmpRepo("g6-r7-blocker-");
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "g6-r7-outside-")));
    try {
      write(dir, "a.ts", A_TS);
      write(dir, "b.ts", B_TS);
      fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
      // .guild/indexes → a dir OUTSIDE the repo.
      fs.symlinkSync(outside, path.join(dir, ".guild", "indexes"));
      // The exact file the default-path cache deletion would target (graphPath is
      // <indexes>/knowledge-graph.json → resolves into `outside`).
      const outsideSidecar = path.join(outside, "knowledge-graph.json.structural-cache.json");
      fs.writeFileSync(outsideSidecar, '{"version":"x","files":{}}', "utf8");
      expect(fs.existsSync(outsideSidecar)).toBe(true); // setup is valid

      const imp = runCli(dir, ["--import"]); // NO --out — exercises the default path
      expect(imp.status).toBe(1); // refused: cache path escapes the repo
      expect(imp.out).toContain("escapes .guild/indexes");
      // Non-vacuity (would FAIL pre-fix): the outside sidecar was NOT deleted.
      expect(fs.existsSync(outsideSidecar)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  // #2 MAJOR — an existing in-repo sidecar that cannot be removed must NOT be left
  // reachable by the cache-reading incremental path. A non-empty DIRECTORY at the
  // cache path is genuinely un-removable by the code's `rmSync(force)` (no
  // recursive) → the import must fail closed onto a no-cache FULL rebuild, never a
  // silent incremental reuse.
  test("un-removable sidecar → forced no-cache full rebuild, result == from-scratch (no reuse)", () => {
    const dir = tmpRepo("g6-r7-major-");
    try {
      write(dir, "a.ts", A_TS);
      write(dir, "b.ts", B_TS);
      // 1) Seed a real V1 cache + graph, export the V1 snapshot.
      runExtractFull(dir, graphPathOf(dir));
      const cachePath = `${graphPathOf(dir)}.structural-cache.json`;
      expect(fs.existsSync(cachePath)).toBe(true); // setup is valid
      const exp = runCli(dir, ["--export", "--force"]);
      expect(exp.status).toBe(0);

      // 2) Evolve a.ts to a structurally DIFFERENT V2 (adds exported `baz`).
      const A_V2 = A_TS + "export function baz(): number { return 42; }\n";
      write(dir, "a.ts", A_V2);

      // 3) Wipe the local graph; replace the cache FILE with an un-removable
      //    non-empty DIRECTORY at the same path. `rmSync(path,{force:true})` (the
      //    code's call) throws on a directory → the sidecar survives removal.
      fs.rmSync(graphPathOf(dir), { force: true });
      fs.rmSync(cachePath, { force: true });
      fs.mkdirSync(cachePath, { recursive: true });
      fs.writeFileSync(path.join(cachePath, "blocker"), "x", "utf8"); // non-empty
      expect(fs.statSync(cachePath).isDirectory()).toBe(true); // setup is valid

      // 4) Import: must fail closed → forced full rebuild, never the incremental path.
      //    Capture stderr too (the diagnostics below are written there on exit 0).
      const imp = runCliBoth(dir, ["--import"]);
      expect(imp.status).toBe(0);
      const imported = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;

      // 5) From-scratch on the SAME V2 tree (side path, own cache).
      const scratchPath = path.join(dir, ".guild", "indexes", "scratch-graph.json");
      runExtractFull(dir, scratchPath);
      const scratch = JSON.parse(readFile(scratchPath)) as KnowledgeGraph;

      const importedSubset = JSON.stringify(structuralSubset(imported));
      expect(importedSubset).toBe(JSON.stringify(structuralSubset(scratch)));
      expect(importedSubset).toContain("baz"); // reflects the LIVE V2 tree, not a stale reuse

      // Non-vacuity (both FAIL pre-fix): the fail-closed branch is taken (forced full
      // rebuild) and the cache-reading incremental path is NOT (its "no usable cache"
      // log is absent because the extractor ran in full mode, never reading the cache).
      expect(imp.out).toContain("forcing a no-cache full rebuild");
      expect(imp.out).not.toContain("no usable cache");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // #3 MAJOR (FIX-T6.1-r8) — a cache sidecar that is ITSELF a symlink to another
  // CONTAINED .guild/indexes file must not make the pre-import clearance delete that
  // target. Pre-fix, assertContainedPath dereferenced the final component (both files
  // are in-repo, so containment passed) and rmSync deleted the symlink's TARGET; the
  // link survived. Post-fix the lexical link is unlinked and its target is untouched.
  test("a cache sidecar that is a SYMLINK → another contained .guild/indexes file does NOT delete that target (FIX-T6.1-r8)", () => {
    const dir = tmpRepo("g6-r8-");
    try {
      write(dir, "a.ts", A_TS);
      write(dir, "b.ts", B_TS);
      // 1) Seed a real graph + cache and export a valid snapshot, so import proceeds.
      runExtractFull(dir, graphPathOf(dir));
      const cachePath = `${graphPathOf(dir)}.structural-cache.json`;
      expect(fs.existsSync(cachePath)).toBe(true); // setup is valid
      const exp = runCli(dir, ["--export", "--force"]);
      expect(exp.status).toBe(0);

      // 2) Plant a VICTIM file inside .guild/indexes (contained), then replace the
      //    cache sidecar with a SYMLINK pointing at that contained victim.
      const indexesDir = path.join(dir, ".guild", "indexes");
      const victim = path.join(indexesDir, "victim-keep-me.json");
      const victimBody = '{"keep":"me","important":true}';
      fs.writeFileSync(victim, victimBody, "utf8");
      fs.rmSync(cachePath, { force: true });
      fs.symlinkSync(victim, cachePath); // sidecar IS a symlink → another contained file
      expect(fs.lstatSync(cachePath).isSymbolicLink()).toBe(true); // setup is valid

      // 3) Import (default path) — exercises removeStaleLocalCache on the real CLI.
      const imp = runCliBoth(dir, ["--import"]);
      expect(imp.status).toBe(0);
      // The clearance was contained (not the symlinked-indexes escape branch).
      expect(imp.out).not.toContain("escapes .guild/indexes");

      // Non-vacuity (FAILS pre-fix): the symlink TARGET survives byte-for-byte — the
      // pre-fix code resolved the final symlink and rmSync-deleted the victim.
      expect(fs.existsSync(victim)).toBe(true);
      expect(readFile(victim)).toBe(victimBody);

      // The sidecar symlink itself was removed (only the link). Any cache now present
      // at the path is a freshly written REGULAR file, never the surviving symlink.
      if (fs.existsSync(cachePath)) {
        expect(fs.lstatSync(cachePath).isSymbolicLink()).toBe(false);
      }

      // The post-import structural tier still equals a from-scratch extraction (the
      // collateral-delete did not corrupt the rebuild; round-trip preserved).
      const imported = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;
      const scratchPath = path.join(indexesDir, "scratch-graph.json");
      runExtractFull(dir, scratchPath);
      const scratch = JSON.parse(readFile(scratchPath)) as KnowledgeGraph;
      expect(JSON.stringify(structuralSubset(imported))).toBe(
        JSON.stringify(structuralSubset(scratch)),
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Anti-vacuity for the lstat gone-check (#2/#3): a sidecar that is a DANGLING
  // symlink (target removed) which cannot be unlinked is still seen as present and
  // fails closed. We assert assertContainedPath's lexical-final mode directly so the
  // gone-check semantics are pinned even where the CLI would otherwise rebuild.
  test("lexicalFinal containment keeps the literal final symlink (does not resolve to its target) (FIX-T6.1-r8)", () => {
    const dir = tmpRepo("g6-r8-lex-");
    try {
      fs.mkdirSync(path.join(dir, ".guild", "indexes"), { recursive: true });
      const base = fs.realpathSync(path.join(dir, ".guild", "indexes"));
      const target = path.join(base, "target.json");
      fs.writeFileSync(target, "{}", "utf8");
      const link = path.join(base, "side.structural-cache.json");
      fs.symlinkSync(target, link);

      // Default (resolve-final) mode dereferences the symlink → returns the TARGET.
      expect(assertContainedPath(link, base)).toBe(target);
      // lexicalFinal mode keeps the literal link path → deleting it removes the link.
      expect(assertContainedPath(link, base, undefined, { lexicalFinal: true })).toBe(link);

      // A symlinked PARENT escape is STILL rejected under lexicalFinal (only the final
      // component is left lexical; parents are resolved + checked).
      const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "g6-r8-out-")));
      try {
        fs.symlinkSync(outside, path.join(base, "evil"));
        expect(() =>
          assertContainedPath(path.join(base, "evil", "x.json"), base, undefined, {
            lexicalFinal: true,
          }),
        ).toThrow(ArtifactError);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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
