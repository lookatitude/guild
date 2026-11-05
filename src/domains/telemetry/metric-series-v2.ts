/**
 * src/domains/telemetry/metric-series-v2.ts — T04 C9 formula engine:
 * `guild.stack.metric-series.v2`, `guild.stack.metric-drilldown.v2`, the
 * `guild.stack.read-request.v2` binding and `guild.stack.refusal.v2`.
 *
 * One engine computes every catalog metric from source-qualified facts. Each
 * series point carries value, known subtotal, exact total, numerator and
 * denominator, field coverage, cost basis and evidence. A metric with no
 * producer yet is `unavailable` with the reason, never zero. Ratios are
 * weighted (sum of numerators over sum of denominators), a zero denominator is
 * null with a reason, and outcome metrics select by accepted terminal time.
 *
 * Identity: a run is (source, run); a usage leaf is (source, run, accounting
 * identity); repeated attachments of one run count it once. An offline source
 * stays in the snapshot and makes the eligible denominator unknown.
 */

import * as crypto from "node:crypto";
import { ATOMIC_BY_FORMULA, ATOMIC_BY_ID, ATOMIC_METRICS, SIGNED_METRICS, type AtomicMetric } from "./metric-catalog-v2";
import { TRACE_ID_RE, TRACE_V3_CHECKS, compareTraceInstants, type TraceCoverage, type TraceEvidence, type TraceShapeCheck } from "./trace-analysis-v3";

export const METRIC_SERIES_V2_SCHEMA = "guild.stack.metric-series.v2" as const;
export const METRIC_DRILLDOWN_V2_SCHEMA = "guild.stack.metric-drilldown.v2" as const;
export const READ_REQUEST_V2_SCHEMA = "guild.stack.read-request.v2" as const;
export const REFUSAL_V2_SCHEMA = "guild.stack.refusal.v2" as const;
const SCHEMA_BASE = "https://guildstack.dev/contracts/guild-stack/v2/";
export const RESULT_SCHEMA_IDS = Object.freeze({
  metric_series: `${SCHEMA_BASE}metric-series.schema.json`,
  metric_drilldown: `${SCHEMA_BASE}metric-drilldown.schema.json`,
});
export const METRIC_SERIES_V2_VERSIONS = Object.freeze({ aggregation: "t04.aggregation.1" });
export const SERIES_LIMITS = Object.freeze({ points: 1000, evidence: 100, records: 1000, filters: 50, filter_values: 100 });

// ── Shapes ───────────────────────────────────────────────────────────────────

export type Evidence = TraceEvidence;
export type Coverage = TraceCoverage;
export type CostBasis = "measured" | "derived_estimate" | "native_estimate" | "unavailable" | "not_applicable";
export type UsageSemantics = "inclusive_input_cache_subset.v1" | "provider_session_only.v1" | "not_applicable" | "unknown";
export type WindowBasis = "activity_completed" | "accepted_outcome_cohort" | "as_of_snapshot";
export interface VersionSet { schema: string; analyzer: string; normalizer: string; formula: string; usage_semantics: string; pricing: string; aggregation: string }
export interface Snapshot { input_manifest_digest: string; source_ids: string[]; source_generations: { source_id: string; generation: string }[]; as_of: string }
export interface QueryFilter { dimension: string; values: string[] }
export interface QueryIdentity {
  schema_version: string; versions: VersionSet; snapshot: Snapshot; grain: string; filters: QueryFilter[];
  window: { from: string; to: string; basis: WindowBasis; timezone: string };
  cohort_hash: string; underlying_scalar: { metric_id: string; formula_version: string } | null;
}
export interface SeriesPoint {
  key: string; value: number | null; known_subtotal: number | null; exact_total: number | null;
  numerator: number | null; denominator: number | null; coverage: Coverage; cost_basis: CostBasis; reason: string | null;
  evidence: Evidence[]; drilldown: { query_hash: string; cursor: string | null };
}
export interface MetricSeriesV2 {
  schema_version: typeof METRIC_SERIES_V2_SCHEMA; metric_id: string; underlying_formula_version: string | null; underlying_metric_id: string | null;
  unit: string; unit_label: string; query: QueryIdentity; usage_semantics: UsageSemantics;
  pricing: { version: string; currency: "USD"; source_hash: string } | null; coverage: Coverage; points: SeriesPoint[];
}
export interface MetricDrilldownV2 {
  schema_version: typeof METRIC_DRILLDOWN_V2_SCHEMA; metric_id: string; point_key: string; query_hash: string;
  snapshot: Snapshot; records: Evidence[]; coverage: Coverage; next_cursor: string | null;
}
export interface ReadRequestV2 {
  schema_version: typeof READ_REQUEST_V2_SCHEMA; request_id: string; session_id: string;
  operation: "entities" | "trace" | "artifacts" | "workflow" | "knowledge" | "metric_series" | "metric_drilldown";
  result_schema_id: string; query: QueryIdentity; cursor: string | null; limit: number; query_hash: string;
}
export type RefusalCode = "unsupported_schema" | "unsupported_capability" | "stale_cursor" | "stale_source" | "expired_preview" | "authority_conflict" | "source_unavailable" | "input_unavailable" | "invalid_request";
export interface RefusalV2 {
  schema_version: typeof REFUSAL_V2_SCHEMA; request_id: string; code: RefusalCode; message: string; retryable: boolean;
  expected_snapshot: string | null; observed_snapshot: string | null;
}
export type Verdict = { ok: true } | { ok: false; errors: string[] };

/** A refusal raised inside the engine; the read service turns it into `guild.stack.refusal.v2`. */
export class SeriesRefusal extends Error {
  constructor(readonly code: RefusalCode, message: string, readonly retryable = false) { super(message); }
}

// ── Facts (the engine's only input) ──────────────────────────────────────────

/** One normalized, deduplicated leaf request (the T02 ledger leaf, with its completion instant). */
export interface UsageFact {
  accounting_identity: string; at: string | null;
  execution_id: string | null; logical_task_id: string | null; attempt_id: string | null; agent_instance_id: string | null;
  requested_model: string | null; observed_model: string | null;
  /** Each counter is null unless the leaf reports it with known semantics (the T02 ledger rule). */
  input: number | null; output: number | null; cache_read: number | null; cache_write: number | null; total: number | null;
  measured_usd: number | null; derived_usd: number | null; covered: boolean; allocated: boolean;
  usage_semantics: string; evidence: Evidence;
}
/** One valid trace record's lineage: what the run names even without usage (dispatch, phase, lifecycle). */
export interface ObservationFact {
  at: string; execution_id: string | null; logical_task_id: string | null; attempt_id: string | null; agent_instance_id: string | null;
  requested_model: string | null; observed_model: string | null; evidence: Evidence;
}
export interface RunFacts {
  source_id: string; run_id: string; evidence: Evidence;
  /** `unavailable` when no normalized trace exists: request counts for the run are unknown. */
  usage_state: "available" | "unavailable"; usage_reason: string | null;
  /** Requests known to exist with no usable leaf (pending, invalid); null when unknown. */
  extra_missing: number | null; invalid_count: number | null; duplicate_count: number;
  attachments: { kind: "initiative" | "goal"; id: string }[];
  leaves: UsageFact[];
  /** Every valid record of the run; `trace_complete` is false when records may be missing or invalid. */
  observations: ObservationFact[]; trace_complete: boolean;
}
export interface TaskFact {
  source_id: string; run_id: string; task_id: string; cohort: string | null;
  outcome: "pending" | "succeeded" | "failed" | "cancelled" | "partial" | "unknown";
  acceptance: "pending" | "verified" | "rejected" | "not_required" | "unknown";
  terminal_at: string | null; spend_usd: number | null; spend_basis: "measured" | "derived_estimate" | null; evidence: Evidence;
}
export interface SourceFacts {
  /** `unavailable`: offline, unreadable or past an enumeration bound. Its facts are unknown, never zero. */
  source_id: string; generation: string; state: "available" | "unavailable"; reason: string | null;
  runs: RunFacts[];
  /** Run directories that exist but cannot be read as contract runs (unsupported id); they make the enumeration unknown. */
  unenumerated_runs: number;
  /** Whether a producer recorded task outcome axes; without one, outcome metrics are unknown, never zero. */
  outcomes: "collected" | "not_collected";
  tasks: TaskFact[];
}
export interface FactSet { snapshot: Snapshot; sources: SourceFacts[]; pricing: { version: string; currency: string; source_hash: string } | null }

