/**
 * scripts/__tests__/recall-structural.test.ts
 *
 * G7 (T7.1) — structural recall channel (branch E).
 *
 * A deterministic structural-intent classifier routes callers/callees/imports/
 * dead-code/impact queries to the COMMITTED model-free graph-query lib (G3) over
 * the FROZEN knowledge-graph.json, returning trusted file:line evidence merged
 * into the single protected bundle — 0 model tokens, SQLite-independent.
 *
 * Covers the validation gate:
 *   1. structural query → call chain from the graph, 0 model tokens (fetch spy)
 *   3. structural + wiki merge in ONE protected bundle, every chunk wrapped
 *   4. scope honored — a scoped query excludes an out-of-scope structural node
 *   5. SQLite-off==on parity (runBothIndexModes) on the model-free structural path
 * (Gate item 2 — the tokenizer — lives in tokenizer-identifier.test.ts.)
 *
 * Run: cd scripts && npx jest --no-coverage recall-structural
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { recall, type RecallResult } from "../lib/recall";
import { classifyStructuralIntent } from "../../src/modules/context/workflows/recall";
import { runBothIndexModes } from "../understand/lib/parity-harness";

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});

function mkTmpRepo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-recall-structural-"));
  TEMP_DIRS.push(d);
  return d;
}

function writeWikiFile(repo: string, relPath: string, content: string): void {
  const abs = path.join(repo, ".guild", "wiki", relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

interface GNode { id: string; type: string; name: string; source_refs: string[]; confidence?: string; category?: string }
interface GEdge { source: string; target: string; type: string; direction?: string; weight?: number }

function writeGraph(repo: string, nodes: GNode[], edges: GEdge[]): void {
  const dir = path.join(repo, ".guild", "indexes");
  fs.mkdirSync(dir, { recursive: true });
  const doc = {
    schema_version: "guild.knowledge_graph.v1",
    project: "fixture",
    nodes: nodes.map((n) => ({ confidence: "high", ...n })),
    edges: edges.map((e) => ({ direction: "out", weight: 1, ...e })),
  };
  fs.writeFileSync(path.join(dir, "knowledge-graph.json"), JSON.stringify(doc, null, 2), "utf8");
}

// A small call graph: checkout() and adminPanel() both CALL processOrder().
function callGraph(): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [
    { id: "function:src/order.ts:processOrder", type: "function", name: "processOrder", source_refs: ["src/order.ts#L10-L20"] },
    { id: "function:src/billing/checkout.ts:checkout", type: "function", name: "checkout", source_refs: ["src/billing/checkout.ts#L5-L15"] },
    { id: "function:src/admin/panel.ts:adminPanel", type: "function", name: "adminPanel", source_refs: ["src/admin/panel.ts#L1-L9"] },
  ];
  const edges: GEdge[] = [
    { source: "function:src/billing/checkout.ts:checkout", target: "function:src/order.ts:processOrder", type: "calls" },
    { source: "function:src/admin/panel.ts:adminPanel", target: "function:src/order.ts:processOrder", type: "calls" },
  ];
  return { nodes, edges };
}

// ── Classifier ────────────────────────────────────────────────────────────────

describe("G7 — structural-intent classifier (precision over recall)", () => {
  test("structural phrasings classify; ordinary recall queries return null", () => {
    expect(classifyStructuralIntent("what calls processOrder")).toMatchObject({ kind: "trace", direction: "inbound", target: "processOrder" });
    expect(classifyStructuralIntent("callers of processOrder")).toMatchObject({ kind: "trace", direction: "inbound" });
    expect(classifyStructuralIntent("what does checkout call")).toMatchObject({ kind: "trace", direction: "outbound", target: "checkout" });
    expect(classifyStructuralIntent("impact of processOrder")).toMatchObject({ kind: "trace", direction: "inbound" });
    expect(classifyStructuralIntent("find dead code")).toMatchObject({ kind: "deadcode" });
    expect(classifyStructuralIntent("imports of authService")).toMatchObject({ kind: "neighbors" });

    // NON-structural → null (must not hijack ordinary recall).
    expect(classifyStructuralIntent("authentication settings for the payment flow")).toBeNull();
    expect(classifyStructuralIntent("how do we handle retries")).toBeNull();
    expect(classifyStructuralIntent("AuthService authentication class")).toBeNull();
  });
});

// ── Gate 1: call chain from the graph, 0 model tokens ─────────────────────────

describe("G7 gate-1 — structural query returns the call chain, 0 model tokens", () => {
  test("'what calls processOrder' returns the inbound callers as trusted file:line evidence, no network", () => {
    const repo = mkTmpRepo();
    const { nodes, edges } = callGraph();
    writeGraph(repo, nodes, edges);

    // 0 model tokens: a fetch spy proves the structural path makes NO network call.
    const fetchSpy = jest.fn();
    const origFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch?: unknown }).fetch = fetchSpy;
    let result: RecallResult;
    try {
      result = recall("what calls processOrder", { cwd: repo, _bm25Disabled: true, _kgDisabled: true });
    } finally {
      (globalThis as unknown as { fetch?: unknown }).fetch = origFetch;
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.source).toBe("structural");

    // The caller (checkout) came straight from the graph's `calls` edge.
    const caller = result.chunks.find((c) => c.source_path.includes("checkout.ts"));
    expect(caller).toBeDefined();
    expect(caller!.trust_tier).toBe("trusted"); // has #Lx-Ly provenance → EVIDENCE
    expect(caller!.rendered).toContain('<guild:recall trust_tier="trusted">');
    // file:line provenance is carried through (not stripped).
    expect(caller!.rendered).toContain("src/billing/checkout.ts#L5-L15");
    // Both callers surface (admin panel also calls processOrder).
    expect(result.chunks.some((c) => c.source_path.includes("panel.ts"))).toBe(true);
  });

  test("no knowledge-graph.json → structural branch is a no-op (falls through to wiki)", () => {
    const repo = mkTmpRepo();
    writeWikiFile(repo, "clean.md", "# Clean\n\nA clean wiki page about checkout flow.\n");
    const result = recall("what calls processOrder", { cwd: repo, _indexConfig: { enabled: false }, _kgDisabled: true });
    expect(result.source).not.toBe("structural");
  });
});

// ── Gate 3: structural + wiki merge in ONE protected bundle ───────────────────

describe("G7 gate-3 — structural + wiki merge in one protected bundle (all wrapped)", () => {
  test("a structural query that also matches a wiki page yields combined, fully-protected chunks", () => {
    const repo = mkTmpRepo();
    const { nodes, edges } = callGraph();
    writeGraph(repo, nodes, edges);
    // A wiki page that matches the query terms (processOrder / checkout).
    writeWikiFile(repo, "decisions/order-flow.md", "# Order flow\n\nThe checkout path and processOrder settlement decision.\n");

    const result = recall("what calls processOrder", { cwd: repo, _indexConfig: { enabled: false }, _kgDisabled: true });

    // Both channels contributed → combined.
    expect(result.source).toBe("combined");
    expect(result.chunks.some((c) => c.source_path.includes("checkout.ts"))).toBe(true); // structural
    expect(result.chunks.some((c) => c.source_path.endsWith(".md"))).toBe(true); // wiki

    // Bundle invariant: NO raw chunk — every chunk is wrapped, quarantined, or operator.
    for (const chunk of result.chunks) {
      const wrapped = chunk.rendered.includes("<guild:recall trust_tier=");
      const quarantined = chunk.rendered.includes("[QUARANTINED:");
      const operator = chunk.trust_tier === "operator" && !chunk.quarantined;
      expect(wrapped || quarantined || operator).toBe(true);
    }
    expect(result.directive).toBeTruthy();
  });
});

// ── Gate 4: scope honored on the structural channel ───────────────────────────

describe("G7 gate-4 — category/source scope excludes out-of-scope structural nodes", () => {
  test("scoping 'what calls processOrder' to 'billing' keeps the billing caller and PROVABLY drops the admin caller", () => {
    const repo = mkTmpRepo();
    const { nodes, edges } = callGraph();
    writeGraph(repo, nodes, edges);

    // Baseline (no scope): BOTH callers surface — proves the scope test is non-vacuous.
    const unscoped = recall("what calls processOrder", { cwd: repo, _bm25Disabled: true, _kgDisabled: true });
    expect(unscoped.chunks.some((c) => c.source_path.includes("billing/checkout.ts"))).toBe(true);
    expect(unscoped.chunks.some((c) => c.source_path.includes("admin/panel.ts"))).toBe(true);

    // Scoped to "billing": the admin caller MATCHES the trace but is out of scope → absent.
    const scoped = recall("what calls processOrder", { cwd: repo, category: "billing", _bm25Disabled: true, _kgDisabled: true });
    expect(scoped.chunks.some((c) => c.source_path.includes("billing/checkout.ts"))).toBe(true);
    expect(scoped.chunks.some((c) => c.source_path.includes("admin/panel.ts"))).toBe(false);
  });
});

// ── Determinism: reversed graph input → identical structural output ───────────

describe("G7 determinism — reversing the consumed nodes/edges yields identical output", () => {
  test("shuffling/reversing knowledge-graph.json nodes AND edges does not change the structural chunks", () => {
    const { nodes, edges } = callGraph();

    const repoA = mkTmpRepo();
    writeGraph(repoA, nodes, edges);
    const a = recall("what calls processOrder", { cwd: repoA, _bm25Disabled: true, _kgDisabled: true });

    // Reverse BOTH arrays — the actual structures the structural branch consumes.
    const repoB = mkTmpRepo();
    writeGraph(repoB, [...nodes].reverse(), [...edges].reverse());
    const b = recall("what calls processOrder", { cwd: repoB, _bm25Disabled: true, _kgDisabled: true });

    const key = (r: RecallResult) => r.chunks.map((c) => `${c.source_path}|${c.trust_tier}|${c.rendered}`).join("\n");
    expect(key(a)).toBe(key(b)); // byte-identical bundle regardless of input order
    expect(a.chunks.length).toBeGreaterThan(0); // non-vacuous
  });
});

// ── Gate 5: SQLite-off==on parity on the model-free structural path ───────────

describe("G7 gate-5 — structural channel is SQLite-independent (off==on parity)", () => {
  test("the SAME structural query returns byte-identical chunks with index:off and index:on", () => {
    const repo = mkTmpRepo();
    const { nodes, edges } = callGraph();
    writeGraph(repo, nodes, edges);

    const outcome = runBothIndexModes((ctx) => {
      const r = recall("what calls processOrder", { cwd: repo, _indexConfig: ctx.config, _kgDisabled: true });
      // The structural channel reads the FROZEN knowledge-graph.json directly — it
      // NEVER engages the wiki FTS cache, so it is JSON-both by design (the off==on
      // invariant holds trivially). engagementProven (off=false/on=true) applies
      // only to wiki-FTS gates; here both modes legitimately read JSON.
      ctx.reportEngagement(r.source === "sqlite");
      return { source: r.source, chunks: r.chunks };
    });

    expect(outcome.ranBoth).toBe(true);
    expect(outcome.identical).toBe(true);
    expect(outcome.off.source).toBe("structural");
  });
});
