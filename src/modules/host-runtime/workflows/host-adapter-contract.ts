/**
 * src/modules/host-runtime/workflows/host-adapter-contract.ts
 *
 * R2 foundation - the host-neutral HostAdapter contract. This is the boundary
 * later runs move concrete Claude/Codex/Pi/Antigravity/app behavior behind.
 *
 * The default adapter in this file is deliberately conservative: it reports the
 * registry-derived profile and returns explicit degraded/unavailable operation
 * results instead of launching host binaries or claiming runtime parity. Runtime
 * code that needs concrete host behavior must import `host-adapter-factory.ts`;
 * this contract-local factory is a fail-closed baseline for schema tests and
 * unknown-host safety.
 */

import {
  HOST_IDS,
  HOST_REGISTRY_ROWS,
  type HostId,
  type HostRegistryEntry,
  type Installability,
} from "./host-registry-schema";
import { normalizeHostId } from "./host-id-namespace";
import {
  type AdapterSurface,
  type DegradationReceipt,
  resolveRung,
} from "./adapter-fallback-ladders";

export const HOST_ADAPTER_OPERATIONS = [
  "capabilities",
  "bootstrap",
  "preflight",
  "dispatch",
  "collect",
  "renderCommandSurface",
  "renderPackage",
  "renderPermissionDecision",
  "resolveModelParams",
  "memory",
] as const;

export type HostAdapterOperation = (typeof HOST_ADAPTER_OPERATIONS)[number];
export type HostAdapterStatus = "ok" | "degraded" | "unavailable";

export interface HostAdapterReceipt {
  schema_version: "guild.host_adapter_receipt.v1";
  host: HostId | string;
  operation: HostAdapterOperation;
  status: HostAdapterStatus;
  reason: string;
  degradation_receipt?: DegradationReceipt;
}

export interface HostAdapterResult<T = unknown> {
  schema_version: "guild.host_adapter_result.v1";
  host: HostId | string;
  operation: HostAdapterOperation;
  status: HostAdapterStatus;
  value: T | null;
  receipt: HostAdapterReceipt;
}

export interface HostAdapterCapabilityProfile {
  schema_version: "guild.host_adapter_capabilities.v1";
  host: HostId | string;
  host_id: HostId | null;
  known: boolean;
  family: string | null;
  surface_kind: "cli" | "app" | "file" | null;
  installability: Installability | "unknown";
  result_adapter: boolean;
  dispatch_selectable: boolean;
  provenance: "verified" | "inferred" | "unknown";
  runtime_surfaces: Record<AdapterSurface, DegradationReceipt>;
  unavailable_operations: HostAdapterOperation[];
}

export interface BootstrapRequest {
  cwd?: string;
  runId?: string;
}

export interface PreflightRequest {
  cwd?: string;
  runId?: string;
  event?: string;
}

export interface DispatchRequest {
  taskRun: unknown;
}

export interface CollectRequest {
  runId?: string;
  artifactPath?: string;
}

export interface RenderCommandSurfaceRequest {
  commandIds?: string[];
}

export interface RenderPackageRequest {
  packageRoot?: string;
}

export interface RenderPermissionDecisionRequest {
  decision: unknown;
}

export interface ResolveModelParamsRequest {
  tier: "cheap" | "mid" | "powerful";
  params?: Record<string, unknown> | null;
}

export interface MemoryRequest {
  mode: "query" | "write" | "status";
  payload?: unknown;
}

export interface HostAdapter {
  readonly host: HostId | string;
  readonly hostId: HostId | null;
  capabilities(): HostAdapterCapabilityProfile;
  bootstrap(request?: BootstrapRequest): HostAdapterResult;
  preflight(request?: PreflightRequest): HostAdapterResult;
  dispatch(request: DispatchRequest): HostAdapterResult;
  collect(request?: CollectRequest): HostAdapterResult;
  renderCommandSurface(request?: RenderCommandSurfaceRequest): HostAdapterResult;
  renderPackage(request?: RenderPackageRequest): HostAdapterResult;
  renderPermissionDecision(request: RenderPermissionDecisionRequest): HostAdapterResult;
  resolveModelParams(request: ResolveModelParamsRequest): HostAdapterResult<Record<string, unknown>>;
  memory(request: MemoryRequest): HostAdapterResult;
}

