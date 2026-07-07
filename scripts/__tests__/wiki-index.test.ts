/**
 * scripts/__tests__/wiki-index.test.ts
 *
 * L2 TDD-first tests — SC-3 + SC-6: K2 wiki/KB index
 *
 * Acceptance: SC-3 Check on the L0f frozen fixture corpus:
 *   - page_count == wiki_page node count (6)
 *   - all 8 expected_related_edges present (1:1 with [[wikilinks]])
 *   - every wiki_page has non-null category + importance
 *
 * Also covers the no-index branch (docs/knowledge/ style — no index.md):
 *   - Recursive scan finds all non-meta .md files
 *   - README.md (and other meta files) are excluded
 *   - wiki_page nodes and related edges are emitted correctly
 *   - ids and anchors are deterministic
 *
 * SC-6 Check (structural — deep validation lives in L0):
 *   - category on every wiki_page is from the closed enum
 *   - confidence is one of high|medium|low
 *
 * Determinism responsibility table (SC-9 — this lane's contract):
 * | Output                        | Owner                  |
 * |-------------------------------|------------------------|
 * | wiki_page node ids            | deterministic-script   |
 * | source_refs (H1 heading slug) | deterministic-script   |
 * | name (H1 text)                | deterministic-script   |
 * | related edges (wikilinks 1:1) | deterministic-script   |
 * | edge direction / weight       | deterministic-script   |
 * | category                      | LLM-judged (mock in test) |
 * | importance                    | LLM-judged (mock in test) |
 * | labels[]                      | LLM-judged (mock in test) |
 * | implicit relates_to edges     | LLM-judged (mock in test) |
 *
 * Usage: npx jest --testPathPattern=wiki-index --no-coverage
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  indexWiki,
  type WikiPageClassification,
  type ClassifyPageFn,
} from "../learn/wiki-index";
import { NODE_CATEGORIES } from "../learn/lib/schema";

// ---------------------------------------------------------------------------
// Fixture paths + oracle data
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.resolve(
  __dirname,
  "../learn/__tests__/fixtures/knowledge",
);

// Pinned SC-3 classification oracle from expected-output.json
// (these are the LLM-judged values that the fixture locks down).
const PINNED_CLASSIFICATION: Record<string, WikiPageClassification> = {
  "wiki_page:index.md":          { category: "index",     importance: "high",   labels: ["index", "map"] },
  "wiki_page:docs/overview.md":  { category: "overview",  importance: "high",   labels: ["overview"] },
  "wiki_page:docs/ingestion.md": { category: "guide",     importance: "high",   labels: ["ingestion", "pipeline"] },
  "wiki_page:docs/validation.md":{ category: "reference", importance: "medium", labels: ["validation", "rules"] },
  "wiki_page:docs/storage.md":   { category: "guide",     importance: "medium", labels: ["storage", "persistence"] },
  "wiki_page:docs/concepts.md":  { category: "concept",   importance: "low",    labels: ["glossary", "vocabulary"] },
};

/**
 * Pinned classifier: returns the oracle classifications from the fixture.
 * Replaces the LLM call for deterministic TDD.
 */
const fixtureClassifier: ClassifyPageFn = async (pages) => {
  const result = new Map<string, WikiPageClassification>();
  for (const page of pages) {
    const cls = PINNED_CLASSIFICATION[page.id];
    if (cls) result.set(page.id, cls);
  }
  return result;
};

// ---------------------------------------------------------------------------
// Expected edges (from expected-output.json SC-3.expected_related_edges)
// ---------------------------------------------------------------------------

const EXPECTED_RELATED_EDGES = [
  { source: "wiki_page:index.md",           target: "wiki_page:docs/overview.md",  type: "related", direction: "out", weight: 1.0 },
  { source: "wiki_page:index.md",           target: "wiki_page:docs/ingestion.md", type: "related", direction: "out", weight: 1.0 },
  { source: "wiki_page:index.md",           target: "wiki_page:docs/validation.md",type: "related", direction: "out", weight: 1.0 },
  { source: "wiki_page:index.md",           target: "wiki_page:docs/storage.md",   type: "related", direction: "out", weight: 1.0 },
  { source: "wiki_page:index.md",           target: "wiki_page:docs/concepts.md",  type: "related", direction: "out", weight: 1.0 },
  { source: "wiki_page:docs/overview.md",   target: "wiki_page:docs/ingestion.md", type: "related", direction: "out", weight: 1.0 },
  { source: "wiki_page:docs/ingestion.md",  target: "wiki_page:docs/validation.md",type: "related", direction: "out", weight: 1.0 },
  { source: "wiki_page:docs/validation.md", target: "wiki_page:docs/concepts.md",  type: "related", direction: "out", weight: 1.0 },
];

