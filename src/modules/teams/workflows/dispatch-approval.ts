/**
 * src/modules/teams/workflows/dispatch-approval.ts
 *
 * T7-H1 — the approve-before-dispatch gate, ON THE REAL DISPATCH PATH.
 *
 * ── WHAT THE AUDIT FOUND ────────────────────────────────────────────────────
 * `dispatchGate` (team-decision.ts) and `preDispatchGate` (team-decision-surface.ts)
 * are correct, fail-closed, non-vacuous gates — 7/7 planted controls refused,
 * including a forged `{kind:"agent"}` approver and a legacy bare `decided_by`.
 * And NOTHING on the execution path called them. A literal grep over the
 * dispatch chain (agent-team-launcher.ts, task-assignment*.ts, run-lifecycle.ts,
 * team-file.ts) for `team-decision|dispatchGate|proposal_hash` returned no
 * output. The launcher took `--team <path>` and dispatched every specialist in
 * that YAML: no proposal loaded, no hash recomputed, no decision consulted.
 *
 * The concrete failure: an operator approves a 9-participant proposal; anyone
 * (or any lane pane — the known self-commit behaviour) edits
 * `.guild/team/<slug>.build.yaml` to add a specialist, swap a model/tier, or
 * drop a role; `guild:execute-plan` invokes the launcher on that file; every
 * edited participant dispatches.
 *
 * This is the security-step-as-model-prose class: T1a wrote the prose that says
 * to run the gate (execute-plan "input 1b", guild-quality "step 0 HOLD",
 * guild-operations "step 0 gate"); no lane owned the join.
 *
 * ── WHAT ROUND 1 GOT WRONG (T7R-R1-B1) ──────────────────────────────────────
 * Round 1 wired the join but kept an "unenforced mode": when a run carried no
 * proposal trail AND the team file declared no `proposal_ref`/`decision_ref`, a
 * MISSING proposal and even a REFUSED `preDispatchGate` verdict were both
 * converted into `allowed: true`, and the launcher merely warned. The reviewer's
 * real-entry probe — the actual `scripts/agent-team-launcher.ts` command
 * `guild:execute-plan` runs, with no proposal and no decision — exited 0 and the
 * recording tmux stub observed `new-session` and `split-window`. An entirely
 * unapproved team dispatched on the DEFAULT path. "Warn and continue" is not a
 * gate; absence of evidence was being read as evidence of approval.
 *
 * ── WHAT THIS MODULE DOES ───────────────────────────────────────────────────
 * It is the JOIN, in code. It loads the run's persisted proposal + decision
 * trail, delegates every verdict to the EXISTING canonical gates (nothing is
 * re-implemented here — `preDispatchGate` → `dispatchGate` → `validateProposal`
 * / `validateDecision` do the work), and then asserts SET EQUALITY between the
 * approved worker set and the participants the launcher is about to spawn.
 * Set equality, never counts: a count can lie, a set cannot (§5).
 *
 * ── WHEN IT BLOCKS: ALWAYS, UNLESS APPROVAL VERIFIES ────────────────────────
 * Approval verification is MANDATORY and UNCONDITIONAL before every launcher
 * dispatch and every dispatch-plan emission, standalone/no-run-id calls
 * included. There is no unenforced mode and no auto-allow:
 *
 *   - a MISSING proposal            → refuse (`no_persisted_proposal`)
 *   - an INVALID / AMBIGUOUS trail  → refuse
 *   - a REFUSED `preDispatchGate`   → refuse (verbatim delegated reason)
 *   - a scheduled≠approved set      → refuse (`participant_set_mismatch`)
 *   - NO run id (nothing to check)  → refuse (`no_run_id`) — a dispatch whose
 *                                     approval cannot even be looked up is
 *                                     never an approved dispatch
 *
 * ── THE ONLY ESCAPE: AN EXPLICIT, AUDITED OPERATOR OVERRIDE ─────────────────
 * Compatibility with un-migrated callers survives ONLY as
 * `--approval-override "<reason>"` (or `GUILD_DISPATCH_APPROVAL_OVERRIDE=
 * "<reason>"`). It is:
 *   - NAMED     — it must be typed on purpose; there is no default value;
 *   - REASONED  — an empty reason, or a bare `1`/`true`/`yes`, is REFUSED, so
 *                 the muscle memory of `EXPORT SOMETHING=1` cannot switch the
 *                 gate off;
 *   - AUDITED   — it appends a `guild.dispatch_approval_override.v1` record to a
 *                 JSONL audit log BEFORE dispatch proceeds, and a failure to
 *                 record REFUSES the dispatch;
 *   - A DEGRADATION — the verdict carries `degradation: true` plus the refusal
 *                 it overrode, and the launcher prints it as a loud degradation,
 *                 never as a pass.
 *
 * ── WIRING THE TRAIL (the composition side) ─────────────────────────────────
 * The normal path now HAS a trail to check: `scripts/team-decide.ts persist`
 * writes the composed `guild.team_proposal.v2` into
 * `.guild/runs/<run-id>/team-plan/`, and `scripts/team-decide.ts record` routes
 * the user's approve through `recordDecision` (§4 user-actor allowlist — an
 * agent identity can never decide) into `writeDecision`. Both are deterministic
 * code, not skill prose.
 */

