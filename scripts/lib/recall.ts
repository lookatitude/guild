/**
 * scripts/lib/recall.ts
 *
 * D-RECALL (Wave-3 security) — single config-aware protected recall entry.
 *
 * `recall(query, opts)` picks the recall mechanism from config and routes ALL
 * hits through protectChunks (recall-protect.ts) before returning.
 * No raw recall output ever reaches the caller.
 *
 * Routing:
 *   WIKI (waterfall — first returning branch wins):
 *     A. SQLite FTS (wiki-recall.ts):
 *          `index.enabled=true` AND file count > `wiki_file_threshold`.
 *          Returns null when below threshold or disabled → fall through.
 *     B. File-BM25 (mcp-servers/guild-memory/src/bm25.ts):
 *          Direct in-process BM25 over .guild/wiki/ recursively (*.md files).
 *          k1=1.5/b=0.75 — same parameters as guild-memory's MCP search path.
 *          Returns null when no wiki files match query terms → fall through.
 *     C. fsScan (fs-scanner.ts):
 *          Last-resort fallback. Always returns (may be empty array).
 *   KG (additive — always appended when knowledge-graph.json exists):
 *     D. kg-query (understand/lib/schema.ts KnowledgeGraph):
 *          2-hop node scoring over .guild/indexes/knowledge-graph.json.
 *          KG nodes are ALWAYS classified untrusted (DEFAULT-DENY; not wiki operator paths).
 *          Returns null when KG file absent or no matching nodes.
 *
 * Wiki (A/B/C) + KG (D) results are combined into a single protected chunks[].
 * If both contribute: source = "combined"; if only one: source = that branch's id.
 *
 * Bundle invariant: every chunk in `chunks[]` is [QUARANTINED] /
 *   <guild:recall trust_tier="…"> / operator-unwrapped — NEVER raw.
 *
 * Federation: recall.ts is per-root. Pass `--cwd <sub-guild-root>` to target
 * any sub-guild root — context-assemble loops recall.ts per registered root.
 *
 * Skills wire context-assemble at this module. guild-memory MCP stays registered
 * for the model's ad-hoc queries but is OUT of the deterministic bundle-recall path.
 *
 * Usage (library):
 *   import { recall } from './recall'
 *   const { chunks, directive, source } = recall("authentication configure", { cwd })
 *
 * CLI:
 *   npx tsx scripts/lib/recall.ts --query "authentication" --cwd /repo
 *     [--category decisions] [--limit 10] [--run-id <id> [--run-dir <dir>]]
 *   stdout: { chunks: ProtectedChunk[], directive: string | null, source }
 *   Exit 0 on success; 1 on missing --query.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { DEFAULT_INDEX_BLOCK, type IndexBlock } from "./index-cache";
import { wikiRecall } from "./wiki-recall";
import { fsScan } from "./fs-scanner";
import { protectChunks, type ProtectedChunk } from "./recall-protect";
import { tokenize, bm25Score } from "./shared/bm25";
import { termMatchScore } from "./shared/graph-scoring";
import type { KnowledgeGraph, GraphNode } from "../understand/lib/schema";
import { ingestImportanceScore, resolveRecallImportance } from "./ingest-importance";

// Re-export so existing importers (`recall.ts` was the original home of the scorer)
// keep resolving `ingestImportanceScore` from here; canonical impl now in ingest-importance.ts.
export { ingestImportanceScore };

/** Default recency half-life (days) for composite recall when none is supplied. */
export const DEFAULT_RECALL_HALF_LIFE_DAYS = 90;

// ── Public types ──────────────────────────────────────────────────────────────

export type RecallSource = "sqlite" | "file-bm25" | "fs-scan" | "kg-query" | "combined";

export interface RecallResult {
  /** Protected chunks — each passed through protectChunks on every branch. */
  chunks: ProtectedChunk[];
  /**
   * Integrity directive to prepend before all recall content when ≥1 wrapped
   * chunk exists; null when all chunks are operator-tier or no chunks returned.
   */
  directive: string | null;
  /** Which recall mechanism(s) were used — informational (telemetry / logging). */
  source: RecallSource;
}

