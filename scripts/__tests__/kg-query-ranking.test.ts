/**
 * scripts/__tests__/kg-query-ranking.test.ts
 *
 * L11 TDD-first tests — SC-13: kg-query recall ranking
 *
 * Extends kg-query scoring to use `importance_score` / `importance` (string)
 * + `confidence` + topic proximity (subtopic_of graph traversal), within the
 * existing token budget (MAX_LIMIT / --limit cap unchanged).
 *
 * SC-13 Check: a fixture recall query returns the high-importance topic above a
 * low-importance sibling, under the budget cap.
 *
 * Determinism responsibility table (SC-9, all deterministic-script for L11):
 * | Output                   | Owner                  |
 * | term match score         | deterministic-script   |
 * | importance multiplier    | deterministic-script   |
 * | confidence bonus         | deterministic-script   |
 * | topic proximity bonus    | deterministic-script   |
 * | final sort order         | deterministic-script   |
 * No LLM calls in this lane — pure scoring arithmetic.
 *
 * Test sections:
 *   A — unit tests of exported scoring helpers
 *   B — CLI integration tests (spawnSync): fixture graph → kg-query → ranked output
 *
 * Usage: npx jest --testPathPattern=kg-query-ranking --no-coverage
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

// ── A: import scoring helpers exported from kg-query.ts ──────────────────────
// These exports are added by L11. They will fail with "has no exported member"
// until the implementation lands (confirming RED state).
import {
  importanceMultiplier,
  confidenceBonus,
  scoreNode,
  buildProximityBonuses,
} from "../learn/kg-query";
import type { GraphNode, GraphEdge } from "../learn/lib/schema";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function mkTmpRepo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-kg-rank-"));
  TEMP_DIRS.push(d);
  return d;
}

/**
 * Write the kg-query source. As of metric-6=B, kg-query reads the recall-optimized projection
 * knowledge-recall.json (guild.knowledge_links.v2), NOT the raw v1 graph — so the fixture writes
 * the projection, wrapping the same nodes/edges (ranking is preserved: the projection retains node
 * fields). knowledge-graph.json is still written for any v1-graph reader; kg-query keys off recall.
 */
function writeGraph(repo: string, graph: Record<string, unknown>): void {
  const dir = path.join(repo, ".guild", "indexes");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "knowledge-graph.json"), JSON.stringify(graph, null, 2), "utf8");
  const projection = {
    schema_version: "guild.knowledge_links.v2",
    nodes: (graph as { nodes?: unknown[] }).nodes ?? [],
    edges: (graph as { edges?: unknown[] }).edges ?? [],
  };
  fs.writeFileSync(path.join(dir, "knowledge-recall.json"), JSON.stringify(projection, null, 2), "utf8");
}

/** Minimal valid v1 graph skeleton. */
function minGraph(nodes: Record<string, unknown>[], edges: Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    version: "guild.knowledge_graph.v1",
    generated_from_commit: "test",
    project: { name: "test", description: "" },
    nodes,
    edges,
    layers: [],
    tour: [],
  };
}

function makeTopicNode(
  id: string,
  name: string,
  opts: {
    importance?: string;
    importance_score?: number;
    confidence?: "high" | "medium" | "low";
  } = {},
): Record<string, unknown> {
  return {
    id,
    type: "topic",
    name,
    confidence: opts.confidence ?? "medium",
    source_refs: [],
    ...(opts.importance !== undefined ? { importance: opts.importance } : {}),
    ...(opts.importance_score !== undefined ? { importance_score: opts.importance_score } : {}),
  };
}

const KG_QUERY_SCRIPT = path.resolve(__dirname, "../learn/kg-query.ts");

