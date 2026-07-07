/**
 * tests/integration/handoff-v2-integration.test.ts
 *
 * Integration-layer acceptance tests for the `guild.handoff.v2` contract.
 *
 * These tests operate at the integration layer by importing the validator from
 * hooks/lib/handoff-v2.ts (the same import path Lane H uses in production code
 * and that task-completed.ts imports at runtime). They do NOT duplicate Lane
 * H's unit coverage (hooks/__tests__/handoff-v2.test.ts) — they cover the
 * cross-cutting contract perspective:
 *
 *   1. Valid "golden" envelope acceptance — the exact canonical body from
 *      ADR §5 (including the O-4 binding resolution: optional notes ≤200 chars).
 *   2. Oversize/free-form rejection at the integration boundary (SC-7 / VC-7).
 *   3. `escalate` + `escalate_reason` binding — the O-4-resolved canonical
 *      body includes `notes`; escalate envelopes must also carry `escalate_reason`.
 *   4. Compose semantics: a terminal `done` envelope is a valid input to the
 *      frozen `guild.handoff_receipt.v1` pipeline (asserted via structural check
 *      — the receipt pipeline itself is an LLM contract, not deterministic code).
 *
 * guild-plan.md §15.2 risk row 3 (decision-capture noise) + VC-7 (SC-7).
 *
 * Import path: ../../hooks/lib/handoff-v2 — same as production hooks.
 */

import {
  validateHandoffV2,
  isHandoffV2,
  SUMMARY_MAX_CHARS,
  NOTES_MAX_CHARS,
  type HandoffV2,
} from "../../hooks/lib/handoff-v2";

// ── The canonical golden envelope from ADR §5 + O-4 resolution ──────────────
// ADR §5 body — single source of truth. Including the O-4 binding: optional
// `notes` field, capped at 200 chars.

const CANONICAL_DONE: HandoffV2 = {
  schema_version: "guild.handoff.v2",
  task_id: "backend-api-001",
  tier: "cheap",
  status: "done",
  summary: "Implemented the auth endpoints.",
  artifacts: ["src/auth.ts:1-80"],
  issues: [],
  // O-4: optional notes within 200 chars
  notes: "Auth middleware wired to /admin routes.",
  learnings: ["File scan is cheap-tier work."],
};

const CANONICAL_ESCALATE: HandoffV2 = {
  schema_version: "guild.handoff.v2",
  task_id: "graph-schema-001",
  tier: "mid",
  status: "escalate",
  summary:
    "Cross-file relationship extraction complete; schema topology ambiguous.",
  artifacts: ["src/graph/edges.ts:1-40"],
  issues: ["Topology unclear at layer boundary"],
  escalate_reason:
    "Cannot determine whether the auth→session edge should be directed or bidirectional — requires graph schema review.",
  notes: "Mid-tier agent hit schema topology above its tier.",
};

// ── 1. Valid golden envelope acceptance ─────────────────────────────────────

