/**
 * src/modules/context/workflows/recall.ts
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
import * as crypto from "node:crypto";

import { DEFAULT_INDEX_BLOCK, type IndexBlock } from "../../state";
import { wikiRecall } from "./wiki-recall";
import { fsScan } from "./fs-scanner";
import { protectChunks, type ProtectedChunk } from "./recall-protect";
import { tokenize, bm25Score } from "../../knowledge";
import { rankKgNodes } from "../../knowledge";
import type { GraphNode, GraphEdge } from "../../understanding";
import type { KnowledgeLinksDoc } from "../../knowledge";
import {
  ingestImportanceScore,
  resolveRecallImportance,
} from "../../knowledge";
// R-TRACE (Wave 6): additive trace emit — NEVER changes return value
import { emitTraceEvent } from "../../telemetry";
import { makeRecallEvent, makeRecallDecisionEvent } from "../../telemetry";

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
  /**
   * G10: top raw relevance score of the winning branch (branch-native scale).
   * Informational — surfaced for recall-quality telemetry / threshold tuning.
   * Undefined when the branch does not expose a numeric score (sqlite/fs-scan).
   */
  topScore?: number;
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
  /**
   * G10: the `recallScoreThreshold` in effect (read-skip threshold). Drives the
   * recall-decision telemetry's `read_skip_fired` (top_score >= threshold). The
   * pure path defaults to 0.4 (config default); the CLI resolves it from
   * `models.recallScoreThreshold`.
   */
  recallScoreThreshold?: number;
  /**
   * G10: downstream lane outcome hook for the recall-decision event. Defaults to
   * "unknown" — a caller that knows whether the recall helped its lane can pass
   * "success"/"failure" so recall-stats can compute precision.
   */
  laneOutcome?: "success" | "failure" | "unknown";
}

/** G10: default read-skip threshold (mirrors config-defaults models.recallScoreThreshold). */
export const DEFAULT_RECALL_SCORE_THRESHOLD = 0.4;

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
    const { resolveSettings } = require("../../config") as typeof import("../../config");
    const models = (resolveSettings({ cwd }).config as {
      models?: { compositeRecall?: boolean; importanceGate?: number };
    }).models;
    if (models?.compositeRecall) {
      return { importanceGate: models.importanceGate ?? 3, halfLifeDays: DEFAULT_RECALL_HALF_LIFE_DAYS };
    }
  } catch { /* settings unreadable → BM25-only default */ }
  return undefined;
}

/**
 * G10: resolve `models.recallScoreThreshold` from settings for a cwd, falling
 * back to DEFAULT_RECALL_SCORE_THRESHOLD when unset/unreadable. Kept out of the
 * pure recall() path (which takes the value via opts) so the library never loads
 * the settings resolver.
 */
export function resolveRecallScoreThreshold(cwd: string): number {
  try {
    // Lazy require so the pure library path never loads the settings resolver.
    const { resolveSettings } = require("../../config") as typeof import("../../config");
    const models = (resolveSettings({ cwd }).config as {
      models?: { recallScoreThreshold?: number };
    }).models;
    if (typeof models?.recallScoreThreshold === "number" && models.recallScoreThreshold >= 0) {
      return models.recallScoreThreshold;
    }
  } catch { /* settings unreadable → default */ }
  return DEFAULT_RECALL_SCORE_THRESHOLD;
}

/**
 * G10: stable, privacy-preserving query key — sha256[:16] of the full query.
 * The raw query is never logged; recall-stats groups by this hash.
 */
