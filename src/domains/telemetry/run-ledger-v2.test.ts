/**
 * T02 · run ledger normalization (AT23 usage arithmetic, AT24 pricing and
 * attribution, AT25 time oracle) over T01 `guild.trace.analysis.v3` events.
 *
 * The A02 golden fixtures GF1/GF2 are vendored; when the frozen checkout is
 * present (A02_CONTRACT_ROOT or <umbrella>/contracts/guild-stack/v2) the vendored
 * subset must equal it, and T02_REQUIRE_A02=1 makes that check mandatory.
 * Property tests use a seeded generator and a brute-force oracle.
 */
import { describe, it, expect } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { validateTraceAnalysisV3, type TraceAnalysisV3, type TraceCoverage, type TraceUsage } from "./trace-analysis-v3";
import { normalizeRunLedger, type PriceTable, type RunLedger, type RunLedgerInput } from "./run-ledger-v2";
import { openTraceCapture, readTrace, type TraceAuthority } from "./trace-capture-v3";
import * as os from "node:os";

const PLUGIN_ROOT = path.resolve(__dirname, "../../..");
const VENDORED = path.join(__dirname, "run-ledger-v2.a02-golden.json");
const A02_ROOT = process.env["A02_CONTRACT_ROOT"] ?? path.resolve(PLUGIN_ROOT, "../contracts/guild-stack/v2");
const A02_PRESENT = fs.existsSync(path.join(A02_ROOT, "fixtures", "golden.json"));
const vendored = JSON.parse(fs.readFileSync(VENDORED, "utf8")) as {
  source: { golden_sha256: string; bundle_sha256: string };
  fixtures: { id: string; tests: string[]; inputs: any; bindings: { id: string; expected: unknown }[]; refusals: { id: string; level: string; expected_error: string }[] }[];
};
const GF1 = vendored.fixtures.find((f) => f.id === "GF1")!;
const GF2 = vendored.fixtures.find((f) => f.id === "GF2")!;

// ── Builders ─────────────────────────────────────────────────────────────────

const H = `sha256:${"a".repeat(64)}`;
const PINS = { assignment: H, definition: H, configuration: H, workflow: H, policy: H };
const COMPLETE: TraceCoverage = { eligible: 1, covered: 1, excluded: 0, missing: 0, state: "complete", reason: null, exclusion_reasons: [] };
const SOURCE = "source-a";
const RUN = "run-t02";

interface UseSpec {
  acct: string; rev?: number; final?: boolean; inclusion?: TraceUsage["inclusion"];
  input?: number | null; cache?: number | null; write?: number | null; output?: number | null;
  measured?: number | null; semantics?: TraceUsage["usage_semantics"];
}
function use(u: UseSpec): TraceUsage {
  const input = u.input ?? null;
  const output = u.output ?? null;
  const known = [input, output, u.cache ?? null, u.write ?? null].some((x) => x !== null);
  const total = input !== null && output !== null ? input + output : null;
  const coverage: TraceCoverage = total !== null
    ? COMPLETE
    : { eligible: 1, covered: 0, excluded: 0, missing: 1, state: known ? "partial" : "unavailable", reason: "provider did not report usage", exclusion_reasons: [] };
  const measured = u.measured ?? null;
  return {
    granularity: "leaf_request", observation_id: `obs-${u.acct}-${u.rev ?? 1}`, revision: u.rev ?? 1, final: u.final ?? true,
    accounting_identity: u.acct, parent_accounting_identity: null, inclusion: u.inclusion ?? "leaf_exclusive",
    input_inclusive: known ? input : null, output: known ? output : null, cache_read_subset: known ? (u.cache ?? null) : null,
    cache_write_subset: known ? (u.write ?? null) : null, total: known ? total : null,
    cost_usd: measured, cost_basis: measured === null ? "unavailable" : "measured", currency: "USD", pricing_version: null,
    usage_semantics: u.semantics ?? (known ? "inclusive_input_cache_subset.v1" : "unknown"),
    coverage, native_baseline_usd: null, native_cumulative_usd: null,
  };
}
function nativeUse(acct: string, rev: number, final: boolean, baseline: number, cumulative: number): TraceUsage {
  return {
    granularity: "native_session", observation_id: `obs-${acct}-${rev}`, revision: rev, final, accounting_identity: acct,
    parent_accounting_identity: null, inclusion: "session_cumulative", input_inclusive: null, output: null,
    cache_read_subset: null, cache_write_subset: null, total: null, cost_usd: Number((cumulative - baseline).toFixed(12)),
    cost_basis: "native_estimate", currency: "USD", pricing_version: null, usage_semantics: "provider_session_only.v1",
    coverage: COMPLETE, native_baseline_usd: baseline, native_cumulative_usd: cumulative,
  };
}

let seq = 0;
interface EvSpec {
  id: string; usage?: TraceUsage | null; request?: string | null; cls?: TraceAnalysisV3["event_class"];
  task?: string | null; attempt?: string | null; agent?: string | null; exec?: string;
  requested?: string | null; observed?: { provider: string; model: string } | null; source?: string; run?: string;
}
function ev(s: EvSpec): TraceAnalysisV3 {
  const cls = s.cls ?? "request_completed";
  const request = s.request === undefined ? (s.usage?.accounting_identity ?? null) : s.request;
  const observed = s.observed === undefined ? { provider: "provider", model: "observed-model" } : s.observed;
  return {
    schema_version: "guild.trace.analysis.v3", event_id: s.id, sequence: seq++, event_class: cls, at: "2026-10-26T00:00:10Z",
    lineage: {
      source_id: s.source ?? SOURCE, run_id: s.run ?? RUN, execution_id: s.exec ?? "exec-1", host_session_id: "host-session-1",
      initiative_id: null, goal_id: null, logical_task_id: s.task ?? null, attempt_id: s.attempt ?? null,
      agent_instance_id: s.agent ?? null, request_id: request,
    },
    operation_id: null, component_invocation_id: null, actor_id: "agent-1", pins: PINS,
    requested_model: s.requested === undefined ? "requested-model" : s.requested,
    observed_identity: observed ? { ...observed, status: "observed", reason: null } : { provider: null, model: null, status: "unavailable", reason: "provider did not report provider and model" },
    usage: s.usage ?? null, payload_ref: null, prompt_hash: null, redaction_version: "guild.trace-scrub.v1",
    capture: COMPLETE, interval: null,
  };
}

const P1: PriceTable = {
  version: "p1", currency: "USD", source_hash: `sha256:${"d".repeat(64)}`,
  entries: [{ provider: "provider", model: "observed-model", uncached_input: 2, cache_read: 0.5, cache_write: null, output: 8 }],
};

