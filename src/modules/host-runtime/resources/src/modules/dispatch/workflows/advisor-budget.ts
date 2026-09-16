/**
 * The in-cell critic budget (KTD61 / R72, KTD68).
 *
 * The advisor is the critic — there is no fourth model family and no standalone
 * reviewer type. What makes that safe is that consulting it COSTS something:
 * `advisorRounds` (default 2) caps consults per cell, and exhaustion BLOCKS the
 * cell with `next_need: budget` instead of quietly looping a critic forever.
 *
 * The exclusions are the interesting half. D-PROBE (the security probe over a
 * candidate body), inner verify, harvest BM25, compile, and the SessionStart
 * marker read do NOT decrement. They are machinery Guild requires for
 * correctness; charging them to the critic budget would create a cell that
 * cannot afford to be safe. `budget_remaining` on `guild.goal_status.v1` is the
 * live remainder, so T0 sees the real number rather than a decorative field.
 */
import * as fs from "fs";
import * as path from "path";

import { deepFreeze, frozenList } from "../../kernel";
import { taskCellPaths } from "./task-cell-contract";

export const ADVISOR_BUDGET_SCHEMA = "guild.advisor_budget.v1" as const;

/** Policy default; the closed policy key is `advisorRounds`. */
export const DEFAULT_ADVISOR_ROUNDS = 2;

/**
 * Consult kinds. Exactly one of them decrements. The others are listed rather
 * than defaulted-to-free so that adding a new machinery consult is a deliberate
 * edit to this enum, not an accident.
 */
export const CONSULT_KINDS = frozenList([
  /** A real advisor escalation. THE decrementing kind. */
  "advisor",
  /** Security probe over untrusted text. Never decrements (KTD61). */
  "d-probe",
  /** The adapter's verify.after_edit hook. Never decrements. */
  "inner-verify",
  /** BM25 recall during harvest. Never decrements. */
  "harvest-bm25",
  /** Compile / SessionStart marker read. Never decrements. */
  "machinery",
] as const);

export type ConsultKind = (typeof CONSULT_KINDS)[number];

export function consultDecrements(kind: ConsultKind): boolean {
  return kind === "advisor";
}

export interface AdvisorBudgetV1 {
  schema_version: typeof ADVISOR_BUDGET_SCHEMA;
  run_id: string;
  logical_task_id: string;
  cell_id: string;
  /** The cap this cell was dispatched under. */
  rounds_allowed: number;
  rounds_used: number;
  /** Non-decrementing consults, kept for telemetry so "free" stays auditable. */
  exempt_consults: number;
  updated_at: string;
}

export function advisorBudgetPath(input: {
  run_id: string;
  logical_task_id: string;
  guildDir?: string;
}): string {
  const paths = taskCellPaths(
    { run_id: input.run_id, logical_task_id: input.logical_task_id, attempt: 1, instance_id: "ledger" },
    { guildDir: input.guildDir },
  );
  return path.join(paths.cell_dir, "advisor-budget.json");
}

/** Resolve the cap from already-resolved policy; a missing key is the default. */
export function resolveAdvisorRounds(policy: Record<string, unknown> | null | undefined): number {
  const raw = policy?.["advisorRounds"];
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return DEFAULT_ADVISOR_ROUNDS;
  return raw;
}

export function readAdvisorBudget(input: {
  cwd: string;
  run_id: string;
  logical_task_id: string;
  guildDir?: string;
}): AdvisorBudgetV1 | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.resolve(input.cwd, advisorBudgetPath(input)), "utf8"),
    ) as AdvisorBudgetV1;
    return parsed?.schema_version === ADVISOR_BUDGET_SCHEMA ? parsed : null;
  } catch {
    return null;
  }
}

function write(cwd: string, budget: AdvisorBudgetV1, guildDir?: string): void {
  const abs = path.resolve(
    cwd,
    advisorBudgetPath({ run_id: budget.run_id, logical_task_id: budget.logical_task_id, guildDir }),
  );
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(budget, null, 2)}\n`, "utf8");
}

/**
 * Create the cell's budget — IDEMPOTENT.
 *
 * An existing file is returned untouched. Round 1 overwrote it, so a cell that
 * had spent its rounds got them all back the next time anything initialised the
 * budget: a retry, a resume, a second runtime object. A cap that a re-init
 * refunds is not a cap, and the exhaustion block it is supposed to produce
 * would never be reached in a long-running cell.
 */
export function initAdvisorBudget(input: {
  cwd: string;
  run_id: string;
  logical_task_id: string;
  cell_id: string;
  rounds_allowed: number;
  now?: () => string;
  guildDir?: string;
}): AdvisorBudgetV1 {
  const existing = readAdvisorBudget(input);
  if (existing) return existing;
  const budget: AdvisorBudgetV1 = {
    schema_version: ADVISOR_BUDGET_SCHEMA,
    run_id: input.run_id,
    logical_task_id: input.logical_task_id,
    cell_id: input.cell_id,
    rounds_allowed: input.rounds_allowed,
    rounds_used: 0,
    exempt_consults: 0,
    updated_at: (input.now ?? (() => new Date().toISOString()))(),
  };
  write(input.cwd, budget, input.guildDir);
  return budget;
}

export type ConsultResult =
  | { ok: true; budget: AdvisorBudgetV1; decremented: boolean; remaining: number }
  | {
      ok: false;
      state: "blocked";
      next_need: "budget";
      reason: string;
      budget: AdvisorBudgetV1;
      remaining: 0;
    };

/**
 * Spend (or don't spend) one consult.
 *
 * On exhaustion this returns the BLOCK, it does not throw: the cell is meant to
 * surface `blocked` + `next_need: budget` on its `guild.goal_status.v1` so the
 * human gate lands on T0, which is where every human gate lands.
 */
export function consumeConsult(input: {
  cwd: string;
  run_id: string;
  logical_task_id: string;
  kind: ConsultKind;
  now?: () => string;
  guildDir?: string;
}): ConsultResult {
  const budget = readAdvisorBudget(input);
  if (!budget) {
    throw new Error(
      `no guild.advisor_budget.v1 for ${input.logical_task_id} — the budget is ` +
        `initialised at cell spawn; consulting before it exists is a dispatch defect`,
    );
  }
  const now = (input.now ?? (() => new Date().toISOString()))();
  if (!consultDecrements(input.kind)) {
    budget.exempt_consults += 1;
    budget.updated_at = now;
    write(input.cwd, budget, input.guildDir);
    return {
      ok: true,
      budget,
      decremented: false,
      remaining: budget.rounds_allowed - budget.rounds_used,
    };
  }
  if (budget.rounds_used >= budget.rounds_allowed) {
    return {
      ok: false,
      state: "blocked",
      next_need: "budget",
      remaining: 0,
      budget,
      reason:
        `advisorRounds exhausted (${budget.rounds_used}/${budget.rounds_allowed}) on ` +
        `cell ${budget.cell_id} — no new advisor round and no new T2 spawn. ` +
        `Raise advisorRounds or accept the current draft.`,
    };
  }
  budget.rounds_used += 1;
  budget.updated_at = now;
  write(input.cwd, budget, input.guildDir);
  return {
    ok: true,
    budget,
    decremented: true,
    remaining: budget.rounds_allowed - budget.rounds_used,
  };
}

export const ADVISOR_BUDGET_CONTRACT = deepFreeze({
  schema: ADVISOR_BUDGET_SCHEMA,
  policy_key: "advisorRounds",
  default: DEFAULT_ADVISOR_ROUNDS,
  consult_kinds: CONSULT_KINDS,
  decrementing_kinds: frozenList(["advisor"] as const),
});
