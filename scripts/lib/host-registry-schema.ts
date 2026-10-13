/**
 * Backward-compatible public entrypoint.
 *
 * Host registry schema rows live in src/modules/host-runtime so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */

export {
  validateHostRegistryEntry,
  isHostRegistryEntry,
  HOST_IDS,
  type HostId,
  HOST_FAMILIES,
  type HostFamilyId,
  type Installability,
  AUTH_PROBES,
  type AuthProbe,
  type HostMarker,
  type HostDetection,
  type AdapterBinding,
  type HostRegistryEntry,
  HOST_REGISTRY_ROWS,
  type HostRegistryValidationResult as ValidationResult,
} from "../../src/domains/config/index";
