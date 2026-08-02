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
  parseCompatibilityUsageV1,
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

  it("rejects an unknown key (closed key set — never silently ignored)", () => {
    expect(isCompatibilityUsageV1({ ...usage(), sneaky: true })).toBe(false);
  });
});

describe("S8 — fail-closed hardening (the specialist-identity.ts idiom)", () => {
  // A record that validates but reads back DIFFERENTLY would corrupt the G5 count —
  // the single number the removal gate rests on. These are the exotic-input paths
  // that a naive `typeof v.field === "string"` guard would wave through.

  it("returns a typed value or null, never throws", () => {
    expect(parseCompatibilityUsageV1(usage())).not.toBeNull();
    expect(parseCompatibilityUsageV1({})).toBeNull();
  });

  it("NEVER invokes a getter — an accessor property reads as absent, not as its value", () => {
    let invoked = 0;
    const hostile = {
      ...usage(),
    } as Record<string, unknown>;
    Object.defineProperty(hostile, "asset_id", {
      enumerable: true,
      configurable: true,
      get() {
        invoked += 1;
        return "backend-api-contract";
      },
    });
    expect(parseCompatibilityUsageV1(hostile)).toBeNull();
    expect(invoked).toBe(0);
  });

  it("REJECTS a getter that would flip `synthetic` after validation (TOCTOU)", () => {
    // The attack this closes: read #1 says synthetic:true (benign, excluded), read #2
    // says false — or vice versa, silently moving a record in or out of the G5 count.
    let reads = 0;
    const hostile = { ...usage() } as Record<string, unknown>;
    Object.defineProperty(hostile, "synthetic", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1;
      },
    });
    expect(parseCompatibilityUsageV1(hostile)).toBeNull();
  });

  it("REJECTS a Proxy outright — it can lie on every trap", () => {
    const proxied = new Proxy(usage() as unknown as Record<string, unknown>, {});
    expect(parseCompatibilityUsageV1(proxied)).toBeNull();
  });

  it("REJECTS an exotic prototype — an inherited field must not slip past an own-key scan", () => {
    const inherited = Object.create({ synthetic: false }) as Record<string, unknown>;
    for (const [k, v] of Object.entries(usage())) {
      if (k !== "synthetic") inherited[k] = v;
    }
    expect(parseCompatibilityUsageV1(inherited)).toBeNull();
  });

  it("accepts a null-prototype object (plain JSON data, no chain to walk)", () => {
    const bare = Object.assign(Object.create(null), usage()) as Record<string, unknown>;
    expect(parseCompatibilityUsageV1(bare)).not.toBeNull();
  });

  it("REJECTS symbol-keyed data rather than silently dropping it", () => {
    const withSymbol = { ...usage(), [Symbol("x")]: 1 };
    expect(parseCompatibilityUsageV1(withSymbol)).toBeNull();
  });

  it("returns a FROZEN fresh copy — later mutation of the input cannot change it", () => {
    const source = { ...usage() } as Record<string, unknown>;
    const parsed = parseCompatibilityUsageV1(source)!;
    expect(parsed).not.toBeNull();
    source.reason = "mint_source";
    source.synthetic = true;
    // The parsed record still carries what was VALIDATED, so the G5 verdict computed
    // from it cannot be retroactively altered through the input object.
    expect(parsed.reason).toBe("no_project_definition");
    expect(parsed.synthetic).toBe(false);
    expect(Object.isFrozen(parsed)).toBe(true);
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
  // A clean release: both required assets OBSERVED (instrumentation fired) with zero
  // dependence. `seq` varies the window id so two clean releases are two RELEASES.
  const clean = (
    seq = 0,
    over: Partial<ReturnType<typeof rollupCompatibilityUsage>> = {},
  ) => ({
    ...rollupCompatibilityUsage({
      window_start_release: `2.${5 + seq}.0`,
      window_end_release: `2.${6 + seq}.0`,
      known_asset_ids: REQUIRED,
      unreadable: 0,
      records: REQUIRED.map((id) => usage({ asset_id: id, reason: "mint_source" })),
    }),
    ...over,
  });

  it("PASSES on two clean, fully-instrumented releases", () => {
    const verdict = evaluateG5({ rollups: [clean(0), clean(1)], required_asset_ids: REQUIRED });
    expect(verdict.blockers).toEqual([]);
    expect(verdict.passed).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.removable).toEqual(["a", "b"]);
  });

  it("BLOCKS on a window shorter than two releases — a schedule is not a measurement", () => {
    const verdict = evaluateG5({ rollups: [clean(0)], required_asset_ids: REQUIRED });
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(" ")).toMatch(/insufficient window/);
    expect(verdict.removable).toEqual([]);
  });

  it("BLOCKS on any dependence read in the window", () => {
    const dirty = clean(1, { total_dependence_reads: 1, by_asset: { a: 1, b: 0 } });
    const verdict = evaluateG5({ rollups: [clean(0), dirty], required_asset_ids: REQUIRED });
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(" ")).toMatch(/1 dependence read/);
  });

  it("BLOCKS on a TORN JOURNAL — an absent observation is never cleanliness", () => {
    // Zero dependence reads AND unreadable records is not evidence of zero usage;
    // it is evidence we cannot tell. This is the anti-vacuity guard that makes the
    // gate trustworthy.
    const torn = clean(1, { unreadable: 2 });
    const verdict = evaluateG5({ rollups: [clean(0), torn], required_asset_ids: REQUIRED });
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(" ")).toMatch(/unreadable record/);
    expect(verdict.removable).toEqual([]);
  });

  it("BLOCKS when a required asset was never instrumented — its zero is FALSE", () => {
    // S8 invariant 5: a partially instrumented set produces a false zero.
    const partial = (seq: number) =>
      rollupCompatibilityUsage({
        window_start_release: `2.${5 + seq}.0`,
        window_end_release: `2.${6 + seq}.0`,
        known_asset_ids: ["a"], // "b" never instrumented
        unreadable: 0,
        records: [usage({ asset_id: "a", reason: "mint_source" })],
      });
    const verdict = evaluateG5({
      rollups: [partial(0), partial(1)],
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
    // window + unreadable + dependence + uninstrumented — all at once, not just the first.
    expect(verdict.blockers.length).toBeGreaterThanOrEqual(4);
  });

  it("never reports removable assets on a blocked gate", () => {
    const verdict = evaluateG5({
      rollups: [clean(0, { unreadable: 1 }), clean(1)],
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

// ===========================================================================
// CODEX ADVERSARIAL ROUND — 8 defects an independent reviewer found, all of
// which were paths to a FALSE CLEAN on a gate whose output is "delete 73 files".
// ===========================================================================

describe("S8 codex-round — the vacuous coverage check (P0, the worst one)", () => {
  // rollupCompatibilityUsage SEEDS by_asset with every known id at 0 so an unread asset
  // stays visible. evaluateG5 then used those keys as proof of instrumentation — so an
  // asset that was NEVER INSTRUMENTED looked identical to one instrumented and never
  // depended on. Two EMPTY rollups passed and marked all 73 assets removable.
  const REQUIRED = ["a", "b"];
  const empty = (seq: number) =>
    rollupCompatibilityUsage({
      window_start_release: `2.${5 + seq}.0`,
      window_end_release: `2.${6 + seq}.0`,
      known_asset_ids: REQUIRED,
      unreadable: 0,
      records: [], // nothing ever emitted
    });

  it("two EMPTY releases do NOT pass — zero observations is not zero usage", () => {
    const verdict = evaluateG5({ rollups: [empty(0), empty(1)], required_asset_ids: REQUIRED });
    expect(verdict.passed).toBe(false);
    expect(verdict.blockers.join(" ")).toMatch(/never instrumented/);
    expect(verdict.removable).toEqual([]);
  });

  it("coverage comes from observations, NOT from seeded by_asset keys", () => {
    const r = empty(0);
    // by_asset is seeded (so an unread asset is visible)...
    expect(Object.keys(r.by_asset).sort()).toEqual(["a", "b"]);
    // ...but nothing was observed, and THAT is what the gate reads.
    expect(r.observed_asset_ids).toEqual([]);
  });

  it("a synthetic or benign read still proves the emission point FIRED", () => {
    const r = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: REQUIRED,
      unreadable: 0,
      records: [
        usage({ asset_id: "a", reason: "mint_source" }),
        usage({ asset_id: "b", synthetic: true }),
      ],
    });
    expect(r.observed_asset_ids).toEqual(["a", "b"]);
    expect(r.total_dependence_reads).toBe(0); // neither counts as dependence
  });
});

describe("S8 codex-round — frozen vocabularies (P0)", () => {
  it("the exported reason arrays are FROZEN, not merely readonly", () => {
    // TypeScript's readonly is erased at compile time. Without Object.freeze a caller
    // could push "rollback" into the benign list and silently exclude rollback reads.
    expect(Object.isFrozen(COMPATIBILITY_READ_REASONS)).toBe(true);
    expect(Object.isFrozen(BENIGN_COMPATIBILITY_READ_REASONS)).toBe(true);
    expect(Object.isFrozen(DEPENDENCE_COMPATIBILITY_READ_REASONS)).toBe(true);
    expect(Object.isFrozen(COMPATIBILITY_ASSET_KINDS)).toBe(true);
  });

  it("mutating an exported vocabulary cannot change a verdict", () => {
    // Even if a caller defeats the freeze (non-strict mode swallows the throw), the
    // predicate reads a PRIVATE set snapshotted at module load.
    try {
      (BENIGN_COMPATIBILITY_READ_REASONS as CompatibilityReadReason[]).push("rollback");
    } catch {
      /* frozen — the expected path */
    }
    expect(isDependenceRead(usage({ reason: "rollback" }))).toBe(true);
  });

  it("the rollup it returns is frozen (a verdict input cannot be edited after the fact)", () => {
    const r = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: ["a"],
      unreadable: 0,
      records: [],
    });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.by_asset)).toBe(true);
  });
});

