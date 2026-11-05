/**
 * src/domains/telemetry/project-read-v2.ts — T04 complete project read service.
 *
 * Reads every retained run of every requested source (a `.guild/` root) into
 * source-qualified facts, binds them to one immutable snapshot, and serves C9
 * metric series and paged evidence drilldown through `guild.stack.read-request.v2`.
 *
 * - Complete: every trace record of every run is read through T01/T02, never a
 *   bounded analysis preview; run identity is (source, run).
 * - Snapshot: each source's generation hashes its runs' retained input manifests;
 *   the snapshot digest hashes the generations. An unavailable source stays in
 *   the snapshot with its own generation, so it cannot drop out of a denominator.
 * - Cursor: binds query hash, snapshot digest, metric and point. Any page read
 *   against a different snapshot is a `stale_cursor` refusal, never a mixed page.
 *
 * Read-only: it writes no cache into the sources it reads.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { durableGuildDir } from "../state";
import { inputManifestDigest, readRunInputs, RUN_ANALYSIS_V2_VERSIONS } from "./run-analysis-v2";
import { RUN_LEDGER_VERSIONS, normalizeRunLedger, type PriceTable } from "./run-ledger-v2";
import { TRACE_ID_RE, compareTraceInstants, isRfc3339, type TraceAnalysisV3 } from "./trace-analysis-v3";
import {
  METRIC_DRILLDOWN_V2_SCHEMA,
  METRIC_SERIES_V2_SCHEMA,
  METRIC_SERIES_V2_VERSIONS,
  RESULT_SCHEMA_IDS,
  SeriesRefusal,
  canonicalJson,
  computeMetricSeries,
  metricOfQuery,
  pinQuery,
  queryHash,
  refusal,
  seriesUsageSemantics,
  sha256,
  validateReadRequestV2,
  type Evidence,
  type FactSet,
  type GroupBy,
  type MetricDrilldownV2,
  type MetricSeriesV2,
  type ObservationFact,
  type QueryFilter,
  type QueryIdentity,
  type ReadRequestV2,
  type RefusalV2,
  type RunFacts,
  type Snapshot,
  type SourceFacts,
  type UsageFact,
  type WindowBasis,
} from "./metric-series-v2";

export const PROJECT_READ_LIMITS = Object.freeze({ sources: 100, runs_per_source: 10000, page: 1000 });
const TRACE_SCHEMA = "guild.trace.analysis.v3";

export interface ProjectSource { source_id: string; root: string }
export interface SourceDiagnostics {
  source_id: string; state: "available" | "unavailable"; reason: string | null;
  runs: number; runs_without_trace: number; invalid_events: number; pending_requests: number | null; duplicates: number;
  run_errors: { run_id: string; reason: string }[];
}
export interface ProjectSnapshot { facts: FactSet; diagnostics: SourceDiagnostics[]; pricing: PriceTable | null; cursor_key: Buffer }

/**
 * Cursors are MAC'd with a service key, so a client cannot mint an offset or point.
 * The default key lives for this process; a service that pages across processes passes its own.
 */
const PROCESS_CURSOR_KEY = crypto.randomBytes(32);

// ── Reading ──────────────────────────────────────────────────────────────────

function runEvidence(sourceId: string, runId: string, inputs: ReturnType<typeof readRunInputs>, asOf: string): Evidence {
  const trace = inputs.evidence.find((e) => e.path === `runs/${runId}/trace.jsonl`);
  if (trace) return trace;
  const any = [...inputs.evidence].sort((a, b) => (a.path < b.path ? -1 : 1))[0];
  return any ?? { source_id: sourceId, path: `runs/${runId}`, sha256: sha256(""), schema_version: "guild.run_dir.v1", observed_at: asOf, availability: "missing", reason: "run directory holds no retained trace input" };
}

