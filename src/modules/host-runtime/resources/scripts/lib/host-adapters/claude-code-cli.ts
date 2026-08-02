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
import { HOST_REGISTRY_ROWS, type HostId, type HostRegistryEntry } from "../host-registry-schema";
import {
  resolveRung,
  type AdapterSurface,
  type DegradationReceipt,
} from "../adapter-fallback-ladders";
import { ClaudePaneAdapter } from "../pane-adapter";

const HOST_ID: HostId = "claude-code-cli";
const ENTRY = HOST_REGISTRY_ROWS[HOST_ID];

function runtimeReceipts(): Record<AdapterSurface, DegradationReceipt> {
  return {
    interaction: resolveRung("interaction", HOST_ID),
    session: resolveRung("session", HOST_ID),
    semantic_tool: resolveRung("semantic_tool", HOST_ID),
    browser: resolveRung("browser", HOST_ID),
  };
}

function receipt(
  operation: HostAdapterOperation,
  status: HostAdapterReceipt["status"],
  reason: string,
  degradationReceipt?: DegradationReceipt
): HostAdapterReceipt {
  return {
    schema_version: "guild.host_adapter_receipt.v1",
    host: HOST_ID,
    operation,
    status,
    reason,
    ...(degradationReceipt ? { degradation_receipt: degradationReceipt } : {}),
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
    receipt: receipt(operation, status, reason, degradationReceipt),
  };
}

