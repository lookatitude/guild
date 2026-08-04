/**
 * C7 — Review identity + two-axis independence (model_resolution §7–§7a; SC-7).
 *
 * Contract: strong independence requires VERIFIED host trust on both sides,
 * known + differing host_family, AND known + differing served-model
 * model_family (derived from finalized receipts' outcome.actual_model — never
 * the requested model). Asserted/unknown identity NEVER yields strong.
 *
 * EXPECTED TO FAIL TODAY:
 *  - review-pairing.ts grants independence:"strong" from registry entries
 *    alone (asserted host ids; no trust axis, no served-model axis).
 *  - The §7 predicate module does not exist yet (lanes T5+T6).
 */

import { planReviewPairing } from "../../src/modules/review/workflows/review-pairing";
import { requireContractModule } from "./_helpers";

const PREDICATE_MODULE = "src/modules/capability/workflows/independence-predicates";
const LANE = "T5+T6-review-independence";

/**
 * Minimal progress ctx satisfying PlanReviewPairingInput's ReviewProgressContext.
 * Registry ids verified live: claude-code-cli (family claude) and codex-cli
 * (family codex, result_adapter: true) — the pair the current implementation
 * marks "strong" from asserted registry rows alone.
 */
const CTX = {
  gate: "G-lane",
  runId: "run-contract-fixture",
  authorHost: "claude-code-cli",
  reviewerHost: "codex-cli",
} as Record<string, unknown>;

/** A fully-strong predicate input; each violation case flips ONE term. */
function strongInput() {
  return {
    producer: {
      host_family: "claude",
      host_trust: "verified",
      served_model: "claude-fable-5",
      served_model_family: "claude",
      finalized: true,
      status: "served",
    },
    reviewer: {
      host_family: "codex",
      host_trust: "verified",
      served_model: "gpt-5.6-sol",
      served_model_family: "gpt",
      finalized: true,
      status: "served",
    },
  };
}

const VIOLATIONS: ReadonlyArray<{ name: string; mutate: (i: any) => void }> = [
  { name: "producer trust asserted (not verified)", mutate: (i) => (i.producer.host_trust = "asserted") },
  { name: "reviewer trust asserted (not verified)", mutate: (i) => (i.reviewer.host_trust = "asserted") },
  { name: "producer host_family unknown", mutate: (i) => (i.producer.host_family = "unknown") },
  { name: "same host_family", mutate: (i) => (i.reviewer.host_family = "claude") },
  { name: "producer actual_model unknown (provider_silent)", mutate: (i) => { i.producer.served_model = "unknown"; i.producer.served_model_family = "unknown"; } },
  { name: "reviewer actual_model unknown", mutate: (i) => { i.reviewer.served_model = "unknown"; i.reviewer.served_model_family = "unknown"; } },
  { name: "same served model_family (provider substitution landed reviewer in producer family)", mutate: (i) => { i.reviewer.served_model = "claude-opus-4-8"; i.reviewer.served_model_family = "claude"; } },
  { name: "reviewer receipt unfinalized", mutate: (i) => (i.reviewer.finalized = false) },
  { name: "producer receipt not served (failed_closed)", mutate: (i) => (i.producer.status = "failed_closed") },
];

