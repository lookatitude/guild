/**
 * scripts/__tests__/classify-wiki-pages.test.ts
 *
 * L8 tests for the ClassifyPageFn implementation.
 *
 * The classifier is LLM-judged in production (SC-9 determinism table).
 * These tests cover the DETERMINISTIC halves:
 *   - buildClassifyPrompt: input→prompt (pure function, deterministic-script)
 *   - parseClassifyResponse: raw LLM output→Map (pure function, deterministic-script)
 *   - makeClassifier: end-to-end with a mocked LLM runner
 *   - defaultFallbackClassifier: offline fallback (deterministic-script)
 *
 * Tests do NOT call a real LLM — the LLM call is injected via makeClassifier(runLLM)
 * and mocked here. This keeps CI free of API keys and maintains determinism (SC-9).
 *
 * Determinism responsibility table (SC-9 — this module):
 *   | Output                     | Owner                 |
 *   |----------------------------|-----------------------|
 *   | prompt text                | deterministic-script  |
 *   | JSON parse + field check   | deterministic-script  |
 *   | fallback defaults          | deterministic-script  |
 *   | category / importance /    |                       |
 *   |   labels[] values          | LLM-judged (mocked ↑) |
 *
 * Usage: npx jest --testPathPatterns=classify-wiki-pages --no-coverage
 */

import {
  buildClassifyPrompt,
  parseClassifyResponse,
  makeClassifier,
  defaultFallbackClassifier,
} from "../understand/classify-wiki-pages";
import { NODE_CATEGORIES } from "../understand/lib/schema";
import type { WikiPageDescriptor, WikiPageClassification } from "../understand/wiki-index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDescriptor(overrides: Partial<WikiPageDescriptor> = {}): WikiPageDescriptor {
  return {
    id: overrides.id ?? "wiki_page:docs/test.md",
    relpath: overrides.relpath ?? "docs/test.md",
    name: overrides.name ?? "Test Page",
    headings: overrides.headings ?? ["Test Page", "Section A"],
    content: overrides.content ?? "# Test Page\n\nThis is test content about ingestion.",
    wikilinks: overrides.wikilinks ?? [],
  };
}

const PAGE_A = makeDescriptor({ id: "wiki_page:docs/a.md", name: "Alpha", relpath: "docs/a.md" });
const PAGE_B = makeDescriptor({ id: "wiki_page:docs/b.md", name: "Beta", relpath: "docs/b.md" });
const PAGES = [PAGE_A, PAGE_B];

// ---------------------------------------------------------------------------
// buildClassifyPrompt — deterministic-script
// ---------------------------------------------------------------------------

describe("buildClassifyPrompt (deterministic-script)", () => {

  it("returns a non-empty string", () => {
    const prompt = buildClassifyPrompt(PAGES);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes all page ids in the prompt", () => {
    const prompt = buildClassifyPrompt(PAGES);
    for (const p of PAGES) {
      expect(prompt).toContain(p.id);
    }
  });

  it("instructs the LLM to output JSON (mentions 'results' key)", () => {
    const prompt = buildClassifyPrompt(PAGES);
    expect(prompt).toMatch(/"results"/);
  });

  it("lists the closed category enum values", () => {
    const prompt = buildClassifyPrompt(PAGES);
    // At least some NODE_CATEGORIES values should appear (not necessarily all — prompt abbreviates)
    const found = [...NODE_CATEGORIES].filter((c) => prompt.includes(c));
    expect(found.length).toBeGreaterThan(3);
  });

  it("mentions high|medium|low for importance", () => {
    const prompt = buildClassifyPrompt(PAGES);
    expect(prompt).toContain("high");
    expect(prompt).toContain("medium");
    expect(prompt).toContain("low");
  });

  it("includes the page name for each page", () => {
    const prompt = buildClassifyPrompt(PAGES);
    expect(prompt).toContain(PAGE_A.name);
    expect(prompt).toContain(PAGE_B.name);
  });

  it("is deterministic — same input produces same output", () => {
    expect(buildClassifyPrompt(PAGES)).toBe(buildClassifyPrompt(PAGES));
  });

  it("handles empty page list (no crash, returns non-empty prompt)", () => {
    const p = buildClassifyPrompt([]);
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });

});

// ---------------------------------------------------------------------------
// parseClassifyResponse — deterministic-script
// ---------------------------------------------------------------------------

