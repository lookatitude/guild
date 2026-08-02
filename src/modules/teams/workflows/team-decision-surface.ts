/**
 * src/modules/teams/workflows/team-decision-surface.ts
 *
 * T6b - the REUSABLE pre-dispatch team-decision INTERACTION every phase runs
 * before it dispatches anything (team-contracts §4/§5; plan lane
 * "command and team-decision surfaces").
 *
 * WHY THIS IS CODE AND NOT COMMAND PROSE
 * --------------------------------------
 * `guild.team_decision.v1` already gives us a fail-closed dispatch gate
 * (`dispatchGate`) and an immutable restructure path (`applyRestructure`), but
 * before this module nothing outside the contract test-suite called either -
 * the "every phase blocks dispatch on a persisted decision" rule existed only
 * as instructions inside phase commands. A gate a model is *told* to run is not
 * a gate. This module is the deterministic surface the phase commands shell out
 * to (`scripts/team-decide.ts`), so the block, the fail-closed staleness check,
 * and the anti-cap / anti-auto-approve assertions are executed code with an
 * exit status; the model only reads their output.
 *
 * DELEGATION (this file re-implements NOTHING)
 * --------------------------------------------
 *   - validity/hashing/gate  -> team-decision.ts (validateDecision,
 *                               dispatchGate, applyRestructure, proposalHashOf)
 *   - proposal schema        -> team-proposal.ts (validateProposal)
 *   - scheduling invariants  -> team-schedule.ts (validateScheduleSets)
 *   - YAML                   -> ../../state (parseYaml)
 * What lives HERE is only: reading the PERSISTED trail, presenting it, parsing
 * the user's decision vocabulary, and three surface-level fail-closed
 * assertions the contracts imply but no single module owns (roster delta must
 * be edit-cited; no cap key may re-enter; every participation_kind is gated).
 *
 * PURITY: rendering + assertions are pure (no clock, no env, no writes). The
 * only I/O is READ-ONLY trail loading; persistence stays in team-decision.ts /
 * team-proposal.ts where the immutability rule lives.
 */

import * as fs from "fs";
import * as path from "path";

import { parseYaml } from "../../state";
import { canonicalYaml } from "./canonical-hash";
import {
  applyRestructure,
  dispatchGate,
  proposalHashOf,
  validateDecision,
  type DecisionInput,
  type DispatchGateVerdict,
  type RestructureEdit,
  type RestructureResult,
  type TeamDecisionV1,
} from "./team-decision";
import {
  validateProposal,
  type ProposalParticipant,
  type TeamProposalV2,
} from "./team-proposal";
import { validateScheduleSets, type TeamScheduleV1 } from "./team-schedule";

// -- §4 decision vocabulary (frozen - widening it is requires-confirmation) --

/**
 * The user-facing decision vocabulary. `approve` is the only terminal verb;
 * the four edit verbs are the `restructure` edit kinds spelled as top-level
 * choices because that is how a user says them ("remove the mobile lane"), and
 * `restructure` itself is the generic form. Every edit verb resolves to a
 * `decision: restructure` artifact - there is no fifth decision kind.
 */
export const DECISION_VOCABULARY = [
  "approve",
  "add",
  "remove",
  "substitute",
  "edit_dependencies",
  "restructure",
] as const;

export type DecisionVerb = (typeof DECISION_VOCABULARY)[number];

const EDIT_VERBS: ReadonlySet<string> = new Set([
  "add",
  "remove",
  "substitute",
  "edit_dependencies",
  "restructure",
]);

/** Parse a user answer into a vocabulary verb, or null (never a guess). */
export function parseDecisionVerb(raw: unknown): DecisionVerb | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (DECISION_VOCABULARY as readonly string[]).includes(v) ? (v as DecisionVerb) : null;
}

/** True when the verb produces a §4 `restructure` decision (never an approve). */
export function isRestructureVerb(verb: DecisionVerb): boolean {
  return EDIT_VERBS.has(verb);
}

/** The §4 decision kind a vocabulary verb maps to. NEVER infers an approve. */
export function decisionKindForVerb(verb: DecisionVerb): "approve" | "restructure" {
  return verb === "approve" ? "approve" : "restructure";
}

// -- Read-only trail loading (a PERSISTED decision is what the gate consumes) -

export interface TrailFs {
  readdir(dir: string): string[];
  readFile(p: string): string | null;
}

function realTrailFs(): TrailFs {
  return {
    readdir: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []),
    readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null),
  };
}

/** `.guild/runs/<run-id>/team-plan` - where §1 says the trail lives. */
export function teamPlanDir(cwd: string, runId: string, guildDir = ".guild"): string {
  return path.join(cwd, guildDir, "runs", runId, "team-plan");
}

