/**
 * src/modules/teams/workflows/station-composer.ts
 *
 * G6a (task-cell-runtime P0.6, FOUNDATION) — the deterministic station team
 * composer + the two typed contracts (`guild.team_plan.v1` /
 * `guild.team_result.v1`) + the code-as-data station policy
 * (`guild.station_policy.v1`).
 *
 * G6 routes every lifecycle STATION through ONE deterministic composer that emits
 * a typed team plan/result, replacing today's hardcoded per-station team combos
 * with a data-driven policy lookup. G6a builds only the SHARED SPINE (ADDITIVE —
 * no station is wired to it here); G6b wires the stations, and G8 adds fan-out
 * SIGNAL SCORING behind the `scoreFanout` seam this file leaves open. The composer
 * here is fully deterministic: a policy-table lookup for the station's default
 * roster + the §Implied Specialist Rules applied against typed `signals`. There is
 * NO scoring — `fanout` is a plain table value (D1 baseline `lead_only`), the
 * later G8 item being the only thing allowed to make it signal-derived.
 *
 * Canonical policy source (this code MUST match it — cited per row):
 *   `.guild/wiki/entities/team-composition.md`
 *     §Phase Team Defaults      → STATION_POLICY[*].default_roster / optional_roster / advisory_memory
 *     §Implied Specialist Rules → IMPLIED_RULES
 *     §Team Size Rules          → cap-6 / default 3-4, orchestrator uncounted
 * Where this table EXTENDS the doc (the `research` / `definition` / `learn`
 * stations the doc's 6-row §Phase Team Defaults omits), the station carries a
 * `note` and `extends_doc: true` so G6b can reconcile the doc in the same rollout.
 *
 * Contract idioms mirror the G2 seam
 * (`scripts/lib/core/contracts/task-cell-backend.ts`): frozen literal sets,
 * `schema_version` string literals, and fail-closed validators that return the
 * typed value or NULL — never throw, never repair. Vocabulary reuse: `CellFanout`
 * and `ModelTier` are imported from G2, not re-declared.
 */

import {
  type CellFanout,
  type ModelTier,
} from "../../../../scripts/lib/core/contracts/task-cell-backend";
import { type RosterAgentEntry, type RosterResolution } from "../../../../scripts/lib/roster";

// ── Stations ─────────────────────────────────────────────────────────────────

/**
 * The lifecycle STATIONS the composer knows how to compose a team for.
 *
 * The first six are the canonical lifecycle phases
 * (`init ideate plan build qa ops`, run-lifecycle.ts CANONICAL_PHASES) mapped 1:1
 * onto the doc's §Phase Team Defaults rows (Init / Ideation / Planning /
 * Development / Quality / Operations). The last three — `research`, `definition`,
 * `learn` — EXTEND the doc (its §Phase Team Defaults omits them); each is marked
 * `extends_doc: true` in the policy so G6b reconciles the doc.
 *
 * NOTE (8-vs-9): the G6a brief tallies "8 stations" but its own §2 enumerates the
 * 6 doc phases PLUS research/definition/learn = NINE. This file covers all nine (a
 * strict superset of any 8-station reading — no station is left uncomposable); the
 * exact station enumeration is flagged for the lead to pin in G6b.
 */
export const STATIONS = [
  "init",
  "ideate",
  "plan",
  "build",
  "qa",
  "ops",
  "research",
  "definition",
  "learn",
] as const;

export type StationId = (typeof STATIONS)[number];

const STATION_SET: ReadonlySet<string> = new Set<string>(STATIONS);

export function isStation(v: string): v is StationId {
  return STATION_SET.has(v);
}

// ── Signals ──────────────────────────────────────────────────────────────────

/**
 * The typed composition SIGNALS the §Implied Specialist Rules fire on. Every
 * field is an optional boolean; absent/false ⇒ the rule does not fire. This is
 * the closed input surface the composer reads — a rule can only key off a field
 * declared here (which is what makes "rule fires on its trigger and NOT
 * otherwise" testable).
 */