export type GroupBy = "all" | "source" | "run" | "cohort" | "task" | "observed_model";

// ── Hashing ──────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
/** RFC 8785-compatible for the values these documents hold: sorted keys, ECMAScript number and string forms. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export const sha256 = (s: string | Buffer) => `sha256:${crypto.createHash("sha256").update(s).digest("hex")}`;
/** C9 query hash: the digest a series point, read request and drilldown page must all carry. */
export const queryHash = (q: QueryIdentity) => sha256(canonicalJson(q));
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const evKey = (e: Evidence) => `${e.source_id}\u0000${e.path}\u0000${e.sha256}`;
const sortEvidence = (xs: Evidence[]) => {
  const seen = new Map<string, Evidence>();
  for (const x of xs) if (!seen.has(evKey(x))) seen.set(evKey(x), x);
  return [...seen.values()].sort((a, b) => cmp(evKey(a), evKey(b)));
};

// ── Catalog ──────────────────────────────────────────────────────────────────

/** The atomic metric a query's pinned formula version names (M29 names its own). */
export function metricOfQuery(q: QueryIdentity): AtomicMetric {
  const m = ATOMIC_BY_FORMULA.get(q.versions.formula);
  if (!m) throw new SeriesRefusal("unsupported_capability", `formula version ${q.versions.formula} is not in the C9 catalog`);
  return m;
}

const UNIT_LABEL: Record<string, string> = {
  ms: "milliseconds", usd: "USD", tokens: "tokens", count: "count", ratio: "ratio",
  usd_per_outcome: "USD per verified success", ms_per_outcome: "ms per verified success", case_score: "case score",
};
const USAGE_FAMILIES = new Set(["M06", "M07", "M08", "M09", "M10", "M13"]);
const OUTCOME_METRICS = new Set(["M14.outcome_count", "M14.success_ratio", "M15.first_attempt_success_ratio", "M15.retry_count", "M15.rework_count", "M22.cost_per_success_usd", "M22.elapsed_per_success_ms"]);
const COST_UNITS = new Set(["usd", "usd_per_outcome"]);
const familyOf = (id: string) => id.slice(0, 3);

// ── Coverage ─────────────────────────────────────────────────────────────────

/** Field coverage: eligible = covered + missing; exclusions sit outside eligible. Null eligible is unknown. */
export function makeCoverage(eligible: number | null, covered: number, exclusions: Record<string, number>, reason: string | null): Coverage {
  const exclusion_reasons = Object.entries(exclusions).filter(([, n]) => n > 0).map(([code, count]) => ({ code, count })).sort((a, b) => cmp(a.code, b.code)).slice(0, 100);
  const excluded = exclusion_reasons.reduce((a, x) => a + x.count, 0);
  if (eligible !== null && covered > eligible) throw new Error("covered exceeds eligible");
  const missing = eligible === null ? null : eligible - covered;
  const state: Coverage["state"] = eligible !== null && missing === 0 ? "complete" : covered === 0 ? "unavailable" : "partial";
  return { eligible, covered, excluded, missing, state, reason: state === "complete" ? null : reason ?? "coverage incomplete", exclusion_reasons };
}

// ── Scope ────────────────────────────────────────────────────────────────────

const RUN_DIMENSIONS = new Set(["run", "initiative", "goal"]);
const LEAF_DIMENSIONS = new Set(["execution", "task", "attempt", "agent", "observed_model", "requested_model"]);

interface ScopedRun { run: RunFacts; leaves: UsageFact[]; observations: ObservationFact[] }
interface Scope {
  runs: ScopedRun[]; tasks: TaskFact[];
  /** Offline or unreadable sources in the snapshot; their facts are unknown, never zero. */
  unknownSources: string[];
  /** Runs whose membership under a record-level filter cannot be decided (no or incomplete trace). */
  unknownRuns: { source_id: string; run_id: string }[];
  /** Per available source, run directories that could not be enumerated as runs. */
  unenumerated: { source_id: string; count: number }[];
  /** Available sources with no outcome producer: their outcome facts are unknown too. */
  noOutcomeSources: string[];
  /** A leaf-level filter or activity window is active: unattributable extras make eligibility unknown. */
  leafFiltered: boolean;
  exclusions: Record<string, number>;
  taskExclusions: Record<string, number>;
}

const inWindow = (at: string, w: QueryIdentity["window"]) => compareTraceInstants(at, w.from) >= 0 && compareTraceInstants(at, w.to) < 0;

function leafMatches(l: UsageFact | ObservationFact, f: QueryFilter): boolean {
  const v = { execution: l.execution_id, task: l.logical_task_id, attempt: l.attempt_id, agent: l.agent_instance_id, observed_model: l.observed_model, requested_model: l.requested_model }[f.dimension as "task"];
  return v !== null && v !== undefined && f.values.includes(v);
}
function runMatches(r: RunFacts, f: QueryFilter): boolean {
  // A run filter names local run ids; each snapshot source's run of that id stays a distinct run.
  if (f.dimension === "run") return f.values.includes(r.run_id);
  return r.attachments.some((a) => a.kind === f.dimension && f.values.includes(a.id));
}

