/**
 * T04 · C9 series and complete project read service.
 *   AT28 project completeness · AT29 query snapshot · AT30 metric series contract.
 *
 * Sources are real `.guild/` roots on disk read through T01/T02; GF3 and GF5
 * come from the frozen A02 golden fixture (A02_CONTRACT_ROOT, or
 * <umbrella>/contracts/guild-stack/v2). T04_REQUIRE_A02=1 makes them mandatory.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TraceAnalysisV3, TraceCoverage, TraceUsage } from "./trace-analysis-v3";
import type { PriceTable } from "./run-ledger-v2";
import { ATOMIC_METRICS } from "./metric-catalog-v2";
import {
  SeriesRefusal,
  computeMetricSeries,
  queryHash,
  validateMetricDrilldownV2,
  validateMetricSeriesV2,
  validateReadRequestV2,
  type FactSet,
  type MetricDrilldownV2,
  type MetricSeriesV2,
  type QueryIdentity,
  type RefusalV2,
  type TaskFact,
} from "./metric-series-v2";
import { validateRunAnalysisV2, validateRunComparisonV2 } from "./run-analysis-v2";
import { openProjectSnapshot, projectQuery, readMetricDrilldown, readMetricSeries, readRequest, type ProjectSnapshot } from "./project-read-v2";

const PLUGIN_ROOT = path.resolve(__dirname, "../../..");
const A02_ROOT = process.env["A02_CONTRACT_ROOT"] ?? path.resolve(PLUGIN_ROOT, "../contracts/guild-stack/v2");
const A02_PRESENT = fs.existsSync(path.join(A02_ROOT, "fixtures", "golden.json"));
const REQUIRE = process.env["T04_REQUIRE_A02"] === "1";

const H = `sha256:${"a".repeat(64)}`;
const PINS = { assignment: H, definition: H, configuration: H, workflow: H, policy: H };
const COMPLETE: TraceCoverage = { eligible: 1, covered: 1, excluded: 0, missing: 0, state: "complete", reason: null, exclusion_reasons: [] };
const AS_OF = "2026-10-26T01:00:00Z";
const P1: PriceTable = {
  version: "p1", currency: "USD", source_hash: `sha256:${"d".repeat(64)}`,
  entries: [{ provider: "provider", model: "observed-model", uncached_input: 2, cache_read: 0.5, cache_write: null, output: 8 }],
};

function use(acct: string, input: number, output: number, semantics: TraceUsage["usage_semantics"] = "inclusive_input_cache_subset.v1"): TraceUsage {
  return {
    granularity: "leaf_request", observation_id: `obs-${acct}`, revision: 1, final: true, accounting_identity: acct,
    parent_accounting_identity: null, inclusion: "leaf_exclusive", input_inclusive: input, output, cache_read_subset: 0,
    cache_write_subset: 0, total: input + output, cost_usd: null, cost_basis: "unavailable", currency: "USD", pricing_version: null,
    usage_semantics: semantics, coverage: COMPLETE, native_baseline_usd: null, native_cumulative_usd: null,
  };
}

let seq = 0;
function ev(source: string, run: string, n: number, usage: TraceUsage, o: { goal?: string | null; initiative?: string | null; task?: string | null; at?: string } = {}): TraceAnalysisV3 {
  const at = o.at ?? new Date(Date.parse("2026-10-26T00:00:00Z") + n * 1000).toISOString();
  return {
    schema_version: "guild.trace.analysis.v3", event_id: `record-${String(n).padStart(3, "0")}`, sequence: seq++, event_class: "request_completed", at,
    lineage: {
      source_id: source, run_id: run, execution_id: "exec-1", host_session_id: "host-session-1", initiative_id: o.initiative ?? null, goal_id: o.goal ?? null,
      logical_task_id: o.task ?? null, attempt_id: o.task ? `${o.task}-a1` : null, agent_instance_id: o.task ? "agent-1" : null, request_id: usage.accounting_identity,
    },
    operation_id: null, component_invocation_id: null, actor_id: "agent-1", pins: PINS, requested_model: "requested-model",
    observed_identity: { provider: "provider", model: "observed-model", status: "observed", reason: null },
    usage, payload_ref: null, prompt_hash: null, redaction_version: "guild.trace-scrub.v1", capture: COMPLETE, interval: null,
  };
}
const jsonl = (events: TraceAnalysisV3[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

let base = "";
const rootOf = (source: string) => path.join(base, source);
function put(source: string, rel: string, body: string): void {
  const p = path.join(rootOf(source), ".guild", rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = st.isSymbolicLink() ? `link:${fs.readlinkSync(p)}` : crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

/** AT28 fixture: 501 records in source-a run-1 (usage only on record 501), the same local run id in source-b, a shared goal and a repeated attachment. */
function at28Sources(): void {
  const a: TraceAnalysisV3[] = [];
  for (let n = 1; n <= 501; n++) a.push(ev("source-a", "run-1", n, use(`req-${n}`, 1, n === 501 ? 7 : 0), n === 1 ? { initiative: "initiative-1" } : n === 2 ? { goal: "goal-1" } : {}));
  put("source-a", "runs/run-1/trace.jsonl", jsonl(a));
  put("source-b", "runs/run-1/trace.jsonl", jsonl([ev("source-b", "run-1", 1, use("req-1", 2, 3), { goal: "goal-1" })]));
}
const SOURCES = () => [{ source_id: "source-a", root: rootOf("source-a") }, { source_id: "source-b", root: rootOf("source-b") }];
const open = (sources = SOURCES(), pricing: PriceTable | null = P1) => openProjectSnapshot(sources, { as_of: AS_OF, pricing });
const isRefusal = (x: unknown): x is RefusalV2 => (x as RefusalV2)?.schema_version === "guild.stack.refusal.v2";
function series(snap: ProjectSnapshot, metric: string, o: { filters?: QueryIdentity["filters"]; grain?: QueryIdentity["grain"]; group_by?: "all" | "source" | "run" | "cohort" } = {}): MetricSeriesV2 {
  const q = projectQuery(snap, { metric_id: metric, filters: o.filters, grain: o.grain });
  const r = readMetricSeries(snap, readRequest(q, "metric_series", { request_id: "q-1", session_id: "stack-session-1" }), { group_by: o.group_by });
  if (isRefusal(r)) throw new Error(`refused: ${r.code} ${r.message}`);
  expect(validateMetricSeriesV2(r)).toEqual({ ok: true });
  return r;
}
const pt = (s: MetricSeriesV2, key = "all") => s.points.find((p) => p.key === key)!;