describe("parseClassifyResponse (deterministic-script)", () => {

  it("parses a valid JSON response and maps ids to classifications", () => {
    const raw = JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "guide", importance: "high", labels: ["ingestion"] },
        { id: "wiki_page:docs/b.md", category: "reference", importance: "medium", labels: ["api"] },
      ],
    });
    const result = parseClassifyResponse(raw, PAGES);
    expect(result.size).toBe(2);
    expect(result.get("wiki_page:docs/a.md")).toEqual({ category: "guide", importance: "high", labels: ["ingestion"] });
    expect(result.get("wiki_page:docs/b.md")).toEqual({ category: "reference", importance: "medium", labels: ["api"] });
  });

  it("every returned classification has a valid category from NODE_CATEGORIES", () => {
    const raw = JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "guide", importance: "high", labels: [] },
      ],
    });
    const result = parseClassifyResponse(raw, [PAGE_A]);
    const cls = result.get("wiki_page:docs/a.md")!;
    expect(NODE_CATEGORIES.has(cls.category)).toBe(true);
  });

  it("every returned classification has a valid importance (high|medium|low)", () => {
    const raw = JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "guide", importance: "high", labels: [] },
      ],
    });
    const result = parseClassifyResponse(raw, [PAGE_A]);
    const cls = result.get("wiki_page:docs/a.md")!;
    expect(["high", "medium", "low"]).toContain(cls.importance);
  });

  it("falls back to 'note' category when LLM returns an invalid category", () => {
    const raw = JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "not-a-real-category", importance: "high", labels: [] },
      ],
    });
    const result = parseClassifyResponse(raw, [PAGE_A]);
    const cls = result.get("wiki_page:docs/a.md")!;
    expect(cls.category).toBe("note");
    expect(NODE_CATEGORIES.has(cls.category)).toBe(true);
  });

  it("falls back to 'low' importance when LLM returns an invalid importance", () => {
    const raw = JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "guide", importance: "super-important", labels: [] },
      ],
    });
    const result = parseClassifyResponse(raw, [PAGE_A]);
    expect(result.get("wiki_page:docs/a.md")!.importance).toBe("low");
  });

  it("fills fallback for page ids missing from the LLM response", () => {
    // Only page A returned, but PAGES has [A, B]
    const raw = JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "guide", importance: "high", labels: [] },
      ],
    });
    const result = parseClassifyResponse(raw, PAGES);
    expect(result.has("wiki_page:docs/a.md")).toBe(true);
    // B should get the fallback
    const fallback = result.get("wiki_page:docs/b.md")!;
    expect(fallback.category).toBe("note");
    expect(fallback.importance).toBe("low");
    expect(fallback.labels).toEqual([]);
  });

  it("handles malformed JSON gracefully — fallback for all pages", () => {
    const result = parseClassifyResponse("this is not json { broken", PAGES);
    expect(result.size).toBe(2);
    for (const [, cls] of result) {
      expect(["high", "medium", "low"]).toContain(cls.importance);
      expect(NODE_CATEGORIES.has(cls.category)).toBe(true);
    }
  });

  it("handles markdown-fenced JSON (```json ... ```)", () => {
    const raw = "```json\n" + JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "guide", importance: "medium", labels: ["test"] },
      ],
    }) + "\n```";
    const result = parseClassifyResponse(raw, [PAGE_A]);
    expect(result.get("wiki_page:docs/a.md")!.category).toBe("guide");
  });

  it("labels array is always an array of strings", () => {
    const raw = JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "guide", importance: "high", labels: ["a", "b"] },
        { id: "wiki_page:docs/b.md", category: "note", importance: "low", labels: null },
      ],
    });
    const result = parseClassifyResponse(raw, PAGES);
    for (const [, cls] of result) {
      expect(Array.isArray(cls.labels)).toBe(true);
    }
  });

  it("empty page list returns empty map", () => {
    const raw = JSON.stringify({ results: [] });
    const result = parseClassifyResponse(raw, []);
    expect(result.size).toBe(0);
  });

  it("is deterministic — same inputs produce same output", () => {
    const raw = JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "guide", importance: "high", labels: ["x"] },
      ],
    });
    const r1 = parseClassifyResponse(raw, [PAGE_A]);
    const r2 = parseClassifyResponse(raw, [PAGE_A]);
    expect([...r1.entries()]).toEqual([...r2.entries()]);
  });

});

// ---------------------------------------------------------------------------
// makeClassifier — end-to-end with mocked LLM runner
// ---------------------------------------------------------------------------

