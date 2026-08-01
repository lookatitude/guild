/**
 * scripts/__tests__/compatibility-usage.test.ts
 *
 * S8 — `guild.compatibility_usage.v1`, the MEASURED input to D03's G5 removal gate.
 * Closes audit gap F4 (G5 depended on telemetry nothing defined).
 *
 * The rows that matter most are the ones that keep the gate HONEST rather than merely
 * green:
 *   - benign reads (mint_source / shadow_comparison) are EXCLUDED from the dependence
 *     count — without that, minting reads a template by design and the total never
 *     reaches zero, so G5 could never pass;
 *   - `unreadable > 0` BLOCKS rather than reading as clean;
 *   - a required asset that was never instrumented blocks, because its zero is fake.
 * A green G5 that has never flagged a known positive is not evidence, so the
 * anti-vacuity row proves the gate can actually fail.
 */

import {
  BENIGN_COMPATIBILITY_READ_REASONS,
  COMPATIBILITY_ASSET_KINDS,
  COMPATIBILITY_READ_REASONS,
  COMPATIBILITY_USAGE_DISPOSITION,
  COMPATIBILITY_USAGE_EVENT_NAME,
  COMPATIBILITY_USAGE_OUTCOME_TYPE,
  COMPATIBILITY_USAGE_SCHEMA,
  DEPENDENCE_COMPATIBILITY_READ_REASONS,
  evaluateG5,
  isCompatibilityUsageV1,
  isDependenceRead,
  rollupCompatibilityUsage,
  type CompatibilityReadReason,
  type CompatibilityUsageV1,
} from "../lib/capability/compatibility-usage";
import {
  RECEIPT_DISPOSITIONS,
  RECEIPT_EVENT_NAMES,
  RECEIPT_OUTCOME_TYPES,
} from "../../src/modules/telemetry/workflows/receipt-journal";

function usage(over: Partial<CompatibilityUsageV1> = {}): CompatibilityUsageV1 {
  return {
    schema_version: COMPATIBILITY_USAGE_SCHEMA,
    asset_kind: "shipped_domain_skill",
    asset_id: "backend-api-contract",
    asset_path: "skills/specialists/backend-api-contract/SKILL.md",
    content_hash: "a".repeat(64),
    reason: "no_project_definition",
    resolver_mode: "legacy",
    synthetic: false,
    specialist_id: "backend",
    ...over,
  };
}

describe("S8 — rides the EXISTING receipt vocabularies (no closed set widened)", () => {
  it("every vocabulary member it binds to already exists in the frozen sets", () => {
    // This is the spec's single hard rule: emit through the MH-06 journal, never
    // invent another one. If any of these three fail, a contract change was smuggled in.
    expect(RECEIPT_EVENT_NAMES).toContain(COMPATIBILITY_USAGE_EVENT_NAME);
    expect(RECEIPT_OUTCOME_TYPES).toContain(COMPATIBILITY_USAGE_OUTCOME_TYPE);
    expect(RECEIPT_DISPOSITIONS).toContain(COMPATIBILITY_USAGE_DISPOSITION);
  });

  it("binds to task.dispatch / capability_outcome / degraded", () => {
    expect(COMPATIBILITY_USAGE_EVENT_NAME).toBe("task.dispatch");
    expect(COMPATIBILITY_USAGE_OUTCOME_TYPE).toBe("guild.capability_outcome.v1");
    // `degraded` is the honest label: the work succeeded, but via the retiring path.
    expect(COMPATIBILITY_USAGE_DISPOSITION).toBe("degraded");
  });

  it("ANTI-VACUITY: the frozen vocabularies still have their documented sizes", () => {
    // A widened set would make the assertions above pass trivially.
    expect(RECEIPT_EVENT_NAMES).toHaveLength(19);
    expect(RECEIPT_OUTCOME_TYPES).toHaveLength(10);
    expect(RECEIPT_DISPOSITIONS).toHaveLength(5);
  });
});

