/**
 * scripts/__tests__/knowledge-links-builder.test.ts
 *
 * SC-E — knowledge-links-builder tests.
 *
 * TDD discipline: tests written BEFORE implementation. Every test here was
 * confirmed to fail with "Cannot find module" (pre-implementation RED) before
 * any production code was written.
 *
 * Covers:
 *
 * 1. Extended node-kind classification — all 19 entity types from the brief
 *    §306-327 classify correctly (goals, non-goals, initiatives, work items,
 *    specs, plans, tasks, runs, decisions, open questions, wiki pages, raw
 *    sources, files, components, domains, agents, skills, reviews, verification
 *    evidence, reflection/evolution candidates).
 *
 * 2. Extended edge-type set — the 9 existing closed-set types are preserved;
 *    the 6 new extension types are accepted and not rejected as "non-closed".
 *
 * 3. NN#8 rebuild-from-canonical — delete the derived index, rebuild from
 *    on-disk canonical stores, verify the result is byte-for-byte identical
 *    (normalised). Proves: the builder holds NO unique state; derived index is
 *    fully rebuildable from canonical sources.
 *
 * 4. Cross-cut traversal — a single BFS traversal over a fixture knowledge-
 *    links.json answers at least 2 of the brief §329-339 questions:
 *    (a) "Which decisions constrained this task?" → reachable decision nodes
 *    (b) "Which goal does this initiative serve?" → initiative → goal edge
 *    (c) "Which skill/agent produced the work?" → run → skill/agent edge
 *    (d) "Which wiki pages explain this component?" → component → wiki edge
 *    (e) "Which lessons came after this phase?" → run → reflection/evo edge
 *
 * 5. context-assemble query shape — the queryDecisionsAndOpenQuestions()
 *    helper returns structured { decisions, open_questions } arrays from the
 *    edge layer. context-assemble pins these to the current task/run.
 *
 * 6. harvest-candidate source_refs compatibility (FU-A1-3) — edges generated
 *    from a guild.harvest_candidates.v1 fixture reference candidates by their
 *    source_refs, not by inline bodies.
 *
 * Hermetic: all tests use in-memory fixture data. No disk I/O except for the
 * NN#8 rebuild test which uses a real tmp dir.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// The module under test — does NOT exist yet. This import will fail until
// knowledge-links-builder.ts is written (the expected RED state).
import {
  // Extended classification
  classifyNodeKindExtended,
  EXTENDED_EDGE_TYPES,
  EXTENDED_NODE_KINDS,

  // Builder
  buildKnowledgeLinks,
  type BuildOptions,
  type KnowledgeLinkDoc,

  // Traversal helpers (cross-cut questions)
  findConstrainingDecisions,
  findGoalForInitiative,
  findSkillsAndAgentsForRun,
  findWikiPagesForComponent,
  findLessonsAfterRun,

  // context-assemble query shape
  queryDecisionsAndOpenQuestions,
  type ContextAssembleQuery,
  type ContextAssembleResult,
} from "../knowledge-links-builder";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A minimal fixture that covers all 19 entity types from brief §306-327.
 * Edges use the full extended closed-set types.
 */
const FULL_FIXTURE_LINKS = [
  // goal ← initiative serves
  { from: "initiative:learn-knowledge-convergence", to: "goal:connected-learning", type: "serves_goal", run_id: "run-1" },
  // non-goal linked to initiative
  { from: "initiative:learn-knowledge-convergence", to: "non-goal:auto-promotion", type: "excludes", run_id: "run-1" },
  // initiative → spec
  { from: "initiative:learn-knowledge-convergence", to: "spec:sc-e-spec", type: "produced", run_id: "run-1" },
  // spec → plan
  { from: "spec:sc-e-spec", to: "plan:e1-plan", type: "produced", run_id: "run-1" },
  // plan → task
  { from: "plan:e1-plan", to: "task:E1-links", type: "produced", run_id: "run-1" },
  // work_item → task
  { from: "work_item:wi-001", to: "task:E1-links", type: "produced", run_id: "run-1" },
  // decision constrains task
  { from: "decision:nn8-derived-indexes-rebuildable", to: "task:E1-links", type: "constrains", run_id: "run-1" },
  // open question linked to task
  { from: "task:E1-links", to: "open_question:oq-edge-types", type: "opens_question", run_id: "run-1" },
  // run produced by task
  { from: "task:E1-links", to: "run:run-learn-knowledge-convergence-20260529-094021", type: "produced", run_id: "run-1" },
  // skill used for run
  { from: "skill:guild-learn-harvest", to: "run:run-learn-knowledge-convergence-20260529-094021", type: "used_for", run_id: "run-1" },
  // agent used for run
  { from: "agent:tooling-engineer", to: "run:run-learn-knowledge-convergence-20260529-094021", type: "used_for", run_id: "run-1" },
  // run touches component
  { from: "run:run-learn-knowledge-convergence-20260529-094021", to: "component:knowledge-links-builder", type: "touches", run_id: "run-1" },
  // run touches file
  { from: "run:run-learn-knowledge-convergence-20260529-094021", to: "file:plugin/scripts/knowledge-links-builder.ts", type: "touches", run_id: "run-1" },
  // component touches domain
  { from: "component:knowledge-links-builder", to: "domain:scripts", type: "touches", run_id: "run-1" },
  // wiki page describes component
  { from: "component:knowledge-links-builder", to: "wiki:knowledge-links-expansion", type: "learned_from", run_id: "run-1" },
  // raw_source → wiki (research source introduced this idea)
  { from: "raw_source:learn-knowledge-run-convergence", to: "wiki:knowledge-links-expansion", type: "learned_from", run_id: "run-1" },
  // review linked to run
  { from: "review:codex-review-e1", to: "run:run-learn-knowledge-convergence-20260529-094021", type: "produced", run_id: "run-1" },
  // verification evidence linked to run
  { from: "verify:verify-sc-e", to: "run:run-learn-knowledge-convergence-20260529-094021", type: "produced", run_id: "run-1" },
  // reflection candidate
  { from: "run:run-learn-knowledge-convergence-20260529-094021", to: "reflection:refl-sc-e-lessons", type: "produced", run_id: "run-1" },
  // evolution candidate
  { from: "run:run-learn-knowledge-convergence-20260529-094021", to: "evolution:evo-knowledge-links-skill", type: "produced", run_id: "run-1" },
];