/** GF1 observations as T01 events: provisional→final stream, mirror, parent-inclusive, retry, unknown. */
function gf1Events(): TraceAnalysisV3[] {
  const obs = GF1.inputs.observations as any[];
  const a = obs.filter((o) => o.identity === "request-a");
  const parent = obs.find((o) => o.identity === "parent-1");
  const b = obs.find((o) => o.identity === "request-b");
  const c = obs.find((o) => o.identity === "request-c");
  expect(parent.total).toBe(120);
  return [
    ev({ id: "ev-a1", task: "task-1", attempt: "attempt-a1", agent: "agent-1", usage: use({ acct: "request-a", rev: a[0].revision, final: a[0].final, input: a[0].input, cache: a[0].cache, write: 0, output: a[0].output }) }),
    ev({ id: "ev-a2", task: "task-1", attempt: "attempt-a1", agent: "agent-1", usage: use({ acct: "request-a", rev: a[1].revision, final: a[1].final, input: a[1].input, cache: a[1].cache, write: 0, output: a[1].output }) }),
    // The mirror repeats request-a's final revision under another observation.
    ev({ id: "ev-a2-mirror", task: "task-1", attempt: "attempt-a1", agent: "agent-1", usage: use({ acct: "request-a", rev: a[2].revision, final: a[2].final, input: a[2].input, cache: a[2].cache, write: 0, output: a[2].output }) }),
    // A parent-inclusive counter of 120 (input 100 + output 20): the validator needs total = input + output.
    ev({ id: "ev-parent", usage: use({ acct: "parent-1", inclusion: "parent_inclusive", input: 100, cache: 40, write: 0, output: 20 }) }),
    ev({ id: "ev-b", task: "task-2", attempt: "attempt-b2", agent: "agent-2", usage: use({ acct: "request-b", input: b.input, cache: b.cache, write: 0, output: b.output }) }),
    ev({ id: "ev-c", usage: use({ acct: "request-c", input: c.input, cache: c.cache, output: c.output }) }),
  ];
}
const base = (over: Partial<RunLedgerInput> = {}): RunLedgerInput => ({
  source_id: SOURCE, run_id: RUN, events: [], capture: COMPLETE, spans: [], pricing: null, budget: null, as_of: null, ...over,
});
const leafOf = (l: RunLedger, acct: string) => l.leaves.find((x) => x.accounting_identity === acct)!;
const loss = (l: RunLedger, code: string) => l.losses.find((x) => x.code === code)?.count ?? 0;

function coverageOk(c: TraceCoverage): boolean {
  if (c.eligible !== null && c.covered > c.eligible) return false;
  if (c.eligible !== null && c.missing !== null && c.covered + c.missing !== c.eligible) return false;
  if (c.state === "complete") return c.eligible !== null && c.covered === c.eligible && c.missing === 0 && c.reason === null;
  if (!c.reason) return false;
  return c.state !== "unavailable" || c.covered === 0;
}

// ── Frozen fixture parity ────────────────────────────────────────────────────

describe("T02 vendored A02 golden subset", () => {
  it("equals the frozen GF1/GF2 fixtures (mandatory when T02_REQUIRE_A02=1)", () => {
    if (!A02_PRESENT) {
      expect(process.env["T02_REQUIRE_A02"]).not.toBe("1");
      return;
    }
    const raw = fs.readFileSync(path.join(A02_ROOT, "fixtures", "golden.json"));
    expect(`sha256:${crypto.createHash("sha256").update(raw).digest("hex")}`).toBe(vendored.source.golden_sha256);
    const frozen = JSON.parse(raw.toString("utf8")).fixtures as any[];
    for (const f of vendored.fixtures) {
      const g = frozen.find((x) => x.id === f.id);
      expect(f.inputs).toEqual(g.inputs);
      expect(f.bindings).toEqual(g.bindings);
      expect(f.refusals).toEqual(g.refusals.map((r: any) => ({ id: r.id, level: r.level, expected_error: r.expected_error })));
    }
  });
});

// ── AT23 · usage arithmetic ──────────────────────────────────────────────────

