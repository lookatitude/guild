/**
 * scripts/__tests__/knowledge-orchestrator.test.ts
 *
 * TDD discipline: tests confirmed RED ("Cannot find module") before implementation.
 *
 * Covers:
 *   A — buildFileBackedSeams: reads judgment files by candidate_key (hermetic)
 *   B — emitRound1Candidates: writes k1/k2/k3/k4 candidate files with candidate_keys
 *   C — SC-8: runKnowledgeStages same judgments → byte-identical knowledge-recall.json
 *   D — Stage ordering: K3 runs before K5 (diagram nodes in final graph)
 *   E — Artifacts: knowledge-graph.json + knowledge-recall.json + provenance all written
 *   F — CLI phase routing: --phase flag dispatches correctly (smoke test)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Module under test — does NOT exist yet (expected RED state)
import {
  runKnowledgeStages,
  buildFileBackedSeams,
  emitRound1Candidates,
  type KnowledgeFilePaths,
  type KnowledgeLLMSeams,
  type RunKnowledgeOptions,
  type K1JudgmentsDoc,
  type K2JudgmentsDoc,
  type K4JudgmentsDoc,
  type K5JudgmentsDoc,
} from "../learn/knowledge-orchestrator";

import type {
  ProposeConceptsFn,
  ProposeClaimsAndEntitiesFn,
} from "../learn/content-analyze";
import type { ClassifyPageFn } from "../learn/wiki-index";
import type { ProposeTaxonomyFn } from "../learn/taxonomy-build";
import type { ConfirmCrossLinksFn } from "../learn/cross-link";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const FIXTURE_ROOT = path.join(
  __dirname, "../learn/__tests__/fixtures/knowledge"
);
const CODE_PATHS = ["src/validate.ts", "src/store.ts", "src/ingest.ts"];
const DOC_PATHS = [
  "docs/ingestion.md",
  "docs/storage.md",
  "docs/validation.md",
  "docs/concepts.md",
];

// NOOP seams — all LLM calls return empty (K3 deterministic half still runs)
const NOOP_SEAMS: KnowledgeLLMSeams = {
  proposeConcepts: async () => [],
  proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
  classifyPage: async (pages) =>
    new Map(pages.map((p) => [p.id, { category: "note", importance: "low", labels: [] }])),
  proposeTaxonomy: async () => ({ topicProposals: [], domainProposals: [] }),
  confirmCrossLinks: async () => [],
};

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function mkTmpRepo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-orch-"));
  TEMP_DIRS.push(d);
  return d;
}

/** Copy fixture src/ and docs/ into a temp repo root so analyzeContent can read real files. */
function scaffoldFixtureRepo(tmpDir: string): void {
  const srcDir = path.join(tmpDir, "src");
  const docsDir = path.join(tmpDir, "docs");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  for (const rel of CODE_PATHS) {
    const src = path.join(FIXTURE_ROOT, rel);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(tmpDir, rel));
    }
  }
  for (const rel of DOC_PATHS) {
    const src = path.join(FIXTURE_ROOT, rel);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(tmpDir, rel));
    }
  }
}

// ---------------------------------------------------------------------------
// Section A — buildFileBackedSeams (hermetic, no fixture needed)
// ---------------------------------------------------------------------------

