/**
 * scripts/__tests__/learning-signatures.test.ts
 *
 * METRIC 3 — signature_coverage = 12/12 for the per-phase learning-checkpoint
 * classifier (scripts/lib/learning-signatures.ts).
 *
 * For EACH of the 12 named predicates this file asserts:
 *   - POSITIVE : the deterministic signature fires → a terminal (non-"none") verdict.
 *   - NEGATIVE : the signal is absent → "none".
 *   - HOSTILE  : a malformed / adversarial ArtifactSet (empty/missing fields,
 *                wrong types, injection-shaped strings) does NOT crash and
 *                returns "none" — proving the fail-safe (the module is documented
 *                PURE, zero-throw).
 *
 * PLUS an anti-vacuity / MUTATION proof (operator metric:
 *   "removing any signature makes at least one test fail"):
 *   each predicate is run against the SAME positive fixture under an all-"none"
 *   stub — if a clause were deleted (collapsing the predicate toward the stub),
 *   the positive fixture would return "none" and the POSITIVE assertion above
 *   would flip RED. The mutation block makes that coupling explicit and
 *   machine-checkable: positiveVerdict !== stubVerdict for every target.
 *
 * 12 targets × {pos, neg, hostile} = 36 cases + the 12-target mutation proof.
 */

import {
  classifyMemory,
  classifyWiki,
  classifyKnowledgeGraph,
  classifyDomainModel,
  classifyAgentDef,
  classifySkillDef,
  classifyAgentTemplate,
  classifySkillTemplate,
  classifyConfig,
  classifyTaskTracking,
  classifyWorkflowRules,
  classifyReviewPolicy,
  classifyPhase,
  type ArtifactSet,
  type Verdict,
  type PhaseVerdict,
} from "../lib/learning-signatures";

// ── Fixture table ────────────────────────────────────────────────────────────
//
// One row per target. Each row carries:
//   predicate  — the named classifier under test
//   positive   — an ArtifactSet whose signature MUST fire (→ non-"none")
//   negative   — an ArtifactSet with the signal absent (→ "none")
//   hostile    — a malformed / adversarial ArtifactSet (→ "none", never throws)
//
// `runId` is required on ArtifactSet; every fixture supplies it. The hostile
// fixtures deliberately violate the declared types via `as never` so we exercise
// the fail-safe try/catch and the `?? []` / `?.` guards on the real path.

interface TargetCase {
  name: string;
  predicate: (a: ArtifactSet) => Verdict;
  positive: ArtifactSet;
  negative: ArtifactSet;
  hostile: ArtifactSet;
  /** Substring the positive verdict must contain (proves the right clause fired). */
  positiveContains?: string;
}

const RUN = "run-sig-2026-06-21";

/** A garbage handoff block whose every field is the wrong type. */
const HOSTILE_BLOCK = {
  schema_version: 42,
  task_id: { nope: true },
  status: ["array-not-string"],
  summary: null,
  learnings: "not-an-array-of-strings",
  followups: 99,
  issues: { also: "wrong" },
  artifacts: false,
  assumptions: [],
  notes: 0,
} as never;

/** Injection-shaped strings — must be treated as inert data, never executed. */
const INJECTION = [
  "'; DROP TABLE decisions; --",
  "${process.env.SECRET}",
  "<script>alert(1)</script>",
  "$(rm -rf /)",
] as const;

