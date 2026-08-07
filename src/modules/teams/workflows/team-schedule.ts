/**
 * src/modules/teams/workflows/team-schedule.ts
 *
 * T2b (dynamic-host-model-routing) — `guild.team_schedule.v1`: backend
 * scheduling over an APPROVED, uncapped roster (team-contracts §5).
 *
 * Slot limits are a CONCURRENCY concern only. Backend capacity translates the
 * approved participant set into dependency-aware execution waves — it can never
 * cap, filter, reorder, or truncate the roster. The §5 invariants are SET
 * EQUALITY (not counts): approved participant-id set = base-wave union =
 * dispatch-receipt id set = terminal-outcome id set (modulo
 * `explicitly_removed_by_new_decision`, which must cite the new decision hash).
 * Each id reaches EXACTLY ONE terminal outcome; retries attach to the same id
 * as new `attempt`s; a failed/interrupted wave preserves every not-yet-terminal
 * id for resume — omission is NEVER removal. Resource exhaustion is an explicit
 * scheduling failure or a request for a user-approved revision, never a roster
 * mutation.
 */

import { canonicalYaml, isSha256Hex, sha256Hex } from "./canonical-hash";
import {
  dispatchGate,
  proposalHashOf,
  validateDecision,
  type TeamDecisionV1,
} from "./team-decision";
import { dependencyWaves, validateProposal, type TeamProposalV2 } from "./team-proposal";
import { writeRunArtifact } from "./station-signals";

export const TEAM_SCHEDULE_SCHEMA = "guild.team_schedule.v1" as const;

export type TerminalOutcomeKind =
  | "completed"
  | "failed"
  | "explicitly_removed_by_new_decision";

export interface DispatchReceipt {
  participant_id: string;
  attempt: number;
  dispatched_at: string;
  receipt_ref: string;
}

export interface TerminalOutcome {
  participant_id: string;
  outcome: TerminalOutcomeKind;
  via_decision_hash: string | null;
}

export interface TeamScheduleV1 {
  schema_version: typeof TEAM_SCHEDULE_SCHEMA;
  run_id: string;
  phase: string;
  /** The approved proposal's §1 hash — REQUIRED (rework F3: chain-bound). */
  proposal_hash: string;
  /** The approve decision's §1 hash — REQUIRED, never null (rework F3). */
  decision_hash: string;
  backend: string;
  concurrency: {
    verified_backend_capacity: number;
    selected_hint: number | null;
    effective: number;
    clamp_diagnostic: string | null;
  };
  base_waves: string[][];
  dispatch_receipts: DispatchReceipt[];
  terminal_outcomes: TerminalOutcome[];
}

/** An EXPLICIT scheduling failure — never a roster mutation (§5). */
export interface ScheduleFailure {
  error: string;
  /** What the user can approve to unblock: a backend or concurrency revision. */
  requires_user_approved_revision: true;
}

export interface BuildScheduleOptions {
  backend: string;
  verified_backend_capacity: number;
  /** §6-resolved concurrency hint (already precedence-resolved); optional. */
  selected_hint?: number | null;
  /** The CURRENT approve decision — REQUIRED; no decision, no schedule (§4/§5). */
  decision: TeamDecisionV1;
}

function isScheduleFailure(v: TeamScheduleV1 | ScheduleFailure): v is ScheduleFailure {
  return (v as ScheduleFailure).error !== undefined;
}

/**
 * Build the binding `guild.team_schedule.v1` for an approved proposal:
 * dependency-aware Kahn waves bounded by effective concurrency =
 * min(selected_hint ?? capacity, capacity). EVERY approved participant id lands
 * in exactly one wave — capacity shapes the waves, never the set.
 *
 * REQUIRES a current approve decision (rework F3): the full §4 dispatch gate
 * runs first — a missing, malformed, non-approve, tampered, or hash-mismatched
 * decision THROWS; no schedule exists without a verified user approval. The
 * emitted schedule carries BOTH chain bindings (`proposal_hash` +
 * `decision_hash`), non-null. A non-positive capacity returns an EXPLICIT
 * ScheduleFailure (the §5 resource-exhaustion path); the proposal is never
 * touched.
 */