export interface StationSignals {
  /** Multi-component build → architect owns boundaries + dependencies. */
  multi_component?: boolean;
  /** Auth, secrets, payments, webhooks, or external APIs → security. */
  auth_touched?: boolean;
  /** Server-side work present → qa (integration + regression evidence). */
  backend_present?: boolean;
  /** User-facing UI → frontend (and often qa). */
  user_facing_ui?: boolean;
  /** Public docs → technical-writer. */
  public_docs?: boolean;
  /** Search / discoverability surface → seo. */
  search_discoverability?: boolean;
}

// ── Implied Specialist Rules (guild.station_policy.v1 · §Implied) ─────────────

/**
 * A §Implied Specialist Rule as DATA: a single signal field that, when truthy,
 * adds one or more specialist roles. Encodes `team-composition.md §Implied
 * Specialist Rules` verbatim — all SIX rows (the brief names four; the doc is
 * canonical and carries public-docs→technical-writer and search→seo too).
 */
export interface ImpliedRule {
  /** Stable rule id, recorded in `fired_rules`. */
  id: string;
  /** The `StationSignals` field that triggers this rule. */
  signal: keyof StationSignals;
  /** The specialist role(s) added when the signal is truthy. */
  adds: readonly string[];
  /** The doc's stated reason. */
  reason: string;
  /** Doc anchor this row mirrors. */
  doc_ref: string;
}

const DOC = ".guild/wiki/entities/team-composition.md";

export const IMPLIED_RULES: readonly ImpliedRule[] = Object.freeze([
  {
    id: "multi_component",
    signal: "multi_component",
    adds: Object.freeze(["architect"]),
    reason: "Component boundaries and dependencies need ownership.",
    doc_ref: `${DOC}#implied-specialist-rules`,
  },
  {
    id: "auth_touched",
    signal: "auth_touched",
    adds: Object.freeze(["security"]),
    reason: "Threats and trust boundaries must be explicit.",
    doc_ref: `${DOC}#implied-specialist-rules`,
  },
  {
    id: "backend_present",
    signal: "backend_present",
    adds: Object.freeze(["qa"]),
    reason: "Server-side work needs integration and regression evidence.",
    doc_ref: `${DOC}#implied-specialist-rules`,
  },
  {
    id: "user_facing_ui",
    signal: "user_facing_ui",
    // Doc: "frontend and often qa" — both are added; qa dedupes against the
    // backend_present rule when both fire.
    adds: Object.freeze(["frontend", "qa"]),
    reason: "Accessibility, responsive behavior, and interaction state need coverage.",
    doc_ref: `${DOC}#implied-specialist-rules`,
  },
  {
    id: "public_docs",
    signal: "public_docs",
    adds: Object.freeze(["technical-writer"]),
    reason: "Durable docs need task-focused structure and maintenance boundaries.",
    doc_ref: `${DOC}#implied-specialist-rules`,
  },
  {
    id: "search_discoverability",
    signal: "search_discoverability",
    adds: Object.freeze(["seo"]),
    reason: "SEO owns metadata, crawlability, and keyword strategy.",
    doc_ref: `${DOC}#implied-specialist-rules`,
  },
]);

// ── Station policy (guild.station_policy.v1 · §Phase Team Defaults) ───────────

export const STATION_POLICY_SCHEMA = "guild.station_policy.v1" as const;

/**
 * The default team for one station, as DATA. Mirrors a §Phase Team Defaults row:
 * `default_roster` are the always-present specialists, `optional_roster` the
 * doc's "optional …" / "… when needed" roles (dropped first under the cap-6
 * ceiling), `advisory_memory` the doc's "advisory memory" attachment. `fanout` is
 * the D1 BASELINE table value (`lead_only`) — never a scored value here (G8 owns
 * scoring, via the composer's `scoreFanout` seam).
 */