const OPERATION_TO_RUNTIME_SURFACE: Partial<Record<HostAdapterOperation, AdapterSurface>> = {
  bootstrap: "session",
  preflight: "session",
  dispatch: "semantic_tool",
  collect: "session",
  renderCommandSurface: "semantic_tool",
  renderPermissionDecision: "semantic_tool",
  resolveModelParams: "semantic_tool",
  memory: "semantic_tool",
};

function receipt(
  host: HostId | string,
  operation: HostAdapterOperation,
  status: HostAdapterStatus,
  reason: string,
  degradationReceipt?: DegradationReceipt
): HostAdapterReceipt {
  return {
    schema_version: "guild.host_adapter_receipt.v1",
    host,
    operation,
    status,
    reason,
    ...(degradationReceipt ? { degradation_receipt: degradationReceipt } : {}),
  };
}

function result<T>(
  host: HostId | string,
  operation: HostAdapterOperation,
  status: HostAdapterStatus,
  reason: string,
  value: T | null,
  degradationReceipt?: DegradationReceipt
): HostAdapterResult<T> {
  return {
    schema_version: "guild.host_adapter_result.v1",
    host,
    operation,
    status,
    value,
    receipt: receipt(host, operation, status, reason, degradationReceipt),
  };
}

function runtimeReceipts(host: HostId | string): Record<AdapterSurface, DegradationReceipt> {
  return {
    interaction: resolveRung("interaction", host),
    session: resolveRung("session", host),
    semantic_tool: resolveRung("semantic_tool", host),
    browser: resolveRung("browser", host),
  };
}

function operationReceipt(host: HostId | string, operation: HostAdapterOperation): DegradationReceipt | undefined {
  const surface = OPERATION_TO_RUNTIME_SURFACE[operation];
  return surface ? resolveRung(surface, host) : undefined;
}

function packageStatus(entry: HostRegistryEntry): HostAdapterStatus {
  if (entry.installability === "native") return "ok";
  if (entry.installability === "target") return "degraded";
  return "unavailable";
}

function bootstrapStatus(entry: HostRegistryEntry): HostAdapterStatus {
  const caps = entry.capabilities.bootstrap;
  return caps.context_injection || caps.wrapper_injection || caps.prompt_transform ? "degraded" : "unavailable";
}

function commandStatus(entry: HostRegistryEntry): HostAdapterStatus {
  const caps = entry.capabilities.commands;
  if (caps.slash_commands || caps.command_files !== "none") return "ok";
  return entry.surface_kind === "app" ? "unavailable" : "degraded";
}

function permissionStatus(entry: HostRegistryEntry): HostAdapterStatus {
  const caps = entry.capabilities.permissions;
  if (caps.deny || caps.ask || caps.permission_prompt_layer) return "ok";
  return "degraded";
}

function memoryStatus(entry: HostRegistryEntry): HostAdapterStatus {
  const mcp = entry.capabilities.mcp;
  return mcp.stdio || mcp.http || entry.capabilities.artifacts.file_bus || entry.capabilities.artifacts.direct_filesystem
    ? "degraded"
    : "unavailable";
}

function modelParams(entry: HostRegistryEntry, request: ResolveModelParamsRequest): Record<string, unknown> | null {
  const configured = request.params && typeof request.params === "object" ? request.params : {};
  const registryModel = entry.capabilities.models[request.tier]?.model ?? null;
  const model = typeof configured["model"] === "string" ? configured["model"] : registryModel;
  if (!model) return null;
  return { ...configured, model };
}