describe("S8 — payload validation", () => {
  it("accepts a well-formed payload", () => {
    expect(isCompatibilityUsageV1(usage())).toBe(true);
  });

  it("rejects a wrong schema_version, kind, reason or resolver mode", () => {
    expect(isCompatibilityUsageV1(usage({ schema_version: "guild.other.v1" } as never))).toBe(false);
    expect(isCompatibilityUsageV1(usage({ asset_kind: "shipped_hook" } as never))).toBe(false);
    expect(isCompatibilityUsageV1(usage({ reason: "because" } as never))).toBe(false);
    expect(isCompatibilityUsageV1(usage({ resolver_mode: "aggressive" } as never))).toBe(false);
  });

  it("requires content_hash (S8 invariant 4 — a rollup must distinguish versions)", () => {
    expect(isCompatibilityUsageV1(usage({ content_hash: "" }))).toBe(false);
    expect(isCompatibilityUsageV1(usage({ content_hash: undefined } as never))).toBe(false);
  });

  it("requires an explicit boolean `synthetic` — never inferred, never optional", () => {
    expect(isCompatibilityUsageV1(usage({ synthetic: undefined } as never))).toBe(false);
    expect(isCompatibilityUsageV1(usage({ synthetic: "false" } as never))).toBe(false);
  });

  it("allows a null specialist_id (not every read has a lane) but not a missing one", () => {
    expect(isCompatibilityUsageV1(usage({ specialist_id: null }))).toBe(true);
    expect(isCompatibilityUsageV1(usage({ specialist_id: undefined } as never))).toBe(false);
  });

  it("never throws on hostile input", () => {
    for (const bad of [null, undefined, 42, "x", [], { schema_version: 1 }]) {
      expect(() => isCompatibilityUsageV1(bad)).not.toThrow();
      expect(isCompatibilityUsageV1(bad)).toBe(false);
    }
  });
});

describe("S8 — the dependence predicate (the spec's main content)", () => {
  it("counts the three dependence reasons", () => {
    for (const reason of ["no_project_definition", "explicit_legacy_mode", "rollback"] as const) {
      expect(isDependenceRead(usage({ reason }))).toBe(true);
    }
  });

  it("EXCLUDES mint_source — minting a project role FROM a template is the migration WORKING", () => {
    expect(isDependenceRead(usage({ reason: "mint_source" }))).toBe(false);
  });

  it("EXCLUDES shadow_comparison — the A-side of a shadow compare is supposed to be legacy", () => {
    expect(isDependenceRead(usage({ reason: "shadow_comparison" }))).toBe(false);
  });

  it("EXCLUDES every synthetic read regardless of reason", () => {
    for (const reason of COMPATIBILITY_READ_REASONS) {
      expect(isDependenceRead(usage({ reason, synthetic: true }))).toBe(false);
    }
  });

  it("the two subsets partition the vocabulary exactly", () => {
    expect([...DEPENDENCE_COMPATIBILITY_READ_REASONS].sort()).toEqual(
      ["explicit_legacy_mode", "no_project_definition", "rollback"].sort(),
    );
    const union = new Set([
      ...DEPENDENCE_COMPATIBILITY_READ_REASONS,
      ...BENIGN_COMPATIBILITY_READ_REASONS,
    ]);
    expect(union.size).toBe(COMPATIBILITY_READ_REASONS.length);
  });

  it("FAIL-CLOSED: a reason not listed as benign counts as dependence", () => {
    // Derivation-by-exclusion means a future reason someone forgets to classify
    // BLOCKS the gate rather than silently suppressing it.
    const unknown = "some_future_reason" as CompatibilityReadReason;
    expect(BENIGN_COMPATIBILITY_READ_REASONS).not.toContain(unknown);
    expect(isDependenceRead(usage({ reason: unknown }))).toBe(true);
  });
});

describe("S8 — the rollup", () => {
  const ASSETS = ["backend-api-contract", "qa-test-strategy", "architect-adr-writer"];

  it("counts only dependence reads, per asset", () => {
    const rollup = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: ASSETS,
      unreadable: 0,
      records: [
        usage({ asset_id: "backend-api-contract", reason: "no_project_definition" }),
        usage({ asset_id: "backend-api-contract", reason: "explicit_legacy_mode" }),
        usage({ asset_id: "qa-test-strategy", reason: "mint_source" }), // benign
        usage({ asset_id: "qa-test-strategy", reason: "shadow_comparison" }), // benign
        usage({ asset_id: "architect-adr-writer", reason: "rollback", synthetic: true }), // test read
      ],
    });

    expect(rollup.by_asset["backend-api-contract"]).toBe(2);
    expect(rollup.by_asset["qa-test-strategy"]).toBe(0);
    expect(rollup.by_asset["architect-adr-writer"]).toBe(0);
    expect(rollup.total_dependence_reads).toBe(2);
    // Only the asset with real dependence is withheld from removal.
    expect(rollup.removable).toEqual(["architect-adr-writer", "qa-test-strategy"]);
  });

  it("ANTI-VACUITY: a known legacy read must NOT report its asset removable", () => {
    // The row that proves the rollup can fail. A gate that never flags a known
    // positive is not evidence.
    const rollup = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: ASSETS,
      unreadable: 0,
      records: [usage({ asset_id: "backend-api-contract", reason: "no_project_definition" })],
    });
    expect(rollup.removable).not.toContain("backend-api-contract");
    expect(rollup.by_asset["backend-api-contract"]).toBe(1);
  });

  it("seeds every KNOWN asset at zero, so an unread asset is visible rather than absent", () => {
    const rollup = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: ASSETS,
      unreadable: 0,
      records: [],
    });
    expect(Object.keys(rollup.by_asset).sort()).toEqual([...ASSETS].sort());
    expect(rollup.removable).toEqual([...ASSETS].sort());
  });

  it("carries `unreadable` through verbatim — never defaulted to zero", () => {
    const rollup = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: ASSETS,
      unreadable: 3,
      records: [],
    });
    expect(rollup.unreadable).toBe(3);
  });
});