describe("handoff-v2 integration — valid canonical envelopes (ADR §5)", () => {
  test("canonical done envelope (O-4 notes included) passes validation", () => {
    const result = validateHandoffV2(CANONICAL_DONE);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("canonical escalate envelope passes validation with escalate_reason", () => {
    const result = validateHandoffV2(CANONICAL_ESCALATE);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("isHandoffV2 type guard accepts canonical done envelope", () => {
    expect(isHandoffV2(CANONICAL_DONE)).toBe(true);
  });

  test("isHandoffV2 type guard accepts canonical escalate envelope", () => {
    expect(isHandoffV2(CANONICAL_ESCALATE)).toBe(true);
  });

  test("cheap tier in canonical envelope is accepted", () => {
    expect(validateHandoffV2({ ...CANONICAL_DONE, tier: "cheap" }).valid).toBe(
      true
    );
  });

  test("mid tier in canonical envelope is accepted", () => {
    expect(validateHandoffV2({ ...CANONICAL_DONE, tier: "mid" }).valid).toBe(
      true
    );
  });

  test("powerful tier in canonical envelope is accepted", () => {
    expect(
      validateHandoffV2({ ...CANONICAL_DONE, tier: "powerful" }).valid
    ).toBe(true);
  });

  test("blocked status in canonical envelope is accepted", () => {
    const result = validateHandoffV2({ ...CANONICAL_DONE, status: "blocked" });
    expect(result.valid).toBe(true);
  });

  test("notes exactly at NOTES_MAX_CHARS (O-4 boundary) is accepted", () => {
    expect(NOTES_MAX_CHARS).toBe(200); // assert the constant is the O-4 value
    const result = validateHandoffV2({
      ...CANONICAL_DONE,
      notes: "N".repeat(NOTES_MAX_CHARS),
    });
    expect(result.valid).toBe(true);
  });

  test("empty artifacts array is accepted (required-but-may-be-empty)", () => {
    const result = validateHandoffV2({ ...CANONICAL_DONE, artifacts: [] });
    expect(result.valid).toBe(true);
  });

  test("empty issues array is accepted (required-but-may-be-empty)", () => {
    const result = validateHandoffV2({ ...CANONICAL_DONE, issues: [] });
    expect(result.valid).toBe(true);
  });
});

// ── 2. Oversize / free-form rejection (SC-7 / VC-7) ─────────────────────────

describe("handoff-v2 integration — bloat rejection at integration boundary (SC-7)", () => {
  test("summary one char over SUMMARY_MAX_CHARS is rejected", () => {
    const oversize = "S".repeat(SUMMARY_MAX_CHARS + 1);
    const result = validateHandoffV2({ ...CANONICAL_DONE, summary: oversize });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("summary"))).toBe(true);
  });

  test("notes one char over NOTES_MAX_CHARS (200) is rejected (O-4 cap)", () => {
    const overNotes = "N".repeat(NOTES_MAX_CHARS + 1);
    const result = validateHandoffV2({ ...CANONICAL_DONE, notes: overNotes });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("notes"))).toBe(true);
  });

  test("a free-form prose blob in place of a valid envelope is rejected", () => {
    const freeForm =
      "The task is done. I checked the auth endpoints and they look good. " +
      "Also reviewed the session management and the token refresh flow. " +
      "Everything seems to be working correctly based on my analysis.";
    // A raw string is not a valid envelope object
    const result = validateHandoffV2(freeForm);
    expect(result.valid).toBe(false);
  });

  test("envelope with wrong schema_version is rejected at integration boundary", () => {
    const wrongVersion = {
      ...CANONICAL_DONE,
      schema_version: "guild.handoff.v1" as never,
    };
    const result = validateHandoffV2(wrongVersion);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  test("envelope with no required fields (empty object) is rejected", () => {
    const result = validateHandoffV2({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ── 3. escalate_reason coupling (ADR §5, O-4) ────────────────────────────────

describe("handoff-v2 integration — escalate_reason coupling", () => {
  test("status=escalate without escalate_reason is rejected (bloat gate)", () => {
    const { escalate_reason: _r, ...noReason } = CANONICAL_ESCALATE;
    const result = validateHandoffV2({ ...noReason, status: "escalate" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("escalate_reason"))).toBe(true);
  });

  test("status=escalate with blank escalate_reason is rejected", () => {
    const result = validateHandoffV2({
      ...CANONICAL_ESCALATE,
      escalate_reason: "   ",
    });
    expect(result.valid).toBe(false);
  });

  test("status=done with escalate_reason absent is valid (escalate_reason is optional for done)", () => {
    const result = validateHandoffV2(CANONICAL_DONE);
    expect(result.valid).toBe(true);
  });
});

// ── 4. Structural compose check: done envelope fields needed for receipt ──────
// The frozen guild.handoff_receipt.v1 pipeline takes the handoff envelope and
// produces a durable receipt. We can't test the LLM pipeline deterministically,
// but we CAN assert that a canonical done envelope exposes all the structural
// fields the pipeline contract requires: task_id, tier, status, artifacts,
// summary (the receipt's work_summary is derived from it).

describe("handoff-v2 integration — compose-readiness for handoff_receipt.v1 pipeline", () => {
  test("canonical done envelope exposes task_id (receipt pipeline input)", () => {
    expect(isHandoffV2(CANONICAL_DONE)).toBe(true);
    expect(typeof CANONICAL_DONE.task_id).toBe("string");
    expect(CANONICAL_DONE.task_id.length).toBeGreaterThan(0);
  });

  test("canonical done envelope exposes tier (receipt pipeline input)", () => {
    expect(["cheap", "mid", "powerful"]).toContain(CANONICAL_DONE.tier);
  });

  test("canonical done envelope exposes status=done (terminal for receipt)", () => {
    expect(CANONICAL_DONE.status).toBe("done");
  });

  test("canonical done envelope exposes artifacts array (receipt pointers)", () => {
    expect(Array.isArray(CANONICAL_DONE.artifacts)).toBe(true);
  });

  test("canonical done envelope exposes non-empty summary (receipt work_summary source)", () => {
    expect(CANONICAL_DONE.summary.trim().length).toBeGreaterThan(0);
  });

  test("schema_version is the self-versioned guild.handoff.v2 discriminator", () => {
    expect(CANONICAL_DONE.schema_version).toBe("guild.handoff.v2");
  });
});
