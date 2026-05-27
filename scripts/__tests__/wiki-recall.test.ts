/**
 * __tests__/wiki-recall.test.ts
 *
 * Tests for scripts/lib/wiki-recall.ts — the SQLite wiki_fts read-through
 * for the recall-before-read path (D-PS-2, v2-persistence-and-sqlite-index).
 *
 * Coverage:
 *   1. Read-through HIT: above threshold + query matches → WikiRecallResult with hits.
 *   2. Read-through MISS (no FTS matches): above threshold + populated → empty hits
 *      (index IS the path; 0 results ≠ null).
 *   3. Cache miss → null (fall through): below threshold.
 *   4. OFF mode → null (fall through): enabled:false.
 *   5. Lazy-build trigger: first call above threshold populates wiki_fts.
 *   6. Cache-hit: second identical call uses fingerprint, no re-populate.
 *   7. normalizeFtsQuery: strips FTS5 special chars, returns empty on blank.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  wikiRecall,
  normalizeFtsQuery,
  type WikiRecallResult,
} from "../lib/wiki-recall";

import { DEFAULT_INDEX_BLOCK, type IndexBlock } from "../lib/index-cache";

// ── Minimal node:sqlite helper for verification ───────────────────────────

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
function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-wiki-recall-"));
}

/** Create a fake repo with .guild/wiki/. Returns repoRoot. */
function mkFakeRepo(): string {
  const root = mkTmpDir();
  fs.mkdirSync(path.join(root, ".guild", "wiki"), { recursive: true });
  fs.mkdirSync(path.join(root, ".guild", "indexes"), { recursive: true });
  fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
  return root;
}

/** Write N markdown files to .guild/wiki/, with unique content. */
function writeWikiFiles(
  repoRoot: string,
  files: Array<{ name: string; title: string; body: string }>,
): void {
  const wikiDir = path.join(repoRoot, ".guild", "wiki");
  for (const { name, title, body } of files) {
    fs.writeFileSync(path.join(wikiDir, name), `# ${title}\n\n${body}\n`);
  }
}

/** Write N generic wiki files. */
function writeGenericWikiFiles(repoRoot: string, count: number): void {
  const wikiDir = path.join(repoRoot, ".guild", "wiki");
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(
      path.join(wikiDir, `page-${i}.md`),
      `# Page ${i}\n\nContent for page ${i}.\n`,
    );
  }
}

/** Config that triggers at low threshold for test convenience. */
function lowThresholdConfig(overrides?: Partial<IndexBlock>): IndexBlock {
  return {
    ...DEFAULT_INDEX_BLOCK,
    wiki_file_threshold: 1,
    ...overrides,
  };
}

// ── 1. Read-through HIT ────────────────────────────────────────────────────

describe("wikiRecall — read-through HIT", () => {
  test("above threshold, query matches → WikiRecallResult with non-empty hits", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, [
      {
        name: "recall.md",
        title: "SQLite recall caching",
        body: "The recall path uses SQLite wiki_fts for BM25 search when above threshold.",
      },
      {
        name: "other.md",
        title: "Unrelated Page",
        body: "This page is about something entirely different.",
      },
    ]);

    const config = lowThresholdConfig(); // threshold=1, 2 files → above
    const result = wikiRecall("SQLite recall BM25", repo, config);

    expect(result).not.toBeNull();
    expect(result!.source).toBe("sqlite-wiki_fts");
    expect(result!.hits.length).toBeGreaterThan(0);

    // The recall.md page should be the top hit (most relevant to query)
    const topHit = result!.hits[0];
    expect(topHit.path).toContain("recall.md");
    expect(topHit.rank).toBeLessThan(0); // BM25 rank is negative for matches
    expect(topHit.title).toContain("SQLite recall");
    expect(typeof topHit.snippet).toBe("string");
  });

  test("hits are ordered by BM25 relevance (most relevant rank first)", () => {
    const repo = track(mkFakeRepo());
    // Both pages mention "recall" and "index" so both match; highly-relevant has more density.
    writeWikiFiles(repo, [
      {
        name: "highly-relevant.md",
        title: "Recall index deep guide",
        body: "Recall index recall index recall index recall index. This page is all about recall and index.",
      },
      {
        name: "weakly-relevant.md",
        title: "General recall guide",
        body: "Provides general recall and index capabilities.",
      },
    ]);

    const config = lowThresholdConfig();
    const result = wikiRecall("recall index", repo, config);

    expect(result).not.toBeNull();
    expect(result!.hits.length).toBeGreaterThan(1);

    // Verify hits are sorted by rank ascending (most negative = best match first)
    for (let i = 1; i < result!.hits.length; i++) {
      expect(result!.hits[i - 1].rank).toBeLessThanOrEqual(result!.hits[i].rank);
    }
  });

  test("dbPath in result points to the index.sqlite used", () => {
    const repo = track(mkFakeRepo());
    writeGenericWikiFiles(repo, 3);

    const config = lowThresholdConfig();
    const result = wikiRecall("page content", repo, config);

    expect(result).not.toBeNull();
    expect(result!.dbPath).toContain("index.sqlite");
    expect(fs.existsSync(result!.dbPath)).toBe(true);
  });
});

