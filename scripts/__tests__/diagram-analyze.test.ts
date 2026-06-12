/**
 * scripts/__tests__/diagram-analyze.test.ts
 *
 * L3 TDD-first tests — SC-7: K3 diagram analysis
 *
 * Tests `plugin/scripts/understand/diagram-analyze.ts` against the frozen
 * L0f knowledge fixture corpus at
 * `scripts/understand/__tests__/fixtures/knowledge/`.
 *
 * Sections:
 *   A — mermaid block extraction + parse (deterministic)
 *   B — SVG file parse (label-text deterministic; svg_description LLM-stub)
 *   C — determinism: two consecutive calls → same result (SC-11 / SC-9)
 *   D — SC-9 determinism-boundary: svg_description NOT populated by the
 *       deterministic stage (LLM field)
 *   E — diagram node IDs are fully deterministic (assert exactly per
 *       notes_for_lane_owners.L3_diagram_analyze)
 *
 * field_contract rules applied throughout:
 *   • node.id         — HARD for diagram nodes (assert exactly)
 *   • node.type       — HARD ("diagram")
 *   • node.category   — HARD ("diagram")
 *   • node.source_refs — HARD — non-empty; every anchor resolves per-form
 *   • node.confidence — ENUM-PRESENT (one of high|medium|low)
 *   • edge source/target/type/direction — HARD
 *   • edge weight     — RANGE 0..1 (not exact for LLM-scored edges)
 *
 * Usage: npx jest --testPathPattern=diagram-analyze --no-coverage
 */

import * as path from "path";
import type { GraphNode } from "../understand/lib/schema";

// ── Import under test (fails at RED state — module does not exist yet) ──────
import {
  analyzeDiagrams,
} from "../understand/diagram-analyze";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CORPUS_DIR = path.resolve(
  __dirname,
  "../understand/__tests__/fixtures/knowledge"
);

/**
 * All corpus-relative file paths (markdown + SVG) that diagram-analyze should
 * scan.  Only docs/ingestion.md contains a mermaid block; only
 * diagrams/architecture.svg is an SVG.
 */
const ALL_CORPUS_FILES: string[] = [
  "index.md",
  "docs/overview.md",
  "docs/ingestion.md",
  "docs/validation.md",
  "docs/storage.md",
  "docs/concepts.md",
  "src/ingest.ts",
  "src/validate.ts",
  "src/store.ts",
  "diagrams/architecture.svg",
];

// Expected values from expected-output.json SC-7 section
const MERMAID_ANCHOR = "docs/ingestion.md#mermaid-0";
const MERMAID_NODE_ID = "diagram:docs/ingestion.md#mermaid-0";
const EXPECTED_MERMAID_NODES = ["Adapter", "Ingest", "Validate", "Store"];
const EXPECTED_MERMAID_EDGES = [
  { from: "Adapter", to: "Ingest" },
  { from: "Ingest", to: "Validate" },
  { from: "Validate", to: "Store" },
];

const SVG_ANCHOR = "diagrams/architecture.svg#svg";
const SVG_NODE_ID = "diagram:diagrams/architecture.svg#svg";
const EXPECTED_SVG_TITLE = "Event Pipeline Architecture";
const EXPECTED_SVG_LABELS = ["Ingest", "Validate", "Store"];
const EXPECTED_SVG_ELEMENT_IDS = ["ingest-box", "validate-box", "store-box"];

const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);

// ── Helper ────────────────────────────────────────────────────────────────────

function findNode(nodes: GraphNode[], id: string): GraphNode | undefined {
  return nodes.find((n) => n.id === id);
}

// ── A: mermaid block extraction ───────────────────────────────────────────────

