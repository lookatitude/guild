/**
 * scripts/__tests__/recall-emit.test.ts
 *
 * G10 — recall-decision telemetry emit.
 *
 * Asserts recall() emits a well-formed guild.trace.recall_decision.v1 event into
 * the active run's logs/v1.4-events.jsonl, with both read_skip_fired directions
 * reachable, and that with NO active run the emit is a safe no-op.
 *
 * Run: cd scripts && npx jest --no-coverage recall-emit
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { recall } from "../lib/recall";
import {
  validateRecallDecisionEvent,
  makeRecallDecisionEvent,
} from "../../src/modules/telemetry/workflows/guild-trace-events";
import { computeRecallStats, readRecallDecisionEvents } from "../recall-stats";

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

/** A temp repo with a KG projection so recall's KG branch yields a real top_score. */
function makeRepoWithKg(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g10-emit-"));
  TEMP_DIRS.push(dir);
  const doc = {
    schema_version: "guild.knowledge_links.v2",
    nodes: [
      { id: "node:pay", type: "function", name: "payment", confidence: "high", source_refs: ["src/pay.ts"], importance_score: 0.9 },
      { id: "node:bill", type: "concept", name: "billing", confidence: "medium", source_refs: ["src/payment/bill.ts"], importance_score: 0.5 },
    ],
    edges: [],
  };
  const idxDir = path.join(dir, ".guild", "indexes");
  fs.mkdirSync(idxDir, { recursive: true });
  fs.writeFileSync(path.join(idxDir, "knowledge-recall.json"), JSON.stringify(doc), "utf8");
  return dir;
}