function selectScope(facts: FactSet, q: QueryIdentity, outcomeMetric: boolean): Scope {
  for (const f of q.filters) {
    if (!RUN_DIMENSIONS.has(f.dimension) && !LEAF_DIMENSIONS.has(f.dimension)) throw new SeriesRefusal("unsupported_capability", `filter dimension ${f.dimension} is not served by the project read service`);
  }
  const w = q.window;
  if (w.timezone !== "UTC") throw new SeriesRefusal("invalid_request", "windows are UTC [from,to)");
  if (outcomeMetric && w.basis !== "accepted_outcome_cohort") throw new SeriesRefusal("invalid_request", "outcome cohorts select by accepted terminal time (accepted_outcome_cohort), not an activity window or as_of snapshot");
  if (w.basis === "as_of_snapshot" && w.to !== q.snapshot.as_of) throw new SeriesRefusal("invalid_request", "an as_of_snapshot window must end at the snapshot as_of");
  const runFilters = q.filters.filter((f) => RUN_DIMENSIONS.has(f.dimension));
  const leafFilters = q.filters.filter((f) => LEAF_DIMENSIONS.has(f.dimension));
  if (outcomeMetric && leafFilters.some((f) => f.dimension !== "task")) throw new SeriesRefusal("unsupported_capability", "task outcomes carry no execution, attempt, agent or model binding to filter on");
  const exclusions: Record<string, number> = {};
  const taskExclusions: Record<string, number> = {};
  const unknownSources: string[] = [];
  const unknownRuns: { source_id: string; run_id: string }[] = [];
  const unenumerated: { source_id: string; count: number }[] = [];
  const noOutcomeSources: string[] = [];
  const runs: ScopedRun[] = [];
  const tasks: TaskFact[] = [];
  const bySource = new Map(facts.sources.map((s) => [s.source_id, s]));
  for (const sid of q.snapshot.source_ids) {
    const s = bySource.get(sid);
    if (!s) throw new SeriesRefusal("source_unavailable", `snapshot source ${sid} has no facts`);
    if (s.state !== "available") { unknownSources.push(sid); continue; }
    if (s.outcomes !== "collected") noOutcomeSources.push(sid);
    if (s.unenumerated_runs > 0) unenumerated.push({ source_id: sid, count: s.unenumerated_runs });
    // Cohort selection first: under accepted_outcome_cohort, usage follows the selected tasks across all attempts.
    const selected = new Set<string>();
    for (const t of s.tasks) {
      const r = s.runs.find((x) => x.run_id === t.run_id);
      if (runFilters.length && (!r || !runFilters.every((f) => runMatches(r, f)))) continue;
      if (leafFilters.some((f) => f.dimension === "task" && !f.values.includes(t.task_id))) continue;
      if (w.basis === "accepted_outcome_cohort") {
        if (t.outcome === "pending" || t.terminal_at === null) { taskExclusions["pending_right_censored"] = (taskExclusions["pending_right_censored"] ?? 0) + 1; continue; }
        if (!inWindow(t.terminal_at, w)) continue;
      }
      tasks.push(t);
      selected.add(`${t.run_id}\u0000${t.task_id}`);
    }
    const recordLevel = leafFilters.length > 0 || w.basis === "activity_completed";
    for (const r of s.runs) {
      if (!runFilters.every((f) => runMatches(r, f))) {
        // Attachments come from the run's records: without a complete trace a non-match is unknown, not absent.
        const attachmentFilter = runFilters.some((f) => f.dimension !== "run" && !runMatches(r, f));
        const named = runFilters.filter((f) => f.dimension === "run").every((f) => runMatches(r, f));
        if (attachmentFilter && named && (r.usage_state !== "available" || !r.trace_complete)) unknownRuns.push({ source_id: r.source_id, run_id: r.run_id });
        continue;
      }
      const leaves: UsageFact[] = [];
      for (const l of r.leaves) {
        if (!leafFilters.every((f) => leafMatches(l, f))) continue;
        if (w.basis === "activity_completed") {
          if (l.at === null) { exclusions["invalid_clock"] = (exclusions["invalid_clock"] ?? 0) + 1; continue; }
          if (!inWindow(l.at, w)) continue;
        } else if (w.basis === "accepted_outcome_cohort") {
          if (l.logical_task_id === null || !selected.has(`${r.run_id}\u0000${l.logical_task_id}`)) continue;
        }
        leaves.push(l);
      }
      const observations = r.observations.filter((o) => leafFilters.every((f) => leafMatches(o, f)) && (w.basis !== "activity_completed" || inWindow(o.at, w))
        && (w.basis !== "accepted_outcome_cohort" || (o.logical_task_id !== null && selected.has(`${r.run_id}\u0000${o.logical_task_id}`))));
      if (recordLevel) {
        // Membership is decided by the run's records; without a complete trace it is unknown, not absent.
        if (r.usage_state !== "available" || !r.trace_complete) unknownRuns.push({ source_id: r.source_id, run_id: r.run_id });
        if (leaves.length === 0 && observations.length === 0) continue;
      }
      if (w.basis === "accepted_outcome_cohort" && leaves.length === 0 && observations.length === 0 && !tasks.some((t) => t.source_id === r.source_id && t.run_id === r.run_id)) continue;
      runs.push({ run: r, leaves, observations });
    }
  }
  return { runs, tasks, unknownSources, unknownRuns, unenumerated, noOutcomeSources, leafFiltered: leafFilters.length > 0 || w.basis !== "as_of_snapshot", exclusions, taskExclusions };
}

// ── Point computation ────────────────────────────────────────────────────────

interface Calc {
  value: number | null; known_subtotal: number | null; exact_total: number | null;
  numerator: number | null; denominator: number | null; coverage: Coverage; cost_basis: CostBasis; reason: string | null; records: Evidence[];
}

const unknownReason = (s: Scope, extra: string[] = []) => [
  ...s.unknownSources.map((x) => `source ${x} unavailable`),
  ...s.unknownRuns.slice(0, 20).map((x) => `run ${x.source_id}:${x.run_id} membership unknown (no complete trace)`),
  ...(s.unknownRuns.length > 20 ? [`${s.unknownRuns.length - 20} more runs with unknown membership`] : []),
  ...s.unenumerated.map((x) => `source ${x.source_id} has ${x.count} run directories that are not contract runs`),
  ...extra,
].join("; ").slice(0, 4000) || null;
/** The scope's run enumeration is fully known. */
const enumKnown = (s: Scope) => s.unknownSources.length === 0 && s.unknownRuns.length === 0 && s.unenumerated.length === 0;

/** Eligible leaf requests in scope: null when any part of the enumeration is unknown. */
function leafEligibility(s: Scope): { eligible: number | null; reasons: string[] } {
  let eligible: number | null = enumKnown(s) ? 0 : null;
  const reasons: string[] = [];
  for (const { run, leaves } of s.runs) {
    if (run.usage_state !== "available") { eligible = null; reasons.push(`run ${run.source_id}:${run.run_id} ${run.usage_reason ?? "has no normalized trace"}`); continue; }
    const extra = run.extra_missing;
    if (extra === null || (extra > 0 && s.leafFiltered)) { eligible = null; if (extra !== 0) reasons.push(`run ${run.source_id}:${run.run_id} has requests with unknown attribution`); }
    if (eligible !== null) eligible += leaves.length + (extra ?? 0);
  }
  return { eligible, reasons };
}

function sumCalc(s: Scope, pick: (l: UsageFact) => number | null, basis: CostBasis, extraReason: string | null = null): Calc {
  const { eligible, reasons } = leafEligibility(s);
  let covered = 0;
  let sum = 0;
  const records: Evidence[] = [];
  for (const { leaves } of s.runs) for (const l of leaves) {
    records.push(l.evidence);
    const v = pick(l);
    if (v === null) continue;
    covered++;
    sum += v;
  }
  if (!Number.isFinite(sum)) throw new SeriesRefusal("invalid_request", "sum is not representable");
  const reason = [unknownReason(s, reasons), extraReason].filter(Boolean).join("; ") || "some eligible requests did not report this field";
  const coverage = makeCoverage(eligible === null ? null : Math.max(eligible, covered), covered, s.exclusions, reason);
  if (coverage.state === "unavailable") return { value: null, known_subtotal: null, exact_total: null, numerator: null, denominator: null, coverage, cost_basis: basis === "not_applicable" || basis === "measured" || basis === "derived_estimate" ? basis : "unavailable", reason: coverage.reason, records };
  return { value: sum, known_subtotal: sum, exact_total: coverage.state === "complete" ? sum : null, numerator: null, denominator: null, coverage, cost_basis: basis, reason: coverage.state === "complete" ? null : coverage.reason, records };
}

/** Weighted ratio: sum(num) / sum(den) over compatible samples; zero denominator is null with a reason. */
function ratioCalc(num: number, den: number, coverage: Coverage, records: Evidence[], zeroReason: string): Calc {
  if (coverage.state === "unavailable") return { value: null, known_subtotal: null, exact_total: null, numerator: null, denominator: null, coverage, cost_basis: "not_applicable", reason: coverage.reason, records };
  if (den === 0) return { value: null, known_subtotal: null, exact_total: null, numerator: num, denominator: 0, coverage, cost_basis: "not_applicable", reason: zeroReason, records };
  return { value: num / den, known_subtotal: null, exact_total: null, numerator: num, denominator: den, coverage, cost_basis: "not_applicable", reason: coverage.state === "complete" ? null : coverage.reason, records };
}

