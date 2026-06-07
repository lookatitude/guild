/**
 * scripts/__tests__/fs-scanner.test.ts
 *
 * TDD suite for scripts/lib/fs-scanner.ts (R-019d — FDC-13 fallback_reader).
 *
 * The fs_scanner is the MCP-unavailable degradation path: a direct filesystem
 * walk of .guild/wiki/ + .guild/runs/ with naive term matching, returned in the
 * same consumer-facing shape as wiki-recall.ts (drop-in when MCP is down).
 *
 * Coverage map:
 *  - term match: a query term present in a file produces a hit for that file.
 *  - ranking order: higher term-frequency files come FIRST in the hits array
 *    (consumers rely on ARRAY ORDER, not on a rank field — per team-lead's
 *    drop-in contract; rank is not in the public hit shape).
 *  - empty-dir: a present-but-empty .guild/wiki/ yields zero hits, source set.
 *  - missing-dir tolerance: absent .guild/ entirely → returns null (caller
 *    substitutes an empty result), never throws.
 *  - title extraction: first H1 heading becomes the title; basename fallback.
 *  - case-insensitive matching.
 *  - limit: respects the opts.limit cap.
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { fsScan, type FsScanResult } from "../lib/fs-scanner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-fsscan-test-"));
}

function writeWiki(root: string, relPath: string, content: string): void {
  const full = path.join(root, ".guild", "wiki", relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function writeRun(root: string, relPath: string, content: string): void {
  const full = path.join(root, ".guild", "runs", relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// ---------------------------------------------------------------------------
// 1. Term match
// ---------------------------------------------------------------------------

describe("fsScan — term match", () => {
  it("finds a file containing the query term", () => {
    const root = makeTmpRoot();
    writeWiki(root, "caching.md", "# Caching\nThe recall caching layer uses BM25.");
    writeWiki(root, "unrelated.md", "# Unrelated\nNothing to see here.");

    const result = fsScan("caching", root);
    expect(result).not.toBeNull();
    const r = result as FsScanResult;
    expect(r.source).toBe("fs-scanner");
    const paths = r.hits.map((h) => path.basename(h.path));
    expect(paths).toContain("caching.md");
    expect(paths).not.toContain("unrelated.md");
  });

  it("matches case-insensitively", () => {
    const root = makeTmpRoot();
    writeWiki(root, "page.md", "# Page\nThe CACHING strategy is documented here.");
    const result = fsScan("caching", root);
    expect(result).not.toBeNull();
    expect((result as FsScanResult).hits.length).toBe(1);
  });

  it("scans both wiki and runs directories", () => {
    const root = makeTmpRoot();
    writeWiki(root, "w.md", "# W\nalpha term in wiki");
    writeRun(root, "run-1/notes.md", "# Notes\nalpha term in runs");
    const result = fsScan("alpha", root);
    expect(result).not.toBeNull();
    const r = result as FsScanResult;
    expect(r.hits.length).toBe(2);
    expect(r.scannedDirs.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Ranking order (array order, not rank field)
// ---------------------------------------------------------------------------

describe("fsScan — ranking order (consumers rely on array order)", () => {
  it("orders higher term-frequency files first", () => {
    const root = makeTmpRoot();
    // low-frequency: 1 mention
    writeWiki(root, "low.md", "# Low\nThe widget is here once.");
    // high-frequency: 3 mentions
    writeWiki(root, "high.md", "# High\nwidget widget widget — three widgets.");
    // medium: 2 mentions
    writeWiki(root, "medium.md", "# Medium\nwidget appears, then widget again.");

    const result = fsScan("widget", root);
    expect(result).not.toBeNull();
    const ordered = (result as FsScanResult).hits.map((h) => path.basename(h.path));
    // Array order is the contract: most relevant (highest TF) first.
    expect(ordered[0]).toBe("high.md");
    expect(ordered[1]).toBe("medium.md");
    expect(ordered[2]).toBe("low.md");
  });

  it("does NOT expose a rank field on the public hit shape", () => {
    const root = makeTmpRoot();
    writeWiki(root, "a.md", "# A\nterm term");
    const result = fsScan("term", root);
    const hit = (result as FsScanResult).hits[0];
    // The public contract is path/title/snippet only — rank is internal.
    expect(hit).toHaveProperty("path");
    expect(hit).toHaveProperty("title");
    expect(hit).toHaveProperty("snippet");
    expect(hit).not.toHaveProperty("rank");
  });
});

// ---------------------------------------------------------------------------
// 3. Empty-dir + missing-dir tolerance
// ---------------------------------------------------------------------------

describe("fsScan — empty + missing dir tolerance", () => {
  it("present-but-empty wiki dir yields zero hits (not null)", () => {
    const root = makeTmpRoot();
    fs.mkdirSync(path.join(root, ".guild", "wiki"), { recursive: true });
    const result = fsScan("anything", root);
    expect(result).not.toBeNull();
    const r = result as FsScanResult;
    expect(r.hits).toEqual([]);
    expect(r.source).toBe("fs-scanner");
  });

  it("returns null when NO target dirs exist at all", () => {
    const root = makeTmpRoot(); // no .guild/ created
    const result = fsScan("anything", root);
    expect(result).toBeNull();
  });

  it("tolerates a missing runs dir when wiki exists", () => {
    const root = makeTmpRoot();
    writeWiki(root, "only.md", "# Only\nbeta term present");
    // no runs dir
    const result = fsScan("beta", root);
    expect(result).not.toBeNull();
    const r = result as FsScanResult;
    expect(r.hits.length).toBe(1);
    expect(r.scannedDirs.some((d) => d.includes("wiki"))).toBe(true);
    expect(r.scannedDirs.some((d) => d.includes("runs"))).toBe(false);
  });

  it("never throws on a non-existent root path", () => {
    expect(() => fsScan("x", "/nonexistent/path/to/nowhere-xyz")).not.toThrow();
    expect(fsScan("x", "/nonexistent/path/to/nowhere-xyz")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Title extraction + snippet
// ---------------------------------------------------------------------------

describe("fsScan — title + snippet", () => {
  it("uses the first H1 heading as the title", () => {
    const root = makeTmpRoot();
    writeWiki(root, "doc.md", "# My Page Title\nSome content with gamma in it.");
    const result = fsScan("gamma", root);
    const hit = (result as FsScanResult).hits[0];
    expect(hit.title).toBe("My Page Title");
  });

  it("falls back to basename (no extension) when no H1 present", () => {
    const root = makeTmpRoot();
    writeWiki(root, "no-heading.md", "Just body text with delta term, no heading.");
    const result = fsScan("delta", root);
    const hit = (result as FsScanResult).hits[0];
    expect(hit.title).toBe("no-heading");
  });

  it("snippet contains the matching context", () => {
    const root = makeTmpRoot();
    writeWiki(root, "s.md", "# S\nThe epsilon keyword is on this line.");
    const result = fsScan("epsilon", root);
    const hit = (result as FsScanResult).hits[0];
    expect(hit.snippet.toLowerCase()).toContain("epsilon");
  });
});

// ---------------------------------------------------------------------------
// 5. limit
// ---------------------------------------------------------------------------

describe("fsScan — limit", () => {
  it("respects opts.limit", () => {
    const root = makeTmpRoot();
    for (let i = 0; i < 10; i++) {
      writeWiki(root, `f${i}.md`, `# F${i}\nzeta term here`);
    }
    const result = fsScan("zeta", root, { limit: 3 });
    expect((result as FsScanResult).hits.length).toBe(3);
  });

  it("default limit caps at 10", () => {
    const root = makeTmpRoot();
    for (let i = 0; i < 15; i++) {
      writeWiki(root, `g${i}.md`, `# G${i}\neta term here`);
    }
    const result = fsScan("eta", root);
    expect((result as FsScanResult).hits.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 6. multi-term query
// ---------------------------------------------------------------------------

describe("fsScan — multi-term query", () => {
  it("ranks a file matching more query terms higher", () => {
    const root = makeTmpRoot();
    writeWiki(root, "both.md", "# Both\ncaching and recall both appear here");
    writeWiki(root, "one.md", "# One\nonly caching appears here");
    const result = fsScan("caching recall", root);
    const ordered = (result as FsScanResult).hits.map((h) => path.basename(h.path));
    expect(ordered[0]).toBe("both.md"); // matches 2 terms → ranks first
  });
});
