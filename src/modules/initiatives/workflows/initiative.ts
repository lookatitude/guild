/**
 * lib/initiative.ts — guild.initiative.v1 validator + 4-axis status derivation
 * and the definition-ledger readiness rule (deferred items 10 & 11).
 *
 * docs/v2/initiatives.md §Registry & directory / §Definition ledger; field
 * body canonical in docs/knowledge/observability/data-model.md §Initiative /
 * §DefinitionItem. The manifest was [v2-contract-only] (frozen target, no code
 * wrote/validated it). This is the [v2.x] adoption code: the closed-enum
 * validator + the derived-status function + the ledger gate. It never WRITES a
 * manifest (the sub-verb prose owns that) — it validates and derives.
 */

export const INITIATIVE_SCHEMA = "guild.initiative.v1";

// ── The four separate status axes (closed enums) ──────────────────────────────
export const DEFINITION_STATUS = ["incomplete", "assumed", "complete"] as const;
export const EXECUTION_STATUS = ["not_started", "active", "blocked", "done"] as const;
export const RELEASE_STATUS = ["not_released", "release_candidate", "released", "rollback_required"] as const;
export const DOCUMENTATION_STATUS = ["not_assessed", "no_update_required", "update_required", "updated", "stale"] as const;

export type DefinitionStatus = (typeof DEFINITION_STATUS)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUS)[number];
export type ReleaseStatus = (typeof RELEASE_STATUS)[number];
export type DocumentationStatus = (typeof DOCUMENTATION_STATUS)[number];

/** Derived human-facing status — computed from the axes, never set independently. */
export const DERIVED_STATUS = [
  "proposed", "defining", "ready", "in_progress", "review",
  "release_ready", "released", "docs_update_pending", "closed", "paused", "cancelled",
] as const;
export type DerivedStatus = (typeof DERIVED_STATUS)[number];

export interface InitiativeAxes {
  definition_status: DefinitionStatus;
  execution_status: ExecutionStatus;
  release_status: ReleaseStatus;
  documentation_status: DocumentationStatus;
}

export interface InitiativeManifest extends InitiativeAxes {
  id: string;
  title: string;
  summary_ref: string;
  created_at: string;
  updated_at: string;
  status?: DerivedStatus;
  // additive optional (lenient reader):
  project_id?: string;
  scope?: string;
  members?: string[];
  goal?: string;
  owner?: string;
  risk_level?: string;
  primary_branch?: string;
  active_run_id?: string;
}

const inEnum = <T extends readonly string[]>(set: T, v: unknown): v is T[number] =>
  typeof v === "string" && (set as readonly string[]).includes(v);

/**
 * Facts the manifest alone cannot carry, supplied by the caller:
 *  - archived: the initiative lives under archived/ (→ treated as closed).
 *  - paused:   the operator's explicit idle marker.
 *  - cancelled / hasReview / definingStarted.
 */
export interface DerivationFacts {
  archived?: boolean;
  paused?: boolean;
  cancelled?: boolean;
  hasReview?: boolean;
  definingStarted?: boolean;
}

/**
 * Derive `status` from the four axes + facts — the furthest-progressed point the
 * axes jointly support (initiatives.md §171). Detour states (paused /
 * cancelled / rollback) take precedence over the forward ladder.
 */
export function deriveInitiativeStatus(m: InitiativeAxes, facts: DerivationFacts = {}): DerivedStatus {
  if (facts.cancelled) return "cancelled";
  if (m.release_status === "rollback_required") return "release_ready"; // RollbackRequired detour folds to the release stage
  if (facts.paused) return "paused";
  if (facts.archived) return "closed";

  // Release/docs ladder (furthest first).
  if (m.release_status === "released") {
    if (m.documentation_status === "updated" || m.documentation_status === "no_update_required") return "closed";
    return "docs_update_pending";
  }
  if (m.release_status === "release_candidate") return "release_ready";

  // Execution ladder.
  if (m.execution_status === "active" || m.execution_status === "blocked") {
    return facts.hasReview ? "review" : "in_progress";
  }
  if (m.execution_status === "done") return "release_ready";

  // Pre-execution: definition ladder.
  if (m.definition_status === "complete" || m.definition_status === "assumed") return "ready";
  return facts.definingStarted ? "defining" : "proposed";
}

