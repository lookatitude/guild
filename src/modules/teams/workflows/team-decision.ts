/**
 * src/modules/teams/workflows/team-decision.ts
 *
 * T2b (dynamic-host-model-routing) — `guild.team_decision.v1`: exactly one user
 * decision per proposal hash (team-contracts §4).
 *
 * - A decision BINDS a proposal by its §1 self-referential hash. ANY relevant
 *   edit to the proposal (participant, obligation, dependency, tier/purpose,
 *   capability scope, backend, wave structure, concurrency, cost posture,
 *   review independence — i.e. any byte of the hashed value) changes the
 *   recomputed hash and INVALIDATES the prior decision.
 * - The DISPATCH GATE accepts only a current `approve` whose `proposal_hash`
 *   equals the hash RECOMPUTED from the proposal artifact; stale or mismatched
 *   decisions fail closed. Guild NEVER auto-approves — no decision, no dispatch.
 * - `restructure` never mutates approved/proposed bytes: it yields a NEW
 *   proposal (version+1, `parent_proposal_hash` set) plus a new PENDING
 *   decision state, revalidating obligation coverage and surfacing lost
 *   obligations before acceptance.
 */

import { cloneArtifact, isSha256Hex, selfReferentialHash, canonicalYaml } from "./canonical-hash";
import {
  validateProposal,
  type ProposalParticipant,
  type TeamProposalV2,
} from "./team-proposal";
import { writeRunArtifact } from "./station-signals";

export const TEAM_DECISION_SCHEMA = "guild.team_decision.v1" as const;
export const DECISION_HASH_ALGORITHM = "sha256" as const;
export const DECISION_HASH_SCOPE =
  "canonical_yaml_with_decision_hash_field_omitted" as const;

export type DecisionKind = "approve" | "restructure";

/** One §4 restructure edit — exactly one operation key per entry. */
export type RestructureEdit =
  | { add: { participant: ProposalParticipant } }
  | { remove: { participant_id: string } }
  | { substitute: { participant_id: string; participant: ProposalParticipant } }
  | { edit_dependencies: { participant_id: string; depends_on: string[] } };

export interface TeamDecisionV1 {
  schema_version: typeof TEAM_DECISION_SCHEMA;
  run_id: string;
  phase: string;
  proposal_hash: string;
  decision: DecisionKind;
  /**
   * Frozen §4 string field, ALWAYS the canonical `<kind>[:<id>]@<channel>`
   * serialization of a typed user/operator actor (see the allowlist section
   * below) — never a free-form identity.
   */
  decided_by: string;
  decided_at: string;
  restructure_edits?: RestructureEdit[];
  resulting_proposal: { version: number; hash: string } | null;
  decision_hash_algorithm: typeof DECISION_HASH_ALGORITHM;
  decision_hash_scope: typeof DECISION_HASH_SCOPE;
  decision_hash: string;
}

export interface DecisionInput {
  decision: DecisionKind;
  /**
   * The deciding actor as a TYPED object — `{kind: "user" | "operator", id?}`.
   * Bare strings are rejected (rework round 3, T2B-R2-F1): user origin is
   * affirmed structurally, never inferred from an agent-name denylist.
   */
  decided_by: DecisionActor;
  /** REQUIRED provenance: which user-confirmation surface carried the decision. */
  decision_channel: DecisionChannel;
  decided_at?: string;
  restructure_edits?: RestructureEdit[];
}

export interface DispatchGateVerdict {
  allowed: boolean;
  reason: string;
}

/** Recompute a proposal's §1 self-referential hash from its current bytes. */
export function proposalHashOf(proposal: object): string {
  return selfReferentialHash(proposal as Record<string, unknown>, "proposal_hash");
}