export interface LoadedDecision {
  /** Absolute path of the persisted artifact. */
  source_path: string;
  decision: TeamDecisionV1;
  /** Validator verdict for THIS artifact - an invalid one is never usable. */
  valid: boolean;
  reasons: string[];
}

/**
 * Load every persisted `<phase>.decision.*.yaml` for a run/phase, READ-ONLY.
 * Malformed artifacts come back with `valid: false` and their reasons - they
 * are surfaced, never silently skipped (a trail with an unreadable decision is
 * information the operator needs).
 */
export function loadPersistedDecisions(
  cwd: string,
  runId: string,
  phase: string,
  opts: { guildDir?: string; fs?: TrailFs } = {}
): LoadedDecision[] {
  const f = opts.fs ?? realTrailFs();
  const dir = teamPlanDir(cwd, runId, opts.guildDir ?? ".guild");
  const prefix = phase + ".decision.";
  const out: LoadedDecision[] = [];
  for (const name of f.readdir(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(".yaml")) continue;
    const p = path.join(dir, name);
    const raw = f.readFile(p);
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      out.push({
        source_path: p,
        decision: null as unknown as TeamDecisionV1,
        valid: false,
        reasons: ["unparseable YAML: " + (err as Error).message],
      });
      continue;
    }
    const verdict = validateDecision(parsed);
    out.push({
      source_path: p,
      decision: parsed as TeamDecisionV1,
      valid: verdict.valid,
      reasons: verdict.reasons,
    });
  }
  return out;
}

/** Load persisted `<phase>.proposal.v<n>.yaml` artifacts (read-only). */
export function loadPersistedProposals(
  cwd: string,
  runId: string,
  phase: string,
  opts: { guildDir?: string; fs?: TrailFs } = {}
): Array<{ source_path: string; proposal: TeamProposalV2; valid: boolean; reasons: string[] }> {
  const f = opts.fs ?? realTrailFs();
  const dir = teamPlanDir(cwd, runId, opts.guildDir ?? ".guild");
  const prefix = phase + ".proposal.";
  const out: Array<{
    source_path: string;
    proposal: TeamProposalV2;
    valid: boolean;
    reasons: string[];
  }> = [];
  for (const name of f.readdir(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(".yaml")) continue;
    const p = path.join(dir, name);
    const raw = f.readFile(p);
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch {
      continue;
    }
    const verdict = validateProposal(parsed);
    out.push({
      source_path: p,
      proposal: parsed as TeamProposalV2,
      valid: verdict.valid,
      reasons: verdict.reasons,
    });
  }
  return out;
}

// -- The blocking pre-dispatch gate -----------------------------------------

export interface PreDispatchVerdict {
  /** Dispatch may proceed ONLY when true. */
  allowed: boolean;
  /** Machine-readable refusal cause; null when allowed. */
  refusal:
    | null
    | "no_persisted_decision"
    | "invalid_decision_artifact"
    | "not_an_approve"
    | "stale_or_hash_mismatch"
    | "invalid_proposal"
    | "kind_coverage_gap"
    /**
     * T6B-R1-B3: two or more decisions bind the CURRENT proposal hash. §1
     * allows exactly one decision per proposal hash, so a trail carrying an
     * approve AND a restructure (or two approves) for the same bytes is
     * ambiguous - it fails closed rather than letting filename order pick a
     * winner.
     */
    | "conflicting_decisions";
  /** Human-readable reason (verbatim from the delegated gate when it refused). */
  reason: string;
  /** The persisted approve that authorized dispatch (null when refused). */
  approved_by: { source_path: string; decision_hash: string } | null;
  /** Every candidate the trail offered, with why each was or was not usable. */
  considered: Array<{ source_path: string; verdict: string }>;
  /** Per-participation_kind gate accounting - no kind is exempt (§3/§4). */
  kind_coverage: Array<{ participation_kind: string; participants: number; gated: boolean }>;
}

/**
 * Per-kind accounting. EVERY dispatchable participation_kind is gated by the
 * same decision - this exists so the surface can PROVE that rather than assert
 * it in prose. `gated` is false only for a participant whose kind is outside
 * the frozen §3 enum (an unknown kind is never silently trusted).
 */
export function kindCoverage(
  participants: readonly ProposalParticipant[]
): Array<{ participation_kind: string; participants: number; gated: boolean }> {
  const KNOWN = new Set([
    "worker",
    "advisor",
    "challenger",
    "reviewer_local",
    "reviewer_cross_host",
  ]);
  const counts = new Map<string, number>();
  for (const p of participants) {
    const k = String(p?.participation_kind ?? "unknown");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([participation_kind, participants]) => ({
      participation_kind,
      participants,
      gated: KNOWN.has(participation_kind),
    }));
}

