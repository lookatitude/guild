import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { lintWiki } from "../wiki-lint-checks";

function page(dir: string, name: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
}

describe("wiki-lint-checks (deterministic core of /guild:wiki lint)", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-wlc-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("flags importance_draft pages (pending-grade-review)", () => {
    page(path.join(root, ".guild", "wiki"), "a.md", "---\nimportance: high\nimportance_draft: true\ngraded_by: guild-migrate\n---\nbody");
    const f = lintWiki(root);
    expect(f).toHaveLength(1);
    expect(f[0].check).toBe("pending-grade-review");
    expect(f[0].detail).toMatch(/accept-grades/);
  });

  it("flags consumable pages missing importance; exempts via the SHARED grader predicate", () => {
    const w = path.join(root, ".guild", "wiki");
    page(w, "ungraded.md", "---\ntitle: x\n---\nbody");
    page(w, "prov.md", "---\ncategory: provenance\n---\nbody");
    page(w, "typed.md", "---\ntype: research\n---\nbody");
    page(path.join(w, "research"), "by-path.md", "---\ntitle: r\n---\nbody");
    page(path.join(w, "ideation"), "idea.md", "body no fm");
    page(w, "index.md", "# idx");
    page(w, "README.md", "# readme");
    const f = lintWiki(root);
    expect(f).toHaveLength(1);
    expect(f[0].check).toBe("missing-importance");
    expect(f[0].file).toContain("ungraded.md");
  });

  it("architecture-map.md is NOT structural — the grader grades it, so lint flags it ungraded", () => {
    const w = path.join(root, ".guild", "wiki");
    page(w, "architecture-map.md", "---\ntitle: map\n---\nbody");
    const f = lintWiki(root);
    expect(f).toHaveLength(1);
    expect(f[0].file).toContain("architecture-map.md");
  });

  it("clean wiki (graded, accepted) → zero findings; missing wiki dir → zero", () => {
    page(path.join(root, ".guild", "wiki"), "a.md", "---\nimportance: medium\n---\nbody");
    expect(lintWiki(root)).toHaveLength(0);
    expect(lintWiki(path.join(root, "nope"))).toHaveLength(0);
  });

  // ── M3 invalid-type (wiki-frontmatter-contract.ts §10.1.1 vocabulary) ─────

  it("flags a durable page whose type: is present but not in the §10.1.1 canonical enum", () => {
    const w = path.join(root, ".guild", "wiki");
    page(w, "bogus-type.md", "---\nimportance: medium\ntype: guideline\n---\nbody");
    const f = lintWiki(root);
    expect(f).toHaveLength(1);
    expect(f[0].check).toBe("invalid-type");
    expect(f[0].file).toContain("bogus-type.md");
    expect(f[0].detail).toContain("guideline");
    expect(f[0].detail).toContain("§10.1.1");
  });

  it("does NOT flag a page whose type: is a canonical §10.1.1 value", () => {
    const w = path.join(root, ".guild", "wiki");
    for (const t of ["context", "standard", "product", "entity", "concept", "decision"]) {
      page(w, `${t}.md`, `---\nimportance: medium\ntype: ${t}\n---\nbody`);
    }
    expect(lintWiki(root)).toHaveLength(0);
  });

  it("does NOT flag a page with no type: field at all (absence is a different check's job)", () => {
    const w = path.join(root, ".guild", "wiki");
    page(w, "no-type.md", "---\nimportance: medium\n---\nbody");
    expect(lintWiki(root)).toHaveLength(0);
  });

  it("exempts provenance/exploratory pages from invalid-type via the SHARED durable predicate", () => {
    const w = path.join(root, ".guild", "wiki");
    // "exploratory" is itself a PROVENANCE_FM_VALUES marker (not a §10.1.1
    // type) — exempt via the same durable predicate M2 uses, not flagged.
    page(w, "prov.md", "---\ntype: exploratory\n---\nbody");
    expect(lintWiki(root)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B-2: production path wiring — lintWiki() MUST surface knowledge-graph lint
// findings (SC-6) by calling lintKnowledgeNodes() on the index file.
// ---------------------------------------------------------------------------

describe("wiki-lint-checks — knowledge-graph lint wired into lintWiki() (B-2 / SC-6)", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-wlc-kg-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  /** Write a knowledge-graph.json under .guild/indexes/ with the given nodes. */
  function writeKnowledgeGraph(nodes: unknown[]): void {
    const indexDir = path.join(root, ".guild", "indexes");
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, "knowledge-graph.json"), JSON.stringify({ nodes }, null, 2));
  }

  it("surfaces a wiki_page node missing importance via the production lintWiki() entrypoint", () => {
    // This is the B-2 acceptance criterion: the real production path must call
    // lintKnowledgeNodes() and fold its findings into the report.
    // Node mirrors bad-nodes.json -> flagged_by_wiki_lint.wiki_page_missing_importance.
    writeKnowledgeGraph([
      {
        id: "wiki_page:docs/storage.md",
        type: "wiki_page",
        name: "Storage",
        category: "guide",
        labels: ["storage"],
        source_refs: ["docs/storage.md#storage"],
        confidence: "high",
        // NO importance field — must be flagged
      },
    ]);

    const findings = lintWiki(root);
    const kgFinding = findings.find(
      (f) => f.check === "missing-importance" && f.file === "wiki_page:docs/storage.md"
    );
    expect(kgFinding).toBeDefined();
    expect(kgFinding!.detail).toMatch(/importance/i);
  });

  it("surfaces an invalid-category node via the production lintWiki() entrypoint", () => {
    writeKnowledgeGraph([
      {
        id: "wiki_page:docs/overview.md",
        type: "wiki_page",
        name: "Overview",
        category: "not-a-real-category",  // out-of-enum
        importance: "high",
        source_refs: ["docs/overview.md#overview"],
        confidence: "high",
      },
    ]);

    const findings = lintWiki(root);
    const kgFinding = findings.find(
      (f) => f.check === "invalid-category" && f.file === "wiki_page:docs/overview.md"
    );
    expect(kgFinding).toBeDefined();
    expect(kgFinding!.detail).toMatch(/not-a-real-category/);
  });

  it("does NOT surface knowledge-graph findings when knowledge-graph.json is absent (graceful skip)", () => {
    // No .guild/indexes/knowledge-graph.json written.
    // Ensure lintWiki() doesn't throw and returns only wiki-file findings (empty here).
    expect(() => lintWiki(root)).not.toThrow();
    expect(lintWiki(root)).toHaveLength(0);
  });

  it("skips gracefully when knowledge-graph.json is malformed JSON", () => {
    const indexDir = path.join(root, ".guild", "indexes");
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(path.join(indexDir, "knowledge-graph.json"), "{ NOT VALID JSON }");
    expect(() => lintWiki(root)).not.toThrow();
    expect(lintWiki(root)).toHaveLength(0);
  });

  it("does NOT flag clean knowledge-graph nodes (no false positives in production path)", () => {
    writeKnowledgeGraph([
      {
        id: "wiki_page:docs/clean.md",
        type: "wiki_page",
        name: "Clean",
        category: "guide",
        importance: "high",
        labels: [],
        source_refs: ["docs/clean.md#clean"],
        confidence: "high",
      },
      {
        // file node — not a knowledge node, must be ignored
        id: "file:src/main.ts",
        type: "file",
        name: "main.ts",
        source_refs: ["src/main.ts"],
        confidence: "high",
      },
    ]);
    expect(lintWiki(root)).toHaveLength(0);
  });
});
