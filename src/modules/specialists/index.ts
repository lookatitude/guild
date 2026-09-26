/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/teams/. This file republishes the exact
 * pre-fold public surface of src/modules/specialists so existing importers keep working;
 * T16 deletes it. New code imports src/domains/teams directly.
 */

export {
  MACHINERY_AGENT_IDS,
  MODULE_PUBLIC_API_VERSION,
  SPECIALIST_SKILL_PREFIXES,
  SPECIALIST_TEMPLATE_IDS,
  isMachineryAgentId,
  isSpecialistSkillId,
  isSpecialistTemplateId,
  listMachineryAgentIds,
  listSpecialistSkillPrefixes,
  listSpecialistTemplateIds,
} from "../../domains/teams";
export type {
  MachineryAgentId,
  RosterAgentEntry,
  RosterResolution,
  RosterSkillEntry,
  RosterSource,
  SpecialistSkillPrefix,
  SpecialistTemplateId,
  Tier,
} from "../../domains/teams";