function countCalc(eligibleKnown: boolean, items: Map<string, Evidence>, s: Scope, reason: string | null): Calc {
  const n = items.size;
  const records = [...items.values()];
  const coverage = makeCoverage(eligibleKnown ? n : null, n, {}, reason ?? unknownReason(s) ?? "enumeration incomplete");
  if (coverage.state === "unavailable") return { value: null, known_subtotal: null, exact_total: null, numerator: null, denominator: null, coverage, cost_basis: "not_applicable", reason: coverage.reason, records };
  return { value: n, known_subtotal: n, exact_total: coverage.state === "complete" ? n : null, numerator: null, denominator: null, coverage, cost_basis: "not_applicable", reason: coverage.state === "complete" ? null : coverage.reason, records };
}

function unavailableCalc(reason: string, cost: boolean): Calc {
  return {
    value: null, known_subtotal: null, exact_total: null, numerator: null, denominator: null,
    coverage: { eligible: null, covered: 0, excluded: 0, missing: null, state: "unavailable", reason, exclusion_reasons: [] },
    cost_basis: cost ? "unavailable" : "not_applicable", reason, records: [],
  };
}

const NOT_COLLECTED: Record<string, string> = {
  M02: "no controller span source is projected yet; elapsed time is unknown",
  M03: "no controller span source is projected yet; active time is unknown",
  M04: "no controller span source is projected yet; wait time is unknown",
  M05: "no controller span source is projected yet; latency samples are unknown",
  M11: "budget policy is not part of the project read inputs",
};

function outcomeTasks(s: Scope): { tasks: TaskFact[]; unknown: number } {
  if (s.noOutcomeSources.length) throw new OutcomesNotCollected(s.noOutcomeSources);
  let unknown = 0;
  const tasks: TaskFact[] = [];
  for (const t of s.tasks) {
    if (t.outcome === "unknown" || t.acceptance === "unknown") unknown++;
    else tasks.push(t);
  }
  return { tasks, unknown };
}

class OutcomesNotCollected extends Error { constructor(readonly sources: string[]) { super(`no task outcome producer for source ${sources.join(", ")}`); } }

function computeCalc(metric: AtomicMetric, s: Scope, facts: FactSet, grain: string): Calc {
  try { return computeCalcInner(metric, s, facts, grain); } catch (err) {
    if (err instanceof OutcomesNotCollected) return unavailableCalc(`task outcome axes not collected: ${err.message}`, COST_UNITS.has(metric.unit));
    throw err;
  }
}

