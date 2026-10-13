/**
 * Backward-compatible public entrypoint for the host-open preflight API.
 *
 * The canonical implementation lives in src/domains/config so the
 * module reorganization can move internals without breaking imports — same shim
 * pattern as settings-resolver.ts / init-scaffold-manifest.ts. Host adapters (L3)
 * and the init/repair API (L2) consume `detectGuildState`, `hostOpenPreflight`,
 * and `suggestWorkspaceMode` through this path.
 */

export {
  detectGuildState,
  detectChildGitRepos,
  suggestWorkspaceMode,
  hostOpenPreflight,
  GUILD_STATE_SCHEMA_VERSION,
  type GuildState,
  type GuildStateEvidence,
  type GuildStateProblem,
  type GuildStateResult,
  type WorkspaceSuggestion,
  HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
  CLI_NATIVE_HOSTS,
  type PreflightAction,
  type PreflightAdvisory,
  type RootKind,
  type InitMode,
  type InitPromptData,
  type HostOpenPreflightResult,
} from "../../src/domains/config/index";
