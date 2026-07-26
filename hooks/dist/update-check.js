var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../src/modules/host-runtime/workflows/host-capabilities-schema.ts
var UPDATE_COMMANDS, CLAUDE_CAPABILITIES, CODEX_CAPABILITIES, NO_HOOKS, AGENTS_FILE_CAPABILITIES;
var init_host_capabilities_schema = __esm({
  "../src/modules/host-runtime/workflows/host-capabilities-schema.ts"() {
    UPDATE_COMMANDS = {
      marketplace_cli: "claude plugin marketplace update guild && claude plugin update guild@guild",
      self_update: "guild-run update",
      reinstall_command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update"
    };
    CLAUDE_CAPABILITIES = {
      schema_version: "guild.host_capabilities.v1",
      host_kind: "claude",
      family: "claude",
      surface_kind: "cli",
      package: {
        installable: true,
        installability: "verified",
        manifest_format: "claude-plugin",
        update: { check: "marketplace_clone", apply: "marketplace_cli", command: UPDATE_COMMANDS.marketplace_cli, auto_capable: true }
      },
      bootstrap: {
        context_injection: "hookSpecificOutput.additionalContext",
        skill_autoload: true,
        prompt_transform: false,
        wrapper_injection: true
      },
      commands: { slash_commands: true, command_files: "markdown" },
      skills: { native_skills: true, skill_dir: ".claude/skills" },
      agents: { native_agents: true, agent_format: "claude-md" },
      hooks: {
        // All ten events are bound in the live hooks/hooks.json (verified).
        session_start: true,
        user_prompt_submit: true,
        pre_tool_use: true,
        post_tool_use: true,
        stop: true,
        pre_compact: true,
        subagent_stop: true,
        task_created: true,
        task_completed: true,
        teammate_idle: true
      },
      permissions: {
        deny: true,
        ask: true,
        ask_mode: "pre_tool_use",
        accept_edits_without_prompt: true,
        auto_approve_tools: true,
        bypass_prompts: true,
        bypass_sandbox: false,
        permission_prompt_layer: true,
        launch_modes: {
          read_only: ["--tools", "Read,Grep,Glob"],
          ask: ["--permission-mode", "default"],
          accept_edits: ["--permission-mode", "acceptEdits"],
          auto: ["--permission-mode", "auto"],
          bypass_all: ["--permission-mode", "bypassPermissions"]
        }
      },
      dispatch: {
        tmux_processes: true,
        plain_processes: true,
        independent_agents: true,
        subagents: true,
        inline: true
      },
      interaction: {
        native_questions: true,
        terminal_prompt: true,
        file_bus_questions: true
      },
      sessions: { continue: true, resume_by_id: true, fork: true },
      structured_output: {
        native_json: true,
        schema_validation: true,
        repair_prompt: true
      },
      artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
      tools: {
        read: "native",
        search: "native",
        shell: "native",
        edit: "native",
        write: "native",
        browser: "bridge",
        web: "native",
        mcp: "native"
      },
      mcp: { stdio: true, http: false },
      models: {
        cheap: { model: "haiku" },
        mid: { model: "sonnet" },
        powerful: { model: "opus" }
      }
    };
    CODEX_CAPABILITIES = {
      schema_version: "guild.host_capabilities.v1",
      host_kind: "codex",
      family: "codex",
      surface_kind: "cli",
      // installable:false is the honest MACHINE state — the Codex renderer exists but
      // per-host-packaging.ts marks it DORMANT; a non-Claude render must not be treated
      // as installable until proven. installability:"target" records that the renderer
      // exists; both flip to verified/true at SC-3 (real Codex install + bootstrap).
      package: {
        installable: false,
        installability: "target",
        manifest_format: "codex-plugin",
        update: { check: "receipt", apply: "self_update", command: UPDATE_COMMANDS.self_update, auto_capable: false }
      },
      bootstrap: {
        // Codex has no hookSpecificOutput injection; bootstrap rides an instruction
        // file (AGENTS.md) / the generated wrapper (ADR P0: Codex "plugin-or-skill").
        context_injection: "instruction_file",
        skill_autoload: false,
        // Verified: Codex has no native skill dir (per-host-packaging flags skills unsupported).
        prompt_transform: false,
        // INFERRED
        wrapper_injection: true
        // The generated guild-run wrapper injects bootstrap.
      },
      commands: {
        // Verified: Codex has no .md slash-command format; commands render as workflow descriptors.
        slash_commands: false,
        command_files: "none"
      },
      skills: { native_skills: false, skill_dir: null },
      // Verified (per-host-packaging).
      agents: { native_agents: false, agent_format: null },
      // Verified (per-host-packaging flags agents unsupported).
      hooks: {
        // Verified-by-design: Codex hook taxonomy differs from Claude; no native
        // Claude-equivalent hooks. All degrade through the HookEmitter (ADR Surface 3).
        session_start: false,
        user_prompt_submit: false,
        pre_tool_use: false,
        post_tool_use: false,
        stop: false,
        pre_compact: false,
        subagent_stop: false,
        task_created: false,
        task_completed: false,
        teammate_idle: false
      },
      permissions: {
        // INFERRED (Codex CLI approval model). Confirm on-box at L3.
        deny: false,
        ask: true,
        // Codex prompts for approval by default.
        ask_mode: null,
        // No pre_tool_use layer; approval is interactive.
        accept_edits_without_prompt: false,
        // INFERRED
        auto_approve_tools: false,
        // INFERRED
        bypass_prompts: true,
        // Codex YOLO / --dangerously-bypass exists (AC19).
        bypass_sandbox: true,
        // INFERRED — YOLO bypasses the sandbox.
        permission_prompt_layer: false,
        // INFERRED
        launch_modes: {
          // INFERRED — only bypass_all has a well-known Codex flag today. ask/auto/
          // accept_edits/read_only recipes are confirmed at L3; OMITTED here rather
          // than guessed, so their absence reads as "degrade/record", not "supported".
          bypass_all: ["--dangerously-bypass-approvals-and-sandbox"]
          // INFERRED flag name — verify on-box (AC19).
        }
      },
      dispatch: {
        tmux_processes: true,
        // Codex is a CLI process — tmux panes work.
        plain_processes: true,
        independent_agents: false,
        // INFERRED — no native agent-team primitive.
        subagents: false,
        // INFERRED
        inline: true
      },
      interaction: {
        native_questions: false,
        // INFERRED — no AskUserQuestion equivalent; use terminal/file-bus.
        terminal_prompt: true,
        file_bus_questions: true
        // Guild file-bus approval works on any FS host.
      },
      sessions: {
        continue: true,
        // INFERRED — Codex has session continuation.
        resume_by_id: true,
        // INFERRED
        fork: false
        // INFERRED
      },
      structured_output: {
        native_json: false,
        // INFERRED — no guaranteed native JSON mode; use fenced-block + repair.
        schema_validation: false,
        // Guild-side validation (validateHandoffV2) instead.
        repair_prompt: true
        // Bounded repair prompt is the fallback (ADR §Result contracts).
      },
      artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
      tools: {
        read: "native",
        search: "native",
        shell: "native",
        edit: "native",
        write: "native",
        browser: "none",
        // INFERRED — no native browser; record fallback (AC29).
        web: "emulated",
        // INFERRED
        mcp: "native"
        // Codex supports stdio MCP.
      },
      mcp: { stdio: true, http: false },
      // Verified: Codex supports stdio MCP only (per-host-packaging flags HTTP unsupported).
      models: {
        // Codex model ids are host-specific and not pinned in this repo yet; null =
        // "no Guild-mapped model at this tier" (settings models.tiers.codex is null today).
        cheap: { model: null },
        mid: { model: null },
        powerful: { model: null }
      }
    };
    NO_HOOKS = {
      session_start: false,
      user_prompt_submit: false,
      pre_tool_use: false,
      post_tool_use: false,
      stop: false,
      pre_compact: false,
      subagent_stop: false,
      task_created: false,
      task_completed: false,
      teammate_idle: false
    };
    AGENTS_FILE_CAPABILITIES = {
      schema_version: "guild.host_capabilities.v1",
      host_kind: "agents-file",
      family: "agents",
      surface_kind: "file",
      package: {
        installable: false,
        installability: "target",
        manifest_format: "agents-file",
        update: { check: "receipt", apply: "reinstall_command", command: UPDATE_COMMANDS.reinstall_command, auto_capable: false }
      },
      bootstrap: {
        context_injection: "instruction_file",
        skill_autoload: false,
        prompt_transform: false,
        wrapper_injection: true
      },
      commands: { slash_commands: false, command_files: "none" },
      skills: { native_skills: false, skill_dir: ".agents/skills/guild" },
      agents: { native_agents: false, agent_format: null },
      hooks: NO_HOOKS,
      permissions: {
        deny: false,
        ask: true,
        ask_mode: null,
        accept_edits_without_prompt: false,
        auto_approve_tools: false,
        bypass_prompts: false,
        bypass_sandbox: false,
        permission_prompt_layer: false,
        launch_modes: {}
      },
      dispatch: {
        tmux_processes: false,
        plain_processes: false,
        independent_agents: false,
        subagents: false,
        inline: false
      },
      interaction: {
        native_questions: false,
        terminal_prompt: false,
        file_bus_questions: true
      },
      sessions: { continue: false, resume_by_id: false, fork: false },
      structured_output: {
        native_json: false,
        schema_validation: false,
        repair_prompt: true
      },
      artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
      tools: {
        read: "native",
        search: "native",
        shell: "native",
        edit: "native",
        write: "native",
        browser: "none",
        web: "emulated",
        mcp: "none"
      },
      mcp: { stdio: false, http: false },
      models: {
        cheap: { model: null },
        mid: { model: null },
        powerful: { model: null }
      }
    };
  }
});

// ../src/modules/host-runtime/workflows/host-registry-schema.ts
function inferredCaps(host_kind, family, surface_kind = "cli") {
  return {
    schema_version: "guild.host_capabilities.v1",
    host_kind,
    family,
    // Must equal the registry entry's top-level surface_kind (cross-field invariant,
    // enforced by validateHostRegistryEntry). `.agents` is a file surface, not cli.
    surface_kind,
    package: {
      installable: false,
      installability: "target",
      manifest_format: `${host_kind}-package`,
      // AC-7 by surface: cli = Guild-owned wrapper packages → guild-run
      // self-update; file = AGENTS-file packages → reinstall command (notify +
      // one command, no daemon); app = refused install surfaces → no check, no
      // apply (degrades to notify-only prose; the recorded loss IS this row).
      update: surface_kind === "cli" ? { check: "receipt", apply: "self_update", command: UPDATE_COMMANDS.self_update, auto_capable: false } : surface_kind === "file" ? { check: "receipt", apply: "reinstall_command", command: UPDATE_COMMANDS.reinstall_command, auto_capable: false } : { check: "none", apply: "none", command: null, auto_capable: false }
    },
    bootstrap: {
      context_injection: "instruction_file",
      skill_autoload: false,
      prompt_transform: false,
      wrapper_injection: true
    },
    commands: { slash_commands: false, command_files: "none" },
    skills: { native_skills: false, skill_dir: null },
    agents: { native_agents: false, agent_format: null },
    hooks: {
      session_start: false,
      user_prompt_submit: false,
      pre_tool_use: false,
      post_tool_use: false,
      stop: false,
      pre_compact: false,
      subagent_stop: false,
      task_created: false,
      task_completed: false,
      teammate_idle: false
    },
    permissions: {
      deny: false,
      ask: true,
      ask_mode: null,
      accept_edits_without_prompt: false,
      auto_approve_tools: false,
      bypass_prompts: false,
      bypass_sandbox: false,
      permission_prompt_layer: false,
      launch_modes: {}
    },
    dispatch: {
      tmux_processes: true,
      plain_processes: true,
      independent_agents: false,
      subagents: false,
      inline: true
    },
    interaction: { native_questions: false, terminal_prompt: true, file_bus_questions: true },
    sessions: { continue: false, resume_by_id: false, fork: false },
    structured_output: { native_json: false, schema_validation: false, repair_prompt: true },
    artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
    tools: {
      read: "native",
      search: "native",
      shell: "native",
      edit: "native",
      write: "native",
      browser: "none",
      web: "emulated",
      mcp: "none"
    },
    mcp: { stdio: false, http: false },
    models: { cheap: { model: null }, mid: { model: null }, powerful: { model: null } }
  };
}
var HOST_IDS, HOST_FAMILIES, AUTH_PROBES, CLAUDE_ENTRY, CODEX_ENTRY, AGENTS_FILE_ENTRY, PI_ENTRY, ANTIGRAVITY_ENTRY, CLAUDE_APP_ENTRY, CLAUDE_WEB_ENTRY, CODEX_APP_ENTRY, CLAUDE_AI_CONNECTOR_ENTRY, CURSOR_ENTRY, GITHUB_COPILOT_ENTRY, OPENCODE_ENTRY, ROVO_DEV_ENTRY, KIRO_ENTRY, QODER_ENTRY, TRAE_ENTRY, HOST_REGISTRY_ROWS, HOST_ID_SET, FAMILY_SET, AUTH_PROBE_SET;
var init_host_registry_schema = __esm({
  "../src/modules/host-runtime/workflows/host-registry-schema.ts"() {
    init_host_capabilities_schema();
    HOST_IDS = [
      // keep CLI/file (5)
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity-cli",
      "agents-file",
      // keep-as-refuse (4) — RETAINED verbatim
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
      // new CLI-with-binary (4) — verified_multi_host L0 ADR §2.1
      "cursor",
      "github-copilot",
      "opencode",
      "rovo-dev",
      // new IDE-embedded (3) — bind the universal agents-file adapter (adapter_binding: "agents-file").
      // `trae-cn` is NOT distinct — it folds into `trae` (L0 ADR §9). host id set = 16.
      "kiro",
      "qoder",
      "trae"
    ];
    HOST_FAMILIES = [
      "claude",
      "codex",
      "agents",
      "pi",
      "antigravity",
      "cursor",
      "copilot",
      "opencode",
      "rovo"
    ];
    AUTH_PROBES = [
      "codex_stored_or_env",
      "none",
      "cursor_stored",
      "gh_auth",
      "opencode_stored_or_env",
      "acli_stored"
    ];
    CLAUDE_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "claude-code-cli",
      family: "claude",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "claude", requires_auth: false, auth_probe: "none" },
      installability: "native",
      result_adapter: false,
      // Claude is the reference author host, not a cross reviewer for itself.
      dispatch_selectable: true,
      capabilities: CLAUDE_CAPABILITIES,
      provenance: "verified"
    };
    CODEX_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "codex-cli",
      family: "codex",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "codex", requires_auth: true, auth_probe: "codex_stored_or_env" },
      // installability:"target" mirrors the P0 capability row (renderer exists, install unproven).
      installability: "target",
      result_adapter: true,
      // The only selectable cross reviewer today (provider-detect codex-plugin/codex-cli).
      dispatch_selectable: true,
      capabilities: CODEX_CAPABILITIES,
      provenance: "verified"
      // columns verified from plugin facts; the embedded caps row carries its own INFERRED notes.
    };
    AGENTS_FILE_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "agents-file",
      family: "agents",
      // "self": agents-file is the universal AGENTS.md adapter/renderer ITSELF (the IDE rows
      // dereference it via adapter_binding: "agents-file"; this row is the target of that binding).
      adapter_binding: "self",
      // `agents-file` is the universal AGENTS.md package target — a FILE surface, not a CLI.
      surface_kind: "file",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "target",
      result_adapter: false,
      // INFERRED — no cross-review adapter; verify at live-host availability.
      dispatch_selectable: true,
      // INFERRED — a host consuming AGENTS.md can run a lane.
      capabilities: AGENTS_FILE_CAPABILITIES,
      // file surface — matches top-level surface_kind.
      provenance: "inferred"
    };
    PI_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "pi-cli",
      family: "pi",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "pi", requires_auth: false, auth_probe: "none" },
      // VERIFIED on-host 2026-06-16: `pi` 0.79.3 at /opt/homebrew/bin/pi.
      installability: "target",
      // VERIFIED-as-target: CLI present; Guild-package install into pi unproven.
      result_adapter: false,
      // VERIFIED: no Guild cross-review adapter ships for pi (detect-only, provider-detect.ts:206).
      dispatch_selectable: true,
      // VERIFIED: pi is a CLI process a lane can run on.
      capabilities: {
        ...inferredCaps("pi-cli", "pi"),
        // VERIFIED on-host (pi --help, 0.79.3):
        sessions: { continue: true, resume_by_id: true, fork: true },
        // --continue/-c, --resume/-r + --session-id, --fork
        structured_output: { native_json: true, schema_validation: false, repair_prompt: true },
        // --mode json
        permissions: {
          ...inferredCaps("pi-cli", "pi").permissions,
          // G4b: carries forward the Phase-1 hand-authored host-capabilities-schema.ts
          // PI_CAPABILITIES.permissions.deny value (a field the inferredCaps() default
          // left false) — pi's --tools allowlist lets an invocation deny specific tools,
          // so `deny:true` is the correct capability. Recorded here (not just in the
          // now-superseded PI_CAPABILITIES row) so the registry stays the single source.
          deny: true
        }
      },
      provenance: "verified"
      // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
    };
    ANTIGRAVITY_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "antigravity-cli",
      family: "antigravity",
      adapter_binding: "self",
      surface_kind: "cli",
      // VERIFIED on-host 2026-06-16: the CLI is `agy` 1.0.8 (~/.local/bin/agy) — NOT `antigravity`. Detection bin corrected.
      detection: { bin: "agy", requires_auth: false, auth_probe: "none" },
      installability: "target",
      // VERIFIED-as-target: CLI present; Guild-package install unproven.
      result_adapter: false,
      // VERIFIED: no Guild cross-review adapter ships for antigravity (detect-only, provider-detect.ts:207).
      dispatch_selectable: true,
      // VERIFIED: agy is a CLI process a lane can run on.
      capabilities: {
        ...inferredCaps("antigravity-cli", "antigravity"),
        // VERIFIED on-host (agy --help, 1.0.8):
        sessions: { continue: true, resume_by_id: true, fork: false },
        // --continue/-c, --conversation <id>; no fork flag
        permissions: {
          ...inferredCaps("antigravity-cli", "antigravity").permissions,
          bypass_prompts: true,
          // --dangerously-skip-permissions auto-approves all tool-permission prompts (agy also has a separate --sandbox restrict toggle)
          launch_modes: { bypass_all: ["--dangerously-skip-permissions"] },
          // G4b: carries forward two Phase-1 hand-authored host-capabilities-schema.ts
          // ANTIGRAVITY_CAPABILITIES fields the inferredCaps() default did not set —
          // `deny` (agy can refuse a tool) and `bypass_sandbox` (the same
          // --dangerously-skip-permissions flag that sets bypass_prompts above also lifts
          // the sandbox restriction agy's separate --sandbox toggle would otherwise apply).
          // Recorded here so the registry — not a second hand-authored row — is the one
          // source of truth (closes the "two diverged capability truths" audit finding).
          deny: true,
          bypass_sandbox: true
        }
      },
      provenance: "verified"
      // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
    };
    CLAUDE_APP_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "claude-code-app",
      family: "claude",
      adapter_binding: "self",
      surface_kind: "app",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "none",
      result_adapter: false,
      dispatch_selectable: false,
      capabilities: inferredCaps("claude-code-app", "claude", "app"),
      provenance: "inferred"
    };
    CLAUDE_WEB_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "claude-code-web",
      family: "claude",
      adapter_binding: "self",
      surface_kind: "app",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "none",
      result_adapter: false,
      dispatch_selectable: false,
      capabilities: inferredCaps("claude-code-web", "claude", "app"),
      provenance: "inferred"
    };
    CODEX_APP_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "codex-app",
      family: "codex",
      adapter_binding: "self",
      surface_kind: "app",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "none",
      result_adapter: false,
      dispatch_selectable: false,
      capabilities: inferredCaps("codex-app", "codex", "app"),
      provenance: "inferred"
    };
    CLAUDE_AI_CONNECTOR_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "claude-ai-connector",
      family: "claude",
      adapter_binding: "self",
      surface_kind: "app",
      detection: { bin: null, requires_auth: false, auth_probe: "none" },
      installability: "none",
      result_adapter: false,
      dispatch_selectable: false,
      capabilities: inferredCaps("claude-ai-connector", "claude", "app"),
      provenance: "inferred"
    };
    CURSOR_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "cursor",
      family: "cursor",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "cursor-agent", requires_auth: true, auth_probe: "cursor_stored", subcommand: null, marker: null },
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      capabilities: inferredCaps("cursor", "cursor", "cli"),
      provenance: "inferred"
    };
    GITHUB_COPILOT_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "github-copilot",
      family: "copilot",
      adapter_binding: "self",
      surface_kind: "cli",
      // capability is a subcommand of the shared `gh` bin (`gh copilot`).
      detection: { bin: "gh", requires_auth: true, auth_probe: "gh_auth", subcommand: "copilot", marker: null },
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      capabilities: inferredCaps("github-copilot", "copilot", "cli"),
      provenance: "inferred"
    };
    OPENCODE_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "opencode",
      family: "opencode",
      adapter_binding: "self",
      surface_kind: "cli",
      detection: { bin: "opencode", requires_auth: true, auth_probe: "opencode_stored_or_env", subcommand: null, marker: null },
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      capabilities: inferredCaps("opencode", "opencode", "cli"),
      provenance: "inferred"
    };
    ROVO_DEV_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "rovo-dev",
      family: "rovo",
      adapter_binding: "self",
      surface_kind: "cli",
      // capability is a subcommand of the shared `acli` bin (`acli rovodev`).
      detection: { bin: "acli", requires_auth: true, auth_probe: "acli_stored", subcommand: "rovodev", marker: null },
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      capabilities: inferredCaps("rovo-dev", "rovo", "cli"),
      provenance: "inferred"
    };
    KIRO_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "kiro",
      family: "agents",
      adapter_binding: "agents-file",
      surface_kind: "file",
      detection: {
        bin: null,
        requires_auth: false,
        auth_probe: "none",
        subcommand: null,
        marker: { config_dir: ".kiro", scope: "project", agents_placement: "AGENTS.md" }
      },
      installability: "target",
      result_adapter: false,
      // G4b (host-reachability audit): FLIPPED from true — an agents-file surface is a
      // FILE the host reads (root AGENTS.md), never a pane a lane can be dispatched into.
      // `dispatch_selectable:true` was a lie: no HostKind member, no PaneAdapter, no
      // legacy hand-authored HOST_CAPABILITY_ROWS row ever backed it (confirmed
      // unreachable through EVERY dispatch surface; the registry-DERIVED map now carries
      // a row per registry id, but a capability row is not a dispatch surface). The
      // honest column for a pane-less file surface is false.
      dispatch_selectable: false,
      capabilities: inferredCaps("kiro", "agents", "file"),
      provenance: "inferred"
    };
    QODER_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "qoder",
      family: "agents",
      adapter_binding: "agents-file",
      surface_kind: "file",
      detection: {
        bin: null,
        requires_auth: false,
        auth_probe: "none",
        subcommand: null,
        marker: { config_dir: ".qoder", scope: "project", agents_placement: "AGENTS.md" }
      },
      installability: "target",
      result_adapter: false,
      // G4b: FLIPPED from true (see KIRO_ENTRY comment — agents-file is a file surface,
      // never a pane; dispatch_selectable:true was unreachable-through-every-surface).
      dispatch_selectable: false,
      capabilities: inferredCaps("qoder", "agents", "file"),
      provenance: "inferred"
    };
    TRAE_ENTRY = {
      schema_version: "guild.host_registry.v1",
      host_id: "trae",
      family: "agents",
      adapter_binding: "agents-file",
      surface_kind: "file",
      detection: {
        bin: null,
        requires_auth: false,
        auth_probe: "none",
        subcommand: null,
        marker: { config_dir: ".trae", scope: "project", agents_placement: "AGENTS.md" }
      },
      installability: "target",
      result_adapter: false,
      // G4b: FLIPPED from true (see KIRO_ENTRY comment — agents-file is a file surface,
      // never a pane; dispatch_selectable:true was unreachable-through-every-surface).
      dispatch_selectable: false,
      capabilities: inferredCaps("trae", "agents", "file"),
      provenance: "inferred"
    };
    HOST_REGISTRY_ROWS = {
      "claude-code-cli": CLAUDE_ENTRY,
      "codex-cli": CODEX_ENTRY,
      "pi-cli": PI_ENTRY,
      "antigravity-cli": ANTIGRAVITY_ENTRY,
      "agents-file": AGENTS_FILE_ENTRY,
      "claude-code-app": CLAUDE_APP_ENTRY,
      "claude-code-web": CLAUDE_WEB_ENTRY,
      "codex-app": CODEX_APP_ENTRY,
      "claude-ai-connector": CLAUDE_AI_CONNECTOR_ENTRY,
      cursor: CURSOR_ENTRY,
      "github-copilot": GITHUB_COPILOT_ENTRY,
      opencode: OPENCODE_ENTRY,
      "rovo-dev": ROVO_DEV_ENTRY,
      kiro: KIRO_ENTRY,
      qoder: QODER_ENTRY,
      trae: TRAE_ENTRY
    };
    HOST_ID_SET = new Set(HOST_IDS);
    FAMILY_SET = new Set(HOST_FAMILIES);
    AUTH_PROBE_SET = new Set(AUTH_PROBES);
  }
});