describe("AT23 · usage arithmetic", () => {
  const l = normalizeRunLedger(base({ events: gf1Events(), pricing: P1 }));
  const expected = Object.fromEntries(GF1.bindings.map((b) => [b.id, b.expected]));

  it("GF1 bindings: known input150/cache40/output30, total180, exact null, coverage 2/3", () => {
    expect(l.usage.input.value).toBe(expected["GF1.input_tokens"] as number);
    expect(l.usage.cache_read.value).toBe(expected["GF1.cache_read_tokens"] as number);
    expect(l.usage.output.value).toBe(expected["GF1.output_tokens"] as number);
    expect(l.usage.total.value).toBe(expected["GF1.total_tokens"] as number);
    expect(l.usage.total.known_subtotal).toBe(expected["GF1.total_known_subtotal"] as number);
    expect(l.usage.total.exact_total).toBe(expected["GF1.total_exact"] as null);
    expect(l.usage.total.coverage.covered).toBe(expected["GF1.total_covered"] as number);
    expect(l.usage.total.coverage.eligible).toBe(expected["GF1.total_eligible"] as number);
    expect(l.coverage.request_ratio.value).toBe(expected["GF1.coverage_ratio"] as number);
    expect(l.coverage.duplicates).toBe(expected["GF1.mirror_suppressed"] as number);
    expect(l.usage.input.exact_total).toBeNull();
    expect(l.usage.input.coverage.state).toBe("partial");
  });

  it("total is input + output on the identical request set; cache is never added (negative control 220)", () => {
    expect(l.usage.total.value).toBe(l.usage.input.value! + l.usage.output.value!);
    expect(l.usage.total.value).not.toBe(220);
  });

  it("parent-inclusive and mirror add 0; provisional stream revision is superseded", () => {
    expect(loss(l, "parent_inclusive_excluded")).toBe(1);
    expect(loss(l, "mirror_suppressed")).toBe(1);
    expect(loss(l, "provisional_superseded")).toBe(1);
    expect(l.leaves.map((x) => x.accounting_identity).sort()).toEqual(["request-a", "request-b", "request-c"]);
    expect(leafOf(l, "request-a").usage!.revision).toBe(2);
  });

  it("unknown usage is null with reason, never zero; unknown task stays unallocated", () => {
    const c = leafOf(l, "request-c");
    expect(c.covered).toBe(false);
    expect(c.usage!.total).toBeNull();
    expect(c.reason).toBeTruthy();
    expect(l.allocation.unallocated_request_ids).toEqual(["request-c"]);
  });

  it("retry is billed as a distinct request", () => {
    const retry = ev({ id: "ev-b-retry", task: "task-2", attempt: "attempt-b1", usage: use({ acct: "request-b-attempt-1", input: 50, cache: 0, write: 0, output: 10 }) });
    const r = normalizeRunLedger(base({ events: [...gf1Events(), retry] }));
    expect(r.usage.total.known_subtotal).toBe(240);
  });

  it("stale cumulative stream revisions never sum (negative control)", () => {
    const stream = [1, 2, 3].map((rev) => ev({ id: `ev-s${rev}`, usage: use({ acct: "req-s", rev, final: rev === 3, input: 10 * rev, cache: 0, output: rev }) }));
    const r = normalizeRunLedger(base({ events: stream }));
    expect(r.usage.input.exact_total).toBe(30);
    expect(r.usage.output.exact_total).toBe(3);
    expect(loss(r, "provisional_superseded")).toBe(2);
  });

  it("a stream with no final revision is not covered", () => {
    const r = normalizeRunLedger(base({ events: [ev({ id: "ev-p1", usage: use({ acct: "req-p", final: false, input: 5, output: 1 }) })] }));
    expect(r.usage.total.exact_total).toBeNull();
    expect(r.usage.total.coverage.covered).toBe(0);
    expect(r.usage.total.value).toBeNull();
    expect(r.usage.total.reason).toBeTruthy();
  });

  it("a counter that decreases across revisions makes the request unknown", () => {
    const r = normalizeRunLedger(base({ events: [
      ev({ id: "ev-m1", usage: use({ acct: "req-m", rev: 1, final: false, input: 50, output: 9 }) }),
      ev({ id: "ev-m2", usage: use({ acct: "req-m", rev: 2, final: true, input: 40, output: 9 }) }),
    ] }));
    expect(leafOf(r, "req-m").covered).toBe(false);
    expect(loss(r, "non_monotonic_revision")).toBe(1);
  });

  it("an identical replay is a duplicate; the same event id with other content poisons the request", () => {
    const e = ev({ id: "ev-r", usage: use({ acct: "req-r", input: 7, output: 3 }) });
    const r1 = normalizeRunLedger(base({ events: [e, structuredClone(e)] }));
    expect(r1.usage.total.exact_total).toBe(10);
    expect(loss(r1, "replayed_event")).toBe(1);
    const forged = structuredClone(e);
    forged.usage!.input_inclusive = 70; forged.usage!.total = 73;
    const r2 = normalizeRunLedger(base({ events: [e, forged] }));
    // Both copies are dropped and the request denominator becomes unknown (R2-F8).
    expect(r2.leaves).toEqual([]);
    expect(r2.usage.total.known_subtotal).toBeNull();
    expect(r2.usage.total.coverage.eligible).toBeNull();
    expect(loss(r2, "event_id_conflict")).toBe(1);
  });

  it("two observations of one revision with different counters are a conflict, not a mirror", () => {
    const r = normalizeRunLedger(base({ events: [
      ev({ id: "ev-x1", usage: use({ acct: "req-x", input: 7, output: 3 }) }),
      ev({ id: "ev-x2", usage: use({ acct: "req-x", input: 8, output: 3 }) }),
    ] }));
    expect(leafOf(r, "req-x").covered).toBe(false);
    expect(loss(r, "revision_conflict")).toBe(1);
  });

  it("untrusted bytes: invalid, foreign and non-object events are counted losses, not usage", () => {
    const bad = ev({ id: "ev-bad", usage: use({ acct: "req-bad", input: 5, output: 1 }) });
    bad.usage!.total = 99;
    const foreign = ev({ id: "ev-f", run: "run-other", usage: use({ acct: "req-f", input: 5, output: 1 }) });
    const otherSource = ev({ id: "ev-o", source: "source-b", usage: use({ acct: "req-o", input: 5, output: 1 }) });
    const r = normalizeRunLedger(base({ events: [bad, foreign, otherSource, null, "{", 7, { schema_version: "guild.trace.analysis.v3" }] }));
    expect(r.leaves).toEqual([]);
    expect(loss(r, "invalid_event")).toBe(5);
    expect(loss(r, "foreign_event")).toBe(2);
    expect(r.usage.total.known_subtotal).toBeNull();
  });

  it("an incomplete capture makes the request denominator unknown", () => {
    const partial: TraceCoverage = { eligible: null, covered: 4, excluded: 0, missing: null, state: "partial", reason: "loss_unknown_size=1", exclusion_reasons: [] };
    for (const capture of [partial, null]) {
      const r = normalizeRunLedger(base({ events: [ev({ id: "ev-k", usage: use({ acct: "req-k", input: 5, output: 1 }) })], capture }));
      expect(r.usage.total.coverage.eligible).toBeNull();
      expect(r.usage.total.exact_total).toBeNull();
      expect(r.usage.total.known_subtotal).toBe(6);
      expect(r.coverage.request_ratio.value).toBeNull();
    }
  });

  it("a request that started but never completed is eligible and missing", () => {
    const started = ev({ id: "ev-st", cls: "request_started", request: "req-open", usage: null });
    const r = normalizeRunLedger(base({ events: [started, ev({ id: "ev-done", usage: use({ acct: "req-done", input: 5, output: 1 }) })] }));
    expect(r.usage.total.coverage.eligible).toBe(2);
    expect(r.usage.total.exact_total).toBeNull();
  });

  it("usage with unknown semantics or leaf session semantics is not billable", () => {
    const r = normalizeRunLedger(base({ events: [ev({ id: "ev-u", usage: use({ acct: "req-u", input: 5, output: 1, semantics: "unknown" }) })] }));
    expect(leafOf(r, "req-u").covered).toBe(false);
  });

  it("cache ratio is covered cache-read over input on compatible requests; denominator 0 unavailable", () => {
    expect(l.usage.cache_hit_ratio.numerator).toBe(40);
    expect(l.usage.cache_hit_ratio.denominator).toBe(150);
    const z = normalizeRunLedger(base({ events: [ev({ id: "ev-z", usage: use({ acct: "req-z", input: 0, cache: 0, output: 4 }) })] }));
    expect(z.usage.cache_hit_ratio.value).toBeNull();
    expect(z.usage.cache_hit_ratio.reason).toBeTruthy();
  });

  it("every emitted coverage obeys the frozen coverage rules and every leaf record validates as v3 usage", () => {
    const cov: TraceCoverage[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        if ("covered" in v && "eligible" in v && "state" in v) cov.push(v as TraceCoverage);
        Object.values(v).forEach(walk);
      }
    };
    walk(l);
    expect(cov.length).toBeGreaterThan(5);
    for (const c of cov) expect(coverageOk(c)).toBe(true);
    for (const leaf of l.leaves) {
      const src = gf1Events().find((e) => e.usage?.accounting_identity === leaf.accounting_identity && e.usage.revision === leaf.usage!.revision)!;
      expect(validateTraceAnalysisV3({ ...src, usage: leaf.normalized_usage })).toEqual({ ok: true });
    }
  });
});

// ── AT24 · pricing and attribution ───────────────────────────────────────────

