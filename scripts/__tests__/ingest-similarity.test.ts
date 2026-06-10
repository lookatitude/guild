/**
 * scripts/__tests__/ingest-similarity.test.ts
 *
 * D-INGEST-GATE (Wave-3 security) — TDD suite for ingest-similarity.ts.
 *
 * All integration tests use real on-disk fixtures (no injected seams) per the
 * "injected-seam tests mask real-path misses" discipline. Temp directories are
 * created with mkdtempSync and removed in afterEach.
 *
 * Required test cases (from spec wave3-dingest-gate-bm25.md):
 *   1. dup→pause:         near-duplicate candidate scores >> gate → should_pause = true
 *   2. novel→pass:        novel candidate has 0 token overlap → should_pause = false
 *   3. category-scoped:   similar page in different category → no match → should_pause = false
 *   4. config-threshold:  moderate-overlap candidate; low gate in settings.json → pauses;
 *                         default gate (0.80) → passes
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  tokenize,
  bm25Score,
  readIngestGate,
  ingestSimilarity,
  normalizeCategory,
  IngestCandidate,
} from "../lib/ingest-similarity";
// Real BM25 parity: import guild-memory's bm25Score from the pure utility module
// (not index.ts — that would start the MCP server).
import {
  tokenize as gmTokenize,
  bm25Score as gmBm25Score,
} from "../../mcp-servers/guild-memory/src/bm25";

const INGEST_SIMILARITY_SCRIPT = path.resolve(__dirname, "../lib/ingest-similarity.ts");

function runIngestSimilarityCLI(
  args: string[],
  extraEnv: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync(
    "npx",
    ["tsx", INGEST_SIMILARITY_SCRIPT, ...args],
    {
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
      timeout: 15_000,
    },
  );
  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-ingest-sim-test-"));
}

function mkdir(base: string, ...parts: string[]): void {
  fs.mkdirSync(path.join(base, ...parts), { recursive: true });
}

function writeFile(base: string, relPath: string, content: string): void {
  const abs = path.join(base, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function writeSettings(base: string, gate: number): void {
  writeFile(base, ".guild/settings.json", JSON.stringify({ models: { ingestSimilarityGate: gate } }));
}

// ── tokenize() ────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumeric", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });

  it("filters tokens of length <= 1", () => {
    // Single-char tokens like "a", "I" are excluded
    expect(tokenize("a I do it")).toEqual(["do", "it"]);
  });

  it("includes numbers with length > 1", () => {
    expect(tokenize("v2 api 42")).toEqual(["v2", "api", "42"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("deduplication NOT applied — repeated tokens appear multiple times", () => {
    const tokens = tokenize("foo foo bar");
    expect(tokens).toEqual(["foo", "foo", "bar"]);
  });
});

// ── bm25Score() ───────────────────────────────────────────────────────────────

describe("bm25Score", () => {
  it("returns empty array for empty docs", () => {
    expect(bm25Score(["hello"], [])).toEqual([]);
  });

  it("returns 0 score when no query token matches", () => {
    const docs = [{ tokens: ["foo", "bar"] }];
    const scores = bm25Score(["baz", "qux"], docs);
    expect(scores).toHaveLength(1);
    expect(scores[0]).toBe(0);
  });

  it("returns positive score when query token is in the document", () => {
    const docs = [{ tokens: ["authentication", "module", "configure"] }];
    const scores = bm25Score(["authentication"], docs);
    expect(scores[0]).toBeGreaterThan(0);
  });

  it("scores higher for near-duplicate than partial-overlap", () => {
    const tokens = ["configure", "authentication", "module", "settings", "system"];
    const docs = [
      { tokens },
      { tokens: ["configure", "authentication", "other", "stuff", "here"] },
    ];
    const query = ["configure", "authentication", "module", "settings", "system"];
    const scores = bm25Score(query, docs);
    expect(scores[0]).toBeGreaterThan(scores[1]);
  });

  it("real BM25 parity: produces the SAME score as guild-memory's bm25Score on identical input", () => {
    // Import both implementations and assert byte-identical scores on a shared
    // multi-token, multi-document corpus — this is REAL parity, not a formula
    // smoke test. The two tokenizers must also agree.
    const DOCS = [
      { tokens: tokenize("configure authentication module settings system") },
      { tokens: tokenize("database replication backup restore snapshot") },
      { tokens: tokenize("authentication token refresh credentials session") },
    ];
    const GM_DOCS = [
      { tokens: gmTokenize("configure authentication module settings system") },
      { tokens: gmTokenize("database replication backup restore snapshot") },
      { tokens: gmTokenize("authentication token refresh credentials session") },
    ];
    const QUERY = tokenize("authentication configure");
    const GM_QUERY = gmTokenize("authentication configure");

    // Tokenizers must agree
    expect(QUERY).toEqual(GM_QUERY);
    expect(DOCS.map((d) => d.tokens)).toEqual(GM_DOCS.map((d) => d.tokens));

    // Scores must be identical to floating-point precision
    const scores = bm25Score(QUERY, DOCS);
    const gmScores = gmBm25Score(GM_QUERY, GM_DOCS);
    expect(scores).toHaveLength(gmScores.length);
    for (let i = 0; i < scores.length; i++) {
      expect(scores[i]).toBeCloseTo(gmScores[i]!, 12);
    }
  });
});

// ── normalizeCategory() ───────────────────────────────────────────────────────
//
// Verifies that every singular hint from wiki-ingest SKILL.md maps to the
// correct plural canonical directory, and that already-plural / special cases
// pass through unchanged.

describe("normalizeCategory", () => {
  it.each([
    // singular hint → plural canonical dir (the actual .guild/wiki/<dir>/ on disk)
    ["standard", "standards"],
    ["product", "products"],
    ["entity", "entities"],
    ["concept", "concepts"],
    ["source", "sources"],
  ])("maps singular '%s' → '%s'", (singular, plural) => {
    expect(normalizeCategory(singular)).toBe(plural);
  });

  it.each([
    // already-plural forms pass through unchanged
    "standards", "products", "entities", "concepts", "sources",
    // singular-and-canonical forms pass through unchanged
    "decisions", "context",
    // arbitrary/unknown slugs pass through
    "custom-category",
  ])("passes through '%s' unchanged", (slug) => {
    expect(normalizeCategory(slug)).toBe(slug);
  });

  it("is case-insensitive for the standard singular hints", () => {
    expect(normalizeCategory("Concept")).toBe("concepts");
    expect(normalizeCategory("STANDARD")).toBe("standards");
    expect(normalizeCategory("Entity")).toBe("entities");
  });
});

// ── readIngestGate() ──────────────────────────────────────────────────────────

describe("readIngestGate", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmpRepo();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns default 0.80 when .guild/settings.json does not exist", () => {
    expect(readIngestGate(tmpDir)).toBe(0.80);
  });

  it("returns default 0.80 when models.ingestSimilarityGate is absent", () => {
    writeFile(tmpDir, ".guild/settings.json", JSON.stringify({ models: {} }));
    expect(readIngestGate(tmpDir)).toBe(0.80);
  });

  it("returns the configured value when valid", () => {
    writeSettings(tmpDir, 0.60);
    expect(readIngestGate(tmpDir)).toBe(0.60);
  });

  it("accepts boundary values 0 and 1", () => {
    writeSettings(tmpDir, 0);
    expect(readIngestGate(tmpDir)).toBe(0);
    writeSettings(tmpDir, 1);
    expect(readIngestGate(tmpDir)).toBe(1);
  });

  it("returns default 0.80 when value is outside [0,1]", () => {
    writeFile(tmpDir, ".guild/settings.json", JSON.stringify({ models: { ingestSimilarityGate: 1.5 } }));
    expect(readIngestGate(tmpDir)).toBe(0.80);
    writeFile(tmpDir, ".guild/settings.json", JSON.stringify({ models: { ingestSimilarityGate: -0.1 } }));
    expect(readIngestGate(tmpDir)).toBe(0.80);
  });

  it("returns default 0.80 when settings.json is malformed JSON", () => {
    writeFile(tmpDir, ".guild/settings.json", "not { json");
    expect(readIngestGate(tmpDir)).toBe(0.80);
  });
});

// ── ingestSimilarity() — integration tests ───────────────────────────────────

describe("ingestSimilarity", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpRepo();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. dup → pause ──────────────────────────────────────────────────────────
  //
  // A candidate that is a near-duplicate of the existing page should produce a
  // BM25 score well above the default gate (0.80).
  //
  // Computed by hand (see bm25Score parity test above):
  //   Existing page "existing.md" → title="existing" (2x) + content tokens.
  //   Candidate uses same title+content → all tokens match → score ≈ 2.26 >> 0.80.

  describe("dup → pause", () => {
    const CONTENT = "configure authentication module settings system";

    it("scores well above default gate for a near-duplicate candidate", () => {
      mkdir(tmpDir, ".guild", "wiki", "decisions");
      writeFile(tmpDir, ".guild/wiki/decisions/existing.md", CONTENT);

      const candidate: IngestCandidate = { title: "existing", content: CONTENT };
      const result = ingestSimilarity(tmpDir, candidate, "decisions");

      expect(result.gate).toBe(0.80);
      expect(result.top_score).toBeGreaterThan(result.gate);
      expect(result.should_pause).toBe(true);
      expect(result.top_path).toBe(path.join(".guild", "wiki", "decisions", "existing.md"));
    });

    it("identifies the most-similar page as top_path", () => {
      mkdir(tmpDir, ".guild", "wiki", "decisions");
      // Two pages: one is a near-duplicate, one is unrelated
      writeFile(tmpDir, ".guild/wiki/decisions/existing.md", CONTENT);
      writeFile(tmpDir, ".guild/wiki/decisions/unrelated.md",
        "database index replication backup restore");

      const candidate: IngestCandidate = { title: "existing", content: CONTENT };
      const result = ingestSimilarity(tmpDir, candidate, "decisions");

      expect(result.should_pause).toBe(true);
      expect(result.top_path).toContain("existing.md");
    });
  });

  // ── 2. novel → pass ─────────────────────────────────────────────────────────
  //
  // A candidate with completely different vocabulary shares no tokens with any
  // existing page → BM25 score = 0 < gate → should_pause = false.

  describe("novel → pass", () => {
    it("scores 0 and does not pause when vocabulary is completely disjoint", () => {
      mkdir(tmpDir, ".guild", "wiki", "decisions");
      writeFile(tmpDir, ".guild/wiki/decisions/existing.md",
        "configure authentication module settings system");

      const candidate: IngestCandidate = {
        title: "database performance",
        content: "query optimization index statistics cache eviction",
      };
      const result = ingestSimilarity(tmpDir, candidate, "decisions");

      expect(result.top_score).toBe(0);
      expect(result.should_pause).toBe(false);
      expect(result.gate).toBe(0.80);
    });

    it("returns top_path=null when no tokens match any existing page", () => {
      mkdir(tmpDir, ".guild", "wiki", "decisions");
      writeFile(tmpDir, ".guild/wiki/decisions/existing.md",
        "configure authentication module settings system");

      const candidate: IngestCandidate = {
        title: "database performance",
        content: "query optimization index statistics cache eviction",
      };
      const result = ingestSimilarity(tmpDir, candidate, "decisions");

      expect(result.top_path).toBeNull();
    });
  });

  // ── 3. category-scoped ─────────────────────────────────────────────────────
  //
  // A similar page exists in "decisions" but the gate is called for category
  // "context". No pages in "context" → score = 0 → no pause.
  // Verifies that cross-category contamination does NOT occur.

  describe("category-scoped", () => {
    const CONTENT = "configure authentication module settings system";

    it("does not trip the gate when the matching page is in a different category", () => {
      // Put a near-duplicate in "decisions"
      mkdir(tmpDir, ".guild", "wiki", "decisions");
      writeFile(tmpDir, ".guild/wiki/decisions/existing.md", CONTENT);
      // The target category "context" is empty
      mkdir(tmpDir, ".guild", "wiki", "context");

      const candidate: IngestCandidate = { title: "existing", content: CONTENT };
      // Gate against "context", not "decisions"
      const result = ingestSimilarity(tmpDir, candidate, "context");

      expect(result.top_score).toBe(0);
      expect(result.should_pause).toBe(false);
      expect(result.top_path).toBeNull();
    });

    it("does trip the gate when the same candidate is compared against the correct category", () => {
      mkdir(tmpDir, ".guild", "wiki", "decisions");
      writeFile(tmpDir, ".guild/wiki/decisions/existing.md", CONTENT);

      const candidate: IngestCandidate = { title: "existing", content: CONTENT };
      const inDecisions = ingestSimilarity(tmpDir, candidate, "decisions");
      const inContext = ingestSimilarity(tmpDir, candidate, "context");

      expect(inDecisions.should_pause).toBe(true);
      expect(inContext.should_pause).toBe(false);
    });

    it("returns 0 score and no pause when the category directory does not exist", () => {
      // No wiki dir at all
      const candidate: IngestCandidate = { title: "existing", content: CONTENT };
      const result = ingestSimilarity(tmpDir, candidate, "nonexistent");

      expect(result.top_score).toBe(0);
      expect(result.should_pause).toBe(false);
      expect(result.top_path).toBeNull();
    });
  });

  // ── 4. config-threshold ───────────────────────────────────────────────────
  //
  // A candidate with moderate token overlap (1 shared unique token: "authentication",
  // appearing 2× in candidate tokens due to title-doubling) scores ≈ 0.576 with
  // N=1 and the parity constants (k1=1.5, b=0.75).
  //
  //   Computed manually:
  //     Existing page "source.md" (title "source" 2x + content):
  //       tokens: ["source","source","security","authentication","credentials","token","access"]
  //       dl = 7, avgdl = 7
  //     Candidate: title "authentication process" (2x) + content "for new users"
  //       queryTokens: ["authentication","process","authentication","process","for","new","users"]
  //     Only "authentication" overlaps (df=1 in N=1 corpus):
  //       idf = log(4/3) ≈ 0.2877
  //       per hit: tf=1 in doc, dl/avgdl=1 → 0.2877 * 1.0 = 0.2877
  //       "authentication" appears 2× in query → total = 2 * 0.2877 ≈ 0.5754
  //
  //   With default gate 0.80: 0.5754 < 0.80 → should_pause = false
  //   With gate 0.40 from settings.json: 0.5754 >= 0.40 → should_pause = true

  describe("config-threshold", () => {
    const EXISTING_CONTENT = "security authentication credentials token access";
    const CANDIDATE: IngestCandidate = {
      title: "authentication process",
      content: "for new users",
    };
    const CATEGORY = "context";

    it("does not pause with default gate (0.80) for moderate-overlap candidate", () => {
      mkdir(tmpDir, ".guild", "wiki", CATEGORY);
      writeFile(tmpDir, `.guild/wiki/${CATEGORY}/source.md`, EXISTING_CONTENT);
      // No settings.json — default 0.80 applies

      const result = ingestSimilarity(tmpDir, CANDIDATE, CATEGORY);

      expect(result.gate).toBe(0.80);
      // Score ≈ 0.576: below default 0.80 → no pause
      expect(result.top_score).toBeGreaterThan(0);    // some overlap
      expect(result.top_score).toBeLessThan(0.80);     // but below default gate
      expect(result.should_pause).toBe(false);
    });

    it("pauses when gate is lowered below the actual score", () => {
      mkdir(tmpDir, ".guild", "wiki", CATEGORY);
      writeFile(tmpDir, `.guild/wiki/${CATEGORY}/source.md`, EXISTING_CONTENT);
      // Lower gate to 0.40 (score ≈ 0.576 ≥ 0.40)
      writeSettings(tmpDir, 0.40);

      const result = ingestSimilarity(tmpDir, CANDIDATE, CATEGORY);

      expect(result.gate).toBe(0.40);
      expect(result.top_score).toBeGreaterThanOrEqual(0.40);
      expect(result.should_pause).toBe(true);
    });

    it("gate is surfaced in the result so the operator can see the threshold", () => {
      mkdir(tmpDir, ".guild", "wiki", CATEGORY);
      writeFile(tmpDir, `.guild/wiki/${CATEGORY}/source.md`, EXISTING_CONTENT);
      writeSettings(tmpDir, 0.55);

      const result = ingestSimilarity(tmpDir, CANDIDATE, CATEGORY);
      expect(result.gate).toBe(0.55);
    });
  });

  // ── category normalization: singular hints resolve to plural dirs ──────────
  //
  // D-INGEST MAJOR fix: before the fix, `--category concept` scanned
  // `.guild/wiki/concept/` (non-existent) → 0 pages → should_pause:false ALWAYS.
  // After the fix, `normalizeCategory` maps each singular hint to its plural
  // canonical directory. This test ensures each of the 5 pairs works end-to-end:
  // a near-dup page written to the PLURAL dir is found when the SINGULAR hint
  // is passed.

  describe("category normalization — singular hint resolves to plural dir", () => {
    const NEAR_DUP_CONTENT = "configure authentication module settings system workflow pipeline deployment";

    it.each([
      ["standard", "standards"],
      ["product", "products"],
      ["entity", "entities"],
      ["concept", "concepts"],
      ["source", "sources"],
    ])(
      "singular '%s' → finds near-dup page in '%s/' → should_pause:true",
      (singularHint, pluralDir) => {
        // Write the near-dup in the PLURAL canonical dir
        mkdir(tmpDir, ".guild", "wiki", pluralDir);
        writeFile(tmpDir, `.guild/wiki/${pluralDir}/existing.md`, NEAR_DUP_CONTENT);

        // Pass the SINGULAR hint (as wiki-ingest SKILL.md does)
        const candidate: IngestCandidate = {
          title: "existing",
          content: NEAR_DUP_CONTENT,
        };
        const result = ingestSimilarity(tmpDir, candidate, singularHint);

        expect(result.should_pause).toBe(true);
        expect(result.top_score).toBeGreaterThan(result.gate);
        expect(result.top_path).toContain(pluralDir);
        expect(result.top_path).toContain("existing.md");
      },
    );

    it("singular 'concept' → EMPTY dir → should_pause:false (gate open for truly-new category)", () => {
      // Verify a non-existent category still returns false (no false positive)
      const result = ingestSimilarity(
        tmpDir,
        { title: "existing", content: NEAR_DUP_CONTENT },
        "concept",
      );
      expect(result.should_pause).toBe(false);
      expect(result.top_score).toBe(0);
    });

    it("plural 'concepts' still works after normalization (pass-through)", () => {
      mkdir(tmpDir, ".guild", "wiki", "concepts");
      writeFile(tmpDir, ".guild/wiki/concepts/existing.md", NEAR_DUP_CONTENT);

      const result = ingestSimilarity(
        tmpDir,
        { title: "existing", content: NEAR_DUP_CONTENT },
        "concepts",
      );
      expect(result.should_pause).toBe(true);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns 0 score and no pause for an empty candidate", () => {
      mkdir(tmpDir, ".guild", "wiki", "decisions");
      writeFile(tmpDir, ".guild/wiki/decisions/page.md", "authentication configure module");

      const result = ingestSimilarity(tmpDir, { title: "", content: "" }, "decisions");
      expect(result.top_score).toBe(0);
      expect(result.should_pause).toBe(false);
    });

    it("returns 0 score and no pause when category has no .md files", () => {
      mkdir(tmpDir, ".guild", "wiki", "empty");
      writeFile(tmpDir, ".guild/wiki/empty/not-markdown.txt", "some content");

      const result = ingestSimilarity(tmpDir, { title: "foo", content: "bar baz" }, "empty");
      expect(result.top_score).toBe(0);
      expect(result.should_pause).toBe(false);
      expect(result.top_path).toBeNull();
    });

    it("uses the highest-scoring page as top_path when multiple pages exist", () => {
      mkdir(tmpDir, ".guild", "wiki", "decisions");
      writeFile(tmpDir, ".guild/wiki/decisions/close.md",
        "configure authentication module settings system");
      writeFile(tmpDir, ".guild/wiki/decisions/far.md",
        "database replication backup restore snapshot");

      const candidate: IngestCandidate = {
        title: "configure",
        content: "authentication module",
      };
      const result = ingestSimilarity(tmpDir, candidate, "decisions");

      expect(result.top_path).toContain("close.md");
    });
  });
});

// ── CLI entry: real invocation via spawnSync ──────────────────────────────────
//
// Exercises the `if (require.main === module)` CLI path end-to-end.
// Uses real on-disk fixtures — no injected seams (per discipline).
// These are the two required spec cases for the D-INGEST CLI:
//   - near-dup fixture → JSON with should_pause: true
//   - novel fixture → JSON with should_pause: false

describe("ingest-similarity CLI", () => {
  let tmpDir: string;
  let contentFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ingest-cli-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("near-duplicate candidate: exits 0 and returns should_pause:true", () => {
    // Existing page in "decisions" with known content
    const CONTENT = "configure authentication module settings system workflow pipeline";
    fs.mkdirSync(path.join(tmpDir, ".guild", "wiki", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".guild", "wiki", "decisions", "existing.md"), CONTENT, "utf8");

    // Write the candidate to a temp content file
    contentFile = path.join(tmpDir, "candidate.txt");
    fs.writeFileSync(contentFile, CONTENT, "utf8");

    const { exitCode, stdout, stderr } = runIngestSimilarityCLI([
      "--cwd", tmpDir,
      "--category", "decisions",
      "--title", "existing",
      "--content-file", contentFile,
    ]);

    expect(exitCode).toBe(0);
    // stderr may contain benign Node.js deprecation warnings from tsx — only fail on script errors
    expect(stderr).not.toContain("[ingest-similarity] ERROR");

    const result = JSON.parse(stdout.trim()) as { top_score: number; should_pause: boolean; gate: number; top_path: string | null };
    expect(result.should_pause).toBe(true);
    expect(result.top_score).toBeGreaterThan(result.gate);
    expect(result.top_path).toContain("existing.md");
  });

  it("novel candidate: exits 0 and returns should_pause:false", () => {
    // Existing page in "decisions" with completely unrelated vocabulary
    fs.mkdirSync(path.join(tmpDir, ".guild", "wiki", "decisions"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".guild", "wiki", "decisions", "auth.md"),
      "configure authentication module settings system workflow pipeline",
      "utf8",
    );

    // Candidate with completely different vocabulary (no token overlap)
    contentFile = path.join(tmpDir, "novel.txt");
    fs.writeFileSync(contentFile, "database replication backup restore snapshot sharding cluster", "utf8");

    const { exitCode, stdout, stderr } = runIngestSimilarityCLI([
      "--cwd", tmpDir,
      "--category", "decisions",
      "--title", "database performance",
      "--content-file", contentFile,
    ]);

    expect(exitCode).toBe(0);
    // stderr may contain benign Node.js deprecation warnings from tsx — only fail on script errors
    expect(stderr).not.toContain("[ingest-similarity] ERROR");

    const result = JSON.parse(stdout.trim()) as { top_score: number; should_pause: boolean };
    expect(result.should_pause).toBe(false);
    expect(result.top_score).toBe(0);
  });

  it("exits 1 and prints an error when --category is absent", () => {
    const { exitCode, stderr } = runIngestSimilarityCLI([
      "--cwd", tmpDir,
      "--title", "some title",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--category");
  });

  // ── CLI: singular category hint resolves to plural dir ─────────────────────
  //
  // This is the primary regression test for the D-INGEST MAJOR fix:
  // Before the fix, `--category concept` would scan `.guild/wiki/concept/`
  // (non-existent) and return should_pause:false even with a near-dup in concepts/.
  // After the fix: normalizeCategory maps the hint before scanning.

  it("CLI: --category concept with near-dup in concepts/ → should_pause:true", () => {
    const CONTENT = "configure authentication module settings system workflow pipeline deployment";
    fs.mkdirSync(path.join(tmpDir, ".guild", "wiki", "concepts"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".guild", "wiki", "concepts", "existing.md"),
      CONTENT, "utf8",
    );

    contentFile = path.join(tmpDir, "candidate.txt");
    fs.writeFileSync(contentFile, CONTENT, "utf8");

    const { exitCode, stdout, stderr } = runIngestSimilarityCLI([
      "--cwd", tmpDir,
      "--category", "concept",       // SINGULAR hint (as wiki-ingest SKILL.md passes)
      "--title", "existing",
      "--content-file", contentFile,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("[ingest-similarity] ERROR");

    const result = JSON.parse(stdout.trim()) as {
      top_score: number; should_pause: boolean; gate: number; top_path: string | null;
    };
    expect(result.should_pause).toBe(true);
    expect(result.top_path).toContain("concepts");
    expect(result.top_path).toContain("existing.md");
  });

  it("CLI: --category standard with near-dup in standards/ → should_pause:true", () => {
    const CONTENT = "configure authentication module settings system workflow pipeline deployment";
    fs.mkdirSync(path.join(tmpDir, ".guild", "wiki", "standards"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".guild", "wiki", "standards", "existing.md"),
      CONTENT, "utf8",
    );

    contentFile = path.join(tmpDir, "candidate.txt");
    fs.writeFileSync(contentFile, CONTENT, "utf8");

    const { exitCode, stdout } = runIngestSimilarityCLI([
      "--cwd", tmpDir,
      "--category", "standard",      // SINGULAR hint
      "--title", "existing",
      "--content-file", contentFile,
    ]);

    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout.trim()) as { should_pause: boolean; top_path: string | null };
    expect(result.should_pause).toBe(true);
    expect(result.top_path).toContain("standards");
  });
});
