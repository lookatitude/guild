/**
 * C13 — Approval-gate fail-closed probes (rework rounds 2–3; T2B-R1-F2..F5 +
 * T2B-R2-F1).
 *
 * The G-lane review LIVE-PROBED the round-1 runtime and found the approval
 * chain failing OPEN. Each reviewer probe is reproduced here verbatim as a
 * permanent regression test; each must now FAIL CLOSED:
 *
 *  - F2 empty-proposal gate probe: validateProposal accepted a proposal
 *    omitting every frozen field; recordDecision({}, {decided_by: "agent"})
 *    then dispatchGate({}, decision) returned allowed:true with empty
 *    run_id/phase.
 *  - F3 tampered-hash schedule probe: a completed schedule with proposal_hash
 *    set to 64 zeroes and decision_hash left null still validated.
 *  - F4 overwrite probe: a second schedule write silently replaced the earlier
 *    scheduled/receipt/outcome state at the fixed <phase>.schedule.yaml path.
 *  - F5 legacy fail-open probe: allow_larger: "yes" was accepted as a no-op;
 *    roster: [{role: "qa"}] imported as a pending proposal with undefined
 *    tier/source.
 *  - T2B-R2-F1 (round 3): the round-2 user-actor boundary was an exact-token
 *    DENYLIST — the round-2 review live-probed recordDecision accepting
 *    decided_by "agent7", "claude3", "worker", "reviewer", "openai" (any
 *    unlisted agent identity). Inverted to a structural ALLOWLIST: decided_by
 *    is a typed actor {kind ∈ {user, operator}, id?} + a closed-enum
 *    decision_channel provenance, serialized as <kind>[:<id>]@<channel> into
 *    the frozen §4 string; bare strings, unknown kinds, and absent provenance
 *    all reject.
 */

import * as fs from "fs";
import * as path from "path";

import { requireContractModule, mkTmpWorkspace, selfRefHash } from "./_helpers";

const PROPOSAL_MODULE = "src/modules/teams/workflows/team-proposal";
const DECISION_MODULE = "src/modules/teams/workflows/team-decision";
const SCHEDULE_MODULE = "src/modules/teams/workflows/team-schedule";
const COMPAT_MODULE = "src/modules/teams/workflows/team-plan-compat";
const SIGNALS_MODULE = "src/modules/teams/workflows/station-signals";
const LANE = "T2b-unbounded-team-composer";

const proposalMod: any = requireContractModule(PROPOSAL_MODULE, LANE);
const decisionMod: any = requireContractModule(DECISION_MODULE, LANE);
const scheduleMod: any = requireContractModule(SCHEDULE_MODULE, LANE);
const compatMod: any = requireContractModule(COMPAT_MODULE, LANE);
const signalsMod: any = requireContractModule(SIGNALS_MODULE, LANE);

const FROZEN_FIELDS = [
  "proposal_version",
  "parent_proposal_hash",
  "proposal_hash_algorithm",
  "proposal_hash_scope",
  "proposal_hash",
] as const;

/** A complete, valid guild.team_proposal.v2 (hash stamped via the REFERENCE impl). */
function completeProposal(): Record<string, unknown> {
  const participants = Array.from({ length: 3 }, (_, i) => ({
    participant_id: `p${i}`,
    participation_kind: "worker",
    role_ref: `role-${i}`,
    necessity_rationale: `covers obligation ob${i}`,
    owned_obligations: [`ob${i}`],
    depends_on: i > 0 ? [`p${i - 1}`] : [],
    tier: "mid",
    purpose: "implementation",
    capability_scope: null,
    backend: "team",
  }));
  const proposal: Record<string, unknown> = {
    schema_version: "guild.team_proposal.v2",
    run_id: "run-c13-probes",
    phase: "build",
    proposal_version: 1,
    parent_proposal_hash: null,
    proposal_hash_algorithm: "sha256",
    proposal_hash_scope: "canonical_yaml_with_proposal_hash_field_omitted",
    participants,
    obligations: participants.map((p, i) => ({
      obligation_id: `ob${i}`,
      source: "plan_item",
      text: `item ${i}`,
      disposition: { owners: [p.participant_id] },
    })),
    excluded_roles: [],
  };
  proposal.proposal_hash = selfRefHash(proposal, "proposal_hash");
  return proposal;
}