function computeCalcInner(metric: AtomicMetric, s: Scope, facts: FactSet, grain: string): Calc {
  const id = metric.id;
  const fam = familyOf(id);
  const cost = COST_UNITS.has(metric.unit);
  switch (id) {
    case "M01.run_count": {
      const m = new Map<string, Evidence>();
      for (const { run } of s.runs) m.set(`${run.source_id}\u0000${run.run_id}`, run.evidence);
      return countCalc(enumKnown(s), m, s, null);
    }
    case "M01.execution_count":
    case "M01.task_count": {
      // Every valid record names its execution and task, usage or not.
      const m = new Map<string, Evidence>();
      const partial: string[] = [];
      for (const { run, observations } of s.runs) {
        if (run.usage_state !== "available" || !run.trace_complete) partial.push(`run ${run.source_id}:${run.run_id} has no complete trace`);
        for (const o of observations) {
          const k = id === "M01.execution_count" ? o.execution_id && `${run.source_id}\u0000${run.run_id}\u0000${o.execution_id}` : o.logical_task_id && `${run.source_id}\u0000${o.logical_task_id}`;
          if (k && !m.has(k)) m.set(k, o.evidence);
        }
      }
      if (id === "M01.task_count") for (const t of s.tasks) if (!m.has(`${t.source_id}\u0000${t.task_id}`)) m.set(`${t.source_id}\u0000${t.task_id}`, t.evidence);
      return countCalc(enumKnown(s) && partial.length === 0, m, s, unknownReason(s, partial));
    }
    case "M01.goal_count": {
      const m = new Map<string, Evidence>();
      for (const { run } of s.runs) for (const a of run.attachments) if (a.kind === "goal" && !m.has(`${run.source_id}\u0000${a.id}`)) m.set(`${run.source_id}\u0000${a.id}`, run.evidence);
      const unknownRuns = s.runs.filter((r) => r.run.usage_state !== "available" || !r.run.trace_complete).map((r) => `run ${r.run.source_id}:${r.run.run_id} attachments unknown`);
      return countCalc(enumKnown(s) && unknownRuns.length === 0, m, s, unknownReason(s, unknownRuns));
    }
    case "M06.input_tokens": return sumCalc(s, (l) => l.input, "not_applicable");
    case "M07.output_tokens": return sumCalc(s, (l) => l.output, "not_applicable");
    case "M08.cache_read_tokens": return sumCalc(s, (l) => l.cache_read, "not_applicable");
    case "M08.cache_write_tokens": return sumCalc(s, (l) => l.cache_write, "not_applicable");
    case "M09.total_tokens": return sumCalc(s, (l) => l.total, "not_applicable");
    case "M08.cache_hit_ratio": {
      const { eligible, reasons } = leafEligibility(s);
      let num = 0, den = 0, covered = 0;
      const records: Evidence[] = [];
      for (const { leaves } of s.runs) for (const l of leaves) {
        records.push(l.evidence);
        if (l.input === null || l.cache_read === null) continue;
        covered++; num += l.cache_read; den += l.input;
      }
      const cov = makeCoverage(eligible === null ? null : Math.max(eligible, covered), covered, s.exclusions, unknownReason(s, reasons) ?? "some eligible requests did not report cache reads");
      return ratioCalc(num, den, cov, records, "zero_inclusive_input");
    }
    case "M10.measured_spend_usd": return sumCalc(s, (l) => l.measured_usd, "measured");
    case "M10.derived_estimate_usd": {
      // A derived series always names its pinned pricing; with none there is no series to state.
      if (!facts.pricing) throw new SeriesRefusal("input_unavailable", "no pricing table pinned; a derived estimate series needs one");
      if (facts.pricing.currency !== "USD") throw new SeriesRefusal("unsupported_capability", `pricing currency ${facts.pricing.currency} has no conversion contract`);
      return sumCalc(s, (l) => l.derived_usd, "derived_estimate");
    }
    case "M10.native_estimate_usd": return { ...unavailableCalc("native session records are disclosed as a loss, not projected as spend", true), cost_basis: "native_estimate" };
    case "M12.eligible_count":
    case "M12.covered_count":
    case "M12.coverage_ratio": {
      const { eligible, reasons } = leafEligibility(s);
      const records: Evidence[] = [];
      let covered = 0;
      for (const { leaves } of s.runs) for (const l of leaves) { records.push(l.evidence); if (l.covered) covered++; }
      const reason = unknownReason(s, reasons) ?? "some eligible requests did not report usage";
      if (id === "M12.covered_count") {
        // Covered samples are counted exactly; only the enumeration around them can be unknown.
        if (eligible !== null) return { value: covered, known_subtotal: covered, exact_total: covered, numerator: null, denominator: null, coverage: makeCoverage(eligible, eligible, s.exclusions, null), cost_basis: "not_applicable", reason: null, records };
        const cov = makeCoverage(null, covered, s.exclusions, reason);
        return cov.state === "unavailable" ? { ...unavailableCalc(reason, false), coverage: cov, records } : { value: covered, known_subtotal: covered, exact_total: null, numerator: null, denominator: null, coverage: cov, cost_basis: "not_applicable", reason, records };
      }
      if (eligible === null) {
        const cov = makeCoverage(null, covered, s.exclusions, reason);
        return { value: null, known_subtotal: null, exact_total: null, numerator: id === "M12.coverage_ratio" ? covered : null, denominator: null, coverage: cov, cost_basis: "not_applicable", reason: `eligible denominator unknown: ${reason}`, records };
      }
      if (id === "M12.eligible_count") return { value: eligible, known_subtotal: eligible, exact_total: eligible, numerator: null, denominator: null, coverage: makeCoverage(eligible, eligible, s.exclusions, null), cost_basis: "not_applicable", reason: null, records };
      return ratioCalc(covered, eligible, makeCoverage(eligible, eligible, s.exclusions, null), records, "no eligible requests");
    }
    case "M12.invalid_count": {
      const m = new Map<string, Evidence>();
      let n = 0;
      let known = enumKnown(s) && !s.leafFiltered;
      for (const { run } of s.runs) { if (run.invalid_count === null) known = false; else n += run.invalid_count; m.set(`${run.source_id}\u0000${run.run_id}`, run.evidence); }
      if (!known) return unavailableCalc(s.leafFiltered ? "invalid events cannot be attributed to a filtered scope" : unknownReason(s) ?? "invalid event count unknown", false);
      return { value: n, known_subtotal: n, exact_total: n, numerator: null, denominator: null, coverage: makeCoverage(s.runs.length, s.runs.length, {}, null), cost_basis: "not_applicable", reason: null, records: [...m.values()] };
    }
    case "M12.duplicate_count": {
      const records: Evidence[] = [];
      // A run without a complete trace has unknown attachments and unknown suppressed repeats.
      const unknown = s.runs.filter(({ run }) => run.usage_state !== "available" || !run.trace_complete);
      const reason = unknownReason(s, unknown.map(({ run }) => `run ${run.source_id}:${run.run_id} has no complete trace`));
      const known = s.runs.filter((r) => !unknown.includes(r));
      if (grain === "run") {
        // Suppressed repeats of one source-qualified run across its attachments.
        let observations = 0;
        for (const { run } of known) { observations += Math.max(1, run.attachments.length); records.push(run.evidence); }
        const n = observations - known.length;
        const cov = makeCoverage(enumKnown(s) && unknown.length === 0 ? observations : null, observations, {}, reason);
        if (cov.state === "unavailable") return { ...unavailableCalc(cov.reason!, false), coverage: cov, records };
        return { value: n, known_subtotal: n, exact_total: cov.state === "complete" ? n : null, numerator: null, denominator: null, coverage: cov, cost_basis: "not_applicable", reason: cov.state === "complete" ? null : cov.reason, records };
      }
      if (s.leafFiltered) return unavailableCalc("suppressed request repeats cannot be attributed to a filtered scope", false);
      let n = 0;
      for (const { run } of known) { n += run.duplicate_count; records.push(run.evidence); }
      const cov = makeCoverage(enumKnown(s) ? s.runs.length : null, known.length, {}, reason);
      if (cov.state === "unavailable") return { ...unavailableCalc(cov.reason!, false), coverage: cov, records };
      return { value: n, known_subtotal: n, exact_total: cov.state === "complete" ? n : null, numerator: null, denominator: null, coverage: cov, cost_basis: "not_applicable", reason: cov.state === "complete" ? null : cov.reason, records };
    }
    case "M13.allocated_tokens": return sumCalc(s, (l) => (l.covered && l.allocated && l.total !== null ? l.total : l.covered && !l.allocated ? 0 : null), "not_applicable");
    case "M13.unallocated_tokens": return sumCalc(s, (l) => (l.covered && !l.allocated && l.total !== null ? l.total : l.covered && l.allocated ? 0 : null), "not_applicable");
    case "M13.allocated_usd":
    case "M13.unallocated_usd": {
      // Known cost keeps its basis: measured spend when the scope has any, else the pinned derived estimate.
      const want = id === "M13.allocated_usd";
      const anyMeasured = s.runs.some(({ leaves }) => leaves.some((l) => l.measured_usd !== null));
      if (anyMeasured) return sumCalc(s, (l) => (l.measured_usd === null ? null : l.allocated === want ? l.measured_usd : 0), "measured", "some requests have no measured spend");
      if (!facts.pricing) return unavailableCalc("no measured spend and no pricing table pinned; allocated cost unavailable", true);
      return sumCalc(s, (l) => (l.derived_usd === null ? null : l.allocated === want ? l.derived_usd : 0), "derived_estimate");
    }
    case "M14.outcome_count": {
      const { tasks, unknown } = outcomeTasks(s);
      const m = new Map<string, Evidence>();
      for (const t of tasks) if (t.outcome !== "pending") m.set(`${t.source_id}\u0000${t.task_id}`, t.evidence);
      const eligible = s.unknownSources.length ? null : m.size + unknown;
      const cov = makeCoverage(eligible, m.size, s.taskExclusions, unknownReason(s, unknown ? [`${unknown} tasks have no recorded outcome axes`] : []));
      if (cov.state === "unavailable") return unavailableCalc(cov.reason!, false);
      return { value: m.size, known_subtotal: m.size, exact_total: cov.state === "complete" ? m.size : null, numerator: null, denominator: null, coverage: cov, cost_basis: "not_applicable", reason: cov.state === "complete" ? null : cov.reason, records: [...m.values()] };
    }
    case "M14.success_ratio": {
      const { tasks, unknown } = outcomeTasks(s);
      const num = tasks.filter((t) => t.outcome === "succeeded" && t.acceptance === "verified").length;
      const eligible = s.unknownSources.length ? null : tasks.length + unknown;
      const cov = makeCoverage(eligible, tasks.length, s.taskExclusions, unknownReason(s, unknown ? [`${unknown} tasks have no recorded outcome axes`] : []));
      return ratioCalc(num, tasks.length, cov, tasks.map((t) => t.evidence), "no_completed_task_in_cohort");
    }
    case "M22.cost_per_success_usd": {
      const { tasks, unknown } = outcomeTasks(s);
      const eligible = s.unknownSources.length ? null : tasks.length + unknown;
      const cov = makeCoverage(eligible, tasks.length, s.taskExclusions, unknownReason(s, unknown ? [`${unknown} tasks have no recorded outcome axes`] : []));
      const records = tasks.map((t) => t.evidence);
      if (cov.state === "unavailable") return unavailableCalc(cov.reason!, true);
      const den = tasks.filter((t) => t.outcome === "succeeded" && t.acceptance === "verified").length;
      const bases = new Set(tasks.map((t) => t.spend_basis));
      if (tasks.some((t) => t.spend_usd === null) || bases.has(null)) return { ...unavailableCalc("cohort spend incomplete", true), coverage: cov, denominator: den, records };
      if (bases.size > 1) throw new SeriesRefusal("unsupported_capability", "cohort spend mixes measured and estimated cost bases");
      const basis = (bases.values().next().value ?? "measured") as CostBasis;
      if (basis === "derived_estimate" && !facts.pricing) return { ...unavailableCalc("derived spend needs a pinned pricing table", true), coverage: cov, records };
      // All attempts of the selected tasks, including spend before the window.
      const num = tasks.reduce((a, t) => a + t.spend_usd!, 0);
      if (den === 0) return { value: null, known_subtotal: null, exact_total: null, numerator: num, denominator: 0, coverage: cov, cost_basis: basis, reason: "no_verified_success_in_cohort", records };
      return { value: num / den, known_subtotal: null, exact_total: null, numerator: num, denominator: den, coverage: cov, cost_basis: basis, reason: cov.state === "complete" ? null : cov.reason, records };
    }
    default:
      return unavailableCalc(NOT_COLLECTED[fam] ?? `not collected: producer ${metric.producer_package} has no project read input yet`, cost);
  }
}