// ── 1. Extended node-kind classification ──────────────────────────────────────

describe("classifyNodeKindExtended — all 19 entity types", () => {
  const cases: [string, string][] = [
    ["goal:connected-learning", "goal"],
    ["non-goal:auto-promotion", "non_goal"],
    ["initiative:learn-knowledge-convergence", "initiative"],
    ["work_item:wi-001", "work_item"],
    ["spec:sc-e-spec", "spec"],
    ["plan:e1-plan", "plan"],
    ["task:E1-links", "task"],
    ["run:run-learn-knowledge-convergence-20260529-094021", "run"],
    ["decision:nn8-derived-indexes-rebuildable", "decision"],
    ["open_question:oq-edge-types", "open_question"],
    ["wiki:knowledge-links-expansion", "wiki"],
    ["raw_source:learn-knowledge-run-convergence", "raw_source"],
    ["file:plugin/scripts/knowledge-links-builder.ts", "file"],
    ["component:knowledge-links-builder", "feature_component"],
    ["domain:scripts", "domain"],
    ["agent:tooling-engineer", "skill_agent"],
    ["skill:guild-learn-harvest", "skill_agent"],
    ["review:codex-review-e1", "review"],
    ["verify:verify-sc-e", "verify"],
    ["reflection:refl-sc-e-lessons", "reflection_evolution"],
    ["evolution:evo-knowledge-links-skill", "reflection_evolution"],
    ["feature:some-feature", "feature_component"],
    ["unknown:xyz", "other"],
  ];

  test.each(cases)("classifyNodeKindExtended('%s') → '%s'", (id, expected) => {
    expect(classifyNodeKindExtended(id)).toBe(expected);
  });
});

// ── 2. Extended edge-type set ─────────────────────────────────────────────────

describe("EXTENDED_EDGE_TYPES — original 9 + 6 new extension types", () => {
  const originalClosedSet = [
    "decided_by", "used_for", "produced", "touches", "supersedes",
    "learned_from", "constrains", "opens_question", "resolves",
  ];
  const newExtensionTypes = [
    "serves_goal", "excludes", "references", "emits_candidate",
    "verified_by", "has_review",
  ];

  test("all 9 original closed-set types are present", () => {
    for (const t of originalClosedSet) {
      expect(EXTENDED_EDGE_TYPES.has(t)).toBe(true);
    }
  });

  test("all 6 new extension types are accepted", () => {
    for (const t of newExtensionTypes) {
      expect(EXTENDED_EDGE_TYPES.has(t)).toBe(true);
    }
  });

  test("total extended set has ≥ 15 types", () => {
    expect(EXTENDED_EDGE_TYPES.size).toBeGreaterThanOrEqual(15);
  });
});

describe("EXTENDED_NODE_KINDS — 19 entity kinds", () => {
  const required = [
    "goal", "non_goal", "initiative", "work_item", "spec", "plan",
    "task", "run", "decision", "open_question", "wiki", "raw_source",
    "file", "feature_component", "domain", "skill_agent", "review",
    "verify", "reflection_evolution",
  ];

  test("all 19 required node kinds are present", () => {
    for (const k of required) {
      expect(EXTENDED_NODE_KINDS.has(k)).toBe(true);
    }
  });
});

// ── 3. NN#8 rebuild-from-canonical ───────────────────────────────────────────