import * as fs from "fs";
import * as path from "path";

import {
  loadPersistedDecisions,
  loadPersistedProposals,
  preDispatchGate,
  teamPlanDir,
  type PreDispatchVerdict,
} from "./team-decision-surface";
import { proposalHashOf } from "./team-decision";
import type { TeamProposalV2 } from "./team-proposal";

/**
 * `enforced` is the ONLY mode in which dispatch is approval-verified.
 * `operator_override` means dispatch proceeds DESPITE a refusal, on an audited
 * operator decision — it is a degradation, never a pass.
 */
export type ApprovalMode = "enforced" | "operator_override";

export interface ApprovalRefusal {
  /** Machine-readable cause. */
  refusal: string;
  /** Human-readable reason (verbatim from the delegated gate when it refused). */
  reason: string;
}

export interface DispatchApprovalVerdict {
  /** Dispatch may proceed ONLY when true. */
  allowed: boolean;
  mode: ApprovalMode;
  /** Why the gate reached this verdict — never silent. */
  mode_reason: string;
  /** true when dispatch proceeds ONLY because an operator override was used. */
  degradation: boolean;
  /** The operator's stated reason for the override (null when none was used). */
  override_reason: string | null;
  /** Where the override was recorded (null when no override was used). */
  override_audit_path: string | null;
  /** The refusal — RETAINED even when an override allows dispatch anyway. */
  refusal: string | null;
  reason: string;
  /** Path of the proposal artifact the gate bound to (null when none). */
  proposal_path: string | null;
  /** decision_hash of the approve that authorized dispatch (null when refused). */
  decision_hash: string | null;
  /** Participants the launcher would spawn that the user never approved. */
  scheduled_not_approved: string[];
  /** Approved worker participants the launcher would silently NOT spawn. */
  approved_not_scheduled: string[];
  /** The delegated surface verdict, for the caller's log (null when unreached). */
  gate: PreDispatchVerdict | null;
}

/**
 * Legacy force-flag env. Enforcement is now UNCONDITIONAL, so this is a no-op
 * kept only so existing CI exports do not become errors. It can never weaken
 * the gate — nothing reads it to decide WHETHER to enforce.
 */
export const REQUIRE_APPROVAL_ENV = "GUILD_REQUIRE_TEAM_APPROVAL";

/** The ONE named escape hatch. Its value is the operator's stated reason. */
export const APPROVAL_OVERRIDE_ENV = "GUILD_DISPATCH_APPROVAL_OVERRIDE";

/** Audit-log basename for `guild.dispatch_approval_override.v1` records. */
export const OVERRIDE_AUDIT_FILE = "dispatch-approval-overrides.jsonl";

/**
 * Values that look like a flag flip rather than a reason. Rejecting these is the
 * point: an override must be an EXPLAINED operator decision.
 */
const NON_REASONS = new Set(["1", "0", "true", "false", "yes", "no", "on", "off", "y", "n"]);

/** Does the team file declare the proposal/decision it realizes? (diagnostic) */
export function teamFileDeclaresApprovalRefs(teamPath: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(teamPath, "utf8");
  } catch {
    return false;
  }
  return /^\s*(proposal_ref|decision_ref)\s*:/m.test(raw);
}

