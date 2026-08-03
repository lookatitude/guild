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

const HOST_ID: HostId = "codex-cli";
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
  host: HostId,
  operation: HostAdapterOperation,
  status: HostAdapterReceipt["status"],
  reason: string,
  value: T,
  degradationReceipt?: DegradationReceipt
): HostAdapterResult<T> {
  return {
    schema_version: "guild.host_adapter_result.v1",
    host,
    operation,
    status,
    value,
    receipt: {
      schema_version: "guild.host_adapter_receipt.v1",
      host,
      operation,
      status,
      reason,
      ...(degradationReceipt ? { degradation_receipt: degradationReceipt } : {}),
    },
  };
}

function taskRunRecord(request: DispatchRequest): Record<string, unknown> {
  return request.taskRun && typeof request.taskRun === "object"
    ? (request.taskRun as Record<string, unknown>)
    : { prompt: String(request.taskRun ?? "") };
}

function configuredModelParams(request: ResolveModelParamsRequest): Record<string, unknown> {
  return request.params && typeof request.params === "object" ? request.params : {};
}

function unsupportedModelParamKeys(params: Record<string, unknown>, supportedKeys: string[]): string[] {
  const supported = new Set(supportedKeys);
  return Object.keys(params).filter((key) => !supported.has(key));
}

