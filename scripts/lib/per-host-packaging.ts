/**
 * Backward-compatible public entrypoint.
 *
 * Per-host packaging renderers live in src/modules/distribution so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export {
  validateManifest,
  renderCodexPluginJson,
  renderClaudePluginPackage,
  renderClaudeMarketplacePackage,
  renderCodexGitInstallManifest,
  renderPiManifest,
  renderAntigravityManifest,
  renderWrappedCliPackage,
  renderAgentsPackage,
  type GuildPluginManifest,
  type PackagingMcpServerEntry as McpServerEntry,
  type PackagingHookEntry as HookEntry,
  type CodexPluginJson,
  type CodexCommandEntry,
  type CodexMcpEntry,
  type PiManifest,
  type PiCommandEntry,
  type UnsupportedField,
  type PackagingValidationResult as ValidationResult,
  type RenderOptions,
  type NewHostRenderSpec,
  type ClaudePluginJson,
  type ClaudeMarketplaceJson,
  type CodexGitInstallMcpEntry,
  type CodexGitInstallJson,
  type AntigravityManifest,
  type WrappedCliRenderSpec,
  type WrappedCliPackage,
  type AgentsPackage,
} from "../../src/domains/distribution/index";