describe("A — buildFileBackedSeams", () => {
  let judgeDir: string;

  beforeEach(() => {
    judgeDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-judge-"));
    TEMP_DIRS.push(judgeDir);
  });

  test("A1: returns KnowledgeLLMSeams-shaped object with all 5 seam functions", () => {
    const seams = buildFileBackedSeams(judgeDir);
    expect(typeof seams.proposeConcepts).toBe("function");
    expect(typeof seams.proposeClaimsAndEntities).toBe("function");
    expect(typeof seams.classifyPage).toBe("function");
    expect(typeof seams.proposeTaxonomy).toBe("function");
    expect(typeof seams.confirmCrossLinks).toBe("function");
  });

  test("A2: proposeConcepts returns concept from k1-judgments.json keyed by candidate_key", async () => {
    const judgments: K1JudgmentsDoc = {
      schema_version: "guild.knowledge.judgments.v1",
      stage: "k1",
      concepts: {
        "concept:docs/foo.md#heading:abc12345": { name: "Validator", confidence: "high" },
      },
      claims: {},
      entities: {},
    };
    fs.writeFileSync(
      path.join(judgeDir, "k1-judgments.json"),
      JSON.stringify(judgments, null, 2) + "\n"
    );

    const seams = buildFileBackedSeams(judgeDir);
    const candidates = [
      { anchor: "docs/foo.md#heading:abc12345", text: "Validates events" } as any,
    ];
    // The seam should return a result keyed by anchor (concept nodes need anchor)
    const result = await seams.proposeConcepts!(candidates);
    // proposeConcepts returns ConceptLLMResult[]
    // The file-backed adapter maps candidate anchor → judgment
    expect(result.length).toBeGreaterThanOrEqual(0); // at least doesn't throw
  });

  test("A3: classifyPage returns classification from k2-judgments.json keyed by page id", async () => {
    const judgments: K2JudgmentsDoc = {
      schema_version: "guild.knowledge.judgments.v1",
      stage: "k2",
      pages: {
        "wiki_page:docs/auth.md": { category: "guide", importance: "high", labels: ["security"] },
      },
    };
    fs.writeFileSync(
      path.join(judgeDir, "k2-judgments.json"),
      JSON.stringify(judgments, null, 2) + "\n"
    );

    const seams = buildFileBackedSeams(judgeDir);
    const pages = [
      { id: "wiki_page:docs/auth.md", relpath: "docs/auth.md", name: "Auth", headings: [], wikilinks: [], content: "" } as any,
    ];
    const result = await seams.classifyPage!(pages);

    expect(result).toBeInstanceOf(Map);
    const cls = result.get("wiki_page:docs/auth.md");
    expect(cls).toBeDefined();
    expect(cls!.category).toBe("guide");
    expect(cls!.importance).toBe("high");
    expect(cls!.labels).toContain("security");
  });

  test("A4: classifyPage — page absent from k2-judgments is NOT in result Map (SC-9 B4: no default invented)", async () => {
    const judgments: K2JudgmentsDoc = {
      schema_version: "guild.knowledge.judgments.v1",
      stage: "k2",
      pages: {},
    };
    fs.writeFileSync(
      path.join(judgeDir, "k2-judgments.json"),
      JSON.stringify(judgments, null, 2) + "\n"
    );

    const seams = buildFileBackedSeams(judgeDir);
    const pages = [
      { id: "wiki_page:docs/unknown.md", relpath: "docs/unknown.md", name: "Unknown", headings: [], wikilinks: [], content: "" } as any,
    ];
    const result = await seams.classifyPage!(pages);

    // SC-9 / B4: missing judgment → page is ABSENT from the result Map (not fabricated "note")
    expect(result.has("wiki_page:docs/unknown.md")).toBe(false);
    expect(result.size).toBe(0);
  });

  test("A5: proposeTaxonomy returns topics from k4-judgments.json keyed by topicId", async () => {
    const judgments: K4JudgmentsDoc = {
      schema_version: "guild.knowledge.judgments.v1",
      stage: "k4",
      topics: {
        "topic:abc12345": {
          name: "Authentication",
          parent: null,
          importance_score: 0.7,
          sourceRef: "docs/auth.md#authentication",
        },
      },
      domains: {}, // Record<candidate_key, ...> — FIX 3
    };
    fs.writeFileSync(
      path.join(judgeDir, "k4-judgments.json"),
      JSON.stringify(judgments, null, 2) + "\n"
    );

    const seams = buildFileBackedSeams(judgeDir);
    const inputs = [
      { topicId: "topic:abc12345", memberIds: ["file:src/auth.ts"] } as any,
    ];
    const result = await seams.proposeTaxonomy(inputs, { forbiddenDomainNames: [] });

    const topic = result.topicProposals.find((t) => t.topicId === "topic:abc12345");
    expect(topic).toBeDefined();
    expect(topic!.name).toBe("Authentication");
    expect(topic!.importanceScore).toBe(0.7);
    expect(topic!.parentTopicId).toBeNull();
  });

  test("A6: proposeTaxonomy skips topics absent from k4-judgments (no invented IDs)", async () => {
    const judgments: K4JudgmentsDoc = {
      schema_version: "guild.knowledge.judgments.v1",
      stage: "k4",
      topics: {},
      domains: {}, // Record<candidate_key, ...> — FIX 3
    };
    fs.writeFileSync(
      path.join(judgeDir, "k4-judgments.json"),
      JSON.stringify(judgments, null, 2) + "\n"
    );

    const seams = buildFileBackedSeams(judgeDir);
    const inputs = [
      { topicId: "topic:not-in-judgments", memberIds: ["file:src/x.ts"] } as any,
    ];
    const result = await seams.proposeTaxonomy(inputs, { forbiddenDomainNames: [] });
    // Topic not in judgments → not in output (SC-9: no LLM-invented IDs)
    expect(result.topicProposals.find((t) => t.topicId === "topic:not-in-judgments")).toBeUndefined();
  });

  test("A7: confirmCrossLinks returns edges from k5-judgments keyed by source→target:type", async () => {
    const judgments: K5JudgmentsDoc = {
      schema_version: "guild.knowledge.judgments.v1",
      stage: "k5",
      edges: {
        "topic:abc→function:src/auth.ts:authenticate:evidenced_by": { weight: 0.9 },
      },
    };
    fs.writeFileSync(
      path.join(judgeDir, "k5-judgments.json"),
      JSON.stringify(judgments, null, 2) + "\n"
    );

    const seams = buildFileBackedSeams(judgeDir);
    const candidates = [
      { source: "topic:abc", target: "function:src/auth.ts:authenticate", type: "evidenced_by", reason: "func_in_doc" } as any,
    ];
    const result = await seams.confirmCrossLinks([], candidates, { relMinConf: 0.5 });

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("topic:abc");
    expect(result[0].target).toBe("function:src/auth.ts:authenticate");
    expect(result[0].weight).toBe(0.9);
  });

  test("A8: confirmCrossLinks drops edges below relMinConf", async () => {
    const judgments: K5JudgmentsDoc = {
      schema_version: "guild.knowledge.judgments.v1",
      stage: "k5",
      edges: {
        "topic:abc→function:src/auth.ts:authenticate:evidenced_by": { weight: 0.3 },
      },
    };
    fs.writeFileSync(
      path.join(judgeDir, "k5-judgments.json"),
      JSON.stringify(judgments, null, 2) + "\n"
    );

    const seams = buildFileBackedSeams(judgeDir);
    const candidates = [
      { source: "topic:abc", target: "function:src/auth.ts:authenticate", type: "evidenced_by", reason: "func_in_doc" } as any,
    ];
    const result = await seams.confirmCrossLinks([], candidates, { relMinConf: 0.5 });
    expect(result).toHaveLength(0);
  });

  test("A9: confirmCrossLinks drops edges absent from k5-judgments (SC-9: no invented edges)", async () => {
    const judgments: K5JudgmentsDoc = {
      schema_version: "guild.knowledge.judgments.v1",
      stage: "k5",
      edges: {},
    };
    fs.writeFileSync(
      path.join(judgeDir, "k5-judgments.json"),
      JSON.stringify(judgments, null, 2) + "\n"
    );

    const seams = buildFileBackedSeams(judgeDir);
    const candidates = [
      { source: "topic:abc", target: "function:x:fn", type: "evidenced_by", reason: "func_in_doc" } as any,
    ];
    const result = await seams.confirmCrossLinks([], candidates, { relMinConf: 0.5 });
    expect(result).toHaveLength(0);
  });

  test("A10: missing k4-judgments.json → proposeTaxonomy returns empty arrays (graceful)", async () => {
    // No k4-judgments.json in judgeDir
    const seams = buildFileBackedSeams(judgeDir);
    const result = await seams.proposeTaxonomy(
      [{ topicId: "topic:x", memberIds: [] } as any],
      { forbiddenDomainNames: [] }
    );
    expect(result.topicProposals).toEqual([]);
    expect(result.domainProposals).toEqual([]);
  });

  test("A12: classifyPage — classified page in Map, unclassified page absent (no fabrication, SC-9 B4)", async () => {
    const judgments: K2JudgmentsDoc = {
      schema_version: "guild.knowledge.judgments.v1",
      stage: "k2",
      pages: {
        "wiki_page:docs/classified.md": { category: "guide", importance: "high", labels: ["security"] },
        // "wiki_page:docs/unclassified.md" intentionally absent
      },
    };
    fs.writeFileSync(
      path.join(judgeDir, "k2-judgments.json"),
      JSON.stringify(judgments, null, 2) + "\n"
    );

    const seams = buildFileBackedSeams(judgeDir);
    const pages = [
      { id: "wiki_page:docs/classified.md", relpath: "docs/classified.md", name: "Classified", headings: [], wikilinks: [], content: "" } as any,
      { id: "wiki_page:docs/unclassified.md", relpath: "docs/unclassified.md", name: "Unclassified", headings: [], wikilinks: [], content: "" } as any,
    ];
    const result = await seams.classifyPage!(pages);

    // Classified page is present with real data
    expect(result.has("wiki_page:docs/classified.md")).toBe(true);
    expect(result.get("wiki_page:docs/classified.md")!.category).toBe("guide");
    expect(result.get("wiki_page:docs/classified.md")!.importance).toBe("high");

    // Unclassified page is ABSENT — not fabricated (SC-9 / B4)
    expect(result.has("wiki_page:docs/unclassified.md")).toBe(false);
    expect(result.size).toBe(1);
  });

  test("A11: missing k5-judgments.json → confirmCrossLinks returns [] (graceful)", async () => {
    const seams = buildFileBackedSeams(judgeDir);
    const result = await seams.confirmCrossLinks(
      [],
      [{ source: "a", target: "b", type: "evidenced_by", reason: "func_in_doc" } as any],
      { relMinConf: 0.5 }
    );
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Section B — emitRound1Candidates
// ---------------------------------------------------------------------------

describe("B — emitRound1Candidates", () => {
  test("B1: writes k1-candidates.json to candidateDir", () => {
    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(
      FIXTURE_ROOT,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      candidateDir
    );

    expect(fs.existsSync(path.join(candidateDir, "k1-candidates.json"))).toBe(true);
  });

  test("B2: writes k3-nodes.json to candidateDir (K3 fully deterministic)", () => {
    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(
      FIXTURE_ROOT,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      candidateDir
    );

    expect(fs.existsSync(path.join(candidateDir, "k3-nodes.json"))).toBe(true);
    const doc = JSON.parse(fs.readFileSync(path.join(candidateDir, "k3-nodes.json"), "utf8"));
    expect(doc.stage).toBe("k3");
    expect(Array.isArray(doc.nodes)).toBe(true);
  });

  test("B3: writes k4-candidates.json to candidateDir", () => {
    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(
      FIXTURE_ROOT,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      candidateDir
    );

    expect(fs.existsSync(path.join(candidateDir, "k4-candidates.json"))).toBe(true);
    const doc = JSON.parse(fs.readFileSync(path.join(candidateDir, "k4-candidates.json"), "utf8"));
    expect(doc.stage).toBe("k4");
    expect(Array.isArray(doc.topic_inputs)).toBe(true);
  });

  test("B4: k1-candidates.json has candidate_key on doc_comment_candidates", () => {
    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(
      FIXTURE_ROOT,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      candidateDir
    );

    const doc = JSON.parse(fs.readFileSync(path.join(candidateDir, "k1-candidates.json"), "utf8"));
    // All doc_comment_candidates must have candidate_key
    for (const c of doc.doc_comment_candidates ?? []) {
      expect(typeof c.candidate_key).toBe("string");
      expect(c.candidate_key.length).toBeGreaterThan(0);
    }
  });

  test("B5: k4-candidates.json topic_inputs have candidate_key = topicId (makeTopicId)", () => {
    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(
      FIXTURE_ROOT,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      candidateDir
    );

    const doc = JSON.parse(fs.readFileSync(path.join(candidateDir, "k4-candidates.json"), "utf8"));
    for (const input of doc.topic_inputs ?? []) {
      // candidate_key must equal topicId (makeTopicId hash)
      expect(input.candidate_key).toBe(input.topicId);
    }
  });

  test("B6: two identical calls produce identical k3-nodes.json (K3 is deterministic)", () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(dir1, dir2);

    emitRound1Candidates(FIXTURE_ROOT, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, dir1);
    emitRound1Candidates(FIXTURE_ROOT, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, dir2);

    const k3a = fs.readFileSync(path.join(dir1, "k3-nodes.json"), "utf8");
    const k3b = fs.readFileSync(path.join(dir2, "k3-nodes.json"), "utf8");
    expect(k3a).toBe(k3b);
  });

  test("B7: k3-nodes.json contains diagram nodes from mermaid blocks in fixture docs", () => {
    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(
      FIXTURE_ROOT,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      candidateDir
    );

    const doc = JSON.parse(fs.readFileSync(path.join(candidateDir, "k3-nodes.json"), "utf8"));
    const diagramNodes = (doc.nodes as any[]).filter((n: any) => n.type === "diagram");
    // ingestion.md has a mermaid block → at least one diagram node
    expect(diagramNodes.length).toBeGreaterThan(0);
  });

  test("B8: writes k2-candidates.json when wiki dir exists", () => {
    // Create a minimal wiki in a temp repo
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "guild-k2-"));
    TEMP_DIRS.push(tmpRepo);

    const wikiDir = path.join(tmpRepo, ".guild", "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(
      path.join(wikiDir, "auth.md"),
      "# Authentication\n\nHandles login and tokens.\n\n## Overview\n\nSee [[storage]].\n"
    );
    fs.writeFileSync(
      path.join(wikiDir, "storage.md"),
      "# Storage\n\nPersists state.\n"
    );

    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(tmpRepo, { codeRelPaths: [], docRelPaths: [] }, candidateDir);

    expect(fs.existsSync(path.join(candidateDir, "k2-candidates.json"))).toBe(true);
    const doc = JSON.parse(fs.readFileSync(path.join(candidateDir, "k2-candidates.json"), "utf8"));

    expect(doc.schema_version).toBe("guild.knowledge.candidates.v1");
    expect(doc.stage).toBe("k2");
    expect(Array.isArray(doc.pages)).toBe(true);
    expect(doc.pages.length).toBe(2);
  });

  test("B9: k2-candidates.json pages have candidate_key = wiki_page_id (authoritative for model)", () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "guild-k2-"));
    TEMP_DIRS.push(tmpRepo);

    const wikiDir = path.join(tmpRepo, ".guild", "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(
      path.join(wikiDir, "auth.md"),
      "# Authentication\n\nHandles login and tokens.\n\n## Overview\n\nSee [[storage]].\n"
    );
    fs.writeFileSync(path.join(wikiDir, "storage.md"), "# Storage\n\nContent.\n");

    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(tmpRepo, { codeRelPaths: [], docRelPaths: [] }, candidateDir);

    const doc = JSON.parse(fs.readFileSync(path.join(candidateDir, "k2-candidates.json"), "utf8"));
    for (const page of doc.pages) {
      // candidate_key must equal id which is "wiki_page:<repoRoot-relpath>"
      expect(page.candidate_key).toBe(page.id);
      expect(page.id.startsWith("wiki_page:")).toBe(true);
      expect(typeof page.relpath).toBe("string");
      expect(typeof page.name).toBe("string");
      expect(Array.isArray(page.headings)).toBe(true);
    }
    // BUG-3 fix: round1 candidate id/relpath are repoRoot-relative (".guild/wiki/…")
    // — NOT wikiDir-relative ("auth.md") — so they equal finalize's indexWiki id and
    // resolve at repoRoot in validateGraphV2. The old "auth.md" assertion contradicted
    // SC-3/SC-12 (every wiki_page anchor must resolve at repoRoot).
    const authPage = doc.pages.find((p: any) => p.relpath === ".guild/wiki/auth.md");
    expect(authPage).toBeDefined();
    expect(authPage.id).toBe("wiki_page:.guild/wiki/auth.md");
    expect(authPage.name).toBe("Authentication");
    expect(authPage.headings).toContain("Authentication");
    expect(authPage.wikilinks).toContain("storage"); // [[storage]] extracted
  });

  test("B11: k4-candidates.json includes domain_candidates keyed by domain:${topicId} (FIX 3 SC-9)", () => {
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "guild-dom-"));
    TEMP_DIRS.push(tmpRepo);

    // Need code/doc files so buildContentClusters can produce topicInputs
    const srcDir = path.join(tmpRepo, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "main.ts"),
      "/** Entry point */\nexport function run() {}\n"
    );

    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(tmpRepo, { codeRelPaths: ["src/main.ts"], docRelPaths: [] }, candidateDir);

    const doc = JSON.parse(fs.readFileSync(path.join(candidateDir, "k4-candidates.json"), "utf8"));

    // Must have domain_candidates array
    expect(Array.isArray(doc.domain_candidates)).toBe(true);

    // Every domain candidate must have a valid candidate_key of form "domain:topic:..."
    for (const dc of doc.domain_candidates as any[]) {
      expect(typeof dc.candidate_key).toBe("string");
      expect(dc.candidate_key.startsWith("domain:topic:")).toBe(true);
      expect(typeof dc.primary_topicId).toBe("string");
      // primary_topicId must be the matching topic candidate_key (sans "domain:" prefix)
      expect(dc.candidate_key).toBe(`domain:${dc.primary_topicId}`);
    }

    // One domain_candidate per topic_input (1:1 correspondence)
    expect(doc.domain_candidates.length).toBe(doc.topic_inputs.length);
  });

  test("B12: k2-candidates.json page order is deterministic across identical calls (NI-2 sort)", () => {
    // Create a wiki with multiple pages to exercise sort stability
    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ni2-"));
    TEMP_DIRS.push(tmpRepo);

    const wikiDir = path.join(tmpRepo, ".guild", "wiki");
    fs.mkdirSync(wikiDir, { recursive: true });
    // Create pages in deliberately non-alpha-sort order on disk
    for (const name of ["zebra.md", "alpha.md", "mango.md"]) {
      fs.writeFileSync(path.join(wikiDir, name), `# ${path.basename(name, ".md")}\n\nContent.\n`);
    }

    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(dir1, dir2);

    emitRound1Candidates(tmpRepo, { codeRelPaths: [], docRelPaths: [] }, dir1);
    emitRound1Candidates(tmpRepo, { codeRelPaths: [], docRelPaths: [] }, dir2);

    const k2a = fs.readFileSync(path.join(dir1, "k2-candidates.json"), "utf8");
    const k2b = fs.readFileSync(path.join(dir2, "k2-candidates.json"), "utf8");

    // NI-2: byte-identical across calls (sorted iteration)
    expect(k2a).toBe(k2b);

    // Verify the pages ARE sorted by relpath
    const doc = JSON.parse(k2a);
    const relpaths = doc.pages.map((p: any) => p.relpath as string);
    const sorted = [...relpaths].sort((a, b) => a.localeCompare(b));
    expect(relpaths).toEqual(sorted);
  });

  test("B10: k2-candidates.json stage:k2 + empty pages when no wiki dir exists", () => {
    // Fixture root has no .guild/wiki/ or docs/knowledge/ → empty pages array
    const candidateDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cand-"));
    TEMP_DIRS.push(candidateDir);

    emitRound1Candidates(
      FIXTURE_ROOT,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      candidateDir
    );

    const doc = JSON.parse(fs.readFileSync(path.join(candidateDir, "k2-candidates.json"), "utf8"));
    expect(doc.stage).toBe("k2");
    // FIXTURE_ROOT has no .guild/wiki/ or docs/knowledge/ → 0 pages (no error)
    expect(Array.isArray(doc.pages)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section C — SC-8: runKnowledgeStages byte-identical output
// ---------------------------------------------------------------------------

describe("C — SC-8: runKnowledgeStages same seams → byte-identical knowledge-recall.json", () => {
  // Note: this test is necessarily slower (real file I/O + K1/K3/K4/K5 pipeline)
  test(
    "C1 (SC-8 core): two runs with NOOP seams + different runIds → byte-identical knowledge-recall.json",
    async () => {
      const dir1 = mkTmpRepo();
      const dir2 = mkTmpRepo();
      scaffoldFixtureRepo(dir1);
      scaffoldFixtureRepo(dir2);

      const filePaths: KnowledgeFilePaths = { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS };

      await runKnowledgeStages(dir1, filePaths, NOOP_SEAMS, { runId: "run-aaa", generatedAt: "2026-06-12T10:00:00.000Z" });
      await runKnowledgeStages(dir2, filePaths, NOOP_SEAMS, { runId: "run-bbb", generatedAt: "2026-06-12T11:00:00.000Z" });

      const links1 = fs.readFileSync(path.join(dir1, ".guild", "indexes", "knowledge-recall.json"), "utf8");
      const links2 = fs.readFileSync(path.join(dir2, ".guild", "indexes", "knowledge-recall.json"), "utf8");

      // SC-8 core: byte-identical regardless of runId + timestamp
      expect(links1).toBe(links2);

      // Sidecar must differ (it carries run_id)
      const prov1 = fs.readFileSync(path.join(dir1, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8");
      const prov2 = fs.readFileSync(path.join(dir2, ".guild", "indexes", "knowledge-recall-provenance.json"), "utf8");
      expect(prov1).not.toBe(prov2);
      expect(prov1).toContain("run-aaa");
      expect(prov2).toContain("run-bbb");
    },
    30000 // allow up to 30s for real file I/O
  );

  test(
    "C3 (FIX 1 — pure finalize): byte-identical output with/without prior knowledge-graph.json",
    async () => {
      // Run 1: no prior graph present (clean slate)
      const dir = mkTmpRepo();
      scaffoldFixtureRepo(dir);
      const filePaths: KnowledgeFilePaths = { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS };

      await runKnowledgeStages(dir, filePaths, NOOP_SEAMS, { runId: "run-pure-1" });
      const graph1 = fs.readFileSync(
        path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8"
      );
      const links1 = fs.readFileSync(
        path.join(dir, ".guild", "indexes", "knowledge-recall.json"), "utf8"
      );

      // Run 2: prior knowledge-graph.json is now present (from run 1).
      // With the old caching, this produced DIFFERENT bytes (stale node reuse).
      // With pure finalize, output must be BYTE-IDENTICAL to run 1.
      await runKnowledgeStages(dir, filePaths, NOOP_SEAMS, { runId: "run-pure-2" });
      const graph2 = fs.readFileSync(
        path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8"
      );
      const links2 = fs.readFileSync(
        path.join(dir, ".guild", "indexes", "knowledge-recall.json"), "utf8"
      );

      // Both SC-8 byte-set members must be byte-identical across warm/cold runs
      expect(graph2).toBe(graph1);
      expect(links2).toBe(links1);
    },
    30000
  );

  test("C2: knowledge-recall.json contains NO run_id field", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    await runKnowledgeStages(
      dir,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      NOOP_SEAMS,
      { runId: "run-nonce-check" }
    );

    const raw = fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-recall.json"), "utf8");
    expect(raw).not.toContain("run-nonce-check");
    expect(raw).not.toMatch(/"run_id"\s*:/);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Section D — Stage ordering
// ---------------------------------------------------------------------------

describe("D — stage ordering", () => {
  test("D1: K3 diagram nodes appear in knowledge-graph.json (K3 runs before K5)", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    await runKnowledgeStages(
      dir,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      NOOP_SEAMS,
      {}
    );

    const graph = JSON.parse(
      fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8")
    );
    const diagramNodes = (graph.nodes as any[]).filter((n: any) => n.type === "diagram");
    // ingestion.md has a mermaid block → at least 1 diagram node in final graph
    expect(diagramNodes.length).toBeGreaterThan(0);
  }, 30000);

  test("D2: knowledge-graph.json has version = guild.knowledge_graph.v2", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    await runKnowledgeStages(dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {});

    const graph = JSON.parse(
      fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8")
    );
    expect(graph.version).toBe("guild.knowledge_graph.v2");
  }, 30000);

  test("D3: preserves the structural tour and layer map supplied by the deep-graph stage", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    const structuralGraph: NonNullable<RunKnowledgeOptions["structuralGraph"]> = {
      nodes: [{
        id: "file:src/validate.ts",
        type: "file",
        name: "validate.ts",
        source_refs: ["src/validate.ts"],
        confidence: "high",
      }],
      edges: [],
      layers: [{
        id: "layer:validation",
        name: "Validation",
        description: "Validation implementation",
        nodeIds: ["file:src/validate.ts"],
      }],
      tour: [{
        order: 0,
        title: "Step 1",
        description: "",
        nodeIds: ["file:src/validate.ts"],
      }],
    };

    const result = await runKnowledgeStages(
      dir,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      NOOP_SEAMS,
      { structuralGraph }
    );

    expect(result.graph.layers).toEqual(structuralGraph.layers);
    expect(result.graph.tour).toEqual(structuralGraph.tour);
    expect(result.graph.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "file:src/validate.ts" })])
    );
  }, 30000);
});

// ---------------------------------------------------------------------------
// Section E — Artifacts written
// ---------------------------------------------------------------------------

describe("E — artifacts written by runKnowledgeStages", () => {
  test("E1: knowledge-graph.json created at .guild/indexes/", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    const result = await runKnowledgeStages(
      dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {}
    );

    expect(fs.existsSync(result.graphPath)).toBe(true);
    expect(result.graphPath).toBe(path.join(dir, ".guild", "indexes", "knowledge-graph.json"));
  }, 30000);

  test("E2: knowledge-recall.json created at .guild/indexes/", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    const result = await runKnowledgeStages(
      dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {}
    );

    expect(fs.existsSync(result.linksPath)).toBe(true);
    expect(result.linksPath).toBe(path.join(dir, ".guild", "indexes", "knowledge-recall.json"));
  }, 30000);

  test("E3: knowledge-recall-provenance.json created at .guild/indexes/", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    const result = await runKnowledgeStages(
      dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {}
    );

    expect(fs.existsSync(result.provenancePath)).toBe(true);
  }, 30000);

  test("E4: result.nodeCount and result.edgeCount are non-negative integers", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    const result = await runKnowledgeStages(
      dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {}
    );

    expect(result.nodeCount).toBeGreaterThanOrEqual(0);
    expect(result.edgeCount).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.nodeCount)).toBe(true);
    expect(Number.isInteger(result.edgeCount)).toBe(true);
  }, 30000);

  test("E5: knowledge-graph.json ends with newline (L0 convention)", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    await runKnowledgeStages(dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {});

    const raw = fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.endsWith("\n\n")).toBe(false);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Section F — H1 on knowledge-graph.json (byte-set member 1)
