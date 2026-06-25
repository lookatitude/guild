export const OPERATIONS_ROUTER_SKILL_ID = "guild-operations" as const;

export const OPERATIONS_RUNBOOK_SKILLS = [
  { runbook: "incident", skillId: "ops-incident" },
  { runbook: "maintenance", skillId: "ops-maintenance" },
  { runbook: "monitoring", skillId: "ops-monitoring" },
  { runbook: "release", skillId: "ops-release" },
  { runbook: "rollback", skillId: "ops-rollback" },
] as const;

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
