/**
 * The two goal nouns, and the lint that keeps them apart (KTD51 / R33, R63).
 *
 *  - **`guild.goal.v1`** is PRODUCT INTENT: the P.O.V.E.R. statement of what is
 *    being built and how we will know. T0 does not read it directly; it reads a
 *    status envelope whose `goal_id` cites it.
 *  - **`guild.goal_status.v1`** is the CELL ROLL-UP: one Team Lead's report on
 *    one TaskCell. It is the ONLY thing that crosses the T1 → T0 boundary.
 *
 * Conflating them is what produced the Magentic-One failure mode this cut
 * exists to fix — one model holding both the outer task ledger and the inner
 * progress ledger. Keeping T0 ignorant of task specifics is not a style
 * preference; it is what keeps the orchestrator's context from filling with the
 * workers' transcripts until it can no longer route.
 *
 * So the lint here is deliberately blunt: a status envelope carrying changed-file
 * paths, specialist names, or a diff is REJECTED. Not truncated, not summarised.
 * An envelope that needs to name a file is describing task specifics, and task
 * specifics belong to the lead.
 */
import { deepFreeze, frozenList } from "../../kernel";

// ── guild.goal.v1 — product intent ───────────────────────────────────────────

export const GOAL_SCHEMA = "guild.goal.v1" as const;

export interface GoalV1 {
  schema_version: typeof GOAL_SCHEMA;
  id: string;
  title: string;
  problem: string;
  outcome: string;
  validation: string[];
  execution: string[];
  risks: string[];
  acceptance_criteria_ids: string[];
  project_scope: string[];
  /** Harvest pin-hit compares superseded ids against these (KTD53). */
  pinned_decision_ids?: string[];
  /**
   * The per-goal roster SLICE (KTD62). Role ids selected from the phase roster
   * that is ALREADY MINTED — never a second mint, never a parallel tree.
   */
  roster_role_ids?: string[];
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isStrArr = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Fail-closed. Returns the typed goal or null; never repairs. */
export function validateGoalV1(obj: unknown): GoalV1 | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== GOAL_SCHEMA) return null;
  for (const k of ["id", "title", "problem", "outcome"]) if (!isStr(o[k])) return null;
  for (const k of ["validation", "execution", "risks", "acceptance_criteria_ids", "project_scope"]) {
    if (!isStrArr(o[k])) return null;
  }
  for (const k of ["pinned_decision_ids", "roster_role_ids"]) {
    if (o[k] !== undefined && !isStrArr(o[k])) return null;
  }
  return obj as GoalV1;
}

// ── guild.goal_status.v1 — cell roll-up ──────────────────────────────────────

export const GOAL_STATUS_SCHEMA = "guild.goal_status.v1" as const;

export const GOAL_STATUS_STATES = frozenList(["running", "blocked", "done", "failed"] as const);
export type GoalStatusState = (typeof GOAL_STATUS_STATES)[number];

export const NEXT_NEEDS = frozenList([
  "ingest",
  "evolve",
  "create-specialist",
  "operator",
  "budget",
  "verify",
  "commit",
] as const);
export type NextNeed = (typeof NEXT_NEEDS)[number];

export const WORKFLOW_CLASSES = frozenList([
  "product",
  "research",
  "debug",
  "ops",
  "init",
] as const);
export type WorkflowClass = (typeof WORKFLOW_CLASSES)[number];

export interface GoalStatusV1 {
  schema_version: typeof GOAL_STATUS_SCHEMA;
  run_id: string;
  goal_id: string;
  phase_id: string;
  cell_id: string;
  team_id: string;
  state: GoalStatusState;
  progress: number;
  /** A COUNT, never names. */
  worker_count: number;
  /** Pointers. May be empty. */
  handoff_ids: string[];
  /** The only prose field. ≤100 tokens, lint-enforced. */
  summary: string;
  blocked_reason?: string;
  next_need?: NextNeed;
  budget_remaining?: { tokens?: number; usd?: number };
  workflow?: { class: WorkflowClass; node_id: string };
}

