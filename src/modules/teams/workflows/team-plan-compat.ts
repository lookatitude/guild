/**
 * src/modules/teams/workflows/team-plan-compat.ts
 *
 * T2b (dynamic-host-model-routing) — the versioned `guild.team_plan.v1`
 * compatibility reader + the §6 legacy scheduling-input resolver
 * (team-contracts §6–§7; two-release migration window).
 *
 * §6 — legacy scheduling inputs are TEMPORARY CONCURRENCY PREFERENCES only:
 *   precedence: explicit v2 scheduling value > positive `--team-size N`
 *   (mapped to a run-local `max_concurrency_hint`) > positive
 *   `defaults.team.size`; missing ⇒ verified backend capacity. Effective
 *   concurrency = min(selected_hint, verified capacity) with a clamp
 *   diagnostic. `allow_larger` is a WARNED NO-OP. Zero/negative/malformed
 *   values are REJECTED. NONE of these inputs can cap, filter, or reorder the
 *   logical roster. Legacy bytes are never rewritten.
 *
 * §7 — legacy `guild.team_plan.v1` artifacts stay READABLE for the window; v2
 *   NEVER emits `cap`/`capped`/`dropped_roles`. A capped/lossy artifact is
 *   UNTRUSTED: it requires v2 recomposition + fresh user approval. A non-lossy
 *   artifact imports ONLY as a PENDING v2 proposal (version 1, provenance
 *   noted) — never as an approval.
 */

import {
  PROPOSAL_HASH_ALGORITHM,
  PROPOSAL_HASH_SCOPE,
  TEAM_PROPOSAL_SCHEMA,
  validateProposal,
  type ProposalParticipant,
  type TeamProposalV2,
} from "./team-proposal";
import { selfReferentialHash } from "./canonical-hash";

// ── §6 legacy scheduling inputs ──────────────────────────────────────────────

export interface SchedulingInputs {
  /** An explicit v2 scheduling value (wins the precedence outright). */
  v2_scheduling?: { effective: number };
  /** Legacy `--team-size N` (positive ⇒ run-local max_concurrency_hint). */
  cli_team_size?: unknown;
  /** Legacy `defaults.team.size` (positive ⇒ hint of last resort). */
  defaults_team_size?: unknown;
  /** Legacy `allow_larger` (either boolean) — a WARNED NO-OP in v2. */
  allow_larger?: unknown;
  verified_backend_capacity: number;
}

export type ConcurrencyHintSource =
  | "v2_scheduling"
  | "cli_team_size"
  | "defaults_team_size"
  | "backend_capacity";

export interface ConcurrencyHint {
  selected_hint: number | null;
  effective: number;
  clamp_diagnostic: string | null;
  /** Which precedence rung supplied the hint. */
  source: ConcurrencyHintSource;
  /** Migration diagnostics: allow_larger no-op, superseded-input conflicts. */
  warnings: string[];
}

function rejectLegacyValue(name: string, v: unknown): never {
  throw new Error(
    `rejected: invalid/malformed legacy scheduling value ${name}=${JSON.stringify(v)} — ` +
      "zero, negative, or malformed legacy values are REJECTED with a diagnostic (team-contracts §6)"
  );
}

/** A positive integer, or a §6 rejection for anything else (when present). */
function positiveIntOrReject(name: string, v: unknown): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) rejectLegacyValue(name, v);
  return v as number;
}

/**
 * Resolve the §6 concurrency hint under the FROZEN precedence and clamp rules.
 * Pure scheduling: the return carries a hint and diagnostics, never a roster.
 */