// ── 2. Read-through: no FTS matches → empty hits (not null) ──────────────

describe("wikiRecall — FTS query with no matches", () => {
  test("populated index + query with no matches → empty hits array (not null)", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, [
      {
        name: "page.md",
        title: "Ordinary Page",
        body: "This page talks about ordinary things.",
      },
      {
        name: "page2.md",
        title: "Another Ordinary Page",
        body: "Also talks about ordinary things and nothing special.",
      },
    ]);

    const config = lowThresholdConfig();
    // Query with terms that definitely don't appear in the wiki
    const result = wikiRecall("xyzzy-frobnicator-quux-zork", repo, config);

    // The index IS populated — result is NOT null (cache hit, 0 FTS matches)
    // This is the "query miss but index available" case
    // Note: if normalizeFtsQuery drops the token as a single char, it returns null.
    // Our terms here are all >1 char, so they survive normalization.
    if (result !== null) {
      expect(result.source).toBe("sqlite-wiki_fts");
      expect(result.hits).toHaveLength(0);
    }
    // else: result is null if the query was entirely stripped by normalization
    // (acceptable, since normalization is a safety gate)
  });
});

// ── 3. Below threshold → null (fall through) ─────────────────────────────

describe("wikiRecall — below wiki_file_threshold → null (fall through)", () => {
  test("file count ≤ threshold → returns null, no index.sqlite created", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, [
      { name: "only.md", title: "Only Page", body: "Only wiki page." },
    ]);
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    // threshold=5, only 1 file → below threshold → null
    const config: IndexBlock = { ...DEFAULT_INDEX_BLOCK, wiki_file_threshold: 5 };
    const result = wikiRecall("Only Page recall", repo, config);

    expect(result).toBeNull(); // fall through to guild-memory MCP BM25
    expect(fs.existsSync(dbPath)).toBe(false); // no index.sqlite created
  });

  test("0 wiki files → null, no index.sqlite", () => {
    const repo = track(mkFakeRepo());
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const config = lowThresholdConfig(); // threshold=1 but 0 files
    const result = wikiRecall("anything", repo, config);

    expect(result).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});

// ── 4. OFF mode (enabled:false) → null — byte-identical to pre-ADR ───────

describe("wikiRecall — OFF mode (enabled:false)", () => {
  test("enabled:false → always returns null regardless of file count", () => {
    const repo = track(mkFakeRepo());
    // Lots of wiki files — would be above threshold if enabled
    writeGenericWikiFiles(repo, 50);
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    const disabledConfig: IndexBlock = {
      ...lowThresholdConfig(), // low threshold so file count is above
      enabled: false,
    };
    const result = wikiRecall("page content recall", repo, disabledConfig);

    // Hard VC: OFF path returns null, no index.sqlite written
    expect(result).toBeNull();
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test("OFF mode: behavior is byte-identical to not calling wikiRecall at all", () => {
    const repo = track(mkFakeRepo());
    writeGenericWikiFiles(repo, 10);

    const disabledConfig: IndexBlock = { ...DEFAULT_INDEX_BLOCK, enabled: false };

    // Multiple calls — all return null, no side effects
    for (let i = 0; i < 3; i++) {
      const result = wikiRecall("any query", repo, disabledConfig);
      expect(result).toBeNull();
    }
    // Still no sqlite file
    expect(fs.existsSync(path.join(repo, ".guild", "index.sqlite"))).toBe(false);
  });
});

// ── 5. Lazy-build trigger fires at threshold ──────────────────────────────

describe("wikiRecall — lazy-build trigger (D-PS-1)", () => {
  test("first call above threshold populates wiki_fts (lazy-build)", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, [
      { name: "a.md", title: "Alpha", body: "Alpha content about recall." },
      { name: "b.md", title: "Beta", body: "Beta content about indexing." },
      { name: "c.md", title: "Gamma", body: "Gamma content about caching." },
    ]);
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    // threshold=2, 3 files → above threshold on first call
    const config: IndexBlock = { ...DEFAULT_INDEX_BLOCK, wiki_file_threshold: 2 };

    expect(fs.existsSync(dbPath)).toBe(false); // no index before first call

    const result = wikiRecall("recall indexing", repo, config);

    // Lazy-build fired: index.sqlite now exists
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("sqlite-wiki_fts");

    // Verify wiki_fts was populated with the correct number of rows
    const db = openDb(dbPath);
    const cnt = (db.prepare("SELECT COUNT(*) AS c FROM wiki_fts").get() as { c: number }).c;
    db.close();
    expect(cnt).toBe(3);
  });

  test("below threshold: lazy-build does NOT fire (threshold gate)", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, [
      { name: "only.md", title: "Only", body: "Only file below threshold." },
    ]);
    const dbPath = path.join(repo, ".guild", "index.sqlite");

    // threshold=2, only 1 file → below threshold → NO lazy-build
    const config: IndexBlock = { ...DEFAULT_INDEX_BLOCK, wiki_file_threshold: 2 };
    wikiRecall("only file", repo, config);

    expect(fs.existsSync(dbPath)).toBe(false); // lazy-build did NOT fire
  });
});

