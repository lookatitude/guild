/**
 * C9 — Uncapped, task-derived team composition (team-contracts §2–§3; SC-16).
 *
 * Contract: NO hard specialist-count cap, NO default 3-4 target, NO
 * tail-drop/truncation path in composer, validators, skills, or commands.
 * Retires TEAM_CAP=6 (station-composer.ts:649) and the `cap` config override
 * (:872). Backend limits touch scheduling only, never the roster.
 *
 * EXPECTED TO FAIL TODAY:
 *  - composeStationTeam caps at 6 and tail-drops justified roles;
 *  - source guards find the numeric limiter + slice path in the composer;
 *  - the guild.team_proposal.v2 composer/validator module does not exist (T2b).
 */

import * as fs from "fs";
import * as path from "path";

import {
  composeStationTeam,
  type StationSignals,
} from "../../src/modules/teams/workflows/station-composer";
import { requireContractModule, seededRng, rngInt, selfRefHash, PLUGIN_ROOT } from "./_helpers";

const PROPOSAL_MODULE = "src/modules/teams/workflows/team-proposal";
const LANE = "T2b-unbounded-team-composer";

/** All six global signals true — for station "init" this JUSTIFIES 7 distinct roles. */
const ALL_SIGNALS: StationSignals = {
  multi_component: true,
  auth_touched: true,
  backend_present: true,
  user_facing_ui: true,
  public_docs: true,
  search_discoverability: true,
};

