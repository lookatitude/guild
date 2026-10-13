/**
 * Backward-compatible public entrypoint.
 *
 * The neutral inventory schema lives in src/modules/distribution so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export {
  validateInventoryV1,
  isInventoryV1,
  INVENTORY_CATEGORIES,
  type InventoryCategory,
  type InventoryEntryBase,
  type CommandEntry,
  type SkillEntry,
  type AgentEntry,
  type InventoryHookEntry as HookEntry,
  type InventoryMcpServerEntry as McpServerEntry,
  type ScriptEntry,
  type SchemaEntry,
  type DocEntry,
  type InventoryManifest,
  type GuildInventoryV1,
  type InventoryValidationResult as ValidationResult,
  ALLOWED_INVENTORY_KEYS,
} from "../../src/domains/distribution/index";
