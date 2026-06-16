/**
 * scripts/__tests__/understand-schema-v2.test.ts
 *
 * L0 TDD-first tests for guild.knowledge_graph.v2 (post G-lane round-2 revision).
 *
 * Round-2 additions / fixes:
 *   NEW BLOCKER — mixed-anchor: node REJECTED if ANY source_ref fails (not just all).
 *   B4 — #svg resolves against SVG content (root <svg> element); path#<id> resolves
 *          id="<id>" attribute in SVG content.
 *   Fix 3 — makeTopicId / makeClaimId / makeConceptId accept real inputs and hash
 *            internally; determinism is enforced in code, not caller guidance.
 *   Fix 4 — file-in-exactly-one-layer is ALWAYS fatal on v2 (not gated on layers
 *            non-empty); every v2 graph with file nodes must have them in a layer.
 *
 * Fixture discipline: all v2 graphs with `file` nodes include a `layers` array
 * assigning each file node to exactly one layer (required by Fix 4).
 * Graphs testing other invariants use knowledge-only nodes (no `file` type) so
 * they are unaffected by the layer invariant.
 *
 * Usage: npx jest --testPathPattern=understand-schema-v2 --no-coverage
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  validateGraph,
  validateGraphV2,
  NODE_TYPES,
  NODE_TYPES_V2,
  EDGE_TYPES,
  EDGE_TYPES_V2,
  NODE_CATEGORIES,
  KNOWLEDGE_CONFIG_DEFAULTS,
  makeTopicId,
  makeClaimId,
  makeEntityId,
  makeWikiPageId,
  makeDiagramId,
  makeConceptId,
  sha8Hash,
  sha8,
} from "../understand/lib/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid v1 graph. */
function minV1Graph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "guild.knowledge_graph.v1",
    generated_from_commit: "abc123",
    project: { name: "test", description: "" },
    nodes: [
      { id: "file:src/index.ts", type: "file", name: "index.ts", source_refs: ["src/index.ts"], confidence: "high" },
    ],
    edges: [],
    layers: [],
    tour: [],
    ...overrides,
  };
}

/**
 * Build a temp repo with the given files and return its root path.
 * Caller responsible for cleanup.
 */
function makeTempRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-v2-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

/**
 * Wrap a list of file-node ids into a single layer covering all of them.
 * Used to satisfy the file-in-exactly-one-layer invariant in every v2 fixture.
 */
function singleLayer(fileNodeIds: string[]): Record<string, unknown>[] {
  return [{ id: "layer:default", name: "Default", description: "", nodeIds: fileNodeIds }];
}

// ---------------------------------------------------------------------------
// 0. Infrastructure smoke test
// ---------------------------------------------------------------------------