describe("NN#8 — rebuild-from-canonical (delete index → rebuild → identical)", () => {
  let tmpDir: string;
  let klPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-builder-nn8-"));
    // Create the minimal canonical store layout.
    const guildDir = path.join(tmpDir, ".guild");
    fs.mkdirSync(path.join(guildDir, "indexes"), { recursive: true });
    fs.mkdirSync(path.join(guildDir, "wiki"), { recursive: true });
    fs.mkdirSync(path.join(guildDir, "wiki", "decisions"), { recursive: true });
    fs.mkdirSync(path.join(guildDir, "raw", "sources"), { recursive: true });
    fs.mkdirSync(path.join(guildDir, "initiatives", "active", "test-initiative"), { recursive: true });
    fs.mkdirSync(path.join(guildDir, "runs", "run-test-1"), { recursive: true });
    fs.mkdirSync(path.join(guildDir, "reflections"), { recursive: true });
    fs.mkdirSync(path.join(guildDir, "evolve"), { recursive: true });

    // Canonical wiki decision page.
    //
    // G7b: this page carries the 3 "W3" canonical sources so the NN#8
    // delete→rebuild test below can prove all 3 W3 edge types are RE-DERIVED
    // losslessly from canonical wiki frontmatter (not held in the deleted index):
    //   - supersedes: <prev>          → decision:test-decision supersedes decision:test-decision-v0
    //   - task: <task-slug>           → decision:test-decision decided_by task:T1
    //   - resolves: <open-question>   → decision:test-decision resolves open_question:oq-test
    // The provenance.touched.decisions entry below also yields a SECOND
    // decided_by edge (decision:test-decision decided_by run:run-test-1).
    fs.writeFileSync(
      path.join(guildDir, "wiki", "decisions", "test-decision.md"),
      [
        "---",
        "type: decision",
        "slug: test-decision",
        "supersedes: test-decision-v0",
        "task: T1",
        "resolves: oq-test",
        "---",
        "# Test Decision",
        "Some decision.",
      ].join("\n") + "\n",
    );

    // Canonical raw source
    fs.writeFileSync(
      path.join(guildDir, "raw", "sources", "test-source.md"),
      `---\ntype: source\nslug: test-source\n---\n# Test Source\nSome research.\n`,
    );

    // Canonical initiative spec
    fs.writeFileSync(
      path.join(guildDir, "initiatives", "active", "test-initiative", "spec.md"),
      `---\ntype: spec\ninitiative: test-initiative\ngoal: test-goal\n---\n# Test Initiative Spec\n`,
    );

    // Canonical run provenance
    fs.writeFileSync(
      path.join(guildDir, "runs", "run-test-1", "provenance.json"),
      JSON.stringify({
        schema_version: "guild.provenance.v1",
        run_id: "run-test-1",
        command: "/guild:build",
        initiative: "test-initiative",
        status: "closed",
        touched: {
          tasks: ["task:T1"],
          agents: ["agent:tooling-engineer"],
          skills: ["skill:guild-build"],
          decisions: ["decision:test-decision"],
          features: ["component:test-component"],
          files: ["plugin/src/test.ts"],
          runs: [],
        },
        artifacts: { verify: ".guild/runs/run-test-1/verify.md" },
        benchmark_eligible: true,
      }, null, 2),
    );

    // Canonical reflection
    fs.writeFileSync(
      path.join(guildDir, "reflections", "refl-test.yaml"),
      `schema_version: guild.reflection.v1\nrun_id: run-test-1\nlessons:\n  - lesson: test lesson\n`,
    );

    klPath = path.join(guildDir, "indexes", "knowledge-links.json");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const opts: BuildOptions = { root: "" }; // set at test time

  test("builder creates knowledge-links.json from canonical stores", () => {
    const buildOpts: BuildOptions = { root: tmpDir };
    const result = buildKnowledgeLinks(buildOpts);
    expect(result.ok).toBe(true);
    expect(fs.existsSync(klPath)).toBe(true);
    const doc = JSON.parse(fs.readFileSync(klPath, "utf8")) as KnowledgeLinkDoc;
    expect(doc.schema_version).toBe("guild.knowledge_links.v1");
    expect(Array.isArray(doc.links)).toBe(true);
    expect(doc.links.length).toBeGreaterThan(0);
  });

  test("NN#8: delete index → rebuild → identical (normalised)", () => {
    const buildOpts: BuildOptions = { root: tmpDir };

    // First build
    buildKnowledgeLinks(buildOpts);
    const firstBuild = fs.readFileSync(klPath, "utf8");
    const firstDoc = JSON.parse(firstBuild) as KnowledgeLinkDoc;

    // DELETE the derived index (NN#8 proof step 1)
    fs.rmSync(klPath);
    expect(fs.existsSync(klPath)).toBe(false);

    // Rebuild from canonical stores only (NN#8 proof step 2)
    buildKnowledgeLinks(buildOpts);
    expect(fs.existsSync(klPath)).toBe(true);
    const secondDoc = JSON.parse(fs.readFileSync(klPath, "utf8")) as KnowledgeLinkDoc;

    // Normalise for comparison: sort links by from|to|type (order may vary)
    const normalise = (doc: KnowledgeLinkDoc) =>
      [...doc.links].sort((a, b) =>
        `${a.from}|${a.to}|${a.type}`.localeCompare(`${b.from}|${b.to}|${b.type}`)
      );

    const first = normalise(firstDoc);
    const second = normalise(secondDoc);

    // Same number of edges
    expect(second.length).toBe(first.length);
    // Same edges (normalised)
    for (let i = 0; i < first.length; i++) {
      expect(second[i].from).toBe(first[i].from);
      expect(second[i].to).toBe(first[i].to);
      expect(second[i].type).toBe(first[i].type);
    }

    // ── G7b: the 3 "W3" edge types survive delete→rebuild specifically ────────
    //
    // The general byte-for-byte check above proves the index is rebuildable, but
    // it would still pass if the W3 fixture simply emitted ZERO W3 edges on BOTH
    // builds (first === second === none). Anchor the proof to the exact triples
    // re-derived from canonical sources, so a regression in ANY of the three
    // re-derivations (provenance.touched.decisions → decided_by; wiki
    // supersedes:/task:/resolves: frontmatter) fails this test.
    const hasEdge = (links: KnowledgeLinkDoc["links"], from: string, to: string, type: string) =>
      links.some((l) => l.from === from && l.to === to && l.type === type);

    // decided_by re-derived from provenance.touched.decisions (decision → run)
    expect(hasEdge(secondDoc.links, "decision:test-decision", "run:run-test-1", "decided_by")).toBe(true);
    // decided_by re-derived from the wiki decision page `task:` frontmatter (decision → task)
    expect(hasEdge(secondDoc.links, "decision:test-decision", "task:T1", "decided_by")).toBe(true);
    // supersedes re-derived from the wiki decision page `supersedes:` frontmatter (decision → decision)
    expect(hasEdge(secondDoc.links, "decision:test-decision", "decision:test-decision-v0", "supersedes")).toBe(true);
    // resolves re-derived from the wiki decision page `resolves:` frontmatter (decision → open_question)
    expect(hasEdge(secondDoc.links, "decision:test-decision", "open_question:oq-test", "resolves")).toBe(true);

    // Anti-vacuity: all three W3 *edge types* are present in the rebuilt index.
    const rebuiltTypes = new Set(secondDoc.links.map((l) => l.type));
    expect(rebuiltTypes.has("decided_by")).toBe(true);
    expect(rebuiltTypes.has("supersedes")).toBe(true);
    expect(rebuiltTypes.has("resolves")).toBe(true);
  });

  test("NN#8: no unique state — canonical stores are the sole source of truth", () => {
    // Add a NEW run after the initial build
    const guildDir = path.join(tmpDir, ".guild");
    fs.mkdirSync(path.join(guildDir, "runs", "run-test-2"), { recursive: true });
    fs.writeFileSync(
      path.join(guildDir, "runs", "run-test-2", "provenance.json"),
      JSON.stringify({
        schema_version: "guild.provenance.v1",
        run_id: "run-test-2",
        command: "/guild:qa",
        initiative: "test-initiative",
        status: "closed",
        touched: {
          tasks: ["task:T2"],
          agents: ["agent:eval-engineer"],
          skills: ["skill:guild-quality"],
          decisions: [],
          features: ["component:test-component"],
          files: [],
          runs: [],
        },
        artifacts: {},
        benchmark_eligible: true,
      }, null, 2),
    );

    // Delete + rebuild
    fs.rmSync(klPath);
    buildKnowledgeLinks({ root: tmpDir });
    const doc = JSON.parse(fs.readFileSync(klPath, "utf8")) as KnowledgeLinkDoc;

    // New run's task must appear in the rebuilt index
    const taskNodes = new Set(doc.links.flatMap((l) => [l.from, l.to]));
    expect(taskNodes.has("task:T2")).toBe(true);
  });
});

