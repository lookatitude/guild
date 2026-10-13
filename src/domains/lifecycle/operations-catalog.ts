export const OPERATIONS_ROUTER_SKILL_ID = "guild-operations" as const;

export const OPERATIONS_RUNBOOK_SKILLS = Object.freeze([
  Object.freeze({ runbook: "incident", skillId: "ops-incident" }),
  Object.freeze({ runbook: "maintenance", skillId: "ops-maintenance" }),
  Object.freeze({ runbook: "monitoring", skillId: "ops-monitoring" }),
  Object.freeze({ runbook: "release", skillId: "ops-release" }),
  Object.freeze({ runbook: "rollback", skillId: "ops-rollback" }),
] as const);

export type OperationsRunbook = (typeof OPERATIONS_RUNBOOK_SKILLS)[number]["runbook"];
export type OperationsSkillId =
  | typeof OPERATIONS_ROUTER_SKILL_ID
  | (typeof OPERATIONS_RUNBOOK_SKILLS)[number]["skillId"];

export function listOperationsSkillIds(): OperationsSkillId[] {
  return [
    OPERATIONS_ROUTER_SKILL_ID,
    ...OPERATIONS_RUNBOOK_SKILLS.map((entry) => entry.skillId),
  ];
}

export function listOperationsRunbooks(): Array<{
  runbook: OperationsRunbook;
  skillId: Exclude<OperationsSkillId, typeof OPERATIONS_ROUTER_SKILL_ID>;
}> {
  return OPERATIONS_RUNBOOK_SKILLS.map((entry) => ({ ...entry }));
}

export function isOperationsSkillId(value: string): value is OperationsSkillId {
  return listOperationsSkillIds().includes(value as OperationsSkillId);
}