function runKgQuery(
  repo: string,
  args: string[],
): { code: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", KG_QUERY_SCRIPT, "--cwd", repo, ...args], {
    encoding: "utf8",
    timeout: 120_000,
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// ── A: Unit tests — importanceMultiplier ─────────────────────────────────────

describe("importanceMultiplier", () => {
  test("returns numeric importance_score directly (0..1 clamp)", () => {
    const n = { importance_score: 0.9 } as unknown as GraphNode;
    expect(importanceMultiplier(n)).toBeCloseTo(0.9);
  });

  test("clamps importance_score > 1 to 1", () => {
    const n = { importance_score: 1.5 } as unknown as GraphNode;
    expect(importanceMultiplier(n)).toBe(1);
  });

  test("clamps importance_score < 0 to 0", () => {
    const n = { importance_score: -0.1 } as unknown as GraphNode;
    expect(importanceMultiplier(n)).toBe(0);
  });

  test("maps importance='high' to 0.8 when no importance_score", () => {
    const n = { importance: "high" } as unknown as GraphNode;
    expect(importanceMultiplier(n)).toBeCloseTo(0.8);
  });

  test("maps importance='medium' to 0.4", () => {
    const n = { importance: "medium" } as unknown as GraphNode;
    expect(importanceMultiplier(n)).toBeCloseTo(0.4);
  });

  test("maps importance='low' to 0.1", () => {
    const n = { importance: "low" } as unknown as GraphNode;
    expect(importanceMultiplier(n)).toBeCloseTo(0.1);
  });

  test("returns 0 when neither field present", () => {
    const n = {} as unknown as GraphNode;
    expect(importanceMultiplier(n)).toBe(0);
  });

  test("importance_score takes precedence over string importance", () => {
    const n = { importance_score: 0.3, importance: "high" } as unknown as GraphNode;
    // importance_score=0.3 wins; string "high" would give 0.8
    expect(importanceMultiplier(n)).toBeCloseTo(0.3);
  });
});

// ── A: Unit tests — confidenceBonus ──────────────────────────────────────────

describe("confidenceBonus", () => {
  test("high confidence → 0.3", () => {
    const n = { confidence: "high" } as unknown as GraphNode;
    expect(confidenceBonus(n)).toBeCloseTo(0.3);
  });

  test("medium confidence → 0.1", () => {
    const n = { confidence: "medium" } as unknown as GraphNode;
    expect(confidenceBonus(n)).toBeCloseTo(0.1);
  });

  test("low confidence → 0", () => {
    const n = { confidence: "low" } as unknown as GraphNode;
    expect(confidenceBonus(n)).toBe(0);
  });

  test("undefined confidence → 0", () => {
    const n = {} as unknown as GraphNode;
    expect(confidenceBonus(n)).toBe(0);
  });
});

// ── A: Unit tests — scoreNode ─────────────────────────────────────────────────

describe("scoreNode", () => {
  test("returns 0 for no term match (importance cannot inflate a zero)", () => {
    const n = makeTopicNode("topic:irrelevant", "Unrelated Node", {
      importance_score: 0.99,
      confidence: "high",
    }) as unknown as GraphNode;
    expect(scoreNode(n, ["authentication"])).toBe(0);
  });

  test("exact name match scores higher than partial", () => {
    const exact = makeTopicNode("topic:exact", "authentication", {}) as unknown as GraphNode;
    const partial = makeTopicNode("topic:partial", "authentication details", {}) as unknown as GraphNode;
    const terms = ["authentication"];
    expect(scoreNode(exact, terms)).toBeGreaterThan(scoreNode(partial, terms));
  });

  test("SC-13: high-importance node scores higher than low-importance on same term match", () => {
    // Same name → same raw term score; importance decides
    const highImp = makeTopicNode("topic:zebra-high", "Authentication Overview", {
      importance_score: 0.9,
      confidence: "high",
    }) as unknown as GraphNode;
    const lowImp = makeTopicNode("topic:alpha-low", "Authentication Overview", {
      importance_score: 0.4,
      confidence: "low",
    }) as unknown as GraphNode;
    const terms = ["authentication"];
    expect(scoreNode(highImp, terms)).toBeGreaterThan(scoreNode(lowImp, terms));
  });

  test("confidence acts as tie-breaker when importance_score is equal", () => {
    const highConf = makeTopicNode("topic:z-highconf", "Authentication Overview", {
      importance_score: 0.5,
      confidence: "high",
    }) as unknown as GraphNode;
    const lowConf = makeTopicNode("topic:a-lowconf", "Authentication Overview", {
      importance_score: 0.5,
      confidence: "low",
    }) as unknown as GraphNode;
    const terms = ["authentication"];
    expect(scoreNode(highConf, terms)).toBeGreaterThan(scoreNode(lowConf, terms));
  });

  test("returns ≥1 for each matched term in no-terms mode (empty terms)", () => {
    const n = makeTopicNode("topic:x", "Authentication", {}) as unknown as GraphNode;
    // With empty terms, node should score positively so it's included in ranking
    expect(scoreNode(n, [])).toBeGreaterThanOrEqual(1);
  });

  test("importance affects score proportionally — higher is strictly better", () => {
    const terms = ["auth"];
    const scores = [0, 0.2, 0.5, 0.8, 1.0].map((imp) => {
      const n = makeTopicNode("topic:t", "auth stuff", {
        importance_score: imp,
      }) as unknown as GraphNode;
      return scoreNode(n, terms);
    });
    // Each subsequent score should be ≥ the previous
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });
});

// ── A: Unit tests — buildProximityBonuses ────────────────────────────────────

describe("buildProximityBonuses", () => {
  test("returns empty map when no topics match", () => {
    const scored: Array<{ n: GraphNode; s: number }> = [
      { n: makeTopicNode("topic:a", "Foo", {}) as unknown as GraphNode, s: 0 },
    ];
    const edges: GraphEdge[] = [];
    expect(buildProximityBonuses(scored, edges).size).toBe(0);
  });

  test("returns empty map when no subtopic_of edges", () => {
    const scored: Array<{ n: GraphNode; s: number }> = [
      { n: makeTopicNode("topic:child", "Auth Details", {}) as unknown as GraphNode, s: 3 },
    ];
    const edges: GraphEdge[] = [];
    expect(buildProximityBonuses(scored, edges).size).toBe(0);
  });

  test("parent topic gets proximity bonus when a matched topic is its child", () => {
    const child = makeTopicNode("topic:child", "Auth Details", {}) as unknown as GraphNode;
    const scored: Array<{ n: GraphNode; s: number }> = [
      { n: child, s: 3 },
    ];
    const edges: GraphEdge[] = [
      {
        source: "topic:child",
        target: "topic:parent",
        type: "subtopic_of",
        direction: "out",
        weight: 1,
      },
    ];
    const bonuses = buildProximityBonuses(scored, edges);
    expect(bonuses.has("topic:parent")).toBe(true);
    expect(bonuses.get("topic:parent")).toBeGreaterThan(0);
  });

  test("non-topic matched nodes do NOT generate proximity bonuses", () => {
    const fileNode: GraphNode = {
      id: "file:src/auth.ts",
      type: "file",
      name: "auth.ts",
      confidence: "high",
      source_refs: [],
    };
    const scored: Array<{ n: GraphNode; s: number }> = [
      { n: fileNode, s: 3 },
    ];
    const edges: GraphEdge[] = [
      {
        source: "file:src/auth.ts",
        target: "topic:parent",
        type: "subtopic_of",
        direction: "out",
        weight: 1,
      },
    ];
    const bonuses = buildProximityBonuses(scored, edges);
    // File nodes don't generate proximity — only topic nodes do
    expect(bonuses.has("topic:parent")).toBe(false);
  });

  test("unmatched topics (s=0) do NOT generate proximity bonuses", () => {
    const unmatched = makeTopicNode("topic:unmatched", "Unrelated", {}) as unknown as GraphNode;
    const scored: Array<{ n: GraphNode; s: number }> = [
      { n: unmatched, s: 0 },
    ];
    const edges: GraphEdge[] = [
      {
        source: "topic:unmatched",
        target: "topic:parent",
        type: "subtopic_of",
        direction: "out",
        weight: 1,
      },
    ];
    const bonuses = buildProximityBonuses(scored, edges);
    expect(bonuses.has("topic:parent")).toBe(false);
  });

  test("higher child score yields higher proximity bonus for the same parent", () => {
    const childA = makeTopicNode("topic:child-a", "Auth", {}) as unknown as GraphNode;
    const childB = makeTopicNode("topic:child-b", "Auth", {}) as unknown as GraphNode;
    const edges: GraphEdge[] = [
      { source: "topic:child-a", target: "topic:parent", type: "subtopic_of", direction: "out", weight: 1 },
      { source: "topic:child-b", target: "topic:parent", type: "subtopic_of", direction: "out", weight: 1 },
    ];

    const scoredLow: Array<{ n: GraphNode; s: number }> = [{ n: childA, s: 1 }];
    const scoredHigh: Array<{ n: GraphNode; s: number }> = [{ n: childA, s: 5 }];

    const bonusLow = buildProximityBonuses(scoredLow, edges).get("topic:parent") ?? 0;
    const bonusHigh = buildProximityBonuses(scoredHigh, edges).get("topic:parent") ?? 0;
    expect(bonusHigh).toBeGreaterThan(bonusLow);
  });

  test("non-topic TARGET of subtopic_of edge receives no proximity bonus (target-side guard)", () => {
    // Codex G-lane blocker: the source side correctly requires type=topic, but the
    // ORIGINAL code placed no guard on the target side. A file/function that is the
    // TARGET of a subtopic_of edge (malformed or cross-type) must not receive a bonus.
    // This test FAILS on the original code (bonus is 0.95) and PASSES after the fix.
    const topicSource: GraphNode = {
      id: "topic:auth-source",
      type: "topic",
      name: "authentication",
      confidence: "high",
      source_refs: [],
    };
    const fileTarget: GraphNode = {
      id: "file:src/auth.ts",
      type: "file",
      name: "authentication module",
      confidence: "high",
      source_refs: [],
    };
    // Both nodes are in scored (s > 0) — the file IS reachable by query, which is
    // the exact scenario where the missing guard surfaces as a wrong score boost.
    const scored: Array<{ n: GraphNode; s: number }> = [
      { n: topicSource, s: 9.5 }, // topic source — generates proximity
      { n: fileTarget, s: 3.0 },  // file target — must NOT receive proximity
    ];
    const edges: GraphEdge[] = [
      {
        source: "topic:auth-source",
        target: "file:src/auth.ts",
        type: "subtopic_of",
        direction: "out",
        weight: 1,
      },
    ];

    const bonuses = buildProximityBonuses(scored, edges);

    // The file node (non-topic TARGET) must NOT receive a proximity bonus.
    // Without the target-side guard, bonuses.get("file:src/auth.ts") would be 0.95.
    expect(bonuses.has("file:src/auth.ts")).toBe(false);
    expect(bonuses.size).toBe(0);
  });
});

// ── B: CLI integration tests ──────────────────────────────────────────────────

describe("CLI: SC-13 ranking integration", () => {
  /**
   * SC-13 core check: high-importance topic ranks above low-importance sibling.
   *
   * Fixture construction ensures the WITHOUT-importance ordering is WRONG:
   *   - Both nodes match "authentication" with the same raw term score (substring in name).
   *   - Without importance: alphabetical tiebreak → "topic:alpha-low" before "topic:zebra-high".
   *   - With importance: "topic:zebra-high" (score ≈6.0) > "topic:alpha-low" (score ≈4.2).
   */
  test("SC-13: high-importance topic ranks above low-importance sibling — core check", () => {
    const repo = mkTmpRepo();
    const graph = minGraph([
      makeTopicNode("topic:zebra-high", "Authentication Overview", {
        importance_score: 0.9,
        confidence: "high",
      }),
      makeTopicNode("topic:alpha-low", "Authentication Details", {
        importance_score: 0.4,
        confidence: "low",
      }),
    ]);
    writeGraph(repo, graph);

    const r = runKgQuery(repo, ["--q", "authentication", "--type", "topic", "--json"]);
    expect(r.code).toBe(0);

    const result = JSON.parse(r.out) as {
      count: number;
      capped: boolean;
      results: Array<{ id: string; type: string }>;
    };

    expect(result.results.length).toBe(2);
    // Determinism check: high-importance node must be FIRST
    expect(result.results[0].id).toBe("topic:zebra-high");
    expect(result.results[1].id).toBe("topic:alpha-low");
  });

  test("SC-13: budget cap (--limit) preserved with new ranking", () => {
    const repo = mkTmpRepo();
    // Create 6 topic nodes all matching "deployment", varying importance
    const nodes = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4].map((imp, i) =>
      makeTopicNode(`topic:dep-${i}`, `Deployment Strategy ${i}`, {
        importance_score: imp,
        confidence: "medium",
      }),
    );
    writeGraph(repo, minGraph(nodes));

    const r = runKgQuery(repo, ["--q", "deployment", "--limit", "3", "--json"]);
    expect(r.code).toBe(0);

    const result = JSON.parse(r.out) as {
      count: number;
      capped: boolean;
      results: Array<{ id: string }>;
    };
    // Exactly --limit results returned
    expect(result.results.length).toBe(3);
    expect(result.capped).toBe(true);
    // Top 3 must be the highest importance ones (dep-0 > dep-1 > dep-2)
    const ids = result.results.map((r) => r.id);
    expect(ids).toContain("topic:dep-0"); // importance_score=0.9
    expect(ids).toContain("topic:dep-1"); // importance_score=0.8
    expect(ids).toContain("topic:dep-2"); // importance_score=0.7
  });

  test("SC-13: importance=0 node (no importance fields) ranks below nodes with importance", () => {
    const repo = mkTmpRepo();
    // "topic:zzz-no-imp" has no importance fields — falls back to multiplier=0
    // "topic:aaa-has-imp" has importance_score=0.7 — despite alphabetically later, should rank first
    const graph = minGraph([
      makeTopicNode("topic:zzz-no-imp", "Authentication Core", {}),
      makeTopicNode("topic:aaa-has-imp", "Authentication Core", {
        importance_score: 0.7,
        confidence: "high",
      }),
    ]);
    writeGraph(repo, graph);

    const r = runKgQuery(repo, ["--q", "authentication", "--type", "topic", "--json"]);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.out) as { results: Array<{ id: string }> };
    expect(result.results[0].id).toBe("topic:aaa-has-imp");
  });

  test("SC-13: text (non-json) output still works after ranking change", () => {
    const repo = mkTmpRepo();
    const graph = minGraph([
      makeTopicNode("topic:high", "Authentication Overview", {
        importance_score: 0.9,
        confidence: "high",
      }),
      makeTopicNode("topic:low", "Authentication Details", {
        importance_score: 0.2,
        confidence: "low",
      }),
    ]);
    writeGraph(repo, graph);

    const r = runKgQuery(repo, ["--q", "authentication", "--type", "topic"]);
    expect(r.code).toBe(0);
    expect(r.out.trim().length).toBeGreaterThan(0);
    // First line should reference the high node
    const firstLine = r.out.trim().split("\n")[0];
    expect(firstLine).toContain("topic:high");
  });

  test("SC-13: proximity bonus applied — parent topic gets boosted above equal-scoring non-child", () => {
    const repo = mkTmpRepo();
    // Setup:
    //   "topic:parent" — doesn't match "authentication" at all
    //   "topic:child"  — matches "authentication" (name contains it) + subtopic_of topic:parent
    //   "topic:other"  — also matches "authentication" (name contains it), same importance, NO subtopic_of
    //
    // Without proximity: parent doesn't match → excluded.
    // But if parent ALSO has "auth" in its name → all 3 match "authentication".
    // Then: child and other have same raw score; child's proximity boosts parent.
    // But parent must also match to be in results (s > 0 filter).
    //
    // Simpler: make parent also match "authentication" with a lower base score,
    // but child proximity boosts parent above a peer non-child with same base.
    const nodes = [
      makeTopicNode("topic:parent", "Authentication System", {
        importance_score: 0.5,
        confidence: "medium",
      }),
      makeTopicNode("topic:child", "Authentication Handler Details", {
        importance_score: 0.5,
        confidence: "medium",
      }),
      makeTopicNode("topic:unrelated-peer", "Authentication Handler Details", {
        importance_score: 0.5,
        confidence: "medium",
      }),
    ];
    const edges = [
      {
        source: "topic:child",
        target: "topic:parent",
        type: "subtopic_of",
        direction: "out",
        weight: 1,
      },
    ];
    writeGraph(repo, minGraph(nodes, edges));

    const r = runKgQuery(repo, ["--q", "authentication", "--type", "topic", "--json"]);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.out) as { results: Array<{ id: string }> };

    // parent has shorter name → lower base score; but child's proximity should
    // boost parent above unrelated-peer (same base score, no proximity)
    const parentIdx = result.results.findIndex((r) => r.id === "topic:parent");
    const peerIdx = result.results.findIndex((r) => r.id === "topic:unrelated-peer");
    // Both should be in results
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(peerIdx).toBeGreaterThanOrEqual(0);
    // Parent must rank above unrelated-peer (same base score, parent gets proximity boost)
    expect(parentIdx).toBeLessThan(peerIdx);
  });

  test("SC-13 target-guard: non-topic subtopic_of target gets no proximity boost — queried WITHOUT --type filter", () => {
    // Codex G-lane CLI-level complement to the unit test above.
    // Discriminating design: topic:auth-source → file:auth-target (subtopic_of, cross-type edge).
    // Both file:auth-target and concept:auth-peer have identical base scores for query "auth".
    //   base(file) = base(concept) = 3 × (1+0) + 0.3 = 3.3  (name-contains "auth", high-conf)
    //   topic score = 5 × (1+0.9) + 0.3 = 9.8  (exact name "auth", importance_score=0.9, high-conf)
    // WITHOUT target-side guard: file gets bonus 9.8×0.1=0.98 → total 4.28 → ranks 2nd (above concept).
    // WITH    target-side guard: file stays 3.3 = concept 3.3, tiebreak by id → concept (c<f) ranks 2nd.
    // Assertion: with --limit 2, result[1] must be concept:auth-peer (not file:auth-target).
    const repo = mkTmpRepo();
    const topicNode = makeTopicNode("topic:auth-source", "auth", {
      importance_score: 0.9,
      confidence: "high",
    });
    const fileNode = {
      id: "file:auth-target",
      type: "file",
      name: "auth module",
      confidence: "high",
      source_refs: [],
    };
    const conceptNode = {
      id: "concept:auth-peer",
      type: "concept",
      name: "auth concept",
      confidence: "high",
      source_refs: [],
    };
    const graph = minGraph(
      [topicNode, fileNode, conceptNode],
      [{ source: "topic:auth-source", target: "file:auth-target", type: "subtopic_of", direction: "out", weight: 1 }],
    );
    writeGraph(repo, graph);

    // Critically: NO --type filter — all node types compete in the results
    const r = runKgQuery(repo, ["--q", "auth", "--limit", "2", "--json"]);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.out) as { results: Array<{ id: string }> };

    expect(result.results).toHaveLength(2);
    expect(result.results[0].id).toBe("topic:auth-source");  // always highest (score 9.8)
    // With target-side guard: concept (c<f id sort, same 3.3 base) ranks 2nd
    // Without guard:          file would rank 2nd (inflated to 4.28 by proximity bonus)
    expect(result.results[1].id).toBe("concept:auth-peer");
  });
});
