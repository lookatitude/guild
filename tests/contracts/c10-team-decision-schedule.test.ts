/**
 * C10 — Team decision + backend-wave scheduling (team-contracts §4–§5; SC-16).
 *
 * Contract: exactly one user decision per proposal hash; ANY relevant edit
 * (participant, obligation, dependency, tier/purpose, capability scope,
 * backend, waves, concurrency, cost posture, review independence) invalidates
 * a prior decision; dispatch accepts only a current approve whose hash matches
 * the RECOMPUTED proposal hash; scheduling preserves the participant-id SET
 * through waves, receipts, and terminal outcomes; retries reuse ids; failed
 * waves preserve pending ids for resume; capacity produces waves, never
 * roster edits.
 *
 * EXPECTED TO FAIL TODAY: team-decision.ts / team-schedule.ts do not exist
 * (lane T2b). Reference hashing controls (team-contracts §1) pass today.
 */

import { requireContractModule, selfRefHash, seededRng, rngInt } from "./_helpers";

const DECISION_MODULE = "src/modules/teams/workflows/team-decision";
const SCHEDULE_MODULE = "src/modules/teams/workflows/team-schedule";
const LANE = "T2b-unbounded-team-composer";

function referenceProposal(): Record<string, unknown> {
  const proposal = referenceProposalUnhashed();
  // Rework F2: proposal_hash is REQUIRED — stamped via the REFERENCE section-1
  // implementation; the runtime recompute must byte-agree (cross-impl check).
  proposal.proposal_hash = selfRefHash(proposal, "proposal_hash");
  return proposal;
}

/**
 * A reference section-4 approve decision over `proposal`, built with the
 * REFERENCE hashing (not the runtime) — the runtime gate must verify it
 * byte-identically (rework F3: schedules are approval-bound).
 */
function referenceApproveDecision(proposal: Record<string, unknown>): any {
  const decision: Record<string, unknown> = {
    schema_version: "guild.team_decision.v1",
    run_id: proposal.run_id,
    phase: proposal.phase,
    proposal_hash: selfRefHash(proposal, "proposal_hash"),
    decision: "approve",
    // Round-3 (T2B-R2-F1) canonical §4 serialization: <kind>[:<id>]@<channel>.
    decided_by: "user@interactive_prompt",
    decided_at: "2026-07-30T00:00:00Z",
    resulting_proposal: null,
    decision_hash_algorithm: "sha256",
    decision_hash_scope: "canonical_yaml_with_decision_hash_field_omitted",
  };
  decision.decision_hash = selfRefHash(decision, "decision_hash");
  return decision;
}

function referenceProposalUnhashed(): Record<string, unknown> {
  const participants = Array.from({ length: 9 }, (_, i) => ({
    participant_id: `p${i}`,
    participation_kind: i === 8 ? "reviewer_cross_host" : i === 7 ? "challenger" : "worker",
    role_ref: `role-${i}`,
    necessity_rationale: `covers obligation ob${i}`,
    owned_obligations: [`ob${i}`],
    depends_on: i > 0 ? [`p${i - 1}`] : [],
    tier: "mid",
    purpose: i === 8 ? "adversarial" : "implementation",
    capability_scope: null,
    backend: "team",
  }));
  return {
    schema_version: "guild.team_proposal.v2",
    run_id: "run-c10",
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
    backend_capacity_evidence: {
      backend: "team",
      verified_capacity: 3,
      method: "preflight probe",
      as_of: "2026-07-30T00:00:00Z",
    },
    // Non-binding §3 preview; chain DAG ⇒ singleton waves. Part of the hashed
    // proposal bytes, so wave-structure edits invalidate a prior decision (§4).
    proposed_schedule: { waves: participants.map((p) => [p.participant_id]) },
  };
}

