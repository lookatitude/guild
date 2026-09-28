/**
 * Backward-compatible public entrypoint.
 *
 * Host id namespace reconciliation lives in src/modules/host-runtime so the
 * reorg can move internals without breaking existing imports from scripts/lib/*.
 */
export {
  hostKindToRegistryId,
  normalizeHostId,
  registryIdToCanonicalHostKind,
  isDroppedHostKind,
  HOSTKIND_TO_REGISTRY_ID,
  LEGACY_HOST_ALIASES,
} from "../../src/domains/config/index";
