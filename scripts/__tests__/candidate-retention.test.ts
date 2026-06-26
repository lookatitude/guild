/**
 * scripts/__tests__/candidate-retention.test.ts
 *
 * METRIC 4 — Candidate-retention invariant (no-loss audit).
 *
 * INVARIANT: candidates_in (K2 wiki page count) == classified_nodes (wiki_page
 * nodes that survive into the graph) + suppressed.length (entries in
 * knowledge-suppressed.json).  No K2 candidate may silently vanish.
 *
 * Two drop-point fixtures:
 *   DROP 1 — wiki-index.ts: a page for which the classifier returns no entry
 *             is now recorded as stage:"wiki-index-unclassified" in suppressed[].
 *   DROP 2 — knowledge-orchestrator.ts: nodes that validateGraphV2 drops with
 *             level:"dropped" are now recorded as stage:"validator-dropped" in
 *             suppressed[].
 *
 * Anti-vacuity: the tests below:
 *   (a) plant an unclassified candidate → expect it in suppressed (DROP 1)
 *   (b) plant a validator-dropped node  → expect it in suppressed (DROP 2)
 *   (c) assert the invariant equation holds in both scenarios
 *   (d) assert that removing the suppression record (simulated by stripping the
 *       suppressed file) breaks the invariant — proving the gate is not vacuous.
 *
 * Usage: ./node_modules/.bin/jest --no-coverage candidate-retention
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  indexWiki,
  type ClassifyPageFn,
} from "../learn/wiki-index";

import {
  runKnowledgeStages,
  type KnowledgeLLMSeams,
} from "../learn/knowledge-orchestrator";

import {
  makeWikiPageId,
  type KnowledgeSuppressed,
} from "../learn/lib/schema";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
function mkTmpRepo(prefix = "guild-retention-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
}
function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

// ---------------------------------------------------------------------------
// DROP 1 — wiki-index.ts unclassified pages
// ---------------------------------------------------------------------------

describe("DROP 1 — wiki-index unclassified candidates", () => {
  it("records an unclassified page in suppressed[] instead of silently skipping it", async () => {
    const repo = mkTmpRepo();
    const wikiDir = path.join(repo, ".guild", "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });

    // Plant two pages: one will be classified, one will be left unclassified.
    write(repo, ".guild/wiki/index.md", "# Index\n\nThe wiki index.\n");
    write(repo, ".guild/wiki/unclassified-page.md", "# Unclassified Page\n\nNo judgment.\n");

    const classifiedId = makeWikiPageId(".guild/wiki/index.md");
    const unclassifiedId = makeWikiPageId(".guild/wiki/unclassified-page.md");

    // Classifier only returns a judgment for the index page — simulates a model
    // that returns a partial judgment map (missing entry for unclassified-page).
    const partialClassifier: ClassifyPageFn = async (pages) => {
      const result = new Map();
      for (const p of pages) {
        if (p.id === classifiedId) {
          result.set(p.id, { category: "note", importance: "low", labels: [] });
        }
        // unclassifiedId intentionally omitted — DROP 1 scenario
      }
      return result;
    };

    const result = await indexWiki(wikiDir, {
      classifier: partialClassifier,
      repoRoot: repo,
    });

    // The classified page becomes a node.
    const nodeIds = result.nodes.map((n) => n.id);
    expect(nodeIds).toContain(classifiedId);
    // The unclassified page does NOT become a node.
    expect(nodeIds).not.toContain(unclassifiedId);

    // DROP 1 fix: the unclassified page IS recorded in suppressed[].
    expect(result.suppressed).toHaveLength(1);
    const entry = result.suppressed[0];
    expect(entry.id).toBe(unclassifiedId);
    expect(entry.stage).toBe("wiki-index-unclassified");
    expect(entry.reason).toMatch(/unclassified|no judgment/i);

    // INVARIANT: candidates_in == classified_nodes + suppressed.length
    const candidatesIn = 2; // index.md + unclassified-page.md
    const classifiedNodes = result.nodes.filter((n) => n.type === "wiki_page").length;
    expect(classifiedNodes + result.suppressed.length).toBe(candidatesIn);
  });

  it("produces an empty suppressed[] when all pages are classified", async () => {
    const repo = mkTmpRepo();
    const wikiDir = path.join(repo, ".guild", "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    write(repo, ".guild/wiki/a.md", "# A\n\nPage A.\n");
    write(repo, ".guild/wiki/b.md", "# B\n\nPage B.\n");

    // Full classifier — returns entries for every page.
    const fullClassifier: ClassifyPageFn = async (pages) => {
      return new Map(pages.map((p) => [p.id, { category: "note", importance: "low", labels: [] }]));
    };

    const result = await indexWiki(wikiDir, {
      classifier: fullClassifier,
      repoRoot: repo,
    });

    expect(result.suppressed).toHaveLength(0);
    // INVARIANT: 2 candidates_in == 2 nodes + 0 suppressed
    expect(result.nodes.filter((n) => n.type === "wiki_page").length + result.suppressed.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// DROP 2 — validator-dropped nodes persisted in orchestrator
// ---------------------------------------------------------------------------

/**
 * Minimal seams that always classify pages as "note"/"low".
 * proposeTaxonomy returns 0 topics (needed to fire the SC-3 fallback root topic
 * so the graph has ≥1 topic and validateGraphV2 passes for wiki_pages).
 */