export function validateGoalStatusV1(obj: unknown): GoalStatusV1 | null {
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["schema_version"] !== GOAL_STATUS_SCHEMA) return null;
  for (const k of ["run_id", "goal_id", "phase_id", "cell_id", "team_id", "summary"]) {
    if (!isStr(o[k])) return null;
  }
  if (!(GOAL_STATUS_STATES as readonly string[]).includes(o["state"] as string)) return null;
  const progress = o["progress"];
  if (typeof progress !== "number" || progress < 0 || progress > 1) return null;
  const workers = o["worker_count"];
  if (typeof workers !== "number" || !Number.isInteger(workers) || workers < 0) return null;
  if (!isStrArr(o["handoff_ids"])) return null;
  // `blocked` without a reason is the status that says nothing; refuse it.
  if (o["state"] === "blocked" && !isStr(o["blocked_reason"])) return null;
  if (o["next_need"] !== undefined && !(NEXT_NEEDS as readonly string[]).includes(o["next_need"] as string)) {
    return null;
  }
  const wf = o["workflow"];
  if (wf !== undefined) {
    if (wf === null || typeof wf !== "object") return null;
    const w = wf as Record<string, unknown>;
    if (!(WORKFLOW_CLASSES as readonly string[]).includes(w["class"] as string)) return null;
    if (!isStr(w["node_id"])) return null;
  }
  const budget = o["budget_remaining"];
  if (budget !== undefined) {
    if (budget === null || typeof budget !== "object") return null;
    const b = budget as Record<string, unknown>;
    for (const k of ["tokens", "usd"]) {
      if (b[k] !== undefined && typeof b[k] !== "number") return null;
    }
  }
  return obj as GoalStatusV1;
}

// ── The orchestrator lint ────────────────────────────────────────────────────

/** ≤100 tokens; the ~4-chars-per-token approximation the catalog CI already uses. */
export const SUMMARY_TOKEN_CAP = 100;

export interface OrchestratorLintFinding {
  code:
    | "not_a_goal_status"
    | "path_in_envelope"
    | "diff_in_envelope"
    | "specialist_name_in_envelope"
    | "summary_over_cap"
    | "assignment_in_context";
  detail: string;
}