describe("AT24 · pricing and attribution", () => {
  const native = [
    ev({ id: "ev-n1", cls: "request_completed", request: "sess-1", usage: nativeUse("sess-1", 1, false, 0, 1), observed: null }),
    ev({ id: "ev-n2", cls: "request_completed", request: "sess-1", usage: nativeUse("sess-1", 2, true, 0, 1.08), observed: null }),
  ];
  const l = normalizeRunLedger(base({ events: [...gf1Events(), ...native], pricing: P1, budget: { threshold_usd: 1 } }));

  it("GF1: derived estimate 0.00048 USD, labelled estimate; measured unavailable, not 0", () => {
    expect(l.cost.derived_estimate.value).toBe(GF1.bindings.find((b) => b.id === "GF1.derived_estimate_usd")!.expected as number);
    expect(l.cost.derived_estimate.basis).toBe("derived_estimate");
    expect(l.cost.derived_estimate.pricing_version).toBe("p1");
    expect(l.cost.derived_estimate.exact_total).toBeNull();
    expect(l.cost.measured.value).toBeNull();
    expect(l.cost.measured.reason).toBeTruthy();
    expect(leafOf(l, "request-a").derived_estimate_usd).toBe(0.0003);
    expect(leafOf(l, "request-b").derived_estimate_usd).toBe(0.00018);
    expect(leafOf(l, "request-c").derived_estimate_usd).toBeNull();
  });

  it("requested and observed model stay separate; requested is never priced", () => {
    const a = leafOf(l, "request-a");
    expect(a.observed_identity.model).toBe(GF1.bindings.find((b) => b.id === "GF1.observed_model")!.expected as string);
    expect(a.requested_model).toBe(GF1.bindings.find((b) => b.id === "GF1.requested_model")!.expected as string);
    const unobserved = ev({ id: "ev-d", requested: "observed-model", observed: null, usage: use({ acct: "req-d", input: 10, cache: 0, write: 0, output: 1 }) });
    const r = normalizeRunLedger(base({ events: [unobserved], pricing: P1 }));
    expect(leafOf(r, "req-d").derived_estimate_usd).toBeNull();
    expect(r.cost.derived_estimate.value).toBeNull();
    expect(r.usage.total.exact_total).toBe(11);
  });

  it("native cumulative session spend uses the latest revision delta, never a sum, never measured", () => {
    expect(l.cost.native_estimate.value).toBe(1.08);
    expect(l.cost.native_estimate.value).not.toBe(2.08);
    expect(l.cost.native_estimate.basis).toBe("native_estimate");
    expect(l.cost.measured.value).toBeNull();
    // Session-only accounting hides how many leaf requests ran (R2-F7).
    expect(l.usage.total.coverage.eligible).toBeNull();
    expect(l.usage.total.known_subtotal).toBe(180);
  });

  it("budget threshold is an estimate: overshoot 0.08, remaining 0, not a strict cap", () => {
    expect(l.cost.budget!.overshoot_usd).toBe(0.08);
    expect(l.cost.budget!.remaining_usd).toBe(0);
    expect(l.cost.budget!.basis).toBe("native_estimate");
    expect(l.cost.budget!.strict_ceiling).toBe(false);
    const unknown = normalizeRunLedger(base({ events: gf1Events(), budget: { threshold_usd: 1 } }));
    expect(unknown.cost.budget!.overshoot_usd).toBeNull();
    expect(unknown.cost.budget!.remaining_usd).toBeNull();
  });

  it("measured cost is a separate series from the derived estimate", () => {
    const r = normalizeRunLedger(base({ events: [ev({ id: "ev-ms", usage: use({ acct: "req-ms", input: 100, cache: 40, write: 0, output: 20, measured: 0.001 }) })], pricing: P1 }));
    expect(r.cost.measured.exact_total).toBe(0.001);
    expect(r.cost.derived_estimate.exact_total).toBe(0.0003);
  });

  it("task allocated + unallocated reconciles the known ledger; ambiguous bindings stay unallocated", () => {
    const sumTokens = l.allocation.groups.reduce((s, g) => s + (g.tokens.known_subtotal ?? 0), 0) + (l.allocation.unallocated.tokens.known_subtotal ?? 0);
    expect(sumTokens).toBe(l.usage.total.known_subtotal!);
    const sumUsd = l.allocation.groups.reduce((s, g) => s + (g.derived_estimate_usd.known_subtotal ?? 0), 0);
    expect(sumUsd).toBeCloseTo(l.cost.derived_estimate.known_subtotal!, 15);
    expect(l.allocation.groups.map((g) => [g.key.logical_task_id, g.tokens.known_subtotal])).toEqual([["task-1", 120], ["task-2", 60]]);
    const ambiguous = gf1Events();
    ambiguous[2] = ev({ id: "ev-a2-mirror", task: "task-9", attempt: "attempt-9", usage: ambiguous[2]!.usage });
    const r = normalizeRunLedger(base({ events: ambiguous }));
    expect(r.allocation.unallocated_request_ids).toEqual(["request-a", "request-c"]);
    expect(r.allocation.groups.map((g) => g.key.logical_task_id)).toEqual(["task-2"]);
    expect(leafOf(r, "request-a").allocation_reason).toMatch(/conflict/);
  });

  it("a non-USD price table refuses the derived aggregate; a write-priced gap refuses the leaf", () => {
    const eur = normalizeRunLedger(base({ events: gf1Events(), pricing: { ...P1, currency: "EUR" } }));
    expect(eur.cost.derived_estimate.value).toBeNull();
    expect(eur.cost.derived_estimate.reason).toMatch(/currency/);
    const w = normalizeRunLedger(base({ events: [ev({ id: "ev-w", usage: use({ acct: "req-w", input: 100, cache: 0, write: 30, output: 1 }) })], pricing: P1 }));
    expect(leafOf(w, "req-w").derived_estimate_usd).toBeNull();
  });

  it("an invalid price entry prices nothing", () => {
    for (const bad of [-1, Number.NaN, Infinity, 1e-12]) {
      const r = normalizeRunLedger(base({ events: gf1Events(), pricing: { ...P1, entries: [{ ...P1.entries[0]!, output: bad }] } }));
      expect(r.cost.derived_estimate.value).toBeNull();
    }
  });
});

// ── AT25 · time oracle ───────────────────────────────────────────────────────

const iv = (start: number | null, end: number | null, clock: Record<string, unknown> = GF2.inputs.run.clock) => ({
  start: start === null ? "nope" : new Date(Date.UTC(2026, 9, 26) + start).toISOString(),
  end: end === null ? null : new Date(Date.UTC(2026, 9, 26) + end).toISOString(),
  duration_ms: end === null || start === null ? null : end - start,
  clock,
});
const gf2Spans = () => [
  { span_id: "run", kind: "run", interval: GF2.inputs.run, agent_instance_id: null, reason: null },
  ...GF2.inputs.active.map((a: any, i: number) => ({ span_id: `active-${i}`, kind: "active", interval: { start: a.start, end: a.end, duration_ms: a.duration_ms, clock: a.clock }, agent_instance_id: a.agent, reason: null })),
  ...GF2.inputs.wait.map((w: any, i: number) => ({ span_id: `wait-${i}`, kind: "wait", interval: { start: w.start, end: w.end, duration_ms: w.duration_ms, clock: w.clock }, agent_instance_id: null, reason: w.reason })),
];

