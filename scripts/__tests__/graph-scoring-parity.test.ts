/**
 * scripts/__tests__/graph-scoring-parity.test.ts
 *
 * Re-arch WAVE 1 (M9 single-source floor) — PARITY GUARD for the KG scorer.
 *
 * Unit 2 collapsed the KnowledgeGraph node-scoring logic that lived in
 * scripts/understand/kg-query.ts plus the term-match copy inlined in
 * scripts/lib/recall.ts (`scoreKgNode`) into ONE canonical module at
 * scripts/lib/shared/graph-scoring.ts.
 *
 *   (A) PARITY:        canonical scoreNode / termMatchScore / importanceMultiplier
 *                      / confidenceBonus match the frozen reference (the exact
 *                      pre-collapse algorithm) on a representative sample set.
 *   (B) ANTI-VACUITY:  a deliberately divergent scoreNode variant (exact-match
 *                      weight 6 instead of 5) disagrees with the canonical impl
 *                      on at least one sample — proving (A) has teeth.
 *   (C) SINGLE-IMPL:   exactly one source file DEFINES scoreNode /
 *                      buildProximityBonuses / termMatchScore.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as graphScoringShim from "../lib/shared/graph-scoring";
import * as graphScoringModule from "../../src/modules/knowledge/workflows/graph-scoring";
import {
  scoreNode as canonicalScoreNode,
  termMatchScore as canonicalTermMatchScore,
  importanceMultiplier as canonicalImportanceMultiplier,
  confidenceBonus as canonicalConfidenceBonus,
} from "../lib/shared/graph-scoring";
import type { GraphNode } from "../understand/lib/schema";

// ── Frozen reference: the verbatim pre-collapse algorithm. ───────────────────
function refImportanceMultiplier(node: GraphNode): number {
  const n = node as GraphNode & { importance_score?: unknown; importance?: unknown };
  if (typeof n.importance_score === "number") {
    return Math.max(0, Math.min(1, n.importance_score));
  }
  switch (n.importance) {
    case "high":   return 0.8;
    case "medium": return 0.4;
    case "low":    return 0.1;
    default:       return 0;
  }
}
function refConfidenceBonus(node: GraphNode): number {
  switch (node.confidence) {
    case "high":   return 0.3;
    case "medium": return 0.1;
    default:       return 0;
  }
}
// Old recall.ts scoreKgNode == old kg-query inner term loop. `exactWeight`
// exists ONLY for the anti-vacuity control (default 5 = shipped behaviour).
function refTermMatchScore(node: GraphNode, terms: string[], exactWeight = 5): number {
  const hay = `${node.name} ${node.id} ${(node.source_refs ?? []).join(" ")}`.toLowerCase();
  let termScore = 0;
  for (const t of terms) {
    if (!t) continue;
    if (node.name.toLowerCase() === t)            termScore += exactWeight;
    else if (node.name.toLowerCase().includes(t)) termScore += 3;
    else if (hay.includes(t))                      termScore += 1;
  }
  return termScore;
}
function refScoreNode(node: GraphNode, terms: string[], exactWeight = 5): number {
  if (terms.length === 0) {
    return 1 * (1 + refImportanceMultiplier(node)) + refConfidenceBonus(node);
  }
  const termScore = refTermMatchScore(node, terms, exactWeight);
  if (termScore === 0) return 0;
  return termScore * (1 + refImportanceMultiplier(node)) + refConfidenceBonus(node);
}

// ── Sample nodes covering every branch. ──────────────────────────────────────
const NODES: GraphNode[] = [
  { id: "n1", type: "topic", name: "recall", source_refs: ["scripts/lib/recall.ts"], confidence: "high", importance: "high" },
  { id: "n2", type: "file", name: "bm25 scorer", source_refs: ["a.ts", "b.ts"], confidence: "medium", importance_score: 0.5 },
  { id: "n3", type: "function", name: "tokenize", source_refs: [], confidence: "low" },
  { id: "n4", type: "topic", name: "graph", source_refs: ["scripts/understand/kg-query.ts"], confidence: "high", importance: "medium" },
  { id: "n5", type: "concept", name: "Prototype Pollution", source_refs: ["safe-object.ts"], confidence: "low", importance_score: 1 },
  { id: "n6", type: "file", name: "unrelated", source_refs: [], confidence: "high", importance_score: 1.7 /* clamps to 1 */ },
];
const TERM_SETS: string[][] = [
  [],                       // empty-terms branch
  ["recall"],               // exact name match
  ["graph", "scorer"],      // exact + contains
  ["zzz", "qqq"],           // no match → 0
  ["bm25", "tokenize"],     // contains / haystack mix
  ["scripts"],              // haystack (source_refs) only
];

