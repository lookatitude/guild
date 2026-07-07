/**
 * scripts/__tests__/lane-reserved-field.test.ts
 *
 * TDD suite for scripts/lib/lane-reserved-field.ts
 *
 * The module ships the reader half for the reserved per-lane `retry:` field
 * in the `team.yaml` lane/specialist schema (ADR-RE-2, v2.x).
 *
 * Coverage map:
 *  - readReservedLaneField:
 *      happy path: all three sub-fields parsed correctly
 *      partial: only max_attempts present; only backoff; only base_delay_ms
 *      absent key: lane has no retry field → undefined
 *      null / undefined lane → undefined (never throws)
 *      retry: null → undefined
 *      retry: [] (array) → undefined
 *      retry: "string" → undefined
 *      max_attempts = 0 (below minimum) → field dropped, not returned
 *      max_attempts = 1.5 (non-integer) → field dropped
 *      backoff: "unknown" → field dropped
 *      base_delay_ms = 0 → field dropped
 *      base_delay_ms = -1 → field dropped
 *      unknown extra keys in retry block → ignored (forward-compat)
 *      all sub-keys invalid → undefined (no valid key)
 *  - validateReservedLaneField:
 *      absent retry → valid=true, errors=[]
 *      well-formed block → valid=true, errors=[]
 *      bad max_attempts (< 1, non-integer) → error reported
 *      bad backoff → error reported
 *      bad base_delay_ms → error reported
 *      multiple errors at once
 *      retry not a plain object → error reported
 *      null/undefined lane → valid=true (absent = ok)
 *  - LANE_RETRY_BACKOFF_VALUES: closed set contains exactly the three strategies
 *  - No fs I/O: pure function, no temp dirs needed (no fs-touching paths)
 */

import {
  readReservedLaneField,
  validateReservedLaneField,
  LANE_RETRY_BACKOFF_VALUES,
  type LaneRetryOverride,
  type LaneRetryBackoff,
} from "../lib/lane-reserved-field";

// ---------------------------------------------------------------------------
// 1. LANE_RETRY_BACKOFF_VALUES — closed set
// ---------------------------------------------------------------------------

describe("LANE_RETRY_BACKOFF_VALUES", () => {
  it("contains exactly immediate, linear, exponential", () => {
    expect(LANE_RETRY_BACKOFF_VALUES).toHaveLength(3);
    expect(LANE_RETRY_BACKOFF_VALUES).toContain("immediate");
    expect(LANE_RETRY_BACKOFF_VALUES).toContain("linear");
    expect(LANE_RETRY_BACKOFF_VALUES).toContain("exponential");
  });
});

// ---------------------------------------------------------------------------
// 2. readReservedLaneField — happy paths
// ---------------------------------------------------------------------------

describe("readReservedLaneField — happy path", () => {
  it("reads all three sub-fields when all are valid", () => {
    const lane = {
      name: "backend",
      tier: "mid",
      retry: {
        max_attempts: 3,
        backoff: "exponential",
        base_delay_ms: 2000,
      },
    };
    const result = readReservedLaneField(lane);
    expect(result).toEqual<LaneRetryOverride>({
      max_attempts: 3,
      backoff: "exponential",
      base_delay_ms: 2000,
    });
  });

  it("reads max_attempts=1 (the no-retry back-compat value)", () => {
    const result = readReservedLaneField({ retry: { max_attempts: 1 } });
    expect(result).toEqual({ max_attempts: 1 });
  });

  it("reads all three backoff strategies correctly", () => {
    for (const backoff of LANE_RETRY_BACKOFF_VALUES) {
      const result = readReservedLaneField({ retry: { backoff } });
      expect(result).toEqual({ backoff });
    }
  });

  it("returns only max_attempts when backoff and base_delay_ms absent", () => {
    const result = readReservedLaneField({ retry: { max_attempts: 5 } });
    expect(result).toEqual({ max_attempts: 5 });
    expect(result).not.toHaveProperty("backoff");
    expect(result).not.toHaveProperty("base_delay_ms");
  });

  it("returns only backoff when max_attempts and base_delay_ms absent", () => {
    const result = readReservedLaneField({ retry: { backoff: "linear" } });
    expect(result).toEqual({ backoff: "linear" });
  });

  it("returns only base_delay_ms when max_attempts and backoff absent", () => {
    const result = readReservedLaneField({ retry: { base_delay_ms: 500 } });
    expect(result).toEqual({ base_delay_ms: 500 });
  });

  it("ignores unknown extra keys in retry block (forward-compat)", () => {
    const lane = {
      retry: {
        max_attempts: 2,
        backoff: "immediate" as LaneRetryBackoff,
        // v2.x might add jitter:, timeout_ms:, etc.
        jitter: true,
        timeout_ms: 30000,
      },
    };
    const result = readReservedLaneField(lane);
    expect(result).toEqual({ max_attempts: 2, backoff: "immediate" });
    expect(result).not.toHaveProperty("jitter");
    expect(result).not.toHaveProperty("timeout_ms");
  });

  it("ignores unrelated lane fields (name, tier, host, etc.)", () => {
    const lane = {
      name: "frontend",
      tier: "cheap",
      host: "remote-host",
      retry: { max_attempts: 2, backoff: "linear" as LaneRetryBackoff },
    };
    const result = readReservedLaneField(lane);
    expect(result).toEqual({ max_attempts: 2, backoff: "linear" });
  });
});