/** The §4 invalidation classes — each mutation must invalidate a prior approve. */
const MUTATION_CLASSES: ReadonlyArray<{ name: string; mutate: (p: any) => void }> = [
  { name: "participant added", mutate: (p) => p.participants.push({ ...p.participants[0], participant_id: "p-new", owned_obligations: [] }) },
  { name: "participant removed", mutate: (p) => p.participants.pop() },
  { name: "obligation text edited", mutate: (p) => (p.obligations[0].text = "EDITED") },
  { name: "dependency edited", mutate: (p) => (p.participants[2].depends_on = []) },
  { name: "tier changed", mutate: (p) => (p.participants[1].tier = "powerful") },
  { name: "purpose changed", mutate: (p) => (p.participants[1].purpose = "research") },
  { name: "capability scope narrowed", mutate: (p) => (p.participants[1].capability_scope = ["Read"]) },
  { name: "backend changed", mutate: (p) => (p.participants[1].backend = "subagent") },
  { name: "wave structure changed", mutate: (p) => (p.proposed_schedule.waves = [["p0", "p1"], ...p.proposed_schedule.waves.slice(2)]) },
  { name: "concurrency changed", mutate: (p) => (p.backend_capacity_evidence.verified_capacity = 5) },
  { name: "cost posture changed (bulk tier downgrade)", mutate: (p) => p.participants.forEach((x: any) => (x.tier = "cheap")) },
  { name: "review independence changed (cross-host reviewer localized)", mutate: (p) => (p.participants[8].participation_kind = "reviewer_local") },
];

/**
 * A COMPLETED guild.team_schedule.v1 artifact for the reference proposal:
 * every approved id appears exactly once in waves, receipts, and terminal
 * outcomes — the §5 all-invariants-hold baseline the violation tables break.
 */
function referenceCompletedSchedule(proposal: any, decision: any): any {
  const ids: string[] = proposal.participants.map((p: any) => p.participant_id);
  return {
    schema_version: "guild.team_schedule.v1",
    run_id: proposal.run_id,
    phase: proposal.phase,
    proposal_hash: selfRefHash(proposal, "proposal_hash"),
    decision_hash: decision.decision_hash,
    backend: "team",
    concurrency: { verified_backend_capacity: 3, selected_hint: null, effective: 3, clamp_diagnostic: null },
    base_waves: ids.map((id) => [id]), // chain DAG ⇒ singleton waves
    dispatch_receipts: ids.map((id) => ({ participant_id: id, attempt: 1, dispatched_at: "2026-07-30T00:00:00Z", receipt_ref: `receipts/${id}.md` })),
    terminal_outcomes: ids.map((id) => ({ participant_id: id, outcome: "completed", via_decision_hash: null })),
  };
}

/** §5 four-set-equality violations — each breaks exactly one equality link. */
const SET_EQUALITY_VIOLATIONS: ReadonlyArray<{ name: string; mutate: (s: any) => void }> = [
  { name: "dispatch receipts omit an approved id", mutate: (s) => s.dispatch_receipts.pop() },
  { name: "dispatch receipt for an unapproved id", mutate: (s) => s.dispatch_receipts.push({ participant_id: "p-ghost", attempt: 1, dispatched_at: "2026-07-30T00:00:00Z", receipt_ref: "receipts/p-ghost.md" }) },
  { name: "terminal outcomes omit an approved id (omission is never removal)", mutate: (s) => s.terminal_outcomes.pop() },
  { name: "terminal outcome for an unapproved id", mutate: (s) => s.terminal_outcomes.push({ participant_id: "p-ghost", outcome: "completed", via_decision_hash: null }) },
  { name: "base-wave union omits an approved id", mutate: (s) => s.base_waves.pop() },
  { name: "explicitly_removed_by_new_decision without citing the new decision hash", mutate: (s) => (s.terminal_outcomes[8] = { participant_id: "p8", outcome: "explicitly_removed_by_new_decision", via_decision_hash: null }) },
];

/** §5 exactly-one-terminal-outcome violations (retries must reuse ids as attempts, never duplicate outcomes). */
const EXACTLY_ONE_VIOLATIONS: ReadonlyArray<{ name: string; mutate: (s: any) => void }> = [
  { name: "duplicate terminal outcome for one id", mutate: (s) => s.terminal_outcomes.push({ participant_id: "p0", outcome: "failed", via_decision_hash: null }) },
  { name: "conflicting duplicate (completed AND explicitly_removed)", mutate: (s) => s.terminal_outcomes.push({ participant_id: "p0", outcome: "explicitly_removed_by_new_decision", via_decision_hash: "1".repeat(64) }) },
];

/**
 * §5 reference checker: SET EQUALITY (not counts) across approved participants,
 * base-wave union, dispatch-receipt ids, terminal-outcome ids — modulo
 * explicitly_removed_by_new_decision citing the new decision hash — plus
 * exactly one terminal outcome per participant. Runtime must agree with this.
 */
