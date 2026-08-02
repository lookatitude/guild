/**
 * The specialists catalog (machinery-vs-template-library ADR).
 *
 * The plugin ships exactly THREE registered, dispatchable agents — the machinery
 * set (`agents/*.md`): `advisor` (powerful escalation supervisor),
 * `context-manager` (mid-tier bounded context assembler, added by decision
 * cap-loc-D01 once its written contract landed) and `developer` (generic
 * mid-tier lane worker). Every DOMAIN specialist type is
 * a TEMPLATE (`templates/specialists/*.md`, `guild.specialist_template.v1`):
 * read-only feedstock that guild:team-compose mints into the consuming repo's
 * `.guild/agents/` (roster-resolve.ts `mint`) before it can join a team.
 *
 * These tuples are a hand-maintained mirror of the manifest `owns` block and
 * the two filesystem trees, kept honest by capability-catalogs.test.ts; the
 * canonical enumeration consumers use at runtime is scripts/lib/roster.ts.
 */

// INTEGRATION (five-branch stack): the union of the learn lane's third machinery
// agent and the freeze lane's Object.freeze. Same conflict as
// `AUGMENTING_AGENT_IDS` in scripts/lib/roster.ts, and it must resolve the same
// way — capability-catalogs.test.ts holds these two enumerations to each other.
export const MACHINERY_AGENT_IDS = Object.freeze([
  "advisor",
  "context-manager",
  "developer",
] as const);

export const SPECIALIST_TEMPLATE_IDS = Object.freeze([
  "architect",
  "backend",
  "copywriter",
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
] as const);

export const SPECIALIST_SKILL_PREFIXES = Object.freeze([
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
] as const);

export type MachineryAgentId = (typeof MACHINERY_AGENT_IDS)[number];
export type SpecialistTemplateId = (typeof SPECIALIST_TEMPLATE_IDS)[number];
export type SpecialistSkillPrefix = (typeof SPECIALIST_SKILL_PREFIXES)[number];

export function listMachineryAgentIds(): MachineryAgentId[] {
  return [...MACHINERY_AGENT_IDS];
}

export function listSpecialistTemplateIds(): SpecialistTemplateId[] {
  return [...SPECIALIST_TEMPLATE_IDS];
}

export function listSpecialistSkillPrefixes(): SpecialistSkillPrefix[] {
  return [...SPECIALIST_SKILL_PREFIXES];
}

export function isMachineryAgentId(value: string): value is MachineryAgentId {
  return MACHINERY_AGENT_IDS.includes(value as MachineryAgentId);
}

export function isSpecialistTemplateId(value: string): value is SpecialistTemplateId {
  return SPECIALIST_TEMPLATE_IDS.includes(value as SpecialistTemplateId);
}

export function isSpecialistSkillId(value: string): boolean {
  return SPECIALIST_SKILL_PREFIXES.some((prefix) => value.startsWith(prefix));
}
