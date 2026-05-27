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
 * Usage (from skill or hook):
 *   import { wikiRecall } from './lib/wiki-recall'
 *   const result = wikiRecall(query, cwd, config);
 *   if (!result) { /* fall through to guild-memory MCP BM25 *\/ }
 *
 * CLI:
 *   npx tsx scripts/lib/wiki-recall.ts --query "recall caching" --cwd <path> [--limit 10]
 *   Stdout: JSON { source, hits[], dbPath } or {"fallthrough":true} if guild-memory path needed.
 */

import { ensureWikiFtsIndex, type IndexBlock } from "./index-cache";

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

export interface WikiRecallResult {
  /** Always `"sqlite-wiki_fts"` — identifies the SQLite-backed path. */
  source: "sqlite-wiki_fts";
  /**
   * Matched wiki pages, ordered by BM25 relevance (best first).
   * May be empty when the query has no matches in wiki_fts — the index IS populated;
   * the query simply returned no rows. This is different from `null` (index unavailable).
   */
  hits: WikiHit[];
  /** Absolute path to the index.sqlite file that was queried. */
  dbPath: string;
}

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
 * Lazy-build trigger: if `ensureWikiFtsIndex` detects the wiki file count
 * exceeds `config.wiki_file_threshold`, it populates `wiki_fts` before the
 * query runs (D-PS-1 measured-slowness gate). A SHA-256 fingerprint prevents
 * redundant re-population (cache-hit path).
 */
export function wikiRecall(
  query: string,
  cwd: string,
  config: IndexBlock,
  opts: { limit?: number } = {},
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

    return {
      source: "sqlite-wiki_fts",
      dbPath,
      hits: rows.map((r) => ({
        path: typeof r["path"] === "string" ? r["path"] : "",
        title: typeof r["title"] === "string" ? r["title"] : "",
        rank: typeof r["rank"] === "number" ? r["rank"] : 0,
        snippet: typeof r["snippet"] === "string" ? r["snippet"] : "",
      })),
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

  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--query" || argv[i] === "-q") && argv[i + 1]) query = argv[++i]!;
    else if (argv[i] === "--cwd" && argv[i + 1]) cwd = argv[++i]!;
    else if (argv[i] === "--limit" && argv[i + 1]) limit = Math.max(1, parseInt(argv[++i]!, 10) || DEFAULT_LIMIT);
    else if (argv[i]?.startsWith("--query=")) query = argv[i]!.slice("--query=".length);
    else if (argv[i]?.startsWith("--cwd=")) cwd = argv[i]!.slice("--cwd=".length);
    else if (argv[i]?.startsWith("--limit=")) limit = Math.max(1, parseInt(argv[i]!.slice("--limit=".length), 10) || DEFAULT_LIMIT);
  }

  if (!query) {
    process.stderr.write("[wiki-recall] ERROR: --query <text> is required\n");
    process.exit(1);
  }

  // Read config from .guild/settings.json (or built-in defaults).
  // We import the IndexBlock defaults directly rather than shelling out to
  // read-guild-config.ts to keep this module zero-shell-dependency at runtime.
  const { DEFAULT_INDEX_BLOCK } = require("./index-cache") as {
    DEFAULT_INDEX_BLOCK: IndexBlock;
  };

  // Allow the caller to signal index=off via env for the OFF path test.
  const indexOff = (process.env["GUILD_INDEX"] ?? "auto") === "off";
  const config: IndexBlock = indexOff
    ? { ...DEFAULT_INDEX_BLOCK, enabled: false }
    : DEFAULT_INDEX_BLOCK;

  const result = wikiRecall(query, cwd, config, { limit });

  if (!result) {
    // Fall-through — caller should use guild-memory MCP BM25.
    process.stdout.write(JSON.stringify({ fallthrough: true }) + "\n");
    return;
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (typeof module !== "undefined" && require.main === module) {
  main();
}