// ── Grouping ─────────────────────────────────────────────────────────────────

const KEY_RE = TRACE_ID_RE;
/**
 * Group the scope into series points. Source, run and task keys are source-qualified
 * (`source:run`, `source:task`); a key two different identities would share refuses,
 * so ids containing ':' can never merge two runs. Cohort and model keys are
 * cross-source by design.
 */
function groupKeys(s: Scope, by: GroupBy): Map<string, Scope> {
  const out = new Map<string, Scope>();
  if (by === "all") { out.set("all", s); return out; }
  const owner = new Map<string, string>();
  const own = by === "source" || by === "run";
  // Runs whose records are not all known could hold any task, model or cohort key: every such point is unknown there.
  const opaque = own ? [] : s.runs.filter(({ run }) => run.usage_state !== "available" || !run.trace_complete || run.extra_missing !== 0).map(({ run }) => ({ source_id: run.source_id, run_id: run.run_id }));
  const group = (k: string | null, identity: string | null, src: string, runId: string | null = null): Scope => {
    const key = k === null ? "unattributed" : k;
    if (!KEY_RE.test(key)) throw new SeriesRefusal("invalid_request", `group key ${JSON.stringify(key)} is not a contract id`);
    const id = identity ?? key;
    if (owner.has(key) && owner.get(key) !== id) throw new SeriesRefusal("invalid_request", `group key ${key} would merge distinct identities; ids are ambiguous under ':' joining`);
    owner.set(key, id);
    let g = out.get(key);
    if (!g) {
      // A source or run key names known facts; an unavailable source cannot hold them. Other keys may recur there.
      g = { ...s, runs: [], tasks: [], leafFiltered: s.leafFiltered || !own,
        unknownSources: own ? [] : s.unknownSources,
        unknownRuns: by === "source" ? s.unknownRuns.filter((x) => x.source_id === src) : by === "run" ? s.unknownRuns.filter((x) => x.source_id === src && x.run_id === runId) : [...s.unknownRuns, ...opaque],
        unenumerated: by === "source" ? s.unenumerated.filter((x) => x.source_id === src) : by === "run" ? [] : s.unenumerated,
        noOutcomeSources: own ? s.noOutcomeSources.filter((x) => x === src) : s.noOutcomeSources };
      out.set(key, g);
    }
    return g;
  };
  const slot = (g: Scope, r: ScopedRun, whole: boolean): ScopedRun => {
    let x = g.runs.find((y) => y.run === r.run);
    if (!x) { x = { run: r.run, leaves: whole ? r.leaves : [], observations: whole ? r.observations : [] }; g.runs.push(x); }
    return x;
  };
  const cohortOf = new Map(s.tasks.map((t) => [`${t.source_id}\u0000${t.run_id}\u0000${t.task_id}`, t.cohort]));
  const keyOf = (r: RunFacts, rec: { logical_task_id: string | null; observed_model: string | null }): [string | null, string | null] => {
    if (by === "task") return rec.logical_task_id === null ? [null, null] : [`${r.source_id}:${rec.logical_task_id}`, `${r.source_id}\u0000${rec.logical_task_id}`];
    if (by === "observed_model") return [rec.observed_model, null];
    const c = rec.logical_task_id === null ? null : cohortOf.get(`${r.source_id}\u0000${r.run_id}\u0000${rec.logical_task_id}`) ?? null;
    return [c, null];
  };
  for (const r of s.runs) {
    if (by === "source") slot(group(r.run.source_id, null, r.run.source_id), r, true);
    else if (by === "run") slot(group(`${r.run.source_id}:${r.run.run_id}`, `${r.run.source_id}\u0000${r.run.run_id}`, r.run.source_id, r.run.run_id), r, true);
    else {
      for (const l of r.leaves) { const [k, id] = keyOf(r.run, l); slot(group(k, id, r.run.source_id), r, false).leaves.push(l); }
      for (const o of r.observations) { const [k, id] = keyOf(r.run, o); slot(group(k, id, r.run.source_id), r, false).observations.push(o); }
    }
  }
  for (const t of s.tasks) {
    const g = by === "cohort" ? group(t.cohort, null, t.source_id)
      : by === "source" ? group(t.source_id, null, t.source_id)
      : by === "run" ? group(`${t.source_id}:${t.run_id}`, `${t.source_id}\u0000${t.run_id}`, t.source_id, t.run_id)
      : by === "task" ? group(`${t.source_id}:${t.task_id}`, `${t.source_id}\u0000${t.task_id}`, t.source_id) : null;
    g?.tasks.push(t);
  }
  // Unavailable sources are unknown in every group, so per-source points still name them.
  if (by === "source") for (const sid of s.unknownSources) if (!out.has(sid)) out.set(sid, { ...s, runs: [], tasks: [], unknownSources: [sid], unknownRuns: [], unenumerated: [], noOutcomeSources: [] });
  if (out.size > SERIES_LIMITS.points) throw new SeriesRefusal("invalid_request", `${out.size} groups exceed the ${SERIES_LIMITS.points}-point bound; narrow the filters`);
  return new Map([...out.entries()].sort((a, b) => cmp(a[0], b[0])));
}

// ── Series ───────────────────────────────────────────────────────────────────

export interface ComputedSeries { series: MetricSeriesV2; records: Map<string, Evidence[]> }

/** Cursor for the first drilldown page of a point (null when it has no records). */
export type CursorFor = (point_key: string, offset: number, total: number) => string | null;

function usageSemanticsOf(metric: AtomicMetric, s: Scope): UsageSemantics {
  if (!USAGE_FAMILIES.has(familyOf(metric.id))) return "not_applicable";
  const set = new Set<string>();
  for (const { leaves } of s.runs) for (const l of leaves) if (l.covered) set.add(l.usage_semantics);
  set.delete("unknown");
  if (set.size > 1) throw new SeriesRefusal("unsupported_capability", `mixed usage semantics ${[...set].sort().join("+")} cannot be summed`);
  const only = set.values().next().value as string | undefined;
  if (only === undefined) return "unknown";
  if (only !== "inclusive_input_cache_subset.v1" && only !== "provider_session_only.v1") throw new SeriesRefusal("unsupported_capability", `usage semantics ${only} are not a C9 semantics`);
  return only;
}

/** Pin a query to one metric: formula, usage semantics and the M29 underlying scalar. */
export function pinQuery(base: Omit<QueryIdentity, "versions" | "underlying_scalar"> & { versions: Omit<VersionSet, "formula" | "usage_semantics"> }, metricId: string, usage_semantics: UsageSemantics, underlying: string | null = null): QueryIdentity {
  const m = ATOMIC_BY_ID.get(metricId);
  if (!m) throw new SeriesRefusal("unsupported_capability", `metric ${metricId} is not in the C9 catalog`);
  let under: QueryIdentity["underlying_scalar"] = null;
  if (metricId === "M29.series_value") {
    const u = underlying === null ? undefined : ATOMIC_BY_ID.get(underlying);
    if (!u || u.id === "M29.series_value") throw new SeriesRefusal("invalid_request", "M29 alias needs an underlying scalar metric");
    under = { metric_id: u.id, formula_version: u.formula_version };
  } else if (underlying !== null) throw new SeriesRefusal("invalid_request", "only M29 carries an underlying scalar");
  return { ...base, versions: { ...base.versions, formula: m.formula_version, usage_semantics }, underlying_scalar: under };
}

/** The usage semantics a metric's query must pin over these facts (so a client can build the query first). */
export function seriesUsageSemantics(facts: FactSet, q: QueryIdentity, metricId: string, underlying: string | null = null): UsageSemantics {
  const m = ATOMIC_BY_ID.get(metricId === "M29.series_value" && underlying ? underlying : metricId);
  if (!m) throw new SeriesRefusal("unsupported_capability", `metric ${metricId} is not in the C9 catalog`);
  return usageSemanticsOf(m, selectScope(facts, q, false));
}