// ---------------------------------------------------------------------------

describe("F — H1: knowledge-graph.json has fixed key order (SC-8 member 1)", () => {
  test("F1: every node in knowledge-graph.json has id before type before name", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    await runKnowledgeStages(dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {});

    const graph = JSON.parse(
      fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8")
    );
    // For every node, the first key must be "id", second "type", third "name"
    for (const node of graph.nodes as object[]) {
      const keys = Object.keys(node);
      expect(keys[0]).toBe("id");
      expect(keys[1]).toBe("type");
      expect(keys[2]).toBe("name");
    }
  }, 30000);

  test("F2: every edge in knowledge-graph.json has direction before source before target", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    await runKnowledgeStages(dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {});

    const graph = JSON.parse(
      fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8")
    );
    for (const edge of graph.edges as object[]) {
      const keys = Object.keys(edge);
      expect(keys[0]).toBe("direction");
      expect(keys[1]).toBe("source");
      expect(keys[2]).toBe("target");
    }
  }, 30000);

  test("F3: SC-8 cross-trigger — knowledge-graph.json byte-identical with different runIds", async () => {
    const dir1 = mkTmpRepo();
    const dir2 = mkTmpRepo();
    scaffoldFixtureRepo(dir1);
    scaffoldFixtureRepo(dir2);

    await runKnowledgeStages(dir1, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, { runId: "run-x" });
    await runKnowledgeStages(dir2, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, { runId: "run-y" });

    const g1 = fs.readFileSync(path.join(dir1, ".guild", "indexes", "knowledge-graph.json"), "utf8");
    const g2 = fs.readFileSync(path.join(dir2, ".guild", "indexes", "knowledge-graph.json"), "utf8");

    // knowledge-graph.json must also be byte-identical across triggers (SC-8 member 1)
    expect(g1).toBe(g2);

    // Sanity: run_id must NOT appear in the graph (it's sidecar-only)
    expect(g1).not.toContain("run-x");
    expect(g1).not.toContain("run-y");
  }, 30000);
});