beforeEach(() => { base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-t04-"))); seq = 0; });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

// ── frozen A02 ───────────────────────────────────────────────────────────────

interface Golden { fixtures: Array<{ id: string; inputs: any; documents: Array<{ id: string; schema: string; instance: any }>; bindings: Array<{ id: string; document: string; pointer: string; expected: unknown }>; refusals: Array<{ id: string; document: string; schema: string; level: string; expected_error: string; instance: any }> }> }
function golden(): Golden | null {
  if (!A02_PRESENT) { expect(REQUIRE).toBe(false); return null; }
  return JSON.parse(fs.readFileSync(path.join(A02_ROOT, "fixtures", "golden.json"), "utf8")) as Golden;
}
const at = (doc: unknown, pointer: string) => pointer.split("/").slice(1).reduce<any>((o, k) => o?.[k], doc);
const VALIDATORS: Record<string, (v: unknown) => { ok: boolean; errors?: string[] }> = {
  "metric-series": validateMetricSeriesV2, "metric-drilldown": validateMetricDrilldownV2, "read-request": validateReadRequestV2,
  "run-analysis": validateRunAnalysisV2, "run-comparison": validateRunComparisonV2,
};

/** verify_contracts.py semantic_errors (AST-extracted; rfc8785/jsonschema are not installed here). */
function pythonSemanticErrors(cases: Array<[string, unknown]>): string[][] {
  const py = [
    "import sys,json,ast,copy,math,hashlib", "from datetime import datetime",
    `root=${JSON.stringify(A02_ROOT)}`, "p=root+'/verify_contracts.py'",
    "t=ast.parse(open(p).read(),p)",
    "m=ast.Module(body=[n for n in t.body if isinstance(n,ast.FunctionDef) and n.name in {'dt','semantic_errors','input_identity','disclosed','usable'}],type_ignores=[])",
    "def digest(v): return 'sha256:'+hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()",
    "CATALOG=json.load(open(root+'/metric-catalog.json'))",
    "METRICS={x['id']:x for x in CATALOG['atomic_measurements']}",
    "SIGNED_METRICS={x['id'] for x in CATALOG['atomic_measurements'] if 'paired candidate-baseline' in x['formula']}",
    "UNSIGNED_UNITS={'count','tokens','ms','usd','usd_per_outcome','ms_per_outcome'}",
    "USAGE_COUNTERS=['input_inclusive','output','cache_read_subset','cache_write_subset','total']",
    "BY_URI={'https://guildstack.dev/contracts/guild-stack/v2/metric-series.schema.json':1,'https://guildstack.dev/contracts/guild-stack/v2/metric-drilldown.schema.json':1}",
    "exec(compile(m,p,'exec'))",
    "print(json.dumps([semantic_errors(n,v) for n,v in json.load(sys.stdin)]))",
  ].join("\n");
  const r = spawnSync("python3", ["-I", "-c", py], { input: JSON.stringify(cases), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  expect(r.stderr).toBe("");
  return JSON.parse(r.stdout) as string[][];
}

// ── AT30 ─────────────────────────────────────────────────────────────────────

function gf3Facts(tasks: TaskFact[]): FactSet {
  const snapshot = { input_manifest_digest: H, source_ids: ["source-a"], source_generations: [{ source_id: "source-a", generation: H }], as_of: "2026-10-26T00:00:20Z" };
  return { snapshot, sources: [{ source_id: "source-a", generation: H, state: "available", reason: null, runs: [], unenumerated_runs: 0, outcomes: "collected", tasks }], pricing: null };
}
function gf3Query(metric: string, basis: QueryIdentity["window"]["basis"] = "accepted_outcome_cohort"): QueryIdentity {
  const m = ATOMIC_METRICS.find((x) => x.id === metric)!;
  return {
    schema_version: "guild.stack.metric-series.v2",
    versions: { schema: "v2", analyzer: "a1", normalizer: "n1", formula: m.formula_version, usage_semantics: "not_applicable", pricing: "p1", aggregation: "g1" },
    snapshot: gf3Facts([]).snapshot, grain: "logical_task", filters: [],
    window: { from: "2026-10-26T00:00:00Z", to: "2026-10-26T00:00:20Z", basis, timezone: "UTC" }, cohort_hash: `sha256:${"c".repeat(64)}`, underlying_scalar: null,
  };
}
const OUTCOMES = (gf3: any): TaskFact[] => (gf3?.inputs.tasks ?? [
  { cohort: "cohort-a", run: "run-1", task: "task-1", outcome: "succeeded", acceptance: "verified", spend_usd: 0.5 },
  { cohort: "cohort-a", run: "run-2", task: "task-2", outcome: "failed", acceptance: "rejected", spend_usd: 0.5 },
  { cohort: "cohort-a", run: "run-2", task: "task-3", outcome: "failed", acceptance: "rejected", spend_usd: 1.0 },
  { cohort: "cohort-b", run: "run-3", task: "task-4", outcome: "failed", acceptance: "rejected", spend_usd: 0.25 },
  { cohort: "cohort-b", run: "run-3", task: "task-5", outcome: "failed", acceptance: "rejected", spend_usd: 0.25 },
]).map((t: any) => ({
  source_id: "source-a", run_id: t.run, task_id: t.task, cohort: t.cohort, outcome: t.outcome, acceptance: t.acceptance,
  terminal_at: "2026-10-26T00:00:10Z", spend_usd: t.spend_usd, spend_basis: "measured",
  evidence: { source_id: "source-a", path: `runs/${t.run}/outcomes.json`, sha256: H, schema_version: "guild.evidence.v1", observed_at: "2026-10-26T00:00:00Z", availability: "available", reason: null },
}));

describe("AT30 · metric series contract", () => {
  it("the embedded catalog equals the frozen A02 registry and schema enum", () => {
    const g = golden();
    if (!g) return;
    const cat = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "metric-catalog.json"), "utf8"));
    expect(ATOMIC_METRICS.map((m) => ({ ...m }))).toEqual(cat.atomic_measurements.map((m: any) => ({ id: m.id, unit: m.unit, formula_version: m.formula_version, producer_package: m.producer_package })));
    const schema = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "schemas", "metric-series.schema.json"), "utf8"));
    expect(ATOMIC_METRICS.map((m) => m.id)).toEqual(schema.properties.metric_id.enum);
  });

  it("GF3: weighted success ratio, cost per success over all attempts, zero-success denominator unavailable", () => {
    const g = golden();
    const gf3 = g?.fixtures.find((f) => f.id === "GF3");
    const facts = gf3Facts(OUTCOMES(gf3));
    const success = computeMetricSeries(facts, gf3Query("M14.success_ratio"), { group_by: "cohort" }).series;
    const cost = computeMetricSeries(facts, gf3Query("M22.cost_per_success_usd"), { group_by: "cohort" }).series;
    expect(validateMetricSeriesV2(success)).toEqual({ ok: true });
    expect(validateMetricSeriesV2(cost)).toEqual({ ok: true });
    expect(pt(success, "cohort-a")).toMatchObject({ value: 1 / 3, numerator: 1, denominator: 3 });
    expect(pt(success, "cohort-b")).toMatchObject({ value: 0, numerator: 0, denominator: 2 });
    expect(pt(cost, "cohort-a")).toMatchObject({ value: 2, numerator: 2, denominator: 1, cost_basis: "measured" });
    expect(pt(cost, "cohort-b")).toMatchObject({ value: null, numerator: 0.5, denominator: 0, reason: "no_verified_success_in_cohort" });
    expect(pt(cost, "cohort-b").coverage.state).toBe("complete");
    if (!gf3) return;
    const doc = gf3.documents.find((d) => d.id === "analysis")!.instance;
    const mine = { ...doc, metrics: [success, cost] };
    // Bindings that name values (not fixture prose) must hold on the engine output.
    for (const b of gf3.bindings) if (b.pointer.startsWith("/metrics/")) expect(`${b.id}=${JSON.stringify(at(mine, b.pointer))}`).toBe(`${b.id}=${JSON.stringify(b.expected)}`);
    // Negative control: the frozen "mean of per-run ratios" instance is not what the engine computes.
    const meanCase = gf3.refusals.find((r) => r.id === "GF3-mean-of-per-run-ratios")!;
    expect(at(meanCase.instance, "/metrics/0/points/0/value")).toBe(0.5);
    expect(pt(success, "cohort-a").value).not.toBe(0.5);
  });

  it("outcome cohorts refuse activity-window and as_of bases; mixed cost bases and currencies refuse", () => {
    const facts = gf3Facts(OUTCOMES(null));
    for (const basis of ["activity_completed", "as_of_snapshot"] as const) {
      const q = gf3Query("M14.success_ratio", basis);
      const qq = basis === "as_of_snapshot" ? { ...q, window: { ...q.window, to: q.snapshot.as_of } } : q;
      expect(() => computeMetricSeries(facts, qq)).toThrow(SeriesRefusal);
    }
    const mixed = OUTCOMES(null).map((t, i) => ({ ...t, spend_basis: i === 0 ? "derived_estimate" as const : "measured" as const }));
    expect(() => computeMetricSeries(gf3Facts(mixed), gf3Query("M22.cost_per_success_usd"))).toThrow(/mixes measured and estimated/);
    const unknownSpend = OUTCOMES(null).map((t, i) => ({ ...t, spend_usd: i === 0 ? null : t.spend_usd }));
    expect(pt(computeMetricSeries(gf3Facts(unknownSpend), gf3Query("M22.cost_per_success_usd")).series)).toMatchObject({ value: null, reason: "cohort spend incomplete" });
    // Pending tasks are right-censored with a counted reason, never failures.
    const pending = [...OUTCOMES(null), { ...OUTCOMES(null)[0]!, task_id: "task-6", outcome: "pending" as const, acceptance: "pending" as const, terminal_at: null }];
    const s = computeMetricSeries(gf3Facts(pending), gf3Query("M14.success_ratio")).series;
    expect(pt(s)).toMatchObject({ numerator: 1, denominator: 5 });
    expect(pt(s).coverage.exclusion_reasons).toEqual([{ code: "pending_right_censored", count: 1 }]);
    // Unknown outcome axes leave the ratio partial, not a failure.
    const unknown = OUTCOMES(null).map((t, i) => (i === 1 ? { ...t, outcome: "unknown" as const, acceptance: "unknown" as const } : t));
    expect(pt(computeMetricSeries(gf3Facts(unknown), gf3Query("M14.success_ratio")).series)).toMatchObject({ numerator: 1, denominator: 4, coverage: { state: "partial", missing: 1 } });
  });

  it("every catalog metric returns a valid measured, partial or unavailable series over a real project", () => {
    at28Sources();
    put("source-b", "runs/run-old/logs/v1.4-events.jsonl", `{"event":"llm_call"}\n`);
    const snap = open();
    const docs: Array<[string, unknown]> = [];
    const states = new Map<string, string>();
    const OUTCOME = new Set(["M14.outcome_count", "M14.success_ratio", "M15.first_attempt_success_ratio", "M15.retry_count", "M15.rework_count", "M22.cost_per_success_usd", "M22.elapsed_per_success_ms"]);
    for (const m of ATOMIC_METRICS) {
      const s = OUTCOME.has(m.id)
        ? (() => { const q = projectQuery(snap, { metric_id: m.id, grain: "logical_task", window: { from: "2026-10-26T00:00:00Z", to: AS_OF, basis: "accepted_outcome_cohort" } }); const r = readMetricSeries(snap, readRequest(q, "metric_series", { request_id: "q-1", session_id: "s-1" })); if (isRefusal(r)) throw new Error(r.message); return r; })()
        : m.id === "M29.series_value"
        ? (() => { const q = projectQuery(snap, { metric_id: m.id, underlying_metric_id: "M07.output_tokens" }); const r = readMetricSeries(snap, readRequest(q, "metric_series", { request_id: "q-1", session_id: "s-1" })); if (isRefusal(r)) throw new Error(r.message); return r; })()
        : series(snap, m.id);
      expect(`${m.id}:${JSON.stringify(validateMetricSeriesV2(s))}`).toBe(`${m.id}:{"ok":true}`);
      const p = pt(s);
      states.set(m.id, p.coverage.state);
      if (p.value === null) expect(p.reason).toBeTruthy();
      if (p.coverage.state !== "unavailable") expect(`${m.id}:${p.evidence.length > 0}`).toBe(`${m.id}:true`);
      docs.push(["metric-series", s]);
    }
    // A capable producer yields observed values; unavailable is reserved for recorded capability gaps.
    for (const id of ["M01.run_count", "M01.execution_count", "M06.input_tokens", "M07.output_tokens", "M09.total_tokens", "M10.derived_estimate_usd", "M12.duplicate_count", "M29.series_value"]) expect(`${id}:${states.get(id)}`).not.toBe(`${id}:unavailable`);
    expect(states.get("M02.elapsed_ms")).toBe("unavailable");
    // No outcome producer: outcome metrics are unknown, not a complete zero.
    expect(states.get("M14.outcome_count")).toBe("unavailable");
    if (!A02_PRESENT) return;
    const errs = pythonSemanticErrors(docs);
    expect(errs.filter((e) => e.length)).toEqual([]);
    // Anti-vacuity: the same harness flags a zero-denominator ratio scored as zero.
    const bad = JSON.parse(JSON.stringify(docs.find(([, d]) => (d as MetricSeriesV2).metric_id === "M12.coverage_ratio")![1])) as MetricSeriesV2;
    bad.points[0]!.denominator = 0; bad.points[0]!.value = 0; bad.points[0]!.reason = null;
    expect(pythonSemanticErrors([["metric-series", bad]])[0]).toContain("zero denominator is unavailable with an explicit reason, not zero score");
    expect(validateMetricSeriesV2(bad).ok).toBe(false);
  });

  it("mixed usage semantics and non-USD pricing refuse instead of summing", () => {
    put("source-a", "runs/run-1/trace.jsonl", jsonl([ev("source-a", "run-1", 1, use("req-1", 1, 1))]));
    put("source-b", "runs/run-1/trace.jsonl", jsonl([ev("source-b", "run-1", 1, use("req-1", 1, 1))]));
    const snap = open();
    // Facts whose leaves disagree on usage semantics cannot be summed into one series.
    const mixed: FactSet = JSON.parse(JSON.stringify(snap.facts));
    mixed.sources[1]!.runs[0]!.leaves[0]!.usage_semantics = "provider_session_only.v1";
    const q0 = projectQuery(snap, { metric_id: "M07.output_tokens" });
    expect(() => computeMetricSeries(mixed, q0)).toThrow(/mixed usage semantics/);
    // The engine itself refuses facts from another snapshot than the query names.
    const other: FactSet = { ...snap.facts, snapshot: { ...snap.facts.snapshot, input_manifest_digest: H } };
    expect(() => computeMetricSeries(other, q0)).toThrow(/query snapshot differs/);
    // Counts carry no usage semantics and still serve.
    expect(pt(series(snap, "M01.run_count")).value).toBe(2);
    fs.rmSync(path.join(rootOf("source-a"), ".guild", "runs", "run-1"), { recursive: true });
    const eur = open(SOURCES(), { ...P1, currency: "EUR" });
    const q = projectQuery(eur, { metric_id: "M10.derived_estimate_usd" });
    const r = readMetricSeries(eur, readRequest(q, "metric_series", { request_id: "q-1", session_id: "s-1" }));
    expect(isRefusal(r) && r.code).toBe("unsupported_capability");
  });

  it("frozen GF3/GF5 documents validate and every semantic refusal is refused with its error", () => {
    const g = golden();
    if (!g) return;
    let refused = 0;
    for (const f of g.fixtures.filter((x) => x.id === "GF3" || x.id === "GF5")) {
      for (const d of f.documents) if (VALIDATORS[d.schema]) expect(`${d.id}:${JSON.stringify(VALIDATORS[d.schema]!(d.instance))}`).toBe(`${d.id}:{"ok":true}`);
      for (const r of f.refusals.filter((x) => x.level === "semantic")) {
        const v = VALIDATORS[r.schema]!(r.instance);
        expect(`${r.id}:${v.ok}`).toBe(`${r.id}:false`);
        expect(v.errors!.join("|")).toContain(r.expected_error);
        refused++;
      }
    }
    expect(refused).toBe(11);
  });
});

