/**
 * scripts/__tests__/recall-kg-scoring-unify.test.ts
 *
 * G15 — Unify bundle KG recall scoring with kg-query.
 *
 * Before G15 the bundle KG branch (recall.ts) ranked knowledge nodes on flat
 * `termMatchScore` + id tiebreak, while the kg-query CLI ranked on the full
 * `scoreNode` (importance + confidence) + topic-proximity. An agent therefore
 * got WORSE KG recall through the context bundle than through the CLI, silently.
 *
 * This suite is the gate:
 *   1. PARITY     — the bundle KG branch and the kg-query CLI return the SAME
 *                   top-N ranked node ids in the SAME order (order-sensitive).
 *   2. ANTI-VACUITY — a node high by importance/confidence but LOW by raw
 *                   term-match now surfaces in the bundle top-N, and was ABSENT
 *                   under the old flat scoring (old algorithm replicated inline).
 *   3. SQLITE-OFF PARITY — the bundle KG ranking is identical with index:off and
 *                   index:on (runBothIndexModes); the branch reads the JSON
 *                   projection and never requires SQLite.
 *   4. SECURITY   — every KG chunk stays untrusted + trust-tier wrapped.
 *
 * Run: cd scripts && npx jest --no-coverage recall-kg-scoring-unify
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { recall } from "../lib/recall";
import { rankKgNodes } from "../lib/shared/graph-scoring";
import { runBothIndexModes } from "../understand/lib/parity-harness";
import type { GraphNode } from "../understand/lib/schema";

const KG_QUERY_SCRIPT = path.resolve(__dirname, "../understand/kg-query.ts");
const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture: a knowledge-recall.json where importance/confidence REORDERS the
// ranking relative to flat term-match. All nodes match "payment":
//   delta-exact  exact name match (+5), importance 0.5  → clear #1 either way
//   zeta-high    haystack match (+1), importance 0.95/high → rich rank #2,
//                but FLAT rank is a 4-way tie broken by id (sorts LAST)
//   alpha/beta/gamma-low  haystack match (+1), importance 0.05/low
// ---------------------------------------------------------------------------

function makeFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g15-kg-"));
  TEMP_DIRS.push(dir);
  const nodes = [
    {
      id: "node:delta-exact", type: "function", name: "payment",
      confidence: "medium", source_refs: ["src/payment/index.ts"], importance_score: 0.5,
    },
    {
      id: "node:zeta-high", type: "concept", name: "billing",
      confidence: "high", source_refs: ["src/payment/charge.ts"], importance_score: 0.95,
    },
    {
      id: "node:alpha-low", type: "file", name: "logs",
      confidence: "low", source_refs: ["src/payment/log.ts"], importance_score: 0.05,
    },
    {
      id: "node:beta-low", type: "file", name: "utils",
      confidence: "low", source_refs: ["src/payment/util.ts"], importance_score: 0.05,
    },
    {
      id: "node:gamma-low", type: "file", name: "config",
      confidence: "low", source_refs: ["payment.config.ts"], importance_score: 0.05,
    },
  ];
  const doc = { schema_version: "guild.knowledge_links.v2", nodes, edges: [] };
  const idxDir = path.join(dir, ".guild", "indexes");
  fs.mkdirSync(idxDir, { recursive: true });
  fs.writeFileSync(path.join(idxDir, "knowledge-recall.json"), JSON.stringify(doc), "utf8");
  return dir;
}

/** The old FLAT ranking the bundle used before G15 (replicated for anti-vacuity). */
function oldFlatRanking(nodes: GraphNode[], terms: string[], limit: number): string[] {
  const hayMatch = (n: GraphNode): number => {
    const hay = `${n.name} ${n.id} ${(n.source_refs ?? []).join(" ")}`.toLowerCase();
    let s = 0;
    for (const t of terms) {
      if (!t) continue;
      if (n.name.toLowerCase() === t) s += 5;
      else if (n.name.toLowerCase().includes(t)) s += 3;
      else if (hay.includes(t)) s += 1;
    }
    return s;
  };
  return nodes
    .map((n) => ({ n, s: hayMatch(n) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.n.id.localeCompare(b.n.id))
    .slice(0, limit)
    .map((x) => x.n.id);
}

/** Extract KG node ids (in order) from a recall result's protected chunks. */
function kgIdsFromRecall(chunks: { source_path: string }[]): string[] {
  return chunks
    .filter((c) => c.source_path.includes("knowledge-recall.json#"))
    .map((c) => c.source_path.split("#").slice(1).join("#"));
}

/** Run the kg-query CLI and return ranked node ids. */
function kgQueryCliIds(cwd: string, query: string, limit: number): string[] {
  const res = spawnSync(
    "npx",
    ["tsx", KG_QUERY_SCRIPT, "--cwd", cwd, "--q", query, "--json", "--limit", String(limit)],
    { encoding: "utf8" },
  );
  expect(res.status).toBe(0);
  const parsed = JSON.parse(res.stdout) as { results: Array<{ id: string }> };
  return parsed.results.map((r) => r.id);
}

// ---------------------------------------------------------------------------

describe("G15 — bundle KG ranking == kg-query CLI ranking", () => {
  const QUERY = "payment";

  test("1. PARITY: bundle KG branch and kg-query CLI return the same top-N order", () => {
    const cwd = makeFixtureRepo();
    const bundle = recall(QUERY, { cwd, limit: 10, _bm25Disabled: true });
    const bundleIds = kgIdsFromRecall(bundle.chunks);
    const cliIds = kgQueryCliIds(cwd, QUERY, 10);

    expect(bundleIds.length).toBeGreaterThan(0);
    // Order-sensitive equality — a reordering would fail this.
    expect(bundleIds).toEqual(cliIds);
    // Sanity: the rich pipeline puts the exact match first, the high-importance
    // node second (above the low-importance haystack matches).
    expect(bundleIds[0]).toBe("node:delta-exact");
    expect(bundleIds[1]).toBe("node:zeta-high");
  });

  test("2. ANTI-VACUITY: a high-importance/low-term node now surfaces; absent under old flat scoring", () => {
    const cwd = makeFixtureRepo();
    const doc = JSON.parse(
      fs.readFileSync(path.join(cwd, ".guild", "indexes", "knowledge-recall.json"), "utf8"),
    ) as { nodes: GraphNode[] };
    const terms = QUERY.split(/\s+/);
    const LIMIT = 4;

    // OLD behavior: flat term-match + id tiebreak → zeta-high (a 4-way tie that
    // sorts LAST by id) is pushed out of the top-4.
    const oldTop = oldFlatRanking(doc.nodes, terms, LIMIT);
    expect(oldTop).not.toContain("node:zeta-high");

    // NEW behavior (shared rankKgNodes, used by both bundle + CLI): importance
    // lifts zeta-high into the top-4.
    const newTop = rankKgNodes(doc.nodes, [], terms, LIMIT).map((x) => x.n.id);
    expect(newTop).toContain("node:zeta-high");

    // And the actual bundle output (limit 4) reflects the NEW behavior.
    const bundle = recall(QUERY, { cwd, limit: LIMIT, _bm25Disabled: true });
    expect(kgIdsFromRecall(bundle.chunks)).toContain("node:zeta-high");

    // The change is in the EXPECTED direction (old excluded, new includes).
    expect(oldTop).not.toEqual(newTop);
  });

  test("3. SQLITE-OFF PARITY: bundle KG ranking identical with index:off and index:on", () => {
    const cwd = makeFixtureRepo();
    const outcome = runBothIndexModes((ctx) => {
      const r = recall(QUERY, {
        cwd,
        limit: 10,
        _bm25Disabled: true,
        _indexConfig: { enabled: ctx.config.enabled },
      });
      return kgIdsFromRecall(r.chunks);
    });
    expect(outcome.ranBoth).toBe(true);
    expect(outcome.executed).toEqual(["off", "on"]);
    expect(outcome.identical).toBe(true);
    expect(outcome.off.length).toBeGreaterThan(0);
  });

  test("4. SECURITY: every KG chunk stays untrusted + trust-tier wrapped", () => {
    const cwd = makeFixtureRepo();
    const bundle = recall(QUERY, { cwd, limit: 10, _bm25Disabled: true });
    const kgChunks = bundle.chunks.filter((c) =>
      c.source_path.includes("knowledge-recall.json#"),
    );
    expect(kgChunks.length).toBeGreaterThan(0);
    for (const c of kgChunks) {
      expect(c.trust_tier).toBe("untrusted");
      expect(c.quarantined).toBe(false);
      // Clean (non-injected) untrusted chunks are wrapped, never raw.
      expect(c.rendered.startsWith('<guild:recall trust_tier="untrusted">')).toBe(true);
    }
    // Integrity directive is present when wrapped chunks exist.
    expect(bundle.directive).not.toBeNull();
  });
});
