/**
 * scripts/__tests__/knowledge-tier-evals.test.ts
 *
 * L9 — per-SC eval assertions for the knowledge tier (guild.knowledge_graph.v2).
 * One named eval per SC-1…SC-15 "Check", anchored on the committed L0f corpus at
 * `scripts/understand/__tests__/fixtures/knowledge/`. This is the per-SC rollup the
 * L12 integration gate reads.
 *
 * Landing strategy (per plan §L9: "each assertion lands as its owning lane completes"):
 *   - LANDED NOW (assert against committed artifacts: L0 validator + L0f corpus + L11 kg-query):
 *     SC-2, SC-4 (validator/structural half), SC-5 (structural half), SC-6 (validator half),
 *     SC-11, SC-12, SC-13, plus a permanent field_contract tightness meta-eval.
 *   - PENDING (it.todo carrying the assertion spec; filled when the owning K-lane gates):
 *     SC-1 (L1), SC-3 (L2), SC-7 (L3), SC-8/14/15 (L6), SC-9 (L1+docs), SC-10 (L7),
 *     plus the data-production halves of SC-4 (L5) / SC-5 (L4) and the lint half of SC-6 (L8).
 *
 * Assertion spec = the field_contract authored in expected-output.json (the tightness codex
 * required at the L0f G-lane): source/target/type/direction match exactly; edge weight is
 * range/threshold; node name is FREE for topic/claim/concept; confidence is enum-present.
 *
 * Usage: npx jest --testPathPattern=knowledge-tier-evals --no-coverage
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import { validateGraphV2, KNOWLEDGE_CONFIG_DEFAULTS, NODE_CATEGORIES, resolveAnchor, GraphNode, GraphEdge } from "../understand/lib/schema";
import { scoreNode } from "../understand/kg-query";
import { analyzeDiagrams } from "../understand/diagram-analyze";
import { indexWiki, ClassifyPageFn, WikiPageClassification } from "../understand/wiki-index";
import { lintKnowledgeNodes } from "../understand/wiki-lint-knowledge";
import { lintWiki } from "../wiki-lint-checks";
import { analyzeContent, ProposeConceptsFn, ProposeClaimsAndEntitiesFn } from "../understand/content-analyze";
import { buildKStageStore, analyzeHashDelta, classifyKStages } from "../understand/k-stage-staleness";
import { buildTaxonomy, ProposeTaxonomyFn } from "../understand/taxonomy-build";
import { buildCrossLinks, ConfirmCrossLinksFn, proposeCandidates } from "../understand/cross-link";

// ---------------------------------------------------------------------------
// Fixture loaders — the committed L0f corpus is the oracle.
// ---------------------------------------------------------------------------

const FIX = path.join(__dirname, "../understand/__tests__/fixtures/knowledge");
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));

const expected = load("expected-output.json");
const graph = load("expected-graph.v2.json");
const bad = load("bad-nodes.json");

const vg = (g: unknown) => validateGraphV2(g, { repoRoot: FIX });
const nodeById = (id: string): GraphNode | undefined => graph.nodes.find((n: GraphNode) => n.id === id);
const edgesOfType = (t: string): GraphEdge[] => graph.edges.filter((e: GraphEdge) => e.type === t);

/** parent map over subtopic_of, and a memoized depth from root. */
function subtopicDepth(): { maxDepth: number; depthOf: (id: string) => number } {
  const parent = new Map<string, string>();
  for (const e of edgesOfType("subtopic_of")) parent.set(e.source, e.target as string);
  const depthOf = (id: string): number => (parent.has(id) ? depthOf(parent.get(id)!) + 1 : 0);
  const topics = graph.nodes.filter((n: GraphNode) => n.type === "topic");
  const maxDepth = Math.max(...topics.map((t: GraphNode) => depthOf(t.id)));
  return { maxDepth, depthOf };
}

/** A graph clone with a single node/edge mutation, validated against the corpus. */
const baseNeg = {
  version: "guild.knowledge_graph.v2", kind: "knowledge", generated_from_commit: "X",
  project: { name: "neg", description: "" }, nodes: [] as unknown[], edges: [] as unknown[], layers: [], tour: [],
};

// ===========================================================================
// Sanity — the three corpus artifacts load and the reference graph validates.
// ===========================================================================

describe("L0f corpus — load + reference-graph validity", () => {
  it("loads expected-output.json, expected-graph.v2.json, bad-nodes.json", () => {
    expect(expected.field_contract).toBeDefined();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(bad.rejected_by_validator).toBeDefined();
  });

  it("expected-graph.v2.json passes validateGraphV2 against the corpus root (0 invariant drops)", () => {
    const r = vg(graph);
    expect(r.success).toBe(true);
    expect(r.fatal).toBeUndefined();
    expect(r.data!.nodes.length).toBe(graph.nodes.length);
    expect(r.data!.edges.length).toBe(graph.edges.length);
    expect((r.issues || []).filter((i) => i.level !== "auto-corrected")).toEqual([]);
  });
});

// ===========================================================================
// field_contract tightness meta-eval (the gap codex flagged at the L0f gate).
// Permanent guard: every asserted edge must carry source/target/type/direction/weight
// and match the reference graph exactly on the HARD fields.
// ===========================================================================

describe("field_contract — every asserted edge is fully shaped + matches the graph", () => {
  const assertedEdges: GraphEdge[] = [
    ...expected.expectations["SC-3"].expected_related_edges,
    expected.expectations["SC-4"].seeded_claim_to_code.edge,
    expected.expectations["SC-4"].seeded_topic_to_diagram.edge,
    ...expected.expectations["SC-4"].additional_evidenced_by,
    ...expected.expectations["SC-5"].belongs_to_domain_edges,
    expected.expectations["SC-7"].seeded_topic_to_diagram_resolves,
  ];

  it.each(assertedEdges.map((e) => [`${e.type}|${e.source}->${e.target}`, e] as const))(
    "%s has direction+weight and matches the reference graph (HARD fields exact)",
    (_label, e) => {
      for (const k of ["source", "target", "type", "direction", "weight"]) {
        expect(e).toHaveProperty(k);
      }
      expect(["out", "in", "bi"]).toContain(e.direction);
      expect(typeof e.weight).toBe("number");
      expect(e.weight).toBeGreaterThanOrEqual(0);
      expect(e.weight).toBeLessThanOrEqual(1);
      const match = graph.edges.find(
        (g: GraphEdge) => g.source === e.source && g.target === e.target && g.type === e.type,
      );
      expect(match).toBeDefined();
      expect(match!.direction).toBe(e.direction); // HARD — exact
      expect(match!.weight).toBe(e.weight);
      // evidenced_by / relates_to weights must clear relMinConf (threshold rule)
      if (e.type === "evidenced_by" || e.type === "relates_to") {
        expect(e.weight).toBeGreaterThanOrEqual(KNOWLEDGE_CONFIG_DEFAULTS.relMinConf);
      }
    },
  );
});

