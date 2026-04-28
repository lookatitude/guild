// v1.4.0 — T3c-backend-logging redaction tests.
// Pins the 5-pattern redaction policy from
// `benchmark/plans/v1.4-jsonl-schema.md` §"Redaction policy":
//   1. token-shape regex (REUSED from runner.ts §178-189)
//   2. home-dir absolute paths under sensitive dirs
//   3. key=value secrets (case-insensitive)
//   4. high-entropy strings (with whitelist for run-id + git context)
//   5. length truncation at 4 KiB after groups 1-4 run
//
// Each group has positive (redacts) + negative (passes through) tests.

import { describe, expect, it } from "vitest";

import {
  FIELD_SIZE_CAP_BYTES,
  HIGH_ENTROPY_REDACTED,
  HOME_DIR_PATTERN,
  KV_REDACTED,
  KV_SECRET_PATTERN,
  PATH_REDACTED,
  REDACTABLE_FIELDS,
  TOKEN_REDACTED,
  TOKEN_SHAPE_PATTERNS,
  TRUNCATION_SUFFIX,
  isWhitelistedHighEntropy,
  redactEventFields,
  redactField,
  redactHighEntropy,
  redactHomeDirPaths,
  redactKeyValueSecrets,
  redactTokenShapes,
  truncateToCap,
} from "../src/redact-log.js";

// ──────────────────────────────────────────────────────────────────────────
// Group 1 — token-shape regex
// ──────────────────────────────────────────────────────────────────────────

