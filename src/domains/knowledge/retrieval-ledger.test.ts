/**
 * K05 (CW-26) — recall instrumentation and explicit knowledge-use links.
 * AT52 installed-retrieval instrumentation (in-repo compiled CLI; installed
 * hosts are V01), AT20 capture safety for the retrieval ledger. Disposable roots only.
 *
 * GF6 is read from the frozen A02 golden fixture (A02_CONTRACT_ROOT, or
 * <umbrella>/contracts/guild-stack/v2). K05_REQUIRE_A02=1 makes it mandatory.
 */
import { afterEach, describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  RETRIEVAL_RECORD_SCHEMA,
  beginRetrieval,
  instrumentRetrieval,
  readRetrievalLedger,
  recordKnowledgeUse,
  retrievalDir,
  type RetrievalClock,
  type RetrievalContext,
} from "./retrieval-ledger";
import { basisDigest, type Sha256 } from "./source-basis";
import { publishGeneration, readPublication, type BasisRef, type PublicationArtifacts } from "./publication";
import { recall } from "./recall";
import { phaseStartRecall } from "./phase-start";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..", "..");
const A02_ROOT = process.env["A02_CONTRACT_ROOT"] ?? path.resolve(PLUGIN_ROOT, "../contracts/guild-stack/v2");
const A02_PRESENT = fs.existsSync(path.join(A02_ROOT, "fixtures", "golden.json"));

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function tmpRoot(prefix = "k05-"): string {
  const r = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(r);
  return r;
}

function runDirIn(root: string, runId = "run-k05"): string {
  const d = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** A clock that returns scripted controller and monotonic instants (ms). */
function scriptedClock(ticks: number[]): RetrievalClock {
  let i = 0;
  return {
    wall: (ms?: number) => new Date(Date.UTC(2026, 9, 26) + (ms ?? 0)).toISOString(),
    monotonicNs: () => {
      const ms = ticks[i++];
      if (ms === undefined) throw new Error("clock exhausted");
      return BigInt(ms) * 1_000_000n;
    },
  };
}

function ctx(runDir: string, over: Partial<RetrievalContext> = {}): RetrievalContext {
  return {
    runDir,
    run_id: path.basename(runDir),
    source_id: "source-a",
    entry_point: "recall_api",
    mode: "recall",
    use_capture: "supported",
    ...over,
  };
}

/** Every byte under a directory, for leak scans. */
function allBytes(dir: string): string {
  if (!fs.existsSync(dir)) return "";
  let out = "";
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true } as never) as unknown as fs.Dirent[]) {
    const p = path.join((e as unknown as { parentPath?: string; path?: string }).parentPath ?? (e as unknown as { path: string }).path, e.name);
    if (e.isFile()) out += fs.readFileSync(p, "utf8") + "\n";
  }
  return out;
}

interface Gf6Query { query_id: string; start_ms: number; end_ms: number; result_count: number; mirror: boolean; explicit_use: boolean }
interface Gf6 { inputs: { queries: Gf6Query[] }; documents: Array<{ id: string; instance: { metrics: Array<{ metric_id: string; points: Array<Record<string, unknown>> }> } }> }

const VENDORED_GF6_INPUTS: Gf6Query[] = [
  { query_id: "q1", start_ms: 0, end_ms: 10, result_count: 3, mirror: false, explicit_use: true },
  { query_id: "q2", start_ms: 20, end_ms: 40, result_count: 0, mirror: false, explicit_use: false },
  { query_id: "q1", start_ms: 0, end_ms: 10, result_count: 3, mirror: true, explicit_use: true },
];

function loadGf6(): Gf6 | null {
  if (!A02_PRESENT) {
    expect(process.env["K05_REQUIRE_A02"]).not.toBe("1");
    return null;
  }
  const golden = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "fixtures", "golden.json"), "utf8")) as { fixtures: Array<Gf6 & { id: string }> };
  const gf6 = golden.fixtures.find((f) => f.id === "GF6");
  expect(gf6).toBeDefined();
  expect(gf6!.inputs.queries).toEqual(VENDORED_GF6_INPUTS);
  return gf6!;
}

/** Drive the GF6 inputs through the real instrumentation and return the ledger. */
function driveGf6(runDir: string, useCapture: "supported" | "unsupported") {
  const ids = new Map<string, string>();
  for (const q of VENDORED_GF6_INPUTS) {
    const c = ctx(runDir, {
      use_capture: useCapture,
      clock: scriptedClock([q.start_ms, q.end_ms]),
      ...(q.mirror ? { identity: { kind: "mirror" as const, of: ids.get(q.query_id)! } } : {}),
    });
    const res = instrumentRetrieval(`query ${q.query_id}`, c, () =>
      Array.from({ length: q.result_count }, (_, k) => ({ ref: `wiki/decisions/${q.query_id}-${k}.md`, content: `body ${k}` })),
    );
    expect(res.record).not.toBeNull();
    if (!q.mirror) ids.set(q.query_id, res.record!.query_id);
    if (q.explicit_use && !q.mirror && useCapture === "supported") {
      const u = recordKnowledgeUse({ runDir, query_id: res.record!.query_id, ordinal: 0, consumer: { kind: "handoff", id: "lane-a" } });
      expect(u.ok).toBe(true);
    }
  }
  return readRetrievalLedger(runDir);
}

const pick = (p: Record<string, unknown>) => ({
  value: p["value"],
  numerator: p["numerator"],
  denominator: p["denominator"],
  coverage: p["coverage"],
});

