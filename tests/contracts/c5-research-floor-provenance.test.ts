/**
 * C5 — Transitive research purpose + non-downgradable floors
 * (model_policy §2–§3; SC-5).
 *
 * Contract: purpose: research ALWAYS forces effective_complexity hard, tier
 * powerful, forced_floor_reason research_always_hard — for the DIRECT call and
 * transitively through nested delegation, retries, resume, advisor calls, and
 * generic sub-dispatch. Descendants may RAISE floors, never lower or erase
 * one. Missing authoritative purpose metadata fails closed (purpose_unbound).
 *
 * EXPECTED TO FAIL TODAY: src/modules/capability/workflows/purpose-provenance.ts
 * does not exist (lanes T1b+T5). The work_class pin tests are REAL-path and
 * pass today (T1a/T1b landed the metadata) — they anchor the authoritative
 * source the runtime must read.
 */

import * as fs from "fs";
import * as path from "path";

import { requireContractModule, PLUGIN_ROOT } from "./_helpers";

const PROVENANCE_MODULE = "src/modules/capability/workflows/purpose-provenance";
const LANE = "T5-policy-resolver";

/**
 * The six dispatch-chain shapes the plan lane names. Each chain starts from an
 * authoritative research binding and applies descendant events that try to
 * erase or lower the floor; NONE may succeed.
 */
const CHAIN_FIXTURES: ReadonlyArray<{
  name: string;
  events: Array<Record<string, unknown>>;
}> = [
  {
    name: "direct call",
    events: [{ kind: "dispatch", source: "skill_metadata", work_class: "research" }],
  },
  {
    name: "nested delegation (3 deep, every child labels easy)",
    events: [
      { kind: "dispatch", source: "skill_metadata", work_class: "research" },
      { kind: "delegate", caller_label: { complexity: "easy" } },
      { kind: "delegate", caller_label: { complexity: "easy" } },
      { kind: "delegate", caller_label: { complexity: "medium", purpose: "general" } },
    ],
  },
  {
    name: "retry",
    events: [
      { kind: "dispatch", source: "lane_lock", work_class: "research" },
      { kind: "retry", attempt: 2, caller_label: { complexity: "easy" } },
    ],
  },
  {
    name: "resume",
    events: [
      { kind: "dispatch", source: "registry_metadata", work_class: "research" },
      { kind: "resume", restored_from: "frozen_session_context" },
    ],
  },
  {
    name: "advisor escalation",
    events: [
      { kind: "dispatch", source: "skill_metadata", work_class: "research" },
      { kind: "advisor_call", caller_label: { purpose: "advisory" } },
    ],
  },
  {
    name: "generic sub-dispatch",
    events: [
      { kind: "dispatch", source: "skill_metadata", work_class: "research" },
      { kind: "sub_dispatch", declared_purpose: "general", caller_label: { complexity: "easy" } },
    ],
  },
];

