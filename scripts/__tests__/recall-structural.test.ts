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
 *   3. structural + KG merge in ONE protected bundle, every chunk wrapped
 *   4. scope honored — a scoped query excludes an out-of-scope structural node
 *   5. SQLite-off==on parity (runBothIndexModes) on the model-free structural path
 * (Gate item 2 — the tokenizer — lives in tokenizer-identifier.test.ts.)
 *
 * FIX-T7.1 (closes the Codex review of 043b196 — 4 MAJOR):
 *   F1. classifier precision — a plain semantic query ("related to billing") does
 *       NOT route structural (the generic `related to` phrase was removed).
 *   F2. security — a structural hit whose source path matches an operator
 *       allowlist pattern stays trust-tier WRAPPED, never raw/operator.
 *   F3. ordering — a structural query resolves from the graph with 0 file-sweep /
 *       0 LLM tokens and does NOT run the wiki branches first.
 *   F4. FTS parity — an identifier (`process_order`) query returns identical
 *       results with index:on and index:off (camel/snake bypass of SQLite).
 *
 * Run: cd scripts && npx jest --no-coverage recall-structural
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { recall, type RecallResult } from "../lib/recall";
import { classifyStructuralIntent } from "../../src/modules/context/workflows/recall";
import { classifyTrustTier, isIdentifierAwareQuery } from "../lib/wiki-recall";
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