// ── §4 user-actor boundary (STRUCTURAL ALLOWLIST — rework round 3) ───────────
//
// Round 2 (T2B-R2-F1) proved the exact-token denylist bypassable: any unlisted
// agent identity ("agent7", "claude3", "worker", "reviewer", "openai") recorded
// a valid approve. Inverted: a decision is valid ONLY when its actor is
// AFFIRMATIVELY a user/operator — a typed actor (kind in a closed enum) plus a
// closed-enum decision-channel provenance. Anything else — bare identity
// strings, unknown kinds, absent provenance — is rejected. Nothing is inferred
// from what an identity is NOT.
//
// Mapping onto the FROZEN artifact schema (team-contracts §4 freezes
// `decided_by: string`; guild.team_decision.v1 is a closed schema, so no new
// field may be added): the typed actor + channel serialize into the frozen
// string field under the canonical grammar
//
//   decided_by := <kind> [":" <id>] "@" <channel>
//     kind    ∈ DECISION_ACTOR_KINDS   (closed: user | operator)
//     id      =~ /^[a-z0-9][a-z0-9._-]{0,63}$/   (optional operator identity)
//     channel ∈ DECISION_CHANNELS      (closed provenance enum)
//
// e.g. "user@interactive_prompt", "operator:miguel@terminal_prompt".
// `validateDecision` re-parses the persisted string against this grammar —
// only canonical serializations of an allowed actor validate; any other string
// (including every pre-round-3 form) fails closed.

/** Closed §4 actor kinds — the ONLY identities that may decide. */
export const DECISION_ACTOR_KINDS = ["user", "operator"] as const;
export type DecisionActorKind = (typeof DECISION_ACTOR_KINDS)[number];

/**
 * Closed provenance enum: the user-confirmation surface a decision arrived on.
 * - `interactive_prompt` — host-native question UI (e.g. AskUserQuestion).
 * - `terminal_prompt`    — a terminal y/n confirmation read from the user.
 * - `file_gate`          — the Guild file-bus decision gate (hosts without a
 *                          native question UI; the user writes the decision file).
 * Extending this enum is a contract-reviewed change, never ad hoc.
 */
export const DECISION_CHANNELS = [
  "interactive_prompt",
  "terminal_prompt",
  "file_gate",
] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];

/** Typed §4 deciding actor — the only shape `recordDecision` accepts. */
export interface DecisionActor {
  kind: DecisionActorKind;
  /** Optional operator identity (e.g. "miguel"); lowercase [a-z0-9._-]. */
  id?: string;
}

const ACTOR_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const ACTOR_KIND_SET: ReadonlySet<string> = new Set(DECISION_ACTOR_KINDS);
const CHANNEL_SET: ReadonlySet<string> = new Set(DECISION_CHANNELS);

/**
 * Validate a typed actor object (closed keys, closed kind enum, id shape).
 * Bare strings — including "user", "operator:miguel", and every agent-side
 * identity — are NOT actors; user origin is typed, never guessed from a name.
 */
export function validateDecisionActor(actor: unknown): DecisionVerdict {
  const reasons: string[] = [];
  if (actor === null || typeof actor !== "object" || Array.isArray(actor)) {
    return {
      valid: false,
      reasons: [
        "decided_by must be a typed actor object {kind: \"user\" | \"operator\", id?} — " +
          "bare identity strings are rejected (§4 user-actor allowlist)",
      ],
    };
  }
  const a = actor as Record<string, unknown>;
  for (const key of Object.keys(a)) {
    if (key !== "kind" && key !== "id") {
      reasons.push(`unknown actor key "${key}" — the §4 actor shape is closed`);
    }
  }
  if (typeof a["kind"] !== "string" || !ACTOR_KIND_SET.has(a["kind"])) {
    reasons.push(
      `actor kind must be one of {${DECISION_ACTOR_KINDS.join(", ")}} — ` +
        "any other kind (including every agent-side identity) is rejected"
    );
  }
  if (a["id"] !== undefined && (typeof a["id"] !== "string" || !ACTOR_ID_RE.test(a["id"]))) {
    reasons.push("actor id, when present, must match /^[a-z0-9][a-z0-9._-]{0,63}$/");
  }
  return { valid: reasons.length === 0, reasons };
}

/** Serialize a validated actor + channel into the frozen `decided_by` string. */
export function formatDecidedBy(actor: DecisionActor, channel: DecisionChannel): string {
  return `${actor.kind}${actor.id !== undefined ? `:${actor.id}` : ""}@${channel}`;
}

export interface ParsedDecidedBy {
  kind: DecisionActorKind;
  id: string | null;
  channel: DecisionChannel;
}