describe("S8 codex-round — forged and malformed counts (P1)", () => {
  const REQUIRED = ["a"];
  const base = (over: Record<string, unknown>) =>
    ({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      by_asset: { a: 0 },
      total_dependence_reads: 0,
      observed_asset_ids: ["a"],
      removable: ["a"],
      unreadable: 0,
      ...over,
    }) as unknown as Parameters<typeof evaluateG5>[0]["rollups"][number];

  it("a rollup claiming total 0 over by_asset {a:1} is CAUGHT", () => {
    // The gate counts from by_asset and cross-checks the summary, so a hand-built or
    // mutated rollup cannot declare itself clean.
    const forged = base({ by_asset: { a: 1 }, total_dependence_reads: 0 });
    const v = evaluateG5({ rollups: [forged, base({ window_end_release: "2.7.0" })], required_asset_ids: REQUIRED });
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/disagrees with by_asset sum/);
  });

  it("NaN unreadable BLOCKS — NaN > 0 is false, so a naive check would pass it", () => {
    const v = evaluateG5({
      rollups: [base({ unreadable: Number.NaN }), base({ window_end_release: "2.7.0" })],
      required_asset_ids: REQUIRED,
    });
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/unreadable is not a valid count/);
  });

  it("a NEGATIVE unreadable cannot cancel a real one across releases", () => {
    // Summing before testing let +1 and -1 cancel to zero. The check is PER RELEASE.
    const v = evaluateG5({
      rollups: [
        base({ unreadable: 1 }),
        base({ window_end_release: "2.7.0", unreadable: -1 }),
      ],
      required_asset_ids: REQUIRED,
    });
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/unreadable/);
  });

  it("a negative by_asset count is rejected rather than offsetting a real read", () => {
    const v = evaluateG5({
      rollups: [
        base({ by_asset: { a: -5 }, total_dependence_reads: -5 }),
        base({ window_end_release: "2.7.0" }),
      ],
      required_asset_ids: REQUIRED,
    });
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/not a valid count/);
  });
});

