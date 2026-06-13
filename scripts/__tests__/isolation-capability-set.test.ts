/**
 * scripts/__tests__/isolation-capability-set.test.ts
 *
 * Focused tests for scripts/lib/isolation-capability-set.ts — W2-A1 isolation
 * capability reader (deferred v2.x feature item 35).
 *
 * Coverage:
 *   1. ISOLATION_MODES closed enum — exact set in order, no silent additions.
 *   2. readIsolationCapability — happy path (recognized modes returned verbatim).
 *   3. readIsolationCapability — contract guarantees:
 *      a. Absent capability_set (undefined/null) ⇒ "none".
 *      b. Absent isolation field inside a present capability_set ⇒ "none".
 *      c. Non-string isolation value ⇒ "none" (lenient-reader).
 *      d. Unrecognized string value ⇒ "none" (forward-compatible fallback).
 *      e. Empty string ⇒ "none".
 *      f. Extra keys in capability_set are silently ignored.
 *      g. Return is always a member of ISOLATION_MODES (closed-enum invariant).
 *   4. validateIsolationCapability — accepts valid inputs; rejects malformed.
 *   5. isKnownIsolationMode — convenience type-predicate.
 *   6. Malformed / edge cases:
 *      a. null capability_set ⇒ "none" (same as undefined).
 *      b. isolation: null ⇒ "none".
 *      c. isolation: 42 (number) ⇒ "none" and validator reports error.
 *      d. isolation: "future_mode_v3" (unknown forward value) ⇒ "none".
 *
 * All tests are PURE (no disk I/O). `readIsolationCapability` accepts only
 * plain objects — no tmp-dir fixture needed (no fs touch in lib functions).
 */

import {
  ISOLATION_MODES,
  readIsolationCapability,
  validateIsolationCapability,
  isKnownIsolationMode,
  type IsolationMode,
  type CapabilitySetWithIsolation,
} from "../lib/isolation-capability-set";

// ── 1. Closed enum ────────────────────────────────────────────────────────────

describe("ISOLATION_MODES — closed enum", () => {
  test("contains exactly the 4 expected values in order", () => {
    expect([...ISOLATION_MODES]).toEqual([
      "worktree",
      "sandbox",
      "cloud_container",
      "none",
    ]);
  });

  test("has exactly 4 entries (no silent additions)", () => {
    expect(ISOLATION_MODES).toHaveLength(4);
  });
});

// ── 2. readIsolationCapability — happy path ───────────────────────────────────

describe("readIsolationCapability — happy path (recognized modes)", () => {
  test.each([
    ["worktree" as IsolationMode],
    ["sandbox" as IsolationMode],
    ["cloud_container" as IsolationMode],
    ["none" as IsolationMode],
  ])("isolation=%s is returned verbatim", (mode) => {
    const result = readIsolationCapability({ isolation: mode });
    expect(result).toBe(mode);
  });
});

// ── 3. readIsolationCapability — contract guarantees ─────────────────────────

describe("readIsolationCapability — contract guarantees", () => {
  // 3a. Absent capability_set ⇒ "none"
  test("absent capability_set (undefined) returns none", () => {
    expect(readIsolationCapability(undefined)).toBe("none");
  });

  // 3a. null treated same as undefined
  test("null capability_set returns none", () => {
    expect(readIsolationCapability(null as unknown as undefined)).toBe("none");
  });

  // 3b. Present capability_set but no isolation field
  test("capability_set with no isolation field returns none", () => {
    const cs: CapabilitySetWithIsolation = { needs_pr: true } as CapabilitySetWithIsolation;
    expect(readIsolationCapability(cs)).toBe("none");
  });

  // 3c. Non-string isolation value ⇒ "none" (lenient)
  test("isolation: 42 (number) returns none", () => {
    const cs = { isolation: 42 } as unknown as CapabilitySetWithIsolation;
    expect(readIsolationCapability(cs)).toBe("none");
  });

  test("isolation: true (boolean) returns none", () => {
    const cs = { isolation: true } as unknown as CapabilitySetWithIsolation;
    expect(readIsolationCapability(cs)).toBe("none");
  });

  test("isolation: null returns none", () => {
    const cs = { isolation: null } as unknown as CapabilitySetWithIsolation;
    expect(readIsolationCapability(cs)).toBe("none");
  });

  // 3d. Unrecognized string ⇒ "none" (forward-compatible)
  test("isolation: unknown forward mode returns none", () => {
    const cs = { isolation: "future_mode_v3" } as CapabilitySetWithIsolation;
    expect(readIsolationCapability(cs)).toBe("none");
  });

  // 3e. Empty string ⇒ "none"
  test("isolation: empty string returns none", () => {
    const cs = { isolation: "" } as CapabilitySetWithIsolation;
    expect(readIsolationCapability(cs)).toBe("none");
  });

  // 3f. Extra keys are silently ignored
  test("extra keys in capability_set are ignored", () => {
    const cs = {
      isolation: "worktree",
      needs_pr: true,
      needs_network: false,
      some_future_key: "x",
    } as CapabilitySetWithIsolation;
    expect(readIsolationCapability(cs)).toBe("worktree");
  });

  // 3g. Return is always a member of ISOLATION_MODES (closed-enum invariant)
  test("return value is always a member of ISOLATION_MODES", () => {
    const inputs: Array<CapabilitySetWithIsolation | undefined> = [
      undefined,
      {},
      { isolation: "worktree" },
      { isolation: "sandbox" },
      { isolation: "cloud_container" },
      { isolation: "none" },
      { isolation: "unknown_value" },
      { isolation: "" },
      { isolation: 0 } as unknown as CapabilitySetWithIsolation,
    ];
    const modeSet = new Set<string>(ISOLATION_MODES);
    for (const input of inputs) {
      const result = readIsolationCapability(input);
      expect(modeSet.has(result)).toBe(true);
    }
  });
});