export interface RecallOpts {
  /** Absolute path to the consuming repo root (where .guild/ lives). */
  cwd: string;
  /**
   * Scope wiki recall to a specific category (e.g. "decisions", "context").
   * When absent, all wiki files are candidates.
   * Has no effect on the KG branch (KG is always searched unscoped).
   */
  category?: string;
  /** Maximum number of chunks per mechanism (default 10). */
  limit?: number;
  /** Run directory for quarantine event emission. Derived from cwd+runId if absent. */
  runDir?: string;
  /** Run ID for quarantine event emission. Events not written when absent. */
  runId?: string;
  /**
   * TEST SEAM: override index config fields (merged over DEFAULT_INDEX_BLOCK).
   *   { enabled: false }                 → bypasses sqlite, goes to file-BM25/fsScan
   *   { enabled: true, wiki_file_threshold: 1 } → triggers sqlite at 2+ files
   */
  _indexConfig?: Partial<IndexBlock>;
  /**
   * TEST SEAM: disable the file-BM25 branch (branch B), forcing fsScan fallback.
   * Use ONLY in tests that specifically need to exercise the fsScan code path.
   */
  _bm25Disabled?: boolean;
  /**
   * TEST SEAM: disable the KG branch (branch D), so KG nodes are never appended.
   * Use in tests that verify wiki-only results and don't want KG interference.
   */
  _kgDisabled?: boolean;
  /**
   * Composite recall scoring + importance gate (items 6/7, docs/v2/05 §Recall).
   * Absent → shipped BM25-only ranking (byte-identical default). Present →
   * wiki ranking becomes `relevance(BM25) × recency(exp-decay) × importance(1–5)`
   * and pages scoring below `importanceGate` are filtered from routine recall.
   * Resolved from `models.compositeRecall` + `models.importanceGate` by the CLI.
   */
  composite?: CompositeConfig;
}

// ── Composite recall scoring (docs/v2/05-knowledge-memory.md §Recall scoring) ──

/** Config for the composite recall re-ranker + importance gate. */
export interface CompositeConfig {
  /** 1–5 floor; wiki pages scoring below this are dropped from routine recall. */
  importanceGate: number;
  /** Recency exponential-decay half-life in days. */
  halfLifeDays: number;
  /** TEST SEAM: fixed "now" in ms for deterministic recency. Defaults to Date.now(). */
  nowMs?: number;
}

/** Exponential recency decay in (0,1]: 1.0 at age 0, 0.5 at one half-life. */
export function recencyDecay(ageMs: number, halfLifeDays: number): number {
  if (!(halfLifeDays > 0)) return 1;
  const ageDays = Math.max(0, ageMs) / 86_400_000;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/** Composite recall score = relevance(BM25) × recency × (importance/5). */
export function compositeScore(
  relevance: number,
  importance1to5: number,
  ageMs: number,
  halfLifeDays: number,
): number {
  return relevance * recencyDecay(ageMs, halfLifeDays) * (importance1to5 / 5);
}

/**
 * Resolve the composite-recall config from settings (`models.compositeRecall` +
 * `models.importanceGate`) for a cwd. Returns the `CompositeConfig` when composite
 * recall is enabled (the default), or `undefined` when disabled / settings are
 * unreadable (→ legacy BM25-only ranking). Kept OUT of the pure `recall()` fn so
 * the pure path never loads the settings resolver — both the CLI and the
 * host-adapter memory path call this so the config-driven default takes effect
 * on every recall surface, not just the CLI.
 */
export function resolveCompositeConfig(cwd: string): CompositeConfig | undefined {
  try {
    // Lazy require so the pure library path never loads the settings resolver.
    const { resolveSettings } = require("./settings-resolver") as typeof import("./settings-resolver");
    const models = (resolveSettings({ cwd }).config as {
      models?: { compositeRecall?: boolean; importanceGate?: number };
    }).models;
    if (models?.compositeRecall) {
      return { importanceGate: models.importanceGate ?? 3, halfLifeDays: DEFAULT_RECALL_HALF_LIFE_DAYS };
    }
  } catch { /* settings unreadable → BM25-only default */ }
  return undefined;
}

/** Wiki category from an absolute path under `<wikiBase>/<category>/…`. */
function categoryFromWikiPath(absPath: string, wikiBase: string): string | undefined {
  const segs = path.relative(wikiBase, absPath).split(path.sep);
  return segs.length > 1 ? segs[0] : undefined;
}

/**
 * Rank scored wiki docs. Default (no composite): BM25 desc, score>0, capped.
 * Composite: re-rank by `compositeScore` and drop pages whose 1–5 importance is
 * below the gate (lower pages stay reachable by an explicit category query).
 */
function rankWikiDocs(
  docs: { path: string; content: string; score: number }[],
  wikiBase: string,
  limit: number,
  composite: CompositeConfig | undefined,
): { path: string; content: string }[] {
  const scoring = docs.filter((d) => d.score > 0);
  if (!composite) {
    return scoring.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  const now = composite.nowMs ?? Date.now();
  return scoring
    .map((d) => {
      // Prefer the persisted write-time `recall_importance:` score; fall back to the
      // category-derived value for an un-stamped page (byte-identical to pre-lane behavior).
      const importance = resolveRecallImportance(d.content, categoryFromWikiPath(d.path, wikiBase));
      let ageMs = 0;
      try { ageMs = now - fs.statSync(d.path).mtimeMs; } catch { /* unstattable → age 0 */ }
      return { d, importance, comp: compositeScore(d.score, importance, ageMs, composite.halfLifeDays) };
    })
    .filter((x) => x.importance >= composite.importanceGate)
    .sort((a, b) => b.comp - a.comp)
    .slice(0, limit)
    .map((x) => x.d);
}

// ── Internal: recursive .md file walker ──────────────────────────────────────

function walkMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        result.push(full);
      }
    }
  }
  return result;
}

