/**
 * lib/init-offer-initiative.ts — opt-in "create an initiative?" final step of init.
 *
 * docs/v2/06-initiatives.md §Init's role:
 *   "'/guild:init' (the Init phase) **offers** a first initiative as its final step —
 *   opt-in, never forced ([v2.x] — design-fixed; the shipped init skill does not make
 *   the offer yet)."
 *
 * Two exports:
 *   shouldOfferInitiative(context) → bool
 *     Decide whether the init skill should surface the opt-in initiative offer to the
 *     operator.  Returns true ONLY when adding a durable goal container adds value.
 *     A one-off or trivially short task NEVER triggers the offer — the zero-cost-one-off
 *     invariant must hold.
 *
 *   buildInitiativeOffer(initState) → InitiativeOfferPayload
 *     Build the proposal payload the init skill surfaces for the user to accept/decline.
 *     Caller supplies all randomness-free deterministic inputs; this function is PURE.
 *     NEVER auto-creates anything — the payload is a proposal only.
 *
 * Hard constraints:
 *   - PURE + deterministic — no Date.now(), no Math.random(), no I/O.
 *   - Opt-in / default-off — caller controls the write; this module never writes files.
 *   - No side effects that would change an existing path.
 */

// ── Context types ─────────────────────────────────────────────────────────────

/**
 * Signals from the init run that inform the offer decision.
 *
 * isBrownfield         — project already has code/docs/a wiki; a first initiative
 *                        is MORE appropriate for a brownfield (ongoing work) than a
 *                        brand-new empty scaffold.
 * hasExistingInitiative — at least one active initiative already exists; the init
 *                        skill should NOT offer to create a second one silently.
 * taskComplexitySignals — hints extracted from the init brief. Each truthy signal
 *                        raises the likelihood that the work is durable. Empty array
 *                        means no durable-goal evidence was found.
 */
export interface OfferContext {
  /** True when the project already has an existing codebase (brownfield scan found content). */
  isBrownfield: boolean;
  /** True when .guild/initiatives/active/ already contains at least one initiative. */
  hasExistingInitiative: boolean;
  /**
   * Complexity / durability signals extracted from the init brief.
   * Examples: "ongoing", "milestone", "over the next N weeks", "rollout", "phase".
   * The caller extracts these; this module only counts/classifies them.
   */
  taskComplexitySignals: TaskComplexitySignal[];
}

/** Vocabulary of durable-goal signals the init-brief parser may detect. */
export const TASK_COMPLEXITY_SIGNALS = [
  "ongoing",
  "multi_phase",
  "multi_sprint",
  "rollout",
  "milestone",
  "cross_team",
  "cross_repo",
  "initiative_keyword",
  "explicit_duration",
] as const;
export type TaskComplexitySignal = (typeof TASK_COMPLEXITY_SIGNALS)[number];

// ── shouldOfferInitiative ─────────────────────────────────────────────────────

/**
 * Decide whether the init skill should surface the opt-in initiative offer.
 *
 * Rules (all must pass for true):
 *   1. No existing active initiative — a second offer when one already exists is
 *      noise (the operator can /guild:initiative new explicitly).
 *   2. At least one durable-goal signal OR the project is brownfield — a purely
 *      greenfield one-liner with zero signals gets no offer (zero-cost-one-off
 *      invariant from docs/v2/06-initiatives.md §Opt-in attachment binding).
 *
 * Note: the asymmetry is intentional — a false negative costs nothing (one-off
 * is first-class); a false positive costs exactly one question.
 */
export function shouldOfferInitiative(context: OfferContext): boolean {
  // Gate 1: never offer when an initiative already exists
  if (context.hasExistingInitiative) return false;

  // Gate 2: require at least one durable-goal signal OR a brownfield codebase
  const hasDurableSignal = context.taskComplexitySignals.length > 0;
  if (!hasDurableSignal && !context.isBrownfield) return false;

  return true;
}

// ── InitiativeOfferPayload ────────────────────────────────────────────────────

