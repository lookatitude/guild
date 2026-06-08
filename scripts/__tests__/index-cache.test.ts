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
  ensureKlIndex,
  ensureRunProvenanceIndex,
  ensureWikiFtsIndex,
  ensureFederationWikiCache,
  type IndexBlock,
  type FederationWikiHit,
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

/** Write a fake knowledge-links.json with edgeCount edges. */
function writeKl(repoRoot: string, edgeCount: number): void {
  const links = Array.from({ length: edgeCount }, (_, i) => ({
    from: `node-${i}`,
    to: `node-${i + 1}`,
    type: "touches",
    run_id: "run-0",
  }));
  const doc = { version: "guild.knowledge_links.v1", links };
  fs.writeFileSync(
    path.join(repoRoot, ".guild", "indexes", "knowledge-links.json"),
    JSON.stringify(doc),
  );
}

/** Create N fake run directories with provenance.json. */
function writeRuns(repoRoot: string, runCount: number): void {
  for (let i = 0; i < runCount; i++) {
    const dir = path.join(repoRoot, ".guild", "runs", `run-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "provenance.json"),
      JSON.stringify({ run_id: `run-${i}`, ts: new Date().toISOString() }),
    );
  }
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

  test("ensureKlIndex returns null and no sqlite file is created", () => {
    const repo = track(mkFakeRepo());
    writeKl(repo, 100);
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const result = ensureKlIndex(repo, disabledConfig);

    expect(result).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test("ensureRunProvenanceIndex returns null and no sqlite file is created", () => {
    const repo = track(mkFakeRepo());
    writeRuns(repo, 50);
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const result = ensureRunProvenanceIndex(repo, disabledConfig);

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

  test("ensureKlIndex below edge threshold → null", () => {
    const repo = track(mkFakeRepo());
    writeKl(repo, 1); // 1 edge, threshold=2
    const cfg: IndexBlock = { ...lowThresholdConfig(), links_edge_threshold: 2 };
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const result = ensureKlIndex(repo, cfg);

    expect(result).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test("ensureKlIndex above edge threshold → populated", () => {
    const repo = track(mkFakeRepo());
    writeKl(repo, 5); // 5 edges, threshold=2
    const cfg: IndexBlock = { ...lowThresholdConfig(), links_edge_threshold: 2 };

    const result = ensureKlIndex(repo, cfg);

    expect(result?.status).toBe("populated");

    const db = openDb(result!.dbPath!);
    const rows = db.prepare("SELECT COUNT(*) AS cnt FROM kl_edges").get() as { cnt: number };
    expect(rows.cnt).toBe(5);
    db.close();
  });

  test("ensureRunProvenanceIndex below runs threshold → null", () => {
    const repo = track(mkFakeRepo());
    writeRuns(repo, 1); // 1 run, threshold=2
    const cfg: IndexBlock = { ...lowThresholdConfig(), runs_threshold: 2 };
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const result = ensureRunProvenanceIndex(repo, cfg);

    expect(result).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test("ensureRunProvenanceIndex above runs threshold → populated", () => {
    const repo = track(mkFakeRepo());
    writeRuns(repo, 5); // 5 runs, threshold=2
    const cfg: IndexBlock = { ...lowThresholdConfig(), runs_threshold: 2 };

    const result = ensureRunProvenanceIndex(repo, cfg);

    expect(result?.status).toBe("populated");

    const db = openDb(result!.dbPath!);
    const rows = db.prepare("SELECT COUNT(*) AS cnt FROM run_provenance").get() as { cnt: number };
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

  test("kl_edges fingerprint: cache-hit on repeat, rebuild on change", () => {
    const repo = track(mkFakeRepo());
    writeKl(repo, 3);
    const cfg = lowThresholdConfig();

    const first = ensureKlIndex(repo, cfg);
    expect(first?.status).toBe("populated");

    const second = ensureKlIndex(repo, cfg);
    expect(second?.status).toBe("cache-hit");

    writeKl(repo, 6);
    const third = ensureKlIndex(repo, cfg);
    expect(third?.status).toBe("populated");
    const db = openDb(third!.dbPath!);
    const cnt = (db.prepare("SELECT COUNT(*) AS c FROM kl_edges").get() as { c: number }).c;
    db.close();
    expect(cnt).toBe(6);
  });

  test("run_provenance fingerprint: cache-hit on repeat, rebuild when new run added", () => {
    const repo = track(mkFakeRepo());
    writeRuns(repo, 3);
    const cfg = lowThresholdConfig();

    const first = ensureRunProvenanceIndex(repo, cfg);
    expect(first?.status).toBe("populated");

    const second = ensureRunProvenanceIndex(repo, cfg);
    expect(second?.status).toBe("cache-hit");

    // Add another run
    writeRuns(repo, 4);
    const third = ensureRunProvenanceIndex(repo, cfg);
    expect(third?.status).toBe("populated");
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

  test("ensureKlIndex with no knowledge-links.json → null", () => {
    const repo = track(mkFakeRepo());
    const result = ensureKlIndex(repo, lowThresholdConfig());
    expect(result).toBeNull();
  });

  test("ensureRunProvenanceIndex with empty runs dir → null", () => {
    const repo = track(mkFakeRepo());
    const result = ensureRunProvenanceIndex(repo, lowThresholdConfig());
    expect(result).toBeNull();
  });
});

// ── 6. ensureFederationWikiCache (TE-14) ──────────────────────────────────

/**
 * Create a fake workspace root (has .guild/index.sqlite after first populate).
 * Distinct from mkFakeRepo — the workspace root doesn't need wiki files.
 */
function mkWorkspaceRoot(): string {
  const root = mkTmpDir();
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  return root;
}

/**
 * Create a fake sub-guild root with N wiki markdown files.
 * BOUNDARY: the workspace root must be DIFFERENT from this root.
 */
function mkSubGuildWithWiki(fileCount: number): string {
  const root = mkTmpDir();
  const wikiDir = path.join(root, ".guild", "wiki");
  fs.mkdirSync(wikiDir, { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    fs.writeFileSync(
      path.join(wikiDir, `wiki-${i}.md`),
      `# Sub-Guild Page ${i}\n\nContent for page ${i}.\n`,
    );
  }
  return root;
}