function unsupportedModelParamKeys(params: Record<string, unknown>, supportedKeys: string[]): string[] {
  const supported = new Set(supportedKeys);
  return Object.keys(params).filter((key) => !supported.has(key));
}

function unavailableOperations(entry: HostRegistryEntry): HostAdapterOperation[] {
  const operations: HostAdapterOperation[] = [];
  if (bootstrapStatus(entry) === "unavailable") operations.push("bootstrap");
  if (!entry.dispatch_selectable) operations.push("dispatch");
  if (commandStatus(entry) === "unavailable") operations.push("renderCommandSurface");
  if (packageStatus(entry) === "unavailable") operations.push("renderPackage");
  if (memoryStatus(entry) === "unavailable") operations.push("memory");
  return operations;
}

export function createHostAdapter(host: HostId | string): HostAdapter {
  const hostId = normalizeHostId(host);
  const entry = hostId ? HOST_REGISTRY_ROWS[hostId] : null;
  const adapterHost = hostId ?? host;

  function unavailable(operation: HostAdapterOperation): HostAdapterResult {
    const degradationReceipt = operationReceipt(adapterHost, operation);
    return result(
      adapterHost,
      operation,
      "unavailable",
      `unknown host "${host}" — no HostAdapter registry entry; fail-closed to unavailable`,
      null,
      degradationReceipt
    );
  }

  function contractOnly(operation: HostAdapterOperation, status: HostAdapterStatus, reason: string, value: unknown = null): HostAdapterResult {
    return result(adapterHost, operation, status, reason, value, operationReceipt(adapterHost, operation));
  }

  return {
    host: adapterHost,
    hostId,
    capabilities(): HostAdapterCapabilityProfile {
      const receipts = runtimeReceipts(adapterHost);
      if (!entry || !hostId) {
        return {
          schema_version: "guild.host_adapter_capabilities.v1",
          host: adapterHost,
          host_id: null,
          known: false,
          family: null,
          surface_kind: null,
          installability: "unknown",
          result_adapter: false,
          dispatch_selectable: false,
          provenance: "unknown",
          runtime_surfaces: receipts,
          unavailable_operations: HOST_ADAPTER_OPERATIONS.filter((op) => op !== "capabilities"),
        };
      }
      return {
        schema_version: "guild.host_adapter_capabilities.v1",
        host: adapterHost,
        host_id: hostId,
        known: true,
        family: entry.family,
        surface_kind: entry.surface_kind,
        installability: entry.installability,
        result_adapter: entry.result_adapter,
        dispatch_selectable: entry.dispatch_selectable,
        provenance: entry.provenance,
        runtime_surfaces: receipts,
        unavailable_operations: unavailableOperations(entry),
      };
    },
    bootstrap(request?: BootstrapRequest): HostAdapterResult {
      if (!entry) return unavailable("bootstrap");
      const status = bootstrapStatus(entry);
      return contractOnly(
        "bootstrap",
        status,
        status === "degraded"
          ? "bootstrap primitive exists, but concrete host bootstrap is wired in later adapter runs"
          : "host advertises no bootstrap primitive",
        request ?? {}
      );
    },
    preflight(request?: PreflightRequest): HostAdapterResult {
      if (!entry) return unavailable("preflight");
      const hooks = entry.capabilities.hooks;
      const hasNativeHook = Object.values(hooks).some(Boolean);
      const reason = hasNativeHook
        ? "native hook is advertised; concrete hook binding remains host-adapter runtime work"
        : "no native hook advertised; preflight must use fallback ladder and record degradation";
      return contractOnly(
        "preflight",
        "degraded",
        reason,
        request ?? {}
      );
    },
    dispatch(request: DispatchRequest): HostAdapterResult {
      if (!entry) return unavailable("dispatch");
      if (!entry.dispatch_selectable) {
        return contractOnly("dispatch", "unavailable", "host is known but not dispatch-selectable", request);
      }
      return contractOnly("dispatch", "degraded", "dispatch contract accepted; concrete execution adapter is wired in later runs", request);
    },
    collect(request?: CollectRequest): HostAdapterResult {
      if (!entry) return unavailable("collect");
      return contractOnly("collect", "degraded", "collection uses file-bus/session fallback until concrete adapter collect is wired", request ?? {});
    },
    renderCommandSurface(request?: RenderCommandSurfaceRequest): HostAdapterResult {
      if (!entry) return unavailable("renderCommandSurface");
      return contractOnly(
        "renderCommandSurface",
        commandStatus(entry),
        commandStatus(entry) === "ok" ? "host advertises a command surface" : "host lacks native command surface; use instructions/file-bus",
        request ?? {}
      );
    },
    renderPackage(request?: RenderPackageRequest): HostAdapterResult {
      if (!entry) return unavailable("renderPackage");
      const status = packageStatus(entry);
      return result(
        adapterHost,
        "renderPackage",
        status,
        status === "ok"
          ? "host has a verified native package install path"
          : status === "degraded"
            ? "package renderer/target exists but install is not verified"
            : "host has no installable package surface",
        { installability: entry.installability, request: request ?? {} },
        operationReceipt(adapterHost, "renderPackage")
      );
    },
    renderPermissionDecision(request: RenderPermissionDecisionRequest): HostAdapterResult {
      if (!entry) return unavailable("renderPermissionDecision");
      return contractOnly(
        "renderPermissionDecision",
        permissionStatus(entry),
        permissionStatus(entry) === "ok" ? "host advertises a permission decision primitive" : "permission decision must be recorded as degraded",
        request
      );
    },
    resolveModelParams(request: ResolveModelParamsRequest): HostAdapterResult<Record<string, unknown>> {
      if (!entry) return unavailable("resolveModelParams") as HostAdapterResult<Record<string, unknown>>;
      const params = modelParams(entry, request);
      if (!params) {
        // Explicit type argument: passing `null` alone would infer `T = null` and
        // yield `HostAdapterResult<null>`. Type-only; the returned record is
        // byte-identical. Surfaced once this contract became a public export.
        return result<Record<string, unknown>>(
          adapterHost,
          "resolveModelParams",
          "degraded",
          `no model configured for ${request.tier} on ${adapterHost}; later dispatch must record unsupported model params`,
          null,
          operationReceipt(adapterHost, "resolveModelParams")
        );
      }
      const unsupported = unsupportedModelParamKeys(params, ["model"]);
      if (unsupported.length > 0) {
        return result(
          adapterHost,
          "resolveModelParams",
          "degraded",
          `model params resolved, but ${adapterHost} default adapter cannot enforce unsupported key(s): ${unsupported.join(", ")}`,
          {
            modelParams: params,
            unsupported_model_params: unsupported,
          },
          operationReceipt(adapterHost, "resolveModelParams")
        );
      }
      return result(
        adapterHost,
        "resolveModelParams",
        "ok",
        "model parameter dictionary resolved with registry/default model only",
        { modelParams: params },
        operationReceipt(adapterHost, "resolveModelParams")
      );
    },
    memory(request: MemoryRequest): HostAdapterResult {
      if (!entry) return unavailable("memory");
      const status = memoryStatus(entry);
      return contractOnly(
        "memory",
        status,
        status === "degraded"
          ? "memory access must route through MCP, bridge, filesystem, or file-bus fallback in later memory adapter run"
          : "host advertises no memory transport",
        request
      );
    },
  };
}

export function createAllHostAdapters(): Record<HostId, HostAdapter> {
  const out = {} as Record<HostId, HostAdapter>;
  for (const hostId of HOST_IDS) out[hostId] = createHostAdapter(hostId);
  return out;
}