// ../src/modules/host-runtime/workflows/host-id-namespace.ts
function normalizeHostId(value) {
  const s = value.trim();
  if (HOST_ID_SET2.has(s)) return s;
  return LEGACY_HOST_ALIASES[s] ?? null;
}
var HOST_ID_SET2, LEGACY_HOST_ALIASES;
var init_host_id_namespace = __esm({
  "../src/modules/host-runtime/workflows/host-id-namespace.ts"() {
    init_host_registry_schema();
    HOST_ID_SET2 = new Set(HOST_IDS);
    LEGACY_HOST_ALIASES = {
      claude: "claude-code-cli",
      "claude-code-desktop": "claude-code-app",
      codex: "codex-cli",
      "codex-plugin": "codex-cli",
      agents: "agents-file",
      ".agents": "agents-file",
      pi: "pi-cli",
      antigravity: "antigravity-cli",
      "antigravity-2": "antigravity-cli"
    };
  }
});

// ../src/modules/host-runtime/workflows/adapter-fallback-ladders.ts
var RUNGS, ADAPTER_SURFACES, RUNG_SET, SURFACE_SET;
var init_adapter_fallback_ladders = __esm({
  "../src/modules/host-runtime/workflows/adapter-fallback-ladders.ts"() {
    init_host_registry_schema();
    RUNGS = ["native", "wrapped", "bridged", "emulated", "degraded"];
    ADAPTER_SURFACES = ["interaction", "session", "semantic_tool", "browser"];
    RUNG_SET = new Set(RUNGS);
    SURFACE_SET = new Set(ADAPTER_SURFACES);
  }
});

// ../src/modules/host-runtime/workflows/host-profiles-validate.ts
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function validateHostProfiles(hp) {
  const rejects = [];
  for (const [hostId, entry] of Object.entries(hp)) {
    const canonicalHostId = normalizeHostId(hostId);
    if (!canonicalHostId) {
      rejects.push(
        `unknown host_profiles host_id "${hostId}" (closed key set \u2014 valid: ${[...KNOWN_HOST_IDS].join("|")})`
      );
      continue;
    }
    if (!isPlainObject(entry)) {
      rejects.push(`host_profiles["${hostId}"] must be an object { models?, enabled? }`);
      continue;
    }
    const e = entry;
    for (const ek of Object.keys(e)) {
      if (!VALID_HOST_PROFILE_ENTRY_KEYS.has(ek)) {
        rejects.push(
          `unknown host_profiles["${hostId}"] key "${ek}" (closed entry shape \u2014 only models, enabled)`
        );
      }
    }
    if (e["enabled"] !== void 0 && typeof e["enabled"] !== "boolean") {
      rejects.push(`host_profiles["${hostId}"].enabled must be a boolean (got ${JSON.stringify(e["enabled"])})`);
    }
    if (e["models"] !== void 0) {
      if (!isPlainObject(e["models"])) {
        rejects.push(`host_profiles["${hostId}"].models must be an object { cheap?, mid?, powerful? }`);
      } else {
        const m = e["models"];
        for (const mk of Object.keys(m)) {
          if (!VALID_HOST_PROFILE_MODEL_KEYS.has(mk)) {
            rejects.push(
              `unknown host_profiles["${hostId}"].models key "${mk}" (closed key set \u2014 only cheap, mid, powerful)`
            );
          } else if (typeof m[mk] !== "string" || !m[mk].trim()) {
            rejects.push(`host_profiles["${hostId}"].models.${mk} must be a non-empty string (got ${JSON.stringify(m[mk])})`);
          }
        }
      }
    }
  }
  return rejects;
}
function filterHostProfiles(raw) {
  const out = {};
  for (const [hostId, entry] of Object.entries(raw)) {
    if (validateHostProfiles({ [hostId]: entry }).length === 0) {
      const canonicalHostId = normalizeHostId(hostId);
      if (canonicalHostId) out[canonicalHostId] = entry;
    }
  }
  return out;
}
var KNOWN_HOST_IDS, VALID_HOST_PROFILE_ENTRY_KEYS, VALID_HOST_PROFILE_MODEL_KEYS;
var init_host_profiles_validate = __esm({
  "../src/modules/host-runtime/workflows/host-profiles-validate.ts"() {
    init_host_registry_schema();
    init_host_id_namespace();
    KNOWN_HOST_IDS = new Set(HOST_IDS);
    VALID_HOST_PROFILE_ENTRY_KEYS = /* @__PURE__ */ new Set(["models", "enabled"]);
    VALID_HOST_PROFILE_MODEL_KEYS = /* @__PURE__ */ new Set(["cheap", "mid", "powerful"]);
  }
});

// ../src/modules/host-runtime/workflows/host-registry.ts
function deriveCapabilityRow(row) {
  return row.capabilities;
}
function resultAdapterForFamily(family) {
  return FAMILY_TO_ROW[family]?.result_adapter ?? false;
}
var DERIVED_HOST_CAPABILITY_ROWS, FAMILY_TO_ROW;
var init_host_registry = __esm({
  "../src/modules/host-runtime/workflows/host-registry.ts"() {
    init_host_registry_schema();
    init_host_id_namespace();
    DERIVED_HOST_CAPABILITY_ROWS = (() => {
      const out = {};
      for (const id of HOST_IDS) {
        out[id] = deriveCapabilityRow(HOST_REGISTRY_ROWS[id]);
      }
      out["claude"] = out["claude-code-cli"];
      out["codex"] = out["codex-cli"];
      out["pi"] = out["pi-cli"];
      out["antigravity"] = out["antigravity-cli"];
      out["antigravity-2"] = out["antigravity-cli"];
      return out;
    })();
    FAMILY_TO_ROW = (() => {
      const out = {};
      for (const id of HOST_IDS) {
        const row = HOST_REGISTRY_ROWS[id];
        const existing = out[row.family];
        if (!existing || !existing.result_adapter && row.result_adapter) {
          out[row.family] = row;
        }
      }
      return out;
    })();
  }
});

// ../src/modules/host-runtime/workflows/provider-detect.ts
var PROVIDER_REGISTRY;
var init_provider_detect = __esm({
  "../src/modules/host-runtime/workflows/provider-detect.ts"() {
    init_host_registry();
    PROVIDER_REGISTRY = [
      // The author host itself — always "detected on the host", never a cross reviewer
      // for a same-family author (the AC-8 guard handles that).
      { id: "claude", kind: "host", family: "claude", hasAdapter: resultAdapterForFamily("claude"), requiresAuth: false },
      // Codex reference adapters (the only selectable cross reviewers today).
      { id: "codex-plugin", kind: "plugin-adapter", family: "codex", bin: "codex", hasAdapter: resultAdapterForFamily("codex"), requiresAuth: true },
      { id: "codex-cli", kind: "cli", family: "codex", bin: "codex", hasAdapter: resultAdapterForFamily("codex"), requiresAuth: true },
      // Detect-only until adapters ship (OD-6) — pi/antigravity rows carry result_adapter:false.
      // (The former `gemini-cli` provider was removed when Gemini was sunset 2026-06-14.)
      { id: "pi", kind: "cli", family: "pi", bin: "pi", hasAdapter: resultAdapterForFamily("pi"), requiresAuth: false },
      // VERIFIED on-host 2026-06-16: the Antigravity CLI is `agy` (1.0.8), not `antigravity` — detection must probe `agy` or it never finds the host.
      { id: "antigravity", kind: "cli", family: "antigravity", bin: "agy", hasAdapter: resultAdapterForFamily("antigravity"), requiresAuth: false }
    ];
  }
});

// ../src/modules/host-runtime/index.ts
var init_host_runtime = __esm({
  "../src/modules/host-runtime/index.ts"() {
    init_host_id_namespace();
    init_adapter_fallback_ladders();
    init_host_profiles_validate();
    init_host_registry();
    init_host_registry_schema();
    init_provider_detect();
  }
});

// ../src/modules/security/workflows/safe-object.ts
var PROTO_POISON_KEYS;
var init_safe_object = __esm({
  "../src/modules/security/workflows/safe-object.ts"() {
    PROTO_POISON_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  }
});

// ../src/modules/security/workflows/share-set.ts
var init_share_set = __esm({
  "../src/modules/security/workflows/share-set.ts"() {
  }
});

// ../src/modules/security/index.ts
var init_security = __esm({
  "../src/modules/security/index.ts"() {
    init_safe_object();
    init_share_set();
  }
});

// ../src/modules/config/workflows/config-defaults.ts
var DEFAULT_ESCALATION_MARKERS, NON_INHERITABLE_KEYS, LOG_ROTATION_THRESHOLD_BYTES, SIDECAR_MAX_BYTES, DEFAULTS;
var init_config_defaults = __esm({
  "../src/modules/config/workflows/config-defaults.ts"() {
    DEFAULT_ESCALATION_MARKERS = [
      "I'm not sure",
      "unclear",
      "cannot determine",
      "I don't know",
      "ambiguous",
      "uncertain",
      "not enough information"
    ];
    NON_INHERITABLE_KEYS = /* @__PURE__ */ new Set([
      "initiative_default",
      // OD-1: attach-to-wrong-initiative risk
      "workspace"
      // workspace.mode is root-detection-only
    ]);
    LOG_ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
    SIDECAR_MAX_BYTES = 1024 * 1024;
    DEFAULTS = {
      rigor: "standard",
      auto_approve: [],
      review: "local",
      host: "auto",
      /**
       * rf-wi-01 (v23x-deferred-followups G1) — the sanctioned P1-L10 host-autonomy
       * override (host_mode × guild_gates orthogonality invariant, permission-policy-schema.ts).
       * null (default) = no override; the host's own default ("ask", lifted to "bypass_all" for
       * unattended team panes per issue #54) applies. NOT under `security.` — the #54 lane
       * explicitly reverted an ad-hoc `security.host_mode` key because it bypassed this schema;
       * this top-level placement (sibling of the `host` dispatch selector) is the registered
       * replacement. One of only three keys ever legitimately null-typed at the top level.
       */
      host_mode: null,
      roles: { host: null, advisory: null, adversarial: null },
      host_profiles: {},
      initiative_default: null,
      index: "auto",
      record_status_runs: true,
      codex_skip_enforcement: "warn",
      agent_mode: "auto",
      workspace: { mode: "auto" },
      models: {
        enabled: true,
        // G4b (host-reachability): every host in the registry's HOST_IDS gets an
        // explicit tier slot — NOT generated by importing HOST_IDS here (this file's
        // own contract, stated in the module doc comment above, is to stay free of
        // internal runtime imports so core settings code can load it before the
        // host-runtime layer). The literal key set below IS the full 16-id HOST_IDS
        // roster (host-registry-schema.ts) enumerated by hand; a jest test
        // (scripts/__tests__/config-defaults-tiers-host-ids.test.ts) asserts the two
        // stay in sync so this can never silently drift again the way it had (7 of
        // 16 hosts were missing a slot before this fix). Only claude-code-cli has a
        // non-null model — every other host's registry row carries `models.<tier>.model:
        // null` (no Guild-mapped model), so `null` here is the HONEST default, not a
        // gap (see tier-defaults.ts's `tierDefaults()` for the runtime-computed
        // equivalent this static scaffold mirrors).
        tiers: {
          cheap: { "claude-code-cli": "haiku", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null },
          mid: { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null },
          powerful: { "claude-code-cli": "opus", "codex-cli": null, "pi-cli": null, "antigravity-cli": null, "agents-file": null, "claude-code-app": null, "claude-code-web": null, "codex-app": null, "claude-ai-connector": null, cursor: null, "github-copilot": null, opencode: null, "rovo-dev": null, kiro: null, qoder: null, trae: null }
        },
        scoreWeights: {
          workType: 0,
          blastRadius: 1,
          dependsOn: 1,
          security: 1,
          priorEscalation: 1
        },
        thresholds: { mid: 1, powerful: 3 },
        advisorRounds: 2,
        escalationMarkers: DEFAULT_ESCALATION_MARKERS,
        recallBeforeRead: true,
        recallScoreThreshold: 0.4,
        structuredOutputRequired: true,
        cacheTTL: { coordinator: "1h", leaf: "5m" },
        importanceGate: 3,
        compositeRecall: true,
        importanceAtIngest: true,
        ingestSimilarityGate: 0.8,
        shortOutputThreshold: {},
        knowledge: {
          maxDepth: 8,
          maxBranching: 12,
          minTopicImportance: 0.4,
          relMinConf: 0.5,
          maxFiles: 3e3,
          maxTokens: 1e6,
          batchSize: 20
        }
      },
      security: {
        bypass_permissions_policy: "audit"
      },
      secrets_policy: {
        env_allowlist: [],
        redaction_patterns: [],
        fail_mode_durable: "closed",
        fail_mode_telemetry: "open"
      },
      mcp: {
        tool_description_hashes: {},
        stdio_available: true,
        http_available: false,
        bridge_package: null
      },
      statusline: false,
      adversarial_review_provider: "auto",
      loops: null,
      loop_cap: 16,
      codex_cap: 5,
      defaults: {
        auto_learn: false,
        adversarial: "on",
        team: { size: null, always_include: [] },
        review_workflow: "standard",
        skill_policy: "standard",
        gates: { auto_approve: [] },
        wiki: { share_mode: "team", autopromote: false },
        quality: { budget: { per_class_minutes: 10, total_minutes: 30 } },
        reporting: "standard",
        index: {
          enabled: true,
          kg_node_threshold: 2e3,
          kg_size_threshold_mb: 1,
          links_edge_threshold: 2e3,
          runs_threshold: 20,
          wiki_file_threshold: 500
        },
        cross_host: { enabled: false, hosts: {}, fallback_to_claude: true },
        retry: { max_attempts: 1, backoff: "exponential" },
        resume: { enabled: true },
        heartbeat_timeout_ms: 6e5,
        capability_manifest_ttl_s: 3600,
        // plugin-update-lifecycle G1 AC-6: update-signal behavior. `notify` prints
        // the SessionStart signal; `auto` additionally stages the host apply path;
        // `off` silences everything. cadence_hours bounds the ls-remote cache TTL.
        update: { mode: "notify", cadence_hours: 24 },
        allowed_tools: [],
        /**
         * rf-wi-01 (G1) — registers the guard hooks/lib/lean-lead-guard.ts already reads
         * tolerantly. enabled: advisory master toggle. hands_on_edit_threshold: direct lead
         * Edit/Write ops before the inline-shortcut-expired advisory fires (SKILL.md
         * "Inline shortcut under high autonomy").
         */
        lean_lead: { enabled: true, hands_on_edit_threshold: 8 },
        /**
         * rf-wi-01 (G1) — registers the guard hooks/lib/lifecycle-gate.ts already reads
         * tolerantly. enabled: master toggle. adhoc_activity_threshold: ad-hoc (non-skill)
         * activity count before the lifecycle gate advisory fires.
         */
        lifecycle_gate: { enabled: true, adhoc_activity_threshold: 20 }
      }
    };
  }
});

// ../src/modules/kernel/workflows/module-manifest.ts
var init_module_manifest = __esm({
  "../src/modules/kernel/workflows/module-manifest.ts"() {
  }
});

// node_modules/js-yaml/lib/common.js
var require_common = __commonJS({
  "node_modules/js-yaml/lib/common.js"(exports2, module2) {
    "use strict";
    function isNothing(subject) {
      return typeof subject === "undefined" || subject === null;
    }
    function isObject(subject) {
      return typeof subject === "object" && subject !== null;
    }
    function toArray(sequence) {
      if (Array.isArray(sequence)) return sequence;
      else if (isNothing(sequence)) return [];
      return [sequence];
    }
    function extend(target, source) {
      if (source) {
        const sourceKeys = Object.keys(source);
        for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
          const key = sourceKeys[index];
          target[key] = source[key];
        }
      }
      return target;
    }
    function repeat(string, count) {
      let result = "";
      for (let cycle = 0; cycle < count; cycle += 1) {
        result += string;
      }
      return result;
    }
    function isNegativeZero(number) {
      return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
    }
    module2.exports.isNothing = isNothing;
    module2.exports.isObject = isObject;
    module2.exports.toArray = toArray;
    module2.exports.repeat = repeat;
    module2.exports.isNegativeZero = isNegativeZero;
    module2.exports.extend = extend;
  }
});

// node_modules/js-yaml/lib/exception.js
var require_exception = __commonJS({
  "node_modules/js-yaml/lib/exception.js"(exports2, module2) {
    "use strict";
    function formatError(exception, compact) {
      let where = "";
      const message = exception.reason || "(unknown reason)";
      if (!exception.mark) return message;
      if (exception.mark.name) {
        where += 'in "' + exception.mark.name + '" ';
      }
      where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
      if (!compact && exception.mark.snippet) {
        where += "\n\n" + exception.mark.snippet;
      }
      return message + " " + where;
    }
    function YAMLException(reason, mark) {
      Error.call(this);
      this.name = "YAMLException";
      this.reason = reason;
      this.mark = mark;
      this.message = formatError(this, false);
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
      } else {
        this.stack = new Error().stack || "";
      }
    }
    YAMLException.prototype = Object.create(Error.prototype);
    YAMLException.prototype.constructor = YAMLException;
    YAMLException.prototype.toString = function toString(compact) {
      return this.name + ": " + formatError(this, compact);
    };
    module2.exports = YAMLException;
  }
});