/**
 * THE BLOCK. Phase dispatch is authorized only by a PERSISTED, valid, current
 * `approve` whose `proposal_hash` recomputes over the proposal artifact.
 *
 * Fail-closed by construction:
 *   - no trail / no decision           -> refused (Guild never auto-approves)
 *   - malformed or tampered artifact   -> refused (validateDecision recomputes)
 *   - a `restructure` decision         -> refused (it is not an approval)
 *   - proposal mutated since approval  -> refused (hash mismatch == stale)
 *   - an unknown participation_kind    -> refused (advisors, challengers and
 *     local/cross-host reviewer slots pass through the SAME gate; an advisory
 *     label is never a bypass)
 *
 * THE COMPLETE TRAIL IS VALIDATED BEFORE ANYTHING IS AUTHORIZED (T6B-R1-B3).
 * Round 1 returned on the FIRST candidate whose `dispatchGate` allowed, so a
 * valid approve sorted early hid every later artifact: a live probe showed a
 * conflicting restructure AND a hash-tampered decision both surviving behind
 * one good approve, with filename order deciding. There is no early return
 * here. Every artifact is classified first, and dispatch proceeds only when
 * the FULL invariant holds:
 *
 *   - not one artifact in the trail is invalid (a corrupt or tampered file
 *     anywhere invalidates the trail, whatever else it contains), AND
 *   - EXACTLY ONE decision binds the current proposal's recomputed hash
 *     (§1: one decision per proposal hash - zero is unapproved, two or more is
 *     ambiguous), AND
 *   - that sole decision passes the delegated `dispatchGate`.
 *
 * Decisions bound to a DIFFERENT proposal hash (earlier versions in the same
 * trail) are legitimate history: they are reported in `considered` and
 * authorize nothing.
 */
export function preDispatchGate(
  proposal: object,
  decisions: readonly LoadedDecision[]
): PreDispatchVerdict {
  const considered: PreDispatchVerdict["considered"] = [];
  const proposalVerdict = validateProposal(proposal);
  if (!proposalVerdict.valid) {
    return {
      allowed: false,
      refusal: "invalid_proposal",
      reason:
        "proposal is not a valid guild.team_proposal.v2 - dispatch refused (fails closed): " +
        proposalVerdict.reasons.join("; "),
      approved_by: null,
      considered,
      kind_coverage: [],
    };
  }
  const p = proposal as TeamProposalV2;
  const kind_coverage = kindCoverage(p.participants ?? []);
  const gap = kind_coverage.find((k) => !k.gated);
  if (gap) {
    return {
      allowed: false,
      refusal: "kind_coverage_gap",
      reason:
        'participation_kind "' + gap.participation_kind + '" is outside the frozen §3 enum (' +
        gap.participants +
        " participant(s)) - advisors, challengers and reviewer slots pass through the same " +
        "approval gate and an unrecognized kind is never exempt; fails closed",
      approved_by: null,
      considered,
      kind_coverage,
    };
  }

  if (decisions.length === 0) {
    return {
      allowed: false,
      refusal: "no_persisted_decision",
      reason:
        "no persisted guild.team_decision.v1 for this run/phase - dispatch refused. " +
        "Guild never auto-approves: present the proposal and record the user's answer first.",
      approved_by: null,
      considered,
      kind_coverage,
    };
  }

  // ── PASS 1: classify the COMPLETE trail. No early return, no short-circuit.
  const currentHash = proposalHashOf(proposal);
  const invalid: LoadedDecision[] = [];
  /** Valid decisions that bind THIS proposal's recomputed hash. */
  const current: LoadedDecision[] = [];
  let sawNonApprove = false;
  let sawMismatch = false;

  for (const candidate of decisions) {
    if (!candidate.valid) {
      invalid.push(candidate);
      considered.push({
        source_path: candidate.source_path,
        verdict: "INVALID artifact - " + candidate.reasons.join("; "),
      });
      continue;
    }
    if (candidate.decision?.proposal_hash === currentHash) {
      current.push(candidate);
      considered.push({
        source_path: candidate.source_path,
        verdict:
          'binds the current proposal hash as a "' + candidate.decision.decision + '" decision',
      });
    } else {
      considered.push({
        source_path: candidate.source_path,
        verdict:
          "binds a DIFFERENT proposal hash (earlier version in this trail) - authorizes nothing",
      });
    }
    if (candidate.decision?.decision !== "approve") sawNonApprove = true;
    else sawMismatch = true;
  }

  // ── PASS 2: the invariant. Any failure refuses; none authorizes early.
  if (invalid.length > 0) {
    return {
      allowed: false,
      refusal: "invalid_decision_artifact",
      reason:
        invalid.length +
        " artifact(s) in this run/phase decision trail are invalid (" +
        invalid.map((c) => c.source_path).join(", ") +
        ") - the WHOLE trail fails closed. A valid approve elsewhere in the trail does not " +
        "excuse a corrupt or tampered decision file; repair or remove it and re-approve.",
      approved_by: null,
      considered,
      kind_coverage,
    };
  }

  if (current.length > 1) {
    return {
      allowed: false,
      refusal: "conflicting_decisions",
      reason:
        current.length +
        " decisions bind the same proposal hash (" +
        current.map((c) => c.decision.decision).join(", ") +
        ") - §1 permits exactly ONE decision per proposal hash. A trail this ambiguous " +
        "never authorizes dispatch; the user must resolve it and re-approve.",
      approved_by: null,
      considered,
      kind_coverage,
    };
  }

  if (current.length === 1) {
    const sole = current[0];
    const gate: DispatchGateVerdict = dispatchGate(proposal, sole.decision);
    if (gate.allowed) {
      return {
        allowed: true,
        refusal: null,
        reason: gate.reason,
        approved_by: {
          source_path: sole.source_path,
          decision_hash: sole.decision.decision_hash,
        },
        considered,
        kind_coverage,
      };
    }
    return {
      allowed: false,
      refusal: sole.decision.decision === "approve" ? "stale_or_hash_mismatch" : "not_an_approve",
      reason:
        "the sole decision bound to this proposal does not authorize dispatch - " + gate.reason,
      approved_by: null,
      considered,
      kind_coverage,
    };
  }

  const refusal: PreDispatchVerdict["refusal"] = sawMismatch
    ? "stale_or_hash_mismatch"
    : sawNonApprove
      ? "not_an_approve"
      : "no_persisted_decision";
  return {
    allowed: false,
    refusal,
    reason:
      "no persisted decision binds this proposal's recomputed hash - dispatch refused (fails " +
      "closed). A stale or hash-mismatched decision requires renewed user approval.",
    approved_by: null,
    considered,
    kind_coverage,
  };
}

