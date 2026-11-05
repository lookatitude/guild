/**
 * src/domains/telemetry/trace-analysis-v3.ts — T01 validator for
 * `guild.trace.analysis.v3` (contract bundle guild.stack.contract_bundle.v2).
 *
 * A hand-written mirror of the frozen A02 `trace-analysis.schema.json` plus the
 * verify_contracts.py semantic rules that apply to it: the shared recursive walk
 * (coverage, state axes, intervals, lineage, observed identity), the usage rules
 * and the trace-analysis branch. The vendored A02 fixture subset pins parity; the
 * test runs a differential against the frozen JSON schema when the contracts
 * checkout is present. Pure: no I/O, no clock.
 */

export const TRACE_ANALYSIS_V3_SCHEMA = "guild.trace.analysis.v3" as const;

export const TRACE_EVENT_CLASSES = Object.freeze([
  "prompt", "dispatch", "request_started", "request_completed", "handoff", "phase",
  "obligation", "transfer", "knowledge", "retrieval", "loss",
] as const);
export type TraceEventClass = (typeof TRACE_EVENT_CLASSES)[number];

export type Hash = string;
export interface TraceLineage {
  source_id: string; run_id: string; execution_id: string; host_session_id: string | null; initiative_id: string | null;
  goal_id: string | null; logical_task_id: string | null; attempt_id: string | null; agent_instance_id: string | null;
  request_id: string | null;
}
export interface TracePins { assignment: Hash; definition: Hash; configuration: Hash; workflow: Hash; policy: Hash }
export interface TraceEvidence {
  source_id: string; path: string; sha256: Hash; schema_version: string; observed_at: string;
  availability: "available" | "expired" | "redacted" | "missing" | "unsupported"; reason: string | null;
}
export interface TraceCoverage {
  eligible: number | null; covered: number; excluded: number; missing: number | null;
  state: "complete" | "partial" | "unavailable"; reason: string | null;
  exclusion_reasons: { code: string; count: number }[];
}
export interface TraceObservedIdentity { provider: string | null; model: string | null; status: "observed" | "unavailable"; reason: string | null }
export interface TraceClock { domain: string; basis: "controller" | "local_monotonic" | "provider" | "unknown"; comparable: boolean; skew_bound_ms: number | null }
export interface TraceInterval { start: string; end: string | null; duration_ms: number | null; clock: TraceClock }
export interface TraceUsage {
  granularity: "leaf_request" | "native_session"; observation_id: string; revision: number; final: boolean;
  accounting_identity: string; parent_accounting_identity: string | null;
  inclusion: "leaf_exclusive" | "parent_inclusive" | "session_cumulative";
  input_inclusive: number | null; output: number | null; cache_read_subset: number | null; cache_write_subset: number | null;
  total: number | null; cost_usd: number | null; cost_basis: "measured" | "derived_estimate" | "native_estimate" | "unavailable";
  currency: "USD"; pricing_version: string | null;
  usage_semantics: "inclusive_input_cache_subset.v1" | "provider_session_only.v1" | "unknown";
  coverage: TraceCoverage; native_baseline_usd: number | null; native_cumulative_usd: number | null;
}
export interface TraceAnalysisV3 {
  schema_version: typeof TRACE_ANALYSIS_V3_SCHEMA; event_id: string; sequence: number; event_class: TraceEventClass;
  at: string; lineage: TraceLineage; operation_id: string | null; component_invocation_id: string | null; actor_id: string;
  pins: TracePins; requested_model: string | null; observed_identity: TraceObservedIdentity; usage: TraceUsage | null;
  payload_ref: TraceEvidence | null; prompt_hash: Hash | null; redaction_version: string; capture: TraceCoverage;
  interval: TraceInterval | null;
}

export type TraceValidationVerdict = { ok: true } | { ok: false; errors: string[] };

// ── Structural mirror of the frozen schema ───────────────────────────────────

type Check = (v: unknown, at: string, errs: string[]) => void;
export const TRACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const REL_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*[\\%\x00-\x1f])[^:]+$/u;

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const fail = (errs: string[], at: string, msg: string) => { errs.push(`${at}: ${msg}`); };
/** JSON Schema string lengths count Unicode code points, not UTF-16 units. */
export const cpLength = (s: string) => [...s].length;