export function resolveConcurrencyHint(inputs: SchedulingInputs): ConcurrencyHint {
  const warnings: string[] = [];
  const capacity = inputs.verified_backend_capacity;
  if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity <= 0) {
    rejectLegacyValue("verified_backend_capacity", capacity);
  }

  if (inputs.allow_larger !== undefined) {
    // §6: "allow_larger (either boolean)" — ONLY a boolean is a warned no-op.
    // Any other shape ("yes", 1, "true", …) is a malformed legacy value and is
    // REJECTED with the contract diagnostic, never silently coerced/ignored
    // (rework F5 fail-closed).
    if (typeof inputs.allow_larger !== "boolean") {
      rejectLegacyValue("allow_larger", inputs.allow_larger);
    }
    warnings.push(
      "allow_larger is a warned no-op in v2 — it has no scheduling meaning and never affects the roster or the waves (migration window; remove it before the window closes)"
    );
  }

  let v2Effective: number | null = null;
  if (inputs.v2_scheduling !== undefined) {
    const e = inputs.v2_scheduling?.effective;
    if (typeof e !== "number" || !Number.isInteger(e) || e <= 0) {
      rejectLegacyValue("v2_scheduling.effective", e);
    }
    v2Effective = e;
  }
  const cli = positiveIntOrReject("cli_team_size (--team-size)", inputs.cli_team_size);
  const dflt = positiveIntOrReject("defaults.team.size", inputs.defaults_team_size);

  let selected_hint: number | null;
  let source: ConcurrencyHintSource;
  if (v2Effective !== null) {
    selected_hint = v2Effective;
    source = "v2_scheduling";
    if (cli !== null && cli !== v2Effective) {
      warnings.push(
        `migration diagnostic: --team-size ${cli} is superseded by the explicit v2 scheduling value ${v2Effective} (frozen §6 precedence)`
      );
    }
    if (dflt !== null && dflt !== v2Effective) {
      warnings.push(
        `migration diagnostic: defaults.team.size ${dflt} is superseded by the explicit v2 scheduling value ${v2Effective} (frozen §6 precedence)`
      );
    }
  } else if (cli !== null) {
    // Legacy --team-size maps to a run-local max_concurrency_hint.
    selected_hint = cli;
    source = "cli_team_size";
    if (dflt !== null && dflt !== cli) {
      warnings.push(
        `migration diagnostic: defaults.team.size ${dflt} is superseded by --team-size ${cli} (frozen §6 precedence)`
      );
    }
  } else if (dflt !== null) {
    selected_hint = dflt;
    source = "defaults_team_size";
  } else {
    selected_hint = null;
    source = "backend_capacity";
  }

  const effective = selected_hint === null ? capacity : Math.min(selected_hint, capacity);
  const clamp_diagnostic =
    selected_hint !== null && selected_hint > capacity
      ? `selected_hint ${selected_hint} exceeds verified backend capacity ${capacity} — effective concurrency clamped to ${capacity} (migration diagnostic)`
      : null;

  return { selected_hint, effective, clamp_diagnostic, source, warnings };
}

/**
 * Apply legacy scheduling inputs to a logical roster: the roster passes through
 * BYTE-IDENTICAL in content and order — no legacy input can cap, filter, or
 * reorder it (§6). The resolved hint rides alongside for the scheduler.
 */
export function applySchedulingInputs<T>(
  inputs: SchedulingInputs & { roster: readonly T[] }
): { roster: T[]; hint: ConcurrencyHint } {
  const { roster, ...scheduling } = inputs;
  const hint = resolveConcurrencyHint(scheduling);
  return { roster: [...roster], hint };
}

// ── §7 guild.team_plan.v1 compatibility reader ───────────────────────────────

interface LegacyRosterEntry {
  role: string;
  scope: string | null;
  default_tier: "cheap" | "mid" | "powerful";
  fanout: string;
  source: string;
}

export interface LegacyTeamPlanV1Like {
  schema_version: "guild.team_plan.v1";
  station: string;
  roster: LegacyRosterEntry[];
  cap?: number;
  capped?: boolean;
  dropped_roles?: string[];
  [key: string]: unknown;
}

export type LegacyImportDisposition =
  | "recompose_required"
  | "pending_proposal"
  | "invalid";