// ── AT28 ─────────────────────────────────────────────────────────────────────

describe("AT28 · project completeness", () => {
  it("totals include record 501; same local run id in two sources stays distinct; repeated attachment counts once", () => {
    at28Sources();
    const before = tree(base);
    const snap = open();
    const out = series(snap, "M07.output_tokens");
    expect(pt(out)).toMatchObject({ value: 10, exact_total: 10, coverage: { eligible: 502, covered: 502, state: "complete" } });
    const perSource = series(snap, "M07.output_tokens", { group_by: "source" });
    expect(pt(perSource, "source-a")).toMatchObject({ value: 7, coverage: { eligible: 501 } });
    expect(pt(perSource, "source-b").value).toBe(3);
    // Cross-source totals reconcile with the same snapshot and filter.
    expect(perSource.points.reduce((a, p) => a + p.value!, 0)).toBe(pt(out).value!);
    expect(perSource.query.snapshot).toEqual(out.query.snapshot);
    expect(pt(series(snap, "M01.run_count"))).toMatchObject({ value: 2, exact_total: 2 });
    expect(pt(series(snap, "M12.duplicate_count", { grain: "run" }))).toMatchObject({ value: 1, coverage: { eligible: 3 } });
    // Shared goal: the union of contributing runs, each once; initiative membership does not add a copy.
    expect(pt(series(snap, "M01.run_count", { filters: [{ dimension: "goal", values: ["goal-1"] }] })).value).toBe(2);
    expect(pt(series(snap, "M01.run_count", { filters: [{ dimension: "initiative", values: ["initiative-1"] }] })).value).toBe(1);
    expect(pt(series(snap, "M07.output_tokens", { filters: [{ dimension: "goal", values: ["goal-1"] }, { dimension: "initiative", values: ["initiative-1"] }] })).value).toBe(7);
    expect(pt(series(snap, "M01.goal_count")).value).toBe(2);
    expect(tree(base)).toEqual(before);
  });

  it("negative controls: a first-50 preview and bare-id collapse disagree with the engine", () => {
    at28Sources();
    const snap = open();
    const preview = fs.readFileSync(path.join(rootOf("source-a"), ".guild/runs/run-1/trace.jsonl"), "utf8").trim().split("\n").slice(0, 50).map((l) => JSON.parse(l) as TraceAnalysisV3);
    const previewOutput = preview.reduce((a, e) => a + (e.usage?.output ?? 0), 0);
    const engine = pt(series(snap, "M07.output_tokens", { group_by: "source" }), "source-a").value;
    expect(previewOutput).toBe(0);
    expect(engine).toBe(7);
    const bare = new Set(snap.facts.sources.flatMap((s) => s.runs.map((r) => r.run_id))).size;
    expect(bare).toBe(1);
    expect(pt(series(snap, "M01.run_count")).value).toBe(2);
  });

  it("drilldown pages every retained record once in stable order", () => {
    at28Sources();
    const snap = open();
    const s = series(snap, "M07.output_tokens", { group_by: "source" });
    const p = pt(s, "source-a");
    expect(p.evidence).toHaveLength(100);
    expect(p.drilldown.cursor).not.toBeNull();
    const page = (cursor: string | null) => readMetricDrilldown(snap, readRequest(s.query, "metric_drilldown", { request_id: "q-2", session_id: "s-1", cursor, limit: 500 }), { group_by: "source", point_key: cursor ? undefined : "source-a" }) as MetricDrilldownV2;
    const p1 = page(p.drilldown.cursor);
    expect(validateMetricDrilldownV2(p1)).toEqual({ ok: true });
    expect(p1.records).toHaveLength(500);
    expect(p1.next_cursor).not.toBeNull();
    const p2 = page(p1.next_cursor);
    expect(p2.records).toHaveLength(1);
    expect(p2.next_cursor).toBeNull();
    const all = [...p1.records, ...p2.records].map((r) => r.sha256);
    expect(new Set(all).size).toBe(501);
    expect(p1.coverage).toEqual(p.coverage);
    expect(p1.query_hash).toBe(queryHash(s.query));
    // The same request without a cursor starts at the same first page.
    expect(page(null).records).toEqual(p1.records);
  });
});