describe("AT25 · time oracle", () => {
  const t = normalizeRunLedger(base({ spans: gf2Spans() })).time;
  const want = Object.fromEntries(GF2.bindings.map((b) => [b.id, b.expected]));

  it("GF2: elapsed20, active union15, agent work20, raw wait6, exclusive wait3", () => {
    expect(t.elapsed_ms.exact_total).toBe(want["GF2.elapsed_ms"] as number);
    expect(t.active_union_ms.exact_total).toBe(want["GF2.active_union_ms"] as number);
    expect(t.agent_work_ms.exact_total).toBe(want["GF2.agent_work_ms"] as number);
    expect(t.raw_wait_ms.exact_total).toBe(want["GF2.raw_wait_ms"] as number);
    expect(t.exclusive_wait_ms.exact_total).toBe(want["GF2.exclusive_wait_ms"] as number);
    expect(t.wait_by_reason).toEqual([{ reason: "operator", ms: 6 }]);
    expect(t.clock).toEqual({ domain: "controller-a", basis: "controller", skew_bound_ms: 0 });
  });

  it("negative controls: elapsed is not summed spans (26), active does not add overlaps (20)", () => {
    expect(t.elapsed_ms.value).not.toBe(26);
    expect(t.active_union_ms.value).not.toBe(20);
  });

  it("an incomparable host clock is excluded from the union, never subtracted", () => {
    const host = { domain: "host-b", basis: "controller", comparable: false, skew_bound_ms: null };
    const r = normalizeRunLedger(base({ spans: [...gf2Spans(), { span_id: "active-host", kind: "active", interval: iv(16, 19, host), agent_instance_id: "agent-3", reason: null }] })).time;
    expect(r.active_union_ms.value).toBe(15);
    expect(r.active_union_ms.exact_total).toBeNull();
    expect(r.active_union_ms.coverage.state).toBe("partial");
    expect(r.active_union_ms.reason).toMatch(/clock/);
  });

  it("skew is reported, and an unknown clock claims no elapsed time", () => {
    const skewed = { domain: "controller-a", basis: "controller", comparable: true, skew_bound_ms: 5 };
    const r = normalizeRunLedger(base({ spans: [...gf2Spans(), { span_id: "active-s", kind: "active", interval: iv(1, 2, skewed), agent_instance_id: "agent-1", reason: null }] })).time;
    expect(r.clock.skew_bound_ms).toBe(5);
    const unknown = { domain: "host-x", basis: "unknown", comparable: false, skew_bound_ms: null };
    const u = normalizeRunLedger(base({ spans: [{ span_id: "run", kind: "run", interval: { ...iv(0, 20, unknown), duration_ms: null }, agent_instance_id: null, reason: null }] })).time;
    expect(u.elapsed_ms.value).toBeNull();
    expect(u.elapsed_ms.reason).toBeTruthy();
  });

  it("an open run reports elapsed so far against as_of as partial", () => {
    const r = normalizeRunLedger(base({ spans: [{ span_id: "run", kind: "run", interval: iv(0, null), agent_instance_id: null, reason: null }], as_of: new Date(Date.UTC(2026, 9, 26) + 12).toISOString() })).time;
    expect(r.elapsed_ms.value).toBe(12);
    expect(r.elapsed_ms.exact_total).toBeNull();
    expect(r.elapsed_ms.coverage.state).toBe("partial");
  });

  it("spans are clipped to the run interval; duration mismatch, open and malformed spans are excluded", () => {
    const r = normalizeRunLedger(base({ spans: [
      { span_id: "run", kind: "run", interval: iv(0, 20), agent_instance_id: null, reason: null },
      { span_id: "a1", kind: "active", interval: iv(15, 30), agent_instance_id: "agent-1", reason: null },
      { span_id: "a2", kind: "active", interval: { ...iv(0, 5), duration_ms: 50 }, agent_instance_id: "agent-1", reason: null },
      { span_id: "a3", kind: "active", interval: iv(2, null), agent_instance_id: "agent-1", reason: null },
      { span_id: "a4", kind: "active", interval: iv(null, 3), agent_instance_id: "agent-1", reason: null },
      { span_id: "a5", kind: "active", interval: iv(9, 4), agent_instance_id: "agent-1", reason: null },
      "garbage",
    ] })).time;
    expect(r.active_union_ms.value).toBe(5);
    expect(r.active_union_ms.coverage.covered).toBe(1);
    expect(r.active_union_ms.coverage.eligible).toBe(5);
    expect(r.losses.find((x) => x.code === "invalid_span")!.count).toBe(3);
  });

  it("a duplicate span id is counted once; conflicting content excludes both", () => {
    const spans = gf2Spans();
    const r = normalizeRunLedger(base({ spans: [...spans, structuredClone(spans[1]!)] })).time;
    expect(r.active_union_ms.exact_total).toBe(15);
    const forged = { ...structuredClone(spans[1]!), interval: { ...spans[1]!.interval, end: "2026-10-26T00:00:00.019Z", duration_ms: 19 } };
    const c = normalizeRunLedger(base({ spans: [...spans, forged] })).time;
    expect(c.active_union_ms.exact_total).toBeNull();
    expect(c.losses.find((x) => x.code === "span_conflict")!.count).toBe(1);
  });

  it("latency distribution is nearest-rank over completed spans with n", () => {
    expect(t.active_latency_ms).toEqual({ n: 2, p50: 10, p95: 10, excluded: 0 });
  });
});