// ---------------------------------------------------------------------------
// 3. readReservedLaneField — absent / null / malformed → undefined
// ---------------------------------------------------------------------------

describe("readReservedLaneField — absent/null/malformed → undefined", () => {
  it("returns undefined when lane has no retry key", () => {
    expect(readReservedLaneField({ name: "backend", tier: "mid" })).toBeUndefined();
  });

  it("returns undefined for null lane (never throws)", () => {
    expect(readReservedLaneField(null)).toBeUndefined();
  });

  it("returns undefined for undefined lane (never throws)", () => {
    expect(readReservedLaneField(undefined)).toBeUndefined();
  });

  it("returns undefined when retry is null", () => {
    expect(readReservedLaneField({ retry: null })).toBeUndefined();
  });

  it("returns undefined when retry is an array", () => {
    expect(readReservedLaneField({ retry: [1, 2, 3] })).toBeUndefined();
  });

  it("returns undefined when retry is a string", () => {
    expect(readReservedLaneField({ retry: "3/exponential" })).toBeUndefined();
  });

  it("returns undefined when retry is a number", () => {
    expect(readReservedLaneField({ retry: 42 })).toBeUndefined();
  });

  it("returns undefined when retry is an empty object (no actionable keys)", () => {
    expect(readReservedLaneField({ retry: {} })).toBeUndefined();
  });

  it("returns undefined when all sub-keys are invalid (none passes validation)", () => {
    const lane = {
      retry: {
        max_attempts: 0,       // below minimum
        backoff: "turbo",      // not in closed set
        base_delay_ms: -100,   // negative
      },
    };
    expect(readReservedLaneField(lane)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. readReservedLaneField — per-field edge cases (invalid values dropped)
// ---------------------------------------------------------------------------

describe("readReservedLaneField — invalid sub-field values silently dropped", () => {
  it("drops max_attempts=0 (below minimum 1)", () => {
    const result = readReservedLaneField({
      retry: { max_attempts: 0, backoff: "immediate" },
    });
    expect(result).toEqual({ backoff: "immediate" });
    expect(result).not.toHaveProperty("max_attempts");
  });

  it("drops max_attempts=1.5 (non-integer)", () => {
    const result = readReservedLaneField({
      retry: { max_attempts: 1.5, backoff: "linear" },
    });
    expect(result).toEqual({ backoff: "linear" });
    expect(result).not.toHaveProperty("max_attempts");
  });

  it("drops max_attempts when it is a string", () => {
    const result = readReservedLaneField({
      retry: { max_attempts: "3", backoff: "exponential" },
    });
    expect(result).toEqual({ backoff: "exponential" });
    expect(result).not.toHaveProperty("max_attempts");
  });

  it("drops backoff when not in the closed set", () => {
    const result = readReservedLaneField({
      retry: { max_attempts: 2, backoff: "turbo" },
    });
    expect(result).toEqual({ max_attempts: 2 });
    expect(result).not.toHaveProperty("backoff");
  });

  it("drops base_delay_ms=0 (not positive)", () => {
    const result = readReservedLaneField({
      retry: { max_attempts: 2, base_delay_ms: 0 },
    });
    expect(result).toEqual({ max_attempts: 2 });
    expect(result).not.toHaveProperty("base_delay_ms");
  });

  it("drops base_delay_ms=-1 (negative)", () => {
    const result = readReservedLaneField({
      retry: { base_delay_ms: -1, backoff: "immediate" },
    });
    expect(result).toEqual({ backoff: "immediate" });
    expect(result).not.toHaveProperty("base_delay_ms");
  });

  it("drops base_delay_ms=500.5 (non-integer)", () => {
    const result = readReservedLaneField({
      retry: { base_delay_ms: 500.5, backoff: "linear" },
    });
    expect(result).toEqual({ backoff: "linear" });
    expect(result).not.toHaveProperty("base_delay_ms");
  });
});

// ---------------------------------------------------------------------------
// 5. readReservedLaneField — contract guarantees
// ---------------------------------------------------------------------------

describe("readReservedLaneField — contract guarantees", () => {
  it("is pure: same input always produces same output", () => {
    const lane = { retry: { max_attempts: 3, backoff: "exponential" } };
    const r1 = readReservedLaneField(lane);
    const r2 = readReservedLaneField(lane);
    expect(r1).toEqual(r2);
  });

  it("does not mutate the input lane object", () => {
    const lane = { name: "x", retry: { max_attempts: 2, backoff: "linear" } };
    const before = JSON.stringify(lane);
    readReservedLaneField(lane);
    expect(JSON.stringify(lane)).toBe(before);
  });

  it("does not throw for any of: null, undefined, [], {}, string, number inputs", () => {
    const inputs: unknown[] = [null, undefined, [], {}, "string", 42, true];
    for (const input of inputs) {
      expect(() =>
        readReservedLaneField(input as Parameters<typeof readReservedLaneField>[0]),
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. validateReservedLaneField — strict authoring-time validator
// ---------------------------------------------------------------------------

describe("validateReservedLaneField — absent field", () => {
  it("lane without retry key → valid=true, no errors", () => {
    expect(validateReservedLaneField({ name: "backend" })).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("null lane → valid=true, no errors (field absent = ok)", () => {
    expect(validateReservedLaneField(null)).toEqual({ valid: true, errors: [] });
  });

  it("undefined lane → valid=true, no errors", () => {
    expect(validateReservedLaneField(undefined)).toEqual({ valid: true, errors: [] });
  });

  it("retry: null → valid=true, no errors (null treated as absent)", () => {
    expect(validateReservedLaneField({ retry: null })).toEqual({
      valid: true,
      errors: [],
    });
  });
});

describe("validateReservedLaneField — well-formed block", () => {
  it("full valid block → valid=true, no errors", () => {
    const result = validateReservedLaneField({
      retry: { max_attempts: 3, backoff: "exponential", base_delay_ms: 1000 },
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("partial valid block (only max_attempts) → valid=true", () => {
    expect(validateReservedLaneField({ retry: { max_attempts: 1 } })).toEqual({
      valid: true,
      errors: [],
    });
  });
});

describe("validateReservedLaneField — invalid sub-fields", () => {
  it("max_attempts = 0 → error", () => {
    const { valid, errors } = validateReservedLaneField({
      retry: { max_attempts: 0 },
    });
    expect(valid).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/max_attempts/);
  });

  it("max_attempts = -2 → error", () => {
    const { valid, errors } = validateReservedLaneField({
      retry: { max_attempts: -2 },
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/max_attempts/);
  });

  it("max_attempts = 1.5 (non-integer) → error", () => {
    const { valid, errors } = validateReservedLaneField({
      retry: { max_attempts: 1.5 },
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/max_attempts/);
  });

  it("backoff = 'turbo' → error", () => {
    const { valid, errors } = validateReservedLaneField({
      retry: { backoff: "turbo" },
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/backoff/);
  });

  it("base_delay_ms = 0 → error", () => {
    const { valid, errors } = validateReservedLaneField({
      retry: { base_delay_ms: 0 },
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/base_delay_ms/);
  });

  it("base_delay_ms = -500 → error", () => {
    const { valid, errors } = validateReservedLaneField({
      retry: { base_delay_ms: -500 },
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/base_delay_ms/);
  });

  it("retry is an array (not plain object) → error", () => {
    const { valid, errors } = validateReservedLaneField({
      retry: [1, 2, 3],
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/plain object/);
  });

  it("retry is a string → error", () => {
    const { valid, errors } = validateReservedLaneField({
      retry: "3/exponential",
    });
    expect(valid).toBe(false);
    expect(errors[0]).toMatch(/plain object/);
  });

  it("multiple invalid fields → multiple errors", () => {
    const { valid, errors } = validateReservedLaneField({
      retry: {
        max_attempts: 0,
        backoff: "turbo",
        base_delay_ms: -1,
      },
    });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(3);
    // Each field gets its own error message
    expect(errors.some((e) => e.includes("max_attempts"))).toBe(true);
    expect(errors.some((e) => e.includes("backoff"))).toBe(true);
    expect(errors.some((e) => e.includes("base_delay_ms"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Integration: readReservedLaneField + validateReservedLaneField compose
// ---------------------------------------------------------------------------

describe("reader + validator compose", () => {
  it("a lane that validates clean is also read without loss", () => {
    const lane = {
      name: "arch",
      retry: {
        max_attempts: 2,
        backoff: "linear" as LaneRetryBackoff,
        base_delay_ms: 500,
      },
    };
    const { valid } = validateReservedLaneField(lane);
    expect(valid).toBe(true);

    const read = readReservedLaneField(lane);
    expect(read).toEqual({ max_attempts: 2, backoff: "linear", base_delay_ms: 500 });
  });

  it("a lane with an invalid retry block may still partially read (lenient vs strict)", () => {
    // Validator is strict → reports error on bad max_attempts
    // Reader is lenient → drops bad max_attempts but keeps valid backoff
    const lane = { retry: { max_attempts: 0, backoff: "immediate" } };

    const { valid } = validateReservedLaneField(lane);
    expect(valid).toBe(false); // strict: error

    const read = readReservedLaneField(lane);
    // lenient: only valid sub-field returned
    expect(read).toEqual({ backoff: "immediate" });
  });
});
