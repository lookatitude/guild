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
import { validateRecallDecisionEvent } from "../../src/modules/telemetry/workflows/guild-trace-events";

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