// node_modules/js-yaml/lib/snippet.js
var require_snippet = __commonJS({
  "node_modules/js-yaml/lib/snippet.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
      let head = "";
      let tail = "";
      const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
      if (position - lineStart > maxHalfLength) {
        head = " ... ";
        lineStart = position - maxHalfLength + head.length;
      }
      if (lineEnd - position > maxHalfLength) {
        tail = " ...";
        lineEnd = position + maxHalfLength - tail.length;
      }
      return {
        str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
        pos: position - lineStart + head.length
        // relative position
      };
    }
    function padStart(string, max) {
      return common.repeat(" ", max - string.length) + string;
    }
    function makeSnippet(mark, options) {
      options = Object.create(options || null);
      if (!mark.buffer) return null;
      if (!options.maxLength) options.maxLength = 79;
      if (typeof options.indent !== "number") options.indent = 1;
      if (typeof options.linesBefore !== "number") options.linesBefore = 3;
      if (typeof options.linesAfter !== "number") options.linesAfter = 2;
      const re = /\r?\n|\r|\0/g;
      const lineStarts = [0];
      const lineEnds = [];
      let match;
      let foundLineNo = -1;
      while (match = re.exec(mark.buffer)) {
        lineEnds.push(match.index);
        lineStarts.push(match.index + match[0].length);
        if (mark.position <= match.index && foundLineNo < 0) {
          foundLineNo = lineStarts.length - 2;
        }
      }
      if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
      let result = "";
      const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
      const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
      for (let i = 1; i <= options.linesBefore; i++) {
        if (foundLineNo - i < 0) break;
        const line2 = getLine(
          mark.buffer,
          lineStarts[foundLineNo - i],
          lineEnds[foundLineNo - i],
          mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
          maxLineLength
        );
        result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
      }
      const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
      result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
      result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
      for (let i = 1; i <= options.linesAfter; i++) {
        if (foundLineNo + i >= lineEnds.length) break;
        const line2 = getLine(
          mark.buffer,
          lineStarts[foundLineNo + i],
          lineEnds[foundLineNo + i],
          mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
          maxLineLength
        );
        result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
      }
      return result.replace(/\n$/, "");
    }
    module2.exports = makeSnippet;
  }
});

// node_modules/js-yaml/lib/type.js
var require_type = __commonJS({
  "node_modules/js-yaml/lib/type.js"(exports2, module2) {
    "use strict";
    var YAMLException = require_exception();
    var TYPE_CONSTRUCTOR_OPTIONS = [
      "kind",
      "multi",
      "resolve",
      "construct",
      "instanceOf",
      "predicate",
      "represent",
      "representName",
      "defaultStyle",
      "styleAliases"
    ];
    var YAML_NODE_KINDS = [
      "scalar",
      "sequence",
      "mapping"
    ];
    function compileStyleAliases(map) {
      const result = {};
      if (map !== null) {
        Object.keys(map).forEach(function(style) {
          map[style].forEach(function(alias) {
            result[String(alias)] = style;
          });
        });
      }
      return result;
    }
    function Type(tag, options) {
      options = options || {};
      Object.keys(options).forEach(function(name) {
        if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) {
          throw new YAMLException('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
        }
      });
      this.options = options;
      this.tag = tag;
      this.kind = options["kind"] || null;
      this.resolve = options["resolve"] || function() {
        return true;
      };
      this.construct = options["construct"] || function(data) {
        return data;
      };
      this.instanceOf = options["instanceOf"] || null;
      this.predicate = options["predicate"] || null;
      this.represent = options["represent"] || null;
      this.representName = options["representName"] || null;
      this.defaultStyle = options["defaultStyle"] || null;
      this.multi = options["multi"] || false;
      this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
      if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
        throw new YAMLException('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
      }
    }
    module2.exports = Type;
  }
});

// node_modules/js-yaml/lib/schema.js
var require_schema = __commonJS({
  "node_modules/js-yaml/lib/schema.js"(exports2, module2) {
    "use strict";
    var YAMLException = require_exception();
    var Type = require_type();
    function compileList(schema, name) {
      const result = [];
      schema[name].forEach(function(currentType) {
        let newIndex = result.length;
        result.forEach(function(previousType, previousIndex) {
          if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
            newIndex = previousIndex;
          }
        });
        result[newIndex] = currentType;
      });
      return result;
    }
    function compileMap() {
      const result = {
        scalar: {},
        sequence: {},
        mapping: {},
        fallback: {},
        multi: {
          scalar: [],
          sequence: [],
          mapping: [],
          fallback: []
        }
      };
      function collectType(type) {
        if (type.multi) {
          result.multi[type.kind].push(type);
          result.multi["fallback"].push(type);
        } else {
          result[type.kind][type.tag] = result["fallback"][type.tag] = type;
        }
      }
      for (let index = 0, length = arguments.length; index < length; index += 1) {
        arguments[index].forEach(collectType);
      }
      return result;
    }
    function Schema(definition) {
      return this.extend(definition);
    }
    Schema.prototype.extend = function extend(definition) {
      let implicit = [];
      let explicit = [];
      if (definition instanceof Type) {
        explicit.push(definition);
      } else if (Array.isArray(definition)) {
        explicit = explicit.concat(definition);
      } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
        if (definition.implicit) implicit = implicit.concat(definition.implicit);
        if (definition.explicit) explicit = explicit.concat(definition.explicit);
      } else {
        throw new YAMLException("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
      }
      implicit.forEach(function(type) {
        if (!(type instanceof Type)) {
          throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        }
        if (type.loadKind && type.loadKind !== "scalar") {
          throw new YAMLException("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
        }
        if (type.multi) {
          throw new YAMLException("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
        }
      });
      explicit.forEach(function(type) {
        if (!(type instanceof Type)) {
          throw new YAMLException("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        }
      });
      const result = Object.create(Schema.prototype);
      result.implicit = (this.implicit || []).concat(implicit);
      result.explicit = (this.explicit || []).concat(explicit);
      result.compiledImplicit = compileList(result, "implicit");
      result.compiledExplicit = compileList(result, "explicit");
      result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
      return result;
    };
    module2.exports = Schema;
  }
});

// node_modules/js-yaml/lib/type/str.js
var require_str = __commonJS({
  "node_modules/js-yaml/lib/type/str.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    module2.exports = new Type("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function(data) {
        return data !== null ? data : "";
      }
    });
  }
});

// node_modules/js-yaml/lib/type/seq.js
var require_seq = __commonJS({
  "node_modules/js-yaml/lib/type/seq.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    module2.exports = new Type("tag:yaml.org,2002:seq", {
      kind: "sequence",
      construct: function(data) {
        return data !== null ? data : [];
      }
    });
  }
});

// node_modules/js-yaml/lib/type/map.js
var require_map = __commonJS({
  "node_modules/js-yaml/lib/type/map.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    module2.exports = new Type("tag:yaml.org,2002:map", {
      kind: "mapping",
      construct: function(data) {
        return data !== null ? data : {};
      }
    });
  }
});

// node_modules/js-yaml/lib/schema/failsafe.js
var require_failsafe = __commonJS({
  "node_modules/js-yaml/lib/schema/failsafe.js"(exports2, module2) {
    "use strict";
    var Schema = require_schema();
    module2.exports = new Schema({
      explicit: [
        require_str(),
        require_seq(),
        require_map()
      ]
    });
  }
});

// node_modules/js-yaml/lib/type/null.js
var require_null = __commonJS({
  "node_modules/js-yaml/lib/type/null.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlNull(data) {
      if (data === null) return true;
      const max = data.length;
      return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
    }
    function constructYamlNull() {
      return null;
    }
    function isNull(object) {
      return object === null;
    }
    module2.exports = new Type("tag:yaml.org,2002:null", {
      kind: "scalar",
      resolve: resolveYamlNull,
      construct: constructYamlNull,
      predicate: isNull,
      represent: {
        canonical: function() {
          return "~";
        },
        lowercase: function() {
          return "null";
        },
        uppercase: function() {
          return "NULL";
        },
        camelcase: function() {
          return "Null";
        },
        empty: function() {
          return "";
        }
      },
      defaultStyle: "lowercase"
    });
  }
});

// node_modules/js-yaml/lib/type/bool.js
var require_bool = __commonJS({
  "node_modules/js-yaml/lib/type/bool.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlBoolean(data) {
      if (data === null) return false;
      const max = data.length;
      return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
    }
    function constructYamlBoolean(data) {
      return data === "true" || data === "True" || data === "TRUE";
    }
    function isBoolean(object) {
      return Object.prototype.toString.call(object) === "[object Boolean]";
    }
    module2.exports = new Type("tag:yaml.org,2002:bool", {
      kind: "scalar",
      resolve: resolveYamlBoolean,
      construct: constructYamlBoolean,
      predicate: isBoolean,
      represent: {
        lowercase: function(object) {
          return object ? "true" : "false";
        },
        uppercase: function(object) {
          return object ? "TRUE" : "FALSE";
        },
        camelcase: function(object) {
          return object ? "True" : "False";
        }
      },
      defaultStyle: "lowercase"
    });
  }
});

// node_modules/js-yaml/lib/type/int.js
var require_int = __commonJS({
  "node_modules/js-yaml/lib/type/int.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var Type = require_type();
    function isHexCode(c) {
      return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
    }
    function isOctCode(c) {
      return c >= 48 && c <= 55;
    }
    function isDecCode(c) {
      return c >= 48 && c <= 57;
    }
    function resolveYamlInteger(data) {
      if (data === null) return false;
      const max = data.length;
      let index = 0;
      let hasDigits = false;
      if (!max) return false;
      let ch = data[index];
      if (ch === "-" || ch === "+") {
        ch = data[++index];
      }
      if (ch === "0") {
        if (index + 1 === max) return true;
        ch = data[++index];
        if (ch === "b") {
          index++;
          for (; index < max; index++) {
            ch = data[index];
            if (ch !== "0" && ch !== "1") return false;
            hasDigits = true;
          }
          return hasDigits && isFinite(parseYamlInteger(data));
        }
        if (ch === "x") {
          index++;
          for (; index < max; index++) {
            if (!isHexCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && isFinite(parseYamlInteger(data));
        }
        if (ch === "o") {
          index++;
          for (; index < max; index++) {
            if (!isOctCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && isFinite(parseYamlInteger(data));
        }
      }
      for (; index < max; index++) {
        if (!isDecCode(data.charCodeAt(index))) {
          return false;
        }
        hasDigits = true;
      }
      if (!hasDigits) return false;
      return isFinite(parseYamlInteger(data));
    }
    function parseYamlInteger(data) {
      let value = data;
      let sign = 1;
      let ch = value[0];
      if (ch === "-" || ch === "+") {
        if (ch === "-") sign = -1;
        value = value.slice(1);
        ch = value[0];
      }
      if (value === "0") return 0;
      if (ch === "0") {
        if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
        if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
        if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
      }
      return sign * parseInt(value, 10);
    }
    function constructYamlInteger(data) {
      return parseYamlInteger(data);
    }
    function isInteger(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common.isNegativeZero(object));
    }
    module2.exports = new Type("tag:yaml.org,2002:int", {
      kind: "scalar",
      resolve: resolveYamlInteger,
      construct: constructYamlInteger,
      predicate: isInteger,
      represent: {
        binary: function(obj) {
          return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
        },
        octal: function(obj) {
          return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
        },
        decimal: function(obj) {
          return obj.toString(10);
        },
        hexadecimal: function(obj) {
          return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
        }
      },
      defaultStyle: "decimal",
      styleAliases: {
        binary: [2, "bin"],
        octal: [8, "oct"],
        decimal: [10, "dec"],
        hexadecimal: [16, "hex"]
      }
    });
  }
});

// node_modules/js-yaml/lib/type/float.js
var require_float = __commonJS({
  "node_modules/js-yaml/lib/type/float.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var Type = require_type();
    var YAML_FLOAT_PATTERN = new RegExp(
      // 2.5e4, 2.5 and integers
      "^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
    );
    var YAML_FLOAT_SPECIAL_PATTERN = new RegExp(
      "^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
    );
    function resolveYamlFloat(data) {
      if (data === null) return false;
      if (!YAML_FLOAT_PATTERN.test(data)) {
        return false;
      }
      if (isFinite(parseFloat(data, 10))) {
        return true;
      }
      return YAML_FLOAT_SPECIAL_PATTERN.test(data);
    }
    function constructYamlFloat(data) {
      let value = data.toLowerCase();
      const sign = value[0] === "-" ? -1 : 1;
      if ("+-".indexOf(value[0]) >= 0) {
        value = value.slice(1);
      }
      if (value === ".inf") {
        return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      } else if (value === ".nan") {
        return NaN;
      }
      return sign * parseFloat(value, 10);
    }
    var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
    function representYamlFloat(object, style) {
      if (isNaN(object)) {
        switch (style) {
          case "lowercase":
            return ".nan";
          case "uppercase":
            return ".NAN";
          case "camelcase":
            return ".NaN";
        }
      } else if (Number.POSITIVE_INFINITY === object) {
        switch (style) {
          case "lowercase":
            return ".inf";
          case "uppercase":
            return ".INF";
          case "camelcase":
            return ".Inf";
        }
      } else if (Number.NEGATIVE_INFINITY === object) {
        switch (style) {
          case "lowercase":
            return "-.inf";
          case "uppercase":
            return "-.INF";
          case "camelcase":
            return "-.Inf";
        }
      } else if (common.isNegativeZero(object)) {
        return "-0.0";
      }
      const res = object.toString(10);
      return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
    }
    function isFloat(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
    }
    module2.exports = new Type("tag:yaml.org,2002:float", {
      kind: "scalar",
      resolve: resolveYamlFloat,
      construct: constructYamlFloat,
      predicate: isFloat,
      represent: representYamlFloat,
      defaultStyle: "lowercase"
    });
  }
});

// node_modules/js-yaml/lib/schema/json.js
var require_json = __commonJS({
  "node_modules/js-yaml/lib/schema/json.js"(exports2, module2) {
    "use strict";
    module2.exports = require_failsafe().extend({
      implicit: [
        require_null(),
        require_bool(),
        require_int(),
        require_float()
      ]
    });
  }
});

// node_modules/js-yaml/lib/schema/core.js
var require_core = __commonJS({
  "node_modules/js-yaml/lib/schema/core.js"(exports2, module2) {
    "use strict";
    module2.exports = require_json();
  }
});

// node_modules/js-yaml/lib/type/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/js-yaml/lib/type/timestamp.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var YAML_DATE_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
    );
    var YAML_TIMESTAMP_REGEXP = new RegExp(
      "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
    );
    function resolveYamlTimestamp(data) {
      if (data === null) return false;
      if (YAML_DATE_REGEXP.exec(data) !== null) return true;
      if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
      return false;
    }
    function constructYamlTimestamp(data) {
      let fraction = 0;
      let delta = null;
      let match = YAML_DATE_REGEXP.exec(data);
      if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
      if (match === null) throw new Error("Date resolve error");
      const year = +match[1];
      const month = +match[2] - 1;
      const day = +match[3];
      if (!match[4]) {
        return new Date(Date.UTC(year, month, day));
      }
      const hour = +match[4];
      const minute = +match[5];
      const second = +match[6];
      if (match[7]) {
        fraction = match[7].slice(0, 3);
        while (fraction.length < 3) {
          fraction += "0";
        }
        fraction = +fraction;
      }
      if (match[9]) {
        const tzHour = +match[10];
        const tzMinute = +(match[11] || 0);
        delta = (tzHour * 60 + tzMinute) * 6e4;
        if (match[9] === "-") delta = -delta;
      }
      const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
      if (delta) date.setTime(date.getTime() - delta);
      return date;
    }
    function representYamlTimestamp(object) {
      return object.toISOString();
    }
    module2.exports = new Type("tag:yaml.org,2002:timestamp", {
      kind: "scalar",
      resolve: resolveYamlTimestamp,
      construct: constructYamlTimestamp,
      instanceOf: Date,
      represent: representYamlTimestamp
    });
  }
});

// node_modules/js-yaml/lib/type/merge.js
var require_merge = __commonJS({
  "node_modules/js-yaml/lib/type/merge.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    function resolveYamlMerge(data) {
      return data === "<<" || data === null;
    }
    module2.exports = new Type("tag:yaml.org,2002:merge", {
      kind: "scalar",
      resolve: resolveYamlMerge
    });
  }
});

// node_modules/js-yaml/lib/type/binary.js
var require_binary = __commonJS({
  "node_modules/js-yaml/lib/type/binary.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
    function resolveYamlBinary(data) {
      if (data === null) return false;
      let bitlen = 0;
      const max = data.length;
      const map = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        const code = map.indexOf(data.charAt(idx));
        if (code > 64) continue;
        if (code < 0) return false;
        bitlen += 6;
      }
      return bitlen % 8 === 0;
    }
    function constructYamlBinary(data) {
      const input = data.replace(/[\r\n=]/g, "");
      const max = input.length;
      const map = BASE64_MAP;
      let bits = 0;
      const result = [];
      for (let idx = 0; idx < max; idx++) {
        if (idx % 4 === 0 && idx) {
          result.push(bits >> 16 & 255);
          result.push(bits >> 8 & 255);
          result.push(bits & 255);
        }
        bits = bits << 6 | map.indexOf(input.charAt(idx));
      }
      const tailbits = max % 4 * 6;
      if (tailbits === 0) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      } else if (tailbits === 18) {
        result.push(bits >> 10 & 255);
        result.push(bits >> 2 & 255);
      } else if (tailbits === 12) {
        result.push(bits >> 4 & 255);
      }
      return new Uint8Array(result);
    }
    function representYamlBinary(object) {
      let result = "";
      let bits = 0;
      const max = object.length;
      const map = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        if (idx % 3 === 0 && idx) {
          result += map[bits >> 18 & 63];
          result += map[bits >> 12 & 63];
          result += map[bits >> 6 & 63];
          result += map[bits & 63];
        }
        bits = (bits << 8) + object[idx];
      }
      const tail = max % 3;
      if (tail === 0) {
        result += map[bits >> 18 & 63];
        result += map[bits >> 12 & 63];
        result += map[bits >> 6 & 63];
        result += map[bits & 63];
      } else if (tail === 2) {
        result += map[bits >> 10 & 63];
        result += map[bits >> 4 & 63];
        result += map[bits << 2 & 63];
        result += map[64];
      } else if (tail === 1) {
        result += map[bits >> 2 & 63];
        result += map[bits << 4 & 63];
        result += map[64];
        result += map[64];
      }
      return result;
    }
    function isBinary(obj) {
      return Object.prototype.toString.call(obj) === "[object Uint8Array]";
    }
    module2.exports = new Type("tag:yaml.org,2002:binary", {
      kind: "scalar",
      resolve: resolveYamlBinary,
      construct: constructYamlBinary,
      predicate: isBinary,
      represent: representYamlBinary
    });
  }
});

// node_modules/js-yaml/lib/type/omap.js
var require_omap = __commonJS({
  "node_modules/js-yaml/lib/type/omap.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var _toString = Object.prototype.toString;
    function resolveYamlOmap(data) {
      if (data === null) return true;
      const objectKeys = [];
      const object = data;
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        let pairHasKey = false;
        if (_toString.call(pair) !== "[object Object]") return false;
        let pairKey;
        for (pairKey in pair) {
          if (_hasOwnProperty.call(pair, pairKey)) {
            if (!pairHasKey) pairHasKey = true;
            else return false;
          }
        }
        if (!pairHasKey) return false;
        if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
        else return false;
      }
      return true;
    }
    function constructYamlOmap(data) {
      return data !== null ? data : [];
    }
    module2.exports = new Type("tag:yaml.org,2002:omap", {
      kind: "sequence",
      resolve: resolveYamlOmap,
      construct: constructYamlOmap
    });
  }
});

// node_modules/js-yaml/lib/type/pairs.js
var require_pairs = __commonJS({
  "node_modules/js-yaml/lib/type/pairs.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _toString = Object.prototype.toString;
    function resolveYamlPairs(data) {
      if (data === null) return true;
      const object = data;
      const result = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        if (_toString.call(pair) !== "[object Object]") return false;
        const keys = Object.keys(pair);
        if (keys.length !== 1) return false;
        result[index] = [keys[0], pair[keys[0]]];
      }
      return true;
    }
    function constructYamlPairs(data) {
      if (data === null) return [];
      const object = data;
      const result = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        const keys = Object.keys(pair);
        result[index] = [keys[0], pair[keys[0]]];
      }
      return result;
    }
    module2.exports = new Type("tag:yaml.org,2002:pairs", {
      kind: "sequence",
      resolve: resolveYamlPairs,
      construct: constructYamlPairs
    });
  }
});

// node_modules/js-yaml/lib/type/set.js
var require_set = __commonJS({
  "node_modules/js-yaml/lib/type/set.js"(exports2, module2) {
    "use strict";
    var Type = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    function resolveYamlSet(data) {
      if (data === null) return true;
      const object = data;
      for (const key in object) {
        if (_hasOwnProperty.call(object, key)) {
          if (object[key] !== null) return false;
        }
      }
      return true;
    }
    function constructYamlSet(data) {
      return data !== null ? data : {};
    }
    module2.exports = new Type("tag:yaml.org,2002:set", {
      kind: "mapping",
      resolve: resolveYamlSet,
      construct: constructYamlSet
    });
  }
});

// node_modules/js-yaml/lib/schema/default.js
var require_default = __commonJS({
  "node_modules/js-yaml/lib/schema/default.js"(exports2, module2) {
    "use strict";
    module2.exports = require_core().extend({
      implicit: [
        require_timestamp(),
        require_merge()
      ],
      explicit: [
        require_binary(),
        require_omap(),
        require_pairs(),
        require_set()
      ]
    });
  }
});

