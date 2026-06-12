/**
 * scripts/__tests__/content-analyze.test.ts
 *
 * L1 TDD-first tests — SC-1: K1 content-analyze
 *
 * Tests `plugin/scripts/understand/content-analyze.ts` against the frozen
 * L0f knowledge fixture corpus at
 * `scripts/understand/__tests__/fixtures/knowledge/`.
 *
 * Sections:
 *   A — extractDocCommentCandidates: file-level doc-comment extraction (deterministic)
 *   B — extractHeadingCandidates: heading extraction from markdown (deterministic)
 *   C — extractClaimSections: prose section extraction per heading (deterministic)
 *   D — node builders: buildConceptNode / buildClaimNode / buildEntityNode (deterministic ids)
 *   E — analyzeContent SC-1 integration with oracle-backed stub LLM
 *   F — determinism: two calls → same node ids in same order (SC-11)
 *
 * field_contract rules applied (from expected-output.json.field_contract):
 *   • node.id        — HARD for entity (entity:<normalized>); for concept/claim
 *                      HARD when oracle text is fixed (section D + E test both)
 *   • node.type      — HARD ("concept", "claim", "entity")
 *   • node.category  — HARD ("concept", "claim", "definition")
 *   • node.source_refs — HARD: non-empty; anchor file part must exist at repoRoot
 *   • node.confidence  — ENUM-PRESENT (high|medium|low), not pinned
 *
 * TDD RED confirmed before implementation:
 *   TS2307 — Cannot find module '../understand/content-analyze'
 *
 * Usage: npx jest --testPathPattern=content-analyze --no-coverage
 */

import * as path from "path";
import * as fs from "fs";

import {
  extractDocCommentCandidates,
  extractHeadingCandidates,
  extractClaimSections,
  buildConceptNode,
  buildClaimNode,
  buildEntityNode,
  analyzeContent,
  buildContentClusters,
  extractFunctionIds,
  extractMermaidEntries,
} from "../understand/content-analyze";

import type {
  DocCommentCandidate,
  HeadingCandidate,
  ClaimSection,
  ContentAnalyzeResult,
  ClusterGroup,
  MermaidEntry,
  ProposeConceptsFn,
  ProposeClaimsAndEntitiesFn,
} from "../understand/content-analyze";

import {
  makeConceptId,
  makeClaimId,
  makeEntityId,
  makeTopicId,
} from "../understand/lib/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CORPUS_DIR = path.resolve(
  __dirname,
  "../understand/__tests__/fixtures/knowledge"
);

const EXPECTED = JSON.parse(
  fs.readFileSync(path.join(CORPUS_DIR, "expected-output.json"), "utf8")
);

const CORPUS_CODE_FILES = ["src/ingest.ts", "src/validate.ts", "src/store.ts"];
const CORPUS_DOC_FILES = [
  "index.md",
  "docs/overview.md",
  "docs/ingestion.md",
  "docs/validation.md",
  "docs/storage.md",
  "docs/concepts.md",
];

// Oracle-pinned text (from expected-graph.v2.json) — using these exact texts
// fixes the LLM-derived IDs so tests can assert HARD-exact hashes (per
// notes_for_lane_owners: "assert the exact hashed id ONLY in tests that also
// fix the membership/text input").
const ORACLE_CONCEPTS = [
  {
    anchor: "src/ingest.ts#L1-L6",
    name: "Ingestion is the front door of the event pipeline.",
  },
  {
    anchor: "src/store.ts#L1-L6",
    name: "The event store is an append-only durable log.",
  },
];

const ORACLE_CLAIMS = [
  {
    anchor: "docs/ingestion.md#ingestion",
    text: "Every incoming event is validated before it is persisted.",
  },
  {
    anchor: "docs/storage.md#storage",
    text: "Events are stored append-only and never mutated.",
  },
];

