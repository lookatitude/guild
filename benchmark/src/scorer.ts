import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Case,
  ComponentScore,
  EventLine,
  MetricsJson,
  RunRecord,
  Score,
  ScoreComponents,
  ScoringWeights,
  Stage,
} from "./types.js";
import { DEFAULT_WEIGHTS, EXPECTED_GATES, SCHEMA_VERSION } from "./types.js";

export function resolveWeights(caseFile: Case): ScoringWeights {
  const o = caseFile.scoring_weights ?? {};
  return {
    outcome: o.outcome ?? DEFAULT_WEIGHTS.outcome,
    delegation: o.delegation ?? DEFAULT_WEIGHTS.delegation,
    gates: o.gates ?? DEFAULT_WEIGHTS.gates,
    evidence: o.evidence ?? DEFAULT_WEIGHTS.evidence,
    loop_response: o.loop_response ?? DEFAULT_WEIGHTS.loop_response,
    efficiency: o.efficiency ?? DEFAULT_WEIGHTS.efficiency,
  };
}

export function computeMetrics(record: RunRecord, caseFile: Case): MetricsJson {
  const stages = collectStages(record.events);
  const dispatched = uniqueStrings(
    record.events.flatMap((e) =>
      e.type === "specialist_dispatched" ? [e.specialist] : [],
    ),
  );
  const observedStageOrder = record.events
    .filter((e): e is Extract<EventLine, { type: "stage_started" }> => e.type === "stage_started")
    .map((e) => e.stage);
  const acceptanceResults = caseFile.acceptance_commands.map((command) => {
    const evt = record.events.find(
      (e): e is Extract<EventLine, { type: "acceptance_command" }> =>
        e.type === "acceptance_command" && e.command === command,
    );
    return { command, passed: evt?.exit_code === 0 };
  });
  const gateOutcomes: Record<string, "passed" | "skipped"> = {};
  for (const e of record.events) {
    if (e.type === "gate_passed") gateOutcomes[e.gate] = "passed";
    else if (e.type === "gate_skipped" && !(e.gate in gateOutcomes))
      gateOutcomes[e.gate] = "skipped";
  }
  const retry_count = record.events.filter((e) => e.type === "retry").length;
  const tool_error_count = record.events.filter((e) => e.type === "tool_error").length;
  return {
    schema_version: SCHEMA_VERSION,
    run_id: record.run.run_id,
    computed_at: new Date().toISOString(),
    wall_clock_ms: record.run.wall_clock_ms,
    wall_clock_budget_ms:
      record.run.wall_clock_budget_ms ?? caseFile.wall_clock_budget_ms,
    stages,
    dispatched_specialists: dispatched,
    expected_specialists: caseFile.expected_specialists,
    acceptance_commands: acceptanceResults,
    expected_stage_order: caseFile.expected_stage_order,
    observed_stage_order: observedStageOrder,
    gate_outcomes: gateOutcomes,
    retry_count,
    tool_error_count,
  };
}

export function scoreRun(
  record: RunRecord,
  caseFile: Case,
): { score: Score; metrics: MetricsJson } {
  const metrics = computeMetrics(record, caseFile);
  const weights = resolveWeights(caseFile);
  const components: ScoreComponents = {
    outcome: scoreOutcome(record, metrics, weights),
    delegation: scoreDelegation(metrics, weights),
    gates: scoreGates(record, weights),
    evidence: scoreEvidence(record, weights),
    loop_response: scoreLoopResponse(record, weights),
    efficiency: scoreEfficiency(record, metrics, weights),
  };
  const guild_score = round2(
    components.outcome.weighted +
      components.delegation.weighted +
      components.gates.weighted +
      components.evidence.weighted +
      components.loop_response.weighted +
      components.efficiency.weighted,
  );
  // v1.1 — annotate run_kind. When events.ndjson is missing AND the run
  // produced any captured output (i.e. `claude --print` ran but did not
  // emit lifecycle events), this is a raw-model run; the scorer faithfully
  // records 0/100 on the lifecycle-dependent components. When events.ndjson
  // is present, this is a Guild lifecycle run. See
  // .guild/wiki/decisions/benchmark-runs-raw-claude-not-guild-lifecycle.md.
  const runKind: "raw_model" | "guild_lifecycle" =
    record.missing_artifacts.includes("events.ndjson")
      ? "raw_model"
      : "guild_lifecycle";

  const score: Score = {
    schema_version: SCHEMA_VERSION,
    run_id: record.run.run_id,
    case_slug: record.run.case_slug,
    plugin_ref: record.run.plugin_ref,
    model_ref: record.run.model_ref,
    status: record.run.status,
    scored_at: new Date().toISOString(),
    partial: record.partial,
    missing_artifacts: record.missing_artifacts,
    run_kind: runKind,
    components,
    guild_score,
  };
  return { score, metrics };
}

export async function persistScore(
  runDir: string,
  score: Score,
  metrics: MetricsJson,
): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  await writeFile(join(runDir, "score.json"), JSON.stringify(score, null, 2) + "\n");
}

