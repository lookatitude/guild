/**
 * Backward-compatible public entrypoint.
 *
 * Initiative contracts live in src/modules/initiatives so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export {
  deriveInitiativeStatus,
  validateInitiativeManifest,
  validateDefinitionItem,
  blockingUnresolved,
  ledgerReady,
  d8CloseGate,
  INITIATIVE_SCHEMA,
  DEFINITION_STATUS,
  EXECUTION_STATUS,
  RELEASE_STATUS,
  DOCUMENTATION_STATUS,
  type DefinitionStatus,
  type ExecutionStatus,
  type ReleaseStatus,
  type DocumentationStatus,
  DERIVED_STATUS,
  type DerivedStatus,
  type InitiativeAxes,
  type InitiativeManifest,
  type DerivationFacts,
  DEFINITION_CATEGORIES,
  DEFINITION_ITEM_STATUS,
  type DefinitionCategory,
  type DefinitionItemStatus,
  type DefinitionItem,
  type D8Input,
  type D8Result,
} from "../../src/domains/lifecycle/index";