/**
 * Scope options for the proposed initiative.
 * Mirrors the scope vocabulary in docs/v2/06-initiatives.md §Project-scoped vs
 * workspace-scoped initiatives.  Init offers project-scoped by default;
 * workspace-scoped is only suggested when cross-repo signals are present.
 */
export const INITIATIVE_SCOPE_OPTIONS = ["project", "workspace"] as const;
export type InitiativeScopeOption = (typeof INITIATIVE_SCOPE_OPTIONS)[number];

/**
 * The payload the init skill surfaces for the user to accept/decline.
 * Caller accepts → calls /guild:initiative new with these fields pre-filled.
 * Caller declines → nothing is created, init run completes as one-off.
 *
 * NEVER auto-creates; this is a proposal only.
 */
export interface InitiativeOfferPayload {
  /** Proposed initiative id (slug from project name + optional signal context). */
  suggested_id: string;
  /** Human-readable title derived from project name + dominant signal. */
  suggested_title: string;
  /** Project-scoped default; workspace-scoped when cross-repo/cross-team signals. */
  suggested_scope: InitiativeScopeOption;
  /**
   * One-sentence rationale shown to the operator so they can make an informed
   * accept/decline decision.  Capped to avoid noisy output.
   */
  rationale: string;
  /**
   * The accept prompt the init skill should display verbatim.
   * Format: "Create initiative '<suggested_title>'? [y/N]"
   */
  accept_prompt: string;
}

/** State from the init run that the offer payload is derived from. */
export interface InitOfferState {
  /** Slug-safe project identifier (lower-kebab; e.g. "my-api", "web-app"). */
  projectSlug: string;
  /** Full display name, e.g. "My API". */
  projectDisplayName: string;
  /** Same signals already classified by shouldOfferInitiative. */
  taskComplexitySignals: TaskComplexitySignal[];
  /** Whether the project is brownfield (affects title wording). */
  isBrownfield: boolean;
}

// ── internal helpers ──────────────────────────────────────────────────────────

const CROSS_REPO_SIGNALS = new Set<TaskComplexitySignal>(["cross_repo", "cross_team"]);

function dominantSignal(signals: TaskComplexitySignal[]): TaskComplexitySignal | null {
  // Prefer higher-specificity signals: explicit_duration > initiative_keyword > multi_phase, etc.
  const priority: TaskComplexitySignal[] = [
    "explicit_duration",
    "initiative_keyword",
    "multi_phase",
    "multi_sprint",
    "rollout",
    "milestone",
    "cross_team",
    "cross_repo",
    "ongoing",
  ];
  for (const p of priority) {
    if (signals.includes(p)) return p;
  }
  return signals[0] ?? null;
}

const SIGNAL_TITLE_SUFFIX: Record<TaskComplexitySignal, string> = {
  ongoing: "ongoing work",
  multi_phase: "multi-phase delivery",
  multi_sprint: "sprint series",
  rollout: "rollout",
  milestone: "milestone delivery",
  cross_team: "cross-team initiative",
  cross_repo: "cross-repo initiative",
  initiative_keyword: "initiative",
  explicit_duration: "time-boxed delivery",
};

const SIGNAL_RATIONALE: Record<TaskComplexitySignal, string> = {
  ongoing: "the brief signals ongoing work — a durable initiative tracks progress across sessions",
  multi_phase: "multi-phase delivery benefits from a durable goal container across phases",
  multi_sprint: "work spanning multiple sprints is a natural fit for an initiative",
  rollout: "a rollout typically spans multiple sessions and environments",
  milestone: "milestone-based work benefits from a tracked durable goal",
  cross_team: "cross-team work benefits from a workspace-scoped initiative",
  cross_repo: "cross-repo work benefits from a workspace-scoped initiative",
  initiative_keyword: "the brief explicitly mentions an initiative",
  explicit_duration: "a stated time-box is a clear durable-goal signal",
};

// ── buildInitiativeOffer ──────────────────────────────────────────────────────