describe("WAVE-1 Unit 2 — KG scorer single-source parity", () => {
  test("compatibility shim: scripts/lib/shared/graph-scoring re-exports src/modules/knowledge", () => {
    expect(graphScoringShim.scoreNode).toBe(graphScoringModule.scoreNode);
    expect(graphScoringShim.termMatchScore).toBe(graphScoringModule.termMatchScore);
    expect(graphScoringShim.buildProximityBonuses).toBe(graphScoringModule.buildProximityBonuses);
  });

  test("(A) parity: importanceMultiplier + confidenceBonus match the reference", () => {
    for (const n of NODES) {
      expect(canonicalImportanceMultiplier(n)).toBe(refImportanceMultiplier(n));
      expect(canonicalConfidenceBonus(n)).toBe(refConfidenceBonus(n));
    }
  });

  test("(A) parity: termMatchScore (recall's KG branch primitive) matches the reference", () => {
    for (const n of NODES) {
      for (const terms of TERM_SETS) {
        expect(canonicalTermMatchScore(n, terms)).toBe(refTermMatchScore(n, terms));
      }
    }
  });

  test("(A) parity: scoreNode (kg-query's full scorer) matches the reference", () => {
    for (const n of NODES) {
      for (const terms of TERM_SETS) {
        expect(canonicalScoreNode(n, terms)).toBe(refScoreNode(n, terms));
      }
    }
  });

  test("(B) anti-vacuity control: exact-match weight 6 disagrees with the canonical impl", () => {
    let sawDivergence = false;
    for (const n of NODES) {
      for (const terms of TERM_SETS) {
        if (canonicalScoreNode(n, terms) !== refScoreNode(n, terms, /* exactWeight */ 6)) {
          sawDivergence = true;
        }
      }
    }
    expect(sawDivergence).toBe(true);
  });

  test("(C) single-impl: exactly one source file DEFINES the KG scorers", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const roots = [path.join(repoRoot, "scripts"), path.join(repoRoot, "mcp-servers"), path.join(repoRoot, "src")];
    const SKIP = new Set(["node_modules", "dist", ".git", "build", "coverage"]);
    const definers = { scoreNode: [] as string[], buildProximityBonuses: [] as string[], termMatchScore: [] as string[], scoreKgNode: [] as string[] };

    function walk(dir: string): void {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SKIP.has(e.name)) continue;
          walk(path.join(dir, e.name));
        } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
          const src = fs.readFileSync(path.join(dir, e.name), "utf8");
          const rel = path.relative(repoRoot, path.join(dir, e.name));
          if (/function\s+scoreNode\s*\(/.test(src)) definers.scoreNode.push(rel);
          if (/function\s+buildProximityBonuses\s*\(/.test(src)) definers.buildProximityBonuses.push(rel);
          if (/function\s+termMatchScore\s*\(/.test(src)) definers.termMatchScore.push(rel);
          // codex W1-gate #1: the OLD recall duplicate was named scoreKgNode — assert it never
          // reappears (a re-introduced duplicate under the old name must fail this test).
          if (/function\s+scoreKgNode\s*\(/.test(src)) definers.scoreKgNode.push(rel);
        }
      }
    }
    for (const r of roots) walk(r);

    expect(definers.scoreNode).toEqual(["src/modules/knowledge/workflows/graph-scoring.ts"]);
    expect(definers.buildProximityBonuses).toEqual(["src/modules/knowledge/workflows/graph-scoring.ts"]);
    expect(definers.termMatchScore).toEqual(["src/modules/knowledge/workflows/graph-scoring.ts"]);
    expect(definers.scoreKgNode).toEqual([]); // old duplicate name must be gone for good
  });
});
