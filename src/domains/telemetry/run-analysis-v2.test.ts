/**
 * T03 · versioned run analysis and cache invalidation (AT26 cache compatibility,
 * AT27 backfill migration) over T02's ledger and T01's v3 trace.
 *
 * Fixtures are written into a disposable root as retained run evidence; the
 * A02 frozen examples are re-validated when the frozen checkout is present, and
 * T02_REQUIRE_A02=1 makes that check mandatory.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TraceAnalysisV3, TraceCoverage, TraceUsage } from "./trace-analysis-v3";
import { normalizeRunLedger, type PriceTable } from "./run-ledger-v2";
import { spawnSync } from "node:child_process";
import {
  LEGACY_V1_USAGE_SEMANTICS,
  RUN_ANALYSIS_V2_SCHEMA,
  analyzeRunV2,
  buildRunAnalysisV2,
  analysisCacheKey,
  compareRunsV2,
  legacyV1UsageProjection,
  readCachedRunAnalysisV2,
  validateRunAnalysisV2,
  validateRunComparisonV2,
  type RunAnalysisV2,
  type VersionSet,
} from "./run-analysis-v2";
import { analyzeRun, loadOrAnalyzeRun, writeRunAnalysis } from "./run-analysis";

const PLUGIN_ROOT = path.resolve(__dirname, "../../..");
const A02_ROOT = process.env["A02_CONTRACT_ROOT"] ?? path.resolve(PLUGIN_ROOT, "../contracts/guild-stack/v2");
const A02_PRESENT = fs.existsSync(path.join(A02_ROOT, "fixtures", "examples.json"));

const H = `sha256:${"a".repeat(64)}`;
const PINS = { assignment: H, definition: H, configuration: H, workflow: H, policy: H };
const COMPLETE: TraceCoverage = { eligible: 1, covered: 1, excluded: 0, missing: 0, state: "complete", reason: null, exclusion_reasons: [] };
const SOURCE = "source-a";
const AS_OF = "2026-10-26T00:01:00Z";
const P1: PriceTable = {
  version: "p1", currency: "USD", source_hash: `sha256:${"d".repeat(64)}`,
  entries: [{ provider: "provider", model: "observed-model", uncached_input: 2, cache_read: 0.5, cache_write: null, output: 8 }],
};

function use(acct: string, input: number | null, cache: number | null, output: number | null): TraceUsage {
  const known = input !== null && output !== null;
  return {
    granularity: "leaf_request", observation_id: `obs-${acct}`, revision: 1, final: true, accounting_identity: acct,
    parent_accounting_identity: null, inclusion: "leaf_exclusive", input_inclusive: input, output, cache_read_subset: cache,
    cache_write_subset: input === null ? null : 0, total: known ? input! + output! : null, cost_usd: null, cost_basis: "unavailable",
    currency: "USD", pricing_version: null, usage_semantics: known ? "inclusive_input_cache_subset.v1" : "unknown",
    coverage: known ? COMPLETE : { eligible: 1, covered: 0, excluded: 0, missing: 1, state: "unavailable", reason: "provider did not report usage", exclusion_reasons: [] },
    native_baseline_usd: null, native_cumulative_usd: null,
  };
}

let seq = 0;
function ev(run: string, id: string, at: string, usage: TraceUsage | null, task: string | null, attempt: string | null): TraceAnalysisV3 {
  return {
    schema_version: "guild.trace.analysis.v3", event_id: id, sequence: seq++, event_class: "request_completed", at,
    lineage: {
      source_id: SOURCE, run_id: run, execution_id: "exec-1", host_session_id: "host-session-1", initiative_id: null, goal_id: null,
      logical_task_id: task, attempt_id: attempt, agent_instance_id: task ? "agent-1" : null, request_id: usage?.accounting_identity ?? id,
    },
    operation_id: null, component_invocation_id: null, actor_id: "agent-1", pins: PINS, requested_model: "requested-model",
    observed_identity: { provider: "provider", model: "observed-model", status: "observed", reason: null },
    usage, payload_ref: null, prompt_hash: null, redaction_version: "guild.trace-scrub.v1", capture: COMPLETE, interval: null,
  };
}

/** A legacy v1 analysis as KTD16 left it: total = input + output + cached. */
function v1Analysis(run: string, input: number, output: number, cached: number): Record<string, unknown> {
  return {
    schema_version: "guild.run_analysis.v1", analysis_id: `analysis:${run}:${"b".repeat(12)}`, run_id: run, source_hash: "b".repeat(64),
    eligible: true, identity: { run_scope: "unknown", initiative_id: null, independent_group_id: null, config_snapshot_ref: null, host: "claude", phase: null },
    completeness: { score: 50, present: [], missing: [] },
    assessments: {
      instruction_following: { status: "unknown", evidence_refs: [] }, prompt_efficiency: { status: "unknown", evidence_refs: [] },
      workflow: { status: "unknown", evidence_refs: [] }, tool_coverage: { status: "unknown", evidence_refs: [] },
    },
    usage: { llm_event_count: 2, specialists_dispatched: [], tokens: { input, output, cached, total: input + output + cached, cost_usd: 0 }, duration_ms: 0 },
    findings: [], recommendations: [],
  };
}