// ===========================================================================
// SC-1 — article/topic extraction (LANDED; L1 content-analyze gated + committed 42fa8e4)
// Asserts the REAL analyzeContent path (oracle-backed LLM seams; the real adapter is L6).
// ===========================================================================

const CODE = ["src/ingest.ts", "src/validate.ts", "src/store.ts"];
const DOCS = ["index.md", "docs/overview.md", "docs/ingestion.md", "docs/validation.md", "docs/storage.md", "docs/concepts.md"];

// Oracle-backed seams: echo real (resolvable) anchors from the extracted candidates so the
// LLM layer is held constant — the test exercises the deterministic pipeline + anchor gate,
// not LLM behavior (same frozen-LLM discipline as SC-3/SC-8).
const proposeConcepts: ProposeConceptsFn = async (cands) =>
  cands.map((c, i) => ({ anchor: c.anchor, name: `Concept ${i}`, confidence: "high" }));
const proposeClaimsAndEntities: ProposeClaimsAndEntitiesFn = async (sections, headings) => ({
  claims: sections.slice(0, 3).map((s, i) => ({ anchor: s.anchor, text: `Claim ${i}`, confidence: "high" })),
  entities: headings
    .filter((h) => h.relPath === "docs/concepts.md" && h.level === 2)
    .map((h) => ({ name: h.text, anchor: h.anchor, confidence: "high" })),
});

describe("SC-1 — content-analyze: concept/claim/entity extraction", () => {
  const sc1 = expected.expectations["SC-1"];
  let result: { nodes: GraphNode[]; edges: GraphEdge[]; clusters: { memberIds: string[] }[] };
  beforeAll(async () => {
    result = await analyzeContent(FIX, CODE, DOCS, { proposeConcepts, proposeClaimsAndEntities });
  });

  const countByType = (t: string) => result.nodes.filter((n) => n.type === t).length;

  it("emits >= the expected node count per type (claim>=2, entity>=3, concept>=2)", () => {
    expect(countByType("claim")).toBeGreaterThanOrEqual(sc1.min_nodes_by_type.claim);
    expect(countByType("entity")).toBeGreaterThanOrEqual(sc1.min_nodes_by_type.entity);
    expect(countByType("concept")).toBeGreaterThanOrEqual(sc1.min_nodes_by_type.concept);
  });

  it("every emitted node has >=1 source_ref, all resolving per-form at repoRoot", () => {
    for (const n of result.nodes) {
      const refs = n.source_refs ?? [];
      expect(refs.length).toBeGreaterThanOrEqual(1);
      for (const a of refs) expect(resolveAnchor(FIX, a)).toBe(true);
    }
  });

  it("0 nodes missing confidence (node field_contract: confidence enum-present)", () => {
    const IMP = new Set(["high", "medium", "low"]);
    for (const n of result.nodes) expect(IMP.has(n.confidence)).toBe(true);
  });

  it("emits deterministic content-cluster membership for L4 (sorted memberIds, ready for makeTopicId)", () => {
    expect(result.clusters.length).toBeGreaterThanOrEqual(1);
    for (const c of result.clusters) {
      expect(Array.isArray(c.memberIds)).toBe(true);
      expect([...c.memberIds].sort()).toEqual(c.memberIds); // already sorted (SC-11 determinism)
    }
  });

  it("REAL PATH — fail-loud: analyzeContent with NO LLM seam injected THROWS (no silent empty graph)", async () => {
    await expect(analyzeContent(FIX, CODE, DOCS)).rejects.toThrow(/LLM adapter/i);
  });

  it("REAL PATH — per-form anchor gate: a proposal with a valid FILE but out-of-range lines is DROPPED", async () => {
    const goodAnchor = "src/ingest.ts#L1-L6";
    const badAnchor = "src/ingest.ts#L900-L999"; // file exists, line range does NOT — must be dropped
    const mixed: ProposeConceptsFn = async () => [
      { anchor: goodAnchor, name: "Good", confidence: "high" },
      { anchor: badAnchor, name: "Bad", confidence: "high" },
    ];
    const r = await analyzeContent(FIX, CODE, DOCS, { proposeConcepts: mixed });
    const anchors = r.nodes.flatMap((n) => n.source_refs ?? []);
    expect(anchors).toContain(goodAnchor); // good survives
    expect(anchors).not.toContain(badAnchor); // bad dropped — proves per-form (not file-only) validation
  });
});

// ===========================================================================
// SC-9 — determinism boundary table (LANDED; L1 content-analyze gated 42fa8e4)
// Asserts the table is present in the source AND honestly classifies cluster membership.
// ===========================================================================

describe("SC-9 — determinism responsibility table is present + honest", () => {
  const src = fs.readFileSync(path.join(__dirname, "../understand/content-analyze.ts"), "utf8");

  it("content-analyze.ts carries a determinism responsibility table", () => {
    expect(src).toMatch(/determinism responsibility table/i);
  });

  it("table covers 100% of emitted node fields (id, source_refs, type/category, name, confidence)", () => {
    expect(src).toMatch(/node id/i);
    expect(src).toMatch(/source_refs/);
    expect(src).toMatch(/node type \/ category/i);
    expect(src).toMatch(/concept name/i);
    expect(src).toMatch(/claim text/i);
    expect(src).toMatch(/entity selection/i);
    expect(src).toMatch(/confidence/i);
  });

  it("HONEST cluster-membership classification: structural-authorship vs content-co-occurrence distinguished", () => {
    // v4 fix: the dishonest blanket 'NOT structural' claim was removed; the two membership
    // kinds are named separately and the honest 'NOT dir co-location' qualifier remains.
    expect(src).toMatch(/cluster membership — structural authorship/i);
    expect(src).toMatch(/cluster membership — content co-occurrence/i);
    expect(src).toMatch(/NOT dir co-location/i);
  });

  it("no field claimed deterministic that actually calls the model (LLM fields marked LLM-judged)", () => {
    // The four LLM-judged fields must be labelled as such, not as deterministic-script.
    for (const f of ["concept name", "claim text", "entity selection", "confidence"]) {
      const row = src.split("\n").find((l) => new RegExp(f, "i").test(l));
      expect(row).toBeDefined();
    }
    expect(src).toMatch(/LLM-judged/);
  });
});

// ===========================================================================
// SC-2 — multi-level taxonomy (validator + structural; LANDED)
// ===========================================================================

