/**
 * scripts/lib/wiki-recall.ts
 *
 * SQLite wiki_fts read-through for the recall-before-read path.
 * Implements D-PS-2 of v2-persistence-and-sqlite-index ADR.
 *
 * Contract:
 *  - enabled:false OR below wiki_file_threshold → return null (caller uses guild-memory MCP BM25).
 *  - above threshold → lazy-build wiki_fts via ensureWikiFtsIndex, then query via FTS5 bm25().
 *  - Cache miss (index not populated/available) → return null (fall through).
 *  - On any error → return null (zero-cost regression; OFF path byte-identical to today).
 *  - All functions are synchronous and never throw.
 *
 * D-RECALL (Wave-3 security): the returned result now includes pre-wrapped chunks.
 * Pipeline per hit: FTS5 recall → injection probe (sanitizeForInjection, HK-08) →
 * quarantine flagged → trust-tier classify + wrap survivors. The model receives
 * pre-wrapped output; it never performs the wrapping or quarantine judgments.
 *
 * Trust tiers (from frontmatter + path layer):
 *   "operator"  → operator-layer PATH-ALLOWLIST ONLY (isOperatorPath) → NOT wrapped.
 *                 Frontmatter `owner: operator` grants AT MOST "trusted" (wrapped) —
 *                 never "operator" — to prevent forgery escalation.
 *   "trusted"   → confidence:high + human source_refs / owner:reviewed / owner:operator
 *                 (frontmatter) → <guild:recall trust_tier="trusted">…</guild:recall>
 *   "untrusted" → synthesized / auto-learn / unclassifiable (DEFAULT-DENY) →
 *                 <guild:recall trust_tier="untrusted">…</guild:recall>
 *
 * Quarantine: a chunk probed as "flagged" by sanitizeForInjection is excluded
 * entirely and replaced with [QUARANTINED: …] marker. A recall_quarantine
 * security event is emitted when runDir + runId opts are provided.
 *
 * Usage (from skill or hook):
 *   import { wikiRecall } from './lib/wiki-recall'
 *   const result = wikiRecall(query, cwd, config);
 *   if (!result) { /* fall through to guild-memory MCP BM25 *\/ }
 *
 * CLI:
 *   npx tsx scripts/lib/wiki-recall.ts --query "recall caching" --cwd <path> [--limit 10]
 *   Stdout: JSON { source, hits[], chunks[], directive, dbPath } or {"fallthrough":true}.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ensureWikiFtsIndex, type IndexBlock } from "./index-cache";
// D-RECALL (Wave-3): shared choke-point — all 3 recall paths (SQLite / MCP / fsScan)
// run through protectChunks.  wiki-recall.ts owns the SQLite path; the other two
// paths use protect-chunks.ts CLI.  classifyTrustTier, TrustTier, and
// RECALL_INTEGRITY_DIRECTIVE are re-exported so callers who import them from here
// continue to work without changes.
import { protectChunks, type RawRecallHit, type TrustTier } from "./recall-protect";

// Re-export for backward compatibility with callers that import from wiki-recall.
export { classifyTrustTier, RECALL_INTEGRITY_DIRECTIVE } from "./recall-protect";
export type { TrustTier } from "./recall-protect";

// ── Minimal node:sqlite type stubs ────────────────────────────────────────

interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

function openDatabase(dbPath: string): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDb;
  };
  return new DatabaseSync(dbPath);
}

// ── Public types ──────────────────────────────────────────────────────────

export interface WikiHit {
  /** Path relative to repo root (e.g. `.guild/wiki/context/project-overview.md`) */
  path: string;
  /** First H1 heading or file basename */
  title: string;
  /**
   * BM25 rank from FTS5 `bm25()` — negative float; more negative = better match.
   * Ordering: ascending (most relevant first).
   */
  rank: number;
  /** Content excerpt around matching terms (plain text, no markers) */
  snippet: string;
}

/**
 * D-RECALL: a single pre-processed recall chunk.
 * Quarantined chunks carry the `[QUARANTINED]` marker text; clean chunks carry
 * the wrapped (or unwrapped, for operator tier) content.
 */