/**
 * Structurally parse a persisted `decided_by` string. Returns the actor +
 * provenance ONLY when the string is the exact canonical serialization of an
 * allowed user/operator actor; anything else — bare identities ("user",
 * "codex-lane", "agent7"), unknown kinds, missing/unknown channels — returns
 * null and fails the §4 boundary closed.
 */
export function parseDecidedBy(value: unknown): ParsedDecidedBy | null {
  if (typeof value !== "string") return null;
  const at = value.split("@");
  if (at.length !== 2) return null;
  const [actorPart, channel] = at;
  if (!CHANNEL_SET.has(channel)) return null;
  const colon = actorPart.split(":");
  if (colon.length > 2) return null;
  const [kind, id] = colon;
  if (!ACTOR_KIND_SET.has(kind)) return null;
  if (id !== undefined && !ACTOR_ID_RE.test(id)) return null;
  return {
    kind: kind as DecisionActorKind,
    id: id ?? null,
    channel: channel as DecisionChannel,
  };
}

/**
 * True iff `value` is a canonical §4 user/operator serialization. The round-2
 * denylist (`isUserActor` over agent-name tokens) is GONE — this is the
 * affirmative replacement; unlisted identities no longer pass by default.
 */
export function isUserActor(value: unknown): value is string {
  return parseDecidedBy(value) !== null;
}

const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

const DECISION_KEYS: ReadonlySet<string> = new Set([
  "schema_version",
  "run_id",
  "phase",
  "proposal_hash",
  "decision",
  "decided_by",
  "decided_at",
  "restructure_edits",
  "resulting_proposal",
  "decision_hash_algorithm",
  "decision_hash_scope",
  "decision_hash",
]);

export interface DecisionVerdict {
  valid: boolean;
  reasons: string[];
}

/**
 * Fail-closed validation of a `guild.team_decision.v1` artifact (§4): closed
 * schema, non-empty run/phase, sha256 proposal binding, decision enum,
 * user-actor `decided_by`, RFC3339 `decided_at`, restructure_edits present iff
 * restructure, exact §1 convention literals, and a `decision_hash` that
 * matches the §1 recomputation (hash field omitted). Anything malformed or
 * tampered is invalid — the gate never "checks when present".
 */
export function validateDecision(obj: unknown): DecisionVerdict {
  const reasons: string[] = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { valid: false, reasons: ["decision must be a plain object"] };
  }
  const d = obj as Record<string, unknown>;
  for (const key of Object.keys(d)) {
    if (!DECISION_KEYS.has(key)) {
      reasons.push(`unknown key "${key}" — guild.team_decision.v1 is a closed schema`);
    }
  }
  if (d["schema_version"] !== TEAM_DECISION_SCHEMA) {
    reasons.push(`schema_version must be ${TEAM_DECISION_SCHEMA}`);
  }
  if (typeof d["run_id"] !== "string" || d["run_id"].trim() === "") {
    reasons.push("run_id must be a non-empty string");
  }
  if (typeof d["phase"] !== "string" || d["phase"].trim() === "") {
    reasons.push("phase must be a non-empty string");
  }
  if (!isSha256Hex(d["proposal_hash"])) {
    reasons.push("proposal_hash must be a sha256 hex string (the §1 binding to the proposal)");
  }
  if (d["decision"] !== "approve" && d["decision"] !== "restructure") {
    reasons.push('decision must be "approve" or "restructure"');
  }
  if (parseDecidedBy(d["decided_by"]) === null) {
    reasons.push(
      "decided_by must be the canonical serialization of an allowed user/operator actor " +
        "(<kind>[:<id>]@<channel>, kind ∈ {user, operator}, channel ∈ " +
        `{${DECISION_CHANNELS.join(", ")}}) — an agent identity can never approve a team ` +
        "(§4 user-actor allowlist; nothing outside the grammar validates)"
    );
  }
  if (typeof d["decided_at"] !== "string" || !RFC3339_RE.test(d["decided_at"])) {
    reasons.push("decided_at must be an RFC3339 timestamp");
  }
  if (d["decision"] === "restructure") {
    if (!Array.isArray(d["restructure_edits"]) || d["restructure_edits"].length === 0) {
      reasons.push("a restructure decision requires a non-empty restructure_edits array");
    }
  } else if (d["restructure_edits"] !== undefined) {
    reasons.push("restructure_edits is present iff decision=restructure");
  }
  const rp = d["resulting_proposal"];
  if (rp !== null) {
    if (
      rp === undefined ||
      typeof rp !== "object" ||
      Array.isArray(rp) ||
      typeof (rp as Record<string, unknown>)["version"] !== "number" ||
      !isSha256Hex((rp as Record<string, unknown>)["hash"])
    ) {
      reasons.push("resulting_proposal must be null or {version: number, hash: sha256}");
    }
  }
  if (d["decision_hash_algorithm"] !== DECISION_HASH_ALGORITHM) {
    reasons.push(`decision_hash_algorithm is required and must be "${DECISION_HASH_ALGORITHM}"`);
  }
  if (d["decision_hash_scope"] !== DECISION_HASH_SCOPE) {
    reasons.push(`decision_hash_scope is required and must be exactly "${DECISION_HASH_SCOPE}"`);
  }
  if (!isSha256Hex(d["decision_hash"])) {
    reasons.push("decision_hash is required and must be a sha256 hex string");
  } else if (reasons.length === 0) {
    const recomputed = selfReferentialHash(d, "decision_hash");
    if (recomputed !== d["decision_hash"]) {
      reasons.push("decision_hash mismatch — the decision artifact was altered after recording; fails closed");
    }
  }
  return { valid: reasons.length === 0, reasons };
}

