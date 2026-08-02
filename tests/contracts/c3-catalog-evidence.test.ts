/**
 * C3 — Target evidence eligibility (model_catalog §2–§6; SC-3, SC-4, SC-8).
 *
 * Contract: evidence states are closed (available|advertised|unknown|
 * unavailable); closed transitions are append-only events that never rewrite a
 * frozen run snapshot; public docs / static hints NEVER prove entitlement
 * (max `advertised`, never `available`); no cross-target projection; gateway +
 * claude-cli/app/web adapters resolve honest `unknown`.
 *
 * EXPECTED TO FAIL TODAY: the owning module
 * src/modules/capability/workflows/model-catalog.ts does not exist (lane T4).
 * Failing-by-design via CONTRACT-MODULE-MISSING; [control] tests pass today.
 */

import { requireContractModule, EVIDENCE_STATES } from "./_helpers";

const CATALOG_MODULE = "src/modules/capability/workflows/model-catalog";
const LANE = "T4-catalog-discovery";

/** catalog §5 — the closed purpose-aware eligibility matrix, verbatim. */
const ELIGIBILITY_CASES: ReadonlyArray<{
  evidence: (typeof EVIDENCE_STATES)[number];
  purposeClass: "general" | "research" | "review";
  allowAdvertisedAttempt: boolean;
  eligible: boolean;
}> = [
  { evidence: "available", purposeClass: "general", allowAdvertisedAttempt: false, eligible: true },
  { evidence: "available", purposeClass: "research", allowAdvertisedAttempt: false, eligible: true },
  { evidence: "available", purposeClass: "review", allowAdvertisedAttempt: false, eligible: true },
  { evidence: "advertised", purposeClass: "general", allowAdvertisedAttempt: false, eligible: false },
  { evidence: "advertised", purposeClass: "general", allowAdvertisedAttempt: true, eligible: true },
  { evidence: "advertised", purposeClass: "research", allowAdvertisedAttempt: true, eligible: false },
  { evidence: "advertised", purposeClass: "review", allowAdvertisedAttempt: true, eligible: false },
  { evidence: "unknown", purposeClass: "general", allowAdvertisedAttempt: true, eligible: false },
  { evidence: "unknown", purposeClass: "research", allowAdvertisedAttempt: true, eligible: false },
  { evidence: "unknown", purposeClass: "review", allowAdvertisedAttempt: true, eligible: false },
  { evidence: "unavailable", purposeClass: "general", allowAdvertisedAttempt: true, eligible: false },
  { evidence: "unavailable", purposeClass: "research", allowAdvertisedAttempt: true, eligible: false },
  { evidence: "unavailable", purposeClass: "review", allowAdvertisedAttempt: true, eligible: false },
];

/** Reference eligibility semantics (catalog §5) for anti-vacuity controls. */
function referenceEligibility(
  evidence: string,
  purposeClass: string,
  allowAdvertisedAttempt: boolean
): boolean {
  if (evidence === "available") return true;
  if (evidence === "advertised") return purposeClass === "general" && allowAdvertisedAttempt;
  return false;
}