describe("S8 codex-round — window integrity and the required universe (P0/P1)", () => {
  const REQUIRED = ["a"];
  const rollup = (start: string, end: string) =>
    rollupCompatibilityUsage({
      window_start_release: start,
      window_end_release: end,
      known_asset_ids: REQUIRED,
      unreadable: 0,
      records: [usage({ asset_id: "a", reason: "mint_source" })],
    });

  it("the SAME release submitted twice is not two releases of evidence", () => {
    const r = rollup("2.5.0", "2.6.0");
    const v = evaluateG5({ rollups: [r, r], required_asset_ids: REQUIRED });
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/duplicate release windows/);
  });

  it("two DISTINCT releases do pass (the check above is not just always-false)", () => {
    const v = evaluateG5({
      rollups: [rollup("2.5.0", "2.6.0"), rollup("2.6.0", "2.7.0")],
      required_asset_ids: REQUIRED,
    });
    expect(v.passed).toBe(true);
  });

  it("an EMPTY required set cannot pass — a gate over nothing proves nothing", () => {
    const v = evaluateG5({
      rollups: [rollup("2.5.0", "2.6.0"), rollup("2.6.0", "2.7.0")],
      required_asset_ids: [],
    });
    expect(v.passed).toBe(false);
    expect(v.blockers.join(" ")).toMatch(/empty required_asset_ids/);
  });
});

