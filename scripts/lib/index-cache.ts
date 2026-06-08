/**
 * scripts/lib/index-cache.ts
 *
 * Lazy SQLite index cache — populates .guild/index.sqlite tables ONLY when the
 * defaults.index.* threshold for that source is crossed.
 *
 * Contract (D-PS-1 — v2-persistence-and-sqlite-index):
 *  - enabled:false   → return null immediately; index.sqlite is NEVER written.
 *  - below threshold → return null; index.sqlite is NOT touched.
 *  - above threshold → open/migrate index.sqlite; check SHA-256 fingerprint:
 *      cache-hit  → table already current; return { status:'cache-hit', dbPath }
 *      stale/new  → rebuild that table; return { status:'populated', dbPath }
 *  - on any error    → return null (caller falls back to direct-parse).
 *
 * All functions are synchronous and never throw.
 *
 * Usage:
 *   import { ensureKgIndex, ensureKlIndex,
 *            ensureRunProvenanceIndex, ensureWikiFtsIndex,
 *            ensureFederationWikiCache } from './lib/index-cache'
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { runMigrations } from "../index-migrate";

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

// ── IndexBlock (mirrors read-guild-config.ts; defined here to avoid
//    importing the full script at runtime). ────────────────────────────────

export interface IndexBlock {
  enabled: boolean;
  kg_node_threshold: number;
  kg_size_threshold_mb: number;
  links_edge_threshold: number;
  runs_threshold: number;
  wiki_file_threshold: number;
}

export const DEFAULT_INDEX_BLOCK: IndexBlock = {
  enabled: true,
  kg_node_threshold: 2000,
  kg_size_threshold_mb: 1,
  links_edge_threshold: 2000,
  runs_threshold: 20,
  wiki_file_threshold: 500,
};

// ── Result types ──────────────────────────────────────────────────────────

export type CacheStatus = "disabled" | "below-threshold" | "cache-hit" | "populated" | "error";

export interface CacheResult {
  status: CacheStatus;
  /** Absolute path to index.sqlite (only on cache-hit / populated). */
  dbPath?: string;
  message?: string;
}

// ── TE-14 federation_wiki_cache types ─────────────────────────────────────

/**
 * One row from the federation_wiki_cache table.
 * Mirrors the table schema: (sub_guild_root, path, title, snippet).
 * `sub_guild_root` is omitted from hits — callers already know it.
 */
export interface FederationWikiHit {
  path: string;
  title: string | null;
  snippet: string | null;
}

/**
 * Return value from ensureFederationWikiCache().
 * Extends CacheResult with the cached hits so callers do not need a
 * separate DB query — the result carries both status AND data.
 */
export interface FederationWikiCacheResult {
  status: "disabled" | "cache-hit" | "populated" | "error";
  dbPath?: string;
  message?: string;
  /** The hits for this sub-guild (present on cache-hit + populated). */
  hits?: FederationWikiHit[];
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the canonical MAIN repo root worktree-safely.
 * Mirrors understand/lib/paths.ts:resolveMainRepoRoot — duplicated here
 * to avoid cross-directory coupling at runtime.
 */
export function resolveMainRepoRoot(cwd: string): string {
  try {
    const raw = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    const root = path.dirname(abs);
    if (fs.existsSync(root)) return root;
  } catch {
    /* not a git repo or git unavailable */
  }
  return path.resolve(cwd);
}

/** Compute SHA-256 of a single file's contents. */
function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/** Compute SHA-256 over a sorted list of file paths + their contents. */
function sha256Files(filePaths: string[]): string {
  const hash = createHash("sha256");
  for (const p of [...filePaths].sort()) {
    hash.update(p + "\n");
    hash.update(fs.readFileSync(p));
  }
  return hash.digest("hex");
}

/** Read the fingerprint stored in _fingerprints for tableName. Returns null if absent. */
function getFingerprint(db: SqliteDb, tableName: string): string | null {
  try {
    const row = db
      .prepare("SELECT sha256 FROM _fingerprints WHERE table_name = ?")
      .get(tableName) as { sha256: string } | undefined;
    return row?.sha256 ?? null;
  } catch {
    return null;
  }
}

/** Write or update the fingerprint for tableName. */
function setFingerprint(
  db: SqliteDb,
  tableName: string,
  sourcePath: string,
  sha256: string,
): void {
  db.prepare(
    `INSERT INTO _fingerprints (table_name, source_path, sha256, populated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(table_name) DO UPDATE SET
       source_path  = excluded.source_path,
       sha256       = excluded.sha256,
       populated_at = excluded.populated_at`,
  ).run(tableName, sourcePath, sha256, new Date().toISOString());
}

/**
 * Open the index.sqlite, running migrations if needed.
 * Returns null on any error (caller falls back to direct-parse).
 */
function openIndex(dbPath: string): SqliteDb | null {
  const migResult = runMigrations(dbPath);
  if (!migResult.ok) return null;
  try {
    return openDatabase(dbPath);
  } catch {
    return null;
  }
}

/** Collect .md file paths under a directory (recursive). */
function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(d: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(".md")) results.push(full);
    }
  }
  walk(dir);
  return results;
}