// node_modules/js-yaml/lib/loader.js
var require_loader = __commonJS({
  "node_modules/js-yaml/lib/loader.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var makeSnippet = require_snippet();
    var DEFAULT_SCHEMA = require_default();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var CONTEXT_FLOW_IN = 1;
    var CONTEXT_FLOW_OUT = 2;
    var CONTEXT_BLOCK_IN = 3;
    var CONTEXT_BLOCK_OUT = 4;
    var CHOMPING_CLIP = 1;
    var CHOMPING_STRIP = 2;
    var CHOMPING_KEEP = 3;
    var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
    var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
    var PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
    var PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
    var PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
    function _class(obj) {
      return Object.prototype.toString.call(obj);
    }
    function isEol(c) {
      return c === 10 || c === 13;
    }
    function isWhiteSpace(c) {
      return c === 9 || c === 32;
    }
    function isWsOrEol(c) {
      return c === 9 || c === 32 || c === 10 || c === 13;
    }
    function isFlowIndicator(c) {
      return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
    }
    function fromHexCode(c) {
      if (c >= 48 && c <= 57) {
        return c - 48;
      }
      const lc = c | 32;
      if (lc >= 97 && lc <= 102) {
        return lc - 97 + 10;
      }
      return -1;
    }
    function escapedHexLen(c) {
      if (c === 120) {
        return 2;
      }
      if (c === 117) {
        return 4;
      }
      if (c === 85) {
        return 8;
      }
      return 0;
    }
    function fromDecimalCode(c) {
      if (c >= 48 && c <= 57) {
        return c - 48;
      }
      return -1;
    }
    function simpleEscapeSequence(c) {
      switch (c) {
        case 48:
          return "\0";
        case 97:
          return "\x07";
        case 98:
          return "\b";
        case 116:
          return "	";
        case 9:
          return "	";
        case 110:
          return "\n";
        case 118:
          return "\v";
        case 102:
          return "\f";
        case 114:
          return "\r";
        case 101:
          return "\x1B";
        case 32:
          return " ";
        case 34:
          return '"';
        case 47:
          return "/";
        case 92:
          return "\\";
        case 78:
          return "\x85";
        case 95:
          return "\xA0";
        case 76:
          return "\u2028";
        case 80:
          return "\u2029";
        default:
          return "";
      }
    }
    function charFromCodepoint(c) {
      if (c <= 65535) {
        return String.fromCharCode(c);
      }
      return String.fromCharCode(
        (c - 65536 >> 10) + 55296,
        (c - 65536 & 1023) + 56320
      );
    }
    function setProperty(object, key, value) {
      if (key === "__proto__") {
        Object.defineProperty(object, key, {
          configurable: true,
          enumerable: true,
          writable: true,
          value
        });
      } else {
        object[key] = value;
      }
    }
    var simpleEscapeCheck = new Array(256);
    var simpleEscapeMap = new Array(256);
    for (let i = 0; i < 256; i++) {
      simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
      simpleEscapeMap[i] = simpleEscapeSequence(i);
    }
    function State(input, options) {
      this.input = input;
      this.filename = options["filename"] || null;
      this.schema = options["schema"] || DEFAULT_SCHEMA;
      this.onWarning = options["onWarning"] || null;
      this.legacy = options["legacy"] || false;
      this.json = options["json"] || false;
      this.listener = options["listener"] || null;
      this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
      this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
      this.implicitTypes = this.schema.compiledImplicit;
      this.typeMap = this.schema.compiledTypeMap;
      this.length = input.length;
      this.position = 0;
      this.line = 0;
      this.lineStart = 0;
      this.lineIndent = 0;
      this.depth = 0;
      this.totalMergeKeys = 0;
      this.firstTabInLine = -1;
      this.documents = [];
      this.anchorMapTransactions = [];
    }
    function generateError(state, message) {
      const mark = {
        name: state.filename,
        buffer: state.input.slice(0, -1),
        // omit trailing \0
        position: state.position,
        line: state.line,
        column: state.position - state.lineStart
      };
      mark.snippet = makeSnippet(mark);
      return new YAMLException(message, mark);
    }
    function throwError(state, message) {
      throw generateError(state, message);
    }
    function throwWarning(state, message) {
      if (state.onWarning) {
        state.onWarning.call(null, generateError(state, message));
      }
    }
    function storeAnchor(state, name, value) {
      const transactions = state.anchorMapTransactions;
      if (transactions.length !== 0) {
        const transaction = transactions[transactions.length - 1];
        if (!_hasOwnProperty.call(transaction, name)) {
          transaction[name] = {
            existed: _hasOwnProperty.call(state.anchorMap, name),
            value: state.anchorMap[name]
          };
        }
      }
      state.anchorMap[name] = value;
    }
    function beginAnchorTransaction(state) {
      state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
    }
    function commitAnchorTransaction(state) {
      const transaction = state.anchorMapTransactions.pop();
      const transactions = state.anchorMapTransactions;
      if (transactions.length === 0) return;
      const parent = transactions[transactions.length - 1];
      const names = Object.keys(transaction);
      for (let index = 0, length = names.length; index < length; index += 1) {
        const name = names[index];
        if (!_hasOwnProperty.call(parent, name)) {
          parent[name] = transaction[name];
        }
      }
    }
    function rollbackAnchorTransaction(state) {
      const transaction = state.anchorMapTransactions.pop();
      const names = Object.keys(transaction);
      for (let index = names.length - 1; index >= 0; index -= 1) {
        const entry = transaction[names[index]];
        if (entry.existed) {
          state.anchorMap[names[index]] = entry.value;
        } else {
          delete state.anchorMap[names[index]];
        }
      }
    }
    function snapshotState(state) {
      return {
        position: state.position,
        line: state.line,
        lineStart: state.lineStart,
        lineIndent: state.lineIndent,
        firstTabInLine: state.firstTabInLine,
        tag: state.tag,
        anchor: state.anchor,
        kind: state.kind,
        result: state.result
      };
    }
    function restoreState(state, snapshot) {
      state.position = snapshot.position;
      state.line = snapshot.line;
      state.lineStart = snapshot.lineStart;
      state.lineIndent = snapshot.lineIndent;
      state.firstTabInLine = snapshot.firstTabInLine;
      state.tag = snapshot.tag;
      state.anchor = snapshot.anchor;
      state.kind = snapshot.kind;
      state.result = snapshot.result;
    }
    var directiveHandlers = {
      YAML: function handleYamlDirective(state, name, args) {
        if (state.version !== null) {
          throwError(state, "duplication of %YAML directive");
        }
        if (args.length !== 1) {
          throwError(state, "YAML directive accepts exactly one argument");
        }
        const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
        if (match === null) {
          throwError(state, "ill-formed argument of the YAML directive");
        }
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major !== 1) {
          throwError(state, "unacceptable YAML version of the document");
        }
        state.version = args[0];
        state.checkLineBreaks = minor < 2;
        if (minor !== 1 && minor !== 2) {
          throwWarning(state, "unsupported YAML version of the document");
        }
      },
      TAG: function handleTagDirective(state, name, args) {
        let prefix;
        if (args.length !== 2) {
          throwError(state, "TAG directive accepts exactly two arguments");
        }
        const handle = args[0];
        prefix = args[1];
        if (!PATTERN_TAG_HANDLE.test(handle)) {
          throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
        }
        if (_hasOwnProperty.call(state.tagMap, handle)) {
          throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
        }
        if (!PATTERN_TAG_URI.test(prefix)) {
          throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
        }
        try {
          prefix = decodeURIComponent(prefix);
        } catch (err) {
          throwError(state, "tag prefix is malformed: " + prefix);
        }
        state.tagMap[handle] = prefix;
      }
    };
    function captureSegment(state, start, end, checkJson) {
      if (start < end) {
        const _result = state.input.slice(start, end);
        if (checkJson) {
          for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
            const _character = _result.charCodeAt(_position);
            if (!(_character === 9 || _character >= 32 && _character <= 1114111)) {
              throwError(state, "expected valid JSON character");
            }
          }
        } else if (PATTERN_NON_PRINTABLE.test(_result)) {
          throwError(state, "the stream contains non-printable characters");
        }
        state.result += _result;
      }
    }
    function mergeMappings(state, destination, source, overridableKeys) {
      if (!common.isObject(source)) {
        throwError(state, "cannot merge mappings; the provided source object is unacceptable");
      }
      const sourceKeys = Object.keys(source);
      for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
        const key = sourceKeys[index];
        if (state.maxTotalMergeKeys !== -1 && ++state.totalMergeKeys > state.maxTotalMergeKeys) {
          throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
        }
        if (!_hasOwnProperty.call(destination, key)) {
          setProperty(destination, key, source[key]);
          overridableKeys[key] = true;
        }
      }
    }
    function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
      if (Array.isArray(keyNode)) {
        keyNode = Array.prototype.slice.call(keyNode);
        for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
          if (Array.isArray(keyNode[index])) {
            throwError(state, "nested arrays are not supported inside keys");
          }
          if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
            keyNode[index] = "[object Object]";
          }
        }
      }
      if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
        keyNode = "[object Object]";
      }
      keyNode = String(keyNode);
      if (_result === null) {
        _result = {};
      }
      if (keyTag === "tag:yaml.org,2002:merge") {
        if (Array.isArray(valueNode)) {
          for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
            mergeMappings(state, _result, valueNode[index], overridableKeys);
          }
        } else {
          mergeMappings(state, _result, valueNode, overridableKeys);
        }
      } else {
        if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
          state.line = startLine || state.line;
          state.lineStart = startLineStart || state.lineStart;
          state.position = startPos || state.position;
          throwError(state, "duplicated mapping key");
        }
        setProperty(_result, keyNode, valueNode);
        delete overridableKeys[keyNode];
      }
      return _result;
    }
    function readLineBreak(state) {
      const ch = state.input.charCodeAt(state.position);
      if (ch === 10) {
        state.position++;
      } else if (ch === 13) {
        state.position++;
        if (state.input.charCodeAt(state.position) === 10) {
          state.position++;
        }
      } else {
        throwError(state, "a line break is expected");
      }
      state.line += 1;
      state.lineStart = state.position;
      state.firstTabInLine = -1;
    }
    function skipSeparationSpace(state, allowComments, checkIndent) {
      let lineBreaks = 0;
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        while (isWhiteSpace(ch)) {
          if (ch === 9 && state.firstTabInLine === -1) {
            state.firstTabInLine = state.position;
          }
          ch = state.input.charCodeAt(++state.position);
        }
        if (allowComments && ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 10 && ch !== 13 && ch !== 0);
        }
        if (isEol(ch)) {
          readLineBreak(state);
          ch = state.input.charCodeAt(state.position);
          lineBreaks++;
          state.lineIndent = 0;
          while (ch === 32) {
            state.lineIndent++;
            ch = state.input.charCodeAt(++state.position);
          }
        } else {
          break;
        }
      }
      if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
        throwWarning(state, "deficient indentation");
      }
      return lineBreaks;
    }
    function testDocumentSeparator(state) {
      let _position = state.position;
      let ch = state.input.charCodeAt(_position);
      if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
        _position += 3;
        ch = state.input.charCodeAt(_position);
        if (ch === 0 || isWsOrEol(ch)) {
          return true;
        }
      }
      return false;
    }
    function writeFoldedLines(state, count) {
      if (count === 1) {
        state.result += " ";
      } else if (count > 1) {
        state.result += common.repeat("\n", count - 1);
      }
    }
    function readPlainScalar(state, nodeIndent, withinFlowCollection) {
      let captureStart;
      let captureEnd;
      let hasPendingContent;
      let _line;
      let _lineStart;
      let _lineIndent;
      const _kind = state.kind;
      const _result = state.result;
      let ch = state.input.charCodeAt(state.position);
      if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
        return false;
      }
      if (ch === 63 || ch === 45) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
          return false;
        }
      }
      state.kind = "scalar";
      state.result = "";
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
      while (ch !== 0) {
        if (ch === 58) {
          const following = state.input.charCodeAt(state.position + 1);
          if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
            break;
          }
        } else if (ch === 35) {
          const preceding = state.input.charCodeAt(state.position - 1);
          if (isWsOrEol(preceding)) {
            break;
          }
        } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) {
          break;
        } else if (isEol(ch)) {
          _line = state.line;
          _lineStart = state.lineStart;
          _lineIndent = state.lineIndent;
          skipSeparationSpace(state, false, -1);
          if (state.lineIndent >= nodeIndent) {
            hasPendingContent = true;
            ch = state.input.charCodeAt(state.position);
            continue;
          } else {
            state.position = captureEnd;
            state.line = _line;
            state.lineStart = _lineStart;
            state.lineIndent = _lineIndent;
            break;
          }
        }
        if (hasPendingContent) {
          captureSegment(state, captureStart, captureEnd, false);
          writeFoldedLines(state, state.line - _line);
          captureStart = captureEnd = state.position;
          hasPendingContent = false;
        }
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position + 1;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, captureEnd, false);
      if (state.result) {
        return true;
      }
      state.kind = _kind;
      state.result = _result;
      return false;
    }
    function readSingleQuotedScalar(state, nodeIndent) {
      let captureStart;
      let captureEnd;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 39) {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        if (ch === 39) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (ch === 39) {
            captureStart = state.position;
            state.position++;
            captureEnd = state.position;
          } else {
            return true;
          }
        } else if (isEol(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a single quoted scalar");
        } else {
          state.position++;
          if (!isWhiteSpace(ch)) {
            captureEnd = state.position;
          }
        }
      }
      throwError(state, "unexpected end of the stream within a single quoted scalar");
    }
    function readDoubleQuotedScalar(state, nodeIndent) {
      let captureStart;
      let captureEnd;
      let tmp;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 34) {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        if (ch === 34) {
          captureSegment(state, captureStart, state.position, true);
          state.position++;
          return true;
        } else if (ch === 92) {
          captureSegment(state, captureStart, state.position, true);
          ch = state.input.charCodeAt(++state.position);
          if (isEol(ch)) {
            skipSeparationSpace(state, false, nodeIndent);
          } else if (ch < 256 && simpleEscapeCheck[ch]) {
            state.result += simpleEscapeMap[ch];
            state.position++;
          } else if ((tmp = escapedHexLen(ch)) > 0) {
            let hexLength = tmp;
            let hexResult = 0;
            for (; hexLength > 0; hexLength--) {
              ch = state.input.charCodeAt(++state.position);
              if ((tmp = fromHexCode(ch)) >= 0) {
                hexResult = (hexResult << 4) + tmp;
              } else {
                throwError(state, "expected hexadecimal character");
              }
            }
            state.result += charFromCodepoint(hexResult);
            state.position++;
          } else {
            throwError(state, "unknown escape sequence");
          }
          captureStart = captureEnd = state.position;
        } else if (isEol(ch)) {
          captureSegment(state, captureStart, captureEnd, true);
          writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
          captureStart = captureEnd = state.position;
        } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
          throwError(state, "unexpected end of the document within a double quoted scalar");
        } else {
          state.position++;
          if (!isWhiteSpace(ch)) {
            captureEnd = state.position;
          }
        }
      }
      throwError(state, "unexpected end of the stream within a double quoted scalar");
    }
    function readFlowCollection(state, nodeIndent) {
      let readNext = true;
      let _line;
      let _lineStart;
      let _pos;
      const _tag = state.tag;
      let _result;
      const _anchor = state.anchor;
      let terminator;
      let isPair;
      let isExplicitPair;
      let isMapping;
      const overridableKeys = /* @__PURE__ */ Object.create(null);
      let keyNode;
      let keyTag;
      let valueNode;
      let ch = state.input.charCodeAt(state.position);
      if (ch === 91) {
        terminator = 93;
        isMapping = false;
        _result = [];
      } else if (ch === 123) {
        terminator = 125;
        isMapping = true;
        _result = {};
      } else {
        return false;
      }
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, _result);
      }
      ch = state.input.charCodeAt(++state.position);
      while (ch !== 0) {
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === terminator) {
          state.position++;
          state.tag = _tag;
          state.anchor = _anchor;
          state.kind = isMapping ? "mapping" : "sequence";
          state.result = _result;
          return true;
        } else if (!readNext) {
          throwError(state, "missed comma between flow collection entries");
        } else if (ch === 44) {
          throwError(state, "expected the node content, but found ','");
        }
        keyTag = keyNode = valueNode = null;
        isPair = isExplicitPair = false;
        if (ch === 63) {
          const following = state.input.charCodeAt(state.position + 1);
          if (isWsOrEol(following)) {
            isPair = isExplicitPair = true;
            state.position++;
            skipSeparationSpace(state, true, nodeIndent);
          }
        }
        _line = state.line;
        _lineStart = state.lineStart;
        _pos = state.position;
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        keyTag = state.tag;
        keyNode = state.result;
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if ((isExplicitPair || state.line === _line) && ch === 58) {
          isPair = true;
          ch = state.input.charCodeAt(++state.position);
          skipSeparationSpace(state, true, nodeIndent);
          composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
          valueNode = state.result;
        }
        if (isMapping) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
        } else if (isPair) {
          _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
        } else {
          _result.push(keyNode);
        }
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === 44) {
          readNext = true;
          ch = state.input.charCodeAt(++state.position);
        } else {
          readNext = false;
        }
      }
      throwError(state, "unexpected end of the stream within a flow collection");
    }
    function readBlockScalar(state, nodeIndent) {
      let folding;
      let chomping = CHOMPING_CLIP;
      let didReadContent = false;
      let detectedIndent = false;
      let textIndent = nodeIndent;
      let emptyLines = 0;
      let atMoreIndented = false;
      let tmp;
      let ch = state.input.charCodeAt(state.position);
      if (ch === 124) {
        folding = false;
      } else if (ch === 62) {
        folding = true;
      } else {
        return false;
      }
      state.kind = "scalar";
      state.result = "";
      while (ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
        if (ch === 43 || ch === 45) {
          if (CHOMPING_CLIP === chomping) {
            chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
          } else {
            throwError(state, "repeat of a chomping mode identifier");
          }
        } else if ((tmp = fromDecimalCode(ch)) >= 0) {
          if (tmp === 0) {
            throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
          } else if (!detectedIndent) {
            textIndent = nodeIndent + tmp - 1;
            detectedIndent = true;
          } else {
            throwError(state, "repeat of an indentation width identifier");
          }
        } else {
          break;
        }
      }
      if (isWhiteSpace(ch)) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (isWhiteSpace(ch));
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (!isEol(ch) && ch !== 0);
        }
      }
      while (ch !== 0) {
        readLineBreak(state);
        state.lineIndent = 0;
        ch = state.input.charCodeAt(state.position);
        while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
        if (!detectedIndent && state.lineIndent > textIndent) {
          textIndent = state.lineIndent;
        }
        if (isEol(ch)) {
          emptyLines++;
          continue;
        }
        if (!detectedIndent && textIndent === 0) {
          throwError(state, "missing indentation for block scalar");
        }
        if (state.lineIndent < textIndent) {
          if (chomping === CHOMPING_KEEP) {
            state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          } else if (chomping === CHOMPING_CLIP) {
            if (didReadContent) {
              state.result += "\n";
            }
          }
          break;
        }
        if (folding) {
          if (isWhiteSpace(ch)) {
            atMoreIndented = true;
            state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          } else if (atMoreIndented) {
            atMoreIndented = false;
            state.result += common.repeat("\n", emptyLines + 1);
          } else if (emptyLines === 0) {
            if (didReadContent) {
              state.result += " ";
            }
          } else {
            state.result += common.repeat("\n", emptyLines);
          }
        } else {
          state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        }
        didReadContent = true;
        detectedIndent = true;
        emptyLines = 0;
        const captureStart = state.position;
        while (!isEol(ch) && ch !== 0) {
          ch = state.input.charCodeAt(++state.position);
        }
        captureSegment(state, captureStart, state.position, false);
      }
      return true;
    }
    function readBlockSequence(state, nodeIndent) {
      const _tag = state.tag;
      const _anchor = state.anchor;
      const _result = [];
      let detected = false;
      if (state.firstTabInLine !== -1) return false;
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, _result);
      }
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (state.firstTabInLine !== -1) {
          state.position = state.firstTabInLine;
          throwError(state, "tab characters must not be used in indentation");
        }
        if (ch !== 45) {
          break;
        }
        const following = state.input.charCodeAt(state.position + 1);
        if (!isWsOrEol(following)) {
          break;
        }
        detected = true;
        state.position++;
        if (skipSeparationSpace(state, true, -1)) {
          if (state.lineIndent <= nodeIndent) {
            _result.push(null);
            ch = state.input.charCodeAt(state.position);
            continue;
          }
        }
        const _line = state.line;
        composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
        _result.push(state.result);
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
          throwError(state, "bad indentation of a sequence entry");
        } else if (state.lineIndent < nodeIndent) {
          break;
        }
      }
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "sequence";
        state.result = _result;
        return true;
      }
      return false;
    }
    function readBlockMapping(state, nodeIndent, flowIndent) {
      let allowCompact;
      let _keyLine;
      let _keyLineStart;
      let _keyPos;
      const _tag = state.tag;
      const _anchor = state.anchor;
      const _result = {};
      const overridableKeys = /* @__PURE__ */ Object.create(null);
      let keyTag = null;
      let keyNode = null;
      let valueNode = null;
      let atExplicitKey = false;
      let detected = false;
      if (state.firstTabInLine !== -1) return false;
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, _result);
      }
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (!atExplicitKey && state.firstTabInLine !== -1) {
          state.position = state.firstTabInLine;
          throwError(state, "tab characters must not be used in indentation");
        }
        const following = state.input.charCodeAt(state.position + 1);
        const _line = state.line;
        if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
          if (ch === 63) {
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = true;
            allowCompact = true;
          } else if (atExplicitKey) {
            atExplicitKey = false;
            allowCompact = true;
          } else {
            throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
          }
          state.position += 1;
          ch = following;
        } else {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
          if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
            break;
          }
          if (state.line === _line) {
            ch = state.input.charCodeAt(state.position);
            while (isWhiteSpace(ch)) {
              ch = state.input.charCodeAt(++state.position);
            }
            if (ch === 58) {
              ch = state.input.charCodeAt(++state.position);
              if (!isWsOrEol(ch)) {
                throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
              }
              if (atExplicitKey) {
                storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
                keyTag = keyNode = valueNode = null;
              }
              detected = true;
              atExplicitKey = false;
              allowCompact = false;
              keyTag = state.tag;
              keyNode = state.result;
            } else if (detected) {
              throwError(state, "can not read an implicit mapping pair; a colon is missed");
            } else {
              state.tag = _tag;
              state.anchor = _anchor;
              return true;
            }
          } else if (detected) {
            throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        }
        if (state.line === _line || state.lineIndent > nodeIndent) {
          if (atExplicitKey) {
            _keyLine = state.line;
            _keyLineStart = state.lineStart;
            _keyPos = state.position;
          }
          if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
            if (atExplicitKey) {
              keyNode = state.result;
            } else {
              valueNode = state.result;
            }
          }
          if (!atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          skipSeparationSpace(state, true, -1);
          ch = state.input.charCodeAt(state.position);
        }
        if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
          throwError(state, "bad indentation of a mapping entry");
        } else if (state.lineIndent < nodeIndent) {
          break;
        }
      }
      if (atExplicitKey) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
      }
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "mapping";
        state.result = _result;
      }
      return detected;
    }
    function readTagProperty(state) {
      let isVerbatim = false;
      let isNamed = false;
      let tagHandle;
      let tagName;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 33) return false;
      if (state.tag !== null) {
        throwError(state, "duplication of a tag property");
      }
      ch = state.input.charCodeAt(++state.position);
      if (ch === 60) {
        isVerbatim = true;
        ch = state.input.charCodeAt(++state.position);
      } else if (ch === 33) {
        isNamed = true;
        tagHandle = "!!";
        ch = state.input.charCodeAt(++state.position);
      } else {
        tagHandle = "!";
      }
      let _position = state.position;
      if (isVerbatim) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 0 && ch !== 62);
        if (state.position < state.length) {
          tagName = state.input.slice(_position, state.position);
          ch = state.input.charCodeAt(++state.position);
        } else {
          throwError(state, "unexpected end of the stream within a verbatim tag");
        }
      } else {
        while (ch !== 0 && !isWsOrEol(ch)) {
          if (ch === 33) {
            if (!isNamed) {
              tagHandle = state.input.slice(_position - 1, state.position + 1);
              if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
                throwError(state, "named tag handle cannot contain such characters");
              }
              isNamed = true;
              _position = state.position + 1;
            } else {
              throwError(state, "tag suffix cannot contain exclamation marks");
            }
          }
          ch = state.input.charCodeAt(++state.position);
        }
        tagName = state.input.slice(_position, state.position);
        if (PATTERN_FLOW_INDICATORS.test(tagName)) {
          throwError(state, "tag suffix cannot contain flow indicator characters");
        }
      }
      if (tagName && !PATTERN_TAG_URI.test(tagName)) {
        throwError(state, "tag name cannot contain such characters: " + tagName);
      }
      try {
        tagName = decodeURIComponent(tagName);
      } catch (err) {
        throwError(state, "tag name is malformed: " + tagName);
      }
      if (isVerbatim) {
        state.tag = tagName;
      } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
        state.tag = state.tagMap[tagHandle] + tagName;
      } else if (tagHandle === "!") {
        state.tag = "!" + tagName;
      } else if (tagHandle === "!!") {
        state.tag = "tag:yaml.org,2002:" + tagName;
      } else {
        throwError(state, 'undeclared tag handle "' + tagHandle + '"');
      }
      return true;
    }
    function readAnchorProperty(state) {
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 38) return false;
      if (state.anchor !== null) {
        throwError(state, "duplication of an anchor property");
      }
      ch = state.input.charCodeAt(++state.position);
      const _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an anchor node must contain at least one character");
      }
      state.anchor = state.input.slice(_position, state.position);
      return true;
    }
    function readAlias(state) {
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 42) return false;
      ch = state.input.charCodeAt(++state.position);
      const _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      if (state.position === _position) {
        throwError(state, "name of an alias node must contain at least one character");
      }
      const alias = state.input.slice(_position, state.position);
      if (!_hasOwnProperty.call(state.anchorMap, alias)) {
        throwError(state, 'unidentified alias "' + alias + '"');
      }
      state.result = state.anchorMap[alias];
      skipSeparationSpace(state, true, -1);
      return true;
    }
    function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
      const fallbackState = snapshotState(state);
      beginAnchorTransaction(state);
      restoreState(state, propertyStart);
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
        commitAnchorTransaction(state);
        return true;
      }
      rollbackAnchorTransaction(state);
      restoreState(state, fallbackState);
      return false;
    }
    function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
      let allowBlockScalars;
      let allowBlockCollections;
      let indentStatus = 1;
      let atNewLine = false;
      let hasContent = false;
      let propertyStart = null;
      let type;
      let flowIndent;
      let blockIndent;
      if (state.depth >= state.maxDepth) {
        throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
      }
      state.depth += 1;
      if (state.listener !== null) {
        state.listener("open", state);
      }
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
      if (allowToSeek) {
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        }
      }
      if (indentStatus === 1) {
        while (true) {
          const ch = state.input.charCodeAt(state.position);
          const propertyState = snapshotState(state);
          if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) {
            break;
          }
          if (!readTagProperty(state) && !readAnchorProperty(state)) {
            break;
          }
          if (propertyStart === null) {
            propertyStart = propertyState;
          }
          if (skipSeparationSpace(state, true, -1)) {
            atNewLine = true;
            allowBlockCollections = allowBlockStyles;
            if (state.lineIndent > parentIndent) {
              indentStatus = 1;
            } else if (state.lineIndent === parentIndent) {
              indentStatus = 0;
            } else if (state.lineIndent < parentIndent) {
              indentStatus = -1;
            }
          } else {
            allowBlockCollections = false;
          }
        }
      }
      if (allowBlockCollections) {
        allowBlockCollections = atNewLine || allowCompact;
      }
      if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
        if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
          flowIndent = parentIndent;
        } else {
          flowIndent = parentIndent + 1;
        }
        blockIndent = state.position - state.lineStart;
        if (indentStatus === 1) {
          if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
            hasContent = true;
          } else {
            const ch = state.input.charCodeAt(state.position);
            if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(
              state,
              propertyStart,
              propertyStart.position - propertyStart.lineStart,
              flowIndent
            )) {
              hasContent = true;
            } else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
              hasContent = true;
            } else if (readAlias(state)) {
              hasContent = true;
              if (state.tag !== null || state.anchor !== null) {
                throwError(state, "alias node should not have any properties");
              }
            } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
              hasContent = true;
              if (state.tag === null) {
                state.tag = "?";
              }
            }
            if (state.anchor !== null) {
              storeAnchor(state, state.anchor, state.result);
            }
          }
        } else if (indentStatus === 0) {
          hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
        }
      }
      if (state.tag === null) {
        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result);
        }
      } else if (state.tag === "?") {
        if (state.result !== null && state.kind !== "scalar") {
          throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
        }
        for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
          type = state.implicitTypes[typeIndex];
          if (type.resolve(state.result)) {
            state.result = type.construct(state.result);
            state.tag = type.tag;
            if (state.anchor !== null) {
              storeAnchor(state, state.anchor, state.result);
            }
            break;
          }
        }
      } else if (state.tag !== "!") {
        if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
          type = state.typeMap[state.kind || "fallback"][state.tag];
        } else {
          type = null;
          const typeList = state.typeMap.multi[state.kind || "fallback"];
          for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
            if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
              type = typeList[typeIndex];
              break;
            }
          }
        }
        if (!type) {
          throwError(state, "unknown tag !<" + state.tag + ">");
        }
        if (state.result !== null && type.kind !== state.kind) {
          throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"');
        }
        if (!type.resolve(state.result, state.tag)) {
          throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
        } else {
          state.result = type.construct(state.result, state.tag);
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
        }
      }
      if (state.listener !== null) {
        state.listener("close", state);
      }
      state.depth -= 1;
      return state.tag !== null || state.anchor !== null || hasContent;
    }
    function readDocument(state) {
      const documentStart = state.position;
      let hasDirectives = false;
      let ch;
      state.version = null;
      state.checkLineBreaks = state.legacy;
      state.tagMap = /* @__PURE__ */ Object.create(null);
      state.anchorMap = /* @__PURE__ */ Object.create(null);
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if (state.lineIndent > 0 || ch !== 37) {
          break;
        }
        hasDirectives = true;
        ch = state.input.charCodeAt(++state.position);
        let _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        const directiveName = state.input.slice(_position, state.position);
        const directiveArgs = [];
        if (directiveName.length < 1) {
          throwError(state, "directive name must not be less than one character in length");
        }
        while (ch !== 0) {
          while (isWhiteSpace(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 35) {
            do {
              ch = state.input.charCodeAt(++state.position);
            } while (ch !== 0 && !isEol(ch));
            break;
          }
          if (isEol(ch)) break;
          _position = state.position;
          while (ch !== 0 && !isWsOrEol(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          directiveArgs.push(state.input.slice(_position, state.position));
        }
        if (ch !== 0) readLineBreak(state);
        if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
          directiveHandlers[directiveName](state, directiveName, directiveArgs);
        } else {
          throwWarning(state, 'unknown document directive "' + directiveName + '"');
        }
      }
      skipSeparationSpace(state, true, -1);
      if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      } else if (hasDirectives) {
        throwError(state, "directives end mark is expected");
      }
      composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
      skipSeparationSpace(state, true, -1);
      if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
        throwWarning(state, "non-ASCII line breaks are interpreted as content");
      }
      state.documents.push(state.result);
      if (state.position === state.lineStart && testDocumentSeparator(state)) {
        if (state.input.charCodeAt(state.position) === 46) {
          state.position += 3;
          skipSeparationSpace(state, true, -1);
        }
        return;
      }
      if (state.position < state.length - 1) {
        throwError(state, "end of the stream or a document separator is expected");
      }
    }
    function loadDocuments(input, options) {
      input = String(input);
      options = options || {};
      if (input.length !== 0) {
        if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
          input += "\n";
        }
        if (input.charCodeAt(0) === 65279) {
          input = input.slice(1);
        }
      }
      const state = new State(input, options);
      const nullpos = input.indexOf("\0");
      if (nullpos !== -1) {
        state.position = nullpos;
        throwError(state, "null byte is not allowed in input");
      }
      state.input += "\0";
      while (state.input.charCodeAt(state.position) === 32) {
        state.lineIndent += 1;
        state.position += 1;
      }
      while (state.position < state.length - 1) {
        readDocument(state);
      }
      return state.documents;
    }
    function loadAll(input, iterator, options) {
      if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
        options = iterator;
        iterator = null;
      }
      const documents = loadDocuments(input, options);
      if (typeof iterator !== "function") {
        return documents;
      }
      for (let index = 0, length = documents.length; index < length; index += 1) {
        iterator(documents[index]);
      }
    }
    function load(input, options) {
      const documents = loadDocuments(input, options);
      if (documents.length === 0) {
        return void 0;
      } else if (documents.length === 1) {
        return documents[0];
      }
      throw new YAMLException("expected a single document in the stream, but found more");
    }
    module2.exports.loadAll = loadAll;
    module2.exports.load = load;
  }
});