export function hashQuery(query: string): string {
  return crypto.createHash("sha256").update(query).digest("hex").slice(0, 16);
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
// G15: the KG branch now ranks via the SHARED `rankKgNodes` pipeline from
// src/modules/knowledge/workflows/graph-scoring.ts — the SAME ranking kg-query.ts
// uses (scoreNode importance+confidence + topic-proximity, then score-desc/id-asc).
// This closes the bundle-vs-CLI scoring drift (goals.md §2.2): an agent now gets
// identical KG recall ordering through the context bundle and the CLI. Previously
// this branch ranked on flat termMatchScore + id tiebreak, silently worse.

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
  // G10: top raw BM25 score (pre-rank) — the winning branch's relevance signal.
  const topScore = scores.length ? Math.max(0, ...scores) : 0;

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
  return { source: "file-bm25", chunks, directive, topScore };
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

// ── Branch D: kg-query (knowledge-recall.json projection) ────────────────────
//
// METRIC 6 (DECISION=B): reads .guild/indexes/knowledge-recall.json — the
// recall-OPTIMISED projection written by understand/write-knowledge-links.ts.
// G15: this branch ranks the projection nodes via the shared rankKgNodes pipeline
// (importance + confidence + topic-proximity) — identical to the kg-query CLI.
//
// Falls back gracefully when the projection file is absent: returns null (same
// behaviour as the previous absent-graph path). Never throws.
//
// KG nodes are ALWAYS classified untrusted (DEFAULT-DENY). The node "content"
// is a deterministic markdown summary — not a raw file, so no operator-path
// allowlist match is possible. The probe still runs on each node (injection guard).
//
// This branch is ADDITIVE — it appends to whatever the wiki branch returned.
// Returns null when the projection file is absent or no nodes match the query.

function kgQueryBranch(
  query: string,
  cwd: string,
  limit: number,
  runDir?: string,
  runId?: string,
): RecallResult | null {
  // METRIC 6: read the recall projection, not the raw knowledge-graph
  const projPath = path.join(cwd, ".guild", "indexes", "knowledge-recall.json");
  if (!fs.existsSync(projPath)) return null;

  let proj: KnowledgeLinksDoc | null = null;
  try {
    proj = JSON.parse(fs.readFileSync(projPath, "utf8")) as KnowledgeLinksDoc;
  } catch {
    return null;
  }

  if (!Array.isArray(proj?.nodes) || proj.nodes.length === 0) return null;

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  // G15: rank via the shared pipeline (importance + confidence + topic-proximity),
  // identical to kg-query.ts. The projection carries nodes AND subtopic_of edges,
  // so proximity applies here exactly as it does in the CLI. SQLite-optional: this
  // reads the knowledge-recall.json projection directly and never requires the cache.
  const ranked = rankKgNodes(
    proj.nodes as unknown as GraphNode[],
    (proj.edges ?? []) as unknown as GraphEdge[],
    terms,
    limit,
  );

  if (ranked.length === 0) return null;

  // G10: top rankKgNodes score — the KG branch's relevance signal.
  const topScore = ranked[0]?.s ?? 0;

  // Build a deterministic markdown summary for each node.
  // source_path uses the projection file path + node id so classifyTrustTier
  // can identify the origin without hitting the operator-path allowlist.
  const rawHits = ranked.map(({ n }) => {
    const sourceRefs = (n.source_refs ?? []).slice(0, 2).join(", ");
    const content =
      `# ${n.name} (${n.type})\n\n` +
      `confidence: ${n.confidence}\n` +
      (sourceRefs ? `source_refs: ${sourceRefs}\n` : "");
    return {
      source_path: `.guild/indexes/knowledge-recall.json#${n.id}`,
      content,
    };
  });

  const { chunks, directive } = protectChunks(rawHits, {
    runDir,
    runId,
    callerTool: "recall:kg-query",
  });
  return { source: "kg-query", chunks, directive, topScore };
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
    recallScoreThreshold = DEFAULT_RECALL_SCORE_THRESHOLD,
    laneOutcome = "unknown",
  } = opts;

  // R-TRACE: wall-clock start (additive timing — does not affect result)
  const _traceStart = Date.now();

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

  // G10 parity (SQLite-off==on): only branches that expose a COMPARABLE numeric
  // score may drive the read-skip decision. The SQLite (A) and fs-scan (C) wiki
  // branches expose none (sqlite's bm25() rank is a different, negative scale —
  // not comparable to file-BM25's positive score), so they are UNSCORED. Treating
  // an unscored branch's missing score as 0 is exactly the bug that made the same
  // recall report a different `read_skip_fired` with index:on (sqlite, →0) vs
  // index:off (file-bm25, real score). We instead mark the event `scored:false`
  // and exclude it downstream. A contribution counts only when it both returned
  // chunks AND exposed a numeric topScore.
  const wikiScored = hasWiki && wikiResult.topScore !== undefined;
  const kgScored = hasKg && kgResult?.topScore !== undefined;
  const scored = wikiScored || kgScored;

  // top relevance score across the SCORED contributing branches (branch-native
  // scale). 0 is a placeholder when unscored — never threshold-compared then.
  const scoredValues = [
    ...(wikiScored ? [wikiResult.topScore as number] : []),
    ...(kgScored ? [kgResult!.topScore as number] : []),
  ];
  const topScore = scoredValues.length ? Math.max(...scoredValues) : 0;

  const result: RecallResult = { source, chunks: allChunks, directive, topScore };

  // Branch label shared by both trace emits below.
  const _traceBranch = allChunks.length === 0
    ? "empty" as const
    : source === "combined" ? "combined" as const
    : source as "sqlite" | "file-bm25" | "fs-scan" | "kg-query";

  // R-TRACE emit — additive, try/catch, never changes result (guild.trace.recall.v1)
  // emit-point: recall.ts, after result is fully assembled
  try {
    const _traceDurationMs = Date.now() - _traceStart;
    // ProtectedChunk exposes an explicit `quarantined` boolean — use it directly.
    // (The prior `c.content.includes("[QUARANTINED]")` referenced a property that does not
    // exist on ProtectedChunk — TS2339; the rendered text field is `rendered`, not `content`.)
    const _hadQuarantine = allChunks.some((c) => c.quarantined === true);
    emitTraceEvent(
      makeRecallEvent({
        ts: new Date().toISOString(),
        run_id: runId ?? "",
        lane_id: process.env["GUILD_LANE_ID"] ?? "",
        query: query.slice(0, 200), // truncate long queries in the trace
        branch: _traceBranch,
        chunk_count: allChunks.length,
        duration_ms: _traceDurationMs,
        had_quarantine: _hadQuarantine,
        cwd_redacted: cwd.replace(/\/Users\/[^/]+/, "<operator-home>"),
      }),
      runDir ?? null,
    );
  } catch {
    // Trace must never affect recall result — swallow all errors silently
  }

  // G10 emit — recall-quality decision (guild.trace.recall_decision.v1).
  // Additive + safe: no runDir → emitTraceEvent no-ops; never throws.
  // read_skip_fired = SCORED branch produced ≥1 chunk AND its (comparable) top
  // score cleared the threshold. An unscored branch (sqlite/fs-scan) can NEVER
  // fire a skip — its placeholder 0 is not threshold-comparable (parity fix).
  try {
    const readSkipFired = scored && allChunks.length > 0 && topScore >= recallScoreThreshold;
    emitTraceEvent(
      makeRecallDecisionEvent({
        ts: new Date().toISOString(),
        run_id: runId ?? "",
        lane_id: process.env["GUILD_LANE_ID"] ?? "",
        query_hash: hashQuery(query),
        query_preview: query.slice(0, 60),
        branch: _traceBranch,
        top_score: topScore,
        threshold: recallScoreThreshold,
        read_skip_fired: readSkipFired,
        chunk_count: allChunks.length,
        scored,
        lane_outcome: laneOutcome,
      }),
      runDir ?? null,
    );
  } catch {
    // Telemetry must never affect recall result — swallow all errors silently
  }

  return result;
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

export function runRecallCli(): void {
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

  // G10: resolve the read-skip threshold from settings so recall-decision telemetry
  // records the threshold actually in effect for this repo.
  const recallScoreThreshold = resolveRecallScoreThreshold(cwd);

  const result = recall(query, {
    cwd,
    category,
    limit,
    recallScoreThreshold,
    ...(runId ? { runId } : {}),
    ...(runDir ? { runDir } : {}),
    ...(composite ? { composite } : {}),
    ...(_indexConfig.enabled !== undefined || _indexConfig.wiki_file_threshold !== undefined
      ? { _indexConfig }
      : {}),
  });

  process.stdout.write(JSON.stringify(result) + "\n");
}

if (typeof module !== "undefined" && require.main === module) {
  runRecallCli();
}