// ── Internal: KG node scorer ─────────────────────────────────────────────────
//
// Re-arch WAVE 1: the term-match primitive is now the canonical
// `termMatchScore` from scripts/lib/shared/graph-scoring.ts — the same loop
// kg-query.ts uses. recall's KG branch intentionally ranks on term match alone
// (no importance/confidence), so it calls the shared primitive directly.

// ── Branch A: SQLite FTS (wiki-recall.ts) ─────────────────────────────────────
//
// wikiRecall already calls protectChunks internally (D-RECALL Wave-3 refactor).
// WikiChunk fields (path, text) are mapped to ProtectedChunk (source_path, rendered).
// Returns null when below threshold or disabled → fall through.

function sqliteBranch(
  query: string,
  cwd: string,
  indexConfig: IndexBlock,
  limit: number,
  runDir?: string,
  runId?: string,
): RecallResult | null {
  const runCtx = runDir && runId ? { runDir, runId } : {};
  const result = wikiRecall(query, cwd, indexConfig, { limit, ...runCtx });
  if (!result) return null;

  // WikiChunk is ProtectedChunk with renamed fields (backward-compat wrapper).
  const chunks: ProtectedChunk[] = result.chunks.map((c) => ({
    source_path: c.path,
    rendered: c.text,
    trust_tier: c.trust_tier,
    quarantined: c.quarantined,
  }));
  return { source: "sqlite", chunks, directive: result.directive };
}

// ── Branch B: File-BM25 (mcp-servers/guild-memory/src/bm25.ts) ───────────────
//
// Direct in-process BM25 over .guild/wiki/<category?>/**/*.md.
// k1=1.5/b=0.75 — identical to guild-memory's search path.
// Returns null when no docs score >0 (fall through to fsScan).

function fileBm25Branch(
  query: string,
  cwd: string,
  category: string | undefined,
  limit: number,
  runDir?: string,
  runId?: string,
  composite?: CompositeConfig,
): RecallResult | null {
  const wikiBase = path.join(cwd, ".guild", "wiki");
  const scanDir = category ? path.join(wikiBase, category) : wikiBase;

  const files = walkMdFiles(scanDir);
  if (files.length === 0) return null;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return null;

  // Read and tokenize all files
  const docs = files.map((f) => {
    let content = "";
    try { content = fs.readFileSync(f, "utf8"); } catch { /* unreadable: keep empty */ }
    return { path: f, content, tokens: tokenize(content) };
  });

  const scores = bm25Score(queryTokens, docs);

  // BM25 desc by default; composite re-rank + importance gate when configured.
  const ranked = rankWikiDocs(
    docs.map((d, i) => ({ path: d.path, content: d.content, score: scores[i] ?? 0 })),
    wikiBase,
    limit,
    composite,
  );

  if (ranked.length === 0) return null;

  const rawHits = ranked.map((d) => ({
    source_path: path.relative(cwd, d.path),
    content: d.content,
  }));

  const { chunks, directive } = protectChunks(rawHits, {
    runDir,
    runId,
    callerTool: "recall:file-bm25",
  });
  return { source: "file-bm25", chunks, directive };
}

// ── Branch C: fsScan → protectChunks ─────────────────────────────────────────
//
// Last-resort fallback. Uses fs-scanner.ts (FDC-13 degraded-path reader) to get
// TF-ranked hits, then re-reads full file content for each hit (so parseFrontmatter
// can classify trust tier from frontmatter — the snippet alone is not enough).
// All hits feed through protectChunks — bundle invariant holds.

