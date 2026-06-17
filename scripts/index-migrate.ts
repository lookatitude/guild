#!/usr/bin/env -S npx tsx
/**
 * scripts/index-migrate.ts
 *
 * PRAGMA user_version migration runner for .guild/index.sqlite.
 *
 * Contract (D-PS-1 — v2-persistence-and-sqlite-index):
 *  - Atomic: each migration runs inside BEGIN IMMEDIATE/COMMIT; on failure
 *    the transaction is rolled back (affected tables are dropped inside the
 *    transaction so a rollback restores consistency).
 *  - Drop-and-rebuild-affected-table on failure: each migration DROPs its
 *    tables first (within the transaction) then re-creates them, so any
 *    partially-written state from a previous crash is cleaned up.
 *  - Never aborts the caller: all errors are caught and returned in the
 *    MigrationResult; callers treat `ok:false` as "fall back to direct-parse".
 *  - Worktree-safe: resolves .guild/ via `git rev-parse --git-common-dir`
 *    so linked worktrees always write to the main repo's .guild/.
 *
 * Usage:
 *   npx tsx scripts/index-migrate.ts [--db-path <path>] [--cwd <path>]
 *   import { runMigrations, CURRENT_SCHEMA_VERSION } from './index-migrate'
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Minimal type stubs for node:sqlite (stable in Node 26; not yet in
//    @types/node@22 range that the package.json pins). ──────────────────────
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

// TE-14: bump to 2 for federation_wiki_cache table.
export const CURRENT_SCHEMA_VERSION = 2;

export interface MigrationResult {
  ok: boolean;
  fromVersion: number;
  toVersion: number;
  dbPath: string;
  message?: string;
}

/**
 * Resolve the canonical MAIN repo root for a given cwd.
 *
 * INTENTIONAL DIVERGENCE from scripts/lib/guild-root.ts (the shared resolver
 * used by emit-loop-event, run-lifecycle, and retention):
 *
 *   scripts/lib/guild-root.ts (hooks/lib/guild-root.ts re-export) walks the
 *   filesystem UP looking for `.git` (file or dir) or `.guild/` (dir). In a
 *   git linked worktree, it STOPS at the WORKTREE root where the `.git` file
 *   lives — which is NOT the same as the MAIN working tree.
 *
 *   This function uses `git rev-parse --git-common-dir`, which always returns
 *   the MAIN repo's .git directory regardless of whether the cwd is in a
 *   linked worktree. The SQLite index at .guild/index.sqlite must live in the
 *   MAIN repo so all worktrees share the same DB — routing to a worktree's
 *   local root would create a split-brain index. Therefore this git-based
 *   resolver is the correct choice for index-migrate.ts, and the divergence
 *   is deliberate.
 *
 *   If the shared resolver is ever made worktree-aware (e.g. it follows the
 *   `.git` file pointer to resolve the main repo), this local copy can be
 *   removed and replaced with an import from scripts/lib/guild-root.ts.
 *
 * Falls back to cwd when git is unavailable or not a git repo.
 */
