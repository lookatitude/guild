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
import { runBothIndexModes } from "../learn/lib/parity-harness";

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

// ── FIX-T7.1-r2 finding-2: a no-provenance operator-SHAPED graph node is NOT over-trusted ─
//
// The r1 no-operator guard mapped ANY would-be operator hit straight to "trusted".
// That is still an over-trust: a SYNTHETIC graph node with NO provenance whose
// source_path merely looks operator-shaped (a node id containing `principles` /
// `goals.md`) was promoted to "trusted" — human-reviewed-grade — purely on its path.
// The fix re-derives the tier from frontmatter alone (operator path layer disabled),
// so such a node stays DEFAULT-DENY "untrusted"; only a node carrying REAL provenance
// (confidence:high + source_refs) earns wrapped "trusted".

// forge() has NO line provenance (source_refs lack #Lx-Ly) but its id sits on an
// operator-shaped path (`principles`); it CALLS processOrder().
function operatorImpostorCallGraph(): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = [
    { id: "function:src/order.ts:processOrder", type: "function", name: "processOrder", source_refs: ["src/order.ts#L10-L20"] },
    // No #Lx-Ly anchor → graph-query down-tiers to untrusted + filters refs to []
    // → structural source_path falls back to knowledge-graph.json#<id>, which
    // contains `principles` and so MATCHES the operator allowlist pattern.
    { id: "function:src/principles/forge.ts:forge", type: "function", name: "forge", source_refs: ["src/principles/forge.ts"] },
  ];
  const edges: GEdge[] = [
    { source: "function:src/principles/forge.ts:forge", target: "function:src/order.ts:processOrder", type: "calls" },
  ];
  return { nodes, edges };
}

describe("G7 finding-2 — a no-provenance operator-shaped graph node stays untrusted (not over-trusted)", () => {
  test("a path-shaped synthetic caller with NO provenance is wrapped 'untrusted', never promoted to trusted/operator", () => {
    const repo = mkTmpRepo();
    const { nodes, edges } = operatorImpostorCallGraph();
    writeGraph(repo, nodes, edges);

    const result = recall("what calls processOrder", { cwd: repo, _bm25Disabled: true, _kgDisabled: true });

    const impostor = result.chunks.find((c) => c.source_path.includes("forge"));
    expect(impostor).toBeDefined();

    // NON-VACUITY: that source_path WOULD classify "operator" through the default
    // (path-allowlist) classifier — so the guard is doing real work, and the r1
    // behaviour would have force-promoted it to "trusted".
    expect(classifyTrustTier(impostor!.source_path, impostor!.rendered)).toBe("operator");

    // The fix: re-derived from frontmatter alone → DEFAULT-DENY untrusted.
    expect(impostor!.trust_tier).not.toBe("operator");
    expect(impostor!.trust_tier).not.toBe("trusted"); // ← the over-trust the fix closes
    expect(impostor!.trust_tier).toBe("untrusted");
    expect(impostor!.quarantined).toBe(false);
    expect(impostor!.rendered).toContain('<guild:recall trust_tier="untrusted">');
    // Raw node content is NOT emitted unwrapped.
    expect(impostor!.rendered.startsWith("<guild:recall")).toBe(true);
  });

  test("CONTRAST: an operator-shaped caller WITH real #Lx-Ly provenance still earns wrapped 'trusted'", () => {
    // Same operator path, but now carrying a real line anchor → genuine evidence.
    const repo = mkTmpRepo();
    const nodes: GNode[] = [
      { id: "function:src/order.ts:processOrder", type: "function", name: "processOrder", source_refs: ["src/order.ts#L10-L20"] },
      { id: "function:src/principles/loader.ts:loadPrinciples", type: "function", name: "loadPrinciples", source_refs: ["src/principles/loader.ts#L1-L9"] },
    ];
    const edges: GEdge[] = [
      { source: "function:src/principles/loader.ts:loadPrinciples", target: "function:src/order.ts:processOrder", type: "calls" },
    ];
    writeGraph(repo, nodes, edges);

    const result = recall("what calls processOrder", { cwd: repo, _bm25Disabled: true, _kgDisabled: true });
    const evidence = result.chunks.find((c) => c.source_path.includes("principles/loader.ts"));
    expect(evidence).toBeDefined();
    expect(evidence!.trust_tier).toBe("trusted"); // earned via provenance, NOT path
    expect(evidence!.rendered).toContain('<guild:recall trust_tier="trusted">');
  });
});