// -- Restructure: idempotent, cap-proof, never self-approving ----------------

export interface RestructurePlan {
  /**
   * The minted iteration, or NULL when the loop CONVERGED (T6B-R1-B4): an
   * iteration whose edits leave the roster byte-identical mints nothing -
   * no new proposal version, no new decision artifact, no new hash.
   */
  result: RestructureResult | null;
  /**
   * True when every edit was already satisfied by the parent. `proposal` then
   * IS the parent, unchanged: the loop has a fixed point instead of churning
   * v2 -> v3 -> v4 on repeated already-applied edits.
   */
  converged: boolean;
  /** The proposal that stands after this iteration (the parent when converged). */
  proposal: TeamProposalV2;
  /** Edits whose effect is ALREADY present in the parent - the idempotence leg. */
  no_op_edits: string[];
  /** Roster ids added/removed WITHOUT a citing edit (must always be empty). */
  uncited_roster_delta: string[];
  /** Cap/truncation keys detected anywhere in the new proposal (must be empty). */
  cap_reintroduction: string[];
  /** Structural verdict on the produced proposal. */
  valid: boolean;
  reasons: string[];
}

const CAP_KEYS = [
  "cap",
  "capped",
  "dropped_roles",
  "max_participants",
  "max_team_size",
  "team_size",
  "size_limit",
  "truncated",
];

/** Deep scan for any cap/truncation key - belt to the closed-schema suspenders. */
export function scanCapReintroduction(
  value: unknown,
  trail: string[] = [],
  out: string[] = []
): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanCapReintroduction(v, [...trail, String(i)], out));
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CAP_KEYS.includes(k)) out.push([...trail, k].join("."));
      scanCapReintroduction(v, [...trail, k], out);
    }
  }
  return out;
}

function idsOf(p: TeamProposalV2): Set<string> {
  return new Set((p.participants ?? []).map((x) => x.participant_id));
}

/** Ids each edit explicitly names - the citation set the roster delta must match. */
function citedIds(edits: readonly RestructureEdit[]): { added: Set<string>; removed: Set<string> } {
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const e of edits) {
    const edit = e as Record<string, any>;
    if (edit["add"]) added.add(String(edit["add"].participant?.participant_id));
    else if (edit["remove"]) removed.add(String(edit["remove"].participant_id));
    else if (edit["substitute"]) {
      removed.add(String(edit["substitute"].participant_id));
      added.add(String(edit["substitute"].participant?.participant_id));
    }
  }
  return { added, removed };
}

