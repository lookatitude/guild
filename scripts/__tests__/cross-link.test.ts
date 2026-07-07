/**
 * K5 cross-modal-link tests — TDD suite for cross-link.ts
 *
 * Sections:
 *   A — Pure helpers (fileFromSourceRef, funcNameFromId, escapeRegex, wordBoundaryRegex, extractKeyTerms)
 *   B — proposeCandidates (deterministic, file-read rules 1-5)
 *   C — Fail-loud seam guard (confirmCrossLinks absent)
 *   D — Weight filtering (< relMinConf dropped)
 *   E — Anchor resolution (evidenced_by target must resolve; invalid → dropped)
 *   F — Integration oracle (SC-4: seeded claim→code + topic→diagram; all 6 cross-modal edges)
 *   G — Dedup against existing input.edges
 */

import * as path from "path";
import * as fs from "fs";
import type { GraphNode, GraphEdge } from "../learn/lib/schema";
import {
  fileFromSourceRef,
  funcNameFromId,
  escapeRegex,
  wordBoundaryRegex,
  extractKeyTerms,
  nameSlugTokens,
  sharedPrefixLen,
  proposeCandidates,
  buildCrossLinks,
  CrossLinkCandidate,
  ConfirmCrossLinksFn,
} from "../learn/cross-link";

// ---------------------------------------------------------------------------
// Shared fixture paths
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = path.join(__dirname, "../learn/__tests__/fixtures/knowledge");

// Load oracle graph once (shared across integration tests)
const ORACLE_GRAPH = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_ROOT, "expected-graph.v2.json"), "utf-8")
) as { nodes: GraphNode[]; edges: GraphEdge[] };

// Oracle cross-modal edges (K5 scope only)
const ORACLE_CROSS_MODAL: GraphEdge[] = [
  // evidenced_by
  {
    source: "claim:docs/ingestion.md#ingestion:0ee19523",
    target: "function:src/validate.ts:validateEvent",
    type: "evidenced_by",
    direction: "out",
    weight: 0.9,
  },
  {
    source: "claim:docs/storage.md#storage:e8805bb0",
    target: "function:src/store.ts:storeEvent",
    type: "evidenced_by",
    direction: "out",
    weight: 0.9,
  },
  {
    source: "topic:79c825b8",
    target: "diagram:docs/ingestion.md#mermaid-0",
    type: "evidenced_by",
    direction: "out",
    weight: 0.8,
  },
  // mentions
  {
    source: "function:src/validate.ts:validateEvent",
    target: "entity:validator",
    type: "mentions",
    direction: "out",
    weight: 0.6,
  },
  // relates_to
  {
    source: "entity:event-store",
    target: "topic:a21d1858",
    type: "relates_to",
    direction: "out",
    weight: 0.6,
  },
  {
    source: "entity:validator",
    target: "topic:189866d8",
    type: "relates_to",
    direction: "out",
    weight: 0.7,
  },
];

/**
 * Oracle ConfirmCrossLinksFn — returns the 6 oracle edges when all relevant
 * source/target node IDs are present in the nodes argument.
 */
const ORACLE_CONFIRM: ConfirmCrossLinksFn = async (_nodes, _candidates, _ctx) => {
  return ORACLE_CROSS_MODAL;
};

// ---------------------------------------------------------------------------
// Minimal node helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<GraphNode> & { id: string; type: string }): GraphNode {
  return {
    name: overrides.id,
    source_refs: [],
    confidence: "high",
    ...overrides,
  } as GraphNode;
}

// ---------------------------------------------------------------------------
// Section A — Pure helpers
// ---------------------------------------------------------------------------

describe("A — fileFromSourceRef", () => {
  test("A1: strips fragment from heading anchor", () => {
    expect(fileFromSourceRef("docs/ingestion.md#ingestion")).toBe("docs/ingestion.md");
  });

  test("A2: strips fragment from line-range anchor", () => {
    expect(fileFromSourceRef("src/validate.ts#L16-L20")).toBe("src/validate.ts");
  });

  test("A3: strips fragment from mermaid anchor", () => {
    expect(fileFromSourceRef("docs/ingestion.md#mermaid-0")).toBe("docs/ingestion.md");
  });

  test("A4: no fragment → returns full ref unchanged", () => {
    expect(fileFromSourceRef("src/store.ts")).toBe("src/store.ts");
  });

  test("A5: svg anchor → strips fragment", () => {
    expect(fileFromSourceRef("diagrams/arch.svg#svg")).toBe("diagrams/arch.svg");
  });
});

