/**
 * Backward-compatible public entrypoint.
 *
 * The implementation lives in src/modules/kernel so the reorganization can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export {
  loadModuleManifests,
  moduleManifestFiles,
  ownersFor,
  validateModuleOwnership,
  validateModuleHealth,
  validateModuleBoundaries,
  formatOwnershipValidation,
  formatBoundaryValidation,
  formatModuleHealthValidation,
  MODULE_MANIFEST_SCHEMA_VERSION,
  type ModuleKind,
  type ModuleImplementationMode,
  type OwnedInventoryCategory,
  OWNED_INVENTORY_CATEGORIES,
  type ModuleOwns,
  type ModuleManifest,
  type ModuleValidationResult,
  type OwnershipFinding,
  type OwnershipValidationResult,
  type ModuleInventoryEntry,
  type ModuleInventory,
  type ModuleBoundaryViolation,
  type ModuleBoundaryValidationResult,
  type ModuleHealthFindingReason,
  type ModuleHealthFinding,
  type ModuleHealthSummary,
  type ModuleHealthValidationResult,
  type ModuleInventoryCategory,
} from "../../src/domains/kernel/index";
