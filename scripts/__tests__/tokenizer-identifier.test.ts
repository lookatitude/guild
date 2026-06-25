/**
 * scripts/__tests__/tokenizer-identifier.test.ts
 *
 * G7 (T7.1) — camel/snake-aware identifier tokenizer.
 *
 * Asserts the shared `tokenizeIdentifierAware` splits camelCase/PascalCase so a
 * snake_case query (`process_order`) matches a camelCase symbol (`processOrder`/
 * `ProcessOrder`), AND that it stays a strict SUPER-SET of the classic `tokenize`
 * for plain prose (so existing BM25 ranking is unchanged).
 *
 * Run: cd scripts && npx jest --no-coverage tokenizer
 */

import {
  tokenize,
  tokenizeIdentifierAware,
  bm25Score,
} from "../lib/shared/bm25";

describe("G7 — identifier-aware tokenizer (camel/snake)", () => {
  test("snake_case and camelCase produce overlapping sub-tokens (the core G7 fix)", () => {
    const snake = tokenizeIdentifierAware("process_order");
    const camel = tokenizeIdentifierAware("processOrder");
    const pascal = tokenizeIdentifierAware("ProcessOrder");

    // All three share the [process, order] sub-tokens → they match each other.
    for (const toks of [snake, camel, pascal]) {
      expect(toks).toContain("process");
      expect(toks).toContain("order");
    }
    // The camel/pascal forms ALSO keep the full lowercased token (exact match).
    expect(camel).toContain("processorder");
    expect(pascal).toContain("processorder");
  });

  test("acronym boundary splits correctly (HTTPRequest → http + request)", () => {
    const toks = tokenizeIdentifierAware("HTTPRequest");
    expect(toks).toContain("http");
    expect(toks).toContain("request");
  });

  test("STRICT SUPER-SET: plain prose / snake / digits tokenize IDENTICALLY to tokenize", () => {
    // No internal uppercase boundary → must be byte-identical to classic tokenize,
    // so existing wiki BM25 ranking is provably unchanged.
    for (const s of [
      "the quick brown fox authentication settings",
      "process_order snake_case_only lower",
      "bm25 v2 plain digits 123 token",
    ]) {
      expect(tokenizeIdentifierAware(s)).toEqual(tokenize(s));
    }
  });

  test("ANTI-VACUITY: classic tokenize does NOT bridge snake↔camel (proves the new tokenizer is doing the work)", () => {
    // With the OLD tokenizer, `process_order` → [process, order] but `processOrder`
    // → [processorder] — no shared token. This is the gap G7 closes.
    const classicSnake = tokenize("process_order");
    const classicCamel = tokenize("processOrder");
    expect(classicCamel).toEqual(["processorder"]);
    expect(classicSnake.some((t) => classicCamel.includes(t))).toBe(false);
  });

  test("BM25: a snake_case query ranks a doc containing the camelCase symbol > an unrelated doc", () => {
    const q = tokenizeIdentifierAware("process_order");
    const docs = [
      { tokens: tokenizeIdentifierAware("function processOrder() { settle the invoice }") },
      { tokens: tokenizeIdentifierAware("totally unrelated content about billing cycles") },
    ];
    const scores = bm25Score(q, docs);
    expect(scores[0]!).toBeGreaterThan(0); // matched via process+order sub-tokens
    expect(scores[0]!).toBeGreaterThan(scores[1]!);
    expect(scores[1]!).toBe(0); // no shared tokens → zero
  });
});
