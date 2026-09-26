/**
 * telemetry — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/telemetry/ may reach a sibling module directly.
 *
 * Folded here (KTD36): telemetry.
 */


// ── from src/modules/telemetry ──────────────────────────────────────────
// Keep the receipt boundary first: state/run-analysis can re-enter telemetry
// through dispatch during barrel initialization, and these bindings must
// already exist when that happens.
export * from "./receipt-journal";
export * from "./receipt-reconcile";
export * from "./debug-bundle";
export * from "./receipt-journal-conformance-evaluator";

export * from "./guild-trace-emit";
export * from "./guild-trace-events";
export * from "./task-cell-telemetry";
export * from "./run-analysis";