describe("C5 model_policy §2–§3 — research floor + transitive provenance", () => {
  describe("floor survives every chain shape (none can erase it)", () => {
    test.each(CHAIN_FIXTURES.map((f) => [f.name, f.events]))(
      "FAILING-TODAY: %s — effective purpose research, hard/powerful, research_always_hard",
      (_name, events) => {
        const mod: any = requireContractModule(PROVENANCE_MODULE, LANE);
        const resolved = mod.resolveEffectivePurpose({ events });
        expect(resolved.purpose).toBe("research");
        expect(resolved.effective_complexity).toBe("hard");
        expect(resolved.tier).toBe("powerful");
        expect(resolved.forced_floor_reason).toBe("research_always_hard");
        // Every overridden caller/child label is recorded, never silently eaten.
        const hasLabels = (events as Array<Record<string, unknown>>).some((e) => e["caller_label"]);
        if (hasLabels) expect(resolved.rejected_labels.length).toBeGreaterThan(0);
        // Root provenance + ancestry are recorded on the descendant.
        expect(resolved.purpose_origin).toBeTruthy();
      }
    );

    test("FAILING-TODAY: work lacking authoritative purpose metadata fails closed (purpose_unbound), never 'general'", () => {
      const mod: any = requireContractModule(PROVENANCE_MODULE, LANE);
      expect(() =>
        mod.resolveEffectivePurpose({ events: [{ kind: "dispatch", source: "none" }] })
      ).toThrow(/purpose_unbound/);
    });

    test("FAILING-TODAY: descendants may RAISE a floor, never lower it (max composition)", () => {
      const mod: any = requireContractModule(PROVENANCE_MODULE, LANE);
      const resolved = mod.resolveEffectivePurpose({
        events: [
          { kind: "dispatch", source: "skill_metadata", work_class: "general", complexity: "medium" },
          { kind: "delegate", raises_floor: "hard" },
          { kind: "delegate", caller_label: { complexity: "easy" } },
        ],
      });
      expect(resolved.effective_complexity).toBe("hard");
    });
  });

  describe("T5-R1-F1 — the research powerful-TIER floor is enforced, not just the complexity label", () => {
    const POLICY_MODULE = "src/modules/capability/workflows/model-policy";
    const RESOLVER_MODULE = "src/modules/capability/workflows/model-resolver";

    /** Structurally valid research policy preferring a cheap-tier catalog id. */
    const cheapResearchPolicy = () => ({
      version: 2,
      allow_advertised_attempt: false,
      purposes: {
        research: {
          min_effective_complexity: "hard",
          independence: "none",
          confirm_on_degradation: true,
          routes: [
            {
              complexity: "hard",
              preferred: [{ selector: "id:cheap-research-model" }],
              fallbacks: [],
            },
          ],
        },
      },
    });
    const cheapCatalogRow = {
      canonical_id: "cheap-research-model",
      model_family: "cheapco",
      tier: "cheap",
      catalog_index: 0,
      evidence: { state: "available" },
    };

    test("probe: research route + cheap-tier preferred id ⇒ validator REJECTS against the catalog", () => {
      const mod: any = requireContractModule(POLICY_MODULE, LANE);
      const rejects: string[] = mod.validateModelPolicy(cheapResearchPolicy(), {
        catalog_models: [cheapCatalogRow],
      });
      expect(rejects.length).toBeGreaterThan(0);
      expect(rejects.join("\n")).toMatch(/tier "cheap".*powerful|powerful.*tier "cheap"/is);
    });

    test("probe: a sub-floor tier named STATICALLY (expr:tier=cheap) on a research route is rejected with no catalog at all", () => {
      const mod: any = requireContractModule(POLICY_MODULE, LANE);
      const policy = cheapResearchPolicy();
      (policy.purposes.research.routes[0] as any).fallbacks = [{ selector: "expr:tier=cheap" }];
      const rejects: string[] = mod.validateModelPolicy(policy);
      expect(rejects.some((r) => /expr:tier=cheap/.test(r) && /powerful/.test(r))).toBe(true);
    });

    test("probe: review-class purposes carry the same powerful floor (advisory route + cheap id rejected)", () => {
      const mod: any = requireContractModule(POLICY_MODULE, LANE);
      const policy: any = cheapResearchPolicy();
      policy.purposes = {
        advisory: {
          min_effective_complexity: "easy",
          independence: "prefer_cross_family",
          confirm_on_degradation: true,
          routes: [
            { complexity: "any", preferred: [{ selector: "id:cheap-research-model" }], fallbacks: [] },
          ],
        },
      };
      const rejects: string[] = mod.validateModelPolicy(policy, { catalog_models: [cheapCatalogRow] });
      expect(rejects.length).toBeGreaterThan(0);
      expect(rejects.join("\n")).toMatch(/advisory/);
    });

    test("probe: resolve NEVER selects a sub-powerful model on a research route — it fails closed as policy_invalid", () => {
      const mod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const receipt = mod.resolve({
        session_context: { target_id: "probe" },
        catalog_snapshot: { models: [cheapCatalogRow] },
        policy: cheapResearchPolicy(),
        request: { purpose: "research", requested_complexity: "easy" },
      });
      expect(receipt.failed_closed).toBe("policy_invalid");
      expect(receipt.selection).toBeNull();
      expect(receipt.rule_path.join("\n")).toMatch(/policy_reject:.*tier/i);
    });

    test("[anti-vacuity] the same research route resolves fine when the preferred id sits at the powerful tier", () => {
      const policyMod: any = requireContractModule(POLICY_MODULE, LANE);
      const resolverMod: any = requireContractModule(RESOLVER_MODULE, LANE);
      const powerfulRow = { ...cheapCatalogRow, tier: "powerful" };
      expect(policyMod.validateModelPolicy(cheapResearchPolicy(), { catalog_models: [powerfulRow] })).toEqual([]);
      const receipt = resolverMod.resolve({
        session_context: { target_id: "probe" },
        catalog_snapshot: { models: [powerfulRow] },
        policy: cheapResearchPolicy(),
        request: { purpose: "research", requested_complexity: "easy" },
      });
      expect(receipt.failed_closed).toBeUndefined();
      expect(receipt.selection.model).toBe("cheap-research-model");
      expect(receipt.request.effective_complexity).toBe("hard");
    });
  });

  describe("[control] authoritative work_class metadata is on disk (T1a/T1b real-path anchor)", () => {
    const researcherSkills = [
      "src/modules/specialists/resources/skills/specialists/researcher-deep-dive/SKILL.md",
      "src/modules/specialists/resources/skills/specialists/researcher-comparison-table/SKILL.md",
      "src/modules/specialists/resources/skills/specialists/researcher-paper-digest/SKILL.md",
    ];

    test.each(researcherSkills)("[control] %s carries work_class: research frontmatter", (rel) => {
      const text = fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8");
      expect(text).toMatch(/work_class:\s*research/);
    });

    test("[control] reference max() floor composer distinguishes raise vs erase (anti-vacuity)", () => {
      const ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
      const compose = (floors: string[]) =>
        floors.reduce((acc, f) => (ORDER[f] > ORDER[acc] ? f : acc), "easy");
      expect(compose(["medium", "hard", "easy"])).toBe("hard");
      // Injected known-bad (last-label-wins) is caught by the same fixture:
      const knownBad = (floors: string[]) => floors[floors.length - 1];
      expect(knownBad(["hard", "easy"])).not.toBe("hard");
    });
  });
});