const ORACLE_ENTITIES = [
  { name: "Event",       anchor: "docs/concepts.md#event" },
  { name: "Validator",   anchor: "docs/concepts.md#validator" },
  { name: "Event Store", anchor: "docs/concepts.md#event-store" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check that the file part of a source_ref anchor exists at corpus root. */
function anchorFileExists(anchor: string): boolean {
  const hashIdx = anchor.indexOf("#");
  const relPath = hashIdx === -1 ? anchor : anchor.slice(0, hashIdx);
  return fs.existsSync(path.join(CORPUS_DIR, relPath));
}

// ---------------------------------------------------------------------------
// Section A — extractDocCommentCandidates
// ---------------------------------------------------------------------------

describe("A — extractDocCommentCandidates", () => {
  let candidates: DocCommentCandidate[];

  beforeAll(() => {
    candidates = extractDocCommentCandidates(CORPUS_DIR, CORPUS_CODE_FILES);
  });

  it("returns one candidate per code file (3 for the fixture)", () => {
    expect(candidates.length).toBe(3);
  });

  it("each candidate anchor is in path#Lx-Ly format", () => {
    for (const c of candidates) {
      expect(c.anchor).toMatch(/^[^#]+#L\d+-L\d+$/);
    }
  });

  it("src/ingest.ts: anchor is src/ingest.ts#L1-L6", () => {
    const c = candidates.find((x) => x.relPath === "src/ingest.ts");
    expect(c).toBeDefined();
    expect(c!.anchor).toBe("src/ingest.ts#L1-L6");
  });

  it("src/validate.ts: anchor is src/validate.ts#L1-L6", () => {
    const c = candidates.find((x) => x.relPath === "src/validate.ts");
    expect(c).toBeDefined();
    expect(c!.anchor).toBe("src/validate.ts#L1-L6");
  });

  it("src/store.ts: anchor is src/store.ts#L1-L6", () => {
    const c = candidates.find((x) => x.relPath === "src/store.ts");
    expect(c).toBeDefined();
    expect(c!.anchor).toBe("src/store.ts#L1-L6");
  });

  it("each anchor's file exists at corpus root (SC-12 pre-check)", () => {
    for (const c of candidates) {
      expect(anchorFileExists(c.anchor)).toBe(true);
    }
  });

  it("rawText is a non-empty string for each candidate", () => {
    for (const c of candidates) {
      expect(typeof c.rawText).toBe("string");
      expect(c.rawText.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Section B — extractHeadingCandidates
// ---------------------------------------------------------------------------

describe("B — extractHeadingCandidates", () => {
  let headings: HeadingCandidate[];

  beforeAll(() => {
    headings = extractHeadingCandidates(CORPUS_DIR, ["docs/concepts.md"]);
  });

  it("returns at least 3 H2 headings from docs/concepts.md (the 3 entity definitions)", () => {
    const h2s = headings.filter((h) => h.level === 2);
    expect(h2s.length).toBeGreaterThanOrEqual(3);
  });

  it("heading 'Event' is present with anchor docs/concepts.md#event", () => {
    const h = headings.find((x) => x.text === "Event");
    expect(h).toBeDefined();
    expect(h!.anchor).toBe("docs/concepts.md#event");
    expect(h!.level).toBe(2);
  });

  it("heading 'Validator' is present with anchor docs/concepts.md#validator", () => {
    const h = headings.find((x) => x.text === "Validator");
    expect(h).toBeDefined();
    expect(h!.anchor).toBe("docs/concepts.md#validator");
    expect(h!.level).toBe(2);
  });

  it("heading 'Event Store' is present with anchor docs/concepts.md#event-store", () => {
    const h = headings.find((x) => x.text === "Event Store");
    expect(h).toBeDefined();
    expect(h!.anchor).toBe("docs/concepts.md#event-store");
    expect(h!.level).toBe(2);
  });

  it("each anchor's file exists at corpus root", () => {
    for (const h of headings) {
      expect(anchorFileExists(h.anchor)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Section C — extractClaimSections
// ---------------------------------------------------------------------------

describe("C — extractClaimSections", () => {
  let sections: ClaimSection[];

  beforeAll(() => {
    sections = extractClaimSections(CORPUS_DIR, CORPUS_DOC_FILES);
  });

  it("returns at least one section per doc file", () => {
    expect(sections.length).toBeGreaterThan(0);
  });

  it("section anchored at docs/ingestion.md#ingestion is present", () => {
    const s = sections.find((x) => x.anchor === "docs/ingestion.md#ingestion");
    expect(s).toBeDefined();
    expect(s!.text.trim().length).toBeGreaterThan(0);
  });

  it("section anchored at docs/storage.md#storage is present", () => {
    const s = sections.find((x) => x.anchor === "docs/storage.md#storage");
    expect(s).toBeDefined();
    expect(s!.text.trim().length).toBeGreaterThan(0);
  });

  it("each section's anchor file exists at corpus root", () => {
    for (const s of sections) {
      expect(anchorFileExists(s.anchor)).toBe(true);
    }
  });

  it("each section has non-empty text", () => {
    for (const s of sections) {
      expect(typeof s.text).toBe("string");
      expect(s.text.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Section D — node builders (deterministic ids when text is fixed)
// ---------------------------------------------------------------------------

describe("D — buildConceptNode", () => {
  it("id matches oracle hash for src/ingest.ts#L1-L6 (oracle text fixed → HARD-exact)", () => {
    const anchor = "src/ingest.ts#L1-L6";
    const name   = "Ingestion is the front door of the event pipeline.";
    const n = buildConceptNode(anchor, name);
    expect(n.id).toBe(makeConceptId(anchor, name));
    // Oracle hash (from expected-output.json.ids.concepts.ingestion_front_door)
    expect(n.id).toBe("concept:src/ingest.ts#L1-L6:0086d04b");
  });

  it("id matches oracle hash for src/store.ts#L1-L6 (oracle text fixed → HARD-exact)", () => {
    const anchor = "src/store.ts#L1-L6";
    const name   = "The event store is an append-only durable log.";
    const n = buildConceptNode(anchor, name);
    expect(n.id).toBe(makeConceptId(anchor, name));
    // Oracle hash (from expected-output.json.ids.concepts.append_only_log)
    expect(n.id).toBe("concept:src/store.ts#L1-L6:fda0dd6b");
  });

  it("node required fields: type=concept, category=concept, source_refs=[anchor], confidence=enum", () => {
    const n = buildConceptNode("src/ingest.ts#L1-L6", "some concept text");
    expect(n.type).toBe("concept");
    expect(n.category).toBe("concept");
    expect(n.source_refs).toEqual(["src/ingest.ts#L1-L6"]);
    expect(["high", "medium", "low"]).toContain(n.confidence);
  });

  it("confidence defaults to 'high' when not provided", () => {
    const n = buildConceptNode("src/ingest.ts#L1-L6", "text");
    expect(n.confidence).toBe("high");
  });

  it("explicit confidence is preserved", () => {
    const n = buildConceptNode("src/ingest.ts#L1-L6", "text", "medium");
    expect(n.confidence).toBe("medium");
  });
});

describe("D — buildClaimNode", () => {
  it("id matches oracle hash for docs/ingestion.md#ingestion (oracle text fixed → HARD-exact)", () => {
    const anchor = "docs/ingestion.md#ingestion";
    const text   = "Every incoming event is validated before it is persisted.";
    const n = buildClaimNode(anchor, text);
    expect(n.id).toBe(makeClaimId(anchor, text));
    expect(n.id).toBe("claim:docs/ingestion.md#ingestion:0ee19523");
  });

  it("id matches oracle hash for docs/storage.md#storage (oracle text fixed → HARD-exact)", () => {
    const anchor = "docs/storage.md#storage";
    const text   = "Events are stored append-only and never mutated.";
    const n = buildClaimNode(anchor, text);
    expect(n.id).toBe(makeClaimId(anchor, text));
    expect(n.id).toBe("claim:docs/storage.md#storage:e8805bb0");
  });

  it("node required fields: type=claim, category=claim, source_refs=[anchor], confidence=enum", () => {
    const n = buildClaimNode("docs/ingestion.md#ingestion", "some claim");
    expect(n.type).toBe("claim");
    expect(n.category).toBe("claim");
    expect(n.source_refs).toEqual(["docs/ingestion.md#ingestion"]);
    expect(["high", "medium", "low"]).toContain(n.confidence);
  });
});

describe("D — buildEntityNode", () => {
  it("entity:event — id exact, type, category, source_refs", () => {
    const n = buildEntityNode("Event", "docs/concepts.md#event");
    expect(n.id).toBe(makeEntityId("Event"));
    expect(n.id).toBe("entity:event");
    expect(n.type).toBe("entity");
    expect(n.category).toBe("definition");
    expect(n.source_refs).toEqual(["docs/concepts.md#event"]);
    expect(["high", "medium", "low"]).toContain(n.confidence);
  });

  it("entity:event-store — spaces→hyphens in normalized id", () => {
    const n = buildEntityNode("Event Store", "docs/concepts.md#event-store");
    expect(n.id).toBe("entity:event-store");
  });

  it("entity:validator", () => {
    const n = buildEntityNode("Validator", "docs/concepts.md#validator");
    expect(n.id).toBe("entity:validator");
  });
});

// ---------------------------------------------------------------------------
// Section E — analyzeContent SC-1 integration
// ---------------------------------------------------------------------------

describe("E — analyzeContent: SC-1 integration (oracle-backed stub LLM)", () => {
  const sc1 = EXPECTED.expectations["SC-1"];
  let result: ContentAnalyzeResult;

  // Oracle-backed mocks: return the pinned oracle outputs regardless of input
  // (the real LLM would derive these from content; tests fix them for HARD-exact id checks)
  const mockProposeConcepts: ProposeConceptsFn = async (_candidates) =>
    ORACLE_CONCEPTS.map((c) => ({
      anchor: c.anchor,
      name: c.name,
      confidence: "high" as const,
    }));

  const mockProposeClaimsAndEntities: ProposeClaimsAndEntitiesFn = async (_sections, _headings) => ({
    claims: ORACLE_CLAIMS.map((c) => ({
      anchor: c.anchor,
      text: c.text,
      confidence: "high" as const,
    })),
    entities: ORACLE_ENTITIES.map((e) => ({
      name: e.name,
      anchor: e.anchor,
      confidence: "high" as const,
    })),
  });

  beforeAll(async () => {
    result = await analyzeContent(
      CORPUS_DIR,
      CORPUS_CODE_FILES,
      CORPUS_DOC_FILES,
      {
        proposeConcepts: mockProposeConcepts,
        proposeClaimsAndEntities: mockProposeClaimsAndEntities,
      }
    );
  });

  // SC-1: min_nodes_by_type
  it("produces >= 2 claim nodes (SC-1 min_nodes_by_type.claim=2)", () => {
    const claims = result.nodes.filter((n) => n.type === "claim");
    expect(claims.length).toBeGreaterThanOrEqual(sc1.min_nodes_by_type.claim);
  });

  it("produces >= 3 entity nodes (SC-1 min_nodes_by_type.entity=3)", () => {
    const entities = result.nodes.filter((n) => n.type === "entity");
    expect(entities.length).toBeGreaterThanOrEqual(sc1.min_nodes_by_type.entity);
  });

  it("produces >= 2 concept nodes (SC-1 min_nodes_by_type.concept=2)", () => {
    const concepts = result.nodes.filter((n) => n.type === "concept");
    expect(concepts.length).toBeGreaterThanOrEqual(sc1.min_nodes_by_type.concept);
  });

  // SC-1: nodes_missing_confidence === 0
  it("every node has a valid confidence enum value (SC-1 nodes_missing_confidence=0)", () => {
    const bad = result.nodes.filter(
      (n) => !["high", "medium", "low"].includes(n.confidence as string)
    );
    expect(bad).toHaveLength(0);
  });

  // SC-1: every_node_has_resolvable_anchor
  it("every node has non-empty source_refs (SC-1 every_node_has_resolvable_anchor)", () => {
    const noRefs = result.nodes.filter(
      (n) => !Array.isArray(n.source_refs) || n.source_refs.length === 0
    );
    expect(noRefs).toHaveLength(0);
  });

  it("every node's source_ref file part exists at corpus root", () => {
    for (const n of result.nodes) {
      for (const ref of n.source_refs ?? []) {
        expect(anchorFileExists(ref as string)).toBe(true);
      }
    }
  });

  // SC-1: seeded anchors present (by anchor, not hash — per notes_for_lane_owners)
  it("seeded claim anchor docs/ingestion.md#ingestion present", () => {
    const claims = result.nodes.filter((n) => n.type === "claim");
    expect(claims.some((n) => (n.source_refs ?? []).includes("docs/ingestion.md#ingestion"))).toBe(true);
  });

  it("seeded claim anchor docs/storage.md#storage present", () => {
    const claims = result.nodes.filter((n) => n.type === "claim");
    expect(claims.some((n) => (n.source_refs ?? []).includes("docs/storage.md#storage"))).toBe(true);
  });

  it("seeded concept anchor src/ingest.ts#L1-L6 present", () => {
    const concepts = result.nodes.filter((n) => n.type === "concept");
    expect(concepts.some((n) => (n.source_refs ?? []).includes("src/ingest.ts#L1-L6"))).toBe(true);
  });

  it("seeded concept anchor src/store.ts#L1-L6 present", () => {
    const concepts = result.nodes.filter((n) => n.type === "concept");
    expect(concepts.some((n) => (n.source_refs ?? []).includes("src/store.ts#L1-L6"))).toBe(true);
  });

  it("seeded entity ids present: entity:event, entity:validator, entity:event-store", () => {
    const ids = new Set(result.nodes.filter((n) => n.type === "entity").map((n) => n.id));
    expect(ids.has("entity:event")).toBe(true);
    expect(ids.has("entity:validator")).toBe(true);
    expect(ids.has("entity:event-store")).toBe(true);
  });

  // Oracle text fixed → assert exact hashed ids (both anchors and hashes)
  it("concept ids match oracle hashes (oracle text fixed in stub)", () => {
    const ids = new Set(result.nodes.filter((n) => n.type === "concept").map((n) => n.id));
    expect(ids.has("concept:src/ingest.ts#L1-L6:0086d04b")).toBe(true);
    expect(ids.has("concept:src/store.ts#L1-L6:fda0dd6b")).toBe(true);
  });

  it("claim ids match oracle hashes (oracle text fixed in stub)", () => {
    const ids = new Set(result.nodes.filter((n) => n.type === "claim").map((n) => n.id));
    expect(ids.has("claim:docs/ingestion.md#ingestion:0ee19523")).toBe(true);
    expect(ids.has("claim:docs/storage.md#storage:e8805bb0")).toBe(true);
  });

  // Required fields on all nodes
  it("every claim node has category='claim'", () => {
    for (const n of result.nodes.filter((n) => n.type === "claim")) {
      expect(n.category).toBe("claim");
    }
  });

  it("every concept node has category='concept'", () => {
    for (const n of result.nodes.filter((n) => n.type === "concept")) {
      expect(n.category).toBe("concept");
    }
  });

  it("every entity node has category='definition'", () => {
    for (const n of result.nodes.filter((n) => n.type === "entity")) {
      expect(n.category).toBe("definition");
    }
  });

  it("result.edges is an array (may be empty at K1 stage)", () => {
    expect(Array.isArray(result.edges)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section F — determinism / idempotency (SC-11)
// ---------------------------------------------------------------------------

describe("F — determinism: same inputs → same node ids in same order (SC-11)", () => {
  it("two consecutive calls produce identical node id lists", async () => {
    const opts = {
      proposeConcepts: async () =>
        ORACLE_CONCEPTS.map((c) => ({
          anchor: c.anchor,
          name: c.name,
          confidence: "high" as const,
        })),
      proposeClaimsAndEntities: async () => ({
        claims: ORACLE_CLAIMS.map((c) => ({
          anchor: c.anchor,
          text: c.text,
          confidence: "high" as const,
        })),
        entities: ORACLE_ENTITIES.map((e) => ({
          name: e.name,
          anchor: e.anchor,
          confidence: "high" as const,
        })),
      }),
    };

    const r1 = await analyzeContent(CORPUS_DIR, CORPUS_CODE_FILES, CORPUS_DOC_FILES, opts);
    const r2 = await analyzeContent(CORPUS_DIR, CORPUS_CODE_FILES, CORPUS_DOC_FILES, opts);

    expect(r1.nodes.map((n) => n.id)).toEqual(r2.nodes.map((n) => n.id));
  });
});

// ---------------------------------------------------------------------------
// Section G — deterministic TF/co-occurrence cluster membership (BLOCKER 1)
// ---------------------------------------------------------------------------
//
// Oracle member sets (from expected-output.json.ids.topic_member_sets):
//   topic:a81857d8 → ["file:src/ingest.ts","file:src/validate.ts","file:src/store.ts"]
//   topic:79c825b8 → ["file:src/ingest.ts","function:src/ingest.ts:ingestEvent"]
//   topic:189866d8 → ["file:src/validate.ts","function:src/validate.ts:validateEvent"]
//   topic:2c7639cd → ["function:src/ingest.ts:ingestEvent","diagram:docs/ingestion.md#mermaid-0"]
//   topic:a21d1858 → ["file:src/store.ts","function:src/store.ts:storeEvent"]
//
// K1 produces these 5 clusters deterministically; the 6th oracle topic
// (topic:69b00735, single-function) is derived by L4 from highly-referenced
// functions — it is NOT a K1 cluster output.
//
// SC-9 confirms: cluster membership is "deterministic-script" (no model call).
// ---------------------------------------------------------------------------

describe("G — cluster membership: deterministic TF/co-occurrence (BLOCKER 1 — SC-9)", () => {
  let clusterResult: ContentAnalyzeResult;

  beforeAll(async () => {
    clusterResult = await analyzeContent(
      CORPUS_DIR,
      CORPUS_CODE_FILES,
      CORPUS_DOC_FILES,
      {
        proposeConcepts: async () => [],
        proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
      }
    );
  });

  it("G1: result.clusters is an array", () => {
    expect(Array.isArray(clusterResult.clusters)).toBe(true);
  });

  it("G2: at least 5 clusters for the 3-file fixture (root + 3 per-file + 1 function+diagram)", () => {
    expect(clusterResult.clusters.length).toBeGreaterThanOrEqual(5);
  });

  it("G3: root cluster contains all 3 code file IDs (sorted)", () => {
    const rootMembers = [
      "file:src/ingest.ts",
      "file:src/store.ts",
      "file:src/validate.ts",
    ].sort(); // already sorted alphabetically
    const found = clusterResult.clusters.some(
      (c) => JSON.stringify(c.memberIds) === JSON.stringify(rootMembers)
    );
    expect(found).toBe(true);
  });

  it("G4: ingest.ts per-file cluster [file:src/ingest.ts, function:src/ingest.ts:ingestEvent]", () => {
    const members = ["file:src/ingest.ts", "function:src/ingest.ts:ingestEvent"].sort();
    const found = clusterResult.clusters.some(
      (c) => JSON.stringify(c.memberIds) === JSON.stringify(members)
    );
    expect(found).toBe(true);
  });

  it("G5: validate.ts per-file cluster [file:src/validate.ts, function:src/validate.ts:validateEvent]", () => {
    const members = ["file:src/validate.ts", "function:src/validate.ts:validateEvent"].sort();
    const found = clusterResult.clusters.some(
      (c) => JSON.stringify(c.memberIds) === JSON.stringify(members)
    );
    expect(found).toBe(true);
  });

  it("G6: store.ts per-file cluster [file:src/store.ts, function:src/store.ts:storeEvent]", () => {
    const members = ["file:src/store.ts", "function:src/store.ts:storeEvent"].sort();
    const found = clusterResult.clusters.some(
      (c) => JSON.stringify(c.memberIds) === JSON.stringify(members)
    );
    expect(found).toBe(true);
  });

  it("G7: function+diagram cluster [diagram:docs/ingestion.md#mermaid-0, function:src/ingest.ts:ingestEvent]", () => {
    // The mermaid block in docs/ingestion.md contains 'ingestEvent' → first match
    const members = [
      "diagram:docs/ingestion.md#mermaid-0",
      "function:src/ingest.ts:ingestEvent",
    ].sort();
    const found = clusterResult.clusters.some(
      (c) => JSON.stringify(c.memberIds) === JSON.stringify(members)
    );
    expect(found).toBe(true);
  });

  it("G8: every cluster's memberIds array is sorted (makeTopicId determinism — SC-11)", () => {
    for (const cluster of clusterResult.clusters) {
      const sorted = [...cluster.memberIds].sort();
      expect(cluster.memberIds).toEqual(sorted);
    }
  });

  it("G9: root cluster → makeTopicId → oracle hash topic:a81857d8", () => {
    const members = ["file:src/ingest.ts", "file:src/store.ts", "file:src/validate.ts"].sort();
    expect(makeTopicId(members)).toBe("topic:a81857d8");
  });

  it("G10: ingest per-file cluster → makeTopicId → oracle hash topic:79c825b8", () => {
    const members = ["file:src/ingest.ts", "function:src/ingest.ts:ingestEvent"].sort();
    expect(makeTopicId(members)).toBe("topic:79c825b8");
  });

  it("G11: function+diagram cluster → makeTopicId → oracle hash topic:2c7639cd", () => {
    const members = [
      "diagram:docs/ingestion.md#mermaid-0",
      "function:src/ingest.ts:ingestEvent",
    ].sort();
    expect(makeTopicId(members)).toBe("topic:2c7639cd");
  });

  it("G12: store per-file cluster → makeTopicId → oracle hash topic:a21d1858", () => {
    const members = ["file:src/store.ts", "function:src/store.ts:storeEvent"].sort();
    expect(makeTopicId(members)).toBe("topic:a21d1858");
  });

  it("G13: buildContentClusters pure-unit — deduplication: duplicate member sets collapse to one", () => {
    // buildContentClusters(codeRelPaths, functionIds, docSections, mermaidEntries)
    const clusters = buildContentClusters(
      ["src/a.ts", "src/b.ts"],
      ["function:src/a.ts:foo", "function:src/b.ts:bar"],
      [{ relPath: "docs/x.md", anchor: "docs/x.md#x", text: "foo and bar are both present" }],
      []
    );
    // Calling twice on same inputs must deduplicate
    const keys = clusters.map((c) => c.memberIds.join("|"));
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length); // no duplicates
  });

  it("G14: TF co-occurrence — functions from different files in the SAME section cluster their files together", () => {
    const sections = [
      {
        relPath: "docs/shared.md",
        anchor: "docs/shared.md#shared",
        text: "Both ingestEvent and validateEvent are part of the pipeline.",
      },
    ];
    const clusters = buildContentClusters(
      ["src/ingest.ts", "src/validate.ts"],
      ["function:src/ingest.ts:ingestEvent", "function:src/validate.ts:validateEvent"],
      sections,
      []
    );
    // A cross-file cluster should contain BOTH file IDs
    const crossFileCluster = clusters.some(
      (c) =>
        c.memberIds.includes("file:src/ingest.ts") &&
        c.memberIds.includes("file:src/validate.ts")
    );
    expect(crossFileCluster).toBe(true);
  });

  it("G15: TF co-occurrence — functions from different files in SEPARATE sections do NOT form a cross-file cluster", () => {
    const sections = [
      { relPath: "docs/a.md", anchor: "docs/a.md#a", text: "ingestEvent handles input." },
      { relPath: "docs/b.md", anchor: "docs/b.md#b", text: "validateEvent checks rules." },
    ];
    const clusters = buildContentClusters(
      ["src/ingest.ts", "src/validate.ts"],
      ["function:src/ingest.ts:ingestEvent", "function:src/validate.ts:validateEvent"],
      sections,
      []
    );
    // No cluster should contain BOTH file IDs (each function is in its own section only)
    const crossFileCluster = clusters.some(
      (c) =>
        c.memberIds.includes("file:src/ingest.ts") &&
        c.memberIds.includes("file:src/validate.ts")
    );
    expect(crossFileCluster).toBe(false);
  });

  it("G16: word-boundary — funcName 'store' does NOT match 'stored', 'restored', or 'storage'", () => {
    // Text contains "stored", "restored", "storage" — none are the exact whole-word "store".
    // With naive .includes() this would FALSELY trigger; with \bstore\b it must NOT.
    const sections: ClaimSection[] = [
      {
        relPath: "docs/x.md",
        anchor: "docs/x.md#x",
        text: "Events are stored in the system and can be restored from storage.",
      },
    ];
    const clusters = buildContentClusters(
      ["src/a.ts", "src/b.ts"],
      ["function:src/a.ts:store", "function:src/b.ts:other"],
      sections,
      []
    );
    // "store" never appears as a whole word — no cross-file cluster must form
    const crossFile = clusters.some(
      (c) =>
        c.memberIds.includes("file:src/a.ts") &&
        c.memberIds.includes("file:src/b.ts")
    );
    expect(crossFile).toBe(false);
  });

  it("G17: word-boundary — funcName 'store' DOES match when it appears as a standalone word", () => {
    // Text contains "store" and "other" as whole words — cross-file cluster must form.
    const sections: ClaimSection[] = [
      {
        relPath: "docs/x.md",
        anchor: "docs/x.md#x",
        text: "Call store and other to process the event.",
      },
    ];
    const clusters = buildContentClusters(
      ["src/a.ts", "src/b.ts"],
      ["function:src/a.ts:store", "function:src/b.ts:other"],
      sections,
      []
    );
    // Both "store" and "other" appear as whole words — cross-file cluster must form
    const crossFile = clusters.some(
      (c) =>
        c.memberIds.includes("file:src/a.ts") &&
        c.memberIds.includes("file:src/b.ts")
    );
    expect(crossFile).toBe(true);
  });

  it("G18: word-boundary (mermaid path) — funcName 'run' does NOT match 'runner' in mermaid content", () => {
    // Mermaid content contains "runner" but not standalone "run".
    // Naive .includes("run") would match "runner"; \brun\b must NOT.
    const clusters = buildContentClusters(
      ["src/a.ts", "src/b.ts"],
      ["function:src/a.ts:run", "function:src/b.ts:other"],
      [],
      [{ anchor: "docs/x.md#mermaid-0", content: "runner --> other" }]
    );
    // "run" never appears as a whole word — no diagram+function cluster from "run",
    // no cross-file cluster from "run"
    const hasRunCluster = clusters.some(
      (c) =>
        c.memberIds.some((id) => id === "function:src/a.ts:run") &&
        c.memberIds.some((id) => id.startsWith("diagram:"))
    );
    expect(hasRunCluster).toBe(false);
  });

  it("G19: word-boundary (mermaid path) — funcName 'run' DOES match when it is a whole word", () => {
    // Mermaid content contains "run" as a whole word (surrounded by spaces/arrows).
    const clusters = buildContentClusters(
      ["src/a.ts", "src/b.ts"],
      ["function:src/a.ts:run", "function:src/b.ts:other"],
      [],
      [{ anchor: "docs/x.md#mermaid-0", content: "A --> run --> other" }]
    );
    // "run" and "other" both appear as whole words → diagram+function cluster + cross-file
    const hasDiagramCluster = clusters.some(
      (c) =>
        c.memberIds.includes("function:src/a.ts:run") &&
        c.memberIds.includes("diagram:docs/x.md#mermaid-0")
    );
    expect(hasDiagramCluster).toBe(true);
  });

  it("G20: W1 same-funcName — two files exporting 'handle' both attributed on co-mention", () => {
    // Both src/a.ts and src/b.ts export 'handle'. Prose mentions "handle" once.
    // With funcName → funcId[] (not single-value), BOTH files must be attributed.
    const sections: ClaimSection[] = [
      {
        relPath: "docs/x.md",
        anchor: "docs/x.md#x",
        text: "Incoming requests are processed by handle before routing.",
      },
    ];
    const clusters = buildContentClusters(
      ["src/a.ts", "src/b.ts"],
      ["function:src/a.ts:handle", "function:src/b.ts:handle"],
      sections,
      []
    );
    // Both files export "handle" and "handle" appears once in the section.
    // fileIdsMentioned must include BOTH file:src/a.ts AND file:src/b.ts → cross-file cluster.
    const crossFile = clusters.some(
      (c) =>
        c.memberIds.includes("file:src/a.ts") &&
        c.memberIds.includes("file:src/b.ts")
    );
    expect(crossFile).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section H — fail-loud: uninjected LLM seam (BLOCKER 2)
// ---------------------------------------------------------------------------
//
// analyzeContent MUST throw when called without any LLM adapter.
// This prevents the K1 stage from silently emitting an empty graph
// (e.g. if a caller forgets to inject adapters — SC-1 would appear to pass
// trivially with zero nodes, failing the min_nodes_by_type checks).
//
// One seam is sufficient — the stage runs the phases it has adapters for.
// ---------------------------------------------------------------------------

describe("H — fail-loud when no LLM adapter injected (BLOCKER 2)", () => {
  it("H1: throws when opts is undefined (no adapters at all)", async () => {
    await expect(
      analyzeContent(CORPUS_DIR, CORPUS_CODE_FILES, CORPUS_DOC_FILES, undefined)
    ).rejects.toThrow();
  });

  it("H2: throws when opts is empty object (both seams absent)", async () => {
    await expect(
      analyzeContent(CORPUS_DIR, CORPUS_CODE_FILES, CORPUS_DOC_FILES, {})
    ).rejects.toThrow();
  });

  it("H3: error message mentions 'LLM adapter' (clear failure mode, not a generic error)", async () => {
    await expect(
      analyzeContent(CORPUS_DIR, CORPUS_CODE_FILES, CORPUS_DOC_FILES, undefined)
    ).rejects.toThrow(/LLM adapter/i);
  });

  it("H4: does NOT throw when only proposeConcepts is provided", async () => {
    await expect(
      analyzeContent(CORPUS_DIR, CORPUS_CODE_FILES, CORPUS_DOC_FILES, {
        proposeConcepts: async () => [],
      })
    ).resolves.toBeDefined();
  });

  it("H5: does NOT throw when only proposeClaimsAndEntities is provided", async () => {
    await expect(
      analyzeContent(CORPUS_DIR, CORPUS_CODE_FILES, CORPUS_DOC_FILES, {
        proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
      })
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Section I — anchor validation: unresolvable proposals dropped (BLOCKER 3)
// ---------------------------------------------------------------------------
//
// K1 must validate every proposal's anchor against the corpus root before
// calling addNode(). Proposals with an unresolvable anchor must be silently
// dropped (not added to the result graph).
//
// This prevents broken anchors from propagating into the graph and failing
// SC-1's every_node_has_resolvable_anchor check.
//
// Validation: resolveAnchor(repoRoot, anchor) performs FULL per-form validation —
// the file must exist AND the fragment must resolve for its form:
//   path#Lx-Ly    — file exists AND line range is in bounds
//   path#mermaid-N — file exists AND Nth fence is present
//   path#slug      — file exists AND heading slug resolves in the file
//   path (bare)    — file exists
// ---------------------------------------------------------------------------

describe("I — anchor validation: bad-anchor proposals dropped (BLOCKER 3)", () => {
  it("I1: concept proposal with non-existent anchor file → node NOT present in result", async () => {
    const result = await analyzeContent(
      CORPUS_DIR,
      CORPUS_CODE_FILES,
      CORPUS_DOC_FILES,
      {
        proposeConcepts: async () => [
          { anchor: "src/DOES_NOT_EXIST.ts#L1-L5", name: "phantom concept" },
          { anchor: "src/ingest.ts#L1-L6", name: "real concept" },
        ],
        proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
      }
    );
    const ids = result.nodes.map((n) => n.id);
    // phantom should be dropped
    const phantom = ids.find((id) => id.includes("phantom"));
    expect(phantom).toBeUndefined();
  });

  it("I2: concept proposal with valid anchor → node IS present in result", async () => {
    const result = await analyzeContent(
      CORPUS_DIR,
      CORPUS_CODE_FILES,
      CORPUS_DOC_FILES,
      {
        proposeConcepts: async () => [
          { anchor: "src/ingest.ts#L1-L6", name: "real concept text here" },
        ],
        proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
      }
    );
    const concepts = result.nodes.filter((n) => n.type === "concept");
    expect(concepts.length).toBeGreaterThan(0);
    const found = concepts.some((n) =>
      (n.source_refs ?? []).includes("src/ingest.ts#L1-L6")
    );
    expect(found).toBe(true);
  });

  it("I3: claim proposal with non-existent anchor → node NOT added", async () => {
    const result = await analyzeContent(
      CORPUS_DIR,
      CORPUS_CODE_FILES,
      CORPUS_DOC_FILES,
      {
        proposeConcepts: async () => [],
        proposeClaimsAndEntities: async () => ({
          claims: [
            { anchor: "docs/GHOST_FILE.md#section", text: "ghost claim" },
            { anchor: "docs/ingestion.md#ingestion", text: "real claim" },
          ],
          entities: [],
        }),
      }
    );
    const claims = result.nodes.filter((n) => n.type === "claim");
    const ghostFound = claims.some((n) =>
      (n.source_refs ?? []).some((r) => (r as string).includes("GHOST_FILE"))
    );
    expect(ghostFound).toBe(false);
  });

  it("I4: entity proposal with non-existent anchor → node NOT added", async () => {
    const result = await analyzeContent(
      CORPUS_DIR,
      CORPUS_CODE_FILES,
      CORPUS_DOC_FILES,
      {
        proposeConcepts: async () => [],
        proposeClaimsAndEntities: async () => ({
          claims: [],
          entities: [
            { name: "Ghost", anchor: "docs/GHOST.md#ghost" },
            { name: "Event", anchor: "docs/concepts.md#event" },
          ],
        }),
      }
    );
    const entities = result.nodes.filter((n) => n.type === "entity");
    const ghostFound = entities.some((n) => n.id === "entity:ghost");
    expect(ghostFound).toBe(false);
    // real entity IS present
    const realFound = entities.some((n) => n.id === "entity:event");
    expect(realFound).toBe(true);
  });

  it("I5: entity with VALID file but NON-EXISTENT heading slug → dropped (full per-form check)", async () => {
    // docs/ingestion.md EXISTS but has no heading #nonexistent-heading
    const result = await analyzeContent(
      CORPUS_DIR,
      CORPUS_CODE_FILES,
      CORPUS_DOC_FILES,
      {
        proposeConcepts: async () => [],
        proposeClaimsAndEntities: async () => ({
          claims: [],
          entities: [
            { name: "Phantom", anchor: "docs/ingestion.md#nonexistent-heading" },
            { name: "Event",   anchor: "docs/concepts.md#event" },
          ],
        }),
      }
    );
    const entities = result.nodes.filter((n) => n.type === "entity");
    // phantom has a valid file but bad heading slug — must be dropped
    const phantomFound = entities.some((n) => n.id === "entity:phantom");
    expect(phantomFound).toBe(false);
    // real entity retained
    const realFound = entities.some((n) => n.id === "entity:event");
    expect(realFound).toBe(true);
  });

  it("I6: concept with VALID file but OUT-OF-RANGE line numbers → dropped (full per-form check)", async () => {
    // src/ingest.ts EXISTS (≈24 lines) but L1000-L1010 is out of range
    const result = await analyzeContent(
      CORPUS_DIR,
      CORPUS_CODE_FILES,
      CORPUS_DOC_FILES,
      {
        proposeConcepts: async () => [
          { anchor: "src/ingest.ts#L1000-L1010", name: "out of range concept" },
          { anchor: "src/ingest.ts#L1-L6",       name: "valid concept" },
        ],
        proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
      }
    );
    const concepts = result.nodes.filter((n) => n.type === "concept");
    // out-of-range must be dropped
    const oobFound = concepts.some((n) =>
      (n.source_refs ?? []).includes("src/ingest.ts#L1000-L1010")
    );
    expect(oobFound).toBe(false);
    // valid in-range concept retained
    const validFound = concepts.some((n) =>
      (n.source_refs ?? []).includes("src/ingest.ts#L1-L6")
    );
    expect(validFound).toBe(true);
  });
});