// ---------------------------------------------------------------------------
// SC-3: page count
// ---------------------------------------------------------------------------

describe("SC-3 — wiki indexed + labeled + classified", () => {

  test("page_count == wiki_page node count (6)", async () => {
    const { nodes } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");
    expect(wikiPageNodes).toHaveLength(6);
  });

  // -------------------------------------------------------------------------
  // SC-3: all 8 expected related edges (1:1 with [[wikilinks]])
  // -------------------------------------------------------------------------

  test("total related edges == 8 (1:1 with wikilinks)", async () => {
    const { edges } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const relatedEdges = edges.filter((e) => e.type === "related");
    expect(relatedEdges).toHaveLength(8);
  });

  test("each expected related edge is present with exact source/target/type/direction", async () => {
    const { edges } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const relatedEdges = edges.filter((e) => e.type === "related");

    for (const exp of EXPECTED_RELATED_EDGES) {
      const found = relatedEdges.find(
        (e) =>
          e.source === exp.source &&
          e.target === exp.target &&
          e.type === exp.type &&
          e.direction === exp.direction,
      );
      expect(found).toBeDefined(
        // message for a missing edge
        // Jest doesn't support message in toBeDefined, but it prints the exp object
      );
    }
  });

  test("related edge weights are numeric 0..1", async () => {
    const { edges } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const relatedEdges = edges.filter((e) => e.type === "related");
    for (const e of relatedEdges) {
      expect(typeof e.weight).toBe("number");
      expect(e.weight).toBeGreaterThanOrEqual(0);
      expect(e.weight).toBeLessThanOrEqual(1);
    }
  });

  // -------------------------------------------------------------------------
  // SC-3: every wiki_page has non-null category + importance
  // -------------------------------------------------------------------------

  test("every wiki_page node has non-null category and importance", async () => {
    const { nodes } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");
    for (const node of wikiPageNodes) {
      expect(node.category).toBeTruthy();
      expect(node.importance).toBeTruthy();
    }
  });

  // -------------------------------------------------------------------------
  // SC-3: classification values match oracle
  // -------------------------------------------------------------------------

  test("wiki_page classification matches oracle (category/importance/labels)", async () => {
    const { nodes } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");

    for (const node of wikiPageNodes) {
      const oracle = PINNED_CLASSIFICATION[node.id as string];
      expect(oracle).toBeDefined(); // id must be in oracle
      expect(node.category).toBe(oracle.category);
      expect(node.importance).toBe(oracle.importance);
      // labels[] must include all oracle labels (order-independent)
      const labels = (node.labels ?? []) as string[];
      for (const lbl of oracle.labels) {
        expect(labels).toContain(lbl);
      }
    }
  });

  // -------------------------------------------------------------------------
  // SC-3: deterministic ids (wiki_page:<relpath>)
  // -------------------------------------------------------------------------

  test("wiki_page ids are deterministic (wiki_page:<relpath>)", async () => {
    const { nodes } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");
    const expectedIds = new Set([
      "wiki_page:index.md",
      "wiki_page:docs/overview.md",
      "wiki_page:docs/ingestion.md",
      "wiki_page:docs/validation.md",
      "wiki_page:docs/storage.md",
      "wiki_page:docs/concepts.md",
    ]);
    const actualIds = new Set(wikiPageNodes.map((n) => n.id));
    for (const id of expectedIds) {
      expect(actualIds).toContain(id);
    }
    expect(actualIds.size).toBe(expectedIds.size);
  });

  // -------------------------------------------------------------------------
  // SC-3 + SC-12: source_refs use heading-slug anchors and are non-empty
  // -------------------------------------------------------------------------

  test("every wiki_page node has a non-empty source_refs with heading-slug anchor", async () => {
    const { nodes } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");
    for (const node of wikiPageNodes) {
      const refs = node.source_refs as string[];
      expect(refs.length).toBeGreaterThan(0);
      // Each ref must be a path#heading-slug form (contains '#')
      for (const ref of refs) {
        expect(ref).toContain("#");
      }
    }
  });

  // -------------------------------------------------------------------------
  // SC-3: wiki_page names match H1 text
  // -------------------------------------------------------------------------

  test("wiki_page names match H1 text", async () => {
    const { nodes } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const expectedNames: Record<string, string> = {
      "wiki_page:index.md":           "Event Pipeline Knowledge Base",
      "wiki_page:docs/overview.md":   "Overview",
      "wiki_page:docs/ingestion.md":  "Ingestion",
      "wiki_page:docs/validation.md": "Validation",
      "wiki_page:docs/storage.md":    "Storage",
      "wiki_page:docs/concepts.md":   "Concepts",
    };
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");
    for (const node of wikiPageNodes) {
      const expected = expectedNames[node.id as string];
      if (expected !== undefined) {
        expect(node.name).toBe(expected);
      }
    }
  });

});