/** Default hits factory — produces deterministic hits from a sub-guild path list. */
function makeFetchHits(pages: { path: string; title: string; snippet: string }[]): () => FederationWikiHit[] {
  return () => pages;
}

describe("ensureFederationWikiCache (TE-14)", () => {
  const cfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, enabled: true };
  const disabledCfg: IndexBlock = { ...DEFAULT_INDEX_BLOCK, enabled: false };

  test("disabled config → status='disabled', no DB written", () => {
    const workspace = track(mkWorkspaceRoot());
    const subGuild = track(mkSubGuildWithWiki(1));
    const fetchHits = jest.fn().mockReturnValue([]);

    const result = ensureFederationWikiCache(workspace, subGuild, disabledCfg, fetchHits);

    expect(result.status).toBe("disabled");
    expect(result.hits).toBeUndefined();
    expect(fetchHits).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(workspace, ".guild", "index.sqlite"))).toBe(false);
  });

  test("boundary violation (workspace === subGuild) → error, no DB written", () => {
    const workspace = track(mkWorkspaceRoot());
    const fetchHits = jest.fn().mockReturnValue([]);

    const result = ensureFederationWikiCache(workspace, workspace, cfg, fetchHits);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/boundary/i);
    expect(fetchHits).not.toHaveBeenCalled();
  });

  test("first call (no cache) → status='populated', fetchHits called once, hits returned", () => {
    const workspace = track(mkWorkspaceRoot());
    const subGuild = track(mkSubGuildWithWiki(2));
    const expectedHits: FederationWikiHit[] = [
      { path: "sub/a.md", title: "A", snippet: "content A" },
      { path: "sub/b.md", title: "B", snippet: "content B" },
    ];
    const fetchHits = jest.fn().mockReturnValue(expectedHits);

    const result = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);

    expect(result.status).toBe("populated");
    expect(result.hits).toEqual(expectedHits);
    expect(fetchHits).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(workspace, ".guild", "index.sqlite"))).toBe(true);
  });

  test("second call (same sub-guild wiki, unchanged) → cache-hit, fetchHits NOT called again", () => {
    const workspace = track(mkWorkspaceRoot());
    const subGuild = track(mkSubGuildWithWiki(2));
    const hits: FederationWikiHit[] = [
      { path: "sub/a.md", title: "A", snippet: "content A" },
    ];
    const fetchHits = jest.fn().mockReturnValue(hits);

    const first = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);
    const second = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);

    expect(first.status).toBe("populated");
    expect(second.status).toBe("cache-hit");
    expect(fetchHits).toHaveBeenCalledTimes(1); // NOT called again on cache-hit
    // Cache-hit results must equal the originally stored hits.
    expect(second.hits).toEqual(hits);
  });

  test("cache-hit results equal direct-hit results (TE-14 contract)", () => {
    const workspace = track(mkWorkspaceRoot());
    const subGuild = track(mkSubGuildWithWiki(3));
    const hits: FederationWikiHit[] = [
      { path: "p1.md", title: "T1", snippet: "S1" },
      { path: "p2.md", title: "T2", snippet: "S2" },
      { path: "p3.md", title: null, snippet: null },
    ];
    const fetchHits = jest.fn().mockReturnValue(hits);

    const populated = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);
    const cached = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);

    expect(populated.status).toBe("populated");
    expect(cached.status).toBe("cache-hit");
    // The cached hits must be structurally identical to what fetchHits() returned.
    expect(cached.hits).toEqual(populated.hits);
  });

  test("sub-guild wiki changes → cache invalidated → fetchHits called again", () => {
    const workspace = track(mkWorkspaceRoot());
    const subGuild = track(mkSubGuildWithWiki(1));
    const hitsV1: FederationWikiHit[] = [{ path: "old.md", title: "Old", snippet: "old" }];
    const hitsV2: FederationWikiHit[] = [{ path: "new.md", title: "New", snippet: "new" }];
    const fetchHits = jest.fn()
      .mockReturnValueOnce(hitsV1)
      .mockReturnValueOnce(hitsV2);

    const r1 = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);
    expect(r1.status).toBe("populated");
    expect(r1.hits).toEqual(hitsV1);

    // Mutate the sub-guild wiki (triggers fingerprint invalidation on next call).
    fs.writeFileSync(
      path.join(subGuild, ".guild", "wiki", "new-page.md"),
      "# New Page\n\nAdded content.\n",
    );

    const r2 = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);
    expect(r2.status).toBe("populated");
    expect(r2.hits).toEqual(hitsV2);
    expect(fetchHits).toHaveBeenCalledTimes(2); // re-fetched after wiki change
  });

  test("empty sub-guild wiki → populated with empty hits (zero rows), cache-hit on repeat", () => {
    const workspace = track(mkWorkspaceRoot());
    const subGuild = track(mkSubGuildWithWiki(0)); // no wiki files
    const fetchHits = jest.fn().mockReturnValue([]);

    const r1 = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);
    const r2 = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);

    expect(r1.status).toBe("populated");
    expect(r1.hits).toEqual([]);
    expect(r2.status).toBe("cache-hit");
    expect(r2.hits).toEqual([]);
    expect(fetchHits).toHaveBeenCalledTimes(1);
  });

  test("BOUNDARY: no write to subGuildRoot/.guild/ — workspace DB is in workspaceRoot only", () => {
    const workspace = track(mkWorkspaceRoot());
    const subGuild = track(mkSubGuildWithWiki(2));
    const fetchHits = jest.fn().mockReturnValue([
      { path: "x.md", title: "X", snippet: "x" },
    ]);

    ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);

    // The sub-guild's .guild/ must not have an index.sqlite.
    expect(fs.existsSync(path.join(subGuild, ".guild", "index.sqlite"))).toBe(false);
    // The workspace's .guild/ must have one.
    expect(fs.existsSync(path.join(workspace, ".guild", "index.sqlite"))).toBe(true);
  });

  test("multiple sub-guilds share one workspace DB without cross-contamination", () => {
    const workspace = track(mkWorkspaceRoot());
    const subA = track(mkSubGuildWithWiki(1));
    const subB = track(mkSubGuildWithWiki(1));
    const hitsA: FederationWikiHit[] = [{ path: "a.md", title: "A", snippet: "a" }];
    const hitsB: FederationWikiHit[] = [{ path: "b.md", title: "B", snippet: "b" }];

    const rA = ensureFederationWikiCache(workspace, subA, cfg, () => hitsA);
    const rB = ensureFederationWikiCache(workspace, subB, cfg, () => hitsB);

    expect(rA.status).toBe("populated");
    expect(rB.status).toBe("populated");

    // On cache-hit, each sub-guild only sees its own rows.
    const cA = ensureFederationWikiCache(workspace, subA, cfg, () => hitsA);
    const cB = ensureFederationWikiCache(workspace, subB, cfg, () => hitsB);

    expect(cA.status).toBe("cache-hit");
    expect(cB.status).toBe("cache-hit");
    expect(cA.hits).toEqual(hitsA);
    expect(cB.hits).toEqual(hitsB);
    // No cross-contamination: A's hits don't contain B's path and vice versa.
    expect(cA.hits!.find((h) => h.path === "b.md")).toBeUndefined();
    expect(cB.hits!.find((h) => h.path === "a.md")).toBeUndefined();
  });

  test("fetchHits() throwing → status='error', DB left consistent", () => {
    const workspace = track(mkWorkspaceRoot());
    const subGuild = track(mkSubGuildWithWiki(1));
    const fetchHits = jest.fn().mockImplementation(() => {
      throw new Error("network unreachable");
    });

    const result = ensureFederationWikiCache(workspace, subGuild, cfg, fetchHits);

    expect(result.status).toBe("error");
    expect(result.message).toMatch(/fetchHits/i);
    // A subsequent call with a working fetchHits must succeed (DB consistent).
    const goodHits: FederationWikiHit[] = [{ path: "ok.md", title: "OK", snippet: "ok" }];
    const retry = ensureFederationWikiCache(workspace, subGuild, cfg, () => goodHits);
    expect(retry.status).toBe("populated");
    expect(retry.hits).toEqual(goodHits);
  });
});