describe("SC-2 — subtopic_of taxonomy depth/fanout/threshold/acyclic", () => {
  it("reference graph: max subtopic depth >= 3 and matches the contract", () => {
    const { maxDepth } = subtopicDepth();
    expect(maxDepth).toBeGreaterThanOrEqual(3);
    expect(maxDepth).toBe(expected.expectations["SC-2"].max_subtopic_depth);
  });

  it("reference graph: depth <= maxDepth(8), root fan-out <= maxBranching(12)", () => {
    const { maxDepth, depthOf } = subtopicDepth();
    expect(maxDepth).toBeLessThanOrEqual(KNOWLEDGE_CONFIG_DEFAULTS.maxDepth);
    const root = expected.expectations["SC-13"].sibling_pair_under_root.parent;
    const fanout = edgesOfType("subtopic_of").filter((e) => e.target === root).length;
    expect(fanout).toBe(expected.expectations["SC-2"].root_fanout);
    expect(fanout).toBeLessThanOrEqual(KNOWLEDGE_CONFIG_DEFAULTS.maxBranching);
    expect(depthOf(root)).toBe(0);
  });

  it("reference graph: no topic below minTopicImportance(0.4)", () => {
    for (const n of graph.nodes.filter((x: GraphNode) => x.type === "topic")) {
      expect(typeof n.importance_score).toBe("number");
      expect(n.importance_score as number).toBeGreaterThanOrEqual(KNOWLEDGE_CONFIG_DEFAULTS.minTopicImportance);
    }
  });

  it("negative: a below-threshold topic is dropped by the validator", () => {
    const n = bad.rejected_by_validator.topic_below_min_importance.node;
    const r = vg({ ...baseNeg, nodes: [n] });
    expect(r.data?.nodes.some((x: GraphNode) => x.id === n.id) ?? false).toBe(false);
  });

  it("negative: a topic missing importance_score is dropped", () => {
    const n = bad.rejected_by_validator.topic_missing_importance_score.node;
    const r = vg({ ...baseNeg, nodes: [n] });
    expect(r.data?.nodes.some((x: GraphNode) => x.id === n.id) ?? false).toBe(false);
  });

  it("negative: a subtopic_of cycle is FATAL", () => {
    const t = (id: string) => ({
      id, type: "topic", name: id, category: "concept", importance: "high",
      importance_score: 0.9, topic_path: [id], source_refs: ["docs/overview.md#overview"], confidence: "high",
    });
    const r = vg({ ...baseNeg, nodes: [t("topic:cyc0a000"), t("topic:cyc0b000")], edges: bad.rejected_subgraphs.subtopic_cycle.edges });
    expect(r.success).toBe(false);
  });

});

// ===========================================================================
// SC-3 — wiki indexed + labeled + classified (LANDED; L2 wiki-index gated + committed 7a8a0a4)
// Asserts the REAL indexWiki output with an oracle-backed mock classifier (real classifier = L8).
// ===========================================================================

describe("SC-3 — wiki-index: wiki_page nodes + related edges + classification", () => {
  const sc3 = expected.expectations["SC-3"];
  const classification: Record<string, WikiPageClassification> = sc3.wiki_page_classification;

  // Inject the oracle classification (frozen LLM seam — the real classifier is L8).
  const mockClassifier: ClassifyPageFn = async (pages) => {
    const m = new Map<string, WikiPageClassification>();
    for (const p of pages) m.set(p.id, classification[p.id] ?? { category: "note", importance: "low", labels: [] });
    return m;
  };

  let wikiNodes: GraphNode[] = [];
  let related: GraphEdge[] = [];
  beforeAll(async () => {
    const r = await indexWiki(FIX, { classifier: mockClassifier });
    wikiNodes = r.nodes.filter((n) => n.type === "wiki_page");
    related = r.edges.filter((e) => e.type === "related");
  });

  it("page_count == wiki_page node count == 6", () => {
    expect(wikiNodes.length).toBe(sc3.wiki_page_node_count);
    expect(wikiNodes.length).toBe(sc3.page_count);
    expect(wikiNodes.length).toBe(expected.corpus.markdown_pages);
  });

  it("every wiki_page id is deterministic wiki_page:<relpath> and matches ids.wiki_pages", () => {
    const got = new Set(wikiNodes.map((n) => n.id));
    const want = new Set(Object.values(expected.ids.wiki_pages) as string[]);
    expect(got).toEqual(want);
  });

  it("all 8 expected related edges present 1:1 with HARD fields matching field_contract (no extras)", () => {
    expect(related.length).toBe(sc3.expected_related_edges.length); // 8, no extras
    for (const want of sc3.expected_related_edges as GraphEdge[]) {
      const m = related.find((e) => e.source === want.source && e.target === want.target);
      expect(m).toBeDefined();
      expect(m!.type).toBe(want.type);
      expect(m!.direction).toBe(want.direction); // HARD — exact
      expect(m!.weight).toBe(want.weight);
    }
  });

  it("every wiki_page has non-null category(enum) + importance(enum) + labels; confidence enum-present", () => {
    const IMP = new Set(["high", "medium", "low"]);
    for (const n of wikiNodes) {
      expect(typeof n.category).toBe("string");
      expect(NODE_CATEGORIES.has(n.category as string)).toBe(true);
      expect(IMP.has(n.importance as string)).toBe(true);
      expect(Array.isArray(n.labels)).toBe(true);
      expect(IMP.has(n.confidence)).toBe(true); // node field_contract: confidence enum-present
    }
  });

  it("classification flows from the injected classifier into the node (category/importance/labels)", () => {
    for (const n of wikiNodes) {
      const oracle = classification[n.id];
      expect(n.category).toBe(oracle.category);
      expect(n.importance).toBe(oracle.importance);
      expect(n.labels).toEqual(oracle.labels);
    }
  });

  it("wiki_page source_refs (heading-slug anchors) match the committed reference graph", () => {
    for (const n of wikiNodes) {
      const inGraph = graph.nodes.find((g: GraphNode) => g.id === n.id);
      expect(inGraph).toBeDefined();
      expect(n.source_refs).toEqual(inGraph!.source_refs);
    }
  });
});

// ===========================================================================
// SC-4 — cross-modal relations (validator global + seeded fixture; LANDED structural)
// ===========================================================================

