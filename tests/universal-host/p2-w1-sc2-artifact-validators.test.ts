/**
 * tests/universal-host/p2-w1-sc2-artifact-validators.test.ts
 *
 * SC-W1-2 / SC-W1-3(shape) — AUTHORITATIVE validator negatives for the product-loop
 * artifact contracts `guild.explore.v1` (LW1-1) and `guild.define.v1` (LW1-1), driving the
 * SHIPPED validators on the real path. Proves: a complete artifact PASSES; dropping EACH
 * required field FAILS closed; the define duplicate-AC-id rule FAILS; and exotic input
 * (BigInt schema_version) FAILS without throwing. The exported `*_V1_EXAMPLE` constants are
 * the shapes the product-explore / product-define producer skills emit, so a passing
 * example here is the producer-shape check too.
 */
import {
  validateExploreV1,
  EXPLORE_V1_EXAMPLE,
} from "../../scripts/lib/explore-schema";
import {
  validateDefineV1,
  DEFINE_V1_EXAMPLE,
} from "../../scripts/lib/define-schema";

describe("SC-W1-2 — guild.explore.v1 validator", () => {
  it("accepts the producer example (valid sample)", () => {
    expect(validateExploreV1(EXPLORE_V1_EXAMPLE).valid).toBe(true);
  });

  const REQUIRED = ["assumptions", "evidence_needs", "comparables", "risks", "recommended_next_step"];
  it.each(REQUIRED)("fails closed when required field %s is missing", (field) => {
    const broken: Record<string, unknown> = { ...EXPLORE_V1_EXAMPLE };
    delete broken[field];
    expect(validateExploreV1(broken).valid).toBe(false);
  });

  it.each(REQUIRED)("fails closed when required array/field %s is empty", (field) => {
    const broken: Record<string, unknown> = { ...EXPLORE_V1_EXAMPLE };
    broken[field] = field === "recommended_next_step" ? "" : [];
    expect(validateExploreV1(broken).valid).toBe(false);
  });

  it("fails closed on a smuggled unknown key (strict)", () => {
    expect(validateExploreV1({ ...EXPLORE_V1_EXAMPLE, wiki_text: "x" }).valid).toBe(false);
  });

  it("NEVER throws and fails closed on an exotic BigInt schema_version", () => {
    let threw = false;
    let valid = true;
    try {
      valid = validateExploreV1({ ...EXPLORE_V1_EXAMPLE, schema_version: 1n as unknown }).valid;
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(valid).toBe(false);
  });
});

describe("SC-W1-3(shape) — guild.define.v1 validator", () => {
  it("accepts the producer example (valid sample)", () => {
    expect(validateDefineV1(DEFINE_V1_EXAMPLE).valid).toBe(true);
  });

  const REQUIRED = [
    "acceptance_criteria",
    "user_stories",
    "non_goals",
    "risks",
    "affected_surfaces",
    "test_implications",
  ];
  it.each(REQUIRED)("fails closed when required field %s is missing", (field) => {
    const broken: Record<string, unknown> = { ...DEFINE_V1_EXAMPLE };
    delete broken[field];
    expect(validateDefineV1(broken).valid).toBe(false);
  });

  it("fails closed on a duplicate acceptance-criterion id (traceability-breaking)", () => {
    const dup = {
      ...DEFINE_V1_EXAMPLE,
      acceptance_criteria: [
        { id: "AC-1", text: "first" },
        { id: "AC-1", text: "dup" },
      ],
    };
    expect(validateDefineV1(dup).valid).toBe(false);
  });

  it("fails closed on an acceptance criterion missing a stable id", () => {
    const noId = {
      ...DEFINE_V1_EXAMPLE,
      acceptance_criteria: [{ text: "criterion without an id" }],
    };
    expect(validateDefineV1(noId).valid).toBe(false);
  });

  it("NEVER throws and fails closed on an exotic BigInt schema_version", () => {
    let threw = false;
    let valid = true;
    try {
      valid = validateDefineV1({ ...DEFINE_V1_EXAMPLE, schema_version: 1n as unknown }).valid;
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(valid).toBe(false);
  });
});
