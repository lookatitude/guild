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

import { types as nodeTypes } from "util";

import {
  type CellFanout,
  type ModelTier,
} from "../../dispatch";
import { type RosterAgentEntry, type RosterResolution } from "../../specialists";

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

// ── Decomposition signals + fan-out scoring (D1 · decision 5 · G8) ────────────

/**
 * The closed set of DECOMPOSITION signals the fan-out scorer keys off — DISTINCT
 * from `StationSignals` (which selects SPECIALISTS). These decide how a station
 * cell decomposes into workers. Fan-out is **signal-gated, NOT cost-gated**
 * (resolved decision 5): a decomposition signal firing is sufficient to fan out;
 * there is no token-cost veto.
 *
 *  - `independence`             genuinely independent / parallelizable branches ⇒ many.
 *  - `adversarial_value`        an INDEPENDENT adversarial / reviewer perspective adds
 *                               value, running parallel to the producer ⇒ many
 *                               (D1: "…or adversarially valuable work").
 *  - `distinct_discipline_count` how many distinct bounded specialties the work needs
 *                               BEYOND the lead: `0` ⇒ none, `1` ⇒ `lead_plus_one`,
 *                               `≥2` ⇒ `lead_plus_many`.
 *
 * `StationSignals` cannot express `independence` (it has no breadth/parallelism
 * axis), so a caller that knows a task is parallelizable supplies it explicitly via
 * `StationComposeConfig.decompositionSignals`; the rest can be DERIVED from
 * `StationSignals` (see `deriveDecompositionSignals`).
 */
export interface DecompositionSignals {
  independence?: boolean;
  adversarial_value?: boolean;
  distinct_discipline_count?: number;
}

/** The RESOLVED, fully-populated fan-out signal evidence recorded on every trace. */
export interface FanoutSignalsFired {
  independence: boolean;
  adversarial_value: boolean;
  distinct_discipline_count: number;
}

export type CostBand = "low" | "medium" | "high";

/**
 * A DETERMINISTIC ordinal cost proxy — **NOT** a token measurement. Guild has no
 * token oracle at compose time; G11 telemetry measures real per-cell tokens
 * post-hoc. This is stored per decision 5's auditability requirement so a reviewer
 * can see the estimated blast radius the (disabled) cost gate WOULD have weighed.
 * `band` derives deterministically from the mode; `worker_lanes` is the resolved
 * roster size. Cost is RECORDED, never GATING.
 */
export interface CostEstimate {
  band: CostBand;
  worker_lanes: number;
}

/** Decision 5: the cost gate is disabled by operator decision (signal-gated, not cost-gated). */
export const COST_GATE_POLICY = "disabled_by_operator" as const;

/**
 * The lead-binding DECISION (decision 2). `lead_only` ⇒ reuse the parent
 * orchestrator as lead (no new lead model call, no new `guild.agent_instance.v1`
 * for the lead — recorded as a `lead_binding_id` pointer at dispatch);
 * `lead_plus_one` / `lead_plus_many` ⇒ a distinct Team Lead call (recorded as a
 * `team_lead_instance_id`). The composer records the DECISION; the dispatch layer
 * fills the concrete runtime id. Worker instances are always fresh regardless (D3).
 */
export type LeadBindingKind = "reuse_parent" | "distinct_lead";

/**
 * A user / operator fan-out OVERRIDE — forces the mode regardless of the scored
 * signals, and stays fully TRACEABLE. Unlike the signal scorer (which only ever
 * RAISES fan-out), an override may raise OR lower the scored mode.
 */
export interface FanoutOverride {
  mode: CellFanout;
  /** Why the operator forced the mode (non-empty; recorded on the trace). */
  reason: string;
  /** Who forced it (non-empty; recorded on the trace). */
  by: string;
}

/** The override AS RECORDED on the trace (`null` when the mode is signal-scored). */
export interface FanoutOverrideRecord {
  applied: true;
  /** What the signals scored (before the override). */
  scored_mode: CellFanout;
  /** What the override forced (=== the resolved `mode`). */
  forced_mode: CellFanout;
  reason: string;
  by: string;
}

export const COMPOSITION_TRACE_SCHEMA = "guild.composition_trace.v1" as const;

/**
 * The per-cell COMPOSITION TRACE (decision 5 auditability requirement + D1). Stores
 * the evidence for the resolved fan-out mode so G11 can audit *why* a (potentially
 * high-cost) fan-out was allowed — cost never GATES the decision, but the evidence
 * is always recorded. Emitted on every `guild.team_plan.v1`.
 */
