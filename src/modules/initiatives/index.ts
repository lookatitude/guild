/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/lifecycle/. This file republishes the exact
 * pre-fold public surface of src/modules/initiatives so existing importers keep working;
 * T16 deletes it. New code imports src/domains/lifecycle directly.
 */

export {
  ACTIVITY_EVENTS,
  ACTIVITY_SCHEMA,
  DEFINITION_CATEGORIES,
  DEFINITION_ITEM_STATUS,
  DEFINITION_STATUS,
  DERIVED_STATUS,
  DOCUMENTATION_STATUS,
  EXECUTION_STATUS,
  INITIATIVE_SCHEMA,
  RELEASE_STATUS,
  WORK_ITEM_STATUS,
  WORK_ITEM_TYPES,
  appendActivity,
  blockingUnresolved,
  classifyProposal,
  d8CloseGate,
  deriveInitiativeStatus,
  isValidActivityRow,
  ledgerReady,
  makeActivityRow,
  populateReleaseDocsWorkItems,
  readActivity,
  runClassifyProposalCli,
  validateDefinitionItem,
  validateInitiativeManifest,
  validateWorkItem,
} from "../../domains/lifecycle";
export type {
  ActivityEvent,
  ActivityRow,
  ClassifierTarget,
  ClassifyProposalInput,
  ClassifyProposalResult,
  D8Input,
  D8Result,
  DefinitionCategory,
  DefinitionItem,
  DefinitionItemStatus,
  DefinitionStatus,
  DerivationFacts,
  DerivedStatus,
  DocumentationStatus,
  ExecutionStatus,
  InitiativeAxes,
  InitiativeManifest,
  ReleaseStatus,
  WorkItem,
  WorkItemStatus,
  WorkItemType,
} from "../../domains/lifecycle";