export interface StationDefault {
  station: StationId;
  default_roster: readonly string[];
  /**
   * The doc's "optional …" / "… when needed" roles, made CONDITIONAL: each maps to
   * the `StationSignals` field that must be true for the role to be included. An
   * unset signal means the optional role is NOT composed (a no-signal composition
   * carries only `default_roster`). Each inclusion records a `opt:<station>:<role>`
   * entry in `fired_rules`.
   */
  conditional_roster: Readonly<Record<string, keyof StationSignals>>;
  /**
   * Roles/categories the DETERMINISTIC composer does not resolve — they are supplied
   * by G6b plan wiring from the actual spec/plan (the doc's "relevant implementers" /
   * "task owners selected by plan", and "when needed" roles with no signal, e.g.
   * `devops`). Recorded on the team_plan so downstream wiring has an explicit slot;
   * never auto-added here.
   */
  plan_driven_slots: readonly string[];
  advisory_memory: boolean;
  /** D1 baseline fan-out for every lane at this station; G8 may raise it. */
  default_fanout: CellFanout;
  /** true when this row EXTENDS the doc (doc §Phase Team Defaults omits it). */
  extends_doc: boolean;
  /** Present on extended rows — the reconcile note surfaced to the lead. */
  note?: string;
  doc_ref: string;
}

const DEFAULTS_ANCHOR = `${DOC}#phase-team-defaults`;

/**
 * `guild.station_policy.v1` — the canonical station→default-team table.
 *
 * Rows 1-6 are the doc's §Phase Team Defaults, verbatim:
 *   Init         → researcher, technical-writer, (optional architect), advisory
 *   Ideation     → architect, researcher, (optional product/content), advisory
 *   Planning     → architect, technical-writer, qa; security when needed; advisory
 *   Development  → qa, security; architect when boundaries change; advisory
 *                  (task-owner implementers are added by the plan/signals, not the
 *                  station default — see composeStationTeam)
 *   Quality      → qa; devops, security when needed; advisory
 *   Operations   → devops, security, qa; advisory
 *
 * Rows 7-9 (research/definition/learn) EXTEND the doc — sensible defaults, flagged.
 */
export const STATION_POLICY: Readonly<Record<StationId, StationDefault>> = Object.freeze({
  init: {
    station: "init",
    default_roster: Object.freeze(["researcher", "technical-writer"]),
    // Doc: "optional architect" — only when component boundaries are in play.
    conditional_roster: Object.freeze({ architect: "multi_component" }),
    plan_driven_slots: Object.freeze([]),
    advisory_memory: true,
    default_fanout: "lead_only",
    extends_doc: false,
    doc_ref: DEFAULTS_ANCHOR,
  },
  ideate: {
    station: "ideate",
    default_roster: Object.freeze(["architect", "researcher"]),
    conditional_roster: Object.freeze({}),
    // Doc: "optional product/content/domain specialists" — no signal encodes these
    // concrete roles; the plan/spec supplies them (G6b).
    plan_driven_slots: Object.freeze(["product", "content", "domain"]),
    advisory_memory: true,
    default_fanout: "lead_only",
    extends_doc: false,
    doc_ref: DEFAULTS_ANCHOR,
  },
  plan: {
    station: "plan",
    default_roster: Object.freeze(["architect", "technical-writer", "qa"]),
    // Doc: "security when needed" → gated on auth/secrets signal.
    conditional_roster: Object.freeze({ security: "auth_touched" }),
    plan_driven_slots: Object.freeze([]),
    advisory_memory: true,
    default_fanout: "lead_only",
    extends_doc: false,
    doc_ref: DEFAULTS_ANCHOR,
  },
  build: {
    station: "build",
    // Doc: "task owners selected by plan, qa, security, architect/tech lead when
    // boundaries change". Always-present reviewers are the default; architect is
    // boundary-change (multi_component) gated; task-owner implementers are plan-driven.
    default_roster: Object.freeze(["qa", "security"]),
    conditional_roster: Object.freeze({ architect: "multi_component" }),
    plan_driven_slots: Object.freeze(["task-owner-implementers"]),
    advisory_memory: true,
    default_fanout: "lead_only",
    extends_doc: false,
    doc_ref: DEFAULTS_ANCHOR,
  },
  qa: {
    station: "qa",
    default_roster: Object.freeze(["qa"]),
    // Doc: "devops, security when needed" — security gated on auth_touched; devops
    // "when needed" has no signal (release/deploy context) → plan-driven. Doc also
    // names "relevant implementers" → plan-driven.
    conditional_roster: Object.freeze({ security: "auth_touched" }),
    plan_driven_slots: Object.freeze(["devops", "relevant-implementers"]),
    advisory_memory: true,
    default_fanout: "lead_only",
    extends_doc: false,
    doc_ref: DEFAULTS_ANCHOR,
  },
  ops: {
    station: "ops",
    default_roster: Object.freeze(["devops", "security", "qa"]),
    conditional_roster: Object.freeze({}),
    // Doc: "relevant implementers" → plan-driven.
    plan_driven_slots: Object.freeze(["relevant-implementers"]),
    advisory_memory: true,
    default_fanout: "lead_only",
    extends_doc: false,
    doc_ref: DEFAULTS_ANCHOR,
  },
  // ── Extended stations (doc §Phase Team Defaults omits these) ──
  research: {
    station: "research",
    default_roster: Object.freeze(["researcher"]),
    conditional_roster: Object.freeze({ architect: "multi_component" }),
    plan_driven_slots: Object.freeze([]),
    advisory_memory: true,
    default_fanout: "lead_only",
    extends_doc: true,
    note: "EXTENDS doc: research station (product-explore / researcher deliverables); doc §Phase Team Defaults omits it — reconcile in G6b.",
    doc_ref: DEFAULTS_ANCHOR,
  },
  definition: {
    station: "definition",
    default_roster: Object.freeze(["architect", "technical-writer"]),
    conditional_roster: Object.freeze({ qa: "backend_present" }),
    plan_driven_slots: Object.freeze([]),
    advisory_memory: true,
    default_fanout: "lead_only",
    extends_doc: true,
    note: "EXTENDS doc: definition station (product-define / PRD nucleus); mirrors Planning minus security-by-default — reconcile in G6b.",
    doc_ref: DEFAULTS_ANCHOR,
  },
  learn: {
    station: "learn",
    default_roster: Object.freeze(["researcher"]),
    conditional_roster: Object.freeze({ architect: "multi_component", "technical-writer": "public_docs" }),
    plan_driven_slots: Object.freeze([]),
    advisory_memory: true,
    default_fanout: "lead_only",
    extends_doc: true,
    note: "EXTENDS doc: learn station (learn-* knowledge pipeline; analysis reuses researcher/architect per team-composition.md §No new analysis specialist); doc §Phase Team Defaults omits it — reconcile in G6b.",
    doc_ref: DEFAULTS_ANCHOR,
  },
});