export interface CompositionTraceV1 {
  schema_version: typeof COMPOSITION_TRACE_SCHEMA;
  /** The resolved fan-out mode for the whole station cell (every lane mirrors it). */
  mode: CellFanout;
  /** Which decomposition signals fired — the `fanout_signals` evidence (decision 5). */
  fanout_signals: FanoutSignalsFired;
  /** Ordinal cost proxy — recorded, never gating (decision 5). */
  cost_estimate: CostEstimate;
  /** Constant: the cost gate is disabled by operator decision (decision 5). */
  cost_gate_policy: typeof COST_GATE_POLICY;
  /** Lead-binding DECISION (decision 2): reuse parent (`lead_only`) vs distinct lead. */
  lead_binding: LeadBindingKind;
  /** Convenience mirror: `true` ⇔ `mode === "lead_only"` ⇔ `lead_binding === "reuse_parent"`. */
  lead_reuses_parent: boolean;
  /** The traceable operator override, or `null` when the mode is purely signal-scored. */
  override: FanoutOverrideRecord | null;
}

/**
 * The `StationSignals` fields that each denote a distinct discipline. Used to DERIVE
 * `distinct_discipline_count` — the number of these that fired for a composition.
 */
const DISCIPLINE_SIGNALS: readonly (keyof StationSignals)[] = Object.freeze([
  "multi_component",
  "auth_touched",
  "backend_present",
  "user_facing_ui",
  "public_docs",
  "search_discoverability",
]);

/**
 * Derive best-effort `DecompositionSignals` from the specialist-selection
 * `StationSignals`, so a caller with only `StationSignals` still gets a sane mode.
 *
 *  - `independence` is NOT derivable (StationSignals has no breadth axis) ⇒ `false`;
 *    a caller that knows a task is parallelizable supplies it explicitly.
 *  - `adversarial_value` derives from `auth_touched` — security-sensitive work
 *    genuinely benefits from an INDEPENDENT adversarial review cell.
 *  - `distinct_discipline_count` = how many `DISCIPLINE_SIGNALS` fired.
 *
 * Explicit `config.decompositionSignals` are MERGED OVER this derivation per axis
 * (see `resolveDecomposition`).
 */
export function deriveDecompositionSignals(signals: StationSignals): DecompositionSignals {
  let count = 0;
  for (const k of DISCIPLINE_SIGNALS) if (signals[k] === true) count++;
  return {
    independence: false,
    adversarial_value: signals.auth_touched === true,
    distinct_discipline_count: count,
  };
}

/** Clamp a caller-supplied discipline count to a NON-NEGATIVE INTEGER (fail-closed:
 * a NaN / negative / non-integer / non-number collapses to 0, never a fan-out). */
