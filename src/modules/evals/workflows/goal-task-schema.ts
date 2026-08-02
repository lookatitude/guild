/**
 * src/modules/evals/workflows/goal-task-schema.ts
 *
 * Versioned contracts for P.O.V.E.R. goals and host-portable task groups.
 */

import { deepFreeze } from "../../kernel";

export const GOAL_SCHEMA_VERSION = "guild.goal.v1" as const;
export const TASK_GROUP_SCHEMA_VERSION = "guild.task_group.v1" as const;

export type GoalSurface = "host_goal" | "guild_goal" | "task_group";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PoverGoalV1 {
  schema_version: typeof GOAL_SCHEMA_VERSION;
  id: string;
  title: string;
  problem: string;
  outcome: string;
  validation: string[];
  execution: string[];
  risks: string[];
  acceptance_criteria_ids: string[];
  project_scope: string[];
}

export interface TaskGroupTask {
  id: string;
  title: string;
  depends_on: string[];
  validation: string[];
  owner: string;
}

export interface TaskGroupV1 {
  schema_version: typeof TASK_GROUP_SCHEMA_VERSION;
  id: string;
  title: string;
  source_goal_id: string | null;
  tasks: TaskGroupTask[];
  acceptance_criteria_ids: string[];
  project_scope: string[];
  team_ref: string | null;
}

const GOAL_ALLOWED_KEYS = [
  "schema_version",
  "id",
  "title",
  "problem",
  "outcome",
  "validation",
  "execution",
  "risks",
  "acceptance_criteria_ids",
  "project_scope",
];

const TASK_GROUP_ALLOWED_KEYS = [
  "schema_version",
  "id",
  "title",
  "source_goal_id",
  "tasks",
  "acceptance_criteria_ids",
  "project_scope",
  "team_ref",
];

const TASK_ALLOWED_KEYS = ["id", "title", "depends_on", "validation", "owner"];

function show(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

function rejectUnknownKeys(
  errors: string[],
  obj: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${label} has unknown key "${key}"`);
  }
}

function requireNonEmptyString(errors: string[], obj: Record<string, unknown>, field: string): void {
  if (typeof obj[field] !== "string" || (obj[field] as string).trim() === "") {
    errors.push(`${field} must be a non-empty string`);
  }
}

function requireStringOrNull(errors: string[], obj: Record<string, unknown>, field: string): void {
  if (obj[field] !== null && typeof obj[field] !== "string") {
    errors.push(`${field} must be a string or null`);
  }
}

function requireNonEmptyStringArray(errors: string[], obj: Record<string, unknown>, field: string): void {
  const value = obj[field];
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field} must be a non-empty array of strings`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      errors.push(`${field}[${index}] must be a non-empty string`);
    }
  });
}

function requireStringArray(errors: string[], obj: Record<string, unknown>, field: string): void {
  const value = obj[field];
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array of strings`);
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string") errors.push(`${field}[${index}] must be a string`);
  });
}

export function selectGoalSurface(input: {
  hostSupportsGoalCommand?: boolean;
  forceTaskGroupFallback?: boolean;
}): GoalSurface {
  if (input.forceTaskGroupFallback) return "task_group";
  return input.hostSupportsGoalCommand ? "host_goal" : "guild_goal";
}

export function validateGoalV1(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["goal artifact must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;
  rejectUnknownKeys(errors, o, GOAL_ALLOWED_KEYS, "goal artifact");
  if (o["schema_version"] !== GOAL_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${GOAL_SCHEMA_VERSION}"; got ${show(o["schema_version"])}`);
  }
  requireNonEmptyString(errors, o, "id");
  requireNonEmptyString(errors, o, "title");
  requireNonEmptyString(errors, o, "problem");
  requireNonEmptyString(errors, o, "outcome");
  requireNonEmptyStringArray(errors, o, "validation");
  requireNonEmptyStringArray(errors, o, "execution");
  requireNonEmptyStringArray(errors, o, "risks");
  requireNonEmptyStringArray(errors, o, "acceptance_criteria_ids");
  requireNonEmptyStringArray(errors, o, "project_scope");
  return { valid: errors.length === 0, errors };
}