// node_modules/js-yaml/lib/dumper.js
var require_dumper = __commonJS({
  "node_modules/js-yaml/lib/dumper.js"(exports2, module2) {
    "use strict";
    var common = require_common();
    var YAMLException = require_exception();
    var DEFAULT_SCHEMA = require_default();
    var _toString = Object.prototype.toString;
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var CHAR_BOM = 65279;
    var CHAR_TAB = 9;
    var CHAR_LINE_FEED = 10;
    var CHAR_CARRIAGE_RETURN = 13;
    var CHAR_SPACE = 32;
    var CHAR_EXCLAMATION = 33;
    var CHAR_DOUBLE_QUOTE = 34;
    var CHAR_SHARP = 35;
    var CHAR_PERCENT = 37;
    var CHAR_AMPERSAND = 38;
    var CHAR_SINGLE_QUOTE = 39;
    var CHAR_ASTERISK = 42;
    var CHAR_COMMA = 44;
    var CHAR_MINUS = 45;
    var CHAR_COLON = 58;
    var CHAR_EQUALS = 61;
    var CHAR_GREATER_THAN = 62;
    var CHAR_QUESTION = 63;
    var CHAR_COMMERCIAL_AT = 64;
    var CHAR_LEFT_SQUARE_BRACKET = 91;
    var CHAR_RIGHT_SQUARE_BRACKET = 93;
    var CHAR_GRAVE_ACCENT = 96;
    var CHAR_LEFT_CURLY_BRACKET = 123;
    var CHAR_VERTICAL_LINE = 124;
    var CHAR_RIGHT_CURLY_BRACKET = 125;
    var ESCAPE_SEQUENCES = {};
    ESCAPE_SEQUENCES[0] = "\\0";
    ESCAPE_SEQUENCES[7] = "\\a";
    ESCAPE_SEQUENCES[8] = "\\b";
    ESCAPE_SEQUENCES[9] = "\\t";
    ESCAPE_SEQUENCES[10] = "\\n";
    ESCAPE_SEQUENCES[11] = "\\v";
    ESCAPE_SEQUENCES[12] = "\\f";
    ESCAPE_SEQUENCES[13] = "\\r";
    ESCAPE_SEQUENCES[27] = "\\e";
    ESCAPE_SEQUENCES[34] = '\\"';
    ESCAPE_SEQUENCES[92] = "\\\\";
    ESCAPE_SEQUENCES[133] = "\\N";
    ESCAPE_SEQUENCES[160] = "\\_";
    ESCAPE_SEQUENCES[8232] = "\\L";
    ESCAPE_SEQUENCES[8233] = "\\P";
    var DEPRECATED_BOOLEANS_SYNTAX = [
      "y",
      "Y",
      "yes",
      "Yes",
      "YES",
      "on",
      "On",
      "ON",
      "n",
      "N",
      "no",
      "No",
      "NO",
      "off",
      "Off",
      "OFF"
    ];
    var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
    function compileStyleMap(schema, map) {
      if (map === null) return {};
      const result = {};
      const keys = Object.keys(map);
      for (let index = 0, length = keys.length; index < length; index += 1) {
        let tag = keys[index];
        let style = String(map[tag]);
        if (tag.slice(0, 2) === "!!") {
          tag = "tag:yaml.org,2002:" + tag.slice(2);
        }
        const type = schema.compiledTypeMap["fallback"][tag];
        if (type && _hasOwnProperty.call(type.styleAliases, style)) {
          style = type.styleAliases[style];
        }
        result[tag] = style;
      }
      return result;
    }
    function encodeHex(character) {
      let handle;
      let length;
      const string = character.toString(16).toUpperCase();
      if (character <= 255) {
        handle = "x";
        length = 2;
      } else if (character <= 65535) {
        handle = "u";
        length = 4;
      } else if (character <= 4294967295) {
        handle = "U";
        length = 8;
      } else {
        throw new YAMLException("code point within a string may not be greater than 0xFFFFFFFF");
      }
      return "\\" + handle + common.repeat("0", length - string.length) + string;
    }
    var QUOTING_TYPE_SINGLE = 1;
    var QUOTING_TYPE_DOUBLE = 2;
    function State(options) {
      this.schema = options["schema"] || DEFAULT_SCHEMA;
      this.indent = Math.max(1, options["indent"] || 2);
      this.noArrayIndent = options["noArrayIndent"] || false;
      this.skipInvalid = options["skipInvalid"] || false;
      this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
      this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
      this.sortKeys = options["sortKeys"] || false;
      this.lineWidth = options["lineWidth"] || 80;
      this.noRefs = options["noRefs"] || false;
      this.noCompatMode = options["noCompatMode"] || false;
      this.condenseFlow = options["condenseFlow"] || false;
      this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
      this.forceQuotes = options["forceQuotes"] || false;
      this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
      this.implicitTypes = this.schema.compiledImplicit;
      this.explicitTypes = this.schema.compiledExplicit;
      this.tag = null;
      this.result = "";
      this.duplicates = [];
      this.usedDuplicates = null;
    }
    function indentString(string, spaces) {
      const ind = common.repeat(" ", spaces);
      let position = 0;
      let result = "";
      const length = string.length;
      while (position < length) {
        let line;
        const next = string.indexOf("\n", position);
        if (next === -1) {
          line = string.slice(position);
          position = length;
        } else {
          line = string.slice(position, next + 1);
          position = next + 1;
        }
        if (line.length && line !== "\n") result += ind;
        result += line;
      }
      return result;
    }
    function generateNextLine(state, level) {
      return "\n" + common.repeat(" ", state.indent * level);
    }
    function testImplicitResolving(state, str) {
      for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
        const type = state.implicitTypes[index];
        if (type.resolve(str)) {
          return true;
        }
      }
      return false;
    }
    function isWhitespace(c) {
      return c === CHAR_SPACE || c === CHAR_TAB;
    }
    function isPrintable(c) {
      return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
    }
    function isNsCharOrWhitespace(c) {
      return isPrintable(c) && c !== CHAR_BOM && // - b-char
      c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
    }
    function isPlainSafe(c, prev, inblock) {
      const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
      const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
      return (
        // ns-plain-safe
        (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && // - c-flow-indicator
        c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && // ns-plain-char
        c !== CHAR_SHARP && // false on '#'
        !(prev === CHAR_COLON && !cIsNsChar) || // false on ': '
        isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || // change to true on '[^ ]#'
        prev === CHAR_COLON && cIsNsChar
      );
    }
    function isPlainSafeFirst(c) {
      return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && // - s-white
      // - (c-indicator ::=
      // “-” | “?” | “:” | “,” | “[” | “]” | “{” | “}”
      c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && // | “#” | “&” | “*” | “!” | “|” | “=” | “>” | “'” | “"”
      c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && // | “%” | “@” | “`”)
      c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
    }
    function isPlainSafeLast(c) {
      return !isWhitespace(c) && c !== CHAR_COLON;
    }
    function codePointAt(string, pos) {
      const first = string.charCodeAt(pos);
      let second;
      if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
        second = string.charCodeAt(pos + 1);
        if (second >= 56320 && second <= 57343) {
          return (first - 55296) * 1024 + second - 56320 + 65536;
        }
      }
      return first;
    }
    function needIndentIndicator(string) {
      const leadingSpaceRe = /^\n* /;
      return leadingSpaceRe.test(string);
    }
    var STYLE_PLAIN = 1;
    var STYLE_SINGLE = 2;
    var STYLE_LITERAL = 3;
    var STYLE_FOLDED = 4;
    var STYLE_DOUBLE = 5;
    function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
      let i;
      let char = 0;
      let prevChar = null;
      let hasLineBreak = false;
      let hasFoldableLine = false;
      const shouldTrackWidth = lineWidth !== -1;
      let previousLineBreak = -1;
      let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
      if (singleLineOnly || forceQuotes) {
        for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
          char = codePointAt(string, i);
          if (!isPrintable(char)) {
            return STYLE_DOUBLE;
          }
          plain = plain && isPlainSafe(char, prevChar, inblock);
          prevChar = char;
        }
      } else {
        for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
          char = codePointAt(string, i);
          if (char === CHAR_LINE_FEED) {
            hasLineBreak = true;
            if (shouldTrackWidth) {
              hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
              i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
              previousLineBreak = i;
            }
          } else if (!isPrintable(char)) {
            return STYLE_DOUBLE;
          }
          plain = plain && isPlainSafe(char, prevChar, inblock);
          prevChar = char;
        }
        hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
      }
      if (!hasLineBreak && !hasFoldableLine) {
        if (plain && !forceQuotes && !testAmbiguousType(string)) {
          return STYLE_PLAIN;
        }
        return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
      }
      if (indentPerLevel > 9 && needIndentIndicator(string)) {
        return STYLE_DOUBLE;
      }
      if (!forceQuotes) {
        return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
      }
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    function writeScalar(state, string, level, iskey, inblock) {
      state.dump = (function() {
        if (string.length === 0) {
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
        }
        if (!state.noCompatMode) {
          if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
            return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
          }
        }
        const indent = state.indent * Math.max(1, level);
        const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
        const singleLineOnly = iskey || // No block styles in flow mode.
        state.flowLevel > -1 && level >= state.flowLevel;
        function testAmbiguity(string2) {
          return testImplicitResolving(state, string2);
        }
        switch (chooseScalarStyle(
          string,
          singleLineOnly,
          state.indent,
          lineWidth,
          testAmbiguity,
          state.quotingType,
          state.forceQuotes && !iskey,
          inblock
        )) {
          case STYLE_PLAIN:
            return string;
          case STYLE_SINGLE:
            return "'" + string.replace(/'/g, "''") + "'";
          case STYLE_LITERAL:
            return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
          case STYLE_FOLDED:
            return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
          case STYLE_DOUBLE:
            return '"' + escapeString(string, lineWidth) + '"';
          default:
            throw new YAMLException("impossible error: invalid scalar style");
        }
      })();
    }
    function blockHeader(string, indentPerLevel) {
      const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
      const clip = string[string.length - 1] === "\n";
      const keep = clip && (string[string.length - 2] === "\n" || string === "\n");
      const chomp = keep ? "+" : clip ? "" : "-";
      return indentIndicator + chomp + "\n";
    }
    function dropEndingNewline(string) {
      return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
    }
    function foldString(string, width) {
      const lineRe = /(\n+)([^\n]*)/g;
      let result = (function() {
        let nextLF = string.indexOf("\n");
        nextLF = nextLF !== -1 ? nextLF : string.length;
        lineRe.lastIndex = nextLF;
        return foldLine(string.slice(0, nextLF), width);
      })();
      let prevMoreIndented = string[0] === "\n" || string[0] === " ";
      let moreIndented;
      let match;
      while (match = lineRe.exec(string)) {
        const prefix = match[1];
        const line = match[2];
        moreIndented = line[0] === " ";
        result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
        prevMoreIndented = moreIndented;
      }
      return result;
    }
    function foldLine(line, width) {
      if (line === "" || line[0] === " ") return line;
      const breakRe = / [^ ]/g;
      let match;
      let start = 0;
      let end;
      let curr = 0;
      let next = 0;
      let result = "";
      while (match = breakRe.exec(line)) {
        next = match.index;
        if (next - start > width) {
          end = curr > start ? curr : next;
          result += "\n" + line.slice(start, end);
          start = end + 1;
        }
        curr = next;
      }
      result += "\n";
      if (line.length - start > width && curr > start) {
        result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
      } else {
        result += line.slice(start);
      }
      return result.slice(1);
    }
    function escapeString(string) {
      let result = "";
      let char = 0;
      for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        const escapeSeq = ESCAPE_SEQUENCES[char];
        if (!escapeSeq && isPrintable(char)) {
          result += string[i];
          if (char >= 65536) result += string[i + 1];
        } else {
          result += escapeSeq || encodeHex(char);
        }
      }
      return result;
    }
    function writeFlowSequence(state, level, object) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object.length; index < length; index += 1) {
        let value = object[index];
        if (state.replacer) {
          value = state.replacer.call(object, String(index), value);
        }
        if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
          if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = "[" + _result + "]";
    }
    function writeBlockSequence(state, level, object, compact) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object.length; index < length; index += 1) {
        let value = object[index];
        if (state.replacer) {
          value = state.replacer.call(object, String(index), value);
        }
        if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
          if (!compact || _result !== "") {
            _result += generateNextLine(state, level);
          }
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
            _result += "-";
          } else {
            _result += "- ";
          }
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = _result || "[]";
    }
    function writeFlowMapping(state, level, object) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object);
      for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
        let pairBuffer = "";
        if (_result !== "") pairBuffer += ", ";
        if (state.condenseFlow) pairBuffer += '"';
        const objectKey = objectKeyList[index];
        let objectValue = object[objectKey];
        if (state.replacer) {
          objectValue = state.replacer.call(object, objectKey, objectValue);
        }
        if (!writeNode(state, level, objectKey, false, false)) {
          continue;
        }
        if (state.dump.length > 1024) pairBuffer += "? ";
        pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
        if (!writeNode(state, level, objectValue, false, false)) {
          continue;
        }
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = "{" + _result + "}";
    }
    function writeBlockMapping(state, level, object, compact) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object);
      if (state.sortKeys === true) {
        objectKeyList.sort();
      } else if (typeof state.sortKeys === "function") {
        objectKeyList.sort(state.sortKeys);
      } else if (state.sortKeys) {
        throw new YAMLException("sortKeys must be a boolean or a function");
      }
      for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
        let pairBuffer = "";
        if (!compact || _result !== "") {
          pairBuffer += generateNextLine(state, level);
        }
        const objectKey = objectKeyList[index];
        let objectValue = object[objectKey];
        if (state.replacer) {
          objectValue = state.replacer.call(object, objectKey, objectValue);
        }
        if (!writeNode(state, level + 1, objectKey, true, true, true)) {
          continue;
        }
        const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
        if (explicitPair) {
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
            pairBuffer += "?";
          } else {
            pairBuffer += "? ";
          }
        }
        pairBuffer += state.dump;
        if (explicitPair) {
          pairBuffer += generateNextLine(state, level);
        }
        if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
          continue;
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += ":";
        } else {
          pairBuffer += ": ";
        }
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = _result || "{}";
    }
    function detectType(state, object, explicit) {
      const typeList = explicit ? state.explicitTypes : state.implicitTypes;
      for (let index = 0, length = typeList.length; index < length; index += 1) {
        const type = typeList[index];
        if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object === "object" && object instanceof type.instanceOf) && (!type.predicate || type.predicate(object))) {
          if (explicit) {
            if (type.multi && type.representName) {
              state.tag = type.representName(object);
            } else {
              state.tag = type.tag;
            }
          } else {
            state.tag = "?";
          }
          if (type.represent) {
            const style = state.styleMap[type.tag] || type.defaultStyle;
            let _result;
            if (_toString.call(type.represent) === "[object Function]") {
              _result = type.represent(object, style);
            } else if (_hasOwnProperty.call(type.represent, style)) {
              _result = type.represent[style](object, style);
            } else {
              throw new YAMLException("!<" + type.tag + '> tag resolver accepts not "' + style + '" style');
            }
            state.dump = _result;
          }
          return true;
        }
      }
      return false;
    }
    function writeNode(state, level, object, block, compact, iskey, isblockseq) {
      state.tag = null;
      state.dump = object;
      if (!detectType(state, object, false)) {
        detectType(state, object, true);
      }
      const type = _toString.call(state.dump);
      const inblock = block;
      if (block) {
        block = state.flowLevel < 0 || state.flowLevel > level;
      }
      const objectOrArray = type === "[object Object]" || type === "[object Array]";
      let duplicateIndex;
      let duplicate;
      if (objectOrArray) {
        duplicateIndex = state.duplicates.indexOf(object);
        duplicate = duplicateIndex !== -1;
      }
      if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
        compact = false;
      }
      if (duplicate && state.usedDuplicates[duplicateIndex]) {
        state.dump = "*ref_" + duplicateIndex;
      } else {
        if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
          state.usedDuplicates[duplicateIndex] = true;
        }
        if (type === "[object Object]") {
          if (block && Object.keys(state.dump).length !== 0) {
            writeBlockMapping(state, level, state.dump, compact);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + state.dump;
            }
          } else {
            writeFlowMapping(state, level, state.dump);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + " " + state.dump;
            }
          }
        } else if (type === "[object Array]") {
          if (block && state.dump.length !== 0) {
            if (state.noArrayIndent && !isblockseq && level > 0) {
              writeBlockSequence(state, level - 1, state.dump, compact);
            } else {
              writeBlockSequence(state, level, state.dump, compact);
            }
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + state.dump;
            }
          } else {
            writeFlowSequence(state, level, state.dump);
            if (duplicate) {
              state.dump = "&ref_" + duplicateIndex + " " + state.dump;
            }
          }
        } else if (type === "[object String]") {
          if (state.tag !== "?") {
            writeScalar(state, state.dump, level, iskey, inblock);
          }
        } else if (type === "[object Undefined]") {
          return false;
        } else {
          if (state.skipInvalid) return false;
          throw new YAMLException("unacceptable kind of an object to dump " + type);
        }
        if (state.tag !== null && state.tag !== "?") {
          let tagStr = encodeURI(
            state.tag[0] === "!" ? state.tag.slice(1) : state.tag
          ).replace(/!/g, "%21");
          if (state.tag[0] === "!") {
            tagStr = "!" + tagStr;
          } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
            tagStr = "!!" + tagStr.slice(18);
          } else {
            tagStr = "!<" + tagStr + ">";
          }
          state.dump = tagStr + " " + state.dump;
        }
      }
      return true;
    }
    function getDuplicateReferences(object, state) {
      const objects = [];
      const duplicatesIndexes = [];
      inspectNode(object, objects, duplicatesIndexes);
      const length = duplicatesIndexes.length;
      for (let index = 0; index < length; index += 1) {
        state.duplicates.push(objects[duplicatesIndexes[index]]);
      }
      state.usedDuplicates = new Array(length);
    }
    function inspectNode(object, objects, duplicatesIndexes) {
      if (object !== null && typeof object === "object") {
        const index = objects.indexOf(object);
        if (index !== -1) {
          if (duplicatesIndexes.indexOf(index) === -1) {
            duplicatesIndexes.push(index);
          }
        } else {
          objects.push(object);
          if (Array.isArray(object)) {
            for (let i = 0, length = object.length; i < length; i += 1) {
              inspectNode(object[i], objects, duplicatesIndexes);
            }
          } else {
            const objectKeyList = Object.keys(object);
            for (let i = 0, length = objectKeyList.length; i < length; i += 1) {
              inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
            }
          }
        }
      }
    }
    function dump(input, options) {
      options = options || {};
      const state = new State(options);
      if (!state.noRefs) getDuplicateReferences(input, state);
      let value = input;
      if (state.replacer) {
        value = state.replacer.call({ "": value }, "", value);
      }
      if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
      return "";
    }
    module2.exports.dump = dump;
  }
});