// Write a KG recall PROJECTION (knowledge-recall.json) — the additive KG branch (D)
// reads this, distinct from the structural knowledge-graph.json (branch E).
function writeKgProjection(repo: string, nodes: GNode[]): void {
  const dir = path.join(repo, ".guild", "indexes");
  fs.mkdirSync(dir, { recursive: true });
  const proj = {
    schema_version: "guild.knowledge_links.v2",
    nodes: nodes.map((n) => ({ confidence: "medium", ...n })),
    edges: [],
  };
  fs.writeFileSync(path.join(dir, "knowledge-recall.json"), JSON.stringify(proj, null, 2), "utf8");
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

  // FIX-T7.1 F1 — precision: the generic semantic phrase `related to X` must NOT
  // route a plain semantic query into the structural channel.
  test("F1: a generic 'related to <X>' semantic query does NOT route structural", () => {
    expect(classifyStructuralIntent("related to billing")).toBeNull();
    expect(classifyStructuralIntent("everything related to authentication")).toBeNull();
    expect(classifyStructuralIntent("docs related to checkout")).toBeNull();
    // …but an EXPLICIT graph term + symbol still routes (regression guard).
    expect(classifyStructuralIntent("imports of billing")).toMatchObject({ kind: "neighbors", target: "billing" });
    expect(classifyStructuralIntent("neighbors of authService")).toMatchObject({ kind: "neighbors" });
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

// ── Gate 3: structural + KG merge in ONE protected bundle ─────────────────────
//
// FIX-T7.1 F3 changed the merge semantics: a structural answer now SKIPS the wiki
// file sweep entirely, so structural+wiki "combined" is no longer reachable. The
// additive KG channel (a graph projection, not a file sweep) still merges — so the
// "one protected bundle, every chunk wrapped" invariant is proven via structural+KG.

describe("G7 gate-3 — structural + KG merge in one protected bundle (all wrapped)", () => {
  test("a structural query that also matches a KG node yields combined, fully-protected chunks", () => {
    const repo = mkTmpRepo();
    const { nodes, edges } = callGraph();
    writeGraph(repo, nodes, edges);
    // A KG projection node whose name matches the query term `processOrder`.
    writeKgProjection(repo, [
      { id: "topic:order", type: "topic", name: "processOrder", source_refs: ["src/order.ts#L10-L20"] },
    ]);

    const result = recall("what calls processOrder", { cwd: repo, _indexConfig: { enabled: false } });

    // Both graph channels contributed → combined (structural + KG).
    expect(result.source).toBe("combined");
    expect(result.chunks.some((c) => c.source_path.includes("checkout.ts"))).toBe(true); // structural
    expect(result.chunks.some((c) => c.source_path.includes("knowledge-recall.json"))).toBe(true); // KG

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

// ── FIX-T7.1 F2: structural chunks stay trust-tier wrapped, NEVER operator ────
//
// A structural node's source file can sit on an operator allowlist path (e.g.
// `src/principles/loader.ts` matches the `/principles/` operator pattern).
// protectChunks grants operator (UNWRAPPED, raw) by path BEFORE wrapping, so
// without the no-operator guard a structural hit could land as raw operator
// content. The fix forces graph-derived chunks down to wrapped "trusted".

// checkout() lives under an OPERATOR path (principles) and CALLS processOrder().
function operatorPathCallGraph(): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [
    { id: "function:src/order.ts:processOrder", type: "function", name: "processOrder", source_refs: ["src/order.ts#L10-L20"] },
    { id: "function:src/principles/loader.ts:loadPrinciples", type: "function", name: "loadPrinciples", source_refs: ["src/principles/loader.ts#L1-L9"] },
  ];
  const edges: GEdge[] = [
    { source: "function:src/principles/loader.ts:loadPrinciples", target: "function:src/order.ts:processOrder", type: "calls" },
  ];
  return { nodes, edges };
}

describe("G7 F2 — a structural hit on an operator-allowlist path stays WRAPPED (never operator)", () => {
  test("a caller whose source file matches an operator path is wrapped trusted, not raw operator", () => {
    const repo = mkTmpRepo();
    const { nodes, edges } = operatorPathCallGraph();
    writeGraph(repo, nodes, edges);

    // NON-VACUITY: that source path WOULD classify "operator" (raw, unwrapped)
    // through the default protect path — the guard is doing real work.
    expect(classifyTrustTier("src/principles/loader.ts", "anything")).toBe("operator");

    const result = recall("what calls processOrder", { cwd: repo, _bm25Disabled: true, _kgDisabled: true });

    const hit = result.chunks.find((c) => c.source_path.includes("principles/loader.ts"));
    expect(hit).toBeDefined();
    // Forced down to wrapped "trusted" — never operator, never raw.
    expect(hit!.trust_tier).not.toBe("operator");
    expect(hit!.trust_tier).toBe("trusted");
    expect(hit!.quarantined).toBe(false);
    expect(hit!.rendered).toContain('<guild:recall trust_tier="trusted">');
    // The raw node content is NOT emitted unwrapped.
    expect(hit!.rendered.startsWith("<guild:recall")).toBe(true);
  });
});

// ── FIX-T7.1 F3: structural runs BEFORE the wiki sweep (0 file-sweep, 0 LLM) ───
//
// Proven BEHAVIOURALLY (cross-module fs spies don't survive ts-jest's __importStar,
// so a readdir spy would pass vacuously): a wiki page that PROVABLY matches the
// query (see the anti-vacuity test) is ABSENT from a structural answer's bundle —
// the only way that happens is the wiki file sweep never ran. `fetch` (a real
// global) is spied to prove 0 LLM tokens.

const F3_WIKI = "decisions/order-flow.md";
const F3_WIKI_BODY = "# Order flow\n\ncheckout and processOrder settlement.\n";

describe("G7 F3 — a structural query resolves from the graph with 0 file-sweep / 0 LLM tokens", () => {
  test("structural fully answers → a matching wiki page is NOT swept into the bundle, no network", () => {
    const repo = mkTmpRepo();
    const { nodes, edges } = callGraph();
    writeGraph(repo, nodes, edges);
    // A wiki page that PROVABLY matches the query (the anti-vacuity test below
    // shows the SAME page+query returns file-bm25) — present to prove it is skipped.
    writeWikiFile(repo, F3_WIKI, F3_WIKI_BODY);

    const fetchSpy = jest.fn();
    const origFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch?: unknown }).fetch = fetchSpy;
    let result: RecallResult;
    try {
      // index:off → IF the wiki waterfall ran it would be file-bm25 and the .md page
      // would appear. It does not → the sweep was skipped.
      result = recall("what calls processOrder", {
        cwd: repo,
        _indexConfig: { enabled: false },
        _kgDisabled: true,
      });
    } finally {
      (globalThis as unknown as { fetch?: unknown }).fetch = origFetch;
    }

    // Structural fully answered → wiki waterfall skipped → structural-only source.
    expect(result.source).toBe("structural");
    expect(result.chunks.length).toBeGreaterThan(0);
    // 0 file-sweep: the matching wiki page was NOT pulled in.
    expect(result.chunks.some((c) => c.source_path.endsWith(".md"))).toBe(false);
    // 0 LLM tokens: no network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("ANTI-VACUITY: the SAME wiki page + query DOES match when there is no structural answer", () => {
    const repo = mkTmpRepo();
    // No graph → structural is a no-op → the wiki waterfall runs and matches the page.
    writeWikiFile(repo, F3_WIKI, F3_WIKI_BODY);

    const result = recall("what calls processOrder", {
      cwd: repo,
      _indexConfig: { enabled: false },
      _kgDisabled: true,
    });

    expect(result.source).toBe("file-bm25");
    expect(result.chunks.some((c) => c.source_path.endsWith(".md"))).toBe(true);
  });
});

// ── FIX-T7.1 F4: identifier FTS parity — index:on == index:off ────────────────
//
// The file-BM25 path tokenizes identifier-aware (camel/snake), matching a
// `process_order` query against a `processOrder` symbol. The SQLite FTS path does
// NOT split camelCase, so the SAME query could return different results across
// modes. The fix bypasses SQLite for identifier-shaped queries → byte-identical.

describe("G7 F4 — identifier (camel/snake) query bypasses SQLite for index:on==off parity", () => {
  test("a process_order query returns byte-identical results with index:on and index:off", () => {
    const repo = mkTmpRepo();
    // One doc carries the camelCase symbol; a pad doc keeps us above threshold-1.
    writeWikiFile(repo, "a.md", "# Order\n\nThe processOrder function settles the invoice.\n");
    writeWikiFile(repo, "b.md", "# Other\n\nbilling cycles and dunning content.\n");

    const outcome = runBothIndexModes((ctx) => {
      const r = recall("process_order", {
        cwd: repo,
        _indexConfig: { ...ctx.config, wiki_file_threshold: 1 },
        _kgDisabled: true,
      });
      // Identifier queries bypass the FTS cache → BOTH modes read file-BM25.
      ctx.reportEngagement(r.source === "sqlite");
      return { source: r.source, paths: r.chunks.map((c) => c.source_path).sort() };
    });

    expect(outcome.ranBoth).toBe(true);
    expect(outcome.identical).toBe(true);          // byte-identical across modes
    expect(outcome.off.source).toBe("file-bm25");
    expect(outcome.on.source).toBe("file-bm25");    // bypass → NOT sqlite
    // Non-vacuous: the snake_case query DID match the camelCase doc.
    expect(outcome.off.paths.some((p) => p.endsWith("a.md"))).toBe(true);
    expect(isIdentifierAwareQuery("process_order")).toBe(true);
  });

  test("ANTI-VACUITY: a plain (non-identifier) query DOES engage SQLite at index:on", () => {
    const repo = mkTmpRepo();
    writeWikiFile(repo, "a.md", "# Order\n\nThe invoice settlement page content.\n");
    writeWikiFile(repo, "b.md", "# More\n\ninvoice settlement and dunning content.\n");

    const outcome = runBothIndexModes((ctx) => {
      const r = recall("invoice settlement", {
        cwd: repo,
        _indexConfig: { ...ctx.config, wiki_file_threshold: 1 },
        _kgDisabled: true,
      });
      ctx.reportEngagement(r.source === "sqlite");
      return { source: r.source };
    });

    // Plain query is NOT bypassed → index:on engages the FTS cache; index:off does not.
    expect(outcome.engagement.off).toBe(false);
    expect(outcome.engagement.on).toBe(true);
    expect(isIdentifierAwareQuery("invoice settlement")).toBe(false);
  });
});
