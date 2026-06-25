/**
 * Backward-compatible public entrypoint.
 *
 * Accidental-write protection now lives in src/modules/communication so the
 * communication module owns its executable workflows. Keep this path stable for
 * existing imports from scripts/comms.
 */
export * from "../../src/modules/communication/workflows/no-accidental-write";
