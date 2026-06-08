/**
 * Tests for hooks/lib/handoff-v2.ts
 *
 * Covers: type validation, size-cap bloat rejection (SC-7/VC-7),
 * escalate_reason coupling, optional fields, isHandoffV2 guard.
 */

import {
  validateHandoffV2,
  isHandoffV2,
  SUMMARY_MAX_CHARS,
  NOTES_MAX_CHARS,
  ALLOWED_TOP_LEVEL_KEYS,
  HandoffV2,
} from "../lib/handoff-v2";

const VALID_BASE: HandoffV2 = {
  schema_version: "guild.handoff.v2",
  task_id: "backend-api-001",
  tier: "mid",
  status: "done",
  summary: "Implemented the auth endpoints.",
  artifacts: ["src/auth.ts:1-80"],
  issues: [],
};

describe("validateHandoffV2 — valid envelopes", () => {
  it("accepts a minimal valid envelope", () => {
    const result = validateHandoffV2(VALID_BASE);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts all three tiers", () => {
    for (const tier of ["cheap", "mid", "powerful"] as const) {
      const result = validateHandoffV2({ ...VALID_BASE, tier });
      expect(result.valid).toBe(true);
    }
  });

  it("accepts all three statuses (non-escalate)", () => {
    for (const status of ["done", "blocked"] as const) {
      const result = validateHandoffV2({ ...VALID_BASE, status });
      expect(result.valid).toBe(true);
    }
  });

  it("accepts status=escalate with escalate_reason present", () => {
    const result = validateHandoffV2({
      ...VALID_BASE,
      status: "escalate",
      escalate_reason: "Cannot determine the correct schema topology",
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts optional learnings array", () => {
    const result = validateHandoffV2({
      ...VALID_BASE,
      learnings: ["Prefer typed returns over prose", "File scan is cheap-tier work"],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts optional notes within 200 char cap", () => {
    const result = validateHandoffV2({
      ...VALID_BASE,
      notes: "A" .repeat(NOTES_MAX_CHARS),
    });
    expect(result.valid).toBe(true);
  });

  it("accepts empty artifacts and issues arrays", () => {
    const result = validateHandoffV2({ ...VALID_BASE, artifacts: [], issues: [] });
    expect(result.valid).toBe(true);
  });

  it("accepts summary exactly at the char cap", () => {
    const result = validateHandoffV2({
      ...VALID_BASE,
      summary: "x".repeat(SUMMARY_MAX_CHARS),
    });
    expect(result.valid).toBe(true);
  });
});

describe("validateHandoffV2 — schema_version", () => {
  it("rejects wrong schema_version", () => {
    const result = validateHandoffV2({ ...VALID_BASE, schema_version: "guild.handoff.v1" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  it("rejects missing schema_version", () => {
    const { schema_version: _sv, ...rest } = VALID_BASE;
    const result = validateHandoffV2(rest);
    expect(result.valid).toBe(false);
  });
});

describe("validateHandoffV2 — required fields", () => {
  it("rejects empty task_id", () => {
    const result = validateHandoffV2({ ...VALID_BASE, task_id: "  " });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("task_id"))).toBe(true);
  });

  it("rejects invalid tier", () => {
    const result = validateHandoffV2({ ...VALID_BASE, tier: "ultra" as never });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("tier"))).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = validateHandoffV2({ ...VALID_BASE, status: "pending" as never });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("rejects missing summary", () => {
    const { summary: _s, ...rest } = VALID_BASE;
    const result = validateHandoffV2(rest);
    expect(result.valid).toBe(false);
  });

  it("rejects empty summary", () => {
    const result = validateHandoffV2({ ...VALID_BASE, summary: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("summary"))).toBe(true);
  });

  it("rejects artifacts as non-array", () => {
    const result = validateHandoffV2({ ...VALID_BASE, artifacts: "src/foo.ts" as never });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("artifacts"))).toBe(true);
  });

  it("rejects issues as non-array", () => {
    const result = validateHandoffV2({ ...VALID_BASE, issues: null as never });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("issues"))).toBe(true);
  });
});

describe("validateHandoffV2 — bloat rejection (SC-7)", () => {
  it("rejects summary over SUMMARY_MAX_CHARS", () => {
    const result = validateHandoffV2({
      ...VALID_BASE,
      summary: "x".repeat(SUMMARY_MAX_CHARS + 1),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("summary") && e.includes("cap"))).toBe(true);
  });

  it("rejects notes over NOTES_MAX_CHARS", () => {
    const result = validateHandoffV2({
      ...VALID_BASE,
      notes: "x".repeat(NOTES_MAX_CHARS + 1),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("notes") && e.includes("cap"))).toBe(true);
  });
});

describe("validateHandoffV2 — escalate coupling", () => {
  it("rejects status=escalate without escalate_reason", () => {
    const result = validateHandoffV2({ ...VALID_BASE, status: "escalate" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("escalate_reason"))).toBe(true);
  });

  it("rejects status=escalate with empty escalate_reason", () => {
    const result = validateHandoffV2({
      ...VALID_BASE,
      status: "escalate",
      escalate_reason: "   ",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("escalate_reason"))).toBe(true);
  });

  it("does not require escalate_reason when status=done", () => {
    const result = validateHandoffV2({ ...VALID_BASE, status: "done" });
    expect(result.valid).toBe(true);
  });
});

describe("validateHandoffV2 — non-object inputs", () => {
  it("rejects null", () => {
    const result = validateHandoffV2(null);
    expect(result.valid).toBe(false);
  });

  it("rejects array", () => {
    const result = validateHandoffV2([]);
    expect(result.valid).toBe(false);
  });

  it("rejects string", () => {
    const result = validateHandoffV2("guild.handoff.v2");
    expect(result.valid).toBe(false);
  });
});

describe("validateHandoffV2 — unknown-key rejection (strict v2)", () => {
  it("rejects an envelope with a single unknown top-level key", () => {
    const result = validateHandoffV2({ ...VALID_BASE, extra: "oops" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown key "extra"'))).toBe(true);
  });

  it("rejects multiple unknown keys and lists each", () => {
    const result = validateHandoffV2({ ...VALID_BASE, foo: 1, bar: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown key "foo"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('unknown key "bar"'))).toBe(true);
  });

  it("rejects the literal p2-3 drift shape (schema: instead of schema_version:, extra keys)", () => {
    // Exact p2-3 drift: used `schema` (not `schema_version`), plus `specialist` and `timestamp`
    const p23Drift = {
      schema: "guild.handoff.v2",
      task_id: "p2-3",
      specialist: "backend",
      status: "done",
      timestamp: "2026-05-27T00:00:00Z",
    };
    const result = validateHandoffV2(p23Drift);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown key "schema"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('unknown key "specialist"'))).toBe(true);
    expect(result.errors.some((e) => e.includes('unknown key "timestamp"'))).toBe(true);
  });

  it("accepts all known optional keys without error", () => {
    const result = validateHandoffV2({
      ...VALID_BASE,
      status: "escalate",
      escalate_reason: "Need clarification on topology",
      learnings: ["key insight"],
      notes: "short note",
    });
    expect(result.valid).toBe(true);
  });

  it("ALLOWED_TOP_LEVEL_KEYS export matches spec §2 (including HK-08 injection_clean)", () => {
    const expected = [
      "schema_version", "task_id", "tier", "status", "summary",
      "artifacts", "issues", "escalate_reason", "learnings", "notes",
      "injection_clean", // HK-08 additive-optional
    ];
    for (const k of expected) {
      expect(ALLOWED_TOP_LEVEL_KEYS.has(k)).toBe(true);
    }
    expect(ALLOWED_TOP_LEVEL_KEYS.size).toBe(expected.length);
  });
});

describe("isHandoffV2 type guard", () => {
  it("returns true for a valid envelope", () => {
    expect(isHandoffV2(VALID_BASE)).toBe(true);
  });

  it("returns false for an invalid envelope", () => {
    expect(isHandoffV2({ ...VALID_BASE, schema_version: "guild.handoff.v1" })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isHandoffV2(null)).toBe(false);
  });
});

// ── HK-08: injection_clean field (additive-optional) ─────────────────────────

describe("validateHandoffV2 — injection_clean field (HK-08)", () => {
  it("accepts injection_clean: clean", () => {
    const result = validateHandoffV2({ ...VALID_BASE, injection_clean: "clean" });
    expect(result.valid).toBe(true);
  });

  it("accepts injection_clean: flagged", () => {
    const result = validateHandoffV2({ ...VALID_BASE, injection_clean: "flagged" });
    expect(result.valid).toBe(true);
  });

  it("accepts injection_clean: unverified", () => {
    const result = validateHandoffV2({ ...VALID_BASE, injection_clean: "unverified" });
    expect(result.valid).toBe(true);
  });

  it("accepts envelope without injection_clean (field is optional)", () => {
    const result = validateHandoffV2(VALID_BASE);
    expect(result.valid).toBe(true);
  });

  it("rejects injection_clean with invalid value", () => {
    const result = validateHandoffV2({
      ...VALID_BASE,
      injection_clean: "unknown_value" as never,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("injection_clean"))).toBe(true);
  });

  it("isHandoffV2 returns true for envelope with injection_clean: clean", () => {
    expect(isHandoffV2({ ...VALID_BASE, injection_clean: "clean" })).toBe(true);
  });

  it("injection_clean is NOT rejected as an unknown key (HK-08 additive)", () => {
    const result = validateHandoffV2({ ...VALID_BASE, injection_clean: "clean" });
    expect(result.errors.some((e) => e.includes('unknown key "injection_clean"'))).toBe(false);
  });
});