/** Does the run carry ANY persisted team-plan proposal artifact? (diagnostic) */
export function runHasTeamPlanTrail(cwd: string, runId: string, guildDir = ".guild"): boolean {
  const dir = teamPlanDir(cwd, runId, guildDir);
  try {
    return fs.readdirSync(dir).some((n) => /\.proposal\..*\.(ya?ml|json)$/i.test(n));
  } catch {
    return false;
  }
}

/**
 * Resolve the operator override, if any. Returns the operator's stated reason,
 * or null when no override was requested. THROWS when an override was clearly
 * attempted but carries no reason — a nameless override is not an audited
 * override, and silently ignoring it would be its own fail-open.
 */
export function resolveApprovalOverride(input: {
  env?: NodeJS.ProcessEnv;
  /** Explicit CLI override (`--approval-override "<reason>"`). */
  overrideReason?: string | null;
}): string | null {
  const env = input.env ?? process.env;
  const raw = (input.overrideReason ?? env[APPROVAL_OVERRIDE_ENV] ?? "").trim();
  if (raw.length === 0) return null;
  if (NON_REASONS.has(raw.toLowerCase())) {
    throw new Error(
      `dispatch_approval_override_unreasoned: the approve-before-dispatch override was set to ` +
        `${JSON.stringify(raw)} — a boolean-shaped value is NOT a reason. The override is an ` +
        `audited operator decision and must state WHY approval verification is being bypassed ` +
        `(e.g. --approval-override "migrating legacy team file; approved out-of-band in ticket X").`,
    );
  }
  return raw;
}

/** Frozen record kind for the override audit log. */
export const OVERRIDE_RECORD_KIND = "guild.dispatch_approval_override.v1";

/**
 * Append the override audit record. Run-local when a run id exists,
 * workspace-local otherwise — an override is ALWAYS recorded somewhere durable.
 * Throws on failure; the caller must then refuse, because an unrecorded
 * override is exactly the silent bypass this gate exists to stop.
 */
export function recordApprovalOverride(input: {
  cwd: string;
  runId: string;
  phase: string;
  teamPath: string;
  guildDir?: string;
  override_reason: string;
  refusal: string;
  refusal_reason: string;
  scheduledParticipants: string[];
  now?: string;
}): string {
  const guildDir = input.guildDir ?? ".guild";
  const hasRun = input.runId.trim().length > 0;
  const dir = hasRun
    ? path.join(input.cwd, guildDir, "runs", input.runId)
    : path.join(input.cwd, guildDir, "artifacts", "audits");
  const target = path.join(dir, OVERRIDE_AUDIT_FILE);
  const record: Record<string, unknown> = {};
  record["schema_version"] = OVERRIDE_RECORD_KIND;
  record["recorded_at"] = input.now ?? new Date().toISOString();
  record["run_id"] = hasRun ? input.runId : null;
  record["phase"] = input.phase;
  record["team_path"] = input.teamPath;
  record["scheduled_participants"] = [...input.scheduledParticipants].sort();
  record["refusal"] = input.refusal;
  record["refusal_reason"] = input.refusal_reason;
  record["override_reason"] = input.override_reason;
  record["degradation"] = true;
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(target, JSON.stringify(record) + "\n", "utf8");
  return target;
}

/**
 * Pick the CURRENT proposal from a phase's trail: the highest
 * `proposal_version`. A tie at the top is AMBIGUOUS and refuses — filename
 * order must never pick which roster the user approved (the same reasoning
 * that makes two decisions on one hash a `conflicting_decisions` refusal).
 */
