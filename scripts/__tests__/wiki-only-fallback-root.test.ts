/**
 * scripts/__tests__/wiki-only-fallback-root.test.ts
 *
 * L20 — SC-3 unconditional: EVERY wiki_page must have ≥1 topic-membership edge,
 * even for a topic-less corpus (wiki/docs pages but no code → K4 emits 0 topics).
 *
 * Codex BLOCKER 1 (rereview-L17-L18-L19): a wiki-only corpus →
 *   `topics:0, wikis:1, wikiTopicEdges:0, orphan:true`, and validateGraphV2
 *   returned `success:true` — the orphan passed silently.
 *
 * Fix under test: when the assembled graph has ≥1 wiki_page but 0 topic nodes,
 * the orchestrator synthesizes ONE deterministic fallback root `topic`
 * ("Project Knowledge") and links EVERY wiki_page to it via `evidenced_by`
 * (topic→wiki_page), unconditionally. A normal multi-topic corpus synthesizes
 * NO root (Rule 6's topics>0 path is untouched).
 *
 * RED-first: the AFTER assertions (root present, 0 orphans, sc3 flag empty) fail
 * before the synthesis exists. The BEFORE probe (cross-link layer alone orphans a
 * wiki-only corpus) stays true — the fix lives ABOVE cross-link in the orchestrator.
 *
 * Usage: ./node_modules/.bin/jest --no-coverage wiki-only-fallback-root
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  runKnowledgeStages,
  maybeSynthesizeFallbackRootTopic,
  deriveFallbackRootTopicName,
  FALLBACK_ROOT_TOPIC_SEED,
  FALLBACK_ROOT_TOPIC_NAME,
  type KnowledgeLLMSeams,
} from "../understand/knowledge-orchestrator";
import {
  makeTopicId,
  makeWikiPageId,
  type GraphNode,
} from "../understand/lib/schema";
import { proposeCandidates } from "../understand/cross-link";

// ---------------------------------------------------------------------------
const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
function mkTmpRepo(prefix = "guild-wikionly-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
}
function write(repo: string, rel: string, body: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

/** Classify every page so none is dropped (B4) — keeps the focus on SC-3. */
const SEAMS: KnowledgeLLMSeams = {
  proposeConcepts: async () => [],
  proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
  classifyPage: async (pages) =>
    new Map(pages.map((p) => [p.id, { category: "note", importance: "low", labels: [] }])),
  // Topic-less corpus: K4 produces 0 topics (no code clusters).
  proposeTaxonomy: async () => ({ topicProposals: [], domainProposals: [] }),
  confirmCrossLinks: async () => [],
};

const ROOT_TOPIC_ID = makeTopicId([FALLBACK_ROOT_TOPIC_SEED]);

function topicMembership(graph: { nodes: GraphNode[]; edges: any[] }): {
  topics: GraphNode[];
  wikis: GraphNode[];
  orphans: string[];
} {
  const topicIds = new Set(graph.nodes.filter((n) => n.type === "topic").map((n) => n.id));
  const wikis = graph.nodes.filter((n) => n.type === "wiki_page");
  const covered = new Set<string>();
  for (const e of graph.edges) {
    if (e.type === "evidenced_by" && topicIds.has(e.source) && String(e.target).startsWith("wiki_page:")) {
      covered.add(e.target);
    }
  }
  return {
    topics: graph.nodes.filter((n) => n.type === "topic"),
    wikis,
    orphans: wikis.filter((w) => !covered.has(w.id)).map((w) => w.id).sort(),
  };
}