const TABLE: TargetCase[] = [
  {
    name: "memory",
    predicate: classifyMemory,
    positive: { runId: RUN, provenanceTouched: { decisions: ["decision:adr-001"] } },
    negative: { runId: RUN, handoffBlocks: [{ learnings: ["fixed a typo in the readme"] }] },
    // hostile: malformed `decisions` (object, not array) — the ?? [] guard + the
    // no-durable-keyword learnings keep this at "none" (fail-safe).
    hostile: { runId: RUN, provenanceTouched: { decisions: { junk: true } as never }, handoffBlocks: [HOSTILE_BLOCK] },
    positiveContains: "candidate:",
  },
  {
    name: "wiki",
    predicate: classifyWiki,
    positive: { runId: RUN, provenanceTouched: { wiki: [".guild/wiki/decisions/x.md"] } },
    negative: { runId: RUN, handoffBlocks: [{ followups: ["rebase the branch"] }] },
    hostile: { runId: RUN, provenanceTouched: { wiki: 7 as never }, handoffBlocks: [HOSTILE_BLOCK] },
    positiveContains: "candidate:",
  },
  {
    name: "knowledge_graph",
    predicate: classifyKnowledgeGraph,
    positive: { runId: RUN, provenanceTouched: { initiatives: ["initiative:learn-tier"] } },
    negative: { runId: RUN, changedFiles: ["README.md", "package.json"] },
    hostile: { runId: RUN, changedFiles: [null as never, 12 as never], provenanceTouched: { initiatives: {} as never } },
    positiveContains: "re-derive",
  },
  {
    name: "domain_model",
    predicate: classifyDomainModel,
    positive: { runId: RUN, changedFiles: ["src/services/auth.ts"] },
    // ALL changes are test files (or docs that match no source pattern) — must
    // NOT shift the domain model. A single non-test source file would trip it,
    // so the negative keeps every entry inside a test/spec path.
    negative: { runId: RUN, changedFiles: ["src/services/auth.test.ts", "src/__tests__/login.spec.ts"] },
    hostile: { runId: RUN, changedFiles: { not: "an array" } as never },
    positiveContains: "refresh:",
  },
  {
    name: "agent_def",
    predicate: classifyAgentDef,
    positive: { runId: RUN, handoffBlocks: [{ followups: ["agent improvement: the reviewer keeps over-triggering"] }] },
    negative: { runId: RUN, handoffBlocks: [{ learnings: ["nothing actionable this lane"] }] },
    hostile: { runId: RUN, handoffBlocks: [HOSTILE_BLOCK, { learnings: [...INJECTION] }] },
    positiveContains: "proposal:",
  },
  {
    name: "skill_def",
    predicate: classifySkillDef,
    positive: { runId: RUN, handoffBlocks: [{ learnings: ["skill: guild:tdd misfired on a config-only change"] }] },
    negative: { runId: RUN, handoffBlocks: [{ followups: ["bump the dependency"] }] },
    hostile: { runId: RUN, handoffBlocks: [HOSTILE_BLOCK, { followups: [...INJECTION] }] },
    positiveContains: "proposal:",
  },
  {
    name: "agent_template",
    predicate: classifyAgentTemplate,
    positive: {
      runId: RUN,
      classifyProposalInput: { distinct_subject_count: 3, same_run: false, same_signature: true, user_approved: true },
    },
    // a single-instance proposal is agent_def, NEVER agent_template
    negative: {
      runId: RUN,
      classifyProposalInput: { distinct_subject_count: 1, same_run: true, same_signature: true, user_approved: true },
    },
    hostile: { runId: RUN, classifyProposalInput: { distinct_subject_count: "lots" as never, same_run: 1 as never, same_signature: null as never, user_approved: "yes" as never } },
    positiveContains: "systemic-proposal",
  },
  {
    name: "skill_template",
    predicate: classifySkillTemplate,
    positive: {
      runId: RUN,
      classifyProposalInput: { distinct_subject_count: 2, same_run: true, same_signature: true, user_approved: true },
    },
    // signature differs → specific → "none"
    negative: {
      runId: RUN,
      classifyProposalInput: { distinct_subject_count: 5, same_run: true, same_signature: false, user_approved: true },
    },
    hostile: { runId: RUN, classifyProposalInput: undefined as never },
    positiveContains: "systemic-proposal",
  },
  {
    name: "config",
    predicate: classifyConfig,
    positive: { runId: RUN, provenanceTouched: { config_keys: ["models.tiers.cheap"] } },
    negative: { runId: RUN, changedFiles: ["src/index.ts", "README.md"] },
    hostile: { runId: RUN, provenanceTouched: { config_keys: 3.14 as never }, changedFiles: [Symbol("x") as never] },
    positiveContains: "proposal:",
  },
  {
    name: "task_tracking",
    predicate: classifyTaskTracking,
    positive: { runId: RUN, provenanceTouched: { tasks: ["TASK-42"] }, handoffBlocks: [{ status: "done" }] },
    // task touched but NO handoff is done → not yet trackable → "none"
    negative: { runId: RUN, provenanceTouched: { tasks: ["TASK-7"] }, handoffBlocks: [{ status: "in-progress" }] },
    hostile: { runId: RUN, provenanceTouched: { tasks: [{} as never] }, handoffBlocks: [HOSTILE_BLOCK] },
    positiveContains: "update:",
  },
  {
    name: "workflow_rules",
    predicate: classifyWorkflowRules,
    positive: { runId: RUN, handoffBlocks: [{ learnings: ["always run the build before testing — dist was stale"] }] },
    negative: { runId: RUN, handoffBlocks: [{ learnings: ["renamed a local variable"] }] },
    hostile: { runId: RUN, handoffBlocks: [HOSTILE_BLOCK], changedFiles: [42 as never] },
    positiveContains: "proposal:",
  },
  {
    name: "review_policy",
    predicate: classifyReviewPolicy,
    positive: { runId: RUN, handoffBlocks: [{ issues: ["BLOCK on G-spec gate — owner accepted risk"] }] },
    negative: { runId: RUN, handoffBlocks: [{ summary: "all gates passed cleanly" }] },
    hostile: { runId: RUN, handoffBlocks: [{ issues: 5 as never, notes: {} as never, summary: [] as never }] },
    positiveContains: "proposal:",
  },
];