/**
 * Record a user decision over a proposal (team-contracts §4). The proposal is
 * FULLY validated first (rework F2: recording a decision over a malformed
 * proposal is refused — `recordDecision({}, …)` throws). Snapshots the
 * proposal's §1 hash AT DECISION TIME — later mutations of the proposal object
 * cannot retroactively ride this decision (the dispatch gate recomputes and
 * compares). The decision artifact itself is §1-hashed (`decision_hash`).
 */
export function recordDecision(
  proposal: object,
  input: DecisionInput
): TeamDecisionV1 {
  const proposalVerdict = validateProposal(proposal);
  if (!proposalVerdict.valid) {
    throw new Error(
      `recordDecision: refusing to record a decision over an invalid guild.team_proposal.v2 — ${proposalVerdict.reasons.join("; ")}`
    );
  }
  const actorVerdict = validateDecisionActor(input.decided_by);
  if (!actorVerdict.valid) {
    throw new Error(
      `recordDecision: decided_by ${JSON.stringify(input.decided_by)} is not an allowed ` +
        `user/operator actor — ${actorVerdict.reasons.join("; ")} ` +
        "(§4 user-actor allowlist: approval is a USER act; an agent identity can never decide)"
    );
  }
  if (
    typeof input.decision_channel !== "string" ||
    !CHANNEL_SET.has(input.decision_channel)
  ) {
    throw new Error(
      "recordDecision: decision_channel is required and must be one of " +
        `{${DECISION_CHANNELS.join(", ")}} — a decision without user-confirmation ` +
        "provenance is never recorded (§4 user-actor allowlist)"
    );
  }
  if (input.decision !== "approve" && input.decision !== "restructure") {
    throw new Error('recordDecision: decision must be "approve" or "restructure"');
  }
  if (input.decision === "restructure" && !(input.restructure_edits?.length)) {
    throw new Error("recordDecision: a restructure decision requires restructure_edits");
  }
  if (input.decided_at !== undefined && !RFC3339_RE.test(input.decided_at)) {
    throw new Error("recordDecision: decided_at must be an RFC3339 timestamp");
  }
  const p = proposal as Partial<TeamProposalV2>;
  const decision: Omit<TeamDecisionV1, "decision_hash"> = {
    schema_version: TEAM_DECISION_SCHEMA,
    run_id: typeof p.run_id === "string" ? p.run_id : "",
    phase: typeof p.phase === "string" ? p.phase : "",
    proposal_hash: proposalHashOf(proposal),
    decision: input.decision,
    decided_by: formatDecidedBy(input.decided_by, input.decision_channel),
    decided_at: input.decided_at ?? new Date().toISOString(),
    ...(input.decision === "restructure"
      ? { restructure_edits: cloneArtifact(input.restructure_edits ?? []) }
      : {}),
    resulting_proposal: null,
    decision_hash_algorithm: DECISION_HASH_ALGORITHM,
    decision_hash_scope: DECISION_HASH_SCOPE,
  };
  const full: TeamDecisionV1 = {
    ...decision,
    decision_hash: selfReferentialHash(
      decision as unknown as Record<string, unknown>,
      "decision_hash"
    ),
  };
  return full;
}