// ── Team size rules (§Team Size Rules) ───────────────────────────────────────

/** Doc §Team Size Rules: max 6 specialists (the orchestrator/lead does not count). */
export const TEAM_CAP = 6 as const;

// ── guild.team_plan.v1 ───────────────────────────────────────────────────────

export const TEAM_PLAN_SCHEMA = "guild.team_plan.v1" as const;

/** How a lane entered the plan — preserves the composition provenance. */
export type LaneSource = "default" | "optional" | "implied";

/**
 * One resolved lane of a composed team. Field names align with a
 * `team-composition.md §Team Record` specialist entry (`name`→`role`, `scope`) +
 * the roster's per-specialist `default_tier`, so G6b can emit a `team_plan`
 * alongside the `.guild/team/<slug>.<phase>.yaml` it already writes.
 */
export interface TeamPlanLane {
  /** The specialist role slug (a `templates/specialists/<role>` type / minted instance). */
  role: string;
  /**
   * The lane's bounded scope, aligning with a `team-composition.md §Team Record`
   * specialist's `scope`. The deterministic composer does NOT assign scope (it comes
   * from the spec/plan at G6b wiring); it is `null` here so the field EXISTS for
   * alignment and downstream population.
   */
  scope: string | null;
  /** The roster's canonical `default_tier` for the role (roster-derived, per D2/D4). */
  default_tier: ModelTier;
  /** Per-lane fan-out. D1 baseline table value unless G8's `scoreFanout` raised it. */
  fanout: CellFanout;
  /** How this lane entered the team (default roster / optional / implied rule). */
  source: LaneSource;
  /** The rule id that added this lane (present for `source === "implied"` OR `"optional"`). */
  fired_rule?: string;
}

/**
 * `guild.team_plan.v1` — the deterministic output of `composeStationTeam`. A typed
 * team the run can dispatch: the station, the resolved roster (roles + per-lane
 * tier + fan-out), which implied rules fired, and the cap-6 outcome.
 */