describe("A — funcNameFromId", () => {
  test("A6: extracts function name from standard function id", () => {
    expect(funcNameFromId("function:src/validate.ts:validateEvent")).toBe("validateEvent");
  });

  test("A7: extracts name from nested path", () => {
    expect(funcNameFromId("function:src/adapters/webhook.ts:handlePost")).toBe("handlePost");
  });

  test("A8: returns null for non-function node ids", () => {
    expect(funcNameFromId("claim:docs/overview.md#overview:abc123")).toBeNull();
    expect(funcNameFromId("topic:79c825b8")).toBeNull();
    expect(funcNameFromId("entity:validator")).toBeNull();
    expect(funcNameFromId("diagram:docs/ingestion.md#mermaid-0")).toBeNull();
  });
});

describe("A — escapeRegex + wordBoundaryRegex", () => {
  test("A9: escapeRegex escapes special chars", () => {
    expect(escapeRegex("validate.ts")).toBe("validate\\.ts");
    expect(escapeRegex("a+b")).toBe("a\\+b");
    expect(escapeRegex("validateEvent")).toBe("validateEvent");
  });

  test("A10: wordBoundaryRegex matches exact token", () => {
    const re = wordBoundaryRegex("store");
    expect(re.test("the store opens")).toBe(true);
    expect(re.test("store")).toBe(true);
  });

  test("A11: wordBoundaryRegex does NOT match partial token — store vs stored", () => {
    // L1 lesson: word-boundary prevents substring false positives
    const re = wordBoundaryRegex("store");
    expect(re.test("stored append-only")).toBe(false);
    expect(re.test("storeEvent")).toBe(false);
  });

  test("A12: wordBoundaryRegex does NOT match partial token — validate vs validated", () => {
    const re = wordBoundaryRegex("validate");
    expect(re.test("validated before")).toBe(false);
    expect(re.test("validate a raw event")).toBe(true);
  });

  test("A13: wordBoundaryRegex with 'i' flag is case-insensitive", () => {
    const re = wordBoundaryRegex("Validator", "i");
    expect(re.test("The validator enforces")).toBe(true);
    expect(re.test("The Validator is the component")).toBe(true);
  });
});

describe("A — extractKeyTerms", () => {
  test("A14: strips stopwords and short words", () => {
    const terms = extractKeyTerms("Events are stored append-only and never mutated.");
    expect(terms).toContain("stored");
    expect(terms).toContain("append");
    expect(terms).toContain("mutated");
    // stopwords removed
    expect(terms).not.toContain("are");
    expect(terms).not.toContain("and");
    expect(terms).not.toContain("never");
  });

  test("A15: strips words shorter than 4 chars", () => {
    const terms = extractKeyTerms("A big red box.");
    expect(terms).not.toContain("big"); // len 3
    expect(terms).not.toContain("red"); // len 3
    expect(terms).not.toContain("A"); // len 1
  });

  test("A16: strips punctuation before splitting", () => {
    // "append-only" → "append only" → ["append"] (only stripped via STOPWORDS)
    const terms = extractKeyTerms("append-only storage.");
    expect(terms).toContain("append");
    expect(terms).toContain("storage");
  });
});

// ---------------------------------------------------------------------------
// Section B — proposeCandidates (deterministic, fixture-backed)
// ---------------------------------------------------------------------------