export function resolveGuildRoot(cwd: string): string {
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

// ── Migration definitions ─────────────────────────────────────────────────

interface Migration {
  /** Target schema version after this migration is applied. */
  version: number;
  /** Table names this migration creates — used for drop-on-failure cleanup. */
  tables: string[];
  /** Apply the migration. Called inside BEGIN IMMEDIATE; must not manage its own transaction. */
  up(db: SqliteDb): void;
}

const MIGRATIONS: Migration[] = [
  // ── v1: core tables ───────────────────────────────────────────────────────
  {
    version: 1,
    tables: ["kg_nodes", "kg_edges", "kl_edges", "run_provenance", "wiki_fts", "_fingerprints"],
    up(db: SqliteDb): void {
      // Drop before creating — ensures idempotent rebuild even if a previous
      // attempt left partial tables (drop-and-rebuild contract, D-PS-1).
      db.exec(`
        DROP TABLE IF EXISTS kg_nodes;
        DROP TABLE IF EXISTS kg_edges;
        DROP TABLE IF EXISTS kl_edges;
        DROP TABLE IF EXISTS run_provenance;
        DROP TABLE IF EXISTS wiki_fts;
        DROP TABLE IF EXISTS _fingerprints;
      `);

      db.exec(`
        CREATE TABLE kg_nodes (
          id         TEXT NOT NULL PRIMARY KEY,
          type       TEXT,
          name       TEXT,
          source_refs TEXT,
          confidence TEXT,
          layer      TEXT,
          data       TEXT
        );

        CREATE TABLE kg_edges (
          id        INTEGER PRIMARY KEY,
          source    TEXT NOT NULL,
          target    TEXT NOT NULL,
          type      TEXT,
          direction TEXT,
          weight    REAL,
          data      TEXT
        );

        CREATE TABLE kl_edges (
          id        INTEGER PRIMARY KEY,
          from_node TEXT NOT NULL,
          to_node   TEXT NOT NULL,
          type      TEXT,
          run_id    TEXT,
          data      TEXT
        );

        CREATE TABLE run_provenance (
          run_id TEXT NOT NULL PRIMARY KEY,
          ts     TEXT,
          data   TEXT
        );

        CREATE TABLE _fingerprints (
          table_name   TEXT NOT NULL PRIMARY KEY,
          source_path  TEXT NOT NULL,
          sha256       TEXT NOT NULL,
          populated_at TEXT NOT NULL
        );
      `);

      // wiki_fts: attempt FTS5 (SQLite ≥ 3.9 + FTS5 extension); fall back
      // to a plain table if FTS5 is unavailable in the linked SQLite build.
      //
      // TE-16 ACCEPT — self-contained vs external-content FTS5:
      //
      //   This creates a SELF-CONTAINED FTS5 table: content is stored directly
      //   inside the index.  The alternative, external-content FTS5
      //   (`content='wiki_files'`), would store content in a separate backing
      //   table and let `chunks_vec` (vector chunk embeddings) share that table
      //   via rowid JOIN, enabling additive recall from a single content source.
      //
      //   External-content FTS5 is NOT needed until `chunks_vec` is introduced.
      //   Self-contained FTS5 satisfies all current BM25 recall requirements and
      //   requires no backing-table migration.  This is a deliberate deferral.
      //
      //   Enabling condition (migrate to external-content FTS5):
      //     When `chunks_vec` is added (v2.x target), add a new migration version:
      //     1. Create `wiki_files` backing table (path TEXT PK, title TEXT, content TEXT).
      //     2. Migrate rows: INSERT INTO wiki_files SELECT path, title, content FROM wiki_fts.
      //     3. DROP TABLE wiki_fts; then recreate as external-content:
      //          CREATE VIRTUAL TABLE wiki_fts USING fts5(
      //            content='wiki_files', content_rowid='rowid',
      //            path UNINDEXED, title, content, tokenize='porter ascii'
      //          );
      //     4. `chunks_vec` can then JOIN on wiki_files.rowid.
      try {
        db.exec(`
          CREATE VIRTUAL TABLE wiki_fts USING fts5(
            path      UNINDEXED,
            title,
            content,
            tokenize='porter ascii'
          );
        `);
      } catch {
        db.exec(`
          CREATE TABLE wiki_fts (
            path    TEXT,
            title   TEXT,
            content TEXT
          );
        `);
      }
    },
  },

  // ── v2: federation_wiki_cache (TE-14) ────────────────────────────────────
  //
  // Stores a flat BM25-ready snapshot of each federated sub-guild's wiki.
  // Primary key is (sub_guild_root, path) — one row per page per sub-guild.
  // Fingerprint key in _fingerprints: "federation_wiki_cache:<sub_guild_root>".
  //
  // BOUNDARY: this table ONLY lives in the workspace-root index.sqlite.
  // ensureFederationWikiCache() NEVER writes to sub_guild_root/.guild/.
  {
    version: 2,
    tables: ["federation_wiki_cache"],
    up(db: SqliteDb): void {
      db.exec(`DROP TABLE IF EXISTS federation_wiki_cache;`);
      db.exec(`
        CREATE TABLE federation_wiki_cache (
          sub_guild_root TEXT NOT NULL,
          path           TEXT NOT NULL,
          title          TEXT,
          snippet        TEXT,
          PRIMARY KEY (sub_guild_root, path)
        );
      `);
    },
  },
];

/**
 * Run all pending migrations against the SQLite database at `dbPath`.
 * Creates the file and its parent directories if they do not exist.
 *
 * Returns a MigrationResult. On `ok: false` the database is left in a
 * consistent (possibly empty) state; the caller should fall back to
 * direct-parse rather than aborting.
 */
export function runMigrations(dbPath: string): MigrationResult {
  let db: SqliteDb | undefined;
  let fromVersion = 0;

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = openDatabase(dbPath);

    // WAL mode + NORMAL synchronous for reliable writes without
    // fsync-on-every-write overhead (index is reconstructable).
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");

    fromVersion = (
      db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;

    for (const mig of MIGRATIONS) {
      if (mig.version <= fromVersion) continue;

      try {
        db.exec("BEGIN IMMEDIATE");
        mig.up(db); // drops + recreates tables inside the transaction
        db.exec(`PRAGMA user_version = ${mig.version}`);
        db.exec("COMMIT");
        fromVersion = mig.version;
      } catch (err) {
        // Roll back the partially-applied migration.
        try {
          db.exec("ROLLBACK");
        } catch {
          /* ignore rollback errors */
        }
        // Belt-and-braces: also drop outside the transaction in case the DB
        // engine left partial state (e.g., DDL auto-committed before error).
        for (const tbl of mig.tables) {
          try {
            db.exec(`DROP TABLE IF EXISTS ${tbl}`);
          } catch {
            /* ignore individual drop errors */
          }
        }
        db.close();
        return {
          ok: false,
          fromVersion,
          toVersion: fromVersion,
          dbPath,
          message: `migration to v${mig.version} failed: ${(err as Error).message}`,
        };
      }
    }

    db.close();
    return {
      ok: true,
      fromVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      dbPath,
    };
  } catch (err) {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      fromVersion,
      toVersion: fromVersion,
      dbPath,
      message: `migration runner error: ${(err as Error).message}`,
    };
  }
}

// ── CLI entrypoint ────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);
  let cwd = process.env["GUILD_CWD"] ?? process.cwd();
  let dbPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && argv[i + 1]) cwd = argv[++i]!;
    if (argv[i] === "--db-path" && argv[i + 1]) dbPath = argv[++i];
  }

  if (!dbPath) {
    const guildRoot = resolveGuildRoot(cwd);
    dbPath = path.join(guildRoot, ".guild", "index.sqlite");
  }

  const result = runMigrations(dbPath);
  if (result.ok) {
    process.stdout.write(
      `[index-migrate] OK: schema v${result.fromVersion}→v${result.toVersion} at ${result.dbPath}\n`,
    );
  } else {
    process.stderr.write(`[index-migrate] WARN: ${result.message}\n`);
    process.exit(1);
  }
}

if (typeof module !== "undefined" && require.main === module) {
  main();
}
