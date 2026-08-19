/**
 * hooks/__tests__/redact-log-path-exemption.test.ts
 *
 * Regression: the group-4 high-entropy scrub must NOT redact ordinary
 * repo-relative file paths. Observed 2026-07-13: writing a wiki page's
 * `source_refs:` frontmatter turned `scripts/learn/extract-structural.ts`
 * into `<HIGH_ENTROPY_REDACTED>-structural.ts` — the entropy pattern
 * `[A-Za-z0-9+/=]{20,}` fired on the ≥20-char letters+slashes prefix once
 * `-`/`.` split the run.
 */

import {
  redactField,
  redactHighEntropy,
  isRelativePathToken,
  HIGH_ENTROPY_REDACTED,
} from "../lib/v1.4/redact-log";

describe("group 4 — repo-relative path exemption", () => {
  it("preserves the observed wiki source_refs paths verbatim (regression)", () => {
    const input = [
      "source_refs:",
      "  - scripts/learn/extract-structural.ts",
      "  - scripts/learn/resolve-calls.ts",
      "  - skills/knowledge/learn-diff/SKILL.md",
      "  - scripts/learn/diff-learn.ts",
    ].join("\n");
    const out = redactField(input);
    expect(out).toBe(input);
    expect(out).not.toContain(HIGH_ENTROPY_REDACTED);
  });

  it("preserves paths embedded in prose and markdown links", () => {
    const input =
      "See [initiative-workitems.ts](src/modules/initiatives/workflows/initiative-workitems.ts:42) " +
      "and hooks/lib/security/scrubbed-write.ts for the choke-point.";
    expect(redactHighEntropy(input)).toBe(input);
  });

  it("preserves Guild's hidden repo-relative namespace, including canonical run ids", () => {
    const input = [
      ".guild/wiki/decisions/workspace-knowledge-flow.md",
      ".guild/runs/run-20260812-010000-hook-output/handoffs/security-W4.md",
      ".guild/initiatives/active/hook-output-hygiene/initiative.yaml",
      ".guild/artifacts/audits/hook-output-budget.json",
    ].join("\n");
    expect(redactHighEntropy(input)).toBe(input);
  });

  it("preserves ./-prefixed relative paths", () => {
    const input = "run ./scripts/docs-hygiene/scan-everything-now.ts first";
    expect(redactHighEntropy(input)).toBe(input);
  });

  it("still redacts a base64 blob (contains +/=)", () => {
    const blob = "QmFzZTY0U2VjcmV0RGF0YUhlcmU+x7/abc=";
    const out = redactHighEntropy(`payload: ${blob}`);
    expect(out).not.toContain(blob);
    expect(out).toContain(HIGH_ENTROPY_REDACTED);
  });

  it("still redacts a slash-containing random token whose words exceed the entropy threshold", () => {
    // A path-shaped wrapper around a ≥20-char unbroken run must not smuggle
    // the blob through the exemption.
    const blob = "keys/aBcDeFgHiJkLmNoPqRsTuVwXyZ01234/data.txt";
    const out = redactHighEntropy(blob);
    expect(out).toContain(HIGH_ENTROPY_REDACTED);
  });

  it("does not exempt a single-slash extensionless random token", () => {
    const token = "abcdefghijQRS/klmnopqrstuvw";
    const out = redactHighEntropy(`value ${token} end`);
    expect(out).toContain(HIGH_ENTROPY_REDACTED);
  });

  it("still redacts path-shaped secrets built from short mixed-case chunks (codex bypass candidates)", () => {
    // Each chunk is <20 chars, but random base64 material is case/digit
    // mixed — it must fail the wordish check and stay redacted.
    const candidates = [
      "cache/Zm9vYmFyYmF6cXV4/MTIzNDU2Nzg5MDEy.bin",
      "aBcDeFgHiJkLmNoPqrst/0123456789abcdefij.txt",
      "key-abcdefghijklmnopqrs/ABCDEFGHIJKLMNOP.sig",
      // Round 2: several short ALLCAPS / digit-only chunks must not add up
      // to an exemption (opaque budget = 1 per token).
      "cache/ABCDEFGH/IJKLMNOP/QRSTUVWX.bin",
      "cache/12345678/90123456/78901234.bin",
      ".guild/cache/Zm9vYmFyYmF6cXV4/MTIzNDU2Nzg5MDEy.bin",
      ".guild/cache/aBcdefGhij/kLmnoPqrst/uVwxyzAbcd/file.txt",
      ".guild/cache/abcdefghij/klmnopqrst/uvwxyzabcd/file.txt",
      ".guild/cache/12/34/56/78/90/12/34/56/78/90/secret.bin",
      ".guild/wiki/aBcdefGhij/kLmnoPqrst/uVwxyzAbcd/file.txt",
    ];
    for (const c of candidates) {
      const out = redactHighEntropy(`payload: ${c}`);
      expect(out).toContain(HIGH_ENTROPY_REDACTED);
    }
  });

  it("preserves PascalCase/camelCase and ALLCAPS path segments", () => {
    const input =
      "src/components/UserProfileCard.tsx and docs/README.md plus skills/knowledge/SKILL.md";
    expect(redactHighEntropy(input)).toBe(input);
  });

  it("preserves version-numbered path segments (short digit words are free)", () => {
    const input = "vendor/node-v22.1.0/lib/internal/modules.js";
    expect(redactHighEntropy(input)).toBe(input);
  });

  it("bails to redaction on an implausibly long path-like token (DoS cap)", () => {
    const huge = "src/" + "abcdefghijklmnopqrst-".repeat(300) + "x.ts";
    const started = Date.now();
    const out = redactHighEntropy(huge);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out).toContain(HIGH_ENTROPY_REDACTED);
  });

  it("keeps absolute and home-dir paths on their existing (redacted) behavior", () => {
    // Absolute operator paths are not repo-relative provenance; the exemption
    // must not widen to them.
    expect(isRelativePathToken("Users/someoperator/Projects", "/Users/someoperator/Projects/guild", 1)).toBe(false);
    const abs = "/Users/someoperator/Projects/guild/plugin";
    expect(redactHighEntropy(abs)).toContain(HIGH_ENTROPY_REDACTED);
  });

  it("isRelativePathToken accepts a partial match inside a hyphenated path", () => {
    const full = "  - scripts/learn/extract-structural.ts";
    const candidate = "scripts/learn/extract";
    const idx = full.indexOf(candidate);
    expect(isRelativePathToken(candidate, full, idx)).toBe(true);
  });
});
