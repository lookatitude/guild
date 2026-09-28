/**
 * config — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/config/ may reach a sibling module directly.
 *
 * Folded here (KTD36): config, capability, prompting.
 */


// ── from src/modules/host-runtime (T14) ──────────────────────────────────────
// Host identity is truth, so it lives in a domain (KTD27: adapters map, they do
// not own truth). src/adapters keeps only the per-host runtime that implements
// these contracts; a domain never imports it (KTD4). The names are exactly the
// ones host-runtime published, so the fold stays bijective. First, on purpose:
// these modules depend only on the kernel, and evaluating them before the rest
// of config keeps a lifecycle -> config cycle from reading them uninitialised.
export type { HostKind } from "./host-types";
export type { HostCapabilityManifest } from "./host-capability-manifest";
export { HOSTKIND_TO_REGISTRY_ID, hostKindToRegistryId, normalizeHostId } from "./host-id-namespace";
export { resolveRung, type DegradationReceipt } from "./adapter-fallback-ladders";
export { filterHostProfiles } from "./host-profiles-validate";
export { getRegistryEntry } from "./host-registry";
export {
  HOST_FAMILIES,
  HOST_IDS,
  HOST_REGISTRY_ROWS,
  type AdapterBinding,
  type AuthProbe,
  type HostFamilyId,
  type HostId,
  type HostRegistryEntry,
  type Installability,
} from "./host-registry-schema";
export {
  HOST_ADAPTER_CONTRACT_VERSION,
  HOST_ADAPTER_OPERATIONS,
  type BootstrapRequest,
  type CollectRequest,
  type DispatchRequest,
  type HostAdapter,
  type HostAdapterCapabilityProfile,
  type HostAdapterOperation,
  type HostAdapterReceipt,
  type HostAdapterResult,
  type HostAdapterStatus,
  type MemoryRequest,
  type PreflightRequest,
  type RenderCommandSurfaceRequest,
  type RenderPackageRequest,
  type RenderPermissionDecisionRequest,
  type ResolveModelParamsRequest,
} from "./host-adapter-contract";
export {
  defaultProbeEnv,
  detectProviders,
  recommendProvider,
  resolveAuthorHost,
  selectReviewer,
  type AuthorIdentityTrust,
  type DetectedProvider,
  type DetectionResult,
  type DetectOptions,
  type HostFamily,
  type ProbeEnv,
  type ProviderKind,
  type RecommendResult,
  type ResolvedReview,
  type SelectResult,
} from "./provider-detect";
export {
  buildSessionContext,
  loadOrCreateFingerprintSalt,
  loadSessionContext,
  makeFingerprint,
  restoreSessionContext,
  sessionContextPath,
  writeSessionContext,
  type AuthMode,
  type BuildSessionContextInput,
  type ExecutionTargetBlock,
  type GuildSessionContextV1,
  type HostHandshakeIdentity,
  type HostSurface,
  type IdentityConfidence,
  type IdentitySource,
  type IdentityTrust,
  type NativeAdapterIdentity,
  type SessionContextFs,
  type SessionHostBlock,
  type SessionHostFamily,
  type SessionIdentityBlock,
  type TargetProviderKind,
} from "./session-context";
// The model-discovery PORT. Concrete per-target adapters implement it in
// src/adapters/model-discovery; the catalog normalizes what they return.
export {
  compareVersions,
  DEFAULT_DISCOVERY_BUDGET_MS,
  DiscoveryBudgetExceeded,
  DiscoveryParseRejected,
  FAILURE_REASONS,
  failureResult,
  fingerprintOrUnknown,
  isFailureReason,
  nullIo,
  runAdapter,
  toolVersionInRange,
  withBudget,
  type DiscoveryAdapter,
  type DiscoveryIo,
  type DiscoveryMethod,
  type DiscoveryStatus,
  type FailureReason,
  type ListingSource,
  type RawDiscoveryResult,
  type RawModelEntry,
  type ToolVersionRange,
} from "./model-discovery-contract";

// ── from src/modules/config ──────────────────────────────────────────
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export * from "./config-defaults";
export * from "./policy-keys";
export * from "./policy-resolver";
export * from "./session-binding";
export * from "./config-validation";
export * from "./settings-resolver";
export * from "./workspace-mode";
export * from "./tier-model";

