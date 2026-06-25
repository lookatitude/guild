export const QUALITY_GATE_SKILL_ID = "guild-quality" as const;

export type QualitySkillId = typeof QUALITY_GATE_SKILL_ID;

export function listQualitySkillIds(): QualitySkillId[] {
  return [QUALITY_GATE_SKILL_ID];
}

export function isQualitySkillId(value: string): value is QualitySkillId {
  return value === QUALITY_GATE_SKILL_ID;
}
