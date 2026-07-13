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