function selectCurrentProposal(
  loaded: Array<{ source_path: string; proposal: TeamProposalV2; valid: boolean; reasons: string[] }>,
): { chosen: (typeof loaded)[number] | null; refusal: ApprovalRefusal | null } {
  if (loaded.length === 0) {
    return {
      chosen: null,
      refusal: {
        refusal: "no_persisted_proposal",
        reason:
          "no persisted guild.team_proposal.v2 for this run/phase — dispatch refused. Guild never " +
          "auto-approves: compose the proposal and record the user's decision first.",
      },
    };
  }
  const invalid = loaded.filter((p) => !p.valid);
  if (invalid.length > 0) {
    return {
      chosen: null,
      refusal: {
        refusal: "invalid_proposal_artifact",
        reason:
          `${invalid.length} proposal artifact(s) in this trail are invalid (` +
          invalid.map((p) => p.source_path).join(", ") +
          ") — the WHOLE trail fails closed; a valid proposal elsewhere does not excuse a corrupt one.",
      },
    };
  }
  const maxVersion = Math.max(...loaded.map((p) => p.proposal.proposal_version ?? 1));
  const top = loaded.filter((p) => (p.proposal.proposal_version ?? 1) === maxVersion);
  if (top.length !== 1) {
    return {
      chosen: null,
      refusal: {
        refusal: "ambiguous_proposal",
        reason:
          `${top.length} proposals share the highest version (${maxVersion}) in this trail (` +
          top.map((p) => p.source_path).join(", ") +
          ") — which roster the user approved is ambiguous; filename order never decides. Resolve and re-approve.",
      },
    };
  }
  return { chosen: top[0], refusal: null };
}

/**
 * THE GATE the launcher calls before creating the first pane.
 *
 * `scheduledParticipants` is what the launcher is ABOUT to dispatch (the team
 * file's specialist names). It is compared against the approved
 * `participation_kind: "worker"` participants — the set `guild:plan` says maps
 * one-to-one onto plan lanes. Advisors, challengers, and reviewer slots are
 * approved by the SAME decision but dispatch at their own gate points
 * (advisor escalation, panels, brokers), so they are not expected in a
 * launcher roster; a scheduled name matching ANY approved participant is
 * accepted, and only names matching NO approved participant are smuggled.
 *
 * There is no mode in which a missing or refused trail returns `allowed: true`
 * on its own. The ONLY way `allowed` is true alongside a non-null `refusal` is
 * an audited operator override, and that verdict also carries
 * `degradation: true` plus a non-null `override_audit_path`.
 */