export interface TeamPlanV1 {
  schema_version: typeof TEAM_PLAN_SCHEMA;
  station: StationId;
  /** The resolved specialist lanes (cap-6, orchestrator/advisory uncounted). */
  roster: TeamPlanLane[];
  /**
   * EVERY rule whose signal fired for this composition — implied-rule ids AND
   * `opt:<station>:<role>` conditional-roster ids — recorded on the SIGNAL, NOT on
   * lane survival. A rule stays listed even when its role was already a default
   * (deduped) or dropped by the cap, so the audit trail never loses fired-rule
   * evidence. Order-stable, deduped.
   */
  fired_rules: string[];
  /**
   * The doc's plan-driven categories for this station ("relevant implementers" /
   * "task owners selected by plan" / signal-less "when needed" roles like `devops`).
   * The deterministic composer does NOT resolve these; G6b plan wiring fills them
   * from the actual spec/plan. Present so downstream has an explicit slot.
   */
  plan_driven_slots: string[];
  /** Whether an advisory-memory agent should attach (does not count toward cap-6). */
  advisory_memory: boolean;
  /** The cap applied. */
  cap: number;
  /** true iff the cap-6 ceiling truncated the roster (optionals dropped first). */
  capped: boolean;
  /** Roles dropped by the cap (empty when `capped` is false). */
  dropped_roles: string[];
}

// ── guild.team_result.v1 ─────────────────────────────────────────────────────

export const TEAM_RESULT_SCHEMA = "guild.team_result.v1" as const;

/**
 * One lane's typed outcome. `instance_id` is the FRESH per-instance runtime
 * identity (G2 D3 — never reused); `handoff_ref` / `acceptance_ref` are POINTERS
 * to the durable `guild.handoff_receipt.v1` / `guild.handoff_acceptance.v1`
 * records, never inlined copies.
 */
export interface TeamResultLane {
  role: string;
  /** The fresh runtime identity that ran this lane (G2 D3; distinct per lane — test 12). */
  instance_id: string;
  /** Pointer to the lane's handoff receipt (null until submitted). */
  handoff_ref: string | null;
  /** Pointer to the lane's acceptance record (null until accepted). */
  acceptance_ref: string | null;
}

/**
 * `guild.team_result.v1` — the typed result of dispatching a `team_plan`: a
 * back-reference to the plan, plus one typed lane result per instance. The fresh,
 * DISTINCT `instance_id`s are what prove adversarial test 12 ("fresh identities +
 * typed results") — the validator rejects any result with a duplicate
 * `instance_id`.
 */
export interface TeamResultV1 {
  schema_version: typeof TEAM_RESULT_SCHEMA;
  station: StationId;
  /** Reference to the composed `guild.team_plan.v1` this result executes. */
  team_plan_ref: string;
  lanes: TeamResultLane[];
}

// ── Tier index (reuse roster-resolve; do NOT re-implement — D4) ───────────────

/**
 * Build a `role → default_tier` index from a `guild.roster.v1` resolution.
 *
 * This is the D4-compliant tier source: `default_tier` was ALREADY derived by
 * roster-resolve from each type's `model:` frontmatter (D2 ladder) — this helper
 * only projects that, it never hand-maintains a tier table (D4 forbids one). The
 * composer reads tiers through this index; G6b passes
 * `buildTierIndex(resolveRoster(...))`, tests pass the same over the real
 * template library, so the tiers under test are the shipped frontmatter values.
 *
 * Templates, project instances, and shipped machinery agents are all indexed;
 * project instances win on a name collision (they are the dispatchable roster).
 */
export function buildTierIndex(resolution: RosterResolution): Record<string, ModelTier> {
  const index: Record<string, ModelTier> = {};
  const put = (e: RosterAgentEntry) => {
    index[e.name] = e.default_tier;
  };
  // Precedence: templates first, then merged roster (project wins over shipped).
  resolution.templates.forEach(put);
  resolution.roster.forEach(put);
  return index;
}

// ── The G8 scoring seam ──────────────────────────────────────────────────────