function normalizeDisciplineCount(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

/** Merge explicit decomposition signals OVER the derived ones, per axis, and
 * normalize to the fully-populated `FanoutSignalsFired` evidence. */
function resolveDecomposition(
  derived: DecompositionSignals,
  explicit: DecompositionSignals | undefined
): FanoutSignalsFired {
  const e = explicit ?? {};
  return {
    independence: (e.independence ?? derived.independence) === true,
    adversarial_value: (e.adversarial_value ?? derived.adversarial_value) === true,
    distinct_discipline_count: normalizeDisciplineCount(
      e.distinct_discipline_count ?? derived.distinct_discipline_count
    ),
  };
}

/**
 * Score the fan-out MODE from the fired decomposition signals — **signal-gated
 * (decision 5), NO cost input**:
 *
 *  - `independence` OR `adversarial_value` OR `distinct_discipline_count ≥ 2`
 *    ⇒ `lead_plus_many` (independent / parallel / adversarial / cross-discipline);
 *  - exactly `distinct_discipline_count === 1` ⇒ `lead_plus_one` (one distinct
 *    bounded specialty);
 *  - otherwise ⇒ `lead_only` (small, linear — the parent orchestrator is the lead).
 */
export function scoreFanoutMode(fired: FanoutSignalsFired): CellFanout {
  if (
    fired.independence ||
    fired.adversarial_value ||
    fired.distinct_discipline_count >= 2
  ) {
    return "lead_plus_many";
  }
  if (fired.distinct_discipline_count === 1) return "lead_plus_one";
  return "lead_only";
}

/** Deterministic ordinal cost band from the resolved mode (recorded, never gating). */
function costBandForMode(mode: CellFanout): CostBand {
  return mode === "lead_plus_many" ? "high" : mode === "lead_plus_one" ? "medium" : "low";
}

/**
 * Total order over the three fan-out modes, so a station's `default_fanout` acts as
 * a FLOOR the signal scorer may only RAISE (the seam's original "only ever RAISE"
 * contract). An operator override is the sole authority that may lower the mode.
 */
const FANOUT_RANK: Readonly<Record<CellFanout, number>> = Object.freeze({
  lead_only: 0,
  lead_plus_one: 1,
  lead_plus_many: 2,
});

// ── Advisory challenger panel (advisory_panel — additive to team_plan.v1) ─────

/**
 * The composition-signal union a GATED advisory challenger may key off. Re-derived
 * locally as `keyof StationSignals` on purpose: `station-signals.ts` already imports
 * FROM this module, so importing its `StationSignalKey` back would form an import
 * cycle. `keyof StationSignals` is the same closed set, no new cross-file edge.
 */
export type AdvisoryChallengerSignal = keyof StationSignals;

/**
 * A challenger in a station's advisory panel. `signal` omitted ⇒ BASELINE (always
 * on — the safety floor); present ⇒ GATED (included only when that composition
 * signal is true).
 */
export interface AdvisoryChallenger {
  role: string;
  signal?: AdvisoryChallengerSignal;
}

/** Per-station advisory-panel POLICY (carried in `STATION_POLICY`). */
export interface AdvisoryPanelPolicy {
  /** Designated producer role; `null` = plan/class-driven (G6b-2b fills it). */
  producer: string | null;
  challengers: readonly AdvisoryChallenger[];
}

/**
 * The RESOLVED advisory panel on a composed `team_plan`. The producer + challengers
 * are ADVISORY — they do NOT enter the `roster`, do NOT count toward cap-6, and are
 * independent of roster resolution (a challenger role may or may not also appear in
 * the roster; they are different lists).
 */
export interface AdvisoryPanelV1 {
  /** Copied verbatim from the policy (may be null; G6b-2b may fill a null later). */
  producer: string | null;
  /** Resolved challengers (baseline + fired gated), deduped, order-stable. */
  challengers: string[];
  /** `chal:<station>:<role>` for each GATED challenger that fired (baseline emits none). */
  fired_challenger_rules: string[];
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
  /**
   * The advisory CHALLENGER panel POLICY for this station — the producer + the
   * baseline/gated challengers, as DATA. Replaces the old hardcoded per-skill
   * combos (guild-quality's `producer qa-test-strategy; challengers [security,
   * architect]`, guild-operations, …) with composer policy. ADVISORY only — never
   * enters the roster, never counts toward cap-6.
   */
  advisory_panel: AdvisoryPanelPolicy;
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
 * The empty advisory panel — no producer, no challengers — for stations with no
 * hardcoded challenger trail today (init/ideate/plan/build/research/definition/
 * learn). Shared frozen literal so an empty panel is a no-op, no-regression value.
 */
const EMPTY_ADVISORY_PANEL: AdvisoryPanelPolicy = Object.freeze({
  producer: null,
  challengers: Object.freeze([]),
});

/**
 * qa's advisory panel — replaces guild-quality's hardcoded `producer
 * qa-test-strategy; challengers [security, architect]`. security is BASELINE (the
 * always-on safety floor); architect is now GATED on `multi_component` — a
 * deliberate semantics change from the old fixed pair. The explicit type
 * annotation contextually types the `signal` literals as `keyof StationSignals`.
 */
const QA_ADVISORY_PANEL: AdvisoryPanelPolicy = Object.freeze({
  producer: "qa-test-strategy",
  challengers: Object.freeze([
    Object.freeze({ role: "security" }),
    Object.freeze({ role: "architect", signal: "multi_component" }),
  ]),
});

/**
 * ops' advisory panel — replaces guild-operations' hardcoded combo. producer is
 * class/plan-driven (`null` here; G6b-2b fills it); security BASELINE; architect
 * GATED on `multi_component`.
 */
const OPS_ADVISORY_PANEL: AdvisoryPanelPolicy = Object.freeze({
  producer: null,
  challengers: Object.freeze([
    Object.freeze({ role: "security" }),
    Object.freeze({ role: "architect", signal: "multi_component" }),
  ]),
});

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
    advisory_panel: EMPTY_ADVISORY_PANEL,
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
    advisory_panel: EMPTY_ADVISORY_PANEL,
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
    advisory_panel: EMPTY_ADVISORY_PANEL,
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
    advisory_panel: EMPTY_ADVISORY_PANEL,
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
    advisory_panel: QA_ADVISORY_PANEL,
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
    advisory_panel: OPS_ADVISORY_PANEL,
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
    advisory_panel: EMPTY_ADVISORY_PANEL,
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
    advisory_panel: EMPTY_ADVISORY_PANEL,
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
    advisory_panel: EMPTY_ADVISORY_PANEL,
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
  /**
   * The lane's fan-out mode. At this composer level every lane mirrors the cell's
   * resolved `composition_trace.mode` (the trace is authoritative; this is a
   * per-lane convenience mirror the validator holds consistent). G8 scores the mode
   * from decomposition signals; before G8 it was the D1 `lead_only` table baseline.
   */
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
  /**
   * The RESOLVED advisory challenger panel — producer + resolved challengers +
   * fired gated-challenger rule ids. ADVISORY: independent of the roster, never
   * counts toward cap-6. (REQUIRED field — G6b-2b consumes it.)
   */
  advisory_panel: AdvisoryPanelV1;
  /**
   * The per-cell COMPOSITION TRACE (G8): the resolved fan-out mode + the signal
   * evidence, cost proxy, cost-gate policy, and lead-binding decision that produced
   * it. Every `roster` lane's `fanout` mirrors `composition_trace.mode` (the trace
   * is authoritative). REQUIRED — decision 5 mandates the evidence on every cell.
   */
  composition_trace: CompositionTraceV1;
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

// ── Compose config (G8 fills the fan-out seam) ───────────────────────────────

export interface StationComposeConfig {
  /** role → default_tier, from `buildTierIndex(resolveRoster(...))` (D4). REQUIRED. */
  tierIndex: Record<string, ModelTier>;
  /**
   * Explicit decomposition signals (G8), MERGED OVER the derivation from
   * `StationSignals` (per axis, see `resolveDecomposition`). Supply the axes
   * `StationSignals` cannot express — chiefly `independence` for parallelizable
   * breadth (e.g. parallel-research). Omitted ⇒ the mode is scored purely from the
   * derived signals.
   */
  decompositionSignals?: DecompositionSignals;
  /**
   * A traceable operator fan-out OVERRIDE (G8). When present it FORCES the resolved
   * mode (may raise OR lower the scored mode) and is recorded verbatim on
   * `composition_trace.override`. An override with an unknown `mode` is a
   * programming error and throws (like an unknown station).
   */
  fanoutOverride?: FanoutOverride;
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
 * `signals` — a policy-table lookup + the §Implied Specialist Rules for roster
 * selection, plus G8 fan-out SCORING for the cell's decomposition mode.
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
 *   6. SCORE the fan-out mode (G8): derive decomposition signals from `signals`,
 *      merge `config.decompositionSignals` over them, `scoreFanoutMode(...)` →
 *      `lead_only | lead_plus_one | lead_plus_many` (signal-gated, NOT cost-gated).
 *      A `config.fanoutOverride` FORCES the mode and is recorded (traceable). Build
 *      the `composition_trace` (mode + fired signals + cost proxy + cost-gate policy
 *      + lead-binding decision + override). Every lane's `fanout` mirrors the mode.
 *   7. Resolve each lane's `default_tier` from `config.tierIndex`.
 *
 * Throws only on an unknown `station` or an override with an unknown `mode` (both
 * programming errors — fail loud, since a bad station id must never silently
 * compose an empty team, and a malformed override must never be silently dropped).
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

  // (6) — SCORE the fan-out mode (G8). Signal-gated, NOT cost-gated (decision 5).
  // Derive decomposition signals from `signals`, merge the caller's explicit ones
  // over them, and score the mode. The policy table's `default_fanout` is a FLOOR
  // the signal score may only RAISE (never lower) — an operator OVERRIDE is the only
  // authority that can lower it, and it is recorded verbatim.
  const fired = resolveDecomposition(
    deriveDecompositionSignals(signals),
    config.decompositionSignals
  );
  const scoredMode = scoreFanoutMode(fired);
  const flooredMode: CellFanout =
    FANOUT_RANK[scoredMode] >= FANOUT_RANK[policy.default_fanout]
      ? scoredMode
      : policy.default_fanout;
  let mode: CellFanout = flooredMode;
  let override: FanoutOverrideRecord | null = null;
  if (config.fanoutOverride) {
    const ov = config.fanoutOverride;
    if (!CELL_FANOUTS.has(ov.mode)) {
      throw new Error(
        `station-composer: invalid fanoutOverride.mode "${ov.mode}" — must be one of ${[...CELL_FANOUTS].join(", ")}`
      );
    }
    // An override MUST be traceable: a blank reason/by would produce a plan the
    // validator rejects, so the composer refuses to emit one (fail loud, like an
    // unknown mode — the composer's invariant is "always emits a valid plan").
    if (typeof ov.reason !== "string" || ov.reason.trim() === "") {
      throw new Error("station-composer: fanoutOverride.reason must be a non-empty string (override must be traceable)");
    }
    if (typeof ov.by !== "string" || ov.by.trim() === "") {
      throw new Error("station-composer: fanoutOverride.by must be a non-empty string (override must be traceable)");
    }
    mode = ov.mode;
    override = {
      applied: true,
      scored_mode: flooredMode,
      forced_mode: ov.mode,
      reason: ov.reason,
      by: ov.by,
    };
  }
  const composition_trace: CompositionTraceV1 = {
    schema_version: COMPOSITION_TRACE_SCHEMA,
    mode,
    fanout_signals: fired,
    cost_estimate: { band: costBandForMode(mode), worker_lanes: kept.length },
    cost_gate_policy: COST_GATE_POLICY,
    lead_binding: mode === "lead_only" ? "reuse_parent" : "distinct_lead",
    lead_reuses_parent: mode === "lead_only",
    override,
  };

  // (7) — resolve tier + scope per surviving lane, in original priority order. Every
  // lane's `fanout` mirrors the resolved cell mode (the trace is authoritative).
  const roster: TeamPlanLane[] = kept
    .sort((a, b) => ordered.indexOf(a) - ordered.indexOf(b))
    .map((c) => {
      const lane: TeamPlanLane = {
        role: c.role,
        scope: null, // composer does not assign scope; G6b plan wiring populates it.
        default_tier: config.tierIndex[c.role] ?? fallbackTier,
        fanout: mode,
        source: c.source,
      };
      if ((c.source === "implied" || c.source === "optional") && c.fired_rule) {
        lane.fired_rule = c.fired_rule;
      }
      return lane;
    });

  // (8) — resolve the ADVISORY CHALLENGER PANEL. Independent of the roster: a
  // challenger is a baseline (always-on) or a gated (signal-fired) reviewer, NOT a
  // roster lane. Iterate policy order; include a challenger when its `signal` is
  // undefined (baseline) OR the signal fired. Dedupe by role, order-stable. Each
  // GATED challenger that fired records `chal:<station>:<role>` (baseline emits no
  // fired-rule id); these NEVER fold into the roster `fired_rules`.
  const advisoryPolicy = policy.advisory_panel;
  const challengers: string[] = [];
  const challengerSeen = new Set<string>();
  const fired_challenger_rules: string[] = [];
  const firedChallengerSeen = new Set<string>();
  for (const ch of advisoryPolicy.challengers) {
    const gated = ch.signal !== undefined;
    const fired = gated ? signals[ch.signal as keyof StationSignals] === true : true;
    if (!fired) continue;
    if (!challengerSeen.has(ch.role)) {
      challengerSeen.add(ch.role);
      challengers.push(ch.role);
    }
    if (gated) {
      const ruleId = `chal:${station}:${ch.role}`;
      if (!firedChallengerSeen.has(ruleId)) {
        firedChallengerSeen.add(ruleId);
        fired_challenger_rules.push(ruleId);
      }
    }
  }
  const advisory_panel: AdvisoryPanelV1 = {
    producer: advisoryPolicy.producer,
    challengers,
    fired_challenger_rules,
  };

  const plan: TeamPlanV1 = {
    schema_version: TEAM_PLAN_SCHEMA,
    station,
    roster,
    fired_rules,
    plan_driven_slots: [...policy.plan_driven_slots],
    advisory_memory: policy.advisory_memory,
    advisory_panel,
    composition_trace,
    cap,
    capped: dropped_roles.length > 0,
    dropped_roles,
  };

  // INVARIANT (the trust anchor for the composition_trace contract): the composer is
  // the SOLE trusted producer and MUST only ever emit a plan its own fail-closed
  // validator accepts. If this ever fails it is a composer bug, not caller input —
  // fail loud rather than emit an internally-inconsistent plan a consumer would trust.
  if (validateTeamPlanV1(plan) === null) {
    throw new Error(
      "station-composer: composed an internally-invalid team_plan (composer bug) — refusing to emit"
    );
  }
  return plan;
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

/** A non-BLANK string (rejects whitespace-only) — the traceability bar the composer
 * enforces with `trim() === ""`; the validator must match it so it never accepts an
 * override the composer itself refuses. */
const isNonBlankStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * `Array.prototype.every` SKIPS holes in a sparse array — a hole would then pass a
 * naive `.every(pred)` check yet `JSON.stringify` serializes it to `null`, so a
 * plan could validate on write but fail on re-read (write/read asymmetry). This
 * visits EVERY index 0..length-1 (a hole reads as `undefined`, which every
 * predicate here rejects), closing the sparse-array hole for all array fields.
 */
function denseEvery(arr: readonly unknown[], pred: (x: unknown) => boolean): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (!pred(arr[i])) return false;
  }
  return true;
}

const isStrArr = (v: unknown): v is string[] =>
  Array.isArray(v) && denseEvery(v, (x) => typeof x === "string" && (x as string).length > 0);

const STATION_SEGMENT = /^[a-z-]+$/;
const ROLE_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * True for a scoped rule id of the exact shape `<prefix>:<station>:<role>` (e.g.
 * `opt:build:architect`, `chal:qa:security`).
 *
 * Parsed BY SEGMENT rather than with one caret-anchored identifier-then-colon regex
 * literal: the three-part shape is stated directly, and that anchored literal form
 * is the hand-rolled-YAML-field-extractor idiom the comms-format policy lints for —
 * this is a structured id, never YAML, so it should not read like one.
 */
function isScopedRuleId(id: string, prefix: string): boolean {
  const parts = id.split(":");
  return (
    parts.length === 3 &&
    parts[0] === prefix &&
    STATION_SEGMENT.test(parts[1]) &&
    ROLE_SEGMENT.test(parts[2])
  );
}

/** A fired_rule id is a known IMPLIED_RULES id or a `opt:<station>:<role>` id. */
const IMPLIED_RULE_IDS: ReadonlySet<string> = new Set<string>(IMPLIED_RULES.map((r) => r.id));
function isKnownRuleId(id: string): boolean {
  if (IMPLIED_RULE_IDS.has(id)) return true;
  return isScopedRuleId(id, "opt");
}

/**
 * Fail-closed check of a RESOLVED `advisory_panel` for `station`, enforcing the
 * SAME invariants `composeStationTeam` guarantees so a hand-authored plan cannot
 * smuggle a malformed audit trail past the validator: `producer` is a non-empty
 * string OR null; `challengers` is a DEDUPED string[] of non-empty entries; every
 * `fired_challenger_rules` entry is `chal:<station>:<role>` for THIS plan's
 * `station` (a `chal:` id for another station is rejected), references a role that
 * is PRESENT in `challengers` (a gated fire always adds its role), and is itself
 * deduped.
 */
function isAdvisoryPanelV1(v: unknown, station: StationId): v is AdvisoryPanelV1 {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!(o["producer"] === null || isStr(o["producer"]))) return false;
  if (!isStrArr(o["challengers"])) return false; // isStrArr accepts [] (empty is legal)
  const challengers = o["challengers"] as string[];
  if (new Set(challengers).size !== challengers.length) return false; // deduped (resolver guarantee)
  if (!Array.isArray(o["fired_challenger_rules"])) return false;
  const challengerSet = new Set(challengers);
  const prefix = `chal:${station}:`;
  const firedSeen = new Set<string>();
  for (const x of o["fired_challenger_rules"] as unknown[]) {
    if (typeof x !== "string") return false;
    if (!x.startsWith(prefix)) return false; // station-matched (rejects a cross-station chal: id)
    const role = x.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(role)) return false;
    if (!challengerSet.has(role)) return false; // fired rule must reference a PRESENT challenger
    if (firedSeen.has(x)) return false; // deduped
    firedSeen.add(x);
  }
  return true;
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