// node_modules/js-yaml/index.js
var require_js_yaml = __commonJS({
  "node_modules/js-yaml/index.js"(exports2, module2) {
    "use strict";
    var loader = require_loader();
    var dumper = require_dumper();
    function renamed(from, to) {
      return function() {
        throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
      };
    }
    module2.exports.Type = require_type();
    module2.exports.Schema = require_schema();
    module2.exports.FAILSAFE_SCHEMA = require_failsafe();
    module2.exports.JSON_SCHEMA = require_json();
    module2.exports.CORE_SCHEMA = require_core();
    module2.exports.DEFAULT_SCHEMA = require_default();
    module2.exports.load = loader.load;
    module2.exports.loadAll = loader.loadAll;
    module2.exports.dump = dumper.dump;
    module2.exports.YAMLException = require_exception();
    module2.exports.types = {
      binary: require_binary(),
      float: require_float(),
      map: require_map(),
      null: require_null(),
      pairs: require_pairs(),
      set: require_set(),
      timestamp: require_timestamp(),
      bool: require_bool(),
      int: require_int(),
      merge: require_merge(),
      omap: require_omap(),
      seq: require_seq(),
      str: require_str()
    };
    module2.exports.safeLoad = renamed("safeLoad", "load");
    module2.exports.safeLoadAll = renamed("safeLoadAll", "loadAll");
    module2.exports.safeDump = renamed("safeDump", "dump");
  }
});

// ../src/modules/kernel/workflows/yaml-loader.ts
function pluginLocalScriptsRoots() {
  return [
    // Source/runtime TS layout: src/modules/kernel/workflows -> plugin/scripts.
    path2.resolve(__dirname, "..", "..", "..", "..", "scripts"),
    // Bundled hook layout: hooks/dist -> plugin/scripts.
    path2.resolve(__dirname, "..", "..", "scripts"),
    // Bundled agent-team hook layout: hooks/agent-team/dist -> plugin/scripts.
    path2.resolve(__dirname, "..", "..", "..", "scripts")
  ];
}
function tryScriptsRoot(scriptsRoot) {
  try {
    return require(require.resolve("js-yaml", { paths: [scriptsRoot] }));
  } catch {
    return null;
  }
}
function loadYamlApi() {
  const tried = [];
  for (const scriptsRoot of pluginLocalScriptsRoots()) {
    tried.push(scriptsRoot);
    const api2 = tryScriptsRoot(scriptsRoot);
    if (api2) return api2;
  }
  try {
    return require_js_yaml();
  } catch {
  }
  const cwdRoot = path2.resolve(process.cwd(), "scripts");
  tried.push(cwdRoot);
  const api = tryScriptsRoot(cwdRoot);
  if (api) return api;
  throw new Error(
    `Guild needs the js-yaml package and could not resolve it. Fix: npm install --prefix <plugin-root>/scripts (roots tried: ${tried.join(", ")})`
  );
}
var path2;
var init_yaml_loader = __esm({
  "../src/modules/kernel/workflows/yaml-loader.ts"() {
    path2 = __toESM(require("node:path"));
  }
});

// ../src/modules/kernel/workflows/identifier-tokenize.ts
var init_identifier_tokenize = __esm({
  "../src/modules/kernel/workflows/identifier-tokenize.ts"() {
  }
});

// ../src/modules/kernel/index.ts
var init_kernel = __esm({
  "../src/modules/kernel/index.ts"() {
    init_module_manifest();
    init_yaml_loader();
    init_identifier_tokenize();
  }
});

