/**
 * tests/universal-host/sc6-normalizer-contracts.test.ts
 *
 * SC-6 — normalizer validation for the TWO EXISTING result contracts only:
 *   - guild.handoff.v2   (strict validator, hooks/lib/handoff-v2.ts)
 *   - review_result.v1   (lenient reader, scripts/verify-gate-pass.ts) — NO guild. prefix
 *
 * The Phase-1 normalizer target set is CLOSED to exactly these two; the deferred
 * contracts have no producer and must NOT be normalizer targets (fail-closed).
 *
 * REAL PATH: tests dispatch through the L0 registry's CONTRACT_VALIDATORS map —
 * the same by-reference binding L3 normalizers dispatch through — never a re-
 * implemented validator. The validators themselves are the real production
 * functions (validateHandoffV2 / parseReviewResult).
 *
 * MUST-encode (#2): the prefixed form `guild.review_result.v1` is rejected.
 *
 * Status at authoring: GREEN at the registry/validator layer (L0 landed). The
 * L3 guild-run BOUNDED-REPAIR-then-fail-closed normalizer real path is RED until
 * the wrapper lands (guarded section below).
 */

import {
  EXISTING_CONTRACTS,
  DEFERRED_CONTRACTS,
  PHASE1_NORMALIZER_TARGETS,
  CONTRACT_VALIDATORS,
  findContract,
} from "../../scripts/lib/result-contracts";
import {
  normalizeResult,
  normalizeWithRepair,
} from "../../scripts/lib/result-normalizer";

// ── Valid golden envelopes (canonical minimal shapes) ───────────────────────

const VALID_HANDOFF = {
  schema_version: "guild.handoff.v2",
  task_id: "eval-engineer-L6",
  tier: "mid",
  status: "done",
  summary: "Authored SC tests against L0 contracts.",
  artifacts: ["tests/universal-host/sc7-two-sided-parity.test.ts"],
  issues: [],
};

const VALID_REVIEW_RESULT = {
  schema_version: "review_result.v1", // NO guild. prefix — the real wire string.
  packet_id: "pkt-001",
  artifact_sha256_reviewed: "a".repeat(64),
  verdict: "pass",
  blocking_findings: [],
};

describe("SC-6 registry — normalizer target set (all six contracts shipped in v2)", () => {
  it("targets EXACTLY the six wire strings (the 4 formerly-deferred now ship)", () => {
    expect([...PHASE1_NORMALIZER_TARGETS].sort()).toEqual(
      [
        "guild.handoff.v2",
        "review_result.v1",
        "guild.phase_result.v1",
        "guild.permission_receipt.v1",
        "guild.host_event.v1",
        "guild.qa_result.v1",
      ].sort()
    );
  });

  it("review_result wire string carries NO guild. prefix (correction #1)", () => {
    const entry = EXISTING_CONTRACTS.find((c) => c.purpose.includes("review"));
    expect(entry?.wire_schema_version).toBe("review_result.v1");
    expect(PHASE1_NORMALIZER_TARGETS.has("guild.review_result.v1")).toBe(false);
  });

  it("no contracts remain deferred — all four formerly-deferred now ship with validators", () => {
    expect(DEFERRED_CONTRACTS).toEqual([]);
    for (const wire of [
      "guild.phase_result.v1",
      "guild.permission_receipt.v1",
      "guild.host_event.v1",
      "guild.qa_result.v1",
    ]) {
      expect(PHASE1_NORMALIZER_TARGETS.has(wire)).toBe(true);
      expect(typeof CONTRACT_VALIDATORS[wire]).toBe("function");
    }
  });

  it("every existing target has a bound validator in CONTRACT_VALIDATORS", () => {
    for (const c of EXISTING_CONTRACTS) {
      expect(typeof CONTRACT_VALIDATORS[c.wire_schema_version]).toBe("function");
    }
  });
});

