/** Evidence-bound single-agent vs multi-agent promotion gate for TaskCell policies (G11). */

export const TASK_CELL_POLICY_EVAL_OBSERVATION_SCHEMA = "guild.task_cell_policy_eval_observation.v1" as const;

export interface TaskCellPolicyEvalObservationV1 {
  schema_version: typeof TASK_CELL_POLICY_EVAL_OBSERVATION_SCHEMA;
  scenario_id: string;
  policy_id: string;
  mode: "single_agent_baseline" | "multi_agent_candidate";
  quality_score: number;
  coverage_score: number;
  latency_ms: number;
  risk_score: number;
  tokens: number;
  cost_usd: number;
  evidence_refs: string[];
}

export interface TaskCellPolicyPromotionThresholds {
  min_quality_gain: number;
  min_coverage_gain: number;
  min_latency_gain_ratio: number;
  min_risk_reduction: number;
  max_cost_multiplier: number;
  max_latency_multiplier: number;
  max_risk_increase: number;
}

export interface TaskCellPolicyPromotionInput {
  baseline: TaskCellPolicyEvalObservationV1[];
  candidate: TaskCellPolicyEvalObservationV1[];
  policy: TaskCellPolicyPromotionThresholds;
}

export interface TaskCellPolicyPromotionResult {
  schema_version: "guild.task_cell_policy_promotion.v1";
  promote: boolean;
  reasons: string[];
  material_benefits: Array<"quality" | "coverage" | "latency" | "risk">;
  comparison: {
    quality_gain: number | null;
    coverage_gain: number | null;
    latency_gain_ratio: number | null;
    risk_reduction: number | null;
    token_multiplier: number | null;
    cost_multiplier: number | null;
    latency_multiplier: number | null;
  };
}

function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function nonNegative(value: unknown): value is number { return finite(value) && value >= 0; }
function score(value: unknown): value is number { return finite(value) && value >= 0 && value <= 1; }
function nonBlank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }

const POLICY_KEYS = Object.freeze([
  "max_cost_multiplier",
  "max_latency_multiplier",
  "max_risk_increase",
  "min_coverage_gain",
  "min_latency_gain_ratio",
  "min_quality_gain",
  "min_risk_reduction",
]);

function validateObservation(value: unknown, expected: TaskCellPolicyEvalObservationV1["mode"]): string | null {
  if (!value || typeof value !== "object" || !("schema_version" in value) || value.schema_version !== TASK_CELL_POLICY_EVAL_OBSERVATION_SCHEMA) return "invalid observation schema";
  const observation = value as TaskCellPolicyEvalObservationV1;
  if (observation.mode !== expected) return `expected ${expected}`;
  if (!nonBlank(observation.scenario_id) || !nonBlank(observation.policy_id)) return "missing scenario_id/policy_id";
  if (!score(observation.quality_score) || !score(observation.coverage_score) || !score(observation.risk_score)) return "quality, coverage, and risk must be finite scores in [0,1]";
  if (!nonNegative(observation.latency_ms) || !nonNegative(observation.tokens) || !Number.isInteger(observation.tokens) || !nonNegative(observation.cost_usd)) return "latency, integer tokens, and cost must be measured non-negative values";
  if (!Array.isArray(observation.evidence_refs) || observation.evidence_refs.some((ref) => !nonBlank(ref))) return "invalid evidence_refs";
  return null;
}

function validPolicy(value: TaskCellPolicyPromotionThresholds | null | undefined): value is TaskCellPolicyPromotionThresholds {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value).sort();
  return JSON.stringify(keys) === JSON.stringify(POLICY_KEYS) &&
    POLICY_KEYS.every((key) => nonNegative(value[key as keyof TaskCellPolicyPromotionThresholds])) &&
    value.max_cost_multiplier > 0 && value.max_latency_multiplier > 0;
}

function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return numerator === 0 ? 1 : null;
  return numerator / denominator;
}