export function isRfc3339(v: string): boolean {
  const m = TIME_RE.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const daysIn = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn[mo - 1]! || h > 23 || mi > 59 || s > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return true;
}

/** Epoch microseconds of an RFC 3339 instant; callers check `isRfc3339` first. */
export function traceInstantMicros(t: string): bigint {
  const m = TIME_RE.exec(t)!;
  const frac = /\.(\d+)/.exec(t.slice(19))?.[1] ?? "";
  const whole = BigInt(Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${t.slice(19).replace(/^\.\d+/, "")}`));
  return whole * 1000n + BigInt((frac + "000000").slice(0, 6));
}

/** Microsecond-precision instant order (the frozen verifier compares datetimes, not ms). */
export function compareTraceInstants(a: string, b: string): number {
  const d = traceInstantMicros(a) - traceInstantMicros(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

const id: Check = (v, at, e) => { if (typeof v !== "string" || !TRACE_ID_RE.test(v)) fail(e, at, "not an id"); };
const hash: Check = (v, at, e) => { if (typeof v !== "string" || !HASH_RE.test(v)) fail(e, at, "not a sha256 hash"); };
const time: Check = (v, at, e) => { if (typeof v !== "string" || !isRfc3339(v)) fail(e, at, "not a date-time"); };
const str: Check = (v, at, e) => { if (typeof v !== "string" || cpLength(v) < 1 || cpLength(v) > 4096) fail(e, at, "not a bounded string"); };
const int0: Check = (v, at, e) => { if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(e, at, "not a non-negative integer"); };
const num0: Check = (v, at, e) => { if (typeof v !== "number" || !Number.isFinite(v) || v < 0) fail(e, at, "not a non-negative number"); };
const bool: Check = (v, at, e) => { if (typeof v !== "boolean") fail(e, at, "not a boolean"); };
const konst = (c: string): Check => (v, at, e) => { if (v !== c) fail(e, at, `must equal ${c}`); };
const oneOf = (...vals: readonly string[]): Check => (v, at, e) => { if (typeof v !== "string" || !vals.includes(v)) fail(e, at, `not one of ${vals.join("|")}`); };
const nullable = (c: Check): Check => (v, at, e) => { if (v !== null) c(v, at, e); };
const relPath: Check = (v, at, e) => {
  if (typeof v !== "string" || cpLength(v) < 1 || cpLength(v) > 1024 || !REL_PATH_RE.test(v)) fail(e, at, "not a contained relative path");
};
const array = (item: Check, max: number): Check => (v, at, e) => {
  if (!Array.isArray(v)) return fail(e, at, "not an array");
  if (v.length > max) fail(e, at, `more than ${max} items`);
  for (let i = 0; i < v.length; i++) item(v[i], `${at}[${i}]`, e);
};
const object = (shape: Record<string, Check>): Check => (v, at, e) => {
  if (!isObj(v)) return fail(e, at, "not an object");
  for (const k of Object.keys(v)) if (!own(shape, k)) fail(e, `${at}.${k}`, "unknown field");
  for (const k of Object.keys(shape)) {
    if (!own(v, k)) fail(e, `${at}.${k}`, "required");
    else shape[k]!(v[k], `${at}.${k}`, e);
  }
};

const evidence = object({
  source_id: id, path: relPath, sha256: hash, schema_version: str, observed_at: time,
  availability: oneOf("available", "expired", "redacted", "missing", "unsupported"), reason: nullable(str),
});
const coverage = object({
  eligible: nullable(int0), covered: int0, excluded: int0, missing: nullable(int0),
  state: oneOf("complete", "partial", "unavailable"), reason: nullable(str),
  exclusion_reasons: array(object({ code: id, count: int0 }), 100),
});
const lineage = object({
  source_id: id, run_id: id, execution_id: id, host_session_id: nullable(id), initiative_id: nullable(id), goal_id: nullable(id),
  logical_task_id: nullable(id), attempt_id: nullable(id), agent_instance_id: nullable(id), request_id: nullable(id),
});
const pins = object({ assignment: hash, definition: hash, configuration: hash, workflow: hash, policy: hash });
const interval = object({
  start: time, end: nullable(time), duration_ms: nullable(num0),
  clock: object({ domain: id, basis: oneOf("controller", "local_monotonic", "provider", "unknown"), comparable: bool, skew_bound_ms: nullable(num0) }),
});
const usage = object({
  granularity: oneOf("leaf_request", "native_session"), observation_id: id, revision: int0, final: bool,
  accounting_identity: id, parent_accounting_identity: nullable(id),
  inclusion: oneOf("leaf_exclusive", "parent_inclusive", "session_cumulative"),
  input_inclusive: nullable(int0), output: nullable(int0), cache_read_subset: nullable(int0), cache_write_subset: nullable(int0),
  total: nullable(int0), cost_usd: nullable(num0), cost_basis: oneOf("measured", "derived_estimate", "native_estimate", "unavailable"),
  currency: konst("USD"), pricing_version: nullable(str),
  usage_semantics: oneOf("inclusive_input_cache_subset.v1", "provider_session_only.v1", "unknown"),
  coverage, native_baseline_usd: nullable(num0), native_cumulative_usd: nullable(num0),
});
const shape = object({
  schema_version: konst(TRACE_ANALYSIS_V3_SCHEMA), event_id: id, sequence: int0, event_class: oneOf(...TRACE_EVENT_CLASSES),
  at: time, lineage, operation_id: nullable(id), component_invocation_id: nullable(id), actor_id: id, pins,
  requested_model: nullable(str),
  observed_identity: object({ provider: nullable(str), model: nullable(str), status: oneOf("observed", "unavailable"), reason: nullable(str) }),
  usage: nullable(usage), payload_ref: nullable(evidence), prompt_hash: nullable(hash), redaction_version: str,
  capture: coverage, interval: nullable(interval),
});

/** Schema-mirror building blocks shared with the T03 v2 analysis validator. */
export const TRACE_V3_CHECKS = Object.freeze({ id, hash, time, str, int0, num0, bool, konst, oneOf, nullable, relPath, array, object, evidence, coverage, usage });
export type TraceShapeCheck = Check;

export function validateTraceAnalysisV3Shape(value: unknown): TraceValidationVerdict {
  const errors: string[] = [];
  shape(value, "$", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ── Semantic rules (verify_contracts.py) ─────────────────────────────────────

const USAGE_COUNTERS = ["input_inclusive", "output", "cache_read_subset", "cache_write_subset", "total"] as const;
const hasKeys = (o: Record<string, unknown>, keys: readonly string[]) => keys.every((k) => own(o, k));

function coverageRules(c: any, require: (ok: boolean, msg: string) => void): void {
  if (c.eligible !== null) {
    require(c.covered <= c.eligible, "covered exceeds eligible");
    if (c.missing !== null) require(c.covered + c.missing === c.eligible, "eligible must equal covered plus missing; excluded is outside eligible");
  }
  if (c.state === "complete") require(c.eligible !== null && c.covered === c.eligible && c.missing === 0, "complete requires known full coverage");
  else require(Boolean(c.reason), "incomplete coverage needs reason");
  if (c.state === "unavailable") require(c.covered === 0, "unavailable coverage cannot have covered samples");
}

/** Python math.isclose(a, b, abs_tol=1e-12) with its default rel_tol=1e-9. */
const isClose = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9 * Math.max(Math.abs(a), Math.abs(b)), 1e-12);

export function usageRules(u: any, require: (ok: boolean, msg: string) => void): void {
  coverageRules(u.coverage, require);
  if (u.coverage.state === "unavailable") require(USAGE_COUNTERS.every((k) => u[k] === null), "unavailable usage must report null counters, not zero");
  if (u.input_inclusive !== null) {
    for (const k of ["cache_read_subset", "cache_write_subset"]) require(u[k] === null || u[k] <= u.input_inclusive, "cache must be subset of inclusive input");
  }
  const expected = u.input_inclusive === null || u.output === null ? null : u.input_inclusive + u.output;
  require(u.total === expected, "total must be input plus output; cache is not additive");
  if (u.cost_basis === "unavailable") require(u.cost_usd === null, "unavailable cost must be null");
  if (u.cost_basis !== "unavailable") require(u.cost_usd !== null, "available cost basis requires value");
  if (u.cost_basis === "derived_estimate") require(Boolean(u.pricing_version), "derived estimate needs pricing version");
  if (u.granularity === "native_session") {
    require(u.inclusion === "session_cumulative" && u.usage_semantics === "provider_session_only.v1", "session accounting cannot claim leaf semantics");
    require(USAGE_COUNTERS.every((k) => u[k] === null), "session-only cost does not synthesize normalized leaf tokens");
    require(u.cost_basis === "native_estimate" || u.cost_basis === "unavailable", "native session never measured billing");
    if (u.cost_usd !== null) {
      require(
        u.native_baseline_usd !== null && u.native_cumulative_usd !== null && u.native_cumulative_usd >= u.native_baseline_usd &&
          isClose(u.cost_usd, u.native_cumulative_usd - u.native_baseline_usd),
        "session delta needs non-reset baseline",
      );
    }
  } else require(u.inclusion !== "session_cumulative", "leaf cannot claim cumulative session inclusion");
}

function walkRules(o: unknown, require: (ok: boolean, msg: string) => void, level = 0): void {
  if (level > 32) return require(false, "object depth exceeds validation budget");
  if (Array.isArray(o)) { for (const x of o) walkRules(x, require, level + 1); return; }
  if (!isObj(o)) return;
  if (hasKeys(o, ["eligible", "covered", "excluded", "missing", "state", "reason", "exclusion_reasons"])) coverageRules(o, require);
  if (hasKeys(o, ["lifecycle", "outcome", "acceptance", "observability"])) {
    if (o["outcome"] === "succeeded") require(o["acceptance"] === "verified", "success requires verified acceptance");
    if (o["lifecycle"] === "closed") require(o["outcome"] !== "pending" && o["outcome"] !== "unknown", "closed cannot have pending/unknown outcome");
  }
  if (hasKeys(o, ["start", "end", "duration_ms", "clock"])) {
    require(o["end"] === null || compareTraceInstants(o["end"] as string, o["start"] as string) >= 0, "interval cannot end before start");
    require(o["duration_ms"] === null || (o["clock"] as Record<string, unknown>)["basis"] !== "unknown", "unknown clock cannot claim duration");
  }
  if (hasKeys(o, ["source_id", "run_id", "execution_id", "host_session_id", "attempt_id", "logical_task_id", "request_id"])) {
    require(o["attempt_id"] === null || o["logical_task_id"] !== null, "attempt requires logical task");
  }
  if (hasKeys(o, ["provider", "model", "status", "reason"])) {
    if (o["status"] === "observed") require(o["model"] !== null, "observed identity needs observed model");
    if (o["status"] === "unavailable") require(o["model"] === null && Boolean(o["reason"]), "unavailable observed identity needs null model and reason");
  }
  for (const x of Object.values(o)) walkRules(x, require, level + 1);
}

/** Structural then semantic validation; semantic rules run only on a structurally valid event. */
export function validateTraceAnalysisV3(value: unknown): TraceValidationVerdict {
  const structural = validateTraceAnalysisV3Shape(value);
  if (!structural.ok) return structural;
  const v = value as TraceAnalysisV3;
  const errors: string[] = [];
  const require = (ok: boolean, msg: string) => { if (!ok) errors.push(msg); };
  walkRules(v, require);
  const l = v.lineage;
  require(v.payload_ref === null || v.payload_ref.source_id === l.source_id, "lineage-owned evidence recorded by another source");
  if (v.event_class === "request_started" || v.event_class === "request_completed") require(l.request_id !== null, "request event missing request id");
  if (v.usage) usageRules(v.usage, require);
  if (v.usage && v.usage.cost_basis === "derived_estimate") require(v.observed_identity.status === "observed", "derived model pricing needs observed model, not requested fallback");
  if (v.observed_identity.status === "unavailable") {
    require(v.observed_identity.model === null && Boolean(v.observed_identity.reason), "unobserved model cannot be requested-model fallback");
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
