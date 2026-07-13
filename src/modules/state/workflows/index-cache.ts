/**
 * src/modules/state/workflows/index-cache.ts
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
 *   import { ensureKgIndex, ensureKgProjectionIndex,
 *            ensureWikiFtsIndex } from './lib/index-cache'
 *
 * plugin-audit-remediation G5a: ensureKlIndex, ensureRunProvenanceIndex, and
 * ensureFederationWikiCache were removed (2026-07) — all three had zero
 * production consumers (test-only; the kl_edges/run_provenance/
 * federation_wiki_cache tables were built but never read by the live wiki
 * recall path, which only calls ensureKgIndex/ensureKgProjectionIndex/
 * ensureWikiFtsIndex). The empty table schemas remain in index-migrate.ts —
 * removing them is a separate, out-of-scope migration decision.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { runMigrations } from "../../migrations";
// Identifier tokenizer is a base-layer primitive in kernel (not the higher
// knowledge module) — keeps this lower `state` module's dependency direction inward.
import { tokenizeIdentifierAware } from "../../kernel";

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

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the canonical MAIN repo root worktree-safely.
 * Mirrors learn/lib/paths.ts:resolveMainRepoRoot — duplicated here
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
 * T5.1 (G5) — Ensure the OPTIONAL structural projection (kg_calls +
 * kg_symbols_fts) is populated.
 *
 * Source: .guild/indexes/knowledge-graph.json (SAME source + thresholds +
 * fingerprint discipline as {@link ensureKgIndex}; a sibling projection, not a
 * replacement). Fingerprint key: "kg_projection".
 *
 *   kg_calls       ← every `calls` edge (source, target, confidence).
 *   kg_symbols_fts ← one row per NAMED node: (node_id, name_tokens), where
 *                    name_tokens is the camel/snake-split identifier tokens of
 *                    the node name joined by spaces (model-free, deterministic).
 *
 * HARD INVARIANT (goals.md §1.3): this is acceleration ONLY. `index: off`
 * (in-process JSON BFS via lib/graph-query.ts) is the source of truth and
 * returns IDENTICAL answers; deleting index.sqlite loses nothing. Both tables
 * are a PURE function of the graph — rebuild twice → identical contents.
 *
 * Returns null  → below threshold / disabled / missing source → caller uses JSON.
 * Returns CacheResult { status:'cache-hit'|'populated', dbPath } → projection ready.
 */
export function ensureKgProjectionIndex(cwd: string, config: IndexBlock): CacheResult | null {
  if (!config.enabled) return null;

  try {
    const repoRoot = resolveMainRepoRoot(cwd);
    const kgPath = path.join(repoRoot, ".guild", "indexes", "knowledge-graph.json");
    const dbPath = path.join(repoRoot, ".guild", "index.sqlite");

    if (!fs.existsSync(kgPath)) return null;

    // Threshold check — identical gating to ensureKgIndex (node count OR size).
    const stat = fs.statSync(kgPath);
    const sizeMb = stat.size / (1024 * 1024);
    let nodeCount = 0;
    try {
      const raw = JSON.parse(fs.readFileSync(kgPath, "utf8")) as { nodes?: unknown[] };
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

    const stored = getFingerprint(db, "kg_projection");
    if (stored === currentHash) {
      db.close();
      return { status: "cache-hit", dbPath };
    }

    try {
      const graph = JSON.parse(fs.readFileSync(kgPath, "utf8")) as {
        nodes?: Array<{ id: string; name?: string; [k: string]: unknown }>;
        edges?: Array<{ source: string; target: string; type?: string; confidence?: string; [k: string]: unknown }>;
      };

      db.exec("BEGIN IMMEDIATE");
      db.exec("DELETE FROM kg_calls");
      db.exec("DELETE FROM kg_symbols_fts");

      const insCall = db.prepare(
        "INSERT INTO kg_calls (source, target, confidence) VALUES (?, ?, ?)",
      );
      for (const edge of graph.edges ?? []) {
        if (edge.type !== "calls") continue;
        if (typeof edge.source !== "string" || typeof edge.target !== "string") continue;
        insCall.run(
          edge.source,
          edge.target,
          typeof edge.confidence === "string" ? edge.confidence : null,
        );
      }

      const insSym = db.prepare(
        "INSERT INTO kg_symbols_fts (node_id, name_tokens) VALUES (?, ?)",
      );
      for (const node of graph.nodes ?? []) {
        if (typeof node.id !== "string") continue;
        const name = typeof node.name === "string" ? node.name : "";
        if (name.length === 0) continue;
        // Index the camel/snake-split tokens of the node's display NAME only
        // (not the id — its path/type segments would pollute symbol search), so
        // `process_order` finds `processOrder`. Pre-split here so the FTS
        // built-in tokenizer only whitespace-splits (see migration v3). The
        // read seam (graph-query-projection.ts) tokenizes the SAME `node.name`
        // on the query+document side, so FTS and the JSON scan agree exactly.
        const tokens = tokenizeIdentifierAware(name);
        insSym.run(node.id, tokens.join(" "));
      }

      setFingerprint(db, "kg_projection", kgPath, currentHash);
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
        message: `kg projection rebuild failed: ${(err as Error).message}`,
      };
    }

    db.close();
    return { status: "populated", dbPath };
  } catch (err) {
    return { status: "error", message: `ensureKgProjectionIndex error: ${(err as Error).message}` };
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