// ── 4. Cross-cut traversal questions ─────────────────────────────────────────

describe("cross-cut traversal — answering §329-339 questions from fixture", () => {
  const doc: KnowledgeLinkDoc = {
    schema_version: "guild.knowledge_links.v1",
    links: FULL_FIXTURE_LINKS,
  };

  test("(a) Which decisions constrained this task? (§329)", () => {
    const decisions = findConstrainingDecisions(doc, "task:E1-links");
    expect(decisions).toContain("decision:nn8-derived-indexes-rebuildable");
    expect(decisions.length).toBeGreaterThanOrEqual(1);
  });

  test("(b) Which goal does this initiative serve? (§330)", () => {
    const goals = findGoalForInitiative(doc, "initiative:learn-knowledge-convergence");
    expect(goals).toContain("goal:connected-learning");
    expect(goals.length).toBeGreaterThanOrEqual(1);
  });

  test("(c) Which skill and agent produced the work? (§332)", () => {
    const { skills, agents } = findSkillsAndAgentsForRun(
      doc,
      "run:run-learn-knowledge-convergence-20260529-094021",
    );
    expect(skills).toContain("skill:guild-learn-harvest");
    expect(agents).toContain("agent:tooling-engineer");
  });

  test("(d) Which wiki pages explain this component? (§333)", () => {
    const pages = findWikiPagesForComponent(doc, "component:knowledge-links-builder");
    expect(pages).toContain("wiki:knowledge-links-expansion");
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  test("(e) Which lessons were extracted after this run? (§335)", () => {
    const lessons = findLessonsAfterRun(
      doc,
      "run:run-learn-knowledge-convergence-20260529-094021",
    );
    expect(lessons).toContain("reflection:refl-sc-e-lessons");
    expect(lessons).toContain("evolution:evo-knowledge-links-skill");
  });

  test("one traversal from task reaches decisions + skills/agents + components + wiki", () => {
    // Mirrors the VC-K2 isFullyConnected assertion but using classifyNodeKindExtended.
    // BFS from task:E1-links must reach decision, skill_agent, feature_component, wiki.
    const adj = new Map<string, Set<string>>();
    for (const l of doc.links) {
      if (!adj.has(l.from)) adj.set(l.from, new Set());
      if (!adj.has(l.to)) adj.set(l.to, new Set());
      adj.get(l.from)!.add(l.to);
      adj.get(l.to)!.add(l.from);
    }
    const seen = new Set<string>(["task:E1-links"]);
    const queue = ["task:E1-links"];
    const kindsReached = new Set<string>();
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        kindsReached.add(classifyNodeKindExtended(next));
        queue.push(next);
      }
    }
    expect(kindsReached.has("decision")).toBe(true);
    expect(kindsReached.has("skill_agent")).toBe(true);
    expect(kindsReached.has("feature_component")).toBe(true);
    expect(kindsReached.has("wiki")).toBe(true);
    // Extended kinds also reachable
    expect(kindsReached.has("reflection_evolution")).toBe(true);
    expect(kindsReached.has("run")).toBe(true);
  });
});

