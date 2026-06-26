/**
 * scripts/__tests__/knowledge-realpath-bugs.test.ts
 *
 * L13 — red-first regression tests for the 3 REAL-PATH bugs the L12 integration
 * gate found in the v2 knowledge tier. On the real plugin corpus the production
 * path produced a DEGENERATE graph (826 nodes = claim+entity only, all edges
 * claim→claim, ZERO topic/domain/subtopic_of/wiki_page/diagram). All 3 bugs live
 * in scripts/learn/ and were masked by injected-seam / shadow-file fixtures.
 *
 * Each test FAILS on the pre-fix code and PASSES after the fix (verified by
 * git-stashing the two source files and running this suite — see handoff).
 *
 *   BUG-1 — discoverFilePaths is code-blind + svg-blind (hardcoded src/lib/docs).
 *   BUG-2 — round1/finalize wiki page-discovery divergence (index.md-BFS gate
 *           dropped pages in finalize that round1 classified).
 *   BUG-3 — wiki_page id + anchor base mismatch (wikiDir-relative → unresolvable
 *           at repoRoot → every wiki_page node dropped by validateGraphV2).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  discoverFilePaths,
  emitRound1Candidates,
  runKnowledgeStages,
  type KnowledgeLLMSeams,
} from "../learn/knowledge-orchestrator";
import { indexWiki, type ClassifyPageFn } from "../learn/wiki-index";
import { resolveAnchor } from "../learn/lib/schema";

// ---------------------------------------------------------------------------
// Temp repo lifecycle
// ---------------------------------------------------------------------------

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
function mkTmpRepo(prefix = "guild-realpath-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
}
function write(repo: string, rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** Classifier that labels every page (no B4 drops). */
const classifyAll: ClassifyPageFn = async (pages) =>
  new Map(pages.map((p) => [p.id, { category: "note", importance: "low", labels: [] }]));

// ---------------------------------------------------------------------------
// BUG-1 — discoverFilePaths must discover code/svg GENERICALLY, not just src/lib
// ---------------------------------------------------------------------------