export function buildSchedule(
  proposal: object,
  opts: BuildScheduleOptions
): TeamScheduleV1 | ScheduleFailure {
  const gate = dispatchGate(proposal, opts.decision);
  if (!gate.allowed) {
    throw new Error(
      `buildSchedule: refusing to schedule without a current, verified approve decision — ${gate.reason}`
    );
  }
  const p = proposal as TeamProposalV2;
  const capacity = opts.verified_backend_capacity;
  if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity <= 0) {
    return {
      error:
        `scheduling failure: verified backend capacity ${String(capacity)} for backend "${opts.backend}" cannot run any participant — ` +
        "request a user-approved backend or concurrency revision; the approved roster is NOT modified",
      requires_user_approved_revision: true,
    };
  }
  const hint = opts.selected_hint ?? null;
  const effective = hint === null ? capacity : Math.min(hint, capacity);
  const clamp_diagnostic =
    hint !== null && hint > capacity
      ? `selected_hint ${hint} exceeds verified backend capacity ${capacity} — effective concurrency clamped to ${capacity}`
      : null;

  let base_waves: string[][];
  try {
    base_waves = dependencyWaves(p.participants ?? [], effective);
  } catch (err) {
    return {
      error: `scheduling failure: ${(err as Error).message}`,
      requires_user_approved_revision: true,
    };
  }

  return {
    schema_version: TEAM_SCHEDULE_SCHEMA,
    run_id: p.run_id,
    phase: p.phase,
    proposal_hash: proposalHashOf(proposal),
    decision_hash: opts.decision.decision_hash,
    backend: opts.backend,
    concurrency: {
      verified_backend_capacity: capacity,
      selected_hint: hint,
      effective,
      clamp_diagnostic,
    },
    base_waves,
    dispatch_receipts: [],
    terminal_outcomes: [],
  };
}

// ── Wave failure + resume (omission is NEVER removal) ────────────────────────

export interface WaveFailureInput {
  wave_index: number;
  failed_ids: string[];
}

/**
 * Record the outcome of an interrupted run deterministically (test/simulation
 * seam and the resume bookkeeping shape): waves BEFORE `wave_index` completed;
 * in the failed wave, `failed_ids` failed THIS ATTEMPT (not terminal — retries
 * reuse the participant id as a new attempt) and the rest completed; waves
 * AFTER `wave_index` were never dispatched. Returns a NEW schedule object —
 * every not-yet-terminal id stays present in `base_waves` for resume.
 */
export function simulateWaveFailure(
  schedule: TeamScheduleV1,
  input: WaveFailureInput
): TeamScheduleV1 {
  const next: TeamScheduleV1 = JSON.parse(JSON.stringify(schedule)) as TeamScheduleV1;
  const failed = new Set(input.failed_ids);
  let attemptStamp = 0;
  for (let w = 0; w <= input.wave_index && w < next.base_waves.length; w++) {
    for (const id of next.base_waves[w]) {
      attemptStamp++;
      next.dispatch_receipts.push({
        participant_id: id,
        attempt: 1,
        dispatched_at: `1970-01-01T00:00:${String(attemptStamp % 60).padStart(2, "0")}Z`,
        receipt_ref: `receipts/${id}-attempt1.md`,
      });
      const failedHere = w === input.wave_index && failed.has(id);
      if (!failedHere) {
        next.terminal_outcomes.push({
          participant_id: id,
          outcome: "completed",
          via_decision_hash: null,
        });
      }
      // A failed attempt records NO terminal outcome — the id stays pending so
      // resume retries it under the SAME participant id (attempt+1).
    }
  }
  return next;
}

export interface ResumeState {
  /** Ids that reached a terminal outcome (completed/failed-terminal/removed-with-citation). */
  terminal_ids: string[];
  /** Every approved id NOT yet terminal — preserved for resume; omission is never removal. */
  pending_ids: string[];
  /** Dependency-aware waves over the pending set (completed deps satisfied). */
  resume_waves: string[][];
}

/**
 * Resume an interrupted schedule (§5): terminal ids keep their single outcome;
 * EVERY other approved id — including ids whose attempts failed — is pending
 * and re-waved. terminal ∪ pending always equals the scheduled participant set.
 */
