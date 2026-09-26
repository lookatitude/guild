/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/distribution/. This file republishes the exact
 * pre-fold public surface of src/modules/docs-sync so existing importers keep working;
 * T16 deletes it. New code imports src/domains/distribution directly.
 */

export {
  checkDocSyncMain,
  wikiLintChecksMain,
  DEFAULT_CONCERN_ENUM,
  collectCommandTokens,
  evaluateCommandCoverage,
  evaluateDocSync,
  gatherCrossRepoInputs,
  gatherKnowledgeText,
  getChangedFilesResult,
  getCommitMessagesResult,
  htmlToText,
  isTokenCovered,
  isUserFacingSkill,
  lintWiki,
  checkCommandCoverageMain as main,
  readLabelTaxonomy,
  resolveUserFacingSkillPaths,
} from "../../domains/distribution";
export type {
  CheckCommandCoverageCoverageResult as CoverageResult,
  CrossRepoOptions,
  DocSyncInput,
  DocSyncResult,
  GitResult,
  LabelTaxonomy,
} from "../../domains/distribution";