describe("BUG-1 — discoverFilePaths is generic (code-blind + svg-blind fix)", () => {
  function scaffoldGenericRepo(): string {
    const repo = mkTmpRepo("guild-discover-");
    // Code lives under non-src dirs — exactly Guild's own layout.
    write(repo, "scripts/foo.ts", "/** Foo */\nexport function foo() { return 1; }\n");
    write(repo, "hooks/bar.js", "export function bar() {}\n");
    write(repo, "mcp-servers/srv/index.mjs", "export const srv = () => {};\n");
    write(repo, "src/legacy.ts", "export function legacy() {}\n");
    // Excluded: test files, hidden/excluded dirs.
    write(repo, "scripts/foo.test.ts", "test('x', () => {});\n");
    write(repo, "node_modules/dep/junk.ts", "export const junk = 1;\n");
    write(repo, ".guild/indexes/self.ts", "export const self = 1;\n");
    write(repo, "dist/built.js", "export const built = 1;\n");
    // Docs + svg + wiki.
    write(repo, "docs/guide.md", "# Guide\n\nProse.\n");
    write(repo, "diagrams/arch.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>Arch</title></svg>\n');
    write(repo, ".guild/wiki/index.md", "# Index\n");
    return repo;
  }

  test("discovers code under scripts/, hooks/, mcp-servers/ (not just src/lib)", () => {
    const repo = scaffoldGenericRepo();
    const fp = discoverFilePaths(repo);
    expect(fp.codeRelPaths).toContain("scripts/foo.ts");
    expect(fp.codeRelPaths).toContain("hooks/bar.js");
    expect(fp.codeRelPaths).toContain("mcp-servers/srv/index.mjs");
    expect(fp.codeRelPaths).toContain("src/legacy.ts");
  });

  test("excludes .test files, node_modules, .guild, dist", () => {
    const repo = scaffoldGenericRepo();
    const fp = discoverFilePaths(repo);
    expect(fp.codeRelPaths).not.toContain("scripts/foo.test.ts");
    expect(fp.codeRelPaths.some((p) => p.includes("node_modules"))).toBe(false);
    expect(fp.codeRelPaths.some((p) => p.startsWith(".guild"))).toBe(false);
    expect(fp.codeRelPaths.some((p) => p.startsWith("dist"))).toBe(false);
  });

  test("returns svgRelPaths (was never populated pre-fix)", () => {
    const repo = scaffoldGenericRepo();
    const fp = discoverFilePaths(repo);
    expect(fp.svgRelPaths).toBeDefined();
    expect(fp.svgRelPaths).toContain("diagrams/arch.svg");
  });

  test("docRelPaths covers .md but excludes the wiki (.guild) — wiki is indexed via wikiDir", () => {
    const repo = scaffoldGenericRepo();
    const fp = discoverFilePaths(repo);
    expect(fp.docRelPaths).toContain("docs/guide.md");
    expect(fp.docRelPaths.some((p) => p.startsWith(".guild"))).toBe(false);
  });

  test("returns wikiDir default <repoRoot>/.guild/wiki", () => {
    const repo = scaffoldGenericRepo();
    const fp = discoverFilePaths(repo);
    expect(fp.wikiDir).toBe(path.join(repo, ".guild", "wiki"));
  });

  test("all discovered lists are sorted (SC-8/SC-9 determinism)", () => {
    const repo = scaffoldGenericRepo();
    const fp = discoverFilePaths(repo);
    expect(fp.codeRelPaths).toEqual([...fp.codeRelPaths].sort());
    expect(fp.docRelPaths).toEqual([...fp.docRelPaths].sort());
    expect(fp.svgRelPaths).toEqual([...(fp.svgRelPaths ?? [])].sort());
  });

  test("code under scripts/ flows into K1 clusters → non-empty K4 topic_inputs", () => {
    // End-to-end BUG-1: pre-fix discovery found 0 code → 0 clusters → 0 topics.
    const repo = mkTmpRepo("guild-topicflow-");
    // Two files cross-mentioned in a doc → a content cluster (>=2 members).
    write(repo, "scripts/ingest.ts", "/** Ingest */\nexport function ingestEvent() {}\n");
    write(repo, "scripts/store.ts", "/** Store */\nexport function storeEvent() {}\n");
    write(repo, "docs/flow.md", "# Flow\n\nThe ingestEvent path calls storeEvent downstream.\n");
    const fp = discoverFilePaths(repo);
    const candidateDir = path.join(repo, ".guild", "runs", "t", "knowledge");
    emitRound1Candidates(repo, fp, candidateDir);
    const k4 = JSON.parse(fs.readFileSync(path.join(candidateDir, "k4-candidates.json"), "utf8"));
    expect(Array.isArray(k4.topic_inputs)).toBe(true);
    expect(k4.topic_inputs.length).toBeGreaterThan(0);
  });

  test("svg discovered → K3 emits a diagram node in the finalized graph", async () => {
    const repo = mkTmpRepo("guild-svgnode-");
    write(repo, "scripts/x.ts", "/** X */\nexport function x() {}\n");
    write(repo, "diagrams/arch.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>Arch</title><text>Box</text></svg>\n');
    const fp = discoverFilePaths(repo);
    const NOOP: KnowledgeLLMSeams = {
      proposeConcepts: async () => [],
      proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
      classifyPage: classifyAll,
      proposeTaxonomy: async () => ({ topicProposals: [], domainProposals: [] }),
      confirmCrossLinks: async () => [],
    };
    const result = await runKnowledgeStages(repo, fp, NOOP, {});
    const diagramNodes = result.graph.nodes.filter((n) => n.type === "diagram");
    expect(diagramNodes.length).toBeGreaterThan(0);
    expect(diagramNodes.some((n) => n.source_refs[0] === "diagrams/arch.svg#svg")).toBe(true);
  }, 30000);
});

// ---------------------------------------------------------------------------
// BUG-2 — orphan wiki pages (not [[wikilinked]] from index.md) must still index
// ---------------------------------------------------------------------------

describe("BUG-2 — every .md page indexed, even if index.md does not link it", () => {
  test("indexWiki indexes an orphan page not reachable from index.md", async () => {
    const repo = mkTmpRepo("guild-orphan-");
    const wikiDir = path.join(repo, ".guild", "wiki");
    // index.md links ONLY [[linked]] — orphan.md is unreachable by BFS.
    write(repo, ".guild/wiki/index.md", "# Index\n\nSee [[linked]].\n");
    write(repo, ".guild/wiki/linked.md", "# Linked\n\nReachable page.\n");
    write(repo, ".guild/wiki/orphan.md", "# Orphan\n\nNot linked from index.\n");

    const { nodes } = await indexWiki(wikiDir, { repoRoot: repo, classifier: classifyAll });
    const ids = new Set(nodes.map((n) => n.id));
    // Pre-fix: collectViaIndex BFS dropped orphan.md → 2 nodes. Fixed: all 3.
    expect(nodes.filter((n) => n.type === "wiki_page").length).toBe(3);
    expect(ids.has("wiki_page:.guild/wiki/orphan.md")).toBe(true);
  });

  test("round1 candidate page-set == finalize page-set (no drift)", async () => {
    const repo = mkTmpRepo("guild-nodrift-");
    const wikiDir = path.join(repo, ".guild", "wiki");
    write(repo, ".guild/wiki/index.md", "# Index\n\nSee [[a]].\n");
    write(repo, ".guild/wiki/a.md", "# A\n");
    write(repo, ".guild/wiki/b.md", "# B (orphan)\n");

    // round1 candidate ids
    const candDir = path.join(repo, ".guild", "runs", "t", "knowledge");
    emitRound1Candidates(repo, { codeRelPaths: [], docRelPaths: [], wikiDir }, candDir);
    const k2 = JSON.parse(fs.readFileSync(path.join(candDir, "k2-candidates.json"), "utf8"));
    const round1Ids = new Set<string>(k2.pages.map((p: any) => p.id));

    // finalize ids
    const { nodes } = await indexWiki(wikiDir, { repoRoot: repo, classifier: classifyAll });
    const finalizeIds = new Set(nodes.filter((n) => n.type === "wiki_page").map((n) => n.id));

    expect(finalizeIds).toEqual(round1Ids);
    expect(round1Ids.has("wiki_page:.guild/wiki/b.md")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG-3 — wiki_page ids/anchors are repoRoot-relative and resolve at repoRoot
// ---------------------------------------------------------------------------

describe("BUG-3 — wiki_page anchors resolve at repoRoot (no unresolvable-drop)", () => {
  test("ids are repoRoot-relative and every source_ref resolves via resolveAnchor", async () => {
    const repo = mkTmpRepo("guild-anchor-");
    const wikiDir = path.join(repo, ".guild", "wiki");
    write(repo, ".guild/wiki/index.md", "# Event Pipeline Knowledge Base\n");

    const { nodes } = await indexWiki(wikiDir, { repoRoot: repo, classifier: classifyAll });
    const page = nodes.find((n) => n.id === "wiki_page:.guild/wiki/index.md");
    expect(page).toBeDefined();
    // Anchor is repoRoot-relative — NOT wikiDir-relative "index.md#…".
    expect(page!.source_refs[0]).toBe(".guild/wiki/index.md#event-pipeline-knowledge-base");
    // The anchor actually resolves at repoRoot (the production validate check).
    expect(resolveAnchor(repo, page!.source_refs[0])).toBe(true);
  });

  test("two roots both with index.md do NOT collide on id", async () => {
    const repo = mkTmpRepo("guild-collide-");
    write(repo, ".guild/wiki/index.md", "# Wiki Index\n");
    write(repo, "docs/knowledge/index.md", "# KB Index\n");

    const wiki = await indexWiki(path.join(repo, ".guild", "wiki"), { repoRoot: repo, classifier: classifyAll });
    const kb = await indexWiki(path.join(repo, "docs", "knowledge"), { repoRoot: repo, classifier: classifyAll });
    const wikiId = wiki.nodes[0].id;
    const kbId = kb.nodes[0].id;
    expect(wikiId).toBe("wiki_page:.guild/wiki/index.md");
    expect(kbId).toBe("wiki_page:docs/knowledge/index.md");
    expect(wikiId).not.toBe(kbId);
  });
});
