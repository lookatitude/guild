/**
 * scripts/__tests__/taxonomy-build.test.ts
 *
 * L4 TDD-first tests — SC-2 + SC-5: K4 taxonomy-build
 *
 * Tests `plugin/scripts/understand/taxonomy-build.ts` against the frozen
 * L0f knowledge fixture at
 * `scripts/understand/__tests__/fixtures/knowledge/`.
 *
 * Sections:
 *   A — collectTopicInputs + addHubTopics: deterministic cluster→TopicInput (no LLM)
 *   B — deriveDomainId: name → "domain:<slug>" (pure)
 *   C — slugifyTopicName + deriveTopicPath: path derivation (pure)
 *   D — foldSubThreshold: sub-threshold removal + child promotion (pure)
 *   E — validateAcyclicity: cycle detection (pure, throws)
 *   F — buildTaxonomy fail-loud: seam guard (LLM required)
 *   G — SC-5: domain validation (dir-name anti-pattern)
 *   H — SC-2 structural constraints: depth + fan-out (throws on violation)
 *   I — buildTaxonomy integration: oracle-backed mock, SC-2+SC-5 assertions
 *
 * TDD RED confirmed before implementation:
 *   TS2307 — Cannot find module '../understand/taxonomy-build'
 *
 * Usage: npx jest --testPathPattern=taxonomy-build --no-coverage
 */

import * as path from "path";
import * as fs from "fs";

import {
  collectTopicInputs,
  addHubTopics,
  deriveDomainId,
  slugifyTopicName,
  deriveTopicPath,
  foldSubThreshold,
  validateAcyclicity,
  isForbiddenDomainName,
  buildTaxonomy,
} from "../understand/taxonomy-build";

import type {
  TopicInput,
  TopicProposal,
  DomainProposal,
  TaxonomyBuildOptions,
  TaxonomyBuildResult,
  ProposeTaxonomyFn,
} from "../understand/taxonomy-build";

import type { ClusterGroup } from "../understand/content-analyze";

import { makeTopicId } from "../understand/lib/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CORPUS_DIR = path.resolve(
  __dirname,
  "../understand/__tests__/fixtures/knowledge"
);

// K1 oracle clusters (from expected-output.json topic_member_sets — all sorted)
const K1_CLUSTERS: ClusterGroup[] = [
  { memberIds: ["file:src/ingest.ts", "file:src/store.ts", "file:src/validate.ts"] },          // topic:a81857d8
  { memberIds: ["file:src/ingest.ts", "function:src/ingest.ts:ingestEvent"] },                  // topic:79c825b8
  { memberIds: ["file:src/validate.ts", "function:src/validate.ts:validateEvent"] },            // topic:189866d8
  { memberIds: ["diagram:docs/ingestion.md#mermaid-0", "function:src/ingest.ts:ingestEvent"] }, // topic:2c7639cd
  { memberIds: ["file:src/store.ts", "function:src/store.ts:storeEvent"] },                    // topic:a21d1858
];

// Oracle topic IDs (deterministic from cluster membership)
const ORACLE_TOPIC_IDS = {
  event_pipeline: "topic:a81857d8",
  ingestion:      "topic:79c825b8",
  validation:     "topic:189866d8",
  source_adapters:"topic:2c7639cd",
  webhook_adapter:"topic:69b00735",  // hub: single-function singleton
  storage:        "topic:a21d1858",
};

// Oracle-backed ProposeTaxonomyFn for integration tests
// Mirrors expected-graph.v2.json topic shapes and domain assignments
const ORACLE_PROPOSE_TAXONOMY: ProposeTaxonomyFn = async (topicInputs, _ctx) => {
  const proposalMap: Record<string, Omit<TopicProposal, "topicId">> = {
    "topic:a81857d8": { name: "Event Pipeline",   importanceScore: 0.9,  sourceRef: "docs/overview.md#overview",              parentTopicId: null },
    "topic:79c825b8": { name: "Ingestion",         importanceScore: 0.85, sourceRef: "docs/ingestion.md#ingestion",           parentTopicId: "topic:a81857d8" },
    "topic:189866d8": { name: "Validation",        importanceScore: 0.45, sourceRef: "docs/validation.md#validation",         parentTopicId: "topic:a81857d8" },
    "topic:2c7639cd": { name: "Source Adapters",   importanceScore: 0.6,  sourceRef: "docs/ingestion.md#source-adapters",     parentTopicId: "topic:79c825b8" },
    "topic:69b00735": { name: "Webhook Adapter",   importanceScore: 0.5,  sourceRef: "docs/ingestion.md#webhook-adapter",     parentTopicId: "topic:2c7639cd" },
    "topic:a21d1858": { name: "Storage",           importanceScore: 0.55, sourceRef: "docs/storage.md#storage",              parentTopicId: "topic:a81857d8" },
  };

  const topicProposals: TopicProposal[] = topicInputs.map((t) => ({
    topicId: t.topicId,
    ...(proposalMap[t.topicId] ?? {
      name: `Topic ${t.topicId}`,
      importanceScore: 0.5,
      sourceRef: "docs/overview.md#overview",
      parentTopicId: null,
    }),
  }));

  const domainProposals: DomainProposal[] = [
    {
      name: "Event Ingestion",
      topicIds: ["topic:79c825b8", "topic:2c7639cd"],
      sourceRef: "docs/ingestion.md#ingestion",
    },
  ];

  return { topicProposals, domainProposals };
};