// ── Property tests ───────────────────────────────────────────────────────────

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, n: number) => Math.floor(r() * n);
function shuffle<T>(r: () => number, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = int(r, i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

interface Truth { acct: string; input: number | null; cache: number | null; output: number | null; task: string | null; priced: boolean }
function genUsage(seed: number) {
  const r = rng(seed);
  const truth: Truth[] = [];
  const events: TraceAnalysisV3[] = [];
  const n = 1 + int(r, 8);
  for (let i = 0; i < n; i++) {
    const acct = `req-${i}`;
    const unknown = r() < 0.2;
    const input = unknown ? null : int(r, 5000);
    const cache = input === null ? null : int(r, input + 1);
    const output = unknown ? null : int(r, 2000);
    const task = r() < 0.7 ? `task-${int(r, 3)}` : null;
    const priced = r() < 0.8;
    truth.push({ acct, input, cache, output, task, priced });
    const at = { task, attempt: task ? `att-${i}` : null, agent: task ? `agent-${i % 2}` : null, observed: priced ? { provider: "provider", model: "observed-model" } : null };
    const revs = unknown ? 0 : int(r, 3);
    for (let k = 1; k <= revs; k++) {
      const f = k / (revs + 1);
      events.push(ev({ id: `ev-${i}-p${k}`, ...at, usage: use({ acct, rev: k, final: false, input: Math.floor(input! * f), cache: Math.floor(cache! * f), write: 0, output: Math.floor(output! * f) }) }));
    }
    const fin = ev({ id: `ev-${i}-f`, ...at, usage: use({ acct, rev: revs + 1, final: true, input, cache, write: input === null ? null : 0, output }) });
    events.push(fin);
    if (r() < 0.3) events.push(structuredClone(fin));
    if (r() < 0.3) events.push(ev({ id: `ev-${i}-mirror`, ...at, usage: structuredClone(fin.usage) }));
    if (r() < 0.2) events.push(ev({ id: `ev-${i}-parent`, usage: use({ acct: `parent-${i}`, inclusion: "parent_inclusive", input: 9999, cache: 0, output: 9999 }) }));
  }
  return { truth, events: shuffle(r, events) };
}

/** Brute-force oracle in integer femto-USD per 1M tokens: (uncached*2 + cache*0.5 + output*8) / 1e6. */
const oracleUsd = (t: Truth) => (t.input === null || !t.priced ? null : Number(BigInt(t.input - t.cache!) * 2000n + BigInt(t.cache!) * 500n + BigInt(t.output!) * 8000n) / 1e9);

describe("property · usage, cost and attribution invariants", () => {
  const SEEDS = Array.from({ length: 300 }, (_, i) => 1000 + i);

  it("matches the oracle and is invariant under order, replays, mirrors and parent counters", () => {
    for (const seed of SEEDS) {
      const { truth, events } = genUsage(seed);
      const l = normalizeRunLedger(base({ events, pricing: P1 }));
      const known = truth.filter((t) => t.input !== null);
      const sum = (f: (t: Truth) => number) => known.reduce((s, t) => s + f(t), 0);
      const ctx = `seed ${seed}`;
      expect([ctx, l.usage.input.known_subtotal]).toEqual([ctx, known.length ? sum((t) => t.input!) : null]);
      expect([ctx, l.usage.output.known_subtotal]).toEqual([ctx, known.length ? sum((t) => t.output!) : null]);
      expect([ctx, l.usage.cache_read.known_subtotal]).toEqual([ctx, known.length ? sum((t) => t.cache!) : null]);
      expect([ctx, l.usage.total.known_subtotal]).toEqual([ctx, known.length ? sum((t) => t.input! + t.output!) : null]);
      expect([ctx, l.usage.total.exact_total]).toEqual([ctx, known.length === truth.length ? sum((t) => t.input! + t.output!) : null]);
      expect(l.usage.total.coverage.eligible).toBe(truth.length);
      expect(l.usage.total.coverage.covered).toBe(known.length);
      // cache is a subset: never above input on the same set, never added to total
      if (known.length) expect(l.usage.cache_read.known_subtotal!).toBeLessThanOrEqual(l.usage.input.known_subtotal!);
      // exact derived estimate per leaf and in aggregate
      const priced = truth.map(oracleUsd).filter((x): x is number => x !== null);
      for (const t of truth) expect([ctx, t.acct, leafOf(l, t.acct).derived_estimate_usd]).toEqual([ctx, t.acct, oracleUsd(t)]);
      const leafSum = l.leaves.reduce((s, x) => s + BigInt(Math.round((x.derived_estimate_usd ?? 0) * 1e9)), 0n);
      expect([ctx, l.cost.derived_estimate.known_subtotal === null ? null : Math.round(l.cost.derived_estimate.known_subtotal * 1e9)]).toEqual([ctx, priced.length ? Number(leafSum) : null]);
      // attribution reconciles exactly
      const alloc = l.allocation.groups.reduce((s, g) => s + (g.tokens.known_subtotal ?? 0), 0) + (l.allocation.unallocated.tokens.known_subtotal ?? 0);
      expect([ctx, alloc]).toEqual([ctx, l.usage.total.known_subtotal ?? 0]);
      expect(l.allocation.unallocated_request_ids).toEqual(truth.filter((t) => t.task === null).map((t) => t.acct).sort());
      // order and duplicate invariance
      const again = normalizeRunLedger(base({ events: shuffle(rng(seed * 7), [...events, ...events.slice(0, 2).map((e) => structuredClone(e))]), pricing: P1 }));
      expect([ctx, again.usage, again.cost, again.allocation]).toEqual([ctx, l.usage, l.cost, l.allocation]);
    }
  });

  it("anti-vacuity: the oracle rejects naive aggregators on the same corpus", () => {
    let cacheAdded = 0, streamSummed = 0, parentBilled = 0;
    for (const seed of SEEDS) {
      const { truth, events } = genUsage(seed);
      const l = normalizeRunLedger(base({ events }));
      const naive = (pred: (e: TraceAnalysisV3) => boolean, f: (u: TraceUsage) => number) =>
        events.filter((e) => e.usage && e.usage.total !== null && pred(e)).reduce((s, e) => s + f(e.usage!), 0);
      const truthTotal = truth.reduce((s, t) => s + (t.input === null ? 0 : t.input + t.output!), 0);
      expect(l.usage.total.known_subtotal ?? 0).toBe(truthTotal);
      if (naive((e) => e.usage!.final && e.usage!.inclusion === "leaf_exclusive", (u) => u.total! + (u.cache_read_subset ?? 0)) !== truthTotal) cacheAdded++;
      if (naive((e) => e.usage!.inclusion === "leaf_exclusive", (u) => u.total!) !== truthTotal) streamSummed++;
      if (naive((e) => e.usage!.final, (u) => u.total!) !== truthTotal) parentBilled++;
    }
    expect(cacheAdded).toBeGreaterThan(100);
    expect(streamSummed).toBeGreaterThan(100);
    expect(parentBilled).toBeGreaterThan(100);
  });
});

describe("property · time invariants against a millisecond grid", () => {
  it("union, per-agent work, raw and exclusive wait match brute force; order and duplicates do not matter", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const runEnd = 10 + int(r, 60);
      const spans: any[] = [{ span_id: "run", kind: "run", interval: iv(0, runEnd), agent_instance_id: null, reason: null }];
      const grid = { active: new Set<number>(), wait: new Set<number>(), agents: new Map<string, Set<number>>(), reasons: new Map<string, Set<number>>() };
      const nA = int(r, 6), nW = int(r, 4);
      for (let i = 0; i < nA + nW; i++) {
        const s = int(r, runEnd + 10), e = s + int(r, 25);
        const isActive = i < nA;
        const agent = `agent-${int(r, 3)}`;
        const reason = ["operator", "review", "queue"][int(r, 3)]!;
        if (!isActive && !grid.reasons.has(reason)) grid.reasons.set(reason, new Set());
        spans.push({ span_id: `s-${i}`, kind: isActive ? "active" : "wait", interval: iv(s, e), agent_instance_id: isActive ? agent : null, reason: isActive ? null : reason });
        for (let ms = s; ms < Math.min(e, runEnd); ms++) {
          if (isActive) {
            grid.active.add(ms);
            if (!grid.agents.has(agent)) grid.agents.set(agent, new Set());
            grid.agents.get(agent)!.add(ms);
          } else {
            grid.wait.add(ms);
            grid.reasons.get(reason)!.add(ms);
          }
        }
      }
      const t = normalizeRunLedger(base({ spans: shuffle(r, spans) })).time;
      const ctx = `seed ${seed}`;
      const agentWork = [...grid.agents.values()].reduce((s, x) => s + x.size, 0);
      expect([ctx, t.elapsed_ms.exact_total]).toEqual([ctx, runEnd]);
      expect([ctx, t.active_union_ms.exact_total]).toEqual([ctx, grid.active.size]);
      expect([ctx, t.agent_work_ms.exact_total]).toEqual([ctx, agentWork]);
      expect([ctx, t.raw_wait_ms.exact_total]).toEqual([ctx, grid.wait.size]);
      expect([ctx, t.exclusive_wait_ms.exact_total]).toEqual([ctx, [...grid.wait].filter((ms) => !grid.active.has(ms)).length]);
      expect([ctx, t.wait_by_reason]).toEqual([ctx, [...grid.reasons.entries()].map(([reason, set]) => ({ reason, ms: set.size })).sort((a, b) => a.reason.localeCompare(b.reason))]);
      expect(t.active_union_ms.exact_total!).toBeLessThanOrEqual(t.elapsed_ms.exact_total!);
      expect(t.active_union_ms.exact_total!).toBeLessThanOrEqual(t.agent_work_ms.exact_total!);
      const dup = normalizeRunLedger(base({ spans: [...spans, ...spans.slice(1, 3).map((s) => structuredClone(s))] })).time;
      expect([ctx, dup.active_union_ms, dup.agent_work_ms, dup.raw_wait_ms, dup.exclusive_wait_ms]).toEqual([ctx, t.active_union_ms, t.agent_work_ms, t.raw_wait_ms, t.exclusive_wait_ms]);
    }
  });
});