// ── AT29 ─────────────────────────────────────────────────────────────────────

describe("AT29 · query snapshot", () => {
  it("a source change between pages is a stale-cursor refusal; an unchanged re-read serves the same page", () => {
    at28Sources();
    const snap = open();
    const s = series(snap, "M07.output_tokens", { group_by: "source" });
    const req = (sn: ProjectSnapshot, cursor: string | null) => readMetricDrilldown(sn, readRequest(s.query, "metric_drilldown", { request_id: "q-3", session_id: "s-1", cursor, limit: 500 }), { group_by: "source" });
    const p1 = req(snap, pt(s, "source-a").drilldown.cursor) as MetricDrilldownV2;
    const same = open();
    expect(same.facts.snapshot).toEqual(snap.facts.snapshot);
    expect((req(same, p1.next_cursor) as MetricDrilldownV2).records).toHaveLength(1);
    fs.appendFileSync(path.join(rootOf("source-b"), ".guild/runs/run-1/trace.jsonl"), JSON.stringify(ev("source-b", "run-1", 2, use("req-2", 1, 1))) + "\n");
    const changed = open();
    expect(changed.facts.snapshot.input_manifest_digest).not.toBe(snap.facts.snapshot.input_manifest_digest);
    const r = req(changed, p1.next_cursor) as RefusalV2;
    expect(r).toMatchObject({ schema_version: "guild.stack.refusal.v2", code: "stale_cursor", retryable: true, expected_snapshot: snap.facts.snapshot.input_manifest_digest, observed_snapshot: changed.facts.snapshot.input_manifest_digest });
    // A series request against the old snapshot is a stale-source refusal, never a mixed answer.
    const old = readMetricSeries(changed, readRequest(s.query, "metric_series", { request_id: "q-4", session_id: "s-1" })) as RefusalV2;
    expect(old.code).toBe("stale_source");
    // Negative control: a cursor forged onto the new snapshot digest still names the old query.
    const forged = readMetricDrilldown(changed, readRequest(projectQuery(changed, { metric_id: "M07.output_tokens" }), "metric_drilldown", { request_id: "q-5", session_id: "s-1", cursor: p1.next_cursor, limit: 500 }), { group_by: "source" }) as RefusalV2;
    expect(forged.code).toBe("invalid_request");
  });

  it("an offline source stays in the snapshot and the denominator; omitting it is detectable", () => {
    at28Sources();
    const sources = [...SOURCES(), { source_id: "source-c", root: path.join(base, "gone") }];
    const snap = open(sources);
    expect(snap.facts.snapshot.source_ids).toEqual(["source-a", "source-b", "source-c"]);
    expect(snap.diagnostics.find((d) => d.source_id === "source-c")).toMatchObject({ state: "unavailable", reason: "source root is offline or unreadable" });
    const out = series(snap, "M07.output_tokens");
    expect(pt(out)).toMatchObject({ value: 10, known_subtotal: 10, exact_total: null, coverage: { eligible: null, missing: null, state: "partial" } });
    expect(pt(out).coverage.reason).toContain("source-c");
    expect(pt(series(snap, "M01.run_count"))).toMatchObject({ value: 2, exact_total: null, coverage: { state: "partial" } });
    const perSource = series(snap, "M07.output_tokens", { group_by: "source" });
    expect(pt(perSource, "source-c")).toMatchObject({ value: null, coverage: { state: "unavailable" } });
    // Points of the readable sources stay exact: the offline one is unknown only where it could contribute.
    expect(pt(perSource, "source-a")).toMatchObject({ value: 7, exact_total: 7, coverage: { state: "complete" } });
    // Negative control: a snapshot that silently drops source-c claims a complete total and is a different snapshot.
    const dropped = open(SOURCES());
    expect(pt(series(dropped, "M07.output_tokens")).coverage.state).toBe("complete");
    expect(dropped.facts.snapshot.input_manifest_digest).not.toBe(snap.facts.snapshot.input_manifest_digest);
    const q = projectQuery(dropped, { metric_id: "M07.output_tokens" });
    expect((readMetricSeries(snap, readRequest(q, "metric_series", { request_id: "q-6", session_id: "s-1" })) as RefusalV2).code).toBe("stale_source");
    // The source coming back online is a new generation.
    fs.mkdirSync(path.join(base, "gone"));
    expect(open(sources).facts.snapshot.input_manifest_digest).not.toBe(snap.facts.snapshot.input_manifest_digest);
  });

  it("malformed and unsupported artifacts keep the total partial with diagnostics", () => {
    at28Sources();
    fs.appendFileSync(path.join(rootOf("source-b"), ".guild/runs/run-1/trace.jsonl"), "{not json\n");
    put("source-b", "runs/run-old/logs/v1.4-events.jsonl", `{"event":"llm_call","tokens":{"input":1,"output":1}}\n`);
    fs.mkdirSync(path.join(rootOf("source-a"), ".guild/runs/run-link"), { recursive: true });
    fs.symlinkSync(path.join(rootOf("source-a"), ".guild/runs/run-1/trace.jsonl"), path.join(rootOf("source-a"), ".guild/runs/run-link/trace.jsonl"));
    const snap = open();
    const out = series(snap, "M07.output_tokens");
    expect(pt(out)).toMatchObject({ value: 10, exact_total: null, coverage: { eligible: null, state: "partial" } });
    expect(pt(out).coverage.reason).toContain("run-old");
    expect(pt(out).coverage.reason).toContain("run-link");
    expect(pt(series(snap, "M01.run_count")).value).toBe(4);
    const inv = series(snap, "M12.invalid_count", { filters: [{ dimension: "run", values: ["run-1"] }], group_by: "source" });
    expect(pt(inv, "source-b")).toMatchObject({ value: 1, exact_total: 1 });
    expect(pt(inv, "source-a").value).toBe(0);
    // run-old has no normalized trace, so its invalid events are unknown.
    expect(pt(series(snap, "M12.invalid_count", { group_by: "source" }), "source-b")).toMatchObject({ value: null, coverage: { state: "unavailable" } });
    const b = snap.diagnostics.find((d) => d.source_id === "source-b")!;
    expect(b).toMatchObject({ runs: 2, runs_without_trace: 1, invalid_events: 1 });
    // A foreign-source record inside a trace is not this source's evidence.
    put("source-b", "runs/run-2/trace.jsonl", jsonl([ev("source-a", "run-2", 1, use("req-x", 1, 100))]));
    const s2 = open();
    expect(pt(series(s2, "M07.output_tokens", { group_by: "source" }), "source-b").value).toBe(3);
  });

  it("zero denominators are null with a reason, never zero or NaN", () => {
    put("source-a", "runs/run-1/trace.jsonl", jsonl([ev("source-a", "run-1", 1, use("req-1", 0, 0))]));
    put("source-b", "runs/run-1/trace.jsonl", jsonl([ev("source-b", "run-1", 1, use("req-1", 0, 0))]));
    const snap = open();
    expect(pt(series(snap, "M08.cache_hit_ratio"))).toMatchObject({ value: null, numerator: 0, denominator: 0, reason: "zero_inclusive_input", coverage: { state: "complete" } });
    const empty = openProjectSnapshot([{ source_id: "source-z", root: path.join(base, "empty") }], { as_of: AS_OF });
    fs.mkdirSync(path.join(base, "empty"));
    const e = openProjectSnapshot([{ source_id: "source-z", root: path.join(base, "empty") }], { as_of: AS_OF });
    expect(empty.facts.snapshot.input_manifest_digest).not.toBe(e.facts.snapshot.input_manifest_digest);
    expect(pt(series(e, "M12.coverage_ratio"))).toMatchObject({ value: null, denominator: 0, reason: "no eligible requests" });
    // An empty but readable project is a known zero.
    expect(pt(series(e, "M01.run_count"))).toMatchObject({ value: 0, exact_total: 0, coverage: { state: "complete" } });
  });

  it("records without usage still name their executions and tasks; record-level filters decide run membership", () => {
    const dispatch = { ...ev("source-a", "run-1", 1, use("req-1", 1, 1), { task: "task-d" }), event_class: "dispatch" as const, usage: null };
    dispatch.lineage = { ...dispatch.lineage, execution_id: "exec-d", request_id: null };
    put("source-a", "runs/run-1/trace.jsonl", jsonl([dispatch]));
    put("source-b", "runs/run-1/trace.jsonl", jsonl([ev("source-b", "run-1", 1, use("req-1", 2, 3), { task: "task-b" })]));
    put("source-b", "runs/run-old/logs/v1.4-events.jsonl", `{"event":"llm_call"}\n`);
    const snap = open();
    expect(pt(series(snap, "M01.execution_count", { group_by: "source" }), "source-a")).toMatchObject({ value: 1, exact_total: 1 });
    expect(pt(series(snap, "M01.task_count", { group_by: "source" }), "source-a")).toMatchObject({ value: 1, exact_total: 1 });
    // A task that no record names selects no run; a run without a trace is unknown, not counted.
    const none = pt(series(snap, "M01.run_count", { filters: [{ dimension: "task", values: ["task-none"] }] }));
    expect(none).toMatchObject({ value: null, exact_total: null, coverage: { state: "unavailable", covered: 0, eligible: null } });
    expect(none.coverage.reason).toContain("source-b:run-old");
    expect(pt(series(snap, "M01.run_count", { filters: [{ dimension: "task", values: ["task-d"] }] }))).toMatchObject({ value: 1, exact_total: null });
    // Goal and initiative membership come from records too: a trace-less run is unknown under them.
    const byGoal = pt(series(snap, "M01.run_count", { filters: [{ dimension: "goal", values: ["goal-none"] }] }));
    expect(byGoal).toMatchObject({ value: null, coverage: { state: "unavailable", eligible: null } });
    expect(byGoal.coverage.reason).toContain("source-b:run-old");
    // Its suppressed repeats are unknown as well.
    const dup = pt(series(snap, "M12.duplicate_count", { grain: "request" }));
    expect(dup).toMatchObject({ value: 0, exact_total: null, coverage: { state: "partial", covered: 2, eligible: 3 } });
    expect(pt(series(snap, "M12.duplicate_count", { grain: "run" }))).toMatchObject({ exact_total: null, coverage: { eligible: null } });
    fs.rmSync(path.join(rootOf("source-b"), ".guild/runs/run-old"), { recursive: true });
    const clean = open();
    expect(pt(series(clean, "M01.run_count", { filters: [{ dimension: "goal", values: ["goal-none"] }] }))).toMatchObject({ value: 0, exact_total: 0, coverage: { state: "complete" } });
    expect(pt(series(clean, "M12.duplicate_count", { grain: "request" }))).toMatchObject({ value: 0, exact_total: 0 });
    expect(pt(series(clean, "M01.run_count", { filters: [{ dimension: "task", values: ["task-none"] }] }))).toMatchObject({ value: 0, exact_total: 0, coverage: { state: "complete" } });
    expect(pt(series(clean, "M01.run_count", { filters: [{ dimension: "task", values: ["task-b"] }] }))).toMatchObject({ value: 1, exact_total: 1 });
  });

  it("ids containing ':' never merge two runs into one point", () => {
    put("a", "runs/c/trace.jsonl", jsonl([ev("a", "c", 1, use("req-1", 1, 1))]));
    put("a:b", "runs/c/trace.jsonl", jsonl([ev("a:b", "c", 1, use("req-1", 1, 1))]));
    const snap = openProjectSnapshot([{ source_id: "a", root: rootOf("a") }, { source_id: "a:b", root: rootOf("a:b") }], { as_of: AS_OF });
    expect(pt(series(snap, "M01.run_count")).value).toBe(2);
    // Engine facts where ("a", "b:c") and ("a:b", "c") would both key as "a:b:c".
    const facts: FactSet = JSON.parse(JSON.stringify(snap.facts));
    facts.sources.find((x) => x.source_id === "a")!.runs[0]!.run_id = "b:c";
    const q = projectQuery(snap, { metric_id: "M01.run_count" });
    expect(() => computeMetricSeries(facts, q, { group_by: "run" })).toThrow(/would merge distinct identities/);
    expect(pt(computeMetricSeries(facts, q).series).value).toBe(2);
    // The reader cannot name a run directory with ':' in a contract path: the enumeration is unknown, not short.
    fs.mkdirSync(path.join(rootOf("a"), ".guild/runs/b:c"));
    const withColon = openProjectSnapshot([{ source_id: "a", root: rootOf("a") }], { as_of: AS_OF });
    expect(pt(series(withColon, "M01.run_count"))).toMatchObject({ value: 1, exact_total: null, coverage: { state: "partial" } });
    expect(withColon.diagnostics[0]!.run_errors).toEqual([{ run_id: "b:c", reason: "run directory name is not a contract path segment" }]);
  });

  it("request and cursor binding: unbound hash, altered cursor and wrong operation refuse", () => {
    at28Sources();
    const snap = open();
    const q = projectQuery(snap, { metric_id: "M07.output_tokens" });
    const good = readRequest(q, "metric_series", { request_id: "q-7", session_id: "s-1" });
    expect(validateReadRequestV2(good)).toEqual({ ok: true });
    expect((readMetricSeries(snap, { ...good, query_hash: H }) as RefusalV2).code).toBe("unsupported_schema");
    expect((readMetricSeries(snap, { ...good, operation: "metric_drilldown" }) as RefusalV2).code).toBe("unsupported_schema");
    const s = readMetricSeries(snap, good) as MetricSeriesV2;
    const cursor = pt(s).drilldown.cursor!;
    const flipped = cursor.slice(0, -1) + (cursor.endsWith("0") ? "1" : "0");
    const dd = readRequest(q, "metric_drilldown", { request_id: "q-8", session_id: "s-1", cursor: flipped });
    expect((readMetricDrilldown(snap, dd) as RefusalV2).code).toBe("invalid_request");
    // A relabelled version pin with a recomputed hash is not the query this service computes.
    const relabelled = { ...q, versions: { ...q.versions, pricing: "p2@sha256:0" } };
    expect((readMetricSeries(snap, readRequest(relabelled, "metric_series", { request_id: "q-10", session_id: "s-1" })) as RefusalV2).code).toBe("unsupported_capability");
    const recohort = { ...q, cohort_hash: H };
    expect((readMetricSeries(snap, readRequest(recohort, "metric_series", { request_id: "q-11", session_id: "s-1" })) as RefusalV2).code).toBe("unsupported_capability");
    // A cursor cut under one grouping cannot page another grouping's point of the same name.
    const allCursor = pt(s).drilldown.cursor!;
    const regroup = readMetricDrilldown(snap, readRequest(q, "metric_drilldown", { request_id: "q-12", session_id: "s-1", cursor: allCursor }), { group_by: "source" }) as RefusalV2;
    expect(regroup.code).toBe("invalid_request");
    // A cursor re-signed with a public checksum (no service key) is refused.
    const bodyOf = (c: string) => JSON.parse(Buffer.from(c.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    const forgedBody = JSON.stringify(Object.fromEntries(Object.entries({ ...bodyOf(allCursor), o: 1 }).sort(([a], [b]) => (a < b ? -1 : 1))));
    const forged = `c9v2.${Buffer.from(forgedBody).toString("base64url")}.${crypto.createHash("sha256").update(forgedBody).digest("hex").slice(0, 16)}`;
    expect((readMetricDrilldown(snap, readRequest(q, "metric_drilldown", { request_id: "q-13", session_id: "s-1", cursor: forged })) as RefusalV2).code).toBe("invalid_request");
    // A cursor from another service key (another process) is refused, not served.
    const other = openProjectSnapshot(SOURCES(), { as_of: AS_OF, pricing: P1, cursor_key: Buffer.alloc(32, 7) });
    expect((readMetricDrilldown(other, readRequest(q, "metric_drilldown", { request_id: "q-14", session_id: "s-1", cursor: allCursor })) as RefusalV2).code).toBe("invalid_request");
    // A filter dimension the service cannot answer refuses rather than being ignored.
    expect(() => projectQuery(snap, { metric_id: "M07.output_tokens", filters: [{ dimension: "host", values: ["h"] }] })).toThrow(/not served/);
  });

  it("GF5: query hashes match the frozen digests and the coordinated snapshot oracles hold", () => {
    const g = golden();
    if (!g) return;
    const gf5 = g.fixtures.find((f) => f.id === "GF5")!;
    const doc = (id: string) => gf5.documents.find((d) => d.id === id)!.instance;
    for (const id of ["run-count", "duplicates", "output-tokens"]) expect(queryHash(doc(id).query)).toBe(doc(id).points[0].drilldown.query_hash);
    expect(queryHash(doc("drilldown-request").query)).toBe(doc("drilldown-request").query_hash);
    for (const b of gf5.bindings) expect(`${b.id}=${JSON.stringify(at(doc(b.document), b.pointer))}`).toBe(`${b.id}=${JSON.stringify(b.expected)}`);
    // The engine reproduces the GF5 counts on equivalent on-disk sources.
    at28Sources();
    const snap = open();
    expect(pt(series(snap, "M07.output_tokens", { group_by: "source" }), "source-a")).toMatchObject({ value: gf5.inputs.records.record501_output_tokens, coverage: { eligible: gf5.inputs.records.count } });
    expect(pt(series(snap, "M01.run_count")).value).toBe(doc("run-count").points[0].value);
    expect(pt(series(snap, "M12.duplicate_count", { grain: "run" })).value).toBe(doc("duplicates").points[0].value);
  });
});