export function assertDispatchApproved(input: {
  cwd: string;
  runId: string;
  phase: string;
  teamPath: string;
  scheduledParticipants: string[];
  guildDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Explicit CLI override (`--approval-override "<reason>"`). */
  overrideReason?: string | null;
  /** Legacy `--require-approval`. Accepted and IGNORED: enforcement is unconditional. */
  forced?: boolean;
}): DispatchApprovalVerdict {
  const guildDir = input.guildDir ?? ".guild";

  const base: DispatchApprovalVerdict = {
    allowed: false,
    mode: "enforced",
    mode_reason:
      "approve-before-dispatch verification is MANDATORY for every dispatch and every " +
      "dispatch-plan emission (T7-H1) — there is no unenforced mode",
    degradation: false,
    override_reason: null,
    override_audit_path: null,
    refusal: null,
    reason: "",
    proposal_path: null,
    decision_hash: null,
    scheduled_not_approved: [],
    approved_not_scheduled: [],
    gate: null,
  };

  // An unreasoned override ATTEMPT throws — it is never a quiet fall-through.
  const overrideReason = resolveApprovalOverride({
    env: input.env,
    overrideReason: input.overrideReason,
  });

  /** Apply the audited operator override to a refusal, or return the refusal. */
  const settle = (refused: DispatchApprovalVerdict): DispatchApprovalVerdict => {
    if (overrideReason === null) return refused;
    let auditPath: string;
    try {
      auditPath = recordApprovalOverride({
        cwd: input.cwd,
        runId: input.runId,
        phase: input.phase,
        teamPath: input.teamPath,
        guildDir,
        override_reason: overrideReason,
        refusal: refused.refusal ?? "refused",
        refusal_reason: refused.reason,
        scheduledParticipants: input.scheduledParticipants,
      });
    } catch (err) {
      // An override that cannot be recorded is not an audited override.
      return {
        ...refused,
        refusal: "override_audit_unwritable",
        reason:
          `${refused.reason} — an operator override was supplied but its audit record could not ` +
          `be written (${(err as Error).message}). An unrecorded override is a silent bypass; ` +
          `dispatch stays REFUSED.`,
      };
    }
    return {
      ...refused,
      allowed: true,
      mode: "operator_override",
      degradation: true,
      override_reason: overrideReason,
      override_audit_path: auditPath,
      mode_reason:
        `OPERATOR OVERRIDE (${APPROVAL_OVERRIDE_ENV} / --approval-override): dispatch is NOT ` +
        `approval-verified and proceeds as a RECORDED DEGRADATION — "${overrideReason}"`,
    };
  };

  // A dispatch with no run id has no trail that could be looked up, so its
  // approval can never be verified. That is a refusal, not a free pass — the
  // exact standalone/no-run-id hole the reviewer's probe walked through.
  if (input.runId.trim().length === 0) {
    return settle({
      ...base,
      refusal: "no_run_id",
      reason:
        "dispatch was requested with no --run-id, so there is no run whose team-plan trail could " +
        "be consulted — approval can never be verified for this call and is therefore refused. " +
        "Pass --run-id <id> for the run whose proposal+decision authorize this roster.",
    });
  }

  const proposals = loadPersistedProposals(input.cwd, input.runId, input.phase, { guildDir });
  const picked = selectCurrentProposal(proposals);
  if (picked.refusal) {
    return settle({
      ...base,
      refusal: picked.refusal.refusal,
      reason:
        `${picked.refusal.reason} (looked under ` +
        `${teamPlanDir(input.cwd, input.runId, guildDir)} for phase "${input.phase}")`,
    });
  }
  const chosen = picked.chosen as NonNullable<typeof picked.chosen>;

  // Delegated verdict — the canonical trail gate. Nothing about schema,
  // actor allowlist, decision_hash recomputation, staleness, conflicting
  // decisions, or participation-kind coverage is decided here.
  const gate = preDispatchGate(
    chosen.proposal,
    loadPersistedDecisions(input.cwd, input.runId, input.phase, { guildDir }),
  );
  if (!gate.allowed) {
    return settle({
      ...base,
      gate,
      proposal_path: chosen.source_path,
      refusal: gate.refusal ?? "refused",
      reason: gate.reason,
    });
  }

  // ── §5 set equality between APPROVED and ABOUT-TO-DISPATCH ────────────────
  const participants = chosen.proposal.participants ?? [];
  const approvedAll = new Set(participants.map((p) => p.participant_id));
  const approvedWorkers = new Set(
    participants.filter((p) => p.participation_kind === "worker").map((p) => p.participant_id),
  );
  const scheduled = new Set(input.scheduledParticipants);

  // Smuggled: a pane the user never approved in ANY role.
  const scheduled_not_approved = [...scheduled].filter((id) => !approvedAll.has(id)).sort();
  // Silently removed: an approved WORKER that would never be dispatched.
  const approved_not_scheduled = [...approvedWorkers].filter((id) => !scheduled.has(id)).sort();

  const withSets: DispatchApprovalVerdict = {
    ...base,
    gate,
    proposal_path: chosen.source_path,
    decision_hash: gate.approved_by?.decision_hash ?? null,
    scheduled_not_approved,
    approved_not_scheduled,
  };

  if (scheduled_not_approved.length > 0 || approved_not_scheduled.length > 0) {
    const parts: string[] = [];
    if (scheduled_not_approved.length > 0) {
      parts.push(
        `${scheduled_not_approved.length} scheduled participant(s) are NOT in the approved proposal ` +
          `[${scheduled_not_approved.join(", ")}] — the team file was edited after approval`,
      );
    }
    if (approved_not_scheduled.length > 0) {
      parts.push(
        `${approved_not_scheduled.length} approved worker participant(s) would NOT be dispatched ` +
          `[${approved_not_scheduled.join(", ")}] — omission is never removal; a user-approved ` +
          `removal exists only via a new proposal+decision cycle`,
      );
    }
    return settle({
      ...withSets,
      refusal: "participant_set_mismatch",
      reason:
        `scheduled-participant set != approved participant set (§5 set equality): ${parts.join("; ")}. ` +
        `Approved proposal hash ${proposalHashOf(chosen.proposal).slice(0, 12)}… — renewed user approval is required.`,
    });
  }

  return {
    ...withSets,
    allowed: true,
    reason:
      `${gate.reason}; scheduled participant set equals the approved set ` +
      `(${scheduled.size} scheduled, ${approvedWorkers.size} approved worker(s))`,
  };
}