describe("AT52 · installed retrieval instrumentation", () => {
  test("GF6: two completed queries, hit 1/2, mean 15ms, p95 20ms, mirror adds 0, explicit use 1/2", () => {
    const gf6 = loadGf6();
    const capable = driveGf6(runDirIn(tmpRoot(), "run-capable"), "supported");
    const unsupported = driveGf6(runDirIn(tmpRoot(), "run-unsupported"), "unsupported");

    for (const [ledger, docId] of [[capable, "capable"], [unsupported, "use-unsupported"]] as const) {
      expect(ledger.groups).toHaveLength(1);
      const g = ledger.groups[0]!;
      const got = {
        "M26.query_count": g.metrics.query_count,
        "M26.retrieval_hit_ratio": g.metrics.retrieval_hit_ratio,
        "M26.retrieval_latency_mean_ms": g.metrics.retrieval_latency_mean_ms,
        "M26.retrieval_latency_p95_ms": g.metrics.retrieval_latency_p95_ms,
        "M12.duplicate_count": g.metrics.duplicate_count,
        "M26.retrieval_use_ratio": g.metrics.retrieval_use_ratio,
      };
      expect(g.metrics.query_count.value).toBe(2);
      expect(g.metrics.duplicate_count.value).toBe(1);
      expect(g.metrics.retrieval_hit_ratio).toMatchObject({ value: 0.5, numerator: 1, denominator: 2 });
      expect(g.metrics.retrieval_latency_mean_ms).toMatchObject({ value: 15, numerator: 30, denominator: 2 });
      expect(g.metrics.retrieval_latency_p95_ms.value).toBe(20);
      expect(g.metrics.retrieval_latency_p50_ms.value).toBe(10);
      if (gf6) {
        const doc = gf6.documents.find((d) => d.id === docId)!;
        for (const m of doc.instance.metrics) {
          const mine = got[m.metric_id as keyof typeof got];
          expect(mine).toBeDefined();
          const want = pick(m.points[0]!);
          // Golden point reason strings are fixture prose; values, ratio parts and coverage counts must match.
          const { reason: _r, ...wantCov } = want.coverage as Record<string, unknown>;
          const { reason: _m, ...gotCov } = mine!.coverage as unknown as Record<string, unknown>;
          expect({ ...want, coverage: wantCov }).toEqual({ ...pick(mine as never), coverage: gotCov });
        }
      }
    }
    expect(capable.groups[0]!.metrics.retrieval_use_ratio).toMatchObject({ value: 0.5, numerator: 1, denominator: 2 });
    expect(capable.groups[0]!.metrics.retrieval_use_ratio.coverage.state).toBe("complete");
    // Unsupported use capture is unavailable without touching observed hit or latency.
    expect(unsupported.groups[0]!.metrics.retrieval_use_ratio).toMatchObject({ value: null, numerator: null, denominator: null });
    expect(unsupported.groups[0]!.metrics.retrieval_use_ratio.coverage).toMatchObject({ eligible: 2, covered: 0, missing: 2, state: "unavailable" });
    expect(unsupported.groups[0]!.metrics.retrieval_hit_ratio.coverage.state).toBe("complete");
  });

  test("negative control: a naive counter that ignores declared mirrors counts the duplicate twice", () => {
    const runDir = runDirIn(tmpRoot());
    driveGf6(runDir, "supported");
    const files = fs.readdirSync(retrievalDir(runDir)).filter((f) => f.endsWith(".json") && !f.endsWith(".started.json"));
    expect(files).toHaveLength(3);
    expect(readRetrievalLedger(runDir).groups[0]!.metrics.query_count.value).toBe(2);
  });

  test("source and generation join the published C13 record exactly; unpublished never fabricates one", () => {
    const root = tmpRoot();
    const indexesDir = path.join(root, ".guild", "indexes");
    fs.mkdirSync(path.join(root, ".guild", "wiki", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "wiki", "decisions", "cache.md"), "---\ntype: decision\n---\n# cache policy\nwe cache the build graph\n");
    const runDir = runDirIn(root);

    const recallBytes = Buffer.from(JSON.stringify({ schema_version: "guild.knowledge_links.v2", nodes: [], edges: [] }));
    // No export at all: the KG branch read nothing, so nothing is named.
    recall("cache policy", { cwd: root, runDir, runId: "run-k05" });
    expect(readRetrievalLedger(runDir).records[0]!.generation).toMatchObject({ state: "unbound", generation: null });

    // An export a legacy writer left with nothing published: unpublished, never a generation.
    fs.mkdirSync(indexesDir, { recursive: true });
    fs.writeFileSync(path.join(indexesDir, "knowledge-recall.json"), recallBytes);
    recall("cache policy", { cwd: root, runDir, runId: "run-k05" });
    let ledger = readRetrievalLedger(runDir);
    expect(ledger.records.filter((r) => r.generation.state === "unpublished")).toHaveLength(1);
    fs.rmSync(path.join(indexesDir, "knowledge-recall.json"));
    const b = basisRef();
    const pub = publishGeneration({
      indexesDir,
      identity: { source_id: "owner-main", durable_owner_source_id: "owner-main", publication_scope_source_id: "owner-main" },
      layers: { recall: { artifact: "knowledge-recall.json", digest: (a: PublicationArtifacts) => basisDigest(a["knowledge-recall.json"]?.toString("utf8") ?? "") } },
      base: null,
      basis: b,
      observe: () => b,
      channels: ["recall"],
      artifacts: { "knowledge-recall.json": recallBytes },
      exports: ["knowledge-recall.json"],
    } as never);
    expect(pub.status).toBe("published");
    const g = readPublication(indexesDir)!;

    recall("cache policy", { cwd: root, runDir, runId: "run-k05" });
    ledger = readRetrievalLedger(runDir);
    const rec = ledger.records.find((r) => r.generation.state === "published")!;
    expect(rec).toBeDefined();
    expect(rec.source_id).toBe(g.record.source_id);
    expect(rec.generation.generation).toBe(g.pointer.generation);
    expect(rec.generation.publication_sha256).toBe(g.pointer.publication_sha256);
    expect(rec.generation.recall_channel_state).toBe(g.record.channels.find((c) => c.channel === "recall")!.state);
    expect(ledger.groups.map((x) => x.generation)).toEqual([g.pointer.generation, null]);

    // A legacy export that no longer matches the pinned generation is unknown, not G.
    fs.writeFileSync(path.join(indexesDir, "knowledge-recall.json"), JSON.stringify({ schema_version: "guild.knowledge_links.v2", nodes: [{ id: "x", type: "concept", name: "unrelated", confidence: "high", source_refs: [] }], edges: [] }));
    // A query whose KG branch never ran read no published channel: unbound, not G.
    recall("cache policy", { cwd: root, runDir, runId: "run-k05", _kgDisabled: true });
    expect(readRetrievalLedger(runDir).records.filter((r) => r.generation.state === "unbound")).toHaveLength(2);

    recall("cache policy", { cwd: root, runDir, runId: "run-k05" });
    const lagging = readRetrievalLedger(runDir).records.filter((r) => r.generation.state === "export_unknown");
    expect(lagging).toHaveLength(1);
    expect(lagging[0]!.generation.generation).toBeNull();

    // A query lost before completing has no known generation: the published group is incomplete too.
    expect(readRetrievalLedger(runDir).groups.find((x) => x.generation === g.pointer.generation)!.metrics.retrieval_hit_ratio.coverage.state).toBe("complete");
    beginRetrieval("lost", ctx(runDir));
    for (const grp of readRetrievalLedger(runDir).groups) expect(grp.metrics.retrieval_hit_ratio.coverage.state).toBe("partial");
  });

  test("hit, miss and error persist with real timing; error is excluded from the hit denominator; a retry is explicit", () => {
    const runDir = runDirIn(tmpRoot());
    const hit = instrumentRetrieval("q hit", ctx(runDir, { clock: scriptedClock([0, 5]) }), () => [{ ref: "a.md", content: "x" }]);
    const miss = instrumentRetrieval("q miss", ctx(runDir, { clock: scriptedClock([10, 30]) }), () => []);
    expect(() =>
      instrumentRetrieval("q err", ctx(runDir, { clock: scriptedClock([40, 41]) }), () => {
        throw new Error("disk said /Users/alice/secret-path");
      }),
    ).toThrow(/disk said/);
    const ledger1 = readRetrievalLedger(runDir);
    const err = ledger1.records.find((r) => r.outcome.status === "error")!;
    expect(err.outcome).toEqual({ status: "error", result_count: null, error_code: "producer_threw" });
    expect(JSON.stringify(err)).not.toContain("alice");
    const retry = instrumentRetrieval("q err", ctx(runDir, { clock: scriptedClock([50, 60]), identity: { kind: "retry", of: err.query_id } }), () => [{ ref: "b.md", content: "y" }]);
    expect(retry.record!.identity).toEqual({ kind: "retry", of: err.query_id, attempt: 2 });

    expect(hit.record!.outcome).toEqual({ status: "hit", result_count: 1, error_code: null });
    expect(miss.record!.outcome).toEqual({ status: "miss", result_count: 0, error_code: null });
    expect(hit.record!.clock.duration_ms).toBe(5);
    expect(hit.record!.clock.monotonic.clock).toBe("process.hrtime");

    const m = readRetrievalLedger(runDir).groups[0]!.metrics;
    expect(m.query_count.value).toBe(3);
    expect(m.error_count.value).toBe(1);
    expect(m.retrieval_hit_ratio).toMatchObject({ value: 2 / 3, numerator: 2, denominator: 3 });
    expect(m.retrieval_hit_ratio.coverage).toMatchObject({ eligible: 4, covered: 3, excluded: 1, missing: 0, state: "complete" });
  });

  test("the compiled recall CLI records non-Stack queries and accepts an explicit use link", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".guild", "wiki", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "wiki", "decisions", "cache.md"), "---\ntype: decision\n---\n# cache policy\nwe cache the build graph\n");
    runDirIn(root, "run-cli");
    const cli = path.join(PLUGIN_ROOT, "runtime", "scripts", "recall.js");
    const env = { ...process.env, GUILD_RUN_BINDING_REF: "", GUILD_INDEX: "off" };
    delete (env as Record<string, string | undefined>)["GUILD_RUN_BINDING_REF"];
    const r1 = spawnSync("node", [cli, "--query", "cache policy", "--cwd", root, "--run-id", "run-cli"], { encoding: "utf8", env });
    expect(r1.status).toBe(0);
    const out = JSON.parse(r1.stdout) as { chunks: unknown[]; retrieval?: { query_id: string; use_capture: string; status: string } };
    expect(out.chunks.length).toBeGreaterThan(0);
    expect(out.retrieval).toMatchObject({ use_capture: "supported", status: "hit" });

    const r2 = spawnSync("node", [cli, "--record-use", "--cwd", root, "--run-id", "run-cli", "--query-id", out.retrieval!.query_id, "--result", "0", "--consumer-kind", "handoff", "--consumer-id", "lane-b"], { encoding: "utf8", env });
    expect(r2.status).toBe(0);
    expect(JSON.parse(r2.stdout)).toMatchObject({ ok: true });

    const runDir = path.join(root, ".guild", "runs", "run-cli");
    const ledger = readRetrievalLedger(runDir);
    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]!).toMatchObject({ schema_version: RETRIEVAL_RECORD_SCHEMA, entry_point: "recall_cli", launch_path: "non_stack" });
    expect(ledger.groups[0]!.metrics.retrieval_use_ratio).toMatchObject({ value: 1, numerator: 1, denominator: 1 });

    // A forged CLI use (result outside the returned set) is refused and writes nothing.
    const r3 = spawnSync("node", [cli, "--record-use", "--cwd", root, "--run-id", "run-cli", "--query-id", out.retrieval!.query_id, "--result", "99", "--consumer-kind", "handoff", "--consumer-id", "lane-b"], { encoding: "utf8", env });
    expect(r3.status).toBe(1);
    expect(readRetrievalLedger(runDir).uses).toHaveLength(1);
  });

  test("phase-start recall is a recorded retrieval with no use capture; its hits still count", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".guild", "wiki", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "wiki", "decisions", "cache.md"), "---\ntype: decision\n---\n# cache policy\nwe cache the build graph\n");
    const runDir = runDirIn(root, "run-phase");
    // runDir alone (the CLI's --run-dir) is enough to record.
    phaseStartRecall("cache policy", { cwd: root, phase: "build", cell_id: "c1", runDir });
    const ledger = readRetrievalLedger(runDir);
    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]!).toMatchObject({ entry_point: "phase_start", use_capture: "unsupported" });
    expect(ledger.groups[0]!.metrics.query_count.value).toBe(1);
    expect(ledger.groups[0]!.metrics.retrieval_use_ratio.coverage.state).toBe("unavailable");
  });

  test("a Stack launch is labelled stack_launch; both paths record", () => {
    const runDir = runDirIn(tmpRoot());
    instrumentRetrieval("a", ctx(runDir, { launch_path: "stack_launch" }), () => []);
    instrumentRetrieval("b", ctx(runDir), () => []);
    expect(readRetrievalLedger(runDir).records.map((r) => r.launch_path).sort()).toEqual(["non_stack", "stack_launch"]);
  });

  test("missing is not zero: no ledger is unavailable; a started query without a record makes coverage partial", () => {
    const runDir = runDirIn(tmpRoot());
    const none = readRetrievalLedger(runDir);
    expect(none.state).toBe("unavailable");
    expect(none.groups).toEqual([]);

    instrumentRetrieval("done", ctx(runDir), () => [{ ref: "a.md", content: "x" }]);
    // A query that started and never completed (process died): only the start marker exists.
    const h = beginRetrieval("crashed", ctx(runDir));
    expect(h).not.toBeNull();
    const ledger = readRetrievalLedger(runDir);
    expect(ledger.losses).toContainEqual({ code: "started_not_completed", count: 1 });
    const m = ledger.groups[0]!.metrics;
    expect(m.query_count.value).toBe(1);
    expect(m.retrieval_hit_ratio.coverage).toMatchObject({ eligible: 2, covered: 1, missing: 1, state: "partial" });
  });
});