// ── 4. validateIsolationCapability ───────────────────────────────────────────

describe("validateIsolationCapability — validator", () => {
  test("absent capability_set is valid", () => {
    expect(validateIsolationCapability(undefined)).toEqual({ valid: true });
  });

  test("null capability_set is valid", () => {
    expect(
      validateIsolationCapability(null as unknown as undefined),
    ).toEqual({ valid: true });
  });

  test("capability_set with no isolation field is valid", () => {
    expect(validateIsolationCapability({})).toEqual({ valid: true });
  });

  test.each([
    ["worktree"],
    ["sandbox"],
    ["cloud_container"],
    ["none"],
  ])("isolation=%s passes validation", (mode) => {
    const result = validateIsolationCapability({ isolation: mode });
    expect(result).toEqual({ valid: true });
  });

  test("isolation: unknown string fails validation with descriptive error", () => {
    const result = validateIsolationCapability({ isolation: "bad_mode" });
    expect(result.valid).toBe(false);
    const errs = (result as { valid: false; errors: string[] }).errors;
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("bad_mode");
    expect(errs[0]).toContain("not a recognized IsolationMode");
  });

  test("isolation: number fails validation", () => {
    const result = validateIsolationCapability(
      { isolation: 99 } as unknown as CapabilitySetWithIsolation,
    );
    expect(result.valid).toBe(false);
    const errs = (result as { valid: false; errors: string[] }).errors;
    expect(errs[0]).toContain("must be a string");
  });

  test("error message includes the expected modes", () => {
    const result = validateIsolationCapability({ isolation: "future_mode_v3" });
    expect(result.valid).toBe(false);
    const errs = (result as { valid: false; errors: string[] }).errors;
    // Each recognized mode should appear in the error so operators can self-correct
    expect(errs[0]).toContain("worktree");
    expect(errs[0]).toContain("sandbox");
    expect(errs[0]).toContain("cloud_container");
    expect(errs[0]).toContain("none");
  });
});

// ── 5. isKnownIsolationMode ───────────────────────────────────────────────────

describe("isKnownIsolationMode — type predicate", () => {
  test.each(["worktree", "sandbox", "cloud_container", "none"])(
    "%s returns true",
    (mode) => {
      expect(isKnownIsolationMode(mode)).toBe(true);
    },
  );

  test.each(["unknown", "", "WORKTREE", null, undefined, 0, true])(
    "%j returns false",
    (value) => {
      expect(isKnownIsolationMode(value)).toBe(false);
    },
  );
});

// ── 6. Malformed / edge cases ─────────────────────────────────────────────────

describe("edge cases — readIsolationCapability", () => {
  test("capability_set is an empty object returns none", () => {
    expect(readIsolationCapability({})).toBe("none");
  });

  test("W2-A1 contract: router absence ⇒ unconstrained matches reader default none", () => {
    // The router treats absent-isolation as unconstrained (W2-A1).
    // The reader maps absent-isolation → "none", which is the unconstrained
    // mode. Both agree: absent ≡ no constraint. Verify the reader returns
    // "none" for the absent case so the router's lenient path is safe to call
    // with the reader's output.
    const readerResult = readIsolationCapability(undefined);
    expect(readerResult).toBe("none");
  });

  test("capability_set present but isolation is object (malformed) returns none", () => {
    const cs = { isolation: { nested: true } } as unknown as CapabilitySetWithIsolation;
    expect(readIsolationCapability(cs)).toBe("none");
  });

  test("isolation: 'worktree' is the writer default (task_run v1 contract)", () => {
    // The task_run.v1 writer defaults `isolation: worktree` (contract §4).
    // When a host advertises worktree isolation, the reader must return the
    // canonical string so the router's capabilityGap check can compare them.
    const cs: CapabilitySetWithIsolation = { isolation: "worktree" };
    expect(readIsolationCapability(cs)).toBe("worktree");
  });
});