export function createCodexCliAdapter(entry: HostRegistryEntry = ENTRY): HostAdapter {
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
        unavailable_operations: [],
      };
    },

    bootstrap(request?: BootstrapRequest): HostAdapterResult {
      const instructionFile = entry.capabilities.bootstrap.context_injection === "instruction_file";
      return result(
        HOST_ID,
        "bootstrap",
        instructionFile ? "ok" : "degraded",
        instructionFile
          ? "Codex CLI bootstrap is registry-verified through AGENTS.md instruction-file injection"
          : "Codex CLI registry row does not enable instruction-file bootstrap",
        {
          request: request ?? {},
          verified_by: "HOST_REGISTRY_ROWS[codex-cli].capabilities.bootstrap.context_injection",
          registry_value: entry.capabilities.bootstrap.context_injection,
          instruction_file: "AGENTS.md",
          wrapper_injection: entry.capabilities.bootstrap.wrapper_injection,
        },
        resolveRung("session", HOST_ID)
      );
    },

    preflight(request?: PreflightRequest): HostAdapterResult {
      return result(
        HOST_ID,
        "preflight",
        "degraded",
        "Codex fires SessionStart + UserPromptSubmit natively via codex-hooks.json; the remaining Claude hook events degrade to wrapper/instruction-file",
        {
          request: request ?? {},
          // Two events are native (live-verified, wi-04); the rest of the
          // Claude hook taxonomy has no Codex surface and degrades. The flag
          // means "the FULL taxonomy is native", which stays false.
          native_hooks: false,
          native_hook_events: ["SessionStart", "UserPromptSubmit"],
          bootstrap_file: "AGENTS.md",
          commands: ["codex --version", "codex login status"],
          degradation: "hook events beyond SessionStart/UserPromptSubmit have no Codex surface; they degrade through the HookEmitter",
        },
        resolveRung("session", HOST_ID)
      );
    },

    dispatch(request: DispatchRequest): HostAdapterResult {
      const taskRun = taskRunRecord(request);
      const prompt = typeof taskRun["prompt"] === "string" ? (taskRun["prompt"] as string) : JSON.stringify(taskRun);
      const wrapperCommand = typeof taskRun["command"] === "string" ? (taskRun["command"] as string) : null;
      const wrapperArgs = Array.isArray(taskRun["args"]) ? (taskRun["args"] as unknown[]).map(String) : null;
      const wrapperEnv =
        taskRun["env"] && typeof taskRun["env"] === "object" ? (taskRun["env"] as Record<string, string>) : {};
      return result(
        HOST_ID,
        "dispatch",
        "ok",
        wrapperCommand
          ? "Codex CLI dispatch receipt follows the wrapper launch plan"
          : "Codex CLI dispatch uses codex exec with wrapper bootstrap when needed",
        wrapperCommand
          ? { taskRun, dispatch_kind: "wrapper_launch", command: wrapperCommand, args: wrapperArgs ?? [], env: wrapperEnv }
          : { taskRun, dispatch_kind: "plain_process", command: "codex", args: ["exec", prompt], env: {} },
        resolveRung("session", HOST_ID)
      );
    },

    collect(request?: CollectRequest): HostAdapterResult {
      return result(
        HOST_ID,
        "collect",
        "ok",
        "Codex collection reads wrapper stdout/session/result artifacts",
        { request: request ?? {}, artifact_roots: [".guild/runs", ".guild/context"] },
        resolveRung("session", HOST_ID)
      );
    },

    renderCommandSurface(request?: RenderCommandSurfaceRequest): HostAdapterResult {
      return result(
        HOST_ID,
        "renderCommandSurface",
        "degraded",
        "Codex plugin renders command descriptors but has no Claude-style slash markdown files",
        { request: request ?? {}, command_manifest: ".codex-plugin/plugin.json", slash_commands: false },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    renderPackage(request?: RenderPackageRequest): HostAdapterResult {
      return result(
        HOST_ID,
        "renderPackage",
        "degraded",
        "Codex package target renders .codex-plugin plus .agents skill tree; live install is target-level",
        {
          request: request ?? {},
          manifest_path: ".codex-plugin/plugin.json",
          agents_skill_root: ".agents/skills/guild",
          launcher: "bin/guild-run",
          installability: entry.installability,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    renderPermissionDecision(request: RenderPermissionDecisionRequest): HostAdapterResult {
      return result(
        HOST_ID,
        "renderPermissionDecision",
        "ok",
        "Codex permission mode maps through CLI approval/sandbox flags where available",
        { decision: request.decision, launch_modes: entry.capabilities.permissions.launch_modes },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    resolveModelParams(request: ResolveModelParamsRequest): HostAdapterResult<Record<string, unknown>> {
      const configured = configuredModelParams(request);
      const registryModel = entry.capabilities.models[request.tier]?.model ?? null;
      const model = typeof configured["model"] === "string" ? configured["model"] : registryModel;
      if (!model) {
        return result(
          HOST_ID,
          "resolveModelParams",
          "degraded",
          `Codex model params unavailable: no model configured for ${request.tier}`,
          { modelParams: null, unsupported_model_params: [] },
          resolveRung("semantic_tool", HOST_ID)
        );
      }
      const modelParams: Record<string, unknown> = { ...configured, model };
      const unsupported = unsupportedModelParamKeys(modelParams, ["model", "effort", "reasoning"]);
      const reasoningEffort =
        typeof modelParams["reasoning"] === "string"
          ? (modelParams["reasoning"] as string)
          : typeof modelParams["effort"] === "string"
            ? (modelParams["effort"] as string)
            : null;
      const argv = [
        "--model",
        String(model),
        ...(reasoningEffort ? ["-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`] : []),
      ];
      return result(
        HOST_ID,
        "resolveModelParams",
        unsupported.length > 0 ? "degraded" : "ok",
        unsupported.length > 0
          ? `Codex CLI maps model plus effort/reasoning, but cannot enforce unsupported model param key(s): ${unsupported.join(", ")}`
          : "Codex CLI maps model params to --model and model_reasoning_effort config",
        { modelParams, argv, unsupported_model_params: unsupported },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    memory(request: MemoryRequest): HostAdapterResult {
      return result(
        HOST_ID,
        "memory",
        "degraded",
        "Codex CLI uses filesystem/BM25 Guild memory until native MCP memory is available",
        {
          mode: request.mode,
          primary: { transport: "filesystem-bm25", status: "degraded", root: ".guild" },
          mcp: { stdio: entry.capabilities.mcp.stdio, http: entry.capabilities.mcp.http },
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },
  };
}