describe("S8 codex-round — validator closure (P1/P2)", () => {
  it("a NON-ENUMERABLE unknown own property is rejected (Object.keys missed it)", () => {
    const hostile = { ...usage() } as Record<string, unknown>;
    Object.defineProperty(hostile, "backdoor", { value: 1, enumerable: false });
    expect(parseCompatibilityUsageV1(hostile)).toBeNull();
  });

  it("content_hash must be canonical SHA-256 hex — 'x' proves nothing about bytes", () => {
    expect(parseCompatibilityUsageV1(usage({ content_hash: "x" }))).toBeNull();
    expect(parseCompatibilityUsageV1(usage({ content_hash: "A".repeat(64) }))).toBeNull(); // upper-case
    expect(parseCompatibilityUsageV1(usage({ content_hash: "a".repeat(63) }))).toBeNull();
    expect(parseCompatibilityUsageV1(usage({ content_hash: "a".repeat(64) }))).not.toBeNull();
  });
});

// ===========================================================================
// CROSS-LANE DEFECT-CLASS SWEEP — three classes found by sibling lanes' codex
// rounds (S1, S4), audited against S8. All three were PRESENT here.
// ===========================================================================

describe("S8 defect-class 1 — options-object TOCTOU", () => {
  // S1's finding: hardening the ARTIFACT while reading the OPTIONS bag with plain
  // property access leaves the window open. In evaluateG5 this was a direct FALSE
  // CLEAN — `rollup.unreadable` was read twice (validity, then threshold), so a getter
  // could answer 5 to the first and 0 to the second and walk a torn journal through a
  // deletion gate.
  const REQUIRED = ["a"];
  const good = (seq: number) =>
    rollupCompatibilityUsage({
      window_start_release: `2.${5 + seq}.0`,
      window_end_release: `2.${6 + seq}.0`,
      known_asset_ids: REQUIRED,
      unreadable: 0,
      records: [usage({ asset_id: "a", reason: "mint_source" })],
    });

  it("THE FALSE CLEAN: an `unreadable` getter that flips 5 to 0 cannot pass the gate", () => {
    let reads = 0;
    const torn = { ...good(1) } as Record<string, unknown>;
    Object.defineProperty(torn, "unreadable", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? 5 : 0; // valid count, then "not > 0"
      },
    });
    const v = evaluateG5({ rollups: [good(0), torn as never], required_asset_ids: REQUIRED });
    expect(v.passed).toBe(false);
    // Rejected at the options boundary — the getter is never invoked at all.
    expect(reads).toBe(0);
  });

  it("a getter on the G5 input itself NEVER FIRES", () => {
    let fired = 0;
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "rollups", {
      enumerable: true,
      configurable: true,
      get() {
        fired += 1;
        return [good(0), good(1)];
      },
    });
    Object.defineProperty(hostile, "required_asset_ids", {
      enumerable: true,
      configurable: true,
      value: REQUIRED,
    });
    expect(evaluateG5(hostile as never).passed).toBe(false);
    expect(fired).toBe(0);
  });

  it("a Proxy options bag is rejected", () => {
    const v = evaluateG5(
      new Proxy({ rollups: [good(0), good(1)], required_asset_ids: REQUIRED }, {}) as never,
    );
    expect(v.passed).toBe(false);
  });

  it("a SYMBOL key is rejected (getOwnPropertyNames does not see symbols)", () => {
    const withSym: Record<string | symbol, unknown> = {
      rollups: [good(0), good(1)],
      required_asset_ids: REQUIRED,
    };
    withSym[Symbol("x")] = 1;
    expect(evaluateG5(withSym as never).passed).toBe(false);
  });

  it("an unknown key is rejected", () => {
    expect(
      evaluateG5({ rollups: [good(0), good(1)], required_asset_ids: REQUIRED, extra: 1 } as never)
        .passed,
    ).toBe(false);
  });

  it("an exotic prototype is rejected", () => {
    const inherited = Object.create({ sneaky: true }) as Record<string, unknown>;
    inherited.rollups = [good(0), good(1)];
    inherited.required_asset_ids = REQUIRED;
    expect(evaluateG5(inherited as never).passed).toBe(false);
  });

  it("ANTI-VACUITY: the legitimate shape still PASSES", () => {
    // Without this, every assertion above could be satisfied by a gate that always fails.
    const v = evaluateG5({ rollups: [good(0), good(1)], required_asset_ids: REQUIRED });
    expect(v.blockers).toEqual([]);
    expect(v.passed).toBe(true);
  });

  it("the rollup input is hardened the same way, and a rejection is never a clean zero", () => {
    const r = rollupCompatibilityUsage(new Proxy({}, {}) as never);
    expect(r.unusable_reason).toBeDefined();
    // NaN, not 0 — an unusable rollup must never read as "zero dependence".
    expect(Number.isNaN(r.total_dependence_reads)).toBe(true);
    expect(evaluateG5({ rollups: [r, r], required_asset_ids: ["a"] }).passed).toBe(false);
  });
});

