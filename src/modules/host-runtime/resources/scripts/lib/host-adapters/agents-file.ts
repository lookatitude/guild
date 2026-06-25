import type {
  BootstrapRequest,
  CollectRequest,
  DispatchRequest,
  HostAdapter,
  HostAdapterCapabilityProfile,
  HostAdapterOperation,
  HostAdapterReceipt,
  HostAdapterResult,
  MemoryRequest,
  PreflightRequest,
  RenderCommandSurfaceRequest,
  RenderPackageRequest,
  RenderPermissionDecisionRequest,
  ResolveModelParamsRequest,
} from "../host-adapter-contract";
import {
  resolveRung,
  type AdapterSurface,
  type DegradationReceipt,
} from "../adapter-fallback-ladders";
import { HOST_REGISTRY_ROWS, type HostId, type HostRegistryEntry } from "../host-registry-schema";

const HOST_ID: HostId = "agents-file";
const ENTRY = HOST_REGISTRY_ROWS[HOST_ID];

function runtimeReceipts(host: HostId): Record<AdapterSurface, DegradationReceipt> {
  return {
    interaction: resolveRung("interaction", host),
    session: resolveRung("session", host),
    semantic_tool: resolveRung("semantic_tool", host),
    browser: resolveRung("browser", host),
  };
}

function result<T>(
  operation: HostAdapterOperation,
  status: HostAdapterReceipt["status"],
  reason: string,
  value: T,
  degradationReceipt?: DegradationReceipt
): HostAdapterResult<T> {
  return {
    schema_version: "guild.host_adapter_result.v1",
    host: HOST_ID,
    operation,
    status,
    value,
    receipt: {
      schema_version: "guild.host_adapter_receipt.v1",
      host: HOST_ID,
      operation,
      status,
      reason,
      ...(degradationReceipt ? { degradation_receipt: degradationReceipt } : {}),
    },
  };
}

export function createAgentsFileAdapter(entry: HostRegistryEntry = ENTRY): HostAdapter {
  return {
    host: HOST_ID,
    hostId: HOST_ID,

    capabilities(): HostAdapterCapabilityProfile {
      return {
        schema_version: "guild.host_adapter_capabilities.v1",
        host: HOST_ID,
        host_id: HOST_ID,
        known: true,
        family: entry.family,
        surface_kind: entry.surface_kind,
        installability: entry.installability,
        result_adapter: entry.result_adapter,
        dispatch_selectable: entry.dispatch_selectable,
        provenance: entry.provenance,
        runtime_surfaces: runtimeReceipts(HOST_ID),
        unavailable_operations: ["renderPermissionDecision"],
      };
    },

    bootstrap(request?: BootstrapRequest): HostAdapterResult {
      return result(
        "bootstrap",
        "ok",
        "agents-file bootstraps through canonical AGENTS.md instructions",
        { request: request ?? {}, instruction_file: "AGENTS.md", skill_root: ".agents/skills/guild" },
        resolveRung("session", HOST_ID)
      );
    },

    preflight(request?: PreflightRequest): HostAdapterResult {
      return result(
        "preflight",
        "degraded",
        "agents-file has no host runtime hooks; the consuming host performs execution",
        { request: request ?? {}, native_hooks: false, instruction_file: "AGENTS.md" },
        resolveRung("session", HOST_ID)
      );
    },

    dispatch(request: DispatchRequest): HostAdapterResult {
      return result(
        "dispatch",
        "degraded",
        "agents-file is an instruction package target, not a process launcher",
        { taskRun: request.taskRun, dispatch_kind: "instruction_file", command: null, args: [] },
        resolveRung("session", HOST_ID)
      );
    },

    collect(request?: CollectRequest): HostAdapterResult {
      return result(
        "collect",
        "degraded",
        "agents-file collection depends on the consuming host writing Guild artifacts",
        { request: request ?? {}, artifact_roots: [".guild/runs"] },
        resolveRung("session", HOST_ID)
      );
    },

    renderCommandSurface(request?: RenderCommandSurfaceRequest): HostAdapterResult {
      return result(
        "renderCommandSurface",
        "degraded",
        "agents-file exposes instructions and skills, not native command descriptors",
        { request: request ?? {}, commands: "documented-in-AGENTS.md" },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    renderPackage(request?: RenderPackageRequest): HostAdapterResult {
      return result(
        "renderPackage",
        "degraded",
        "agents-file renders AGENTS.md plus .agents/skills/guild for any AGENTS-consuming host",
        {
          request: request ?? {},
          agents_md_path: "AGENTS.md",
          skill_root: ".agents/skills/guild",
          launcher: "bin/guild-run",
          installability: entry.installability,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    renderPermissionDecision(request: RenderPermissionDecisionRequest): HostAdapterResult {
      return result(
        "renderPermissionDecision",
        "unavailable",
        "agents-file has no permission API; consuming host policy owns approval",
        { decision: request.decision },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    resolveModelParams(request: ResolveModelParamsRequest): HostAdapterResult<Record<string, unknown>> {
      const configured = request.params && typeof request.params === "object" ? request.params : {};
      const registryModel = entry.capabilities.models[request.tier]?.model ?? null;
      const model = typeof configured["model"] === "string" ? configured["model"] : registryModel;
      const modelParams = model ? { ...configured, model } : { ...configured };
      const unsupported = Object.keys(modelParams);
      return result(
        "resolveModelParams",
        "degraded",
        "agents-file records desired model params but cannot enforce host-native model flags",
        { modelParams, tier: request.tier, unsupported_model_params: unsupported },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    memory(request: MemoryRequest): HostAdapterResult {
      return result(
        "memory",
        "degraded",
        "agents-file uses shared .guild memory through the consuming host",
        { mode: request.mode, primary: { transport: "filesystem-bm25", root: ".guild" } },
        resolveRung("semantic_tool", HOST_ID)
      );
    },
  };
}
