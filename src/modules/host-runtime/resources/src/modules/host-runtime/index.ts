export type { HostCapabilityManifest } from "./workflows/host-capability-manifest";
export { HOSTKIND_TO_REGISTRY_ID, normalizeHostId } from "./workflows/host-id-namespace";
export {
  resolveRung,
  type DegradationReceipt,
} from "./workflows/adapter-fallback-ladders";
export { filterHostProfiles } from "./workflows/host-profiles-validate";
export { getRegistryEntry, hostKindToRegistryId } from "./workflows/host-registry";
export {
  HOST_IDS,
  HOST_REGISTRY_ROWS,
  type AdapterBinding,
  type AuthProbe,
  type HostFamilyId,
  type HostId,
  type HostRegistryEntry,
  type Installability,
} from "./workflows/host-registry-schema";
export * from "./workflows/provider-detect";
export * from "./workflows/session-context";
export * from "./workflows/model-discovery";
export type { HostKind } from "./workflows/host-types";

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
  HOST_ADAPTER_OPERATIONS,
  type BootstrapRequest,
  type CollectRequest,
  type DispatchRequest,
  type HostAdapter,
  type HostAdapterCapabilityProfile,
  type HostAdapterOperation,
  type HostAdapterReceipt,
  type HostAdapterResult,
  type HostAdapterStatus,
  type MemoryRequest,
  type PreflightRequest,
  type RenderCommandSurfaceRequest,
  type RenderPackageRequest,
  type RenderPermissionDecisionRequest,
  type ResolveModelParamsRequest,
} from "./workflows/host-adapter-contract";

export {
  HOST_ADAPTER_BOUNDARY_MAJOR,
  HOST_ADAPTER_BOUNDARY_SCHEMA,
  HOST_ADAPTER_CONTRACT_VERSION,
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
} from "./workflows/host-adapter-boundary";

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
} from "./workflows/host-capability-snapshot";

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
} from "./workflows/host-event-normalizer";