/**
 * Plan one restructure-loop iteration: delegate the transform to
 * `applyRestructure` (which owns immutability, the version bump, parent-hash
 * chaining and coverage revalidation), then add the three surface-level
 * guarantees the success criteria name:
 *
 *  1. IDEMPOTENT - and, since round 2 (T6B-R1-B4), CONVERGENT. Determinism
 *     alone was not idempotence: round 1 reported an already-satisfied edit in
 *     `no_op_edits` and then applied it anyway, so re-running "remove p1" over
 *     a v2 that already lacks p1 minted a valid v3 with a fresh hash - a loop
 *     with no fixed point. The convergence test is now SEMANTIC, not a
 *     per-edit heuristic: the produced proposal is compared to the parent with
 *     the version/hash/parent fields normalized away, and if the rosters are
 *     byte-identical NOTHING is minted (`result: null`, `converged: true`,
 *     `proposal` = the untouched parent). That covers every no-op shape,
 *     including an `edit_dependencies` that sets the dependencies a
 *     participant already has.
 *  2. NO SILENT ROSTER LOSS - every id that left or joined the roster must be
 *     cited by an edit; anything else lands in `uncited_roster_delta`.
 *  3. NO CAP, NO AUTO-APPROVE - `cap_reintroduction` scans the produced bytes
 *     for cap/truncation keys, and the result's decision state stays `pending`
 *     (`applyRestructure` never emits an approve; this surface never records
 *     one).
 */
export function planRestructure(proposal: object, input: DecisionInput): RestructurePlan {
  const edits = input.restructure_edits ?? [];
  const parent = proposal as TeamProposalV2;
  const parentIds = idsOf(parent);

  const no_op_edits: string[] = [];
  edits.forEach((e, i) => {
    const edit = e as Record<string, any>;
    if (edit["add"] && parentIds.has(String(edit["add"].participant?.participant_id))) {
      no_op_edits.push(
        "edits[" + i + "] add " + edit["add"].participant?.participant_id + ": already present"
      );
    } else if (edit["remove"] && !parentIds.has(String(edit["remove"].participant_id))) {
      no_op_edits.push(
        "edits[" + i + "] remove " + edit["remove"].participant_id + ": not in the roster"
      );
    } else if (edit["substitute"] && !parentIds.has(String(edit["substitute"].participant_id))) {
      no_op_edits.push(
        "edits[" + i + "] substitute " + edit["substitute"].participant_id + ": not in the roster"
      );
    } else if (
      edit["edit_dependencies"] &&
      !parentIds.has(String(edit["edit_dependencies"].participant_id))
    ) {
      no_op_edits.push(
        "edits[" +
          i +
          "] edit_dependencies " +
          edit["edit_dependencies"].participant_id +
          ": not in the roster"
      );
    }
  });

  // T6B-R1-B4: an iteration with nothing to do mints nothing. `applyRestructure`
  // throws on an empty edit list, so that case converges before the call.
  if (edits.length === 0) {
    return convergedPlan(parent, ["no edits supplied - nothing to apply"]);
  }

  const result = applyRestructure(proposal, input);
  if (contentEquivalent(parent, result.new_proposal)) {
    // Every edit was already satisfied: the transform produced the parent's
    // roster back. Discard the minted version/decision entirely - returning it
    // is what churned v2 -> v3 in the round-1 probe. `applyRestructure` is
    // pure, so nothing reached disk and there is nothing to roll back.
    return convergedPlan(
      parent,
      no_op_edits.length > 0
        ? no_op_edits
        : ["all edits were already satisfied by the parent proposal"]
    );
  }

  const nextIds = idsOf(result.new_proposal);
  const cited = citedIds(edits);

  const uncited_roster_delta: string[] = [];
  for (const id of parentIds) {
    if (!nextIds.has(id) && !cited.removed.has(id)) {
      uncited_roster_delta.push('removed "' + id + '" without a citing remove/substitute edit');
    }
  }
  for (const id of nextIds) {
    if (!parentIds.has(id) && !cited.added.has(id)) {
      uncited_roster_delta.push('added "' + id + '" without a citing add/substitute edit');
    }
  }

  const cap_reintroduction = scanCapReintroduction(result.new_proposal);
  return {
    result,
    converged: false,
    proposal: result.new_proposal,
    no_op_edits,
    uncited_roster_delta,
    cap_reintroduction,
    valid:
      uncited_roster_delta.length === 0 &&
      result.coverage_reasons.length === 0 &&
      cap_reintroduction.length === 0,
    reasons: result.coverage_reasons,
  };
}

/**
 * Fields that identify an ITERATION rather than the team it describes. Two
 * proposals equal on everything else describe the same roster, so minting a
 * new one only to change these is version churn, not a restructure.
 */
const ITERATION_FIELDS = ["proposal_version", "parent_proposal_hash", "proposal_hash"] as const;

/** True when two proposals describe the SAME team (iteration fields ignored). */
function contentEquivalent(a: TeamProposalV2, b: TeamProposalV2): boolean {
  const strip = (p: TeamProposalV2): string => {
    const copy = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    for (const f of ITERATION_FIELDS) delete copy[f];
    return canonicalYaml(copy as never);
  };
  return strip(a) === strip(b);
}