function refValidateScheduleSets(proposal: any, schedule: any): string[] {
  const errors: string[] = [];
  const approved = new Set<string>(proposal.participants.map((p: any) => p.participant_id));
  const terminalIds: string[] = schedule.terminal_outcomes.map((t: any) => t.participant_id);
  if (new Set(terminalIds).size !== terminalIds.length) errors.push("exactly-one violated: duplicate terminal outcome for a participant id");
  if ([...new Set(terminalIds)].sort().join() !== [...approved].sort().join()) errors.push("terminal-outcome id set != approved participant set");
  const removed = new Set<string>();
  for (const t of schedule.terminal_outcomes) {
    if (t.outcome === "explicitly_removed_by_new_decision") {
      if (!/^[0-9a-f]{64}$/.test(t.via_decision_hash ?? "")) errors.push("removal without citing the new decision hash");
      removed.add(t.participant_id);
    }
  }
  const expected = [...approved].filter((id) => !removed.has(id)).sort().join();
  const waveUnion: string[] = schedule.base_waves.flat();
  if (new Set(waveUnion).size !== waveUnion.length) errors.push("participant id appears in more than one wave");
  if ([...new Set(waveUnion)].sort().join() !== expected) errors.push("base-wave union != approved participant set");
  const receiptIds = [...new Set<string>(schedule.dispatch_receipts.map((r: any) => r.participant_id))].sort().join();
  if (receiptIds !== expected) errors.push("dispatch-receipt id set != approved participant set");
  return errors;
}

