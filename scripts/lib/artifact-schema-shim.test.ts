import { describe, test, expect } from "bun:test";
import * as defineShim from "./define-schema";
import * as exploreShim from "./explore-schema";
import * as defineModule from "../../src/domains/evolve/index";
import * as exploreModule from "../../src/domains/evolve/index";

describe("artifact schema compatibility shims", () => {
  test("scripts/lib/explore-schema re-exports src/modules/evals", () => {
    expect(exploreShim.EXPLORE_SCHEMA_VERSION).toBe(exploreModule.EXPLORE_SCHEMA_VERSION);
    expect(exploreShim.validateExploreV1).toBe(exploreModule.validateExploreV1);
    expect(exploreShim.isExploreV1).toBe(exploreModule.isExploreV1);
  });

  test("scripts/lib/define-schema re-exports src/modules/evals", () => {
    expect(defineShim.DEFINE_SCHEMA_VERSION).toBe(defineModule.DEFINE_SCHEMA_VERSION);
    expect(defineShim.validateDefineV1).toBe(defineModule.validateDefineV1);
    expect(defineShim.acceptanceCriterionIds).toBe(defineModule.acceptanceCriterionIds);
  });
});