describe("C3 model_catalog — evidence states, transitions, eligibility", () => {
  describe("eligibility matrix (catalog §5, closed)", () => {
    test.each(ELIGIBILITY_CASES.map((c) => [c.evidence, c.purposeClass, c.allowAdvertisedAttempt, c.eligible]))(
      "FAILING-TODAY: evidence=%s purpose-class=%s allow_advertised_attempt=%s ⇒ eligible=%s",
      (evidence, purposeClass, allow, eligible) => {
        const mod: any = requireContractModule(CATALOG_MODULE, LANE);
        expect(
          mod.eligibleForPurpose({
            evidence_state: evidence,
            purpose_class: purposeClass,
            allow_advertised_attempt: allow,
          })
        ).toBe(eligible);
      }
    );

    test("[control] the reference matrix reproduces every fixture row (self-consistency)", () => {
      for (const c of ELIGIBILITY_CASES) {
        expect(referenceEligibility(c.evidence, c.purposeClass, c.allowAdvertisedAttempt)).toBe(c.eligible);
      }
    });

    test("[control] injected known-bad matrix (advertised ⇒ research-eligible) is caught", () => {
      const knownBad = (evidence: string) => evidence !== "unavailable" && evidence !== "unknown";
      const researchAdvertised = ELIGIBILITY_CASES.find(
        (c) => c.evidence === "advertised" && c.purposeClass === "research"
      )!;
      expect(knownBad(researchAdvertised.evidence)).not.toBe(researchAdvertised.eligible);
    });
  });

  describe("evidence transitions (catalog §4, append-only; public docs never prove entitlement)", () => {
    // T4-R2-001: the bare source-only form was removed — every derivation call
    // carries the exact grounded row triple (target_id, adapter_id, source).
    const GROUNDED_ROW = { target_id: "claude-api", adapter_id: "claude-api-models" };

    test("FAILING-TODAY: static hints / public docs emit at most `advertised`, never `available` — even on the grounded row", () => {
      const mod: any = requireContractModule(CATALOG_MODULE, LANE);
      for (const source of ["static_hint", "public_doc", "unauthenticated_list"]) {
        const state = mod.evidenceStateForListing({
          source,
          contract_states_availability: false,
          ...GROUNDED_ROW,
        });
        expect(state).toBe("advertised");
        expect(state).not.toBe("available");
      }
    });

    test("FAILING-TODAY: `available` from a listing requires the exact grounded triple (claude-api /v1/models only, today)", () => {
      const mod: any = requireContractModule(CATALOG_MODULE, LANE);
      expect(
        mod.evidenceStateForListing({
          source: "contract_api_list",
          contract_states_availability: true,
          ...GROUNDED_ROW,
        })
      ).toBe("available");
      // Codex auth-list surfaces: entitlement semantics contractually undefined.
      expect(
        mod.evidenceStateForListing({
          source: "native_list",
          contract_states_availability: false,
          ...GROUNDED_ROW,
        })
      ).toBe("advertised");
      // REGRESSION (T4-R2-001): the bare source-only form no longer derives a
      // state at all — an incomplete authority triple is rejected.
      expect(() =>
        mod.evidenceStateForListing({ source: "contract_api_list", contract_states_availability: true })
      ).toThrow(/authority triple/);
    });

    test("FAILING-TODAY: an `actual_model: unknown` dispatch outcome upgrades NOTHING", () => {
      const mod: any = requireContractModule(CATALOG_MODULE, LANE);
      const verdict = mod.dispatchUpgrade({
        result: "served",
        actual_model: "unknown",
        requested_model: "claude-fable-5",
      });
      expect(verdict.upgrades).toBe(false);
    });

    test("FAILING-TODAY: transitions are append-only events — a frozen run snapshot is never rewritten (SC-8)", () => {
      const mod: any = requireContractModule(CATALOG_MODULE, LANE);
      const snapshot = mod.freezeSnapshot({
        models: [{ canonical_id: "m1", evidence: { state: "advertised" } }],
      });
      mod.appendEvidenceEvent(snapshot.target_log, {
        model: "m1",
        transition: "advertised->unavailable",
      });
      // The frozen snapshot the active run resolves against is unchanged.
      expect(snapshot.models[0].evidence.state).toBe("advertised");
    });

    test("[control] reference transition legality table is closed and self-consistent", () => {
      const legal = new Set([
        "unknown->advertised",
        "unknown->available",
        "advertised->available",
        "advertised->unavailable",
        "available->unavailable",
        "advertised->unknown",
        "available->unknown",
        "unavailable->unknown",
      ]);
      // Known-bad transitions the runtime must reject:
      for (const bad of ["unavailable->available", "unknown->unavailable", "available->advertised"]) {
        expect(legal.has(bad)).toBe(false);
      }
      // TTL expiry alone is NOT a transition (staleness ≠ unavailable).
      expect(legal.has("available->stale")).toBe(false);
    });
  });

  describe("no cross-target projection (catalog §2) + honest-unknown adapters (catalog §6)", () => {
    test("FAILING-TODAY: a claude-api /v1/models snapshot never seeds a subscription or gateway target's catalog", () => {
      const mod: any = requireContractModule(CATALOG_MODULE, LANE);
      const verdict = mod.projectionAllowed({
        from_target: "claude-api",
        to_target: "claude-cli-subscription",
      });
      expect(verdict).toBe(false);
      expect(mod.projectionAllowed({ from_target: "claude-api", to_target: "claude-gateway-bedrock" })).toBe(false);
      expect(mod.projectionAllowed({ from_target: "openai-api", to_target: "codex-cli-chatgpt" })).toBe(false);
    });

    test("FAILING-TODAY: gateway + claude-cli/app/web adapters resolve honest `unknown` absent evidenced listings", () => {
      const mod: any = requireContractModule(CATALOG_MODULE, LANE);
      for (const target of [
        "claude-gateway-bedrock",
        "claude-gateway-vertex",
        "claude-gateway-foundry",
        "claude-cli-subscription",
        "claude-app",
        "claude-web",
      ]) {
        expect(mod.defaultEvidenceStateForTarget(target)).toBe("unknown");
      }
    });

    test("[control] the closed evidence-state enum has exactly the four contract values", () => {
      expect([...EVIDENCE_STATES].sort()).toEqual(["advertised", "available", "unavailable", "unknown"]);
    });
  });
});
