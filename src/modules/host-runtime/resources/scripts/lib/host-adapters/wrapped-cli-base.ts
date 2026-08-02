/**
 * scripts/lib/host-adapters/wrapped-cli-base.ts
 *
 * verified-multi-host-support L2 — the SHARED wrapped-CLI adapter base for the four
 * new-CLI hosts (cursor / github-copilot / opencode / rovo-dev). ADR §4.2 mandates
 * ONE base, not four copy-pasted adapters: each new-CLI host is a thin instance of
 * `createWrappedCliAdapter({ hostId, label, ... })`, and every concern value is read
 * from that host's registry row (`HOST_REGISTRY_ROWS[hostId]`) — the adapter reads the
 * row, it never re-declares host facts (detection.bin/subcommand, capabilities, auth).
 *
 * The 5 existing bespoke adapters (claude/codex/pi/antigravity/agents-file) are NOT
 * refactored onto this base — the two patterns COEXIST (ADR §4.2, A-m3). IDE hosts
 * (kiro/qoder/trae) do NOT instantiate this base; they dereference the agents-file
 * adapter via `adapter_binding` in host-adapter-factory.ts (ADR §3.1).
 *
 * 11-concern coverage (ADR §4.1 crosswalk): the 10 host-adapter operations plus the
 * 11th guild-run wrapper / bin-bootstrap concern (AC-BOOT-1), surfaced via
 * `guildRunWiring()` and echoed into the bootstrap / preflight / renderPackage values.
 *
 * Owned by tooling-engineer (L2). Consumes L0 (ADR) + L1 (registry rows + factory
 * adapter_binding deref). Dual-mirrored under src/modules/host-runtime/resources/.
 */
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

/** Config for one thin wrapped-CLI instance. Host facts are READ from the registry row. */
export interface WrappedCliAdapterConfig {
  /** The canonical registry host id (its row supplies every concern value). */
  hostId: HostId;
  /** Human label for reason strings, e.g. "Cursor", "GitHub Copilot", "opencode". */
  label: string;
  /** Registry row override (defaults to HOST_REGISTRY_ROWS[hostId]). */
  entry?: HostRegistryEntry;
  /**
   * Model-param keys the host CLI can enforce natively (the rest are recorded as
   * unsupported, degrade-and-record). Defaults to ["model"] — the conservative floor
   * for an INFERRED off-box CLI until an operator box confirms richer flags.
   */
  supportedModelParamKeys?: string[];
}

/**
 * The 11th concern (AC-BOOT-1) — the guild-run wrapper / bin bootstrap. DISTINCT from
 * the adapter `bootstrap` operation (concern 10, which renders the bootstrap primitive
 * descriptor): this is the packaged `bin/guild-run` launcher + its wiring in the host
 * package and install.sh (`guild-run --host <h>`), the mechanism a host WITHOUT native
 * session hooks uses to inject run-start preflight + the using-guild gateway.
 * ADR §4.1 crosswalk row 11 → Surface 8 (Team visibility) + preflight injection.
 */
export interface GuildRunWiring {
  concern: "guild-run-wrapper";
  adr_surface: "Surface 8 (Team visibility) + preflight injection";
  /** The shipped executable launcher packaged into each host tree. */
  launcher: "bin/guild-run";
  /** How the host is launched through the wrapper. */
  invocation: string;
  /** The host bin + optional subcommand the wrapper forwards to (READ from detection). */
  bin: string | null;
  subcommand: string | null;
  /** Whether the wrapper injects bootstrap (READ from caps.bootstrap.wrapper_injection). */
  wrapper_injection: boolean;
  /** How install.sh renders the launcher into the host package. */
  install_wiring: string;
  /** What the wrapper injects for a host with no native session hooks. */
  preflight_injection: string;
}

/** Build the concern-11 guild-run wiring descriptor from a registry row (no host facts re-declared). */
export function guildRunWiring(entry: HostRegistryEntry): GuildRunWiring {
  const bin = entry.detection.bin;
  const subcommand = entry.detection.subcommand ?? null;
  return {
    concern: "guild-run-wrapper",
    adr_surface: "Surface 8 (Team visibility) + preflight injection",
    launcher: "bin/guild-run",
    invocation: `guild-run --host ${entry.host_id}`,
    bin,
    subcommand,
    wrapper_injection: entry.capabilities.bootstrap.wrapper_injection,
    install_wiring: `install.sh --hosts ${entry.host_id} renders bin/guild-run into the host package`,
    preflight_injection: "run-start preflight + using-guild gateway (no native session hooks)",
  };
}

function runtimeReceipts(host: HostId): Record<AdapterSurface, DegradationReceipt> {
  return {
    interaction: resolveRung("interaction", host),
    session: resolveRung("session", host),
    semantic_tool: resolveRung("semantic_tool", host),
    browser: resolveRung("browser", host),
  };
}

