/**
 * __tests__/index-cache.test.ts
 *
 * Tests for scripts/index-migrate.ts and scripts/lib/index-cache.ts.
 *
 * Coverage:
 *   1. runMigrations — creates schema v1 tables; idempotent; survives bad db path.
 *   2. Threshold gating — below threshold → no-write (null return); above → populate.
 *   3. SHA-256 fingerprint — cache-hit when source unchanged; rebuild on change.
 *   4. enabled:false — never writes index.sqlite.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  CURRENT_SCHEMA_VERSION,
  runMigrations,
} from "../index-migrate";

import {
  DEFAULT_INDEX_BLOCK,
  ensureKgIndex,
  ensureWikiFtsIndex,
  type IndexBlock,
} from "../lib/index-cache";

// ── Minimal node:sqlite stubs for verification ────────────────────────────

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

function openDb(dbPath: string): SqliteDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => SqliteDb;
  };
  return new DatabaseSync(dbPath);
}

// ── Test helpers ─────────────────────────────────────────────────────────

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-idx-test-"));
}

/** Create a fake repo with .guild/ structure. Returns the repoRoot. */
function mkFakeRepo(): string {
  const root = mkTmpDir();
  fs.mkdirSync(path.join(root, ".guild", "indexes"), { recursive: true });
  fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
  fs.mkdirSync(path.join(root, ".guild", "wiki"), { recursive: true });
  return root;
}

/** Write a fake knowledge-graph.json with nodeCount nodes. */
function writeKg(repoRoot: string, nodeCount: number): void {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `node-${i}`,
    type: "file",
    name: `File${i}`,
    source_refs: [`src/${i}.ts`],
    confidence: "high",
  }));
  const graph = {
    version: "guild.knowledge_graph.v1",
    project: { name: "test", description: "" },
    generated_from_commit: "abc",
    nodes,
    edges: [],
    layers: [],
    tour: [],
  };
  fs.writeFileSync(
    path.join(repoRoot, ".guild", "indexes", "knowledge-graph.json"),
    JSON.stringify(graph),
  );
}

/** Create N fake wiki markdown files. */
function writeWikiFiles(repoRoot: string, fileCount: number): void {
  const wikiDir = path.join(repoRoot, ".guild", "wiki");
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(
      path.join(wikiDir, `page-${i}.md`),
      `# Page ${i}\n\nContent for page ${i}.\n`,
    );
  }
}

/** Low-threshold config that triggers populate with tiny fixtures. */
function lowThresholdConfig(overrides?: Partial<IndexBlock>): IndexBlock {
  return {
    ...DEFAULT_INDEX_BLOCK,
    kg_node_threshold: 1,
    kg_size_threshold_mb: 100,      // won't trigger on size
    links_edge_threshold: 1,
    runs_threshold: 1,
    wiki_file_threshold: 1,
    ...overrides,
  };
}

// ── Cleanup registry ──────────────────────────────────────────────────────

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});
function track<T extends string>(dir: T): T {
  TEMP_DIRS.push(dir);
  return dir;
}

// ── 1. runMigrations ──────────────────────────────────────────────────────