/**
 * The one formula engine. Every report, analysis and read projection that shows
 * a C9 value computes it here, from the same facts, query and snapshot.
 */
export function computeMetricSeries(facts: FactSet, q: QueryIdentity, opts: { group_by?: GroupBy; cursor?: CursorFor } = {}): ComputedSeries {
  if (canonicalJson(q.snapshot) !== canonicalJson(facts.snapshot)) throw new SeriesRefusal("stale_source", "query snapshot differs from the facts snapshot", true);
  const metric = metricOfQuery(q);
  const effective = metric.id === "M29.series_value" ? ATOMIC_BY_ID.get(q.underlying_scalar?.metric_id ?? "") : metric;
  if (!effective || (metric.id === "M29.series_value" && q.underlying_scalar?.formula_version !== effective.formula_version)) throw new SeriesRefusal("invalid_request", "M29 underlying scalar does not name a catalog metric version");
  if (metric.id !== "M29.series_value" && q.underlying_scalar !== null) throw new SeriesRefusal("invalid_request", "only M29 carries an underlying scalar");
  const scope = selectScope(facts, q, OUTCOME_METRICS.has(effective.id));
  const semantics = usageSemanticsOf(effective, scope);
  if (q.versions.usage_semantics !== semantics) throw new SeriesRefusal("invalid_request", `query pins usage semantics ${q.versions.usage_semantics}; the scope observes ${semantics}`);
  const hash = queryHash(q);
  const records = new Map<string, Evidence[]>();
  const points: SeriesPoint[] = [];
  const groups = groupKeys(scope, opts.group_by ?? "all");
  for (const [key, g] of groups) {
    const c = computeCalc(effective, g, facts, q.grain);
    const rs = sortEvidence(c.records);
    records.set(key, rs);
    points.push({
      key, value: c.value, known_subtotal: c.known_subtotal, exact_total: c.exact_total, numerator: c.numerator, denominator: c.denominator,
      coverage: c.coverage, cost_basis: c.cost_basis, reason: c.reason, evidence: rs.slice(0, SERIES_LIMITS.evidence),
      drilldown: { query_hash: hash, cursor: rs.length && opts.cursor ? opts.cursor(key, 0, rs.length) : null },
    });
  }
  const whole = computeCalc(effective, scope, facts, q.grain).coverage;
  const unit = effective.unit as string;
  const derived = points.some((p) => p.cost_basis === "derived_estimate");
  return {
    series: {
      schema_version: METRIC_SERIES_V2_SCHEMA, metric_id: metric.id,
      underlying_formula_version: metric.id === "M29.series_value" ? effective.formula_version : null,
      underlying_metric_id: metric.id === "M29.series_value" ? effective.id : null,
      unit, unit_label: UNIT_LABEL[unit] ?? unit, query: q, usage_semantics: semantics,
      pricing: derived && facts.pricing ? { version: q.versions.pricing, currency: "USD", source_hash: facts.pricing.source_hash } : null,
      coverage: whole, points,
    },
    records,
  };
}

// ── Validation (schema mirror + verify_contracts.py rules) ───────────────────

const C = TRACE_V3_CHECKS;
const num: TraceShapeCheck = (v, at, e) => { if (typeof v !== "number" || !Number.isFinite(v)) e.push(`${at}: not a number`); };
const metricIdCheck = C.oneOf(...ATOMIC_METRICS.map((m) => m.id));
const FILTER_DIMENSIONS = ["initiative", "run", "execution", "phase", "goal", "task", "attempt", "agent", "host", "requested_model", "observed_model", "workflow_revision", "config", "case", "scorer", "pair", "applied_revision", "knowledge_channel", "generation"];
const KINDS = ["initiative", "run", "execution", "host_session", "goal", "logical_task", "task_attempt", "agent_instance", "request", "operation", "decision", "workflow", "component", "invocation", "obligation", "memory", "knowledge", "candidate", "agent", "skill", "tool", "team", "loop", "config", "evaluation", "report", "benchmark_case", "transfer", "query"];
const uniq = (item: TraceShapeCheck, max: number, min = 0): TraceShapeCheck => (v, at, e) => {
  C.array(item, max)(v, at, e);
  if (!Array.isArray(v)) return;
  if (v.length < min) e.push(`${at}: fewer than ${min} items`);
  if (new Set(v.map(canonicalJson)).size !== v.length) e.push(`${at}: items not unique`);
};
const atLeast = (item: TraceShapeCheck, max: number, min: number): TraceShapeCheck => (v, at, e) => {
  C.array(item, max)(v, at, e);
  if (Array.isArray(v) && v.length < min) e.push(`${at}: fewer than ${min} items`);
};
const snapshotCheck = C.object({
  input_manifest_digest: C.hash, source_ids: uniq(C.id, 100, 1),
  source_generations: atLeast(C.object({ source_id: C.id, generation: C.hash }), 100, 1), as_of: C.time,
});
export const QUERY_IDENTITY_CHECK: TraceShapeCheck = C.object({
  schema_version: C.str, versions: C.object({ schema: C.str, analyzer: C.str, normalizer: C.str, formula: C.str, usage_semantics: C.str, pricing: C.str, aggregation: C.str }),
  snapshot: snapshotCheck, grain: C.oneOf(...KINDS),
  filters: C.array(C.object({ dimension: C.oneOf(...FILTER_DIMENSIONS), values: uniq(C.str, 100, 1) }), 50),
  window: C.object({ from: C.time, to: C.time, basis: C.oneOf("activity_completed", "accepted_outcome_cohort", "as_of_snapshot"), timezone: C.str }),
  cohort_hash: C.hash, underlying_scalar: C.nullable(C.object({ metric_id: C.id, formula_version: C.str })),
});
const pointCheck = C.object({
  key: C.id, value: C.nullable(num), known_subtotal: C.nullable(num), exact_total: C.nullable(num), numerator: C.nullable(num),
  denominator: C.nullable(C.num0), coverage: C.coverage,
  cost_basis: C.oneOf("measured", "derived_estimate", "native_estimate", "unavailable", "not_applicable"), reason: C.nullable(C.str),
  evidence: C.array(C.evidence, 100), drilldown: C.object({ query_hash: C.hash, cursor: C.nullable(C.str) }),
});
const seriesShape = C.object({
  schema_version: C.konst(METRIC_SERIES_V2_SCHEMA), metric_id: metricIdCheck,
  underlying_formula_version: C.nullable(C.str), underlying_metric_id: C.nullable(metricIdCheck),
  unit: C.oneOf("ms", "usd", "tokens", "count", "ratio", "usd_per_outcome", "ms_per_outcome", "case_score"), unit_label: C.str,
  query: QUERY_IDENTITY_CHECK, usage_semantics: C.oneOf("inclusive_input_cache_subset.v1", "provider_session_only.v1", "not_applicable", "unknown"),
  pricing: C.nullable(C.object({ version: C.str, currency: C.konst("USD"), source_hash: C.hash })),
  coverage: C.coverage, points: C.array(pointCheck, 1000),
});
const drilldownShape = C.object({
  schema_version: C.konst(METRIC_DRILLDOWN_V2_SCHEMA), metric_id: metricIdCheck, point_key: C.id, query_hash: C.hash,
  snapshot: snapshotCheck, records: C.array(C.evidence, 1000), coverage: C.coverage, next_cursor: C.nullable(C.str),
});
const readRequestShape = C.object({
  schema_version: C.konst(READ_REQUEST_V2_SCHEMA), request_id: C.id, session_id: C.id,
  operation: C.oneOf("entities", "trace", "artifacts", "workflow", "knowledge", "metric_series", "metric_drilldown"),
  result_schema_id: C.str, query: QUERY_IDENTITY_CHECK, cursor: C.nullable(C.str),
  limit: (v, at, e) => { if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 1000) e.push(`${at}: not a limit 1..1000`); },
  query_hash: C.hash,
});

