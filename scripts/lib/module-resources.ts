/**
 * Backward-compatible public entrypoint.
 *
 * The implementation lives in src/modules/distribution so the reorganization can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export {
  buildModuleResourcePlan,
  MODULE_RESOURCES_SCHEMA_VERSION,
  type ModuleResourceEntry,
  type ModuleResourcePlan,
} from "../../src/domains/distribution/index";
