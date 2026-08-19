import {
  evaluateTaskCellPolicyPromotion,
  type TaskCellPolicyEvalObservationV1,
} from "../../src/modules/evals/workflows/task-cell-policy-eval";

function observation(
  scenario_id: string,
  mode: "single_agent_baseline" | "multi_agent_candidate",
  values: Partial<TaskCellPolicyEvalObservationV1> = {},
): TaskCellPolicyEvalObservationV1 {
  return {
    schema_version: "guild.task_cell_policy_eval_observation.v1",
    scenario_id,
    policy_id: mode === "single_agent_baseline" ? "single" : "multi",
    mode,
    quality_score: mode === "single_agent_baseline" ? 0.7 : 0.82,
    coverage_score: mode === "single_agent_baseline" ? 0.65 : 0.8,
    latency_ms: mode === "single_agent_baseline" ? 1000 : 900,
    risk_score: mode === "single_agent_baseline" ? 0.3 : 0.2,
    tokens: mode === "single_agent_baseline" ? 1000 : 1600,
    cost_usd: mode === "single_agent_baseline" ? 1 : 1.5,
    evidence_refs: [`receipts/${scenario_id}-${mode}.json`],
    ...values,
  };
}

describe("TaskCell multi-agent policy promotion gate", () => {
  it("promotes only an evidence-complete candidate with a bounded cost and material benefit", () => {
    const result = evaluateTaskCellPolicyPromotion({
      baseline: [observation("s1", "single_agent_baseline"), observation("s2", "single_agent_baseline")],
      candidate: [observation("s1", "multi_agent_candidate"), observation("s2", "multi_agent_candidate")],
      policy: {
        min_quality_gain: 0.05,
        min_coverage_gain: 0.05,
        min_latency_gain_ratio: 0.05,
        min_risk_reduction: 0.05,
        max_cost_multiplier: 2,
        max_latency_multiplier: 1.25,
        max_risk_increase: 0,
      },
    });
    expect(result.promote).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.comparison.cost_multiplier).toBe(1.5);
    expect(result.material_benefits).toEqual(expect.arrayContaining(["quality", "coverage", "latency", "risk"]));
  });

  it("refuses promotion for cost excess, missing paired scenarios, or unmeasured evidence", () => {
    const policy = {
      min_quality_gain: 0.05,
      min_coverage_gain: 0.05,
      min_latency_gain_ratio: 0.05,
      min_risk_reduction: 0.05,
      max_cost_multiplier: 2,
      max_latency_multiplier: 1.25,
      max_risk_increase: 0,
    };
    const tooCostly = evaluateTaskCellPolicyPromotion({
      baseline: [observation("s1", "single_agent_baseline")],
      candidate: [observation("s1", "multi_agent_candidate", { cost_usd: 3 })],
      policy,
    });
    expect(tooCostly.promote).toBe(false);
    expect(tooCostly.reasons).toContain("candidate cost multiplier 3 exceeds 2");

    const mismatched = evaluateTaskCellPolicyPromotion({
      baseline: [observation("s1", "single_agent_baseline")],
      candidate: [observation("s2", "multi_agent_candidate")],
      policy,
    });
    expect(mismatched.promote).toBe(false);
    expect(mismatched.reasons).toContain("baseline/candidate scenario sets differ");

    const missingEvidence = evaluateTaskCellPolicyPromotion({
      baseline: [observation("s1", "single_agent_baseline")],
      candidate: [observation("s1", "multi_agent_candidate", { evidence_refs: [] })],
      policy,
    });
    expect(missingEvidence.promote).toBe(false);
    expect(missingEvidence.reasons).toContain("candidate scenario s1 has no evidence refs");
  });

  it("returns a frozen refusal envelope for malformed observations", () => {
    const result = evaluateTaskCellPolicyPromotion({
      baseline: [null] as unknown as TaskCellPolicyEvalObservationV1[],
      candidate: [observation("s1", "multi_agent_candidate")],
      policy: {
        min_quality_gain: 0.05,
        min_coverage_gain: 0.05,
        min_latency_gain_ratio: 0.05,
        min_risk_reduction: 0.05,
        max_cost_multiplier: 2,
        max_latency_multiplier: 1.25,
        max_risk_increase: 0,
      },
    });

    expect(result).toMatchObject({
      schema_version: "guild.task_cell_policy_promotion.v1",
      promote: false,
      reasons: expect.arrayContaining(["baseline scenario unknown: invalid observation schema"]),
      material_benefits: [],
    });
  });

  it("refuses a policy whose threshold keys are misspelled even when its key count is correct", () => {
    const result = evaluateTaskCellPolicyPromotion({
      baseline: [observation("s1", "single_agent_baseline", { risk_score: 0 })],
      candidate: [observation("s1", "multi_agent_candidate", { risk_score: 1 })],
      policy: {
        min_quality_gain: 0,
        min_coverage_gain: 0,
        min_latency_gain_ratio: 0,
        min_risk_reduction: 0,
        max_cost_multiplier: 2,
        max_latency_multiplier: 2,
        max_risk_increaze: 0,
      } as unknown as Parameters<typeof evaluateTaskCellPolicyPromotion>[0]["policy"],
    });

    expect(result.promote).toBe(false);
    expect(result.reasons).toContain("invalid promotion policy thresholds");
  });
});
