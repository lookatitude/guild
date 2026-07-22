/**
 * __tests__/ingest-importance.test.ts — the write-time importance-at-ingest scorer +
 * frontmatter persistence (docs/v2/knowledge-memory.html §Importance-at-ingest, LW: importance-at-ingest).
 */

import {
  ingestImportanceScore,
  parseRecallImportance,
  stampRecallImportance,
  resolveRecallImportance,
  isRecallImportancePinned,
  isValidScore,
  RECALL_IMPORTANCE_KEY,
} from "../lib/ingest-importance";

describe("ingestImportanceScore — the 1–5 category table", () => {
  it("maps the design table (ADR→5, contract→4, guide→3, context→2)", () => {
    expect(ingestImportanceScore("decisions")).toBe(5);
    expect(ingestImportanceScore("adr")).toBe(5);
    expect(ingestImportanceScore("standards")).toBe(4);
    expect(ingestImportanceScore("contracts")).toBe(4);
    expect(ingestImportanceScore("concepts")).toBe(3);
    expect(ingestImportanceScore("guides")).toBe(3);
    expect(ingestImportanceScore("context")).toBe(2);
    expect(ingestImportanceScore("sources")).toBe(2);
  });
  it("is case-insensitive and defaults unknown/absent to 3 (== default gate)", () => {
    expect(ingestImportanceScore("DECISIONS")).toBe(5);
    expect(ingestImportanceScore("whatever")).toBe(3);
    expect(ingestImportanceScore(undefined)).toBe(3);
  });
});

describe("isValidScore", () => {
  it("accepts integers 1–5 only", () => {
    for (const n of [1, 2, 3, 4, 5]) expect(isValidScore(n)).toBe(true);
    for (const n of [0, 6, 2.5, -1, NaN]) expect(isValidScore(n)).toBe(false);
    expect(isValidScore("3" as unknown)).toBe(false);
  });
});

const FM = (extra = ""): string => `---\ntype: decision\nowner: x${extra ? "\n" + extra : ""}\n---\n\nbody text here\n`;

describe("parseRecallImportance", () => {
  it("reads a valid persisted score", () => {
    expect(parseRecallImportance(FM(`${RECALL_IMPORTANCE_KEY}: 4`))).toBe(4);
  });
  it("returns undefined when absent or out of range", () => {
    expect(parseRecallImportance(FM())).toBeUndefined();
    expect(parseRecallImportance(FM(`${RECALL_IMPORTANCE_KEY}: 9`))).toBeUndefined();
    expect(parseRecallImportance("no frontmatter at all")).toBeUndefined();
  });
});

describe("stampRecallImportance — surgical, idempotent, author-respecting", () => {
  it("inserts the key when absent (write-time assignment)", () => {
    const r = stampRecallImportance(FM(), 5);
    expect(r.changed).toBe(true);
    expect(parseRecallImportance(r.content)).toBe(5);
    // other frontmatter preserved
    expect(r.content).toContain("type: decision");
    expect(r.content).toContain("owner: x");
    expect(r.content).toContain("body text here");
  });
  it("is idempotent — write-once: a present key is left as-is without force (even if different)", () => {
    const once = stampRecallImportance(FM(), 5).content;
    const again = stampRecallImportance(once, 2); // different score, no force
    expect(again.changed).toBe(false);
    expect(again.skipped).toBe("already");
    expect(parseRecallImportance(again.content)).toBe(5); // unchanged
  });
  it("force updates an existing value (explicit re-grade)", () => {
    const once = stampRecallImportance(FM(), 5).content;
    const forced = stampRecallImportance(once, 2, { force: true });
    expect(forced.changed).toBe(true);
    expect(parseRecallImportance(forced.content)).toBe(2);
  });
  it("force is a no-op when the value already equals the target", () => {
    const once = stampRecallImportance(FM(), 5).content;
    const same = stampRecallImportance(once, 5, { force: true });
    expect(same.changed).toBe(false);
  });
  it("never touches a pinned page (author override)", () => {
    const pinned = FM("recall_importance_pinned: true");
    expect(isRecallImportancePinned(pinned)).toBe(true);
    const r = stampRecallImportance(pinned, 5);
    expect(r.changed).toBe(false);
    expect(r.skipped).toBe("pinned");
    expect(parseRecallImportance(r.content)).toBeUndefined();
  });
  it("creates a minimal frontmatter block when none exists (unless createFrontmatter=false)", () => {
    const r = stampRecallImportance("just a body\n", 3);
    expect(r.changed).toBe(true);
    expect(parseRecallImportance(r.content)).toBe(3);
    expect(r.content).toContain("just a body");
    const noCreate = stampRecallImportance("just a body\n", 3, { createFrontmatter: false });
    expect(noCreate.changed).toBe(false);
    expect(noCreate.skipped).toBe("no-frontmatter-nocreate");
  });
  it("refuses an out-of-range score (no-op)", () => {
    expect(stampRecallImportance(FM(), 9).changed).toBe(false);
    expect(stampRecallImportance(FM(), 0).changed).toBe(false);
  });
});

describe("resolveRecallImportance — persisted wins, else category-derived", () => {
  it("prefers a valid persisted score over the category derivation", () => {
    // category says 5 (decisions) but the page persisted 2 → resolver returns 2
    const page = FM(`${RECALL_IMPORTANCE_KEY}: 2`);
    expect(resolveRecallImportance(page, "decisions")).toBe(2);
  });
  it("falls back to category derivation when unstamped (byte-identical legacy behavior)", () => {
    expect(resolveRecallImportance(FM(), "decisions")).toBe(5);
    expect(resolveRecallImportance(FM(), "context")).toBe(2);
    expect(resolveRecallImportance(FM(), undefined)).toBe(3);
  });
  it("ignores an out-of-range persisted value and derives instead", () => {
    expect(resolveRecallImportance(FM(`${RECALL_IMPORTANCE_KEY}: 9`), "standards")).toBe(4);
  });
});
