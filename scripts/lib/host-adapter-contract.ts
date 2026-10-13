/**
 * Backward-compatible public entrypoint.
 *
 * The host adapter contract lives in src/modules/host-runtime so the reorg can
 * move internals without breaking existing imports from scripts/lib/*.
 */
export {
  createHostAdapter,
  createAllHostAdapters,
  HOST_ADAPTER_CONTRACT_VERSION,
  HOST_ADAPTER_OPERATIONS,
  type HostAdapterOperation,
  type HostAdapterStatus,
  type HostAdapterReceipt,
  type HostAdapterResult,
  type HostAdapterCapabilityProfile,
  type BootstrapRequest,
  type PreflightRequest,
  type DispatchRequest,
  type CollectRequest,
  type RenderCommandSurfaceRequest,
  type RenderPackageRequest,
  type RenderPermissionDecisionRequest,
  type ResolveModelParamsRequest,
  type MemoryRequest,
  type HostAdapter,
} from "../../src/domains/config/index";