/** The converged (fixed-point) plan: the parent stands, nothing was minted. */
function convergedPlan(parent: TeamProposalV2, no_op_edits: string[]): RestructurePlan {
  const cap_reintroduction = scanCapReintroduction(parent);
  return {
    result: null,
    converged: true,
    proposal: parent,
    no_op_edits,
    uncited_roster_delta: [],
    cap_reintroduction,
    // The parent is whatever it already was; this iteration introduced no
    // finding of its own. A cap already present in the parent still fails.
    valid: cap_reintroduction.length === 0,
    reasons: [],
  };
}

// -- Presentation (pure; every format derives from ONE view model) -----------

/** Short hash for display. Full hashes stay in the artifacts, never on screen. */
export function shortHash(h: unknown): string {
  return typeof h === "string" && h.length >= 12 ? h.slice(0, 12) : "unknown";
}

export interface ProposalReviewView {
  schema_version: "guild.team_decision_view.v1";
  run_id: string;
  phase: string;
  proposal: {
    version: number;
    hash_short: string;
    parent_hash_short: string | null;
    participant_count: number;
    participants: Array<{
      participant_id: string;
      participation_kind: string;
      role_ref: string;
      tier: string;
      purpose: string;
      backend: string;
      capability_scope: string;
      depends_on: string[];
      owned_obligations: string[];
      necessity_rationale: string;
    }>;
    excluded_roles: Array<{ role_ref: string; why_unnecessary: string }>;
  };
  coverage: {
    obligations: number;
    owned: number;
    excluded_with_acceptance: number;
    unowned: string[];
  };
  /** Present only when a parent proposal was supplied - the user's edits. */
  edits: null | {
    parent_version: number;
    parent_hash_short: string;
    added: string[];
    removed: string[];
    changed: string[];
    obligations_lost: string[];
  };
  decision: {
    state: "pending" | "approved" | "restructured" | "refused";
    vocabulary: readonly string[];
    /** null until a persisted approve authorizes dispatch. */
    approved_hash_short: string | null;
    gate_reason: string;
  };
  schedule: null | {
    backend: string;
    verified_backend_capacity: number;
    selected_hint: number | null;
    effective: number;
    clamp_diagnostic: string | null;
    waves: string[][];
    set_invariants: string;
  };
  kind_coverage: Array<{ participation_kind: string; participants: number; gated: boolean }>;
}

function scopeLabel(scope: string[] | null | undefined): string {
  return scope === null || scope === undefined ? "unscoped" : scope.join(",") || "unscoped";
}

/**
 * Build the ONE view model every rendering (text and JSON) derives from, so no
 * host surface can show a different team than another host surface. Pure: no
 * clock, no I/O, nothing mutated.
 */