// ---------------------------------------------------------------------------
// SC-6: closed-enum category validation
// ---------------------------------------------------------------------------

describe("SC-6 — classification schema", () => {

  test("category on every wiki_page is from the closed NODE_CATEGORIES enum", async () => {
    const { nodes } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");
    for (const node of wikiPageNodes) {
      expect(NODE_CATEGORIES.has(node.category as string)).toBe(true);
    }
  });

  test("confidence on every wiki_page is one of high|medium|low", async () => {
    const { nodes } = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");
    const validConf = new Set(["high", "medium", "low"]);
    for (const node of wikiPageNodes) {
      expect(validConf.has(node.confidence as string)).toBe(true);
    }
  });

});

// ---------------------------------------------------------------------------
// Idempotency (SC-11 partial: deterministic fields must be input-order independent)
// ---------------------------------------------------------------------------

describe("SC-11 partial — determinism of the deterministic fields", () => {

  test("two calls produce same wiki_page ids and related edges (deterministic fields)", async () => {
    const r1 = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });
    const r2 = await indexWiki(FIXTURE_DIR, { classifier: fixtureClassifier });

    const ids1 = r1.nodes.filter((n) => n.type === "wiki_page").map((n) => n.id).sort();
    const ids2 = r2.nodes.filter((n) => n.type === "wiki_page").map((n) => n.id).sort();
    expect(ids1).toEqual(ids2);

    const relKey = (e: { source: string; target: string; type: string }) =>
      `${e.source}|${e.target}|${e.type}`;
    const edges1 = r1.edges.filter((e) => e.type === "related").map(relKey).sort();
    const edges2 = r2.edges.filter((e) => e.type === "related").map(relKey).sort();
    expect(edges1).toEqual(edges2);
  });

});

// ---------------------------------------------------------------------------
// SC-3 no-index branch: docs/knowledge/ style (own deterministic scanner,
// no index.md required). Exercises wiki-index.ts:collectMarkdownFilesRecursive
// which is the second half of SC-3's requirement.
// Uses an inline temp dir so the committed L0f oracle is never touched.
// ---------------------------------------------------------------------------