const COST_BANDS: ReadonlySet<string> = new Set<string>(["low", "medium", "high"]);
const LEAD_BINDINGS: ReadonlySet<string> = new Set<string>(["reuse_parent", "distinct_lead"]);

/**
 * A sentinel returned for an ACCESSOR descriptor or an ABSENT key — it fails every
 * subsequent type check, so a getter can never inject a value the validator trusts.
 */
const NOT_OWN_DATA = Symbol("not-own-data");

/**
 * Read an OWN DATA property of a plain object. Returns the raw value only for an own
 * DATA descriptor; an accessor descriptor (getter) or an absent key yields
 * `NOT_OWN_DATA`. This is the G6b-1/G7 fail-closed idiom: a non-throwing getter must
 * NOT be able to feed the validator a trusted-looking value.
 */
function ownData(o: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d && Object.prototype.hasOwnProperty.call(d, "value") ? d.value : NOT_OWN_DATA;
}

/** A plain, non-Proxy object (rejects null, primitives, arrays, and Proxies). */
function isPlainObject(v: unknown): v is object {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    !nodeTypes.isProxy(v)
  );
}

/**
 * Fail-closed check of a `guild.composition_trace.v1`, enforcing the SAME
 * invariants `composeStationTeam` guarantees so a hand-authored plan cannot smuggle
 * a fabricated fan-out justification past the validator. Reads are OWN-DATA only
 * (accessor getters ⇒ reject) and every nested object is rejected if it is a Proxy —
 * so an exotic input maps to invalid, never a trusted-looking read.
 *
 * SCOPE: this is a STRUCTURAL, INTERNAL-CONSISTENCY validator over a standalone
 * artifact. It guarantees `mode` is justified BY THE RECORDED `fanout_signals` (you
 * cannot claim a fan-out the recorded evidence doesn't support). It does NOT — and
 * a standalone validator cannot — adjudicate whether those recorded signals reflect
 * the real run inputs; that trust is established by the COMPOSER being the sole
 * producer (it always emits a self-consistent plan) and the emit path validating
 * before write. Re-deriving against a trusted `guild.station_signals.v1` envelope is
 * a separate provenance concern, not this validator's job.
 *
 * Invariants enforced:
 *  - `mode` ∈ {lead_only, lead_plus_one, lead_plus_many};
 *  - `fanout_signals` are two booleans + a non-negative integer discipline count;
 *  - `cost_estimate.band` MATCHES the mode (deterministic) and `worker_lanes` is a
 *    non-negative integer; `cost_gate_policy` is the disabled-by-operator constant;
 *  - `lead_binding` / `lead_reuses_parent` agree with the mode (reuse ⇔ lead_only);
 *  - with NO override, `mode` MUST equal the re-derived scored mode (signal-gated
 *    integrity — a plan cannot claim a fan-out its recorded signals don't justify);
 *  - with an override, it is a well-formed record whose `forced_mode` === `mode`,
 *    whose `scored_mode` === the re-derived scored mode, and carries non-empty
 *    `reason`/`by`. (An override is the ONLY way `mode` may diverge from the score.)
 */
