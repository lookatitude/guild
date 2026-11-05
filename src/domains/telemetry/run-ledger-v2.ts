/**
 * src/domains/telemetry/run-ledger-v2.ts — T02 per-run normalization of usage,
 * cost, time and attribution, computed once over T01 `guild.trace.analysis.v3`
 * events, controller-typed time spans and a pinned price table. Pure: no I/O,
 * no clock. T03 publishes the versioned analysis from this ledger.
 *
 * Usage: one leaf per source-qualified accounting identity. The highest final
 * revision replaces interim stream revisions; counters that fall across
 * revisions, two observations of one revision that disagree, or one event id
 * with two contents make the leaf unknown. Mirrors and replays add 0.
 * Parent-inclusive counters are excluded. Input includes the cache subset and
 * total = input + output, so cache is never added again; reasoning is a subset
 * of output and has no counter of its own. A missing counter is null, never 0:
 * known subtotals are exposed, and an exact total exists only at complete
 * coverage. An incomplete capture makes the request denominator unknown.
 *
 * Cost: measured, derived-estimate and native-estimate series stay separate.
 * Derived estimates price the observed model only (never the requested one),
 * bill uncached input as input minus cache subsets, and sum exactly in integer
 * femto-USD. A non-USD table refuses the aggregate. Native session spend takes
 * the latest cumulative delta per session, never a sum of revisions.
 *
 * Attribution: leaves group by their exact execution/task/attempt/agent/observed
 * model binding. A leaf without a task, or seen with two bindings, stays
 * unallocated; allocated plus unallocated reconciles the known ledger.
 *
 * Time: elapsed comes from the run interval only. Active time is the union of
 * active spans in the run's clock domain; agent work sums each agent's own
 * union; waits are a union by reason, and exclusive wait is wait outside the
 * active union. Spans on another or unknown clock, open spans and spans whose
 * duration disagrees with their bounds are excluded with a reason.
 */

import {
  TRACE_ID_RE,
  isRfc3339,
  traceInstantMicros,
  validateTraceAnalysisV3,
  type TraceAnalysisV3,
  type TraceClock,
  type TraceCoverage,
  type TraceObservedIdentity,
  type TraceUsage,
} from "./trace-analysis-v3";

export const RUN_LEDGER_SCHEMA = "guild.run_ledger.v1" as const;
export const RUN_LEDGER_VERSIONS = Object.freeze({
  normalizer: "t02.n1",
  usage_formula: "t02.usage.1",
  cost_formula: "t02.cost.1",
  time_formula: "t02.time.1",
  usage_semantics: "inclusive_input_cache_subset.v1",
});

// ── Public shapes ────────────────────────────────────────────────────────────

/** USD per 1M tokens. `cache_write: null` means the model bills no separate cache write. */
export interface PriceEntry { provider: string; model: string; uncached_input: number; cache_read: number; cache_write: number | null; output: number }
export interface PriceTable { version: string; currency: string; source_hash: string; entries: PriceEntry[] }

export interface RunLedgerInput {
  source_id: string;
  run_id: string;
  /** Untrusted: trace events, or JSON lines of them. Each is re-validated. */
  events: readonly unknown[];
  /** Trace capture coverage (from T01 `readTrace`); null means unknown. */
  capture: TraceCoverage | null;
  /** Untrusted controller-typed spans: one `run`, plus `active` and `wait`. */
  spans?: readonly unknown[];
  pricing?: PriceTable | null;
  budget?: { threshold_usd: number } | null;
  /** Controller instant for an open run's elapsed-so-far. */
  as_of?: string | null;
}

export interface LedgerValue { value: number | null; known_subtotal: number | null; exact_total: number | null; coverage: TraceCoverage; reason: string | null }
export interface LedgerRatio { value: number | null; numerator: number | null; denominator: number | null; coverage: TraceCoverage; reason: string | null }
export interface CostValue extends LedgerValue { basis: "measured" | "derived_estimate" | "native_estimate"; currency: "USD"; pricing_version: string | null }
export interface LedgerLoss { code: string; count: number | null; reason: string }

export interface LedgerLeaf {
  source_id: string; accounting_identity: string; request_id: string | null;
  execution_id: string | null; logical_task_id: string | null; attempt_id: string | null; agent_instance_id: string | null;
  requested_model: string | null; observed_identity: TraceObservedIdentity;
  /** The selected final observation, as captured. Null when none is usable. */
  usage: TraceUsage | null;
  /** The ledger's v3 usage record: selected counters with this ledger's cost. */
  normalized_usage: TraceUsage;
  covered: boolean; reason: string | null;
  measured_usd: number | null; derived_estimate_usd: number | null;
  allocation: "allocated" | "unallocated"; allocation_reason: string | null;
}

/** A request seen starting, or completing without usage, that has no usage record. */
export interface PendingRequest { execution_id: string; request_id: string }
export interface AllocationKey { execution_id: string; logical_task_id: string; attempt_id: string | null; agent_instance_id: string | null; observed_model: string | null }
export interface AllocationGroup { key: AllocationKey; request_ids: string[]; tokens: LedgerValue; derived_estimate_usd: LedgerValue }

export interface BudgetEstimate {
  threshold_usd: number; basis: "native_estimate"; strict_ceiling: false;
  known_estimate_usd: number | null; remaining_usd: number | null; overshoot_usd: number | null; reason: string | null;
}

export interface RunTime {
  elapsed_ms: LedgerValue; active_union_ms: LedgerValue; agent_work_ms: LedgerValue;
  raw_wait_ms: LedgerValue; exclusive_wait_ms: LedgerValue; wait_by_reason: { reason: string; ms: number }[];
  active_latency_ms: { n: number; p50: number | null; p95: number | null; excluded: number };
  clock: { domain: string | null; basis: TraceClock["basis"] | null; skew_bound_ms: number | null };
  losses: LedgerLoss[];
}