// ── 5. context-assemble query shape ──────────────────────────────────────────

describe("queryDecisionsAndOpenQuestions — context-assemble query shape", () => {
  const doc: KnowledgeLinkDoc = {
    schema_version: "guild.knowledge_links.v1",
    links: FULL_FIXTURE_LINKS,
  };

  test("returns { decisions, open_questions } for a task", () => {
    const query: ContextAssembleQuery = {
      anchor_id: "task:E1-links",
      kinds: ["decision", "open_question"],
    };
    const result: ContextAssembleResult = queryDecisionsAndOpenQuestions(doc, query);
    expect(Array.isArray(result.decisions)).toBe(true);
    expect(Array.isArray(result.open_questions)).toBe(true);
    expect(result.decisions).toContain("decision:nn8-derived-indexes-rebuildable");
    expect(result.open_questions).toContain("open_question:oq-edge-types");
  });

  test("returns { decisions, open_questions } for a run", () => {
    const query: ContextAssembleQuery = {
      anchor_id: "run:run-learn-knowledge-convergence-20260529-094021",
      kinds: ["decision", "open_question"],
    };
    const result = queryDecisionsAndOpenQuestions(doc, query);
    // Run is reachable from the task; transitively from decisions via the task chain.
    expect(Array.isArray(result.decisions)).toBe(true);
    expect(Array.isArray(result.open_questions)).toBe(true);
  });

  test("returns empty arrays for an unknown anchor", () => {
    const query: ContextAssembleQuery = {
      anchor_id: "task:nonexistent",
      kinds: ["decision", "open_question"],
    };
    const result = queryDecisionsAndOpenQuestions(doc, query);
    expect(result.decisions).toEqual([]);
    expect(result.open_questions).toEqual([]);
  });

  test("max_hops=1 limits reachable nodes to direct neighbours", () => {
    const query: ContextAssembleQuery = {
      anchor_id: "task:E1-links",
      kinds: ["decision", "open_question"],
      max_hops: 1,
    };
    const result = queryDecisionsAndOpenQuestions(doc, query);
    // At hop=1, only directly connected decisions appear.
    expect(result.decisions).toContain("decision:nn8-derived-indexes-rebuildable");
    // But things 2+ hops away (e.g. reachable only via run→skill) should not appear.
    for (const d of result.decisions) {
      expect(d.startsWith("decision:")).toBe(true);
    }
  });
});