// ===========================================================================
// BEFORE — codex probe: the cross-link layer ALONE orphans a wiki-only corpus.
// This stays true after the fix; the guarantee is added ABOVE it (orchestrator).
// ===========================================================================
describe("BEFORE (codex probe) — cross-link Rule 6 cannot help a 0-topic corpus", () => {
  test("proposeCandidates emits 0 wiki↔topic edges when there are no topics", () => {
    const repo = mkTmpRepo("guild-probe-");
    const rel = ".guild/wiki/only.md";
    write(repo, rel, "# Only Page\n\nNo topics exist.\n");
    const wiki: GraphNode = {
      id: makeWikiPageId(rel),
      type: "wiki_page",
      name: "Only Page",
      confidence: "high",
      source_refs: [`${rel}#only-page`],
      category: "note",
      importance: "low",
      labels: [],
    };
    const cands = proposeCandidates(repo, [wiki], []).filter(
      (c) => c.reason === "wiki_topic_term_overlap"
    );
    expect(cands).toHaveLength(0); // orphan at the cross-link layer
  });
});

// ===========================================================================
// AFTER — orchestrator synthesizes a deterministic fallback root topic.
// ===========================================================================
describe("AFTER — wiki-only corpus gets a deterministic fallback root topic (SC-3)", () => {
  test("every wiki_page has ≥1 evidenced_by edge from the root topic; 0 orphans", async () => {
    const repo = mkTmpRepo();
    write(repo, ".guild/wiki/index.md", "# Index\n\nSee [[alpha]].\n");
    write(repo, ".guild/wiki/alpha.md", "# Alpha\n\nProse one.\n");
    write(repo, ".guild/wiki/beta.md", "# Beta\n\nProse two.\n");

    const result = await runKnowledgeStages(
      repo,
      { codeRelPaths: [], docRelPaths: [] }, // wikiDir defaults to .guild/wiki
      SEAMS,
      {}
    );
    const graph = result.graph;
    const { topics, wikis, orphans } = topicMembership(graph);

    expect(wikis.length).toBe(3);
    // Exactly ONE topic — the synthesized root.
    expect(topics.map((t) => t.id)).toEqual([ROOT_TOPIC_ID]);
    // Name is now repo-derived (followup: was the generic "Project Knowledge").
    expect(topics[0].name).toBe(deriveFallbackRootTopicName(repo));
    expect(topics[0].name).toMatch(/ Knowledge$/);
    // No wiki_page orphaned.
    expect(orphans).toEqual([]);
    // Defense-in-depth machine check reports clean.
    expect(result.sc3OrphanWikiPageIds).toEqual([]);
  }, 30000);

  test("the root topic resolves at repoRoot (SC-12) and is a valid topic node", async () => {
    const repo = mkTmpRepo();
    write(repo, ".guild/wiki/index.md", "# Index\n\nlone page.\n");
    const result = await runKnowledgeStages(
      repo,
      { codeRelPaths: [], docRelPaths: [] },
      SEAMS,
      {}
    );
    const root = result.graph.nodes.find((n) => n.id === ROOT_TOPIC_ID);
    expect(root).toBeDefined();
    expect(typeof root!.importance_score).toBe("number");
    expect(root!.importance_score as number).toBeGreaterThanOrEqual(0.4);
    expect(Array.isArray(root!.source_refs)).toBe(true);
    expect(root!.source_refs.length).toBeGreaterThanOrEqual(1);
    // anchor is a bare repoRoot-relative path that exists on disk
    const anchor = root!.source_refs[0];
    expect(fs.existsSync(path.join(repo, anchor.split("#")[0]))).toBe(true);
  }, 30000);

  test("SC-8/SC-11: re-running a wiki-only corpus (varying runId) → byte-identical knowledge-graph.json", async () => {
    // Same repo, two finalize runs with different runIds: SC-8 byte-identity
    // means the runId reaches only the provenance sidecar, never the graph.
    // (Uses one repo so the repo-derived root-topic name is held constant —
    //  the name legitimately varies by repo root, not by run.)
    const repo = mkTmpRepo("guild-sc8wiki-");
    write(repo, ".guild/wiki/index.md", "# Index\n\nSee [[alpha]].\n");
    write(repo, ".guild/wiki/alpha.md", "# Alpha\n\nProse.\n");
    await runKnowledgeStages(repo, { codeRelPaths: [], docRelPaths: [] }, SEAMS, { runId: "a" });
    const g1 = fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-graph.json"), "utf8");
    await runKnowledgeStages(repo, { codeRelPaths: [], docRelPaths: [] }, SEAMS, { runId: "b" });
    const g2 = fs.readFileSync(path.join(repo, ".guild", "indexes", "knowledge-graph.json"), "utf8");
    expect(g1).toBe(g2);
  }, 30000);
});

