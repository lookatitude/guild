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
import { AntigravityPaneAdapter } from "../pane-adapter";
import { queryGuildMemory } from "../memory-adapter";
import { makePolicySkipProgress } from "../review-progress";
import { planReviewPairing } from "../review-pairing";

const HOST_ID: HostId = "antigravity-cli";
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

function taskRunRecord(request: DispatchRequest): Record<string, unknown> {
  return request.taskRun && typeof request.taskRun === "object"
    ? (request.taskRun as Record<string, unknown>)
    : { prompt: String(request.taskRun ?? "") };
}

function activeCwd(request: MemoryRequest): string {
  const payload = request.payload;
  if (payload && typeof payload === "object" && typeof (payload as Record<string, unknown>)["cwd"] === "string") {
    return (payload as Record<string, unknown>)["cwd"] as string;
  }
  return process.cwd();
}

function configuredModelParams(request: ResolveModelParamsRequest): Record<string, unknown> {
  return request.params && typeof request.params === "object" ? request.params : {};
}

function unsupportedModelParamKeys(params: Record<string, unknown>, supportedKeys: string[]): string[] {
  const supported = new Set(supportedKeys);
  return Object.keys(params).filter((key) => !supported.has(key));
}

export function createAntigravityCliAdapter(entry: HostRegistryEntry = ENTRY): HostAdapter {
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
      return result(
        "bootstrap",
        "ok",
        "Antigravity CLI bootstraps through AGENTS.md plus the rendered Antigravity plugin package",
        {
          request: request ?? {},
          instruction_file: "AGENTS.md",
          package_manifest: "plugin.json",
          compatibility_manifest: "antigravity-manifest.json",
          validate_command: "agy plugin validate ./dist/antigravity",
          install_command: "agy plugin install ./dist/antigravity",
          skill_root: ".agents/skills/guild",
          launcher: "bin/guild-run",
        },
        resolveRung("session", HOST_ID)
      );
    },

    preflight(request?: PreflightRequest): HostAdapterResult {
      const pane = new AntigravityPaneAdapter();
      return result(
        "preflight",
        "degraded",
        "Antigravity CLI has no native Guild hooks/MCP; preflight uses agy plus file-bus fallback receipts",
        {
          request: request ?? {},
          binary_probe: "agy --version",
          package_validate: "agy plugin validate ./dist/antigravity",
          native_hooks: false,
          mcp: { stdio: entry.capabilities.mcp.stdio, http: entry.capabilities.mcp.http },
          fallback: { hooks: "wrapper/instruction-file", mcp: "filesystem-bm25", permissions: "agy --sandbox or --dangerously-skip-permissions" },
          expected_outputs: pane.expectedOutputs(),
        },
        resolveRung("session", HOST_ID)
      );
    },

    dispatch(request: DispatchRequest): HostAdapterResult {
      const taskRun = taskRunRecord(request);
      const prompt = typeof taskRun["prompt"] === "string" ? (taskRun["prompt"] as string) : JSON.stringify(taskRun);
      const pane = new AntigravityPaneAdapter();
      return result(
        "dispatch",
        "ok",
        "Antigravity dispatch uses agy -p through tmux/plain-process substrate and file-bus coordination",
        {
          taskRun,
          dispatch_kind: "plain_process",
          command: "agy",
          args: ["-p", prompt],
          pane_command: pane.command({
            name: "antigravity",
            scope: "guild task",
            runId: typeof taskRun["runId"] === "string" ? taskRun["runId"] as string : "run",
            slug: "guild-task",
            prompt,
            hostKind: "antigravity-2",
          }),
        },
        resolveRung("session", HOST_ID)
      );
    },

    collect(request?: CollectRequest): HostAdapterResult {
      return result(
        "collect",
        "ok",
        "Antigravity collection reads .guild file-bus artifacts emitted by the wrapper/pane",
        { request: request ?? {}, artifact_roots: [".guild/runs", ".guild/context", ".guild/runs/<run-id>/agent-bus"] },
        resolveRung("session", HOST_ID)
      );
    },

    renderCommandSurface(request?: RenderCommandSurfaceRequest): HostAdapterResult {
      return result(
        "renderCommandSurface",
        "ok",
        "Antigravity package renders Guild commands as plugin command descriptors and AGENTS.md bootstrap instructions",
        {
          request: request ?? {},
          manifest_path: "plugin.json",
          compatibility_manifest_path: "antigravity-manifest.json",
          command_entries: "commands[]",
          invoke: "agy -p",
          native_slash_commands: false,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    renderPackage(request?: RenderPackageRequest): HostAdapterResult {
      return result(
        "renderPackage",
        "degraded",
        "Antigravity package target renders plugin.json, antigravity-manifest.json, and the Guild skill tree",
        {
          request: request ?? {},
          manifest_path: "plugin.json",
          compatibility_manifest_path: "antigravity-manifest.json",
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
        "degraded",
        "Antigravity has no per-tool Guild permission hook; sandbox/bypass are coarse launch modes recorded as degraded policy receipts",
        {
          decision: request.decision,
          sandbox_flag: "--sandbox",
          bypass_flag: "--dangerously-skip-permissions",
          launch_modes: entry.capabilities.permissions.launch_modes,
          native_prompt_layer: false,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    resolveModelParams(request: ResolveModelParamsRequest): HostAdapterResult<Record<string, unknown>> {
      const configured = configuredModelParams(request);
      const registryModel = entry.capabilities.models[request.tier]?.model ?? null;
      const model = typeof configured["model"] === "string" ? configured["model"] : registryModel;
      const modelParams = model ? { ...configured, model } : { ...configured };
      const unsupported = unsupportedModelParamKeys(modelParams, ["model"]);
      const argv = model ? ["--model", String(model)] : [];
      return result(
        "resolveModelParams",
        unsupported.length > 0 ? "degraded" : "ok",
        unsupported.length > 0
          ? `Antigravity maps model, but cannot enforce unsupported model param key(s): ${unsupported.join(", ")}`
          : "Antigravity maps model params to --model",
        { modelParams, argv, unsupported_model_params: unsupported },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    memory(request: MemoryRequest): HostAdapterResult {
      const receipt = queryGuildMemory({
        cwd: activeCwd(request),
        query: typeof request.payload === "object" && request.payload && typeof (request.payload as Record<string, unknown>)["query"] === "string"
          ? (request.payload as Record<string, unknown>)["query"] as string
          : "",
        capabilities: { bridgePackage: true, filesystem: true },
      });
      return result(
        "memory",
        "degraded",
        "Antigravity memory uses the package bridge when present and filesystem/BM25 fallback through the active .guild root",
        {
          mode: request.mode,
          primary: { transport: "bridge-package", status: "target" },
          receipt,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },
  };
}

export function antigravityReviewSkipProgress(runId = "run", gate = "G-implementation:antigravity-cli") {
  return makePolicySkipProgress({
    runId,
    gate,
    roundNumber: 1,
    authorHost: HOST_ID,
    reviewerHost: HOST_ID,
    independence: "weak",
    artifactPath: `.guild/runs/${runId}/review/${gate}/artifact.md`,
    packetPath: `.guild/runs/${runId}/review/${gate}/packet-1.md`,
    timestamp: "2026-06-18T00:00:00Z",
    reason: "antigravity-cli has no result_adapter; policy-permitted skip records weak/no-review state",
    degradationReceipt: resolveRung("semantic_tool", HOST_ID),
  });
}

export function antigravityRequestsCodexReviewProgress(runId = "run", gate = "G-implementation:antigravity-cli") {
  return planReviewPairing({
    runId,
    gate,
    roundNumber: 1,
    authorHost: HOST_ID,
    reviewerHost: "codex-cli",
    independence: "strong",
    artifactPath: `.guild/runs/${runId}/review/${gate}/artifact.md`,
    packetPath: `.guild/runs/${runId}/review/${gate}/packet-1.md`,
    timestamp: "2026-06-18T00:00:00Z",
    policyAllowsSkip: false,
    reviewerAvailable: true,
    outcome: "succeeded",
  });
}