describe("SC-6 — the four formerly-deferred contracts (strict validators)", () => {
  const VALID: Record<string, Record<string, unknown>> = {
    "guild.phase_result.v1": { schema_version: "guild.phase_result.v1", run_id: "run-x", phase: "build", status: "complete", gate_passed: true, outputs: [".guild/runs/run-x/handoffs/backend-T2.md"], ts: "2026-06-27T00:00:00Z" },
    "guild.permission_receipt.v1": { schema_version: "guild.permission_receipt.v1", run_id: "run-x", requested_mode: "team", selected_mode: "team", gate_policy: "prompted_inline", scope: ["Read", "Write"], ts: "2026-06-27T00:00:00Z" },
    "guild.host_event.v1": { schema_version: "guild.host_event.v1", run_id: "run-x", host_id: "claude-local", event_type: "tool", name: "Edit", ts: "2026-06-27T00:00:00Z" },
    "guild.qa_result.v1": { schema_version: "guild.qa_result.v1", run_id: "run-x", checks: [{ id: "SC-1", status: "pass" }], gaps: [], failures: [], release_ok: true, ts: "2026-06-27T00:00:00Z" },
  };

  for (const wire of Object.keys(VALID)) {
    const validate = CONTRACT_VALIDATORS[wire]!;
    it(`${wire}: a valid object passes`, () => {
      const res = validate(VALID[wire]);
      expect(res.errors).toEqual([]);
      expect(res.valid).toBe(true);
    });
    it(`${wire}: wrong schema_version FAILS closed`, () => {
      expect(validate({ ...VALID[wire], schema_version: "guild.bogus.v9" }).valid).toBe(false);
    });
    it(`${wire}: free-form prose FAILS (not a JSON object)`, () => {
      expect(validate("done, all good" as unknown).valid).toBe(false);
    });
  }

  it("phase_result rejects an unknown phase + non-boolean gate", () => {
    const v = CONTRACT_VALIDATORS["guild.phase_result.v1"]!;
    expect(v({ ...VALID["guild.phase_result.v1"], phase: "deploy" }).valid).toBe(false);
    expect(v({ ...VALID["guild.phase_result.v1"], gate_passed: "yes" }).valid).toBe(false);
  });

  it("qa_result rejects a malformed check entry", () => {
    const v = CONTRACT_VALIDATORS["guild.qa_result.v1"]!;
    expect(v({ ...VALID["guild.qa_result.v1"], checks: [{ id: "", status: "maybe" }] }).valid).toBe(false);
  });
});

describe("SC-6 guild.handoff.v2 — strict validator (real path via registry)", () => {
  const validate = CONTRACT_VALIDATORS["guild.handoff.v2"]!;

  it("a valid envelope passes", () => {
    const res = validate(VALID_HANDOFF);
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
  });

  it("free-form prose FAILS (not a JSON object envelope)", () => {
    const res = validate("Lane done — wrote the tests, all green." as unknown);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("an unknown top-level key FAILS (strict)", () => {
    const res = validate({ ...VALID_HANDOFF, schema: "guild.handoff.v2" });
    expect(res.valid).toBe(false);
  });

  it("an oversize summary FAILS (bloat rejection)", () => {
    const res = validate({ ...VALID_HANDOFF, summary: "x".repeat(601) });
    expect(res.valid).toBe(false);
  });
});

describe("SC-6 review_result.v1 — lenient reader (real path via registry)", () => {
  const validate = CONTRACT_VALIDATORS["review_result.v1"]!;

  it("a valid (bare) review_result.v1 passes — object or string form", () => {
    expect(validate(VALID_REVIEW_RESULT).valid).toBe(true);
    expect(validate(JSON.stringify(VALID_REVIEW_RESULT)).valid).toBe(true);
  });

  it("MUST-encode: the prefixed `guild.review_result.v1` form is REJECTED", () => {
    const prefixed = { ...VALID_REVIEW_RESULT, schema_version: "guild.review_result.v1" };
    const res = validate(prefixed);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("review_result.v1"))).toBe(true);
  });

  it("free-form prose FAILS (not valid JSON)", () => {
    const res = validate("looks good to me, ship it" as unknown);
    expect(res.valid).toBe(false);
  });

  it("a JSON object missing required fields FAILS", () => {
    const res = validate({ schema_version: "review_result.v1", verdict: "pass" });
    expect(res.valid).toBe(false);
  });

  it("the prefixed form is also NOT a registry-known contract (fail-closed lookup)", () => {
    expect(findContract("guild.review_result.v1")).toBeUndefined();
    expect(CONTRACT_VALIDATORS["guild.review_result.v1"]).toBeUndefined();
  });
});

// ── L3 bounded-repair normalizer — REAL path (result-normalizer.ts landed) ──
// SC-6 "valid passes; prose fails after bounded repair" via the production
// normalizeResult / normalizeWithRepair the guild-run wrapper dispatches through.

const FENCE = (wire: string, obj: unknown): string =>
  "```" + wire + "\n" + JSON.stringify(obj, null, 2) + "\n```";
const VALID_HANDOFF_FENCE = FENCE("guild.handoff.v2", VALID_HANDOFF);
const VALID_REVIEW_FENCE = FENCE("review_result.v1", VALID_REVIEW_RESULT);