export interface RunLedger {
  schema_version: typeof RUN_LEDGER_SCHEMA;
  versions: typeof RUN_LEDGER_VERSIONS & { pricing: string | null };
  source_id: string; run_id: string;
  leaves: LedgerLeaf[];
  usage: { input: LedgerValue; output: LedgerValue; cache_read: LedgerValue; cache_write: LedgerValue; total: LedgerValue; cache_hit_ratio: LedgerRatio };
  cost: { measured: CostValue; derived_estimate: CostValue; native_estimate: CostValue; budget: BudgetEstimate | null };
  coverage: { requests: TraceCoverage; request_ratio: LedgerRatio; pending_requests: PendingRequest[]; duplicates: number; invalid_events: number };
  allocation: { groups: AllocationGroup[]; unallocated: { tokens: LedgerValue; derived_estimate_usd: LedgerValue }; unallocated_request_ids: string[] };
  time: RunTime;
  losses: LedgerLoss[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === "string" && TRACE_ID_RE.test(v);

/** Key-order-independent serialization, so a replay with reordered keys is still identical. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

class Losses {
  private readonly m = new Map<string, { count: number | null; reason: string }>();
  add(code: string, reason: string, n: number | null = 1): void {
    const cur = this.m.get(code);
    if (!cur) this.m.set(code, { count: n, reason });
    else cur.count = cur.count === null || n === null ? null : cur.count + n;
  }
  get(code: string): number { return this.m.get(code)?.count ?? 0; }
  list(): LedgerLoss[] { return [...this.m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([code, x]) => ({ code, count: x.count, reason: x.reason })); }
}

function coverageOf(eligible: number | null, covered: number, reason: string | null): TraceCoverage {
  const missing = eligible === null ? null : eligible - covered;
  if (eligible !== null && missing === 0) return { eligible, covered, excluded: 0, missing: 0, state: "complete", reason: null, exclusion_reasons: [] };
  return { eligible, covered, excluded: 0, missing, state: covered === 0 ? "unavailable" : "partial", reason: reason ?? "coverage incomplete", exclusion_reasons: [] };
}

/** A sum over covered samples; exact only at complete coverage. `eligible === 0` is a measured zero. */
function ledgerValue(eligible: number | null, samples: readonly number[], reason: string | null): LedgerValue {
  const coverage = coverageOf(eligible, samples.length, reason);
  if (samples.length === 0 && coverage.state !== "complete") return { value: null, known_subtotal: null, exact_total: null, coverage, reason: coverage.reason };
  const v = samples.reduce((s, x) => s + x, 0);
  return { value: v, known_subtotal: v, exact_total: coverage.state === "complete" ? v : null, coverage, reason: coverage.reason };
}

/** Exact sum of non-negative safe integers; null when the sum leaves the safe range. */
function sumCounts(xs: readonly number[]): number | null {
  const s = xs.reduce((a, x) => a + BigInt(x), 0n);
  return s <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(s) : null;
}

function countValue(eligible: number | null, samples: readonly number[], reason: string | null): LedgerValue {
  const s = sumCounts(samples);
  if (s === null) return { value: null, known_subtotal: null, exact_total: null, coverage: coverageOf(eligible, 0, "counter sum overflow"), reason: "counter sum overflow" };
  const v = ledgerValue(eligible, samples, reason);
  return v.value === null ? v : { ...v, value: s, known_subtotal: s, exact_total: v.exact_total === null ? null : s };
}

// Money: integer femto-USD (1e-15). A price per 1M tokens times a token count lands there exactly.
const FEMTO = 1_000_000_000_000_000;
const PRICE_PLACES = 9; // price per 1M tokens, in units of 1e-9 USD
const FEMTO_PLACES = 15;
const MAX_EXPONENT = 40;

/**
 * Exact `x × 10^places` from the number's shortest decimal form, or null when
 * `x` is not a finite non-negative number, carries finer digits, or is absurdly large.
 */
function decimalScaled(x: unknown, places: number): bigint | null {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return null;
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(x.toString());
  if (!m) return null;
  const exp = Number(m[3] ?? 0) - (m[2]?.length ?? 0) + places;
  if (exp > MAX_EXPONENT) return null;
  const digits = BigInt(m[1]! + (m[2] ?? ""));
  if (exp >= 0) return digits * 10n ** BigInt(exp);
  const div = 10n ** BigInt(-exp);
  return digits % div === 0n ? digits / div : null;
}
/** Correctly rounded USD from femto-USD; decimal parsing avoids `Number(f)` overflowing first. */
const femtoToUsd = (f: bigint) => Number(`${f}e-${FEMTO_PLACES}`);
const usdToFemto = (x: number): bigint | null => decimalScaled(x, FEMTO_PLACES);

function costValue(basis: CostValue["basis"], pricing: string | null, eligible: number | null, samples: readonly bigint[], reason: string | null): CostValue {
  const coverage = coverageOf(eligible, samples.length, reason);
  if (samples.length === 0) return { value: null, known_subtotal: null, exact_total: null, coverage: coverageOf(eligible, 0, reason ?? "no cost observed"), reason: reason ?? "no cost observed", basis, currency: "USD", pricing_version: pricing };
  const v = femtoToUsd(samples.reduce((s, x) => s + x, 0n));
  if (!Number.isFinite(v)) return { value: null, known_subtotal: null, exact_total: null, coverage: coverageOf(eligible, 0, "cost sum is not representable"), reason: "cost sum is not representable", basis, currency: "USD", pricing_version: pricing };
  return { value: v, known_subtotal: v, exact_total: coverage.state === "complete" ? v : null, coverage, reason: coverage.reason, basis, currency: "USD", pricing_version: pricing };
}

function unavailableUsage(acct: string, observation: string, reason: string): TraceUsage {
  return {
    granularity: "leaf_request", observation_id: observation, revision: 0, final: true, accounting_identity: acct,
    parent_accounting_identity: null, inclusion: "leaf_exclusive", input_inclusive: null, output: null,
    cache_read_subset: null, cache_write_subset: null, total: null, cost_usd: null, cost_basis: "unavailable",
    currency: "USD", pricing_version: null, usage_semantics: "unknown",
    coverage: { eligible: 1, covered: 0, excluded: 0, missing: 1, state: "unavailable", reason, exclusion_reasons: [] },
    native_baseline_usd: null, native_cumulative_usd: null,
  };
}

// ── Pricing ──────────────────────────────────────────────────────────────────

interface Prices { version: string; byModel: Map<string, { uncached: bigint; cacheRead: bigint; cacheWrite: bigint | null; output: bigint }> }

function resolvePrices(t: PriceTable | null | undefined): { prices: Prices | null; reason: string } {
  if (!t) return { prices: null, reason: "no pinned price table" };
  if (!isObj(t) || !isId(t.version) || !Array.isArray(t.entries)) return { prices: null, reason: "price table invalid" };
  if (t.currency !== "USD") return { prices: null, reason: `price table currency ${String(t.currency).slice(0, 16)} has no conversion contract` };
  const byModel: Prices["byModel"] = new Map();
  for (const e of t.entries) {
    if (!isObj(e) || typeof e.provider !== "string" || typeof e.model !== "string") return { prices: null, reason: "price table invalid" };
    const uncached = decimalScaled(e.uncached_input, PRICE_PLACES), cacheRead = decimalScaled(e.cache_read, PRICE_PLACES), output = decimalScaled(e.output, PRICE_PLACES);
    const cacheWrite = e.cache_write === null ? null : decimalScaled(e.cache_write, PRICE_PLACES);
    if (uncached === null || cacheRead === null || output === null || (e.cache_write !== null && cacheWrite === null)) return { prices: null, reason: "price table invalid" };
    const key = `${e.provider}\u0000${e.model}`;
    if (byModel.has(key)) return { prices: null, reason: "price table lists a model twice" };
    byModel.set(key, { uncached, cacheRead, cacheWrite, output });
  }
  return { prices: { version: t.version, byModel }, reason: "" };
}

/** Femto-USD for one leaf, or the reason it cannot be priced. */
function priceLeaf(u: TraceUsage, id: TraceObservedIdentity, prices: Prices | null, refusal: string): bigint | string {
  if (!prices) return refusal;
  if (id.status !== "observed" || id.provider === null || id.model === null) return "observed model unavailable; requested model is not priced";
  const p = prices.byModel.get(`${id.provider}\u0000${id.model}`);
  if (!p) return "no price for the observed model";
  if (u.input_inclusive === null || u.output === null || u.cache_read_subset === null) return "usage counters incomplete";
  let write = 0n;
  if (u.cache_write_subset !== null && u.cache_write_subset > 0) {
    if (p.cacheWrite === null) return "cache write tokens with no cache-write price";
    write = BigInt(u.cache_write_subset);
  } else if (u.cache_write_subset === null && p.cacheWrite !== null) return "cache write subset unknown for a write-priced model";
  const uncachedTokens = BigInt(u.input_inclusive) - BigInt(u.cache_read_subset) - write;
  if (uncachedTokens < 0n) return "cache subsets exceed inclusive input";
  // tokens × (USD per 1M × 1e9) = USD × 1e15
  const f = uncachedTokens * p.uncached + BigInt(u.cache_read_subset) * p.cacheRead + write * (p.cacheWrite ?? 0n) + BigInt(u.output) * p.output;
  return Number.isFinite(femtoToUsd(f)) ? f : "derived cost is not representable";
}

// ── Usage ────────────────────────────────────────────────────────────────────

const COUNTERS = ["input_inclusive", "output", "cache_read_subset", "cache_write_subset"] as const;
const usageSignature = (u: TraceUsage) => canonical({ ...u, observation_id: null });
const bindingOf = (e: TraceAnalysisV3) =>
  canonical([e.lineage.execution_id, e.lineage.logical_task_id, e.lineage.attempt_id, e.lineage.agent_instance_id]);

interface Selected {
  usage: TraceUsage | null; event: TraceAnalysisV3 | null; trusted: boolean; reason: string | null;
}

/** Pick the highest final revision; any disagreement or counter decrease makes the identity untrusted. */
function selectRevision(obs: readonly TraceAnalysisV3[], poisoned: boolean, losses: Losses, native: boolean): Selected {
  const byRev = new Map<number, TraceAnalysisV3[]>();
  for (const e of obs) {
    const r = e.usage!.revision;
    if (!byRev.has(r)) byRev.set(r, []);
    byRev.get(r)!.push(e);
  }
  let trusted = !poisoned;
  let reason: string | null = poisoned ? "an event id of this request was replayed with different content" : null;
  for (const group of byRev.values()) {
    const sigs = new Set(group.map((e) => usageSignature(e.usage!)));
    if (sigs.size > 1) {
      trusted = false;
      reason = "two observations of one revision disagree";
      losses.add("revision_conflict", "observations of one revision disagree; the request is unknown");
    } else if (group.length > 1) losses.add("mirror_suppressed", "duplicate observation of an already counted revision", group.length - 1);
  }
  const revs = [...byRev.keys()].sort((a, b) => a - b);
  const finals = revs.filter((r) => byRev.get(r)![0]!.usage!.final);
  // A native session estimate is cumulative: the newest revision wins even past a "final" one.
  const chosenRev = native ? revs[revs.length - 1]! : finals.length ? finals[finals.length - 1]! : null;
  if (chosenRev === null) return { usage: null, event: null, trusted: false, reason: reason ?? "no final usage revision" };
  for (const r of revs) {
    if (r === chosenRev) continue;
    const final = byRev.get(r)![0]!.usage!.final;
    if (r > chosenRev) losses.add("post_final_revision_ignored", "a revision after the final one is ignored");
    else if (final) losses.add("final_revision_superseded", "an earlier final revision is replaced by a later one");
    else losses.add("provisional_superseded", "interim stream revision replaced by the final cumulative counters");
  }
  const upTo = revs.filter((r) => r <= chosenRev).map((r) => byRev.get(r)![0]!.usage!);
  // Compare with the running maximum, so a null revision cannot hide a decrease.
  const fields = native ? (["native_cumulative_usd"] as const) : COUNTERS;
  const peak = new Map<string, number>();
  for (let i = 0; i < upTo.length; i++) {
    const b = upTo[i]!;
    const fell = fields.some((k) => b[k] !== null && peak.has(k) && (b[k] as number) < peak.get(k)!);
    for (const k of fields) if (b[k] !== null) peak.set(k, Math.max(peak.get(k) ?? 0, b[k] as number));
    const rebased = native && i > 0 && upTo[0]!.native_baseline_usd !== b.native_baseline_usd;
    if (fell || rebased) {
      trusted = false;
      reason = native ? "native session counter reset or rebased" : "cumulative counters decrease across revisions";
      losses.add("non_monotonic_revision", "cumulative counters decrease across revisions; the request is unknown");
      break;
    }
  }
  const event = byRev.get(chosenRev)![0]!;
  return { usage: event.usage, event, trusted, reason };
}

interface UsageResult {
  leaves: LedgerLeaf[]; femto: Map<string, { derived: bigint | null; measured: bigint | null }>; pending: PendingRequest[]; nativeFemto: bigint[]; nativeSessions: number;
  eligibleKnown: boolean; duplicates: number; invalid: number;
}

function parseEvent(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw) as unknown; } catch { return undefined; }
}

