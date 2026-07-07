export const SPECIALIST_AGENT_IDS = [
  "advisor",
  "architect",
  "backend",
  "copywriter",
  "developer",
  "devops",
  "doc-writer",
  "frontend",
  "marketing",
  "mobile",
  "qa",
  "researcher",
  "sales",
  "security",
  "seo",
  "social-media",
  "technical-writer",
] as const;

export const SPECIALIST_SKILL_PREFIXES = [
  "architect-",
  "backend-",
  "copywriter-",
  "devops-",
  "doc-writer-",
  "frontend-",
  "marketing-",
  "mobile-",
  "qa-",
  "researcher-",
  "sales-",
  "security-",
  "seo-",
  "social-media-",
  "technical-writer-",
] as const;

export type SpecialistAgentId = (typeof SPECIALIST_AGENT_IDS)[number];
export type SpecialistSkillPrefix = (typeof SPECIALIST_SKILL_PREFIXES)[number];

export function listSpecialistAgentIds(): SpecialistAgentId[] {
  return [...SPECIALIST_AGENT_IDS];
}

export function listSpecialistSkillPrefixes(): SpecialistSkillPrefix[] {
  return [...SPECIALIST_SKILL_PREFIXES];
}

export function isSpecialistAgentId(value: string): value is SpecialistAgentId {
  return SPECIALIST_AGENT_IDS.includes(value as SpecialistAgentId);
}

export function isSpecialistSkillId(value: string): boolean {
  return SPECIALIST_SKILL_PREFIXES.some((prefix) => value.startsWith(prefix));
}