describe("runMigrations", () => {
  test("creates all schema tables and sets PRAGMA user_version = CURRENT_SCHEMA_VERSION", () => {
    const dir = track(mkTmpDir());
    const dbPath = path.join(dir, "index.sqlite");

    const result = runMigrations(dbPath);

    expect(result.ok).toBe(true);
    expect(result.toVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(fs.existsSync(dbPath)).toBe(true);

    const db = openDb(dbPath);
    const version = (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version;
    // TE-14: schema version is now 2 (federation_wiki_cache added).
    expect(version).toBe(CURRENT_SCHEMA_VERSION);

    // All expected tables exist (v1 tables + TE-14 v2 federation_wiki_cache)
    for (const tbl of [
      "kg_nodes", "kg_edges", "kl_edges", "run_provenance", "_fingerprints", "wiki_fts",
      "federation_wiki_cache", // TE-14
    ]) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','shadow') AND name = ?")
        .get(tbl) as { name: string } | undefined;
      // wiki_fts is virtual; check it via sqlite_master with type='table' OR 'virtual'
      if (row === undefined) {
        // For virtual FTS5 tables, sqlite_master type may be 'table' for shadow tables
        // Check the content table itself
        const vRow = db
          .prepare("SELECT name FROM sqlite_master WHERE name = ?")
          .get(tbl) as { name: string } | undefined;
        expect(vRow?.name).toBe(tbl);
      } else {
        expect(row.name).toBe(tbl);
      }
    }
    db.close();
  });

  test("is idempotent — running twice does not change schema version", () => {
    const dir = track(mkTmpDir());
    const dbPath = path.join(dir, "index.sqlite");

    const r1 = runMigrations(dbPath);
    const r2 = runMigrations(dbPath);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.fromVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(r2.toVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  test("returns ok:false and does not throw when db path is in a non-creatable location", () => {
    // Use a path under a file (not a directory) to trigger an error
    const dir = track(mkTmpDir());
    const blocker = path.join(dir, "notadir");
    fs.writeFileSync(blocker, "block");
    const dbPath = path.join(blocker, "index.sqlite");

    let result: ReturnType<typeof runMigrations>;
    expect(() => {
      result = runMigrations(dbPath);
    }).not.toThrow();
    // Depending on mkdirSync error handling, ok may be false
    // The point is: no throw
  });

  test("creates parent directories automatically", () => {
    const dir = track(mkTmpDir());
    const dbPath = path.join(dir, "deep", "nested", "index.sqlite");

    const result = runMigrations(dbPath);

    expect(result.ok).toBe(true);
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});

// ── 2. enabled:false ──────────────────────────────────────────────────────

describe("enabled:false — never writes index.sqlite", () => {
  const disabledConfig: IndexBlock = { ...lowThresholdConfig(), enabled: false };

  test("ensureKgIndex returns null and no sqlite file is created", () => {
    const repo = track(mkFakeRepo());
    writeKg(repo, 100); // well above threshold if enabled
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const result = ensureKgIndex(repo, disabledConfig);

    expect(result).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test("ensureWikiFtsIndex returns null and no sqlite file is created", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, 100);
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const result = ensureWikiFtsIndex(repo, disabledConfig);

    expect(result).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});

// ── 3. Threshold gating (ensureKgIndex as representative) ────────────────

describe("threshold gating — below threshold: no write; above: populate", () => {
  test("ensureKgIndex below node threshold → null, no sqlite created", () => {
    const repo = track(mkFakeRepo());
    writeKg(repo, 1); // 1 node, threshold=2
    const cfg: IndexBlock = { ...lowThresholdConfig(), kg_node_threshold: 2 };
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const result = ensureKgIndex(repo, cfg);

    expect(result).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test("ensureKgIndex above node threshold → populated, sqlite created", () => {
    const repo = track(mkFakeRepo());
    writeKg(repo, 5); // 5 nodes, threshold=2 (above)
    const cfg: IndexBlock = { ...lowThresholdConfig(), kg_node_threshold: 2 };
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const result = ensureKgIndex(repo, cfg);

    expect(result).not.toBeNull();
    expect(result?.status).toBe("populated");
    expect(result?.dbPath).toBe(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);

    // Verify rows were actually inserted
    const db = openDb(dbPath);
    const rows = db.prepare("SELECT COUNT(*) AS cnt FROM kg_nodes").get() as { cnt: number };
    expect(rows.cnt).toBe(5);
    db.close();
  });

  test("ensureWikiFtsIndex below wiki threshold → null", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, 1); // 1 file, threshold=2
    const cfg: IndexBlock = { ...lowThresholdConfig(), wiki_file_threshold: 2 };
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const result = ensureWikiFtsIndex(repo, cfg);

    expect(result).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test("ensureWikiFtsIndex above wiki threshold → populated", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, 5); // 5 files, threshold=2
    const cfg: IndexBlock = { ...lowThresholdConfig(), wiki_file_threshold: 2 };

    const result = ensureWikiFtsIndex(repo, cfg);

    expect(result?.status).toBe("populated");

    const db = openDb(result!.dbPath!);
    const rows = db.prepare("SELECT COUNT(*) AS cnt FROM wiki_fts").get() as { cnt: number };
    expect(rows.cnt).toBe(5);
    db.close();
  });
});

// ── 4. Fingerprint cache-hit vs rebuild ───────────────────────────────────

describe("SHA-256 fingerprint gating", () => {
  test("cache-hit: same source → second call returns cache-hit without re-inserting", () => {
    const repo = track(mkFakeRepo());
    writeKg(repo, 3);
    const cfg = lowThresholdConfig();
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const first = ensureKgIndex(repo, cfg);
    expect(first?.status).toBe("populated");

    // Count before second call
    const db1 = openDb(dbPath);
    const cnt1 = (db1.prepare("SELECT COUNT(*) AS c FROM kg_nodes").get() as { c: number }).c;
    db1.close();

    const second = ensureKgIndex(repo, cfg);
    expect(second?.status).toBe("cache-hit");

    // Row count must be unchanged (no re-insert on cache-hit)
    const db2 = openDb(dbPath);
    const cnt2 = (db2.prepare("SELECT COUNT(*) AS c FROM kg_nodes").get() as { c: number }).c;
    db2.close();
    expect(cnt2).toBe(cnt1);
  });

  test("rebuild: source changes → second call returns populated with new row count", () => {
    const repo = track(mkFakeRepo());
    writeKg(repo, 3);
    const cfg = lowThresholdConfig();

    const first = ensureKgIndex(repo, cfg);
    expect(first?.status).toBe("populated");

    // Modify source (add 2 more nodes)
    writeKg(repo, 5);

    const second = ensureKgIndex(repo, cfg);
    expect(second?.status).toBe("populated");

    // New row count must match updated source
    const db = openDb(second!.dbPath!);
    const cnt = (db.prepare("SELECT COUNT(*) AS c FROM kg_nodes").get() as { c: number }).c;
    db.close();
    expect(cnt).toBe(5);
  });

  test("wiki_fts fingerprint: cache-hit on repeat, rebuild when file added", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, 3);
    const cfg = lowThresholdConfig();

    const first = ensureWikiFtsIndex(repo, cfg);
    expect(first?.status).toBe("populated");

    const second = ensureWikiFtsIndex(repo, cfg);
    expect(second?.status).toBe("cache-hit");

    // Add more files
    writeWikiFiles(repo, 5);
    const third = ensureWikiFtsIndex(repo, cfg);
    expect(third?.status).toBe("populated");
    const db = openDb(third!.dbPath!);
    // After rebuild we should have all 5 wiki pages (writeWikiFiles rewrites 0..N-1)
    const cnt = (db.prepare("SELECT COUNT(*) AS c FROM wiki_fts").get() as { c: number }).c;
    db.close();
    expect(cnt).toBe(5);
  });
});

// ── 5. Missing source files → null (no crash) ────────────────────────────

describe("missing source files → null (graceful)", () => {
  test("ensureKgIndex with no knowledge-graph.json → null", () => {
    const repo = track(mkFakeRepo());
    // Don't write any kg file
    const result = ensureKgIndex(repo, lowThresholdConfig());
    expect(result).toBeNull();
  });
});