function normalizeUsage(input: RunLedgerInput, prices: Prices | null, priceRefusal: string, losses: Losses): UsageResult {
  // 1 · admit: validate, keep this source's run, dedupe event ids.
  const byId = new Map<string, { sig: string; event: TraceAnalysisV3 }>();
  const conflictedIds = new Set<string>();
  const copies = new Map<string, { sig: string; event: TraceAnalysisV3 }[]>();
  let invalid = 0, replays = 0;
  for (const raw of input.events) {
    const e = parseEvent(raw);
    if (!validateTraceAnalysisV3(e).ok) { invalid++; losses.add("invalid_event", "event is not a valid guild.trace.analysis.v3 record"); continue; }
    const ev = e as TraceAnalysisV3;
    if (ev.lineage.source_id !== input.source_id || ev.lineage.run_id !== input.run_id) { losses.add("foreign_event", "event belongs to another source or run"); continue; }
    push(copies, ev.event_id, { sig: canonical(ev), event: ev });
  }
  // Decided per id over all copies, so input order cannot change replay or conflict counts.
  for (const [id, cs] of copies) {
    if (new Set(cs.map((c) => c.sig)).size > 1) { conflictedIds.add(id); losses.add("event_id_conflict", "one event id carries two contents; its request is unknown"); continue; }
    byId.set(id, cs[0]!);
    if (cs.length > 1) { replays += cs.length - 1; losses.add("replayed_event", "identical replay of an admitted event", cs.length - 1); }
  }
  // 2 · route observations.
  const leafObs = new Map<string, TraceAnalysisV3[]>();
  const nativeObs = new Map<string, TraceAnalysisV3[]>();
  const poisonedAccts = new Set<string>();
  const completedKeys = new Map<string, string | null>();
  const started = new Map<string, string>();
  const reqKey = (e: TraceAnalysisV3) => `${e.lineage.execution_id}\u0000${e.lineage.request_id}`;
  for (const { event: e } of byId.values()) {
    // Every copy of a conflicting event id is dropped, so the result does not depend on which came first.
    if (conflictedIds.has(e.event_id)) continue;
    if (e.event_class === "request_started" && e.lineage.request_id !== null) started.set(reqKey(e), e.lineage.request_id);
    if (e.usage && e.event_class !== "request_completed") { losses.add("usage_off_completion", "usage on a non-completion event is not billed"); continue; }
    if (e.event_class !== "request_completed") continue;
    const u = e.usage;
    if (!u) { if (!completedKeys.has(reqKey(e))) completedKeys.set(reqKey(e), null); continue; }
    completedKeys.set(reqKey(e), u.accounting_identity);
    if (u.granularity === "native_session") push(nativeObs, u.accounting_identity, e);
    else if (u.inclusion === "parent_inclusive") losses.add("parent_inclusive_excluded", "parent-inclusive counters are not billable leaf usage");
    else push(leafObs, u.accounting_identity, e);
  }
  // The conflicting copies of an event id also poison the identity they name.
  const conflictedNative = new Set<string>();
  for (const id of conflictedIds) {
    for (const { event: e } of copies.get(id)!) {
      if (!e.usage) continue;
      poisonedAccts.add(e.usage.accounting_identity);
      if (e.usage.granularity === "native_session") conflictedNative.add(e.usage.accounting_identity);
    }
  }
  // 3 · leaves.
  const leaves: LedgerLeaf[] = [];
  const femto = new Map<string, { derived: bigint | null; measured: bigint | null }>();
  for (const acct of [...leafObs.keys()].sort()) {
    const obs = leafObs.get(acct)!;
    const sel = selectRevision(obs, poisonedAccts.has(acct), losses, false);
    const ev = sel.event ?? obs[0]!;
    const bindings = new Set(obs.map(bindingOf));
    const identities = new Set((sel.event ? obs.filter((o) => o.usage!.revision === sel.usage!.revision) : obs).map((o) => canonical(o.observed_identity)));
    let observed = ev.observed_identity;
    if (identities.size > 1) {
      observed = { provider: null, model: null, status: "unavailable", reason: "observations disagree on the observed model" };
      losses.add("identity_conflict", "observations disagree on the observed model; it is not priced");
    }
    let reason = sel.reason;
    let usable = sel.trusted && sel.usage !== null;
    if (usable && sel.usage!.usage_semantics !== "inclusive_input_cache_subset.v1") { usable = false; reason = "usage semantics unknown"; }
    const u = usable ? sel.usage! : null;
    const covered = u !== null && u.total !== null;
    if (!covered && reason === null) reason = u ? (u.coverage.reason ?? "usage counters incomplete") : "usage unknown";
    const priced = u ? priceLeaf(u, observed, prices, priceRefusal) : "usage unknown";
    const derived = typeof priced === "bigint" ? priced : null;
    // Measured billing does not depend on token semantics; it needs only a trusted final record.
    const billed = sel.trusted ? sel.usage : null;
    const measured = billed && billed.cost_basis === "measured" && billed.cost_usd !== null ? usdToFemto(billed.cost_usd) : null;
    if (billed && billed.cost_basis === "measured" && measured === null) losses.add("measured_cost_unrepresentable", "measured cost is finer than 1e-15 USD or out of range");
    let allocation_reason: string | null = null;
    if (bindings.size > 1) allocation_reason = "observations carry conflicting task bindings";
    else if (ev.lineage.logical_task_id === null) allocation_reason = "no task binding";
    const base = u ?? unavailableUsage(acct, sel.usage?.observation_id ?? ev.usage!.observation_id, reason ?? "usage unknown");
    const normalized_usage: TraceUsage = measured !== null
      ? { ...base, cost_usd: femtoToUsd(measured), cost_basis: "measured", pricing_version: null }
      : derived !== null
        ? { ...base, cost_usd: femtoToUsd(derived), cost_basis: "derived_estimate", pricing_version: prices!.version }
        : { ...base, cost_usd: null, cost_basis: "unavailable", pricing_version: null };
    leaves.push({
      source_id: input.source_id, accounting_identity: acct, request_id: ev.lineage.request_id,
      execution_id: ev.lineage.execution_id, logical_task_id: ev.lineage.logical_task_id, attempt_id: ev.lineage.attempt_id,
      agent_instance_id: ev.lineage.agent_instance_id, requested_model: ev.requested_model, observed_identity: observed,
      usage: sel.usage, normalized_usage, covered, reason: covered ? null : reason,
      measured_usd: measured === null ? null : femtoToUsd(measured), derived_estimate_usd: derived === null ? null : femtoToUsd(derived),
      allocation: allocation_reason === null ? "allocated" : "unallocated", allocation_reason,
    });
    femto.set(acct, { derived, measured });
  }
  // 4 · native sessions: latest cumulative delta per session.
  const nativeFemto: bigint[] = [];
  for (const acct of [...nativeObs.keys()].sort()) {
    const sel = selectRevision(nativeObs.get(acct)!, poisonedAccts.has(acct), losses, true);
    const f = sel.trusted && sel.usage && sel.usage.cost_usd !== null ? usdToFemto(sel.usage.cost_usd) : null;
    if (f !== null) nativeFemto.push(f);
  }
  // 5 · requests seen starting (or completing without usage) that have no usage record.
  const pendingKeys = new Set([...[...started.keys()].filter((k) => !completedKeys.has(k)), ...[...completedKeys.entries()].filter(([, a]) => a === null).map(([k]) => k)]);
  const pending = [...pendingKeys].sort().map((k) => {
    const [execution_id, request_id] = k.split("\u0000") as [string, string];
    return { execution_id, request_id };
  });
  // Session-only accounting and conflicting event ids both hide how many leaf requests ran.
  const eligibleKnown = input.capture !== null && input.capture.state === "complete" && invalid === 0 && conflictedIds.size === 0 && nativeObs.size === 0;
  return { leaves, femto, pending, nativeFemto, nativeSessions: new Set([...nativeObs.keys(), ...conflictedNative]).size, eligibleKnown, duplicates: replays + losses.get("mirror_suppressed"), invalid };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const xs = m.get(k);
  if (xs) xs.push(v);
  else m.set(k, [v]);
}