function isCompositionTraceV1(v: unknown): v is CompositionTraceV1 {
  if (!isPlainObject(v)) return false;
  const o = v;
  if (ownData(o, "schema_version") !== COMPOSITION_TRACE_SCHEMA) return false;
  const modeRaw = ownData(o, "mode");
  if (typeof modeRaw !== "string" || !CELL_FANOUTS.has(modeRaw)) return false;
  const mode = modeRaw as CellFanout;

  // fanout_signals — the recorded evidence (own-data reads on a non-Proxy object).
  const fs = ownData(o, "fanout_signals");
  if (!isPlainObject(fs)) return false;
  const independence = ownData(fs, "independence");
  const adversarial_value = ownData(fs, "adversarial_value");
  const distinct = ownData(fs, "distinct_discipline_count");
  if (typeof independence !== "boolean") return false;
  if (typeof adversarial_value !== "boolean") return false;
  if (typeof distinct !== "number" || !Number.isInteger(distinct) || distinct < 0) return false;
  const fired: FanoutSignalsFired = { independence, adversarial_value, distinct_discipline_count: distinct };
  const scored = scoreFanoutMode(fired);

  // cost_estimate — recorded, band deterministic from the mode.
  const ce = ownData(o, "cost_estimate");
  if (!isPlainObject(ce)) return false;
  const band = ownData(ce, "band");
  const workerLanes = ownData(ce, "worker_lanes");
  if (typeof band !== "string" || !COST_BANDS.has(band)) return false;
  if (band !== costBandForMode(mode)) return false;
  if (typeof workerLanes !== "number" || !Number.isInteger(workerLanes) || workerLanes < 0) return false;
  if (ownData(o, "cost_gate_policy") !== COST_GATE_POLICY) return false;

  // lead-binding decision must agree with the mode.
  const leadBinding = ownData(o, "lead_binding");
  if (typeof leadBinding !== "string" || !LEAD_BINDINGS.has(leadBinding)) return false;
  if (leadBinding !== (mode === "lead_only" ? "reuse_parent" : "distinct_lead")) return false;
  if (ownData(o, "lead_reuses_parent") !== (mode === "lead_only")) return false;

  // override — null ⇒ signal-gated integrity (mode === scored); else a well-formed record.
  const ov = ownData(o, "override");
  if (ov === null) {
    if (mode !== scored) return false;
  } else {
    if (!isPlainObject(ov)) return false;
    if (ownData(ov, "applied") !== true) return false;
    const scoredMode = ownData(ov, "scored_mode");
    const forcedMode = ownData(ov, "forced_mode");
    if (typeof scoredMode !== "string" || !CELL_FANOUTS.has(scoredMode)) return false;
    if (typeof forcedMode !== "string" || !CELL_FANOUTS.has(forcedMode)) return false;
    if (forcedMode !== mode) return false; // forced === resolved
    if (scoredMode !== scored) return false; // recorded score === re-derived score
    const reason = ownData(ov, "reason");
    const by = ownData(ov, "by");
    // Non-BLANK (matches the composer's trim-based traceability invariant — the
    // validator must never accept an override the composer would refuse).
    if (!isNonBlankStr(reason) || !isNonBlankStr(by)) return false;
  }
  return true;
}