/**
 * The injectable fan-out scorer G8 will supply. Given a lane's role, its station,
 * and the composition signals, it returns the fan-out for that lane. G6a passes
 * NOTHING here, so every lane takes the policy table's `default_fanout` (D1
 * `lead_only`). G8 adds real signal scoring by passing this hook — WITHOUT
 * reshaping `composeStationTeam`'s signature (the whole point of the seam).
 */
export type FanoutScorer = (input: {
  role: string;
  station: StationId;
  signals: StationSignals;
  /** The policy-table baseline, so a scorer can choose to only ever RAISE it. */
  baseline: CellFanout;
}) => CellFanout;

export interface StationComposeConfig {
  /** role → default_tier, from `buildTierIndex(resolveRoster(...))` (D4). REQUIRED. */
  tierIndex: Record<string, ModelTier>;
  /**
   * G8 fan-out scoring seam. Omitted in G6a ⇒ every lane uses the table baseline.
   * When present it is called per lane; its result replaces the baseline.
   */
  scoreFanout?: FanoutScorer;
  /** Override the specialist cap (default `TEAM_CAP` = 6). */
  cap?: number;
  /**
   * Fallback tier for a role absent from `tierIndex` (should not happen for a
   * canonical role — every policy/implied role is a shipped template). Defaults to
   * "mid" (the roster's neutral working tier) so composition never fails closed on
   * a lookup miss; a miss is surfaced to the caller via the return, not thrown.
   */
  fallbackTier?: ModelTier;
}

// ── composeStationTeam ───────────────────────────────────────────────────────

/**
 * Deterministically compose the team for `station` given the composition
 * `signals` — a policy-table lookup + the §Implied Specialist Rules, NO scoring.
 *
 * Algorithm (pure, order-stable, idempotent):
 *   1. Start from the station's `default_roster` (source: "default").
 *   2. Append each `conditional_roster` role ONLY when its gating signal is truthy
 *      (source: "optional", `fired_rule` = `opt:<station>:<role>`).
 *   3. For each `IMPLIED_RULES` whose `signal` is truthy in `signals`, append its
 *      `adds` (source: "implied", `fired_rule` = rule id). Every rule whose signal
 *      fires is recorded in `fired_rules` — even if its role is deduped or capped.
 *   4. Dedupe by role, keeping the FIRST occurrence (so a default/optional role is
 *      never downgraded to "implied", and an implied role added by two rules keeps
 *      the first rule's provenance).
 *   5. Apply cap-6: if the specialist count exceeds `cap`, drop from the tail
 *      (optionals are last in priority order, so they go first), recording
 *      `dropped_roles` and `capped: true`. The advisory-memory agent never counts.
 *   6. Resolve each lane's `default_tier` from `config.tierIndex` and its `fanout`
 *      from `config.scoreFanout` (if any) else the table baseline.
 *
 * Throws only on an unknown `station` (a programming error — fail loud, since a
 * bad station id must never silently compose an empty team).
 */
