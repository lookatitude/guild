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