// ── Time ─────────────────────────────────────────────────────────────────────

type SpanKind = "run" | "active" | "wait";
interface Span { id: string; kind: SpanKind; start: bigint; end: bigint | null; clock: TraceClock; agent: string | null; reason: string | null }
type Seg = [bigint, bigint];

const BASES = new Set(["controller", "local_monotonic", "provider", "unknown"]);
const SPAN_KEYS = new Set(["span_id", "kind", "interval", "agent_instance_id", "reason"]);
const INTERVAL_KEYS = new Set(["start", "end", "duration_ms", "clock"]);
const CLOCK_KEYS = new Set(["domain", "basis", "comparable", "skew_bound_ms"]);
const onlyKeys = (o: Record<string, unknown>, keys: ReadonlySet<string>) => Object.keys(o).every((k) => keys.has(k));

function parseClock(c: unknown): TraceClock | null {
  if (!isObj(c) || !onlyKeys(c, CLOCK_KEYS) || !isId(c.domain) || typeof c.basis !== "string" || !BASES.has(c.basis) || typeof c.comparable !== "boolean") return null;
  const skew = c.skew_bound_ms;
  if (skew !== null && (typeof skew !== "number" || !Number.isFinite(skew) || skew < 0)) return null;
  return { domain: c.domain, basis: c.basis as TraceClock["basis"], comparable: c.comparable, skew_bound_ms: skew as number | null };
}