export function composeStationTeam(
  station: StationId,
  signals: StationSignals,
  config: StationComposeConfig
): TeamPlanV1 {
  const policy = STATION_POLICY[station];
  if (!policy) {
    throw new Error(
      `station-composer: unknown station "${station}" — must be one of ${STATIONS.join(", ")}`
    );
  }
  const cap = config.cap ?? TEAM_CAP;
  const fallbackTier = config.fallbackTier ?? "mid";

  // `fired_rules` is SIGNAL-driven — a rule is recorded the moment its signal fires,
  // independent of whether the resulting role survives dedup or the cap. The audit
  // trail of "which conditions triggered which policy" must never be lost just
  // because the role was already a default (deduped) or dropped by cap-6.
  const fired_rules: string[] = [];
  const firedSet = new Set<string>();
  const recordFired = (id: string): void => {
    if (!firedSet.has(id)) { firedSet.add(id); fired_rules.push(id); }
  };

  // (1)-(3) — build the ordered candidate list, priority order preserved.
  interface Candidate {
    role: string;
    source: LaneSource;
    fired_rule?: string;
  }
  const candidates: Candidate[] = [];
  // (1) defaults — always present.
  for (const role of policy.default_roster) candidates.push({ role, source: "default" });
  // (2) conditional optionals — included ONLY when the gating signal fires (the fix
  // for "optionals added unconditionally"); each records an `opt:<station>:<role>` rule.
  for (const [role, signal] of Object.entries(policy.conditional_roster)) {
    if (signals[signal] !== true) continue;
    const ruleId = `opt:${station}:${role}`;
    recordFired(ruleId);
    candidates.push({ role, source: "optional", fired_rule: ruleId });
  }
  // (3) global implied rules — when the signal fires; record the rule id even if the
  // role is later deduped/capped.
  for (const rule of IMPLIED_RULES) {
    if (signals[rule.signal] !== true) continue;
    recordFired(rule.id);
    for (const role of rule.adds) {
      candidates.push({ role, source: "implied", fired_rule: rule.id });
    }
  }

  // (3b) — ENFORCE plan-driven exclusion: a role declared plan-driven for this
  // station is NEVER resolved by the deterministic composer, even if some default/
  // conditional/implied path would otherwise add it. G6b plan wiring owns these
  // slots (the doc's "relevant implementers" / signal-less "when needed" roles).
  // This is defense-in-depth: the guarantee is enforced, not incidental.
  const planDriven = new Set<string>(policy.plan_driven_slots);
  const composable = candidates.filter((c) => !planDriven.has(c.role));

  // (4) — dedupe by role, first occurrence wins (priority order).
  const seen = new Set<string>();
  const ordered: Candidate[] = [];
  for (const c of composable) {
    if (seen.has(c.role)) continue;
    seen.add(c.role);
    ordered.push(c);
  }

  // (5) — cap-6. Tail drop preserves defaults > implied > (trailing) optionals.
  const rank: Record<LaneSource, number> = { default: 0, implied: 1, optional: 2 };
  const prioritized = ordered
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank[a.c.source] - rank[b.c.source] || a.i - b.i)
    .map((x) => x.c);

  const kept = prioritized.slice(0, cap);
  const dropped = prioritized.slice(cap);
  const dropped_roles = dropped.map((c) => c.role);

  // (6) — resolve tier + fanout + scope per surviving lane, in original priority order.
  const roster: TeamPlanLane[] = kept
    .sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b))
    .map((c) => {
      const baseline = policy.default_fanout;
      const fanout = config.scoreFanout
        ? config.scoreFanout({ role: c.role, station, signals, baseline })
        : baseline;
      const lane: TeamPlanLane = {
        role: c.role,
        scope: null, // composer does not assign scope; G6b plan wiring populates it.
        default_tier: config.tierIndex[c.role] ?? fallbackTier,
        fanout,
        source: c.source,
      };
      if ((c.source === "implied" || c.source === "optional") && c.fired_rule) {
        lane.fired_rule = c.fired_rule;
      }
      return lane;
    });

  return {
    schema_version: TEAM_PLAN_SCHEMA,
    station,
    roster,
    fired_rules,
    plan_driven_slots: [...policy.plan_driven_slots],
    advisory_memory: policy.advisory_memory,
    cap,
    capped: dropped_roles.length > 0,
    dropped_roles,
  };
}

// ── Validators (fail-closed; typed | null, never throw — G2 idiom) ────────────

const MODEL_TIERS: ReadonlySet<string> = new Set<string>(["cheap", "mid", "powerful"]);
const CELL_FANOUTS: ReadonlySet<string> = new Set<string>([
  "lead_only",
  "lead_plus_one",
  "lead_plus_many",
]);
const LANE_SOURCES: ReadonlySet<string> = new Set<string>(["default", "optional", "implied"]);

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isStrArr = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

/** A fired_rule id is a known IMPLIED_RULES id or a `opt:<station>:<role>` id. */
const IMPLIED_RULE_IDS: ReadonlySet<string> = new Set<string>(IMPLIED_RULES.map((r) => r.id));
function isKnownRuleId(id: string): boolean {
  if (IMPLIED_RULE_IDS.has(id)) return true;
  return /^opt:[a-z-]+:[A-Za-z0-9_-]+$/.test(id);
}

