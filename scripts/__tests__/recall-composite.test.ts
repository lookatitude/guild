/**
 * scripts/__tests__/recall-composite.test.ts
 *
 * Composite recall scoring + importance gate (docs/v2/knowledge-memory.html
 * §Recall scoring; deferred items 6 & 7). Verifies:
 *   - the pure scorers (ingestImportanceScore / recencyDecay / compositeScore),
 *   - the integration path: with `composite` set, wiki recall re-ranks by
 *     relevance × recency × importance and drops pages below the importance gate,
 *   - and that WITHOUT `composite` the shipped BM25-only behavior is unchanged.
 * Real path (temp repo, real fs, real recall()), no injected seam.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  recall,
  ingestImportanceScore,
  recencyDecay,
  compositeScore,
} from "../lib/recall";

const DAY = 86_400_000;

function mkRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-recall-comp-"));
}
function writePage(root: string, rel: string, body: string, ageDays: number, now: number): void {
  const p = path.join(root, ".guild", "wiki", rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
  const t = (now - ageDays * DAY) / 1000;
  fs.utimesSync(p, t, t);
}

describe("composite recall — pure scorers", () => {
  test("ingestImportanceScore maps categories to the 1–5 design table", () => {
    expect(ingestImportanceScore("decisions")).toBe(5);
    expect(ingestImportanceScore("standards")).toBe(4);
    expect(ingestImportanceScore("recipes")).toBe(3);
    expect(ingestImportanceScore("context")).toBe(2);
    expect(ingestImportanceScore("anything-else")).toBe(3);
    expect(ingestImportanceScore(undefined)).toBe(3);
  });
  test("recencyDecay: 1.0 at age 0, 0.5 at one half-life, monotone decreasing", () => {
    expect(recencyDecay(0, 90)).toBeCloseTo(1, 10);
    expect(recencyDecay(90 * DAY, 90)).toBeCloseTo(0.5, 10);
    expect(recencyDecay(180 * DAY, 90)).toBeCloseTo(0.25, 10);
    expect(recencyDecay(30 * DAY, 90)).toBeGreaterThan(recencyDecay(60 * DAY, 90));
  });
  test("compositeScore = relevance × recency × importance/5", () => {
    expect(compositeScore(10, 5, 0, 90)).toBeCloseTo(10 * 1 * 1, 10);
    expect(compositeScore(10, 5, 90 * DAY, 90)).toBeCloseTo(10 * 0.5 * 1, 10);
    expect(compositeScore(10, 2, 0, 90)).toBeCloseTo(10 * 1 * 0.4, 10);
  });
});

describe("composite recall — integration (re-rank + gate)", () => {
  const NOW = 1_800_000_000_000; // fixed ms (Date unavailable concerns N/A here; passed as seam)

  test("gate drops below-threshold pages; recency orders equal-relevance pages", () => {
    const repo = mkRepo();
    writePage(repo, "decisions/recent.md", "# Recent\n\nauthentication flow decision token.\n", 0, NOW);
    writePage(repo, "decisions/old.md", "# Old\n\nauthentication flow decision token.\n", 180, NOW);
    writePage(repo, "context/note.md", "# Note\n\nauthentication flow context token.\n", 0, NOW);

    const res = recall("authentication flow token", {
      cwd: repo,
      limit: 10,
      _kgDisabled: true,
      composite: { importanceGate: 3, halfLifeDays: 90, nowMs: NOW },
    });
    const paths = res.chunks.map((c) => c.source_path.replace(/\\/g, "/"));

    // context/ (importance 2) is gated out; both decisions/ (importance 5) survive.
    expect(paths).toContain(".guild/wiki/decisions/recent.md");
    expect(paths).toContain(".guild/wiki/decisions/old.md");
    expect(paths).not.toContain(".guild/wiki/context/note.md");
    // Recency breaks the tie: the fresher decision ranks first.
    expect(paths.indexOf(".guild/wiki/decisions/recent.md"))
      .toBeLessThan(paths.indexOf(".guild/wiki/decisions/old.md"));

    fs.rmSync(repo, { recursive: true, force: true });
  });

  test("WITHOUT composite: BM25-only — the low-importance page is NOT gated out", () => {
    const repo = mkRepo();
    writePage(repo, "decisions/d.md", "# D\n\nauthentication flow decision token.\n", 0, NOW);
    writePage(repo, "context/note.md", "# Note\n\nauthentication flow context token.\n", 0, NOW);

    const res = recall("authentication flow token", {
      cwd: repo,
      limit: 10,
      _kgDisabled: true,
      _indexConfig: { enabled: false },
    });
    const paths = res.chunks.map((c) => c.source_path.replace(/\\/g, "/"));
    expect(paths).toContain(".guild/wiki/context/note.md"); // no gate in default mode

    fs.rmSync(repo, { recursive: true, force: true });
  });
});