export function evaluateTaskCellPolicyPromotion(input: TaskCellPolicyPromotionInput): TaskCellPolicyPromotionResult {
  const reasons: string[] = [];
  const materialBenefits: TaskCellPolicyPromotionResult["material_benefits"] = [];
  const empty = {
    quality_gain: null,
    coverage_gain: null,
    latency_gain_ratio: null,
    risk_reduction: null,
    token_multiplier: null,
    cost_multiplier: null,
    latency_multiplier: null,
  };
  if (!input || typeof input !== "object") {
    return { schema_version: "guild.task_cell_policy_promotion.v1", promote: false, reasons: ["invalid promotion input"], material_benefits: [], comparison: empty };
  }
  if (!validPolicy(input.policy)) reasons.push("invalid promotion policy thresholds");
  if (!Array.isArray(input.baseline) || !Array.isArray(input.candidate)) {
    return { schema_version: "guild.task_cell_policy_promotion.v1", promote: false, reasons: [...reasons, "baseline and candidate observations must be arrays"], material_benefits: [], comparison: empty };
  }
  if (input.baseline.length === 0 || input.candidate.length === 0) reasons.push("baseline and candidate observations are required");

  const seen = new Set<string>();
  for (const observation of input.baseline) {
    const issue = validateObservation(observation, "single_agent_baseline");
    if (issue) {
      reasons.push(`baseline scenario ${observation?.scenario_id ?? "unknown"}: ${issue}`);
      continue;
    }
    if (seen.has(`baseline:${observation.scenario_id}`)) reasons.push(`duplicate baseline scenario ${observation.scenario_id}`);
    seen.add(`baseline:${observation.scenario_id}`);
    if (observation.evidence_refs.length === 0) reasons.push(`baseline scenario ${observation.scenario_id} has no evidence refs`);
  }
  for (const observation of input.candidate) {
    const issue = validateObservation(observation, "multi_agent_candidate");
    if (issue) {
      reasons.push(`candidate scenario ${observation?.scenario_id ?? "unknown"}: ${issue}`);
      continue;
    }
    if (seen.has(`candidate:${observation.scenario_id}`)) reasons.push(`duplicate candidate scenario ${observation.scenario_id}`);
    seen.add(`candidate:${observation.scenario_id}`);
    if (observation.evidence_refs.length === 0) reasons.push(`candidate scenario ${observation.scenario_id} has no evidence refs`);
  }
  if (reasons.length > 0 || input.baseline.length === 0 || input.candidate.length === 0) {
    return { schema_version: "guild.task_cell_policy_promotion.v1", promote: false, reasons, material_benefits: [], comparison: empty };
  }
  const baselineIds = [...new Set(input.baseline.map((item) => item.scenario_id))].sort();
  const candidateIds = [...new Set(input.candidate.map((item) => item.scenario_id))].sort();
  if (JSON.stringify(baselineIds) !== JSON.stringify(candidateIds)) reasons.push("baseline/candidate scenario sets differ");
  if (reasons.length > 0) {
    return { schema_version: "guild.task_cell_policy_promotion.v1", promote: false, reasons, material_benefits: [], comparison: empty };
  }

  if (!validPolicy(input.policy)) {
    return { schema_version: "guild.task_cell_policy_promotion.v1", promote: false, reasons, material_benefits: [], comparison: empty };
  }
  const avg = (items: TaskCellPolicyEvalObservationV1[], key: "quality_score" | "coverage_score" | "latency_ms" | "risk_score" | "tokens" | "cost_usd") => mean(items.map((item) => item[key]));
  const baseQuality = avg(input.baseline, "quality_score");
  const candidateQuality = avg(input.candidate, "quality_score");
  const baseCoverage = avg(input.baseline, "coverage_score");
  const candidateCoverage = avg(input.candidate, "coverage_score");
  const baseLatency = avg(input.baseline, "latency_ms");
  const candidateLatency = avg(input.candidate, "latency_ms");
  const baseRisk = avg(input.baseline, "risk_score");
  const candidateRisk = avg(input.candidate, "risk_score");
  const qualityGain = round(candidateQuality - baseQuality);
  const coverageGain = round(candidateCoverage - baseCoverage);
  const latencyGainRatio = baseLatency === 0 ? 0 : round((baseLatency - candidateLatency) / baseLatency);
  const riskReduction = round(baseRisk - candidateRisk);
  const costMultiplier = ratio(avg(input.candidate, "cost_usd"), avg(input.baseline, "cost_usd"));
  const tokenMultiplier = ratio(avg(input.candidate, "tokens"), avg(input.baseline, "tokens"));
  const latencyMultiplier = ratio(candidateLatency, baseLatency);
  if (qualityGain >= input.policy.min_quality_gain) materialBenefits.push("quality");
  if (coverageGain >= input.policy.min_coverage_gain) materialBenefits.push("coverage");
  if (latencyGainRatio >= input.policy.min_latency_gain_ratio) materialBenefits.push("latency");
  if (riskReduction >= input.policy.min_risk_reduction) materialBenefits.push("risk");
  if (materialBenefits.length === 0) reasons.push("candidate has no material quality, coverage, latency, or risk benefit");
  if (costMultiplier === null) reasons.push("baseline cost is zero, so candidate cost cannot be justified");
  else if (costMultiplier > input.policy.max_cost_multiplier) reasons.push(`candidate cost multiplier ${round(costMultiplier)} exceeds ${input.policy.max_cost_multiplier}`);
  if (latencyMultiplier === null) reasons.push("baseline latency is zero, so candidate latency cannot be compared");
  else if (latencyMultiplier > input.policy.max_latency_multiplier) reasons.push(`candidate latency multiplier ${round(latencyMultiplier)} exceeds ${input.policy.max_latency_multiplier}`);
  if (candidateRisk - baseRisk > input.policy.max_risk_increase) reasons.push(`candidate risk increase ${round(candidateRisk - baseRisk)} exceeds ${input.policy.max_risk_increase}`);
  return {
    schema_version: "guild.task_cell_policy_promotion.v1",
    promote: reasons.length === 0,
    reasons,
    material_benefits: materialBenefits,
    comparison: {
      quality_gain: qualityGain,
      coverage_gain: coverageGain,
      latency_gain_ratio: latencyGainRatio,
      risk_reduction: riskReduction,
      token_multiplier: tokenMultiplier === null ? null : round(tokenMultiplier),
      cost_multiplier: costMultiplier === null ? null : round(costMultiplier),
      latency_multiplier: latencyMultiplier === null ? null : round(latencyMultiplier),
    },
  };
}