export interface WikiChunk {
  /** Relative path of the source wiki page. */
  path: string;
  /** Classified trust tier for this chunk. */
  trust_tier: TrustTier;
  /** True when the chunk was quarantined (injection probe: flagged). */
  quarantined: boolean;
  /**
   * The chunk text as it should appear in the assembled context bundle:
   *   - quarantined: `[QUARANTINED: … — excluded]` marker
   *   - operator tier: raw content (no wrapper)
   *   - trusted/untrusted tier: `<guild:recall trust_tier="…">…</guild:recall>`
   */
  text: string;
}

export interface WikiRecallResult {
  /** Always `"sqlite-wiki_fts"` — identifies the SQLite-backed path. */
  source: "sqlite-wiki_fts";
  /**
   * Matched wiki pages, ordered by BM25 relevance (best first).
   * May be empty when the query has no matches in wiki_fts — the index IS populated;
   * the query simply returned no rows. This is different from `null` (index unavailable).
   * Backward-compat: same as pre-D-RECALL (raw FTS5 rows).
   */
  hits: WikiHit[];
  /** Absolute path to the index.sqlite file that was queried. */
  dbPath: string;
  /**
   * D-RECALL: pre-processed chunks (one per hit), in BM25 order.
   * Each is either trust-tier-wrapped (clean) or a quarantine marker (flagged).
   * Callers MUST use this for context assembly — never re-derive from `hits`.
   */
  chunks: WikiChunk[];
  /**
   * D-RECALL: integrity directive to prepend before all recall content when
   * ≥1 wrapped block is present; null when all chunks are operator-tier (no
   * wrappers). Callers include this ONCE, before the first chunk.
   */
  directive: string | null;
  /** D-RECALL: count of quarantined chunks (injection probe: flagged). */
  quarantineCount: number;
}

// (parseFrontmatter, classifyTrustTier, isOperatorPath, RECALL_INTEGRITY_DIRECTIVE,
//  and emitRecallQuarantineEvent have been extracted to ./recall-protect.ts as part
//  of D-RECALL Wave-3 single-choke-point refactor.  See recall-protect.ts for the
//  canonical implementations.)

// ── Main export ───────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 10;

/**
 * Query the SQLite wiki_fts index for `query`.
 *
 * Returns `null`  → index unavailable (below threshold, disabled, or error);
 *                   caller MUST fall through to guild-memory MCP BM25.
 *                   The OFF path is byte-identical to pre-ADR behavior.
 *
 * Returns `WikiRecallResult` → SQLite path was used; `hits` may be empty when
 *                              the query simply had no FTS5 matches.
 *
 * D-RECALL additions (Wave-3): the result includes pre-wrapped `chunks` and an
 * `integrity directive`. Each chunk is either trust-tier-wrapped (clean) or a
 * `[QUARANTINED]` marker (injection probe: flagged). Callers use `chunks` + `directive`
 * for context assembly; `hits` is preserved for backward compatibility.
 *
 * Lazy-build trigger: if `ensureWikiFtsIndex` detects the wiki file count
 * exceeds `config.wiki_file_threshold`, it populates `wiki_fts` before the
 * query runs (D-PS-1 measured-slowness gate). A SHA-256 fingerprint prevents
 * redundant re-population (cache-hit path).
 */
