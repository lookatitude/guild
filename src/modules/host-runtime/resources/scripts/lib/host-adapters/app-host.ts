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
import { queryGuildMemory, type MemoryCapabilities } from "../memory-adapter";
import { progressScenariosForPair } from "../review-pairing";

export type AppSupportState = "verified" | "unavailable" | "enqueue_only" | "manual_instruction";

// `as const` erases at runtime — the emitted value is a plain, push-able array, and this
// one is exported (`export { APP_HOSTS }` at the foot of the file). Frozen at the
// declaration site; the `as const` is kept for the `AppHostId` union below.
const APP_HOSTS = Object.freeze([
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector",
] as const satisfies readonly HostId[]);

export type AppHostId = (typeof APP_HOSTS)[number];

interface AppHostBehavior {
  supportState: AppSupportState;
  commandMode: AppSupportState;
  dispatchMode: AppSupportState;
  permissionMode: AppSupportState;
  memoryMode: AppSupportState;
  reviewRequester: boolean;
  connectorAuth: AppSupportState;
  egressGate: AppSupportState;
  guidance: string;
}

interface AppCommandGuidance {
  invocation: "native_slash" | "local_plugin_bridge" | "manual_instruction" | "connector_action";
  primary: string;
  fallback: string;
  verification_required: string;
  codex_app_local_plugin_link?: string;
  codex_prompt_bridge?: {
    hook_event: "UserPromptSubmit";
    accepted_forms: string[];
    unknown_verb_behavior: "block_with_known_command_list";
  };
}

const BEHAVIOR: Record<AppHostId, AppHostBehavior> = {
  "claude-code-app": {
    supportState: "manual_instruction",
    commandMode: "manual_instruction",
    dispatchMode: "manual_instruction",
    permissionMode: "manual_instruction",
    memoryMode: "manual_instruction",
    reviewRequester: false,
    connectorAuth: "manual_instruction",
    egressGate: "manual_instruction",
    guidance: "Use the Claude Code CLI plugin install for local Guild execution; the app surface receives pointers to .guild artifacts.",
  },
  "claude-code-web": {
    supportState: "manual_instruction",
    commandMode: "manual_instruction",
    dispatchMode: "enqueue_only",
    permissionMode: "manual_instruction",
    memoryMode: "unavailable",
    reviewRequester: false,
    connectorAuth: "manual_instruction",
    egressGate: "manual_instruction",
    guidance: "Use a cloud/web task packet only after an explicit egress approval; local .guild filesystem access is unavailable.",
  },
  "codex-app": {
    supportState: "enqueue_only",
    commandMode: "manual_instruction",
    dispatchMode: "enqueue_only",
    permissionMode: "manual_instruction",
    memoryMode: "manual_instruction",
    reviewRequester: true,
    connectorAuth: "manual_instruction",
    egressGate: "manual_instruction",
    guidance: "Queue a Codex app thread/worktree packet and write all Guild artifacts back through the file bus.",
  },
  "claude-ai-connector": {
    supportState: "enqueue_only",
    commandMode: "manual_instruction",
    dispatchMode: "enqueue_only",
    permissionMode: "manual_instruction",
    memoryMode: "unavailable",
    reviewRequester: false,
    connectorAuth: "manual_instruction",
    egressGate: "manual_instruction",
    guidance: "Expose Guild as remote MCP/connector instructions; dispatch is serial/enqueue-only and requires connector auth plus egress approval.",
  },
};

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

function configuredModelParams(request: ResolveModelParamsRequest): Record<string, unknown> {
  return request.params && typeof request.params === "object" ? request.params : {};
}

function activeCwd(request: MemoryRequest): string {
  const payload = request.payload;
  if (payload && typeof payload === "object" && typeof (payload as Record<string, unknown>)["cwd"] === "string") {
    return (payload as Record<string, unknown>)["cwd"] as string;
  }
  return process.cwd();
}

function requestedMemoryCapabilities(request: MemoryRequest): MemoryCapabilities {
  const payload = request.payload;
  if (payload && typeof payload === "object") {
    const caps = (payload as Record<string, unknown>)["capabilities"];
    if (caps && typeof caps === "object") {
      const record = caps as Record<string, unknown>;
      return {
        mcp: record["mcp"] === true,
        httpMcp: record["httpMcp"] === true,
        bridgePackage: record["bridgePackage"] === true,
        filesystem: record["filesystem"] === true,
      };
    }
  }
  return { filesystem: true };
}

function hasMemoryTransport(caps: MemoryCapabilities): boolean {
  return caps.mcp === true || caps.httpMcp === true || caps.bridgePackage === true || caps.filesystem === true;
}

