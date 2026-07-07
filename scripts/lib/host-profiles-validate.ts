/**
 * Backward-compatible public entrypoint.
 *
 * Host profile validation lives in src/modules/host-runtime so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */
export * from "../../src/modules/host-runtime/workflows/host-profiles-validate";