describe("SC-4 — evidenced_by cross-modal links", () => {
  it("global invariant: reference graph validates, so every evidenced_by target anchor resolves", () => {
    expect(vg(graph).success).toBe(true);
    expect(edgesOfType("evidenced_by").length).toBeGreaterThanOrEqual(3);
  });

  it("seeded claim->code edge exists and reaches the code node in <=2 hops", () => {
    const spec = expected.expectations["SC-4"].seeded_claim_to_code;
    const e = graph.edges.find(
      (g: GraphEdge) => g.source === spec.edge.source && g.target === spec.edge.target && g.type === "evidenced_by",
    );
    expect(e).toBeDefined();
    expect(spec.hops_claim_to_code).toBeLessThanOrEqual(2);
    expect(nodeById(spec.edge.target)).toBeDefined(); // target code node present (1-hop reachable)
  });

  it("seeded topic->diagram edge exists (SC-3/SC-7 bridge)", () => {
    const e = expected.expectations["SC-4"].seeded_topic_to_diagram.edge;
    expect(graph.edges.some((g: GraphEdge) => g.source === e.source && g.target === e.target && g.type === "evidenced_by")).toBe(true);
  });

  it("negative: a dangling evidenced_by target edge is dropped", () => {
    const edge = bad.rejected_subgraphs.dangling_evidenced_by_target.edge;
    const src = { id: edge.source, type: "claim", name: "c", category: "claim", source_refs: ["docs/ingestion.md#ingestion"], confidence: "high" };
    const r = vg({ ...baseNeg, nodes: [src], edges: [edge] });
    expect((r.data?.edges || []).some((x: GraphEdge) => x.target === edge.target)).toBe(false);
  });

});

// ===========================================================================
// SC-4 PRODUCTION half (LANDED; L5 cross-link gated + committed 7717294)
// Drives the REAL buildCrossLinks path: deterministic candidates → LLM-confirm seam →
// candidateKeys guard + relMinConf filter + evidenced_by anchor validation.
// ===========================================================================

describe("SC-4 production — real buildCrossLinks", () => {
  // Re-derive cross-modal edges from the committed graph's nodes (strip the pre-seeded
  // cross-modal edges so K5 produces them itself; keep structural edges for dedup realism).
  const structuralEdges = graph.edges.filter(
    (e: GraphEdge) => !["evidenced_by", "relates_to", "mentions"].includes(e.type),
  );
  const candidates = proposeCandidates(FIX, graph.nodes, structuralEdges);
  const candidateKeys = new Set(candidates.map((c) => `${c.source}→${c.target}:${c.type}`));

  // Echo-all confirm mock (frozen LLM) at weight 0.9, PLUS one invented relates_to whose
  // (source,target,type) is NOT a deterministic candidate — must be dropped by the guard.
  const confirm: ConfirmCrossLinksFn = async (_nodes, cands) => {
    const edges = cands.map((c) => ({ source: c.source, target: c.target, type: c.type, direction: "out" as const, weight: 0.9 }));
    edges.push({ source: "entity:event", target: "topic:invented9", type: "relates_to", direction: "out", weight: 0.95 });
    return edges;
  };

  const CLAIM = expected.ids.claims.validated_before_persist.id;
  const VALIDATE = "function:src/validate.ts:validateEvent";
  const TOPIC_ING = expected.ids.topics.ingestion;
  const DIAGRAM = expected.ids.diagrams.mermaid_flow;

  let edges: GraphEdge[] = [];
  beforeAll(async () => {
    edges = (await buildCrossLinks(FIX, { nodes: graph.nodes, edges: structuralEdges }, { confirmCrossLinks: confirm })).edges;
  });

  it("derives + emits the seeded claim->code evidenced_by (weight >= relMinConf, direction out)", () => {
    const e = edges.find((x) => x.source === CLAIM && x.target === VALIDATE && x.type === "evidenced_by");
    expect(e).toBeDefined();
    expect(e!.weight).toBeGreaterThanOrEqual(KNOWLEDGE_CONFIG_DEFAULTS.relMinConf);
    expect(e!.direction).toBe("out");
  });

  it("claim -> code is reachable in <=2 hops over the emitted evidenced_by edges", () => {
    const adj = new Map<string, string[]>();
    for (const e of edges) (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target as string);
    // BFS depth <= 2 from CLAIM
    let frontier = [CLAIM];
    let reached = false;
    for (let hop = 1; hop <= 2 && !reached; hop++) {
      const next: string[] = [];
      for (const id of frontier) for (const t of adj.get(id) ?? []) {
        if (t === VALIDATE) { reached = true; break; }
        next.push(t);
      }
      frontier = next;
    }
    expect(reached).toBe(true);
  });

  it("derives + emits the seeded topic->diagram evidenced_by", () => {
    expect(edges.some((x) => x.source === TOPIC_ING && x.target === DIAGRAM && x.type === "evidenced_by")).toBe(true);
  });

  it("every emitted evidenced_by target anchor RESOLVES (no dangling)", () => {
    const nodeById = new Map<string, GraphNode>(graph.nodes.map((n: GraphNode) => [n.id, n]));
    for (const e of edges.filter((x) => x.type === "evidenced_by")) {
      const t = nodeById.get(e.target as string);
      expect(t).toBeDefined();
      expect((t!.source_refs ?? []).some((r) => resolveAnchor(FIX, r))).toBe(true);
    }
  });

  it("REAL PATH — candidateKeys guard: an LLM relates_to edge NOT in the deterministic candidate set is DROPPED", () => {
    expect(edges.some((x) => x.target === "topic:invented9")).toBe(false);
  });

  it("relates_to edges come from deterministic Rule 5 candidates, not LLM invention", () => {
    const rel = edges.filter((x) => x.type === "relates_to");
    expect(rel.length).toBeGreaterThanOrEqual(1);
    for (const e of rel) expect(candidateKeys.has(`${e.source}→${e.target}:${e.type}`)).toBe(true);
  });
});

// ===========================================================================
// SC-5 — semantic domains (structural; LANDED)
// ===========================================================================

describe("SC-5 — semantic domains, not directory names", () => {
  const topLevelDirs: string[] = expected.expectations["SC-5"].top_level_dirs;
  const domains = graph.nodes.filter((n: GraphNode) => n.type === "domain");

  it("no domain is named exactly after a top-level directory", () => {
    expect(domains.length).toBeGreaterThanOrEqual(1);
    for (const d of domains) {
      expect(topLevelDirs).not.toContain(d.name);
      expect(topLevelDirs).not.toContain(d.id.startsWith("domain:") ? d.id.slice(7) : d.id);
    }
  });

  it("each domain has >=1 topic via belongs_to_domain", () => {
    for (const d of domains) {
      const members = edgesOfType("belongs_to_domain").filter((e) => e.target === d.id);
      expect(members.length).toBeGreaterThanOrEqual(1);
    }
  });

});

// ===========================================================================
// SC-2 + SC-5 PRODUCTION halves (LANDED; L4 taxonomy-build gated + committed 549c104)
// Drives the REAL buildTaxonomy path (K1 clusters -> buildTaxonomy with an oracle mock).
// The structural validator halves above prove the invariants; these prove the DATA the lane produces.
// ===========================================================================