describe("B — proposeCandidates", () => {
  // Use oracle graph nodes for candidate detection
  const NODES = ORACLE_GRAPH.nodes;

  test("B1: Rule 1 — topic sharing docs/ingestion.md with diagram → shared_file candidate", () => {
    const candidates = proposeCandidates(FIXTURE_ROOT, NODES, []);
    // topic:79c825b8 source_ref docs/ingestion.md#ingestion
    // diagram:docs/ingestion.md#mermaid-0 source_ref docs/ingestion.md#mermaid-0
    const found = candidates.find(
      (c) =>
        ((c.source === "topic:79c825b8" && c.target === "diagram:docs/ingestion.md#mermaid-0") ||
          (c.source === "diagram:docs/ingestion.md#mermaid-0" && c.target === "topic:79c825b8")) &&
        c.reason === "shared_file"
    );
    expect(found).toBeDefined();
  });

  test("B2: Rule 2 — validateEvent name in docs/ingestion.md → func_in_doc candidate (claim→function)", () => {
    const candidates = proposeCandidates(FIXTURE_ROOT, NODES, []);
    // claim at docs/ingestion.md; ingestion.md mermaid contains validateEvent
    const found = candidates.find(
      (c) =>
        c.source === "claim:docs/ingestion.md#ingestion:0ee19523" &&
        c.target === "function:src/validate.ts:validateEvent" &&
        c.reason === "func_in_doc"
    );
    expect(found).toBeDefined();
  });

  test("B3: Rule 2 — storeEvent name in docs/ingestion.md → func_in_doc candidate (claim:ingestion→storeEvent)", () => {
    const candidates = proposeCandidates(FIXTURE_ROOT, NODES, []);
    // ingestion.md mermaid also contains storeEvent
    const found = candidates.find(
      (c) =>
        c.source === "claim:docs/ingestion.md#ingestion:0ee19523" &&
        c.target === "function:src/store.ts:storeEvent" &&
        c.reason === "func_in_doc"
    );
    expect(found).toBeDefined();
  });

  test("B4: Rule 3 — claim:storage key terms in src/store.ts → claim_term_in_code candidate", () => {
    // claim text "Events are stored append-only and never mutated."
    // "stored" appears word-boundary in store.ts → candidate
    const candidates = proposeCandidates(FIXTURE_ROOT, NODES, []);
    const found = candidates.find(
      (c) =>
        c.source === "claim:docs/storage.md#storage:e8805bb0" &&
        c.target === "function:src/store.ts:storeEvent" &&
        c.reason === "claim_term_in_code"
    );
    expect(found).toBeDefined();
  });

  test("B5: Rule 4 — 'validator' (word-boundary, case-insensitive) in src/validate.ts → entity_in_code candidate", () => {
    // validate.ts doc: "The validator enforces..."
    const candidates = proposeCandidates(FIXTURE_ROOT, NODES, []);
    const found = candidates.find(
      (c) =>
        c.source === "function:src/validate.ts:validateEvent" &&
        c.target === "entity:validator" &&
        c.reason === "entity_in_code"
    );
    expect(found).toBeDefined();
  });

  test("B6: WORD-BOUNDARY SAFETY — 'store' does NOT match 'stored' in storage.md", () => {
    // The claim text DOES contain "stored" not "store".
    // This tests that we do NOT use naive includes() / startsWith()
    const storageContent = fs.readFileSync(
      path.join(FIXTURE_ROOT, "docs/storage.md"),
      "utf-8"
    );
    const storeRe = wordBoundaryRegex("store");
    expect(storeRe.test(storageContent)).toBe(false);
    // But "stored" DOES match with the correct term
    const storedRe = wordBoundaryRegex("stored");
    expect(storedRe.test(storageContent)).toBe(true);
  });

  test("B7: WORD-BOUNDARY SAFETY — 'validate' does NOT match 'validated' or 'validateEvent'", () => {
    // L1 lesson: must use \b<exact>\b, not includes()
    const validateRe = wordBoundaryRegex("validate");
    // "validated" — 'validate' + 'd' → 'd' is \w → no word boundary after 'e' → NO match
    expect(validateRe.test("Every incoming event is validated before it is persisted.")).toBe(false);
    // "validateEvent" — 'validate' + 'E' → 'E' is \w → no word boundary → NO match
    expect(validateRe.test("Ingest --> Validate[validateEvent]")).toBe(false);
    // But "validate" as a standalone word DOES match
    expect(validateRe.test("validate a raw event")).toBe(true);
  });

  test("B8: candidates are unique by (source, target, type)", () => {
    const candidates = proposeCandidates(FIXTURE_ROOT, NODES, []);
    const keys = candidates.map((c) => `${c.source}→${c.target}:${c.type}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// Section C — Fail-loud seam guard
// ---------------------------------------------------------------------------

describe("C — fail-loud seam guard", () => {
  const MINIMAL_NODES: GraphNode[] = [
    makeNode({ id: "topic:abc", type: "topic", source_refs: ["docs/overview.md#overview"] }),
  ];

  test("C1: throws when confirmCrossLinks is absent", async () => {
    await expect(
      buildCrossLinks(FIXTURE_ROOT, { nodes: MINIMAL_NODES, edges: [] }, {} as any)
    ).rejects.toThrow("LLM adapter");
  });

  test("C2: throw message contains 'confirmCrossLinks'", async () => {
    await expect(
      buildCrossLinks(FIXTURE_ROOT, { nodes: MINIMAL_NODES, edges: [] }, {} as any)
    ).rejects.toThrow(/confirmCrossLinks/);
  });

  test("C3: does NOT throw when confirmCrossLinks is provided (resolves)", async () => {
    const confirm: ConfirmCrossLinksFn = async () => [];
    await expect(
      buildCrossLinks(FIXTURE_ROOT, { nodes: MINIMAL_NODES, edges: [] }, { confirmCrossLinks: confirm })
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section D — Weight filtering
// ---------------------------------------------------------------------------

describe("D — weight filtering", () => {
  // topic source_ref points to ingestion.md so Rule 2 (\bingestEvent\b in that doc)
  // produces a deterministic candidate → B1 guard passes for evidenced_by edges
  const NODES: GraphNode[] = [
    makeNode({ id: "topic:t1", type: "topic", source_refs: ["docs/ingestion.md#ingestion"] }),
    makeNode({
      id: "function:src/ingest.ts:ingestEvent",
      type: "function",
      source_refs: ["src/ingest.ts#L21-L25"],
      name: "ingestEvent",
    }),
  ];

  test("D1: edges below relMinConf (0.5) are dropped", async () => {
    const confirm: ConfirmCrossLinksFn = async () => [
      {
        source: "topic:t1",
        target: "function:src/ingest.ts:ingestEvent",
        type: "evidenced_by",
        direction: "out",
        weight: 0.4, // below relMinConf
      },
    ];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: NODES, edges: [] },
      { confirmCrossLinks: confirm, relMinConf: 0.5 }
    );
    expect(result.edges).toHaveLength(0);
  });

  test("D2: edges at exactly relMinConf (0.5) are kept", async () => {
    const confirm: ConfirmCrossLinksFn = async () => [
      {
        source: "topic:t1",
        target: "function:src/ingest.ts:ingestEvent",
        type: "evidenced_by",
        direction: "out",
        weight: 0.5,
      },
    ];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: NODES, edges: [] },
      { confirmCrossLinks: confirm, relMinConf: 0.5 }
    );
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].weight).toBe(0.5);
  });

  test("D3: custom relMinConf respected", async () => {
    const confirm: ConfirmCrossLinksFn = async () => [
      { source: "topic:t1", target: "function:src/ingest.ts:ingestEvent", type: "evidenced_by", direction: "out", weight: 0.6 },
      { source: "topic:t1", target: "function:src/ingest.ts:ingestEvent", type: "relates_to", direction: "out", weight: 0.5 },
    ];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: NODES, edges: [] },
      { confirmCrossLinks: confirm, relMinConf: 0.7 }
    );
    // Both below 0.7
    expect(result.edges).toHaveLength(0);
  });

  test("D4: default relMinConf is 0.5 when not specified", async () => {
    const confirm: ConfirmCrossLinksFn = async () => [
      { source: "topic:t1", target: "function:src/ingest.ts:ingestEvent", type: "evidenced_by", direction: "out", weight: 0.5 },
    ];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: NODES, edges: [] },
      { confirmCrossLinks: confirm } // no relMinConf
    );
    expect(result.edges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Section E — Anchor resolution for evidenced_by targets
// ---------------------------------------------------------------------------

describe("E — anchor resolution for evidenced_by", () => {
  const fnNode: GraphNode = makeNode({
    id: "function:src/validate.ts:validateEvent",
    type: "function",
    name: "validateEvent",
    source_refs: ["src/validate.ts#L16-L20"],
  });

  const fnBadAnchor: GraphNode = makeNode({
    id: "function:src/validate.ts:validateEvent",
    type: "function",
    name: "validateEvent",
    source_refs: ["src/validate.ts#L9999-L9999"], // line does not exist
  });

  const topicNode: GraphNode = makeNode({
    id: "topic:79c825b8",
    type: "topic",
    source_refs: ["docs/ingestion.md#ingestion"],
  });

  test("E1: evidenced_by edge dropped when target anchor does not resolve", async () => {
    const confirm: ConfirmCrossLinksFn = async () => [
      {
        source: "topic:79c825b8",
        target: "function:src/validate.ts:validateEvent",
        type: "evidenced_by",
        direction: "out",
        weight: 0.9,
      },
    ];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: [topicNode, fnBadAnchor], edges: [] },
      { confirmCrossLinks: confirm }
    );
    expect(result.edges).toHaveLength(0);
  });

  test("E2: evidenced_by edge kept when target anchor resolves", async () => {
    const confirm: ConfirmCrossLinksFn = async () => [
      {
        source: "topic:79c825b8",
        target: "function:src/validate.ts:validateEvent",
        type: "evidenced_by",
        direction: "out",
        weight: 0.9,
      },
    ];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: [topicNode, fnNode], edges: [] },
      { confirmCrossLinks: confirm }
    );
    expect(result.edges).toHaveLength(1);
  });

  test("E3: mentions edge kept without anchor resolution check", async () => {
    // mentions edges are not validated against target anchor
    const confirm: ConfirmCrossLinksFn = async () => [
      {
        source: "function:src/validate.ts:validateEvent",
        target: "entity:validator",
        type: "mentions",
        direction: "out",
        weight: 0.6,
      },
    ];
    // name: "Validator" so Rule 4 finds \bValidator\b (case-insensitive) in src/validate.ts
    const entityNode = makeNode({ id: "entity:validator", type: "entity", source_refs: ["docs/concepts.md#validator"], name: "Validator" });
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: [fnNode, entityNode], edges: [] },
      { confirmCrossLinks: confirm }
    );
    expect(result.edges).toHaveLength(1);
  });

  test("E4: evidenced_by edge dropped when target node not found in nodes array", async () => {
    const confirm: ConfirmCrossLinksFn = async () => [
      {
        source: "topic:79c825b8",
        target: "function:src/validate.ts:unknownFunction",
        type: "evidenced_by",
        direction: "out",
        weight: 0.9,
      },
    ];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: [topicNode], edges: [] }, // target node absent
      { confirmCrossLinks: confirm }
    );
    expect(result.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section F — Integration oracle (SC-4)
// ---------------------------------------------------------------------------

describe("F — integration oracle (SC-4)", () => {
  const ALL_NODES = ORACLE_GRAPH.nodes;
  const EXISTING_EDGES: GraphEdge[] = []; // no prior edges from K1-K4 for this test

  test("F1 (SC-4 seeded): claim→code evidenced_by edge present at weight ≥ 0.5", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    const edge = result.edges.find(
      (e) =>
        e.source === "claim:docs/ingestion.md#ingestion:0ee19523" &&
        e.target === "function:src/validate.ts:validateEvent" &&
        e.type === "evidenced_by"
    );
    expect(edge).toBeDefined();
    expect(edge!.weight).toBeGreaterThanOrEqual(0.5);
  });

  test("F2 (SC-4 seeded): topic→diagram evidenced_by edge present at weight ≥ 0.5", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    const edge = result.edges.find(
      (e) =>
        e.source === "topic:79c825b8" &&
        e.target === "diagram:docs/ingestion.md#mermaid-0" &&
        e.type === "evidenced_by"
    );
    expect(edge).toBeDefined();
    expect(edge!.weight).toBeGreaterThanOrEqual(0.5);
  });

  test("F3 (SC-4 additional): claim:storage→storeEvent evidenced_by present", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    const edge = result.edges.find(
      (e) =>
        e.source === "claim:docs/storage.md#storage:e8805bb0" &&
        e.target === "function:src/store.ts:storeEvent" &&
        e.type === "evidenced_by"
    );
    expect(edge).toBeDefined();
    expect(edge!.weight).toBeGreaterThanOrEqual(0.5);
  });

  test("F4: mentions edge (validateEvent→entity:validator) present", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    const edge = result.edges.find(
      (e) =>
        e.source === "function:src/validate.ts:validateEvent" &&
        e.target === "entity:validator" &&
        e.type === "mentions"
    );
    expect(edge).toBeDefined();
    expect(edge!.weight).toBeGreaterThanOrEqual(0.5);
  });

  test("F5a: relates_to edge (entity:event-store→topic:a21d1858) present", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    const edge = result.edges.find(
      (e) =>
        e.source === "entity:event-store" &&
        e.target === "topic:a21d1858" &&
        e.type === "relates_to"
    );
    expect(edge).toBeDefined();
    expect(edge!.weight).toBeGreaterThanOrEqual(0.5);
  });

  test("F5b: relates_to edge (entity:validator→topic:189866d8) present", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    const edge = result.edges.find(
      (e) =>
        e.source === "entity:validator" &&
        e.target === "topic:189866d8" &&
        e.type === "relates_to"
    );
    expect(edge).toBeDefined();
    expect(edge!.weight).toBeGreaterThanOrEqual(0.5);
  });

  test("F6: all emitted edges have weight >= relMinConf (0.5)", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM, relMinConf: 0.5 }
    );
    for (const edge of result.edges) {
      expect(edge.weight).toBeGreaterThanOrEqual(0.5);
    }
  });

  test("F7 (SC-4 anchor): all evidenced_by target anchors resolve", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    const evidencedBy = result.edges.filter((e) => e.type === "evidenced_by");
    expect(evidencedBy.length).toBeGreaterThan(0);
    for (const edge of evidencedBy) {
      const targetNode = ALL_NODES.find((n) => n.id === edge.target);
      expect(targetNode).toBeDefined();
      const { resolveAnchor } = await import("../learn/lib/schema");
      const anyResolves = (targetNode!.source_refs ?? []).some((r) =>
        resolveAnchor(FIXTURE_ROOT, r)
      );
      expect(anyResolves).toBe(true);
    }
  });

  test("F8 (SC-4 hops): claim→code is exactly 1 hop (direct evidenced_by)", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    // Direct edge from claim to function — 1 hop
    const claimToCode = result.edges.find(
      (e) =>
        e.source === "claim:docs/ingestion.md#ingestion:0ee19523" &&
        e.target === "function:src/validate.ts:validateEvent" &&
        e.type === "evidenced_by"
    );
    expect(claimToCode).toBeDefined();
    // 1 hop = direct edge, no traversal needed
    // Verify target IS a code node
    const targetNode = ALL_NODES.find((n) => n.id === claimToCode!.target);
    expect(targetNode?.type).toBe("function");
  });

  test("F9: total cross-modal edges count matches oracle (6)", async () => {
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ALL_NODES, edges: EXISTING_EDGES },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    expect(result.edges).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Section G — Dedup against existing edges
// ---------------------------------------------------------------------------

describe("G — dedup against existing edges", () => {
  const topicNode: GraphNode = makeNode({
    id: "topic:79c825b8",
    type: "topic",
    source_refs: ["docs/ingestion.md#ingestion"],
  });
  const diagramNode: GraphNode = makeNode({
    id: "diagram:docs/ingestion.md#mermaid-0",
    type: "diagram",
    source_refs: ["docs/ingestion.md#mermaid-0"],
  });

  test("G1: edge already in input.edges is not re-emitted", async () => {
    const existingEdge: GraphEdge = {
      source: "topic:79c825b8",
      target: "diagram:docs/ingestion.md#mermaid-0",
      type: "evidenced_by",
      direction: "out",
      weight: 0.8,
    };
    const confirm: ConfirmCrossLinksFn = async () => [{ ...existingEdge }];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: [topicNode, diagramNode], edges: [existingEdge] },
      { confirmCrossLinks: confirm }
    );
    expect(result.edges).toHaveLength(0);
  });

  test("G2: LLM returning same edge twice → emitted only once", async () => {
    const edge: GraphEdge = {
      source: "topic:79c825b8",
      target: "diagram:docs/ingestion.md#mermaid-0",
      type: "evidenced_by",
      direction: "out",
      weight: 0.8,
    };
    const confirm: ConfirmCrossLinksFn = async () => [edge, edge]; // duplicate
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: [topicNode, diagramNode], edges: [] },
      { confirmCrossLinks: confirm }
    );
    expect(result.edges).toHaveLength(1);
  });

  test("G3: bidirectional Rule-1 candidates — both swapped evidenced_by edges emitted (dedup tracks per triple)", async () => {
    // Rule 1 fires for shared file "docs/ingestion.md" in both directions.
    // e1: topic→diagram and e2: diagram→topic are distinct (source,target,type) triples.
    // The dedup key is source+target+type, so both survive.
    const e1: GraphEdge = {
      source: "topic:79c825b8",
      target: "diagram:docs/ingestion.md#mermaid-0",
      type: "evidenced_by",
      direction: "out",
      weight: 0.8,
    };
    const e2: GraphEdge = {
      source: "diagram:docs/ingestion.md#mermaid-0",
      target: "topic:79c825b8",
      type: "evidenced_by",
      direction: "out",
      weight: 0.7,
    };
    const confirm: ConfirmCrossLinksFn = async () => [e1, e2];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: [topicNode, diagramNode], edges: [] },
      { confirmCrossLinks: confirm }
    );
    expect(result.edges).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Section H — Revision tests (B1 guard, B2 sort, Rule-3 tighten, Rule 5)
// ---------------------------------------------------------------------------

describe("H — nameSlugTokens + sharedPrefixLen helpers", () => {
  test("H1: nameSlugTokens splits on spaces, hyphens, underscores", () => {
    expect(nameSlugTokens("Event Store")).toEqual(["event", "store"]);
    expect(nameSlugTokens("event-pipeline")).toEqual(["event", "pipeline"]);
    expect(nameSlugTokens("source_adapter")).toEqual(["source", "adapter"]);
    expect(nameSlugTokens("Validator")).toEqual(["validator"]);
  });

  test("H2: sharedPrefixLen returns length of longest common prefix", () => {
    expect(sharedPrefixLen("store", "storage")).toBe(4); // "stor"
    expect(sharedPrefixLen("validator", "validation")).toBe(7); // "validat"
    expect(sharedPrefixLen("event", "ingestion")).toBe(0);
    expect(sharedPrefixLen("event", "event")).toBe(5); // full match
    expect(sharedPrefixLen("", "storage")).toBe(0);
  });
});

describe("H — Rule 5: entity↔topic name-token prefix overlap", () => {
  const NODES = ORACLE_GRAPH.nodes;

  test("H3 (B9): entity:validator → topic:189866d8 (Validation) proposed via name_token_overlap", () => {
    // "validator" + "validation" → shared prefix "validat" (7 chars ≥ 4) → candidate
    const candidates = proposeCandidates(FIXTURE_ROOT, NODES, []);
    const found = candidates.find(
      (c) =>
        c.source === "entity:validator" &&
        c.target === "topic:189866d8" &&
        c.type === "relates_to" &&
        c.reason === "name_token_overlap"
    );
    expect(found).toBeDefined();
  });

  test("H4 (B10): entity:event-store → topic:a21d1858 (Storage) proposed via name_token_overlap", () => {
    // "store" + "storage" → shared prefix "stor" (4 chars ≥ 4) → candidate
    const candidates = proposeCandidates(FIXTURE_ROOT, NODES, []);
    const found = candidates.find(
      (c) =>
        c.source === "entity:event-store" &&
        c.target === "topic:a21d1858" &&
        c.type === "relates_to" &&
        c.reason === "name_token_overlap"
    );
    expect(found).toBeDefined();
  });

  test("H5: entity:event-store does NOT produce relates_to candidate for topic:79c825b8 (Ingestion)", () => {
    // "event"+"ingestion" = 0 prefix, "store"+"ingestion" = 0 → no candidate
    const candidates = proposeCandidates(FIXTURE_ROOT, NODES, []);
    const found = candidates.find(
      (c) =>
        c.source === "entity:event-store" &&
        c.target === "topic:79c825b8" &&
        c.type === "relates_to"
    );
    expect(found).toBeUndefined();
  });
});

describe("H — B1 guard: LLM-invented edges outside candidate set are dropped", () => {
  const entityNode: GraphNode = makeNode({
    id: "entity:event-store",
    type: "entity",
    name: "Event Store",
    source_refs: ["docs/concepts.md#event-store"],
  });
  const topicIngestionNode: GraphNode = makeNode({
    id: "topic:79c825b8",
    type: "topic",
    name: "Ingestion",
    source_refs: ["docs/ingestion.md#ingestion"],
  });

  test("H6 (B11): LLM-invented relates_to pair not in candidates → dropped", async () => {
    // entity:event-store → topic:79c825b8 (Ingestion):
    // "event"+"ingestion" = 0, "store"+"ingestion" = 0 → NOT a Rule-5 candidate
    // No other rule would propose this pair (different files, no func_in_doc, etc.)
    const confirm: ConfirmCrossLinksFn = async () => [
      {
        source: "entity:event-store",
        target: "topic:79c825b8",
        type: "relates_to",
        direction: "out",
        weight: 0.7,
      },
    ];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: [entityNode, topicIngestionNode], edges: [] },
      { confirmCrossLinks: confirm }
    );
    expect(result.edges).toHaveLength(0); // B1 guard drops the invented edge
  });

  test("H7: LLM-confirmed edge that IS in candidates → kept", async () => {
    // entity:event-store → topic:a21d1858 (Storage):
    // "store"+"storage" = 4 ≥ 4 → IS a Rule-5 candidate
    const storageTopicNode: GraphNode = makeNode({
      id: "topic:a21d1858",
      type: "topic",
      name: "Storage",
      source_refs: ["docs/storage.md#storage"],
    });
    const confirm: ConfirmCrossLinksFn = async () => [
      {
        source: "entity:event-store",
        target: "topic:a21d1858",
        type: "relates_to",
        direction: "out",
        weight: 0.6,
      },
    ];
    const result = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: [entityNode, storageTopicNode], edges: [] },
      { confirmCrossLinks: confirm }
    );
    expect(result.edges).toHaveLength(1); // candidate guard passes, weight ≥ 0.5
    expect(result.edges[0].weight).toBe(0.6);
  });
});

describe("H — B2 sort: two identical runs produce identical edge output", () => {
  test("H8 (B12): determinism — same inputs → same output order both runs", async () => {
    const result1 = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ORACLE_GRAPH.nodes, edges: [] },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    const result2 = await buildCrossLinks(
      FIXTURE_ROOT,
      { nodes: ORACLE_GRAPH.nodes, edges: [] },
      { confirmCrossLinks: ORACLE_CONFIRM }
    );
    expect(result1.edges).toEqual(result2.edges);
  });
});

describe("H — Rule-3 tighten: ≥2 matching terms required", () => {
  const ALL_NODES = ORACLE_GRAPH.nodes;

  test("H9 (B13): claim:ingestion → storeEvent via Rule-3 requires ≥2 terms — only 1 matches → no candidate", () => {
    // claim:ingestion terms (after extended tech stopwords): ["incoming", "validated", "persisted"]
    // store.ts contains: "validated" ✓ — but NOT "incoming" or "persisted"
    // 1 term < 2 → no Rule-3 candidate for this pair
    const candidates = proposeCandidates(FIXTURE_ROOT, ALL_NODES, []);
    const rule3Candidate = candidates.find(
      (c) =>
        c.source === "claim:docs/ingestion.md#ingestion:0ee19523" &&
        c.target === "function:src/store.ts:storeEvent" &&
        c.reason === "claim_term_in_code"
    );
    expect(rule3Candidate).toBeUndefined();
    // Rule 2 (func_in_doc) still provides storeEvent as a candidate from ingestion.md mermaid
    const rule2Candidate = candidates.find(
      (c) =>
        c.source === "claim:docs/ingestion.md#ingestion:0ee19523" &&
        c.target === "function:src/store.ts:storeEvent" &&
        c.reason === "func_in_doc"
    );
    expect(rule2Candidate).toBeDefined();
  });

  test("H10: claim:storage → storeEvent via Rule-3 still fires with ≥2 terms (stored+append+mutated)", () => {
    // claim:storage terms: ["stored", "append", "mutated"] (after "events" removed by tech stopwords)
    // store.ts contains all 3 → 3 ≥ 2 → candidate still proposed
    const candidates = proposeCandidates(FIXTURE_ROOT, ALL_NODES, []);
    const found = candidates.find(
      (c) =>
        c.source === "claim:docs/storage.md#storage:e8805bb0" &&
        c.target === "function:src/store.ts:storeEvent" &&
        c.reason === "claim_term_in_code"
    );
    expect(found).toBeDefined();
  });

  test("H11: candidates are sorted by (source, target, type) for determinism", () => {
    const candidates = proposeCandidates(FIXTURE_ROOT, ALL_NODES, []);
    for (let i = 1; i < candidates.length; i++) {
      const a = candidates[i - 1];
      const b = candidates[i];
      const aKey = `${a.source}\0${a.target}\0${a.type}`;
      const bKey = `${b.source}\0${b.target}\0${b.type}`;
      expect(aKey <= bKey).toBe(true);
    }
  });
});