function approveDecision(proposal: Record<string, unknown>): any {
  return decisionMod.recordDecision(proposal, {
    decision: "approve",
    decided_by: { kind: "operator", id: "miguel" },
    decision_channel: "terminal_prompt",
    decided_at: "2026-07-30T00:00:00Z",
  });
}

/** A COMPLETED schedule for the proposal (every id waved/receipted/terminal). */
function completedSchedule(proposal: any, decision: any): any {
  const ids: string[] = proposal.participants.map((p: any) => p.participant_id);
  return {
    schema_version: "guild.team_schedule.v1",
    run_id: proposal.run_id,
    phase: proposal.phase,
    proposal_hash: selfRefHash(proposal, "proposal_hash"),
    decision_hash: decision.decision_hash,
    backend: "team",
    concurrency: { verified_backend_capacity: 3, selected_hint: null, effective: 3, clamp_diagnostic: null },
    base_waves: ids.map((id) => [id]),
    dispatch_receipts: ids.map((id) => ({
      participant_id: id,
      attempt: 1,
      dispatched_at: "2026-07-30T00:00:00Z",
      receipt_ref: `receipts/${id}.md`,
    })),
    terminal_outcomes: ids.map((id) => ({ participant_id: id, outcome: "completed", via_decision_hash: null })),
  };
}