/**
 * The §4 DISPATCH GATE. Dispatch is allowed ONLY when:
 *  1. the PROPOSAL is a fully valid guild.team_proposal.v2 (rework F2: a
 *     malformed proposal — empty run_id/phase, missing frozen fields, bad
 *     embedded hash — fails closed; `dispatchGate({}, …)` is refused),
 *  2. a decision exists (Guild never auto-approves),
 *  3. the decision is a fully valid guild.team_decision.v1 (schema, user-actor
 *     decided_by, §1-verified decision_hash — a tampered decision fails closed),
 *  4. it is an `approve`,
 *  5. its run_id/phase BIND the proposal's run_id/phase,
 *  6. its `proposal_hash` equals the hash RECOMPUTED from the proposal artifact
 *     under the §1 self-referential rule — any mutation since approval
 *     invalidates it.
 */
export function dispatchGate(
  proposal: object,
  decision: TeamDecisionV1 | null | undefined
): DispatchGateVerdict {
  const proposalVerdict = validateProposal(proposal);
  if (!proposalVerdict.valid) {
    return {
      allowed: false,
      reason: `proposal is not a valid guild.team_proposal.v2 — dispatch refused (fails closed): ${proposalVerdict.reasons.join("; ")}`,
    };
  }
  if (decision === null || decision === undefined) {
    return {
      allowed: false,
      reason:
        "no user decision recorded for this proposal — dispatch refused (Guild never auto-approves; approval requires user confirmation)",
    };
  }
  const decisionVerdict = validateDecision(decision);
  if (!decisionVerdict.valid) {
    return {
      allowed: false,
      reason: `decision is not a valid guild.team_decision.v1 — dispatch refused (fails closed): ${decisionVerdict.reasons.join("; ")}`,
    };
  }
  if (decision.decision !== "approve") {
    return {
      allowed: false,
      reason: `decision is "${decision.decision}", not an approve — dispatch requires a current approve decision`,
    };
  }
  const p = proposal as TeamProposalV2;
  if (decision.run_id !== p.run_id || decision.phase !== p.phase) {
    return {
      allowed: false,
      reason:
        "decision run_id/phase do not bind this proposal's run_id/phase — a decision for another run or phase never authorizes dispatch",
    };
  }
  const recomputedProposalHash = proposalHashOf(proposal);
  if (recomputedProposalHash !== decision.proposal_hash) {
    return {
      allowed: false,
      reason:
        "proposal hash mismatch — the proposal's recomputed §1 hash differs from the approved hash; the prior approval is invalidated and renewed user approval is required",
    };
  }
  return { allowed: true, reason: "current approve decision matches the recomputed proposal hash" };
}

// ── Restructure (never mutates bytes; yields a NEW pending proposal) ─────────

export interface RestructureResult {
  new_proposal: TeamProposalV2;
  /** The restructure decision recorded over the ORIGINAL proposal. */
  restructure_decision: TeamDecisionV1;
  /** The new proposal awaits its OWN user decision. */
  new_decision_state: "pending";
  /** Obligation ids left with NO present owner after the edits (surfaced BEFORE acceptance). */
  lost_obligations: string[];
  /** Structural findings on the new proposal (coverage revalidated per edit). */
  coverage_reasons: string[];
}

/**
 * Apply a `restructure` decision (team-contracts §4): deep-clone the proposal,
 * apply add/remove/substitute/edit_dependencies edits to the CLONE, bump
 * `proposal_version`, set `parent_proposal_hash` to the ORIGINAL's §1 hash,
 * recompute the new proposal's hash, and return it in a PENDING decision state.
 * The original artifact is byte-preserved in the trail (never mutated).
 * Coverage is revalidated; obligations losing their last present owner are
 * returned in `lost_obligations` so they are surfaced before acceptance.
 */
