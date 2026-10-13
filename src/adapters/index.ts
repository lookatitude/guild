/**
 * adapters — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/adapters/ may reach a sibling module directly.
 *
 * Folded here (KTD36): host-runtime.
 */


// ── from src/modules/host-runtime ──────────────────────────────────────────
// Host identity (registry, id namespace, detection, session context, the
// host-adapter and model-discovery contracts) is truth and lives in
// src/domains/config (KTD27). This tree keeps the per-host runtime that
// implements those contracts, and it reaches config only through its index.
export * from "./model-discovery/index";

// ---------------------------------------------------------------------------
// MH-03 host-adapter boundary (`guild.host_adapter_boundary.v1`)
//
// Exported here because this index is the module's stable public entrypoint and
// the module-boundary checker requires cross-module consumers to import through
// it. The adapter INTERFACES are public so a consumer can supply or implement a
// provider without reaching into `workflows/`; the concrete per-host adapters
// stay behind the provider, which is what keeps pane, memory, and review
// surfaces out of every registry consumer's require graph.
// ---------------------------------------------------------------------------

export {
  HOST_ADAPTER_BOUNDARY_MAJOR,
  HOST_ADAPTER_BOUNDARY_SCHEMA,
  HOST_ADAPTER_NOT_OWNED_CONCERNS,
  HOST_ADAPTER_OWNED_CONCERNS,
  HOST_ADAPTER_OWNERSHIP_SCHEMA,
  HOST_ADAPTER_REASON_CODES,
  HOST_CLAIM_RECONCILIATION_SCHEMA,
  HOST_ENTRY_POINTS,
  HOST_ENTRY_POINT_SCHEMA,
  HOST_RUNTIME_BINDING_RESULT_SCHEMA,
  HOST_RUNTIME_BINDING_SCHEMA,
  bindHostRuntimeAdapter,
  hostRuntimeBoundaryOwnership,
  reconcileHostRegistryWithCoreClaimVocabulary,
  resolveHostEntryPoint,
  type HostAdapterProvider,
  type HostClaimReconciliation,
  type HostEntryPoint,
  type HostEntryPointKind,
  type HostRuntimeBinding,
  type HostRuntimeBindingDisposition,
  type HostRuntimeBindingRequest,
  type HostRuntimeBindingResult,
  type HostRuntimeBoundaryOwnership,
} from "./host-adapter-boundary";

export {
  HOST_CAPABILITY_IDS,
  HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA,
  HOST_CAPABILITY_SNAPSHOT_SCHEMA,
  captureHostCapabilitySnapshot,
  createHostCapabilitySnapshotStore,
  releaseHostCapabilitySnapshots,
  type HostAuthenticationObservation,
  type HostCapabilityFact,
  type HostCapabilityId,
  type HostCapabilitySnapshot,
  type HostCapabilitySnapshotDisposition,
  type HostCapabilitySnapshotRequest,
  type HostCapabilitySnapshotResult,
  type HostCapabilitySnapshotStore,
} from "./host-capability-snapshot";

export {
  CLAUDE_NATIVE_EVENT_BINDINGS,
  HOST_EVENT_NORMALIZATION_RESULT_SCHEMA,
  HOST_EVENT_NORMALIZATION_SCHEMA,
  NORMALIZED_EVENT_VOCABULARY_VERSION,
  NORMALIZED_HOST_EVENT_SCHEMA,
  WRAPPER_NATIVE_EVENT_BINDINGS,
  hostEventSource,
  normalizeHostEvent,
  type HostEventNormalizationDisposition,
  type HostEventNormalizationResult,
  type HostEventSource,
  type HostEventSourceKind,
  type HostNativeEventBinding,
  type NormalizedHostEvent,
} from "./host-event-normalizer";

// A21-3 — the MH-03 owner evaluator. Exported here for the same reason as the
// boundary above: the conformance assembler is a cross-module consumer and the
// module-boundary checker requires it to reach this owner through the module's
// public entrypoint rather than into `workflows/`. The evaluator adds no new
// module dependency — it consumes the MH-03 boundary files beside it plus the
// already-declared `lifecycle` public contract.
export * from "./host-adapter-conformance-evaluator";

// Composition-root binding of the domain ports this tree implements (KTD4).
export { bindHostRuntimePorts } from "./composition";

// The closed rung matrix + per-family adapter maps (KTD4, KTD28).
export {
  ADAPTER_LOCK_SCHEMA,
  ADAPTER_MAP_SCHEMA,
  adapterLockFamilies,
  adapterLockProblems,
  adapterMapForFamily,
  checkPackageAgainstMap,
  familyForHostId,
  rungPlanForFamily,
  rungRowForFamily,
  rungKeyForSession,
  type AdapterMap,
} from "./rung-matrix";

// Session-start surface projection (KTD31).
export { projectSurfaces, type SurfaceProjection } from "./session-start";