export function buildProposalReview(input: {
  proposal: TeamProposalV2;
  previous?: TeamProposalV2 | null;
  gate?: PreDispatchVerdict | null;
  schedule?: TeamScheduleV1 | null;
  decision?: TeamDecisionV1 | null;
  lost_obligations?: readonly string[];
}): ProposalReviewView {
  const p = input.proposal;
  const participants = p.participants ?? [];
  const obligations = p.obligations ?? [];
  const ids = new Set(participants.map((x) => x.participant_id));

  const unowned: string[] = [];
  let owned = 0;
  let excludedAccepted = 0;
  for (const ob of obligations) {
    const owners = ob.disposition?.owners ?? [];
    const hasOwner = owners.some((o) => ids.has(o));
    const exclusion = ob.disposition?.exclusion;
    if (hasOwner) owned++;
    else if (exclusion && exclusion.user_accepted === true) excludedAccepted++;
    else unowned.push(ob.obligation_id);
  }

  let edits: ProposalReviewView["edits"] = null;
  if (input.previous) {
    const prevIds = new Set((input.previous.participants ?? []).map((x) => x.participant_id));
    const prevById = new Map(
      (input.previous.participants ?? []).map((x) => [x.participant_id, x])
    );
    const added = [...ids].filter((id) => !prevIds.has(id)).sort();
    const removed = [...prevIds].filter((id) => !ids.has(id)).sort();
    const changed = participants
      .filter((x) => {
        const before = prevById.get(x.participant_id);
        return before !== undefined && JSON.stringify(before) !== JSON.stringify(x);
      })
      .map((x) => x.participant_id)
      .sort();
    edits = {
      parent_version: input.previous.proposal_version ?? 1,
      parent_hash_short: shortHash(input.previous.proposal_hash),
      added,
      removed,
      changed,
      obligations_lost: [...(input.lost_obligations ?? [])].sort(),
    };
  }

  const gate = input.gate ?? null;
  const state: ProposalReviewView["decision"]["state"] = gate?.allowed
    ? "approved"
    : input.decision?.decision === "restructure"
      ? "restructured"
      : gate === null
        ? "pending"
        : "refused";

  let schedule: ProposalReviewView["schedule"] = null;
  if (input.schedule) {
    const s = input.schedule;
    let invariants = "not checked (no approve decision supplied)";
    if (input.decision) {
      const verdict = validateScheduleSets(p, s, input.decision);
      invariants = verdict.valid
        ? "approved set = wave union = receipt ids = terminal ids (set equality holds)"
        : "VIOLATION - " + (verdict.reason ?? "unspecified");
    }
    schedule = {
      backend: s.backend,
      verified_backend_capacity: s.concurrency.verified_backend_capacity,
      selected_hint: s.concurrency.selected_hint,
      effective: s.concurrency.effective,
      clamp_diagnostic: s.concurrency.clamp_diagnostic,
      waves: s.base_waves.map((w) => [...w]),
      set_invariants: invariants,
    };
  }

  return {
    schema_version: "guild.team_decision_view.v1",
    run_id: p.run_id,
    phase: p.phase,
    proposal: {
      version: p.proposal_version ?? 1,
      hash_short: shortHash(p.proposal_hash),
      parent_hash_short: p.parent_proposal_hash ? shortHash(p.parent_proposal_hash) : null,
      participant_count: participants.length,
      participants: participants.map((x) => ({
        participant_id: x.participant_id,
        participation_kind: x.participation_kind,
        role_ref: x.role_ref,
        tier: x.tier,
        purpose: x.purpose,
        backend: x.backend,
        capability_scope: scopeLabel(x.capability_scope),
        depends_on: [...(x.depends_on ?? [])],
        owned_obligations: [...(x.owned_obligations ?? [])],
        necessity_rationale: x.necessity_rationale,
      })),
      excluded_roles: (p.excluded_roles ?? []).map((e) => ({ ...e })),
    },
    coverage: {
      obligations: obligations.length,
      owned,
      excluded_with_acceptance: excludedAccepted,
      unowned,
    },
    edits,
    decision: {
      state,
      vocabulary: DECISION_VOCABULARY,
      approved_hash_short: gate?.approved_by ? shortHash(gate.approved_by.decision_hash) : null,
      gate_reason: gate?.reason ?? "no gate evaluated yet - the decision is pending",
    },
    schedule,
    kind_coverage: gate?.kind_coverage ?? kindCoverage(participants),
  };
}

function table(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  return rows.map((r) => r.map((cell, c) => (cell ?? "").padEnd(widths[c])).join("  ").trimEnd());
}

/**
 * Render the view as the text every host command surface prints. Deterministic
 * and ASCII-only, so the bytes are identical on every host.
 */