/** Extract the first `# Title` line from markdown, else the basename. */
function extractTitle(content: string, filePath: string): string {
  const m = /^#\s+(.+)$/m.exec(content);
  return m ? m[1].trim() : path.basename(filePath, ".md");
}

/** Collect provenance.json paths under runs/ (one per run dir, non-recursive). */
function collectProvenanceFiles(runsDir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pFile = path.join(runsDir, e.name, "provenance.json");
    if (fs.existsSync(pFile)) results.push(pFile);
  }
  return results;
}

// ── Per-table ensure functions ─────────────────────────────────────────────

/**
 * Ensure kg_nodes / kg_edges are populated.
 * Source: .guild/indexes/knowledge-graph.json
 * Thresholds: node count > kg_node_threshold OR file size > kg_size_threshold_mb
 *
 * Returns null  → direct-parse
 * Returns CacheResult { status: 'cache-hit'|'populated', dbPath } → use sqlite
 */
export function ensureKgIndex(cwd: string, config: IndexBlock): CacheResult | null {
  if (!config.enabled) return null;

  try {
    const repoRoot = resolveMainRepoRoot(cwd);
    const kgPath = path.join(repoRoot, ".guild", "indexes", "knowledge-graph.json");
    const dbPath = path.join(repoRoot, ".guild", "index.sqlite");

    if (!fs.existsSync(kgPath)) return null;

    // Threshold check
    const stat = fs.statSync(kgPath);
    const sizeMb = stat.size / (1024 * 1024);
    let nodeCount = 0;
    try {
      const raw = JSON.parse(fs.readFileSync(kgPath, "utf8")) as {
        nodes?: unknown[];
      };
      nodeCount = raw.nodes?.length ?? 0;
    } catch {
      return null;
    }

    const aboveThreshold =
      nodeCount > config.kg_node_threshold || sizeMb > config.kg_size_threshold_mb;
    if (!aboveThreshold) return null;

    const currentHash = sha256File(kgPath);
    const db = openIndex(dbPath);
    if (!db) return null;

    const stored = getFingerprint(db, "kg_nodes");
    if (stored === currentHash) {
      db.close();
      return { status: "cache-hit", dbPath };
    }

    // Rebuild
    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec("DELETE FROM kg_nodes");
      db.exec("DELETE FROM kg_edges");

      const graph = JSON.parse(fs.readFileSync(kgPath, "utf8")) as {
        nodes?: Array<{
          id: string;
          type?: string;
          name?: string;
          source_refs?: string[];
          confidence?: string;
          [k: string]: unknown;
        }>;
        edges?: Array<{
          source: string;
          target: string;
          type?: string;
          direction?: string;
          weight?: number;
          [k: string]: unknown;
        }>;
        layers?: Array<{ id: string; nodeIds?: string[] }>;
      };

      const insNode = db.prepare(
        "INSERT OR REPLACE INTO kg_nodes (id, type, name, source_refs, confidence, layer, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      const insEdge = db.prepare(
        "INSERT INTO kg_edges (source, target, type, direction, weight, data) VALUES (?, ?, ?, ?, ?, ?)",
      );

      // Build node→layer map
      const nodeLayer: Record<string, string> = {};
      for (const layer of graph.layers ?? []) {
        for (const nid of layer.nodeIds ?? []) {
          nodeLayer[nid] = layer.id;
        }
      }

      for (const node of graph.nodes ?? []) {
        const { id, type, name, source_refs, confidence, ...rest } = node;
        insNode.run(
          id,
          type ?? null,
          name ?? null,
          JSON.stringify(source_refs ?? []),
          confidence ?? null,
          nodeLayer[id] ?? null,
          JSON.stringify(rest),
        );
      }

      for (const edge of graph.edges ?? []) {
        const { source, target, type, direction, weight, ...rest } = edge;
        insEdge.run(
          source,
          target,
          type ?? null,
          direction ?? null,
          weight ?? null,
          JSON.stringify(rest),
        );
      }

      setFingerprint(db, "kg_nodes", kgPath, currentHash);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      db.close();
      return { status: "error", message: `kg rebuild failed: ${(err as Error).message}` };
    }

    db.close();
    return { status: "populated", dbPath };
  } catch (err) {
    return { status: "error", message: `ensureKgIndex error: ${(err as Error).message}` };
  }
}