function readRun(root: string, sourceId: string, runId: string, asOf: string, pricing: PriceTable | null): { run: RunFacts; generation: string; pending: number | null; duplicates: number; invalid: number } {
  const inputs = readRunInputs(root, sourceId, runId, asOf);
  const generation = inputManifestDigest(inputs.evidence);
  const evidence = runEvidence(sourceId, runId, inputs, asOf);
  if (!inputs.traceUsable || !inputs.trace) {
    return {
      run: { source_id: sourceId, run_id: runId, evidence, usage_state: "unavailable", usage_reason: evidence.reason ?? "no normalized trace", extra_missing: null, invalid_count: null, duplicate_count: 0, attachments: [], leaves: [], observations: [], trace_complete: false },
      generation, pending: null, duplicates: 0, invalid: 0,
    };
  }
  const late = inputs.trace.events.find((e) => compareTraceInstants(e.at, asOf) >= 0);
  if (late) throw new SeriesRefusal("stale_source", `as_of ${asOf} precedes retained trace event ${late.event_id} of ${sourceId}:${runId}`, true);
  // Records naming another source are not this source's evidence.
  const events = inputs.trace.events.filter((e) => e.lineage.source_id === sourceId);
  const foreign = inputs.trace.events.length - events.length;
  const ledger = normalizeRunLedger({ source_id: sourceId, run_id: runId, events, capture: inputs.trace.coverage, spans: [], pricing, budget: null, as_of: null });
  const recordEvidence = (e: TraceAnalysisV3): Evidence => ({ source_id: sourceId, path: `runs/${runId}/trace.jsonl`, sha256: sha256(canonicalJson(e)), schema_version: TRACE_SCHEMA, observed_at: e.at, availability: "available", reason: null });
  const observations: ObservationFact[] = events.map((e) => ({
    at: e.at, execution_id: e.lineage.execution_id, logical_task_id: e.lineage.logical_task_id, attempt_id: e.lineage.attempt_id, agent_instance_id: e.lineage.agent_instance_id,
    requested_model: e.requested_model, observed_model: e.observed_identity.status === "observed" ? e.observed_identity.model : null, evidence: recordEvidence(e),
  }));
  const byObservation = new Map<string, TraceAnalysisV3>();
  for (const e of events) if (e.usage) byObservation.set(`${e.usage.accounting_identity}\u0000${e.usage.observation_id}\u0000${e.usage.revision}`, e);
  const attachments = new Map<string, { kind: "initiative" | "goal"; id: string }>();
  for (const e of events) {
    if (e.lineage.initiative_id) attachments.set(`initiative\u0000${e.lineage.initiative_id}`, { kind: "initiative", id: e.lineage.initiative_id });
    if (e.lineage.goal_id) attachments.set(`goal\u0000${e.lineage.goal_id}`, { kind: "goal", id: e.lineage.goal_id });
  }
  const leaves: UsageFact[] = ledger.leaves.map((leaf) => {
    const u = leaf.normalized_usage;
    const ev = leaf.usage ? byObservation.get(`${leaf.usage.accounting_identity}\u0000${leaf.usage.observation_id}\u0000${leaf.usage.revision}`) : undefined;
    // The ledger's field rule: a counter is known when the leaf is covered, or reports it with known semantics.
    const known = (k: "input_inclusive" | "output" | "cache_read_subset" | "cache_write_subset" | "total") =>
      leaf.covered || (leaf.usage !== null && u[k] !== null && u.usage_semantics !== "unknown") ? u[k] : null;
    return {
      accounting_identity: leaf.accounting_identity, at: ev?.at ?? null,
      execution_id: leaf.execution_id, logical_task_id: leaf.logical_task_id, attempt_id: leaf.attempt_id, agent_instance_id: leaf.agent_instance_id,
      requested_model: leaf.requested_model, observed_model: leaf.observed_identity.status === "observed" ? leaf.observed_identity.model : null,
      input: known("input_inclusive"), output: known("output"), cache_read: known("cache_read_subset"), cache_write: known("cache_write_subset"), total: known("total"),
      measured_usd: leaf.measured_usd, derived_usd: leaf.derived_estimate_usd, covered: leaf.covered, allocated: leaf.allocation === "allocated",
      usage_semantics: u.usage_semantics,
      evidence: ev
        ? recordEvidence(ev)
        : { ...evidence, reason: evidence.reason ?? `leaf ${leaf.accounting_identity} has no selected observation` },
    };
  });
  const pending = ledger.coverage.requests.eligible === null ? null : ledger.coverage.pending_requests.length;
  return {
    run: {
      source_id: sourceId, run_id: runId, evidence, usage_state: "available", usage_reason: null,
      extra_missing: pending === null || foreign > 0 ? null : pending,
      invalid_count: ledger.coverage.invalid_events + inputs.trace.invalid_lines + foreign,
      duplicate_count: ledger.coverage.duplicates,
      attachments: [...attachments.values()].sort((a, b) => (a.kind + a.id < b.kind + b.id ? -1 : 1)),
      leaves, observations,
      trace_complete: inputs.trace.coverage.state === "complete" && inputs.trace.invalid_lines === 0 && foreign === 0,
    },
    generation, pending, duplicates: ledger.coverage.duplicates, invalid: ledger.coverage.invalid_events + inputs.trace.invalid_lines + foreign,
  };
}