function makeResult<T>(
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

function activeGuildRoot(request: MemoryRequest): string {
  const payload = request.payload;
  if (payload && typeof payload === "object" && typeof (payload as Record<string, unknown>)["cwd"] === "string") {
    const cleaned = ((payload as Record<string, unknown>)["cwd"] as string).replace(/\/+$/, "");
    return cleaned === ".guild" || cleaned.endsWith("/.guild") ? cleaned : `${cleaned}/.guild`;
  }
  return ".guild";
}

/** Invocation parts read from detection: [bin] or [bin, subcommand] (e.g. ["gh","copilot"]). */
function invocationParts(entry: HostRegistryEntry): string[] {
  const bin = entry.detection.bin;
  if (!bin) return [];
  const subcommand = entry.detection.subcommand ?? null;
  return subcommand ? [bin, subcommand] : [bin];
}

/**
 * Build a concrete wrapped-CLI HostAdapter covering all 11 concerns from the registry
 * row. cursor / github-copilot / opencode / rovo-dev are thin instances of this.
 */
export function createWrappedCliAdapter(config: WrappedCliAdapterConfig): HostAdapter {
  const HOST_ID = config.hostId;
  const entry = config.entry ?? HOST_REGISTRY_ROWS[HOST_ID];
  const caps = entry.capabilities;
  const label = config.label;
  const supportedKeys = config.supportedModelParamKeys ?? ["model"];
  const parts = invocationParts(entry);
  const bin = entry.detection.bin;
  const subcommand = entry.detection.subcommand ?? null;
  const invoke = parts.join(" ");
  const wiring = guildRunWiring(entry);

  return {
    host: HOST_ID,
    hostId: HOST_ID,

    // Concern 9 — capability advertisement.
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

    // Concern 10 — session bootstrap primitive (+ concern 11 guild-run echoed in value).
    bootstrap(request?: BootstrapRequest): HostAdapterResult {
      const instructionFile = caps.bootstrap.context_injection === "instruction_file";
      return makeResult(
        HOST_ID,
        "bootstrap",
        instructionFile ? "ok" : "degraded",
        instructionFile
          ? `${label} bootstraps through AGENTS.md instruction-file injection plus the guild-run wrapper`
          : `${label} registry row does not enable instruction-file bootstrap`,
        {
          request: request ?? {},
          verified_by: `HOST_REGISTRY_ROWS[${HOST_ID}].capabilities.bootstrap`,
          registry_value: caps.bootstrap.context_injection,
          instruction_file: "AGENTS.md",
          skill_root: ".agents/skills/guild",
          wrapper_injection: caps.bootstrap.wrapper_injection,
          guild_run: wiring,
        },
        resolveRung("session", HOST_ID)
      );
    },

    // Concern 3 — hooks / preflight (no native hooks; guild-run/instruction-file fallback).
    preflight(request?: PreflightRequest): HostAdapterResult {
      return makeResult(
        HOST_ID,
        "preflight",
        "degraded",
        `${label} has no native Guild hooks; preflight is guild-run/instruction-file based and records the loss`,
        {
          request: request ?? {},
          native_hooks: false,
          binary_probe: subcommand ? `${bin} ${subcommand} --version` : `${bin ?? label} --version`,
          auth_probe: entry.detection.auth_probe,
          requires_auth: entry.detection.requires_auth,
          mcp: { stdio: caps.mcp.stdio, http: caps.mcp.http },
          fallback: {
            hooks: "guild-run/instruction-file",
            mcp: "filesystem-bm25",
            permissions: "coarse launch flags (no per-tool hook)",
          },
          guild_run: wiring,
        },
        resolveRung("session", HOST_ID)
      );
    },

    // Concern 4 — dispatch.
    dispatch(request: DispatchRequest): HostAdapterResult {
      const taskRun = taskRunRecord(request);
      const prompt = typeof taskRun["prompt"] === "string" ? (taskRun["prompt"] as string) : JSON.stringify(taskRun);
      const wrapperCommand = typeof taskRun["command"] === "string" ? (taskRun["command"] as string) : null;
      const wrapperArgs = Array.isArray(taskRun["args"]) ? (taskRun["args"] as unknown[]).map(String) : null;
      const wrapperEnv =
        taskRun["env"] && typeof taskRun["env"] === "object" ? (taskRun["env"] as Record<string, string>) : {};
      // opencode: a bare positional is a PROJECT PATH — `opencode "<prompt>"`
      // opens the interactive TUI (VERIFIED 2026-07-30, opencode 1.18.5,
      // issue #104); its non-interactive form is the `run` subcommand.
      const plainArgs =
        HOST_ID === "opencode"
          ? ["run", prompt]
          : [...(subcommand ? [subcommand] : []), prompt];
      return makeResult(
        HOST_ID,
        "dispatch",
        "ok",
        wrapperCommand
          ? `${label} dispatch receipt follows the guild-run wrapper launch plan`
          : `${label} dispatch runs ${invoke || bin || label} through a plain process with wrapper bootstrap when needed`,
        wrapperCommand
          ? { taskRun, dispatch_kind: "wrapper_launch", command: wrapperCommand, args: wrapperArgs ?? [], env: wrapperEnv }
          : { taskRun, dispatch_kind: "plain_process", command: bin ?? label, args: plainArgs, env: {} },
        resolveRung("session", HOST_ID)
      );
    },

    // Concern 5 — collect.
    collect(request?: CollectRequest): HostAdapterResult {
      return makeResult(
        HOST_ID,
        "collect",
        "ok",
        `${label} collection reads .guild run + file-bus artifacts emitted by the wrapper`,
        {
          request: request ?? {},
          artifact_roots: [".guild/runs", ".guild/context", ".guild/runs/<run-id>/agent-bus"],
        },
        resolveRung("session", HOST_ID)
      );
    },

    // Concern 2 — command surface.
    renderCommandSurface(request?: RenderCommandSurfaceRequest): HostAdapterResult {
      return makeResult(
        HOST_ID,
        "renderCommandSurface",
        "degraded",
        `${label} has no native slash-command surface; Guild commands are invoked via ${invoke || bin || label} and documented in AGENTS.md`,
        {
          request: request ?? {},
          slash_commands: caps.commands.slash_commands,
          command_files: caps.commands.command_files,
          invoke: invoke || null,
          native_slash_commands: false,
          guild_run_invocation: wiring.invocation,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    // Concern 1 — packaging (+ concern 11 guild-run echoed in value).
    renderPackage(request?: RenderPackageRequest): HostAdapterResult {
      return makeResult(
        HOST_ID,
        "renderPackage",
        "degraded",
        `${label} package target renders the instruction file + .agents skill tree + guild-run launcher; live install is target-level`,
        {
          request: request ?? {},
          manifest_format: caps.package.manifest_format,
          agents_md_path: "AGENTS.md",
          agents_skill_root: ".agents/skills/guild",
          launcher: "bin/guild-run",
          guild_run: wiring,
          installability: entry.installability,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    // Concern 6 — permissions.
    renderPermissionDecision(request: RenderPermissionDecisionRequest): HostAdapterResult {
      return makeResult(
        HOST_ID,
        "renderPermissionDecision",
        "degraded",
        `${label} has no per-tool Guild permission hook; approval maps to coarse launch flags recorded as degraded policy receipts`,
        {
          decision: request.decision,
          native_deny: caps.permissions.deny,
          native_ask: caps.permissions.ask,
          permission_prompt_layer: caps.permissions.permission_prompt_layer,
          launch_modes: caps.permissions.launch_modes,
          native_prompt_layer: false,
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    // Concern 7 — model tiers.
    resolveModelParams(request: ResolveModelParamsRequest): HostAdapterResult<Record<string, unknown>> {
      const configured = configuredModelParams(request);
      const registryModel = caps.models[request.tier]?.model ?? null;
      const model = typeof configured["model"] === "string" ? configured["model"] : registryModel;
      if (!model) {
        return makeResult(
          HOST_ID,
          "resolveModelParams",
          "degraded",
          `${label} model params unavailable: no model configured for ${request.tier} (INFERRED off-box row)`,
          { modelParams: null, unsupported_model_params: [] },
          resolveRung("semantic_tool", HOST_ID)
        );
      }
      const modelParams = { ...configured, model };
      const unsupported = unsupportedModelParamKeys(modelParams, supportedKeys);
      const argv = ["--model", String(model)];
      return makeResult(
        HOST_ID,
        "resolveModelParams",
        unsupported.length > 0 ? "degraded" : "ok",
        unsupported.length > 0
          ? `${label} maps model, but cannot enforce unsupported model param key(s): ${unsupported.join(", ")}`
          : `${label} maps model params to --model`,
        { modelParams, argv, unsupported_model_params: unsupported },
        resolveRung("semantic_tool", HOST_ID)
      );
    },

    // Concern 8 — MCP / memory.
    memory(request: MemoryRequest): HostAdapterResult {
      return makeResult(
        HOST_ID,
        "memory",
        "degraded",
        `${label} uses filesystem/BM25 Guild memory through the active .guild root until native MCP memory is available`,
        {
          mode: request.mode,
          active_guild_root: activeGuildRoot(request),
          primary: { transport: "filesystem-bm25", status: "degraded", root: ".guild" },
          mcp: { stdio: caps.mcp.stdio, http: caps.mcp.http },
        },
        resolveRung("semantic_tool", HOST_ID)
      );
    },
  };
}