// ── from src/modules/capability ──────────────────────────────────────────
export * from "./catalog-cache";
export * from "./compatibility-catalog";
export * from "./compatibility-usage";
export * from "./confirmation-arbiter";
export * from "./independence-predicates";
export * from "./independence-record";
export * from "./inspection-persist";
export * from "./inspection-record";
export * from "./model-catalog";
export * from "./model-inspect";
export * from "./model-policy";
export * from "./model-resolver";
export * from "./policy-migration";
export * from "./purpose-provenance";
export * from "./resolver-mode";
export * from "./rank";
export * from "./role-model-schema";
export * from "./routing-rollout";
export * from "./role-resolver";
export * from "./router";
export * from "./tiebreak";
export * from "./tier-defaults";

// ── from src/modules/prompting ──────────────────────────────────────────
export * from "./compose-prompt";
export * from "./team-prompt";

// ── consumed outside the domain (T16: every importer goes through this index) ──
export {
  ADAPTER_SURFACES,
  type AdapterSurface,
  FALLBACK_LADDER_TABLE,
  INFERRED_HOSTS,
  isHostInferred,
  type Rung,
  rungLoss,
  RUNGS,
  validateDegradationReceipt,
  validateLadderTableComplete,
  type ValidationResult as LadderValidationResult,
} from "./adapter-fallback-ladders";
export {
  createAllHostAdapters,
  createHostAdapter,
} from "./host-adapter-contract";
export {
  AGENTS_FILE_CAPABILITIES,
  type AgentsCaps,
  type ArtifactsCaps,
  type BootstrapCaps,
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  type CommandsCaps,
  type DispatchCaps,
  type GuildHostCapabilitiesV1,
  type HooksCaps,
  INJECTION_SUPPORT,
  type InjectionCaps,
  type InjectionSupport,
  type InteractionCaps,
  isHostCapabilitiesV1,
  type McpCaps,
  type ModelsCaps,
  type ModelTierEntry,
  type PackageCaps,
  type PermissionMode,
  type PermissionsCaps,
  PROBE_RECEIPT_PATH_RE,
  REQUIRED_HOOK_EVENTS,
  type SessionsCaps,
  type SkillsCaps,
  type StructuredOutputCaps,
  type ToolsCaps,
  type ToolStrength,
  UPDATE_COMMANDS,
  type UpdateCaps,
  validateHostCapabilitiesV1,
  type ValidationResult as HostCapabilitiesValidationResult,
} from "./host-capabilities-schema";
export {
  isDroppedHostKind,
  LEGACY_HOST_ALIASES,
  registryIdToCanonicalHostKind,
} from "./host-id-namespace";
export {
  CLI_NATIVE_HOSTS,
  detectChildGitRepos,
  detectGuildState,
  GUILD_STATE_SCHEMA_VERSION,
  type GuildState,
  type GuildStateEvidence,
  type GuildStateProblem,
  type GuildStateResult,
  HOST_OPEN_PREFLIGHT_SCHEMA_VERSION,
  hostOpenPreflight,
  type HostOpenPreflightResult,
  type InitMode,
  type InitPromptData,
  type PreflightAction,
  type PreflightAdvisory,
  type RootKind,
  suggestWorkspaceMode,
  type WorkspaceSuggestion,
} from "./host-open-preflight";
export {
  VALID_HOST_PROFILE_ENTRY_KEYS,
  VALID_HOST_PROFILE_MODEL_KEYS,
  validateHostProfiles,
} from "./host-profiles-validate";
export {
  AUTH_PROBES,
  type HostDetection,
  type HostMarker,
  isHostRegistryEntry,
  validateHostRegistryEntry,
  type ValidationResult as HostRegistryValidationResult,
} from "./host-registry-schema";
export {
  deriveCapabilityRow,
  DERIVED_HOST_CAPABILITY_ROWS,
  dispatchSelectableForHostId,
  getRegistryEntryForHostKind,
  installabilityForHostId,
  resultAdapterForFamily,
  resultAdapterForHostId,
  resultAdapterForHostKind,
} from "./host-registry";
export {
  eagerEntriesFor,
  lazyEntriesFor,
  requiredEntriesFor,
  scaffoldFor,
} from "./init-scaffold-manifest";
export {
  parseModelsArgs,
  runModelsCommand,
} from "./models-command";
export {
  resolveSettings as resolveSettingsUntraced,
} from "./settings-reader";