describe("S8 — the G5 gate is fail-closed on every axis", () => {
  const REQUIRED = ["a", "b"];
  const clean = (over: Partial<ReturnType<typeof rollupCompatibilityUsage>> = {}) => ({
    ...rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: REQUIRED,
      unreadable: 0,
      records: [],
    }),
    ...over,
  });

  it("PASSES on two clean, fully-instrumented releases", () => {
    const verdict = evaluateG5({ rollups: [clean(), clean()], required_asset_ids: REQUIRED });
    expect(verdict.passed).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.removable).toEqual(["a", "b"]);
  });

  it("BLOCKS on a window shorter than two releases — a schedule is not a measurement", () => {
    const verdict = evaluateG5({ rollups: [clean()], required_asset_ids: REQUIRED });
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(" ")).toMatch(/insufficient window/);
    expect(verdict.removable).toEqual([]);
  });

  it("BLOCKS on any dependence read in the window", () => {
    const dirty = clean({ total_dependence_reads: 1, by_asset: { a: 1, b: 0 } });
    const verdict = evaluateG5({ rollups: [clean(), dirty], required_asset_ids: REQUIRED });
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(" ")).toMatch(/1 dependence read/);
  });

  it("BLOCKS on a TORN JOURNAL — an absent observation is never cleanliness", () => {
    // Zero dependence reads AND unreadable records is not evidence of zero usage;
    // it is evidence we cannot tell. This is the anti-vacuity guard that makes the
    // gate trustworthy.
    const torn = clean({ unreadable: 2 });
    const verdict = evaluateG5({ rollups: [clean(), torn], required_asset_ids: REQUIRED });
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(" ")).toMatch(/unreadable record/);
    expect(verdict.removable).toEqual([]);
  });

  it("BLOCKS when a required asset was never instrumented — its zero is FALSE", () => {
    // S8 invariant 5: a partially instrumented set produces a false zero.
    const partial = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: ["a"], // "b" never instrumented
      unreadable: 0,
      records: [],
    });
    const verdict = evaluateG5({
      rollups: [partial, partial],
      required_asset_ids: ["a", "b"],
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(" ")).toMatch(/never instrumented/);
    expect(verdict.blockers.join(" ")).toMatch(/\bb\b/);
  });

  it("reports ALL blockers at once, not just the first", () => {
    const bad = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.5.0",
      known_asset_ids: ["a"],
      unreadable: 4,
      records: [usage({ asset_id: "a", reason: "rollback" })],
    });
    const verdict = evaluateG5({ rollups: [bad], required_asset_ids: ["a", "b"] });
    expect(verdict.passed).toBe(false);
    // window + dependence + unreadable + uninstrumented
    expect(verdict.blockers).toHaveLength(4);
  });

  it("never reports removable assets on a blocked gate", () => {
    const verdict = evaluateG5({
      rollups: [clean({ unreadable: 1 }), clean()],
      required_asset_ids: REQUIRED,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.removable).toEqual([]);
  });
});

describe("S8 — vocabulary shape", () => {
  it("asset kinds cover both instrumented surfaces", () => {
    expect([...COMPATIBILITY_ASSET_KINDS]).toEqual(["shipped_template", "shipped_domain_skill"]);
  });

  it("the reason vocabulary is the five the spec names", () => {
    expect([...COMPATIBILITY_READ_REASONS].sort()).toEqual(
      [
        "explicit_legacy_mode",
        "mint_source",
        "no_project_definition",
        "rollback",
        "shadow_comparison",
      ].sort(),
    );
  });
});
