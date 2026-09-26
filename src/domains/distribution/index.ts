/**
 * distribution — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/distribution/ may reach a sibling module directly.
 *
 * Folded here (KTD36): distribution, docs-sync.
 */


// ── from src/modules/distribution ──────────────────────────────────────────
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export * from "./build-inventory";
export * from "./check-domain-ownership";
export * from "./domain-fold";
export * from "./equivalence-contract";
export * from "./handoff-v2";
export * as InventorySchema from "./inventory-schema";
export * from "./module-resources";
export * from "./parity-contract";
export * as PerHostPackaging from "./per-host-packaging";
export * from "./release-conformance-evaluator";
export * from "./release-conformance-integration";
export * from "./result-contracts";
export * from "./review-result";
export * from "./release-distribution-contract";
export * as SurfaceManifestApi from "./surface-manifest";
export * from "./verify-host-packages";
export * from "./verify-installer";

// ── from src/modules/docs-sync ──────────────────────────────────────────
export {
  type CoverageResult as CheckCommandCoverageCoverageResult,
  collectCommandTokens,
  evaluateCommandCoverage,
  gatherKnowledgeText,
  htmlToText,
  isTokenCovered,
  main as checkCommandCoverageMain,
} from "./check-command-coverage";
export {
  type CrossRepoOptions,
  type DocSyncInput,
  type DocSyncResult,
  type GitResult,
  evaluateDocSync,
  gatherCrossRepoInputs,
  getChangedFilesResult,
  getCommitMessagesResult,
  isUserFacingSkill,
  main as checkDocSyncMain,
  resolveUserFacingSkillPaths,
} from "./check-doc-sync";
export {
  DEFAULT_CONCERN_ENUM,
  type LabelTaxonomy,
  lintWiki,
  main as wikiLintChecksMain,
  readLabelTaxonomy,
} from "./wiki-lint-checks";