describe("test infrastructure", () => {
  test("makeTempRepo creates files and returns existing dir", () => {
    const dir = makeTempRepo({ "README.md": "# Hello\n" });
    try {
      expect(fs.existsSync(path.join(dir, "README.md"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 1. v1/v2 boundary — version dispatch
// ---------------------------------------------------------------------------

describe("v1/v2 boundary — version dispatch", () => {
  test("v1 graph routes to v1 validator: success, no v2 invariants applied", () => {
    const result = validateGraphV2(minV1Graph(), { repoRoot: "/nonexistent/path" });
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe("guild.knowledge_graph.v1");
  });

  test("v1 graph with wiki_page alias passes v1 validator (aliased to article in v1)", () => {
    const g = minV1Graph({
      nodes: [
        { id: "file:a.ts", type: "file", name: "a.ts", source_refs: ["a.ts"], confidence: "high" },
        { id: "article:x", type: "wiki_page", name: "x", source_refs: ["x.md"], confidence: "low" },
      ],
    });
    const result = validateGraphV2(g, { repoRoot: "/nonexistent/path" });
    expect(result.success).toBe(true);
    expect(result.fatal).toBeUndefined();
  });

  test("missing version field falls back to v1 validator", () => {
    const g = {
      project: { name: "p", description: "" },
      nodes: [
        { id: "file:a.ts", type: "file", name: "a.ts", source_refs: ["a.ts"], confidence: "high" },
      ],
      edges: [],
    };
    const result = validateGraphV2(g, { repoRoot: "/nonexistent" });
    expect(result.success).toBe(true);
  });

  test("v2 graph with correct version enters v2 validation", () => {
    const dir = makeTempRepo({
      "src/index.ts": "export function main() {}\n",
      "docs/README.md": "# Guild Core\n\nSome content.\n",
    });
    try {
      const g = {
        version: "guild.knowledge_graph.v2",
        generated_from_commit: "abc123",
        project: { name: "test", description: "" },
        nodes: [
          { id: "file:src/index.ts", type: "file", name: "index.ts", source_refs: ["src/index.ts"], confidence: "high" },
          {
            id: "topic:guild-core",
            type: "topic",
            name: "Guild Core",
            source_refs: ["docs/README.md#guild-core"],
            confidence: "high",
            category: "architecture",
            importance: "high",
            importance_score: 0.9,
            topic_path: ["guild", "core"],
          },
        ],
        edges: [],
        layers: singleLayer(["file:src/index.ts"]),
        tour: [],
      };
      const result = validateGraphV2(g, { repoRoot: dir });
      expect(result.success).toBe(true);
      expect(result.data?.version).toBe("guild.knowledge_graph.v2");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Expanded node / edge sets
// ---------------------------------------------------------------------------

describe("v2 node type set expansion", () => {
  test("NODE_TYPES_V2 contains all new knowledge node types", () => {
    for (const t of ["topic", "concept", "claim", "entity", "wiki_page", "diagram"]) {
      expect(NODE_TYPES_V2.has(t)).toBe(true);
    }
  });

  test("NODE_TYPES_V2 retains all v1 node types", () => {
    for (const t of NODE_TYPES) {
      expect(NODE_TYPES_V2.has(t)).toBe(true);
    }
  });

  test("wiki_page is first-class in v2 (not aliased to article)", () => {
    const dir = makeTempRepo({ "docs/index.md": "# Index\n\nWelcome.\n" });
    try {
      const g = {
        version: "guild.knowledge_graph.v2",
        generated_from_commit: "abc123",
        project: { name: "test", description: "" },
        nodes: [
          { id: "file:docs/index.md", type: "file", name: "index.md", source_refs: ["docs/index.md"], confidence: "high" },
          {
            id: "wiki_page:docs/index.md",
            type: "wiki_page",
            name: "Index",
            source_refs: ["docs/index.md#index"],
            confidence: "high",
            category: "guide",
            importance: "high",
          },
        ],
        edges: [],
        layers: singleLayer(["file:docs/index.md"]),
        tour: [],
      };
      const result = validateGraphV2(g, { repoRoot: dir });
      expect(result.success).toBe(true);
      const node = result.data?.nodes.find((n) => n.id === "wiki_page:docs/index.md");
      expect(node).toBeDefined();
      expect(node?.type).toBe("wiki_page");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("v2 edge type set expansion", () => {
  test("EDGE_TYPES_V2 contains all new knowledge edge types", () => {
    for (const t of ["subtopic_of", "relates_to", "evidenced_by", "belongs_to_domain", "mentions", "defines", "related"]) {
      expect(EDGE_TYPES_V2.has(t)).toBe(true);
    }
  });

  test("EDGE_TYPES_V2 retains all v1 edge types", () => {
    for (const t of EDGE_TYPES) {
      expect(EDGE_TYPES_V2.has(t)).toBe(true);
    }
  });

  test("v2 graph with new edge types validates successfully", () => {
    const dir = makeTempRepo({
      "src/a.ts": "export function a() {}\n",
      "docs/a.md": "# Topic A\n\nContent.\n",
      "docs/b.md": "# Topic B\n\nContent.\n",
      "docs/c.md": "# Intro\n\nA claim.\n",
    });
    try {
      const g = {
        version: "guild.knowledge_graph.v2",
        generated_from_commit: "abc123",
        project: { name: "test", description: "" },
        nodes: [
          { id: "file:src/a.ts", type: "file", name: "a.ts", source_refs: ["src/a.ts"], confidence: "high" },
          {
            id: "topic:a",
            type: "topic",
            name: "A",
            source_refs: ["docs/a.md#topic-a"],
            confidence: "high",
            category: "concept",
            importance: "high",
            importance_score: 0.8,
            topic_path: ["a"],
          },
          {
            id: "topic:b",
            type: "topic",
            name: "B",
            source_refs: ["docs/b.md#topic-b"],
            confidence: "high",
            category: "concept",
            importance: "medium",
            importance_score: 0.6,
            topic_path: ["a", "b"],
          },
          {
            id: "claim:docs/c.md#intro:abc12345",
            type: "claim",
            name: "C",
            source_refs: ["docs/c.md#intro"],
            confidence: "medium",
            category: "fact",
          },
        ],
        edges: [
          { source: "topic:b", target: "topic:a", type: "subtopic_of", direction: "out", weight: 1 },
          { source: "claim:docs/c.md#intro:abc12345", target: "file:src/a.ts", type: "evidenced_by", direction: "out", weight: 0.8 },
          { source: "topic:a", target: "topic:b", type: "relates_to", direction: "bi", weight: 0.5 },
        ],
        layers: singleLayer(["file:src/a.ts"]),
        tour: [],
      };
      const result = validateGraphV2(g, { repoRoot: dir });
      expect(result.success).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. SC-6: category enum — REQUIRED + closed set
// ---------------------------------------------------------------------------

describe("SC-6: category enum (REQUIRED + closed set)", () => {
  test("NODE_CATEGORIES is exported and non-empty", () => {
    expect(NODE_CATEGORIES).toBeDefined();
    expect(NODE_CATEGORIES.size).toBeGreaterThan(0);
  });

  test("valid category passes validation", () => {
    const dir = makeTempRepo({ "docs/core.md": "# Core\n\nContent.\n" });
    try {
      // knowledge-only graph (no file node) — layer invariant not triggered
      const g = {
        version: "guild.knowledge_graph.v2",
        generated_from_commit: "abc123",
        project: { name: "test", description: "" },
        nodes: [
          {
            id: "topic:core",
            type: "topic",
            name: "Core",
            source_refs: ["docs/core.md#core"],
            confidence: "high",
            category: "architecture",
            importance: "high",
            importance_score: 0.8,
            topic_path: ["core"],
          },
        ],
        edges: [],
        layers: [],
        tour: [],
      };
      const result = validateGraphV2(g, { repoRoot: dir });
      expect(result.success).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SC-6 MAJOR: MISSING category on knowledge node is REJECTED (node dropped)", () => {
    const dir = makeTempRepo({ "docs/nocategory.md": "# No Category\n\nContent.\n" });
    try {
      const g = {
        version: "guild.knowledge_graph.v2",
        generated_from_commit: "abc123",
        project: { name: "test", description: "" },
        nodes: [
          {
            id: "topic:nocategory",
            type: "topic",
            name: "No Category",
            source_refs: ["docs/nocategory.md#no-category"],
            confidence: "high",
            // category intentionally absent
            importance: "high",
            importance_score: 0.8,
            topic_path: ["nocategory"],
          },
        ],
        edges: [],
        layers: [],
        tour: [],
      };
      const result = validateGraphV2(g, { repoRoot: dir });
      if (result.success) {
        expect(result.data?.nodes.some((n) => n.id === "topic:nocategory")).toBe(false);
      }
      expect(result.issues.some((i) => i.category === "missing-category")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("SC-6: out-of-enum category is REJECTED (node dropped)", () => {
    const dir = makeTempRepo({ "docs/bad.md": "# Bad Category\n\nContent.\n" });
    try {
      const g = {
        version: "guild.knowledge_graph.v2",
        generated_from_commit: "abc123",
        project: { name: "test", description: "" },
        nodes: [
          {
            id: "topic:bad",
            type: "topic",
            name: "Bad",
            source_refs: ["docs/bad.md#bad-category"],
            confidence: "high",
            category: "NOT_A_VALID_CATEGORY",
            importance: "high",
            importance_score: 0.8,
            topic_path: ["bad"],
          },
        ],
        edges: [],
        layers: [],
        tour: [],
      };
      const result = validateGraphV2(g, { repoRoot: dir });
      if (result.success) {
        expect(result.data?.nodes.some((n) => n.id === "topic:bad")).toBe(false);
      }
      expect(result.issues.some((i) => i.category === "invalid-category")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. SC-12: deterministic node ID helpers (Fix 3 — hashing inside)
// ---------------------------------------------------------------------------

describe("SC-12: deterministic node ID helpers (Fix 3 — hash inside)", () => {
  test("makeTopicId: accepts member array, order-independent, same output for same set", () => {
    const members = ["file:src/a.ts", "function:src/a.ts:foo"];
    const id1 = makeTopicId(members);
    const id2 = makeTopicId([...members].reverse()); // reversed order
    expect(id1).toBe(id2); // sort inside ensures order-independence
    expect(id1.startsWith("topic:")).toBe(true);
    expect(id1.slice("topic:".length)).toMatch(/^[0-9a-f]{8}$/);
  });

  test("makeTopicId: different member sets produce different IDs", () => {
    const id1 = makeTopicId(["file:src/a.ts"]);
    const id2 = makeTopicId(["file:src/b.ts"]);
    expect(id1).not.toBe(id2);
  });

  test("makeTopicId: deterministic across calls with same inputs", () => {
    const members = ["file:a.ts", "file:b.ts"];
    expect(makeTopicId(members)).toBe(makeTopicId(members));
  });

  test("makeClaimId: same anchor+text → same ID (deterministic)", () => {
    const id1 = makeClaimId("docs/spec.md#intro", "the claim text");
    const id2 = makeClaimId("docs/spec.md#intro", "the claim text");
    expect(id1).toBe(id2);
    {
      const prefix = "claim:docs/spec.md#intro:";
      expect(id1.startsWith(prefix)).toBe(true);
      expect(id1.slice(prefix.length)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  test("makeClaimId: same anchor different text → different IDs (no collision)", () => {
    const anchor = "docs/spec.md#intro";
    const id1 = makeClaimId(anchor, "first claim text");
    const id2 = makeClaimId(anchor, "second claim text");
    expect(id1).not.toBe(id2);
  });

  test("makeConceptId: same anchor+text → same ID (deterministic)", () => {
    const id1 = makeConceptId("src/index.ts#L10-L20", "the concept");
    const id2 = makeConceptId("src/index.ts#L10-L20", "the concept");
    expect(id1).toBe(id2);
    {
      const prefix = "concept:src/index.ts#L10-L20:";
      expect(id1.startsWith(prefix)).toBe(true);
      expect(id1.slice(prefix.length)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  test("makeConceptId: same anchor different text → different IDs (no collision)", () => {
    const anchor = "src/index.ts#L10-L20";
    const id1 = makeConceptId(anchor, "first concept");
    const id2 = makeConceptId(anchor, "second concept");
    expect(id1).not.toBe(id2);
  });

  test("makeEntityId: normalized name", () => {
    expect(makeEntityId("Guild Plugin")).toBe("entity:guild-plugin");
    expect(makeEntityId("Claude Code")).toBe("entity:claude-code");
  });

  test("makeWikiPageId: relpath", () => {
    expect(makeWikiPageId("docs/knowledge/index.md")).toBe("wiki_page:docs/knowledge/index.md");
  });

  test("makeDiagramId: path#mermaid-N anchor", () => {
    expect(makeDiagramId("docs/arch.md#mermaid-0")).toBe("diagram:docs/arch.md#mermaid-0");
    expect(makeDiagramId("images/flow.svg")).toBe("diagram:images/flow.svg");
  });

  test("sha8 and sha8Hash are equivalent exports (back-compat alias)", () => {
    expect(sha8("hello")).toBe(sha8Hash("hello"));
    expect(sha8("hello")).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// 5. SC-12: per-form anchor resolution
// ---------------------------------------------------------------------------

describe("SC-12: per-form anchor resolution", () => {
  let dir: string;

  beforeAll(() => {
    dir = makeTempRepo({
      "src/code.ts": "line1\nline2\nline3\nline4\nline5\n",
      "docs/guide.md": "# Getting Started\n\n## Installation Guide\n\nSome text.\n",
      "docs/diagram.md": "Some text.\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nMore text.\n\n```mermaid\ngraph LR\n  X --> Y\n```\n",
      // Valid SVG with root element and a labelled element
      "assets/arch.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="box1" width="50" height="50"/></svg>',
      // File that is NOT an SVG
      "docs/notsvg.md": "# Not SVG\n\nContent.\n",
    });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function v2KnowledgeGraph(
    nodes: Record<string, unknown>[],
  ): Record<string, unknown> {
    // Knowledge-only graph (no file nodes) — layer invariant not triggered
    return {
      version: "guild.knowledge_graph.v2",
      generated_from_commit: "abc123",
      project: { name: "test", description: "" },
      nodes,
      edges: [],
      layers: [],
      tour: [],
    };
  }

  function topicNode(id: string, ref: string): Record<string, unknown> {
    return {
      id,
      type: "topic",
      name: id,
      source_refs: [ref],
      confidence: "high",
      category: "concept",
      importance_score: 0.7,
      topic_path: [id],
    };
  }

  function wikiNode(id: string, ref: string): Record<string, unknown> {
    return { id, type: "wiki_page", name: id, source_refs: [ref], confidence: "high", category: "guide" };
  }

  function diagramNode(id: string, ref: string): Record<string, unknown> {
    return { id, type: "diagram", name: id, source_refs: [ref], confidence: "high", category: "diagram" };
  }

  test("code path#Lx-Ly: valid line range resolves", () => {
    const g = v2KnowledgeGraph([topicNode("topic:t1", "src/code.ts#L1-L3")]);
    expect(validateGraphV2(g, { repoRoot: dir }).success).toBe(true);
  });

  test("code path#Lx-Ly: out-of-range line REJECTED", () => {
    const g = v2KnowledgeGraph([topicNode("topic:t2", "src/code.ts#L1-L999")]);
    const result = validateGraphV2(g, { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "topic:t2")).toBe(false);
    }
    expect(result.issues.some((i) => i.category === "unresolvable-anchor")).toBe(true);
  });

  test("doc/wiki path#heading-slug: valid heading resolves", () => {
    const g = v2KnowledgeGraph([wikiNode("wiki_page:docs/guide.md", "docs/guide.md#getting-started")]);
    expect(validateGraphV2(g, { repoRoot: dir }).success).toBe(true);
  });

  test("doc/wiki path#heading-slug: broken heading-slug REJECTED", () => {
    const g = v2KnowledgeGraph([wikiNode("wiki_page:docs/guide.md", "docs/guide.md#no-such-heading")]);
    const result = validateGraphV2(g, { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "wiki_page:docs/guide.md")).toBe(false);
    }
    expect(result.issues.some((i) => i.category === "unresolvable-anchor")).toBe(true);
  });

  test("diagram path#mermaid-N: valid index resolves (mermaid-0)", () => {
    const g = v2KnowledgeGraph([diagramNode("diagram:d0", "docs/diagram.md#mermaid-0")]);
    expect(validateGraphV2(g, { repoRoot: dir }).success).toBe(true);
  });

  test("diagram path#mermaid-N: second block resolves (mermaid-1)", () => {
    const g = v2KnowledgeGraph([diagramNode("diagram:d1", "docs/diagram.md#mermaid-1")]);
    expect(validateGraphV2(g, { repoRoot: dir }).success).toBe(true);
  });

  test("diagram path#mermaid-N: missing index REJECTED — mermaid-5", () => {
    const g = v2KnowledgeGraph([diagramNode("diagram:d5", "docs/diagram.md#mermaid-5")]);
    const result = validateGraphV2(g, { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "diagram:d5")).toBe(false);
    }
    expect(result.issues.some((i) => i.category === "unresolvable-anchor")).toBe(true);
  });

  // B4 Fix 2 — SVG content validation

  test("B4: path#svg resolves when file has root <svg> element", () => {
    const g = v2KnowledgeGraph([diagramNode("diagram:arch", "assets/arch.svg#svg")]);
    expect(validateGraphV2(g, { repoRoot: dir }).success).toBe(true);
  });

  test("B4: path#svg REJECTED when file does not contain <svg> element (non-svg file)", () => {
    const g = v2KnowledgeGraph([diagramNode("diagram:notsvg", "docs/notsvg.md#svg")]);
    const result = validateGraphV2(g, { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "diagram:notsvg")).toBe(false);
    }
    expect(result.issues.some((i) => i.category === "unresolvable-anchor")).toBe(true);
  });

  test("B4: path#<id> in SVG resolves when element with id exists", () => {
    // assets/arch.svg contains id="box1"
    const g = v2KnowledgeGraph([diagramNode("diagram:box1", "assets/arch.svg#box1")]);
    expect(validateGraphV2(g, { repoRoot: dir }).success).toBe(true);
  });

  test("B4: path#<id> in SVG REJECTED when id not present in SVG", () => {
    const g = v2KnowledgeGraph([diagramNode("diagram:missing", "assets/arch.svg#no-such-id")]);
    const result = validateGraphV2(g, { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "diagram:missing")).toBe(false);
    }
    expect(result.issues.some((i) => i.category === "unresolvable-anchor")).toBe(true);
  });

  test("knowledge node with ZERO source_refs is REJECTED", () => {
    const g = v2KnowledgeGraph([{
      id: "topic:zero-refs",
      type: "topic",
      name: "Zero Refs",
      source_refs: [],
      confidence: "high",
      category: "concept",
      importance_score: 0.8,
      topic_path: ["zero-refs"],
    }]);
    const result = validateGraphV2(g, { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "topic:zero-refs")).toBe(false);
    }
  });

  // NEW BLOCKER Fix 1 — mixed-anchor: REJECT if ANY ref fails

  test("NEW BLOCKER Fix 1: multi-ref node with ONE broken ref is REJECTED", () => {
    // First ref resolves, second does not — the spec requires ALL refs to resolve.
    const node: Record<string, unknown> = {
      id: "topic:multi-ref",
      type: "topic",
      name: "Multi Ref",
      source_refs: ["src/code.ts#L1-L3", "nonexistent/file.md#heading"],
      confidence: "high",
      category: "concept",
      importance_score: 0.8,
      topic_path: ["multi-ref"],
    };
    const result = validateGraphV2(v2KnowledgeGraph([node]), { repoRoot: dir });
    // Node MUST be dropped — any broken ref rejects the node (Fix 1)
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "topic:multi-ref")).toBe(false);
    }
    expect(result.issues.some((i) => i.category === "unresolvable-anchor")).toBe(true);
  });

  test("multi-ref node: all refs resolve → node ACCEPTED", () => {
    const node: Record<string, unknown> = {
      id: "topic:all-good",
      type: "topic",
      name: "All Good",
      source_refs: ["src/code.ts#L1-L3", "docs/guide.md#getting-started"],
      confidence: "high",
      category: "concept",
      importance_score: 0.8,
      topic_path: ["all-good"],
    };
    const result = validateGraphV2(v2KnowledgeGraph([node]), { repoRoot: dir });
    expect(result.success).toBe(true);
    expect(result.data?.nodes.some((n) => n.id === "topic:all-good")).toBe(true);
  });

  test("multi-ref node: all refs broken → node DROPPED", () => {
    const node: Record<string, unknown> = {
      id: "topic:all-broken",
      type: "topic",
      name: "All Broken",
      source_refs: ["nonexistent/a.md#heading", "nonexistent/b.md#heading"],
      confidence: "high",
      category: "concept",
      importance_score: 0.8,
      topic_path: ["all-broken"],
    };
    const result = validateGraphV2(v2KnowledgeGraph([node]), { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "topic:all-broken")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. SC-2: subtopic_of invariants
// ---------------------------------------------------------------------------

describe("SC-2: subtopic_of invariants", () => {
  let dir: string;

  beforeAll(() => {
    dir = makeTempRepo({ "src/a.ts": "line1\n" });
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(dir, `docs/level-${i}.md`), `# Level ${i}\n\nContent.\n`, "utf8");
      fs.writeFileSync(path.join(dir, `docs/child-${i}.md`), `# Child ${i}\n\nContent.\n`, "utf8");
    }
    const extras = ["parent", "root", "child", "grandchild", "a", "b", "c", "self", "low", "medium", "threshold"];
    for (const name of extras) {
      fs.writeFileSync(
        path.join(dir, `docs/${name}.md`),
        `# ${name.charAt(0).toUpperCase() + name.slice(1)}\n\nContent.\n`,
        "utf8",
      );
    }
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function topicNode(slug: string, score = 0.8): Record<string, unknown> {
    const docSlug = slug.replace(/\//g, "-");
    return {
      id: `topic:${slug}`,
      type: "topic",
      name: slug,
      source_refs: [`docs/${docSlug}.md#${docSlug}`],
      confidence: "high",
      category: "concept",
      importance: "high",
      importance_score: score,
      topic_path: slug.split("/"),
    };
  }

  function subtopicEdge(child: string, parent: string): Record<string, unknown> {
    return { source: `topic:${child}`, target: `topic:${parent}`, type: "subtopic_of", direction: "out", weight: 1 };
  }

  // Knowledge-only graphs (no file nodes) — layer invariant not triggered
  function v2GraphWith(
    nodes: Record<string, unknown>[],
    edges: Record<string, unknown>[] = [],
  ): Record<string, unknown> {
    return {
      version: "guild.knowledge_graph.v2",
      generated_from_commit: "abc123",
      project: { name: "test", description: "" },
      nodes,
      edges,
      layers: [],
      tour: [],
    };
  }

  // ── depth boundary tests ─────────────────────────────────────────────────

  test("SC-2: depth == maxDepth PASSES (exact boundary)", () => {
    const nodeCount = KNOWLEDGE_CONFIG_DEFAULTS.maxDepth + 1; // 9 nodes → depth 8
    const nodes = [];
    const edges = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push(topicNode(`level-${i}`));
    }
    for (let i = nodeCount - 1; i > 0; i--) {
      edges.push(subtopicEdge(`level-${i}`, `level-${i - 1}`));
    }
    const result = validateGraphV2(v2GraphWith(nodes, edges), { repoRoot: dir });
    expect(result.success).toBe(true);
  });

  test("SC-2: depth > maxDepth is FATAL (maxDepth+1 deep chain)", () => {
    const nodeCount = KNOWLEDGE_CONFIG_DEFAULTS.maxDepth + 2; // 10 nodes → depth 9
    const nodes = [];
    const edges = [];
    for (let i = 0; i < nodeCount; i++) {
      nodes.push(topicNode(`level-${i}`));
    }
    for (let i = nodeCount - 1; i > 0; i--) {
      edges.push(subtopicEdge(`level-${i}`, `level-${i - 1}`));
    }
    const result = validateGraphV2(v2GraphWith(nodes, edges), { repoRoot: dir });
    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.category === "invariant-violation")).toBe(true);
  });

  // ── fan-out boundary tests ───────────────────────────────────────────────

  test("SC-2: fan-out == maxBranching PASSES (exact boundary)", () => {
    const count = KNOWLEDGE_CONFIG_DEFAULTS.maxBranching; // 12 children
    const nodes = [topicNode("parent")];
    const edges = [];
    for (let i = 0; i < count; i++) {
      nodes.push(topicNode(`child-${i}`));
      edges.push(subtopicEdge(`child-${i}`, "parent"));
    }
    const result = validateGraphV2(v2GraphWith(nodes, edges), { repoRoot: dir });
    expect(result.success).toBe(true);
  });

  test("SC-2: fan-out > maxBranching is FATAL (maxBranching+1 children)", () => {
    const count = KNOWLEDGE_CONFIG_DEFAULTS.maxBranching + 1; // 13 children
    const nodes = [topicNode("parent")];
    const edges = [];
    for (let i = 0; i < count; i++) {
      nodes.push(topicNode(`child-${i}`));
      edges.push(subtopicEdge(`child-${i}`, "parent"));
    }
    const result = validateGraphV2(v2GraphWith(nodes, edges), { repoRoot: dir });
    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.category === "invariant-violation")).toBe(true);
  });

  // ── cycle / multi-parent tests ───────────────────────────────────────────

  test("SC-2: subtopic_of cycle is FATAL", () => {
    const nodes = [topicNode("a"), topicNode("b"), topicNode("c")];
    const edges = [
      subtopicEdge("b", "a"),
      subtopicEdge("c", "b"),
      subtopicEdge("a", "c"), // cycle: a→c→b→a
    ];
    const result = validateGraphV2(v2GraphWith(nodes, edges), { repoRoot: dir });
    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.category === "invariant-violation")).toBe(true);
  });

  test("SC-2 Blocker 1: self-loop is FATAL", () => {
    const nodes = [topicNode("self")];
    const edges = [subtopicEdge("self", "self")];
    const result = validateGraphV2(v2GraphWith(nodes, edges), { repoRoot: dir });
    expect(result.success).toBe(false);
  });

  test("SC-2 Blocker 1: multi-parent subtopic_of is REJECTED (tree contract)", () => {
    const nodes = [topicNode("a"), topicNode("b"), topicNode("child")];
    const edges = [
      subtopicEdge("child", "a"),
      subtopicEdge("child", "b"), // second parent → tree violation
    ];
    const result = validateGraphV2(v2GraphWith(nodes, edges), { repoRoot: dir });
    expect(result.success).toBe(false);
    expect(result.issues.some((i) => i.category === "invariant-violation")).toBe(true);
  });

  test("SC-2 Blocker 1: multi-parent-cycle REJECTED", () => {
    const nodes = [topicNode("a"), topicNode("b"), topicNode("c")];
    const edges = [
      subtopicEdge("a", "b"),
      subtopicEdge("a", "c"), // multi-parent for 'a'
      subtopicEdge("c", "a"), // cycle
    ];
    const result = validateGraphV2(v2GraphWith(nodes, edges), { repoRoot: dir });
    expect(result.success).toBe(false);
  });

  test("SC-2: valid 3-deep tree PASSES", () => {
    const nodes = [topicNode("root"), topicNode("child"), topicNode("grandchild")];
    const edges = [subtopicEdge("child", "root"), subtopicEdge("grandchild", "child")];
    const result = validateGraphV2(v2GraphWith(nodes, edges), { repoRoot: dir });
    expect(result.success).toBe(true);
  });

  // ── importance_score boundary tests ─────────────────────────────────────

  test("SC-2 Blocker 3: importance_score exactly at threshold PASSES", () => {
    const exact = KNOWLEDGE_CONFIG_DEFAULTS.minTopicImportance; // 0.4
    const node: Record<string, unknown> = { ...topicNode("threshold"), importance_score: exact };
    const result = validateGraphV2(v2GraphWith([node]), { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "topic:threshold")).toBe(true);
    }
    expect(result.issues.some((i) => i.category === "below-importance-threshold")).toBe(false);
  });

  test("SC-2 Blocker 3: importance_score threshold-minus-epsilon is DROPPED", () => {
    const score = KNOWLEDGE_CONFIG_DEFAULTS.minTopicImportance - 0.001; // 0.399
    const node: Record<string, unknown> = {
      id: "topic:low",
      type: "topic",
      name: "Low",
      source_refs: ["docs/low.md#low"],
      confidence: "low",
      category: "concept",
      importance: "low",
      importance_score: score,
      topic_path: ["low"],
    };
    const result = validateGraphV2(v2GraphWith([node]), { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "topic:low")).toBe(false);
    }
    expect(result.issues.some((i) => i.category === "below-importance-threshold")).toBe(true);
  });

  test("SC-2 Blocker 3: MISSING importance_score on topic node → DROPPED", () => {
    const node: Record<string, unknown> = {
      id: "topic:no-score",
      type: "topic",
      name: "No Score",
      source_refs: ["docs/medium.md#medium"],
      confidence: "high",
      category: "concept",
      importance: "medium",
      // importance_score intentionally absent
      topic_path: ["no-score"],
    };
    const result = validateGraphV2(v2GraphWith([node]), { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "topic:no-score")).toBe(false);
    }
    expect(result.issues.some((i) => i.category === "missing-importance-score")).toBe(true);
  });

  test("SC-2: topic with only string importance field (no numeric score) → DROPPED", () => {
    const node: Record<string, unknown> = {
      id: "topic:string-only",
      type: "topic",
      name: "String Only",
      source_refs: ["docs/medium.md#medium"],
      confidence: "high",
      category: "concept",
      importance: "high", // string label only, no numeric field
      topic_path: ["string-only"],
    };
    const result = validateGraphV2(v2GraphWith([node]), { repoRoot: dir });
    if (result.success) {
      expect(result.data?.nodes.some((n) => n.id === "topic:string-only")).toBe(false);
    }
    expect(result.issues.some((i) => i.category === "missing-importance-score")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. SC-4: evidenced_by — dangling target AND target-anchor broken
// ---------------------------------------------------------------------------

describe("SC-4: evidenced_by invariants", () => {
  let dir: string;

  beforeAll(() => {
    dir = makeTempRepo({
      "src/a.ts": "export function a() {}\n",
      "docs/core.md": "# Core\n\nContent.\n",
    });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function v2WithEvidencedBy(
    targetId: string,
    extraNodes: Record<string, unknown>[] = [],
  ): Record<string, unknown> {
    return {
      version: "guild.knowledge_graph.v2",
      generated_from_commit: "abc123",
      project: { name: "test", description: "" },
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", source_refs: ["src/a.ts"], confidence: "high" },
        {
          id: "topic:core",
          type: "topic",
          name: "Core",
          source_refs: ["docs/core.md#core"],
          confidence: "high",
          category: "architecture",
          importance: "high",
          importance_score: 0.9,
          topic_path: ["core"],
        },
        ...extraNodes,
      ],
      edges: [
        { source: "topic:core", target: targetId, type: "evidenced_by", direction: "out", weight: 0.9 },
      ],
      layers: singleLayer(["file:src/a.ts"]),
      tour: [],
    };
  }

  test("dangling evidenced_by target (not in graph) is DROPPED", () => {
    const g = v2WithEvidencedBy("file:ghost.ts");
    const result = validateGraphV2(g, { repoRoot: dir });
    if (result.success) {
      expect(result.data?.edges.some((e) => e.type === "evidenced_by" && e.target === "file:ghost.ts")).toBe(false);
    }
  });

  test("evidenced_by target in graph with valid anchor survives", () => {
    const g = v2WithEvidencedBy("file:src/a.ts");
    const result = validateGraphV2(g, { repoRoot: dir });
    expect(result.success).toBe(true);
    expect(result.data?.edges.some((e) => e.type === "evidenced_by")).toBe(true);
  });

  test("SC-4 Blocker 6: present target node with broken anchor → edge DROPPED", () => {
    const brokenTarget: Record<string, unknown> = {
      id: "topic:ghost",
      type: "topic",
      name: "Ghost Topic",
      source_refs: ["this/file/does/not/exist.md#heading"],
      confidence: "high",
      category: "concept",
      importance_score: 0.8,
      topic_path: ["ghost"],
    };
    const g = v2WithEvidencedBy("topic:ghost", [brokenTarget]);
    const result = validateGraphV2(g, { repoRoot: dir });
    if (result.success) {
      expect(result.data?.edges.some((e) => e.type === "evidenced_by" && e.target === "topic:ghost")).toBe(false);
    }
    const relevant = result.issues.filter((i) =>
      i.category === "unresolvable-anchor" ||
      i.category === "evidenced-by-anchor-broken" ||
      i.category === "invalid-reference",
    );
    expect(relevant.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. E2 MUST-FIX: non-monotone flow_step is FATAL
// ---------------------------------------------------------------------------

describe("E2: flow_step monotone — FATAL on v2", () => {
  let dir: string;

  beforeAll(() => {
    dir = makeTempRepo({
      "src/a.ts": "line1\nline2\nline3\nline4\nline5\n",
      "src/b.ts": "line1\nline2\nline3\nline4\nline5\n",
      "src/c.ts": "line1\nline2\nline3\nline4\nline5\n",
    });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("non-monotone flow_step is FATAL (not auto-corrected)", () => {
    const g = {
      version: "guild.knowledge_graph.v2",
      generated_from_commit: "abc123",
      project: { name: "test", description: "" },
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", source_refs: ["src/a.ts"], confidence: "high" },
        { id: "step:a", type: "step", name: "Step A", source_refs: ["src/a.ts#L1-L2"], confidence: "high" },
        { id: "step:b", type: "step", name: "Step B", source_refs: ["src/b.ts#L1-L2"], confidence: "high" },
        { id: "step:c", type: "step", name: "Step C", source_refs: ["src/c.ts#L1-L2"], confidence: "high" },
      ],
      edges: [
        { source: "step:a", target: "step:b", type: "flow_step", direction: "out", weight: 0.5 },
        { source: "step:b", target: "step:c", type: "flow_step", direction: "out", weight: 0.3 }, // non-monotone
      ],
      layers: singleLayer(["file:src/a.ts"]),
      tour: [],
    };
    const result = validateGraphV2(g, { repoRoot: dir });
    expect(result.success).toBe(false);
    expect(result.fatal).toMatch(/monotone|flow_step/i);
    expect(result.issues.some((i) => i.category === "non-monotone-flow-step" && i.level === "fatal")).toBe(true);
  });

  test("monotone flow_step is accepted", () => {
    const g = {
      version: "guild.knowledge_graph.v2",
      generated_from_commit: "abc123",
      project: { name: "test", description: "" },
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", source_refs: ["src/a.ts"], confidence: "high" },
        { id: "step:a", type: "step", name: "Step A", source_refs: ["src/a.ts#L1-L2"], confidence: "high" },
        { id: "step:b", type: "step", name: "Step B", source_refs: ["src/b.ts#L1-L2"], confidence: "high" },
        { id: "step:c", type: "step", name: "Step C", source_refs: ["src/c.ts#L1-L2"], confidence: "high" },
      ],
      edges: [
        { source: "step:a", target: "step:b", type: "flow_step", direction: "out", weight: 0.3 },
        { source: "step:b", target: "step:c", type: "flow_step", direction: "out", weight: 0.5 },
        { source: "step:c", target: "step:a", type: "flow_step", direction: "out", weight: 0.7 },
      ],
      layers: singleLayer(["file:src/a.ts"]),
      tour: [],
    };
    const result = validateGraphV2(g, { repoRoot: dir });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Fix 4: file-in-exactly-one-layer — ALWAYS fatal on v2
// ---------------------------------------------------------------------------

describe("Fix 4: file-in-exactly-one-layer — strict on v2 path", () => {
  let dir: string;

  beforeAll(() => {
    dir = makeTempRepo({
      "src/a.ts": "export function a() {}\n",
      "src/b.ts": "export function b() {}\n",
    });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("file in two layers: second occurrence DROPPED with issue", () => {
    const g = {
      version: "guild.knowledge_graph.v2",
      generated_from_commit: "abc123",
      project: { name: "test", description: "" },
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", source_refs: ["src/a.ts"], confidence: "high" },
        { id: "file:src/b.ts", type: "file", name: "b.ts", source_refs: ["src/b.ts"], confidence: "high" },
      ],
      edges: [],
      layers: [
        { id: "layer1", name: "Layer 1", description: "", nodeIds: ["file:src/a.ts", "file:src/b.ts"] },
        { id: "layer2", name: "Layer 2", description: "", nodeIds: ["file:src/a.ts"] }, // a.ts in two layers
      ],
      tour: [],
    };
    const result = validateGraphV2(g, { repoRoot: dir });
    expect(result.issues.some((i) => i.category === "file-in-multiple-layers")).toBe(true);
  });

  test("file in zero layers (layers non-empty) is FATAL", () => {
    const g = {
      version: "guild.knowledge_graph.v2",
      generated_from_commit: "abc123",
      project: { name: "test", description: "" },
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", source_refs: ["src/a.ts"], confidence: "high" },
        { id: "file:src/b.ts", type: "file", name: "b.ts", source_refs: ["src/b.ts"], confidence: "high" },
      ],
      edges: [],
      layers: [
        { id: "layer1", name: "Layer 1", description: "", nodeIds: ["file:src/a.ts"] },
        // file:src/b.ts has zero layers → fatal
      ],
      tour: [],
    };
    const result = validateGraphV2(g, { repoRoot: dir });
    expect(result.success).toBe(false);
    expect(result.fatal).toMatch(/file-in-zero-layers|not assigned to any layer/i);
  });

  test("Fix 4: file in zero layers even when layers EMPTY ARRAY is FATAL", () => {
    // Fix 4: the `if (validLayers.length > 0)` guard is REMOVED.
    // A v2 graph with file nodes and empty layers → fatal.
    const g = {
      version: "guild.knowledge_graph.v2",
      generated_from_commit: "abc123",
      project: { name: "test", description: "" },
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", source_refs: ["src/a.ts"], confidence: "high" },
      ],
      edges: [],
      layers: [], // empty array — but file node exists → fatal
      tour: [],
    };
    const result = validateGraphV2(g, { repoRoot: dir });
    expect(result.success).toBe(false);
    expect(result.fatal).toMatch(/file-in-zero-layers|not assigned to any layer/i);
  });

  test("knowledge-only v2 graph (NO file nodes) with empty layers is accepted", () => {
    // No file nodes → layer invariant does not apply
    const dir2 = makeTempRepo({ "docs/readme.md": "# Readme\n\nContent.\n" });
    try {
      const g = {
        version: "guild.knowledge_graph.v2",
        generated_from_commit: "abc123",
        project: { name: "test", description: "" },
        nodes: [
          {
            id: "wiki_page:docs/readme.md",
            type: "wiki_page",
            name: "Readme",
            source_refs: ["docs/readme.md#readme"],
            confidence: "high",
            category: "guide",
          },
        ],
        edges: [],
        layers: [], // empty — no file nodes so invariant not triggered
        tour: [],
      };
      const result = validateGraphV2(g, { repoRoot: dir2 });
      expect(result.success).toBe(true);
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 10. SC-11: canonical-sort idempotency
// ---------------------------------------------------------------------------

describe("SC-11: idempotent dedup + canonical sort", () => {
  let dir: string;
  let fixture: Record<string, unknown>;

  beforeAll(() => {
    dir = makeTempRepo({
      "src/a.ts": "export function a() {}\n",
      "docs/core.md": "# Core\n\nContent.\n",
      "docs/spec.md": "# Intro\n\nA claim.\n",
      "docs/index.md": "# Index\n\nContent.\n",
      "docs/arch.md": "```mermaid\nflowchart TD\n  A --> B\n```\n",
    });

    fixture = {
      version: "guild.knowledge_graph.v2",
      generated_from_commit: "abc123",
      project: { name: "test", description: "" },
      nodes: [
        { id: "file:src/a.ts", type: "file", name: "a.ts", source_refs: ["src/a.ts"], confidence: "high" },
        {
          id: "topic:core",
          type: "topic",
          name: "Core",
          source_refs: ["docs/core.md#core"],
          confidence: "high",
          category: "architecture",
          importance: "high",
          importance_score: 0.9,
          topic_path: ["core"],
        },
        {
          id: "claim:docs/spec.md#intro:deadbeef",
          type: "claim",
          name: "A claim",
          source_refs: ["docs/spec.md#intro"],
          confidence: "medium",
          category: "fact",
        },
        {
          id: "wiki_page:docs/index.md",
          type: "wiki_page",
          name: "Index",
          source_refs: ["docs/index.md#index"],
          confidence: "high",
          category: "guide",
        },
        {
          id: "diagram:docs/arch.md#mermaid-0",
          type: "diagram",
          name: "Architecture",
          source_refs: ["docs/arch.md#mermaid-0"],
          confidence: "high",
          category: "diagram",
        },
      ],
      edges: [
        { source: "claim:docs/spec.md#intro:deadbeef", target: "file:src/a.ts", type: "evidenced_by", direction: "out", weight: 0.8 },
        { source: "topic:core", target: "file:src/a.ts", type: "evidenced_by", direction: "out", weight: 0.9 },
        { source: "wiki_page:docs/index.md", target: "topic:core", type: "related", direction: "out", weight: 0.7 },
      ],
      layers: singleLayer(["file:src/a.ts"]),
      tour: [],
    };
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("two consecutive in-memory calls on same fixture → byte-identical output", () => {
    const r1 = validateGraphV2(fixture, { repoRoot: dir });
    const r2 = validateGraphV2(fixture, { repoRoot: dir });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(JSON.stringify(r1.data, null, 2)).toBe(JSON.stringify(r2.data, null, 2));
    expect(r1.data?.nodes.length).toBe(r2.data?.nodes.length);
    expect(r1.data?.edges.length).toBe(r2.data?.edges.length);
  });

  test("SC-11 MAJOR: reversed input order → byte-identical output (canonical sort)", () => {
    const reversed = {
      ...fixture,
      nodes: [...(fixture.nodes as any[])].reverse(),
      edges: [...(fixture.edges as any[])].reverse(),
    };
    const r1 = validateGraphV2(fixture, { repoRoot: dir });
    const r2 = validateGraphV2(reversed, { repoRoot: dir });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(JSON.stringify(r1.data?.nodes)).toBe(JSON.stringify(r2.data?.nodes));
    expect(JSON.stringify(r1.data?.edges)).toBe(JSON.stringify(r2.data?.edges));
  });

  test("duplicate nodes by ID are collapsed (canonical-first = lex smallest)", () => {
    const g = {
      ...fixture,
      nodes: [
        ...(fixture.nodes as any[]),
        {
          id: "topic:core",
          type: "topic",
          name: "Core DUPLICATE",
          source_refs: ["docs/core.md#core"],
          confidence: "low",
          category: "architecture",
          importance: "medium",
          importance_score: 0.5,
          topic_path: ["core"],
        },
      ],
    };
    const result = validateGraphV2(g, { repoRoot: dir });
    expect(result.success).toBe(true);
    const cores = result.data?.nodes.filter((n) => n.id === "topic:core") ?? [];
    expect(cores.length).toBe(1);
    expect(result.issues.some((i) => i.category === "duplicate-node")).toBe(true);
  });

  test("duplicate edges by type|source|target are collapsed", () => {
    const g = {
      ...fixture,
      edges: [
        ...(fixture.edges as any[]),
        { source: "topic:core", target: "file:src/a.ts", type: "evidenced_by", direction: "out", weight: 0.7 },
      ],
    };
    const result = validateGraphV2(g, { repoRoot: dir });
    expect(result.success).toBe(true);
    const evEdges = result.data?.edges.filter((e) => e.type === "evidenced_by" && e.source === "topic:core") ?? [];
    expect(evEdges.length).toBe(1);
    expect(result.issues.some((i) => i.category === "duplicate-edge")).toBe(true);
  });

  test("SC-11 on-disk: write result twice, files are byte-identical", () => {
    const r1 = validateGraphV2(fixture, { repoRoot: dir });
    expect(r1.success).toBe(true);

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-v2-roundtrip-"));
    try {
      const file1 = path.join(outDir, "graph1.json");
      const file2 = path.join(outDir, "graph2.json");
      const serialized = JSON.stringify(r1.data, null, 2);
      fs.writeFileSync(file1, serialized, "utf8");

      const r2 = validateGraphV2(JSON.parse(serialized), { repoRoot: dir });
      expect(r2.success).toBe(true);
      fs.writeFileSync(file2, JSON.stringify(r2.data, null, 2), "utf8");

      const bytes1 = fs.readFileSync(file1, "utf8");
      const bytes2 = fs.readFileSync(file2, "utf8");
      expect(bytes1).toBe(bytes2);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 11. KNOWLEDGE_CONFIG_DEFAULTS
// ---------------------------------------------------------------------------

describe("KNOWLEDGE_CONFIG_DEFAULTS", () => {
  test("all required config keys exist with correct defaults", () => {
    expect(KNOWLEDGE_CONFIG_DEFAULTS.maxDepth).toBe(8);
    expect(KNOWLEDGE_CONFIG_DEFAULTS.maxBranching).toBe(12);
    expect(KNOWLEDGE_CONFIG_DEFAULTS.minTopicImportance).toBe(0.4);
    expect(KNOWLEDGE_CONFIG_DEFAULTS.relMinConf).toBe(0.5);
    expect(KNOWLEDGE_CONFIG_DEFAULTS.maxFiles).toBe(3000);
    expect(KNOWLEDGE_CONFIG_DEFAULTS.maxTokens).toBe(1_000_000);
    expect(KNOWLEDGE_CONFIG_DEFAULTS.batchSize).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 12. Regression: v1 validateGraph (tolerant ladder) — UNCHANGED
// ---------------------------------------------------------------------------

describe("regression: v1 validateGraph (tolerant ladder) still works", () => {
  test("normalizes aliases, drops invalid, fatal on zero nodes", () => {
    const ok = validateGraph({
      project: { name: "p", description: "" },
      nodes: [
        { id: "file:a.ts", type: "FILE", name: "a.ts", source_refs: ["a.ts"], confidence: "high" },
        { id: "func:a.ts:f", type: "func", name: "f" }, // alias + missing fields → fixed
        { id: "bad", type: "not_a_type", name: "x" }, // dropped
      ],
      edges: [
        { source: "file:a.ts", target: "func:a.ts:f", type: "uses", direction: "forward" },
        { source: "file:a.ts", target: "ghost", type: "calls", direction: "out", weight: 1 },
      ],
    });
    expect(ok.success).toBe(true);
    const f = ok.data?.nodes.find((n: any) => n.id === "func:a.ts:f");
    expect(f?.type).toBe("function");
    expect(f?.confidence).toBe("low");
    expect(ok.data?.nodes.some((n: any) => n.id === "bad")).toBe(false);
    const e = ok.data?.edges[0];
    expect(e?.type).toBe("depends_on");
    expect(e?.direction).toBe("out");
    expect(ok.data?.edges.length).toBe(1);
    expect(ok.issues.some((i: any) => i.level === "dropped")).toBe(true);
  });

  test("fatal on zero nodes", () => {
    const fatal = validateGraph({ project: { name: "p", description: "" }, nodes: [] });
    expect(fatal.success).toBe(false);
    expect(fatal.fatal).toMatch(/No valid nodes/);
  });

  test("implemented_by is NOT aliased (LOCKED invariant)", () => {
    const { EDGE_TYPE_ALIASES } = require("../understand/lib/schema");
    expect(EDGE_TYPE_ALIASES["implemented_by"]).toBeUndefined();
  });

  test("v1 graph version is preserved through v1 ladder", () => {
    const result = validateGraph(minV1Graph());
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe("guild.knowledge_graph.v1");
  });
});

// ---------------------------------------------------------------------------
// 13. v2 graph version string
// ---------------------------------------------------------------------------

describe("v2 graph version", () => {
  test("validateGraphV2 output has version guild.knowledge_graph.v2", () => {
    const dir = makeTempRepo({
      "src/index.ts": "export function main() {}\n",
      "docs/README.md": "# Guild Core\n\nContent.\n",
    });
    try {
      const g = {
        version: "guild.knowledge_graph.v2",
        generated_from_commit: "abc123",
        project: { name: "test", description: "" },
        nodes: [
          { id: "file:src/index.ts", type: "file", name: "index.ts", source_refs: ["src/index.ts"], confidence: "high" },
          {
            id: "topic:guild-core",
            type: "topic",
            name: "Guild Core",
            source_refs: ["docs/README.md#guild-core"],
            confidence: "high",
            category: "architecture",
            importance: "high",
            importance_score: 0.9,
            topic_path: ["guild-core"],
          },
        ],
        edges: [],
        layers: singleLayer(["file:src/index.ts"]),
        tour: [],
      };
      const result = validateGraphV2(g, { repoRoot: dir });
      expect(result.success).toBe(true);
      expect(result.data?.version).toBe("guild.knowledge_graph.v2");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