export function resumeSchedule(schedule: TeamScheduleV1): ResumeState {
  const allIds = schedule.base_waves.flat();
  const terminal = new Set(schedule.terminal_outcomes.map((t) => t.participant_id));
  const terminal_ids = [...terminal].sort();
  const pending_ids = allIds.filter((id) => !terminal.has(id)).sort();
  const effective = Math.max(1, schedule.concurrency.effective);
  // Re-partition pending ids preserving base-wave (dependency) order, bounded
  // by the effective concurrency: each base wave's still-pending ids re-chunk
  // into waves of at most `effective` ids.
  const resume_waves: string[][] = [];
  for (const wave of schedule.base_waves) {
    const still = wave.filter((id) => !terminal.has(id));
    for (let i = 0; i < still.length; i += effective) {
      resume_waves.push(still.slice(i, i + effective));
    }
  }
  return { terminal_ids, pending_ids, resume_waves };
}

// ── §5 set-equality validation (SET EQUALITY, never counts) ──────────────────

export interface ScheduleSetsVerdict {
  valid: boolean;
  reason: string | null;
}

/**
 * Validate the §5 invariants between an approved proposal, its approve
 * decision, and a schedule. HASH BINDINGS FIRST (rework F3 — the four-set
 * state is never even examined for an unbound schedule):
 *  - the proposal must be a valid guild.team_proposal.v2;
 *  - `schedule.proposal_hash` must equal the §1 hash RECOMPUTED from the
 *    proposal artifact (a tampered/zeroed hash fails closed);
 *  - the decision must be a valid, §1-verified guild.team_decision.v1 approve
 *    binding this proposal (recomputed hash + run/phase), and
 *    `schedule.decision_hash` must equal its verified `decision_hash`.
 * Then the SET-EQUALITY invariants:
 *  - EXACTLY ONE terminal outcome per participant id (retries repeat ids in
 *    dispatch_receipts as attempts — never in terminal_outcomes);
 *  - terminal-outcome id set = approved participant set;
 *  - `explicitly_removed_by_new_decision` MUST cite the new decision hash;
 *  - base-wave union = approved set modulo cited removals, each id exactly once;
 *  - dispatch-receipt id set = approved set modulo cited removals.
 * All comparisons are SET equality — a count can lie, a set cannot.
 */