describe("SC-3 — no-index branch (docs/knowledge/ style, no index.md)", () => {

  // ── helpers ──────────────────────────────────────────────────────────────

  let tmpDir: string;

  /** Write a file at relpath under tmpDir (creates parent dirs). */
  function writeFile(relpath: string, content: string): void {
    const abs = path.join(tmpDir, relpath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  /** Minimal classifier: assigns category=guide / importance=medium / labels=[] */
  const minimalClassifier: ClassifyPageFn = async (pages) => {
    const result = new Map<string, WikiPageClassification>();
    for (const p of pages) {
      result.set(p.id, { category: "guide", importance: "medium", labels: [] });
    }
    return result;
  };

  beforeEach(() => {
    // Fresh temp dir for each test — no cross-test state
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-index-noindex-"));
  });

  afterEach(() => {
    // Clean up
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  // ── corpus layout ─────────────────────────────────────────────────────────
  //
  //   tmpDir/
  //     README.md          ← meta: must be EXCLUDED
  //     decisions/
  //       adr-001.md       # ADR 001 — carries [[concepts]] wikilink
  //       adr-002.md       # ADR 002 — carries [[adr-001]] wikilink
  //     concepts.md        # Concepts glossary
  //
  // Expected:
  //   wiki_page nodes:  adr-001.md, adr-002.md, concepts.md  (3, NOT 4)
  //   related edges:    adr-001 → concepts, adr-002 → adr-001  (2 edges)
  //   README.md excluded (meta file)

  function buildCorpus(): void {
    writeFile("README.md", "# Meta\nThis is a README, not a wiki page.\n");
    writeFile("decisions/adr-001.md", "# ADR 001\n\nFirst decision. See [[concepts]] for vocabulary.\n");
    writeFile("decisions/adr-002.md", "# ADR 002\n\nSecond decision. Supersedes [[adr-001]].\n");
    writeFile("concepts.md", "# Concepts\n\nShared glossary for this knowledge base.\n");
  }

  // ── tests ─────────────────────────────────────────────────────────────────

  test("no-index: recursive scan finds exactly the 3 non-meta .md files", async () => {
    buildCorpus();
    const { nodes } = await indexWiki(tmpDir, { classifier: minimalClassifier });
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");
    expect(wikiPageNodes).toHaveLength(3);
  });

  test("no-index: README.md is excluded from the wiki_page nodes", async () => {
    buildCorpus();
    const { nodes } = await indexWiki(tmpDir, { classifier: minimalClassifier });
    const ids = nodes.map((n) => n.id);
    expect(ids).not.toContain("wiki_page:README.md");
  });

  test("no-index: wiki_page ids are deterministic (wiki_page:<relpath>)", async () => {
    buildCorpus();
    const { nodes } = await indexWiki(tmpDir, { classifier: minimalClassifier });
    const ids = new Set(nodes.filter((n) => n.type === "wiki_page").map((n) => n.id));
    expect(ids).toContain("wiki_page:concepts.md");
    expect(ids).toContain("wiki_page:decisions/adr-001.md");
    expect(ids).toContain("wiki_page:decisions/adr-002.md");
  });

  test("no-index: 2 related edges emitted from the wikilinks", async () => {
    buildCorpus();
    const { edges } = await indexWiki(tmpDir, { classifier: minimalClassifier });
    const related = edges.filter((e) => e.type === "related");
    expect(related).toHaveLength(2);
  });

  test("no-index: related edge adr-001 → concepts is present (direction=out, weight numeric 0..1)", async () => {
    buildCorpus();
    const { edges } = await indexWiki(tmpDir, { classifier: minimalClassifier });
    const edge = edges.find(
      (e) =>
        e.source === "wiki_page:decisions/adr-001.md" &&
        e.target === "wiki_page:concepts.md" &&
        e.type === "related" &&
        e.direction === "out",
    );
    expect(edge).toBeDefined();
    expect(typeof edge!.weight).toBe("number");
    expect(edge!.weight).toBeGreaterThanOrEqual(0);
    expect(edge!.weight).toBeLessThanOrEqual(1);
  });

  test("no-index: related edge adr-002 → adr-001 is present (direction=out)", async () => {
    buildCorpus();
    const { edges } = await indexWiki(tmpDir, { classifier: minimalClassifier });
    const edge = edges.find(
      (e) =>
        e.source === "wiki_page:decisions/adr-002.md" &&
        e.target === "wiki_page:decisions/adr-001.md" &&
        e.type === "related" &&
        e.direction === "out",
    );
    expect(edge).toBeDefined();
  });

  test("no-index: names match H1 text of each page", async () => {
    buildCorpus();
    const { nodes } = await indexWiki(tmpDir, { classifier: minimalClassifier });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get("wiki_page:concepts.md")?.name).toBe("Concepts");
    expect(byId.get("wiki_page:decisions/adr-001.md")?.name).toBe("ADR 001");
    expect(byId.get("wiki_page:decisions/adr-002.md")?.name).toBe("ADR 002");
  });

  test("no-index: source_refs use heading-slug anchors (non-empty, contains #)", async () => {
    buildCorpus();
    const { nodes } = await indexWiki(tmpDir, { classifier: minimalClassifier });
    const wikiPageNodes = nodes.filter((n) => n.type === "wiki_page");
    for (const node of wikiPageNodes) {
      const refs = node.source_refs as string[];
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ref).toContain("#");
      }
    }
  });

  test("no-index: classifier is called with descriptors for all 3 pages", async () => {
    buildCorpus();
    const seen: string[] = [];
    const trackingClassifier: ClassifyPageFn = async (pages) => {
      seen.push(...pages.map((p) => p.id));
      return minimalClassifier(pages);
    };
    await indexWiki(tmpDir, { classifier: trackingClassifier });
    expect(seen).toHaveLength(3);
    expect(seen.sort()).toEqual([
      "wiki_page:concepts.md",
      "wiki_page:decisions/adr-001.md",
      "wiki_page:decisions/adr-002.md",
    ].sort());
  });

  test("no-index: deterministic — two calls yield identical ids and edges", async () => {
    buildCorpus();
    const r1 = await indexWiki(tmpDir, { classifier: minimalClassifier });
    const r2 = await indexWiki(tmpDir, { classifier: minimalClassifier });

    const ids1 = r1.nodes.filter((n) => n.type === "wiki_page").map((n) => n.id).sort();
    const ids2 = r2.nodes.filter((n) => n.type === "wiki_page").map((n) => n.id).sort();
    expect(ids1).toEqual(ids2);

    const relKey = (e: { source: string; target: string; type: string }) =>
      `${e.source}|${e.target}|${e.type}`;
    const edges1 = r1.edges.filter((e) => e.type === "related").map(relKey).sort();
    const edges2 = r2.edges.filter((e) => e.type === "related").map(relKey).sort();
    expect(edges1).toEqual(edges2);
  });

});
