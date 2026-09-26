/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/state/. This file republishes the exact
 * pre-fold public surface of src/modules/migrations so existing importers keep working;
 * T16 deletes it. New code imports src/domains/state directly.
 */

export {
  CURRENT_SCHEMA_VERSION,
  MH08_DECISION_SCHEMA,
  MH08_DIVERGENCE_REASON_CODE,
  MH08_MODES,
  MH08_OWNER_KEY,
  MH08_PROVENANCE_ALLOWLIST,
  MH08_SCENARIO_IDS,
  MH08_SCOPE_FIELDS,
  MODULE_PUBLIC_API_VERSION,
  STRUCTURAL_BASENAMES,
  appendMigrationDecision,
  compareMigrationOutcomes,
  evaluateHostCutoverConformance,
  fmValue,
  isProvenance,
  openMigrationJournal,
  readMigrationJournal,
  resolveEffectiveSelection,
  indexMigrateResolveGuildRoot as resolveGuildRoot,
  runIndexMigrateCli,
  runMigrations,
  wikiImportanceSplitFrontmatter as splitFrontmatter,
} from "../../domains/state";
export type {
  FmSplit,
  Mh08AppendInput,
  Mh08ComparisonDifference,
  Mh08ComparisonVerdict,
  Mh08DecisionRecord,
  Mh08EvaluationRequest,
  Mh08EvaluationResult,
  Mh08JournalHandle,
  Mh08OwnerPacket,
  Mh08Scope,
  MigrationResult,
} from "../../domains/state";