describe("redact-log / group 1 — token-shape regex (POSITIVE)", () => {
  it("redacts an Anthropic API key shape (sk-ant-...)", () => {
    const out = redactTokenShapes(
      "running with sk-ant-1234567890abcdefABCD1234 in env",
    );
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toContain("sk-ant-1234567890abcdefABCD1234");
  });

  it("redacts a GitHub PAT (ghp_...)", () => {
    const out = redactTokenShapes("token=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
  });

  it("redacts a Slack token (xoxb-/xoxp-)", () => {
    const out = redactTokenShapes(
      "xoxb-1234567890-abcdefghij and xoxp-987654321-aaaa",
    );
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toMatch(/xox[bp]-/);
  });

  it("redacts a JWT shape (eyJ.eyJ.sig)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature_part_here";
    const out = redactTokenShapes(`Token: ${jwt}`);
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toContain(jwt);
  });

  it("redacts an AWS access key (AKIA...)", () => {
    const out = redactTokenShapes("AKIAIOSFODNN7EXAMPLE in config");
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts an Authorization: Bearer header", () => {
    const out = redactTokenShapes("Authorization: Bearer abc.def.ghi_long_token_yes");
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toMatch(/Authorization:\s*Bearer\s+[A-Za-z0-9._\-+/=]+/);
  });

  it("token shape patterns array is non-empty", () => {
    expect(TOKEN_SHAPE_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe("redact-log / group 1 — token-shape regex (NEGATIVE)", () => {
  it("passes through a normal sentence", () => {
    expect(redactTokenShapes("Tests passing on main")).toBe("Tests passing on main");
  });

  it("does not match short hex (sk- prefix without enough chars)", () => {
    expect(redactTokenShapes("sk-short")).toBe("sk-short");
  });

  it("does not match a non-token string starting with eyJ but no segments", () => {
    expect(redactTokenShapes("eyJ_no_segments_here")).toBe("eyJ_no_segments_here");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Group 2 — home-dir absolute paths
// ──────────────────────────────────────────────────────────────────────────

describe("redact-log / group 2 — home-dir paths (POSITIVE)", () => {
  it("redacts /Users/<u>/.claude/<file>", () => {
    const out = redactHomeDirPaths("read /Users/miguelp/.claude/config.json");
    expect(out).toContain("/Users/miguelp/.claude/" + PATH_REDACTED);
    expect(out).not.toContain("config.json");
  });

  it("redacts /home/<u>/.aws/credentials", () => {
    const out = redactHomeDirPaths("loaded /home/runner/.aws/credentials");
    expect(out).toContain("/home/runner/.aws/" + PATH_REDACTED);
    expect(out).not.toContain("credentials");
  });

  it("redacts ~/.ssh/id_rsa", () => {
    const out = redactHomeDirPaths("found ~/.ssh/id_rsa file");
    expect(out).toContain("~/.ssh/" + PATH_REDACTED);
    expect(out).not.toContain("id_rsa");
  });

  it("redacts /Users/<u>/.codex/auth.json", () => {
    const out = redactHomeDirPaths("config: /Users/alice/.codex/auth.json yes");
    expect(out).toContain("/Users/alice/.codex/" + PATH_REDACTED);
  });

  it("redacts /Users/<u>/.gnupg/key.gpg", () => {
    const out = redactHomeDirPaths("/Users/bob/.gnupg/private.gpg");
    expect(out).toContain("/Users/bob/.gnupg/" + PATH_REDACTED);
  });

  it("HOME_DIR_PATTERN is exported as a RegExp", () => {
    expect(HOME_DIR_PATTERN).toBeInstanceOf(RegExp);
  });
});

describe("redact-log / group 2 — home-dir paths (NEGATIVE)", () => {
  it("passes through /etc/hosts", () => {
    expect(redactHomeDirPaths("read /etc/hosts ok")).toBe("read /etc/hosts ok");
  });

  it("passes through repo-relative paths", () => {
    expect(redactHomeDirPaths("benchmark/plans/adr-006.md")).toBe(
      "benchmark/plans/adr-006.md",
    );
  });

  it("passes through /Users/<u>/Projects/...", () => {
    expect(redactHomeDirPaths("/Users/miguelp/Projects/guild/README.md")).toBe(
      "/Users/miguelp/Projects/guild/README.md",
    );
  });

  it("does not match non-sensitive dirs like ~/Documents", () => {
    expect(redactHomeDirPaths("~/Documents/notes.md")).toBe("~/Documents/notes.md");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Group 3 — key=value secrets
// ──────────────────────────────────────────────────────────────────────────

describe("redact-log / group 3 — key=value secrets (POSITIVE)", () => {
  it("redacts password=hunter2", () => {
    expect(redactKeyValueSecrets("password=hunter2 logged")).toBe(
      `password=${KV_REDACTED} logged`,
    );
  });

  it("redacts token: secrettoken123 (colon, space)", () => {
    expect(redactKeyValueSecrets("token: secrettoken123")).toBe(
      `token: ${KV_REDACTED}`,
    );
  });

  it("redacts api_key=abcDEF", () => {
    expect(redactKeyValueSecrets("api_key=abcDEF456")).toBe(
      `api_key=${KV_REDACTED}`,
    );
  });

  it("redacts api-key=foo (hyphen variant)", () => {
    expect(redactKeyValueSecrets("api-key=foobar")).toBe(`api-key=${KV_REDACTED}`);
  });

  it("redacts apikey=foo (squashed variant)", () => {
    expect(redactKeyValueSecrets("apikey=baz")).toBe(`apikey=${KV_REDACTED}`);
  });

  it("redacts SECRET=Z (case-insensitive)", () => {
    expect(redactKeyValueSecrets("SECRET=Zvalue")).toBe(`SECRET=${KV_REDACTED}`);
  });

  it("redacts authorization: bearertoken", () => {
    expect(redactKeyValueSecrets("authorization: bearertoken-xyz")).toBe(
      `authorization: ${KV_REDACTED}`,
    );
  });

  it("KV_SECRET_PATTERN exported", () => {
    expect(KV_SECRET_PATTERN).toBeInstanceOf(RegExp);
  });
});

describe("redact-log / group 3 — key=value secrets (NEGATIVE)", () => {
  it("passes through user=alice (not in key list)", () => {
    expect(redactKeyValueSecrets("user=alice")).toBe("user=alice");
  });

  it("passes through count=5", () => {
    expect(redactKeyValueSecrets("count=5")).toBe("count=5");
  });

  it("passes through 'tokenizer is fast' (no separator)", () => {
    expect(redactKeyValueSecrets("tokenizer is fast")).toBe("tokenizer is fast");
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Group 4 — high-entropy strings with whitelist
// ──────────────────────────────────────────────────────────────────────────

describe("redact-log / group 4 — high-entropy (POSITIVE)", () => {
  it("redacts a 32-char base64-like blob", () => {
    const blob = "aB3cD9eF2gH7iJkLmNoP4qRsT8uVwXyZ";
    const out = redactHighEntropy(`payload=${blob} end`);
    expect(out).toContain(HIGH_ENTROPY_REDACTED);
    expect(out).not.toContain(blob);
  });

  it("redacts a 25-char hex-like string with no git context", () => {
    const hex = "abcdef0123456789abcdef012";
    const out = redactHighEntropy(`mystery ${hex} value`);
    expect(out).toContain(HIGH_ENTROPY_REDACTED);
  });
});

describe("redact-log / group 4 — high-entropy (NEGATIVE)", () => {
  it("passes through a run-id (run-XXXX prefix)", () => {
    const id = "run-2026-04-27-v1.4.0-adversarial-loops";
    expect(redactHighEntropy(`opened ${id} now`)).toContain(id);
  });

  it("passes through a 40-char SHA-1 commit hash (no context)", () => {
    const sha1 = "a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4";
    expect(redactHighEntropy(`hash: ${sha1}`)).toContain(sha1);
  });

  it("passes through a 64-char SHA-256 hash", () => {
    const sha256 = "a".repeat(64);
    expect(redactHighEntropy(sha256)).toBe(sha256);
  });

  it("passes through commit <sha> when sha is short (< 20 chars)", () => {
    expect(redactHighEntropy("commit a1b2c3d4")).toBe("commit a1b2c3d4");
  });

  it("isWhitelistedHighEntropy detects run-id context", () => {
    const input = "id=run-1234567890abcdefABCD12";
    const idx = input.indexOf("1234567890abcdefABCD12");
    expect(isWhitelistedHighEntropy("1234567890abcdefABCD12", input, idx)).toBe(true);
  });

  it("isWhitelistedHighEntropy detects git commit context", () => {
    const input = "commit abcdef1234567890abcdef12";
    const idx = input.indexOf("abcdef1234567890abcdef12");
    expect(isWhitelistedHighEntropy("abcdef1234567890abcdef12", input, idx)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Group 5 — length truncation
// ──────────────────────────────────────────────────────────────────────────

describe("redact-log / group 5 — length truncation (POSITIVE)", () => {
  it("truncates a string > 4 KiB to exactly 4 KiB + sentinel", () => {
    const big = "x".repeat(8000);
    const out = truncateToCap(big);
    expect(out.endsWith(TRUNCATION_SUFFIX)).toBe(true);
    expect(out.length).toBe(FIELD_SIZE_CAP_BYTES + TRUNCATION_SUFFIX.length);
  });

  it("respects an explicit cap argument", () => {
    const out = truncateToCap("hello world", 5);
    expect(out).toBe("hello" + TRUNCATION_SUFFIX);
  });
});

describe("redact-log / group 5 — length truncation (NEGATIVE)", () => {
  it("passes through a string ≤ 4 KiB unchanged", () => {
    const small = "tiny string";
    expect(truncateToCap(small)).toBe(small);
  });

  it("passes through an exact 4 KiB string unchanged", () => {
    const exact = "a".repeat(FIELD_SIZE_CAP_BYTES);
    expect(truncateToCap(exact)).toBe(exact);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Composite — redactField runs all 5 groups in order
// ──────────────────────────────────────────────────────────────────────────

describe("redact-log / redactField composite", () => {
  it("redacts a JWT inside a key=value pair (group 1 wins)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature_part_here";
    const out = redactField(`Authorization: Bearer ${jwt}`);
    // Token shape catches the bearer prefix; result has TOKEN_REDACTED.
    expect(out).toContain(TOKEN_REDACTED);
    expect(out).not.toContain(jwt);
  });

  it("redacts both home-dir path AND kv pair in one input", () => {
    const out = redactField("password=hunter2 ; loaded /Users/x/.ssh/id_rsa");
    expect(out).toContain(KV_REDACTED);
    expect(out).toContain("/Users/x/.ssh/" + PATH_REDACTED);
  });

  it("truncates after redaction (group 5 last)", () => {
    // Input must remain > 4 KiB AFTER groups 1-4 collapse the
    // password= secret. We pad with non-secret text so truncation
    // (group 5) is the surviving transformation.
    const filler = "ordinary safe content that does not match any redaction rule. ";
    const big = `password=hunter2 ` + filler.repeat(120);
    expect(big.length).toBeGreaterThan(FIELD_SIZE_CAP_BYTES);
    const out = redactField(big);
    expect(out.endsWith(TRUNCATION_SUFFIX)).toBe(true);
    expect(out).toContain(`password=${KV_REDACTED}`);
  });

  it("non-string input passes through (defensive)", () => {
    // Cast to bypass static check; the runtime handles defensively.
    const result = redactField(42 as unknown as string);
    expect(result).toBe(42 as unknown as string);
  });
});

describe("redact-log / redactEventFields", () => {
  it("redacts redactable fields and leaves others alone", () => {
    const ev = {
      ts: "2026-04-27T07:00:00.000Z",
      event: "tool_call",
      run_id: "run-test",
      tool: "Bash",
      command_redacted: "password=hunter2 npm test",
      result_excerpt_redacted: "OK",
      latency_ms: 100,
      status: "ok",
    };
    const out = redactEventFields(ev);
    expect(out.command_redacted).toContain(KV_REDACTED);
    expect(out.tool).toBe("Bash");
    expect(out.run_id).toBe("run-test");
    expect(out.latency_ms).toBe(100);
  });

  it("redacts assumption_text fields", () => {
    const ev = {
      ts: "2026-04-27T07:00:00.000Z",
      event: "assumption_logged",
      run_id: "run-test",
      lane_id: "T1",
      specialist: "backend",
      assumption_text: "uses sk-ant-1234567890abcdefABCD1234 sometimes",
    };
    const out = redactEventFields(ev);
    expect(out.assumption_text).toContain(TOKEN_REDACTED);
  });

  it("REDACTABLE_FIELDS exposes the canonical set", () => {
    expect(REDACTABLE_FIELDS.has("command_redacted")).toBe(true);
    expect(REDACTABLE_FIELDS.has("result_excerpt_redacted")).toBe(true);
    expect(REDACTABLE_FIELDS.has("payload_excerpt_redacted")).toBe(true);
    expect(REDACTABLE_FIELDS.has("prompt_excerpt")).toBe(true);
    expect(REDACTABLE_FIELDS.has("assumption_text")).toBe(true);
    // Non-redactable fields:
    expect(REDACTABLE_FIELDS.has("ts")).toBe(false);
    expect(REDACTABLE_FIELDS.has("run_id")).toBe(false);
    expect(REDACTABLE_FIELDS.has("tool")).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Drift detection — token-shape regex stays aligned with runner.ts
// ──────────────────────────────────────────────────────────────────────────

describe("redact-log / drift sentinel — token-shape patterns mirror runner.ts", () => {
  it("includes the sk- (Anthropic) prefix pattern verbatim", () => {
    const sources = TOKEN_SHAPE_PATTERNS.map((re) => re.source);
    expect(sources).toContain("\\bsk-(ant-)?[A-Za-z0-9_-]{20,}");
  });

  it("includes the ghp_ (GitHub PAT) pattern verbatim", () => {
    const sources = TOKEN_SHAPE_PATTERNS.map((re) => re.source);
    expect(sources).toContain("\\bghp_[A-Za-z0-9]{36}\\b");
  });

  it("includes the Authorization: Bearer pattern verbatim", () => {
    const sources = TOKEN_SHAPE_PATTERNS.map((re) => re.source);
    expect(sources).toContain("Authorization:\\s*Bearer\\s+[A-Za-z0-9._\\-+/=]+");
  });

  it("includes 9 patterns matching runner.ts §178-189 list size", () => {
    // v1.4.0 — F5-T8 (T8-backend-remediation) added 2 GitHub-family
    // patterns: gh[suor]_ and github_pat_. Cross-file equivalence is
    // separately enforced by the drift sentinel below.
    expect(TOKEN_SHAPE_PATTERNS.length).toBe(9);
  });

  it("mirrors runner.ts REDACTION_PATTERNS one-to-one (sourced from import, not hard-coded)", async () => {
    // Import the runner's pattern list directly so any future edit to
    // runner.ts that adds/removes/reorders/edits a pattern fails this
    // test without code-side changes here. This is the authoritative
    // drift-detection sentinel.
    const { REDACTION_PATTERNS } = await import("../src/runner.js");
    const runnerSources = REDACTION_PATTERNS.map((p) => p.re.source);
    const redactSources = TOKEN_SHAPE_PATTERNS.map((re) => re.source);
    expect(redactSources).toEqual(runnerSources);
    // Also pin the count check derives from the imported list, not a
    // magic number.
    expect(TOKEN_SHAPE_PATTERNS.length).toBe(REDACTION_PATTERNS.length);
  });
});