let root = "";
const g = (...p: string[]) => path.join(root, ".guild", ...p);
function put(rel: string, body: string): void {
  fs.mkdirSync(path.dirname(g(rel)), { recursive: true });
  fs.writeFileSync(g(rel), body);
}
const jsonl = (events: TraceAnalysisV3[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
/** Hash of every file under a directory, by relative path. */
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out[path.relative(dir, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

/** Rich historical run: v1 analysis, v1.4 log, and a retained v3 trace. */
function richRun(run: string): void {
  put(`runs/${run}/run.yaml`, `run_id: ${run}\n`);
  put(`runs/${run}/logs/v1.4-events.jsonl`, `{"event":"llm_call","tokens":{"input":150,"output":30}}\n`);
  put(`runs/${run}/trace.jsonl`, jsonl([
    ev(run, "ev-1", "2026-10-26T00:00:10Z", use("request-1", 100, 40, 20), "task-1", "attempt-1"),
    ev(run, "ev-2", "2026-10-26T00:00:11Z", use("request-2", 50, 0, 10), "task-2", "attempt-2"),
  ]));
  put(`analysis/runs/${run}/analysis.json`, JSON.stringify(v1Analysis(run, 150, 30, 40), null, 2) + "\n");
}

beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-t03-"))); seq = 0; });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const run = (id: string, over: { pricing?: PriceTable | null; versions?: Partial<VersionSet> } = {}) =>
  analyzeRunV2(root, { source_id: SOURCE, run_id: id, pricing: over.pricing === undefined ? P1 : over.pricing, as_of: AS_OF, versions: over.versions });

// ── AT26 ─────────────────────────────────────────────────────────────────────

describe("AT26 · cache compatibility", () => {
  it("v2 misses an existing v1 cache and never serves it as current", () => {
    richRun("run-1");
    const v1Bytes = fs.readFileSync(g("analysis/runs/run-1/analysis.json"));
    const first = run("run-1");
    expect(first.cache).toBe("recomputed");
    expect(first.reason).toBe("legacy_v1_only");
    expect(first.analysis.schema_version).toBe(RUN_ANALYSIS_V2_SCHEMA);
    expect(validateRunAnalysisV2(first.analysis)).toEqual({ ok: true });
    // v1 bytes are untouched; v2 lives in versions/<analysis_id>/ with a current.v2.json pointer.
    expect(fs.readFileSync(g("analysis/runs/run-1/analysis.json")).equals(v1Bytes)).toBe(true);
    expect(fs.existsSync(g(`analysis/runs/run-1/versions/${first.analysis.analysis_id}/analysis.json`))).toBe(true);
    expect(fs.existsSync(g("analysis/runs/run-1/current.v2.json"))).toBe(true);
    const again = run("run-1");
    expect(again.cache).toBe("hit");
    expect(again.analysis.analysis_id).toBe(first.analysis.analysis_id);
  });

  it("v1 readers remain usable after v2 is written", () => {
    richRun("run-1");
    fs.rmSync(g("analysis/runs/run-1/analysis.json"));
    put("runs/run-1/run.yaml", ["schema_version: guild.run.v1", "run_id: run-1", "command: /guild:build", "run_scope: independent",
      "initiative_attachment: null", "independent_run_group: research", "status: closed", "started_at: 2026-10-26T00:00:00Z",
      "host:", "  requested: auto", "  resolved: claude", "phase: build", ""].join("\n"));
    writeRunAnalysis(root, analyzeRun(root, "run-1"));
    const v1 = fs.readFileSync(g("analysis/runs/run-1/analysis.json"));
    const before = loadOrAnalyzeRun(root, "run-1");
    expect(before.cache).toBe("hit");
    expect(run("run-1").reason).toBe("legacy_v1_only");
    const after = loadOrAnalyzeRun(root, "run-1");
    expect(after.cache).toBe("hit");
    expect(after.analysis.analysis_id).toBe(before.analysis.analysis_id);
    expect(fs.readFileSync(g("analysis/runs/run-1/analysis.json")).equals(v1)).toBe(true);
  });

  it("each version dimension changes the cache key", () => {
    const base: VersionSet = { schema: "s", analyzer: "a", normalizer: "n", formula: "f", usage_semantics: "u", pricing: "p", aggregation: "g" };
    const subject = { source_id: SOURCE, run_id: "run-1" };
    const k0 = analysisCacheKey(base, H, subject);
    const keys = new Set([k0]);
    for (const dim of Object.keys(base) as (keyof VersionSet)[]) keys.add(analysisCacheKey({ ...base, [dim]: `${base[dim]}2` }, H, subject));
    expect(keys.size).toBe(8);
    expect(analysisCacheKey(base, `sha256:${"e".repeat(64)}`, subject)).not.toBe(k0);
    expect(analysisCacheKey(base, H, { source_id: SOURCE, run_id: "run-2" })).not.toBe(k0);
    // Key order of the version set does not matter.
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as VersionSet;
    expect(analysisCacheKey(reordered, H, subject)).toBe(k0);
  });

  it("negative control: same events with changed pricing or token semantics cannot hit the prior cache", () => {
    richRun("run-1");
    const first = run("run-1");
    const repriced = run("run-1", { pricing: { ...P1, version: "p2" } });
    expect(repriced.cache).toBe("recomputed");
    expect(repriced.reason).toBe("version_mismatch");
    expect(repriced.dimensions).toEqual(["pricing"]);
    expect(repriced.analysis.analysis_id).not.toBe(first.analysis.analysis_id);
    // A rate edit under the same version and source hash is a different price basis too.
    const rerated = run("run-1", { pricing: { ...P1, version: "p2", entries: [{ ...P1.entries[0]!, output: 80 }] } });
    expect(rerated.cache).toBe("recomputed");
    expect(rerated.dimensions).toEqual(["pricing"]);
    // A same-version table with different bytes is a different price basis too.
    const rehashed = run("run-1", { pricing: { ...P1, version: "p2", source_hash: `sha256:${"f".repeat(64)}` } });
    expect(rehashed.cache).toBe("recomputed");
    const resemantic = run("run-1", { pricing: { ...P1, version: "p2", source_hash: `sha256:${"f".repeat(64)}` }, versions: { usage_semantics: "inclusive_input_cache_subset.v2" } });
    expect(resemantic.cache).toBe("recomputed");
    expect(resemantic.dimensions).toEqual(["usage_semantics"]);
    const pinned = { pricing: { ...P1, version: "p2", source_hash: `sha256:${"f".repeat(64)}` }, versions: { usage_semantics: "inclusive_input_cache_subset.v2" } };
    for (const dim of ["normalizer", "analyzer", "aggregation", "formula", "schema"] as const) {
      run("run-1", pinned);
      expect(run("run-1", pinned).cache).toBe("hit");
      const r = run("run-1", { ...pinned, versions: { ...pinned.versions, [dim]: "bumped" } });
      expect(r.cache).toBe("recomputed");
      expect(r.dimensions).toEqual([dim]);
    }
  });

  it("changed retained input misses the cache", () => {
    richRun("run-1");
    run("run-1");
    fs.appendFileSync(g("runs/run-1/trace.jsonl"), JSON.stringify(ev("run-1", "ev-3", "2026-10-26T00:00:12Z", use("request-3", 5, 0, 5), "task-1", "attempt-1")) + "\n");
    const r = run("run-1");
    expect(r.cache).toBe("recomputed");
    expect(r.reason).toBe("input_changed");
  });

  it("a later as_of on unchanged inputs hits the content-addressed cache; an as_of before the evidence is refused", () => {
    richRun("run-1");
    const first = run("run-1");
    const later = analyzeRunV2(root, { source_id: SOURCE, run_id: "run-1", pricing: P1, as_of: "2026-10-27T00:00:00Z" });
    expect(later.cache).toBe("hit");
    expect(later.analysis).toEqual(first.analysis);
    expect(later.analysis.query.snapshot.as_of).toBe(AS_OF);
    expect(() => analyzeRunV2(root, { source_id: SOURCE, run_id: "run-1", pricing: P1, as_of: "2026-10-26T00:00:10.5Z" })).toThrow(/precedes retained trace event/);
    // The window is half-open: an event exactly at as_of is outside it.
    expect(() => analyzeRunV2(root, { source_id: SOURCE, run_id: "run-1", pricing: P1, as_of: "2026-10-26T00:00:11Z" })).toThrow(/precedes retained trace event/);
  });

  it("repairing a lost pointer keeps the existing body bytes for the same analysis id", () => {
    richRun("run-1");
    const first = run("run-1");
    const body = g(`analysis/runs/run-1/versions/${first.analysis.analysis_id}/analysis.json`);
    const bytes = fs.readFileSync(body);
    fs.rmSync(g("analysis/runs/run-1/current.v2.json"));
    const again = analyzeRunV2(root, { source_id: SOURCE, run_id: "run-1", pricing: P1, as_of: "2026-10-27T00:00:00Z" });
    expect(again.cache).toBe("recomputed");
    expect(again.analysis).toEqual(first.analysis);
    expect(fs.readFileSync(body).equals(bytes)).toBe(true);
    expect(run("run-1").cache).toBe("hit");
  });

  it("payload sidecars are keyed inputs: losing one misses the cache and lowers coverage", () => {
    put("runs/run-p/run.yaml", "run_id: run-p\n");
    const sidecar = "runs/run-p/trace-sidecars/ev-" + "c".repeat(32) + ".json";
    const bytes = JSON.stringify({ content: "scrubbed" });
    put(sidecar, bytes);
    const e = ev("run-p", "ev-1", "2026-10-26T00:00:10Z", use("request-1", 10, 0, 5), "task-1", "attempt-1");
    e.payload_ref = { source_id: SOURCE, path: sidecar, sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`, schema_version: "guild.trace.sidecar.v1", observed_at: "2026-10-26T00:00:10Z", availability: "available", reason: null };
    put("runs/run-p/trace.jsonl", jsonl([e]));
    const first = run("run-p");
    expect(first.analysis.state.observability).toBe("complete");
    expect(first.analysis.input_evidence.find((x) => x.path === sidecar)!.availability).toBe("available");
    expect(run("run-p").cache).toBe("hit");
    fs.rmSync(g(sidecar));
    const r = run("run-p");
    expect(r.cache).toBe("recomputed");
    expect(r.reason).toBe("input_changed");
    expect(r.analysis.state.observability).not.toBe("complete");
    expect(r.analysis.input_evidence.find((x) => x.path === sidecar)!.availability).toBe("missing");
  });

  it("partial or corrupt caches are rejected, never served", () => {
    richRun("run-1");
    const first = run("run-1");
    const body = g(`analysis/runs/run-1/versions/${first.analysis.analysis_id}/analysis.json`);
    const pointer = g("analysis/runs/run-1/current.v2.json");
    const expected = { versions: first.analysis.query.versions, input_manifest_digest: first.analysis.query.snapshot.input_manifest_digest };
    const good = fs.readFileSync(body, "utf8");
    // Truncated body (partial write).
    fs.writeFileSync(body, good.slice(0, good.length / 2));
    expect(readCachedRunAnalysisV2(root, SOURCE, "run-1", expected)).toMatchObject({ state: "miss", reason: "corrupt" });
    // Body valid JSON but edited counters: hash no longer matches the pointer.
    const edited = JSON.parse(good) as RunAnalysisV2;
    edited.usage[0]!.output = 999;
    edited.usage[0]!.total = edited.usage[0]!.input_inclusive! + 999;
    expect(validateRunAnalysisV2(edited)).toEqual({ ok: true });
    fs.writeFileSync(body, JSON.stringify(edited, null, 2) + "\n");
    expect(readCachedRunAnalysisV2(root, SOURCE, "run-1", expected)).toMatchObject({ state: "miss", reason: "corrupt" });
    // Body absent behind a pointer.
    fs.rmSync(body);
    expect(readCachedRunAnalysisV2(root, SOURCE, "run-1", expected)).toMatchObject({ state: "miss", reason: "partial" });
    // Unparseable pointer.
    fs.writeFileSync(body, good);
    expect(readCachedRunAnalysisV2(root, SOURCE, "run-1", expected)).toMatchObject({ state: "hit" });
    fs.writeFileSync(pointer, "{\"schema_version\":");
    expect(readCachedRunAnalysisV2(root, SOURCE, "run-1", expected)).toMatchObject({ state: "miss", reason: "corrupt" });
    // Pointer to a body that is self-consistent but claims other versions than its key.
    const forged = JSON.parse(good) as RunAnalysisV2;
    forged.query.versions.pricing = "p9";
    const forgedBytes = JSON.stringify(forged, null, 2) + "\n";
    fs.writeFileSync(body, forgedBytes);
    const ptr = { schema_version: "guild.run_analysis_pointer.v2", source_id: SOURCE, run_id: "run-1", analysis_id: first.analysis.analysis_id,
      cache_key: analysisCacheKey(first.analysis.query.versions, expected.input_manifest_digest, { source_id: SOURCE, run_id: "run-1" }),
      analysis_sha256: `sha256:${crypto.createHash("sha256").update(forgedBytes).digest("hex")}` };
    fs.writeFileSync(pointer, JSON.stringify(ptr));
    expect(readCachedRunAnalysisV2(root, SOURCE, "run-1", expected)).toMatchObject({ state: "miss", reason: "corrupt" });
    // The analyzer recomputes past every rejected cache.
    const r = run("run-1");
    expect(r.cache).toBe("recomputed");
    expect(validateRunAnalysisV2(r.analysis)).toEqual({ ok: true });
    expect(run("run-1").cache).toBe("hit");
  });

  it("a symlinked cache pointer is refused", () => {
    richRun("run-1");
    const first = run("run-1");
    const pointer = g("analysis/runs/run-1/current.v2.json");
    const elsewhere = path.join(root, "elsewhere.json");
    fs.renameSync(pointer, elsewhere);
    fs.symlinkSync(elsewhere, pointer);
    const expected = { versions: first.analysis.query.versions, input_manifest_digest: first.analysis.query.snapshot.input_manifest_digest };
    expect(readCachedRunAnalysisV2(root, SOURCE, "run-1", expected)).toMatchObject({ state: "miss", reason: "corrupt" });
  });

  it("legacy v1 totals keep their labelled input+output+cached meaning", () => {
    const p = legacyV1UsageProjection(v1Analysis("run-1", 150, 30, 40));
    expect(p).toMatchObject({ schema_version: "guild.run_analysis.v1", usage_semantics: LEGACY_V1_USAGE_SEMANTICS, input: 150, output: 30, cached: 40, total: 220, comparable_with_v2: false });
    expect(p.label).toContain("input + output + cached");
    expect(() => legacyV1UsageProjection({ schema_version: "guild.run_analysis.v2" })).toThrow();
  });

  it("incompatible comparisons refuse; same-version comparisons are compatible", () => {
    richRun("run-1");
    richRun("run-2");
    const a = run("run-1").analysis;
    const b = run("run-2").analysis;
    const ok = compareRunsV2([{ analysis: a }, { analysis: b }], { as_of: AS_OF });
    expect(validateRunComparisonV2(ok)).toEqual({ ok: true });
    expect(ok.compatibility).toBe("compatible");
    expect(ok.refusal_reasons).toEqual([]);

    const repriced = run("run-2", { pricing: { ...P1, version: "p2" } }).analysis;
    const mixedPricing = compareRunsV2([{ analysis: a }, { analysis: repriced }], { as_of: AS_OF });
    expect(validateRunComparisonV2(mixedPricing)).toEqual({ ok: true });
    expect(mixedPricing.compatibility).toBe("refused");
    expect(mixedPricing.refusal_reasons.join(" ")).toContain("pricing");

    const legacy = compareRunsV2([{ analysis: a }, { legacy: v1Analysis("run-3", 1, 1, 1), source_id: SOURCE }], { as_of: AS_OF });
    expect(validateRunComparisonV2(legacy)).toEqual({ ok: true });
    expect(legacy.compatibility).toBe("refused");
    expect(legacy.input_versions[1]!.usage_semantics).toBe(LEGACY_V1_USAGE_SEMANTICS);

    // A forged "compatible" verdict over mixed versions fails validation.
    expect(validateRunComparisonV2({ ...mixedPricing, compatibility: "compatible", refusal_reasons: [] }).ok).toBe(false);
    expect(() => compareRunsV2([{ analysis: a }, { analysis: a }], { as_of: AS_OF })).toThrow(/duplicate/);
    // A comparison cannot cut off before the snapshots it compares.
    const early = compareRunsV2([{ analysis: a }, { analysis: b }], { as_of: "2026-10-25T00:00:00Z" });
    expect(early.compatibility).toBe("refused");
    expect(early.refusal_reasons.join(" ")).toContain("later than the comparison as_of");
  });

  it("mixed observed usage semantics refuse comparison", () => {
    richRun("run-1");
    put("runs/run-2/run.yaml", "run_id: run-2\n");
    const session: TraceUsage = {
      granularity: "native_session", observation_id: "obs-s", revision: 1, final: true, accounting_identity: "session-1",
      parent_accounting_identity: null, inclusion: "session_cumulative", input_inclusive: null, output: null, cache_read_subset: null,
      cache_write_subset: null, total: null, cost_usd: 0.5, cost_basis: "native_estimate", currency: "USD", pricing_version: null,
      usage_semantics: "provider_session_only.v1", coverage: COMPLETE, native_baseline_usd: 0, native_cumulative_usd: 0.5,
    };
    const e = ev("run-2", "ev-s", "2026-10-26T00:00:10Z", session, null, null);
    put("runs/run-2/trace.jsonl", jsonl([e]));
    const a = run("run-1").analysis;
    const b = run("run-2").analysis;
    expect(b.query.versions.usage_semantics).not.toBe(a.query.versions.usage_semantics);
    const c = compareRunsV2([{ analysis: a }, { analysis: b }], { as_of: AS_OF });
    expect(c.compatibility).toBe("refused");
    expect(c.refusal_reasons.join(" ")).toContain("usage_semantics");
    // The session record is not projected; that omission is disclosed, not hidden.
    expect(b.usage).toEqual([]);
    expect(b.losses).toContainEqual(expect.objectContaining({ code: "native_session_not_projected", count: 1 }));
    expect(b.state.observability).not.toBe("complete");
  });

  it("an over-bound projection is marked partial with the omission counted", () => {
    const events = Array.from({ length: 1001 }, (_, i) => ev("run-big", `ev-${i}`, "2026-10-26T00:00:10Z", use(`request-${i}`, 10, 0, 5), "task-1", "attempt-1"));
    const ledger = normalizeRunLedger({ source_id: SOURCE, run_id: "run-big", events, capture: { ...COMPLETE, eligible: 1001, covered: 1001 }, spans: [], pricing: null, budget: null, as_of: AS_OF });
    expect(ledger.coverage.requests.state).toBe("complete");
    const a = buildRunAnalysisV2({ source_id: SOURCE, run_id: "run-big", as_of: AS_OF, ledger, input_evidence: [], trace_usable: true, pricing: null });
    expect(a.usage).toHaveLength(1000);
    expect(a.state.observability).toBe("partial");
    expect(a.losses).toContainEqual(expect.objectContaining({ code: "projection_truncated", count: 1 }));
    expect(validateRunAnalysisV2(a)).toEqual({ ok: true });
  });

  it("validator enforces the frozen state-axis and window rules", () => {
    richRun("run-1");
    const a = run("run-1").analysis;
    expect(validateRunAnalysisV2({ ...a, state: { ...a.state, lifecycle: "closed", outcome: "succeeded", acceptance: "unknown" } }).ok).toBe(false);
    expect(validateRunAnalysisV2({ ...a, state: { ...a.state, lifecycle: "closed", outcome: "unknown" } }).ok).toBe(false);
    expect(validateRunAnalysisV2({ ...a, query: { ...a.query, window: { ...a.query.window, from: AS_OF } } }).ok).toBe(false);
  });

  it("generated analyses and comparisons pass the frozen A02 semantic verifier", () => {
    if (!A02_PRESENT) {
      expect(process.env["T02_REQUIRE_A02"]).not.toBe("1");
      return;
    }
    richRun("run-1");
    richRun("run-2");
    put("runs/run-gone/run.yaml", "run_id: run-gone\n");
    const a = run("run-1").analysis;
    const b = run("run-2").analysis;
    const sparse = run("run-gone").analysis;
    const ok = compareRunsV2([{ analysis: a }, { analysis: b }], { as_of: AS_OF });
    const refused = compareRunsV2([{ analysis: a }, { legacy: v1Analysis("run-3", 1, 1, 1), source_id: SOURCE }], { as_of: AS_OF });
    const bad = { ...a, state: { ...a.state, lifecycle: "closed", outcome: "succeeded", acceptance: "unknown" } };
    const cases = [["run-analysis", a], ["run-analysis", sparse], ["run-comparison", ok], ["run-comparison", refused], ["run-analysis", bad]];
    // semantic_errors and its helpers only; schema checks need packages the frozen bundle pins separately.
    const py = [
      "import sys,json,ast,copy", "from datetime import datetime",
      `p=${JSON.stringify(path.join(A02_ROOT, "verify_contracts.py"))}`,
      "t=ast.parse(open(p).read(),p)",
      "m=ast.Module(body=[n for n in t.body if isinstance(n,ast.FunctionDef) and n.name in {'dt','semantic_errors','input_identity','disclosed','usable'}],type_ignores=[])",
      "USAGE_COUNTERS=['input_inclusive','output','cache_read_subset','cache_write_subset','total']",
      "exec(compile(m,p,'exec'))",
      "print(json.dumps([semantic_errors(n,v) for n,v in json.load(sys.stdin)]))",
    ].join("\n");
    const r = spawnSync("python3", ["-I", "-c", py], { input: JSON.stringify(cases), encoding: "utf8" });
    expect(r.stderr).toBe("");
    const errs = JSON.parse(r.stdout) as string[][];
    expect(errs.slice(0, 4)).toEqual([[], [], [], []]);
    expect(errs[4]).toContain("success requires verified acceptance");
  });

  it("A02 frozen examples validate (mandatory when T02_REQUIRE_A02=1)", () => {
    if (!A02_PRESENT) {
      expect(process.env["T02_REQUIRE_A02"]).not.toBe("1");
      return;
    }
    const ex = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "fixtures", "examples.json"), "utf8"));
    // Nested metric series (T04) are not verified by this reader, so it refuses them rather than pass them unchecked.
    expect(validateRunAnalysisV2(ex["run-analysis"]).ok).toBe(false);
    expect(validateRunComparisonV2(ex["run-comparison"]).ok).toBe(false);
    expect(validateRunAnalysisV2({ ...ex["run-analysis"], metrics: [] })).toEqual({ ok: true });
    expect(validateRunComparisonV2({ ...ex["run-comparison"], metrics: [] })).toEqual({ ok: true });
    // Top-level regression cases: with series stripped, the verdict must match the frozen expectation.
    const reg = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "fixtures", "regressions.json"), "utf8")).cases as any[];
    const nested = /metrics|nested|P11|C3-nested|G3-F3/;
    let checked = 0;
    for (const r of reg) {
      if (r.schema !== "run-analysis" && r.schema !== "run-comparison") continue;
      const validate = r.schema === "run-analysis" ? validateRunAnalysisV2 : validateRunComparisonV2;
      expect(`${r.id}:${validate(r.instance).ok}`).toBe(`${r.id}:false`);
      if (nested.test(r.id)) continue;
      checked++;
      expect(`${r.id}:${validate({ ...r.instance, metrics: [] }).ok}`).toBe(`${r.id}:${r.expected_valid}`);
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });
});

// ── AT27 ─────────────────────────────────────────────────────────────────────

describe("AT27 · backfill migration", () => {
  it("rich run gets a new derived projection without altering history", () => {
    richRun("run-rich");
    const before = { runs: tree(g("runs")), v1: fs.readFileSync(g("analysis/runs/run-rich/analysis.json")) };
    const r = run("run-rich");
    expect(tree(g("runs"))).toEqual(before.runs);
    expect(fs.readFileSync(g("analysis/runs/run-rich/analysis.json")).equals(before.v1)).toBe(true);
    const a = r.analysis;
    expect(a.state.observability).toBe("complete");
    expect(a.usage.map((u) => u.accounting_identity).sort()).toEqual(["request-1", "request-2"]);
    expect(a.usage.find((u) => u.accounting_identity === "request-1")).toMatchObject({ input_inclusive: 100, cache_read_subset: 40, output: 20, total: 120 });
    // The v1.4 log is retained but not normalized: it carries no accounting identity.
    const log = a.input_evidence.find((e) => e.path === "runs/run-rich/logs/v1.4-events.jsonl")!;
    expect(log.availability).toBe("unsupported");
    expect(a.input_evidence.find((e) => e.path === "runs/run-rich/trace.jsonl")!.availability).toBe("available");
    // Lifecycle/outcome/acceptance were never observed: unknown stays unknown.
    expect(a.state).toMatchObject({ lifecycle: "unknown", outcome: "unknown", acceptance: "unknown" });
    expect(a.run).toMatchObject({ source_id: SOURCE, kind: "run", id: "run-rich" });
  });

  it("sparse run with a truncated trace stays partial; missing trace stays unavailable", () => {
    put("runs/run-trunc/run.yaml", "run_id: run-trunc\n");
    put("runs/run-trunc/analysis-placeholder", "");
    const good = JSON.stringify(ev("run-trunc", "ev-1", "2026-10-26T00:00:10Z", use("request-1", 100, 40, 20), "task-1", "attempt-1"));
    const torn = JSON.stringify(ev("run-trunc", "ev-2", "2026-10-26T00:00:11Z", use("request-2", 50, 0, 10), "task-1", "attempt-1")).slice(0, 80);
    put("runs/run-trunc/trace.jsonl", `${good}\n${torn}`);
    const t = run("run-trunc").analysis;
    expect(t.state.observability).toBe("partial");
    expect(t.losses.length).toBeGreaterThan(0);
    expect(t.usage.map((u) => u.accounting_identity)).toEqual(["request-1"]);

    put("runs/run-gone/run.yaml", "run_id: run-gone\n");
    put("runs/run-gone/logs/v1.4-events.jsonl", `{"event":"llm_call"}\n`);
    put("analysis/runs/run-gone/analysis.json", JSON.stringify(v1Analysis("run-gone", 10, 5, 0), null, 2) + "\n");
    const m = run("run-gone").analysis;
    expect(m.state.observability).toBe("unavailable");
    expect(m.usage).toEqual([]);
    expect(m.input_evidence.find((e) => e.path === "runs/run-gone/trace.jsonl")!.availability).toBe("missing");
    expect(m.losses[0]).toMatchObject({ code: "trace_unavailable", count: null });
  });

  it("two sparse runs are never given invented or shared identities", () => {
    for (const id of ["run-s1", "run-s2"]) {
      put(`runs/${id}/run.yaml`, `run_id: ${id}\n`);
      put(`runs/${id}/logs/v1.4-events.jsonl`, `{"event":"llm_call"}\n`);
    }
    const a = run("run-s1").analysis;
    const b = run("run-s2").analysis;
    expect(a.run.id).toBe("run-s1");
    expect(b.run.id).toBe("run-s2");
    expect(a.analysis_id).not.toBe(b.analysis_id);
    expect(a.unallocated_request_ids).toEqual([]);
    expect(b.unallocated_request_ids).toEqual([]);
  });

  it("negative control: a request without a task is not allocated to its nearest-timestamp neighbour", () => {
    put("runs/run-near/run.yaml", "run_id: run-near\n");
    put("runs/run-near/trace.jsonl", jsonl([
      ev("run-near", "ev-1", "2026-10-26T00:00:10.000Z", use("request-1", 10, 0, 5), "task-1", "attempt-1"),
      ev("run-near", "ev-2", "2026-10-26T00:00:10.001Z", use("request-2", 10, 0, 5), null, null),
    ]));
    const a = run("run-near").analysis;
    expect(a.unallocated_request_ids).toEqual(["request-2"]);
    expect(a.state.observability).toBe("complete");
  });

  it("unsafe run ids and symlinked run inputs are refused", () => {
    expect(() => run("../escape")).toThrow();
    richRun("run-1");
    const outside = path.join(root, "outside.jsonl");
    fs.renameSync(g("runs/run-1/trace.jsonl"), outside);
    fs.symlinkSync(outside, g("runs/run-1/trace.jsonl"));
    const a = run("run-1").analysis;
    expect(a.input_evidence.find((e) => e.path === "runs/run-1/trace.jsonl")!.availability).not.toBe("available");
    expect(a.usage).toEqual([]);
  });
});