describe("C7 model_resolution §7–§7a — review identity + independence", () => {
  describe("current pairing grants strong from asserted identity (the live defect)", () => {
    test("FAILING-TODAY: registry-asserted host ids alone must NOT yield strong independence", () => {
      const plan = planReviewPairing({
        ...(CTX as any),
        policyAllowsSkip: true,
        reviewerAvailable: true,
        outcome: "succeeded",
      });
      // Today: author "claude" + reviewer "codex" registry families differ ⇒
      // plan.independence === "strong". Contract §7: no verified trust, no
      // served-model family evidence ⇒ weak, whatever the asserted strings say.
      expect(plan.independence).toBe("weak");
    });

    test("T5-R1-F2 probe: verified trust + cross-family hosts WITHOUT served-model evidence must NOT yield strong (§7a forbids provisional strong)", () => {
      const plan = planReviewPairing({
        ...(CTX as any),
        policyAllowsSkip: true,
        reviewerAvailable: true,
        outcome: "succeeded",
        authorTrust: "verified",
        reviewerTrust: "verified",
      });
      // Host-family difference + verified host trust ALONE is exactly the
      // provisional strong §7a forbids: with no producer/reviewer served-model
      // evidence the pairing stays weak (adjudication pending).
      expect(plan.status).toBe("selected");
      expect(plan.independence).toBe("weak");
      expect(plan.progress.every((e: any) => e.independence === "weak")).toBe(true);
    });

    test("[anti-vacuity] the full §7a evidence set (verified trust + finalized cross-family served models) restores strong", () => {
      const plan = planReviewPairing({
        ...(CTX as any),
        policyAllowsSkip: true,
        reviewerAvailable: true,
        outcome: "succeeded",
        authorTrust: "verified",
        reviewerTrust: "verified",
        authorServed: {
          served_model: "claude-fable-5",
          served_model_family: "claude",
          finalized: true,
          status: "served",
        },
        reviewerServed: {
          served_model: "gpt-5.6-sol",
          served_model_family: "gpt",
          finalized: true,
          status: "served",
        },
      });
      expect(plan.independence).toBe("strong");
      // Same evidence with the reviewer's SERVED model landing in the producer
      // family (provider substitution) drops back to weak — the model axis is
      // derived from the actual model, never the requested one.
      const substituted = planReviewPairing({
        ...(CTX as any),
        policyAllowsSkip: true,
        reviewerAvailable: true,
        outcome: "succeeded",
        authorTrust: "verified",
        reviewerTrust: "verified",
        authorServed: {
          served_model: "claude-fable-5",
          served_model_family: "claude",
          finalized: true,
          status: "served",
        },
        reviewerServed: {
          served_model: "claude-opus-4-8",
          served_model_family: "claude",
          finalized: true,
          status: "served",
        },
      });
      expect(substituted.independence).toBe("weak");
    });

    test("[control] same-family pairing is already weak/blocked (anti-vacuity)", () => {
      const plan = planReviewPairing({
        ...(CTX as any),
        reviewerHost: "claude-code-app",
        policyAllowsSkip: true,
        reviewerAvailable: true,
        outcome: "succeeded",
      });
      expect(plan.independence).toBe("weak");
    });
  });

  describe("§7 predicate module (deterministic, two axes, finalized-receipt inputs)", () => {
    test("FAILING-TODAY: predicate module exists with adjudicateIndependence", () => {
      const mod: any = requireContractModule(PREDICATE_MODULE, LANE);
      expect(typeof mod.adjudicateIndependence).toBe("function");
    });

    test("FAILING-TODAY: the all-strong input adjudicates strong (positive case)", () => {
      const mod: any = requireContractModule(PREDICATE_MODULE, LANE);
      const verdict = mod.adjudicateIndependence(strongInput());
      expect(verdict.independence).toBe("strong");
      expect(verdict.predicate_trace).toBeTruthy();
    });

    test.each(VIOLATIONS.map((v) => [v.name, v.mutate]))(
      "FAILING-TODAY: %s ⇒ weak (single-term violation)",
      (_name, mutate) => {
        const mod: any = requireContractModule(PREDICATE_MODULE, LANE);
        const input = strongInput();
        (mutate as (i: any) => void)(input);
        expect(mod.adjudicateIndependence(input).independence).toBe("weak");
      }
    );

    test("[control] reference §7 predicate reproduces the full truth table (anti-vacuity)", () => {
      const strong = (i: ReturnType<typeof strongInput>): boolean => {
        const final = (s: any) => s.finalized && (s.status === "served" || s.status === "fallback_served");
        const bound = (s: any) => final(s) && s.served_model !== "unknown";
        const known = (x: string) => x !== "unknown";
        return (
          bound(i.producer) && bound(i.reviewer) &&
          i.producer.host_trust === "verified" && i.reviewer.host_trust === "verified" &&
          known(i.producer.host_family) && known(i.reviewer.host_family) &&
          i.producer.host_family !== i.reviewer.host_family &&
          known(i.producer.served_model_family) && known(i.reviewer.served_model_family) &&
          i.producer.served_model_family !== i.reviewer.served_model_family
        );
      };
      expect(strong(strongInput())).toBe(true);
      for (const v of VIOLATIONS) {
        const input = strongInput();
        v.mutate(input);
        expect(strong(input)).toBe(false);
      }
      // Injected known-bad predicate (families-differ-only, ignores trust +
      // served-model axes — today's review-pairing semantics) is caught:
      const knownBad = (i: ReturnType<typeof strongInput>) =>
        i.producer.host_family !== i.reviewer.host_family;
      const asserted = strongInput();
      asserted.producer.host_trust = "asserted";
      expect(knownBad(asserted)).toBe(true); // bad predicate says strong…
      expect(strong(asserted)).toBe(false);  // …contract says weak. Caught.
    });
  });
});