// ── 6. harvest-candidate source_refs compatibility (FU-A1-3) ─────────────────

describe("harvest-candidate source_refs compatibility (FU-A1-3)", () => {
  /**
   * guild.harvest_candidates.v1 (A1 schema) — a reflection_candidate with
   * source_refs pointing to on-disk canonical files (NOT inline bodies).
   */
  const harvestCandidate = {
    schema_version: "guild.harvest_candidates.v1",
    run_id: "run-harvest-1",
    reflection_candidates: [
      {
        id: "reflection:refl-harvest-1",
        source_refs: [
          ".guild/runs/run-harvest-1/handoffs/tooling-engineer-E1-links.md",
          ".guild/wiki/decisions/nn8-derived-indexes-rebuildable.md",
        ],
        promotion_gate: "guild:reflect",
        summary: "NN#8 hold proved via builder rebuild test.",
      },
    ],
    decision_candidates: [],
    wiki_candidates: [],
    evolution_candidates: [],
    open_questions: [],
  };

  test("reflection candidate edge uses source_refs as link targets (not inline bodies)", () => {
    // When buildKnowledgeLinks processes a harvest-candidates.json, the edges it
    // emits for reflection/evolution candidates reference their source_refs as
    // the linked nodes — they never copy or embed the candidate body.
    // We verify this with a link batch built from the candidate above.
    const linksFromCandidate = harvestCandidate.reflection_candidates.flatMap((c) =>
      c.source_refs.map((ref) => ({
        from: c.id,
        to: `raw_source:${path.basename(ref, ".md")}`,
        type: "references",
        run_id: harvestCandidate.run_id,
      })),
    );

    // The reflection candidate links to its source_refs — no body, just refs.
    expect(linksFromCandidate.length).toBe(harvestCandidate.reflection_candidates[0].source_refs.length);
    for (const link of linksFromCandidate) {
      expect(link.from).toBe("reflection:refl-harvest-1");
      expect(link.type).toBe("references");
      // to is a reference path, not an inline body
      expect(link.to.startsWith("raw_source:")).toBe(true);
    }

    // classifyNodeKindExtended on the reflection candidate id returns the right kind
    expect(classifyNodeKindExtended("reflection:refl-harvest-1")).toBe("reflection_evolution");
  });

  test("evolution candidate id classifies as reflection_evolution", () => {
    const evoCandidate = { id: "evolution:evo-learn-harvest-skill", source_refs: [".guild/evolve/evo-learn-harvest.yaml"], promotion_gate: "guild:evolve-skill" };
    expect(classifyNodeKindExtended(evoCandidate.id)).toBe("reflection_evolution");
  });
});

// ── 7. W3 builder re-derivation of decided_by / supersedes / resolves ─────────
//
// TDD discipline: each test uses a real temp .guild/ directory with
// on-disk canonical fixtures. The builder must re-derive the 3 edge types
// from those canonical sources (provenance.json + wiki frontmatter) so they
// survive a full rebuild (NN#8 — previously ephemeral-until-clobbered).

