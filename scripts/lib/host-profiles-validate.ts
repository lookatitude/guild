/**
 * Backward-compatible public entrypoint.
 *
 * Host profile validation lives in src/modules/host-runtime so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */
export {
  validateHostProfiles,
  filterHostProfiles,
  VALID_HOST_PROFILE_ENTRY_KEYS,
  VALID_HOST_PROFILE_MODEL_KEYS,
} from "../../src/domains/config/index";