/**
 * Ensure kl_edges is populated.
 * Source: .guild/indexes/knowledge-links.json
 * Threshold: links.length > links_edge_threshold
 */
export function ensureKlIndex(cwd: string, config: IndexBlock): CacheResult | null {
  if (!config.enabled) return null;

  try {
    const repoRoot = resolveMainRepoRoot(cwd);
    const klPath = path.join(repoRoot, ".guild", "indexes", "knowledge-links.json");
    const dbPath = path.join(repoRoot, ".guild", "index.sqlite");

    if (!fs.existsSync(klPath)) return null;

    let edgeCount = 0;
    try {
      const raw = JSON.parse(fs.readFileSync(klPath, "utf8")) as {
        links?: unknown[];
      };
      edgeCount = raw.links?.length ?? 0;
    } catch {
      return null;
    }

    if (edgeCount <= config.links_edge_threshold) return null;

    const currentHash = sha256File(klPath);
    const db = openIndex(dbPath);
    if (!db) return null;

    const stored = getFingerprint(db, "kl_edges");
    if (stored === currentHash) {
      db.close();
      return { status: "cache-hit", dbPath };
    }

    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec("DELETE FROM kl_edges");

      const doc = JSON.parse(fs.readFileSync(klPath, "utf8")) as {
        links?: Array<{
          from: string;
          to: string;
          type?: string;
          run_id?: string;
          [k: string]: unknown;
        }>;
      };

      const ins = db.prepare(
        "INSERT INTO kl_edges (from_node, to_node, type, run_id, data) VALUES (?, ?, ?, ?, ?)",
      );

      for (const link of doc.links ?? []) {
        const { from, to, type, run_id, ...rest } = link;
        ins.run(from, to, type ?? null, run_id ?? null, JSON.stringify(rest));
      }

      setFingerprint(db, "kl_edges", klPath, currentHash);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      db.close();
      return { status: "error", message: `kl_edges rebuild failed: ${(err as Error).message}` };
    }

    db.close();
    return { status: "populated", dbPath };
  } catch (err) {
    return { status: "error", message: `ensureKlIndex error: ${(err as Error).message}` };
  }
}

/**
 * Ensure run_provenance is populated.
 * Source: .guild/runs/{id}/provenance.json files (one per run directory)
 * Threshold: file count > runs_threshold
 */
