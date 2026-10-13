/**
 * Backward-compatible public entrypoint.
 *
 * Run-start preflight lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing imports from scripts/lib/runstart-preflight.
 */

export {
  detectClaudeNativeAdapterIdentity,
  resolveRunStartDispatchBackend,
  persistTmuxTeamArgv,
  runStartPreflight,
  defaultPreflightProbe,
  type PreflightProbe,
  CLAUDE_CODE_NATIVE_ADAPTER_VERSION,
  type PreflightOptions,
  type ResolvedSettingsSnapshot,
  type RunStartDispatchBackend,
  type RunStartDispatchFacts,
  type RunStartDispatchResolution,
  type PreflightResult,
} from "../../src/domains/lifecycle/index";
