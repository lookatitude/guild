/**
 * scripts/__tests__/knowledge-realpath-l13fix.test.ts
 *
 * L13-FIX — red-first regression tests for the 2 codex G-lane blockers on the
 * L13 real-path fix (commit 4c338bc). Both re-open a previously-"fixed" defect
 * on a secondary code path that the original L13 tests did not exercise.
 *
 *   BLOCKER 1 — repoRoot not threaded to the wiki-index.ts / classify-wiki-pages.ts
 *               CLI entry points → those CLIs emit wikiDir-relative ids/anchors
 *               (`index.md#slug`) that fail to resolve at repoRoot (re-triggers the
 *               BUG-3 unresolvable-anchor drop). Both CLIs advertise `--cwd` but
 *               ignore it. The fix: parse `--cwd`, resolve repoRoot, thread it to
 *               indexWiki so ids/anchors are repoRoot-relative (`.guild/wiki/…`).
 *
 *   BLOCKER 2 — discoverFilePaths recurses into everything except a hand-rolled
 *               dir list, ADMITTING test fixtures / vendor/ / out/ / generated
 *               files that the cost-gate corpus (walkRepo + lib/ignore.ts) excludes.
 *               The fix: discoverFilePaths must honor the SAME shared ignore policy
 *               for DIRECTORY/file exclusion as the cost-gate, EXCEPT `.svg` files
 *               (excluded from token-counting but STILL discovered for K3 diagrams).
 *
 * These tests exercise the REAL paths (spawned CLI; real discoverFilePaths against
 * a real temp repo) — not injected seams — per the recurring "verify the real path"
 * lesson.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  discoverFilePaths,
  runKnowledgeStages,
  type KnowledgeLLMSeams,
} from "../understand/knowledge-orchestrator";
import { resolveAnchor } from "../understand/lib/schema";
import { createIgnoreFilter } from "../understand/lib/ignore";
import { walkRepo } from "../understand/lib/walk";

// ---------------------------------------------------------------------------
// Temp repo lifecycle
// ---------------------------------------------------------------------------

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
function mkTmpRepo(prefix = "guild-l13fix-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_DIRS.push(d);
  return d;
}
function write(repo: string, rel: string, content: string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const TSX_BIN = path.join(__dirname, "..", "node_modules", ".bin", "tsx");
const WIKI_INDEX_CLI = path.join(__dirname, "..", "understand", "wiki-index.ts");
const CLASSIFY_CLI = path.join(__dirname, "..", "understand", "classify-wiki-pages.ts");

// ---------------------------------------------------------------------------
// BLOCKER 1 — CLI entry points thread repoRoot (resolve --cwd → repoRoot)
// ---------------------------------------------------------------------------

describe("BLOCKER 1 — wiki-index.ts CLI threads --cwd → repoRoot (real spawn)", () => {
  function scaffoldWikiRepo(): string {
    const repo = mkTmpRepo("guild-cli-wiki-");
    write(repo, ".guild/wiki/index.md", "# Event Pipeline Knowledge Base\n\nSee [[overview]].\n");
    write(repo, ".guild/wiki/overview.md", "# Overview\n\nProse.\n");
    return repo;
  }

  test("--cwd makes every wiki_page id + source_ref repoRoot-relative AND resolvable", () => {
    const repo = scaffoldWikiRepo();
    const wikiDir = path.join(repo, ".guild", "wiki");
    const stdout = execFileSync(
      TSX_BIN,
      [WIKI_INDEX_CLI, wikiDir, "--cwd", repo, "--print"],
      { encoding: "utf8" },
    );
    // Extract the JSON object the --print flag emits.
    const jsonStart = stdout.indexOf("{");
    const parsed = JSON.parse(stdout.slice(jsonStart));
    const wikiPages = parsed.nodes.filter((n: any) => n.type === "wiki_page");
    expect(wikiPages.length).toBe(2);
    for (const node of wikiPages) {
      // id is repoRoot-relative: wiki_page:.guild/wiki/<file>
      expect(node.id.startsWith("wiki_page:.guild/wiki/")).toBe(true);
      // source_ref is repoRoot-relative AND resolves at repoRoot.
      const ref = node.source_refs[0];
      expect(ref.startsWith(".guild/wiki/")).toBe(true);
      expect(resolveAnchor(repo, ref)).toBe(true);
    }
  }, 30000);
});

describe("BLOCKER 1 — classify-wiki-pages.ts CLI threads --cwd → repoRoot (real spawn)", () => {
  test("--cwd makes printed wiki_page ids repoRoot-relative (not wikiDir-relative)", () => {
    const repo = mkTmpRepo("guild-cli-classify-");
    write(repo, ".guild/wiki/index.md", "# Index\n");
    write(repo, ".guild/wiki/topic.md", "# Topic\n");
    const wikiDir = path.join(repo, ".guild", "wiki");
    const stdout = execFileSync(
      TSX_BIN,
      [CLASSIFY_CLI, wikiDir, "--cwd", repo],
      { encoding: "utf8" },
    );
    // repoRoot-relative ids contain the `.guild/wiki/` prefix …
    expect(stdout).toMatch(/wiki_page:\.guild\/wiki\/index\.md/);
    // … and the bare wikiDir-relative form must NOT appear.
    expect(stdout).not.toMatch(/wiki_page:index\.md\b/);
  }, 30000);
});

// ---------------------------------------------------------------------------
// BLOCKER 2 — discoverFilePaths shares the cost-gate corpus policy
// ---------------------------------------------------------------------------

describe("BLOCKER 2 — discoverFilePaths == cost-gate corpus policy (+ svg nuance)", () => {
  function scaffoldMixedRepo(): string {
    const repo = mkTmpRepo("guild-discover-policy-");
    // Real first-party content (MUST be discovered).
    write(repo, "scripts/app.ts", "/** App */\nexport function app() {}\n");
    write(repo, "docs/guide.md", "# Guide\n\nProse.\n");
    write(repo, "docs/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>Real</title></svg>\n');
    // Pollution the shared ignore policy excludes (MUST NOT be discovered).
    write(repo, "vendor/foo.ts", "export const foo = 1;\n");
    write(repo, "vendor/lib.md", "# Vendored\n");
    write(repo, "out/generated.ts", "export const gen = 1;\n");
    write(repo, "scripts/__tests__/fixtures/docs.md", "# Fixture\n\n```mermaid\ngraph TD; A-->B\n```\n");
    write(repo, "scripts/__tests__/fixtures/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg"><title>Fixture</title></svg>\n');
    return repo;
  }

  test("real first-party code/doc/svg ARE discovered", () => {
    const fp = discoverFilePaths(scaffoldMixedRepo());
    expect(fp.codeRelPaths).toContain("scripts/app.ts");
    expect(fp.docRelPaths).toContain("docs/guide.md");
    expect(fp.svgRelPaths).toContain("docs/diagram.svg");
  });

  test("vendor/ out/ fixtures are NOT discovered as code/doc/svg", () => {
    const fp = discoverFilePaths(scaffoldMixedRepo());
    const all = [
      ...fp.codeRelPaths,
      ...fp.docRelPaths,
      ...(fp.svgRelPaths ?? []),
    ];
    expect(all.some((p) => p.startsWith("vendor/"))).toBe(false);
    expect(all.some((p) => p.startsWith("out/"))).toBe(false);
    expect(all.some((p) => p.includes("/fixtures/") || p.includes("__tests__"))).toBe(false);
  });

  test("discovered non-svg corpus == cost-gate corpus (one shared policy)", () => {
    const repo = scaffoldMixedRepo();
    const fp = discoverFilePaths(repo);
    const filter = createIgnoreFilter(repo);
    const { files } = walkRepo(repo, 100000);
    // Every discovered code/doc file must be a file the cost-gate corpus keeps.
    for (const rel of [...fp.codeRelPaths, ...fp.docRelPaths]) {
      expect(filter.isIgnored(rel)).toBe(false);
      expect(files).toContain(rel);
    }
    // Symmetry: no fixture/vendor/out path the cost-gate excludes leaks into discovery.
    for (const rel of [...fp.codeRelPaths, ...fp.docRelPaths]) {
      expect(rel.startsWith("vendor/")).toBe(false);
      expect(rel.startsWith("out/")).toBe(false);
      expect(rel.includes("/fixtures/")).toBe(false);
    }
  });

  test("svg under a non-ignored dir is discovered; svg under an ignored dir is not", () => {
    const repo = scaffoldMixedRepo();
    const fp = discoverFilePaths(repo);
    // *.svg is file-ignored for token-counting (walkRepo drops it) …
    const filter = createIgnoreFilter(repo);
    expect(filter.isIgnored("docs/diagram.svg")).toBe(true);
    // … but discovery STILL collects it for K3 (nuance).
    expect(fp.svgRelPaths).toContain("docs/diagram.svg");
    // The fixture svg lives under an ignored dir → never discovered.
    expect(fp.svgRelPaths).not.toContain("scripts/__tests__/fixtures/diagram.svg");
  });

  test("end-to-end: fixture mermaid/svg do NOT become diagram nodes", async () => {
    const repo = scaffoldMixedRepo();
    const fp = discoverFilePaths(repo);
    const NOOP: KnowledgeLLMSeams = {
      proposeConcepts: async () => [],
      proposeClaimsAndEntities: async () => ({ claims: [], entities: [] }),
      classifyPage: async (pages) =>
        new Map(pages.map((p) => [p.id, { category: "note", importance: "low", labels: [] }])),
      proposeTaxonomy: async () => ({ topicProposals: [], domainProposals: [] }),
      confirmCrossLinks: async () => [],
    };
    const result = await runKnowledgeStages(repo, fp, NOOP, {});
    const diagramRefs = result.graph.nodes
      .filter((n) => n.type === "diagram")
      .map((n) => n.source_refs[0]);
    expect(diagramRefs.some((r) => r.includes("/fixtures/") || r.includes("__tests__"))).toBe(false);
    expect(diagramRefs.some((r) => r.startsWith("vendor/") || r.startsWith("out/"))).toBe(false);
  }, 30000);
});
