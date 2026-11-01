/**
 * tests/e00/support/team-authority-fixture.ts — the one temp-root builder for an
 * approved team behind an E00 oracle plan (root Q3, design r12 CD8).
 *
 * Writes, through the EXISTING contracts only: the approved machine plan JSON
 * (work_items[].id/owner give lane membership and the owning role), a
 * guild.team_proposal.v2 whose spec_ref binds that JSON by hash
 * (composeProposal -> writeProposal), and the operator's approve decision for
 * that exact proposal, run and phase (recordDecision -> writeDecision). The
 * oracle plan's approved_plan_ref / team_decision_ref are the returned refs.
 * Callers own the root; nothing here is review, broker or package evidence.
 */
import * as fs from "fs";
import * as path from "path";

import { composeProposal, recordDecision, writeDecision, writeProposal } from "../../../src/domains/teams";
import { sha256 } from "./e00-harness";

export interface AuthorityLane { id: string; role: string; deps?: string[] }

export interface ApprovedTeam {
  approvedPlanRef: { path: string; sha256: string };
  teamDecisionRef: { path: string; sha256: string };
  proposalPath: string;
  decisionPath: string;
  proposal: Record<string, any>;
}

const participantId = (id: string) => id.toLowerCase();

export function writeApprovedTeam(root: string, runId: string, lanes: AuthorityLane[], opts: {
  reviewerId: string;
  /** Root-relative path of the approved plan JSON. */
  planRel: string;
  /** Override the approved work_items (negative fixtures); default one per lane, owner = role. */
  workItems?: Array<{ id: string; owner: string }>;
}): ApprovedTeam {
  fs.mkdirSync(path.dirname(path.join(root, opts.planRel)), { recursive: true });
  const workItems = opts.workItems ?? lanes.map((l) => ({ id: l.id, owner: l.role, depends_on: l.deps ?? [] }));
  fs.writeFileSync(path.join(root, opts.planRel), JSON.stringify({ schema_version: "guild.e00_approved_plan.v1", run_id: runId, work_items: workItems }, null, 2) + "\n");
  const approvedPlanRef = { path: opts.planRel, sha256: sha256(fs.readFileSync(path.join(root, opts.planRel))) };

  const workers = lanes.map((l) => ({
    participant_id: participantId(l.id), participation_kind: "worker", role_ref: l.role,
    necessity_rationale: `owns ${l.id}`, owned_obligations: [`ob-${participantId(l.id)}`],
    depends_on: (l.deps ?? []).map(participantId), tier: "mid", purpose: "implementation", capability_scope: null, backend: "team",
  }));
  const reviewer = {
    participant_id: opts.reviewerId, participation_kind: "reviewer_cross_host", role_ref: "security-auditor",
    necessity_rationale: "cross-family review of reviewed lanes", owned_obligations: ["ob-review"],
    depends_on: workers.map((w) => w.participant_id), tier: "powerful", purpose: "adversarial-security", capability_scope: null, backend: "team",
  };
  const participants = [...workers, reviewer];
  const proposal = composeProposal({
    run_id: runId, phase: "build", participants,
    obligations: participants.map((p) => ({ obligation_id: p.owned_obligations[0], source: "plan_item", text: `work owned by ${p.participant_id}`, disposition: { owners: [p.participant_id] } })),
    excluded_roles: [],
    spec_ref: approvedPlanRef,
  } as never);
  const proposalPath = writeProposal(root, proposal);
  const decisionPath = writeDecision(root, recordDecision(proposal, {
    decision: "approve", decided_by: { kind: "operator", id: "e00-operator" }, decision_channel: "terminal_prompt", decided_at: "2026-10-26T13:00:00Z",
  } as never));
  return {
    approvedPlanRef,
    teamDecisionRef: { path: path.relative(root, decisionPath), sha256: sha256(fs.readFileSync(decisionPath)) },
    proposalPath,
    decisionPath,
    proposal: proposal as unknown as Record<string, any>,
  };
}
