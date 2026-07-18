/**
 * scripts/__tests__/learning-candidate.test.ts
 *
 * Typed learning_candidate shape (docs/v2/knowledge-memory.html §Candidate
 * queue; deferred item 9): closed 7-value type, the promotion policy
 * (destination + gate), derivation from guild.harvest_candidates.v1, validation.
 */

import {
  LEARNING_CANDIDATE_TYPES,
  recommendedDestination,
  promotionGate,
  makeLearningCandidate,
  isValidLearningCandidate,
  deriveLearningCandidates,
} from "../lib/learning-candidate";

test("closed 7-value type enum", () => {
  expect([...LEARNING_CANDIDATE_TYPES]).toEqual([
    "fact", "decision", "assumption", "unknown", "standard", "skill_improvement", "eval_fixture",
  ]);
});

test("recommendedDestination routes each type", () => {
  expect(recommendedDestination("fact")).toBe("wiki");
  expect(recommendedDestination("standard")).toBe("wiki:standards");
  expect(recommendedDestination("decision")).toBe("decision");
  expect(recommendedDestination("skill_improvement")).toBe("skill");
  expect(recommendedDestination("eval_fixture")).toBe("eval");
  expect(recommendedDestination("assumption")).toBe("run_local");
  expect(recommendedDestination("unknown")).toBe("run_local");
});

describe("promotionGate — the binding policy", () => {
  test("low-risk repo fact WITH evidence → auto_propose", () => {
    expect(promotionGate("fact", "high", ["src/a.ts#L1"], "repo")).toBe("auto_propose");
  });
  test("fact without evidence (or run-scoped, or low confidence) → human_approval", () => {
    expect(promotionGate("fact", "high", [], "repo")).toBe("human_approval");
    expect(promotionGate("fact", "high", ["x"], "run")).toBe("human_approval");
    expect(promotionGate("fact", "low", ["x"], "repo")).toBe("human_approval");
  });
  test("decisions / standards / skill changes → human_approval", () => {
    expect(promotionGate("decision", "high", ["x"], "repo")).toBe("human_approval");
    expect(promotionGate("standard", "high", ["x"], "repo")).toBe("human_approval");
    expect(promotionGate("skill_improvement", "high", ["x"], "repo")).toBe("human_approval");
  });
  test("eval fixtures auto-propose; failed hypotheses stay run-local", () => {
    expect(promotionGate("eval_fixture", "medium", [], "repo")).toBe("auto_propose");
    expect(promotionGate("assumption", "high", ["x"], "repo")).toBe("run_local");
    expect(promotionGate("unknown", "high", ["x"], "repo")).toBe("run_local");
  });
  test("secrets never promote — overrides everything", () => {
    expect(promotionGate("fact", "high", ["x"], "repo", true)).toBe("never");
    expect(promotionGate("eval_fixture", "high", ["x"], "repo", true)).toBe("never");
  });
});

test("makeLearningCandidate fills destination + gate from the policy", () => {
  const c = makeLearningCandidate({ type: "fact", summary: "X uses sha256", evidence_refs: ["a#L1"], confidence: "high" });
  expect(c.schema_version).toBe("guild.learning_candidate.v1");
  expect(c.recommended_destination).toBe("wiki");
  expect(c.promotion_gate).toBe("auto_propose");
  expect(isValidLearningCandidate(c)).toBe(true);
});

test("isValidLearningCandidate rejects off-enum / malformed", () => {
  expect(isValidLearningCandidate({ schema_version: "guild.learning_candidate.v1", type: "bogus", summary: "x", evidence_refs: [], recommended_destination: "wiki", promotion_gate: "never" })).toBe(false);
  expect(isValidLearningCandidate(null)).toBe(false);
  expect(isValidLearningCandidate({ type: "fact" })).toBe(false);
});

test("deriveLearningCandidates upgrades a harvest_candidates.v1 payload", () => {
  const harvest = {
    schema_version: "guild.harvest_candidates.v1",
    wiki_candidates: [
      { title: "auth uses JWT", confidence: "high", source_refs: ["src/auth.ts#L10"], category: "concepts" },
      { title: "release discipline", confidence: "high", source_refs: ["x#L1"], category: "standards" },
    ],
    decision_candidates: [
      { decision: "use Postgres", confidence: "medium", source_refs: ["adr/1.md#d"] },
    ],
  };
  const out = deriveLearningCandidates(harvest);
  expect(out).toHaveLength(3);
  expect(out.map((c) => c.type)).toEqual(["fact", "standard", "decision"]);
  // fact with evidence + high confidence → auto_propose; standard/decision → human.
  expect(out[0].promotion_gate).toBe("auto_propose");
  expect(out[1].promotion_gate).toBe("human_approval");
  expect(out[2].promotion_gate).toBe("human_approval");
  expect(out.every(isValidLearningCandidate)).toBe(true);
});

test("deriveLearningCandidates is safe on empty / malformed input", () => {
  expect(deriveLearningCandidates(null)).toEqual([]);
  expect(deriveLearningCandidates({})).toEqual([]);
  expect(deriveLearningCandidates({ wiki_candidates: "nope" })).toEqual([]);
});