const verdict = (errors: string[]): Verdict => (errors.length === 0 ? { ok: true } : { ok: false, errors });
type Req = (ok: boolean, msg: string) => void;

function coverageRules(c: Coverage, require: Req): void {
  if (c.eligible !== null) {
    require(c.covered <= c.eligible, "covered exceeds eligible");
    if (c.missing !== null) require(c.covered + c.missing === c.eligible, "eligible must equal covered plus missing; excluded is outside eligible");
  }
  if (c.state === "complete") require(c.eligible !== null && c.covered === c.eligible && c.missing === 0, "complete requires known full coverage");
  else require(Boolean(c.reason), "incomplete coverage needs reason");
  if (c.state === "unavailable") require(c.covered === 0, "unavailable coverage cannot have covered samples");
}
function snapshotRules(s: Snapshot, require: Req): void {
  const gens = s.source_generations.map((g) => g.source_id);
  require(new Set(gens).size === gens.length && gens.every((x) => s.source_ids.includes(x)) && s.source_ids.every((x) => gens.includes(x)), "snapshot source/generation identity mismatch");
}
export function queryRules(q: QueryIdentity, require: Req): void {
  snapshotRules(q.snapshot, require);
  require(compareTraceInstants(q.window.from, q.window.to) < 0, "window must be nonempty half-open [from,to)");
}

const UNSIGNED_UNITS = new Set(["count", "tokens", "ms", "usd", "usd_per_outcome", "ms_per_outcome"]);

export function validateMetricSeriesV2(value: unknown): Verdict {
  const errors: string[] = [];
  seriesShape(value, "$", errors);
  if (errors.length) return verdict(errors);
  const v = value as MetricSeriesV2;
  const require: Req = (ok, msg) => { if (!ok) errors.push(msg); };
  queryRules(v.query, require);
  for (const p of v.points) coverageRules(p.coverage, require);
  coverageRules(v.coverage, require);
  const def = ATOMIC_BY_ID.get(v.metric_id)!;
  require(v.query.versions.formula === def.formula_version, "metric formula version differs from pinned registry");
  if (v.metric_id === "M29.series_value") {
    const under = v.underlying_metric_id === null ? undefined : ATOMIC_BY_ID.get(v.underlying_metric_id);
    require(under !== undefined, "M29 alias needs underlying scalar");
    if (under) require(v.unit === under.unit && v.underlying_formula_version === under.formula_version, "M29 underlying unit/formula mismatch");
  } else require(v.underlying_metric_id === null && v.underlying_formula_version === null && v.unit === def.unit, "scalar unit or unexpected alias mismatch");
  const expectedUnder = v.metric_id === "M29.series_value" ? { metric_id: v.underlying_metric_id, formula_version: v.underlying_formula_version } : null;
  require(canonicalJson(v.query.underlying_scalar) === canonicalJson(expectedUnder), "query identity must carry exactly the M29 underlying scalar (null for ordinary scalars)");
  require(v.usage_semantics === v.query.versions.usage_semantics, "series usage semantics differ from pinned query usage semantics");
  const effective = v.metric_id === "M29.series_value" ? v.underlying_metric_id : v.metric_id;
  const hash = queryHash(v.query);
  const keys = new Set<string>();
  for (const p of v.points) {
    require(!keys.has(p.key), "duplicate series point key");
    keys.add(p.key);
    require(p.drilldown.query_hash === hash, "drilldown query identity mismatch");
    if (p.coverage.state !== "complete") require(p.exact_total === null, "incomplete metric cannot claim exact total");
    if (p.coverage.state === "unavailable") require(p.value === null && p.known_subtotal === null && Boolean(p.reason), "unavailable metric must be null with reason");
    if (p.denominator === 0) require(p.value === null && Boolean(p.reason), "zero denominator is unavailable with an explicit reason, not zero score");
    if (p.value === null) require(Boolean(p.reason), "unavailable metric value needs an explicit reason independent of input coverage");
    if (UNSIGNED_UNITS.has(v.unit) && !SIGNED_METRICS.has(effective ?? "")) require([p.value, p.known_subtotal, p.exact_total, p.numerator].every((x) => x === null || x >= 0), "unsigned metric cannot be negative");
    if (p.value !== null) {
      if (v.unit === "ratio") require(p.value >= 0 && p.value <= 1, "ratio outside0..1");
      if (v.unit === "count") require(p.value >= 0 && Number.isInteger(p.value), "count must be nonnegative integer");
    }
    require(p.evidence.every((x) => v.query.snapshot.source_ids.includes(x.source_id)), "metric evidence outside query sources");
    if (effective === "M10.native_estimate_usd") require(p.cost_basis === "native_estimate", "native estimate cannot become measured billing");
    if (effective === "M10.derived_estimate_usd") require(p.cost_basis === "derived_estimate", "derived estimate must retain basis");
    if (effective === "M10.measured_spend_usd") require(p.cost_basis === "measured", "measured series cannot contain estimated cost");
    if (p.cost_basis === "derived_estimate") require(v.pricing !== null && v.pricing.version === v.query.versions.pricing, "derived estimate needs pinned pricing matching query pricing version");
  }
  return verdict(errors);
}

export function validateMetricDrilldownV2(value: unknown): Verdict {
  const errors: string[] = [];
  drilldownShape(value, "$", errors);
  if (errors.length) return verdict(errors);
  const v = value as MetricDrilldownV2;
  const require: Req = (ok, msg) => { if (!ok) errors.push(msg); };
  snapshotRules(v.snapshot, require);
  coverageRules(v.coverage, require);
  require(v.records.every((x) => v.snapshot.source_ids.includes(x.source_id)), "drilldown record outside snapshot sources");
  return verdict(errors);
}

export function validateReadRequestV2(value: unknown): Verdict {
  const errors: string[] = [];
  readRequestShape(value, "$", errors);
  if (errors.length) return verdict(errors);
  const v = value as ReadRequestV2;
  const require: Req = (ok, msg) => { if (!ok) errors.push(msg); };
  queryRules(v.query, require);
  require(v.query_hash === queryHash(v.query) && (Object.values(RESULT_SCHEMA_IDS) as string[]).includes(v.result_schema_id), "query hash or requested schema unsupported");
  return verdict(errors);
}

/** Series nested in a run analysis or comparison share its inputs; only formula and the M29 scalar may differ. */
export function nestedSeriesErrors(enclosing: QueryIdentity, metrics: readonly unknown[], what: "analysis" | "comparison"): string[] {
  const out: string[] = [];
  const identity = (q: QueryIdentity) => { const c = JSON.parse(JSON.stringify(q)) as Record<string, any>; delete c["versions"]["formula"]; delete c["underlying_scalar"]; return canonicalJson(c); };
  for (const m of metrics) {
    const r = validateMetricSeriesV2(m);
    if (!r.ok) { out.push(...r.errors); continue; }
    if (identity((m as MetricSeriesV2).query) !== identity(enclosing)) out.push(`nested metric series input identity differs from enclosing ${what}`);
  }
  return out;
}

export function refusal(request_id: string, code: RefusalCode, message: string, retryable: boolean, expected: string | null = null, observed: string | null = null): RefusalV2 {
  return { schema_version: REFUSAL_V2_SCHEMA, request_id, code, message: message.slice(0, 4096), retryable, expected_snapshot: expected, observed_snapshot: observed };
}