describe("C13 — approval gate fails closed (reviewer probes as regressions)", () => {
  describe("F2: empty-proposal gate probe", () => {
    test("probe: a proposal omitting EVERY frozen field is rejected, naming each missing field", () => {
      const bare = {
        schema_version: "guild.team_proposal.v2",
        run_id: "run-bare",
        phase: "build",
        participants: [],
        obligations: [],
        excluded_roles: [],
      };
      const verdict = proposalMod.validateProposal(bare);
      expect(verdict.valid).toBe(false);
      const joined = verdict.reasons.join("\n");
      for (const field of FROZEN_FIELDS) {
        expect(joined).toMatch(new RegExp(field));
      }
    });

    test('probe: recordDecision({}, {decision: "approve", decided_by: "agent"}) THROWS (never records)', () => {
      expect(() =>
        decisionMod.recordDecision({}, { decision: "approve", decided_by: "agent" })
      ).toThrow(/invalid|refusing/i);
    });

    test("probe: dispatchGate({}, <valid decision>) is REFUSED — empty run_id/phase fail closed", () => {
      const decision = approveDecision(completeProposal());
      const gate = decisionMod.dispatchGate({}, decision);
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toMatch(/fails closed|refused|invalid/i);
    });

    test("probe: an agent-side actor can never decide, even over a fully valid proposal", () => {
      const proposal = completeProposal();
      for (const actor of ["agent", "claude-orchestrator", "codex-bot", "auto", "subagent-7"]) {
        expect(() =>
          decisionMod.recordDecision(proposal, { decision: "approve", decided_by: actor })
        ).toThrow(/user|agent/i);
      }
      // A recorded USER decision whose decided_by is later swapped to an agent
      // identity is invalid on BOTH counts (actor boundary + hash mismatch):
      const tampered = { ...approveDecision(proposal), decided_by: "agent" };
      const verdict = decisionMod.validateDecision(tampered);
      expect(verdict.valid).toBe(false);
      expect(verdict.reasons.join("\n")).toMatch(/user|agent/i);
    });
  });

  describe("T2B-R2-F1: decided_by is a structural ALLOWLIST (round-3 rework)", () => {
    // The exact identities the round-2 review used to bypass the denylist,
    // plus the codex-lane probe — every one must now be REJECTED at
    // recordDecision (bare strings are never actors):
    const ROUND2_BYPASS_IDENTITIES = [
      "agent7",
      "claude3",
      "worker",
      "reviewer",
      "openai",
      "codex-lane",
    ] as const;

    test("probe: every round-2 denylist-bypass identity is rejected by recordDecision", () => {
      const proposal = completeProposal();
      for (const actor of ROUND2_BYPASS_IDENTITIES) {
        expect(() =>
          decisionMod.recordDecision(proposal, { decision: "approve", decided_by: actor })
        ).toThrow(/user|allowlist/i);
      }
    });

    test("probe: every round-2 bypass identity persisted as decided_by fails validateDecision even with a RE-STAMPED hash", () => {
      const proposal = completeProposal();
      for (const actor of ROUND2_BYPASS_IDENTITIES) {
        const spoofed: Record<string, unknown> = {
          ...approveDecision(proposal),
          decided_by: actor,
        };
        // The spoofer re-hashes the artifact so the §1 hash is self-consistent —
        // the actor boundary alone must still reject it:
        delete spoofed["decision_hash"];
        spoofed["decision_hash"] = selfRefHash(spoofed, "decision_hash");
        const verdict = decisionMod.validateDecision(spoofed);
        expect(verdict.valid).toBe(false);
        expect(verdict.reasons.join("\n")).toMatch(/allowlist|user\/operator/i);
      }
    });

    test("negative: typed-object spoofs — unknown kinds, extra keys, bad ids — are rejected", () => {
      const proposal = completeProposal();
      const spoofActors = [
        { kind: "agent" },
        { kind: "codex", id: "lane" },
        { kind: "assistant" },
        { kind: "orchestrator", id: "claude" },
        { kind: "user", role: "admin" }, // unknown key — actor shape is closed
        { kind: "operator", id: "Miguel!" }, // id outside the allowed shape
        {},
        null,
        42,
        ["user"],
      ];
      for (const actor of spoofActors) {
        expect(() =>
          decisionMod.recordDecision(proposal, {
            decision: "approve",
            decided_by: actor,
            decision_channel: "interactive_prompt",
          })
        ).toThrow(/allowlist|actor/i);
      }
    });

    test("negative: absent or unknown decision_channel provenance rejects even a valid user actor", () => {
      const proposal = completeProposal();
      for (const channel of [undefined, "", "slack", "auto_approve", "AGENT"]) {
        expect(() =>
          decisionMod.recordDecision(proposal, {
            decision: "approve",
            decided_by: { kind: "user" },
            decision_channel: channel,
          })
        ).toThrow(/decision_channel|provenance/i);
      }
    });

    test("negative: pre-round-3 string forms (\"user\", \"operator:miguel\") no longer validate as persisted decided_by", () => {
      const proposal = completeProposal();
      for (const legacy of ["user", "operator:miguel", "cli-approval", "user@slack", "user@interactive_prompt@x"]) {
        const spoofed: Record<string, unknown> = {
          ...approveDecision(proposal),
          decided_by: legacy,
        };
        delete spoofed["decision_hash"];
        spoofed["decision_hash"] = selfRefHash(spoofed, "decision_hash");
        expect(decisionMod.validateDecision(spoofed).valid).toBe(false);
      }
    });

    test("positive: every allowed {kind}×{channel} actor records, serializes canonically, validates, and passes the dispatch gate", () => {
      const cases: Array<{ actor: any; channel: string; serialized: string }> = [
        { actor: { kind: "user" }, channel: "interactive_prompt", serialized: "user@interactive_prompt" },
        { actor: { kind: "user" }, channel: "file_gate", serialized: "user@file_gate" },
        { actor: { kind: "operator", id: "miguel" }, channel: "terminal_prompt", serialized: "operator:miguel@terminal_prompt" },
        { actor: { kind: "operator" }, channel: "interactive_prompt", serialized: "operator@interactive_prompt" },
      ];
      for (const c of cases) {
        const proposal = completeProposal();
        const decision = decisionMod.recordDecision(proposal, {
          decision: "approve",
          decided_by: c.actor,
          decision_channel: c.channel,
          decided_at: "2026-07-30T00:00:00Z",
        });
        expect(decision.decided_by).toBe(c.serialized);
        expect(decisionMod.validateDecision(decision).valid).toBe(true);
        expect(decisionMod.dispatchGate(proposal, decision).allowed).toBe(true);
      }
    });

    test("probe: a tampered embedded proposal_hash is caught by recomputation", () => {
      const proposal = completeProposal();
      proposal.proposal_hash = "0".repeat(64);
      const verdict = proposalMod.validateProposal(proposal);
      expect(verdict.valid).toBe(false);
      expect(verdict.reasons.join("\n")).toMatch(/mismatch/i);
    });
  });

  describe("F3: tampered-hash schedule probe", () => {
    test("probe: proposal_hash = 64 zeroes on a completed schedule fails validateScheduleSets", () => {
      const proposal = completeProposal();
      const decision = approveDecision(proposal);
      const tampered = { ...completedSchedule(proposal, decision), proposal_hash: "0".repeat(64) };
      const verdict = scheduleMod.validateScheduleSets(proposal, tampered, decision);
      expect(verdict.valid).toBe(false);
      expect(verdict.reason).toMatch(/hash|bound|fails closed/i);
    });

    test("probe: decision_hash left null fails validateScheduleSets", () => {
      const proposal = completeProposal();
      const decision = approveDecision(proposal);
      const nullBound = { ...completedSchedule(proposal, decision), decision_hash: null };
      const verdict = scheduleMod.validateScheduleSets(proposal, nullBound, decision);
      expect(verdict.valid).toBe(false);
      expect(verdict.reason).toMatch(/decision_hash|approval-bound|fails closed/i);
    });

    test("probe: buildSchedule REQUIRES a current approve decision (missing/tampered => throw)", () => {
      const proposal = completeProposal();
      expect(() =>
        scheduleMod.buildSchedule(proposal, { backend: "team", verified_backend_capacity: 3, decision: null })
      ).toThrow(/decision|approve/i);
      const tampered = { ...approveDecision(proposal), decision_hash: "0".repeat(64) };
      expect(() =>
        scheduleMod.buildSchedule(proposal, { backend: "team", verified_backend_capacity: 3, decision: tampered })
      ).toThrow(/decision|approve|hash/i);
    });

    test("built schedules carry BOTH chain bindings, non-null", () => {
      const proposal = completeProposal();
      const decision = approveDecision(proposal);
      const schedule = scheduleMod.buildSchedule(proposal, {
        backend: "team",
        verified_backend_capacity: 3,
        decision,
      });
      expect(schedule.proposal_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(schedule.decision_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(schedule.proposal_hash).toBe(selfRefHash(proposal, "proposal_hash"));
      expect(schedule.decision_hash).toBe(decision.decision_hash);
    });
  });

  describe("F4: overwrite probe (immutable, versioned/content-addressed persistence)", () => {
    test("probe: a second write of the SAME schedule state refuses to overwrite; a state transition creates a NEW artifact and preserves the prior bytes", () => {
      const root = mkTmpWorkspace("guild-c13-");
      const proposal = completeProposal();
      const decision = approveDecision(proposal);
      const schedule = completedSchedule(proposal, decision);

      const p1 = scheduleMod.writeSchedule(root, schedule);
      const bytes1 = fs.readFileSync(p1, "utf8");
      expect(path.basename(p1)).not.toBe("build.schedule.yaml"); // not the round-1 fixed path

      // Same state twice => same content address => immutable refusal, bytes intact.
      expect(() => scheduleMod.writeSchedule(root, schedule)).toThrow(/immutable|exists/i);
      expect(fs.readFileSync(p1, "utf8")).toBe(bytes1);

      // A state transition (retry receipt recorded) is a NEW artifact file:
      const next = JSON.parse(JSON.stringify(schedule));
      next.dispatch_receipts.push({
        participant_id: "p0",
        attempt: 2,
        dispatched_at: "2026-07-30T00:00:01Z",
        receipt_ref: "receipts/p0-attempt2.md",
      });
      const p2 = scheduleMod.writeSchedule(root, next);
      expect(p2).not.toBe(p1);
      expect(fs.existsSync(p1)).toBe(true);
      expect(fs.existsSync(p2)).toBe(true);
      // The full audit trail is preserved — the earlier artifact is byte-identical:
      expect(fs.readFileSync(p1, "utf8")).toBe(bytes1);
    });

    test("probe: writeRunArtifact with immutable:true refuses to replace existing bytes", () => {
      const root = mkTmpWorkspace("guild-c13-");
      const proposal = completeProposal();
      const decision = approveDecision(proposal);
      const schedule = completedSchedule(proposal, decision);
      const p1 = scheduleMod.writeSchedule(root, schedule);
      const bytes1 = fs.readFileSync(p1, "utf8");
      expect(() =>
        signalsMod.writeRunArtifact(root, schedule.run_id, "team-result", path.basename(p1), "TAMPERED", {
          immutable: true,
        })
      ).toThrow(/immutable|exists/i);
      expect(fs.readFileSync(p1, "utf8")).toBe(bytes1);
    });

    test("proposal and decision persistence are immutable too (new version = new file)", () => {
      const root = mkTmpWorkspace("guild-c13-");
      const proposal = completeProposal();
      const decision = approveDecision(proposal);
      const pp = proposalMod.writeProposal(root, proposal);
      expect(() => proposalMod.writeProposal(root, proposal)).toThrow(/immutable|exists/i);
      const dp = decisionMod.writeDecision(root, decision);
      expect(() => decisionMod.writeDecision(root, decision)).toThrow(/immutable|exists/i);
      expect(fs.existsSync(pp)).toBe(true);
      expect(fs.existsSync(dp)).toBe(true);
    });
  });

  describe("F5: legacy inputs fail closed", () => {
    test('probe: allow_larger: "yes" (and every non-boolean shape) is REJECTED with the contract diagnostic', () => {
      for (const bad of ["yes", "true", 1, 0, [], {}]) {
        expect(() =>
          compatMod.resolveConcurrencyHint({ allow_larger: bad, verified_backend_capacity: 4 })
        ).toThrow(/rejected.*allow_larger|allow_larger.*rejected/is);
      }
    });

    test("[control] boolean allow_larger IS the warned no-op (either boolean; roster/waves untouched)", () => {
      for (const ok of [true, false]) {
        const hint = compatMod.resolveConcurrencyHint({ allow_larger: ok, verified_backend_capacity: 4 });
        expect(hint.warnings.join("\n")).toMatch(/no-op/i);
        expect(hint.selected_hint).toBeNull();
        expect(hint.effective).toBe(4);
      }
    });

    test("probe: zero/negative/malformed legacy sizes are REJECTED, never coerced", () => {
      for (const bad of [0, -3, 1.5, "4"]) {
        expect(() =>
          compatMod.resolveConcurrencyHint({ cli_team_size: bad, verified_backend_capacity: 4 })
        ).toThrow(/rejected/i);
      }
    });

    test('probe: roster: [{role: "qa"}] is disposition "invalid" with migration guidance — never a manufactured pending proposal', () => {
      const verdict = compatMod.importLegacyTeamPlan({
        schema_version: "guild.team_plan.v1",
        station: "build",
        roster: [{ role: "qa" }],
      });
      expect(verdict.disposition).toBe("invalid");
      expect(verdict.dispatchable).toBe(false);
      expect(verdict.proposal).toBeUndefined();
      expect(verdict.reason).toMatch(/malformed|rejected/i);
      expect(verdict.reason).toMatch(/migration guidance/i);
    });

    test("[control] a WELL-FORMED non-lossy legacy artifact still imports as a PENDING v2 proposal (never an approval)", () => {
      const verdict = compatMod.importLegacyTeamPlan({
        schema_version: "guild.team_plan.v1",
        station: "build",
        roster: [{ role: "qa", scope: null, default_tier: "mid", fanout: "single", source: "default" }],
      });
      expect(verdict.disposition).toBe("pending_proposal");
      expect(verdict.dispatchable).toBe(false);
      expect(verdict.requires_user_approval).toBe(true);
      // The emitted pending proposal passes the FULL v2 validator:
      expect(proposalMod.validateProposal(verdict.proposal).valid).toBe(true);
    });

    test("probe: malformed truncation fields (capped/dropped_roles/cap) are errors, not silent passes", () => {
      for (const patch of [{ capped: "yes" }, { dropped_roles: "qa" }, { cap: 0 }] as Array<Record<string, unknown>>) {
        const verdict = compatMod.importLegacyTeamPlan({
          schema_version: "guild.team_plan.v1",
          station: "build",
          roster: [{ role: "qa", scope: null, default_tier: "mid", fanout: "single", source: "default" }],
          ...patch,
        });
        expect(verdict.disposition).toBe("invalid");
        expect(verdict.reason).toMatch(/malformed|rejected/i);
      }
    });
  });
});