export interface LegacyImportVerdict {
  disposition: LegacyImportDisposition;
  /** A legacy artifact is NEVER directly dispatchable in v2. */
  dispatchable: false;
  /** Every import path ends at the user gate — approval is always required. */
  requires_user_approval: true;
  reason: string;
  /** Present ONLY for the non-lossy pending_proposal path. */
  proposal?: TeamProposalV2 & { provenance: string };
}

/** §7 lossy detection: `capped: true` OR any dropped role ⇒ roster untrusted. */
export function isLossyLegacyPlan(plan: {
  capped?: boolean;
  dropped_roles?: string[];
  roster?: unknown[];
}): boolean {
  return plan.capped === true || (plan.dropped_roles ?? []).length > 0;
}

export interface LegacyImportOptions {
  run_id?: string;
  phase?: string;
}

/**
 * Import a legacy `guild.team_plan.v1` under the §7 rules. The legacy bytes are
 * READ ONLY — never rewritten. Outcomes:
 *  - capped/lossy ⇒ `recompose_required`: the roster is untrusted; a fresh v2
 *    proposal must be composed and user-approved before any dispatch.
 *  - non-lossy ⇒ `pending_proposal`: a v2 proposal (version 1, provenance
 *    noting the v1 origin) awaiting the user decision — NEVER an approval.
 * The emitted proposal carries NO `cap`/`capped`/`dropped_roles` keys — v2
 * never emits them; consumers branch on `schema_version`.
 */
const LEGACY_TIERS = ["cheap", "mid", "powerful"] as const;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Fail-closed shape validation of ONE legacy roster entry (rework F5): every
 * field the v2 import consumes must be present and well-typed — a malformed
 * entry ({role: "qa"} alone) must never be manufactured into a v2 proposal
 * with undefined tier/source.
 */
function legacyRosterEntryErrors(entry: unknown, index: number): string[] {
  const errors: string[] = [];
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return [`roster[${index}] must be an object`];
  }
  const e = entry as Record<string, unknown>;
  if (!isNonEmptyString(e["role"])) errors.push(`roster[${index}].role must be a non-empty string`);
  if (!(e["scope"] === null || isNonEmptyString(e["scope"]))) {
    errors.push(`roster[${index}].scope must be null or a non-empty string`);
  }
  if (!LEGACY_TIERS.includes(e["default_tier"] as (typeof LEGACY_TIERS)[number])) {
    errors.push(`roster[${index}].default_tier must be one of ${LEGACY_TIERS.join("|")}`);
  }
  if (!isNonEmptyString(e["fanout"])) errors.push(`roster[${index}].fanout must be a non-empty string`);
  if (!isNonEmptyString(e["source"])) errors.push(`roster[${index}].source must be a non-empty string`);
  return errors;
}

/** Fail-closed validation of the legacy artifact's truncation fields (rework F5). */
function legacyTruncationFieldErrors(plan: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (plan["capped"] !== undefined && typeof plan["capped"] !== "boolean") {
    errors.push("capped, when present, must be a boolean");
  }
  if (
    plan["dropped_roles"] !== undefined &&
    !(Array.isArray(plan["dropped_roles"]) && plan["dropped_roles"].every((r) => isNonEmptyString(r)))
  ) {
    errors.push("dropped_roles, when present, must be an array of non-empty strings");
  }
  if (plan["cap"] !== undefined && (typeof plan["cap"] !== "number" || !Number.isInteger(plan["cap"]) || plan["cap"] < 1)) {
    errors.push("cap, when present, must be a positive integer");
  }
  return errors;
}

