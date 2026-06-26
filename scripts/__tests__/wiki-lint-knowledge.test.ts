/**
 * scripts/__tests__/wiki-lint-knowledge.test.ts
 *
 * L8 TDD-first tests — SC-6 lint half: knowledge graph lint check
 *
 * Acceptance (per plan L8 + bad-nodes.json):
 *   - wiki-lint flags the seeded bad node wiki_page_missing_importance:
 *     a wiki_page with a valid category but NO importance field —
 *     this PASSES validateGraphV2 but MUST be flagged by lintKnowledgeNodes.
 *   - wiki-lint flags a node with an out-of-enum category.
 *   - wiki-lint does NOT flag a clean knowledge node (valid category + importance).
 *   - wiki-lint does NOT flag non-knowledge nodes (file, function, class).
 *   - Every finding carries nodeId (non-empty) + check (enum) + reason (non-empty).
 *
 * Determinism responsibility table (SC-9 — this module):
 *   | Output         | Owner                |
 *   |----------------|----------------------|
 *   | findings list  | deterministic-script |
 *   | nodeId         | deterministic-script |
 *   | check          | deterministic-script |
 *   | reason         | deterministic-script |
 *
 * All outputs are deterministic-script. No LLM involved in the lint check.
 *
 * Usage: npx jest --testPathPatterns=wiki-lint-knowledge --no-coverage
 */

import * as path from "path";
import * as fs from "fs";
import { lintKnowledgeNodes, KnowledgeLintFinding } from "../learn/wiki-lint-knowledge";
import type { GraphNode } from "../learn/lib/schema";

// ---------------------------------------------------------------------------
// Load L0f oracle fixtures
// ---------------------------------------------------------------------------

const FIX = path.join(__dirname, "../learn/__tests__/fixtures/knowledge");
const bad = JSON.parse(fs.readFileSync(path.join(FIX, "bad-nodes.json"), "utf8"));

// The seeded negative from bad-nodes.json, flagged_by_wiki_lint section.
// This node PASSES validateGraphV2 (has valid category "guide") but is MISSING
// the `importance` field — exactly what the lint check must catch.
const MISSING_IMPORTANCE_NODE = bad.flagged_by_wiki_lint.wiki_page_missing_importance.node as GraphNode;

// The seeded negative from rejected_by_validator — out-of-enum category.
// This is also lint-flaggable (advisory; validator already rejects it as a hard drop).
const OUT_OF_ENUM_CATEGORY_NODE = bad.rejected_by_validator.out_of_enum_category.node as GraphNode;

// ---------------------------------------------------------------------------
// SC-6 lint half — missing-importance (primary L8 acceptance criterion)
// ---------------------------------------------------------------------------