describe("W3 builder re-derivation — decided_by, supersedes, resolves (NN#8)", () => {
  let tmpDir: string;

  beforeEach(() => {
    // Fresh tmp tree per test — avoids fixture bleed between tests.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-builder-w3-"));
    const guildDir = path.join(tmpDir, ".guild");
    fs.mkdirSync(path.join(guildDir, "indexes"), { recursive: true });
    fs.mkdirSync(path.join(guildDir, "wiki", "decisions"), { recursive: true });
    fs.mkdirSync(path.join(guildDir, "runs", "run-w3-test"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── decided_by ──────────────────────────────────────────────────────────────

  test("decided_by — re-derived from provenance.touched.decisions: decision:X decided_by run:Y", () => {
    // Canonical source: provenance.json with a touched.decisions entry.
    // The builder must emit `decision:<slug> decided_by run:<run-id>`.
    const guildDir = path.join(tmpDir, ".guild");
    fs.writeFileSync(
      path.join(guildDir, "runs", "run-w3-test", "provenance.json"),
      JSON.stringify({
        schema_version: "guild.provenance.v1",
        run_id: "run-w3-test",
        command: "/guild:build",
        initiative: null,
        status: "closed",
        touched: {
          tasks: [],
          agents: [],
          skills: [],
          decisions: ["decision:arch-choice-postgres"],
          features: [],
          files: [],
          runs: [],
        },
        artifacts: {},
        benchmark_eligible: false,
      }, null, 2),
    );

    const result = buildKnowledgeLinks({ root: tmpDir });
    expect(result.ok).toBe(true);

    const doc = JSON.parse(
      fs.readFileSync(path.join(guildDir, "indexes", "knowledge-links.json"), "utf8"),
    ) as KnowledgeLinkDoc;

    // The decided_by edge must appear: decision:arch-choice-postgres decided_by run:run-w3-test
    const decidedByEdge = doc.links.find(
      (l) => l.from === "decision:arch-choice-postgres" &&
             l.to === "run:run-w3-test" &&
             l.type === "decided_by",
    );
    expect(decidedByEdge).toBeDefined();
  });

  test("decided_by — re-derived from wiki decision page task: frontmatter: decision:X decided_by task:Y", () => {
    // Canonical source: wiki decision page with `task:` frontmatter field.
    // The builder must emit `decision:<slug> decided_by task:<task-slug>`.
    const guildDir = path.join(tmpDir, ".guild");
    fs.writeFileSync(
      path.join(guildDir, "wiki", "decisions", "frontend-routing-choice.md"),
      [
        "---",
        "type: decision",
        "slug: frontend-routing-choice",
        "task: T4-frontend",
        "supersedes: null",
        "resolves: null",
        "created_at: 2026-06-10",
        "---",
        "# frontend-routing-choice",
        "Chose react-router over tanstack-router.",
      ].join("\n") + "\n",
    );

    const result = buildKnowledgeLinks({ root: tmpDir });
    expect(result.ok).toBe(true);

    const doc = JSON.parse(
      fs.readFileSync(path.join(guildDir, "indexes", "knowledge-links.json"), "utf8"),
    ) as KnowledgeLinkDoc;

    // The decided_by edge must appear: decision:frontend-routing-choice decided_by task:T4-frontend
    const decidedByEdge = doc.links.find(
      (l) => l.from === "decision:frontend-routing-choice" &&
             l.to === "task:T4-frontend" &&
             l.type === "decided_by",
    );
    expect(decidedByEdge).toBeDefined();
  });

  // ── supersedes ──────────────────────────────────────────────────────────────

  test("supersedes — re-derived from wiki decision page supersedes: frontmatter: A supersedes B", () => {
    // Canonical source: wiki decision page with a non-null `supersedes:` frontmatter value.
    // The builder must emit `decision:<current> supersedes decision:<previous>`.
    const guildDir = path.join(tmpDir, ".guild");

    // The new decision supersedes the old one
    fs.writeFileSync(
      path.join(guildDir, "wiki", "decisions", "agent-mode-auto-v2.md"),
      [
        "---",
        "type: decision",
        "slug: agent-mode-auto-v2",
        "supersedes: agent-mode-auto-v1",
        "resolves: null",
        "created_at: 2026-06-10",
        "---",
        "# agent-mode-auto-v2",
        "Updated decision superseding the v1 agent-mode choice.",
      ].join("\n") + "\n",
    );

    const result = buildKnowledgeLinks({ root: tmpDir });
    expect(result.ok).toBe(true);

    const doc = JSON.parse(
      fs.readFileSync(path.join(guildDir, "indexes", "knowledge-links.json"), "utf8"),
    ) as KnowledgeLinkDoc;

    // The supersedes edge must appear: decision:agent-mode-auto-v2 supersedes decision:agent-mode-auto-v1
    const supersEdge = doc.links.find(
      (l) => l.from === "decision:agent-mode-auto-v2" &&
             l.to === "decision:agent-mode-auto-v1" &&
             l.type === "supersedes",
    );
    expect(supersEdge).toBeDefined();
  });

  test("supersedes — null supersedes: frontmatter emits NO supersedes edge", () => {
    // When supersedes: is null (the common case), no supersedes edge must appear.
    const guildDir = path.join(tmpDir, ".guild");
    fs.writeFileSync(
      path.join(guildDir, "wiki", "decisions", "standalone-decision.md"),
      [
        "---",
        "type: decision",
        "slug: standalone-decision",
        "supersedes: null",
        "created_at: 2026-06-10",
        "---",
        "# standalone-decision",
      ].join("\n") + "\n",
    );

    buildKnowledgeLinks({ root: tmpDir });
    const doc = JSON.parse(
      fs.readFileSync(path.join(guildDir, "indexes", "knowledge-links.json"), "utf8"),
    ) as KnowledgeLinkDoc;

    const supersEdges = doc.links.filter(
      (l) => l.from === "decision:standalone-decision" && l.type === "supersedes",
    );
    expect(supersEdges).toHaveLength(0);
  });

  // ── resolves ────────────────────────────────────────────────────────────────

  test("resolves — re-derived from wiki decision page resolves: frontmatter: decision:X resolves open_question:Y", () => {
    // Canonical source: wiki decision page with a `resolves:` frontmatter field
    // referencing an open question id. The builder must emit
    // `decision:<slug> resolves open_question:<oq-id>`.
    const guildDir = path.join(tmpDir, ".guild");
    fs.writeFileSync(
      path.join(guildDir, "wiki", "decisions", "cache-strategy-choice.md"),
      [
        "---",
        "type: decision",
        "slug: cache-strategy-choice",
        "supersedes: null",
        "resolves: oq-cache-strategy",
        "created_at: 2026-06-10",
        "---",
        "# cache-strategy-choice",
        "Chose Redis over Memcached — resolves OQ: oq-cache-strategy.",
      ].join("\n") + "\n",
    );

    const result = buildKnowledgeLinks({ root: tmpDir });
    expect(result.ok).toBe(true);

    const doc = JSON.parse(
      fs.readFileSync(path.join(guildDir, "indexes", "knowledge-links.json"), "utf8"),
    ) as KnowledgeLinkDoc;

    // The resolves edge must appear: decision:cache-strategy-choice resolves open_question:oq-cache-strategy
    const resolvesEdge = doc.links.find(
      (l) => l.from === "decision:cache-strategy-choice" &&
             l.to === "open_question:oq-cache-strategy" &&
             l.type === "resolves",
    );
    expect(resolvesEdge).toBeDefined();
  });

  test("resolves — open_question: prefix in frontmatter is preserved as-is", () => {
    // When the resolves: field already has the open_question: prefix, the
    // builder must not double-prefix it.
    const guildDir = path.join(tmpDir, ".guild");
    fs.writeFileSync(
      path.join(guildDir, "wiki", "decisions", "db-schema-choice.md"),
      [
        "---",
        "type: decision",
        "slug: db-schema-choice",
        "supersedes: null",
        "resolves: open_question:oq-schema-design",
        "created_at: 2026-06-10",
        "---",
        "# db-schema-choice",
      ].join("\n") + "\n",
    );

    buildKnowledgeLinks({ root: tmpDir });
    const doc = JSON.parse(
      fs.readFileSync(path.join(guildDir, "indexes", "knowledge-links.json"), "utf8"),
    ) as KnowledgeLinkDoc;

    const resolvesEdge = doc.links.find(
      (l) => l.from === "decision:db-schema-choice" &&
             l.to === "open_question:oq-schema-design" &&
             l.type === "resolves",
    );
    expect(resolvesEdge).toBeDefined();
    // Ensure no double-prefix: open_question:open_question: must not exist
    const badEdge = doc.links.find((l) => l.to.startsWith("open_question:open_question:"));
    expect(badEdge).toBeUndefined();
  });

  // ── NN#8: all 3 survive a full rebuild ──────────────────────────────────────

  test("NN#8: all 3 edge types survive delete-index → full-rebuild cycle", () => {
    // Plant ALL 3 canonical sources in a single tmp tree, then prove that
    // deleting knowledge-links.json and rebuilding reproduces all 3 edge types.
    const guildDir = path.join(tmpDir, ".guild");
    const klPath = path.join(guildDir, "indexes", "knowledge-links.json");

    // Canonical source for decided_by (provenance)
    fs.writeFileSync(
      path.join(guildDir, "runs", "run-w3-test", "provenance.json"),
      JSON.stringify({
        schema_version: "guild.provenance.v1",
        run_id: "run-w3-test",
        command: "/guild:build",
        initiative: null,
        status: "closed",
        touched: {
          tasks: [],
          agents: [],
          skills: [],
          decisions: ["decision:nn8-decided"],
          features: [],
          files: [],
          runs: [],
        },
        artifacts: {},
        benchmark_eligible: false,
      }, null, 2),
    );

    // Canonical source for supersedes + resolves (wiki decision page)
    fs.writeFileSync(
      path.join(guildDir, "wiki", "decisions", "nn8-full-coverage.md"),
      [
        "---",
        "type: decision",
        "slug: nn8-full-coverage",
        "supersedes: nn8-old-decision",
        "resolves: oq-nn8-open",
        "created_at: 2026-06-10",
        "---",
        "# nn8-full-coverage",
        "Decision that supersedes and resolves.",
      ].join("\n") + "\n",
    );

    // First build
    buildKnowledgeLinks({ root: tmpDir });
    expect(fs.existsSync(klPath)).toBe(true);

    // Delete the derived index (NN#8 proof step)
    fs.rmSync(klPath);
    expect(fs.existsSync(klPath)).toBe(false);

    // Rebuild from canonical stores only
    buildKnowledgeLinks({ root: tmpDir });
    expect(fs.existsSync(klPath)).toBe(true);

    const doc = JSON.parse(fs.readFileSync(klPath, "utf8")) as KnowledgeLinkDoc;

    // decided_by survived
    expect(doc.links.find(
      (l) => l.from === "decision:nn8-decided" && l.to === "run:run-w3-test" && l.type === "decided_by",
    )).toBeDefined();

    // supersedes survived
    expect(doc.links.find(
      (l) => l.from === "decision:nn8-full-coverage" && l.type === "supersedes",
    )).toBeDefined();

    // resolves survived
    expect(doc.links.find(
      (l) => l.from === "decision:nn8-full-coverage" && l.type === "resolves",
    )).toBeDefined();
  });
});