function commandGuidance(hostId: AppHostId): AppCommandGuidance {
  switch (hostId) {
    case "claude-code-app":
      return {
        invocation: "native_slash",
        primary: '/guild:guild "your task"',
        fallback: "Use the Claude Code CLI Guild plugin install, or paste the Guild manual instruction packet that points at the current .guild run artifacts.",
        verification_required: "Open a fresh Claude desktop/Claude Code app session after plugin install and confirm /guild:guild appears and dispatches.",
      };
    case "codex-app":
      return {
        invocation: "local_plugin_bridge",
        primary: "/guild:status",
        fallback: "Invoke the installed Guild plugin or bundled guild skill explicitly with @ if Codex App rejects unknown slash text before hooks run.",
        verification_required: "Install Guild from the local marketplace link, enable the plugin, submit /guild:status in Codex App, and verify the UserPromptSubmit hook receives the prompt.",
        codex_app_local_plugin_link:
          "codex://plugins/guild?marketplacePath=<absolute-path-to-dist/codex-marketplace/.agents/plugins/marketplace.json>",
        codex_prompt_bridge: {
          hook_event: "UserPromptSubmit",
          accepted_forms: ["/guild", "/guild:<verb>", "/guild <verb>"],
          unknown_verb_behavior: "block_with_known_command_list",
        },
      };
    case "claude-code-web":
      return {
        invocation: "manual_instruction",
        primary: "Paste or attach the Guild app dispatch packet for the target run.",
        fallback: "Use Claude Code CLI for local /guild execution when local filesystem artifacts are required.",
        verification_required: "Confirm the web surface can receive the packet only after explicit egress approval and can write results back through the file bus.",
      };
    case "claude-ai-connector":
      return {
        invocation: "connector_action",
        primary: "Use the configured Claude.ai connector/MCP action after connector authentication.",
        fallback: "Emit a manual instruction packet and keep local execution in Claude Code CLI.",
        verification_required: "Confirm connector auth, egress approval, and file-bus writeback before advertising connector execution.",
      };
  }
}

export function appHostReviewPacket(runId = "run-r10", gate = "G-implementation:codex-app") {
  const ctx = {
    runId,
    gate,
    roundNumber: 1,
    authorHost: "codex-app",
    reviewerHost: "claude-code-cli",
    independence: "strong" as const,
    artifactPath: `.guild/runs/${runId}/review/${gate}/artifact.md`,
    packetPath: `.guild/runs/${runId}/review/${gate}/packet-1.md`,
    timestamp: "2026-06-18T00:00:00Z",
  };
  return {
    schema_version: "guild.app_review_packet.v1",
    origin_host: "codex-app",
    reviewer_host: "claude-code-cli",
    support_state: "manual_instruction" as AppSupportState,
    packet_path: ctx.packetPath,
    review_command: "claude --print --verbose --output-format stream-json <packet>",
    progress_scenarios: progressScenariosForPair(ctx),
    pairing: {
      status: "manual_instruction",
      independence: "strong",
      reason: "Codex app emits a file-bus packet that a local Claude CLI reviewer can run when installed/authenticated and policy allows it.",
    },
  };
}