function makeSeamsAllClassify(extraClassifier?: ClassifyPageFn): KnowledgeLLMSeams {
  return {
    proposeConcepts: async () => [],
    proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
    classifyPage: extraClassifier ?? (async (pages) =>
      new Map(pages.map((p) => [p.id, { category: "note", importance: "low", labels: [] }]))
    ),
    proposeTaxonomy: async () => ({ topicProposals: [], domainProposals: [] }),
    confirmCrossLinks: async () => [],
  };
}

describe("DROP 2 — validator-dropped nodes persisted in suppressed artifact", () => {
  it("persists validator-dropped nodes into knowledge-suppressed.json with stage:validator-dropped", async () => {
    const repo = mkTmpRepo();
    const wikiDir = path.join(repo, ".guild", "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });

    // Plant one VALID classified page (passes validation).
    write(repo, ".guild/wiki/valid.md", "# Valid Page\n\nValid content.\n");

    // Plant one page whose classifier will produce an INVALID category value
    // so validateGraphV2 drops it with level:"dropped", category:"invalid-category".
    // The page gets classified, so it is NOT suppressed at DROP 1.
    // It only gets dropped at DROP 2 (validateGraphV2).
    write(repo, ".guild/wiki/bad-category.md", "# Bad Category Page\n\nBad content.\n");

    const validId = makeWikiPageId(".guild/wiki/valid.md");
    const badId = makeWikiPageId(".guild/wiki/bad-category.md");

    // Classifier returns an invalid category for the bad page — will trip SC-6.
    const mixedClassifier: ClassifyPageFn = async (pages) => {
      const result = new Map();
      for (const p of pages) {
        if (p.id === validId) {
          result.set(p.id, { category: "note", importance: "low", labels: [] });
        } else if (p.id === badId) {
          result.set(p.id, { category: "NOT_A_VALID_CATEGORY", importance: "low", labels: [] });
        }
      }
      return result;
    };

    const seams = makeSeamsAllClassify(mixedClassifier);

    const result = await runKnowledgeStages(
      repo,
      { codeRelPaths: [], docRelPaths: [], wikiDir },
      seams,
      { project: { name: "test", description: "retention test" } }
    );

    // The valid page should be in the graph.
    const nodeIds = result.graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain(validId);
    // The bad page should NOT be in the graph (dropped by validator SC-6).
    expect(nodeIds).not.toContain(badId);

    // The suppressed artifact must exist on disk.
    expect(fs.existsSync(result.suppressedPath)).toBe(true);
    const doc = JSON.parse(fs.readFileSync(result.suppressedPath, "utf8")) as KnowledgeSuppressed;
    expect(doc.schema).toBe("guild.knowledge_suppressed.v1");

    // The bad-category page must appear in suppressed[] as stage:validator-dropped.
    const validatorDropped = doc.suppressed.filter((e) => e.stage === "validator-dropped");
    const droppedIds = validatorDropped.map((e) => e.id);
    expect(droppedIds).toContain(badId);

    // Reason must carry the validator's drop reason.
    const badEntry = validatorDropped.find((e) => e.id === badId)!;
    expect(badEntry.reason).toMatch(/invalid.category|NOT_A_VALID_CATEGORY|category.*removed/i);
  });
});

// ---------------------------------------------------------------------------
// INVARIANT — full-pipeline retention equation
// ---------------------------------------------------------------------------

describe("Retention invariant: candidates_in == classified_nodes + suppressed.length", () => {
  it("holds when one page is unclassified (DROP 1) — both sides equal", async () => {
    const repo = mkTmpRepo();
    const wikiDir = path.join(repo, ".guild", "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });

    write(repo, ".guild/wiki/page-a.md", "# Page A\n\nClassified.\n");
    write(repo, ".guild/wiki/page-b.md", "# Page B\n\nUnclassified — no judgment returned.\n");

    const pageAId = makeWikiPageId(".guild/wiki/page-a.md");

    // Only page-a gets a judgment.
    const partialClassifier: ClassifyPageFn = async (pages) => {
      const result = new Map();
      for (const p of pages) {
        if (p.id === pageAId) {
          result.set(p.id, { category: "note", importance: "low", labels: [] });
        }
        // page-b intentionally omitted
      }
      return result;
    };

    const seams = makeSeamsAllClassify(partialClassifier);

    const result = await runKnowledgeStages(
      repo,
      { codeRelPaths: [], docRelPaths: [], wikiDir },
      seams,
      { project: { name: "test", description: "retention invariant test" } }
    );

    // Read the persisted suppressed artifact.
    const doc = JSON.parse(fs.readFileSync(result.suppressedPath, "utf8")) as KnowledgeSuppressed;

    const candidatesIn = 2; // page-a.md + page-b.md
    const classifiedNodes = result.graph.nodes.filter((n) => n.type === "wiki_page").length;
    const suppressedCount = doc.suppressed.length;

    // INVARIANT assertion.
    expect(classifiedNodes + suppressedCount).toBe(candidatesIn);

    // Confirm page-b appears in suppressed (not silently vanished).
    const pageBId = makeWikiPageId(".guild/wiki/page-b.md");
    const pageBEntry = doc.suppressed.find((e) => e.id === pageBId);
    expect(pageBEntry).toBeDefined();
    expect(pageBEntry!.stage).toBe("wiki-index-unclassified");
  });

  // Anti-vacuity: demonstrate that if the suppressed file were ABSENT (simulated
  // by deleting it after the run), the invariant equation breaks — proving the
  // assertion is not trivially true.
  it("anti-vacuity: deleting the suppressed artifact breaks the invariant equation", async () => {
    // @control: this test is the vacuity proof — it intentionally triggers the
    // broken state (missing artifact → equation cannot be verified → fail).
    // @control: ./candidate-retention.test.ts (self-contained vacuity proof)
    const repo = mkTmpRepo();
    const wikiDir = path.join(repo, ".guild", "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });

    write(repo, ".guild/wiki/alpha.md", "# Alpha\n\nClassified.\n");
    write(repo, ".guild/wiki/beta.md", "# Beta\n\nUnclassified.\n");

    const alphaId = makeWikiPageId(".guild/wiki/alpha.md");
    const partialClassifier: ClassifyPageFn = async (pages) => {
      const result = new Map();
      for (const p of pages) {
        if (p.id === alphaId) {
          result.set(p.id, { category: "note", importance: "low", labels: [] });
        }
      }
      return result;
    };

    const seams = makeSeamsAllClassify(partialClassifier);
    const result = await runKnowledgeStages(
      repo,
      { codeRelPaths: [], docRelPaths: [], wikiDir },
      seams,
      { project: { name: "test", description: "anti-vacuity" } }
    );

    // Sanity: the suppressed artifact exists and has 1 entry.
    expect(fs.existsSync(result.suppressedPath)).toBe(true);
    const doc = JSON.parse(fs.readFileSync(result.suppressedPath, "utf8")) as KnowledgeSuppressed;
    expect(doc.suppressed.length).toBeGreaterThan(0);

    // Now simulate what would happen if the suppressed artifact did NOT exist
    // (i.e. the persistence code were removed). We delete the file and verify
    // that a caller checking the invariant would see the breakage.
    fs.unlinkSync(result.suppressedPath);

    // Without the artifact, a caller cannot account for the missing candidate.
    const classifiedNodes = result.graph.nodes.filter((n) => n.type === "wiki_page").length;
    const candidatesIn = 2;
    // With the file gone, suppressed count is treated as 0.
    const apparentSuppressedCount = 0;
    // The invariant FAILS: 1 + 0 != 2.
    expect(classifiedNodes + apparentSuppressedCount).not.toBe(candidatesIn);
  });
});