/**
 * Build the opt-in proposal payload shown to the operator at the end of init.
 * PURE: no I/O, no timestamps, no random IDs — the caller supplies everything.
 *
 * Suggested id  = "<projectSlug>-<signal-slug>" (or just "<projectSlug>" when no signals).
 * Suggested title = "<projectDisplayName> — <signal suffix>" (or "<projectDisplayName>" for brownfield-only).
 * Scope         = workspace when cross-repo/cross-team signals, project otherwise.
 */
export function buildInitiativeOffer(state: InitOfferState): InitiativeOfferPayload {
  const { projectSlug, projectDisplayName, taskComplexitySignals, isBrownfield } = state;

  const dominant = dominantSignal(taskComplexitySignals);
  const hasCrossScope = taskComplexitySignals.some((s) => CROSS_REPO_SIGNALS.has(s));

  // Suggested id: slug + signal qualifier when available
  const signalSlug = dominant
    ? dominant.replace(/_/g, "-")
    : isBrownfield
    ? "ongoing"
    : null;
  const suggested_id = signalSlug ? `${projectSlug}-${signalSlug}` : projectSlug;

  // Suggested title: displayName + suffix
  const suffix =
    dominant != null
      ? SIGNAL_TITLE_SUFFIX[dominant]
      : isBrownfield
      ? "ongoing work"
      : null;
  const suggested_title =
    suffix != null ? `${projectDisplayName} — ${suffix}` : projectDisplayName;

  // Scope
  const suggested_scope: InitiativeScopeOption = hasCrossScope ? "workspace" : "project";

  // Rationale
  const rationale =
    dominant != null
      ? SIGNAL_RATIONALE[dominant]
      : "this project already has content — an initiative can track durable goals across sessions";

  const accept_prompt = `Create initiative '${suggested_title}'? [y/N]`;

  return {
    suggested_id,
    suggested_title,
    suggested_scope,
    rationale,
    accept_prompt,
  };
}

// ── Validators ────────────────────────────────────────────────────────────────

/** Validate an OfferContext — used by callers to guard against malformed input. */
export function validateOfferContext(obj: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!obj || typeof obj !== "object") return { valid: false, errors: ["OfferContext is not an object"] };
  const c = obj as Record<string, unknown>;
  if (typeof c["isBrownfield"] !== "boolean") errors.push(`isBrownfield must be a boolean`);
  if (typeof c["hasExistingInitiative"] !== "boolean") errors.push(`hasExistingInitiative must be a boolean`);
  if (!Array.isArray(c["taskComplexitySignals"])) {
    errors.push(`taskComplexitySignals must be an array`);
  } else {
    const valid = new Set<string>(TASK_COMPLEXITY_SIGNALS);
    const bad = (c["taskComplexitySignals"] as unknown[]).filter(
      (s) => typeof s !== "string" || !valid.has(s)
    );
    if (bad.length > 0) errors.push(`unknown taskComplexitySignals: ${bad.join(", ")}`);
  }
  return { valid: errors.length === 0, errors };
}

/** Validate an InitOfferState — used by callers to guard against malformed input. */
export function validateInitOfferState(obj: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!obj || typeof obj !== "object") return { valid: false, errors: ["InitOfferState is not an object"] };
  const s = obj as Record<string, unknown>;
  for (const f of ["projectSlug", "projectDisplayName"]) {
    if (typeof s[f] !== "string" || s[f] === "") errors.push(`missing required string field "${f}"`);
  }
  if (typeof s["isBrownfield"] !== "boolean") errors.push(`isBrownfield must be a boolean`);
  if (!Array.isArray(s["taskComplexitySignals"])) {
    errors.push(`taskComplexitySignals must be an array`);
  } else {
    const valid = new Set<string>(TASK_COMPLEXITY_SIGNALS);
    const bad = (s["taskComplexitySignals"] as unknown[]).filter(
      (x) => typeof x !== "string" || !valid.has(x)
    );
    if (bad.length > 0) errors.push(`unknown taskComplexitySignals: ${bad.join(", ")}`);
  }
  return { valid: errors.length === 0, errors };
}