/** Anything that looks like a repo path, including Windows-style and globs. */
const PATH_LIKE =
  /(^|[\s"'([])(?:\.{0,2}\/|[A-Za-z]:\\)?[\w.-]+\/[\w.\/-]*\w|\b[\w.-]+\.(?:ts|tsx|js|jsx|json|md|ya?ml|py|go|rs|sh|html|css)\b/;

/** Unified-diff markers and fenced patch hunks. */
const DIFF_LIKE = /(^|\n)\s*(?:@@ |\+\+\+ |--- |diff --git )|```diff/;

/**
 * Does anything anywhere in this value look like an assignment?
 *
 * Round 1 only checked the TOP-LEVEL `schema_version`, so an assignment nested
 * one key deep — wrapped in `{ detail: … }`, or an array of them — reached the
 * orchestrator unflagged, which is precisely the leak R33 exists to stop.
 *
 * The walk is UNCAPPED and cycle-guarded: a depth limit would only move the leak
 * one level deeper, so termination comes from the visited set, not a counter.
 */
const FORBIDDEN_NESTED_SCHEMAS = frozenList([
  "guild.task_assignment.v2",
  "guild.task_assignment.v1",
  "guild.handoff_receipt.v1",
  "guild.handoff.v2",
] as const);

export function findNestedForbiddenSchema(value: unknown): string | null {
  // ITERATIVE and UNCAPPED. A depth limit on the CHECK is a hole with a number
  // on it: anything nested one level past the cap passed silently, so the fix
  // for a leak was to bury it deeper. The cycle guard, not a depth counter, is
  // what makes this terminate.
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const obj = node as Record<string, unknown>;
    const schema = obj["schema_version"];
    if (
      typeof schema === "string" &&
      (FORBIDDEN_NESTED_SCHEMAS as readonly string[]).includes(schema)
    ) {
      return schema;
    }
    for (const key of Object.keys(obj)) stack.push(obj[key]);
  }
  return null;
}

/**
 * Every string leaf in the value, so the prose rules see nested text too.
 *
 * Also uncapped: a path or a specialist name buried deep is still a path or a
 * name in the orchestrator's context.
 */
export function collectStringLeaves(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === "string") {
      out.push(node);
      continue;
    }
    if (node === null || typeof node !== "object") continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    const entries = Array.isArray(node) ? node : Object.values(node as Record<string, unknown>);
    for (const entry of entries) stack.push(entry);
  }
  return out;
}

export interface OrchestratorLintInput {
  envelopes: readonly unknown[];
  /**
   * Role ids of this cell's specialists. Named explicitly because "no names"
   * cannot be checked against a vocabulary the linter does not have — a status
   * envelope may legitimately contain the word "review".
   */
  specialist_names?: readonly string[];
}

/**
 * Lint everything the orchestrator is about to hold.
 *
 * Returns EVERY finding rather than the first, because the useful output when a
 * lead leaks is the full list of what it leaked, not a bisect.
 */
export function lintOrchestratorContext(input: OrchestratorLintInput): OrchestratorLintFinding[] {
  const findings: OrchestratorLintFinding[] = [];
  const names = (input.specialist_names ?? []).filter((n) => n.length > 2);
  input.envelopes.forEach((raw, index) => {
    const at = `envelope[${index}]`;
    // Nested first: an envelope can be schema-valid AND carry an assignment
    // inside an extra key, so a valid parse is not a clean bill of health.
    const nested = findNestedForbiddenSchema(raw);
    if (nested !== null) {
      findings.push({
        code: "assignment_in_context",
        detail:
          `${at} carries a nested ${nested} — the orchestrator must not hold ` +
          `assignments, receipts, or transcripts at any depth (R33)`,
      });
    }
    const env = validateGoalStatusV1(raw);
    if (!env) {
      if (nested === null) {
        findings.push({ code: "not_a_goal_status", detail: `${at} is not a valid guild.goal_status.v1` });
      }
      return;
    }
    // Prose rules run over EVERY string leaf, not just the two known fields: an
    // extra key is still bytes the orchestrator would be holding.
    const leaves = collectStringLeaves(raw);
    const prose = leaves.join("\n");
    if (DIFF_LIKE.test(prose)) {
      findings.push({ code: "diff_in_envelope", detail: `${at} carries a diff` });
    }
    if (PATH_LIKE.test(prose)) {
      findings.push({
        code: "path_in_envelope",
        detail: `${at} names a changed-file path; T0 sees pointers, not paths`,
      });
    }
    for (const name of names) {
      if (leaves.some((leaf) => leaf.includes(name))) {
        findings.push({
          code: "specialist_name_in_envelope",
          detail: `${at} names specialist '${name}'; worker_count is a count, not a roster`,
        });
      }
    }
    if (estimateTokens(env.summary) > SUMMARY_TOKEN_CAP) {
      findings.push({
        code: "summary_over_cap",
        detail: `${at} summary is ~${estimateTokens(env.summary)} tokens (cap ${SUMMARY_TOKEN_CAP})`,
      });
    }
  });
  return findings;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

// ── The T0 window: last 5 + rolling summary ──────────────────────────────────

/** KTD19: the orchestrator keeps the last 5 envelopes in FULL. */
export const ORCHESTRATOR_WINDOW = 5;

export interface OrchestratorContext {
  /** The last `ORCHESTRATOR_WINDOW` envelopes, verbatim. */
  recent: GoalStatusV1[];
  /**
   * Older cells collapsed. LATEST-ONLY (KTD32): each fold REPLACES this string,
   * it never appends a dated line to it.
   */
  rolling_summary: string;
  /** Verbatim pointers for the collapsed cells — ids only. */
  pointers: string[];
}

/**
 * Fold a stream of status envelopes into what T0 actually holds.
 *
 * Invalid envelopes are DROPPED, not repaired: a lead that emitted something
 * unparseable has a defect, and silently keeping the bytes would be exactly the
 * leak the lint above exists to stop.
 */
export function foldOrchestratorContext(
  envelopes: readonly unknown[],
  window = ORCHESTRATOR_WINDOW,
): OrchestratorContext {
  const valid = envelopes
    // A nested assignment is dropped here too. The fold is what T0 actually
    // HOLDS, so letting a schema-valid-but-contaminated envelope through would
    // put the bytes in the orchestrator's context and only report it later.
    .filter((e) => findNestedForbiddenSchema(e) === null)
    .map((e) => validateGoalStatusV1(e))
    .filter((e): e is GoalStatusV1 => e !== null);
  const recent = valid.slice(-window);
  const older = valid.slice(0, Math.max(0, valid.length - window));
  const counts = new Map<GoalStatusState, number>();
  for (const e of older) counts.set(e.state, (counts.get(e.state) ?? 0) + 1);
  const rolling_summary =
    older.length === 0
      ? ""
      : `${older.length} earlier cells: ` +
        [...counts.entries()].map(([state, n]) => `${n} ${state}`).join(", ");
  return { recent, rolling_summary, pointers: older.map((e) => e.cell_id) };
}

export const GOAL_CONTRACT = deepFreeze({
  intent: GOAL_SCHEMA,
  rollup: GOAL_STATUS_SCHEMA,
  window: ORCHESTRATOR_WINDOW,
  states: GOAL_STATUS_STATES,
  next_needs: NEXT_NEEDS,
  classes: WORKFLOW_CLASSES,
});
