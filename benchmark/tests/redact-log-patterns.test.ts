// v1.4.0 — T8-backend-remediation tests for F5-T8 (GitHub token family).
//
// Pins the two new token-shape patterns added in lockstep across:
//   - benchmark/src/runner.ts §REDACTION_PATTERNS
//   - benchmark/src/redact-log.ts §TOKEN_SHAPE_PATTERNS
//
// Coverage: ghs_, gho_, ghu_, ghr_ (unified `gh[suor]_<36>`),
// github_pat_<22>_<59> (fine-grained PAT, 82-char body), plus a negative
// case for `ghs_short` (< 36 chars after prefix).
//
// The 1:1 cross-file equivalence is policed by the drift sentinel in
// `redact-log.test.ts`; this file pins the runtime behavior of the new
// patterns themselves.

import { describe, expect, it } from "vitest";

import { TOKEN_REDACTED, redactTokenShapes } from "../src/redact-log.js";

describe("redact-log / group 1 — GitHub token family (F5-T8 patches)", () => {
  it("redacts a GitHub server-to-server token (ghs_…)", () => {
    const token = "ghs_" + "a".repeat(36);
    const out = redactTokenShapes(`auth=${token} ok`);
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toContain(token);
  });

  it("redacts a GitHub OAuth token (gho_…)", () => {
    const token = "gho_" + "B".repeat(36);
    const out = redactTokenShapes(`token: ${token}`);
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toContain(token);
  });

  it("redacts a GitHub user-to-server token (ghu_…)", () => {
    const token = "ghu_" + "1".repeat(36);
    const out = redactTokenShapes(`bearer ${token} end`);
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toContain(token);
  });

  it("redacts a GitHub refresh token (ghr_…)", () => {
    const token = "ghr_" + "Z".repeat(36);
    const out = redactTokenShapes(`refresh=${token}`);
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toContain(token);
  });

  it("redacts a GitHub fine-grained PAT (github_pat_…_…)", () => {
    // 22-char prefix + `_` + 59-char body = 82 alphanumeric+underscore
    // chars after the `github_pat_` literal.
    const prefix = "A".repeat(22);
    const body = "b".repeat(59);
    const token = `github_pat_${prefix}_${body}`;
    const out = redactTokenShapes(`pat=${token} ok`);
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toContain(token);
  });

  it("does not redact 'ghs_short'", () => {
    // Negative case: less than 36 chars after the `ghs_` prefix must
    // pass through unchanged so the regex doesn't over-match.
    expect(redactTokenShapes("ghs_short")).toBe("ghs_short");
  });
});