// ── Real path: T01 capture → readTrace → ledger ──────────────────────────────

describe("real path · T01 capture bytes normalize once", () => {
  it("two host families, a replay and an unknown-size drop", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-t02-ledger-")));
    try {
      const run = "run-t02-real";
      const authority: TraceAuthority = {
        source_id: SOURCE, run_id: run, initiative_id: null, private_literals: [],
        executions: [
          { execution_id: "exec-a", host_id: "claude", host_session_id: "hs-a", pins: PINS, admission: "active" },
          { execution_id: "exec-b", host_id: "codex", host_session_id: "hs-b", pins: PINS, admission: "active" },
        ],
        assignments: [
          { execution_id: "exec-a", logical_task_id: "task-1", attempt_id: "att-a", agent_instance_id: "agent-1", pins: PINS, goal_ids: [] },
          { execution_id: "exec-b", logical_task_id: "task-1", attempt_id: "att-b", agent_instance_id: "agent-2", pins: PINS, goal_ids: [] },
        ],
      };
      const now = () => new Date("2026-11-05T11:00:00Z");
      const obs = (exec: string, attempt: string, agent: string, o: Record<string, unknown>) => JSON.stringify({
        schema_version: "guild.host_trace_observation.v1", kind: "request_completed", at: "2026-11-05T11:00:00Z", actor_id: agent,
        correlation: { run_id: run, execution_id: exec, logical_task_id: "task-1", attempt_id: attempt, agent_instance_id: agent, request_id: "req-1" }, ...o,
      });
      const a = openTraceCapture({ root, authority, execution_id: "exec-a", now });
      const b = openTraceCapture({ root, authority, execution_id: "exec-b", now });
      const reqA = obs("exec-a", "att-a", "agent-1", { host_event_id: "1", requested_model: "claude-opus-4-1", response: { provider: "anthropic", model: "claude-sonnet-4-5", usage: { input_tokens: 60, cache_read_input_tokens: 40, cache_creation_input_tokens: 0, output_tokens: 20 } } });
      expect(a.observe(reqA).status).toBe("captured");
      expect(a.observe(reqA).status).toBe("duplicate");
      expect(b.observe(obs("exec-b", "att-b", "agent-2", { host_event_id: "1", requested_model: "gpt-5.6", response: { provider: "openai", model: "gpt-5.6-sol", usage: { input_tokens: 50, cached_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 4 } } })).status).toBe("captured");
      const prices: PriceTable = { version: "p-real", currency: "USD", source_hash: H, entries: [
        { provider: "anthropic", model: "claude-sonnet-4-5", uncached_input: 2, cache_read: 0.5, cache_write: 2.5, output: 8 },
        { provider: "openai", model: "gpt-5.6-sol", uncached_input: 2, cache_read: 0.5, cache_write: null, output: 8 },
      ] };
      const t = readTrace(root, run);
      const l = normalizeRunLedger({ source_id: SOURCE, run_id: run, events: t.events, capture: t.coverage, spans: [], pricing: prices, budget: null, as_of: null });
      // Same local request id on two hosts stays two leaves; reasoning is inside output, not added.
      expect(l.leaves).toHaveLength(2);
      expect(l.usage.input.exact_total).toBe(150);
      expect(l.usage.output.exact_total).toBe(30);
      expect(l.usage.total.exact_total).toBe(180);
      expect(l.cost.derived_estimate.exact_total).toBe(0.00048);
      expect(l.leaves.map((x) => x.requested_model).sort()).toEqual(["claude-opus-4-1", "gpt-5.6"]);
      expect(l.allocation.groups).toHaveLength(2);

      expect(b.recordUpstreamLoss({ dropped: null }).status).toBe("captured");
      const t2 = readTrace(root, run);
      const l2 = normalizeRunLedger({ source_id: SOURCE, run_id: run, events: t2.events, capture: t2.coverage, spans: [], pricing: prices, budget: null, as_of: null });
      expect(l2.usage.total.exact_total).toBeNull();
      expect(l2.usage.total.known_subtotal).toBe(180);
      expect(l2.usage.total.coverage.eligible).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── Codex round 1 regressions ────────────────────────────────────────────────

describe("review round 1 regressions", () => {
  const price = (over: Partial<PriceTable["entries"][number]>): PriceTable => ({ ...P1, entries: [{ ...P1.entries[0]!, ...over }] });
  const one = (input: number) => [ev({ id: "ev-1", task: "task-1", attempt: "att-1", usage: use({ acct: "req-1", input, cache: 0, write: 0, output: 0 }) })];

  it("R1-F1: fine and large prices aggregate exactly without throwing", () => {
    const a = normalizeRunLedger(base({ events: one(1), pricing: price({ uncached_input: 0.1234567 }) }));
    expect(a.cost.derived_estimate.exact_total).toBe(0.0000001234567);
    const b = normalizeRunLedger(base({ events: one(1), pricing: price({ uncached_input: 0.000000001 }) }));
    expect(b.cost.derived_estimate.exact_total).toBe(1e-15);
    const c = normalizeRunLedger(base({ events: one(1e9), pricing: price({ uncached_input: 10 }) }));
    expect(c.cost.derived_estimate.exact_total).toBe(10000);
  });

  it("R1-F2: an overflowing duration is a malformed span, not a crash", () => {
    const r = normalizeRunLedger(base({ spans: [...gf2Spans(), { span_id: "a", kind: "active", interval: { start: "2026-10-26T00:00:00Z", end: null, duration_ms: 1e308, clock: GF2.inputs.run.clock }, agent_instance_id: null, reason: null }] })).time;
    expect(r.losses.find((x) => x.code === "invalid_span")!.count).toBe(1);
    expect(r.active_union_ms.exact_total).toBeNull();
  });

  it("R1-F3: allocation groups are not exact when the request denominator is unknown", () => {
    const r = normalizeRunLedger(base({ events: one(1), capture: null, pricing: price({ uncached_input: 2 }) }));
    const g = r.allocation.groups[0]!;
    expect(g.tokens.known_subtotal).toBe(1);
    expect(g.tokens.exact_total).toBeNull();
    expect(g.tokens.coverage.eligible).toBeNull();
    expect(g.derived_estimate_usd.exact_total).toBeNull();
    expect(g.derived_estimate_usd.known_subtotal).toBe(0.000002);
  });

  it("R1-F4: omitted or anchorless time instrumentation is unavailable, not zero", () => {
    for (const spans of [undefined, []]) {
      const t = normalizeRunLedger({ source_id: SOURCE, run_id: RUN, events: [], capture: null, ...(spans ? { spans } : {}) }).time;
      for (const v of [t.active_union_ms, t.agent_work_ms, t.raw_wait_ms, t.exclusive_wait_ms, t.elapsed_ms]) {
        expect(v.value).toBeNull();
        expect(v.reason).toBeTruthy();
      }
    }
    const runOnly = normalizeRunLedger(base({ spans: [gf2Spans()[0]] })).time;
    expect(runOnly.active_union_ms.exact_total).toBe(0);
  });

  it("R1-F5: pending requests stay execution-qualified", () => {
    const r = normalizeRunLedger(base({ events: [
      ev({ id: "s-a", cls: "request_started", exec: "exec-a", request: "req-shared", usage: null }),
      ev({ id: "s-b", cls: "request_started", exec: "exec-b", request: "req-shared", usage: null }),
      ev({ id: "done", usage: use({ acct: "req-done", input: 5, output: 1 }) }),
    ] }));
    expect(r.coverage.requests).toMatchObject({ eligible: 3, covered: 1, missing: 2 });
    expect(r.coverage.request_ratio.value).toBe(1 / 3);
    expect(r.coverage.pending_requests).toEqual([{ execution_id: "exec-a", request_id: "req-shared" }, { execution_id: "exec-b", request_id: "req-shared" }]);
  });

  it("R1-F6: measured billing survives unknown token semantics", () => {
    const e = ev({ id: "ev-m", usage: use({ acct: "req-m", measured: 0.01 }) });
    const r = normalizeRunLedger(base({ events: [e] }));
    expect(r.cost.measured.exact_total).toBe(0.01);
    expect(r.usage.total.value).toBeNull();
    const leaf = leafOf(r, "req-m");
    expect(leaf.normalized_usage.cost_basis).toBe("measured");
    expect(validateTraceAnalysisV3({ ...e, usage: leaf.normalized_usage })).toEqual({ ok: true });
  });
});

describe("review round 2 regressions", () => {
  it("R2-F7: native-only accounting is not exact zero token usage", () => {
    const r = normalizeRunLedger(base({ events: [ev({ id: "n", request: "s", observed: null, usage: nativeUse("s", 1, true, 0, 1) })] }));
    expect(r.cost.native_estimate.exact_total).toBe(1);
    expect(r.usage.total.exact_total).toBeNull();
    expect(r.usage.total.reason).toBeTruthy();
    expect(r.coverage.requests.eligible).toBeNull();
  });

  it("R2-F8: a conflicting event id never yields exact zero, in either order", () => {
    const phase = ev({ id: "same", cls: "phase", request: null });
    const done = ev({ id: "same", usage: use({ acct: "q", input: 10, cache: 0, write: 0, output: 5 }) });
    const a = normalizeRunLedger(base({ events: [phase, done] }));
    const b = normalizeRunLedger(base({ events: [done, phase] }));
    for (const r of [a, b]) {
      expect(r.usage.total.exact_total).toBeNull();
      expect(r.usage.total.coverage.eligible).toBeNull();
    }
    expect([a.usage, a.cost, a.allocation, a.leaves]).toEqual([b.usage, b.cost, b.allocation, b.leaves]);
  });

  it("R2-F9: the newest cumulative native revision wins over an older final one", () => {
    const r = normalizeRunLedger(base({ events: [
      ev({ id: "n1", request: "s", observed: null, usage: nativeUse("s", 1, true, 0, 1) }),
      ev({ id: "n2", request: "s", observed: null, usage: nativeUse("s", 2, false, 0, 2) }),
    ], budget: { threshold_usd: 1.5 } }));
    expect(r.cost.native_estimate.exact_total).toBe(2);
    expect(r.cost.budget!.remaining_usd).toBe(0);
    expect(r.cost.budget!.overshoot_usd).toBe(0.5);
  });

  it("R2-F10: a huge but valid counter prices to a finite USD value", () => {
    const r = normalizeRunLedger(base({ events: [ev({ id: "huge", usage: use({ acct: "huge", input: Number.MAX_SAFE_INTEGER - 1, cache: 0, write: 0, output: 0 }) })], pricing: { ...P1, entries: [{ ...P1.entries[0]!, uncached_input: 1e30 }] } }));
    expect(Number.isFinite(r.cost.derived_estimate.exact_total!)).toBe(true);
    expect(r.cost.derived_estimate.exact_total).toBe(Number(`${BigInt(Number.MAX_SAFE_INTEGER - 1) * 10n ** 30n}e-6`));
  });

  it("R2-F11: a span with unknown or deeply nested fields is malformed, not a crash", () => {
    const deep = JSON.parse("[".repeat(100000) + "0" + "]".repeat(100000));
    const r = normalizeRunLedger(base({ spans: [gf2Spans()[0], { ...gf2Spans()[1], extra: deep }, { ...gf2Spans()[2], interval: { ...gf2Spans()[2]!.interval, extra: 1 } }] })).time;
    expect(r.losses.find((x) => x.code === "invalid_span")!.count).toBe(2);
    expect(r.active_union_ms.exact_total).toBeNull();
  });
});