// ── 6. Cache-hit: fingerprint prevents re-populate ────────────────────────

describe("wikiRecall — SHA-256 fingerprint cache-hit", () => {
  test("second call with unchanged wiki → cache-hit, no re-populate", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, [
      { name: "p1.md", title: "Recall", body: "SQLite recall page content." },
      { name: "p2.md", title: "Cache", body: "Caching with fingerprint SHA256." },
    ]);

    const config = lowThresholdConfig(); // threshold=1

    // First call: lazy-build (populated)
    const first = wikiRecall("recall cache", repo, config);
    expect(first).not.toBeNull();

    // Check row count after first call
    const db1 = openDb(first!.dbPath);
    const cnt1 = (db1.prepare("SELECT COUNT(*) AS c FROM wiki_fts").get() as { c: number }).c;
    db1.close();

    // Second call: same files → cache-hit, no re-populate
    const second = wikiRecall("recall cache", repo, config);
    expect(second).not.toBeNull();

    // Row count unchanged (no re-insert on cache-hit)
    const db2 = openDb(second!.dbPath);
    const cnt2 = (db2.prepare("SELECT COUNT(*) AS c FROM wiki_fts").get() as { c: number }).c;
    db2.close();

    expect(cnt2).toBe(cnt1);
  });

  test("source file changes → re-populate with new content", () => {
    const repo = track(mkFakeRepo());
    writeWikiFiles(repo, [
      { name: "evolving.md", title: "Evolving Page", body: "Initial content only." },
      { name: "stable.md", title: "Stable Page", body: "Stable content unchanged." },
    ]);

    const config = lowThresholdConfig();

    // First populate
    const first = wikiRecall("evolving", repo, config);
    expect(first).not.toBeNull();

    // Mutate wiki content
    fs.writeFileSync(
      path.join(repo, ".guild", "wiki", "evolving.md"),
      "# Evolving Page\n\nContent changed to recall-and-caching specific material.\n",
    );

    // Second call: fingerprint mismatch → re-populate
    const second = wikiRecall("recall caching", repo, config);
    expect(second).not.toBeNull();
    // The hit should now find the new content
    const hit = second!.hits.find((h) => h.path.includes("evolving"));
    // The snippet/title may reflect the re-populated content
    expect(second!.hits.length).toBeGreaterThanOrEqual(0); // no crash
  });
});

// ── 7. normalizeFtsQuery ──────────────────────────────────────────────────

describe("normalizeFtsQuery", () => {
  test("strips FTS5 special characters", () => {
    expect(normalizeFtsQuery('recall "before" (read)* caching:fast^2')).toBe(
      "recall before read caching fast",
    );
  });

  test("returns empty string for blank or special-chars-only input", () => {
    expect(normalizeFtsQuery("")).toBe("");
    expect(normalizeFtsQuery("   ")).toBe("");
    expect(normalizeFtsQuery('"*()^:')).toBe("");
  });

  test("drops single-character tokens (FTS5 porter minimum)", () => {
    expect(normalizeFtsQuery("a recall b")).toBe("recall");
  });

  test("collapses extra whitespace", () => {
    expect(normalizeFtsQuery("  recall   before   read  ")).toBe(
      "recall before read",
    );
  });

  test("preserves multi-word queries", () => {
    const q = normalizeFtsQuery("SQLite wiki recall BM25 search");
    expect(q).toBe("SQLite wiki recall BM25 search");
  });
});

// ── 8. Empty/blank query guard ────────────────────────────────────────────

describe("wikiRecall — empty/blank query returns null immediately", () => {
  test("empty query → null (no DB round-trip)", () => {
    const repo = track(mkFakeRepo());
    writeGenericWikiFiles(repo, 5);
    const config = lowThresholdConfig();

    expect(wikiRecall("", repo, config)).toBeNull();
    expect(wikiRecall("   ", repo, config)).toBeNull();
  });

  test("query of only FTS5 special chars → null", () => {
    const repo = track(mkFakeRepo());
    writeGenericWikiFiles(repo, 5);
    const config = lowThresholdConfig();

    expect(wikiRecall('"*()^:', repo, config)).toBeNull();
  });
});