/** Span, `"mismatch"` (duration disagrees with bounds), or null (malformed). */
function parseSpan(raw: Record<string, unknown>, kind: SpanKind): Span | "mismatch" | null {
  const iv = raw.interval;
  if (!onlyKeys(raw, SPAN_KEYS) || !isId(raw.span_id) || !isObj(iv) || !onlyKeys(iv, INTERVAL_KEYS)) return null;
  const agent = raw.agent_instance_id ?? null, reason = raw.reason ?? null;
  if ((agent !== null && !isId(agent)) || (reason !== null && !isId(reason))) return null;
  const clock = parseClock(iv.clock);
  if (!clock || typeof iv.start !== "string" || !isRfc3339(iv.start)) return null;
  if (iv.end !== null && (typeof iv.end !== "string" || !isRfc3339(iv.end))) return null;
  const d = iv.duration_ms;
  if (d !== null && (typeof d !== "number" || !Number.isFinite(d) || d < 0)) return null;
  if (d !== null && clock.basis === "unknown") return null;
  const start = traceInstantMicros(iv.start);
  let end = iv.end === null ? null : traceInstantMicros(iv.end as string);
  if (end !== null && end < start) return null;
  // An open span (end null) is open: a duration cannot close it.
  if (d !== null && end === null) return null;
  if (d !== null) {
    const dMicros = decimalScaled(d, 3);
    if (dMicros === null) return null;
    if (end - start - dMicros > 1000n || dMicros - (end - start) > 1000n) return "mismatch";
  }
  return { id: raw.span_id, kind, start, end, clock, agent: agent as string | null, reason: reason as string | null };
}

