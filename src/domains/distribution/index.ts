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

// ── consumed outside the domain (T16: every importer goes through this index) ──
export {
  type AgentEntry,
  ALLOWED_INVENTORY_KEYS,
  type CommandEntry,
  type DocEntry,
  type GuildInventoryV1,
  type HookEntry as InventoryHookEntry,
  INVENTORY_CATEGORIES,
  type InventoryCategory,
  type InventoryEntryBase,
  type InventoryManifest,
  isInventoryV1,
  type McpServerEntry as InventoryMcpServerEntry,
  type SchemaEntry,
  type ScriptEntry,
  type SkillEntry,
  validateInventoryV1,
  type ValidationResult as InventoryValidationResult,
} from "./inventory-schema";
export {
  type AgentsPackage,
  type AntigravityManifest,
  type ClaudeMarketplaceJson,
  type ClaudePluginJson,
  type CodexCommandEntry,
  type CodexGitInstallJson,
  type CodexGitInstallMcpEntry,
  type CodexMcpEntry,
  type CodexPluginJson,
  type GuildPluginManifest,
  type HookEntry as PackagingHookEntry,
  type McpServerEntry as PackagingMcpServerEntry,
  type NewHostRenderSpec,
  type PiCommandEntry,
  type PiManifest,
  renderAgentsPackage,
  renderAntigravityManifest,
  renderClaudeMarketplacePackage,
  renderClaudePluginPackage,
  renderCodexGitInstallManifest,
  renderCodexPluginJson,
  type RenderOptions,
  renderPiManifest,
  renderWrappedCliPackage,
  type UnsupportedField,
  validateManifest,
  type ValidationResult as PackagingValidationResult,
  type WrappedCliPackage,
  type WrappedCliRenderSpec,
} from "./per-host-packaging";
export {
  assertLockedScriptRuntimeDependencies,
  assertNativeClaudePackageIdentityCurrent,
  computePhysicalNativeClaudePayloadDigest,
  computeReleaseIdentityId,
  computeReleasePackageDigest,
  computeTrackedNativeClaudePayloadDigest,
  LOCKED_SCRIPT_RUNTIME_DIGESTS,
  NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE,
  NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
  type NativeClaudePackageIdentityV1,
  readVerifiedNativeClaudePackageIdentity,
  readVerifiedReleasePackageIdentity,
  RELEASE_PACKAGE_IDENTITY_FILE,
  RELEASE_PACKAGE_IDENTITY_SCHEMA,
  RELEASE_PACKAGE_INSTALL_RECEIPT_FILE,
  RELEASE_PACKAGE_NAMES,
  type ReleasePackageDigestOptions,
  type ReleasePackageIdentityV1,
  type ReleasePackageName,
  writeNativeClaudePackageIdentity,
  writeReleasePackageIdentitySet,
} from "./release-package-identity";
export {
  SURFACE_KINDS,
  SURFACE_MANIFEST_SCHEMA_VERSION,
  type SurfaceKind,
  type SurfaceManifest,
  validateSurfaceManifest,
  type ValidationResult as SurfaceManifestValidationResult,
} from "./surface-manifest";