function fsScanBranch(
  query: string,
  cwd: string,
  category: string | undefined,
  limit: number,
  runDir?: string,
  runId?: string,
): RecallResult {
  // Scope the scan to .guild/wiki/<category> if given, else .guild/wiki entirely.
  const scanDirs = category ? [`wiki/${category}`] : ["wiki"];
  const scanResult = fsScan(query, cwd, {
    dirs: scanDirs,
    limit,
    extensions: [".md"],
  });

  if (!scanResult || scanResult.hits.length === 0) {
    return { source: "fs-scan", chunks: [], directive: null };
  }

  // Re-read each file for full content (needed for frontmatter + trust classification).
  // FsScanHit.path is absolute — convert to relative for source_path.
  const rawHits = scanResult.hits.map((hit) => {
    const absPath = hit.path;
    const relPath = path.relative(cwd, absPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      // Unreadable after scan — use snippet as fallback (classifyTrustTier → untrusted).
      content = hit.snippet;
    }
    return { source_path: relPath, content };
  });

  const { chunks, directive } = protectChunks(rawHits, {
    runDir,
    runId,
    callerTool: "recall:fs-scan",
  });
  return { source: "fs-scan", chunks, directive };
}

// ── Branch D: kg-query (KnowledgeGraph 2-hop traversal) ──────────────────────
//
// Reads .guild/indexes/knowledge-graph.json (produced by understand/analyze-*.ts),
// scores nodes via the same grep-first term scorer as kg-query.ts, and routes
// each matching node through protectChunks.
//
// KG nodes are ALWAYS classified untrusted (DEFAULT-DENY). The node "content"
// is a deterministic markdown summary — not a raw file, so no operator-path
// allowlist match is possible. The probe still runs on each node (injection guard).
//
// This branch is ADDITIVE — it appends to whatever the wiki branch returned.
// Returns null when the KG file is absent or no nodes match the query.