describe("A — mermaid diagram node", () => {
  let nodes: GraphNode[];

  beforeAll(() => {
    const result = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    nodes = result.nodes;
  });

  test("emits exactly one diagram node for docs/ingestion.md#mermaid-0", () => {
    const count = nodes.filter((n) => n.id === MERMAID_NODE_ID).length;
    expect(count).toBe(1);
  });

  test("mermaid diagram node: id is HARD-exact", () => {
    const n = findNode(nodes, MERMAID_NODE_ID);
    expect(n).toBeDefined();
    expect(n!.id).toBe(MERMAID_NODE_ID);
  });

  test("mermaid diagram node: type === 'diagram' (HARD)", () => {
    const n = findNode(nodes, MERMAID_NODE_ID)!;
    expect(n.type).toBe("diagram");
  });

  test("mermaid diagram node: category === 'diagram' (HARD)", () => {
    const n = findNode(nodes, MERMAID_NODE_ID)!;
    expect(n.category).toBe("diagram");
  });

  test("mermaid diagram node: source_refs contains anchor (HARD)", () => {
    const n = findNode(nodes, MERMAID_NODE_ID)!;
    expect(Array.isArray(n.source_refs)).toBe(true);
    expect(n.source_refs.length).toBeGreaterThanOrEqual(1);
    expect(n.source_refs).toContain(MERMAID_ANCHOR);
  });

  test("mermaid diagram node: confidence is enum-present (ENUM-PRESENT)", () => {
    const n = findNode(nodes, MERMAID_NODE_ID)!;
    expect(VALID_CONFIDENCE.has(n.confidence)).toBe(true);
  });

  test("mermaid diagram node: name is a non-empty string", () => {
    const n = findNode(nodes, MERMAID_NODE_ID)!;
    expect(typeof n.name).toBe("string");
    expect((n.name as string).length).toBeGreaterThan(0);
  });

  test("mermaid diagram node: name matches expected-graph.v2.json value (HARD)", () => {
    const n = findNode(nodes, MERMAID_NODE_ID)!;
    expect(n.name).toBe("Ingestion flow (mermaid)");
  });

  // SC-7: mermaid node extraction — DETERMINISTIC
  test("SC-7: mermaid_nodes array contains all expected node IDs", () => {
    const n = findNode(nodes, MERMAID_NODE_ID) as any;
    expect(Array.isArray(n.mermaid_nodes)).toBe(true);
    expect(n.mermaid_nodes).toEqual(
      expect.arrayContaining(EXPECTED_MERMAID_NODES)
    );
    expect(n.mermaid_nodes.length).toBe(EXPECTED_MERMAID_NODES.length);
  });

  // SC-7: mermaid edge extraction — DETERMINISTIC
  test("SC-7: mermaid_edges contains all expected edges", () => {
    const n = findNode(nodes, MERMAID_NODE_ID) as any;
    expect(Array.isArray(n.mermaid_edges)).toBe(true);
    expect(n.mermaid_edges).toEqual(
      expect.arrayContaining(EXPECTED_MERMAID_EDGES)
    );
    expect(n.mermaid_edges.length).toBe(EXPECTED_MERMAID_EDGES.length);
  });

  test("SC-7: mermaid_edges use node IDs (not display labels)", () => {
    const n = findNode(nodes, MERMAID_NODE_ID) as any;
    // 'Adapter' not 'Webhook Adapter'; 'Ingest' not 'ingestEvent', etc.
    const fromIds = n.mermaid_edges.map((e: any) => e.from);
    const toIds = n.mermaid_edges.map((e: any) => e.to);
    expect(fromIds).toContain("Adapter");
    expect(toIds).toContain("Ingest");
    expect(fromIds).not.toContain("Webhook Adapter");
    expect(toIds).not.toContain("ingestEvent");
  });
});

// ── B: SVG file parsing ───────────────────────────────────────────────────────

describe("B — SVG diagram node", () => {
  let nodes: GraphNode[];

  beforeAll(() => {
    const result = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    nodes = result.nodes;
  });

  test("emits exactly one diagram node for diagrams/architecture.svg#svg", () => {
    const count = nodes.filter((n) => n.id === SVG_NODE_ID).length;
    expect(count).toBe(1);
  });

  test("SVG diagram node: id is HARD-exact", () => {
    const n = findNode(nodes, SVG_NODE_ID);
    expect(n).toBeDefined();
    expect(n!.id).toBe(SVG_NODE_ID);
  });

  test("SVG diagram node: type === 'diagram' (HARD)", () => {
    const n = findNode(nodes, SVG_NODE_ID)!;
    expect(n.type).toBe("diagram");
  });

  test("SVG diagram node: category === 'diagram' (HARD)", () => {
    const n = findNode(nodes, SVG_NODE_ID)!;
    expect(n.category).toBe("diagram");
  });

  test("SVG diagram node: source_refs contains anchor (HARD)", () => {
    const n = findNode(nodes, SVG_NODE_ID)!;
    expect(Array.isArray(n.source_refs)).toBe(true);
    expect(n.source_refs.length).toBeGreaterThanOrEqual(1);
    expect(n.source_refs).toContain(SVG_ANCHOR);
  });

  test("SVG diagram node: confidence is enum-present (ENUM-PRESENT)", () => {
    const n = findNode(nodes, SVG_NODE_ID)!;
    expect(VALID_CONFIDENCE.has(n.confidence)).toBe(true);
  });

  test("SVG diagram node: name matches expected-graph.v2.json value (HARD)", () => {
    const n = findNode(nodes, SVG_NODE_ID)!;
    expect(n.name).toBe("Architecture (svg)");
  });

  // SC-7: SVG title extraction — DETERMINISTIC
  test("SC-7: svg_title matches <title> element", () => {
    const n = findNode(nodes, SVG_NODE_ID) as any;
    expect(n.svg_title).toBe(EXPECTED_SVG_TITLE);
  });

  // SC-7: SVG label text extraction — DETERMINISTIC
  test("SC-7: svg_labels contains all expected text labels", () => {
    const n = findNode(nodes, SVG_NODE_ID) as any;
    expect(Array.isArray(n.svg_labels)).toBe(true);
    expect(n.svg_labels).toEqual(
      expect.arrayContaining(EXPECTED_SVG_LABELS)
    );
  });

  // SC-7: SVG element ID extraction — DETERMINISTIC
  test("SC-7: svg_element_ids contains all expected element ids", () => {
    const n = findNode(nodes, SVG_NODE_ID) as any;
    expect(Array.isArray(n.svg_element_ids)).toBe(true);
    expect(n.svg_element_ids).toEqual(
      expect.arrayContaining(EXPECTED_SVG_ELEMENT_IDS)
    );
  });
});