describe("SC-2 + SC-5 production — real buildTaxonomy", () => {
  // Oracle mock: assign the supported 4-deep chain to the first 4 (sorted) topic inputs,
  // one sub-threshold proposal (must fold), one invented id (must drop), and two domains
  // (one valid 'Event Ingestion', one forbidden 'Source' — src/ is a top-level dir).
  const propose: ProposeTaxonomyFn = async (inputs) => {
    const ids = inputs.map((i) => i.topicId).sort();
    const refs = [
      "docs/overview.md#overview", "docs/ingestion.md#ingestion",
      "docs/ingestion.md#source-adapters", "docs/ingestion.md#webhook-adapter", "docs/storage.md#storage",
    ];
    const chain = ["Event Pipeline", "Ingestion", "Source Adapters", "Webhook Adapter"];
    const scores = [0.9, 0.85, 0.7, 0.6];
    const topicProposals = ids.map((id, i) => {
      if (i === 0) return { topicId: id, name: chain[0], importanceScore: scores[0], sourceRef: refs[0], parentTopicId: null };
      if (i <= 3) return { topicId: id, name: chain[i], importanceScore: scores[i], sourceRef: refs[i], parentTopicId: ids[i - 1] };
      if (i === ids.length - 1) return { topicId: id, name: `Sub ${i}`, importanceScore: 0.2, sourceRef: refs[4], parentTopicId: ids[0] }; // sub-threshold → folds
      return { topicId: id, name: `Topic ${i}`, importanceScore: 0.55, sourceRef: refs[4], parentTopicId: ids[0] };
    });
    topicProposals.push({ topicId: "topic:invented0", name: "Invented", importanceScore: 0.9, sourceRef: refs[0], parentTopicId: null }); // not in input set → drop
    const domainProposals = [
      { name: "Event Ingestion", topicIds: [ids[1]], sourceRef: refs[1] },
      { name: "Source", topicIds: [ids[2]], sourceRef: refs[0] }, // forbidden: src→source
    ];
    return { topicProposals, domainProposals };
  };

  let nodes: GraphNode[] = [];
  let edges: GraphEdge[] = [];
  beforeAll(async () => {
    const k1 = await analyzeContent(FIX, CODE, DOCS, { proposeConcepts, proposeClaimsAndEntities });
    const r = await buildTaxonomy(FIX, k1.clusters, { proposeTaxonomy: propose });
    nodes = r.nodes;
    edges = r.edges;
  });

  const topics = () => nodes.filter((n) => n.type === "topic");
  const domains = () => nodes.filter((n) => n.type === "domain");
  const subtopicParent = () => {
    const m = new Map<string, string>();
    for (const e of edges.filter((x) => x.type === "subtopic_of")) m.set(e.source, e.target as string);
    return m;
  };

  // ── SC-2 production ──
  it("SC-2: derives a tree >= 3 deep on the supported branch, <= maxDepth(8)", () => {
    const parent = subtopicParent();
    const depth = (id: string): number => (parent.has(id) ? depth(parent.get(id)!) + 1 : 0);
    const max = Math.max(...topics().map((t) => depth(t.id)));
    expect(max).toBeGreaterThanOrEqual(3);
    expect(max).toBeLessThanOrEqual(KNOWLEDGE_CONFIG_DEFAULTS.maxDepth);
  });

  it("SC-2: every parent's fan-out <= maxBranching(12)", () => {
    const count = new Map<string, number>();
    for (const e of edges.filter((x) => x.type === "subtopic_of")) {
      count.set(e.target as string, (count.get(e.target as string) ?? 0) + 1);
    }
    for (const c of count.values()) expect(c).toBeLessThanOrEqual(KNOWLEDGE_CONFIG_DEFAULTS.maxBranching);
  });

  it("SC-2: NO emitted topic below minTopicImportance(0.4) — sub-threshold folded into parent", () => {
    for (const t of topics()) expect(t.importance_score as number).toBeGreaterThanOrEqual(KNOWLEDGE_CONFIG_DEFAULTS.minTopicImportance);
    expect(topics().some((t) => /^Sub /.test(t.name))).toBe(false); // the 0.2 proposal is gone
  });

  it("SC-2: subtopic_of tree is acyclic + terminates (every chain reaches a root)", () => {
    const parent = subtopicParent();
    for (const t of topics()) {
      const seen = new Set<string>();
      let cur: string | undefined = t.id;
      while (cur && parent.has(cur)) {
        expect(seen.has(cur)).toBe(false); // no cycle
        seen.add(cur);
        cur = parent.get(cur);
      }
    }
  });

  it("REAL PATH — B3 determinism boundary: an LLM proposal with an invented topicId is DROPPED", () => {
    expect(nodes.some((n) => n.id === "topic:invented0")).toBe(false);
  });

  // ── SC-5 production ──
  it("SC-5: >=1 domain emitted, and 0 domains named after a top-level dir", () => {
    const dirs = ["docs", "diagrams", "src"];
    expect(domains().length).toBeGreaterThanOrEqual(1);
    for (const d of domains()) {
      expect(dirs).not.toContain(d.name.toLowerCase());
      expect(dirs).not.toContain(d.id.startsWith("domain:") ? d.id.slice(7) : d.id);
    }
  });

  it("SC-5: strengthened guard — a proposed domain 'Source' (src/ present) is NOT emitted", () => {
    expect(domains().some((d) => d.name === "Source" || d.id === "domain:source")).toBe(false);
  });

  it("SC-5: every emitted domain has >=1 belongs_to_domain edge (no empty domains)", () => {
    const btd = edges.filter((e) => e.type === "belongs_to_domain");
    for (const d of domains()) {
      expect(btd.filter((e) => e.target === d.id).length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ===========================================================================
// SC-6 — classification + labeling schema (validator half + lint half BOTH LANDED;
// L8 wiki-lint gated + committed plugin 2fef141). Lint asserted at helper AND production level.
// ===========================================================================

describe("SC-6 — category enum + classification schema", () => {
  it("validator rejects an out-of-enum category", () => {
    const n = bad.rejected_by_validator.out_of_enum_category.node;
    const r = vg({ ...baseNeg, nodes: [n] });
    expect(r.data?.nodes.some((x: GraphNode) => x.id === n.id) ?? false).toBe(false);
  });

  it("every topic carries a topic_path", () => {
    for (const t of graph.nodes.filter((n: GraphNode) => n.type === "topic")) {
      expect(Array.isArray(t.topic_path)).toBe(true);
      expect((t.topic_path as string[]).length).toBeGreaterThanOrEqual(1);
    }
  });

  // ── lint half: L8 gated + committed (plugin 2fef141). Owned here. ──
  // Helper-level (lintKnowledgeNodes) PLUS the production path (lintWiki) so a green
  // helper can't mask un-wired production lint (memory: injected-seam tests mask real-path misses).

  it("lint helper: flags wiki_page_missing_importance — validator-valid but lint-flaggable", () => {
    // bad-nodes.json: valid category ("guide") but MISSING the string `importance`.
    // validateGraphV2 does NOT drop it for category reasons (importance is not validator-required);
    // lintKnowledgeNodes must flag it check="missing-importance".
    const badNode = bad.flagged_by_wiki_lint.wiki_page_missing_importance.node as GraphNode;
    expect(badNode.category).toBeDefined();
    const dropIssues = (vg({ ...baseNeg, nodes: [badNode] }).issues || []).filter(
      (i) => i.category === "missing-category" || i.category === "invalid-category",
    );
    expect(dropIssues).toHaveLength(0); // not dropped for category reasons
    const f = lintKnowledgeNodes([badNode]).find((x) => x.check === "missing-importance");
    expect(f).toBeDefined();
    expect(f!.nodeId).toBe(badNode.id);
    expect(f!.reason).toMatch(/importance/i);
  });

  it("lint helper: flags an out-of-enum category as invalid-category", () => {
    const badNode = bad.rejected_by_validator.out_of_enum_category.node as GraphNode;
    const f = lintKnowledgeNodes([badNode]).find((x) => x.check === "invalid-category");
    expect(f).toBeDefined();
    expect(f!.nodeId).toBe(badNode.id);
  });

  it("lint helper: does NOT flag a clean wiki_page with valid category + importance", () => {
    const cleanNode = graph.nodes.find((n: GraphNode) => n.type === "wiki_page" && n.importance);
    expect(cleanNode).toBeDefined();
    expect(lintKnowledgeNodes([cleanNode])).toHaveLength(0);
  });

  it("REAL PATH: production lintWiki() reads .guild/indexes/knowledge-graph.json and surfaces BOTH findings", () => {
    // Proves /guild:wiki lint → lintWiki() actually runs the knowledge-node lint (not just the
    // helper in isolation). Build a real on-disk graph with the two seeded bad nodes; call the
    // production entrypoint; assert both findings come back keyed by node id.
    const missing = bad.flagged_by_wiki_lint.wiki_page_missing_importance.node as GraphNode;
    const invalid = bad.rejected_by_validator.out_of_enum_category.node as GraphNode;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l9-lintwiki-"));
    try {
      const idxDir = path.join(tmp, ".guild", "indexes");
      fs.mkdirSync(idxDir, { recursive: true });
      const kg = {
        version: "guild.knowledge_graph.v2", kind: "knowledge", generated_from_commit: "X",
        project: { name: "lint-realpath", description: "" },
        nodes: [missing, invalid], edges: [], layers: [], tour: [],
      };
      fs.writeFileSync(path.join(idxDir, "knowledge-graph.json"), JSON.stringify(kg));
      const findings = lintWiki(tmp);
      const miss = findings.find((f) => f.check === "missing-importance" && f.file === missing.id);
      const inv = findings.find((f) => f.check === "invalid-category" && f.file === invalid.id);
      expect(miss).toBeDefined(); // surfaced via the production /guild:wiki lint path
      expect(inv).toBeDefined();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// SC-7 — diagram analysis v1 (LANDED; L3 diagram-analyze gated + committed d89de32)
// Asserts the REAL analyzeDiagrams output against the SC-7 contract.
// ===========================================================================

describe("SC-7 — diagram-analyze: mermaid + svg extraction", () => {
  const sc7 = expected.expectations["SC-7"];
  const result = analyzeDiagrams(FIX, ["docs/ingestion.md", "diagrams/architecture.svg"]);
  const byId = (id: string) => result.nodes.find((n) => n.id === id);

  it("emits exactly 2 diagram nodes (1 mermaid, 1 svg), 0 K3 edges (cross-modal is K5)", () => {
    expect(result.nodes.filter((n) => n.type === "diagram").length).toBe(2);
    expect(result.edges).toEqual([]);
  });

  it("mermaid block -> diagram node with expected nodes + edges", () => {
    const m = byId(sc7.mermaid.node_id) as (GraphNode & Record<string, unknown>) | undefined;
    expect(m).toBeDefined();
    expect(m!.source_refs).toEqual([sc7.mermaid.anchor]);
    expect(m!.category).toBe("diagram");
    expect(m!.mermaid_nodes).toEqual(sc7.mermaid.expected_mermaid_nodes);
    expect(m!.mermaid_edges).toEqual(sc7.mermaid.expected_mermaid_edges);
  });

  it("svg -> diagram node with title + labels + element-ids; svg_description LLM-deferred (absent)", () => {
    const s = byId(sc7.svg.node_id) as (GraphNode & Record<string, unknown>) | undefined;
    expect(s).toBeDefined();
    expect(s!.source_refs).toEqual([sc7.svg.anchor]);
    expect(s!.svg_title).toBe(sc7.svg.expected_title);
    expect(s!.svg_labels).toEqual(sc7.svg.expected_label_text);
    expect(s!.svg_element_ids).toEqual(sc7.svg.element_ids);
    expect("svg_description" in s!).toBe(false); // SC-9: LLM-judged, not emitted by the deterministic stage
  });

  it("seeded topic->diagram link resolves: the diagram-node target exists (so L5 evidenced_by resolves)", () => {
    const target = sc7.seeded_topic_to_diagram_resolves.target;
    expect(target).toBe(expected.expectations["SC-4"].seeded_topic_to_diagram.edge.target); // same edge, two SCs
    expect(byId(target)).toBeDefined();
  });

  it("the produced diagram ids/anchors match the committed reference graph (cross-check)", () => {
    for (const id of [sc7.mermaid.node_id, sc7.svg.node_id]) {
      const inGraph = graph.nodes.find((n: GraphNode) => n.id === id);
      const produced = byId(id);
      expect(inGraph).toBeDefined();
      expect(produced!.source_refs).toEqual(inGraph!.source_refs);
    }
  });
});

// ===========================================================================
// SC-11 — idempotent re-run + dedup (LANDED)
// ===========================================================================

describe("SC-11 — byte-identical re-run + canonical-sort dedup", () => {
  const onDisk = fs.readFileSync(path.join(FIX, "expected-graph.v2.json"), "utf8");

  it("re-validating the reference graph is byte-identical", () => {
    expect(JSON.stringify(vg(graph).data, null, 2) + "\n").toBe(onDisk);
  });

  it("reversing node + edge input order is byte-identical (canonical sort)", () => {
    const shuffled = { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };
    expect(JSON.stringify(vg(shuffled).data, null, 2) + "\n").toBe(onDisk);
  });

  it("node + edge counts match the contract", () => {
    expect(graph.nodes.length).toBe(expected.expectations["SC-11"].expected_node_count);
    expect(graph.edges.length).toBe(expected.expectations["SC-11"].expected_edge_count);
  });
});

// ===========================================================================
// SC-12 — deterministic anchors (LANDED)
// ===========================================================================

describe("SC-12 — every knowledge-node anchor resolves", () => {
  const KNOWLEDGE = new Set(["topic", "concept", "claim", "entity", "wiki_page", "diagram"]);

  it("reference graph validates with 0 nodes dropped → 100% of anchors resolve", () => {
    const r = vg(graph);
    expect(r.success).toBe(true);
    expect(r.data!.nodes.length).toBe(graph.nodes.length);
    const unresolved = (r.issues || []).filter((i) => i.category === "unresolvable-anchor");
    expect(unresolved).toEqual([]);
  });

  it("all four anchor forms are present across knowledge nodes", () => {
    const forms = { line: /#L\d+-L\d+$/, heading: /#[a-z0-9-]+$/, mermaid: /#mermaid-\d+$/, svg: /#svg$/ };
    const refs: string[] = graph.nodes
      .filter((n: GraphNode) => KNOWLEDGE.has(n.type))
      .flatMap((n: GraphNode) => n.source_refs ?? []);
    expect(refs.some((r) => forms.line.test(r))).toBe(true);
    expect(refs.some((r) => forms.mermaid.test(r))).toBe(true);
    expect(refs.some((r) => forms.svg.test(r))).toBe(true);
    expect(refs.some((r) => forms.heading.test(r) && !forms.mermaid.test(r) && !forms.svg.test(r))).toBe(true);
  });

  it("negative: an unresolvable anchor is dropped", () => {
    const n = bad.rejected_by_validator.unresolvable_anchor.node;
    const r = vg({ ...baseNeg, nodes: [n] });
    expect(r.data?.nodes.some((x: GraphNode) => x.id === n.id) ?? false).toBe(false);
  });
});

// ===========================================================================
// SC-13 — recall ranking (LANDED; L11 kg-query built)
// ===========================================================================

describe("SC-13 — high-importance topic ranks above its low-importance sibling", () => {
  const pair = expected.expectations["SC-13"].sibling_pair_under_root;
  const high = nodeById(pair.high_importance.id)!;
  const low = nodeById(pair.low_importance.id)!;

  it("the sibling pair exists in the reference graph", () => {
    expect(high).toBeDefined();
    expect(low).toBeDefined();
    expect(high.importance_score as number).toBeGreaterThan(low.importance_score as number);
  });

  it("recall-by-importance (no-terms): high scores above low", () => {
    expect(scoreNode(high, [])).toBeGreaterThan(scoreNode(low, []));
  });

  it("query touching both siblings: high ranks above low", () => {
    // "topic" matches both via the id prefix → equal term score; importance breaks the tie.
    expect(scoreNode(high, ["topic"])).toBeGreaterThan(scoreNode(low, ["topic"]));
  });
});

// ===========================================================================
// PENDING — assertions land as their owning K-lane gates (spec carried in titles).
// ===========================================================================

// ===========================================================================
// SC-14 — per-K-stage staleness (LANDED; k-stage-staleness.ts committed 98dc4e4)
// Drives the REAL classifier pipeline (buildKStageStore → analyzeHashDelta → classifyKStages).
// ===========================================================================

describe("SC-14 — per-K-stage staleness classifier", () => {
  const classify = (base: Record<string, string>, cur: Record<string, string>) => {
    const stored = buildKStageStore(base);
    return classifyKStages(analyzeHashDelta(stored, cur), stored, cur);
  };

  it("docs-only edit → K1/K2/K4/K5/K6 refresh, K3 SKIP, structural graph SKIP", () => {
    const base = { "src/app.ts": "export const x = 1;\n", "docs/knowledge/guide.md": "# Guide\n\nold.\n" };
    const cur = { ...base, "docs/knowledge/guide.md": "# Guide\n\nNEW prose.\n" };
    const s = classify(base, cur);
    expect(s).toMatchObject({ k1: true, k2: true, k3: false, k4: true, k5: true, k6: true, structuralSkip: true });
  });

  it("code-only structural change → all K-stages SKIP (k1..k6 false), structural graph rebuilds", () => {
    const base = { "src/app.ts": "export const x = 1;\n" };
    const cur = { "src/app.ts": "export const x = 2;\n" };
    const s = classify(base, cur);
    expect(s).toMatchObject({ k1: false, k2: false, k3: false, k4: false, k5: false, k6: false });
    expect(s.structuralSkip).toBe(false); // code changed → structural graph DOES rebuild
  });

  it("REAL PATH — AST-correct: editing only a string literal containing `//` does NOT trip K1", () => {
    // A naive regex extractor would treat `//` inside the string as a doc-comment and flip k1.
    const base = { "src/u.ts": 'export const e = "https://a/v1"; // c\n' };
    const cur = { "src/u.ts": 'export const e = "https://b/v2"; // c\n' };
    const s = classify(base, cur);
    expect(s.k1).toBe(false); // doc-comment unchanged; `//` in the string is not a comment (AST-correct)
  });
});

// ===========================================================================
// SC-15 — cost budget + lazy gate (LANDED; cost-gate.ts committed 23805c4)
// Drives the REAL CLI subprocess (npx tsx cost-gate.ts --cwd <dir> --json) and asserts
// the process exit code + JSON verdict — not just the in-process pure functions.
// ===========================================================================

describe("SC-15 — cost-gate CLI: over-maxFiles aborts, under-budget passes", () => {
  const CLI = path.join(__dirname, "../understand/cost-gate.ts");
  const runCli = (dir: string) => {
    const r = spawnSync("npx", ["tsx", CLI, "--cwd", dir, "--json"], { encoding: "utf8" });
    return { status: r.status, result: JSON.parse((r.stdout || "").trim()) };
  };

  it("synthetic input exceeding maxFiles → gate:abort + exit 1, reason present", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-sc15-abort-"));
    try {
      fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
      // Lower maxFiles via settings so a tiny corpus trips the hard file-count gate (no 3000-file write).
      fs.writeFileSync(path.join(dir, ".guild", "settings.json"),
        JSON.stringify({ models: { knowledge: { maxFiles: 1, maxTokens: 1_000_000 } } }));
      fs.writeFileSync(path.join(dir, "a.ts"), "x");
      fs.writeFileSync(path.join(dir, "b.ts"), "y");
      const { status, result } = runCli(dir);
      expect(result.gate).toBe("abort");
      expect(status).toBe(1); // real process exit code
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("under-budget input → gate:pass + exit 0, reason present (not a silent run)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-sc15-pass-"));
    try {
      fs.writeFileSync(path.join(dir, "only.ts"), "x"); // 1 file, default maxFiles 3000
      const { status, result } = runCli(dir);
      expect(result.gate).toBe("pass");
      expect(status).toBe(0);
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// SC-8 — entrypoint-sameness (LANDED; L6 knowledge-orchestrator committed a35f778/0c89224/8cc3999)
// Drives the REAL committed CLI 3-phase flow (round1 → frozen judgments → round2 → frozen
// judgments → finalize) under 3 distinct trigger invocations (different run-id + generated-at,
// identical frozen judgments). The LLM layer is FROZEN; only the trigger path varies. Byte-diffs
// BOTH SC-8 members (knowledge-graph.json + knowledge-recall.json); the provenance sidecar is excluded.
// ===========================================================================

describe("SC-8 — byte-identical projection across all 3 triggers (real orchestrator CLI)", () => {
  const CLI = path.join(__dirname, "../understand/knowledge-orchestrator.ts");
  const CORPUS = [
    "index.md", "docs/overview.md", "docs/ingestion.md", "docs/validation.md",
    "docs/storage.md", "docs/concepts.md", "src/ingest.ts", "src/validate.ts",
    "src/store.ts", "diagrams/architecture.svg",
  ];
  const rd = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
  const wr = (f: string, o: unknown) => fs.writeFileSync(f, JSON.stringify(o, null, 2) + "\n");
  const phase = (cwd: string, p: string, runId: string, genAt: string) =>
    spawnSync("npx", ["tsx", CLI, `--phase=${p}`, "--cwd", cwd, "--run-id", runId, "--generated-at", genAt], { encoding: "utf8" });

  // Frozen-judgment fill — keys are READ from the emitted candidate files (not hardcoded),
  // so the judgments are deterministic but never invent off-candidate keys (SC-9).
  const fillK1toK4 = (runDir: string) => {
    const k1 = rd(path.join(runDir, "k1-candidates.json"));
    wr(path.join(runDir, "k1-judgments.json"), {
      schema_version: "guild.knowledge.judgments.v1", stage: "k1",
      concepts: Object.fromEntries(k1.doc_comment_candidates.map((c: any) => [c.candidate_key, { name: "Concept", confidence: "high" }])),
      claims: Object.fromEntries(k1.claim_sections.slice(0, 3).map((c: any) => [c.candidate_key, { accepted: true, importance_score: 0.8 }])),
      entities: Object.fromEntries(k1.heading_candidates.filter((h: any) => h.relPath === "docs/concepts.md" && h.level === 2).map((h: any) => [h.candidate_key, { accepted: true }])),
    });
    const k4 = rd(path.join(runDir, "k4-candidates.json"));
    wr(path.join(runDir, "k4-judgments.json"), {
      schema_version: "guild.knowledge.judgments.v1", stage: "k4",
      topics: Object.fromEntries(k4.topic_inputs.map((t: any) => [t.topicId, { name: `Topic ${t.topicId.slice(6, 10)}`, parent: null, importance_score: 0.7, sourceRef: "docs/overview.md#overview" }])),
      domains: k4.domain_candidates.length ? { [k4.domain_candidates[0].candidate_key]: { name: "Knowledge Domain", topicIds: [k4.domain_candidates[0].primary_topicId], sourceRef: "docs/overview.md#overview" } } : {},
    });
    const k2p = path.join(runDir, "k2-candidates.json");
    if (fs.existsSync(k2p)) {
      const k2 = rd(k2p);
      wr(path.join(runDir, "k2-judgments.json"), {
        schema_version: "guild.knowledge.judgments.v1", stage: "k2",
        pages: Object.fromEntries((k2.pages || []).map((p: any) => [p.id, { category: "reference", importance: "medium", labels: ["x"] }])),
      });
    }
  };
  const fillK5 = (runDir: string) => {
    const k5 = rd(path.join(runDir, "k5-candidates.json"));
    wr(path.join(runDir, "k5-judgments.json"), {
      schema_version: "guild.knowledge.judgments.v1", stage: "k5",
      edges: Object.fromEntries(k5.cross_link_candidates.map((c: any) => [c.candidate_key, { weight: 0.9 }])),
    });
  };

  const runTrigger = (runId: string, genAt: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-sc8-"));
    try {
      for (const rel of CORPUS) {
        const d = path.join(dir, rel);
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(path.join(FIX, rel), d);
      }
      const runDir = path.join(dir, ".guild", "runs", runId, "knowledge");
      for (const [p, fill] of [["round1", fillK1toK4], ["round2", fillK5], ["finalize", null]] as const) {
        const r = phase(dir, p, runId, genAt);
        if (r.status !== 0) throw new Error(`phase ${p} failed (status ${r.status}): ${r.stderr}`);
        if (fill) fill(runDir);
      }
      const idx = path.join(dir, ".guild", "indexes");
      return {
        runId,
        graph: fs.readFileSync(path.join(idx, "knowledge-graph.json"), "utf8"),
        links: fs.readFileSync(path.join(idx, "knowledge-recall.json"), "utf8"),
        prov: fs.readFileSync(path.join(idx, "knowledge-recall-provenance.json"), "utf8"),
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  // The 3 production triggers all call the SAME runKnowledgeStages entrypoint; we simulate them
  // as 3 invocations with DIFFERENT run-id + generated-at but IDENTICAL frozen judgments.
  let runs: ReturnType<typeof runTrigger>[] = [];
  beforeAll(() => {
    runs = [
      runTrigger("run-learn-knowledge", "2026-01-01T00:00:00Z"),
      runTrigger("run-full-learn", "2026-06-15T12:34:56Z"),
      runTrigger("run-init-learn", "2026-12-31T23:59:59Z"),
    ];
  }, 120000);

  it("knowledge-graph.json is byte-identical across all 3 trigger invocations", () => {
    expect(runs[1].graph).toBe(runs[0].graph);
    expect(runs[2].graph).toBe(runs[0].graph);
  });

  it("knowledge-recall.json is byte-identical across all 3 trigger invocations", () => {
    expect(runs[1].links).toBe(runs[0].links);
    expect(runs[2].links).toBe(runs[0].links);
  });

  it("the projection is non-trivial v2 output (the entrypoint actually ran the pipeline)", () => {
    const g = JSON.parse(runs[0].graph);
    expect(g.version).toBe("guild.knowledge_graph.v2");
    expect(g.nodes.length).toBeGreaterThan(0);
  });

  it("run_id appears ONLY in the provenance sidecar — never in the byte-set members (nonce-free)", () => {
    for (const r of runs) {
      expect(r.graph.includes(r.runId)).toBe(false);
      expect(r.links.includes(r.runId)).toBe(false);
      expect(r.prov.includes(r.runId)).toBe(true);
    }
  });

  it("generated-at does not leak into either byte-set member", () => {
    expect(runs[0].graph).not.toContain("2026-01-01");
    expect(runs[0].links).not.toContain("2026-01-01");
  });
});

describe("PENDING — fill as the owning lane gates", () => {
  it.todo("SC-10 (L7 benchmark UI): a headless assertion confirms (a) subtopic_of tree >=3 deep, (b) >=1 classified+labeled wiki_page cluster, (c) >=1 cross-modal evidenced_by edge between a doc/wiki node and a code node");
});