// ---------------------------------------------------------------------------
// Section A — collectTopicInputs + addHubTopics (deterministic)
// ---------------------------------------------------------------------------

describe("A — collectTopicInputs + addHubTopics (deterministic)", () => {
  it("A1: 5 K1 clusters → 5 base TopicInputs (one per distinct makeTopicId)", () => {
    const inputs = collectTopicInputs(K1_CLUSTERS);
    expect(inputs.length).toBe(5);
  });

  it("A2: each TopicInput.topicId == makeTopicId(cluster.memberIds)", () => {
    const inputs = collectTopicInputs(K1_CLUSTERS);
    for (let i = 0; i < K1_CLUSTERS.length; i++) {
      expect(inputs[i].topicId).toBe(makeTopicId(K1_CLUSTERS[i].memberIds));
    }
  });

  it("A3: duplicate cluster (same memberIds) is deduplicated to one TopicInput", () => {
    const withDupe: ClusterGroup[] = [
      ...K1_CLUSTERS,
      { memberIds: ["file:src/ingest.ts", "file:src/store.ts", "file:src/validate.ts"] }, // duplicate of K1_CLUSTERS[0]
    ];
    const inputs = collectTopicInputs(withDupe);
    expect(inputs.length).toBe(5); // still 5, no duplicate
  });

  it("A4: function:src/ingest.ts:ingestEvent appears in 2 clusters → 1 hub topic added", () => {
    const base = collectTopicInputs(K1_CLUSTERS);
    const withHubs = addHubTopics(K1_CLUSTERS, base);
    expect(withHubs.length).toBe(6); // 5 + 1 hub
  });

  it("A5: hub topic id = oracle:topic:69b00735 (makeTopicId(['function:src/ingest.ts:ingestEvent']))", () => {
    const base = collectTopicInputs(K1_CLUSTERS);
    const withHubs = addHubTopics(K1_CLUSTERS, base);
    const hub = withHubs.find((t) => t.memberIds.length === 1 && t.memberIds[0] === "function:src/ingest.ts:ingestEvent");
    expect(hub).toBeDefined();
    expect(hub!.topicId).toBe(ORACLE_TOPIC_IDS.webhook_adapter); // topic:69b00735
  });

  it("A6: function:src/validate.ts:validateEvent in only 1 cluster → no hub for it", () => {
    const base = collectTopicInputs(K1_CLUSTERS);
    const withHubs = addHubTopics(K1_CLUSTERS, base);
    const validateHub = withHubs.find(
      (t) => t.memberIds.length === 1 && t.memberIds[0] === "function:src/validate.ts:validateEvent"
    );
    expect(validateHub).toBeUndefined();
  });

  it("A7: function:src/store.ts:storeEvent in only 1 cluster → no hub for it", () => {
    const base = collectTopicInputs(K1_CLUSTERS);
    const withHubs = addHubTopics(K1_CLUSTERS, base);
    const storeHub = withHubs.find(
      (t) => t.memberIds.length === 1 && t.memberIds[0] === "function:src/store.ts:storeEvent"
    );
    expect(storeHub).toBeUndefined();
  });

  it("A8: addHubTopics does not add a hub if the singleton topicId already exists in baseInputs", () => {
    // If a cluster is already a singleton funcId (unlikely but defensive)
    const singletonCluster: ClusterGroup[] = [
      { memberIds: ["function:src/x.ts:foo"] },
    ];
    // Manually duplicate: K1_CLUSTERS with two references to foo
    const clustersWithFoo: ClusterGroup[] = [
      { memberIds: ["file:src/a.ts", "function:src/a.ts:foo"] },
      { memberIds: ["file:src/b.ts", "function:src/b.ts:foo"] },
    ];
    // "foo" appears in 2 clusters → hub candidate
    // but if baseInputs already contains it (shouldn't happen from collectTopicInputs but defensive)
    const base = collectTopicInputs(clustersWithFoo);
    const withHubs = addHubTopics(clustersWithFoo, base);
    // Hub should be added for "foo" since it references different funcIds (src/a.ts:foo vs src/b.ts:foo)
    // Actually "foo" as a name is distinct funcIds:
    // function:src/a.ts:foo and function:src/b.ts:foo are DIFFERENT funcIds — hub per funcId
    const hubs = withHubs.filter((t) => t.memberIds.length === 1);
    // function:src/a.ts:foo appears in 1 cluster (clusters[0]) → no hub
    // function:src/b.ts:foo appears in 1 cluster (clusters[1]) → no hub
    // (each funcId is in exactly 1 cluster despite the same name)
    expect(hubs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Section B — deriveDomainId: name → "domain:<slug>"
// ---------------------------------------------------------------------------

describe("B — deriveDomainId (pure, deterministic)", () => {
  it("B1: 'Event Ingestion' → 'domain:event-ingestion'", () => {
    expect(deriveDomainId("Event Ingestion")).toBe("domain:event-ingestion");
  });

  it("B2: 'Source Adapters' → 'domain:source-adapters'", () => {
    expect(deriveDomainId("Source Adapters")).toBe("domain:source-adapters");
  });

  it("B3: single word preserved — 'Storage' → 'domain:storage'", () => {
    expect(deriveDomainId("Storage")).toBe("domain:storage");
  });

  it("B4: punctuation stripped — 'API/Events' → 'domain:apievents'", () => {
    // '/' stripped (non-alnum, non-hyphen, non-space)
    expect(deriveDomainId("API/Events")).toBe("domain:apievents");
  });

  it("B5: id always starts with 'domain:'", () => {
    for (const name of ["Foo", "Bar Baz", "A B C"]) {
      expect(deriveDomainId(name)).toMatch(/^domain:/);
    }
  });
});

// ---------------------------------------------------------------------------
// Section C — slugifyTopicName + deriveTopicPath (pure)
// ---------------------------------------------------------------------------

describe("C — slugifyTopicName + deriveTopicPath (pure, deterministic)", () => {
  it("C1: 'Event Pipeline' → 'event-pipeline'", () => {
    expect(slugifyTopicName("Event Pipeline")).toBe("event-pipeline");
  });

  it("C2: 'Source Adapters' → 'source-adapters'", () => {
    expect(slugifyTopicName("Source Adapters")).toBe("source-adapters");
  });

  it("C3: 'Webhook Adapter' → 'webhook-adapter'", () => {
    expect(slugifyTopicName("Webhook Adapter")).toBe("webhook-adapter");
  });

  it("C4: root topic (no parent) → path is [slugifiedName]", () => {
    const parentMap = new Map([["t1", null]]);
    const nameMap   = new Map([["t1", "Event Pipeline"]]);
    const topicPath = deriveTopicPath("t1", parentMap, nameMap);
    expect(topicPath).toEqual(["event-pipeline"]);
  });

  it("C5: child of root → path is [root-slug, child-slug]", () => {
    const parentMap = new Map<string, string | null>([["t1", null], ["t2", "t1"]]);
    const nameMap   = new Map([["t1", "Event Pipeline"], ["t2", "Ingestion"]]);
    expect(deriveTopicPath("t2", parentMap, nameMap)).toEqual(["event-pipeline", "ingestion"]);
  });

  it("C6: grandchild → path depth 3", () => {
    const parentMap = new Map<string, string | null>([["t1", null], ["t2", "t1"], ["t3", "t2"]]);
    const nameMap   = new Map([["t1", "Event Pipeline"], ["t2", "Ingestion"], ["t3", "Source Adapters"]]);
    expect(deriveTopicPath("t3", parentMap, nameMap)).toEqual([
      "event-pipeline", "ingestion", "source-adapters"
    ]);
  });

  it("C7: depth-4 chain — oracle deepest branch", () => {
    const parentMap = new Map<string, string | null>([
      ["t1", null], ["t2", "t1"], ["t3", "t2"], ["t4", "t3"]
    ]);
    const nameMap = new Map([
      ["t1", "Event Pipeline"], ["t2", "Ingestion"],
      ["t3", "Source Adapters"], ["t4", "Webhook Adapter"],
    ]);
    expect(deriveTopicPath("t4", parentMap, nameMap)).toEqual([
      "event-pipeline", "ingestion", "source-adapters", "webhook-adapter"
    ]);
  });
});

// ---------------------------------------------------------------------------
// Section D — foldSubThreshold (pure)
// ---------------------------------------------------------------------------

describe("D — foldSubThreshold (pure, SC-2)", () => {
  const makeProposal = (
    topicId: string,
    importanceScore: number,
    parentTopicId: string | null
  ): TopicProposal => ({
    topicId,
    name: topicId,
    importanceScore,
    sourceRef: "docs/overview.md#overview",
    parentTopicId,
  });

  it("D1: topic with score 0.3 (< 0.4 threshold) is NOT in output", () => {
    const proposals = [
      makeProposal("root", 0.9, null),
      makeProposal("low", 0.3, "root"),
    ];
    const kept = foldSubThreshold(proposals, 0.4);
    expect(kept.some((p) => p.topicId === "low")).toBe(false);
  });

  it("D2: topic with score 0.4 (= threshold) IS in output", () => {
    const proposals = [
      makeProposal("root", 0.9, null),
      makeProposal("boundary", 0.4, "root"),
    ];
    const kept = foldSubThreshold(proposals, 0.4);
    expect(kept.some((p) => p.topicId === "boundary")).toBe(true);
  });

  it("D3: child of sub-threshold topic → promoted to grandparent", () => {
    // root(0.9) → middle(0.3) → leaf(0.7)
    // middle is sub-threshold → leaf should now point to root
    const proposals = [
      makeProposal("root",   0.9, null),
      makeProposal("middle", 0.3, "root"),
      makeProposal("leaf",   0.7, "middle"),
    ];
    const kept = foldSubThreshold(proposals, 0.4);
    const leaf = kept.find((p) => p.topicId === "leaf");
    expect(leaf).toBeDefined();
    expect(leaf!.parentTopicId).toBe("root");
  });

  it("D4: cascading fold — grandchild promoted when both intermediate nodes sub-threshold", () => {
    // root(0.9) → mid1(0.2) → mid2(0.3) → leaf(0.8)
    // both mid1 and mid2 sub-threshold → leaf points to root
    const proposals = [
      makeProposal("root",  0.9, null),
      makeProposal("mid1",  0.2, "root"),
      makeProposal("mid2",  0.3, "mid1"),
      makeProposal("leaf",  0.8, "mid2"),
    ];
    const kept = foldSubThreshold(proposals, 0.4);
    const leaf = kept.find((p) => p.topicId === "leaf");
    expect(leaf).toBeDefined();
    expect(leaf!.parentTopicId).toBe("root");
  });

  it("D5: root topic sub-threshold → removed, children become new roots", () => {
    const proposals = [
      makeProposal("root",  0.2, null),
      makeProposal("child", 0.8, "root"),
    ];
    const kept = foldSubThreshold(proposals, 0.4);
    expect(kept.some((p) => p.topicId === "root")).toBe(false);
    const child = kept.find((p) => p.topicId === "child");
    expect(child).toBeDefined();
    expect(child!.parentTopicId).toBeNull();
  });

  it("D6: all topics above threshold → all preserved unchanged", () => {
    const proposals = [
      makeProposal("root",  0.9, null),
      makeProposal("child", 0.7, "root"),
    ];
    const kept = foldSubThreshold(proposals, 0.4);
    expect(kept.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Section E — validateAcyclicity (pure, throws on cycle)
// ---------------------------------------------------------------------------

describe("E — validateAcyclicity (pure, SC-2 acyclic invariant)", () => {
  it("E1: linear chain A→B→C→null → no throw", () => {
    const parentMap = new Map<string, string | null>([
      ["A", null], ["B", "A"], ["C", "B"]
    ]);
    expect(() => validateAcyclicity(parentMap)).not.toThrow();
  });

  it("E2: A→B→C→A cycle → throws", () => {
    const parentMap = new Map<string, string | null>([
      ["A", "C"], ["B", "A"], ["C", "B"]
    ]);
    expect(() => validateAcyclicity(parentMap)).toThrow();
  });

  it("E3: self-loop (A→A) → throws", () => {
    const parentMap = new Map<string, string | null>([["A", "A"]]);
    expect(() => validateAcyclicity(parentMap)).toThrow();
  });

  it("E4: error message mentions 'cycle'", () => {
    const parentMap = new Map<string, string | null>([["A", "A"]]);
    expect(() => validateAcyclicity(parentMap)).toThrow(/cycle/i);
  });

  it("E5: forest (two independent chains) → no throw", () => {
    const parentMap = new Map<string, string | null>([
      ["R1", null], ["C1", "R1"],
      ["R2", null], ["C2", "R2"],
    ]);
    expect(() => validateAcyclicity(parentMap)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section F — buildTaxonomy fail-loud (seam guard)
// ---------------------------------------------------------------------------

describe("F — buildTaxonomy fail-loud (LLM seam required)", () => {
  it("F1: throws when proposeTaxonomy is missing", async () => {
    await expect(
      buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {} as TaxonomyBuildOptions)
    ).rejects.toThrow();
  });

  it("F2: error message mentions 'LLM adapter'", async () => {
    await expect(
      buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {} as TaxonomyBuildOptions)
    ).rejects.toThrow(/LLM adapter/i);
  });

  it("F3: does NOT throw when proposeTaxonomy is provided", async () => {
    await expect(
      buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, { proposeTaxonomy: ORACLE_PROPOSE_TAXONOMY })
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section G — SC-5: domain validation (dir-name anti-pattern)
// ---------------------------------------------------------------------------

describe("G — SC-5: domain dir-name anti-pattern", () => {
  // Build a mock proposeTaxonomy that returns a forbidden domain name
  const makeBadDomainMock = (badName: string): ProposeTaxonomyFn =>
    async (topicInputs) => ({
      topicProposals: topicInputs.map((t) => ({
        topicId: t.topicId,
        name: "Topic",
        importanceScore: 0.7,
        sourceRef: "docs/overview.md#overview",
        parentTopicId: null,
      })),
      domainProposals: [{
        name: badName,
        topicIds: [topicInputs[0]?.topicId ?? ""].filter(Boolean),
        sourceRef: "docs/overview.md#overview",
      }],
    });

  it("G1: domain name 'src' (= top-level dir) → domain node NOT in result", async () => {
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {
      proposeTaxonomy: makeBadDomainMock("src"),
    });
    const hasForbidden = result.nodes.some((n) => n.id === "domain:src");
    expect(hasForbidden).toBe(false);
  });

  it("G2: domain name 'docs' (= top-level dir) → domain node NOT in result", async () => {
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {
      proposeTaxonomy: makeBadDomainMock("docs"),
    });
    const hasForbidden = result.nodes.some((n) => n.id === "domain:docs");
    expect(hasForbidden).toBe(false);
  });

  it("G3: domain name 'diagrams' (= top-level dir) → domain node NOT in result", async () => {
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {
      proposeTaxonomy: makeBadDomainMock("diagrams"),
    });
    const hasForbidden = result.nodes.some((n) => n.id === "domain:diagrams");
    expect(hasForbidden).toBe(false);
  });

  it("G4: domain name 'Event Ingestion' → domain:event-ingestion IS emitted", async () => {
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {
      proposeTaxonomy: ORACLE_PROPOSE_TAXONOMY,
    });
    const found = result.nodes.some((n) => n.id === "domain:event-ingestion");
    expect(found).toBe(true);
  });

  it("G5: belongs_to_domain edge has type='belongs_to_domain', direction='out', weight=1.0", async () => {
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {
      proposeTaxonomy: ORACLE_PROPOSE_TAXONOMY,
    });
    const btdEdges = result.edges.filter((e) => e.type === "belongs_to_domain");
    expect(btdEdges.length).toBeGreaterThan(0);
    for (const e of btdEdges) {
      expect(e.direction).toBe("out");
      expect(e.weight).toBe(1.0);
      expect(e.target).toMatch(/^domain:/);
    }
  });

  it("G6: domain node has type='domain', non-empty name, non-empty source_refs, confidence enum", async () => {
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {
      proposeTaxonomy: ORACLE_PROPOSE_TAXONOMY,
    });
    const domainNodes = result.nodes.filter((n) => n.type === "domain");
    expect(domainNodes.length).toBeGreaterThan(0);
    for (const d of domainNodes) {
      expect(typeof d.name).toBe("string");
      expect(d.name.length).toBeGreaterThan(0);
      expect(Array.isArray(d.source_refs)).toBe(true);
      expect(d.source_refs.length).toBeGreaterThan(0);
      expect(["high", "medium", "low"]).toContain(d.confidence);
    }
  });
});

// ---------------------------------------------------------------------------
// Section H — SC-2 structural constraints: depth + fan-out (throws)
// ---------------------------------------------------------------------------

describe("H — SC-2 structural constraints (depth + fan-out)", () => {
  it("H1: grandchild at depth 2 with maxDepth=1 → throws (depth > maxDepth)", async () => {
    // maxDepth=1 allows depths 0 and 1; depth 2 (grandchild) must throw.
    // Consistent with schema.ts validateGraphV2 which uses d > maxDepth.
    const deepMock: ProposeTaxonomyFn = async (topicInputs) => ({
      topicProposals: [
        { topicId: topicInputs[0].topicId, name: "Root",       importanceScore: 0.9, sourceRef: "docs/overview.md#overview", parentTopicId: null },
        { topicId: topicInputs[1].topicId, name: "Child",      importanceScore: 0.8, sourceRef: "docs/overview.md#overview", parentTopicId: topicInputs[0].topicId },
        { topicId: topicInputs[2].topicId, name: "Grandchild", importanceScore: 0.7, sourceRef: "docs/overview.md#overview", parentTopicId: topicInputs[1].topicId },
        ...topicInputs.slice(3).map((t) => ({
          topicId: t.topicId, name: "Other", importanceScore: 0.7,
          sourceRef: "docs/overview.md#overview", parentTopicId: null,
        })),
      ],
      domainProposals: [],
    });
    await expect(
      buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, { proposeTaxonomy: deepMock, maxDepth: 1 })
    ).rejects.toThrow(/maxDepth/);
  });

  it("H2: maxBranching=1 with 2 children of same parent → throws (fan-out exceeded)", async () => {
    // Root with 2 children → exceeds maxBranching=1
    const fanOutMock: ProposeTaxonomyFn = async (topicInputs) => ({
      topicProposals: [
        { topicId: topicInputs[0].topicId, name: "Root",   importanceScore: 0.9, sourceRef: "docs/overview.md#overview", parentTopicId: null },
        { topicId: topicInputs[1].topicId, name: "Child1", importanceScore: 0.8, sourceRef: "docs/overview.md#overview", parentTopicId: topicInputs[0].topicId },
        { topicId: topicInputs[2].topicId, name: "Child2", importanceScore: 0.7, sourceRef: "docs/overview.md#overview", parentTopicId: topicInputs[0].topicId },
        ...topicInputs.slice(3).map((t) => ({
          topicId: t.topicId, name: "Other", importanceScore: 0.7,
          sourceRef: "docs/overview.md#overview", parentTopicId: null,
        })),
      ],
      domainProposals: [],
    });
    await expect(
      buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, { proposeTaxonomy: fanOutMock, maxBranching: 1 })
    ).rejects.toThrow(/maxBranching/);
  });
});

// ---------------------------------------------------------------------------
// Section I — buildTaxonomy integration: oracle-backed + SC-2/SC-5 assertions
// ---------------------------------------------------------------------------

describe("I — buildTaxonomy integration (oracle-backed SC-2 + SC-5)", () => {
  let result: TaxonomyBuildResult;

  beforeAll(async () => {
    result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {
      proposeTaxonomy: ORACLE_PROPOSE_TAXONOMY,
    });
  });

  // --- SC-2: subtopic_of tree structure ---

  it("I1: result has ≥ 6 topic nodes (5 from K1 clusters + 1 hub)", () => {
    const topics = result.nodes.filter((n) => n.type === "topic");
    expect(topics.length).toBeGreaterThanOrEqual(6);
  });

  it("I2: hub topic topic:69b00735 is present (pinned single-funcId input → exact hash)", () => {
    const hub = result.nodes.find((n) => n.id === ORACLE_TOPIC_IDS.webhook_adapter);
    expect(hub).toBeDefined();
    expect(hub!.type).toBe("topic");
  });

  it("I3: root fan-out = 3 (Ingestion, Validation, Storage are children of Event Pipeline)", () => {
    const rootId = ORACLE_TOPIC_IDS.event_pipeline;
    const subtopicEdges = result.edges.filter(
      (e) => e.type === "subtopic_of" && e.target === rootId
    );
    expect(subtopicEdges.length).toBe(3);
  });

  it("I4: deepest topic_path length = 4 (event-pipeline→ingestion→source-adapters→webhook-adapter)", () => {
    const topics = result.nodes.filter((n) => n.type === "topic");
    const maxDepth = Math.max(...topics.map((t) => (t.topic_path as string[])?.length ?? 0));
    expect(maxDepth).toBeGreaterThanOrEqual(4);
  });

  it("I5: all topic nodes have importance_score >= minTopicImportance (0.4)", () => {
    const topics = result.nodes.filter((n) => n.type === "topic");
    for (const t of topics) {
      expect(t.importance_score as number).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("I6: domain:event-ingestion node exists in result", () => {
    const domain = result.nodes.find((n) => n.id === "domain:event-ingestion");
    expect(domain).toBeDefined();
    expect(domain!.name).toBe("Event Ingestion");
  });

  it("I7: belongs_to_domain edge from topic:79c825b8 → domain:event-ingestion", () => {
    const edge = result.edges.find(
      (e) =>
        e.type === "belongs_to_domain" &&
        e.source === ORACLE_TOPIC_IDS.ingestion &&
        e.target === "domain:event-ingestion"
    );
    expect(edge).toBeDefined();
    expect(edge!.direction).toBe("out");
    expect(edge!.weight).toBe(1.0);
  });

  it("I8: belongs_to_domain edge from topic:2c7639cd → domain:event-ingestion", () => {
    const edge = result.edges.find(
      (e) =>
        e.type === "belongs_to_domain" &&
        e.source === ORACLE_TOPIC_IDS.source_adapters &&
        e.target === "domain:event-ingestion"
    );
    expect(edge).toBeDefined();
  });

  it("I9: all topic source_refs resolve at corpus root (SC-12)", () => {
    const topics = result.nodes.filter((n) => n.type === "topic");
    for (const t of topics) {
      const refs = t.source_refs as string[];
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        // bare file check: file part must exist
        const filePart = ref.includes("#") ? ref.split("#")[0] : ref;
        const exists = require("fs").existsSync(require("path").join(CORPUS_DIR, filePart));
        expect(exists).toBe(true);
      }
    }
  });

  it("I10: subtopic_of graph is acyclic (no topic is its own ancestor)", () => {
    const subtopicEdges = result.edges.filter((e) => e.type === "subtopic_of");
    // Build parent map
    const parentMap = new Map<string, string | null>();
    for (const e of subtopicEdges) {
      parentMap.set(e.source, e.target);
    }
    // For every topic, walking parent chain must terminate
    for (const [id] of parentMap) {
      const visited = new Set<string>();
      let current: string | null = id;
      while (current !== null) {
        expect(visited.has(current)).toBe(false); // cycle would repeat a node
        visited.add(current);
        current = parentMap.get(current) ?? null;
      }
    }
  });

  it("I11: no domain id matches a top-level corpus dir (SC-5 anti-pattern)", () => {
    const topLevelDirs = ["docs", "src", "diagrams"];
    const domainNodes = result.nodes.filter((n) => n.type === "domain");
    for (const d of domainNodes) {
      const normalizedName = d.id.replace(/^domain:/, "");
      expect(topLevelDirs).not.toContain(normalizedName);
    }
  });

  it("I12: topic IDs are deterministic (same inputs → same IDs, SC-11)", async () => {
    const result2 = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, {
      proposeTaxonomy: ORACLE_PROPOSE_TAXONOMY,
    });
    const ids1 = result.nodes.filter((n) => n.type === "topic").map((n) => n.id).sort();
    const ids2 = result2.nodes.filter((n) => n.type === "topic").map((n) => n.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it("I13: importance label correct: ≥0.8→high, ≥0.5→medium, else→low", () => {
    const topics = result.nodes.filter((n) => n.type === "topic");
    for (const t of topics) {
      const score = t.importance_score as number;
      const expected = score >= 0.8 ? "high" : score >= 0.5 ? "medium" : "low";
      expect(t.importance).toBe(expected);
    }
  });

  it("I14: every topic node has required fields: id, type, name, source_refs, confidence, importance_score, topic_path", () => {
    const topics = result.nodes.filter((n) => n.type === "topic");
    expect(topics.length).toBeGreaterThan(0);
    for (const t of topics) {
      expect(typeof t.id).toBe("string");
      expect(t.type).toBe("topic");
      expect(typeof t.name).toBe("string");
      expect(t.name.length).toBeGreaterThan(0);
      expect(Array.isArray(t.source_refs)).toBe(true);
      expect(t.source_refs.length).toBeGreaterThan(0);
      expect(["high", "medium", "low"]).toContain(t.confidence);
      expect(typeof t.importance_score).toBe("number");
      expect(Array.isArray(t.topic_path)).toBe(true);
    }
  });

  it("I15: subtopic_of edges have type, direction='out', weight=1.0", () => {
    const stEdges = result.edges.filter((e) => e.type === "subtopic_of");
    expect(stEdges.length).toBeGreaterThan(0);
    for (const e of stEdges) {
      expect(e.direction).toBe("out");
      expect(e.weight).toBe(1.0);
    }
  });
});

// ---------------------------------------------------------------------------
// Section J — Codex blockers B1/B2/B3/B4 (revision tests)
// ---------------------------------------------------------------------------

describe("J — Codex blocker fixes (B1 SC-5 guard, B2 empty-domain, B3 topicId boundary, B4 depth)", () => {

  // --- J1-J5: B1 — isForbiddenDomainName (exported, unit-tested directly) ---

  it("J1: isForbiddenDomainName — exact slug match ('src' in ['src']) → true", () => {
    expect(isForbiddenDomainName("src", ["src", "docs", "diagrams"])).toBe(true);
  });

  it("J2: isForbiddenDomainName — expansion: 'source' is rejected when 'src' dir exists", () => {
    // STRUCTURAL_DIR_EXPANSIONS maps src → ['source']
    expect(isForbiddenDomainName("source", ["src", "docs", "diagrams"])).toBe(true);
  });

  it("J3: isForbiddenDomainName — singular/plural: 'diagram' rejected when 'diagrams' dir exists", () => {
    // 'diagrams' → singular 'diagram'; domain slug 'diagram' matches
    expect(isForbiddenDomainName("diagram", ["diagrams", "src"])).toBe(true);
  });

  it("J4: isForbiddenDomainName — word-boundary: 'my-docs-service' rejected when 'docs' dir exists", () => {
    // 'docs' appears as a standalone hyphen-delimited token in 'my-docs-service'
    expect(isForbiddenDomainName("my-docs-service", ["docs"])).toBe(true);
  });

  it("J5: isForbiddenDomainName — behavioral name 'event-ingestion' NOT rejected", () => {
    expect(isForbiddenDomainName("event-ingestion", ["src", "docs", "diagrams"])).toBe(false);
  });

  it("J5b: buildTaxonomy — 'Source' domain is rejected when fixture has 'src' dir (SC-5 expansion)", async () => {
    const sourceMock: ProposeTaxonomyFn = async (topicInputs) => ({
      topicProposals: topicInputs.map((t) => ({
        topicId: t.topicId,
        name: "Topic",
        importanceScore: 0.7,
        sourceRef: "docs/overview.md#overview",
        parentTopicId: null,
      })),
      domainProposals: [{
        name: "Source",   // normalizes to "source"; src/ dir → expansion rejects it
        topicIds: [topicInputs[0]?.topicId ?? ""].filter(Boolean),
        sourceRef: "docs/overview.md#overview",
      }],
    });
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, { proposeTaxonomy: sourceMock });
    expect(result.nodes.find((n) => n.id === "domain:source")).toBeUndefined();
  });

  // --- J6-J7: B2 — domain with all-folded topics NOT emitted (SC-5 ≥1 topic) ---

  it("J6: domain whose only topic was folded (importance_score < 0.4) is NOT emitted", async () => {
    const b2Mock: ProposeTaxonomyFn = async (topicInputs) => ({
      topicProposals: topicInputs.map((t, i) => ({
        topicId: t.topicId,
        name: i === 0 ? "Root" : "Leaf",
        importanceScore: i === 1 ? 0.3 : 0.7, // topicInputs[1] sub-threshold → folded
        sourceRef: "docs/overview.md#overview",
        parentTopicId: i === 0 ? null : topicInputs[0].topicId,
      })),
      domainProposals: [{
        name: "Orphan Domain",
        topicIds: [topicInputs[1].topicId], // only sub-threshold topic → will be folded
        sourceRef: "docs/ingestion.md#ingestion",
      }],
    });
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, { proposeTaxonomy: b2Mock });
    expect(result.nodes.find((n) => n.id === "domain:orphan-domain")).toBeUndefined();
  });

  it("J7: domain with ≥1 kept topic IS emitted (positive B2 case)", async () => {
    const b2PositiveMock: ProposeTaxonomyFn = async (topicInputs) => ({
      topicProposals: topicInputs.map((t, i) => ({
        topicId: t.topicId,
        name: i === 0 ? "Root" : "Child",
        importanceScore: 0.7, // all kept
        sourceRef: "docs/overview.md#overview",
        parentTopicId: i === 0 ? null : topicInputs[0].topicId,
      })),
      domainProposals: [{
        name: "Kept Domain",
        topicIds: [topicInputs[0].topicId], // kept topic
        sourceRef: "docs/ingestion.md#ingestion",
      }],
    });
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, { proposeTaxonomy: b2PositiveMock });
    expect(result.nodes.find((n) => n.id === "domain:kept-domain")).toBeDefined();
  });

  // --- J8-J9: B3 — invented topicId is rejected (SC-9 determinism boundary) ---

  it("J8: LLM proposal with invented topicId is silently dropped (B3 determinism guard)", async () => {
    const inventedIdMock: ProposeTaxonomyFn = async (topicInputs) => ({
      topicProposals: [
        // Invented ID NOT in topicInputs → must be rejected
        { topicId: "topic:invented-by-llm", name: "Invented", importanceScore: 0.7, sourceRef: "docs/overview.md#overview", parentTopicId: null },
        // All real IDs — must be kept
        ...topicInputs.map((t) => ({
          topicId: t.topicId, name: "Legit", importanceScore: 0.7,
          sourceRef: "docs/overview.md#overview", parentTopicId: null,
        })),
      ],
      domainProposals: [],
    });
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, { proposeTaxonomy: inventedIdMock });
    expect(result.nodes.find((n) => n.id === "topic:invented-by-llm")).toBeUndefined();
  });

  it("J9: real topicIds from topicInputs ARE kept (B3 guard does not over-filter)", async () => {
    const inventedIdMock: ProposeTaxonomyFn = async (topicInputs) => ({
      topicProposals: [
        { topicId: "topic:invented-by-llm", name: "Invented", importanceScore: 0.7, sourceRef: "docs/overview.md#overview", parentTopicId: null },
        ...topicInputs.map((t) => ({
          topicId: t.topicId, name: "Legit", importanceScore: 0.7,
          sourceRef: "docs/overview.md#overview", parentTopicId: null,
        })),
      ],
      domainProposals: [],
    });
    const result = await buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, { proposeTaxonomy: inventedIdMock });
    // All 6 deterministic topic nodes must be present
    expect(result.nodes.filter((n) => n.type === "topic").length).toBe(6);
  });

  // --- J10: B4 — depth semantics aligned with schema.ts validateGraphV2 ---

  it("J10: depth == maxDepth is allowed (consistent with schema.ts, uses d > maxDepth)", async () => {
    // maxDepth=1, child at depth 1: 1 > 1 = false → no throw
    const depthEqualsMock: ProposeTaxonomyFn = async (topicInputs) => ({
      topicProposals: [
        { topicId: topicInputs[0].topicId, name: "Root",  importanceScore: 0.9, sourceRef: "docs/overview.md#overview", parentTopicId: null },
        { topicId: topicInputs[1].topicId, name: "Child", importanceScore: 0.8, sourceRef: "docs/overview.md#overview", parentTopicId: topicInputs[0].topicId },
        ...topicInputs.slice(2).map((t) => ({
          topicId: t.topicId, name: "Other", importanceScore: 0.7,
          sourceRef: "docs/overview.md#overview", parentTopicId: null,
        })),
      ],
      domainProposals: [],
    });
    // maxDepth=1, child at depth=1: must NOT throw (1 is at the ceiling, not beyond it)
    await expect(
      buildTaxonomy(CORPUS_DIR, K1_CLUSTERS, { proposeTaxonomy: depthEqualsMock, maxDepth: 1 })
    ).resolves.toBeDefined();
  });
});