export function wikiRecall(
  query: string,
  cwd: string,
  config: IndexBlock,
  opts: {
    limit?: number;
    /**
     * D-RECALL: run-dir + run-id for security event emission when a chunk is
     * quarantined. If absent, quarantine proceeds but no on-disk event is written.
     */
    runDir?: string;
    runId?: string;
  } = {},
): WikiRecallResult | null {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  // Normalize early — return null immediately on empty/blank queries rather than
  // spending a DB round-trip.
  const safeQuery = normalizeFtsQuery(query);
  if (!safeQuery) return null;

  // ensureWikiFtsIndex encodes the full D-PS-1 gate:
  //   config.enabled=false           → null (disabled)
  //   file count ≤ wiki_file_threshold → null (below threshold)
  //   file count > threshold          → lazy-build; returns {status, dbPath}
  // Null from ensureWikiFtsIndex = "cache miss" → fall through.
  const ensureResult = ensureWikiFtsIndex(cwd, config);
  if (!ensureResult || !ensureResult.dbPath) {
    return null; // OFF path — caller uses guild-memory BM25 (unchanged behavior)
  }

  const { dbPath } = ensureResult;

  let db: SqliteDb | undefined;
  try {
    db = openDatabase(dbPath);

    let rows: Array<Record<string, unknown>>;
    try {
      rows = db
        .prepare(
          `SELECT path,
                  title,
                  bm25(wiki_fts)                              AS rank,
                  snippet(wiki_fts, 2, '', '', '...', 20)    AS snippet
           FROM   wiki_fts
           WHERE  wiki_fts MATCH ?
           ORDER  BY rank   -- bm25() is negative; ASC = most relevant first
           LIMIT  ?`,
        )
        .all(safeQuery, limit);
    } catch {
      // FTS5 unavailable or MATCH syntax error — fall through to guild-memory.
      db.close();
      return null;
    }

    db.close();

    // ── D-RECALL: build RawRecallHit[] → run shared protectChunks pipeline ──────
    //
    // Read file content for each FTS5 row; fall back to the index snippet when
    // the file is unreadable (deleted after indexing).  Both paths produce a
    // RawRecallHit and go through the same probe→quarantine→classify→wrap
    // pipeline in recall-protect.ts — the probe runs on ALL paths.
    const rawHits: RawRecallHit[] = [];
    for (const r of rows) {
      const relPath = typeof r["path"] === "string" ? r["path"] : "";
      const absPath = path.join(cwd, relPath);
      let content: string;
      try {
        content = fs.readFileSync(absPath, "utf8");
      } catch {
        // File unreadable — use the FTS5 snippet as the content.
        // protectChunks will probe the snippet (D-RECALL: probe runs on ALL paths).
        content = typeof r["snippet"] === "string" ? r["snippet"] : "";
      }
      rawHits.push({ source_path: relPath, content });
    }

    // Run the shared choke-point.  Pass callerTool:"wikiRecall" so quarantine
    // security events are stamped correctly for the SQLite path.
    const { chunks: protectedChunks, directive } = protectChunks(rawHits, {
      runDir: opts.runDir,
      runId: opts.runId,
      callerTool: "wikiRecall",
    });

    // Map ProtectedChunk → WikiChunk to preserve the existing public interface
    // (field names "path" and "text" used by tests + external callers).
    const chunks: WikiChunk[] = protectedChunks.map((pc) => ({
      path: pc.source_path,
      trust_tier: pc.trust_tier,
      quarantined: pc.quarantined,
      text: pc.rendered,
    }));
    const quarantineCount = protectedChunks.filter((pc) => pc.quarantined).length;

    return {
      source: "sqlite-wiki_fts",
      dbPath,
      hits: rows.map((r) => ({
        path: typeof r["path"] === "string" ? r["path"] : "",
        title: typeof r["title"] === "string" ? r["title"] : "",
        rank: typeof r["rank"] === "number" ? r["rank"] : 0,
        snippet: typeof r["snippet"] === "string" ? r["snippet"] : "",
      })),
      chunks,
      directive,
      quarantineCount,
    };
  } catch {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    return null; // any error → fall through
  }
}

/**
 * Normalize a raw query string for FTS5 MATCH syntax.
 *
 * Strips FTS5 special characters (`"`, `*`, `(`, `)`, `:`, `^`) so an
 * arbitrary task description can be passed safely. Remaining whitespace-
 * separated tokens are joined with a space, which FTS5 interprets as AND
 * (all tokens must appear).
 *
 * Returns an empty string when the input has no usable tokens — the caller
 * should treat this as a skip (return null).
 */
