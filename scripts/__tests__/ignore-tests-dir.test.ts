/**
 * scripts/__tests__/ignore-tests-dir.test.ts
 *
 * L17 — RED-FIRST regression tests for codex L13-B2 residual:
 * `tests/`, `test/`, `__tests__/` directories were NOT in DEFAULT_IGNORE_PATTERNS,
 * allowing test-material nodes (43 nodes in L12 re-run sourced from plugin tests/)
 * to pollute the knowledge graph.
 *
 * Fix: add "tests/", "test/", "__tests__/" to DEFAULT_IGNORE_PATTERNS so the
 * shared policy (discoverFilePaths + cost-gate walkRepo) excludes test material.
 *
 * RED before fix: assertions at BLOCKER-tests-excl will fail because `tests/`
 * paths are walked and discovered. GREEN after `ignore.ts` change.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { DEFAULT_IGNORE_PATTERNS, createIgnoreFilter } from "../learn/lib/ignore";
import { walkRepo } from "../learn/lib/walk";
import { discoverFilePaths } from "../learn/knowledge-orchestrator";

// ---------------------------------------------------------------------------
// Temp repo lifecycle
// ---------------------------------------------------------------------------

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
function mkTmpRepo(prefix = "guild-ignore-tests-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
}
function write(repo: string, rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// ---------------------------------------------------------------------------
// Section A — DEFAULT_IGNORE_PATTERNS contains the new entries
// ---------------------------------------------------------------------------

describe("Section A — DEFAULT_IGNORE_PATTERNS declares test-dir entries", () => {
  it("A1: DEFAULT_IGNORE_PATTERNS includes 'tests/'", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain("tests/");
  });

  it("A2: DEFAULT_IGNORE_PATTERNS includes 'test/'", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain("test/");
  });

  it("A3: DEFAULT_IGNORE_PATTERNS includes '__tests__/'", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain("__tests__/");
  });

  it("A4: existing fixture exclusions still present", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain("fixtures/");
    expect(DEFAULT_IGNORE_PATTERNS).toContain("testdata/");
    expect(DEFAULT_IGNORE_PATTERNS).toContain("__fixtures__/");
  });
});

// ---------------------------------------------------------------------------
// Section B — createIgnoreFilter: isIgnored returns true for test dirs
// ---------------------------------------------------------------------------

describe("Section B — createIgnoreFilter excludes test dirs (pure filter)", () => {
  let repo: string;
  beforeAll(() => {
    repo = mkTmpRepo("guild-filter-pure-");
    write(repo, "src/real.ts", "export const x = 1;");
  });

  it("B1: tests/foo.md → isIgnored true", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("tests/foo.md")).toBe(true);
  });

  it("B2: tests/boundary/README.md → isIgnored true", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("tests/boundary/README.md")).toBe(true);
  });

  it("B3: test/foo.ts → isIgnored true", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("test/foo.ts")).toBe(true);
  });

  it("B4: __tests__/foo.test.ts → isIgnored true", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("__tests__/foo.test.ts")).toBe(true);
  });

  it("B5: scripts/__tests__/bar.test.ts → isIgnored true", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("scripts/__tests__/bar.test.ts")).toBe(true);
  });

  it("B6: tests/ dir itself → isIgnored true", () => {
    const filter = createIgnoreFilter(repo);
    // walkRepo checks both rel and rel + "/" for directories
    expect(filter.isIgnored("tests")).toBe(true);
  });

  it("B7: src/real.ts → isIgnored false (legit first-party code kept)", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("src/real.ts")).toBe(false);
  });

  it("B8: docs/guide.md → isIgnored false (legit docs kept)", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("docs/guide.md")).toBe(false);
  });

  it("B9: scripts/app.ts → isIgnored false (scripts kept if not under __tests__)", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("scripts/app.ts")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section B2 — generated module-resource mirrors (src/modules/<id>/resources/**)
// are excluded (they are byte-for-byte sync:module-resources copies of first-party
// source; indexing them duplicated ~31% of the structural graph). Non-vacuous: the
// REAL module source (src/modules/<id>/workflows/**, index.ts) must stay indexed.
// ---------------------------------------------------------------------------

describe("Section B2 — createIgnoreFilter excludes generated module-resource mirrors", () => {
  let repo: string;
  beforeAll(() => {
    repo = mkTmpRepo("guild-filter-mirror-");
  });

  it("M1: DEFAULT_IGNORE_PATTERNS declares the generated-mirror pattern", () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain("src/modules/*/resources/");
  });

  it("M2: a mirrored script under resources/ → isIgnored true", () => {
    const filter = createIgnoreFilter(repo);
    expect(
      filter.isIgnored("src/modules/learning/resources/scripts/learn/lib/structural.ts"),
    ).toBe(true);
  });

  it("M3: the resources dir itself → isIgnored true", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("src/modules/knowledge/resources")).toBe(true);
    expect(filter.isIgnored("src/modules/knowledge/resources/")).toBe(true);
  });

  it("M4 (non-vacuity): real module source is KEPT — workflows/index, not under resources/", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("src/modules/kernel/workflows/identifier-tokenize.ts")).toBe(false);
    expect(filter.isIgnored("src/modules/knowledge/index.ts")).toBe(false);
    expect(filter.isIgnored("src/modules/knowledge/module.manifest.json")).toBe(false);
  });

  it("M5 (non-vacuity): canonical source the mirror copies FROM is KEPT", () => {
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("scripts/learn/lib/structural.ts")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section C — walkRepo (cost-gate corpus) excludes tests/ dirs
// ---------------------------------------------------------------------------

describe("Section C — walkRepo (cost-gate corpus) excludes tests/ dirs", () => {
  let repo: string;
  beforeAll(() => {
    repo = mkTmpRepo("guild-walkRepo-tests-");
    // First-party source (MUST be kept)
    write(repo, "src/real.ts", "export const real = 1;");
    write(repo, "docs/guide.md", "# Guide\n\nProse.");
    // Top-level tests/ dir (MUST be excluded — the L12 residual)
    write(repo, "tests/boundary/README.md", "# Boundary tests");
    write(repo, "tests/evolve/README.md", "# Evolve tests");
    write(repo, "tests/wiki-lint/README.md", "# Wiki lint tests");
    write(repo, "tests/workspace/_fixtures.ts", "export const fix = {};");
    // test/ (singular)
    write(repo, "test/util.ts", "export const util = {};");
    // Nested __tests__
    write(repo, "scripts/__tests__/some.test.ts", "test('x', () => {});");
  });

  it("C1: walkRepo result contains src/real.ts", () => {
    const { files } = walkRepo(repo, 10000);
    expect(files).toContain("src/real.ts");
  });

  it("C2: walkRepo result does NOT contain any tests/ prefixed path", () => {
    const { files } = walkRepo(repo, 10000);
    const testsPaths = files.filter((f) => f.startsWith("tests/"));
    expect(testsPaths).toHaveLength(0);
  });

  it("C3: walkRepo result does NOT contain any test/ prefixed path", () => {
    const { files } = walkRepo(repo, 10000);
    const testPaths = files.filter((f) => f.startsWith("test/"));
    expect(testPaths).toHaveLength(0);
  });

  it("C4: walkRepo result does NOT contain any __tests__ path", () => {
    const { files } = walkRepo(repo, 10000);
    const testsPaths = files.filter((f) => f.includes("__tests__"));
    expect(testsPaths).toHaveLength(0);
  });

  it("C5: walkRepo result contains docs/guide.md (legit docs kept)", () => {
    const { files } = walkRepo(repo, 10000);
    expect(files).toContain("docs/guide.md");
  });

  it("C6: cost-gate file count drops when tests/ excluded (was 676 on plugin, now lower)", () => {
    // Verifies the absolute file count changes. In the temp repo:
    // kept: src/real.ts + docs/guide.md = 2 files
    // excluded: 5 test files under tests/ test/ scripts/__tests__/
    const { files } = walkRepo(repo, 10000);
    expect(files.length).toBe(2); // only real.ts + guide.md
  });
});

// ---------------------------------------------------------------------------
// Section D — discoverFilePaths: tests/ paths NOT discovered
// ---------------------------------------------------------------------------

describe("Section D — discoverFilePaths does NOT discover tests/ paths", () => {
  let repo: string;
  beforeAll(() => {
    repo = mkTmpRepo("guild-discover-tests-");
    // First-party source (MUST be discovered)
    write(repo, "src/real.ts", "/** Real source */\nexport function real() {}");
    write(repo, "scripts/app.ts", "/** App */\nexport function app() {}");
    write(repo, "docs/guide.md", "# Guide\n\nProse.");
    // Top-level tests/ (MUST NOT be discovered)
    write(repo, "tests/boundary/README.md", "# Boundary\n");
    write(repo, "tests/workspace/_fixtures.ts", "export const fix = {};");
    // test/ singular
    write(repo, "test/util.ts", "export const util = {};");
    // Nested __tests__
    write(repo, "scripts/__tests__/some.test.ts", "test('x', () => {});");
  });

  it("D1: codeRelPaths contains src/real.ts", () => {
    const fp = discoverFilePaths(repo);
    expect(fp.codeRelPaths).toContain("src/real.ts");
  });

  it("D2: codeRelPaths contains scripts/app.ts", () => {
    const fp = discoverFilePaths(repo);
    expect(fp.codeRelPaths).toContain("scripts/app.ts");
  });

  it("D3: NO discovered path starts with tests/", () => {
    const fp = discoverFilePaths(repo);
    const all = [
      ...fp.codeRelPaths,
      ...fp.docRelPaths,
      ...(fp.svgRelPaths ?? []),
    ];
    const testsPaths = all.filter((p) => p.startsWith("tests/"));
    expect(testsPaths).toHaveLength(0);
  });

  it("D4: NO discovered path starts with test/", () => {
    const fp = discoverFilePaths(repo);
    const all = [
      ...fp.codeRelPaths,
      ...fp.docRelPaths,
      ...(fp.svgRelPaths ?? []),
    ];
    const testPaths = all.filter((p) => p.startsWith("test/"));
    expect(testPaths).toHaveLength(0);
  });

  it("D5: NO discovered path contains __tests__", () => {
    const fp = discoverFilePaths(repo);
    const all = [
      ...fp.codeRelPaths,
      ...fp.docRelPaths,
      ...(fp.svgRelPaths ?? []),
    ];
    const testPaths = all.filter((p) => p.includes("__tests__"));
    expect(testPaths).toHaveLength(0);
  });

  it("D6: docRelPaths contains docs/guide.md", () => {
    const fp = discoverFilePaths(repo);
    expect(fp.docRelPaths).toContain("docs/guide.md");
  });
});

// ---------------------------------------------------------------------------
// Section E — shared-policy symmetry: discoverFilePaths == walkRepo policy
// ---------------------------------------------------------------------------

describe("Section E — shared-policy symmetry after tests/ addition", () => {
  it("E1: every discovered code/doc file passes createIgnoreFilter(false) check", () => {
    const repo = mkTmpRepo("guild-sym-");
    write(repo, "src/real.ts", "/** Real */\nexport function real() {}");
    write(repo, "docs/guide.md", "# Guide\n\nProse.");
    write(repo, "tests/foo.md", "# Test fixture");
    write(repo, "test/bar.ts", "export const bar = 1;");

    const fp = discoverFilePaths(repo);
    const filter = createIgnoreFilter(repo);

    for (const rel of [...fp.codeRelPaths, ...fp.docRelPaths]) {
      expect(filter.isIgnored(rel)).toBe(false);
    }
  });

  it("E2: tests/ paths excluded by both discoverFilePaths and walkRepo (one policy)", () => {
    const repo = mkTmpRepo("guild-onepolicy-");
    write(repo, "src/real.ts", "export const x = 1;");
    write(repo, "tests/foo.md", "# Test fixture");
    write(repo, "tests/workspace/_fixtures.ts", "export const fix = {};");

    const fp = discoverFilePaths(repo);
    const { files } = walkRepo(repo, 10000);

    // Neither discoverer nor walker sees tests/ paths
    const allDiscovered = [...fp.codeRelPaths, ...fp.docRelPaths, ...(fp.svgRelPaths ?? [])];
    expect(allDiscovered.some((p) => p.startsWith("tests/"))).toBe(false);
    expect(files.some((p) => p.startsWith("tests/"))).toBe(false);

    // Both see src/real.ts
    expect(allDiscovered).toContain("src/real.ts");
    expect(files).toContain("src/real.ts");
  });

  it("E3: no legit dir over-excluded — scripts/ (non-test) still walked", () => {
    const repo = mkTmpRepo("guild-notover-");
    write(repo, "scripts/app.ts", "export function app() {}");
    write(repo, "scripts/__tests__/app.test.ts", "test('x', () => {});");

    const { files } = walkRepo(repo, 10000);

    // scripts/app.ts kept (scripts/ is not excluded)
    expect(files).toContain("scripts/app.ts");
    // scripts/__tests__/ excluded
    expect(files.some((f) => f.includes("__tests__"))).toBe(false);
  });
});
