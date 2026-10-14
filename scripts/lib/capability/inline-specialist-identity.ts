import { createHash } from "node:crypto";
import {
  SPECIALIST_PROFILE_SCHEMA,
  SPECIALIST_TYPE_SCHEMA,
  hashSpecialistProfile,
  hashSpecialistType,
  specialistProfileFromAgentFrontmatter,
  type SpecialistProfileV1,
  type SpecialistTypeV2,
} from "../core/contracts/specialist-identity";
import { parseFrontmatter } from "../frontmatter";

export interface InlineIdentityLane {
  name: string;
  definition_source?: string;
  definition?: string;
  capability_scope?: string[];
  tier?: string;
  default_tier?: string;
  scope?: unknown;
  dependsOn?: unknown;
}

const sha256Prefixed = (content: string | Buffer) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

/**
 * The identity a lane gets when no committed ref supplies its hashes. One
 * derivation shared by agent-team-launcher (assignment identity) and the
 * shipped-agent definition ref producer (#221), so the two never disagree.
 */
export function inlineSpecialistIdentity(
  specialist: InlineIdentityLane,
  definitionBytes: Buffer | null,
  pinnedSkillIds: string[],
  projectedType: SpecialistTypeV2 | null,
): { type: SpecialistTypeV2; typeHash: string; profile: SpecialistProfileV1; profileHash: string } {
  const inlineType: SpecialistTypeV2 = projectedType ?? {
    schema_version: SPECIALIST_TYPE_SCHEMA,
    type_id: specialist.name,
    version: "inline-team-v1",
    role: specialist.name,
    capability_tags: [],
    compatible_skill_refs: pinnedSkillIds,
    semantic_tool_requirements: specialist.capability_scope ?? [],
    default_model_tier: (specialist.tier ?? specialist.default_tier ?? "mid") as SpecialistTypeV2["default_model_tier"],
    constraints: {
      definition_source: specialist.definition_source ?? "inline-team",
      definition_path: specialist.definition ?? null,
      definition_content_hash: definitionBytes ? sha256Prefixed(definitionBytes) : null,
    },
    eval_fixture_refs: [],
  };
  const typeHash = hashSpecialistType(inlineType);
  const definitionFm = definitionBytes ? parseFrontmatter(definitionBytes.toString("utf8")) : null;
  const projectedProfile = definitionFm
    ? specialistProfileFromAgentFrontmatter(definitionFm, {
        type_id: inlineType.type_id,
        type_version: inlineType.version,
        type_hash: typeHash,
      })
    : null;
  const profile: SpecialistProfileV1 = projectedProfile ?? {
    schema_version: SPECIALIST_PROFILE_SCHEMA,
    profile_id: specialist.name,
    version: "inline-team-v1",
    derived_from: {
      type_id: inlineType.type_id,
      type_version: inlineType.version,
      type_hash: typeHash,
    },
    project_instructions: definitionBytes
      ? `definition_content_hash=${sha256Prefixed(definitionBytes)}`
      : `inline_team_contract=${sha256Prefixed(JSON.stringify({
          name: specialist.name,
          scope: specialist.scope,
          dependsOn: specialist.dependsOn,
          capability_scope: specialist.capability_scope ?? [],
        }))}`,
    local_skill_refs: pinnedSkillIds,
  };
  return { type: inlineType, typeHash, profile, profileHash: hashSpecialistProfile(profile) };
}
