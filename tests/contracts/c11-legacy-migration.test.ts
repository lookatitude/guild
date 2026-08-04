/**
 * C11 — Legacy migration precedence (model_policy §6; team-contracts §6–§7;
 * SC-12).
 *
 * Contract: v2 model_policy WINS; legacy tier maps fill only unset GENERIC
 * (general/implementation) preferences, never bind research/review purposes,
 * never upgrade evidence; NO settings writeback (legacy bytes byte-identical);
 * legacy scheduling inputs (--team-size / defaults.team.size / allow_larger)
 * are clamped concurrency hints or warned no-ops, never roster inputs;
 * guild.team_plan.v1 capped/lossy artifacts require v2 recomposition + fresh
 * approval; non-lossy artifacts import ONLY as pending proposals.
 *
 * EXPECTED TO FAIL TODAY: the migration reader modules do not exist (T5/T2b).
 * The tier-model.ts control pins today's legacy read path (real module).
 */

import * as fs from "fs";
import * as path from "path";

import { resolveTierModel } from "../../src/modules/config/workflows/tier-model";
import { requireContractModule, mkTmpWorkspace, PLUGIN_ROOT } from "./_helpers";

const POLICY_MIGRATION_MODULE = "src/modules/capability/workflows/policy-migration";
const TEAM_PLAN_READER_MODULE = "src/modules/teams/workflows/team-plan-compat";
const LANE_T5 = "T5-policy-resolver";
const LANE_T2B = "T2b-unbounded-team-composer";