describe("S8 defect-class 2 — alias dedup on ids and paths", () => {
  // S1's finding: raw-string dedup lets two spellings of one referent count twice.
  // Here it is sharper — by_asset GROUPS BY asset_id, so a dependence read under an
  // alias hides while the canonical id reports zero.
  it("a non-canonical asset_id is REJECTED, never normalized", () => {
    expect(parseCompatibilityUsageV1(usage({ asset_id: " qa" }))).toBeNull();
    expect(parseCompatibilityUsageV1(usage({ asset_id: "qa " }))).toBeNull();
    expect(parseCompatibilityUsageV1(usage({ asset_id: "a/b" }))).toBeNull();
    expect(parseCompatibilityUsageV1(usage({ asset_id: "-leading" }))).toBeNull();
    expect(parseCompatibilityUsageV1(usage({ asset_id: "backend-api-contract" }))).not.toBeNull();
  });

  it("a non-canonical asset_path spelling is REJECTED (no accept-and-repair)", () => {
    for (const bad of [
      "skills/./x/SKILL.md",
      "skills/../x/SKILL.md",
      "/skills/x/SKILL.md",
      "skills//x/SKILL.md",
      "skills\\x\\SKILL.md",
    ]) {
      expect(parseCompatibilityUsageV1(usage({ asset_path: bad }))).toBeNull();
    }
    expect(parseCompatibilityUsageV1(usage({ asset_path: "skills/x/SKILL.md" }))).not.toBeNull();
  });

  it("duplicate known_asset_ids are rejected rather than silently collapsed", () => {
    const r = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: ["qa", "qa"],
      unreadable: 0,
      records: [],
    });
    expect(r.unusable_reason).toMatch(/duplicate/);
  });

  it("duplicate required_asset_ids block the gate", () => {
    expect(evaluateG5({ rollups: [], required_asset_ids: ["a", "a"] }).passed).toBe(false);
  });
});

describe("S8 defect-class 3 — unbounded-scalar smuggling and accept-by-attrition", () => {
  // S4's finding: a field validated as merely "non-empty string" carried a 12KB agent
  // body past a schema that had no body field at all.
  const CTRL = String.fromCharCode(1);

  it("an oversized scalar is rejected", () => {
    expect(parseCompatibilityUsageV1(usage({ asset_id: "a".repeat(600) }))).toBeNull();
    expect(
      parseCompatibilityUsageV1(usage({ asset_path: `skills/${"x".repeat(600)}.md` })),
    ).toBeNull();
  });

  it("CONTROL CHARACTERS are rejected — ids and paths never contain newlines", () => {
    expect(parseCompatibilityUsageV1(usage({ asset_id: "qa\nsmuggled: true" }))).toBeNull();
    expect(parseCompatibilityUsageV1(usage({ asset_path: `skills/x${CTRL}/SKILL.md` }))).toBeNull();
    expect(parseCompatibilityUsageV1(usage({ specialist_id: "backend\r\nX" }))).toBeNull();
  });

  it("ACCEPT-BY-ATTRITION: one malformed record REJECTS the rollup, it is not skipped", () => {
    // The sub-pattern: iterating a list and `continue`-ing over malformed entries until
    // a benign one matches. A bad record must sink the whole rollup — otherwise a
    // corrupt window still reports a clean zero.
    const r = rollupCompatibilityUsage({
      window_start_release: "2.5.0",
      window_end_release: "2.6.0",
      known_asset_ids: ["a"],
      unreadable: 0,
      records: [usage({ asset_id: "a" }), { schema_version: "nope" } as never],
    });
    expect(r.unusable_reason).toMatch(/not a valid guild\.compatibility_usage\.v1/);
    expect(Number.isNaN(r.total_dependence_reads)).toBe(true);
  });
});