export function createAppHostAdapter(hostId: AppHostId, entry: HostRegistryEntry = HOST_REGISTRY_ROWS[hostId]): HostAdapter {
  const behavior = BEHAVIOR[hostId];
  return {
    host: hostId,
    hostId,

    capabilities(): HostAdapterCapabilityProfile {
      return {
        schema_version: "guild.host_adapter_capabilities.v1",
        host: hostId,
        host_id: hostId,
        known: true,
        family: entry.family,
        surface_kind: entry.surface_kind,
        installability: entry.installability,
        result_adapter: entry.result_adapter,
        dispatch_selectable: entry.dispatch_selectable,
        provenance: entry.provenance,
        runtime_surfaces: runtimeReceipts(hostId),
        unavailable_operations: ["renderPackage", ...(behavior.dispatchMode === "unavailable" ? ["dispatch" as const] : [])],
      };
    },

    bootstrap(request?: BootstrapRequest): HostAdapterResult {
      return result(
        hostId,
        "bootstrap",
        "degraded",
        "app/connector host has no CLI package bootstrap; Guild emits connector/manual instructions and .guild artifact pointers",
        {
          request: request ?? {},
          support_state: behavior.supportState,
          instruction_file: "AGENTS.md",
          guild_state_root: ".guild",
          guidance: behavior.guidance,
        },
        resolveRung("session", hostId)
      );
    },

    preflight(request?: PreflightRequest): HostAdapterResult {
      return result(
        hostId,
        "preflight",
        "degraded",
        "app/connector host has no local Guild hook; preflight records no-local-hook and connector auth/egress requirements",
        {
          request: request ?? {},
          support_state: behavior.supportState,
          native_hooks: false,
          no_local_hook: true,
          connector_auth: behavior.connectorAuth,
          egress_gate: behavior.egressGate,
          fallback: "file-bus/manual_instruction",
        },
        resolveRung("session", hostId)
      );
    },

    dispatch(request: DispatchRequest): HostAdapterResult {
      const packet = {
        schema_version: "guild.app_dispatch_packet.v1",
        origin_host: hostId,
        support_state: behavior.dispatchMode,
        task_run: request.taskRun,
        queue_path: `.guild/runs/<run-id>/app-queue/${hostId}.json`,
        guidance: behavior.guidance,
      };
      return result(
        hostId,
        "dispatch",
        behavior.dispatchMode === "unavailable" ? "unavailable" : "degraded",
        "app/connector dispatch is not a local CLI process; it enqueues or emits manual instructions",
        packet,
        resolveRung("session", hostId)
      );
    },

    collect(request?: CollectRequest): HostAdapterResult {
      return result(
        hostId,
        "collect",
        "degraded",
        "app/connector collection reads file-bus artifacts once the app/connector writes them back",
        {
          request: request ?? {},
          support_state: behavior.dispatchMode,
          artifact_roots: [".guild/runs", ".guild/context", ".guild/runs/<run-id>/app-queue"],
        },
        resolveRung("session", hostId)
      );
    },

    renderCommandSurface(request?: RenderCommandSurfaceRequest): HostAdapterResult {
      const guidance = commandGuidance(hostId);
      return result(
        hostId,
        "renderCommandSurface",
        "degraded",
        "app/connector host has no CLI slash-command package; commands render as instructions or MCP/connector actions",
        {
          request: request ?? {},
          support_state: behavior.commandMode,
          command_surface: behavior.commandMode === "enqueue_only" ? "queued_action" : "manual_instruction",
          desktop_command_guidance: guidance,
        },
        resolveRung("semantic_tool", hostId)
      );
    },

    renderPackage(request?: RenderPackageRequest): HostAdapterResult {
      return result(
        hostId,
        "renderPackage",
        "unavailable",
        "app/connector hosts are not CLI package targets; installer must refuse and print connector guidance",
        {
          request: request ?? {},
          support_state: "unavailable",
          installability: entry.installability,
          connector_guidance: behavior.guidance,
        },
        resolveRung("semantic_tool", hostId)
      );
    },

    renderPermissionDecision(request: RenderPermissionDecisionRequest): HostAdapterResult {
      return result(
        hostId,
        "renderPermissionDecision",
        "degraded",
        "app/connector approvals are host-native or manual; Guild records the requested policy and waits for operator/app approval",
        {
          decision: request.decision,
          support_state: behavior.permissionMode,
          approval_packet: `.guild/runs/<run-id>/approval/${hostId}.json`,
        },
        resolveRung("semantic_tool", hostId)
      );
    },

    resolveModelParams(request: ResolveModelParamsRequest): HostAdapterResult<Record<string, unknown>> {
      const configured = configuredModelParams(request);
      const registryModel = entry.capabilities.models[request.tier]?.model ?? null;
      const model = typeof configured["model"] === "string" ? configured["model"] : registryModel;
      const modelParams = model ? { ...configured, model } : { ...configured };
      const supportedKeys = hostId === "codex-app" ? ["model", "effort", "reasoning"] : ["model", "effort"];
      const unsupported = Object.keys(modelParams).filter((key) => !supportedKeys.includes(key));
      return result(
        hostId,
        "resolveModelParams",
        "degraded",
        "app/connector model params are recorded for the host/app to apply; unsupported keys are explicit",
        {
          support_state: "manual_instruction",
          modelParams,
          unsupported_model_params: unsupported,
        },
        resolveRung("semantic_tool", hostId)
      );
    },

    memory(request: MemoryRequest): HostAdapterResult {
      if (behavior.memoryMode === "unavailable") {
        return result(
          hostId,
          "memory",
          "unavailable",
          "web/connector target has no local filesystem memory path; caller must provide a connector memory bridge or fail visibly",
          {
            mode: request.mode,
            support_state: "unavailable",
            required_bridge: "guild-memory MCP or explicit file-bus import",
          },
          resolveRung("semantic_tool", hostId)
        );
      }
      const capabilities = requestedMemoryCapabilities(request);
      if (!hasMemoryTransport(capabilities)) {
        return result(
          hostId,
          "memory",
          "unavailable",
          "local app host memory requires a local filesystem companion, MCP bridge, or file-bus import; none was advertised",
          {
            mode: request.mode,
            support_state: "unavailable",
            required_bridge: "guild-memory MCP, bridge package, or local filesystem companion",
          },
          resolveRung("semantic_tool", hostId)
        );
      }
      const receipt = queryGuildMemory({
        cwd: activeCwd(request),
        query: typeof request.payload === "object" && request.payload && typeof (request.payload as Record<string, unknown>)["query"] === "string"
          ? (request.payload as Record<string, unknown>)["query"] as string
          : "",
        capabilities,
      });
      return result(
        hostId,
        "memory",
        "degraded",
        "app host memory uses active .guild filesystem/BM25 through the local companion when available",
        {
          mode: request.mode,
          support_state: behavior.memoryMode,
          receipt,
        },
        resolveRung("semantic_tool", hostId)
      );
    },
  };
}

export { APP_HOSTS };