function unavailableSource(s: ProjectSource, reason: string): { facts: SourceFacts; diag: SourceDiagnostics } {
  return {
    facts: { source_id: s.source_id, generation: sha256(canonicalJson({ source_id: s.source_id, state: "unavailable", reason })), state: "unavailable", reason, runs: [], unenumerated_runs: 0, outcomes: "not_collected", tasks: [] },
    diag: { source_id: s.source_id, state: "unavailable", reason, runs: 0, runs_without_trace: 0, invalid_events: 0, pending_requests: null, duplicates: 0, run_errors: [] },
  };
}

function readSource(s: ProjectSource, asOf: string, pricing: PriceTable | null): { facts: SourceFacts; diag: SourceDiagnostics } {
  let st: fs.Stats;
  try { st = fs.statSync(s.root); } catch { return unavailableSource(s, "source root is offline or unreadable"); }
  if (!st.isDirectory()) return unavailableSource(s, "source root is not a directory");
  const runsDir = path.join(durableGuildDir(s.root), "runs");
  let names: string[];
  try {
    const l = fs.lstatSync(runsDir);
    if (!l.isDirectory()) return unavailableSource(s, ".guild/runs is not a directory");
    names = fs.readdirSync(runsDir).filter((n) => TRACE_ID_RE.test(n)).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return unavailableSource(s, ".guild/runs is unreadable");
    names = [];
  }
  const dirs = names.filter((n) => { try { return fs.lstatSync(path.join(runsDir, n)).isDirectory(); } catch { return false; } });
  // A ':' cannot appear in a contract evidence path, so such a directory is a run the service cannot name.
  const unsupported = dirs.filter((n) => n.includes(":"));
  const runDirs = dirs.filter((n) => !n.includes(":"));
  if (runDirs.length > PROJECT_READ_LIMITS.runs_per_source) return unavailableSource(s, `more than ${PROJECT_READ_LIMITS.runs_per_source} runs; enumeration bound exceeded`);
  const runs: RunFacts[] = [];
  const gens: { run_id: string; generation: string }[] = [];
  const diag: SourceDiagnostics = { source_id: s.source_id, state: "available", reason: null, runs: 0, runs_without_trace: 0, invalid_events: 0, pending_requests: 0, duplicates: 0, run_errors: [] };
  for (const runId of runDirs) {
    let r: ReturnType<typeof readRun>;
    try { r = readRun(s.root, s.source_id, runId, asOf, pricing); } catch (err) {
      if (err instanceof SeriesRefusal) throw err;
      // An unreadable run is a known run with unknown facts.
      const reason = (err as Error).message.slice(0, 400);
      diag.run_errors.push({ run_id: runId, reason });
      const evidence: Evidence = { source_id: s.source_id, path: `runs/${runId}`, sha256: sha256(""), schema_version: "guild.run_dir.v1", observed_at: asOf, availability: "missing", reason };
      runs.push({ source_id: s.source_id, run_id: runId, evidence, usage_state: "unavailable", usage_reason: reason, extra_missing: null, invalid_count: null, duplicate_count: 0, attachments: [], leaves: [], observations: [], trace_complete: false });
      gens.push({ run_id: runId, generation: sha256(canonicalJson({ run_id: runId, error: reason })) });
      continue;
    }
    runs.push(r.run);
    gens.push({ run_id: runId, generation: r.generation });
    diag.runs++;
    if (r.run.usage_state !== "available") diag.runs_without_trace++;
    diag.invalid_events += r.invalid;
    diag.duplicates += r.duplicates;
    diag.pending_requests = diag.pending_requests === null || r.pending === null ? (r.run.usage_state === "available" ? null : diag.pending_requests) : diag.pending_requests + r.pending;
  }
  for (const n of unsupported) diag.run_errors.push({ run_id: n, reason: "run directory name is not a contract path segment" });
  const generation = sha256(canonicalJson({ source_id: s.source_id, runs: gens, unsupported }));
  return { facts: { source_id: s.source_id, generation, state: "available", reason: null, runs, unenumerated_runs: unsupported.length, outcomes: "not_collected", tasks: [] }, diag };
}