export function validateScheduleSets(
  proposal: object,
  schedule: TeamScheduleV1,
  decision: TeamDecisionV1
): ScheduleSetsVerdict {
  const errors: string[] = [];
  const p = proposal as TeamProposalV2;

  // ── Chain bindings (fail closed BEFORE any set accounting) ──
  const proposalVerdict = validateProposal(proposal);
  if (!proposalVerdict.valid) {
    return {
      valid: false,
      reason: `proposal is not a valid guild.team_proposal.v2 — ${proposalVerdict.reasons.join("; ")}`,
    };
  }
  if (schedule === null || typeof schedule !== "object" || Array.isArray(schedule)) {
    return { valid: false, reason: "schedule must be a plain object" };
  }
  if (schedule.schema_version !== TEAM_SCHEDULE_SCHEMA) {
    return { valid: false, reason: `schedule schema_version must be ${TEAM_SCHEDULE_SCHEMA}` };
  }
  if (schedule.run_id !== p.run_id || schedule.phase !== p.phase) {
    return {
      valid: false,
      reason: "schedule run_id/phase do not bind the proposal's run_id/phase — fails closed",
    };
  }
  const recomputedProposalHash = proposalHashOf(proposal);
  if (!isSha256Hex(schedule.proposal_hash) || schedule.proposal_hash !== recomputedProposalHash) {
    return {
      valid: false,
      reason:
        "schedule.proposal_hash does not equal the §1 hash recomputed from the proposal — the schedule is not bound to this approved proposal; fails closed",
    };
  }
  const decisionVerdict = validateDecision(decision);
  if (!decisionVerdict.valid) {
    return {
      valid: false,
      reason: `decision is not a valid guild.team_decision.v1 — ${decisionVerdict.reasons.join("; ")}`,
    };
  }
  if (decision.decision !== "approve") {
    return { valid: false, reason: "the bound decision is not an approve — fails closed" };
  }
  if (decision.run_id !== p.run_id || decision.phase !== p.phase || decision.proposal_hash !== recomputedProposalHash) {
    return {
      valid: false,
      reason: "the decision does not bind this proposal (run/phase/proposal_hash mismatch) — fails closed",
    };
  }
  if (!isSha256Hex(schedule.decision_hash) || schedule.decision_hash !== decision.decision_hash) {
    return {
      valid: false,
      reason:
        "schedule.decision_hash does not equal the verified approve decision's decision_hash — the schedule is not approval-bound; fails closed",
    };
  }

  const approved = new Set((p.participants ?? []).map((x) => x.participant_id));

  const terminalIds = schedule.terminal_outcomes.map((t) => t.participant_id);
  if (new Set(terminalIds).size !== terminalIds.length) {
    errors.push(
      "exactly-one violated: a participant id carries more than one terminal outcome (a retry is a new attempt on the same id, never a duplicate outcome)"
    );
  }
  const terminalKey = [...new Set(terminalIds)].sort().join();
  const approvedKey = [...approved].sort().join();
  if (terminalKey !== approvedKey) {
    errors.push(
      "terminal-outcome id set != approved participant set (omission is never removal; every approved id must reach exactly one terminal outcome)"
    );
  }

  const removed = new Set<string>();
  for (const t of schedule.terminal_outcomes) {
    if (t.outcome === "explicitly_removed_by_new_decision") {
      if (!/^[0-9a-f]{64}$/.test(t.via_decision_hash ?? "")) {
        errors.push(
          `removal of "${t.participant_id}" without citing the new decision hash — user-approved removal exists only via a new proposal+decision cycle`
        );
      }
      removed.add(t.participant_id);
    }
  }

  const expectedKey = [...approved].filter((id) => !removed.has(id)).sort().join();
  const waveUnion = schedule.base_waves.flat();
  if (new Set(waveUnion).size !== waveUnion.length) {
    errors.push("a participant id appears in more than one base wave (each approved id exactly once)");
  }
  if ([...new Set(waveUnion)].sort().join() !== expectedKey) {
    errors.push(
      "base-wave union != approved participant set (an unapproved or omitted id breaks §5 set equality)"
    );
  }
  const receiptKey = [...new Set(schedule.dispatch_receipts.map((r) => r.participant_id))]
    .sort()
    .join();
  if (receiptKey !== expectedKey) {
    errors.push(
      "dispatch-receipt id set != approved participant set (an unapproved or omitted id breaks §5 set equality)"
    );
  }

  return { valid: errors.length === 0, reason: errors.length ? errors.join("; ") : null };
}

/**
 * Persist a schedule (which carries the terminal receipts) under
 * `.guild/runs/<run-id>/team-result/` as
 * `<phase>.schedule.<first12-of-content-sha256>.yaml` — CONTENT-ADDRESSED and
 * IMMUTABLE (rework F4, team-contracts §1): every state transition (new
 * dispatch receipt, new terminal outcome) produces different canonical bytes,
 * hence a NEW artifact file; no write can ever replace prior audit-trail
 * bytes, and `writeRunArtifact` refuses an existing path outright
 * (immutable: true). Refuses a ScheduleFailure — an explicit failure is
 * surfaced, not archived as if it were a schedule. Also refuses a schedule
 * whose chain bindings are missing/malformed.
 */
export function writeSchedule(
  cwd: string,
  schedule: TeamScheduleV1 | ScheduleFailure,
  opts: { guildDir?: string } = {}
): string {
  if (isScheduleFailure(schedule)) {
    throw new Error(`writeSchedule: refusing to persist a scheduling failure — ${schedule.error}`);
  }
  if (!isSha256Hex(schedule.proposal_hash) || !isSha256Hex(schedule.decision_hash)) {
    throw new Error(
      "writeSchedule: refusing to persist a schedule without both §1 chain bindings (proposal_hash + decision_hash)"
    );
  }
  const body = canonicalYaml(schedule);
  const filename = `${schedule.phase}.schedule.${sha256Hex(body).slice(0, 12)}.yaml`;
  return writeRunArtifact(cwd, schedule.run_id, "team-result", filename, body, {
    guildDir: opts.guildDir,
    immutable: true,
  });
}