function activeGuildRoot(request: MemoryRequest): string {
  const payload = request.payload;
  const root =
    payload && typeof payload === "object" && typeof (payload as Record<string, unknown>)["activeRoot"] === "string"
      ? ((payload as Record<string, unknown>)["activeRoot"] as string)
      : payload && typeof payload === "object" && typeof (payload as Record<string, unknown>)["cwd"] === "string"
        ? ((payload as Record<string, unknown>)["cwd"] as string)
        : ".";
  const cleaned = root.replace(/\/+$/, "");
  return cleaned === ".guild" || cleaned.endsWith("/.guild") ? cleaned : `${cleaned}/.guild`;
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

export function createClaudeCodeCliAdapter(entry: HostRegistryEntry = ENTRY): HostAdapter {
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
        runtime_surfaces: runtimeReceipts(),
        unavailable_operations: [],
      };
    },

    bootstrap(request?: BootstrapRequest): HostAdapterResult {
      const contextInjection = entry.capabilities.bootstrap.context_injection;
      return result(
        "bootstrap",
        contextInjection ? "ok" : "degraded",
        contextInjection
          ? "Claude Code SessionStart bootstrap is registry-verified and injects using-guild context"
          : "Claude Code SessionStart bootstrap registry row lacks native context injection",
        {
          request: request ?? {},
          verified_by: "HOST_REGISTRY_ROWS[claude-code-cli].capabilities.bootstrap.context_injection",
          registry_value: contextInjection,
          context_injection: "hookSpecificOutput.additionalContext",
          hook_event: "SessionStart",
          using_guild_source: "skills/meta/using-guild/SKILL.src.md",
          hook_command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/dist/using-guild-bootstrap.js"',
          wrapper_injection: true,
        },
        resolveRung("interaction", HOST_ID)
      );
    },

    preflight(request?: PreflightRequest): HostAdapterResult {
      const sessionStartEnabled = entry.capabilities.hooks.session_start;
      return result(
        "preflight",
        sessionStartEnabled ? "ok" : "degraded",
        sessionStartEnabled
          ? "Claude Code hook preflight is registry-verified and includes using-guild SessionStart injection"
          : "Claude Code hook preflight registry row does not enable SessionStart injection",
        {
          request: request ?? {},
          verified_by: "HOST_REGISTRY_ROWS[claude-code-cli].capabilities.hooks",
          session_start_registry_value: sessionStartEnabled,
          hook_file: "hooks/hooks.json",
          native_events: Object.entries(entry.capabilities.hooks)
            .filter(([, enabled]) => enabled)
            .map(([event]) => event),
          session_start_commands: sessionStartEnabled
            ? [
                'bash "${CLAUDE_PLUGIN_ROOT}/hooks/bootstrap.sh"',
                'node "${CLAUDE_PLUGIN_ROOT}/hooks/dist/detect-guild-version.js"',
                'node "${CLAUDE_PLUGIN_ROOT}/hooks/dist/using-guild-bootstrap.js"',
              ]
            : [],
        },
        resolveRung("session", HOST_ID)
      );
    },

    dispatch(request: DispatchRequest): HostAdapterResult {
      const taskRun = taskRunRecord(request);
      const pane = new ClaudePaneAdapter();
      const prompt = typeof taskRun["prompt"] === "string" ? (taskRun["prompt"] as string) : JSON.stringify(taskRun);
      const runId = typeof taskRun["runId"] === "string" ? (taskRun["runId"] as string) : "run";
      const taskId = typeof taskRun["taskId"] === "string" ? (taskRun["taskId"] as string) : undefined;
      const specialist = typeof taskRun["specialist"] === "string" ? (taskRun["specialist"] as string) : undefined;
      const wrapperCommand = typeof taskRun["command"] === "string" ? (taskRun["command"] as string) : null;
      const wrapperArgs = Array.isArray(taskRun["args"]) ? (taskRun["args"] as unknown[]).map(String) : null;
      const wrapperEnv =
        taskRun["env"] && typeof taskRun["env"] === "object"
          ? (taskRun["env"] as Record<string, string>)
          : null;
      const paneSpec = {
        name: specialist ?? "claude",
        scope: typeof taskRun["scope"] === "string" ? (taskRun["scope"] as string) : "guild task",
        runId,
        slug: typeof taskRun["slug"] === "string" ? (taskRun["slug"] as string) : "guild-task",
        prompt,
        hostKind: "claude" as const,
        ...(taskId ? { taskId } : {}),
        ...(specialist ? { specialist } : {}),
      };
      return result(
        "dispatch",
        "ok",
        wrapperCommand
          ? "Claude dispatch receipt follows the wrapper launch plan and keeps pane dispatch as an alternate host surface"
          : "Claude dispatch uses the existing Claude pane/reference command builder",
        wrapperCommand
          ? {
              taskRun,
              dispatch_kind: "wrapper_launch",
              command: wrapperCommand,
              args: wrapperArgs ?? [],
              env: wrapperEnv ?? {},
              alternate_pane_command: pane.command(paneSpec),
              alternate_pane_env: pane.env(paneSpec),
            }
          : { taskRun, dispatch_kind: "pane", command: pane.command(paneSpec), env: pane.env(paneSpec) },
        resolveRung("session", HOST_ID)
      );
    },

    collect(request?: CollectRequest): HostAdapterResult {
      return result(
        "collect",
        "ok",
        "Claude collection reads existing .guild run artifacts and hook/team receipts",
        { request: request ?? {}, artifact_roots: [".guild/runs", ".guild/context", ".guild/team"] },
        resolveRung("session", HOST_ID)
      );
    },

    renderCommandSurface(request?: RenderCommandSurfaceRequest): HostAdapterResult {
      return result(
        "renderCommandSurface",
        "ok",
        "Claude Code exposes Guild commands as native markdown slash-command files",
        {
          request: request ?? {},
          slash_commands: true,
          command_files: "markdown",
          command_root: "commands/",
          namespace: "/guild:*",
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    renderPackage(request?: RenderPackageRequest): HostAdapterResult {
      return result(
        "renderPackage",
        "ok",
        "Claude Code has the verified native .claude-plugin package shape",
        {
          request: request ?? {},
          manifest_path: ".claude-plugin/plugin.json",
          hooks_path: "hooks/hooks.json",
          mcp_path: ".mcp.json",
          agents_md_path: "AGENTS.md",
          claude_md_path: "CLAUDE.md",
          claude_md_import: "@AGENTS.md",
          installability: entry.installability,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    renderPermissionDecision(request: RenderPermissionDecisionRequest): HostAdapterResult {
      return result(
        "renderPermissionDecision",
        "ok",
        "Claude Code supports deny/ask/allow through PreToolUse and permission-mode launch flags",
        {
          decision: request.decision,
          prompt_layer: "PreToolUse",
          native_deny: entry.capabilities.permissions.deny,
          native_ask: entry.capabilities.permissions.ask,
          launch_modes: entry.capabilities.permissions.launch_modes,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    resolveModelParams(request: ResolveModelParamsRequest): HostAdapterResult<Record<string, unknown>> {
      const configured = configuredModelParams(request);
      const registryModel = entry.capabilities.models[request.tier]?.model ?? null;
      const model = typeof configured["model"] === "string" ? configured["model"] : registryModel;
      if (!model) {
        return result(
          "resolveModelParams",
          "degraded",
          `Claude model params unavailable: no model configured for ${request.tier}`,
          { modelParams: null, unsupported_model_params: [] },
          resolveRung("semantic_tool", HOST_ID)
        );
      }
      const modelParams: Record<string, unknown> = { ...configured, model };
      const unsupported = unsupportedModelParamKeys(modelParams, ["model", "effort"]);
      const argv = [
        "--model",
        String(model),
        ...(typeof modelParams["effort"] === "string" ? ["--effort", modelParams["effort"] as string] : []),
      ];
      return result(
        "resolveModelParams",
        unsupported.length > 0 ? "degraded" : "ok",
        unsupported.length > 0
          ? `Claude CLI maps model/effort, but cannot enforce unsupported model param key(s): ${unsupported.join(", ")}`
          : "Claude CLI maps model params to native --model/--effort flags",
        { modelParams, argv, unsupported_model_params: unsupported },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    memory(request: MemoryRequest): HostAdapterResult {
      const fallbackReceipt = resolveRung("semantic_tool", HOST_ID);
      return result(
        "memory",
        entry.capabilities.mcp.stdio ? "ok" : "degraded",
        entry.capabilities.mcp.stdio
          ? "Claude memory registry enables native stdio MCP first and records filesystem/BM25 fallback degradation"
          : "Claude memory registry does not enable native stdio MCP; filesystem/BM25 fallback is recorded",
        {
          mode: request.mode,
          active_guild_root: activeGuildRoot(request),
          primary: {
            transport: "mcp-stdio",
            server: "guild-memory",
            status: entry.capabilities.mcp.stdio ? "registry_verified" : "unavailable",
            path: ".mcp.json",
            registry_value: entry.capabilities.mcp.stdio,
            verified_by: "HOST_REGISTRY_ROWS[claude-code-cli].capabilities.mcp.stdio",
          },
          fallback: {
            transport: "filesystem-bm25",
            status: "degraded",
            reason: "used only when native MCP is unavailable or policy disables MCP",
            degradation_receipt: fallbackReceipt,
          },
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },
  };
}