export function ensureRunProvenanceIndex(cwd: string, config: IndexBlock): CacheResult | null {
  if (!config.enabled) return null;

  try {
    const repoRoot = resolveMainRepoRoot(cwd);
    const runsDir = path.join(repoRoot, ".guild", "runs");
    const dbPath = path.join(repoRoot, ".guild", "index.sqlite");

    const provFiles = collectProvenanceFiles(runsDir);
    if (provFiles.length <= config.runs_threshold) return null;

    const currentHash = sha256Files(provFiles);
    const db = openIndex(dbPath);
    if (!db) return null;

    const stored = getFingerprint(db, "run_provenance");
    if (stored === currentHash) {
      db.close();
      return { status: "cache-hit", dbPath };
    }

    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec("DELETE FROM run_provenance");

      const ins = db.prepare(
        "INSERT OR REPLACE INTO run_provenance (run_id, ts, data) VALUES (?, ?, ?)",
      );

      for (const pFile of provFiles) {
        try {
          const prov = JSON.parse(fs.readFileSync(pFile, "utf8")) as {
            run_id?: string;
            ts?: string;
            [k: string]: unknown;
          };
          const runId = prov.run_id ?? path.basename(path.dirname(pFile));
          ins.run(runId, prov.ts ?? null, JSON.stringify(prov));
        } catch {
          /* skip unreadable provenance files */
        }
      }

      setFingerprint(db, "run_provenance", runsDir, currentHash);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      db.close();
      return {
        status: "error",
        message: `run_provenance rebuild failed: ${(err as Error).message}`,
      };
    }

    db.close();
    return { status: "populated", dbPath };
  } catch (err) {
    return {
      status: "error",
      message: `ensureRunProvenanceIndex error: ${(err as Error).message}`,
    };
  }
}

/**
 * Ensure wiki_fts is populated.
 * Source: .guild/wiki/** (*.md files)
 * Threshold: file count > wiki_file_threshold
 */
export function ensureWikiFtsIndex(cwd: string, config: IndexBlock): CacheResult | null {
  if (!config.enabled) return null;

  try {
    const repoRoot = resolveMainRepoRoot(cwd);
    const wikiDir = path.join(repoRoot, ".guild", "wiki");
    const dbPath = path.join(repoRoot, ".guild", "index.sqlite");

    const mdFiles = collectMarkdownFiles(wikiDir);
    if (mdFiles.length <= config.wiki_file_threshold) return null;

    const currentHash = sha256Files(mdFiles);
    const db = openIndex(dbPath);
    if (!db) return null;

    const stored = getFingerprint(db, "wiki_fts");
    if (stored === currentHash) {
      db.close();
      return { status: "cache-hit", dbPath };
    }

    try {
      db.exec("BEGIN IMMEDIATE");
      db.exec("DELETE FROM wiki_fts");

      const ins = db.prepare(
        "INSERT INTO wiki_fts (path, title, content) VALUES (?, ?, ?)",
      );

      for (const mdFile of mdFiles) {
        try {
          const content = fs.readFileSync(mdFile, "utf8");
          const relPath = path.relative(repoRoot, mdFile);
          const title = extractTitle(content, mdFile);
          ins.run(relPath, title, content);
        } catch {
          /* skip unreadable wiki files */
        }
      }

      setFingerprint(db, "wiki_fts", wikiDir, currentHash);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      db.close();
      return { status: "error", message: `wiki_fts rebuild failed: ${(err as Error).message}` };
    }

    db.close();
    return { status: "populated", dbPath };
  } catch (err) {
    return { status: "error", message: `ensureWikiFtsIndex error: ${(err as Error).message}` };
  }
}

// ── TE-14: ensureFederationWikiCache ──────────────────────────────────────

/**
 * TE-14 — Lazy populate/invalidate flow for the `federation_wiki_cache` table.
 *
 * Follows the `ensureWikiFtsIndex` pattern exactly:
 *  - Fingerprint key: `"federation_wiki_cache:<subGuildRoot>"` (per-sub-guild).
 *  - If fingerprint matches → return `{ status:'cache-hit', hits: [...] }`.
 *  - If stale or absent → call `fetchHits()`, replace rows for this sub-guild,
 *    update fingerprint → return `{ status:'populated', hits: [...] }`.
 *  - Never throws; returns `{ status:'error' }` on any failure.
 *
 * BOUNDARY INVARIANT: the DB lives at `workspaceRoot/.guild/index.sqlite`.
 * This function NEVER writes to `subGuildRoot/.guild/` — any write there would
 * violate the single-root constraint. Callers must pass distinct roots.
 *
 * @param workspaceRoot  Absolute path to the workspace's root (contains .guild/index.sqlite).
 * @param subGuildRoot   Absolute path to the sub-guild being federated.
 *                       Used as the fingerprint scope key and stored in rows.
 *                       NEVER written to.
 * @param config         Index config (enabled flag, thresholds).
 * @param fetchHits      Callback that reads the sub-guild wiki and returns hits
 *                       (e.g., via BM25 search or full-page extraction). Called
 *                       only when the cache is stale or absent.
 */