describe("C9 team-contracts §2 — uncapped composition", () => {
  describe("real composer: justified teams survive whole (no tail-drop)", () => {
    test("FAILING-TODAY: 7 justified roles all survive composition (no cap-6 tail-drop)", () => {
      // init station under ALL signals: defaults researcher/technical-writer +
      // conditional architect (multi_component) + implied security
      // (auth_touched), qa (backend_present), frontend (user_facing_ui), seo
      // (search_discoverability) = 7 DISTINCT justified roles. Every role has
      // a fired signal or default rationale: the team is JUSTIFIED, so the
      // contract requires ALL 7 in the proposal. Today cap-6 tail-drops one.
      const plan = composeStationTeam("init", ALL_SIGNALS, { tierIndex: {} });
      const justifiedDistinct = [
        "researcher",
        "technical-writer",
        "architect",
        "security",
        "qa",
        "frontend",
        "seo",
      ];
      expect(plan.roster.length).toBeGreaterThanOrEqual(7);
      for (const role of justifiedDistinct) {
        expect(plan.roster.map((l) => l.role)).toContain(role);
      }
    });

    test("FAILING-TODAY: the composed plan reports NO truncation artifacts (dropped_roles empty / capped false)", () => {
      const plan = composeStationTeam("init", ALL_SIGNALS, { tierIndex: {} }) as unknown as Record<string, unknown>;
      const droppedRoles = (plan["dropped_roles"] ?? []) as string[];
      const capped = plan["capped"] ?? false;
      expect(droppedRoles).toEqual([]);
      expect(capped).toBe(false);
    });

    test("FAILING-TODAY: an injected numeric cap override must be REJECTED, not honored as a logical-size limiter", () => {
      // team-contracts §2 retires the `cap` config override (:872). A caller
      // supplying one must not get silent truncation.
      const compose = () =>
        composeStationTeam("plan", ALL_SIGNALS, { tierIndex: {}, cap: 2 } as never);
      let truncated = false;
      try {
        const plan = compose();
        truncated = plan.roster.length <= 2;
      } catch {
        truncated = false; // rejecting loudly satisfies the contract
      }
      expect(truncated).toBe(false);
    });

    test("[control] a small justified team already survives whole (proves the survival assertion CAN pass)", () => {
      const plan = composeStationTeam("init", {}, { tierIndex: {} });
      expect(plan.roster.map((l) => l.role).sort()).toEqual(["researcher", "technical-writer"]);
    });
  });

  describe("source guards: no numeric logical-size limiter / slice-drop path (team-contracts §2)", () => {
    const composerSource = fs.readFileSync(
      path.join(PLUGIN_ROOT, "src", "modules", "teams", "workflows", "station-composer.ts"),
      "utf8"
    );

    test("FAILING-TODAY: no TEAM_CAP numeric limiter constant in the composition pipeline", () => {
      expect(composerSource).not.toMatch(/TEAM_CAP\s*=\s*\d+/);
    });

    test("FAILING-TODAY: no slice/tail-drop path applied to the candidate roster", () => {
      expect(composerSource).not.toMatch(/\.slice\(0,\s*cap\)/);
      expect(composerSource).not.toMatch(/config\.cap\s*\?\?/);
    });

    test("[control] guard patterns CAN fire on the retired constructs (anti-vacuity)", () => {
      expect(/TEAM_CAP\s*=\s*\d+/.test("export const TEAM_CAP = 6 as const;")).toBe(true);
      expect(/\.slice\(0,\s*cap\)/.test("const kept = prioritized.slice(0, cap);")).toBe(true);
    });
  });

  describe("guild.team_proposal.v2 (schema guards + generated/property cases)", () => {
    test("FAILING-TODAY: v2 proposal module exists with composeProposal/validateProposal", () => {
      const mod: any = requireContractModule(PROPOSAL_MODULE, LANE);
      expect(typeof mod.composeProposal).toBe("function");
      expect(typeof mod.validateProposal).toBe("function");
    });

    test("FAILING-TODAY: validator rejects cap/size/truncation keys (closed schema, unknown keys rejected)", () => {
      const mod: any = requireContractModule(PROPOSAL_MODULE, LANE);
      for (const badKey of ["cap", "capped", "dropped_roles", "max_team_size", "team_size"]) {
        const verdict = mod.validateProposal({ schema_version: "guild.team_proposal.v2", [badKey]: 6 });
        expect(verdict.valid).toBe(false);
      }
    });

    test("FAILING-TODAY: generated rosters (sizes 1..40, random DAGs, seeded) all validate uncapped", () => {
      const mod: any = requireContractModule(PROPOSAL_MODULE, LANE);
      const rng = seededRng(0x5eed);
      for (let trial = 0; trial < 25; trial++) {
        const size = 1 + rngInt(rng, 40);
        const participants = Array.from({ length: size }, (_, i) => ({
          participant_id: `p${i}`,
          participation_kind: (["worker", "advisor", "challenger", "reviewer_local", "reviewer_cross_host"] as const)[
            rngInt(rng, 5)
          ],
          role_ref: `role-${i % 7}`,
          necessity_rationale: `justified by generated obligation ${i}`,
          owned_obligations: [`ob${i}`],
          // Edges only to LOWER indices — guaranteed acyclic by construction.
          depends_on: Array.from(
            new Set(Array.from({ length: rngInt(rng, Math.min(i + 1, 4)) }, () => `p${rngInt(rng, Math.max(i, 1))}`))
          ).filter((d) => d !== `p${i}`),
          tier: (["cheap", "mid", "powerful"] as const)[rngInt(rng, 3)],
          purpose: "implementation",
          capability_scope: null,
          backend: "team",
        }));
        const obligations = participants.map((p, i) => ({
          obligation_id: `ob${i}`,
          source: "plan_item",
          text: `generated obligation ${i}`,
          disposition: { owners: [p.participant_id] },
        }));
        // Rework F2: the frozen section-3 fields are REQUIRED — the generated
        // fixture carries them all, hash stamped via the REFERENCE section-1
        // implementation (cross-impl: the runtime recompute must byte-agree).
        const proposal: Record<string, unknown> = {
          schema_version: "guild.team_proposal.v2",
          run_id: "run-gen",
          phase: "build",
          proposal_version: 1,
          parent_proposal_hash: null,
          proposal_hash_algorithm: "sha256",
          proposal_hash_scope: "canonical_yaml_with_proposal_hash_field_omitted",
          participants,
          obligations,
          excluded_roles: [],
        };
        proposal.proposal_hash = selfRefHash(proposal, "proposal_hash");
        const verdict = mod.validateProposal(proposal);
        expect(verdict.valid).toBe(true);
        // Size must NEVER be a rejection reason:
        expect(JSON.stringify(verdict.reasons ?? [])).not.toMatch(/size|cap|too many|limit/i);
      }
    });

    test("FAILING-TODAY: injected truncation (participant dropped, obligation orphaned) INVALIDATES the proposal", () => {
      const mod: any = requireContractModule(PROPOSAL_MODULE, LANE);
      const participants = Array.from({ length: 8 }, (_, i) => ({
        participant_id: `p${i}`,
        participation_kind: "worker",
        role_ref: `role-${i}`,
        necessity_rationale: `needed ${i}`,
        owned_obligations: [`ob${i}`],
        depends_on: [],
        tier: "mid",
        purpose: "implementation",
        capability_scope: null,
        backend: "team",
      }));
      const obligations = participants.map((p, i) => ({
        obligation_id: `ob${i}`,
        source: "success_criterion",
        text: `criterion ${i}`,
        disposition: { owners: [p.participant_id] },
      }));
      // Simulated tail-drop: last participant removed, its obligation orphaned.
      // Frozen fields present + hash stamped, so the ONLY invalidity is the
      // orphaned obligation (the failure is for the intended reason).
      const truncated = participants.slice(0, 7);
      const proposal: Record<string, unknown> = {
        schema_version: "guild.team_proposal.v2",
        run_id: "run-gen",
        phase: "build",
        proposal_version: 1,
        parent_proposal_hash: null,
        proposal_hash_algorithm: "sha256",
        proposal_hash_scope: "canonical_yaml_with_proposal_hash_field_omitted",
        participants: truncated,
        obligations,
        excluded_roles: [],
      };
      proposal.proposal_hash = selfRefHash(proposal, "proposal_hash");
      const verdict = mod.validateProposal(proposal);
      expect(verdict.valid).toBe(false); // unowned obligation => invalid
      expect(JSON.stringify(verdict.reasons)).toMatch(/unowned/i);
    });

    test("[control] reference coverage validator catches the injected truncation (anti-vacuity)", () => {
      const validateCoverage = (
        participants: Array<{ participant_id: string }>,
        obligations: Array<{ obligation_id: string; owners: string[] }>
      ): boolean => {
        const ids = new Set(participants.map((p) => p.participant_id));
        return obligations.every((o) => o.owners.some((owner) => ids.has(owner)));
      };
      const parts = [{ participant_id: "p0" }, { participant_id: "p1" }];
      const obs = [
        { obligation_id: "ob0", owners: ["p0"] },
        { obligation_id: "ob1", owners: ["p1"] },
      ];
      expect(validateCoverage(parts, obs)).toBe(true);
      expect(validateCoverage(parts.slice(0, 1), obs)).toBe(false); // truncation caught
    });
  });
});