export function validateTaskGroupV1(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["task group artifact must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;
  rejectUnknownKeys(errors, o, TASK_GROUP_ALLOWED_KEYS, "task group artifact");
  if (o["schema_version"] !== TASK_GROUP_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${TASK_GROUP_SCHEMA_VERSION}"; got ${show(o["schema_version"])}`);
  }
  requireNonEmptyString(errors, o, "id");
  requireNonEmptyString(errors, o, "title");
  requireStringOrNull(errors, o, "source_goal_id");
  requireNonEmptyStringArray(errors, o, "acceptance_criteria_ids");
  requireNonEmptyStringArray(errors, o, "project_scope");
  requireStringOrNull(errors, o, "team_ref");

  const tasks = o["tasks"];
  if (!Array.isArray(tasks) || tasks.length === 0) {
    errors.push("tasks must be a non-empty array");
  } else {
    const seen = new Set<string>();
    tasks.forEach((task, index) => {
      if (typeof task !== "object" || task === null || Array.isArray(task)) {
        errors.push(`tasks[${index}] must be an object`);
        return;
      }
      const t = task as Record<string, unknown>;
      rejectUnknownKeys(errors, t, TASK_ALLOWED_KEYS, `tasks[${index}]`);
      requireNonEmptyString(errors, t, "id");
      requireNonEmptyString(errors, t, "title");
      requireStringArray(errors, t, "depends_on");
      requireNonEmptyStringArray(errors, t, "validation");
      requireNonEmptyString(errors, t, "owner");
      if (typeof t["id"] === "string" && t["id"].trim() !== "") {
        if (seen.has(t["id"])) errors.push(`tasks[${index}].id "${t["id"]}" is a duplicate`);
        seen.add(t["id"]);
      }
    });
    tasks.forEach((task, index) => {
      if (typeof task !== "object" || task === null || Array.isArray(task)) return;
      const t = task as Record<string, unknown>;
      const deps = t["depends_on"];
      if (!Array.isArray(deps)) return;
      deps.forEach((dep) => {
        if (typeof dep === "string" && dep.trim() !== "" && !seen.has(dep)) {
          errors.push(`tasks[${index}].depends_on references unknown task "${dep}"`);
        }
      });
    });
  }

  return { valid: errors.length === 0, errors };
}

export function isGoalV1(value: unknown): value is PoverGoalV1 {
  return validateGoalV1(value).valid;
}

export function isTaskGroupV1(value: unknown): value is TaskGroupV1 {
  return validateTaskGroupV1(value).valid;
}

export const GOAL_V1_EXAMPLE: PoverGoalV1 = deepFreeze({
  schema_version: GOAL_SCHEMA_VERSION,
  id: "G-1",
  title: "Route ambient prompts into lifecycle phases",
  problem: "Ordinary host prompts are not routed into the right Guild phase.",
  outcome: "Guild can infer the next phase and ask for approval before implementation.",
  validation: ["Prompt intake fixtures cover rough idea, spec-ready, plan-ready, QA, ops, and unrelated prompts."],
  execution: ["Add deterministic prompt intake schema and routing tests."],
  risks: ["Over-routing unrelated host prompts into Guild lifecycle."],
  acceptance_criteria_ids: ["AC-1"],
  project_scope: ["plugin"],
});

export const TASK_GROUP_V1_EXAMPLE: TaskGroupV1 = deepFreeze({
  schema_version: TASK_GROUP_SCHEMA_VERSION,
  id: "TG-1",
  title: "Fallback ordered tasks for hosts without /goal",
  source_goal_id: "G-1",
  tasks: [
    {
      id: "T-1",
      title: "Add prompt intake classifier",
      depends_on: [],
      validation: ["Classifier fixtures pass."],
      owner: "tooling-engineer",
    },
  ],
  acceptance_criteria_ids: ["AC-1"],
  project_scope: ["plugin"],
  team_ref: ".guild/team/prompt-intake.plan.yaml",
});
