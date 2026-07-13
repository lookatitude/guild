/**
 * scripts/__tests__/wiki-frontmatter-contract.test.ts
 *
 * TDD for src/modules/knowledge/workflows/wiki-frontmatter-contract.ts — the
 * §10.1.1 wiki-page frontmatter field vocabulary as typed constants.
 */

import {
  WIKI_PAGE_TYPES,
  WIKI_TYPE_TO_DIR,
  WIKI_CONFIDENCE_LEVELS,
  WIKI_SENSITIVITY_LEVELS,
  WIKI_FRONTMATTER_FIELDS,
  isWikiPageType,
  isWikiConfidenceLevel,
  isWikiSensitivityLevel,
} from "../../src/modules/knowledge/workflows/wiki-frontmatter-contract";

describe("wiki-frontmatter-contract — WIKI_PAGE_TYPES (§10.1.1 type: enum)", () => {
  it("matches the canonical 7-value enum from guild-plan.md §10.1.1", () => {
    expect(WIKI_PAGE_TYPES).toEqual([
      "context",
      "standard",
      "product",
      "entity",
      "concept",
      "decision",
      "source",
    ]);
  });

  it("isWikiPageType accepts every canonical value", () => {
    for (const t of WIKI_PAGE_TYPES) expect(isWikiPageType(t)).toBe(true);
  });

  it("isWikiPageType rejects an out-of-enum value", () => {
    expect(isWikiPageType("bogus")).toBe(false);
    expect(isWikiPageType("contexts")).toBe(false); // plural typo
    expect(isWikiPageType(undefined)).toBe(false);
    expect(isWikiPageType(null)).toBe(false);
    expect(isWikiPageType(42)).toBe(false);
  });
});

describe("wiki-frontmatter-contract — WIKI_TYPE_TO_DIR (§10.2 categorization table)", () => {
  it("has exactly one directory entry per WIKI_PAGE_TYPES value", () => {
    expect(Object.keys(WIKI_TYPE_TO_DIR).sort()).toEqual([...WIKI_PAGE_TYPES].sort());
  });

  it("matches the live .guild/wiki/ directory names already in use (context/, standards/, entities/, decisions/)", () => {
    expect(WIKI_TYPE_TO_DIR.context).toBe("context");
    expect(WIKI_TYPE_TO_DIR.standard).toBe("standards");
    expect(WIKI_TYPE_TO_DIR.entity).toBe("entities");
    expect(WIKI_TYPE_TO_DIR.decision).toBe("decisions");
  });

  it("pluralizes product/concept/source per §10.2 (products/, concepts/, sources/)", () => {
    expect(WIKI_TYPE_TO_DIR.product).toBe("products");
    expect(WIKI_TYPE_TO_DIR.concept).toBe("concepts");
    expect(WIKI_TYPE_TO_DIR.source).toBe("sources");
  });
});

describe("wiki-frontmatter-contract — WIKI_CONFIDENCE_LEVELS", () => {
  it("matches the canonical 3-value enum", () => {
    expect(WIKI_CONFIDENCE_LEVELS).toEqual(["low", "medium", "high"]);
  });

  it("isWikiConfidenceLevel accepts every canonical value and rejects others", () => {
    for (const c of WIKI_CONFIDENCE_LEVELS) expect(isWikiConfidenceLevel(c)).toBe(true);
    expect(isWikiConfidenceLevel("very-high")).toBe(false);
    expect(isWikiConfidenceLevel(undefined)).toBe(false);
  });
});

describe("wiki-frontmatter-contract — WIKI_SENSITIVITY_LEVELS", () => {
  it("matches the canonical 4-value enum", () => {
    expect(WIKI_SENSITIVITY_LEVELS).toEqual(["public", "internal", "confidential", "secret"]);
  });

  it("isWikiSensitivityLevel accepts every canonical value and rejects others", () => {
    for (const s of WIKI_SENSITIVITY_LEVELS) expect(isWikiSensitivityLevel(s)).toBe(true);
    expect(isWikiSensitivityLevel("top-secret")).toBe(false);
  });
});

describe("wiki-frontmatter-contract — WIKI_FRONTMATTER_FIELDS", () => {
  it("lists all 9 required §10.1.1 fields in canonical order", () => {
    expect(WIKI_FRONTMATTER_FIELDS).toEqual([
      "type",
      "owner",
      "confidence",
      "source_refs",
      "created_at",
      "updated_at",
      "expires_at",
      "supersedes",
      "sensitivity",
    ]);
  });
});