describe("makeClassifier (mocked LLM runner)", () => {

  it("calls runLLM once per batch and returns a classification for every page", async () => {
    const validResponse = JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "guide", importance: "high", labels: ["alpha"] },
        { id: "wiki_page:docs/b.md", category: "overview", importance: "medium", labels: ["beta"] },
      ],
    });
    const runLLM = jest.fn().mockResolvedValue(validResponse);
    const classifier = makeClassifier(runLLM);

    const result = await classifier(PAGES);

    expect(runLLM).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(2);
    expect(result.get("wiki_page:docs/a.md")!.category).toBe("guide");
    expect(result.get("wiki_page:docs/b.md")!.importance).toBe("medium");
  });

  it("splits large page batches according to batchSize", async () => {
    const pages = Array.from({ length: 5 }, (_, i) =>
      makeDescriptor({ id: `wiki_page:docs/p${i}.md`, relpath: `docs/p${i}.md`, name: `Page ${i}` })
    );

    const runLLM = jest.fn().mockImplementation(async (prompt: string) => {
      // Return empty results — we're testing batching, not content
      return JSON.stringify({ results: [] });
    });

    const classifier = makeClassifier(runLLM, { batchSize: 2 });
    await classifier(pages);

    // 5 pages / 2 per batch = 3 calls
    expect(runLLM).toHaveBeenCalledTimes(3);
  });

  it("falls back to defaults for the entire batch when runLLM throws", async () => {
    const runLLM = jest.fn().mockRejectedValue(new Error("LLM unavailable"));
    const classifier = makeClassifier(runLLM);

    const result = await classifier(PAGES);

    expect(result.size).toBe(2);
    for (const [, cls] of result) {
      expect(cls.category).toBe("note");
      expect(cls.importance).toBe("low");
      expect(cls.labels).toEqual([]);
    }
  });

  it("every returned classification has valid category (in NODE_CATEGORIES) and importance", async () => {
    // LLM returns partly invalid
    const runLLM = jest.fn().mockResolvedValue(JSON.stringify({
      results: [
        { id: "wiki_page:docs/a.md", category: "INVALID", importance: "ultra", labels: [123, "valid"] },
        { id: "wiki_page:docs/b.md", category: "guide", importance: "high", labels: ["ok"] },
      ],
    }));
    const classifier = makeClassifier(runLLM);
    const result = await classifier(PAGES);

    for (const [, cls] of result) {
      expect(NODE_CATEGORIES.has(cls.category)).toBe(true);
      expect(["high", "medium", "low"]).toContain(cls.importance);
      expect(Array.isArray(cls.labels)).toBe(true);
      for (const lbl of cls.labels) {
        expect(typeof lbl).toBe("string");
      }
    }
  });

});

// ---------------------------------------------------------------------------
// defaultFallbackClassifier — offline fallback
// ---------------------------------------------------------------------------

describe("defaultFallbackClassifier (deterministic-script offline fallback)", () => {

  it("returns a classification for every page", async () => {
    const result = await defaultFallbackClassifier(PAGES);
    expect(result.size).toBe(PAGES.length);
    for (const page of PAGES) {
      expect(result.has(page.id)).toBe(true);
    }
  });

  it("every classification has category='note', importance='low', labels=[]", async () => {
    const result = await defaultFallbackClassifier(PAGES);
    for (const [, cls] of result) {
      expect(cls.category).toBe("note");
      expect(cls.importance).toBe("low");
      expect(cls.labels).toEqual([]);
    }
  });

  it("category 'note' is a valid NODE_CATEGORIES member", () => {
    expect(NODE_CATEGORIES.has("note")).toBe(true);
  });

  it("empty input returns empty map", async () => {
    const result = await defaultFallbackClassifier([]);
    expect(result.size).toBe(0);
  });

  it("is deterministic — two calls produce identical results", async () => {
    const r1 = await defaultFallbackClassifier(PAGES);
    const r2 = await defaultFallbackClassifier(PAGES);
    expect([...r1.entries()]).toEqual([...r2.entries()]);
  });

  it("mutations to one call's map do not affect a second call (no aliasing)", async () => {
    const r1 = await defaultFallbackClassifier([PAGE_A]);
    const r2 = await defaultFallbackClassifier([PAGE_A]);
    const cls1 = r1.get(PAGE_A.id)!;
    // Mutate r1's object
    cls1.category = "guide" as string;
    // r2 should not be affected
    expect(r2.get(PAGE_A.id)!.category).toBe("note");
  });

});
