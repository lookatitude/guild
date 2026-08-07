/**
 * C8 — Exact-key user-confirmation arbitration (model_resolution §6; SC-11).
 *
 * Contract: confirmation state is run-local and claimed atomically over the
 * exact key (run_id, purpose, target_id, policy_hash, catalog_hash,
 * fallback_hash). Byte-identical keys share ONE prompt + ONE decision; ANY
 * differing component is a DIFFERENT question with its own prompt; approval
 * never leaks across targets/purposes/degradation shapes.
 *
 * EXPECTED TO FAIL TODAY: the arbitration module does not exist (lane T5).
 * Deterministic: explicit interleavings, no timers.
 */

import { requireContractModule } from "./_helpers";

const ARBITER_MODULE = "src/modules/capability/workflows/confirmation-arbiter";
const LANE = "T5-policy-resolver";

const KEY_COMPONENTS = [
  "run_id",
  "purpose",
  "target_id",
  "policy_hash",
  "catalog_hash",
  "fallback_hash",
] as const;

function baseKey(): Record<string, string> {
  return {
    run_id: "run-aaaa",
    purpose: "general",
    target_id: "claude-api",
    policy_hash: "pol-hash-1",
    catalog_hash: "cat-hash-1",
    fallback_hash: "fb-hash-1",
  };
}

describe("C8 model_resolution §6 — exact-key prompt arbitration", () => {
  test("FAILING-TODAY: arbiter module exists with claimPrompt/recordDecision", () => {
    const mod: any = requireContractModule(ARBITER_MODULE, LANE);
    expect(typeof mod.claimPrompt).toBe("function");
    expect(typeof mod.recordDecision).toBe("function");
  });

  test("FAILING-TODAY: two concurrent lanes with byte-identical keys share ONE prompt and ONE decision", () => {
    const mod: any = requireContractModule(ARBITER_MODULE, LANE);
    const state = mod.createRunLocalState("run-aaaa");
    // Deterministic interleaving: both lanes claim before any decision lands.
    const laneA = mod.claimPrompt(state, baseKey());
    const laneB = mod.claimPrompt(state, baseKey());
    expect(laneA.prompt_id).toBe(laneB.prompt_id);
    mod.recordDecision(state, baseKey(), { decision: "approved" });
    expect(mod.decisionFor(state, baseKey())).toEqual(expect.objectContaining({ decision: "approved" }));
    // No duplicate or contradictory prompt for the same key:
    expect(mod.claimPrompt(state, baseKey()).already_decided).toBe(true);
  });

  test.each([...KEY_COMPONENTS])(
    "FAILING-TODAY: two non-identical keys (differ in %s) get SEPARATE prompts and no decision leak",
    (component) => {
      const mod: any = requireContractModule(ARBITER_MODULE, LANE);
      const state = mod.createRunLocalState("run-aaaa");
      const keyA = baseKey();
      const keyB = { ...baseKey(), [component]: `${baseKey()[component]}-DIFFERENT` };
      const promptA = mod.claimPrompt(state, keyA);
      const promptB = mod.claimPrompt(state, keyB);
      expect(promptA.prompt_id).not.toBe(promptB.prompt_id);
      mod.recordDecision(state, keyA, { decision: "approved" });
      // Approval must NOT leak to the other key.
      expect(mod.decisionFor(state, keyB)).toBeNull();
    }
  );

  test("[control] reference arbiter keyed on the full 6-tuple passes the same table (anti-vacuity)", () => {
    const canonical = (k: Record<string, string>) => KEY_COMPONENTS.map((c) => k[c]).join("|");
    const prompts = new Map<string, number>();
    const decisions = new Map<string, string>();
    let nextPrompt = 0;
    const claim = (k: Record<string, string>) => {
      const ck = canonical(k);
      if (!prompts.has(ck)) prompts.set(ck, nextPrompt++);
      return { prompt_id: prompts.get(ck)!, already_decided: decisions.has(ck) };
    };
    // Identical keys share:
    expect(claim(baseKey()).prompt_id).toBe(claim(baseKey()).prompt_id);
    // Every single-component difference separates:
    for (const component of KEY_COMPONENTS) {
      const other = { ...baseKey(), [component]: "DIFFERENT" };
      expect(claim(other).prompt_id).not.toBe(claim(baseKey()).prompt_id);
      decisions.set(canonical(baseKey()), "approved");
      expect(decisions.has(canonical(other))).toBe(false);
      decisions.clear();
    }
    // Injected known-bad arbiter (keys only on run_id+purpose) leaks across
    // fallback_hash (two non-identical confirmation keys collapse to one) and
    // is caught by the same table:
    const badCanonical = (k: Record<string, string>) => `${k["run_id"]}|${k["purpose"]}`;
    const differentChain = { ...baseKey(), fallback_hash: "fb-hash-2" };
    expect(badCanonical(differentChain)).toBe(badCanonical(baseKey()));
    expect(canonical(differentChain)).not.toBe(canonical(baseKey()));
  });
});