export function normalizeFtsQuery(query: string): string {
  return query
    .replace(/['"()*:^]/g, " ") // strip FTS5 operator / special chars
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1) // drop single-char tokens (FTS5 porter minimum)
    .join(" ");
}

// ── CLI entrypoint ────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);
  let query = "";
  let cwd = process.env["GUILD_CWD"] ?? process.cwd();
  let limit = DEFAULT_LIMIT;
  let runId = "";
  let runDir = "";

  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--query" || argv[i] === "-q") && argv[i + 1]) query = argv[++i]!;
    else if (argv[i] === "--cwd" && argv[i + 1]) cwd = argv[++i]!;
    else if (argv[i] === "--limit" && argv[i + 1]) limit = Math.max(1, parseInt(argv[++i]!, 10) || DEFAULT_LIMIT);
    else if (argv[i] === "--run-id" && argv[i + 1]) runId = argv[++i]!;
    else if (argv[i] === "--run-dir" && argv[i + 1]) runDir = argv[++i]!;
    else if (argv[i]?.startsWith("--query=")) query = argv[i]!.slice("--query=".length);
    else if (argv[i]?.startsWith("--cwd=")) cwd = argv[i]!.slice("--cwd=".length);
    else if (argv[i]?.startsWith("--limit=")) limit = Math.max(1, parseInt(argv[i]!.slice("--limit=".length), 10) || DEFAULT_LIMIT);
    else if (argv[i]?.startsWith("--run-id=")) runId = argv[i]!.slice("--run-id=".length);
    else if (argv[i]?.startsWith("--run-dir=")) runDir = argv[i]!.slice("--run-dir=".length);
  }

  if (!query) {
    process.stderr.write("[wiki-recall] ERROR: --query <text> is required\n");
    process.exit(1);
  }

  // Derive runDir from cwd when only --run-id is given.
  if (runId && !runDir) {
    runDir = path.join(cwd, ".guild", "runs", runId);
  }

  // Read config from .guild/settings.json (or built-in defaults).
  // We import the IndexBlock defaults directly rather than shelling out to
  // read-guild-config.ts to keep this module zero-shell-dependency at runtime.
  const { DEFAULT_INDEX_BLOCK } = require("./index-cache") as {
    DEFAULT_INDEX_BLOCK: IndexBlock;
  };

  // Allow the caller to signal index=off via env for the OFF path test.
  // Test seam: GUILD_WIKI_THRESHOLD overrides wiki_file_threshold for CLI tests
  // that cannot pass a config object directly.
  const indexOff = (process.env["GUILD_INDEX"] ?? "auto") === "off";
  const thresholdOverride = parseInt(process.env["GUILD_WIKI_THRESHOLD"] ?? "", 10);
  const baseConfig: IndexBlock = indexOff
    ? { ...DEFAULT_INDEX_BLOCK, enabled: false }
    : DEFAULT_INDEX_BLOCK;
  const config: IndexBlock =
    !isNaN(thresholdOverride) && thresholdOverride >= 0
      ? { ...baseConfig, wiki_file_threshold: thresholdOverride }
      : baseConfig;

  const result = wikiRecall(query, cwd, config, {
    limit,
    ...(runDir && runId ? { runDir, runId } : {}),
  });

  if (!result) {
    // Fall-through — caller should use guild-memory MCP BM25.
    process.stdout.write(JSON.stringify({ fallthrough: true }) + "\n");
    return;
  }

  // D-RECALL (Wave-3 security): emit ONLY the protected `chunks[]` payload.
  // Raw `hits[].snippet` must NOT appear in CLI stdout — a chunk that passed the
  // injection probe and wrapping is safe; the raw FTS5 snippet is not (it bypasses
  // both the quarantine and the trust-tier wrap). The consumer (context-assemble)
  // reads `chunks[]`; the library `WikiRecallResult` retains `hits` for
  // backward-compat of programmatic callers. The CLI contract is protected-form only.
  const safeResult: Omit<WikiRecallResult, "hits"> = {
    source: result.source,
    chunks: result.chunks,
    directive: result.directive,
    dbPath: result.dbPath,
    quarantineCount: result.quarantineCount,
  };
  process.stdout.write(JSON.stringify(safeResult, null, 2) + "\n");
}

if (typeof module !== "undefined" && require.main === module) {
  main();
}
