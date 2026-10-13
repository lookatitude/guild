/**
 * Backward-compatible public entrypoint.
 *
 * Host capability rows live in src/modules/host-runtime so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export {
  validateHostCapabilitiesV1,
  isHostCapabilitiesV1,
  type PackageCaps,
  type UpdateCaps,
  UPDATE_COMMANDS,
  type BootstrapCaps,
  type CommandsCaps,
  type SkillsCaps,
  type AgentsCaps,
  type InjectionCaps,
  PROBE_RECEIPT_PATH_RE,
  INJECTION_SUPPORT,
  type InjectionSupport,
  type HooksCaps,
  type PermissionsCaps,
  type PermissionMode,
  type DispatchCaps,
  type InteractionCaps,
  type SessionsCaps,
  type StructuredOutputCaps,
  type ArtifactsCaps,
  type ToolStrength,
  type ToolsCaps,
  type McpCaps,
  type ModelTierEntry,
  type ModelsCaps,
  type GuildHostCapabilitiesV1,
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  AGENTS_FILE_CAPABILITIES,
  type HostCapabilitiesValidationResult as ValidationResult,
  REQUIRED_HOOK_EVENTS,
} from "../../src/domains/config/index";