describe("lintKnowledgeNodes — SC-6 lint half (missing-importance)", () => {

  it("flags wiki_page_missing_importance from the L0f bad-nodes fixture", () => {
    // This is the critical acceptance criterion: the validator-valid-but-lint-flaggable node.
    const findings = lintKnowledgeNodes([MISSING_IMPORTANCE_NODE]);

    const importanceFinding = findings.find(f => f.check === "missing-importance");
    expect(importanceFinding).toBeDefined();
    expect(importanceFinding!.nodeId).toBe("wiki_page:docs/storage.md");
    expect(importanceFinding!.reason).toBeTruthy();
    // Reason must mention the field name so the user knows what to fix
    expect(importanceFinding!.reason).toMatch(/importance/i);
  });

  it("does NOT flag a clean wiki_page with valid importance (high|medium|low)", () => {
    const cleanNode: GraphNode = {
      id: "wiki_page:docs/clean.md",
      type: "wiki_page",
      name: "Clean",
      category: "guide",
      importance: "high",
      labels: ["clean"],
      source_refs: ["docs/clean.md#clean"],
      confidence: "high",
    };
    const findings = lintKnowledgeNodes([cleanNode]);
    expect(findings.filter(f => f.check === "missing-importance")).toHaveLength(0);
  });

  it("does NOT flag a topic node missing string importance (topic uses numeric importance_score, not string importance)", () => {
    // B-1 canonical per-type contract:
    //   topic → carries NUMERIC importance_score (validator-enforced).
    //   Linting topic for STRING importance would false-positive on every valid topic.
    //   IMPORTANCE_LINTABLE_TYPES = Set(["wiki_page"]) only.
    const topicNoStringImportance: GraphNode = {
      id: "topic:abc12345",
      type: "topic",
      name: "Some Topic",
      category: "concept",
      importance_score: 0.8,
      // string `importance` deliberately absent — this is valid for a topic
      topic_path: ["some-topic"],
      source_refs: ["docs/overview.md#overview"],
      confidence: "high",
    };
    const findings = lintKnowledgeNodes([topicNoStringImportance]);
    // missing-importance must NOT fire on a topic
    expect(findings.filter(f => f.check === "missing-importance")).toHaveLength(0);
  });

  it("does NOT flag a concept node missing importance (concept is not an importance-lintable type)", () => {
    // Scope: missing-importance only applies to wiki_page + topic nodes (K2+K4 assign it).
    // claim/concept/entity/diagram don't yet carry importance in the K-stage pipeline.
    const conceptNode: GraphNode = {
      id: "concept:src/x.ts#L1-L5:00000000",
      type: "concept",
      name: "Some Concept",
      category: "concept",
      source_refs: ["src/x.ts#L1-L5"],
      confidence: "high",
    };
    const findings = lintKnowledgeNodes([conceptNode]);
    expect(findings.filter(f => f.check === "missing-importance")).toHaveLength(0);
  });

  it("flags importance='invalid-value' (not high|medium|low) on a wiki_page", () => {
    const badImportance: GraphNode = {
      id: "wiki_page:docs/bad-imp.md",
      type: "wiki_page",
      name: "Bad Importance",
      category: "guide",
      importance: "super-high" as string, // invalid value
      source_refs: ["docs/bad-imp.md#bad-importance"],
      confidence: "high",
    };
    const findings = lintKnowledgeNodes([badImportance]);
    expect(findings.some(f => f.check === "missing-importance")).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// SC-6 lint half — invalid-category (secondary lint check; advisory)
// ---------------------------------------------------------------------------

describe("lintKnowledgeNodes — SC-6 lint half (invalid-category)", () => {

  it("flags the out_of_enum_category node from the L0f bad-nodes fixture", () => {
    const findings = lintKnowledgeNodes([OUT_OF_ENUM_CATEGORY_NODE]);
    const catFinding = findings.find(f => f.check === "invalid-category");
    expect(catFinding).toBeDefined();
    expect(catFinding!.nodeId).toBe("wiki_page:docs/overview.md");
    // Reason should name the offending category value so it's actionable
    expect(catFinding!.reason).toMatch(/not-a-real-category/);
  });

  it("does NOT flag a node with a valid category from NODE_CATEGORIES", () => {
    const validCatNode: GraphNode = {
      id: "wiki_page:docs/valid-cat.md",
      type: "wiki_page",
      name: "Valid Category",
      category: "guide",
      importance: "medium",
      source_refs: ["docs/valid-cat.md#valid-category"],
      confidence: "high",
    };
    const findings = lintKnowledgeNodes([validCatNode]);
    expect(findings.filter(f => f.check === "invalid-category")).toHaveLength(0);
  });

  it("flags a node with missing category (null/undefined)", () => {
    const noCatNode: GraphNode = {
      id: "wiki_page:docs/nocat.md",
      type: "wiki_page",
      name: "No Category",
      // category: undefined  -- deliberately omitted
      importance: "medium",
      source_refs: ["docs/nocat.md#no-category"],
      confidence: "high",
    };
    const findings = lintKnowledgeNodes([noCatNode]);
    expect(findings.some(f => f.check === "invalid-category")).toBe(true);
  });

});

// ---------------------------------------------------------------------------
// Non-knowledge nodes — must NOT be flagged
// ---------------------------------------------------------------------------

describe("lintKnowledgeNodes — non-knowledge node types are NOT flagged", () => {

  it("does not flag a file node (no importance/category requirement)", () => {
    const fileNode: GraphNode = {
      id: "file:src/main.ts",
      type: "file",
      name: "main.ts",
      source_refs: ["src/main.ts"],
      confidence: "high",
    };
    expect(lintKnowledgeNodes([fileNode])).toHaveLength(0);
  });

  it("does not flag a function node", () => {
    const fnNode: GraphNode = {
      id: "function:src/main.ts:main",
      type: "function",
      name: "main",
      source_refs: ["src/main.ts#L1-L5"],
      confidence: "high",
    };
    expect(lintKnowledgeNodes([fnNode])).toHaveLength(0);
  });

  it("does not flag a class node", () => {
    const classNode: GraphNode = {
      id: "class:src/app.ts:App",
      type: "class",
      name: "App",
      source_refs: ["src/app.ts"],
      confidence: "high",
    };
    expect(lintKnowledgeNodes([classNode])).toHaveLength(0);
  });

  it("does not flag a domain node", () => {
    const domainNode: GraphNode = {
      id: "domain:event-ingestion",
      type: "domain",
      name: "Event Ingestion",
      source_refs: [],
      confidence: "high",
    };
    expect(lintKnowledgeNodes([domainNode])).toHaveLength(0);
  });

  it("does not flag a claim node missing importance (not an importance-lintable type)", () => {
    const claimNode: GraphNode = {
      id: "claim:docs/x.md#x:00000000",
      type: "claim",
      name: "Some claim.",
      category: "claim",
      source_refs: ["docs/x.md#x"],
      confidence: "high",
    };
    expect(lintKnowledgeNodes([claimNode]).filter(f => f.check === "missing-importance")).toHaveLength(0);
  });

  it("does not flag an entity node missing importance (not an importance-lintable type)", () => {
    const entityNode: GraphNode = {
      id: "entity:event",
      type: "entity",
      name: "Event",
      category: "concept",
      source_refs: [],
      confidence: "high",
    };
    expect(lintKnowledgeNodes([entityNode]).filter(f => f.check === "missing-importance")).toHaveLength(0);
  });

  it("empty array returns empty findings", () => {
    expect(lintKnowledgeNodes([])).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// Finding shape — every finding carries the required fields
// ---------------------------------------------------------------------------

describe("lintKnowledgeNodes — finding shape (nodeId + check + reason)", () => {

  it("every finding has a non-empty nodeId, a valid check enum, and a non-empty reason", () => {
    // MISSING_IMPORTANCE_NODE is a wiki_page → missing-importance check fires.
    // OUT_OF_ENUM_CATEGORY_NODE is a wiki_page with bad category → invalid-category fires,
    //   and also missing-importance-equivalent (it has importance:"high" so no missing-imp finding,
    //   but invalid-category fires). Use them together to get >=2 findings.
    const nodes: GraphNode[] = [MISSING_IMPORTANCE_NODE, OUT_OF_ENUM_CATEGORY_NODE];
    const findings = lintKnowledgeNodes(nodes);
    expect(findings.length).toBeGreaterThanOrEqual(1); // at minimum the out_of_enum_category fires

    const validChecks: Set<KnowledgeLintFinding["check"]> = new Set(["missing-importance", "invalid-category"]);
    for (const f of findings) {
      expect(typeof f.nodeId).toBe("string");
      expect(f.nodeId.length).toBeGreaterThan(0);
      expect(validChecks.has(f.check)).toBe(true);
      expect(typeof f.reason).toBe("string");
      expect(f.reason.length).toBeGreaterThan(0);
    }
  });

  it("a clean node array produces zero findings", () => {
    const cleanNodes: GraphNode[] = [
      { id: "wiki_page:docs/a.md", type: "wiki_page", name: "A", category: "guide", importance: "high", labels: [], source_refs: ["docs/a.md#a"], confidence: "high" },
      { id: "wiki_page:docs/b.md", type: "wiki_page", name: "B", category: "decision", importance: "medium", labels: [], source_refs: ["docs/b.md#b"], confidence: "high" },
      { id: "file:src/a.ts", type: "file", name: "a.ts", source_refs: [], confidence: "high" },
    ];
    expect(lintKnowledgeNodes(cleanNodes)).toHaveLength(0);
  });

});

// ---------------------------------------------------------------------------
// Determinism — same input always produces same findings (SC-9)
// ---------------------------------------------------------------------------

describe("lintKnowledgeNodes — determinism (SC-9)", () => {

  it("two calls on the same nodes produce identical findings", () => {
    const nodes: GraphNode[] = [MISSING_IMPORTANCE_NODE, OUT_OF_ENUM_CATEGORY_NODE];
    const r1 = lintKnowledgeNodes(nodes);
    const r2 = lintKnowledgeNodes(nodes);
    // Deep-equal (sorted by composite key for stability)
    const key = (f: KnowledgeLintFinding) => `${f.check}|${f.nodeId}`;
    expect(r1.map(key).sort()).toEqual(r2.map(key).sort());
  });

  it("output is independent of input array order (same findings for reversed input)", () => {
    const nodes: GraphNode[] = [MISSING_IMPORTANCE_NODE, OUT_OF_ENUM_CATEGORY_NODE];
    const reversed = [...nodes].reverse();
    const r1 = lintKnowledgeNodes(nodes).map(f => `${f.check}|${f.nodeId}`).sort();
    const r2 = lintKnowledgeNodes(reversed).map(f => `${f.check}|${f.nodeId}`).sort();
    expect(r1).toEqual(r2);
  });

});
