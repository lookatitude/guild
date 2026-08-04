/**
 * C6 — Deterministic resolution + frozen fallback receipts
 * (model_resolution §2–§5, §8; SC-6, SC-9).
 *
 * Contract: route selection is first-match over a closed table (route_unbound
 * fails closed); the fallback chain is FROZEN at resolution time; only the
 * closed eligible failure classes advance the chain; served attempts record
 * requested vs actual_model separately (provider_silent ⇒ actual_model
 * unknown, never the requested model); the receipt is a frozen core + an
 * append-only outcome finalized exactly once; unfinalized-on-resume receipts
 * finalize as `interrupted`.
 *
 * EXPECTED TO FAIL TODAY: src/modules/capability/workflows/model-resolver.ts
 * does not exist (lane T5).
 */

import { requireContractModule, FAILURE_TAXONOMY, selfRefHash, canonicalYaml, sha256 } from "./_helpers";

const RESOLVER_MODULE = "src/modules/capability/workflows/model-resolver";
const LANE = "T5-policy-resolver";

describe("C6 model_resolution — resolver + receipts", () => {
  describe("route selection (§2 / model_policy §1b)", () => {
    test("FAILING-TODAY: resolver module exists with resolve/advanceChain/finalizeReceipt", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      expect(typeof mod.resolve).toBe("function");
      expect(typeof mod.advanceChain).toBe("function");
      expect(typeof mod.finalizeReceipt).toBe("function");
    });

    test("FAILING-TODAY: unknown producer model_family makes BOTH non-always condition kinds false (later always-row catches)", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const routes = [
        { complexity: "any", condition: { kind: "producer_model_family_is_not", model_family: "gpt" }, marker: 0 },
        { complexity: "any", condition: { kind: "producer_model_family_is", model_family: "gpt" }, marker: 1 },
        { complexity: "any", marker: 2 },
      ];
      const selected = mod.selectRoute({ routes, effective_complexity: "hard", producer_model_family: "unknown" });
      expect(selected.index).toBe(2);
    });

    test("FAILING-TODAY: no matching row fails closed with route_unbound — never a silent default", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      expect(() =>
        mod.selectRoute({ routes: [{ complexity: "easy" }], effective_complexity: "hard", producer_model_family: null })
      ).toThrow(/route_unbound/);
    });

    test("[control] reference first-match semantics reproduce the unknown-family case (anti-vacuity)", () => {
      const evalCond = (cond: any, producerFamily: string | null): boolean => {
        if (!cond || cond.kind === "always") return true;
        if (producerFamily === "unknown" || producerFamily === null) return false;
        return cond.kind === "producer_model_family_is"
          ? producerFamily === cond.model_family
          : producerFamily !== cond.model_family;
      };
      expect(evalCond({ kind: "producer_model_family_is_not", model_family: "gpt" }, "unknown")).toBe(false);
      expect(evalCond({ kind: "producer_model_family_is", model_family: "gpt" }, "unknown")).toBe(false);
      expect(evalCond({ kind: "always" }, "unknown")).toBe(true);
      // Known-bad semantics ("is_not" true for unknown) caught:
      const knownBad = (cond: any, fam: string) => fam !== cond.model_family;
      expect(knownBad({ kind: "producer_model_family_is_not", model_family: "gpt" }, "unknown")).toBe(true);
    });
  });

  describe("frozen fallback chain honesty (§3–§4)", () => {
    test.each(FAILURE_TAXONOMY.map((f) => [f.failure_class, f.advances]))(
      "FAILING-TODAY: failure class %s advances-chain=%s (closed taxonomy)",
      (failureClass, advances) => {
        const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
        const receipt = {
          fallbacks: [{ model: "m1" }, { model: "m2" }],
          outcome: { attempted: [] },
        };
        const verdict = mod.advanceChain(receipt, { failure_class: failureClass });
        expect(verdict.advanced).toBe(advances);
        // T5-R1-F4 regression: assert the MODEL, not just the boolean — an
        // eligible failure with nothing attempted yields the FIRST fallback
        // (f1), never an index-offset skip into f2.
        expect(verdict.next_model).toBe(advances ? "m1" : null);
      }
    );

    test("T5-R1-F4 probe: the frozen chain yields f1, then f2, in order — exhaustion only after the LAST fallback", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const receipt = mod.freezeChain({
        selection: { model: "m0" },
        fallbacks: [{ model: "f1" }, { model: "f2" }],
      });
      // Both calling orders reach f1: BEFORE the selected model's failure is
      // recorded, and after. (The live defect returned f2 before / null after,
      // so no calling order ever reached f1.)
      expect(mod.advanceChain(receipt, { failure_class: "model_unavailable" }).next_model).toBe("f1");
      mod.recordAttempt(receipt, { model: "m0", result: "failed", failure_class: "model_unavailable" });
      expect(mod.advanceChain(receipt, { failure_class: "model_unavailable" }).next_model).toBe("f1");
      mod.recordAttempt(receipt, { model: "f1", result: "failed", failure_class: "model_overloaded" });
      expect(mod.advanceChain(receipt, { failure_class: "model_overloaded" }).next_model).toBe("f2");
      mod.recordAttempt(receipt, { model: "f2", result: "failed", failure_class: "server_nonretryable" });
      const exhausted = mod.advanceChain(receipt, { failure_class: "server_nonretryable" });
      expect(exhausted.advanced).toBe(true);
      expect(exhausted.next_model).toBeNull();
    });

    test("FAILING-TODAY: no out-of-receipt substitution — a model outside the frozen chain is a contract violation", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const receipt = { fallbacks: [{ model: "m1" }, { model: "m2" }], outcome: { attempted: [] } };
      expect(() => mod.recordAttempt(receipt, { model: "m-not-in-chain", result: "served" })).toThrow(
        /frozen|out-of-receipt|chain/i
      );
    });

    test("FAILING-TODAY: mid-run catalog changes never alter an already-frozen chain", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const frozen = mod.freezeChain({ fallbacks: [{ model: "m1" }, { model: "m2" }] });
      mod.simulateCatalogChange({ remove: "m2" });
      expect(frozen.fallbacks.map((f: any) => f.model)).toEqual(["m1", "m2"]);
    });

    test("[control] the taxonomy fixture matches the documented eligible set exactly (self-consistency)", () => {
      const eligible = FAILURE_TAXONOMY.filter((f) => f.advances).map((f) => f.failure_class);
      expect(eligible.sort()).toEqual(["model_overloaded", "model_unavailable", "server_nonretryable"]);
      const never = FAILURE_TAXONOMY.filter((f) => !f.advances).map((f) => f.failure_class);
      expect(never).toContain("rate_limited");
      expect(never).toContain("auth_error");
      expect(never).toContain("policy_refusal");
    });
  });

  describe("actual_model honesty (§5)", () => {
    test("FAILING-TODAY: provider_silent substitution records actual_model 'unknown' — NEVER the requested model", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const attempt = mod.classifyServedAttempt({
        requested_model: "claude-fable-5",
        provider_reported_model: null,
      });
      expect(attempt.substitution_class).toBe("provider_silent");
      expect(attempt.actual_model).toBe("unknown");
      expect(attempt.actual_model).not.toBe("claude-fable-5");
    });

    test("FAILING-TODAY: reported substitutions record the SERVED model with the closed class", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const attempt = mod.classifyServedAttempt({
        requested_model: "claude-fable-5",
        provider_reported_model: "claude-opus-4-8",
        mechanism: "content_classifier",
      });
      expect(attempt.substitution_class).toBe("provider_content_fallback");
      expect(attempt.actual_model).toBe("claude-opus-4-8");
    });

    test("[control] known-bad recorder (assumes actual=requested when unreported) is caught by the fixture", () => {
      const knownBad = (requested: string, reported: string | null) => reported ?? requested;
      expect(knownBad("claude-fable-5", null)).not.toBe("unknown");
    });

    test("T5-R1-F3 probe: recordAttempt rejects substitution_class none when requested ≠ actual", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const receipt = mod.freezeChain({ fallbacks: [{ model: "claude-fable-5" }] });
      expect(() =>
        mod.recordAttempt(receipt, {
          model: "claude-fable-5",
          result: "served",
          substitution_class: "none",
          actual_model: "claude-opus-4-8",
        })
      ).toThrow(/none.*actual_model|actual_model.*none/i);
      expect(receipt.outcome.attempted).toHaveLength(0);
    });

    test("T5-R1-F3 probe: recordAttempt rejects an omitted/null substitution_class on a served attempt", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const receipt = mod.freezeChain({ fallbacks: [{ model: "claude-fable-5" }] });
      expect(() =>
        mod.recordAttempt(receipt, { model: "claude-fable-5", result: "served" })
      ).toThrow(/substitution_class/i);
      expect(() =>
        mod.recordAttempt(receipt, {
          model: "claude-fable-5",
          result: "served",
          substitution_class: null,
          actual_model: "claude-fable-5",
        })
      ).toThrow(/substitution_class/i);
      expect(receipt.outcome.attempted).toHaveLength(0);
    });

    test("T5-R1-F3 probe: provider_silent must carry actual_model 'unknown'; reported fallbacks must differ from requested", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const receipt = mod.freezeChain({ fallbacks: [{ model: "claude-fable-5" }] });
      expect(() =>
        mod.recordAttempt(receipt, {
          model: "claude-fable-5",
          result: "served",
          substitution_class: "provider_silent",
          actual_model: "claude-fable-5",
        })
      ).toThrow(/provider_silent/i);
      expect(() =>
        mod.recordAttempt(receipt, {
          model: "claude-fable-5",
          result: "served",
          substitution_class: "provider_content_fallback",
          actual_model: "claude-fable-5",
        })
      ).toThrow(/provider_content_fallback/i);
    });

    test("T5-R1-F3 probe: finalizeReceipt re-validates — a hand-appended dishonest served attempt never finalizes", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      // Dishonest record 1: class none hiding a substitution.
      const r1 = mod.freezeChain({ fallbacks: [{ model: "claude-fable-5" }] });
      r1.outcome.attempted.push({
        model: "claude-fable-5",
        result: "served",
        substitution_class: "none",
        actual_model: "claude-opus-4-8",
      });
      expect(() => mod.finalizeReceipt(r1, { status: "served" })).toThrow(/none/i);
      expect(r1.finalized_at).toBeNull();
      // Dishonest record 2: served attempt with the class omitted (serialized null).
      const r2 = mod.freezeChain({ fallbacks: [{ model: "claude-fable-5" }] });
      r2.outcome.attempted.push({
        model: "claude-fable-5",
        result: "served",
        substitution_class: null,
        actual_model: "unknown",
      });
      expect(() => mod.finalizeReceipt(r2, { status: "served" })).toThrow(/substitution_class/i);
      expect(r2.finalized_at).toBeNull();
      // Honest silent substitution (provider_silent + unknown) finalizes fine.
      const r3 = mod.freezeChain({ fallbacks: [{ model: "claude-fable-5" }] });
      mod.recordAttempt(r3, {
        model: "claude-fable-5",
        result: "served",
        substitution_class: "provider_silent",
        actual_model: "unknown",
      });
      mod.finalizeReceipt(r3, { status: "served" });
      expect(r3.outcome.actual_model).toBe("unknown");
    });
  });

  describe("receipt lifecycle (§8) + determinism (§2)", () => {
    test("FAILING-TODAY: outcome is append-only and finalization happens exactly once", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const receipt = mod.freezeChain({ fallbacks: [{ model: "m1" }] });
      mod.recordAttempt(receipt, { model: "m1", result: "served", actual_model: "m1", substitution_class: "none" });
      mod.finalizeReceipt(receipt, { status: "served" });
      expect(receipt.finalized_at).toBeTruthy();
      expect(receipt.receipt_hash).toBeTruthy();
      expect(() => mod.finalizeReceipt(receipt, { status: "served" })).toThrow(/finalized/i);
      expect(() => mod.recordAttempt(receipt, { model: "m1", result: "served" })).toThrow(/finalized|immutable/i);
    });

    test("FAILING-TODAY: an unfinalized receipt found at resume finalizes as `interrupted`, preserving appended evidence", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const receipt = mod.freezeChain({ fallbacks: [{ model: "m1" }] });
      mod.recordAttempt(receipt, { model: "m1", result: "failed", failure_class: "transport_error" });
      const finalized = mod.finalizeInterrupted(receipt);
      expect(finalized.outcome.status).toBe("interrupted");
      expect(finalized.outcome.attempted).toHaveLength(1);
    });

    test("FAILING-TODAY: byte-identical inputs yield identical selection + fallback_hash (determinism guarantee)", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const inputs = { session_context: "sc-bytes", catalog_snapshot: "cat-bytes", policy: "pol-bytes" };
      const a = mod.resolve(inputs);
      const b = mod.resolve(inputs);
      expect(a.fallback_hash).toBe(b.fallback_hash);
      expect(a.selection).toEqual(b.selection);
      expect(a.rule_path).toEqual(b.rule_path);
    });

    test("[control] reference self-referential hashing (team-contracts §1) is stable and omission-based (anti-vacuity)", () => {
      const artifact: Record<string, unknown> = {
        schema_version: "guild.model_resolution.v1",
        run_id: "run-x",
        fallbacks: [{ model: "m1" }],
        resolution_core_hash: "placeholder",
      };
      const h1 = selfRefHash(artifact, "resolution_core_hash");
      artifact["resolution_core_hash"] = h1;
      // Recomputation from the artifact minus the hash field reproduces it.
      expect(selfRefHash(artifact, "resolution_core_hash")).toBe(h1);
      // Known-bad convention (hash field BLANKED, not omitted) diverges — caught.
      const blanked = { ...artifact, resolution_core_hash: "" };
      expect(sha256(canonicalYaml(blanked))).not.toBe(h1);
    });
  });
});