// ── FIX-T7.1 F3: structural runs BEFORE the wiki sweep (0 file-sweep, 0 LLM) ───
//
// FIX-T7.1-r2 finding-1: the old proof was BEHAVIOURAL only (the matching wiki page
// is absent from the bundle), which a sweep-then-discard regression would pass. We
// now ALSO instrument the file sweep directly: `fs.readdirSync` is the dir-walk that
// BOTH wiki sweeps perform — the file-BM25 branch walks `.guild/wiki/**`, and the
// SQLite branch's `ensureWikiFtsIndex` enumerates the wiki dir to count/fingerprint
// files; the structural and KG branches read named JSON files and never readdir. So
// a structural answer must trigger ZERO `readdirSync`. The cross-module spy is
// proven LIVE (not vacuous) by the anti-vacuity test below, which asserts the SAME
// spy DOES fire (≥1) once the wiki sweep actually runs — and by a direct in-window
// control call. `fetch` (a real global) proves 0 LLM tokens.

const F3_WIKI = "decisions/order-flow.md";
const F3_WIKI_BODY = "# Order flow\n\ncheckout and processOrder settlement.\n";

describe("G7 F3 — a structural query resolves from the graph with 0 file-sweep / 0 LLM tokens", () => {
  test("structural fully answers → NO readdir sweep, matching wiki page absent, no network", () => {
    const repo = mkTmpRepo();
    const { nodes, edges } = callGraph();
    writeGraph(repo, nodes, edges);
    // A wiki page that PROVABLY matches the query (the anti-vacuity test below
    // shows the SAME page+query returns file-bm25) — present to prove it is skipped.
    writeWikiFile(repo, F3_WIKI, F3_WIKI_BODY);

    const fetchSpy = jest.fn();
    const origFetch = (globalThis as unknown as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch?: unknown }).fetch = fetchSpy;
    // Instrumented sweep denial: count every directory walk during the recall.
    const readdirSpy = jest.spyOn(fs, "readdirSync");
    let result: RecallResult;
    let recallReaddirCalls = -1; // sentinel: must be overwritten inside the try
    try {
      // index:on with threshold 0 → IF the wiki waterfall ran it would readdir the
      // wiki dir (to populate the FTS cache OR to walk it for file-BM25), and the
      // .md page would surface. Neither happens → the sweep never STARTED.
      result = recall("what calls processOrder", {
        cwd: repo,
        _indexConfig: { enabled: true, wiki_file_threshold: 0 },
        _kgDisabled: true,
      });
      // Capture the call count BEFORE mockRestore() — mockRestore() RESETS
      // mock.calls, so asserting on the spy AFTER restore is vacuous (Codex
      // FIX-T7.1-r3 #1): it would pass even if recall had swept the wiki dir.
      recallReaddirCalls = readdirSpy.mock.calls.length;
    } finally {
      (globalThis as unknown as { fetch?: unknown }).fetch = origFetch;
      readdirSpy.mockRestore();
    }

    // Structural fully answered → wiki waterfall skipped → structural-only source.
    expect(result.source).toBe("structural");
    expect(result.chunks.length).toBeGreaterThan(0);
    // 0 file-sweep — INSTRUMENTED on the count captured BEFORE restore, so a recall
    // that DID readdir the wiki dir (sweep STARTED) makes this FAIL, not pass.
    expect(recallReaddirCalls).toBe(0);
    // 0 file-sweep — BEHAVIOURAL corroboration: the matching wiki page is absent.
    expect(result.chunks.some((c) => c.source_path.endsWith(".md"))).toBe(false);
    // 0 LLM tokens: no network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("ANTI-VACUITY: with no structural answer the wiki sweep DOES readdir + match the page", () => {
    const repo = mkTmpRepo();
    // No graph → structural is a no-op → the wiki waterfall runs and matches the page.
    writeWikiFile(repo, F3_WIKI, F3_WIKI_BODY);

    const readdirSpy = jest.spyOn(fs, "readdirSync");
    let recallReaddirCalls = 0;
    let result: RecallResult;
    try {
      result = recall("what calls processOrder", {
        cwd: repo,
        _indexConfig: { enabled: false },
        _kgDisabled: true,
      });
      recallReaddirCalls = readdirSpy.mock.calls.length;
      // Spy-liveness control: a direct call inside the SAME window must register,
      // proving the spy is intercepting (so a 0 from recall above is meaningful).
      fs.readdirSync(repo);
      expect(readdirSpy.mock.calls.length).toBe(recallReaddirCalls + 1);
    } finally {
      readdirSpy.mockRestore();
    }

    expect(result.source).toBe("file-bm25");
    expect(result.chunks.some((c) => c.source_path.endsWith(".md"))).toBe(true);
    // Proves the readdir spy is LIVE on the cross-module path: the SAME spy that
    // read 0 in the structural test fires here when the sweep actually runs — so the
    // "0 readdir" sweep-denial assertion above is non-vacuous.
    expect(recallReaddirCalls).toBeGreaterThan(0);
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

// ── FIX-T7.1-r2 finding-3: PLAIN-word query parity via corpus-aware bypass ─────
//
// `isIdentifierAwareQuery` keys off the QUERY shape, so a plain query like
// `process order` (no `_`, no camelCase) returns false and still hit SQLite — yet
// it diverges whenever a DOC carries a camelCase identifier (`processOrder`) that
// the file-BM25 (index:off, source-of-truth) path splits into `process`+`order` but
// FTS5 does not. The corpus-aware bypass detects that the query's terms rely on a
// doc-side camelCase split and routes BOTH modes through file-BM25 → byte-identical.

describe("G7 finding-3 — a plain (non-identifier) query whose terms split a doc identifier stays parity-safe", () => {
  test("a 'process order' query returns byte-identical results index:on == index:off", () => {
    const repo = mkTmpRepo();
    // a.md carries the camelCase symbol the plain query relies on splitting;
    // b.md is padding so the corpus exceeds the (lowered) engagement threshold.
    writeWikiFile(repo, "a.md", "# Order\n\nThe processOrder function settles the invoice.\n");
    writeWikiFile(repo, "b.md", "# Other\n\nbilling cycles and dunning content.\n");

    // The query itself is NOT identifier-shaped — only the corpus signal can catch it.
    expect(isIdentifierAwareQuery("process order")).toBe(false);

    const outcome = runBothIndexModes((ctx) => {
      const r = recall("process order", {
        cwd: repo,
        _indexConfig: { ...ctx.config, wiki_file_threshold: 1 },
        _kgDisabled: true,
      });
      // Corpus-aware bypass → BOTH modes read file-BM25, never the FTS cache.
      ctx.reportEngagement(r.source === "sqlite");
      return { source: r.source, paths: r.chunks.map((c) => c.source_path).sort() };
    });

    expect(outcome.ranBoth).toBe(true);
    expect(outcome.identical).toBe(true);            // byte-identical across modes
    expect(outcome.off.source).toBe("file-bm25");
    expect(outcome.on.source).toBe("file-bm25");      // bypass → NOT sqlite
    // Non-vacuous: the plain `process order` query DID match the camelCase doc.
    expect(outcome.off.paths.some((p) => p.endsWith("a.md"))).toBe(true);
  });

  test("PRECISION: a plain query whose terms do NOT split any doc identifier still engages SQLite", () => {
    // SAME corpus shape (a.md has `processOrder`), but the query `invoice` does not
    // rely on splitting it → the bypass must NOT fire → SQLite engages at index:on.
    // Proves the corpus bypass is query-term-specific, not a blanket "any compound
    // in the corpus → always bypass".
    const repo = mkTmpRepo();
    writeWikiFile(repo, "a.md", "# Order\n\nThe processOrder function settles the invoice.\n");
    writeWikiFile(repo, "b.md", "# Other\n\nthe invoice ledger and dunning content.\n");

    const outcome = runBothIndexModes((ctx) => {
      const r = recall("invoice", {
        cwd: repo,
        _indexConfig: { ...ctx.config, wiki_file_threshold: 1 },
        _kgDisabled: true,
      });
      ctx.reportEngagement(r.source === "sqlite");
      return { source: r.source };
    });

    // Not bypassed → index:on engages the FTS cache, index:off does not.
    expect(outcome.engagement.off).toBe(false);
    expect(outcome.engagement.on).toBe(true);
  });
});

// ── FIX-T7.1-r3 finding-2: CATEGORY-scoped parity when the GLOBAL count crosses ──
//
// `corpusForcesIdentifierBypass` previously gated the bypass on the CATEGORY-scoped
// .md count. But SQLite engages on the WHOLE-wiki count (ensureWikiFtsIndex), and its
// FTS is category-AGNOSTIC (sqliteBranch passes no category). So a category-scoped
// `process order` whose SCOPED count was ≤ threshold skipped the bypass while SQLite
// engaged on the larger GLOBAL count — index:on then ranked out-of-category docs the
// scoped index:off (file-BM25) never saw → divergence. The gate now mirrors the GLOBAL
// engagement count (resolveMainRepoRoot(cwd) whole-wiki, the exact ensureWikiFtsIndex
// condition), so the bypass fires and BOTH modes read the scoped file-BM25 corpus.

describe("G7 finding-2 (r3) — a CATEGORY-scoped query stays parity-safe when the GLOBAL wiki count crosses the SQLite threshold", () => {
  test("category-scoped 'process order' is byte-identical index:on == index:off (scoped count ≤ threshold < global count)", () => {
    const repo = mkTmpRepo();
    // In-category (decisions): ONE doc carrying the camelCase identifier the plain
    // query splits — the scoped count (1) does NOT exceed threshold 1 on its own.
    writeWikiFile(repo, "decisions/order-flow.md", "# Order\n\nThe processOrder function settles the invoice.\n");
    // OUT-of-category padding: pushes the GLOBAL count over threshold AND (for p1)
    // carries plain `process`/`order` tokens that SQLite's category-agnostic FTS
    // WOULD rank for the plain query — the divergent doc the scoped index:off never sees.
    writeWikiFile(repo, "notes/p1.md", "# Notes\n\nprocess order routing; order process steps.\n");
    writeWikiFile(repo, "notes/p2.md", "# Pad\n\nunrelated billing and dunning content.\n");

    // Plain query — not identifier-shaped; only the corpus signal can catch it.
    expect(isIdentifierAwareQuery("process order")).toBe(false);

    const outcome = runBothIndexModes((ctx) => {
      const r = recall("process order", {
        cwd: repo,
        category: "decisions",
        // threshold 1: SCOPED decisions count (1) ≤ 1, but GLOBAL count (3) > 1, so
        // SQLite engages globally — the exact gap the old scoped-count gate missed.
        _indexConfig: { ...ctx.config, wiki_file_threshold: 1 },
        _kgDisabled: true,
      });
      ctx.reportEngagement(r.source === "sqlite");
      return { source: r.source, paths: r.chunks.map((c) => c.source_path).sort() };
    });

    expect(outcome.ranBoth).toBe(true);
    expect(outcome.identical).toBe(true);            // byte-identical across modes
    expect(outcome.off.source).toBe("file-bm25");
    expect(outcome.on.source).toBe("file-bm25");      // global-gate bypass → NOT sqlite
    // Non-vacuity: the scoped in-category doc IS returned, and NO out-of-category
    // (notes/p1.md, p2.md) doc leaked into EITHER mode. Pre-fix, index:on returned
    // the global-FTS p1.md while index:off returned order-flow.md → these would differ.
    const leaked = (paths: string[]) => paths.some((p) => p.endsWith("p1.md") || p.endsWith("p2.md"));
    expect(outcome.off.paths.some((p) => p.endsWith("order-flow.md"))).toBe(true);
    expect(outcome.on.paths.some((p) => p.endsWith("order-flow.md"))).toBe(true);
    expect(leaked(outcome.off.paths)).toBe(false);
    expect(leaked(outcome.on.paths)).toBe(false);
  });

  test("ANTI-VACUITY: the SAME 3-file corpus DOES cross the global SQLite threshold (un-scoped non-splitting query engages index:on)", () => {
    // Proves the parity above is NOT vacuous (i.e. not holding merely because SQLite
    // never engaged): with the same 3-file corpus at threshold 1, an un-scoped plain
    // query that relies on NO identifier split is NOT bypassed → index:on DOES engage
    // the FTS cache. So the global count (3) genuinely exceeds the threshold (1).
    const repo = mkTmpRepo();
    writeWikiFile(repo, "decisions/order-flow.md", "# Order\n\nThe processOrder function settles the invoice.\n");
    writeWikiFile(repo, "notes/p1.md", "# Notes\n\nprocess order routing; order process steps.\n");
    writeWikiFile(repo, "notes/p2.md", "# Pad\n\nunrelated billing and dunning content.\n");

    const outcome = runBothIndexModes((ctx) => {
      const r = recall("billing", {
        cwd: repo,
        _indexConfig: { ...ctx.config, wiki_file_threshold: 1 },
        _kgDisabled: true,
      });
      ctx.reportEngagement(r.source === "sqlite");
      return { source: r.source };
    });

    expect(outcome.engagement.off).toBe(false);
    expect(outcome.engagement.on).toBe(true); // SQLite engaged → global threshold (1) crossed by 3 files
  });
});