// ── C: determinism ────────────────────────────────────────────────────────────

describe("C — determinism (SC-9 / SC-11)", () => {
  test("two consecutive calls on the same corpus are byte-identical", () => {
    const r1 = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    const r2 = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  test("file order in input does not affect output node IDs", () => {
    const reversed = [...ALL_CORPUS_FILES].reverse();
    const r1 = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    const r2 = analyzeDiagrams(CORPUS_DIR, reversed);
    // Node IDs must be present in both
    const ids1 = new Set(r1.nodes.map((n) => n.id));
    const ids2 = new Set(r2.nodes.map((n) => n.id));
    expect(ids1).toEqual(ids2);
  });
});

// ── D: SC-9 determinism boundary ─────────────────────────────────────────────

describe("D — SC-9 determinism boundary", () => {
  test("svg_description is NOT populated by the deterministic stage (LLM field)", () => {
    const result = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    const svgNode = findNode(result.nodes, SVG_NODE_ID) as any;
    // svg_description is the ONLY LLM field in K3; deterministic stage must leave it
    // undefined (not set to an empty string — that would be pretending to be LLM-free)
    expect(svgNode.svg_description).toBeUndefined();
  });

  test("mermaid_nodes and mermaid_edges are populated (deterministic-script fields)", () => {
    const result = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    const n = findNode(result.nodes, MERMAID_NODE_ID) as any;
    expect(Array.isArray(n.mermaid_nodes)).toBe(true);
    expect(n.mermaid_nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(n.mermaid_edges)).toBe(true);
    expect(n.mermaid_edges.length).toBeGreaterThan(0);
  });

  test("svg_title and svg_labels are populated (deterministic-script fields)", () => {
    const result = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    const n = findNode(result.nodes, SVG_NODE_ID) as any;
    expect(typeof n.svg_title).toBe("string");
    expect(n.svg_title.length).toBeGreaterThan(0);
    expect(Array.isArray(n.svg_labels)).toBe(true);
    expect(n.svg_labels.length).toBeGreaterThan(0);
  });
});

// ── E: diagram node IDs are fully deterministic ───────────────────────────────

describe("E — diagram IDs are fully deterministic (SC-11 / SC-12)", () => {
  test("total diagram nodes count = 2 (1 mermaid + 1 svg)", () => {
    const result = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    const diagrams = result.nodes.filter((n) => n.type === "diagram");
    expect(diagrams.length).toBe(2);
  });

  test("both expected diagram IDs are present (HARD)", () => {
    const result = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    const ids = new Set(result.nodes.map((n) => n.id));
    expect(ids.has(MERMAID_NODE_ID)).toBe(true);
    expect(ids.has(SVG_NODE_ID)).toBe(true);
  });

  test("non-diagram files (markdown without mermaid, .ts files) produce no diagram nodes", () => {
    // Only ingestion.md has a mermaid block; others are pure prose
    const mdOnlyFiles = [
      "index.md",
      "docs/overview.md",
      "docs/validation.md",
      "docs/storage.md",
      "docs/concepts.md",
    ];
    const result = analyzeDiagrams(CORPUS_DIR, mdOnlyFiles);
    expect(result.nodes.filter((n) => n.type === "diagram").length).toBe(0);
  });

  test("SC-7 seeded topic→diagram target anchor exists as a diagram node", () => {
    // L5 will create evidenced_by edge: topic:79c825b8 → diagram:docs/ingestion.md#mermaid-0
    // K3 must have emitted the target node so L5's anchor resolves (SC-4 global check).
    const result = analyzeDiagrams(CORPUS_DIR, ALL_CORPUS_FILES);
    const target = findNode(result.nodes, MERMAID_NODE_ID);
    expect(target).toBeDefined();
    // source_refs anchor must resolve: docs/ingestion.md#mermaid-0
    expect(target!.source_refs).toContain("docs/ingestion.md#mermaid-0");
  });
});