describe("C11 — legacy migration precedence + compatibility", () => {
  describe("model_policy §6 — dual-read precedence (v2 wins; legacy read-only)", () => {
    test("FAILING-TODAY: policy-migration module exists with resolveWithLegacy/migrationPreview", () => {
      const mod: any = requireContractModule(POLICY_MIGRATION_MODULE, LANE_T5);
      expect(typeof mod.resolveWithLegacy).toBe("function");
      expect(typeof mod.migrationPreview).toBe("function");
    });

    test("FAILING-TODAY: an explicit v2 purpose value WINS over a conflicting legacy tier map", () => {
      const mod: any = requireContractModule(POLICY_MIGRATION_MODULE, LANE_T5);
      const resolved = mod.resolveWithLegacy({
        v2_policy: { purposes: { general: { routes: [{ complexity: "medium", preferred: [{ selector: "alias:sonnet" }] }] } } },
        legacy_tiers: { mid: "legacy-model-x" },
        purpose: "general",
        effective_complexity: "medium",
      });
      expect(resolved.source).toBe("v2_policy");
      expect(resolved.conflicts).toHaveLength(1); // conflict recorded in the receipt
    });

    test("FAILING-TODAY: legacy fills ONLY unset generic preferences — never research or review purposes", () => {
      const mod: any = requireContractModule(POLICY_MIGRATION_MODULE, LANE_T5);
      for (const purpose of ["research", "advisory", "adversarial", "security", "adversarial-security"]) {
        const resolved = mod.resolveWithLegacy({
          v2_policy: { purposes: {} },
          legacy_tiers: { powerful: "legacy-model-x" },
          purpose,
          effective_complexity: "hard",
        });
        expect(resolved.source).not.toBe("legacy");
      }
    });

    test("FAILING-TODAY: no settings writeback — legacy bytes are byte-identical after resolution (preview only)", () => {
      const mod: any = requireContractModule(POLICY_MIGRATION_MODULE, LANE_T5);
      const root = mkTmpWorkspace();
      const settingsPath = path.join(root, ".guild", "settings.json");
      const legacyBytes = JSON.stringify({ models: { tiers: { mid: "legacy-model-x" } } }, null, 2);
      fs.writeFileSync(settingsPath, legacyBytes, "utf8");
      mod.migrationPreview({ root });
      expect(fs.readFileSync(settingsPath, "utf8")).toBe(legacyBytes);
    });

    test("[control] today's legacy read path resolves tier values read-only (real tier-model.ts anchor)", () => {
      const tiers = { mid: { claude: "claude-sonnet-5" }, powerful: "claude-fable-5" };
      expect(resolveTierModel(tiers, "mid", "claude").model).toBe("claude-sonnet-5");
      expect(resolveTierModel(tiers, "powerful", "codex").model).toBe("claude-fable-5");
      // Malformed input degrades to null — never throws, never guesses:
      expect(resolveTierModel(null, "mid", "claude").model).toBeNull();
      expect(resolveTierModel({ mid: 42 }, "mid", "claude").model).toBeNull();
    });
  });

  describe("team-contracts §6 — legacy scheduling inputs (frozen precedence; hints not caps)", () => {
    test("FAILING-TODAY: precedence explicit-v2 > positive --team-size > positive defaults.team.size, clamped by capacity", () => {
      const mod: any = requireContractModule(TEAM_PLAN_READER_MODULE, LANE_T2B);
      const hint = mod.resolveConcurrencyHint({
        v2_scheduling: { effective: 5 },
        cli_team_size: 3,
        defaults_team_size: 2,
        verified_backend_capacity: 4,
      });
      expect(hint.selected_hint).toBe(5);
      expect(hint.effective).toBe(4); // min(hint, capacity)
      expect(hint.clamp_diagnostic).toBeTruthy();
    });

    test("FAILING-TODAY: allow_larger is a WARNED NO-OP; zero/negative/malformed legacy values are REJECTED", () => {
      const mod: any = requireContractModule(TEAM_PLAN_READER_MODULE, LANE_T2B);
      const noop = mod.resolveConcurrencyHint({
        allow_larger: true,
        verified_backend_capacity: 4,
      });
      expect(noop.warnings.join(" ")).toMatch(/allow_larger/);
      expect(noop.effective).toBe(4);
      for (const bad of [0, -3, "six"]) {
        expect(() => mod.resolveConcurrencyHint({ cli_team_size: bad, verified_backend_capacity: 4 })).toThrow(/reject|invalid|malformed/i);
      }
    });

    test("FAILING-TODAY: NO legacy input can cap, filter, or reorder the logical roster", () => {
      const mod: any = requireContractModule(TEAM_PLAN_READER_MODULE, LANE_T2B);
      const roster = Array.from({ length: 9 }, (_, i) => `p${i}`);
      const out = mod.applySchedulingInputs({ roster, cli_team_size: 2, defaults_team_size: 2, verified_backend_capacity: 2 });
      expect(out.roster).toEqual(roster);
    });
  });

  describe("team-contracts §7 — guild.team_plan.v1 compatibility", () => {
    const cappedLegacy = {
      schema_version: "guild.team_plan.v1",
      station: "build",
      roster: [
        { role: "qa", scope: null, default_tier: "mid", fanout: "lead_only", source: "default" },
      ],
      capped: true,
      dropped_roles: ["security", "frontend"],
    };
    const losslessLegacy = {
      schema_version: "guild.team_plan.v1",
      station: "init",
      roster: [
        { role: "researcher", scope: null, default_tier: "mid", fanout: "lead_only", source: "default" },
        { role: "technical-writer", scope: null, default_tier: "mid", fanout: "lead_only", source: "default" },
      ],
      capped: false,
      dropped_roles: [],
    };

    test("FAILING-TODAY: a capped/lossy v1 artifact REQUIRES v2 recomposition + fresh user approval (roster untrusted)", () => {
      const mod: any = requireContractModule(TEAM_PLAN_READER_MODULE, LANE_T2B);
      const verdict = mod.importLegacyTeamPlan(cappedLegacy);
      expect(verdict.disposition).toBe("recompose_required");
      expect(verdict.dispatchable).toBe(false);
      expect(verdict.requires_user_approval).toBe(true);
    });

    test("FAILING-TODAY: a non-lossy v1 artifact imports ONLY as a PENDING v2 proposal — never as an approval", () => {
      const mod: any = requireContractModule(TEAM_PLAN_READER_MODULE, LANE_T2B);
      const verdict = mod.importLegacyTeamPlan(losslessLegacy);
      expect(verdict.disposition).toBe("pending_proposal");
      expect(verdict.proposal.proposal_version).toBe(1);
      expect(verdict.proposal.provenance).toMatch(/team_plan\.v1/);
      expect(verdict.dispatchable).toBe(false);
    });

    test("FAILING-TODAY: v2 NEVER emits cap/capped/dropped_roles keys (consumers branch on schema_version)", () => {
      const mod: any = requireContractModule(TEAM_PLAN_READER_MODULE, LANE_T2B);
      const v2 = mod.importLegacyTeamPlan(losslessLegacy).proposal;
      expect(v2).not.toHaveProperty("cap");
      expect(v2).not.toHaveProperty("capped");
      expect(v2).not.toHaveProperty("dropped_roles");
    });

    test("[control] lossy-detection distinguishes the two fixtures (anti-vacuity)", () => {
      const isLossy = (plan: { capped?: boolean; dropped_roles?: string[] }) =>
        plan.capped === true || (plan.dropped_roles ?? []).length > 0;
      expect(isLossy(cappedLegacy)).toBe(true);
      expect(isLossy(losslessLegacy)).toBe(false);
      // Injected known-bad detector (trusts `capped` alone, ignores dropped_roles) — caught:
      const knownBad = (plan: { capped?: boolean }) => plan.capped === true;
      expect(knownBad({ capped: false, dropped_roles: ["security"] } as never)).toBe(false);
      expect(isLossy({ capped: false, dropped_roles: ["security"] })).toBe(true);
    });
  });

  describe("fixture hygiene — no fixture doc-string sells a logical cap (T1a opens_for handover)", () => {
    test("[control] config-init-baseline.json documents defaults.team.size as a migration-window concurrency hint, not cap-6", () => {
      const fixturePath = path.join(PLUGIN_ROOT, "tests", "universal-host", "fixtures", "config-init-baseline.json");
      const text = fs.readFileSync(fixturePath, "utf8");
      expect(text).not.toMatch(/cap-6/);
      expect(text).not.toMatch(/3-4 rule/);
      const parsed = JSON.parse(text);
      const docString = JSON.stringify(parsed).match(/defaults\.team\.size[^"]*"[^"]*"/);
      expect(docString).toBeTruthy();
    });
  });
});