function unionLength(segs: readonly Seg[]): bigint { return measure(merge(segs)); }
function merge(segs: readonly Seg[]): Seg[] {
  const s = segs.filter(([a, b]) => b > a).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const out: Seg[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) { if (b > last[1]) last[1] = b; } else out.push([a, b]);
  }
  return out;
}
const measure = (segs: readonly Seg[]) => segs.reduce((s, [a, b]) => s + (b - a), 0n);
/** Length of `a` outside `b`; both merged. */
function outside(a: readonly Seg[], b: readonly Seg[]): bigint {
  let total = 0n;
  for (const [s, e] of a) {
    let covered = 0n;
    for (const [x, y] of b) {
      const lo = s > x ? s : x, hi = e < y ? e : y;
      if (hi > lo) covered += hi - lo;
    }
    total += e - s - covered;
  }
  return total;
}
const ms = (micros: bigint) => Number(micros) / 1000;

function nearestRank(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

/** `rawSpans: null` means no time instrumentation was supplied; it is never an empty, complete set. */
function normalizeTime(rawSpansOrNull: readonly unknown[] | null, asOf: string | null | undefined): RunTime {
  const rawSpans = rawSpansOrNull ?? [];
  const losses = new Losses();
  const eligible: Record<SpanKind, Set<string>> = { run: new Set(), active: new Set(), wait: new Set() };
  const byId = new Map<string, { sig: string; span: Span | null; kind: SpanKind }>();
  const conflicted = new Set<string>();
  const mismatched = new Set<string>();
  const groups = new Map<string, { kind: SpanKind | null; sig: string; parsed: Span | "mismatch" | null }[]>();
  let anonymous = 0;
  for (const raw of rawSpans) {
    const kind = isObj(raw) && (raw.kind === "run" || raw.kind === "active" || raw.kind === "wait") ? (raw.kind as SpanKind) : null;
    // A bad kind under a real span id still joins that id's group, where it conflicts.
    if (!kind && !(isObj(raw) && isId(raw.span_id))) { losses.add("invalid_span", "span is malformed"); continue; }
    const rec = raw as Record<string, unknown>;
    const parsed = kind ? parseSpan(rec, kind) : null;
    const id = isId(rec.span_id) ? rec.span_id : `\u0000anon-${anonymous++}`;
    // A malformed copy gets a unique signature: next to any other copy it is a conflict.
    const sig = parsed === null ? `\u0000invalid-${anonymous++}` : canonical(rec);
    if (parsed === null) losses.add("invalid_span", "span is malformed");
    push(groups, id, { kind, sig, parsed });
  }
  for (const [id, cs] of groups) {
    for (const c of cs) if (c.kind) eligible[c.kind].add(id);
    if (new Set(cs.map((c) => c.sig)).size > 1) { conflicted.add(id); losses.add("span_conflict", "one span id carries two intervals; all copies are excluded"); continue; }
    if (cs.length > 1) losses.add("duplicate_span", "identical span counted once", cs.length - 1);
    const { kind, sig, parsed } = cs[0]!;
    if (!kind) continue;
    if (parsed === "mismatch") mismatched.add(id);
    byId.set(id, { sig, span: parsed === "mismatch" ? null : parsed, kind });
  }
  if (mismatched.size) losses.add("duration_mismatch", "span duration disagrees with its bounds", mismatched.size);
  const live = (k: SpanKind) => [...byId.entries()].filter(([id, x]) => x.kind === k && x.span && !conflicted.has(id)).map(([, x]) => x.span!);

  // Anchor: the run interval's clock domain, or the single domain the spans share.
  const runs = live("run");
  const run = runs.length === 1 ? runs[0]! : null;
  const usable = (c: TraceClock) => c.comparable && c.basis !== "unknown";
  let anchor: TraceClock | null = run && usable(run.clock) ? run.clock : null;
  if (!run) {
    const domains = new Set([...live("active"), ...live("wait")].filter((s) => usable(s.clock)).map((s) => s.clock.domain));
    if (domains.size === 1) anchor = [...live("active"), ...live("wait")].find((s) => usable(s.clock))!.clock;
  }

  // Elapsed (M02).
  let elapsed: LedgerValue;
  let upper: bigint | null = null;
  const nRun = eligible.run.size;
  if (nRun === 0) elapsed = ledgerValue(null, [], "no run interval");
  else if (!run) elapsed = ledgerValue(nRun, [], runs.length > 1 ? "more than one run interval" : "run interval excluded");
  else if (!usable(run.clock)) elapsed = ledgerValue(nRun, [], "run clock unknown or not comparable; no elapsed time is claimed");
  else if (run.end !== null) { elapsed = ledgerValue(nRun, [ms(run.end - run.start)], null); upper = run.end; }
  else if (asOf && isRfc3339(asOf) && run.clock.basis === "controller" && traceInstantMicros(asOf) >= run.start) {
    const now = traceInstantMicros(asOf);
    // Elapsed so far is a value, not a covered terminal sample: partial, never exact.
    const cov: TraceCoverage = { ...coverageOf(nRun, 0, "run open; elapsed so far as of the controller instant"), state: "partial" };
    elapsed = { value: ms(now - run.start), known_subtotal: ms(now - run.start), exact_total: null, coverage: cov, reason: cov.reason };
    upper = now;
  } else elapsed = ledgerValue(nRun, [], "run open and no controller as_of");
  const lower = run && anchor === run.clock ? run.start : null;

  // Included spans in the anchor domain, clipped to the run.
  const skews: (number | null)[] = run && anchor === run.clock ? [run.clock.skew_bound_ms] : [];
  const reasons = new Map<SpanKind, Map<string, number>>([["active", new Map()], ["wait", new Map()]]);
  const exclude = (k: SpanKind, code: string) => { const m = reasons.get(k)!; m.set(code, (m.get(code) ?? 0) + 1); };
  const included = (k: SpanKind) => {
    const out: { span: Span; seg: Seg }[] = [];
    for (const s of live(k)) {
      if (!anchor || !usable(s.clock) || s.clock.domain !== anchor.domain) { exclude(k, "incomparable_clock"); continue; }
      if (s.end === null) { exclude(k, "open_interval"); continue; }
      const a = lower !== null && s.start < lower ? lower : s.start;
      const b = upper !== null && s.end > upper ? upper : s.end;
      out.push({ span: s, seg: [a, b > a ? b : a] });
      skews.push(s.clock.skew_bound_ms);
    }
    return out;
  };
  const active = included("active");
  const wait = included("wait");
  for (const k of ["active", "wait"] as const) for (const [code, n] of reasons.get(k)!) losses.add(code, code === "incomparable_clock" ? "span clock is another domain, unknown or not comparable" : "span has no end", n);
  const why = (k: SpanKind, n: number) => {
    const parts = [...reasons.get(k)!.entries()].map(([c, x]) => `${c}=${x}`);
    const other = eligible[k].size - n - [...reasons.get(k)!.values()].reduce((s, x) => s + x, 0);
    if (other > 0) parts.push(`invalid_or_conflicting=${other}`);
    return `${eligible[k].size - n} of ${eligible[k].size} ${k} spans excluded (${parts.sort().join(",")})`;
  };
  const activeSegs = merge(active.map((x) => x.seg));
  const fix = (covered: number, total: bigint | null, eligibleN: number, reason: string): LedgerValue => {
    // Without a clock anchor there is no instrumented window: zero spans are not zero time.
    if (!anchor) {
      const coverage = coverageOf(null, 0, rawSpansOrNull === null ? "no time instrumentation supplied" : "no run interval or common clock domain; time unavailable");
      return { value: null, known_subtotal: null, exact_total: null, coverage, reason: coverage.reason };
    }
    const coverage = coverageOf(eligibleN, covered, reason);
    if (total === null || (covered === 0 && coverage.state !== "complete")) return { value: null, known_subtotal: null, exact_total: null, coverage, reason: coverage.reason };
    const x = ms(total);
    return { value: x, known_subtotal: x, exact_total: coverage.state === "complete" ? x : null, coverage, reason: coverage.reason };
  };
  const nA = eligible.active.size, nW = eligible.wait.size;
  const activeV = fix(active.length, measure(activeSegs), nA, why("active", active.length));
  const agents = new Map<string, Seg[]>();
  for (const x of active) if (x.span.agent !== null) push(agents, x.span.agent, x.seg);
  const withAgent = active.filter((x) => x.span.agent !== null).length;
  const agentWork = [...agents.values()].reduce((s, segs) => s + unionLength(segs), 0n);
  const agentV = fix(withAgent, agentWork, nA, withAgent < active.length ? `${active.length - withAgent} active spans name no agent; ${why("active", active.length)}` : why("active", active.length));
  const waitSegs = merge(wait.map((x) => x.seg));
  const rawWaitV = fix(wait.length, measure(waitSegs), nW, why("wait", wait.length));
  const byReason = new Map<string, Seg[]>();
  for (const x of wait) push(byReason, x.span.reason ?? "unspecified", x.seg);
  const wait_by_reason = [...byReason.entries()].map(([reason, segs]) => ({ reason, ms: ms(unionLength(segs)) })).sort((a, b) => (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  const exclusiveV = activeV.coverage.state !== "complete"
    ? fix(0, null, nW, "active union incomplete; exclusive wait is not computable")
    : fix(wait.length, outside(waitSegs, activeSegs), nW, why("wait", wait.length));
  const durations = active.map((x) => (x.span.end! - x.span.start)).map(ms).sort((a, b) => a - b);
  return {
    elapsed_ms: elapsed, active_union_ms: activeV, agent_work_ms: agentV, raw_wait_ms: rawWaitV, exclusive_wait_ms: exclusiveV, wait_by_reason,
    active_latency_ms: { n: durations.length, p50: nearestRank(durations, 0.5), p95: nearestRank(durations, 0.95), excluded: nA - durations.length },
    clock: { domain: anchor?.domain ?? null, basis: anchor?.basis ?? null, skew_bound_ms: skews.length && skews.every((x) => x !== null) ? (skews as number[]).reduce((a, b) => (b > a ? b : a), 0) : null },
    losses: losses.list(),
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function normalizeRunLedger(input: RunLedgerInput): RunLedger {
  const losses = new Losses();
  const { prices, reason: priceRefusal } = resolvePrices(input.pricing);
  const u = normalizeUsage(input, prices, priceRefusal, losses);
  if (input.capture === null || input.capture.state !== "complete") {
    losses.add("capture_incomplete", input.capture?.reason ?? "trace capture coverage unknown", null);
  }
  const n = u.leaves.length + u.pending.length;
  const eligible = u.eligibleKnown ? n : null;
  const denomWhy = u.eligibleKnown ? null : "request denominator unknown: trace capture incomplete or events invalid";
  const why = (missingWhat: string, covered: number) =>
    denomWhy ?? `${n - covered} of ${n} requests lack ${missingWhat}; exact total unavailable`;
  const known = (k: (typeof COUNTERS)[number] | "total") => u.leaves.filter((l) => l.covered || (l.usage !== null && l.normalized_usage[k] !== null && l.normalized_usage.usage_semantics !== "unknown")).map((l) => l.normalized_usage[k]).filter((x): x is number => x !== null);
  const field = (k: (typeof COUNTERS)[number] | "total", what: string) => {
    const xs = known(k);
    return countValue(eligible, xs, why(what, xs.length));
  };
  const totals = known("total");
  const ratioPairs = u.leaves.map((l) => l.normalized_usage).filter((x) => x.usage_semantics !== "unknown" && x.input_inclusive !== null && x.cache_read_subset !== null);
  const num = sumCounts(ratioPairs.map((x) => x.cache_read_subset!)), den = sumCounts(ratioPairs.map((x) => x.input_inclusive!));
  const ratioCov = coverageOf(eligible, ratioPairs.length, why("compatible cache counters", ratioPairs.length));
  const cache_hit_ratio: LedgerRatio = den === null || den === 0 || num === null
    ? { value: null, numerator: num, denominator: den, coverage: ratioCov, reason: den === 0 ? "cache ratio denominator is 0" : (ratioCov.reason ?? "no compatible requests") }
    : { value: num / den, numerator: num, denominator: den, coverage: ratioCov, reason: ratioCov.reason };
  const reqCov = coverageOf(eligible, totals.length, why("usage", totals.length));
  const request_ratio: LedgerRatio = eligible === null || eligible === 0
    ? { value: null, numerator: totals.length, denominator: eligible, coverage: reqCov, reason: eligible === 0 ? "no requests" : (denomWhy as string) }
    : { value: totals.length / eligible, numerator: totals.length, denominator: eligible, coverage: coverageOf(1, 1, null), reason: null };

  const femtoOf = (l: LedgerLeaf) => u.femto.get(l.accounting_identity)!;
  const derivedF = u.leaves.map((l) => femtoOf(l).derived).filter((x): x is bigint => x !== null);
  const measuredF = u.leaves.map((l) => femtoOf(l).measured).filter((x): x is bigint => x !== null);
  const derivedWhy = prices ? why("a derived estimate (unpriced or unknown usage)", derivedF.length) : priceRefusal;
  const measured = costValue("measured", null, eligible, measuredF, measuredF.length ? why("measured billing", measuredF.length) : "measured billing unavailable; derived estimate is separate");
  const derived_estimate = costValue("derived_estimate", prices?.version ?? null, eligible, derivedF, derivedWhy);
  const nativeEligible = input.capture?.state === "complete" && u.invalid === 0 ? u.nativeSessions : null;
  const native_estimate = costValue("native_estimate", null, nativeEligible, u.nativeFemto, u.nativeSessions ? "native session estimate incomplete" : "no native session estimate observed");

  let budget: BudgetEstimate | null = null;
  if (input.budget) {
    const thr = usdToFemto(input.budget.threshold_usd);
    const est = native_estimate.exact_total === null ? null : u.nativeFemto.reduce((s, x) => s + x, 0n);
    const ok = thr !== null && est !== null;
    budget = {
      threshold_usd: input.budget.threshold_usd, basis: "native_estimate", strict_ceiling: false,
      known_estimate_usd: native_estimate.exact_total,
      remaining_usd: ok ? femtoToUsd(thr! > est! ? thr! - est! : 0n) : null,
      overshoot_usd: ok ? femtoToUsd(est! > thr! ? est! - thr! : 0n) : null,
      reason: thr === null ? "threshold invalid" : est === null ? "native spend estimate unknown; remaining and overshoot unavailable" : null,
    };
  }

  // Attribution.
  const groups = new Map<string, { key: AllocationKey; leaves: LedgerLeaf[] }>();
  for (const l of u.leaves) {
    if (l.allocation !== "allocated") continue;
    const key: AllocationKey = { execution_id: l.execution_id!, logical_task_id: l.logical_task_id!, attempt_id: l.attempt_id, agent_instance_id: l.agent_instance_id, observed_model: l.observed_identity.status === "observed" ? l.observed_identity.model : null };
    const k = canonical([key.logical_task_id, key.attempt_id, key.agent_instance_id, key.execution_id, key.observed_model]);
    if (!groups.has(k)) groups.set(k, { key, leaves: [] });
    groups.get(k)!.leaves.push(l);
  }
  const tokensOf = (ls: LedgerLeaf[], eligibleN: number | null) => {
    const xs = ls.filter((l) => l.covered).map((l) => l.normalized_usage.total!);
    return countValue(eligibleN, xs, eligibleN === null ? (denomWhy as string) : `${eligibleN - xs.length} of ${eligibleN} requests lack usage`);
  };
  const usdOf = (ls: LedgerLeaf[], eligibleN: number | null) => {
    const xs = ls.map((l) => femtoOf(l).derived).filter((x): x is bigint => x !== null);
    const c = costValue("derived_estimate", prices?.version ?? null, eligibleN, xs, eligibleN === null ? (denomWhy as string) : `${eligibleN - xs.length} of ${eligibleN} requests lack a derived estimate`);
    return { value: c.value, known_subtotal: c.known_subtotal, exact_total: c.exact_total, coverage: c.coverage, reason: c.reason };
  };
  const unalloc = u.leaves.filter((l) => l.allocation === "unallocated");
  const unallocEligible = eligible === null ? null : unalloc.length + u.pending.length;
  const allocation = {
    groups: [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, g]) => ({
      key: g.key, request_ids: g.leaves.map((l) => l.accounting_identity), tokens: tokensOf(g.leaves, eligible === null ? null : g.leaves.length), derived_estimate_usd: usdOf(g.leaves, eligible === null ? null : g.leaves.length),
    })),
    unallocated: { tokens: tokensOf(unalloc, unallocEligible), derived_estimate_usd: usdOf(unalloc, unallocEligible) },
    unallocated_request_ids: unalloc.map((l) => l.accounting_identity).sort(),
  };

  return {
    schema_version: RUN_LEDGER_SCHEMA,
    versions: { ...RUN_LEDGER_VERSIONS, pricing: prices?.version ?? null },
    source_id: input.source_id, run_id: input.run_id,
    leaves: u.leaves,
    usage: {
      input: field("input_inclusive", "final input"), output: field("output", "final output"),
      cache_read: field("cache_read_subset", "cache-read counters"), cache_write: field("cache_write_subset", "cache-write counters"),
      total: countValue(eligible, totals, why("usage", totals.length)), cache_hit_ratio,
    },
    cost: { measured, derived_estimate, native_estimate, budget },
    coverage: { requests: reqCov, request_ratio, pending_requests: u.pending, duplicates: u.duplicates, invalid_events: u.invalid },
    allocation,
    time: normalizeTime(input.spans ?? null, input.as_of),
    losses: losses.list(),
  };
}
