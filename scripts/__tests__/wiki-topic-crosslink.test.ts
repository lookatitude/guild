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

  test("W3 (rigor): no shared IDENTITY term → NO discriminating candidate", () => {
    // L16: identity involvement is required. TOPIC_ORCH idTerms =
    // [pipeline, orchestrator]; WIKI_TELE identity = [telemetry, policy,
    // context, decision] → identity intersection is EMPTY. Body co-occurrence
    // of "pipeline" alone (1 term) can no longer bridge. TOPIC_TELE is present
    // so WIKI_TELE is NOT orphaned → the SC-3 fallback does not fire for the
    // weak TOPIC_ORCH, which therefore gets no edge.
    const candidates = proposeCandidates(
      ROOT,
      [TOPIC_TELE, TOPIC_ORCH, WIKI_TELE],
      []
    );
    const found = candidates.find(
      (c) => c.source === TOPIC_ORCH.id && c.target === WIKI_TELE.id
    );
    expect(found).toBeUndefined();
    // The genuine TOPIC_TELE membership edge is still proposed.
    const genuine = candidates.find(
      (c) => c.source === TOPIC_TELE.id && c.target === WIKI_TELE.id
    );
    expect(genuine).toBeDefined();
  });

  test("W4 (rigor): zero shared terms → NO candidate (page covered by TELE)", () => {
    // TOPIC_MIGRATE shares no identity/body/source term with WIKI_TELE.
    // TOPIC_TELE covers the page (discriminating), so no fallback to MIGRATE.
    const candidates = proposeCandidates(
      ROOT,
      [TOPIC_TELE, TOPIC_MIGRATE, WIKI_TELE],
      []
    );
    const found = candidates.find(
      (c) => c.source === TOPIC_MIGRATE.id && c.target === WIKI_TELE.id
    );
    expect(found).toBeUndefined();
  });

  test("W5 (SC-3 fallback): an orphaned wiki page still gets exactly 1 topic", () => {
    // Neither TOPIC_ORCH nor TOPIC_MIGRATE shares an identity term with
    // WIKI_TELE → no discriminating candidate → SC-3 fallback must assign the
    // single highest-RAW-overlap topic. TOPIC_ORCH ("pipeline" in body) beats
    // TOPIC_MIGRATE (0 overlap), so the page links to TOPIC_ORCH — and only it.
    const candidates = proposeCandidates(
      ROOT,
      [TOPIC_MIGRATE, TOPIC_ORCH, WIKI_TELE],
      []
    );
    const toWiki = candidates.filter((c) => c.target === WIKI_TELE.id);
    expect(toWiki).toHaveLength(1);
    expect(toWiki[0].source).toBe(TOPIC_ORCH.id);
    expect(toWiki[0].reason).toBe("wiki_topic_term_overlap");
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
    // TOPIC_MIGRATE↔WIKI_TELE is NOT a candidate (0 shared terms), and WIKI_TELE
    // is covered by TOPIC_TELE (discriminating) so the SC-3 fallback never
    // proposes MIGRATE either. A judge that fabricates the MIGRATE edge (and
    // does NOT return the genuine TELE edge) must be discarded by the SC-9
    // candidateKeys guard → 0 edges emitted.
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
      { nodes: [TOPIC_TELE, TOPIC_MIGRATE, WIKI_TELE], edges: [] },
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

// ---------------------------------------------------------------------------
// Section V — over-linking discrimination (L16 codex blocker, RED-FIRST)
// ---------------------------------------------------------------------------
//
// codex disproof: an 8-topic × 10-wiki corpus sharing ONLY project-wide
// boilerplate ("Guild Root Lifecycle") drove the prior predicate to emit 80/80
// `wiki_topic_term_overlap` edges (near-complete bipartite). The fixed predicate
// must (a) keep EVERY wiki page with ≥1 topic edge (SC-3), and (b) leave NO
// topic linked to all/most (≥8 of 10) pages (discrimination restored).

describe("V — Rule 6 does NOT over-link on project-wide boilerplate", () => {
  let VROOT: string;
  const N_TOPICS = 8;
  const N_WIKIS = 10;
  const vTopics: GraphNode[] = [];
  const vWikis: GraphNode[] = [];

  // Distinct (non-boilerplate) identity words per node — chosen so NO topic word
  // equals any wiki word and none repeats, i.e. the ONLY shared vocabulary is
  // the boilerplate "Guild Root Lifecycle". 4+ chars, not stopwords.
  const TOPIC_WORDS = [
    "alpha", "bravo", "charlie", "delta",
    "echo", "foxtrot", "golf", "hotel",
  ];
  const WIKI_WORDS = [
    "indigo", "juliet", "kilo", "lima", "mike",
    "november", "oscar", "papa", "quebec", "romeo",
  ];

  function vwrite(rel: string, content: string): void {
    const abs = path.join(VROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  beforeAll(() => {
    VROOT = fs.mkdtempSync(path.join(os.tmpdir(), "l16-overlink-"));

    for (let i = 0; i < N_TOPICS; i++) {
      const word = TOPIC_WORDS[i];
      const rel = `src/mod-${word}.ts`;
      // Source body carries ONLY the boilerplate (no wiki words) so raw overlap
      // is identical across pages → fallback must distribute, not concentrate.
      vwrite(
        rel,
        `// Guild Root Lifecycle module for ${word}.\nexport function ${word}Run(): void {}\n`
      );
      vTopics.push(
        makeNode({
          id: `topic:${word}`,
          type: "topic",
          name: `${word} Guild Root Lifecycle`,
          topic_path: [`${word}-guild-root-lifecycle`],
          source_refs: [`${rel}#L1-L2`],
        })
      );
    }

    for (let i = 0; i < N_WIKIS; i++) {
      const word = WIKI_WORDS[i];
      const rel = `.guild/wiki/decisions/page-${word}.md`;
      vwrite(
        rel,
        `# ${word} Guild Root Lifecycle\n\n## Context\n\nThe Guild Root Lifecycle governs ${word} behaviour across every run.\n`
      );
      vWikis.push(
        makeNode({
          id: `wiki_page:${rel}`,
          type: "wiki_page",
          name: `${word} Guild Root Lifecycle`,
          labels: ["wiki"],
          category: "decision",
          source_refs: [`${rel}#page-${word}`],
        })
      );
    }
  });

  afterAll(() => {
    try {
      fs.rmSync(VROOT, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("V1 (RED): does NOT emit the 80/80 bipartite edge set", () => {
    const candidates = proposeCandidates(VROOT, [...vTopics, ...vWikis], []);
    const wikiTopic = candidates.filter(
      (c) => c.reason === "wiki_topic_term_overlap"
    );
    // The old predicate emitted N_TOPICS*N_WIKIS = 80. We must be far below.
    expect(wikiTopic.length).toBeLessThan(N_TOPICS * N_WIKIS);
    expect(wikiTopic.length).toBeLessThanOrEqual(N_WIKIS); // ≤ one per page
  });

  test("V2 (SC-3): EVERY wiki page still has ≥1 topic edge", () => {
    const candidates = proposeCandidates(VROOT, [...vTopics, ...vWikis], []);
    for (const w of vWikis) {
      const edges = candidates.filter(
        (c) => c.target === w.id && c.reason === "wiki_topic_term_overlap"
      );
      expect(edges.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("V3 (discrimination): NO topic links to all/most (≥8 of 10) pages", () => {
    const candidates = proposeCandidates(VROOT, [...vTopics, ...vWikis], []);
    const fanout = new Map<string, number>();
    for (const c of candidates) {
      if (c.reason !== "wiki_topic_term_overlap") continue;
      fanout.set(c.source, (fanout.get(c.source) ?? 0) + 1);
    }
    const maxFanout = Math.max(0, ...fanout.values());
    expect(maxFanout).toBeLessThan(8);
  });

  test("V4 (determinism): identical across two runs", () => {
    const a = proposeCandidates(VROOT, [...vTopics, ...vWikis], []);
    const b = proposeCandidates(VROOT, [...vTopics, ...vWikis], []);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Section U — per-TOPIC fan-out cap (L19, RED-FIRST)
// ---------------------------------------------------------------------------
//
// L16 capped the per-WIKI axis (each wiki ≤ TOP_K=3 topics) but left the
// per-TOPIC axis uncapped: on the real L12 run one broad-term topic ("Jsonl
// Telemetry Logging") legitimately shared discriminating identity terms with
// 8/10 wiki pages, so per-wiki top-k let that one topic dominate the graph.
//
// FIX (L19): a per-topic fan-out cap — a topic is the documented evidence for
// at most TOP_K_TOPIC = max(TOP_K, ceil(W/2)) wiki pages (half the corpus,
// floored at the per-wiki K so tiny corpora are untouched). Lower-ranked
// wiki→topic edges beyond the cap are dropped, ranked by discriminative score
// (ties by wiki id). HARD CONSTRAINT: the cap must NOT orphan any page — a page
// whose only surviving edge was capped away is RESTORED via its single best
// topic, overriding the cap (SC-3 wins).
//
// Corpus shape mirrors the real run: a "broad" topic B carries 8 distinct
// identity terms; 8 of 10 pages each share a DISTINCT PAIR of those terms with
// B (so each term's DF stays below the boilerplate threshold and B is a
// genuine discriminating candidate for all 8). Each page ALSO matches its own
// narrow topic on a unique pair, so a page capped out of B stays covered.

describe("U — Rule 6 caps per-topic fan-out without orphaning pages", () => {
  let UROOT: string;
  const N_BROAD_PAGES = 8; // pages that legitimately match the broad topic
  const N_NARROW_ONLY = 2; // pages that match ONLY their own narrow topic
  const N_WIKIS = N_BROAD_PAGES + N_NARROW_ONLY; // 10
  // TOP_K=3 internally; cap = max(3, ceil(10/2)) = 5.
  const EXPECTED_CAP = 5;

  // 8 distinct, ≥4-char, non-stopword identity terms for the broad topic.
  const BROAD_TERMS = [
    "telemetry", "logging", "metrics", "tracing",
    "spandex", "buffer", "cursor", "sinker",
  ];
  // Each broad page shares a DISTINCT PAIR of broad terms with B. Every term is
  // used by exactly 2 pages (+B) → idDf=3, never > corpus/2 → not boilerplate.
  const BROAD_PAIRS: Array<[number, number]> = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
  ];
  // 20 letter-only unique words (2 per page, all 10 pages) — distinct tokens so
  // each narrow topic matches exactly one page.
  const UNIQUE_WORDS = [
    "acorn", "badger", "cobra", "dingo", "ferret", "gecko", "heron", "ibex",
    "jackal", "koala", "lemur", "manta", "newtt", "otter", "puffin", "quokka",
    "raven", "seale", "tapir", "urchin",
  ];

  const uTopics: GraphNode[] = [];
  const uWikis: GraphNode[] = [];
  let BROAD_ID: string;

  function uwrite(rel: string, content: string): void {
    const abs = path.join(UROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  beforeAll(() => {
    UROOT = fs.mkdtempSync(path.join(os.tmpdir(), "l19-pertopic-"));

    // Broad topic B — identity = all 8 broad terms.
    uwrite("src/broad.ts", `// broad module\nexport function broadRun(): void {}\n`);
    BROAD_ID = "topic:broad";
    uTopics.push(
      makeNode({
        id: BROAD_ID,
        type: "topic",
        name: BROAD_TERMS.join(" "),
        topic_path: [BROAD_TERMS.join("-")],
        source_refs: ["src/broad.ts#L1-L2"],
      })
    );

    for (let i = 0; i < N_WIKIS; i++) {
      const num = String(i).padStart(2, "0");
      const uA = UNIQUE_WORDS[2 * i];
      const uB = UNIQUE_WORDS[2 * i + 1];

      // Broad pages (0..7) carry a distinct pair of broad terms; narrow-only
      // pages (8,9) carry NO broad term.
      let broadWords = "";
      if (i < N_BROAD_PAGES) {
        const [a, b] = BROAD_PAIRS[i];
        broadWords = `${BROAD_TERMS[a]} ${BROAD_TERMS[b]} `;
      }

      const rel = `.guild/wiki/decisions/page-${num}.md`;
      uwrite(
        rel,
        `# ${broadWords}${uA} ${uB}\n\n## Context\n\nThis page concerns ${broadWords}${uA} ${uB} behaviour.\n`
      );
      uWikis.push(
        makeNode({
          id: `wiki_page:${rel}`,
          type: "wiki_page",
          name: `${broadWords}${uA} ${uB}`,
          labels: ["wiki"],
          category: "decision",
          source_refs: [`${rel}#page-${num}`],
        })
      );

      // Narrow topic Ni — identity = the page's unique pair only.
      const nrel = `src/narrow-${num}.ts`;
      uwrite(nrel, `// narrow ${uA} ${uB} module\nexport function n${num}(): void {}\n`);
      uTopics.push(
        makeNode({
          id: `topic:narrow-${num}`,
          type: "topic",
          name: `${uA} ${uB}`,
          topic_path: [`${uA}-${uB}`],
          source_refs: [`${nrel}#L1-L2`],
        })
      );
    }
  });

  afterAll(() => {
    try {
      fs.rmSync(UROOT, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  function wikiTopicCandidates() {
    return proposeCandidates(UROOT, [...uTopics, ...uWikis], []).filter(
      (c) => c.reason === "wiki_topic_term_overlap"
    );
  }

  test("U1 (sanity): broad topic is a genuine discriminating match for 8 pages", () => {
    // Pre-cap intent check: B shares ≥2 identity terms with each of the 8 broad
    // pages. (On UN-capped code B would fan out to all 8 — that is the bug.)
    // Here we assert the narrow topics each match exactly their own page so the
    // corpus is wired as intended.
    const cands = wikiTopicCandidates();
    const narrowFanout = new Map<string, number>();
    for (const c of cands) {
      if (c.source.startsWith("topic:narrow-")) {
        narrowFanout.set(c.source, (narrowFanout.get(c.source) ?? 0) + 1);
      }
    }
    for (const [, n] of narrowFanout) expect(n).toBe(1);
  });

  test("U2 (RED→GREEN): broad topic fan-out is capped to ≤ TOP_K_TOPIC (<8)", () => {
    const cands = wikiTopicCandidates();
    const bFanout = cands.filter((c) => c.source === BROAD_ID).length;
    // On the pre-L19 (uncapped) code this is 8 → fails RED.
    expect(bFanout).toBeLessThan(N_BROAD_PAGES); // < 8
    expect(bFanout).toBeLessThanOrEqual(EXPECTED_CAP); // ≤ 5
  });

  test("U3 (SC-3): EVERY wiki page still retains ≥1 topic edge", () => {
    const cands = wikiTopicCandidates();
    for (const w of uWikis) {
      const edges = cands.filter((c) => c.target === w.id);
      expect(edges.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("U4 (discrimination): NO topic exceeds the per-topic cap", () => {
    const cands = wikiTopicCandidates();
    const fanout = new Map<string, number>();
    for (const c of cands) fanout.set(c.source, (fanout.get(c.source) ?? 0) + 1);
    const maxFanout = Math.max(0, ...fanout.values());
    expect(maxFanout).toBeLessThanOrEqual(EXPECTED_CAP);
    expect(maxFanout).toBeLessThan(N_BROAD_PAGES); // < 8 (the real-run regression)
  });

  test("U5 (determinism): identical across two runs", () => {
    const a = proposeCandidates(UROOT, [...uTopics, ...uWikis], []);
    const b = proposeCandidates(UROOT, [...uTopics, ...uWikis], []);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Section U2 — cap-orphan RESTORE (fallback overrides the per-topic cap)
// ---------------------------------------------------------------------------
//
// A page whose ONLY discriminating match is a broad topic, where that topic is
// also the best match for many other pages, must NOT be orphaned by the cap.
// The cap is overridden for such a page — its single best edge is restored.

describe("U2 — per-topic cap never orphans a page (SC-3 overrides cap)", () => {
  let RROOT: string;
  const N_PAGES = 6; // broad B matches all 6; cap = max(3, ceil(6/2)) = 3
  const N_NARROW = 3; // pages 0,1,2 have a narrow topic; pages 3,4,5 do NOT

  const BROAD_TERMS = [
    "telemetry", "logging", "metrics", "tracing", "spandex", "buffer",
  ];
  const BROAD_PAIRS: Array<[number, number]> = [
    [0, 1], [2, 3], [4, 5], [0, 2], [1, 3], [4, 0],
  ];
  const UNIQUE_WORDS = ["acorn", "badger", "cobra", "dingo", "ferret", "gecko"];

  const rTopics: GraphNode[] = [];
  const rWikis: GraphNode[] = [];
  const BROAD_ID = "topic:rbroad";

  function rwrite(rel: string, content: string): void {
    const abs = path.join(RROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }

  beforeAll(() => {
    RROOT = fs.mkdtempSync(path.join(os.tmpdir(), "l19-restore-"));
    rwrite("src/rbroad.ts", `// broad\nexport function rb(): void {}\n`);
    rTopics.push(
      makeNode({
        id: BROAD_ID,
        type: "topic",
        name: BROAD_TERMS.join(" "),
        topic_path: [BROAD_TERMS.join("-")],
        source_refs: ["src/rbroad.ts#L1-L2"],
      })
    );

    for (let i = 0; i < N_PAGES; i++) {
      const num = String(i).padStart(2, "0");
      const [a, b] = BROAD_PAIRS[i];
      const broadWords = `${BROAD_TERMS[a]} ${BROAD_TERMS[b]}`;
      const uniq = UNIQUE_WORDS[i];
      const rel = `.guild/wiki/decisions/rpage-${num}.md`;
      // Pages 0,1,2 also carry a unique narrow word; pages 3,4,5 carry ONLY the
      // broad pair (their sole possible match is B).
      const hasNarrow = i < N_NARROW;
      const extra = hasNarrow ? ` ${uniq}` : "";
      rwrite(
        rel,
        `# ${broadWords}${extra}\n\n## Context\n\nConcerns ${broadWords}${extra}.\n`
      );
      rWikis.push(
        makeNode({
          id: `wiki_page:${rel}`,
          type: "wiki_page",
          name: `${broadWords}${extra}`,
          labels: ["wiki"],
          category: "decision",
          source_refs: [`${rel}#rpage-${num}`],
        })
      );
      if (hasNarrow) {
        const nrel = `src/rnarrow-${num}.ts`;
        // Narrow topic needs ≥2 identity terms to be a discriminating match;
        // give it the unique word + a second unique-per-page word.
        const uniq2 = `${uniq}extra`;
        rwrite(nrel, `// narrow\nexport function rn${num}(): void {}\n`);
        rwrite(
          rel,
          `# ${broadWords} ${uniq} ${uniq2}\n\n## Context\n\nConcerns ${broadWords} ${uniq} ${uniq2}.\n`
        );
        // overwrite the wiki node name to include both unique words
        rWikis[rWikis.length - 1] = makeNode({
          id: `wiki_page:${rel}`,
          type: "wiki_page",
          name: `${broadWords} ${uniq} ${uniq2}`,
          labels: ["wiki"],
          category: "decision",
          source_refs: [`${rel}#rpage-${num}`],
        });
        rTopics.push(
          makeNode({
            id: `topic:rnarrow-${num}`,
            type: "topic",
            name: `${uniq} ${uniq2}`,
            topic_path: [`${uniq}-${uniq2}`],
            source_refs: [`${nrel}#L1-L2`],
          })
        );
      }
    }
  });

  afterAll(() => {
    try {
      fs.rmSync(RROOT, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("U2-1 (SC-3 overrides cap): no page orphaned even though B exceeds cap", () => {
    const cands = proposeCandidates(RROOT, [...rTopics, ...rWikis], []).filter(
      (c) => c.reason === "wiki_topic_term_overlap"
    );
    // Every page keeps ≥1 edge.
    for (const w of rWikis) {
      const edges = cands.filter((c) => c.target === w.id);
      expect(edges.length).toBeGreaterThanOrEqual(1);
    }
    // Pages 3,4,5 (no narrow topic) are restored to B → B legitimately exceeds
    // the cap of 3 because SC-3 wins. Assert those three pages link to B.
    for (let i = N_NARROW; i < N_PAGES; i++) {
      const num = String(i).padStart(2, "0");
      const wid = `wiki_page:.guild/wiki/decisions/rpage-${num}.md`;
      const toB = cands.find((c) => c.source === BROAD_ID && c.target === wid);
      expect(toB).toBeDefined();
    }
  });
});
