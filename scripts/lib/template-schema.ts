/**
 * Backward-compatible public entrypoint.
 *
 * The template implementation lives in src/modules/templates so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export {
  validateTemplateV1,
  isTemplateV1,
  instantiateTemplate,
  runSelfCheck,
  TEMPLATE_SCHEMA_VERSION,
  type ValidationResult,
  type ExploreSkeleton,
  type DefineSkeleton,
  type ArtifactSkeletons,
  type TemplateV1,
  type InstantiateResult,
  TEMPLATE_V1_EXAMPLE,
} from "../../src/domains/teams/index";