export function ensureFederationWikiCache(
  workspaceRoot: string,
  subGuildRoot: string,
  config: IndexBlock,
  fetchHits: () => FederationWikiHit[],
): FederationWikiCacheResult {
  if (!config.enabled) return { status: "disabled" };

  // BOUNDARY CHECK: silently refuse when workspaceRoot === subGuildRoot — that
  // would write the sub-guild's own DB, violating the zero-write boundary.
  if (path.resolve(workspaceRoot) === path.resolve(subGuildRoot)) {
    return {
      status: "error",
      message: "ensureFederationWikiCache: workspaceRoot and subGuildRoot must differ (boundary violation guard)",
    };
  }

  try {
    const absWorkspace = path.resolve(workspaceRoot);
    const absSubGuild = path.resolve(subGuildRoot);
    const dbPath = path.join(absWorkspace, ".guild", "index.sqlite");

    // Per-sub-guild fingerprint key (must be unique across sub-guilds).
    const fingerprintKey = `federation_wiki_cache:${absSubGuild}`;

    // Fingerprint = SHA-256 over the sub-guild's wiki markdown files.
    // Computed whether or not there are any files (empty hash = no files).
    const subGuildWikiDir = path.join(absSubGuild, ".guild", "wiki");
    const mdFiles = collectMarkdownFiles(subGuildWikiDir);
    const currentHash = mdFiles.length > 0 ? sha256Files(mdFiles) : "empty";

    const db = openIndex(dbPath);
    if (!db) {
      return { status: "error", message: "ensureFederationWikiCache: failed to open index.sqlite" };
    }

    const stored = getFingerprint(db, fingerprintKey);
    if (stored === currentHash) {
      // Cache hit — read rows for this sub-guild.
      const rows = db
        .prepare(
          "SELECT path, title, snippet FROM federation_wiki_cache WHERE sub_guild_root = ?",
        )
        .all(absSubGuild) as { path: string; title: string | null; snippet: string | null }[];
      db.close();
      return {
        status: "cache-hit",
        dbPath,
        hits: rows.map((r) => ({ path: r.path, title: r.title, snippet: r.snippet })),
      };
    }

    // Cache miss / stale — call fetchHits(), replace rows, update fingerprint.
    let freshHits: FederationWikiHit[];
    try {
      freshHits = fetchHits();
    } catch (err) {
      db.close();
      return {
        status: "error",
        message: `ensureFederationWikiCache: fetchHits() threw: ${(err as Error).message}`,
      };
    }

    try {
      db.exec("BEGIN IMMEDIATE");
      // Delete all existing rows for this sub-guild (full invalidation).
      db
        .prepare("DELETE FROM federation_wiki_cache WHERE sub_guild_root = ?")
        .run(absSubGuild);

      const ins = db.prepare(
        "INSERT INTO federation_wiki_cache (sub_guild_root, path, title, snippet) VALUES (?, ?, ?, ?)",
      );
      for (const hit of freshHits) {
        ins.run(absSubGuild, hit.path, hit.title ?? null, hit.snippet ?? null);
      }

      setFingerprint(db, fingerprintKey, subGuildWikiDir, currentHash);
      db.exec("COMMIT");
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* ignore rollback errors */
      }
      db.close();
      return {
        status: "error",
        message: `ensureFederationWikiCache: rebuild failed: ${(err as Error).message}`,
      };
    }

    db.close();
    return { status: "populated", dbPath, hits: freshHits };
  } catch (err) {
    return {
      status: "error",
      message: `ensureFederationWikiCache error: ${(err as Error).message}`,
    };
  }
}