describe("SC-6 L3 normalizeResult — extract + validate + fail-closed (real path)", () => {
  it("a valid fenced handoff.v2 normalizes ok (value extracted, no repair needed)", () => {
    const r = normalizeResult(VALID_HANDOFF_FENCE, "guild.handoff.v2");
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ schema_version: "guild.handoff.v2", task_id: "eval-engineer-L6" });
    expect(r.repair_prompt).toBeUndefined();
  });

  it("a valid fenced review_result.v1 normalizes ok", () => {
    const r = normalizeResult(VALID_REVIEW_FENCE, "review_result.v1");
    expect(r.ok).toBe(true);
  });

  it("PROSE fails (not accepted) and yields a bounded-repair prompt", () => {
    const r = normalizeResult("Lane done — everything looks good, shipping it.", "guild.handoff.v2");
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
    expect(typeof r.repair_prompt).toBe("string");
    expect(r.repair_prompt).toContain("guild.handoff.v2");
  });

  it("MUST-encode (target-guard path): TARGETING the prefixed `guild.review_result.v1` fails closed with the alias hint — NO repair", () => {
    // Path A: a caller asks the normalizer to target the prefixed wire string.
    // Caught at the unknown-target guard before any payload parse → no repair.
    const r = normalizeResult(VALID_REVIEW_FENCE, "guild.review_result.v1");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('did you mean "review_result.v1"'))).toBe(true);
    expect(r.repair_prompt).toBeUndefined();
  });

  it("MUST-encode (payload-validation path): a payload whose schema_version is prefixed is REJECTED by the real validator", () => {
    // Path B (the dangerous one): the normalizer targets the BARE wire correctly,
    // but the host emitted a payload carrying schema_version "guild.review_result.v1".
    // It must be rejected through the REAL CONTRACT_VALIDATORS["review_result.v1"]
    // (parseReviewResult) path — not silently accepted.
    const prefixedPayload = { ...VALID_REVIEW_RESULT, schema_version: "guild.review_result.v1" };
    const fenced = "```review_result.v1\n" + JSON.stringify(prefixedPayload, null, 2) + "\n```";
    const r = normalizeResult(fenced, "review_result.v1");
    expect(r.ok).toBe(false);
    expect(r.value).toBeNull();
    expect(r.errors.some((e) => e.includes('expected "review_result.v1"'))).toBe(true);
    // This IS a known target, so a bounded-repair prompt is offered (unlike Path A).
    expect(typeof r.repair_prompt).toBe("string");
  });

  it("a genuinely-UNKNOWN contract is not a target and fails closed", () => {
    const r = normalizeResult(FENCE("guild.totally_unknown.v9", { x: 1 }), "guild.totally_unknown.v9");
    expect(r.ok).toBe(false);
  });

  it("a formerly-deferred contract (guild.qa_result.v1) now normalizes when valid", () => {
    const valid = { schema_version: "guild.qa_result.v1", run_id: "run-x", checks: [{ id: "SC-1", status: "pass" }], gaps: [], failures: [], release_ok: true, ts: "2026-06-27T00:00:00Z" };
    const r = normalizeResult(FENCE("guild.qa_result.v1", valid), "guild.qa_result.v1");
    expect(r.ok).toBe(true);
  });

  it("a formerly-deferred contract with an invalid payload fails on SCHEMA (not 'deferred')", () => {
    const r = normalizeResult(FENCE("guild.qa_result.v1", { x: 1 }), "guild.qa_result.v1");
    expect(r.ok).toBe(false);
    // It is now a real target → the failure is schema validation, never the old "deferred" reason.
    expect(r.errors.some((e) => e.toLowerCase().includes("deferred"))).toBe(false);
  });
});

describe("SC-6 L3 normalizeWithRepair — bounded loop then fail-closed (real path)", () => {
  it("prose then a valid re-ask repairs to a valid result (rounds_used ≥ 1)", () => {
    const reask = (_prompt: string): string => VALID_HANDOFF_FENCE; // host fixes it on re-ask
    const r = normalizeWithRepair("just shipping it, trust me", "guild.handoff.v2", reask, { maxRounds: 2 });
    expect(r.ok).toBe(true);
    expect(r.failed_closed).toBe(false);
    expect(r.rounds_used).toBeGreaterThanOrEqual(1);
  });

  it("prose on every re-ask FAILS CLOSED (never returns prose) after the bounded budget", () => {
    const reask = (_prompt: string): string => "still no JSON, here's more prose";
    const r = normalizeWithRepair("no json here", "guild.handoff.v2", reask, { maxRounds: 2 });
    expect(r.ok).toBe(false);
    expect(r.failed_closed).toBe(true);
    expect(r.value).toBeNull();
    expect(r.rounds_used).toBe(2);
  });

  it("the prefixed alias fails closed immediately (rounds_used 0 — no point repairing)", () => {
    const reask = jest.fn((_p: string): string => VALID_REVIEW_FENCE);
    const r = normalizeWithRepair(VALID_REVIEW_FENCE, "guild.review_result.v1", reask, { maxRounds: 2 });
    expect(r.ok).toBe(false);
    expect(r.failed_closed).toBe(true);
    expect(r.rounds_used).toBe(0);
    expect(reask).not.toHaveBeenCalled();
  });
});