export function applyRestructure(
  proposal: object,
  input: DecisionInput
): RestructureResult {
  if (input.decision !== "restructure") {
    throw new Error('applyRestructure: input.decision must be "restructure"');
  }
  const edits = input.restructure_edits ?? [];
  if (edits.length === 0) {
    throw new Error("applyRestructure: restructure requires at least one edit");
  }
  const original = proposal as TeamProposalV2;
  const parentHash = proposalHashOf(proposal);
  const restructure_decision = recordDecision(proposal, input);

  const next = cloneArtifact(original);
  for (const edit of edits) {
    if ("add" in edit) {
      next.participants.push(cloneArtifact(edit.add.participant));
    } else if ("remove" in edit) {
      next.participants = next.participants.filter(
        (p) => p.participant_id !== edit.remove.participant_id
      );
    } else if ("substitute" in edit) {
      next.participants = next.participants.map((p) =>
        p.participant_id === edit.substitute.participant_id
          ? cloneArtifact(edit.substitute.participant)
          : p
      );
    } else if ("edit_dependencies" in edit) {
      next.participants = next.participants.map((p) =>
        p.participant_id === edit.edit_dependencies.participant_id
          ? { ...p, depends_on: [...edit.edit_dependencies.depends_on] }
          : p
      );
    } else {
      throw new Error("applyRestructure: unknown restructure edit shape");
    }
  }

  next.proposal_version = (original.proposal_version ?? 1) + 1;
  next.parent_proposal_hash = parentHash;
  // Keep the non-binding preview consistent with the edited participant set:
  // removed ids leave the waves; new ids append as trailing singleton waves.
  const nextIds = new Set(next.participants.map((p) => p.participant_id));
  if (next.proposed_schedule) {
    const seen = new Set<string>();
    next.proposed_schedule.waves = next.proposed_schedule.waves
      .map((w) => w.filter((id) => nextIds.has(id) && !seen.has(id) && (seen.add(id), true)))
      .filter((w) => w.length > 0);
    for (const p of next.participants) {
      if (!seen.has(p.participant_id)) next.proposed_schedule.waves.push([p.participant_id]);
    }
  }
  delete next.proposal_hash;
  next.proposal_hash = selfReferentialHash(
    next as unknown as Record<string, unknown>,
    "proposal_hash"
  );

  // Coverage revalidation: surface obligations whose owner set no longer
  // intersects the new participant set (lost criteria surface BEFORE acceptance).
  const lost_obligations: string[] = [];
  for (const ob of next.obligations ?? []) {
    const owners = ob.disposition?.owners ?? [];
    const stillOwned = owners.some((o) => nextIds.has(o));
    const excluded = ob.disposition?.exclusion !== undefined;
    if (!stillOwned && !excluded) lost_obligations.push(ob.obligation_id);
  }
  const verdict = validateProposal(next);

  restructure_decision.resulting_proposal = {
    version: next.proposal_version,
    hash: next.proposal_hash,
  };
  // resulting_proposal is set AFTER hashing the decision core; re-stamp the
  // decision hash so the recorded artifact stays self-consistent.
  const restamped: Record<string, unknown> = { ...restructure_decision };
  delete restamped["decision_hash"];
  restructure_decision.decision_hash = selfReferentialHash(restamped, "decision_hash");

  return {
    new_proposal: next,
    restructure_decision,
    new_decision_state: "pending",
    lost_obligations,
    coverage_reasons: verdict.reasons,
  };
}

/**
 * Persist a decision under `.guild/runs/<run-id>/team-plan/` as
 * `<phase>.decision.<first12-of-decision-hash>.yaml` (immutable — §1 trail).
 */
export function writeDecision(
  cwd: string,
  decision: TeamDecisionV1,
  opts: { guildDir?: string } = {}
): string {
  const verdict = validateDecision(decision);
  if (!verdict.valid) {
    throw new Error(
      `writeDecision: refusing to persist an invalid guild.team_decision.v1 — ${verdict.reasons.join("; ")}`
    );
  }
  const filename = `${decision.phase}.decision.${decision.decision_hash.slice(0, 12)}.yaml`;
  return writeRunArtifact(cwd, decision.run_id, "team-plan", filename, canonicalYaml(decision), {
    guildDir: opts.guildDir,
    immutable: true,
  });
}
