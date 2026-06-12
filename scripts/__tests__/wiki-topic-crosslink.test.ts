/**
 * L14 — Rule 6: wiki_page↔topic membership cross-link (SC-3).
 *
 * RED-FIRST: on the pre-L14 code every wiki_page is an orphan — no rule bridges
 * a `topic` (anchored to CODE) to a `wiki_page` (anchored to `.guild/wiki/`).
 * SC-3 requires every wiki page to carry ≥1 topic membership edge. These tests
 * fix a real temp-dir corpus and assert on the proposed candidate + emitted edge.
 *
 * Sections:
 *   W — proposeCandidates Rule 6 (deterministic propose, ≥2-distinct-term rigor)
 *   X — buildCrossLinks emits the confirmed topic→wiki_page evidenced_by edge
 *   Y — candidateKeys guard drops an off-candidate (fabricated) wiki↔topic key
 *   Z — determinism (two runs byte-identical)
 *
 * Chosen edge: `topic --evidenced_by--> wiki_page`. validateGraphV2 accepts the
 * pair (evidenced_by requires the TARGET anchor to resolve; wiki_page anchors
 * resolve), and SC-4 defines evidenced_by as topic→supporting artifact (wiki) —
 * which is exactly SC-3's "topic membership" intent.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { GraphNode, GraphEdge } from "../understand/lib/schema";
import {
  proposeCandidates,
  buildCrossLinks,
  distinctLowerKeyTerms,
  extractHeadingTexts,
  ConfirmCrossLinksFn,
} from "../understand/cross-link";

// ---------------------------------------------------------------------------
// Temp-dir corpus (real files — Rule 6 reads wiki BODY + topic SOURCE)
// ---------------------------------------------------------------------------

let ROOT: string;

function write(rel: string, content: string): void {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "l14-wiki-topic-"));

  // Topic anchored to CODE — its identity terms are "telemetry"/"pipeline".
  write(
    "src/telemetry.ts",
    `// Telemetry pipeline writer.
export function writeTelemetry(runId: string): void {
  // emits run-scoped events to the telemetry stream
}
`
  );

  // Wiki page whose BODY mentions "telemetry" and "pipeline" (Direction A:
  // ≥2 topic-identity terms appear in the body → candidate).
  write(
    ".guild/wiki/decisions/telemetry-policy.md",
    `# Telemetry Policy

## Context

The telemetry pipeline emits run-scoped events for every lifecycle run.

## Decision

Each run writes its own telemetry stream through the pipeline.
`
  );

  // An UNRELATED topic (anchored to code that shares NO terms with the wiki
  // page) — used to prove the candidateKeys guard drops a fabricated key.
  write(
    "src/migrate.ts",
    `// Schema migration runner.
export function runMigration(version: number): void {}
`
  );

  // A topic that shares EXACTLY ONE term ("pipeline") with the wiki page —
  // proves the ≥2-distinct-term rigor (1 term → no candidate).
  write(
    "src/orchestrator.ts",
    `// Lane orchestrator dispatch.
export function dispatchLane(name: string): void {}
`
  );
});

afterAll(() => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ---------------------------------------------------------------------------
// Node fixtures
// ---------------------------------------------------------------------------

function makeNode(o: Partial<GraphNode> & { id: string; type: string }): GraphNode {
  return { name: o.id, source_refs: [], confidence: "high", ...o } as GraphNode;
}

const TOPIC_TELE = makeNode({
  id: "topic:tele01",
  type: "topic",
  name: "Telemetry Pipeline",
  topic_path: ["telemetry-pipeline"],
  source_refs: ["src/telemetry.ts#L1-L4"],
});

const WIKI_TELE = makeNode({
  id: "wiki_page:.guild/wiki/decisions/telemetry-policy.md",
  type: "wiki_page",
  name: "Telemetry Policy",
  labels: ["wiki"],
  category: "decision",
  source_refs: [".guild/wiki/decisions/telemetry-policy.md#telemetry-policy"],
});

const TOPIC_MIGRATE = makeNode({
  id: "topic:migr01",
  type: "topic",
  name: "Schema Migrations",
  topic_path: ["schema-migrations"],
  source_refs: ["src/migrate.ts#L1-L3"],
});

const TOPIC_ORCH = makeNode({
  id: "topic:orch01",
  type: "topic",
  name: "Pipeline Orchestrator",
  topic_path: ["pipeline-orchestrator"],
  source_refs: ["src/orchestrator.ts#L1-L3"],
});

const WIKI_KEY = `${TOPIC_TELE.id}→${WIKI_TELE.id}:evidenced_by`;

// ---------------------------------------------------------------------------
// Section W — proposeCandidates Rule 6
// ---------------------------------------------------------------------------

describe("W — Rule 6 proposes topic→wiki_page evidenced_by candidate", () => {
  test("W0 (helpers): distinctLowerKeyTerms folds case + drops 'module' stopword", () => {
    expect(distinctLowerKeyTerms("Telemetry Module")).toEqual(["telemetry"]);
    expect(extractHeadingTexts("# Title\n## Section A\nbody")).toEqual([
      "Title",
      "Section A",
    ]);
  });

  test("W1 (RED→GREEN): wiki page sharing ≥2 terms with a topic → candidate", () => {
    const candidates = proposeCandidates(ROOT, [TOPIC_TELE, WIKI_TELE], []);
    const found = candidates.find(
      (c) =>
        c.source === TOPIC_TELE.id &&
        c.target === WIKI_TELE.id &&
        c.type === "evidenced_by" &&
        c.reason === "wiki_topic_term_overlap"
    );
    expect(found).toBeDefined();
  });

  test("W2: direction is topic→wiki_page (never wiki_page→topic)", () => {
    const candidates = proposeCandidates(ROOT, [TOPIC_TELE, WIKI_TELE], []);
    const reversed = candidates.find(
      (c) => c.source === WIKI_TELE.id && c.target === TOPIC_TELE.id
    );
    expect(reversed).toBeUndefined();
  });

  test("W3 (rigor): exactly 1 shared term → NO candidate", () => {
    // TOPIC_ORCH idTerms = [pipeline, orchestrator]; wiki body has "pipeline"
    // (1) but not "orchestrator"; orchestrator.ts has none of the wiki terms.
    const candidates = proposeCandidates(ROOT, [TOPIC_ORCH, WIKI_TELE], []);
    const found = candidates.find(
      (c) => c.source === TOPIC_ORCH.id && c.target === WIKI_TELE.id
    );
    expect(found).toBeUndefined();
  });

  test("W4 (rigor): zero shared terms → NO candidate", () => {
    const candidates = proposeCandidates(ROOT, [TOPIC_MIGRATE, WIKI_TELE], []);
    const found = candidates.find(
      (c) => c.source === TOPIC_MIGRATE.id && c.target === WIKI_TELE.id
    );
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section X — buildCrossLinks emits the confirmed edge
// ---------------------------------------------------------------------------

describe("X — buildCrossLinks emits confirmed topic→wiki_page edge", () => {
  test("X1: confirming judge → edge present, anchor resolves, weight kept", async () => {
    const confirm: ConfirmCrossLinksFn = async (_n, candidates) =>
      candidates
        .filter((c) => c.reason === "wiki_topic_term_overlap")
        .map((c) => ({
          source: c.source,
          target: c.target,
          type: c.type,
          direction: "out" as const,
          weight: 0.8,
        }));

    const result = await buildCrossLinks(
      ROOT,
      { nodes: [TOPIC_TELE, WIKI_TELE], edges: [] },
      { confirmCrossLinks: confirm }
    );
    const edge = result.edges.find(
      (e) =>
        e.source === TOPIC_TELE.id &&
        e.target === WIKI_TELE.id &&
        e.type === "evidenced_by"
    );
    expect(edge).toBeDefined();
    expect(edge!.weight).toBe(0.8);
  });

  test("X2: wiki page ends with ≥1 topic membership edge (SC-3)", async () => {
    const confirm: ConfirmCrossLinksFn = async (_n, candidates) =>
      candidates.map((c) => ({
        source: c.source,
        target: c.target,
        type: c.type,
        direction: "out" as const,
        weight: 0.7,
      }));
    const result = await buildCrossLinks(
      ROOT,
      { nodes: [TOPIC_TELE, WIKI_TELE], edges: [] },
      { confirmCrossLinks: confirm }
    );
    const topicEdges = result.edges.filter((e) => e.target === WIKI_TELE.id);
    expect(topicEdges.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Section Y — candidateKeys guard (SC-9): an LLM cannot fabricate the edge
// ---------------------------------------------------------------------------

describe("Y — candidateKeys guard drops off-candidate wiki↔topic keys", () => {
  test("Y1: judge inventing an unrelated topic→wiki edge → dropped", async () => {
    // TOPIC_MIGRATE↔WIKI_TELE is NOT a candidate (0 shared terms). A judge that
    // fabricates that edge must be discarded by the SC-9 candidateKeys guard.
    const confirm: ConfirmCrossLinksFn = async () => [
      {
        source: TOPIC_MIGRATE.id,
        target: WIKI_TELE.id,
        type: "evidenced_by",
        direction: "out",
        weight: 0.95,
      },
    ];
    const result = await buildCrossLinks(
      ROOT,
      { nodes: [TOPIC_MIGRATE, WIKI_TELE], edges: [] },
      { confirmCrossLinks: confirm }
    );
    const fabricated = result.edges.find(
      (e) => e.source === TOPIC_MIGRATE.id && e.target === WIKI_TELE.id
    );
    expect(fabricated).toBeUndefined();
    expect(result.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section Z — determinism (SC-8 byte-identity precondition)
// ---------------------------------------------------------------------------

describe("Z — deterministic candidate + edge output", () => {
  test("Z1: proposeCandidates is identical across two runs", () => {
    const a = proposeCandidates(ROOT, [TOPIC_TELE, TOPIC_ORCH, WIKI_TELE], []);
    const b = proposeCandidates(ROOT, [TOPIC_TELE, TOPIC_ORCH, WIKI_TELE], []);
    expect(a).toEqual(b);
  });

  test("Z2: candidate key matches the documented source→target:type form", () => {
    const candidates = proposeCandidates(ROOT, [TOPIC_TELE, WIKI_TELE], []);
    const keys = candidates.map((c) => `${c.source}→${c.target}:${c.type}`);
    expect(keys).toContain(WIKI_KEY);
  });
});
