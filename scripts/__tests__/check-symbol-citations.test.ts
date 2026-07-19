/**
 * scripts/__tests__/check-symbol-citations.test.ts
 *
 * Warn-only symbol-citation drift checker (finding F-6).
 *
 * Covers:
 *  - code-span extraction (md backticks + fences, html <code>) — the precision mechanism.
 *  - the PROSE-PARENTHETICAL false positive that motivated it: "`x.ts` (real impl)" must
 *    NOT be read as a symbol citation.
 *  - the three finding classes: MISSING / DRIFTED / OVERRUN, and silence on a good cite.
 *  - CLI: warn-only exit 0 even with findings; exit 1 on bad input.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  extractCodeSpans,
  parseCitations,
  findSymbolLines,
  checkCitation,
  scan,
} from "../docs-hygiene/check-symbol-citations";

describe("extractCodeSpans", () => {
  test("html <code> elements, entity-decoded", () => {
    expect(extractCodeSpans("<p><code>src/a.ts:1 (fn)</code></p>", true)).toEqual([
      "src/a.ts:1 (fn)",
    ]);
    expect(extractCodeSpans("<code>a &amp;&amp; b</code>", true)).toEqual(["a && b"]);
  });
  test("markdown inline spans and fenced blocks", () => {
    const spans = extractCodeSpans("see `src/a.ts (fn)` and\n```\nsrc/b.ts:9\n```\n", false);
    expect(spans.some((s) => s.includes("src/a.ts (fn)"))).toBe(true);
    expect(spans.some((s) => s.includes("src/b.ts:9"))).toBe(true);
  });
  test("prose outside code spans is not extracted", () => {
    expect(extractCodeSpans("<p>plain src/a.ts:5 prose</p>", true)).toEqual([]);
  });
});

describe("parseCitations", () => {
  test("recognises path:line (symbol), path (symbol), and path:line", () => {
    const cites = parseCitations(
      "<code>src/a.ts:12 (alpha)</code><code>src/b.ts (beta)</code><code>src/c.ts:7</code>",
      "doc.html",
      true,
    );
    expect(cites).toEqual([
      { citedPath: "src/a.ts", line: 12, symbol: "alpha", docFile: "doc.html" },
      { citedPath: "src/b.ts", line: undefined, symbol: "beta", docFile: "doc.html" },
      { citedPath: "src/c.ts", line: 7, symbol: undefined, docFile: "doc.html" },
    ]);
  });
  test("a line range cites its start line", () => {
    expect(parseCitations("<code>src/a.ts:55-63</code>", "d", true)[0].line).toBe(55);
  });
  test("a bare path mention with no anchor and no symbol is not a citation", () => {
    expect(parseCitations("<code>src/a.ts</code>", "d", true)).toEqual([]);
  });
  test("a path without a directory separator is not a citation", () => {
    expect(parseCitations("<code>a.ts:12 (alpha)</code>", "d", true)).toEqual([]);
  });

  // The regression that motivated code-span scanning: flat-text scanning bound an
  // ordinary English parenthetical to the preceding path and reported it MISSING.
  test("a prose parenthetical after a code span is NOT read as a symbol", () => {
    expect(parseCitations("<code>src/a.ts</code> (real implementation).", "d", true)).toEqual([]);
  });
  test("a multi-word parenthetical inside a code span is not a symbol either", () => {
    expect(parseCitations("<code>src/a.ts (real implementation)</code>", "d", true)).toEqual([]);
  });
});

describe("findSymbolLines — word-bounded", () => {
  const lines = ["const alpha = 1;", "const alphaBeta = 2;", "// alpha again"];
  test("matches whole identifiers only", () => {
    expect(findSymbolLines(lines, "alpha")).toEqual([1, 3]);
  });
  test("no partial match against a longer identifier", () => {
    expect(findSymbolLines(["const alphaBeta = 2;"], "alpha")).toEqual([]);
  });
});

describe("checkCitation — the three finding classes", () => {
  const lines = ["a", "b", "export function target() {}", "d"];

  test("symbol present near the anchor → no finding", () => {
    expect(checkCitation({ citedPath: "f.ts", line: 3, symbol: "target", docFile: "d" }, lines, 25))
      .toBeNull();
  });
  test("symbol absent → MISSING", () => {
    const f = checkCitation({ citedPath: "f.ts", line: 3, symbol: "gone", docFile: "d" }, lines, 25);
    expect(f?.kind).toBe("MISSING");
  });
  test("symbol present but outside the window → DRIFTED, naming the real line", () => {
    const f = checkCitation(
      { citedPath: "f.ts", line: 100, symbol: "target", docFile: "d" },
      lines,
      25,
    );
    expect(f?.kind).toBe("DRIFTED");
    expect(f?.detail).toContain(":3");
  });
  test("window is inclusive at its edge", () => {
    const at = { citedPath: "f.ts", line: 13, symbol: "target", docFile: "d" };
    expect(checkCitation(at, lines, 10)).toBeNull(); // |13-3| == 10
    expect(checkCitation(at, lines, 9)?.kind).toBe("DRIFTED");
  });
  test("line-only citation past EOF → OVERRUN", () => {
    const f = checkCitation({ citedPath: "f.ts", line: 99, docFile: "d" }, lines, 25);
    expect(f?.kind).toBe("OVERRUN");
  });
  test("line-only citation within the file → no finding", () => {
    expect(checkCitation({ citedPath: "f.ts", line: 2, docFile: "d" }, lines, 25)).toBeNull();
  });
});

describe("scan + CLI — real files on disk", () => {
  let dir: string;
  let docs: string;
  let repo: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-symcite-"));
    docs = path.join(dir, "docs");
    repo = path.join(dir, "repo");
    fs.mkdirSync(docs);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    const body = [...Array(200).keys()].map((i) => `// filler ${i + 1}`);
    body.push("export function targetSymbol() {}");
    fs.writeFileSync(path.join(repo, "src", "thing.ts"), body.join("\n") + "\n");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("scan finds each class once and stays silent on the good citation", () => {
    fs.writeFileSync(
      path.join(docs, "page.html"),
      [
        "<p><code>src/thing.ts:201 (targetSymbol)</code></p>",
        "<p><code>src/thing.ts:10 (targetSymbol)</code></p>",
        "<p><code>src/thing.ts (goneSymbol)</code></p>",
        "<p><code>src/thing.ts:9999</code></p>",
        "<p><code>src/thing.ts</code> (real implementation).</p>",
      ].join("\n"),
    );
    const r = scan(docs, [repo], 25);
    expect(r.checked).toBe(4);
    expect(r.findings.map((f) => f.kind).sort()).toEqual(["DRIFTED", "MISSING", "OVERRUN"]);
  });

  test("unresolved paths are counted, not reported as findings", () => {
    fs.writeFileSync(path.join(docs, "page.md"), "see `no/such/file.ts:3 (whatever)`");
    const r = scan(docs, [repo], 25);
    expect(r.findings).toEqual([]);
    expect(r.unresolved).toBe(1);
    expect(r.checked).toBe(0);
  });

  test("a citation resolves against the SECOND --repo-root when the first misses", () => {
    const repo2 = path.join(dir, "repo2");
    fs.mkdirSync(path.join(repo2, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo2, "src", "other.ts"), "export const kept = 1;\n");
    fs.writeFileSync(path.join(docs, "page.md"), "see `src/other.ts:1 (kept)`");
    const r = scan(docs, [repo, repo2], 25);
    expect(r.unresolved).toBe(0);
    expect(r.findings).toEqual([]);
  });

  describe("CLI", () => {
    const SCRIPT = path.resolve(__dirname, "../docs-hygiene/check-symbol-citations.ts");
    function run(args: string[]): { status: number; out: string } {
      const { spawnSync } = require("child_process") as typeof import("child_process");
      const r = spawnSync("npx", ["tsx", SCRIPT, ...args], {
        encoding: "utf8",
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
        timeout: 120_000,
      });
      return { status: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? "") };
    }

    test("warn-only: findings still exit 0", () => {
      fs.writeFileSync(path.join(docs, "page.md"), "see `src/thing.ts (goneSymbol)`");
      const r = run(["--docs-dir", docs, "--repo-root", repo]);
      expect(r.status).toBe(0);
      expect(r.out).toMatch(/MISSING/);
      expect(r.out).toMatch(/Warn-only — not a gate/);
    });

    test("missing args → exit 1", () => {
      expect(run([]).status).toBe(1);
    });

    test("nonexistent docs dir → exit 1", () => {
      expect(run(["--docs-dir", "/no/such/dir", "--repo-root", repo]).status).toBe(1);
    });

    test("negative --window → exit 1", () => {
      expect(run(["--docs-dir", docs, "--repo-root", repo, "--window", "-1"]).status).toBe(1);
    });
  });
});
