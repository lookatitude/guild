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
  canonicalJson,
  validateStructuralCache,
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

  test("round-trip is lossless over the FULL graph envelope (not just the subset)", () => {
    // FIX-T6.1 #2: the previous gate only compared structuralSubset, so a
    // validation repair/drop on a non-structural field went unnoticed. Assert the
    // ENTIRE graph + cache survive the round-trip (modulo the documented commit
    // normalization), and that this is non-vacuous (would fail if any field dropped).
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const { artifact } = packageGraphArtifact(graph, cache);
    const { envelope } = unpackGraphArtifact(artifact);
    const expected: KnowledgeGraph = { ...graph, generated_from_commit: "structural" };
    expect(canonicalJson(envelope.graph)).toBe(canonicalJson(expected));
    expect(canonicalJson(envelope.cache)).toBe(canonicalJson(cache));
    // anti-vacuity: a deliberately-different graph would NOT match.
    expect(canonicalJson(envelope.graph)).not.toBe(
      canonicalJson({ ...expected, project: { ...expected.project, name: "DIFFERENT" } }),
    );
  });

  test("packaging REFUSES a graph that schema validation would repair/drop", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    // anti-vacuity: the clean (fixpoint) graph packages without throwing.
    expect(() => packageGraphArtifact(graph, cache)).not.toThrow();
    // a node with an unknown type is DROPPED by validateGraph → packaging is not
    // lossless → refuse (never silently ship the repaired graph).
    const droppy: KnowledgeGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: "bogus", type: "not_a_real_type", name: "x", source_refs: [], confidence: "high" } as never,
      ],
    };
    expect(() => packageGraphArtifact(droppy, cache)).toThrow(ArtifactError);
    // an unknown top-level field is silently dropped by validateGraph → also refused.
    const extra = { ...graph, customMeta: { keep: "me" } } as unknown as KnowledgeGraph;
    expect(() => packageGraphArtifact(extra, cache)).toThrow(ArtifactError);
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

  test("a checksum-valid artifact with a MALFORMED cache is REJECTED on unpack", () => {
    // FIX-T6.1 #3: package builds a valid checksum even over a malformed cache
    // (it does not validate the cache), so the import-side check is what bites.
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    // anti-vacuity: the well-formed cache round-trips, and the validator agrees.
    expect(validateStructuralCache(cache)).toBe(true);
    expect(() => unpackGraphArtifact(packageGraphArtifact(graph, cache).artifact)).not.toThrow();

    const firstKey = Object.keys(cache.files)[0];

    // (a) a bundle missing its fileNode → broken shape → rejected.
    const noFileNode = JSON.parse(JSON.stringify(cache)) as StructuralCache;
    delete (noFileNode.files[firstKey] as unknown as Record<string, unknown>).fileNode;
    expect(validateStructuralCache(noFileNode)).toBe(false);
    expect(() => unpackGraphArtifact(packageGraphArtifact(graph, noFileNode).artifact)).toThrow(ArtifactError);

    // (b) a non-relative (escaping) cache key → rejected.
    const escKey = JSON.parse(JSON.stringify(cache)) as StructuralCache;
    const moved = escKey.files[firstKey] as unknown as Record<string, unknown>;
    delete escKey.files[firstKey];
    (escKey.files as Record<string, unknown>)["../escape.ts"] = {
      ...moved,
      rel: "../escape.ts",
      fileNode: { ...(moved.fileNode as Record<string, unknown>), id: "file:../escape.ts" },
    };
    expect(validateStructuralCache(escKey)).toBe(false);
    expect(() => unpackGraphArtifact(packageGraphArtifact(graph, escKey).artifact)).toThrow(ArtifactError);

    // (c) a malformed content hash (not "" and not 64-hex) → rejected.
    const badHash = JSON.parse(JSON.stringify(cache)) as StructuralCache;
    (badHash.files[firstKey] as unknown as Record<string, unknown>).contentHash = "deadbeef";
    expect(validateStructuralCache(badHash)).toBe(false);
    expect(() => unpackGraphArtifact(packageGraphArtifact(graph, badHash).artifact)).toThrow(ArtifactError);
  });

  test("CLI --import falls back to full extraction on a malformed-cache artifact (no crash)", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const firstKey = Object.keys(cache.files)[0];
    const badCache = JSON.parse(JSON.stringify(cache)) as StructuralCache;
    delete (badCache.files[firstKey] as unknown as Record<string, unknown>).fileNode;
    const { artifact } = packageGraphArtifact(graph, badCache);
    fs.mkdirSync(path.dirname(artifactPathOf(dir)), { recursive: true });
    fs.writeFileSync(artifactPathOf(dir), artifact);
    const imp = runCli(dir, ["--import"]);
    expect(imp.status).toBe(0); // rejected the cache, fell back, did not crash
    expect(fs.existsSync(graphPathOf(dir))).toBe(true);
    const g = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;
    expect(g.nodes.length).toBeGreaterThan(0);
  });

  test("a malformed callables/classes/symbolNodes cache ELEMENT is REJECTED on unpack (FIX-T6.1-r2 #2)", () => {
    // FIX-T6.1-r2 #2: the array-SHAPE check passes even when an array holds a
    // malformed ENTRY; assembleStructuralGraph() then dereferences callable/class/
    // symbol-node fields and crashes/diverges. Each defect must reject the artifact.
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    // anti-vacuity: the well-formed cache passes the validator and round-trips.
    expect(validateStructuralCache(cache)).toBe(true);
    expect(() => unpackGraphArtifact(packageGraphArtifact(graph, cache).artifact)).not.toThrow();

    // pick the bundle that actually carries symbols/classes/callables (a.ts), so
    // mutating element [0] is meaningful (not a vacuous empty-array mutation).
    const key = Object.keys(cache.files).find((k) => {
      const b = cache.files[k];
      return b.symbolNodes.length > 0 && b.classes.length > 0 && b.callables.length > 0;
    });
    expect(key).toBeDefined();
    const clone = () => JSON.parse(JSON.stringify(cache)) as StructuralCache;
    const bundleOf = (c: StructuralCache) => c.files[key as string] as unknown as Record<string, unknown>;

    // (a) a null `callables` entry → assemble throws on register(c.simpleName, c.id).
    const badCallable = clone();
    (bundleOf(badCallable).callables as unknown[])[0] = null;
    expect(validateStructuralCache(badCallable)).toBe(false);
    expect(() => unpackGraphArtifact(packageGraphArtifact(graph, badCallable).artifact)).toThrow(ArtifactError);

    // (b) a `classes` entry whose `bases` is not an array → Pass 2b `for…of` throws.
    const badClass = clone();
    (bundleOf(badClass).classes as Record<string, unknown>[])[0].bases = "oops";
    expect(validateStructuralCache(badClass)).toBe(false);
    expect(() => unpackGraphArtifact(packageGraphArtifact(graph, badClass).artifact)).toThrow(ArtifactError);

    // (c) a `symbolNodes` entry with a non-string `id` → Pass 1 addNode dereferences it.
    const badSymbol = clone();
    (bundleOf(badSymbol).symbolNodes as Record<string, unknown>[])[0].id = 42;
    expect(validateStructuralCache(badSymbol)).toBe(false);
    expect(() => unpackGraphArtifact(packageGraphArtifact(graph, badSymbol).artifact)).toThrow(ArtifactError);
  });

  test("CLI --import on a malformed-cache-ELEMENT artifact falls back == from-scratch (FIX-T6.1-r2 #2)", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const key = Object.keys(cache.files).find((k) => cache.files[k].callables.length > 0) as string;
    const bad = JSON.parse(JSON.stringify(cache)) as StructuralCache;
    (bad.files[key] as unknown as Record<string, unknown>).callables = [null];
    const { artifact } = packageGraphArtifact(graph, bad);
    fs.mkdirSync(path.dirname(artifactPathOf(dir)), { recursive: true });
    fs.writeFileSync(artifactPathOf(dir), artifact);

    const imp = runCli(dir, ["--import"]);
    expect(imp.status).toBe(0); // rejected the bad element, fell back, did not crash
    const imported = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;

    // == from-scratch: the fallback full extraction equals a clean rebuild.
    const scratchPath = path.join(dir, ".guild", "indexes", "scratch-graph.json");
    runExtractFull(dir, scratchPath);
    const scratch = JSON.parse(readFile(scratchPath)) as KnowledgeGraph;
    expect(JSON.stringify(structuralSubset(imported))).toBe(JSON.stringify(structuralSubset(scratch)));
  });

  test("FULL cached node/edge shape + bundle cross-consistency is validated (FIX-T6.1-r3 #2)", () => {
    // FIX-T6.1-r3 #2: assembleStructuralGraph emits cached fileNode/symbolNodes and
    // contains edges WHOLESALE, so a node missing a schema-required field or an edge
    // with a bad field / phantom endpoint must reject the artifact (not just an
    // id-present / key-present partial check).
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    // anti-vacuity: the well-formed cache passes the validator and round-trips.
    expect(validateStructuralCache(cache)).toBe(true);
    expect(() => unpackGraphArtifact(packageGraphArtifact(graph, cache).artifact)).not.toThrow();

    // pick the code bundle that carries symbols + contains edges (a.ts).
    const key = Object.keys(cache.files).find(
      (k) => cache.files[k].symbolNodes.length > 0 && cache.files[k].contains.length > 0,
    ) as string;
    expect(key).toBeDefined();
    const clone = () => JSON.parse(JSON.stringify(cache)) as StructuralCache;
    const bundleOf = (c: StructuralCache) => c.files[key] as unknown as Record<string, unknown>;
    const expectRejected = (c: StructuralCache) => {
      expect(validateStructuralCache(c)).toBe(false);
      expect(() => unpackGraphArtifact(packageGraphArtifact(graph, c).artifact)).toThrow(ArtifactError);
    };

    // (a) a symbolNode missing schema-required `source_refs` → rejected (partial
    //     id-only check would have accepted it).
    const noRefs = clone();
    delete (bundleOf(noRefs).symbolNodes as Record<string, unknown>[])[0].source_refs;
    expectRejected(noRefs);

    // (b) a symbolNode with an invalid `confidence` value → rejected.
    const badConf = clone();
    (bundleOf(badConf).symbolNodes as Record<string, unknown>[])[0].confidence = "bogus";
    expectRejected(badConf);

    // (c) the fileNode with a wrong `type` (not "file") → rejected.
    const badFileType = clone();
    (bundleOf(badFileType).fileNode as Record<string, unknown>).type = "function";
    expectRejected(badFileType);

    // (d) a contains edge with an out-of-range `weight` → rejected.
    const badWeight = clone();
    (bundleOf(badWeight).contains as Record<string, unknown>[])[0].weight = 9;
    expectRejected(badWeight);

    // (e) a contains edge with a wrong `direction` → rejected.
    const badDir = clone();
    (bundleOf(badDir).contains as Record<string, unknown>[])[0].direction = "sideways";
    expectRejected(badDir);

    // (f) a contains edge whose `target` is a PHANTOM id (not a node in this bundle)
    //     → bundle cross-consistency rejects it (would otherwise emit a dangling edge).
    const danglingEdge = clone();
    (bundleOf(danglingEdge).contains as Record<string, unknown>[])[0].target = "function:a.ts:ghost";
    expectRejected(danglingEdge);
  });

  test("a class/callable id with no matching cached symbol node is REJECTED (FIX-T6.1-r3 #3)", () => {
    // FIX-T6.1-r3 #3: Pass 2b/2c emit inherits/implements/calls edges with the
    // class/callable `id` as the SOURCE. A bogus id not backed by a symbol node
    // surfaces an invalid edge from a phantom source — reject → fallback.
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const key = Object.keys(cache.files).find(
      (k) => cache.files[k].classes.length > 0 && cache.files[k].callables.length > 0,
    ) as string;
    expect(key).toBeDefined();
    const clone = () => JSON.parse(JSON.stringify(cache)) as StructuralCache;
    const bundleOf = (c: StructuralCache) => c.files[key] as unknown as Record<string, unknown>;
    const expectRejected = (c: StructuralCache) => {
      expect(validateStructuralCache(c)).toBe(false);
      expect(() => unpackGraphArtifact(packageGraphArtifact(graph, c).artifact)).toThrow(ArtifactError);
    };

    // anti-vacuity: well-formed → valid (every class/callable id IS a symbol node).
    expect(validateStructuralCache(cache)).toBe(true);

    // (a) a class id that does not correspond to any cached symbol node → rejected.
    const ghostClass = clone();
    (bundleOf(ghostClass).classes as Record<string, unknown>[])[0].id = "class:a.ts:Ghost";
    expectRejected(ghostClass);

    // (b) a callable id that does not correspond to any cached symbol node → rejected.
    const ghostCallable = clone();
    (bundleOf(ghostCallable).callables as Record<string, unknown>[])[0].id = "function:a.ts:ghostFn";
    expectRejected(ghostCallable);
  });

  test("CLI --import on a dangling class-id artifact falls back == from-scratch (FIX-T6.1-r3 #3)", () => {
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const key = Object.keys(cache.files).find((k) => cache.files[k].classes.length > 0) as string;
    const bad = JSON.parse(JSON.stringify(cache)) as StructuralCache;
    (bad.files[key] as unknown as Record<string, unknown> & { classes: Record<string, unknown>[] })
      .classes[0].id = "class:a.ts:Ghost";
    const { artifact } = packageGraphArtifact(graph, bad);
    fs.mkdirSync(path.dirname(artifactPathOf(dir)), { recursive: true });
    fs.writeFileSync(artifactPathOf(dir), artifact);

    const imp = runCli(dir, ["--import"]);
    expect(imp.status).toBe(0); // rejected the dangling id, fell back, did not crash
    const imported = JSON.parse(readFile(graphPathOf(dir))) as KnowledgeGraph;

    // == from-scratch: the fallback full extraction equals a clean rebuild, and the
    // graph carries NO edge sourced from the phantom id.
    const scratchPath = path.join(dir, ".guild", "indexes", "scratch-graph.json");
    runExtractFull(dir, scratchPath);
    const scratch = JSON.parse(readFile(scratchPath)) as KnowledgeGraph;
    expect(JSON.stringify(structuralSubset(imported))).toBe(JSON.stringify(structuralSubset(scratch)));
    expect(imported.edges.some((e) => e.source === "class:a.ts:Ghost")).toBe(false);
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
    // The base dir ITSELF (e.g. .guild/indexes) is a symlink pointing OUTSIDE the
    // repo. Without the repo-anchor, realpathSync(base) silently relocates the
    // containment root outside the repo: a RELATIVE candidate (the `--out` case)
    // then resolves UNDER the symlinked base and a write lands outside the repo.
    const repoRoot = fs.realpathSync(dir);
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "g6-base-outside-")));
    try {
      const linkedBase = path.join(repoRoot, "linked-indexes");
      fs.symlinkSync(outside, linkedBase); // base → outside the repo
      const candidate = "new.json"; // a relative --out under the (symlinked) base

      // anti-vacuity: WITHOUT a repoRoot anchor the relative candidate resolves
      // under the symlinked base (outside the repo) and is ACCEPTED — proving the
      // new anchor is what refuses it below (not the pre-existing lexical check).
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
    // A symlink UNDER .guild/indexes pointing outside the repo; `evil/new.json`
    // stays syntactically under indexes but the import write/spawn (writeJson +
    // runExtractor --out) would follow `evil` OUTSIDE the containment root. This is
    // the real write-escape (export only READS --out; import WRITES it).
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "g6-cli-outside-")));
    try {
      fs.symlinkSync(outside, path.join(dir, ".guild", "indexes", "evil"));
      const r = runCli(dir, ["--import", "--out", "evil/new.json"]);
      expect(r.status).toBe(1); // refused at path resolution, before any write/spawn
      // Non-vacuity: graph-artifact's OWN containment must be what refuses it —
      // assert its specific message, not the downstream extractor's. Pre-fix this
      // message is absent (the symlinked parent slipped through resolveGraphPath),
      // so this assertion FAILS without the fix.
      expect(r.out).toContain("[graph-artifact] refusing --out outside .guild/indexes");
      // nothing was written through the symlink into `outside`.
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
    // A valid artifact exists at the (symlinked) indexes path so import would proceed
    // to its write. With a RELATIVE --out, the symlinked base relocates the write
    // OUTSIDE the repo. Pre-fix `resolveGraphPath` accepts it (the relative path
    // resolves under the symlinked base); the repo-anchor is what refuses it.
    const { graph, cache } = buildGraphAndCache(dir, ["a.ts", "b.ts"]);
    const { artifact } = packageGraphArtifact(graph, cache);
    fs.writeFileSync(artifactPathOf(dir), artifact); // lands in `outside` via the symlink
    expect(fs.existsSync(path.join(outside, ARTIFACT_BASENAME))).toBe(true); // setup is valid

    const r = runCli(dir, ["--import", "--out", "new.json"]);
    expect(r.status).toBe(1); // refused at path resolution, before any write/spawn
    // graph-artifact's OWN repo-anchored refusal (not a downstream error).
    expect(r.out).toContain("[graph-artifact] refusing --out outside .guild/indexes");
    // nothing was written through the symlink into `outside`.
    expect(fs.existsSync(path.join(outside, "new.json"))).toBe(false);
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