function readDecisionEvents(runDir: string): Array<Record<string, unknown>> {
  const file = path.join(runDir, "logs", "v1.4-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => e["schema_version"] === "guild.trace.recall_decision.v1");
}

describe("G10 — recall-decision event emission", () => {
  test("1. a recall emits ≥1 well-formed recall_decision event with branch + top_score", () => {
    const cwd = makeRepoWithKg();
    const runId = "run-emit-a";
    const runDir = path.join(cwd, ".guild", "runs", runId);

    recall("payment", { cwd, runId, runDir, _bm25Disabled: true, recallScoreThreshold: 0.4 });

    const events = readDecisionEvents(runDir);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const ev = events[0];
    // Well-formed per the canonical validator (non-vacuous structural check).
    expect(validateRecallDecisionEvent(ev)).toEqual({ ok: true });
    expect(ev["branch"]).toBe("kg-query");
    expect(typeof ev["top_score"]).toBe("number");
    expect(ev["top_score"] as number).toBeGreaterThan(0);
    expect(ev["chunk_count"] as number).toBeGreaterThan(0);
    // Privacy: raw query is never logged — only a hash + short preview.
    expect(ev["query_hash"]).toMatch(/^[0-9a-f]{16}$/);
    expect(ev).not.toHaveProperty("query"); // no full raw query field
  });

  test("1b. ANTI-VACUITY: read_skip_fired is TRUE above threshold, FALSE below — both directions", () => {
    // Strong recall, low threshold → top_score >= threshold → read_skip_fired TRUE.
    const cwdHi = makeRepoWithKg();
    const runDirHi = path.join(cwdHi, ".guild", "runs", "run-skip-true");
    recall("payment", { cwd: cwdHi, runId: "run-skip-true", runDir: runDirHi, _bm25Disabled: true, recallScoreThreshold: 0.4 });
    const hi = readDecisionEvents(runDirHi)[0];
    expect(hi["read_skip_fired"]).toBe(true);
    expect(hi["threshold"]).toBe(0.4);

    // Same recall, threshold set absurdly high → top_score < threshold → FALSE.
    const cwdLo = makeRepoWithKg();
    const runDirLo = path.join(cwdLo, ".guild", "runs", "run-skip-false");
    recall("payment", { cwd: cwdLo, runId: "run-skip-false", runDir: runDirLo, _bm25Disabled: true, recallScoreThreshold: 1000 });
    const lo = readDecisionEvents(runDirLo)[0];
    expect(lo["read_skip_fired"]).toBe(false);
    expect(lo["threshold"]).toBe(1000);
  });

  test("1c. a no-match recall reports the chunk_count guard (read_skip_fired false, empty branch)", () => {
    const cwd = makeRepoWithKg();
    const runDir = path.join(cwd, ".guild", "runs", "run-empty");
    recall("zzznomatchqxq", { cwd, runId: "run-empty", runDir, _bm25Disabled: true, recallScoreThreshold: 0.0 });
    const ev = readDecisionEvents(runDir)[0];
    expect(ev["branch"]).toBe("empty");
    expect(ev["chunk_count"]).toBe(0);
    // threshold 0.0 would pass score>=threshold, but chunk_count==0 guards it.
    expect(ev["read_skip_fired"]).toBe(false);
  });

  test("4. no active run → emit is a safe no-op (no throw, no file created)", () => {
    const cwd = makeRepoWithKg();
    // No runId / runDir → recall derives no runDir → emit no-ops.
    expect(() => recall("payment", { cwd, _bm25Disabled: true })).not.toThrow();
    // Nothing under .guild/runs should have been created by the emit path.
    expect(fs.existsSync(path.join(cwd, ".guild", "runs"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FINDING 2 — SQLite-off==on parity: an unscored branch never reports a
// threshold-derived skip the scored branch wouldn't (no coerced-0 divergence).
// ---------------------------------------------------------------------------

/** A repo with 2 wiki files (one matches "payment"), so sqlite + file-bm25 both return. */
function makeRepoWithWiki(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g10-parity-"));
  TEMP_DIRS.push(dir);
  const wikiDir = path.join(dir, ".guild", "wiki", "decisions");
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, "pay.md"), "# Payment flow\n\npayment billing invoice settlement payment\n", "utf8");
  fs.writeFileSync(path.join(wikiDir, "other.md"), "# Unrelated\n\nsomething entirely different here\n", "utf8");
  return dir;
}

function readDecision(runDir: string): Record<string, unknown> {
  return readDecisionEvents(runDir)[0]!;
}

describe("G10 FINDING-2 — index:on (sqlite) vs index:off (bm25) skip parity", () => {
  test("the SAME query on vs off yields a consistent skip decision (unscored marker on the sqlite side)", () => {
    // index:ON → sqlite branch wins (enabled, file count 2 > threshold 1).
    const onCwd = makeRepoWithWiki();
    const onDir = path.join(onCwd, ".guild", "runs", "run-on");
    recall("payment", {
      cwd: onCwd,
      runId: "run-on",
      runDir: onDir,
      _kgDisabled: true,
      recallScoreThreshold: 0.4,
      _indexConfig: { enabled: true, wiki_file_threshold: 1 },
    });
    const onEv = readDecision(onDir);

    // index:OFF → file-bm25 branch wins (sqlite disabled).
    const offCwd = makeRepoWithWiki();
    const offDir = path.join(offCwd, ".guild", "runs", "run-off");
    recall("payment", {
      cwd: offCwd,
      runId: "run-off",
      runDir: offDir,
      _kgDisabled: true,
      recallScoreThreshold: 0.4,
      _indexConfig: { enabled: false },
    });
    const offEv = readDecision(offDir);

    // Both produced wiki chunks for the same query.
    expect(onEv["chunk_count"] as number).toBeGreaterThan(0);
    expect(offEv["chunk_count"] as number).toBeGreaterThan(0);

    // The sqlite side is explicitly UNSCORED — it never claims a threshold skip
    // off a coerced-0. THIS is the parity fix: previously it reported
    // read_skip_fired=false off a fake 0 while the bm25 side could report true.
    expect(onEv["branch"]).toBe("sqlite");
    expect(onEv["scored"]).toBe(false);
    expect(onEv["read_skip_fired"]).toBe(false);

    // The bm25 side carries a real, comparable score.
    expect(offEv["branch"]).toBe("file-bm25");
    expect(offEv["scored"]).toBe(true);
    expect(typeof offEv["top_score"]).toBe("number");

    // Aggregated, the unscored sqlite event is EXCLUDED from the skip-rate, so the
    // two index modes cannot report a different skip-rate for the same corpus.
    const recs = [onEv, offEv].map((e) => ({
      run_id: "", lane_id: "",
      query_hash: e["query_hash"] as string,
      branch: e["branch"] as string,
      top_score: e["top_score"] as number,
      threshold: e["threshold"] as number,
      read_skip_fired: e["read_skip_fired"] as boolean,
      chunk_count: e["chunk_count"] as number,
      scored: e["scored"] as boolean,
      lane_outcome: "unknown" as const,
    }));
    const report = computeRecallStats(recs);
    expect(report.overall.count).toBe(2);
    expect(report.overall.scoredCount).toBe(1); // only the bm25 event is scored
  });
});

// ---------------------------------------------------------------------------
// FIX-G10-r2 FINDING 2 — precision populates IN PRODUCTION via a real recall()
// emit + real handoff receipt join, using the SAME dispatched env key.
//
// The dispatch adapters export GUILD_TASK_ID (tmux-backend.ts / inprocess-backend.ts
// / pane-adapter.ts), NOT GUILD_LANE_ID. recall() must emit lane_id from
// GUILD_TASK_ID so the recall-stats lane-outcome join (record.lane_id ===
// receipt.task_id) actually fires. This test drives the REAL env key (not a
// hand-written lane_id) end to end.
// ---------------------------------------------------------------------------

describe("FIX-G10-r2 FINDING-2 — precision populates from a real recall()+receipt join via GUILD_TASK_ID", () => {
  /** Write a guild.handoff.v2 receipt whose task_id is the join key. */
  function writeHandoff(runDir: string, file: string, taskId: string, status: string): void {
    const dir = path.join(runDir, "handoffs");
    fs.mkdirSync(dir, { recursive: true });
    const env = JSON.stringify(
      { schema_version: "guild.handoff.v2", task_id: taskId, tier: "mid", status, summary: "s", artifacts: [], issues: [] },
      null,
      2,
    );
    fs.writeFileSync(path.join(dir, file), `# Receipt\n\n\`\`\`guild.handoff.v2\n${env}\n\`\`\`\n`, "utf8");
  }

  const SAVED_TASK_ID = process.env["GUILD_TASK_ID"];
  const SAVED_LANE_ID = process.env["GUILD_LANE_ID"];
  afterEach(() => {
    if (SAVED_TASK_ID === undefined) delete process.env["GUILD_TASK_ID"];
    else process.env["GUILD_TASK_ID"] = SAVED_TASK_ID;
    if (SAVED_LANE_ID === undefined) delete process.env["GUILD_LANE_ID"];
    else process.env["GUILD_LANE_ID"] = SAVED_LANE_ID;
  });

  test("recall() emits lane_id from GUILD_TASK_ID, and the receipt join makes precision real (not n/a)", () => {
    const cwd = makeRepoWithKg();
    const runId = "run-precision";
    const runDir = path.join(cwd, ".guild", "runs", runId);

    // The dispatch adapters export GUILD_TASK_ID (the REAL key) — set it, leave
    // GUILD_LANE_ID unset to mirror production.
    delete process.env["GUILD_LANE_ID"];
    process.env["GUILD_TASK_ID"] = "task-pay-001";

    recall("payment", { cwd, runId, runDir, _bm25Disabled: true, recallScoreThreshold: 0.4 });

    // The emitted decision event carries the dispatched task id (NOT empty).
    const ev = readDecisionEvents(runDir)[0]!;
    expect(ev["lane_id"]).toBe("task-pay-001");

    // A real handoff receipt for that SAME task id lands later (done → success).
    writeHandoff(runDir, "backend-task-pay-001.md", "task-pay-001", "done");

    // The run-set read joins event ↔ receipt on the shared key → precision real.
    const events = readRecallDecisionEvents(path.join(cwd, ".guild", "runs"));
    const report = computeRecallStats(events);
    expect(report.overall.hits).toBe(1);
    expect(report.overall.misses).toBe(0);
    expect(report.overall.precision).toBe(1); // 1/1 — populated from the real join
    expect(report.overall.precision).not.toBeNull();
  });

  test("ANTI-VACUITY: a key MISMATCH (receipt task_id ≠ dispatched GUILD_TASK_ID) leaves precision n/a", () => {
    const cwd = makeRepoWithKg();
    const runId = "run-mismatch";
    const runDir = path.join(cwd, ".guild", "runs", runId);

    delete process.env["GUILD_LANE_ID"];
    process.env["GUILD_TASK_ID"] = "task-real-001";
    recall("payment", { cwd, runId, runDir, _bm25Disabled: true, recallScoreThreshold: 0.4 });

    // Receipt for a DIFFERENT task id → nothing joins → outcome stays unknown.
    writeHandoff(runDir, "backend-other.md", "task-OTHER-999", "done");

    const events = readRecallDecisionEvents(path.join(cwd, ".guild", "runs"));
    const report = computeRecallStats(events);
    // If recall() emitted an empty lane_id (the bug), this would ALSO be n/a — so
    // the companion test above (real lane_id, matching receipt → precision 1) is
    // what proves the emit reads the right key. Here we only assert the negative.
    expect(report.overall.precision).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FINDING 3 — validator rejects raw-query / malformed-hash / over-long preview.
// ---------------------------------------------------------------------------

describe("G10 FINDING-3 — recall_decision validator enforces privacy invariants", () => {
  const valid = makeRecallDecisionEvent({
    ts: "2026-06-25T00:00:00Z",
    run_id: "run-x",
    lane_id: "",
    query_hash: "abcdef0123456789", // exactly 16 lowercase hex
    query_preview: "payment configure auth",
    branch: "kg-query",
    top_score: 5,
    threshold: 0.4,
    read_skip_fired: true,
    chunk_count: 3,
    scored: true,
    lane_outcome: "unknown",
  });

  test("a conforming event passes", () => {
    expect(validateRecallDecisionEvent(valid)).toEqual({ ok: true });
  });

  test("a non-16-hex query_hash is rejected (malformed hash)", () => {
    expect(validateRecallDecisionEvent({ ...valid, query_hash: "ABCDEF0123456789" }).ok).toBe(false); // upper-case
    expect(validateRecallDecisionEvent({ ...valid, query_hash: "abcdef012345678" }).ok).toBe(false); // 15 chars
    expect(validateRecallDecisionEvent({ ...valid, query_hash: "abcdef01234567890" }).ok).toBe(false); // 17 chars
    expect(validateRecallDecisionEvent({ ...valid, query_hash: "zzzzzzzzzzzzzzzz" }).ok).toBe(false); // non-hex
  });

  test("a raw-query-shaped query_hash is rejected (would leak the query)", () => {
    const res = validateRecallDecisionEvent({ ...valid, query_hash: "how do I configure payment auth" });
    expect(res.ok).toBe(false);
  });

  test("an over-long query_preview (>60 chars) is rejected (raw-query leak)", () => {
    const longPreview = "x".repeat(61);
    const res = validateRecallDecisionEvent({ ...valid, query_preview: longPreview });
    expect(res.ok).toBe(false);
    // exactly 60 is allowed
    expect(validateRecallDecisionEvent({ ...valid, query_preview: "y".repeat(60) })).toEqual({ ok: true });
  });

  test("scored must be a boolean", () => {
    const { scored: _omit, ...noScored } = valid as unknown as Record<string, unknown> & { scored: boolean };
    expect(validateRecallDecisionEvent(noScored).ok).toBe(false);
    expect(validateRecallDecisionEvent({ ...valid, scored: "yes" }).ok).toBe(false);
  });
});
