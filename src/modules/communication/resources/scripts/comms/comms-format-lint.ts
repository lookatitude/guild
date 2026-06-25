/**
 * Backward-compatible public entrypoint.
 *
 * Communication-format linting now lives in src/modules/communication so the
 * communication module owns its executable workflows. Keep this path stable for
 * existing imports from scripts/comms and hook bundles.
 */
export * from "../../src/modules/communication/workflows/comms-format-lint";