export function importLegacyTeamPlan(
  legacy: unknown,
  opts: LegacyImportOptions = {}
): LegacyImportVerdict {
  if (
    legacy === null ||
    typeof legacy !== "object" ||
    Array.isArray(legacy) ||
    (legacy as Record<string, unknown>)["schema_version"] !== "guild.team_plan.v1" ||
    !isNonEmptyString((legacy as Record<string, unknown>)["station"]) ||
    !Array.isArray((legacy as Record<string, unknown>)["roster"])
  ) {
    return {
      disposition: "invalid",
      dispatchable: false,
      requires_user_approval: true,
      reason:
        "not a readable guild.team_plan.v1 artifact — consumers branch explicitly on schema_version (team-contracts §7)",
    };
  }

  // Rework F5 fail-closed: EVERY legacy roster/truncation field is validated
  // BEFORE import. A malformed artifact is invalid with migration guidance —
  // the compatibility path never manufactures a malformed v2 proposal.
  const raw = legacy as Record<string, unknown>;
  const fieldErrors = [
    ...legacyTruncationFieldErrors(raw),
    ...(raw["roster"] as unknown[]).flatMap((entry, i) => legacyRosterEntryErrors(entry, i)),
  ];
  if (fieldErrors.length > 0) {
    return {
      disposition: "invalid",
      dispatchable: false,
      requires_user_approval: true,
      reason:
        `malformed guild.team_plan.v1 artifact — REJECTED, never coerced (team-contracts §6/§7): ${fieldErrors.join("; ")}. ` +
        "Migration guidance: repair the legacy artifact to the documented v1 shape, or recompose a fresh v2 proposal from the task and obtain user approval.",
    };
  }
  const plan = legacy as LegacyTeamPlanV1Like;

  if (isLossyLegacyPlan(plan)) {
    const dropped = (plan.dropped_roles ?? []).join(", ") || "(roster loss detected)";
    return {
      disposition: "recompose_required",
      dispatchable: false,
      requires_user_approval: true,
      reason:
        `legacy guild.team_plan.v1 is capped/lossy (dropped: ${dropped}) — its roster is UNTRUSTED; ` +
        "recompose a v2 proposal from the task and obtain fresh user approval before dispatch (team-contracts §7)",
    };
  }

  const phase = opts.phase ?? plan.station;
  const run_id = opts.run_id ?? `legacy-import-${plan.station}`;
  const participants: ProposalParticipant[] = plan.roster.map((entry) => ({
    participant_id: entry.role,
    participation_kind: "worker",
    role_ref: entry.role,
    necessity_rationale: `carried over from the legacy guild.team_plan.v1 ${entry.source} roster (non-lossy import; re-justify at the user gate)`,
    owned_obligations: [],
    depends_on: [],
    tier: entry.default_tier,
    purpose: "general",
    capability_scope: null,
    backend: "team",
  }));

  const proposal: TeamProposalV2 & { provenance: string } = {
    schema_version: TEAM_PROPOSAL_SCHEMA,
    run_id,
    phase,
    proposal_version: 1,
    parent_proposal_hash: null,
    proposal_hash_algorithm: PROPOSAL_HASH_ALGORITHM,
    proposal_hash_scope: PROPOSAL_HASH_SCOPE,
    participants,
    obligations: [],
    excluded_roles: [],
    provenance: `imported from guild.team_plan.v1 (station "${plan.station}", non-lossy legacy artifact) — PENDING user decision; never an approval`,
  };
  proposal.proposal_hash = selfReferentialHash(
    proposal as unknown as Record<string, unknown>,
    "proposal_hash"
  );

  // Belt-and-suspenders (rework F5): the emitted pending proposal must itself
  // pass the full v2 validator — an import that cannot produce a valid
  // guild.team_proposal.v2 is an invalid artifact, never a silent pass-through.
  const emitted = validateProposal(proposal);
  if (!emitted.valid) {
    return {
      disposition: "invalid",
      dispatchable: false,
      requires_user_approval: true,
      reason:
        `legacy import produced an invalid guild.team_proposal.v2 — REJECTED (fails closed): ${emitted.reasons.join("; ")}. ` +
        "Migration guidance: recompose a fresh v2 proposal from the task and obtain user approval.",
    };
  }

  return {
    disposition: "pending_proposal",
    dispatchable: false,
    requires_user_approval: true,
    reason:
      "non-lossy legacy artifact imported as a PENDING v2 proposal (proposal_version 1, provenance noted) — dispatch still requires a user approve decision",
    proposal,
  };
}