/** Read every requested source into one immutable snapshot of facts. */
export function openProjectSnapshot(sources: readonly ProjectSource[], opts: { as_of: string; pricing?: PriceTable | null; cursor_key?: Buffer }): ProjectSnapshot {
  if (opts.cursor_key !== undefined && opts.cursor_key.length < 32) throw new Error("cursor_key needs at least 32 bytes");
  if (!isRfc3339(opts.as_of)) throw new Error("as_of must be an RFC 3339 instant");
  if (sources.length < 1 || sources.length > PROJECT_READ_LIMITS.sources) throw new Error(`a snapshot reads 1 to ${PROJECT_READ_LIMITS.sources} sources`);
  const ids = sources.map((s) => s.source_id);
  for (const id of ids) if (!TRACE_ID_RE.test(id)) throw new Error(`unsafe source id: ${id}`);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate source id");
  const pricing = opts.pricing ?? null;
  const read = [...sources].sort((a, b) => (a.source_id < b.source_id ? -1 : 1)).map((s) => readSource(s, opts.as_of, pricing));
  const source_generations = read.map((r) => ({ source_id: r.facts.source_id, generation: r.facts.generation }));
  const snapshot: Snapshot = {
    input_manifest_digest: sha256(canonicalJson(source_generations)),
    source_ids: source_generations.map((g) => g.source_id), source_generations, as_of: opts.as_of,
  };
  return {
    facts: { snapshot, sources: read.map((r) => r.facts), pricing: pricing ? { version: pricing.version, currency: pricing.currency, source_hash: pricing.source_hash } : null },
    diagnostics: read.map((r) => r.diag), pricing, cursor_key: opts.cursor_key ?? PROCESS_CURSOR_KEY,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────────

const SNAPSHOT_FROM = "1970-01-01T00:00:00Z";
export interface ProjectQuerySpec {
  metric_id: string; underlying_metric_id?: string | null; grain?: QueryIdentity["grain"]; filters?: QueryFilter[];
  window?: { from: string; to: string; basis: WindowBasis };
}

/** The pinned C9 query identity for one metric over a snapshot. */
export function projectQuery(snap: ProjectSnapshot, spec: ProjectQuerySpec): QueryIdentity {
  const pricing = snap.pricing ? `${snap.pricing.version}@${sha256(canonicalJson(snap.pricing))}` : "unpriced";
  const window = { ...(spec.window ?? { from: SNAPSHOT_FROM, to: snap.facts.snapshot.as_of, basis: "as_of_snapshot" as const }), timezone: "UTC" };
  const filters = (spec.filters ?? []).map((f) => ({ dimension: f.dimension, values: [...f.values].sort() })).sort((a, b) => (a.dimension < b.dimension ? -1 : 1));
  const grain = spec.grain ?? "run";
  const base = {
    schema_version: METRIC_SERIES_V2_SCHEMA,
    versions: { schema: METRIC_SERIES_V2_SCHEMA, analyzer: RUN_ANALYSIS_V2_VERSIONS.analyzer, normalizer: RUN_LEDGER_VERSIONS.normalizer, pricing, aggregation: METRIC_SERIES_V2_VERSIONS.aggregation },
    snapshot: snap.facts.snapshot, grain, filters, window,
    cohort_hash: sha256(canonicalJson({ grain, filters, window })),
  };
  const draft = pinQuery(base, spec.metric_id, "unknown", spec.underlying_metric_id ?? null);
  return pinQuery(base, spec.metric_id, seriesUsageSemantics(snap.facts, draft, spec.metric_id, spec.underlying_metric_id ?? null), spec.underlying_metric_id ?? null);
}

/** A read request bound to a query (its hash is the query's C9 digest). */
export function readRequest(q: QueryIdentity, op: "metric_series" | "metric_drilldown", o: { request_id: string; session_id: string; cursor?: string | null; limit?: number }): ReadRequestV2 {
  return {
    schema_version: "guild.stack.read-request.v2", request_id: o.request_id, session_id: o.session_id, operation: op,
    result_schema_id: RESULT_SCHEMA_IDS[op], query: q, cursor: o.cursor ?? null, limit: o.limit ?? PROJECT_READ_LIMITS.page, query_hash: queryHash(q),
  };
}

// ── Cursor ───────────────────────────────────────────────────────────────────

/** The query hash binds the snapshot, so a cursor cannot outlive the generations it was cut from. */
interface CursorBody { v: 1; q: string; m: string; g: GroupBy; p: string; o: number }
const CURSOR_PREFIX = "c9v2.";

const mac = (key: Buffer, body: string) => crypto.createHmac("sha256", key).update(body).digest("base64url");

export function encodeCursor(key: Buffer, b: Omit<CursorBody, "v">): string {
  const body = canonicalJson({ v: 1, ...b });
  return `${CURSOR_PREFIX}${Buffer.from(body).toString("base64url")}.${mac(key, body)}`;
}

function decodeCursor(key: Buffer, c: string): CursorBody | null {
  if (!c.startsWith(CURSOR_PREFIX) || c.length > 4096) return null;
  const [b64, tag, ...rest] = c.slice(CURSOR_PREFIX.length).split(".");
  if (!b64 || !tag || rest.length) return null;
  const body = Buffer.from(b64, "base64url").toString("utf8");
  const want = Buffer.from(mac(key, body));
  const got = Buffer.from(tag);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const o = JSON.parse(body) as CursorBody;
    if (canonicalJson(o) !== body || o.v !== 1 || typeof o.q !== "string" || typeof o.g !== "string" || typeof o.m !== "string" || typeof o.p !== "string" || !Number.isInteger(o.o) || o.o < 0) return null;
    return o;
  } catch { return null; }
}

// ── Service ──────────────────────────────────────────────────────────────────

/** The query this service pins for the request's own metric, grain, filters and window. */
function pinnedQuery(snap: ProjectSnapshot, q: QueryIdentity): QueryIdentity {
  const metric = metricOfQuery(q);
  return projectQuery(snap, {
    metric_id: metric.id, underlying_metric_id: q.underlying_scalar?.metric_id ?? null, grain: q.grain, filters: q.filters,
    window: { from: q.window.from, to: q.window.to, basis: q.window.basis },
  });
}

function checkRequest(snap: ProjectSnapshot, req: unknown, op: ReadRequestV2["operation"]): ReadRequestV2 | RefusalV2 {
  const rid = typeof (req as ReadRequestV2)?.request_id === "string" && TRACE_ID_RE.test((req as ReadRequestV2).request_id) ? (req as ReadRequestV2).request_id : "invalid-request";
  const v = validateReadRequestV2(req);
  if (!v.ok) return refusal(rid, v.errors.includes("query hash or requested schema unsupported") ? "unsupported_schema" : "invalid_request", v.errors.join("; "), false);
  const r = req as ReadRequestV2;
  if (r.operation !== op || r.result_schema_id !== RESULT_SCHEMA_IDS[op as "metric_series"]) return refusal(rid, "unsupported_schema", `operation ${r.operation} with ${r.result_schema_id} is not ${op}`, false);
  const want = snap.facts.snapshot;
  if (canonicalJson(r.query.snapshot) !== canonicalJson(want)) {
    return refusal(rid, r.cursor === null ? "stale_source" : "stale_cursor", "the query snapshot is not the current source snapshot; restart from a new snapshot", true, r.query.snapshot.input_manifest_digest, want.input_manifest_digest);
  }
  // Version pins, cohort hash and ordering must be the ones this service computes: a relabelled
  // pricing, normalizer or aggregation version would otherwise be served over different inputs.
  let pinned: QueryIdentity;
  try { pinned = pinnedQuery(snap, r.query); } catch (err) {
    if (err instanceof SeriesRefusal) return refusal(rid, err.code, err.message, err.retryable);
    throw err;
  }
  if (canonicalJson(pinned) !== canonicalJson(r.query)) return refusal(rid, "unsupported_capability", "query versions, cohort hash or filter order differ from the pins this service computes; build the query with projectQuery", false);
  return r;
}

const isRefusal = (x: unknown): x is RefusalV2 => (x as RefusalV2)?.schema_version === "guild.stack.refusal.v2";

function run<T>(rid: string, f: () => T): T | RefusalV2 {
  try { return f(); } catch (err) {
    if (err instanceof SeriesRefusal) return refusal(rid, err.code, err.message, err.retryable);
    throw err;
  }
}

/** `metric_series`: one C9 series over the current snapshot. */
export function readMetricSeries(snap: ProjectSnapshot, req: unknown, opts: { group_by?: GroupBy } = {}): MetricSeriesV2 | RefusalV2 {
  const r = checkRequest(snap, req, "metric_series");
  if (isRefusal(r)) return r;
  return run(r.request_id, () => {
    const metric = metricOfQuery(r.query);
    const hash = queryHash(r.query);
    return computeMetricSeries(snap.facts, r.query, { group_by: opts.group_by, cursor: (p, o) => encodeCursor(snap.cursor_key, { q: hash, m: metric.id, g: opts.group_by ?? "all", p, o }) }).series;
  });
}

/**
 * `metric_drilldown`: one page of a point's evidence records, in stable order.
 * The cursor (from the series point or a previous page) names the point; with
 * no cursor the page starts at offset 0 of `point_key`.
 */
export function readMetricDrilldown(snap: ProjectSnapshot, req: unknown, opts: { point_key?: string; group_by?: GroupBy } = {}): MetricDrilldownV2 | RefusalV2 {
  const r = checkRequest(snap, req, "metric_drilldown");
  if (isRefusal(r)) return r;
  return run(r.request_id, () => {
    const metric = metricOfQuery(r.query);
    const hash = queryHash(r.query);
    let point = opts.point_key ?? "all";
    let offset = 0;
    if (r.cursor !== null) {
      const c = decodeCursor(snap.cursor_key, r.cursor);
      if (!c) return refusal(r.request_id, "invalid_request", "cursor is malformed or altered", false);
      if (c.q !== hash || c.m !== metric.id || c.g !== (opts.group_by ?? "all")) return refusal(r.request_id, "invalid_request", "cursor belongs to another query, metric or grouping", false);
      if (opts.point_key !== undefined && opts.point_key !== c.p) return refusal(r.request_id, "invalid_request", "cursor names another series point", false);
      point = c.p;
      offset = c.o;
    }
    const computed = computeMetricSeries(snap.facts, r.query, { group_by: opts.group_by });
    const p = computed.series.points.find((x) => x.key === point);
    const records = computed.records.get(point);
    if (!p || !records) return refusal(r.request_id, "invalid_request", `series has no point ${point}`, false);
    if (offset > records.length) return refusal(r.request_id, "invalid_request", "cursor offset beyond the point's records", false);
    const end = Math.min(records.length, offset + r.limit);
    return {
      schema_version: METRIC_DRILLDOWN_V2_SCHEMA, metric_id: metric.id, point_key: point, query_hash: hash,
      snapshot: snap.facts.snapshot, records: records.slice(offset, end), coverage: p.coverage,
      next_cursor: end < records.length ? encodeCursor(snap.cursor_key, { q: hash, m: metric.id, g: opts.group_by ?? "all", p: point, o: end }) : null,
    };
  });
}
