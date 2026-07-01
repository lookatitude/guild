/**
 * scripts/__tests__/write-knowledge-links.test.ts
 *
 * TDD discipline: every test confirmed to fail with "Cannot find module" before
 * any production code was written (the expected RED state).
 *
 * Covers:
 *   A — canonicalizeNode: fixed per-type key order, source_refs sorted
 *   B — canonicalizeEdge: fixed per-type key order
 *   C — sortNodesByRecall: importance_score desc → confidence desc → id asc
 *   D — writeKnowledgeLinks output shape
 *   E — SC-8 nonce-free proof: two runIds → byte-identical knowledge-recall.json
 *   F — Provenance sidecar: contains run_id; main file does NOT
 *   G — L0 convention: JSON.stringify(.,null,2)+"\n"
 *   H — Empty graph handled without error
 *   I — Dedup by (source,target,type): duplicate edges not written twice
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { GraphNode, GraphEdge } from "../learn/lib/schema";

// The module under test — does NOT exist yet. This import fails until
// write-knowledge-links.ts is written (the expected RED state).
import {
  canonicalizeNode,
  canonicalizeEdge,
  sortNodesByRecall,
  writeKnowledgeLinks,
  KNOWLEDGE_RECALL_SCHEMA_VERSION,
  KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION,
  type WriteKnowledgeLinksOptions,
  type WriteKnowledgeLinksResult,
  type KnowledgeLinksDoc,
} from "../learn/write-knowledge-links";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkTmpRepo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-wkl-"));
  TEMP_DIRS.push(d);
  return d;
}

function makeNode(overrides: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    type: "topic",
    name: overrides.id,
    source_refs: [],
    confidence: "medium",
    ...overrides,
  };
}

function makeEdge(overrides: Partial<GraphEdge> & { source: string; target: string; type: string }): GraphEdge {
  return {
    direction: "out",
    weight: 0.7,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section A — canonicalizeNode: fixed per-type key order
// ---------------------------------------------------------------------------

describe("A — canonicalizeNode", () => {
  test("A1: output keys are in canonical order (id, type, name, confidence, source_refs first)", () => {
    const node = makeNode({
      id: "topic:abc",
      type: "topic",
      name: "Test Topic",
      confidence: "high",
      source_refs: ["docs/test.md#heading"],
      importance_score: 0.8,
      category: "overview",
    });
    const result = canonicalizeNode(node);
    const keys = Object.keys(result);

    // id must come first; type second
    expect(keys[0]).toBe("id");
    expect(keys[1]).toBe("type");
    expect(keys[2]).toBe("name");
    expect(keys[3]).toBe("confidence");
    expect(keys[4]).toBe("source_refs");
    // Optional fields come after required fields
    expect(keys.indexOf("importance_score")).toBeGreaterThan(4);
  });

  test("A2: source_refs array is sorted within the node", () => {
    const node = makeNode({
      id: "topic:sorted",
      source_refs: ["docs/z.md#heading", "docs/a.md#heading", "docs/m.md#heading"],
    });
    const result = canonicalizeNode(node);
    expect(result.source_refs).toEqual(["docs/a.md#heading", "docs/m.md#heading", "docs/z.md#heading"]);
  });

  test("A3: unknown/additive fields are EXCLUDED from canonicalized output (no contamination)", () => {
    const node = {
      ...makeNode({ id: "topic:clean" }),
      _internal_marker: "should-not-appear",
      someRuntimeField: 42,
    };
    const result = canonicalizeNode(node);
    expect(result).not.toHaveProperty("_internal_marker");
    expect(result).not.toHaveProperty("someRuntimeField");
  });

  test("A4: optional fields absent from source node are absent from output (no undefined keys)", () => {
    // Node with no importance_score, no category, no topic_path
    const node = makeNode({ id: "topic:minimal" });
    const result = canonicalizeNode(node);
    expect(result).not.toHaveProperty("importance_score");
    expect(result).not.toHaveProperty("category");
    expect(result).not.toHaveProperty("topic_path");
    expect(result).not.toHaveProperty("labels");
  });

  test("A5: optional fields present in source node appear in output at the right position", () => {
    const node = makeNode({
      id: "topic:full",
      importance_score: 0.9,
      category: "architecture",
      topic_path: ["root", "sub"],
      labels: ["core"],
    });
    const result = canonicalizeNode(node);
    expect(result).toHaveProperty("importance_score", 0.9);
    expect(result).toHaveProperty("category", "architecture");
    expect(result).toHaveProperty("topic_path", ["root", "sub"]);
    expect(result).toHaveProperty("labels", ["core"]);
  });

  test("A6: two nodes with same data but different original key insertion order produce identical JSON", () => {
    // Simulate two nodes built with different key order in the source object
    const node1 = { id: "topic:x", type: "topic", name: "X", confidence: "high" as const, source_refs: ["a.md", "b.md"] };
    const node2 = { source_refs: ["b.md", "a.md"], confidence: "high" as const, name: "X", type: "topic", id: "topic:x" };
    const r1 = canonicalizeNode(node1);
    const r2 = canonicalizeNode(node2);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

// ---------------------------------------------------------------------------
// Section B — canonicalizeEdge: fixed per-type key order
// ---------------------------------------------------------------------------

describe("B — canonicalizeEdge", () => {
  test("B1: output keys are in canonical order (direction, source, target, type, weight)", () => {
    const edge = makeEdge({ source: "a:1", target: "b:2", type: "evidenced_by" });
    const result = canonicalizeEdge(edge);
    const keys = Object.keys(result);
    expect(keys[0]).toBe("direction");
    expect(keys[1]).toBe("source");
    expect(keys[2]).toBe("target");
    expect(keys[3]).toBe("type");
    expect(keys[4]).toBe("weight");
  });

  test("B2: unknown/additive fields excluded from edge output", () => {
    const edge = {
      ...makeEdge({ source: "a:1", target: "b:2", type: "relates_to" }),
      _extra: "noise",
    };
    const result = canonicalizeEdge(edge);
    expect(result).not.toHaveProperty("_extra");
  });

  test("B3: description field included if present, excluded if absent", () => {
    const withDesc = makeEdge({ source: "a:1", target: "b:2", type: "mentions", description: "test" });
    const withoutDesc = makeEdge({ source: "a:1", target: "b:2", type: "mentions" });
    expect(canonicalizeEdge(withDesc)).toHaveProperty("description", "test");
    expect(canonicalizeEdge(withoutDesc)).not.toHaveProperty("description");
  });

  test("B4: two edges with same data but different original key insertion order produce identical JSON", () => {
    const e1 = { direction: "out" as const, source: "a:1", target: "b:2", type: "related", weight: 0.5 };
    const e2 = { weight: 0.5, type: "related", target: "b:2", source: "a:1", direction: "out" as const };
    expect(JSON.stringify(canonicalizeEdge(e1))).toBe(JSON.stringify(canonicalizeEdge(e2)));
  });
});

// ---------------------------------------------------------------------------
// Section C — sortNodesByRecall
// ---------------------------------------------------------------------------

describe("C — sortNodesByRecall", () => {
  test("C1: nodes sorted by importance_score descending", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "topic:low", importance_score: 0.3 }),
      makeNode({ id: "topic:high", importance_score: 0.9 }),
      makeNode({ id: "topic:mid", importance_score: 0.6 }),
    ];
    const sorted = sortNodesByRecall(nodes);
    expect(sorted[0].id).toBe("topic:high");
    expect(sorted[1].id).toBe("topic:mid");
    expect(sorted[2].id).toBe("topic:low");
  });

  test("C2: when importance_score equal, confidence breaks the tie (high > medium > low)", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "topic:a", importance_score: 0.5, confidence: "low" }),
      makeNode({ id: "topic:b", importance_score: 0.5, confidence: "high" }),
      makeNode({ id: "topic:c", importance_score: 0.5, confidence: "medium" }),
    ];
    const sorted = sortNodesByRecall(nodes);
    expect(sorted[0].id).toBe("topic:b"); // high
    expect(sorted[1].id).toBe("topic:c"); // medium
    expect(sorted[2].id).toBe("topic:a"); // low
  });

  test("C3: when importance_score and confidence equal, id sorts ascending (stable)", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "topic:zebra", importance_score: 0.5, confidence: "medium" }),
      makeNode({ id: "topic:alpha", importance_score: 0.5, confidence: "medium" }),
      makeNode({ id: "topic:mango", importance_score: 0.5, confidence: "medium" }),
    ];
    const sorted = sortNodesByRecall(nodes);
    expect(sorted[0].id).toBe("topic:alpha");
    expect(sorted[1].id).toBe("topic:mango");
    expect(sorted[2].id).toBe("topic:zebra");
  });

  test("C4: nodes without importance_score rank below nodes with it (string importance fallback)", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "topic:no-imp", confidence: "high" }), // no importance_score
      makeNode({ id: "topic:imp", importance_score: 0.4, confidence: "high" }),
    ];
    const sorted = sortNodesByRecall(nodes);
    expect(sorted[0].id).toBe("topic:imp");
  });

  test("C5: string importance fallback: high > medium > low when no importance_score", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "topic:low", importance: "low" }),
      makeNode({ id: "topic:high", importance: "high" }),
      makeNode({ id: "topic:med", importance: "medium" }),
    ];
    const sorted = sortNodesByRecall(nodes);
    expect(sorted[0].id).toBe("topic:high");
    expect(sorted[1].id).toBe("topic:med");
    expect(sorted[2].id).toBe("topic:low");
  });

  test("C6: does NOT mutate the input array", () => {
    const nodes: GraphNode[] = [
      makeNode({ id: "topic:z" }),
      makeNode({ id: "topic:a" }),
    ];
    const original = nodes.map(n => n.id);
    sortNodesByRecall(nodes);
    expect(nodes.map(n => n.id)).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// Section D — writeKnowledgeLinks: output shape
// ---------------------------------------------------------------------------

describe("D — writeKnowledgeLinks output shape", () => {
  test("D1: creates knowledge-recall.json at .guild/indexes/", () => {
    const repo = mkTmpRepo();
    const result = writeKnowledgeLinks({
      graph: { nodes: [makeNode({ id: "topic:a" })], edges: [] },
      repoRoot: repo,
    });
    expect(fs.existsSync(result.linksPath)).toBe(true);
    expect(result.linksPath).toBe(path.join(repo, ".guild", "indexes", "knowledge-recall.json"));
  });

  test("D2: creates knowledge-recall-provenance.json at .guild/indexes/", () => {
    const repo = mkTmpRepo();
    const result = writeKnowledgeLinks({
      graph: { nodes: [], edges: [] },
      repoRoot: repo,
    });
    expect(fs.existsSync(result.provenancePath)).toBe(true);
    expect(result.provenancePath).toBe(
      path.join(repo, ".guild", "indexes", "knowledge-recall-provenance.json"),
    );
  });

  test("D3: knowledge-recall.json has correct schema_version", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({ graph: { nodes: [], edges: [] }, repoRoot: repo });
    const doc = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8"),
    ) as KnowledgeLinksDoc;
    expect(doc.schema_version).toBe(KNOWLEDGE_RECALL_SCHEMA_VERSION);
  });

  test("D4: result.nodeCount and result.edgeCount match input graph", () => {
    const repo = mkTmpRepo();
    const result = writeKnowledgeLinks({
      graph: {
        nodes: [makeNode({ id: "topic:x" }), makeNode({ id: "topic:y" })],
        edges: [makeEdge({ source: "topic:x", target: "topic:y", type: "related" })],
      },
      repoRoot: repo,
    });
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(1);
  });

  test("D5: edges in output are sorted by (source, target, type)", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({
      graph: {
        nodes: [
          makeNode({ id: "topic:a" }),
          makeNode({ id: "topic:b" }),
          makeNode({ id: "topic:c" }),
        ],
        edges: [
          makeEdge({ source: "topic:c", target: "topic:a", type: "related" }),
          makeEdge({ source: "topic:a", target: "topic:b", type: "related" }),
          makeEdge({ source: "topic:b", target: "topic:c", type: "related" }),
        ],
      },
      repoRoot: repo,
    });
    const doc = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8"),
    ) as KnowledgeLinksDoc;
    expect(doc.edges[0].source).toBe("topic:a");
    expect(doc.edges[1].source).toBe("topic:b");
    expect(doc.edges[2].source).toBe("topic:c");
  });

  test("D6: nodes in output are sorted by recall score (importance_score desc)", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({
      graph: {
        nodes: [
          makeNode({ id: "topic:low", importance_score: 0.2 }),
          makeNode({ id: "topic:high", importance_score: 0.9 }),
        ],
        edges: [],
      },
      repoRoot: repo,
    });
    const doc = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8"),
    ) as KnowledgeLinksDoc;
    expect(doc.nodes[0].id).toBe("topic:high");
    expect(doc.nodes[1].id).toBe("topic:low");
  });
});

// ---------------------------------------------------------------------------
// Section E — SC-8 nonce-free proof
// ---------------------------------------------------------------------------

describe("E — SC-8 nonce-free proof: different runIds → byte-identical knowledge-recall.json", () => {
  const GRAPH = {
    nodes: [
      makeNode({ id: "topic:auth", name: "Authentication", importance_score: 0.8, confidence: "high" }),
      makeNode({ id: "entity:validator", type: "entity", name: "Validator" }),
    ],
    edges: [
      makeEdge({ source: "topic:auth", target: "entity:validator", type: "mentions" }),
    ],
  };

  test("E1 (SC-8 core): two invocations with different runIds produce byte-identical knowledge-recall.json", () => {
    const repo1 = mkTmpRepo();
    const repo2 = mkTmpRepo();

    writeKnowledgeLinks({
      graph: GRAPH,
      repoRoot: repo1,
      runId: "run-aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa",
      generatedAt: "2026-06-12T10:00:00.000Z",
    });

    writeKnowledgeLinks({
      graph: GRAPH,
      repoRoot: repo2,
      runId: "run-bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb",
      generatedAt: "2026-06-12T11:30:00.000Z",
    });

    const links1 = fs.readFileSync(
      path.join(repo1, ".guild", "indexes", "knowledge-recall.json"), "utf8",
    );
    const links2 = fs.readFileSync(
      path.join(repo2, ".guild", "indexes", "knowledge-recall.json"), "utf8",
    );

    // Byte-identical — the core SC-8 assertion
    expect(links1).toBe(links2);
  });

  test("E2 (SC-8): knowledge-recall.json contains NO run_id field at any nesting level", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({
      graph: GRAPH,
      repoRoot: repo,
      runId: "run-secret-run-id",
    });
    const raw = fs.readFileSync(
      path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8",
    );
    // The literal string "run-secret-run-id" must not appear in the main file
    expect(raw).not.toContain("run-secret-run-id");
    // No "run_id" key anywhere in the file
    expect(raw).not.toMatch(/"run_id"\s*:/);
  });

  test("E3 (SC-8): knowledge-recall.json contains NO timestamp / generatedAt / generated_at field", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({
      graph: GRAPH,
      repoRoot: repo,
      generatedAt: "2026-06-12T10:00:00.000Z",
    });
    const raw = fs.readFileSync(
      path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8",
    );
    expect(raw).not.toContain("2026-06-12T10:00:00.000Z");
    expect(raw).not.toMatch(/"generated_at"\s*:/);
    expect(raw).not.toMatch(/"generatedAt"\s*:/);
  });

  test("E4 (SC-8): same graph, two triggers without runId → still byte-identical", () => {
    const repo1 = mkTmpRepo();
    const repo2 = mkTmpRepo();

    writeKnowledgeLinks({ graph: GRAPH, repoRoot: repo1 });
    writeKnowledgeLinks({ graph: GRAPH, repoRoot: repo2 });

    const links1 = fs.readFileSync(path.join(repo1, ".guild", "indexes", "knowledge-recall.json"), "utf8");
    const links2 = fs.readFileSync(path.join(repo2, ".guild", "indexes", "knowledge-recall.json"), "utf8");
    expect(links1).toBe(links2);
  });

  test("E5 (SC-8): different runIds → provenance sidecars ARE different", () => {
    const repo1 = mkTmpRepo();
    const repo2 = mkTmpRepo();

    writeKnowledgeLinks({ graph: GRAPH, repoRoot: repo1, runId: "run-aaa" });
    writeKnowledgeLinks({ graph: GRAPH, repoRoot: repo2, runId: "run-bbb" });

    const prov1 = fs.readFileSync(
      path.join(repo1, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8",
    );
    const prov2 = fs.readFileSync(
      path.join(repo2, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8",
    );
    // Provenance files differ — they carry the run_id
    expect(prov1).not.toBe(prov2);
    expect(prov1).toContain("run-aaa");
    expect(prov2).toContain("run-bbb");
  });
});

// ---------------------------------------------------------------------------
// Section F — Provenance sidecar
// ---------------------------------------------------------------------------

describe("F — provenance sidecar", () => {
  test("F1: provenance sidecar has correct schema_version", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({ graph: { nodes: [], edges: [] }, repoRoot: repo, runId: "run-test" });
    const prov = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8"),
    );
    expect(prov.schema_version).toBe(KNOWLEDGE_LINKS_PROVENANCE_SCHEMA_VERSION);
  });

  test("F2: provenance sidecar contains run_id when provided", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({ graph: { nodes: [], edges: [] }, repoRoot: repo, runId: "run-xyz" });
    const prov = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8"),
    );
    expect(prov.run_id).toBe("run-xyz");
  });

  test("F3: provenance sidecar contains generated_at when provided", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({
      graph: { nodes: [], edges: [] },
      repoRoot: repo,
      generatedAt: "2026-06-12T12:00:00.000Z",
    });
    const prov = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8"),
    );
    expect(prov.generated_at).toBe("2026-06-12T12:00:00.000Z");
  });

  test("F4: provenance sidecar node_count and edge_count match input", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({
      graph: {
        nodes: [makeNode({ id: "topic:a" }), makeNode({ id: "topic:b" })],
        edges: [makeEdge({ source: "topic:a", target: "topic:b", type: "related" })],
      },
      repoRoot: repo,
    });
    const prov = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8"),
    );
    expect(prov.node_count).toBe(2);
    expect(prov.edge_count).toBe(1);
  });

  test("F5: provenance sidecar run_id is null when not provided", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({ graph: { nodes: [], edges: [] }, repoRoot: repo });
    const prov = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8"),
    );
    expect(prov.run_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section G — L0 convention: JSON.stringify(.,null,2)+"\n"
// ---------------------------------------------------------------------------

describe("G — L0 JSON convention", () => {
  test("G1: knowledge-recall.json ends with exactly one newline", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({ graph: { nodes: [makeNode({ id: "topic:a" })], edges: [] }, repoRoot: repo });
    const raw = fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.endsWith("\n\n")).toBe(false);
  });

  test("G2: knowledge-recall.json uses 2-space indentation", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({ graph: { nodes: [makeNode({ id: "topic:a" })], edges: [] }, repoRoot: repo });
    const raw = fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8");
    // Check that lines inside the JSON use 2-space indent (not 4-space, not tab)
    const lines = raw.split("\n");
    const indentedLines = lines.filter(l => l.startsWith("  ") && !l.startsWith("    "));
    expect(indentedLines.length).toBeGreaterThan(0);
  });

  test("G3: knowledge-recall-provenance.json also ends with exactly one newline", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({ graph: { nodes: [], edges: [] }, repoRoot: repo });
    const raw = fs.readFileSync(
      path.join(repo, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8",
    );
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.endsWith("\n\n")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section H — Empty graph
// ---------------------------------------------------------------------------

describe("H — empty graph", () => {
  test("H1: empty graph writes successfully without error", () => {
    const repo = mkTmpRepo();
    expect(() =>
      writeKnowledgeLinks({ graph: { nodes: [], edges: [] }, repoRoot: repo }),
    ).not.toThrow();
  });

  test("H2: empty graph → empty nodes + edges arrays in output", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({ graph: { nodes: [], edges: [] }, repoRoot: repo });
    const doc = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8"),
    ) as KnowledgeLinksDoc;
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
  });

  test("H3: creates .guild/indexes/ directory if it does not exist", () => {
    const repo = mkTmpRepo();
    // Deliberately do NOT pre-create .guild/indexes/
    expect(fs.existsSync(path.join(repo, ".guild", "indexes"))).toBe(false);
    writeKnowledgeLinks({ graph: { nodes: [], edges: [] }, repoRoot: repo });
    expect(fs.existsSync(path.join(repo, ".guild", "indexes", "knowledge-recall.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section I — Dedup: duplicate edges not written twice
// ---------------------------------------------------------------------------

describe("I — duplicate edge dedup", () => {
  test("I1: identical (source, target, type) appears only once in output", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({
      graph: {
        nodes: [makeNode({ id: "topic:a" }), makeNode({ id: "topic:b" })],
        edges: [
          makeEdge({ source: "topic:a", target: "topic:b", type: "related", weight: 0.8 }),
          makeEdge({ source: "topic:a", target: "topic:b", type: "related", weight: 0.6 }),
        ],
      },
      repoRoot: repo,
    });
    const doc = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8"),
    ) as KnowledgeLinksDoc;
    const dedup = doc.edges.filter(
      e => e.source === "topic:a" && e.target === "topic:b" && e.type === "related",
    );
    expect(dedup).toHaveLength(1);
    // First occurrence (higher weight) kept
    expect(dedup[0].weight).toBe(0.8);
  });

  test("I2: different type with same source+target → both kept", () => {
    const repo = mkTmpRepo();
    writeKnowledgeLinks({
      graph: {
        nodes: [makeNode({ id: "topic:a" }), makeNode({ id: "topic:b" })],
        edges: [
          makeEdge({ source: "topic:a", target: "topic:b", type: "related" }),
          makeEdge({ source: "topic:a", target: "topic:b", type: "mentions" }),
        ],
      },
      repoRoot: repo,
    });
    const doc = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-recall.json"), "utf8"),
    ) as KnowledgeLinksDoc;
    expect(doc.edges).toHaveLength(2);
  });
});
