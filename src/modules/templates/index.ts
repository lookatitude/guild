/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/teams/. This file republishes the exact
 * pre-fold public surface of src/modules/templates so existing importers keep working;
 * T16 deletes it. New code imports src/domains/teams directly.
 */

export {
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATE_V1_EXAMPLE,
  instantiateTemplate,
  isTemplateV1,
  runSelfCheck,
  validateTemplateV1,
} from "../../domains/teams";
export type {
  ArtifactSkeletons,
  DefineSkeleton,
  ExploreSkeleton,
  InstantiateResult,
  TemplateV1,
  ValidationResult,
} from "../../domains/teams";