/**
 * Fail-closed validation of a `guild.team_plan.v1`. Returns the typed plan or
 * NULL — never throws, never repairs. Rejects an unknown station, a malformed
 * lane, a non-boolean `advisory_memory`/`capped`, a bad `cap`, or a `fired_rules`
 * / `dropped_roles` that is not a string array. Also rejects a plan whose
 * `capped` flag disagrees with `dropped_roles` (a `capped:true` with no dropped
 * role, or vice versa), a malformed / self-inconsistent `composition_trace` (G8),
 * a lane whose `fanout` diverges from the trace mode, or a trace `worker_lanes`
 * that disagrees with the roster size — the parts must be consistent.
 */
export function validateTeamPlanV1(obj: unknown): TeamPlanV1 | null {
  // Contract: NEVER throws. An exotic input (a Proxy trap / throwing own getter on
  // any read below) is treated as invalid and mapped to null.
  try {
    return validateTeamPlanV1Inner(obj);
  } catch {
    return null;
  }
}

function validateTeamPlanV1Inner(obj: unknown): TeamPlanV1 | null {
  if (obj === null || typeof obj !== "object") return null;
  // Reject a Proxy plan outright — its traps can lie on every read; there is no
  // trap-by-trap fixed point in userland (G7 lesson). A genuine plan is a plain object.
  if (nodeTypes.isProxy(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== TEAM_PLAN_SCHEMA) return null;
  if (!isStation(o["station"] as string)) return null;
  if (!Array.isArray(o["roster"]) || !denseEvery(o["roster"], (x) => isTeamPlanLane(x))) return null;
  // fired_rules: every entry must be a KNOWN rule id (implied id or `opt:<station>:<role>`),
  // so a plan cannot claim arbitrary fired rules.
  if (!(Array.isArray(o["fired_rules"]) && denseEvery(o["fired_rules"], (x) => typeof x === "string" && isKnownRuleId(x as string)))) {
    return null;
  }
  if (!isStrArr(o["plan_driven_slots"])) return null; // isStrArr accepts [] (empty is legal)
  if (!(Array.isArray(o["dropped_roles"]) && denseEvery(o["dropped_roles"], (x) => typeof x === "string"))) {
    return null;
  }
  if (typeof o["advisory_memory"] !== "boolean") return null;
  // advisory_panel is REQUIRED and must be a well-formed resolved panel for THIS
  // plan's station (station validated above).
  if (!isAdvisoryPanelV1(o["advisory_panel"], o["station"] as StationId)) return null;
  // composition_trace is REQUIRED (G8). Read it ONCE via an own-data descriptor so a
  // top-level accessor getter cannot inject a valid-looking trace (the own-data
  // hardening inside isCompositionTraceV1 is moot if this field itself is a getter).
  const traceField = ownData(o, "composition_trace");
  if (!isCompositionTraceV1(traceField)) return null;
  const trace = traceField;
  // Every roster lane's `fanout` MUST mirror the trace mode (the trace is
  // authoritative; a lane claiming a different fan-out than the cell resolved is a
  // fabricated plan). Dense check for the sparse-array hole.
  if (!denseEvery(o["roster"] as unknown[], (x) => (x as TeamPlanLane).fanout === trace.mode)) return null;
  if (typeof o["capped"] !== "boolean") return null;
  if (!Number.isInteger(o["cap"]) || (o["cap"] as number) < 1) return null;
  // capped ⇔ at least one dropped role.
  if (o["capped"] !== (o["dropped_roles"] as unknown[]).length > 0) return null;
  // Roster must not exceed the declared cap.
  if ((o["roster"] as unknown[]).length > (o["cap"] as number)) return null;
  // cost_estimate.worker_lanes MUST equal the roster size (the composer sets it so;
  // a mismatch means a tampered trace).
  if (trace.cost_estimate.worker_lanes !== (o["roster"] as unknown[]).length) {
    return null;
  }
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
  // Contract: NEVER throws (mirrors validateTeamPlanV1) — a Proxy trap / throwing
  // getter on any read below maps to null.
  try {
    return validateTeamResultV1Inner(obj);
  } catch {
    return null;
  }
}

function validateTeamResultV1Inner(obj: unknown): TeamResultV1 | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== TEAM_RESULT_SCHEMA) return null;
  if (!isStation(o["station"] as string)) return null;
  if (!isStr(o["team_plan_ref"])) return null;
  if (!Array.isArray(o["lanes"]) || !denseEvery(o["lanes"], (x) => isTeamResultLane(x))) return null;
  // D3 freshness — instance_ids must be DISTINCT across lanes.
  const ids = (o["lanes"] as TeamResultLane[]).map((l) => l.instance_id);
  if (new Set(ids).size !== ids.length) return null;
  return o as unknown as TeamResultV1;
}

/** Convenience: is `v` a non-empty string array (exported for the wiring lane G6b). */
export { isStr as isNonEmptyString, isStrArr as isNonEmptyStringArray };