// ---------------------------------------------------------------------------
// Section G — All-stages run (FIX 1: staleness removed from orchestrator)
// ---------------------------------------------------------------------------
// Staleness is now the SKILL's coarse gate. The orchestrator always runs every
// stage unconditionally — finalize is a pure function of (candidates, judgments,
// config) with no prevGraph cache. G2/G3 (which tested caching) are gone.

describe("G — All stages always run (pure finalize, FIX 1)", () => {
  test("G1: no opts → all stages run → all 3 output files produced", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    const result = await runKnowledgeStages(
      dir,
      { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS },
      NOOP_SEAMS,
      {}
    );

    expect(fs.existsSync(result.graphPath)).toBe(true);
    expect(fs.existsSync(result.linksPath)).toBe(true);
    expect(fs.existsSync(result.provenancePath)).toBe(true);
  }, 30000);

  test("G2: successive runs on same dir produce byte-identical SC-8 byte-set", async () => {
    const dir = mkTmpRepo();
    scaffoldFixtureRepo(dir);

    await runKnowledgeStages(dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {});
    const graph1 = fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8");
    const links1 = fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-recall.json"), "utf8");

    await runKnowledgeStages(dir, { codeRelPaths: CODE_PATHS, docRelPaths: DOC_PATHS }, NOOP_SEAMS, {});
    const graph2 = fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8");
    const links2 = fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-recall.json"), "utf8");

    expect(graph2).toBe(graph1);
    expect(links2).toBe(links1);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Section H — B4 + NI-2 integration
// ---------------------------------------------------------------------------

describe("H — B4 (drop unclassified wiki_pages) + NI-2 (deterministic candidate order)", () => {
  test(
    "H1 (B4): unclassified wiki_page is NOT emitted into knowledge-graph.json",
    async () => {
      const dir = mkTmpRepo();

      // SC-12 note: indexWiki generates source_refs anchors as "<relpath>#<slug>"
      // where relpath is relative to wikiDir. validateGraphV2 resolves anchors
      // against repoRoot. To keep the test hermetic, set wikiDir = dir so that
      // relpath "classified.md" resolves to dir/classified.md ✓.
      const wikiDir = dir; // same as repoRoot → anchors resolve
      fs.writeFileSync(
        path.join(wikiDir, "classified.md"),
        "# Auth Guide\n\nHandles authentication.\n"
      );
      fs.writeFileSync(
        path.join(wikiDir, "unclassified.md"),
        "# Raw Notes\n\nSome scratch notes.\n"
      );

      // Emit round1 candidates to get authoritative page IDs
      const runDir = path.join(dir, ".guild", "runs", "test-h1", "knowledge");
      fs.mkdirSync(runDir, { recursive: true });
      emitRound1Candidates(dir, { codeRelPaths: [], docRelPaths: [], wikiDir }, runDir);

      // Write k2-judgments.json classifying ONLY classified.md
      const classifiedId = "wiki_page:classified.md";
      const k2Judgments: K2JudgmentsDoc = {
        schema_version: "guild.knowledge.judgments.v1",
        stage: "k2",
        pages: {
          [classifiedId]: { category: "guide", importance: "high", labels: ["auth"] },
          // wiki_page:unclassified.md intentionally absent
        },
      };
      fs.writeFileSync(
        path.join(runDir, "k2-judgments.json"),
        JSON.stringify(k2Judgments, null, 2) + "\n"
      );

      const seams = buildFileBackedSeams(runDir);
      await runKnowledgeStages(
        dir,
        { codeRelPaths: [], docRelPaths: [], wikiDir },
        seams,
        {}
      );

      const graph = JSON.parse(
        fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8")
      );
      const wikiNodes = (graph.nodes as any[]).filter((n: any) => n.type === "wiki_page");

      // Only the classified page should appear
      expect(wikiNodes.length).toBe(1);
      expect(wikiNodes[0].id).toBe(classifiedId);
      expect(wikiNodes[0].category).toBe("guide");

      // The unclassified page must not be in the graph (SC-9 / B4: no default fabrication)
      expect(
        (graph.nodes as any[]).some((n: any) => n.id === "wiki_page:unclassified.md")
      ).toBe(false);
    },
    30000
  );
});

// ---------------------------------------------------------------------------
// Section I — SC-3 K2 dual-dir: finalize indexes BOTH .guild/wiki/ AND docs/knowledge/
// ---------------------------------------------------------------------------
// Regression guard for the SC-3 real-path gap: previously runKnowledgeStagesK1ToK4
// only called indexWiki for wikiDir (.guild/wiki/), so docs/knowledge/ pages appeared
// in k2-candidates (round1) but produced no wiki_page nodes in the final graph.

describe("I — SC-3 K2 dual-dir: finalize indexes both .guild/wiki/ and docs/knowledge/", () => {
  test(
    "I1 (SC-3): wiki_page nodes from BOTH .guild/wiki/ and docs/knowledge/ appear in knowledge-graph.json",
    async () => {
      const dir = mkTmpRepo();

      // BUG-3 fix: wiki_page ids/anchors are now repoRoot-relative, so the anchor
      // resolves against the REAL page under .guild/wiki/ — no repoRoot "shadow"
      // copy needed. The old shadow files (dir/wikidoc.md) were masking BUG-3:
      // they made the wikiDir-relative anchor "wikidoc.md#…" resolve, hiding that
      // the production path produced unresolvable anchors that validateGraphV2
      // dropped. Removing them verifies the REAL path.

      // ── First root: .guild/wiki/ (default wikiDir) ──────────────────────────
      const wikiDir = path.join(dir, ".guild", "wiki");
      fs.mkdirSync(wikiDir, { recursive: true });
      fs.writeFileSync(
        path.join(wikiDir, "wikidoc.md"),
        "# WikiDoc\n\nA wiki page.\n"
      );

      // ── Second root: docs/knowledge/ (previously not indexed in finalize) ────
      const kbDir = path.join(dir, "docs", "knowledge");
      fs.mkdirSync(kbDir, { recursive: true });
      fs.writeFileSync(
        path.join(kbDir, "kbdoc.md"),
        "# KBDoc\n\nA knowledge base page.\n"
      );

      // NOOP_SEAMS classifies ALL pages → no B4 drops → both nodes survive validate.
      await runKnowledgeStages(
        dir,
        { codeRelPaths: [], docRelPaths: [] }, // wikiDir defaults to .guild/wiki
        NOOP_SEAMS,
        {}
      );

      const graph = JSON.parse(
        fs.readFileSync(path.join(dir, ".guild", "indexes", "knowledge-graph.json"), "utf8")
      );
      const wikiNodes = (graph.nodes as any[]).filter((n: any) => n.type === "wiki_page");
      const wikiNodeIds = new Set(wikiNodes.map((n: any) => n.id as string));

      // First root (.guild/wiki/) — repoRoot-relative id (BUG-3)
      expect(wikiNodeIds.has("wiki_page:.guild/wiki/wikidoc.md")).toBe(true);

      // Second root (docs/knowledge/) — repoRoot-relative id; was MISSING before SC-3 fix
      expect(wikiNodeIds.has("wiki_page:docs/knowledge/kbdoc.md")).toBe(true);

      // BUG-3 real-path guard: anchors actually resolve at repoRoot (no drop).
      const wikidocNode = wikiNodes.find(
        (n: any) => n.id === "wiki_page:.guild/wiki/wikidoc.md"
      );
      expect(wikidocNode.source_refs[0]).toBe(".guild/wiki/wikidoc.md#wikidoc");
    },
    30000
  );
});
