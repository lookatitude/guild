/**
 * `team.compose_scope` — per-phase compose, per-goal SLICE (KTD62 / R73), and
 * the class-scoped mint rule (KTD55 / R67).
 *
 * Two rules that are easy to confuse and expensive to get wrong:
 *
 *  1. **Compose is per phase.** The shipped `.guild/team/<slug>.<phase>.yaml`
 *     files stay exactly as they are. When an initiative carries several
 *     `guild.goal.v1` ids, `scope: "goal"` selects a SUBSET of that phase roster
 *     by `roster_role_ids`. It does not mint a parallel specialist tree — the
 *     profiles it selects were already minted, and a slice that names a role
 *     with no minted profile is a REFUSAL, not an implicit mint.
 *  2. **Only product mints a delivery roster.** `debug`, `research`, and `ops`
 *     run `lead_only` or reuse already-minted profiles. `init` may mint on the
 *     greenfield path. A debug run that quietly minted five specialists would
 *     turn a diagnosis into a build.
 */
import { deepFreeze, frozenList } from "../../kernel";
import type { GoalV1, WorkflowClass } from "./goal-contract";

export const COMPOSE_SCOPES = frozenList(["phase", "goal"] as const);
export type ComposeScope = (typeof COMPOSE_SCOPES)[number];

/** Classes permitted to MINT a delivery roster (R67). */
export const MINTING_CLASSES = frozenList(["product", "init"] as const);

export function classMaysMintDeliveryRoster(cls: WorkflowClass): boolean {
  return (MINTING_CLASSES as readonly string[]).includes(cls);
}

export type MintScopeVerdict =
  | { ok: true; may_mint: true }
  | { ok: true; may_mint: false; fallback: "lead_only" | "already_minted_profiles"; reason: string };

/**
 * The class gate in front of every mint. Non-product classes are not blocked
 * from working — they are blocked from GROWING the project's roster as a side
 * effect of a diagnosis.
 */
export function resolveMintScope(input: {
  workflow_class: WorkflowClass;
  /** True when the station this cell serves requires a specific minted role. */
  requires_existing_profile?: boolean;
}): MintScopeVerdict {
  if (classMaysMintDeliveryRoster(input.workflow_class)) return { ok: true, may_mint: true };
  return {
    ok: true,
    may_mint: false,
    fallback: input.requires_existing_profile ? "already_minted_profiles" : "lead_only",
    reason:
      `class '${input.workflow_class}' does not mint a delivery roster (R67) — ` +
      `it runs lead_only or reuses profiles this project already minted.`,
  };
}

// ── The per-goal slice ───────────────────────────────────────────────────────

/** The minimum a slice needs to know about one roster member. */
export interface RosterMember {
  name: string;
  /** `"project"` means a minted `.guild/agents/<role>.md` profile. */
  source: "shipped" | "project" | "template";
}

export type RosterSliceResult<T extends RosterMember> =
  | { ok: true; scope: ComposeScope; roster: T[] }
  | {
      ok: false;
      scope: "goal";
      reason: string;
      unminted: string[];
      unknown: string[];
      /** Always empty on a refusal — a refused slice hands back NO roster. */
      roster: readonly T[];
      /** What the operator has to do: mint through the team_decision gate. */
      next_need: "mint";
    };

/**
 * Slice a phase roster for one goal.
 *
 * `scope: "phase"` hands back the phase roster untouched — the default, and the
 * shape every shipped team file already has.
 *
 * `scope: "goal"` filters by `goal.roster_role_ids` and then enforces the rule
 * that makes this a slice rather than a second compose: every selected role must
 * be a MINTED PROJECT PROFILE. A `template` entry is feedstock that was never
 * minted, and a `shipped` entry is machinery — neither is a delivery specialist
 * this goal can claim. Both refuse, and the refusal names them so the operator
 * can mint through the normal `team_decision.v1` gate instead of having a slice
 * do it silently.
 */
export function sliceRosterForGoal<T extends RosterMember>(input: {
  scope: ComposeScope;
  phase_roster: readonly T[];
  goal?: Pick<GoalV1, "roster_role_ids"> | null;
}): RosterSliceResult<T> {
  if (input.scope === "phase") {
    return { ok: true, scope: "phase", roster: [...input.phase_roster] };
  }
  const wanted = input.goal?.roster_role_ids ?? [];
  if (wanted.length === 0) {
    // No slice declared under goal scope: the goal covers the phase roster — but
    // only its MINTED members. Round 1 returned the phase roster verbatim here,
    // so a phase whose roster was still all templates handed the caller a list of
    // unminted feedstock to dispatch. A slice returns minted profiles or nothing.
    const minted = input.phase_roster.filter((m) => m.source === "project");
    if (minted.length === 0) {
      const offered = input.phase_roster.map((m) => `${m.name} (${m.source})`);
      return {
        ok: false,
        scope: "goal",
        roster: [] as T[],
        next_need: "mint",
        unknown: [],
        unminted: offered,
        reason:
          `per-goal slice is EMPTY (R73): the phase roster holds no minted project ` +
          `profile${offered.length ? ` (only ${offered.join(", ")})` : ""}. Returning an ` +
          `empty slice, never templates — mint through team_decision.v1 first.`,
      };
    }
    return { ok: true, scope: "goal", roster: [...minted] };
  }
  const byName = new Map(input.phase_roster.map((m) => [m.name, m]));
  const unknown: string[] = [];
  const unminted: string[] = [];
  const roster: T[] = [];
  for (const role of wanted) {
    const member = byName.get(role);
    if (!member) {
      unknown.push(role);
      continue;
    }
    if (member.source !== "project") {
      unminted.push(`${role} (${member.source})`);
      continue;
    }
    roster.push(member);
  }
  if (unknown.length > 0 || unminted.length > 0 || roster.length === 0) {
    return {
      ok: false,
      scope: "goal",
      unknown,
      unminted,
      roster: [] as T[],
      next_need: "mint",
      reason:
        `per-goal slice refused (R73): ` +
        [
          unknown.length > 0 ? `not in the phase roster: ${unknown.join(", ")}` : "",
          unminted.length > 0 ? `not a minted project profile: ${unminted.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("; ") +
        `. A goal scope SELECTS from already-minted profiles; it never mints a ` +
        `parallel tree. Mint through team_decision.v1 first.`,
    };
  }
  return { ok: true, scope: "goal", roster };
}

export const COMPOSE_SCOPE_CONTRACT = deepFreeze({
  policy_key: "team.compose_scope",
  scopes: COMPOSE_SCOPES,
  default: "phase",
  minting_classes: MINTING_CLASSES,
});