// ../src/modules/config/workflows/workspace-manifest.ts
function parseWorkspaceManifest(manifestPath) {
  let raw;
  try {
    if (!fs2.existsSync(manifestPath)) return { status: "absent" };
    raw = fs2.readFileSync(manifestPath, "utf8");
  } catch (e) {
    return { status: "parse_error", error: e instanceof Error ? e.message : String(e) };
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    return { status: "parse_error", error: e instanceof Error ? e.message : String(e) };
  }
  if (manifest && manifest.is_workspace === true) {
    return { status: "workspace", manifest };
  }
  return { status: "not_workspace" };
}
function discoverWorkspace(startDir) {
  let current = path3.dirname(startDir);
  const fsRoot = path3.parse(current).root;
  while (current !== fsRoot) {
    const manifestPath = path3.join(current, ".guild", "workspace.json");
    const parsed = parseWorkspaceManifest(manifestPath);
    if (parsed.status === "workspace") {
      return { rootDir: current, manifest: parsed.manifest };
    }
    if (parsed.status === "not_workspace") {
      return null;
    }
    const parent = path3.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
var fs2, path3;
var init_workspace_manifest = __esm({
  "../src/modules/config/workflows/workspace-manifest.ts"() {
    fs2 = __toESM(require("fs"));
    path3 = __toESM(require("path"));
  }
});

// ../src/modules/config/workflows/settings-reader.ts
function sparseRoles(raw) {
  const out = {};
  for (const k of ["host", "advisory", "adversarial"]) {
    const v = raw[k];
    if (v === null) out[k] = null;
    else if (typeof v === "string") {
      const normalized = normalizeHostId(v);
      if (normalized) out[k] = normalized;
    }
  }
  return out;
}
function sparseHostProfiles(raw) {
  return filterHostProfiles(raw);
}
function sparseTierHostMap(raw) {
  const out = {};
  for (const hk of Object.keys(raw)) {
    const canonicalHostId = normalizeHostId(hk);
    if (canonicalHostId) out[canonicalHostId] = raw[hk];
  }
  return out;
}
function normalizeDispatchHostId(value) {
  const normalized = normalizeHostId(value);
  return normalized && DISPATCH_HOST_IDS.has(normalized) ? normalized : null;
}
function isPlainObject2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge(base, overlay) {
  const result = Object.assign(/* @__PURE__ */ Object.create(null), base);
  for (const [k, v] of Object.entries(overlay)) {
    if (PROTO_POISON_KEYS.has(k)) continue;
    if (Array.isArray(v)) {
      result[k] = v;
    } else if (isPlainObject2(v) && isPlainObject2(result[k])) {
      result[k] = deepMerge(
        result[k],
        v
      );
    } else {
      result[k] = v;
    }
  }
  return { ...result };
}
function collectKeyPaths(obj, prefix = "") {
  const paths = /* @__PURE__ */ new Set();
  for (const [k, v] of Object.entries(obj)) {
    if (PROTO_POISON_KEYS.has(k)) continue;
    const full = prefix ? `${prefix}.${k}` : k;
    paths.add(full);
    if (isPlainObject2(v)) {
      for (const sub of collectKeyPaths(v, full)) {
        paths.add(sub);
      }
    }
  }
  return paths;
}
function validateLocalKeysOrThrow(localObj, baseObj) {
  const basePaths = collectKeyPaths(baseObj);
  for (const key of Object.keys(localObj)) {
    if (PROTO_POISON_KEYS.has(key)) {
      throw new Error(
        `share-dot-guild: settings.local.json key '${key}' is a dangerous prototype key \u2014 rejected.`
      );
    }
    if (key.startsWith("_")) continue;
    if (!basePaths.has(key)) {
      throw new Error(
        `share-dot-guild: settings.local.json key '${key}' not in settings.json schema \u2014 refusing to silently extend. Declare it in settings.json first (with the team default) or remove it from settings.local.json.`
      );
    }
  }
}
function rigorProfile(rigor) {
  switch (rigor) {
    case "quick":
      return { loops: "none", loop_cap: null, review: "off" };
    case "deep":
      return { loops: "all", loop_cap: 16, review: "cross" };
    case "standard":
    default:
      return { loops: "spec,plan", loop_cap: 16, review: "local" };
  }
}
function parseSettingsFile(filePath) {
  if (!fs3.existsSync(filePath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs3.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
  return parseSettingsFile_fromParsed(parsed);
}
function parseLocalFile(guildDir) {
  const localPath = path4.join(guildDir, "settings.local.json");
  if (!fs3.existsSync(localPath)) return {};
  let localParsed;
  try {
    localParsed = JSON.parse(fs3.readFileSync(localPath, "utf8"));
  } catch {
    return {};
  }
  validateLocalKeysOrThrow(localParsed, DEFAULTS2);
  return parseSettingsFile_fromParsed(localParsed);
}
function parseSettingsFile_fromParsed(parsed) {
  const out = {};
  if (VALID_RIGOR.has(parsed["rigor"]))
    out.rigor = parsed["rigor"];
  if (Array.isArray(parsed["auto_approve"]))
    out.auto_approve = parsed["auto_approve"];
  if (VALID_REVIEW.has(parsed["review"]))
    out.review = parsed["review"];
  if (parsed["host"] === "auto") out.host = "auto";
  else if (typeof parsed["host"] === "string") {
    const normalized = normalizeDispatchHostId(parsed["host"]);
    if (normalized) out.host = normalized;
  }
  if (parsed["host_mode"] === null) out.host_mode = null;
  else if (typeof parsed["host_mode"] === "string" && HOST_MODES.includes(parsed["host_mode"]))
    out.host_mode = parsed["host_mode"];
  if (isPlainObject2(parsed["roles"]))
    out.roles = sparseRoles(parsed["roles"]);
  if (isPlainObject2(parsed["host_profiles"]))
    out.host_profiles = sparseHostProfiles(parsed["host_profiles"]);
  if (parsed["initiative_default"] === null || typeof parsed["initiative_default"] === "string")
    out.initiative_default = parsed["initiative_default"];
  if (parsed["index"] === "auto" || parsed["index"] === "off")
    out.index = parsed["index"];
  if (typeof parsed["record_status_runs"] === "boolean")
    out.record_status_runs = parsed["record_status_runs"];
  if (parsed["codex_skip_enforcement"] === "warn" || parsed["codex_skip_enforcement"] === "block")
    out.codex_skip_enforcement = parsed["codex_skip_enforcement"];
  if (VALID_AGENT_MODE.has(parsed["agent_mode"]))
    out.agent_mode = parsed["agent_mode"];
  if (isPlainObject2(parsed["workspace"])) {
    const ws = parsed["workspace"];
    const wsMode = ws["mode"];
    if (wsMode === "auto" || wsMode === "on" || wsMode === "off") {
      out.workspace = { mode: wsMode };
    }
  }
  if (isPlainObject2(parsed["models"])) {
    const rawModels = parsed["models"];
    const sparse = {};
    if (typeof rawModels["enabled"] === "boolean") sparse.enabled = rawModels["enabled"];
    if (isPlainObject2(rawModels["tiers"])) {
      const rt = rawModels["tiers"];
      const sparseTiers = {};
      for (const tier of ["cheap", "mid", "powerful"]) {
        if (isPlainObject2(rt[tier])) sparseTiers[tier] = sparseTierHostMap(rt[tier]);
      }
      sparse.tiers = sparseTiers;
    }
    if (isPlainObject2(rawModels["scoreWeights"])) sparse.scoreWeights = rawModels["scoreWeights"];
    if (isPlainObject2(rawModels["thresholds"])) sparse.thresholds = rawModels["thresholds"];
    if (typeof rawModels["advisorRounds"] === "number" && rawModels["advisorRounds"] >= 1)
      sparse.advisorRounds = Math.floor(rawModels["advisorRounds"]);
    if (Array.isArray(rawModels["escalationMarkers"])) sparse.escalationMarkers = rawModels["escalationMarkers"];
    if (typeof rawModels["recallBeforeRead"] === "boolean") sparse.recallBeforeRead = rawModels["recallBeforeRead"];
    if (typeof rawModels["recallScoreThreshold"] === "number") sparse.recallScoreThreshold = rawModels["recallScoreThreshold"];
    if (typeof rawModels["structuredOutputRequired"] === "boolean") sparse.structuredOutputRequired = rawModels["structuredOutputRequired"];
    if (isPlainObject2(rawModels["cacheTTL"])) {
      const rttl = rawModels["cacheTTL"];
      const newTTL = {};
      if (VALID_CACHE_TTL.has(rttl["coordinator"])) newTTL.coordinator = rttl["coordinator"];
      if (VALID_CACHE_TTL.has(rttl["leaf"])) newTTL.leaf = rttl["leaf"];
      sparse.cacheTTL = newTTL;
    }
    if (typeof rawModels["importanceGate"] === "number" && rawModels["importanceGate"] >= 1 && rawModels["importanceGate"] <= 5)
      sparse.importanceGate = Math.floor(rawModels["importanceGate"]);
    if (typeof rawModels["compositeRecall"] === "boolean")
      sparse.compositeRecall = rawModels["compositeRecall"];
    if (typeof rawModels["importanceAtIngest"] === "boolean")
      sparse.importanceAtIngest = rawModels["importanceAtIngest"];
    if (typeof rawModels["ingestSimilarityGate"] === "number" && rawModels["ingestSimilarityGate"] >= 0 && rawModels["ingestSimilarityGate"] <= 1)
      sparse.ingestSimilarityGate = rawModels["ingestSimilarityGate"];
    if (isPlainObject2(rawModels["shortOutputThreshold"])) {
      const sot = rawModels["shortOutputThreshold"];
      const sotMerged = {};
      for (const taskType of Object.keys(sot)) {
        if (!isPlainObject2(sot[taskType])) continue;
        const innerRaw = sot[taskType];
        const innerMerged = {};
        for (const tier of Object.keys(innerRaw)) {
          if (typeof innerRaw[tier] === "number") innerMerged[tier] = innerRaw[tier];
        }
        if (Object.keys(innerMerged).length > 0) sotMerged[taskType] = innerMerged;
      }
      sparse.shortOutputThreshold = sotMerged;
    }
    if (isPlainObject2(rawModels["knowledge"])) {
      const rawK = rawModels["knowledge"];
      const sparseK = {};
      if (typeof rawK["maxDepth"] === "number" && rawK["maxDepth"] >= 1)
        sparseK.maxDepth = Math.floor(rawK["maxDepth"]);
      if (typeof rawK["maxBranching"] === "number" && rawK["maxBranching"] >= 1)
        sparseK.maxBranching = Math.floor(rawK["maxBranching"]);
      if (typeof rawK["minTopicImportance"] === "number" && rawK["minTopicImportance"] >= 0 && rawK["minTopicImportance"] <= 1)
        sparseK.minTopicImportance = rawK["minTopicImportance"];
      if (typeof rawK["relMinConf"] === "number" && rawK["relMinConf"] >= 0 && rawK["relMinConf"] <= 1)
        sparseK.relMinConf = rawK["relMinConf"];
      if (typeof rawK["maxFiles"] === "number" && rawK["maxFiles"] >= 1)
        sparseK.maxFiles = Math.floor(rawK["maxFiles"]);
      if (typeof rawK["maxTokens"] === "number" && rawK["maxTokens"] >= 1)
        sparseK.maxTokens = Math.floor(rawK["maxTokens"]);
      if (typeof rawK["batchSize"] === "number" && rawK["batchSize"] >= 1)
        sparseK.batchSize = Math.floor(rawK["batchSize"]);
      sparse.knowledge = sparseK;
    }
    out.models = sparse;
  }
  if (isPlainObject2(parsed["security"])) {
    const rawSec = parsed["security"];
    const sparseSec = {};
    const bpp = rawSec["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") sparseSec.bypass_permissions_policy = bpp;
    out.security = sparseSec;
  }
  if (isPlainObject2(parsed["secrets_policy"])) {
    const rawSp = parsed["secrets_policy"];
    const sparseSp = {};
    if (Array.isArray(rawSp["env_allowlist"])) sparseSp.env_allowlist = rawSp["env_allowlist"];
    if (Array.isArray(rawSp["redaction_patterns"])) sparseSp.redaction_patterns = rawSp["redaction_patterns"];
    if (rawSp["fail_mode_durable"] === "closed" || rawSp["fail_mode_durable"] === "open") sparseSp.fail_mode_durable = rawSp["fail_mode_durable"];
    if (rawSp["fail_mode_telemetry"] === "open" || rawSp["fail_mode_telemetry"] === "closed") sparseSp.fail_mode_telemetry = rawSp["fail_mode_telemetry"];
    out.secrets_policy = sparseSp;
  }
  if (isPlainObject2(parsed["mcp"])) {
    const rawMcp = parsed["mcp"];
    const sparseMcp = {};
    if (isPlainObject2(rawMcp["tool_description_hashes"]))
      sparseMcp.tool_description_hashes = rawMcp["tool_description_hashes"];
    if (typeof rawMcp["stdio_available"] === "boolean") sparseMcp.stdio_available = rawMcp["stdio_available"];
    if (typeof rawMcp["http_available"] === "boolean") sparseMcp.http_available = rawMcp["http_available"];
    if (rawMcp["bridge_package"] === null || typeof rawMcp["bridge_package"] === "string")
      sparseMcp.bridge_package = rawMcp["bridge_package"];
    out.mcp = sparseMcp;
  }
  if (typeof parsed["statusline"] === "boolean") out.statusline = parsed["statusline"];
  if (typeof parsed["adversarial_review_provider"] === "string") {
    out.adversarial_review_provider = parsed["adversarial_review_provider"];
  }
  if (typeof parsed["loops"] === "string" || parsed["loops"] === null)
    out.loops = parsed["loops"];
  if (typeof parsed["loop_cap"] === "number")
    out.loop_cap = Math.min(256, Math.max(1, parsed["loop_cap"]));
  if (typeof parsed["codex_cap"] === "number")
    out.codex_cap = Math.min(10, Math.max(1, parsed["codex_cap"]));
  if (isPlainObject2(parsed["defaults"])) {
    const rawDefaults = parsed["defaults"];
    const sparseDefaults = {};
    for (const k of Object.keys(rawDefaults)) {
      if (DEFAULTS_ALLOWED_KEYS.has(k)) sparseDefaults[k] = rawDefaults[k];
    }
    out.defaults = sparseDefaults;
  }
  return out;
}
function assembleLayers(layers, flagsLayer) {
  let accumulated = DEFAULTS2;
  for (const layer of layers) {
    if (Object.keys(layer).length === 0) continue;
    accumulated = deepMerge(accumulated, layer);
  }
  if (Object.keys(flagsLayer).length > 0) {
    accumulated = deepMerge(accumulated, flagsLayer);
  }
  return accumulated;
}
function crossHostAvailable() {
  const v = process.env["GUILD_CROSS_HOST_AVAILABLE"];
  if (v === void 0) return true;
  const s = v.trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "no" || s === "off");
}
function isValidInitiativeId(id) {
  if (!id || !id.trim()) return false;
  if (id.includes("\0")) return false;
  if (id.startsWith("/") || id.startsWith("\\")) return false;
  if (id.includes("/") || id.includes("\\")) return false;
  if (id === ".") return false;
  if (id === ".." || id.startsWith("..")) return false;
  if (id.includes("..")) return false;
  return true;
}
function isContainedIn(candidatePath, baseDir) {
  const resolved = path4.resolve(candidatePath);
  const resolvedBase = path4.resolve(baseDir);
  return resolved.startsWith(resolvedBase + path4.sep);
}
function initiativeIsWorkspaceScoped(workspaceRoot, id) {
  try {
    if (!isValidInitiativeId(id)) return false;
    const registryPath = path4.join(
      workspaceRoot,
      ".guild",
      "indexes",
      "initiatives-registry.yaml"
    );
    if (fs3.existsSync(registryPath)) {
      try {
        const raw = fs3.readFileSync(registryPath, "utf8");
        const parsed = yaml.load(raw);
        if (isPlainObject2(parsed)) {
          const list = parsed["initiatives"];
          if (Array.isArray(list)) {
            for (const entry of list) {
              if (!isPlainObject2(entry)) continue;
              const rec = entry;
              if (rec["id"] === id) {
                return rec["scope"] === "workspace";
              }
            }
          }
        }
      } catch {
        return false;
      }
    }
    const initiativesBase = path4.join(workspaceRoot, ".guild", "initiatives");
    const activePath = path4.join(
      initiativesBase,
      "active",
      id,
      "initiative.yaml"
    );
    const archivedPath = path4.join(
      initiativesBase,
      "archived",
      id,
      "initiative.yaml"
    );
    const activeBase = path4.join(initiativesBase, "active");
    const archivedBase = path4.join(initiativesBase, "archived");
    if (!isContainedIn(activePath, activeBase) && !isContainedIn(archivedPath, archivedBase)) {
      return false;
    }
    let yamlPath = null;
    if (isContainedIn(activePath, activeBase) && fs3.existsSync(activePath)) {
      yamlPath = activePath;
    } else if (isContainedIn(archivedPath, archivedBase) && fs3.existsSync(archivedPath)) {
      yamlPath = archivedPath;
    }
    if (yamlPath !== null) {
      try {
        const raw = fs3.readFileSync(yamlPath, "utf8");
        const parsed = yaml.load(raw);
        if (isPlainObject2(parsed)) {
          const doc = parsed["initiative"];
          if (isPlainObject2(doc)) {
            return doc["scope"] === "workspace";
          }
        }
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
  return false;
}
function wasExplicitlySet(key, ...layers) {
  return layers.some((layer) => key in layer && layer[key] !== void 0);
}
function resolveSettings(opts) {
  const { cwd, flags = {} } = opts;
  const ws = discoverWorkspace(cwd);
  const sources = {};
  for (const key of Object.keys(DEFAULTS2)) {
    sources[key] = "builtin";
  }
  sources["workspace.mode"] = "builtin";
  let wsSettings = {};
  let wsLocalSettings = {};
  if (ws !== null) {
    const wsGuildDir = path4.join(ws.rootDir, ".guild");
    const rawWsSettings = parseSettingsFile(path4.join(wsGuildDir, "settings.json"));
    const wsInheritable = {};
    for (const [k, v] of Object.entries(rawWsSettings)) {
      const key = k;
      if (!NON_INHERITABLE_KEYS.has(key)) {
        wsInheritable[key] = v;
      } else if (key === "initiative_default" && typeof v === "string" && v !== null) {
        if (initiativeIsWorkspaceScoped(ws.rootDir, v)) {
          wsInheritable[key] = v;
        }
      }
    }
    wsSettings = wsInheritable;
    for (const key of Object.keys(wsSettings)) {
      if (key !== "workspace") sources[key] = "workspace";
    }
    try {
      const rawWsLocal = parseLocalFile(wsGuildDir);
      const wsLocalInheritable = {};
      for (const [k, v] of Object.entries(rawWsLocal)) {
        const key = k;
        if (!NON_INHERITABLE_KEYS.has(key)) {
          wsLocalInheritable[key] = v;
        } else if (key === "initiative_default" && typeof v === "string" && v !== null) {
          if (initiativeIsWorkspaceScoped(ws.rootDir, v)) {
            wsLocalInheritable[key] = v;
          }
        }
      }
      wsLocalSettings = wsLocalInheritable;
      for (const key of Object.keys(wsLocalSettings)) {
        if (key !== "workspace") sources[key] = "workspace-local";
      }
    } catch {
    }
  }
  const projectGuildDir = path4.join(cwd, ".guild");
  const projectSettings = parseSettingsFile(path4.join(projectGuildDir, "settings.json"));
  for (const key of Object.keys(projectSettings)) {
    if (key === "workspace") {
      sources["workspace.mode"] = "project";
    } else {
      sources[key] = "project";
    }
  }
  let projectLocalSettings = {};
  try {
    projectLocalSettings = parseLocalFile(projectGuildDir);
    for (const key of Object.keys(projectLocalSettings)) {
      if (key === "workspace") {
        sources["workspace.mode"] = "project-local";
      } else {
        sources[key] = "project-local";
      }
    }
  } catch {
  }
  for (const key of Object.keys(flags)) {
    if (flags[key] !== void 0) {
      if (key === "workspace") {
        sources["workspace.mode"] = "cli";
      }
      sources[key] = "cli";
    }
  }
  const assembled = assembleLayers(
    [wsSettings, wsLocalSettings, projectSettings, projectLocalSettings],
    flags
  );
  const resolvedWorkspaceMode = {
    ...DEFAULTS2.workspace,
    ...projectSettings.workspace ?? {},
    ...projectLocalSettings.workspace ?? {},
    // FIX F2: project-local workspace now included
    ...flags.workspace ?? {}
  };
  assembled.workspace = resolvedWorkspaceMode;
  sources["workspace"] = sources["workspace.mode"];
  const loopsExplicit = wasExplicitlySet(
    "loops",
    wsSettings,
    wsLocalSettings,
    projectSettings,
    projectLocalSettings,
    flags
  ) && assembled.loops !== null;
  const loopCapExplicit = wasExplicitlySet(
    "loop_cap",
    wsSettings,
    wsLocalSettings,
    projectSettings,
    projectLocalSettings,
    flags
  );
  const reviewExplicit = wasExplicitlySet(
    "review",
    wsSettings,
    wsLocalSettings,
    projectSettings,
    projectLocalSettings,
    flags
  );
  if (assembled.loops) {
    for (const v of assembled.loops.split(",").map((s) => s.trim())) {
      if (!VALID_LOOPS.has(v)) {
        assembled.loops = null;
        break;
      }
    }
  }
  const loopsIsExplicit = loopsExplicit && assembled.loops !== null;
  const profile = rigorProfile(assembled.rigor);
  const applied = [];
  const overridden = [];
  let derivedReview = profile.review;
  let reviewFallback = false;
  let fallbackNote;
  if (assembled.rigor === "deep" && derivedReview === "cross" && !crossHostAvailable()) {
    derivedReview = "local";
    reviewFallback = true;
    fallbackNote = "rigor=deep implies review=cross, but the cross-host (Codex) is unavailable \u2014 fell back to review=local with a weak-independence caveat. Not a hard failure.";
  }
  if (loopsIsExplicit) {
    overridden.push("loops");
  } else {
    assembled.loops = profile.loops;
    applied.push("loops");
    if (sources.rigor !== "builtin") sources.loops = "rigor";
  }
  if (profile.loop_cap !== null) {
    if (loopCapExplicit) {
      overridden.push("loop_cap");
    } else {
      assembled.loop_cap = profile.loop_cap;
      applied.push("loop_cap");
      if (sources.rigor !== "builtin") sources.loop_cap = "rigor";
    }
  }
  if (reviewExplicit) {
    overridden.push("review");
  } else {
    assembled.review = derivedReview;
    applied.push("review");
    if (sources.rigor !== "builtin") sources.review = "rigor";
  }
  const rigorExpanded = {
    rigor: assembled.rigor,
    loops: profile.loops,
    loop_cap: profile.loop_cap,
    review: derivedReview,
    applied,
    overridden_by_explicit: overridden
  };
  if (assembled.rigor === "deep") rigorExpanded.review_implied = "cross";
  if (reviewFallback) {
    rigorExpanded.review_fallback = true;
    rigorExpanded.note = fallbackNote;
  }
  assembled._rigorExpanded = rigorExpanded;
  if (assembled.index === "off" && assembled.defaults.index.enabled !== false) {
    assembled.defaults = {
      ...assembled.defaults,
      index: { ...assembled.defaults.index, enabled: false }
    };
  }
  return { config: assembled, sources };
}
var fs3, path4, yaml, HOST_MODES, DEFAULTS2, VALID_TIER_HOST_KEYS, KNOWN_HOST_IDS2, VALID_LOOPS, VALID_RIGOR, VALID_REVIEW, DISPATCH_HOST_IDS, VALID_AGENT_MODE, VALID_CACHE_TTL, DEFAULTS_ALLOWED_KEYS;
var init_settings_reader = __esm({
  "../src/modules/config/workflows/settings-reader.ts"() {
    fs3 = __toESM(require("fs"));
    path4 = __toESM(require("path"));
    init_host_runtime();
    init_host_runtime();
    init_host_runtime();
    init_security();
    init_config_defaults();
    init_kernel();
    init_workspace_manifest();
    yaml = loadYamlApi();
    HOST_MODES = ["read_only", "ask", "accept_edits", "auto", "bypass_all"];
    DEFAULTS2 = DEFAULTS;
    VALID_TIER_HOST_KEYS = new Set(HOST_IDS);
    KNOWN_HOST_IDS2 = new Set(HOST_IDS);
    VALID_LOOPS = /* @__PURE__ */ new Set(["none", "spec", "plan", "implementation", "all"]);
    VALID_RIGOR = /* @__PURE__ */ new Set(["quick", "standard", "deep"]);
    VALID_REVIEW = /* @__PURE__ */ new Set(["local", "cross", "off"]);
    DISPATCH_HOST_IDS = new Set(
      HOST_IDS.filter((id) => HOST_REGISTRY_ROWS[id].dispatch_selectable === true)
    );
    VALID_AGENT_MODE = /* @__PURE__ */ new Set(["team", "agent", "subagent", "auto"]);
    VALID_CACHE_TTL = /* @__PURE__ */ new Set(["1h", "5m", "off"]);
    DEFAULTS_ALLOWED_KEYS = /* @__PURE__ */ new Set([
      "auto_learn",
      "adversarial",
      "team",
      "review_workflow",
      "skill_policy",
      "gates",
      "wiki",
      "quality",
      "reporting",
      "index",
      "cross_host",
      "retry",
      "resume",
      // R-016
      "heartbeat_timeout_ms",
      // R-017
      "capability_manifest_ttl_s",
      // R-018
      "allowed_tools",
      // R-020
      "update",
      // plugin-update-lifecycle AC-6
      "lean_lead",
      "lifecycle_gate"
      // rf-wi-01 (G1)
    ]);
  }
});

// ../src/modules/telemetry/workflows/guild-trace-events.ts
function validateBase(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const e = ev;
  if (typeof e["schema_version"] !== "string" || e["schema_version"] === "") {
    return { ok: false, reason: "schema_version must be a non-empty string" };
  }
  if (!GUILD_TRACE_SCHEMA_VERSIONS.includes(e["schema_version"])) {
    return { ok: false, reason: `unknown schema_version: ${e["schema_version"]}` };
  }
  if (typeof e["ts"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["ts"])) {
    return { ok: false, reason: "ts must be an ISO-8601 timestamp string" };
  }
  if (typeof e["run_id"] !== "string" || e["run_id"] === "") {
    return { ok: false, reason: "run_id must be a non-empty string" };
  }
  if (typeof e["lane_id"] !== "string") {
    return { ok: false, reason: "lane_id must be a string (empty string for lead session)" };
  }
  return { ok: true };
}
function validateDispatchEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.dispatch.v1") {
    return { ok: false, reason: `wrong schema_version for dispatch: ${e["schema_version"]}` };
  }
  if (typeof e["specialist"] !== "string" || e["specialist"] === "") {
    return { ok: false, reason: "specialist must be a non-empty string" };
  }
  if (typeof e["phase"] !== "string" || e["phase"] === "") {
    return { ok: false, reason: "phase must be a non-empty string" };
  }
  if (typeof e["task_id"] !== "string" || e["task_id"] === "") {
    return { ok: false, reason: "task_id must be a non-empty string" };
  }
  if (!DISPATCH_BACKENDS.includes(e["backend"])) {
    return { ok: false, reason: `backend must be one of: ${DISPATCH_BACKENDS.join(", ")}` };
  }
  if (typeof e["backend_rung"] !== "number" || e["backend_rung"] < 0 || e["backend_rung"] > 4) {
    return { ok: false, reason: "backend_rung must be a number 0-4" };
  }
  if (typeof e["dispatched_at"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["dispatched_at"])) {
    return { ok: false, reason: "dispatched_at must be an ISO-8601 timestamp string" };
  }
  for (const optKey of ["attribution_specialist", "pane_id", "pane_target", "pane_backend"]) {
    if (e[optKey] === void 0) continue;
    if (typeof e[optKey] !== "string" || e[optKey] === "") {
      return { ok: false, reason: `${optKey}, when present, must be a non-empty string` };
    }
  }
  if (e["pane_backend"] !== void 0) {
    if (e["backend"] !== "unknown") {
      return {
        ok: false,
        reason: `pane_backend is only for a surface the backend enum cannot name; it must not accompany backend "${e["backend"]}"`
      };
    }
    if (e["backend_rung"] < 1) {
      return {
        ok: false,
        reason: "pane_backend marks a CONFIRMED dispatch, so backend_rung must be >= 1"
      };
    }
  }
  return { ok: true };
}
function validateRecallEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.recall.v1") {
    return { ok: false, reason: `wrong schema_version for recall: ${e["schema_version"]}` };
  }
  if (typeof e["query"] !== "string" || e["query"] === "") {
    return { ok: false, reason: "query must be a non-empty string" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"])) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["had_quarantine"] !== "boolean") {
    return { ok: false, reason: "had_quarantine must be a boolean" };
  }
  if (typeof e["cwd_redacted"] !== "string") {
    return { ok: false, reason: "cwd_redacted must be a string" };
  }
  return { ok: true };
}
function validateRecallDecisionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.recall_decision.v1") {
    return { ok: false, reason: `wrong schema_version for recall_decision: ${e["schema_version"]}` };
  }
  if (typeof e["query_hash"] !== "string" || !/^[0-9a-f]{16}$/.test(e["query_hash"])) {
    return { ok: false, reason: "query_hash must be exactly 16 lowercase hex chars (sha256[:16])" };
  }
  if (typeof e["query_preview"] !== "string") {
    return { ok: false, reason: "query_preview must be a string (may be empty)" };
  }
  if (e["query_preview"].length > 60) {
    return { ok: false, reason: "query_preview must be <= 60 chars (no raw-query leak)" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"])) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["top_score"] !== "number" || e["top_score"] < 0 || !isFinite(e["top_score"])) {
    return { ok: false, reason: "top_score must be a finite number >= 0" };
  }
  if (typeof e["threshold"] !== "number" || e["threshold"] < 0 || !isFinite(e["threshold"])) {
    return { ok: false, reason: "threshold must be a finite number >= 0" };
  }
  if (typeof e["read_skip_fired"] !== "boolean") {
    return { ok: false, reason: "read_skip_fired must be a boolean" };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["scored"] !== "boolean") {
    return { ok: false, reason: "scored must be a boolean" };
  }
  if (!LANE_OUTCOMES.includes(e["lane_outcome"])) {
    return { ok: false, reason: `lane_outcome must be one of: ${LANE_OUTCOMES.join(", ")}` };
  }
  return { ok: true };
}
function validateConfigResolutionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.config_resolution.v1") {
    return { ok: false, reason: `wrong schema_version for config_resolution: ${e["schema_version"]}` };
  }
  if (typeof e["rigor"] !== "string" || e["rigor"] === "") {
    return { ok: false, reason: "rigor must be a non-empty string" };
  }
  if (typeof e["agent_mode"] !== "string" || e["agent_mode"] === "") {
    return { ok: false, reason: "agent_mode must be a non-empty string" };
  }
  if (typeof e["layers"] !== "object" || e["layers"] === null) {
    return { ok: false, reason: "layers must be an object" };
  }
  const layers = e["layers"];
  for (const boolKey of ["workspace", "workspace_local", "project", "project_local", "cli"]) {
    if (typeof layers[boolKey] !== "boolean") {
      return { ok: false, reason: `layers.${boolKey} must be a boolean` };
    }
  }
  if (layers["rigor"] !== null && typeof layers["rigor"] !== "string") {
    return { ok: false, reason: "layers.rigor must be a string or null" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["config_fingerprint"] !== "string" || e["config_fingerprint"] === "") {
    return { ok: false, reason: "config_fingerprint must be a non-empty string" };
  }
  return { ok: true };
}
function validateSecurityDecisionEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.security_decision.v1") {
    return { ok: false, reason: `wrong schema_version for security_decision: ${e["schema_version"]}` };
  }
  if (typeof e["tool_name"] !== "string" || e["tool_name"] === "") {
    return { ok: false, reason: "tool_name must be a non-empty string" };
  }
  if (!SECURITY_OUTCOMES.includes(e["decision"])) {
    return { ok: false, reason: `decision must be one of: ${SECURITY_OUTCOMES.join(", ")}` };
  }
  if (typeof e["bypass_mode"] !== "boolean") {
    return { ok: false, reason: "bypass_mode must be a boolean" };
  }
  if (typeof e["policy_forced"] !== "boolean") {
    return { ok: false, reason: "policy_forced must be a boolean" };
  }
  if (typeof e["autonomy_mode"] !== "string" || e["autonomy_mode"] === "") {
    return { ok: false, reason: "autonomy_mode must be a non-empty string" };
  }
  if (!["env", "file", "none"].includes(e["scope_source"])) {
    return { ok: false, reason: "scope_source must be 'env', 'file', or 'none'" };
  }
  return { ok: true };
}
function validateDegradationEvent(ev) {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev;
  if (e["schema_version"] !== "guild.trace.degradation.v1") {
    return { ok: false, reason: `wrong schema_version for degradation: ${e["schema_version"]}` };
  }
  if (!DEGRADATION_SURFACES.includes(e["surface"])) {
    return { ok: false, reason: `surface must be one of: ${DEGRADATION_SURFACES.join(", ")}` };
  }
  if (typeof e["reason"] !== "string" || e["reason"] === "") {
    return { ok: false, reason: "reason must be a non-empty string" };
  }
  if (typeof e["attempted"] !== "string" || e["attempted"] === "") {
    return { ok: false, reason: "attempted must be a non-empty string" };
  }
  if (typeof e["fallback"] !== "string" || e["fallback"] === "") {
    return { ok: false, reason: "fallback must be a non-empty string" };
  }
  if (!["warn", "error"].includes(e["severity"])) {
    return { ok: false, reason: "severity must be 'warn' or 'error'" };
  }
  return { ok: true };
}
function validateGuildTraceEvent(ev) {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const sv = ev["schema_version"];
  switch (sv) {
    case "guild.trace.dispatch.v1":
      return validateDispatchEvent(ev);
    case "guild.trace.recall.v1":
      return validateRecallEvent(ev);
    case "guild.trace.recall_decision.v1":
      return validateRecallDecisionEvent(ev);
    case "guild.trace.config_resolution.v1":
      return validateConfigResolutionEvent(ev);
    case "guild.trace.security_decision.v1":
      return validateSecurityDecisionEvent(ev);
    case "guild.trace.degradation.v1":
      return validateDegradationEvent(ev);
    default:
      return { ok: false, reason: `unknown schema_version: ${sv}` };
  }
}
function makeConfigResolutionEvent(fields) {
  return { schema_version: "guild.trace.config_resolution.v1", ...fields };
}
var GUILD_TRACE_SCHEMA_VERSIONS, DISPATCH_BACKENDS, RECALL_BRANCHES, SECURITY_OUTCOMES, DEGRADATION_SURFACES, LANE_OUTCOMES;
var init_guild_trace_events = __esm({
  "../src/modules/telemetry/workflows/guild-trace-events.ts"() {
    GUILD_TRACE_SCHEMA_VERSIONS = [
      "guild.trace.dispatch.v1",
      "guild.trace.recall.v1",
      "guild.trace.recall_decision.v1",
      "guild.trace.config_resolution.v1",
      "guild.trace.security_decision.v1",
      "guild.trace.degradation.v1"
    ];
    DISPATCH_BACKENDS = ["agent", "tmux", "remote", "unknown"];
    RECALL_BRANCHES = ["sqlite", "file-bm25", "fs-scan", "kg-query", "structural", "combined", "empty"];
    SECURITY_OUTCOMES = ["allow", "ask", "deny", "audit", "pass-through"];
    DEGRADATION_SURFACES = ["dispatch", "recall", "config", "hook", "host-capability", "other"];
    LANE_OUTCOMES = ["success", "failure", "unknown"];
  }
});