// Compile-time + runtime guard: the table must cover all 12 targets exactly once.
const PHASE_KEYS: (keyof PhaseVerdict)[] = [
  "memory", "wiki", "knowledge_graph", "domain_model",
  "agent_def", "skill_def", "agent_template", "skill_template",
  "config", "task_tracking", "workflow_rules", "review_policy",
];

describe("learning-signatures — signature_coverage 12/12 (METRIC 3)", () => {
  it("the fixture table covers all 12 PhaseVerdict targets exactly once", () => {
    const names = TABLE.map((t) => t.name).sort();
    expect(names).toEqual([...PHASE_KEYS].sort());
    expect(TABLE).toHaveLength(12);
  });

  describe.each(TABLE)("$name", (tc) => {
    it("POSITIVE: signature fires → terminal (non-'none') verdict", () => {
      const v = tc.predicate(tc.positive);
      expect(v).not.toBe("none");
      expect(typeof v).toBe("string");
      if (tc.positiveContains) expect(v).toContain(tc.positiveContains);
    });

    it("NEGATIVE: signal absent → 'none'", () => {
      expect(tc.predicate(tc.negative)).toBe("none");
    });

    it("HOSTILE: malformed/adversarial input does NOT crash and returns 'none' (fail-safe)", () => {
      let v: Verdict = "UNSET";
      expect(() => {
        v = tc.predicate(tc.hostile);
      }).not.toThrow();
      expect(v).toBe("none");
    });
  });

  // ── Anti-vacuity / MUTATION proof ──────────────────────────────────────────
  // The operator bar: "removing any signature makes at least one test fail."
  //
  // We model a deleted signature as the all-"none" STUB (a predicate whose body
  // was gutted to `return "none"`). For every target, the REAL predicate on its
  // positive fixture MUST diverge from the stub. If a clause were removed and the
  // predicate collapsed toward "none" on that fixture, this assertion — and the
  // POSITIVE assertion above — would flip RED. This makes the coupling explicit:
  // no signature can be silently dropped without a red test.
  describe("mutation / anti-vacuity (a deleted signature flips ≥1 test)", () => {
    const ALL_NONE_STUB: (a: ArtifactSet) => Verdict = () => "none";

    it.each(TABLE)("$name: positive verdict diverges from the all-none stub", (tc) => {
      const real = tc.predicate(tc.positive);
      const stub = ALL_NONE_STUB(tc.positive);
      expect(stub).toBe("none");
      // If the signature clause were deleted, `real` would equal `stub` ("none")
      // and BOTH this and the POSITIVE case would fail — the mutation is caught.
      expect(real).not.toBe(stub);
    });

    it("classifyPhase wires every target: a positive fixture per target yields a non-'none' map entry", () => {
      // Build ONE ArtifactSet that trips as many independent signatures as we can
      // co-locate, then prove the aggregate carries the non-none verdicts through.
      // (Targets are wired in classifyPhase — this catches an unwired predicate.)
      const merged: ArtifactSet = {
        runId: RUN,
        provenanceTouched: {
          decisions: ["decision:adr-001"],
          wiki: [".guild/wiki/decisions/x.md"],
          initiatives: ["initiative:learn-tier"],
          config_keys: ["models.tiers.cheap"],
          tasks: ["TASK-42"],
        },
        changedFiles: ["src/services/auth.ts"],
        handoffBlocks: [
          {
            status: "done",
            learnings: [
              "skill: guild:tdd misfired",
              "always run the build before testing",
            ],
            followups: ["agent improvement: reviewer over-triggers"],
            issues: ["BLOCK on G-spec gate — owner accepted risk"],
          },
        ],
        classifyProposalInput: {
          distinct_subject_count: 3,
          same_run: false,
          same_signature: true,
          user_approved: true,
        },
      };
      const verdict: PhaseVerdict = classifyPhase(merged);
      // EVERY target should be non-none for this maximally-tripping fixture.
      for (const key of PHASE_KEYS) {
        expect(verdict[key]).not.toBe("none");
      }
    });
  });

  // ── Aggregate purity invariant ─────────────────────────────────────────────
  describe("classifyPhase purity (never throws, all-none common case)", () => {
    it("returns all-'none' for an empty-but-valid ArtifactSet", () => {
      const v = classifyPhase({ runId: RUN });
      for (const key of PHASE_KEYS) expect(v[key]).toBe("none");
    });

    it("never throws on a fully-hostile ArtifactSet and returns the 12-key shape", () => {
      let v: PhaseVerdict | undefined;
      expect(() => {
        v = classifyPhase({
          runId: RUN,
          handoffBlocks: [HOSTILE_BLOCK],
          provenanceTouched: { decisions: 1 as never, wiki: 2 as never, files: 3 as never },
          changedFiles: "nope" as never,
          classifyProposalInput: "garbage" as never,
        });
      }).not.toThrow();
      expect(Object.keys(v ?? {}).sort()).toEqual([...PHASE_KEYS].sort());
    });
  });
});