/** Validate a manifest against guild.initiative.v1: required fields + closed enums. */
export function validateInitiativeManifest(obj: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!obj || typeof obj !== "object") return { valid: false, errors: ["manifest is not an object"] };
  const m = obj as Record<string, unknown>;

  for (const f of ["id", "title", "summary_ref", "created_at", "updated_at"]) {
    if (typeof m[f] !== "string" || m[f] === "") errors.push(`missing required string field "${f}"`);
  }
  if (!inEnum(DEFINITION_STATUS, m["definition_status"])) errors.push(`definition_status must be one of ${DEFINITION_STATUS.join("|")}`);
  if (!inEnum(EXECUTION_STATUS, m["execution_status"])) errors.push(`execution_status must be one of ${EXECUTION_STATUS.join("|")}`);
  if (!inEnum(RELEASE_STATUS, m["release_status"])) errors.push(`release_status must be one of ${RELEASE_STATUS.join("|")}`);
  if (!inEnum(DOCUMENTATION_STATUS, m["documentation_status"])) errors.push(`documentation_status must be one of ${DOCUMENTATION_STATUS.join("|")}`);
  if (m["status"] !== undefined && !inEnum(DERIVED_STATUS, m["status"])) errors.push(`status (when present) must be one of ${DERIVED_STATUS.join("|")}`);

  return { valid: errors.length === 0, errors };
}

// ── Definition ledger (item 11) ───────────────────────────────────────────────

export const DEFINITION_CATEGORIES = [
  "goal", "outcome", "scope", "non_goal", "acceptance", "constraint", "risk", "assumption", "open_question",
] as const;
export const DEFINITION_ITEM_STATUS = ["defined", "needs_definition", "assumed", "superseded"] as const;
export type DefinitionCategory = (typeof DEFINITION_CATEGORIES)[number];
export type DefinitionItemStatus = (typeof DEFINITION_ITEM_STATUS)[number];

export interface DefinitionItem {
  id: string;
  initiative_id: string;
  category: DefinitionCategory;
  statement: string;
  status: DefinitionItemStatus;
  blocking: boolean;
  evidence_refs?: string[];
  updated_at?: string;
}

export function validateDefinitionItem(obj: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!obj || typeof obj !== "object") return { valid: false, errors: ["definition_item is not an object"] };
  const d = obj as Record<string, unknown>;
  for (const f of ["id", "initiative_id", "statement"]) {
    if (typeof d[f] !== "string" || d[f] === "") errors.push(`missing required string field "${f}"`);
  }
  if (!inEnum(DEFINITION_CATEGORIES, d["category"])) errors.push(`category must be one of ${DEFINITION_CATEGORIES.join("|")}`);
  if (!inEnum(DEFINITION_ITEM_STATUS, d["status"])) errors.push(`status must be one of ${DEFINITION_ITEM_STATUS.join("|")}`);
  if (typeof d["blocking"] !== "boolean") errors.push(`blocking must be a boolean`);
  return { valid: errors.length === 0, errors };
}

/**
 * Ledger readiness (initiatives.md §187): an initiative is NOT ready while any
 * *blocking* definition item is still `needs_definition`. Returns the blocking
 * unresolved items (empty ⇒ ready).
 */
export function blockingUnresolved(items: DefinitionItem[]): DefinitionItem[] {
  return items.filter((d) => d.blocking && d.status === "needs_definition");
}
export function ledgerReady(items: DefinitionItem[]): boolean {
  return blockingUnresolved(items).length === 0;
}

// ── D8 close gate (item 16) ───────────────────────────────────────────────────

/** Inputs to the three-leg D8 close gate. */
export interface D8Input {
  /** verify.md PASS for the contributing runs (exec leg evidence). */
  execVerified: boolean;
  execution_status: ExecutionStatus;
  release_status: ReleaseStatus;
  documentation_status: DocumentationStatus;
}
export interface D8Result {
  canClose: boolean;
  legs: { exec: boolean; release: boolean; docs: boolean };
  blockers: string[];
}

/**
 * The D8 close gate (initiatives.md §The D8 close gate). An initiative cannot
 * close until THREE separate legs resolve — release and docs are never collapsed:
 *   1. exec    — verify.md PASS + execution_status done.
 *   2. release — release_status released (rollback_required does NOT close).
 *   3. docs    — documentation_status resolved (updated | no_update_required).
 *               The docs leg's work-item acceptance (initiative-workitems.ts)
 *               requires the consumer-facing docs/v2 design set to be reconciled
 *               in the same rollout whenever the initiative changed/added a
 *               feature surface — an initiative that ships a feature cannot close
 *               on a stale docs/v2 set.
 * Pure function; the sub-verb supplies the run evidence.
 */
export function d8CloseGate(i: D8Input): D8Result {
  const exec = i.execVerified && i.execution_status === "done";
  const release = i.release_status === "released";
  const docs = i.documentation_status === "updated" || i.documentation_status === "no_update_required";
  const blockers: string[] = [];
  if (!exec) blockers.push("exec leg unresolved: contributing runs not verify.md-PASS or execution_status != done");
  if (!release) blockers.push("release leg unresolved: release_status is not 'released'");
  if (!docs) blockers.push("docs leg unresolved: documentation_status not 'updated'/'no_update_required'");
  return { canClose: exec && release && docs, legs: { exec, release, docs }, blockers };
}
