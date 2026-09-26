/**
 * t09-working-set-recall.test.ts — U-LOOP recall fixtures
 * (KTD26 / KTD45 / KTD50 / KTD67 / KTD70 / R29 / R42 / R57 / R62 / R77 / R80).
 *
 * The named "Done when" clauses this file pins:
 *   - a phase start with a FRESH fingerprint does not spawn learn and does not
 *     rewrite knowledge-recall.json
 *   - T0 context never contains a 6k specialist bundle
 *   - an assignment that uses a project glossary term attaches that definition in
 *     lane_bundle.terms and does not paste the whole glossary
 *   - hybrid recall FAILS OPEN to BM25
 *   - refreshTouched rebuilds only the card, the incremental BM25 and the touched
 *     links subset
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from ".";
import { GLOSSARY_TERM_TOKEN_CAP, matchTerms, parseGlossary, resolveGlossary } from "../knowledge";
import { LANE_BUNDLE_TOKEN_CAP, SPECIALIST_BUNDLE_TOKEN_CAP, assertNoSpecialistBundle, buildLaneBundle, renderSpecialistBundle, validateLaneBundle } from "../knowledge";
import { refreshTouched, knowledgeLinksPath } from "../knowledge";
import { WORKING_SET_TOKEN_CAP, loadWorkingSet } from "../knowledge";
import { refreshWikiIndexPaths, searchWiki, wikiIndexPath } from "../knowledge";
import { GLOSSARY_FEEDSTOCK } from ".";

let sandbox: string;
let repoRoot: string;
let storage: GuildStorage;

function mkStorage(root: string, external: string): GuildStorage {
  return createGuildStorage(root, {
    activeRoot: root,
    profile: "standalone",
    env: {
      GUILD_STATE_HOME: path.join(external, "state"),
      GUILD_CACHE_HOME: path.join(external, "cache"),
      GUILD_WORKTREE_HOME: path.join(external, "worktrees"),
      GUILD_TEMP_HOME: path.join(external, "temp"),
    } as NodeJS.ProcessEnv,
  });
}

function writeWiki(rel: string, body: string): string {
  const abs = storage.project!.knowledge(...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
  return abs;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t09-recall-"));
  repoRoot = path.join(sandbox, "repo");
  fs.mkdirSync(path.join(repoRoot, ".guild"), { recursive: true });
  storage = mkStorage(repoRoot, path.join(sandbox, "external"));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("guild.working_set.v1 — phase start is recall (R29)", () => {
  it("a fresh fingerprint serves the cached card and rebuilds nothing", () => {
    writeWiki("decisions/a.md", "# A\n\nfirst page\n");
    const first = loadWorkingSet({ phase: "plan", storage, pinned_decision_ids: ["decision:a"] });
    expect(first.fresh).toBe(false);

    const second = loadWorkingSet({ phase: "plan", storage, pinned_decision_ids: ["decision:a"] });
    expect(second.fresh).toBe(true);
    expect(second.card.fingerprint).toEqual(first.card.fingerprint);
  });

  it("a fresh-fingerprint phase start does NOT write knowledge-recall.json", () => {
    writeWiki("decisions/a.md", "# A\n\nfirst page\n");
    loadWorkingSet({ phase: "plan", storage });
    const recallProjection = storage.cache("indexes", "knowledge-recall.json");
    const graph = storage.cache("indexes", "knowledge-graph.json");
    loadWorkingSet({ phase: "plan", storage });
    expect(fs.existsSync(recallProjection)).toBe(false);
    expect(fs.existsSync(graph)).toBe(false);
  });

  it("a changed wiki misses the fingerprint and rebuilds the CARD, not a learn run", () => {
    writeWiki("decisions/a.md", "# A\n\nfirst\n");
    loadWorkingSet({ phase: "plan", storage });
    // mtime resolution is coarse; force a distinct stamp.
    const abs = writeWiki("decisions/b.md", "# B\n\nsecond\n");
    fs.utimesSync(abs, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const again = loadWorkingSet({ phase: "plan", storage });
    expect(again.fresh).toBe(false);
    expect(fs.existsSync(storage.cache("indexes", "knowledge-recall.json"))).toBe(false);
  });

  it("the card stays within the 400-token cap by dropping pins, not by throwing", () => {
    const many = Array.from({ length: 400 }, (_, i) => `decision:padding-entry-number-${i}`);
    const { card } = loadWorkingSet({ phase: "plan", storage, pinned_decision_ids: many });
    expect(card.card_tokens).toBeLessThanOrEqual(WORKING_SET_TOKEN_CAP);
    expect(card.pinned_decision_ids.length).toBeLessThan(many.length);
  });
});

describe("refreshTouched scope (KTD50 / R62)", () => {
  it("re-indexes only the touched wiki pages and drops their stale links", () => {
    const a = writeWiki("patterns/a.md", "# Pattern A\n\nretry backoff\n");
    writeWiki("patterns/b.md", "# Pattern B\n\nsomething else\n");
    const linksPath = knowledgeLinksPath(storage);
    fs.mkdirSync(path.dirname(linksPath), { recursive: true });
    fs.writeFileSync(
      linksPath,
      JSON.stringify({
        schema_version: "guild.knowledge_links.v1",
        links: [
          { id: "l1", from: "wiki:patterns/a.md", to: "file:src/x.ts", kind: "describes" },
          { id: "l2", from: "wiki:patterns/b.md", to: "file:src/y.ts", kind: "describes" },
        ],
      }),
      "utf8",
    );

    const result = refreshTouched([a], { storage, phase: "build" });
    expect(result.reindexed).toEqual(["patterns/a.md"]);
    expect(result.relinked).toEqual(["l1"]);

    const after = JSON.parse(fs.readFileSync(linksPath, "utf8")) as { links: Array<{ id: string }> };
    expect(after.links.map((l) => l.id)).toEqual(["l2"]);
  });

  it("never writes the graph or the recall projection", () => {
    const a = writeWiki("patterns/a.md", "# Pattern A\n\ntext\n");
    refreshTouched([a], { storage });
    expect(fs.existsSync(storage.cache("indexes", "knowledge-graph.json"))).toBe(false);
    expect(fs.existsSync(storage.cache("indexes", "knowledge-recall.json"))).toBe(false);
  });
});

describe("BM25 is lazy and includes the glossary (R29 / R80)", () => {
  it("builds the index on the first miss, not before", () => {
    writeWiki("glossary.md", "# Glossary\n\n- **widget** — the unit we bill for.\n");
    expect(fs.existsSync(wikiIndexPath(storage))).toBe(false);
    const r = searchWiki("widget", { storage });
    expect(r.built_index).toBe(true);
    expect(fs.existsSync(wikiIndexPath(storage))).toBe(true);
    expect(r.hits.map((h) => h.rel)).toContain("glossary.md");
  });

  it("hybrid FAILS OPEN to the BM25 order when there is no reranker", () => {
    writeWiki("decisions/retry.md", "# Retry\n\nexponential backoff for the queue\n");
    const r = searchWiki("backoff queue", { storage, backend: "hybrid" });
    expect(r.backend).toBe("bm25");
    expect(r.degraded_reason).toMatch(/BM25/);
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("hybrid FAILS OPEN when the reranker throws", () => {
    writeWiki("decisions/retry.md", "# Retry\n\nexponential backoff for the queue\n");
    const r = searchWiki("backoff queue", {
      storage,
      backend: "hybrid",
      reranker: () => {
        throw new Error("embedding model missing");
      },
    });
    expect(r.backend).toBe("bm25");
    expect(r.degraded_reason).toMatch(/embedding model missing/);
  });

  it("a reranker may only REORDER — it cannot inject a document BM25 never found", () => {
    writeWiki("decisions/retry.md", "# Retry\n\nexponential backoff for the queue\n");
    const r = searchWiki("backoff queue", {
      storage,
      backend: "hybrid",
      reranker: (_q, hits) => [{ rel: "made/up.md", title: "Invented", score: 99 }, ...hits],
    });
    expect(r.hits.map((h) => h.rel)).not.toContain("made/up.md");
  });
});

describe("an incremental refresh never leaves a PARTIAL index (codex G-lane r2 P2)", () => {
  it("a refresh on a cold index builds the whole index first, so an untouched page still hits", () => {
    writeWiki("decisions/untouched.md", "# Untouched\n\nexponential backoff for the queue\n");
    const touched = writeWiki("decisions/touched.md", "# Touched\n\nidempotent consumers\n");
    expect(fs.existsSync(wikiIndexPath(storage))).toBe(false);

    // Harvest indexes the page it just wrote. On a cold index that used to WRITE
    // a one-document index, which every later search then read as complete.
    refreshWikiIndexPaths([path.relative(storage.project!.knowledge(), touched)], { storage });

    const r = searchWiki("backoff queue", { storage });
    expect(r.built_index).toBe(false);
    expect(r.hits.map((h) => h.rel)).toContain("decisions/untouched.md");
    expect(searchWiki("idempotent consumers", { storage }).hits.map((h) => h.rel)).toContain(
      "decisions/touched.md",
    );
  });

  it("a refresh on a WARM index still only re-reads the touched page", () => {
    writeWiki("decisions/a.md", "# A\n\nexponential backoff for the queue\n");
    searchWiki("anything", { storage });
    const b = writeWiki("decisions/b.md", "# B\n\nidempotent consumers\n");
    refreshWikiIndexPaths([path.relative(storage.project!.knowledge(), b)], { storage });
    const hits = searchWiki("backoff queue", { storage });
    expect(hits.built_index).toBe(false);
    expect(hits.hits.map((h) => h.rel)).toContain("decisions/a.md");
  });
});

describe("the two context sizes (KTD26 / KTD45 / R42 / R57)", () => {
  const card = () => loadWorkingSet({ phase: "build", storage }).card;

  it("a glossary term in the assignment attaches its definition, not the whole file", () => {
    writeWiki(
      "glossary.md",
      [
        "# Glossary",
        "",
        "- **widget** — the unit we bill for.",
        "- **frobnicator** — the batch job that reconciles ledgers.",
        "- **tenant** — one paying organisation.",
        "",
      ].join("\n"),
    );
    const glossary = resolveGlossary({ storage });
    const bundle = buildLaneBundle({
      cell_id: "cell-1",
      working_set: card(),
      hits: [{ path: "src/billing.ts", line: 12, gist: "widget price table", score: 3 }],
      assignment_text: "reprice every widget for the tenant",
      glossary,
    });

    const terms = bundle.terms.map((t) => t.term).sort();
    expect(terms).toEqual(["tenant", "widget"]);
    expect(terms).not.toContain("frobnicator");
    expect(validateLaneBundle(bundle).ok).toBe(true);
    expect(bundle.card_tokens).toBeLessThanOrEqual(LANE_BUNDLE_TOKEN_CAP);
  });

  it("glossary hits stay within their 200-token slice of the 1200", () => {
    const long = Array.from(
      { length: 40 },
      (_, i) => `- **term${i}** — ${"a definition long enough to matter ".repeat(3)}`,
    ).join("\n");
    const glossary = parseGlossary(`# Glossary\n\n${long}\n`);
    const matched = matchTerms(
      Array.from({ length: 40 }, (_, i) => `term${i}`).join(" "),
      glossary,
    );
    expect(matched.tokens).toBeLessThanOrEqual(GLOSSARY_TERM_TOKEN_CAP);
    expect(matched.dropped.length).toBeGreaterThan(0);
  });

  it("the lane bundle stays under 1200 by dropping the lowest-scoring citations", () => {
    const hits = Array.from({ length: 200 }, (_, i) => ({
      path: `src/module-${i}/some/deeply/nested/file-${i}.ts`,
      line: i,
      gist: `a gist about the thing in module ${i}`,
      score: i,
    }));
    const bundle = buildLaneBundle({ cell_id: "cell-2", working_set: card(), hits });
    expect(bundle.card_tokens).toBeLessThanOrEqual(LANE_BUNDLE_TOKEN_CAP);
    expect(bundle.hits.length).toBeLessThan(hits.length);
    // What survived is the top of the score order, not an arbitrary prefix.
    expect(bundle.hits[0].score).toBe(199);
  });

  it("T0 context never contains a 6k specialist bundle", () => {
    const rendered = renderSpecialistBundle({
      universal: "universal prelude ".repeat(200),
      role: "role guidance ".repeat(200),
      task: "task detail ".repeat(2000),
      terms: { terms: [{ term: "widget", definition: "the unit we bill for" }], tokens: 6, dropped: [] },
    });
    expect(rendered.tokens).toBeLessThanOrEqual(SPECIALIST_BUNDLE_TOKEN_CAP);
    expect(() => assertNoSpecialistBundle(rendered.text, "T0 context")).toThrow(
      /specialist on-disk bundle reached T0 context/,
    );
  });

  it("stripping the marker does not smuggle the bundle upward — size still refuses", () => {
    const smuggled = "x".repeat(LANE_BUNDLE_TOKEN_CAP * 4 + 100);
    expect(() => assertNoSpecialistBundle(smuggled, "T0 context")).toThrow(/tokens reached T0 context/);
  });

  it("a real lane bundle passes the same check the 6k file fails", () => {
    const bundle = buildLaneBundle({
      cell_id: "cell-3",
      working_set: card(),
      hits: [{ path: "src/a.ts", gist: "entrypoint", score: 1 }],
    });
    expect(() => assertNoSpecialistBundle(bundle, "T0 context")).not.toThrow();
  });
});

describe("the shipped glossary feedstock (KTD70 / R80)", () => {
  it("parses, and its Guild-operating terms attach to an assignment that uses them", () => {
    const glossary = parseGlossary(GLOSSARY_FEEDSTOCK);
    const names = glossary.terms.map((t) => t.term);
    for (const want of ["run", "lane", "tier", "harvest", "class", "recall", "redirect"]) {
      expect(names).toContain(want);
    }
    const matched = matchTerms("dispatch this lane at the cheap tier and harvest after", glossary);
    expect(matched.terms.map((t) => t.term).sort()).toEqual(["harvest", "lane", "tier"]);
    expect(matched.tokens).toBeLessThanOrEqual(GLOSSARY_TERM_TOKEN_CAP);
  });

  it("is recalled on demand, never pasted whole — the file dwarfs the 200-token slice", () => {
    // The reason KTD70 exists: the whole file costs several times what the matched
    // terms do, and it costs it on every turn including the ones that use no term.
    const whole = Math.ceil(GLOSSARY_FEEDSTOCK.trim().length / 4);
    const matched = matchTerms("dispatch this lane at the cheap tier", parseGlossary(GLOSSARY_FEEDSTOCK));
    expect(whole).toBeGreaterThan(GLOSSARY_TERM_TOKEN_CAP * 2);
    expect(matched.tokens).toBeLessThanOrEqual(GLOSSARY_TERM_TOKEN_CAP);
  });
});