function isTeamPlanLane(v: unknown): v is TeamPlanLane {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!isStr(o["role"])) return false;
  // scope: string | null (composer emits null; G6b may populate).
  if (!(o["scope"] === null || isStr(o["scope"]))) return false;
  if (!MODEL_TIERS.has(o["default_tier"] as string)) return false;
  if (!CELL_FANOUTS.has(o["fanout"] as string)) return false;
  if (!LANE_SOURCES.has(o["source"] as string)) return false;
  // fired_rule is present iff source is "implied" OR "optional" (a conditional
  // optional now carries its `opt:` rule id); absent for a plain default lane.
  if (o["source"] === "implied" || o["source"] === "optional") {
    if (!isStr(o["fired_rule"]) || !isKnownRuleId(o["fired_rule"])) return false;
  } else if (o["fired_rule"] !== undefined) {
    return false;
  }
  return true;
}

/**
 * Fail-closed validation of a `guild.team_plan.v1`. Returns the typed plan or
 * NULL — never throws, never repairs. Rejects an unknown station, a malformed
 * lane, a non-boolean `advisory_memory`/`capped`, a bad `cap`, or a `fired_rules`
 * / `dropped_roles` that is not a string array. Also rejects a plan whose
 * `capped` flag disagrees with `dropped_roles` (a `capped:true` with no dropped
 * role, or vice versa) — the two must be consistent.
 */
export function validateTeamPlanV1(obj: unknown): TeamPlanV1 | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== TEAM_PLAN_SCHEMA) return null;
  if (!isStation(o["station"] as string)) return null;
  if (!Array.isArray(o["roster"]) || !o["roster"].every(isTeamPlanLane)) return null;
  // fired_rules: every entry must be a KNOWN rule id (implied id or `opt:<station>:<role>`),
  // so a plan cannot claim arbitrary fired rules.
  if (!(Array.isArray(o["fired_rules"]) && (o["fired_rules"] as unknown[]).every((x) => typeof x === "string" && isKnownRuleId(x)))) {
    return null;
  }
  if (!isStrArr(o["plan_driven_slots"])) return null; // isStrArr accepts [] (empty is legal)
  if (!(Array.isArray(o["dropped_roles"]) && (o["dropped_roles"] as unknown[]).every((x) => typeof x === "string"))) {
    return null;
  }
  if (typeof o["advisory_memory"] !== "boolean") return null;
  if (typeof o["capped"] !== "boolean") return null;
  if (!Number.isInteger(o["cap"]) || (o["cap"] as number) < 1) return null;
  // capped ⇔ at least one dropped role.
  if (o["capped"] !== (o["dropped_roles"] as unknown[]).length > 0) return null;
  // Roster must not exceed the declared cap.
  if ((o["roster"] as unknown[]).length > (o["cap"] as number)) return null;
  return o as unknown as TeamPlanV1;
}

function isTeamResultLane(v: unknown): v is TeamResultLane {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!isStr(o["role"]) || !isStr(o["instance_id"])) return false;
  if (!(o["handoff_ref"] === null || isStr(o["handoff_ref"]))) return false;
  if (!(o["acceptance_ref"] === null || isStr(o["acceptance_ref"]))) return false;
  return true;
}

/**
 * Fail-closed validation of a `guild.team_result.v1`. Returns the typed result or
 * NULL. Enforces the G2 D3 freshness invariant STRUCTURALLY: a result whose lanes
 * carry a DUPLICATE `instance_id` is rejected (proves adversarial test 12 — no
 * reused runtime identity can masquerade as two typed lane results). An empty
 * `lanes` array is legal (a station may compose but dispatch nothing).
 */
export function validateTeamResultV1(obj: unknown): TeamResultV1 | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== TEAM_RESULT_SCHEMA) return null;
  if (!isStation(o["station"] as string)) return null;
  if (!isStr(o["team_plan_ref"])) return null;
  if (!Array.isArray(o["lanes"]) || !o["lanes"].every(isTeamResultLane)) return null;
  // D3 freshness — instance_ids must be DISTINCT across lanes.
  const ids = (o["lanes"] as TeamResultLane[]).map((l) => l.instance_id);
  if (new Set(ids).size !== ids.length) return null;
  return o as unknown as TeamResultV1;
}

/** Convenience: is `v` a non-empty string array (exported for the wiring lane G6b). */
export { isStr as isNonEmptyString, isStrArr as isNonEmptyStringArray };