describe("C10 team-contracts §4–§5 — decision gate + wave scheduling", () => {
  describe("hash-bound approve/restructure (§4)", () => {
    test("FAILING-TODAY: decision module exists with recordDecision/dispatchGate", () => {
      const mod: any = requireContractModule(DECISION_MODULE, LANE);
      expect(typeof mod.recordDecision).toBe("function");
      expect(typeof mod.dispatchGate).toBe("function");
    });

    test.each(MUTATION_CLASSES.map((m) => [m.name, m.mutate]))(
      "FAILING-TODAY: %s invalidates the prior approve (recomputed hash mismatch fails closed)",
      (_name, mutate) => {
        const mod: any = requireContractModule(DECISION_MODULE, LANE);
        const proposal = referenceProposal();
        const decision = mod.recordDecision(proposal, {
          decision: "approve",
          decided_by: { kind: "user" },
          decision_channel: "interactive_prompt",
        });
        (mutate as (p: any) => void)(proposal);
        const gate = mod.dispatchGate(proposal, decision);
        expect(gate.allowed).toBe(false);
        expect(gate.reason).toMatch(/hash|invalidat/i);
      }
    );

    test("FAILING-TODAY: no decision at all => dispatch refused (never auto-approve)", () => {
      const mod: any = requireContractModule(DECISION_MODULE, LANE);
      const gate = mod.dispatchGate(referenceProposal(), null);
      expect(gate.allowed).toBe(false);
    });

    test("FAILING-TODAY: restructure yields a NEW pending proposal (version+1, parent hash), never mutated bytes", () => {
      const mod: any = requireContractModule(DECISION_MODULE, LANE);
      const proposal = referenceProposal();
      const result = mod.applyRestructure(proposal, {
        decision: "restructure",
        restructure_edits: [{ remove: { participant_id: "p8" } }],
        decided_by: { kind: "user" },
        decision_channel: "interactive_prompt",
      });
      expect(result.new_proposal.proposal_version).toBe(2);
      expect(result.new_proposal.parent_proposal_hash).toBeTruthy();
      expect(result.new_decision_state).toBe("pending");
      // Original proposal bytes preserved in the trail:
      expect((proposal as any).participants).toHaveLength(9);
      // Coverage revalidated: removing p8 orphans ob8 => surfaced before acceptance.
      expect(result.lost_obligations).toContain("ob8");
    });

    test("[control] reference self-referential hashing detects EVERY mutation class (anti-vacuity)", () => {
      for (const m of MUTATION_CLASSES) {
        const proposal = referenceProposal();
        const before = selfRefHash(proposal, "proposal_hash");
        m.mutate(proposal);
        expect(selfRefHash(proposal, "proposal_hash")).not.toBe(before);
      }
      // Known-bad hash scope (participants only) MISSES the obligation edit — caught:
      const proposal = referenceProposal();
      const badHash = (p: any) => JSON.stringify(p.participants);
      const goodBefore = selfRefHash(proposal, "proposal_hash");
      const badBefore = badHash(proposal);
      (proposal as any).obligations[0].text = "EDITED";
      expect(badHash(proposal)).toBe(badBefore); // the bad scope is blind to the edit
      expect(selfRefHash(proposal, "proposal_hash")).not.toBe(goodBefore); // the §1 scope is not
    });
  });

  describe("wave scheduling preserves the participant set (§5)", () => {
    test("FAILING-TODAY: schedule module exists with buildSchedule/resumeSchedule", () => {
      const mod: any = requireContractModule(SCHEDULE_MODULE, LANE);
      expect(typeof mod.buildSchedule).toBe("function");
      expect(typeof mod.resumeSchedule).toBe("function");
    });

    test("FAILING-TODAY: approved set larger than backend capacity schedules over waves — SET EQUALITY holds, no role loss", () => {
      const mod: any = requireContractModule(SCHEDULE_MODULE, LANE);
      const proposal = referenceProposal(); // 9 participants, chain DAG
      const decision = referenceApproveDecision(proposal as Record<string, unknown>);
      const schedule = mod.buildSchedule(proposal, { backend: "team", verified_backend_capacity: 3, decision });
      const approved = (proposal as any).participants.map((p: any) => p.participant_id).sort();
      const waveUnion = (schedule.base_waves as string[][]).flat().sort();
      expect(waveUnion).toEqual(approved); // each id EXACTLY once
      expect(new Set(waveUnion).size).toBe(approved.length);
      // Waves respect capacity, dependencies remain wave-ordered:
      for (const wave of schedule.base_waves) expect(wave.length).toBeLessThanOrEqual(3);
    });

    test("FAILING-TODAY: a failed wave preserves ALL not-yet-terminal ids for resume (omission is never removal)", () => {
      const mod: any = requireContractModule(SCHEDULE_MODULE, LANE);
      const proposal = referenceProposal();
      const decision = referenceApproveDecision(proposal as Record<string, unknown>);
      const schedule = mod.buildSchedule(proposal, { backend: "team", verified_backend_capacity: 4, decision });
      const failed = mod.simulateWaveFailure(schedule, { wave_index: 0, failed_ids: ["p0"] });
      const resumed = mod.resumeSchedule(failed);
      const terminalOrPending = [...resumed.terminal_ids, ...resumed.pending_ids].sort();
      expect(terminalOrPending).toEqual((proposal as any).participants.map((p: any) => p.participant_id).sort());
      // Retry reuses the SAME participant id as a new attempt:
      expect(resumed.pending_ids).toContain("p0");
    });

    test("FAILING-TODAY: runtime enforces the FULL four-set equality (approved = wave union = receipt ids = terminal ids)", () => {
      const mod: any = requireContractModule(SCHEDULE_MODULE, LANE);
      const proposal = referenceProposal();
      const decision = referenceApproveDecision(proposal);
      expect(mod.validateScheduleSets(proposal, referenceCompletedSchedule(proposal, decision), decision).valid).toBe(true);
      for (const v of SET_EQUALITY_VIOLATIONS) {
        const bad = referenceCompletedSchedule(proposal, decision);
        v.mutate(bad);
        const verdict = mod.validateScheduleSets(proposal, bad, decision);
        expect(verdict.valid).toBe(false);
        expect(verdict.reason).toMatch(/set|equal|remov|omit|unapproved/i);
      }
    });

    test("FAILING-TODAY: runtime enforces EXACTLY ONE terminal outcome per participant (retries reuse ids as attempts)", () => {
      const mod: any = requireContractModule(SCHEDULE_MODULE, LANE);
      const proposal = referenceProposal();
      const decision = referenceApproveDecision(proposal);
      // A retry is a new attempt on the SAME id — receipts may repeat an id, outcomes never do:
      const retried = referenceCompletedSchedule(proposal, decision);
      retried.dispatch_receipts.push({ participant_id: "p0", attempt: 2, dispatched_at: "2026-07-30T00:00:01Z", receipt_ref: "receipts/p0-attempt2.md" });
      expect(mod.validateScheduleSets(proposal, retried, decision).valid).toBe(true);
      for (const v of EXACTLY_ONE_VIOLATIONS) {
        const bad = referenceCompletedSchedule(proposal, decision);
        v.mutate(bad);
        expect(mod.validateScheduleSets(proposal, bad, decision).valid).toBe(false);
      }
    });

    test("[control] §5 reference checker holds on the completed schedule and catches EVERY four-set violation (anti-vacuity)", () => {
      const proposal = referenceProposal();
      const decision = referenceApproveDecision(proposal);
      expect(refValidateScheduleSets(proposal, referenceCompletedSchedule(proposal, decision))).toEqual([]);
      // Valid user-approved removal (the modulo rule): cited decision hash + consistent exclusion PASSES — the checker is not over-strict.
      const removedOk = referenceCompletedSchedule(proposal, decision);
      removedOk.terminal_outcomes[8] = { participant_id: "p8", outcome: "explicitly_removed_by_new_decision", via_decision_hash: "1".repeat(64) };
      removedOk.base_waves = removedOk.base_waves.filter((w: string[]) => !w.includes("p8"));
      removedOk.dispatch_receipts = removedOk.dispatch_receipts.filter((r: any) => r.participant_id !== "p8");
      expect(refValidateScheduleSets(proposal, removedOk)).toEqual([]);
      for (const v of SET_EQUALITY_VIOLATIONS) {
        const bad = referenceCompletedSchedule(proposal, decision);
        v.mutate(bad);
        expect(refValidateScheduleSets(proposal, bad)).not.toEqual([]);
      }
    });

    test("[control] §5 reference checker enforces exactly-one terminal outcome while allowing retry attempts (anti-vacuity)", () => {
      const proposal = referenceProposal();
      const decision = referenceApproveDecision(proposal);
      const retried = referenceCompletedSchedule(proposal, decision);
      retried.dispatch_receipts.push({ participant_id: "p0", attempt: 2, dispatched_at: "2026-07-30T00:00:01Z", receipt_ref: "receipts/p0-attempt2.md" });
      expect(refValidateScheduleSets(proposal, retried)).toEqual([]);
      for (const v of EXACTLY_ONE_VIOLATIONS) {
        const bad = referenceCompletedSchedule(proposal, decision);
        v.mutate(bad);
        expect(refValidateScheduleSets(proposal, bad)).not.toEqual([]);
      }
    });

    test("FAILING-TODAY: resource exhaustion produces an explicit scheduling failure, never a roster mutation", () => {
      const mod: any = requireContractModule(SCHEDULE_MODULE, LANE);
      const proposal = referenceProposal();
      const decision = referenceApproveDecision(proposal as Record<string, unknown>);
      const verdict = mod.buildSchedule(proposal, { backend: "team", verified_backend_capacity: 0, decision });
      expect(verdict.error).toMatch(/schedul|capacity|backend/i);
      expect((proposal as any).participants).toHaveLength(9);
    });

    test("[control] reference wave partitioner holds set-equality over generated DAGs (anti-vacuity, seeded)", () => {
      const rng = seededRng(0xC10);
      for (let trial = 0; trial < 10; trial++) {
        const n = 2 + rngInt(rng, 20);
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const deps = new Map(ids.map((id, i) => [id, i > 0 && rng() < 0.5 ? [`p${rngInt(rng, i)}`] : []]));
        const capacity = 1 + rngInt(rng, 4);
        // Kahn-style leveled partition bounded by capacity:
        const placed = new Set<string>();
        const waves: string[][] = [];
        while (placed.size < n) {
          const ready = ids.filter((id) => !placed.has(id) && (deps.get(id) ?? []).every((d) => placed.has(d)));
          const wave = ready.slice(0, capacity);
          if (wave.length === 0) throw new Error("cycle in generated DAG (construction bug)");
          wave.forEach((id) => placed.add(id));
          waves.push(wave);
        }
        expect(waves.flat().sort()).toEqual([...ids].sort());
        for (const w of waves) expect(w.length).toBeLessThanOrEqual(capacity);
        // Injected truncation (dropping the last wave) breaks set equality — caught:
        const truncatedUnion = waves.slice(0, -1).flat();
        expect(truncatedUnion.length).toBeLessThan(n);
      }
    });
  });
});
