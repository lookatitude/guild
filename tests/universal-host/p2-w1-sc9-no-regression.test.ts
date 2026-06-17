/**
 * tests/universal-host/p2-w1-sc9-no-regression.test.ts
 *
 * SC-W1-9 — no unintended default-path change. The full scripts/ + tests/ suites green
 * in-band is the primary gate; this file adds the FALSIFIABLE A/B determinism checks that
 * pin the new P2-W1 pure surfaces (additive, no clock/random) so a nondeterminism or
 * silent default-shape drift fails fast. The ONE allowlisted intentional re-baseline is the
 * config-schema-extension golden (LW1-9-signed) — NOT these.
 */
import { classifyIntake } from "../../scripts/lib/classify-intake";
import { detectImpact } from "../../scripts/lib/workspace-impact-detector";
import { validateExploreV1, EXPLORE_V1_EXAMPLE } from "../../scripts/lib/explore-schema";
import { validateDefineV1, DEFINE_V1_EXAMPLE } from "../../scripts/lib/define-schema";
import type { DependencyGraphV1 } from "../../scripts/lib/dependency-graph-schema";

const GRAPH: DependencyGraphV1 = {
  schema_version: "guild.dependency_graph.v1",
  nodes: [
    { id: "plugin", path: "plugin" },
    { id: "website", path: "website" },
    { id: "benchmark", path: "benchmark" },
  ],
  edges: [
    { from: "website", to: "plugin" },
    { from: "benchmark", to: "website" },
  ],
};

describe("SC-W1-9 — additive pure surfaces are deterministic (A/B)", () => {
  it("classifyIntake: same prompt ⇒ byte-identical result", () => {
    const p = "I have an idea for an app that helps neighbors share tools";
    expect(JSON.stringify(classifyIntake(p))).toBe(JSON.stringify(classifyIntake(p)));
  });

  it("detectImpact: same graph + change-set ⇒ byte-identical map", () => {
    expect(JSON.stringify(detectImpact(GRAPH, ["plugin"]))).toBe(
      JSON.stringify(detectImpact(GRAPH, ["plugin"]))
    );
  });

  it("validators: stable verdict on the producer examples (no drift)", () => {
    expect(validateExploreV1(EXPLORE_V1_EXAMPLE).valid).toBe(true);
    expect(validateDefineV1(DEFINE_V1_EXAMPLE).valid).toBe(true);
  });

  it("the intake tuning preserved the five over-fire NEGATIVES (precision floor held)", () => {
    const overfire = [
      "What if we built an endpoint that creates invoices?",
      "I want to create a script that migrates users to the new table",
      "Thinking about a small script to rotate old logs",
      "What if we made a hook that validates receipts?",
      "I would like to build a tool for debugging flaky tests",
    ];
    for (const p of overfire) expect(classifyIntake(p).intake).toBe("other");
  });
});