function makeComponent(
  weight: number,
  rawSubscore: number,
  reason?: string,
  notes?: string[],
): ComponentScore {
  const clamped = Math.max(0, Math.min(100, rawSubscore));
  const out: ComponentScore = {
    weight,
    raw_subscore: round2(clamped),
    max_subscore: 100,
    weighted: round2((weight * clamped) / 100),
  };
  if (reason !== undefined) out.reason = reason;
  if (notes !== undefined) out.notes = notes;
  return out;
}

function scoreOutcome(
  record: RunRecord,
  metrics: MetricsJson,
  weights: ScoringWeights,
): ComponentScore {
  // R3 mitigation: timeout always scores 0 on outcome.
  if (record.run.status === "timeout") {
    return makeComponent(weights.outcome, 0, "timeout");
  }
  if (record.run.status === "errored") {
    return makeComponent(weights.outcome, 0, "errored");
  }
  if (record.events.length === 0) {
    return makeComponent(weights.outcome, 0, "missing_artifact");
  }
  const total = metrics.acceptance_commands.length;
  if (total === 0) {
    return makeComponent(weights.outcome, record.run.status === "pass" ? 100 : 0);
  }
  const passed = metrics.acceptance_commands.filter((c) => c.passed).length;
  return makeComponent(weights.outcome, (100 * passed) / total);
}

function scoreDelegation(metrics: MetricsJson, weights: ScoringWeights): ComponentScore {
  const expected = new Set(metrics.expected_specialists);
  const dispatched = new Set(metrics.dispatched_specialists);
  if (expected.size === 0 && dispatched.size === 0) {
    return makeComponent(weights.delegation, 100);
  }
  let intersect = 0;
  for (const s of expected) if (dispatched.has(s)) intersect += 1;
  const denominator = expected.size + dispatched.size;
  if (denominator === 0) {
    return makeComponent(weights.delegation, 0);
  }
  // F1-style: penalises both missing-critical and over-dispatch.
  return makeComponent(weights.delegation, (200 * intersect) / denominator);
}

function scoreGates(record: RunRecord, weights: ScoringWeights): ComponentScore {
  if (record.events.length === 0) {
    return makeComponent(weights.gates, 0, "missing_artifact");
  }
  const passed = new Set<string>();
  for (const e of record.events) {
    if (e.type === "gate_passed") passed.add(e.gate);
  }
  const matched = EXPECTED_GATES.filter((g) => passed.has(g)).length;
  return makeComponent(weights.gates, (100 * matched) / EXPECTED_GATES.length);
}

function scoreEvidence(record: RunRecord, weights: ScoringWeights): ComponentScore {
  if (record.receipts.length === 0) {
    return makeComponent(weights.evidence, 0, "missing_artifact");
  }
  const withEvidence = record.receipts.filter((r) => r.evidence_present).length;
  return makeComponent(weights.evidence, (100 * withEvidence) / record.receipts.length);
}

function scoreLoopResponse(record: RunRecord, weights: ScoringWeights): ComponentScore {
  if (!record.hasReview && !record.hasAssumptions && !record.hasReflection) {
    if (record.events.length === 0) {
      return makeComponent(weights.loop_response, 0, "missing_artifact");
    }
    return makeComponent(weights.loop_response, 0);
  }
  let raw = 0;
  if (record.hasReview) raw += 33;
  if (record.hasAssumptions) raw += 33;
  if (record.hasReflection) raw += 34;
  return makeComponent(weights.loop_response, raw);
}

function scoreEfficiency(
  record: RunRecord,
  metrics: MetricsJson,
  weights: ScoringWeights,
): ComponentScore {
  if (record.run.status === "timeout") {
    return makeComponent(weights.efficiency, 0, "timeout");
  }
  let base = record.run.status === "pass" ? 100 : 0;
  const ms = metrics.wall_clock_ms;
  const budget = metrics.wall_clock_budget_ms;
  if (typeof ms === "number" && typeof budget === "number" && budget > 0) {
    const excess = Math.max(0, ms - budget);
    base = Math.max(0, 100 * (1 - excess / budget));
  }
  const penalty = Math.min(50, 5 * metrics.retry_count + 10 * metrics.tool_error_count);
  return makeComponent(weights.efficiency, base - penalty);
}

function collectStages(events: EventLine[]): Stage[] {
  const byName = new Map<string, Stage>();
  for (const e of events) {
    if (e.type === "stage_started") {
      const existing = byName.get(e.stage) ?? { name: e.stage, status: "missing" as const };
      existing.started_at = e.ts;
      byName.set(e.stage, existing);
    } else if (e.type === "stage_completed") {
      const existing = byName.get(e.stage) ?? { name: e.stage, status: "missing" as const };
      existing.completed_at = e.ts;
      existing.duration_ms = e.duration_ms;
      existing.status = "passed";
      byName.set(e.stage, existing);
    } else if (e.type === "gate_skipped") {
      const existing = byName.get(e.gate) ?? { name: e.gate, status: "missing" as const };
      if (existing.status !== "passed") {
        existing.status = "skipped";
        if (e.reason !== undefined) existing.reason = e.reason;
      }
      byName.set(e.gate, existing);
    }
  }
  return [...byName.values()];
}

function uniqueStrings(arr: string[]): string[] {
  return [...new Set(arr)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
