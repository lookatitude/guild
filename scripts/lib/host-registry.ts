/**
 * Backward-compatible public entrypoint.
 *
 * Host runtime registry accessors live in src/modules/host-runtime so the reorg
 * can move internals without breaking existing imports from scripts/lib/*.
 */
export {
  deriveCapabilityRow,
  getRegistryEntry,
  getRegistryEntryForHostKind,
  resultAdapterForFamily,
  resultAdapterForHostId,
  resultAdapterForHostKind,
  dispatchSelectableForHostId,
  installabilityForHostId,
  hostKindToRegistryId,
  registryIdToCanonicalHostKind,
  isDroppedHostKind,
  HOSTKIND_TO_REGISTRY_ID,
  HOST_REGISTRY_ROWS,
  HOST_IDS,
  type HostId,
  type HostFamilyId,
  type HostRegistryEntry,
  type Installability,
  DERIVED_HOST_CAPABILITY_ROWS,
} from "../../src/domains/config/index";
