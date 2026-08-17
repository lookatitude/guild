/**
 * Backward-compatible public entrypoint.
 *
 * The shareable-run validation rail lives in src/modules/lifecycle so the
 * module layer owns it; this shim keeps the stable scripts/lib import path.
 */

export * from "../../src/modules/lifecycle/workflows/run-record-validate";