// ../src/modules/telemetry/workflows/guild-trace-emit.ts
function liveLogPath(runDir) {
  return path5.join(runDir, "logs", "v1.4-events.jsonl");
}
function emitTraceEvent(event, runDir) {
  if (!runDir) return false;
  const validationResult = validateGuildTraceEvent(event);
  if (!validationResult.ok) {
    const schemaVersion = event["schema_version"];
    const failResult = validationResult;
    process.stderr.write(
      `[guild-trace-emit] WARN: dropping invalid trace event (${schemaVersion}): ${failResult.reason}
`
    );
    return false;
  }
  try {
    const live = liveLogPath(runDir);
    const dir = path5.dirname(live);
    fs4.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(event) + "\n";
    fs4.appendFileSync(live, line, "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `[guild-trace-emit] WARN: could not write trace event to ${runDir}/logs/v1.4-events.jsonl: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}
var fs4, path5;
var init_guild_trace_emit = __esm({
  "../src/modules/telemetry/workflows/guild-trace-emit.ts"() {
    fs4 = __toESM(require("node:fs"));
    path5 = __toESM(require("node:path"));
    init_guild_trace_events();
  }
});

// ../src/modules/telemetry/index.ts
var init_telemetry = __esm({
  "../src/modules/telemetry/index.ts"() {
    init_guild_trace_emit();
    init_guild_trace_events();
  }
});

// ../src/modules/config/workflows/settings-resolver.ts
var settings_resolver_exports = {};
__export(settings_resolver_exports, {
  deepMerge: () => deepMerge,
  initiativeIsWorkspaceScoped: () => initiativeIsWorkspaceScoped,
  isPlainObject: () => isPlainObject2,
  resolveSettings: () => resolveSettings2,
  rigorProfile: () => rigorProfile
});
function resolveSettings2(opts) {
  const t0 = Date.now();
  const result = resolveSettings(opts);
  try {
    const { cwd, flags = {} } = opts;
    const assembled = result.config;
    const _traceRunId = process.env["GUILD_RUN_ID"] ?? "";
    const _traceRunDir = _traceRunId && cwd ? path6.join(cwd, ".guild", "runs", _traceRunId) : void 0;
    if (_traceRunDir) {
      const _fingerprint = crypto.createHash("sha256").update(JSON.stringify(assembled)).digest("hex").slice(0, 16);
      const sources = result.sources;
      emitTraceEvent(
        makeConfigResolutionEvent({
          ts: (/* @__PURE__ */ new Date()).toISOString(),
          run_id: _traceRunId,
          lane_id: process.env["GUILD_LANE_ID"] ?? "",
          rigor: String(assembled.rigor ?? "standard"),
          agent_mode: String(assembled.agent_mode ?? "default"),
          layers: {
            workspace: Object.values(sources).some((s) => s === "workspace"),
            workspace_local: Object.values(sources).some((s) => s === "workspace-local"),
            project: Object.values(sources).some((s) => s === "project"),
            project_local: Object.values(sources).some((s) => s === "project-local"),
            rigor: assembled._rigorExpanded?.rigor ?? null,
            cli: Object.keys(flags).length > 0
          },
          duration_ms: Date.now() - t0,
          config_fingerprint: _fingerprint
        }),
        _traceRunDir
      );
    }
  } catch {
  }
  return result;
}
var path6, crypto;
var init_settings_resolver = __esm({
  "../src/modules/config/workflows/settings-resolver.ts"() {
    path6 = __toESM(require("path"));
    crypto = __toESM(require("crypto"));
    init_settings_reader();
    init_settings_reader();
    init_telemetry();
    init_telemetry();
  }
});

// update-check.ts
var fs5 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path7 = __toESM(require("path"));
var import_child_process2 = require("child_process");

// ../scripts/lib/update-check.ts
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
init_host_registry_schema();
var SOURCE_REPO_DEFAULT = "https://github.com/lookatitude/guild.git";
var CACHE_SCHEMA = "guild.update_check_cache.v1";
var RECEIPT_SCHEMA = "guild.install_receipt.v1";
var RECEIPT_BASENAME = "guild-install-receipt.json";
function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
function semverLt(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i];
  }
  return false;
}
function latestStableTag(tags) {
  let best = null;
  for (const t of tags) {
    if (!parseSemver(t)) continue;
    if (best === null || semverLt(best, t)) best = t;
  }
  return best;
}
function parseLsRemote(raw) {
  const tags = [];
  let next = null;
  let main2 = null;
  for (const line of raw.split("\n")) {
    const m = /^([0-9a-f]{40})\s+(\S+)$/.exec(line.trim());
    if (!m) continue;
    const [, sha, ref] = m;
    if (ref === "refs/heads/next") next = sha;
    else if (ref === "refs/heads/main") main2 = sha;
    else if (ref.startsWith("refs/tags/v") && !ref.endsWith("^{}")) {
      tags.push(ref.slice("refs/tags/".length));
    }
  }
  return { latest_tag: latestStableTag(tags), next_head_sha: next, main_head_sha: main2 };
}
function resolveGitDir(gitPath, fsi = fs) {
  try {
    const st = fsi.statSync(gitPath);
    if (st.isDirectory()) return gitPath;
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+)\s*$/m.exec(fsi.readFileSync(gitPath, "utf8"));
      if (!m) return null;
      const target = m[1].trim();
      return path.isAbsolute(target) ? target : path.resolve(path.dirname(gitPath), target);
    }
  } catch {
  }
  return null;
}
function readGitHead(gitDir, fsi = fs) {
  const headPath = path.join(gitDir, "HEAD");
  if (!fsi.existsSync(headPath)) return { branch: null, sha: null };
  const head = fsi.readFileSync(headPath, "utf8").trim();
  const refMatch = /^ref:\s*refs\/heads\/(\S+)$/.exec(head);
  if (!refMatch) {
    return { branch: null, sha: /^[0-9a-f]{40}$/.test(head) ? head : null };
  }
  const branch = refMatch[1];
  const refRoots = [gitDir];
  const commondirFile = path.join(gitDir, "commondir");
  if (fsi.existsSync(commondirFile)) {
    const common = fsi.readFileSync(commondirFile, "utf8").trim();
    refRoots.push(path.isAbsolute(common) ? common : path.resolve(gitDir, common));
  }
  for (const root of refRoots) {
    const looseRef = path.join(root, "refs", "heads", branch);
    if (fsi.existsSync(looseRef)) {
      const sha = fsi.readFileSync(looseRef, "utf8").trim();
      return { branch, sha: /^[0-9a-f]{40}$/.test(sha) ? sha : null };
    }
    const packed = path.join(root, "packed-refs");
    if (fsi.existsSync(packed)) {
      for (const line of fsi.readFileSync(packed, "utf8").split("\n")) {
        const m = /^([0-9a-f]{40})\s+refs\/heads\/(\S+)$/.exec(line.trim());
        if (m && m[2] === branch) return { branch, sha: m[1] };
      }
    }
  }
  return { branch, sha: null };
}
function branchToChannel(branch) {
  if (branch === "next") return "beta";
  return "stable";
}
function resolveInstallState(pluginRoot, opts = {}) {
  const fsi = opts.fsi ?? fs;
  const home = opts.homedir ?? os.homedir();
  const real = (() => {
    try {
      return fsi.realpathSync(pluginRoot);
    } catch {
      return pluginRoot;
    }
  })();
  const version = readInstalledVersion(pluginRoot, fsi);
  const managedRoots = [
    path.join(home, ".claude", "plugins"),
    path.join(home, ".config", "claude", "plugins")
  ].map((m) => {
    try {
      return fsi.realpathSync(m);
    } catch {
      return m;
    }
  });
  const isManaged = managedRoots.some(
    (m) => real === m || real.startsWith(m + path.sep)
  );
  const gitDir = resolveGitDir(path.join(real, ".git"), fsi);
  if (gitDir) {
    const { branch, sha } = readGitHead(gitDir, fsi);
    if (!isManaged) {
      return { channel: "dev", version, commit: sha, source: "dev-checkout" };
    }
    return {
      channel: branchToChannel(branch),
      version,
      commit: sha,
      source: "marketplace-clone"
    };
  }
  const receiptPath = path.join(real, RECEIPT_BASENAME);
  if (fsi.existsSync(receiptPath)) {
    try {
      const r = JSON.parse(fsi.readFileSync(receiptPath, "utf8"));
      if (r.schema_version === RECEIPT_SCHEMA) {
        return {
          channel: r.channel === "beta" ? "beta" : "stable",
          version: r.version ?? version,
          commit: r.commit ?? null,
          source: "receipt"
        };
      }
    } catch {
    }
  }
  return { channel: "stable", version, commit: null, source: "default" };
}
var PLUGIN_MANIFEST_CANDIDATES = [
  [".claude-plugin", "plugin.json"],
  [".codex-plugin", "plugin.json"]
];
function readInstalledVersion(pluginRoot, fsi = fs) {
  for (const [dir, file] of PLUGIN_MANIFEST_CANDIDATES) {
    try {
      const manifest = JSON.parse(fsi.readFileSync(path.join(pluginRoot, dir, file), "utf8"));
      if (typeof manifest.version === "string" && manifest.version.length > 0) return manifest.version;
    } catch {
    }
  }
  return null;
}
function cachePath(homedir3 = os.homedir()) {
  return path.join(homedir3, ".guild", "update-check.json");
}
function readCache(file, fsi = fs) {
  try {
    const c = JSON.parse(fsi.readFileSync(file, "utf8"));
    return c.schema_version === CACHE_SCHEMA ? c : null;
  } catch {
    return null;
  }
}
function cacheIsFresh(cache, ttlHours, now) {
  if (!cache) return false;
  const age = now.getTime() - Date.parse(cache.checked_at);
  return Number.isFinite(age) && age >= 0 && age < ttlHours * 36e5;
}
function refreshCache(opts) {
  const repo = opts.repo ?? SOURCE_REPO_DEFAULT;
  const file = opts.file ?? cachePath();
  const fsi = opts.fsi ?? fs;
  const run = opts.runner ?? ((cmd, args) => (0, import_child_process.execFileSync)(cmd, args, { encoding: "utf8", timeout: 15e3 }));
  try {
    const raw = run("git", ["ls-remote", "--tags", "--heads", repo]);
    const cache = {
      schema_version: CACHE_SCHEMA,
      checked_at: (opts.now ?? /* @__PURE__ */ new Date()).toISOString(),
      source_repo: repo,
      remote: parseLsRemote(raw)
    };
    fsi.mkdirSync(path.dirname(file), { recursive: true });
    fsi.writeFileSync(file, JSON.stringify(cache, null, 2) + "\n", "utf8");
    return cache;
  } catch {
    return null;
  }
}
function updateCapsForHost(hostId) {
  if (!hostId) return null;
  const row = HOST_REGISTRY_ROWS[hostId];
  return row ? row.capabilities.package.update : null;
}
function computeSignal(opts) {
  const { state, cache } = opts;
  const short = (sha) => sha ? sha.slice(0, 7) : "unknown";
  const installedLabel = state.channel === "beta" ? short(state.commit) : state.version ?? "unknown";
  const base = {
    channel: state.channel,
    installed: installedLabel,
    available: null,
    command: null
  };
  if (state.channel === "dev") {
    return { ...base, update_available: false, reason: "dev-install" };
  }
  if (!cache) {
    return { ...base, update_available: false, reason: "no-cache" };
  }
  const rowCaps = updateCapsForHost(opts.hostId);
  const command = opts.hostId !== void 0 ? rowCaps ? rowCaps.command : null : opts.hostKind === "wrapper" ? "guild-run update" : opts.hostKind === "agents-file" ? "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update" : "claude plugin marketplace update guild && claude plugin update guild@guild";
  if (state.channel === "beta") {
    const remoteSha = cache.remote.next_head_sha;
    if (remoteSha && state.commit && remoteSha !== state.commit) {
      return {
        ...base,
        update_available: true,
        available: short(remoteSha),
        command,
        reason: "beta-new-commit"
      };
    }
    return { ...base, update_available: false, reason: "up-to-date" };
  }
  const latest = cache.remote.latest_tag;
  if (latest && state.version && semverLt(state.version, latest)) {
    return {
      ...base,
      update_available: true,
      available: latest,
      command,
      reason: "stable-newer-tag"
    };
  }
  return { ...base, update_available: false, reason: "up-to-date" };
}
function renderSignalLine(sig) {
  if (!sig.update_available || !sig.available) return null;
  const channelLabel = sig.channel === "beta" ? "beta (next)" : "stable";
  return `Guild update available on ${channelLabel}: ${sig.installed} \u2192 ${sig.available}` + (sig.command ? ` \u2014 run: ${sig.command}` : "");
}

// update-check.ts
function readUpdateConfig(cwd) {
  const defaults = { mode: "notify", cadenceHours: 24 };
  try {
    const { resolveSettings: resolveSettings3 } = (init_settings_resolver(), __toCommonJS(settings_resolver_exports));
    const parsed = resolveSettings3({ cwd }).config;
    const u = parsed.defaults?.update ?? {};
    const mode = u.mode === "auto" || u.mode === "notify" || u.mode === "off" ? u.mode : defaults.mode;
    const cadenceHours = typeof u.cadence_hours === "number" && u.cadence_hours > 0 ? u.cadence_hours : defaults.cadenceHours;
    return { mode, cadenceHours };
  } catch {
    return defaults;
  }
}
function stagedMarkerPath() {
  return path7.join(os2.homedir(), ".guild", "update-staged.json");
}
function alreadyStaged(target) {
  try {
    const m = JSON.parse(fs5.readFileSync(stagedMarkerPath(), "utf8"));
    return m.target === target;
  } catch {
    return false;
  }
}
function markStaged(target) {
  try {
    fs5.mkdirSync(path7.dirname(stagedMarkerPath()), { recursive: true });
    fs5.writeFileSync(
      stagedMarkerPath(),
      JSON.stringify({ target, staged_at: (/* @__PURE__ */ new Date()).toISOString() }) + "\n",
      "utf8"
    );
  } catch {
  }
}
function spawnDetached(cmd, args) {
  try {
    const child = (0, import_child_process2.spawn)(cmd, args, {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
  } catch {
  }
}
function main() {
  if (process.argv.includes("--refresh")) {
    refreshCache({});
    return;
  }
  const pluginRoot = process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (!pluginRoot) return;
  const { mode, cadenceHours } = readUpdateConfig(process.cwd());
  if (mode === "off") return;
  const hostArg = process.argv.indexOf("--host");
  let hostId = "claude-code-cli";
  if (hostArg !== -1) {
    const raw = process.argv[hostArg + 1];
    hostId = raw === void 0 || raw.startsWith("-") || raw === "" ? "unknown-host" : raw;
  }
  const caps = updateCapsForHost(hostId);
  const hostKind = caps?.apply === "marketplace_cli" ? "claude" : caps?.apply === "self_update" ? "wrapper" : "agents-file";
  const state = resolveInstallState(pluginRoot);
  if (state.channel === "dev") return;
  const cacheFile = cachePath();
  const cache = readCache(cacheFile);
  if (!cacheIsFresh(cache, cadenceHours, /* @__PURE__ */ new Date())) {
    spawnDetached(process.execPath, [__filename, "--refresh"]);
  }
  const signal = computeSignal({ state, cache, hostKind, hostId });
  const line = renderSignalLine(signal);
  if (!line) return;
  if (mode === "auto" && caps?.auto_capable !== true) {
    process.stdout.write(
      `${line}
[guild-update] auto mode: ${hostId} cannot auto-apply \u2014 run the command above.
`
    );
    return;
  }
  if (mode === "auto") {
    const target = `${hostId}@${signal.available ?? ""}`;
    if (!alreadyStaged(target)) {
      spawnDetached("/bin/sh", ["-c", caps.command]);
      markStaged(target);
      process.stdout.write(
        `${line}
[guild-update] auto mode: update staged \u2014 it takes effect next session.
`
      );
      return;
    }
    process.stdout.write(
      `${line}
[guild-update] auto mode: already staged \u2014 restart to apply.
`
    );
    return;
  }
  process.stdout.write(`${line}
`);
}
try {
  main();
} catch {
}
process.exit(0);