// ===========================================================================
// GUARD — the synthesis fires ONLY for ≥1 wiki_page AND 0 topics.
// Unit-tests the exported helper so the multi-topic / no-wiki paths are pinned
// without needing a full corpus (preserves the verified real-plugin byte set).
// ===========================================================================
describe("GUARD — maybeSynthesizeFallbackRootTopic fires only when needed", () => {
  const wiki: GraphNode = {
    id: "wiki_page:.guild/wiki/x.md",
    type: "wiki_page",
    name: "X",
    confidence: "high",
    source_refs: [".guild/wiki/x.md#x"],
    category: "note",
    importance: "low",
    labels: [],
  };
  const topic: GraphNode = {
    id: "topic:abcd1234",
    type: "topic",
    name: "Real Topic",
    confidence: "high",
    source_refs: ["src/a.ts#L1-L1"],
    category: "concept",
    importance: "high",
    importance_score: 0.9,
    topic_path: ["real-topic"],
  };

  test("0 wiki_page → null (no synthesis)", () => {
    expect(maybeSynthesizeFallbackRootTopic([topic], "/tmp")).toBeNull();
  });

  test("≥1 topic present → null (Rule 6 owns it; real-plugin byte set untouched)", () => {
    expect(maybeSynthesizeFallbackRootTopic([wiki, topic], "/tmp")).toBeNull();
  });

  test("≥1 wiki_page AND 0 topics → synthesizes root + one edge per wiki", () => {
    const wiki2: GraphNode = { ...wiki, id: "wiki_page:.guild/wiki/y.md", name: "Y", source_refs: [".guild/wiki/y.md#y"] };
    const out = maybeSynthesizeFallbackRootTopic([wiki2, wiki], "/tmp");
    expect(out).not.toBeNull();
    expect(out!.topicNode.id).toBe(ROOT_TOPIC_ID);
    expect(out!.topicNode.type).toBe("topic");
    // one evidenced_by edge per wiki, sorted by target, all from the root
    expect(out!.edges.map((e) => `${e.source}→${e.target}:${e.type}`)).toEqual([
      `${ROOT_TOPIC_ID}→wiki_page:.guild/wiki/x.md:evidenced_by`,
      `${ROOT_TOPIC_ID}→wiki_page:.guild/wiki/y.md:evidenced_by`,
    ]);
    expect(out!.edges.every((e) => e.direction === "out" && typeof e.weight === "number")).toBe(true);
  });

  test("deterministic: same inputs → identical output across two calls", () => {
    const a = maybeSynthesizeFallbackRootTopic([wiki], "/tmp");
    const b = maybeSynthesizeFallbackRootTopic([wiki], "/tmp");
    expect(a).toEqual(b);
  });
});

describe("deriveFallbackRootTopicName — repo-derived display name (followup)", () => {
  test("title-cases the repo basename + appends ' Knowledge'", () => {
    expect(deriveFallbackRootTopicName("/Users/x/Projects/guild")).toBe("Guild Knowledge");
    expect(deriveFallbackRootTopicName("/tmp/my-cool_repo")).toBe("My Cool Repo Knowledge");
  });
  test("trailing slashes are ignored", () => {
    expect(deriveFallbackRootTopicName("/srv/acme/")).toBe("Acme Knowledge");
  });
  test("degenerate roots fall back to the generic name", () => {
    expect(deriveFallbackRootTopicName("/")).toBe(FALLBACK_ROOT_TOPIC_NAME);
    expect(deriveFallbackRootTopicName("")).toBe(FALLBACK_ROOT_TOPIC_NAME);
  });
  test("deterministic — pure function of repoRoot (SC-8)", () => {
    expect(deriveFallbackRootTopicName("/a/b/guild")).toBe(deriveFallbackRootTopicName("/a/b/guild"));
  });
});