export function renderProposalReview(view: ProposalReviewView): string {
  const L: string[] = [];
  L.push("guild team decision - run " + view.run_id + " | phase " + view.phase);
  L.push(
    "proposal v" +
      view.proposal.version +
      " (" +
      view.proposal.hash_short +
      ")" +
      (view.proposal.parent_hash_short ? " | parent " + view.proposal.parent_hash_short : "") +
      " | " +
      view.proposal.participant_count +
      " participants (UNCAPPED - task-derived)"
  );
  L.push("");
  L.push("PROPOSED TEAM");
  L.push(
    ...table([
      ["id", "kind", "role", "tier", "purpose", "backend", "scope", "depends_on"],
      ...view.proposal.participants.map((p) => [
        p.participant_id,
        p.participation_kind,
        p.role_ref,
        p.tier,
        p.purpose,
        p.backend,
        p.capability_scope,
        p.depends_on.join(",") || "-",
      ]),
    ]).map((l) => "  " + l)
  );
  L.push("");
  L.push("NECESSITY");
  for (const p of view.proposal.participants) {
    L.push("  " + p.participant_id + ": " + p.necessity_rationale);
  }
  if (view.proposal.excluded_roles.length > 0) {
    L.push("");
    L.push("EXCLUDED ROLES");
    for (const e of view.proposal.excluded_roles) {
      L.push("  " + e.role_ref + ": " + e.why_unnecessary);
    }
  }
  L.push("");
  L.push(
    "COVERAGE  obligations=" +
      view.coverage.obligations +
      " owned=" +
      view.coverage.owned +
      " excluded-with-user-acceptance=" +
      view.coverage.excluded_with_acceptance +
      " unowned=" +
      view.coverage.unowned.length
  );
  if (view.coverage.unowned.length > 0) {
    L.push("  UNOWNED (invalidates the proposal): " + view.coverage.unowned.join(", "));
  }

  if (view.edits) {
    L.push("");
    L.push(
      "YOUR EDITS (vs v" + view.edits.parent_version + " " + view.edits.parent_hash_short + ")"
    );
    L.push("  added:   " + (view.edits.added.join(", ") || "-"));
    L.push("  removed: " + (view.edits.removed.join(", ") || "-"));
    L.push("  changed: " + (view.edits.changed.join(", ") || "-"));
    L.push(
      "  COVERAGE IMPACT: " +
        (view.edits.obligations_lost.length === 0
          ? "no obligation lost its owner"
          : "obligations left unowned - " + view.edits.obligations_lost.join(", "))
    );
  }

  L.push("");
  L.push("GATE COVERAGE (no kind is exempt)");
  L.push(
    ...table([
      ["participation_kind", "participants", "gated"],
      ...view.kind_coverage.map((k) => [
        k.participation_kind,
        String(k.participants),
        k.gated ? "yes" : "NO",
      ]),
    ]).map((l) => "  " + l)
  );

  if (view.schedule) {
    L.push("");
    L.push(
      "BACKEND SCHEDULE  backend=" +
        view.schedule.backend +
        " verified_capacity=" +
        view.schedule.verified_backend_capacity +
        " hint=" +
        (view.schedule.selected_hint === null ? "none" : view.schedule.selected_hint) +
        " effective=" +
        view.schedule.effective
    );
    if (view.schedule.clamp_diagnostic) L.push("  clamp: " + view.schedule.clamp_diagnostic);
    view.schedule.waves.forEach((w, i) => L.push("  wave " + (i + 1) + ": " + w.join(", ")));
    L.push("  invariants: " + view.schedule.set_invariants);
    L.push("  (capacity shapes WAVES, never the roster - Guild never drops a specialist)");
  }

  L.push("");
  L.push("DECISION  state=" + view.decision.state);
  L.push("  gate: " + view.decision.gate_reason);
  if (view.decision.approved_hash_short) {
    L.push("  authorized by decision " + view.decision.approved_hash_short);
  }
  L.push("  your options: " + view.decision.vocabulary.join(" | "));
  L.push(
    "  approve is a USER act - Guild never auto-approves, and an agent identity can never decide."
  );
  return L.join("\n") + "\n";
}

/** Render the post-restructure impact block (edits + coverage + next state). */
export function renderRestructurePlan(plan: RestructurePlan): string {
  const L: string[] = [];
  if (plan.result === null) {
    // CONVERGED (T6B-R1-B4): the loop reached its fixed point. Say so
    // explicitly and print the UNCHANGED identity, so an operator reading this
    // can see no version was minted rather than inferring it from silence.
    L.push(
      "restructure CONVERGED - proposal v" +
        (plan.proposal.proposal_version ?? 1) +
        " (" +
        shortHash(plan.proposal.proposal_hash) +
        ") is UNCHANGED; no new version, hash or decision was minted"
    );
    L.push("  idempotence: every edit was already satisfied by the current proposal -");
    for (const n of plan.no_op_edits) L.push("    " + n);
    if (plan.cap_reintroduction.length > 0) {
      L.push("  CAP PRESENT IN THE CURRENT PROPOSAL (fails closed): " + plan.cap_reintroduction.join(", "));
    }
    L.push("  decision state: unchanged (the current proposal keeps whatever decision it had)");
    return L.join("\n") + "\n";
  }
  const np = plan.result.new_proposal;
  L.push(
    "restructure -> proposal v" +
      np.proposal_version +
      " (" +
      shortHash(np.proposal_hash) +
      ") parent " +
      shortHash(np.parent_proposal_hash)
  );
  L.push("  decision state: " + plan.result.new_decision_state + " (a NEW user decision is required)");
  if (plan.no_op_edits.length > 0) {
    L.push("  idempotence: these edits were already satisfied by the parent -");
    for (const n of plan.no_op_edits) L.push("    " + n);
  }
  L.push(
    "  coverage impact: " +
      (plan.result.lost_obligations.length === 0
        ? "no obligation lost its owner"
        : "LOST OWNERS - " + plan.result.lost_obligations.join(", "))
  );
  if (plan.uncited_roster_delta.length > 0) {
    L.push("  ROSTER INTEGRITY VIOLATION (fails closed):");
    for (const d of plan.uncited_roster_delta) L.push("    " + d);
  }
  if (plan.cap_reintroduction.length > 0) {
    L.push("  CAP REINTRODUCED (fails closed): " + plan.cap_reintroduction.join(", "));
  }
  if (plan.reasons.length > 0) {
    L.push("  structural findings: " + plan.reasons.join("; "));
  }
  return L.join("\n") + "\n";
}

/** Re-export of the delegated gate so callers never hand-roll the check. */
export { dispatchGate, proposalHashOf };
