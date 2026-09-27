/**
 * dispatch — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/dispatch/ may reach a sibling module directly.
 *
 * Folded here (KTD36): dispatch, communication.
 */


// ── from src/modules/dispatch ──────────────────────────────────────────
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export * from "./specialist-contract";
export * from "./shadow-routing";
export * from "./task-cell-contract";
export * from "./task-cell-artifact-join";
export * from "./task-cell-runtime";
export * from "./task-cell-scale-audit";
export * from "./task-cell-telemetry-reconcile";
export * from "./task-cell-host-conformance";

// MH-04 execution transports (`guild.execution.transports.v1`). Exported here
// because this index is the module's stable public entrypoint and the
// module-boundary checker requires cross-module consumers to import through it.
// The dependency direction is one-way: the ports module imports only the public
// lifecycle index (`guild.runtime.contracts.v1`) and reaches every concrete
// substrate through structural seams, so exporting it cannot pull a host adapter,
// tmux/ssh implementation, wrapper, or launcher into a consumer.
export * from "./execution-transport-ports";
export * from "./execution-transport-adapters";

// U-TIER (T08): cell completion oracles + ledger, the instance cap, structural
// isolation, the advisor round budget, and the session-binding copy that gives
// an assignment its host/model ids.
export * from "./progress-ledger";
export * from "./instance-cap";
export * from "./isolation-guard";
// T14: the closed adapter rung matrix as dispatch policy (KTD5, KTD28).
export * from "./adapter-rungs";
export * from "./advisor-budget";
export * from "./assignment-binding";

// ── from src/modules/communication ──────────────────────────────────────────
export * from "./comms-format-lint";
export * from "./no-accidental-write";
export * from "./artifact-bus";