function kgQueryBranch(
  query: string,
  cwd: string,
  limit: number,
  runDir?: string,
  runId?: string,
): RecallResult | null {
  const kgPath = path.join(cwd, ".guild", "indexes", "knowledge-graph.json");
  if (!fs.existsSync(kgPath)) return null;

  let graph: KnowledgeGraph | null = null;
  try {
    graph = JSON.parse(fs.readFileSync(kgPath, "utf8")) as KnowledgeGraph;
  } catch {
    return null;
  }

  if (!Array.isArray(graph?.nodes) || graph.nodes.length === 0) return null;

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const ranked = (graph.nodes as GraphNode[])
    .map((n) => ({ n, s: termMatchScore(n, terms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.n.id.localeCompare(b.n.id))
    .slice(0, limit);

  if (ranked.length === 0) return null;

  // Build a deterministic markdown summary for each node.
  // source_path uses the kg file path + node id so classifyTrustTier can
  // identify the origin without hitting the operator-path allowlist.
  const rawHits = ranked.map(({ n }) => {
    const sourceRefs = (n.source_refs ?? []).slice(0, 2).join(", ");
    const content =
      `# ${n.name} (${n.type})\n\n` +
      `confidence: ${n.confidence}\n` +
      (sourceRefs ? `source_refs: ${sourceRefs}\n` : "");
    return {
      source_path: `.guild/indexes/knowledge-graph.json#${n.id}`,
      content,
    };
  });

  const { chunks, directive } = protectChunks(rawHits, {
    runDir,
    runId,
    callerTool: "recall:kg-query",
  });
  return { source: "kg-query", chunks, directive };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Protected recall — single entry point for context-assemble.
 *
 * Routes wiki content through the A→B→C waterfall (first returning branch wins).
 * KG content (branch D) is always appended when knowledge-graph.json exists.
 * Every branch feeds all hits through protectChunks before returning.
 * The caller receives ONLY protected ProtectedChunk[] — never raw content.
 *
 * source: "sqlite"|"file-bm25"|"fs-scan" when only wiki contributes.
 *         "kg-query"                     when only KG contributes.
 *         "combined"                     when both contribute.
 */
export function recall(query: string, opts: RecallOpts): RecallResult {
  const {
    cwd,
    category,
    limit = 10,
    runDir: rawRunDir,
    runId,
    _indexConfig,
    _bm25Disabled = false,
    _kgDisabled = false,
    composite,
  } = opts;

  // Derive runDir from cwd + runId when not given explicitly.
  const runDir = rawRunDir ?? (runId ? path.join(cwd, ".guild", "runs", runId) : undefined);

  // Merge test-seam overrides into DEFAULT_INDEX_BLOCK.
  const indexConfig: IndexBlock = { ...DEFAULT_INDEX_BLOCK, ..._indexConfig };

  // ── Wiki waterfall: A → B → C (first non-null wins for wiki content) ────────
  // Composite mode bypasses the sqlite-FTS cache: re-ranking by recency ×
  // importance + the gate is applied in the file-BM25 branch, which owns the
  // raw relevance score. (The sqlite cache returns pre-ranked chunks without
  // exposed scores.) Default mode is unchanged → byte-identical.
  const sqlite = composite ? null : sqliteBranch(query, cwd, indexConfig, limit, runDir, runId);
  const bm25wiki = sqlite
    ? null
    : _bm25Disabled
      ? null
      : fileBm25Branch(query, cwd, category, limit, runDir, runId, composite);
  const wikiResult: RecallResult =
    sqlite ?? bm25wiki ?? fsScanBranch(query, cwd, category, limit, runDir, runId);

  // ── KG (branch D): additive — appended to wiki results ─────────────────────
  const kgResult: RecallResult | null = _kgDisabled
    ? null
    : kgQueryBranch(query, cwd, limit, runDir, runId);

  // ── Combine wiki + KG ───────────────────────────────────────────────────────
  const wikiChunks = wikiResult.chunks;
  const kgChunks = kgResult?.chunks ?? [];
  const allChunks = [...wikiChunks, ...kgChunks];

  const hasWiki = wikiChunks.length > 0;
  const hasKg = kgChunks.length > 0;

  const source: RecallSource =
    hasWiki && hasKg ? "combined" :
    hasKg ? "kg-query" :
    wikiResult.source;

  // Directive: set when ANY wrapped chunk exists (either wiki or KG).
  const directive = wikiResult.directive ?? kgResult?.directive ?? null;

  return { source, chunks: allChunks, directive };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
//
// Used by skills/context-assemble to drive protected recall.
// Stdout: { chunks: ProtectedChunk[], directive: string | null, source }
// Exit 0 always; errors exit 1 with stderr.
//
// Flags (canonical): --query --cwd --run-id [--category --limit --run-dir]
// Test seams (env): GUILD_WIKI_THRESHOLD → wiki_file_threshold override
//                   GUILD_INDEX=off     → index.enabled=false (force file-BM25/fsScan)

if (require.main === module) {
  const argv = process.argv.slice(2);
  let query = "";
  let cwd = process.env["GUILD_CWD"] ?? process.cwd();
  let category: string | undefined;
  let limit = 10;
  let runId = "";
  let runDir = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if ((arg === "--query" || arg === "-q") && argv[i + 1]) { query = argv[++i]!; }
    else if (arg === "--cwd" && argv[i + 1]) { cwd = argv[++i]!; }
    else if (arg === "--category" && argv[i + 1]) { category = argv[++i]!; }
    else if (arg === "--limit" && argv[i + 1]) { limit = Math.max(1, parseInt(argv[++i]!, 10) || 10); }
    else if (arg === "--run-id" && argv[i + 1]) { runId = argv[++i]!; }
    else if (arg === "--run-dir" && argv[i + 1]) { runDir = argv[++i]!; }
    else if (arg.startsWith("--query=")) { query = arg.slice("--query=".length); }
    else if (arg.startsWith("--cwd=")) { cwd = arg.slice("--cwd=".length); }
    else if (arg.startsWith("--category=")) { category = arg.slice("--category=".length); }
    else if (arg.startsWith("--limit=")) { limit = Math.max(1, parseInt(arg.slice("--limit=".length), 10) || 10); }
    else if (arg.startsWith("--run-id=")) { runId = arg.slice("--run-id=".length); }
    else if (arg.startsWith("--run-dir=")) { runDir = arg.slice("--run-dir=".length); }
  }

  if (!query) {
    process.stderr.write("[recall] ERROR: --query <text> is required\n");
    process.exit(1);
  }

  // Allow test seams via env.
  const thresholdOverride = parseInt(process.env["GUILD_WIKI_THRESHOLD"] ?? "", 10);
  const indexOff = (process.env["GUILD_INDEX"] ?? "auto") === "off";
  const _indexConfig: Partial<IndexBlock> = {};
  if (indexOff) _indexConfig.enabled = false;
  if (!isNaN(thresholdOverride) && thresholdOverride >= 0) {
    _indexConfig.wiki_file_threshold = thresholdOverride;
  }

  // Resolve composite recall config from settings (shared with memory-adapter so the
  // config-driven default takes effect on BOTH the CLI and the host-adapter recall path).
  const composite = resolveCompositeConfig(cwd);

  const result = recall(query, {
    cwd,
    category,
    limit,
    ...(runId ? { runId } : {}),
    ...(runDir ? { runDir } : {}),
    ...(composite ? { composite } : {}),
    ...(_indexConfig.enabled !== undefined || _indexConfig.wiki_file_threshold !== undefined
      ? { _indexConfig }
      : {}),
  });

  process.stdout.write(JSON.stringify(result) + "\n");
}