describe("K05 · knowledge-use link integrity", () => {
  function setup() {
    const runDir = runDirIn(tmpRoot());
    const res = instrumentRetrieval("cache", ctx(runDir), () => [
      { ref: "wiki/a.md", content: "a" },
      { ref: "wiki/b.md", content: "b" },
    ]);
    return { runDir, qid: res.record!.query_id };
  }

  test("dangling, out-of-range and miss-query uses are refused and write nothing", () => {
    const { runDir, qid } = setup();
    const miss = instrumentRetrieval("nothing", ctx(runDir), () => []);
    expect(recordKnowledgeUse({ runDir, query_id: "q-missing", ordinal: 0, consumer: { kind: "handoff", id: "x" } })).toMatchObject({ ok: false, code: "dangling" });
    expect(recordKnowledgeUse({ runDir, query_id: qid, ordinal: 2, consumer: { kind: "handoff", id: "x" } })).toMatchObject({ ok: false, code: "not_in_results" });
    expect(recordKnowledgeUse({ runDir, query_id: miss.record!.query_id, ordinal: 0, consumer: { kind: "handoff", id: "x" } })).toMatchObject({ ok: false, code: "not_in_results" });
    expect(recordKnowledgeUse({ runDir, query_id: "../escape", ordinal: 0, consumer: { kind: "handoff", id: "x" } })).toMatchObject({ ok: false, code: "invalid" });
    expect(recordKnowledgeUse({ runDir, query_id: qid, ordinal: 0, consumer: { kind: "handoff", id: "../../etc" } })).toMatchObject({ ok: false, code: "invalid" });
    expect(readRetrievalLedger(runDir).uses).toEqual([]);
  });

  test("a repeated use of the same result by the same consumer counts once", () => {
    const { runDir, qid } = setup();
    const a = recordKnowledgeUse({ runDir, query_id: qid, ordinal: 1, consumer: { kind: "artifact", id: "plan-1" } });
    const b = recordKnowledgeUse({ runDir, query_id: qid, ordinal: 1, consumer: { kind: "artifact", id: "plan-1" } });
    expect(a.ok && b.ok && a.use_id === b.use_id).toBe(true);
    expect(readRetrievalLedger(runDir).uses).toHaveLength(1);
  });

  test("hand-written forged or dangling use files are excluded and counted, never adopted", () => {
    const { runDir, qid } = setup();
    const ok = recordKnowledgeUse({ runDir, query_id: qid, ordinal: 0, consumer: { kind: "handoff", id: "lane-a" } });
    expect(ok.ok).toBe(true);
    const usesDir = path.join(runDir, "knowledge", "uses");
    const genuine = JSON.parse(fs.readFileSync(path.join(usesDir, `${(ok as { use_id: string }).use_id}.json`), "utf8"));
    // Forged: points at a result hash the query never returned.
    const forged = { ...genuine, consumer: { kind: "handoff", id: "lane-z" }, result: { ordinal: 0, ref_sha256: `sha256:${"f".repeat(64)}` } };
    forged.use_id = "u-forged";
    fs.writeFileSync(path.join(usesDir, "u-forged.json"), JSON.stringify(forged));
    // Dangling: names a query with no record.
    const dangling = { ...genuine, use_id: "u-dangling", query_id: "q-nope" };
    fs.writeFileSync(path.join(usesDir, "u-dangling.json"), JSON.stringify(dangling));
    const ledger = readRetrievalLedger(runDir);
    expect(ledger.uses).toHaveLength(1);
    expect(ledger.losses).toContainEqual({ code: "forged_use", count: 1 });
    expect(ledger.losses).toContainEqual({ code: "dangling_use", count: 1 });
    // Unverifiable use evidence makes the use ratio unknown; hit stays observed.
    expect(ledger.groups[0]!.metrics.retrieval_use_ratio).toMatchObject({ value: null, numerator: null });
    expect(ledger.groups[0]!.metrics.retrieval_use_ratio.coverage.state).toBe("unavailable");
    expect(ledger.groups[0]!.metrics.retrieval_hit_ratio.coverage.state).toBe("complete");
  });

  test("a use naming another run, or a malformed recorded_at, is not genuine", () => {
    const { runDir, qid } = setup();
    const ok = recordKnowledgeUse({ runDir, query_id: qid, ordinal: 0, consumer: { kind: "handoff", id: "lane-a" } });
    const f = path.join(runDir, "knowledge", "uses", `${(ok as { use_id: string }).use_id}.json`);
    const u = JSON.parse(fs.readFileSync(f, "utf8"));
    fs.writeFileSync(f, JSON.stringify({ ...u, run_id: "wrong-run" }));
    expect(readRetrievalLedger(runDir).uses).toHaveLength(0);
    fs.writeFileSync(f, JSON.stringify({ ...u, recorded_at: "yesterday" }));
    expect(readRetrievalLedger(runDir).uses).toHaveLength(0);
    fs.writeFileSync(f, JSON.stringify(u));
    expect(readRetrievalLedger(runDir).uses).toHaveLength(1);
  });

  test("a use of a verified mirror counts for the query it mirrors", () => {
    const runDir = runDirIn(tmpRoot());
    const items = () => [{ ref: "a.md", content: "a" }];
    const orig = instrumentRetrieval("x", ctx(runDir), items);
    const mirror = instrumentRetrieval("x", ctx(runDir, { identity: { kind: "mirror", of: orig.record!.query_id } }), items);
    expect(recordKnowledgeUse({ runDir, query_id: mirror.record!.query_id, ordinal: 0, consumer: { kind: "task", id: "t1" } }).ok).toBe(true);
    const m = readRetrievalLedger(runDir).groups[0]!.metrics;
    expect(m.duplicate_count.value).toBe(1);
    expect(m.retrieval_use_ratio).toMatchObject({ value: 1, numerator: 1, denominator: 1 });
  });

  test("an unreadable uses directory makes use unknown, not zero", () => {
    const { runDir } = setup();
    const ud = path.join(runDir, "knowledge", "uses");
    fs.mkdirSync(ud, { recursive: true });
    fs.chmodSync(ud, 0o000);
    try {
      const m = readRetrievalLedger(runDir).groups[0]!.metrics;
      expect(m.retrieval_use_ratio.value).toBeNull();
      expect(m.retrieval_use_ratio.coverage.state).toBe("unavailable");
      expect(m.retrieval_hit_ratio.coverage.state).toBe("complete");
    } finally {
      fs.chmodSync(ud, 0o700);
    }
  });

  test("a record missing required clock or redaction fields is invalid, never counted", () => {
    const { runDir, qid } = setup();
    const f = path.join(retrievalDir(runDir), `${qid}.json`);
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    delete rec.clock.controller_started_at;
    fs.writeFileSync(f, JSON.stringify(rec));
    const ledger = readRetrievalLedger(runDir);
    expect(ledger.records).toHaveLength(0);
    expect(ledger.losses).toContainEqual({ code: "invalid_record", count: 1 });
  });

  test("tampering with a retrieval record after a use invalidates the record and its use", () => {
    const { runDir, qid } = setup();
    expect(recordKnowledgeUse({ runDir, query_id: qid, ordinal: 0, consumer: { kind: "handoff", id: "lane-a" } }).ok).toBe(true);
    const f = path.join(retrievalDir(runDir), `${qid}.json`);
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    rec.outcome.result_count = 50;
    fs.writeFileSync(f, JSON.stringify(rec));
    const ledger = readRetrievalLedger(runDir);
    expect(ledger.records).toHaveLength(0);
    expect(ledger.uses).toHaveLength(0);
    expect(ledger.losses).toContainEqual({ code: "invalid_record", count: 1 });
    expect(ledger.groups[0]!.metrics.retrieval_hit_ratio.coverage.state).not.toBe("complete");
  });

  test("a record id is immutable: a replay with different content is refused", () => {
    const runDir = runDirIn(tmpRoot());
    const a = instrumentRetrieval("x", ctx(runDir, { query_id: "q-fixed", clock: scriptedClock([0, 1]) }), () => []);
    expect(a.record).not.toBeNull();
    const b = instrumentRetrieval("x", ctx(runDir, { query_id: "q-fixed", clock: scriptedClock([0, 9]) }), () => []);
    expect(b.record).toBeNull();
    expect(b.loss).toBe("record_conflict");
    expect(readRetrievalLedger(runDir).records[0]!.clock.duration_ms).toBe(1);
    // The query that ran under the reused id is not silently dropped: coverage is incomplete.
    expect(readRetrievalLedger(runDir).groups[0]!.metrics.query_count.coverage.state).toBe("partial");
  });

  test("a mirror must name an existing original with the same query and results", () => {
    const runDir = runDirIn(tmpRoot());
    const orig = instrumentRetrieval("x", ctx(runDir), () => [{ ref: "a.md", content: "a" }]);
    instrumentRetrieval("x", ctx(runDir, { identity: { kind: "mirror", of: "q-not-there" } }), () => [{ ref: "a.md", content: "a" }]);
    instrumentRetrieval("other", ctx(runDir, { identity: { kind: "mirror", of: orig.record!.query_id } }), () => [{ ref: "a.md", content: "a" }]);
    const ledger = readRetrievalLedger(runDir);
    // Neither false mirror may hide a query: both count as their own queries and are flagged.
    expect(ledger.groups[0]!.metrics.duplicate_count.value).toBe(0);
    expect(ledger.groups[0]!.metrics.query_count.value).toBe(3);
    expect(ledger.losses).toContainEqual({ code: "unverified_mirror", count: 2 });
  });

  test("a failed query names no generation, even with a published store", () => {
    const runDir = runDirIn(tmpRoot());
    expect(() => instrumentRetrieval("x", ctx(runDir, { indexesDir: path.join(runDir, "nowhere") }), () => { throw new Error("boom"); }, undefined, () => ({ recall_export_sha256: `sha256:${"a".repeat(64)}` }))).toThrow("boom");
    expect(readRetrievalLedger(runDir).records[0]!.generation).toMatchObject({ state: "unbound", generation: null });
  });

  test("a mirror's capture marker does not stand in for its original's", () => {
    const runDir = runDirIn(tmpRoot());
    const items = () => [{ ref: "a.md", content: "a" }];
    const o = instrumentRetrieval("x", ctx(runDir), items);
    instrumentRetrieval("x", ctx(runDir, { identity: { kind: "mirror", of: o.record!.query_id } }), items);
    fs.rmSync(path.join(runDir, "knowledge", "uses", `${o.record!.query_id}.capture.json`));
    expect(readRetrievalLedger(runDir).groups[0]!.metrics.retrieval_use_ratio.coverage.state).toBe("unavailable");
  });

  test("a use of edited record bytes is refused at write and not adopted at read", () => {
    const runDir = runDirIn(tmpRoot());
    const o = instrumentRetrieval("x", ctx(runDir), () => [{ ref: "a.md", content: "a" }]);
    const f = path.join(retrievalDir(runDir), `${o.record!.query_id}.json`);
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    fs.writeFileSync(f, JSON.stringify({ ...rec, run_id: "other-run" }));
    expect(recordKnowledgeUse({ runDir, query_id: o.record!.query_id, ordinal: 0, consumer: { kind: "task", id: "t" } })).toMatchObject({ ok: false, code: "record_invalid" });
    expect(readRetrievalLedger(runDir).uses).toHaveLength(0);
  });

  test("a deleted use-capture marker makes the use ratio incomplete, not an observed zero", () => {
    const { runDir, qid } = setup();
    expect(readRetrievalLedger(runDir).groups[0]!.metrics.retrieval_use_ratio).toMatchObject({ value: 0, numerator: 0, denominator: 1 });
    fs.rmSync(path.join(runDir, "knowledge", "uses", `${qid}.capture.json`));
    const u = readRetrievalLedger(runDir).groups[0]!.metrics.retrieval_use_ratio;
    expect(u.value).toBeNull();
    expect(u.coverage).toMatchObject({ covered: 0, missing: 1, state: "unavailable" });
  });

  test("an unattributable loss makes every generation group incomplete", () => {
    const runDir = runDirIn(tmpRoot());
    instrumentRetrieval("x", ctx(runDir), () => [{ ref: "a.md", content: "a" }]);
    beginRetrieval("lost", ctx(runDir));
    for (const g of readRetrievalLedger(runDir).groups) expect(g.metrics.retrieval_hit_ratio.coverage.state).not.toBe("complete");
  });

  test("mirrors and retries must match run, source, mode and query; a retry must be the next attempt and not itself", () => {
    const runDir = runDirIn(tmpRoot());
    const items = () => [{ ref: "a.md", content: "a" }];
    const orig = instrumentRetrieval("x", ctx(runDir), items);
    instrumentRetrieval("x", ctx(runDir, { mode: "recall_category", identity: { kind: "mirror", of: orig.record!.query_id } }), items);
    instrumentRetrieval("x", ctx(runDir, { source_id: "source-b", identity: { kind: "mirror", of: orig.record!.query_id } }), items);
    expect(instrumentRetrieval("x", ctx(runDir, { query_id: "q-self", identity: { kind: "retry", of: "q-self" } }), items).record).toBeNull();
    const retry = instrumentRetrieval("x", ctx(runDir, { identity: { kind: "retry", of: orig.record!.query_id } }), items);
    instrumentRetrieval("other", ctx(runDir, { identity: { kind: "retry", of: orig.record!.query_id } }), items);
    const ledger = readRetrievalLedger(runDir);
    expect(retry.record!.identity.attempt).toBe(2);
    expect(ledger.groups[0]!.metrics.duplicate_count.value).toBe(0);
    expect(ledger.losses).toContainEqual({ code: "unverified_mirror", count: 2 });
    expect(ledger.losses).toContainEqual({ code: "unverified_retry", count: 1 });
  });

  test("mirror identity covers results past the stored cap; truncated queries are not use-covered", () => {
    const runDir = runDirIn(tmpRoot());
    const many = (last: string) => Array.from({ length: 201 }, (_, k) => ({ ref: `p${k}.md`, content: k === 200 ? last : `c${k}` }));
    const a = instrumentRetrieval("x", ctx(runDir), () => many("A"));
    instrumentRetrieval("x", ctx(runDir, { identity: { kind: "mirror", of: a.record!.query_id } }), () => many("B"));
    const ledger = readRetrievalLedger(runDir);
    expect(ledger.groups[0]!.metrics.duplicate_count.value).toBe(0);
    expect(ledger.groups[0]!.metrics.retrieval_use_ratio.value).toBeNull();
    expect(ledger.groups[0]!.metrics.retrieval_use_ratio.coverage.state).toBe("unavailable");
  });

  test("withheld refs make result identity unverifiable, so a mirror cannot fold two queries", () => {
    const runDir = runDirIn(tmpRoot());
    const o = instrumentRetrieval("x", ctx(runDir), () => [{ ref: "/Users/alice/a.md", content: "same" }]);
    instrumentRetrieval("x", ctx(runDir, { identity: { kind: "mirror", of: o.record!.query_id } }), () => [{ ref: "/Users/alice/b.md", content: "same" }]);
    expect(o.record!.results_identity_verifiable).toBe(false);
    expect(readRetrievalLedger(runDir).groups[0]!.metrics.query_count.value).toBe(2);
  });

  test("a start marker that failed to write still leaves the query visible as lost", () => {
    const runDir = runDirIn(tmpRoot());
    instrumentRetrieval("a", ctx(runDir), () => []);
    const rd = retrievalDir(runDir);
    fs.chmodSync(rd, 0o500);
    let h: ReturnType<typeof beginRetrieval>;
    try { h = beginRetrieval("b", ctx(runDir)); } finally { fs.chmodSync(rd, 0o700); }
    expect(h!.complete([{ ref: "x.md", content: "x" }]).loss).toBe("start_not_written");
    expect(readRetrievalLedger(runDir).groups[0]!.metrics.query_count.coverage.state).toBe("partial");
  });

  test("a throwing generation observer never changes the recall result", () => {
    const root = tmpRoot();
    const idx = path.join(root, ".guild", "indexes");
    fs.mkdirSync(idx, { recursive: true });
    fs.writeFileSync(path.join(idx, "knowledge-recall.json"), JSON.stringify({ schema_version: "guild.knowledge_links.v2", nodes: [{ id: "n1", type: "concept", name: "cache policy", confidence: "high", source_refs: [] }], edges: [] }));
    const plain = recall("cache policy", { cwd: root });
    const observed = recall("cache policy", { cwd: root, _onRecallExportRead: () => { throw new Error("observer"); } });
    expect(observed.chunks.length).toBe(plain.chunks.length);
    expect(plain.chunks.length).toBeGreaterThan(0);
  });

  test("query ids cannot alias the marker namespace", () => {
    const runDir = runDirIn(tmpRoot());
    expect(instrumentRetrieval("x", ctx(runDir, { query_id: "q-reserved.started" }), () => []).record).toBeNull();
  });

  test("a fresh non-Stack run directory receives its first record, even without runs/", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    const runDir = path.join(root, ".guild", "runs", "run-fresh");
    expect(instrumentRetrieval("x", ctx(runDir), () => []).record).not.toBeNull();
    expect(readRetrievalLedger(runDir).records).toHaveLength(1);
  });

  test("a symlinked knowledge directory escaping the run is refused; no bytes land outside", () => {
    const root = tmpRoot();
    const runDir = runDirIn(root);
    const outside = tmpRoot("k05-outside-");
    fs.symlinkSync(outside, path.join(runDir, "knowledge"));
    const r = instrumentRetrieval("x", ctx(runDir), () => [{ ref: "a.md", content: "a" }]);
    expect(r.result).toEqual([{ ref: "a.md", content: "a" }]);
    expect(r.record).toBeNull();
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe("AT20 · retrieval capture safety", () => {
  const SECRET = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
  const AWS = "AKIA" + "ABCDEFGHIJKLMNOP";

  test("a secret-bearing query never reaches the ledger or recall telemetry; preview is off by default", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".guild", "wiki", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "wiki", "decisions", "tok.md"), "---\ntype: decision\n---\n# token rotation\nrotate the token\n");
    const runDir = runDirIn(root);
    const q = `token rotation ${SECRET} key ${AWS} at /Users/alice/.ssh/id_rsa`;
    recall(q, { cwd: root, runDir, runId: "run-k05", _kgDisabled: true });
    const rec = readRetrievalLedger(runDir).records[0]!;
    expect(rec.query.preview).toBeNull();
    expect(rec.query.redacted).toBe(true);
    const bytes = allBytes(runDir);
    expect(bytes.length).toBeGreaterThan(0);
    for (const s of [SECRET, AWS, "alice"]) expect(bytes).not.toContain(s);
  });

  test("secret-shaped or private ids are refused before any path or marker is written", () => {
    const runDir = runDirIn(tmpRoot());
    const r = instrumentRetrieval("x", ctx(runDir, { query_id: SECRET }), () => []);
    expect(r.record).toBeNull();
    expect(r.loss).toBe("invalid_context");
    expect(instrumentRetrieval("x", ctx(runDir, { query_id: "q-zebra", private_literals: ["zebra"] }), () => []).record).toBeNull();
    expect(fs.existsSync(retrievalDir(runDir))).toBe(false);
    const ok = instrumentRetrieval("x", ctx(runDir, { private_literals: ["project-zebra"] }), () => [{ ref: "a.md", content: "a" }]);
    expect(recordKnowledgeUse({ runDir, query_id: ok.record!.query_id, ordinal: 0, consumer: { kind: "task", id: "project-zebra" }, private_literals: ["project-zebra"] })).toMatchObject({ ok: false, code: "invalid" });
    expect(allBytes(runDir)).not.toContain(SECRET);
  });

  test("configured private literals are scrubbed from the recall trace events too", () => {
    const root = tmpRoot();
    fs.mkdirSync(path.join(root, ".guild", "wiki", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "wiki", "decisions", "z.md"), "---\ntype: decision\n---\n# zebra plan\nplan\n");
    const runDir = runDirIn(root);
    recall("project-zebra plan", { cwd: root, runDir, runId: "run-k05", retrieval: { private_literals: ["project-zebra"] } });
    const bytes = allBytes(runDir);
    expect(bytes).toContain("query_hash");
    expect(bytes).not.toContain("project-zebra");
  });

  test("an opted-in preview is scrubbed and bounded; private literals are removed", () => {
    const runDir = runDirIn(tmpRoot());
    const res = instrumentRetrieval(`find ${SECRET} for project-zebra ${"x".repeat(5000)}`, ctx(runDir, { capture_preview: true, private_literals: ["project-zebra"] }), () => []);
    const p = res.record!.query.preview!;
    expect(p).not.toContain(SECRET);
    expect(p).not.toContain("project-zebra");
    expect(Buffer.byteLength(p)).toBeLessThanOrEqual(256);
    expect(res.record!.query.truncated).toBe(true);
    expect(allBytes(runDir)).not.toContain("project-zebra");
  });

  test("result refs that carry secrets are hashed, never stored; oversized result sets are capped with the true count kept", () => {
    const runDir = runDirIn(tmpRoot());
    const many = Array.from({ length: 500 }, (_, k) => ({ ref: k === 0 ? `notes/${SECRET}.md` : `wiki/p${k}.md`, content: `c${k}` }));
    const res = instrumentRetrieval("big", ctx(runDir), () => many);
    expect(res.record!.outcome.result_count).toBe(500);
    expect(res.record!.results).toHaveLength(200);
    expect(res.record!.results_truncated).toBe(true);
    expect(res.record!.results[0]!.ref).toBeNull();
    expect(res.record!.results[0]!.ref_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(allBytes(runDir)).not.toContain(SECRET);
  });

  test("a dropped write never changes the recall result and leaves the run incomplete, not zero", () => {
    const runDir = runDirIn(tmpRoot());
    fs.mkdirSync(path.join(runDir, "knowledge", "retrieval"), { recursive: true });
    instrumentRetrieval("first", ctx(runDir), () => [{ ref: "a.md", content: "a" }]);
    const h = beginRetrieval("second", ctx(runDir));
    fs.chmodSync(path.join(runDir, "knowledge", "retrieval"), 0o500);
    try {
      const done = h!.complete([{ ref: "b.md", content: "b" }]);
      expect(done.record).toBeNull();
      expect(done.loss).toBe("write_failed");
    } finally {
      fs.chmodSync(path.join(runDir, "knowledge", "retrieval"), 0o700);
    }
    const ledger = readRetrievalLedger(runDir);
    expect(ledger.groups[0]!.metrics.retrieval_hit_ratio.coverage.state).toBe("partial");
  });

  test("anti-vacuity: the leak scan finds a raw secret when one is written", () => {
    const runDir = runDirIn(tmpRoot());
    fs.mkdirSync(path.join(runDir, "knowledge", "retrieval"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "knowledge", "retrieval", "raw.json"), JSON.stringify({ query: SECRET }));
    expect(allBytes(runDir)).toContain(SECRET);
  });
});

function basisRef(): BasisRef {
  const H = (c: string): Sha256 => `sha256:${c.repeat(64)}` as Sha256;
  const b = {
    commit: null,
    tree: H("1"),
    dirty_blob_manifest: H("2"),
    file_inventory: basisDigest({ tag: "k05" }),
    resolver_policy: H("3"),
    scan_policy: H("4"),
    source_worktree_id: "worktree-a",
  };
  return { basis: b, source_basis_hash: basisDigest(b), inventory: [{ path: "src/a.ts", sha256: basisDigest({ f: "a" }) }] } as BasisRef;
}

void crypto;
