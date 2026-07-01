#!/usr/bin/env -S npx tsx
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// run-trace-close.ts
var run_trace_close_exports = {};
__export(run_trace_close_exports, {
  findTerminalCheckpoint: () => findTerminalCheckpoint
});
module.exports = __toCommonJS(run_trace_close_exports);
var fs8 = __toESM(require("fs"));
var path10 = __toESM(require("path"));

// lib/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startCwd) {
  let current = path.resolve(startCwd);
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const guildDir = path.join(current, ".guild");
    if (fs.existsSync(guildDir)) {
      try {
        if (fs.statSync(guildDir).isDirectory()) {
          return current;
        }
      } catch {
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startCwd);
    }
    current = parent;
  }
}

// lib/run-trace.ts
var fs7 = __toESM(require("fs"));
var path9 = __toESM(require("path"));

// ../src/modules/lifecycle/workflows/run-lifecycle.ts
var crypto2 = __toESM(require("crypto"));
var fsNode = __toESM(require("fs"));
var path7 = __toESM(require("path"));

// ../src/modules/config/workflows/config-defaults.ts
var LOG_ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
var SIDECAR_MAX_BYTES = 1024 * 1024;

// ../src/modules/host-runtime/workflows/host-capabilities-schema.ts
var CLAUDE_CAPABILITIES = {
  schema_version: "guild.host_capabilities.v1",
  host_kind: "claude",
  family: "claude",
  surface_kind: "cli",
  package: { installable: true, installability: "verified", manifest_format: "claude-plugin" },
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
var CODEX_CAPABILITIES = {
  schema_version: "guild.host_capabilities.v1",
  host_kind: "codex",
  family: "codex",
  surface_kind: "cli",
  // installable:false is the honest MACHINE state — the Codex renderer exists but
  // per-host-packaging.ts marks it DORMANT; a non-Claude render must not be treated
  // as installable until proven. installability:"target" records that the renderer
  // exists; both flip to verified/true at SC-3 (real Codex install + bootstrap).
  package: { installable: false, installability: "target", manifest_format: "codex-plugin" },
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
var NO_HOOKS = {
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
var TARGET_CLI_COMMON = {
  commands: { slash_commands: false, command_files: "none" },
  skills: { native_skills: false, skill_dir: ".agents/skills/guild" },
  agents: { native_agents: false, agent_format: null },
  hooks: NO_HOOKS,
  dispatch: {
    tmux_processes: true,
    plain_processes: true,
    independent_agents: false,
    subagents: false,
    inline: true
  },
  interaction: {
    native_questions: false,
    terminal_prompt: true,
    file_bus_questions: true
  },
  sessions: { continue: false, resume_by_id: false, fork: false },
  structured_output: {
    native_json: true,
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
    mcp: "emulated"
  },
  mcp: { stdio: false, http: false },
  models: {
    cheap: { model: null },
    mid: { model: null },
    powerful: { model: null }
  }
};
var PI_CAPABILITIES = {
  schema_version: "guild.host_capabilities.v1",
  host_kind: "pi",
  family: "pi",
  surface_kind: "cli",
  package: { installable: false, installability: "target", manifest_format: "pi-manifest" },
  bootstrap: {
    context_injection: "instruction_file",
    skill_autoload: false,
    prompt_transform: false,
    wrapper_injection: true
  },
  permissions: {
    deny: true,
    ask: true,
    ask_mode: null,
    accept_edits_without_prompt: false,
    auto_approve_tools: false,
    bypass_prompts: false,
    bypass_sandbox: false,
    permission_prompt_layer: false,
    launch_modes: {}
  },
  ...TARGET_CLI_COMMON
};
var ANTIGRAVITY_CAPABILITIES = {
  schema_version: "guild.host_capabilities.v1",
  host_kind: "antigravity",
  family: "antigravity",
  surface_kind: "cli",
  package: { installable: false, installability: "target", manifest_format: "antigravity-manifest" },
  bootstrap: {
    context_injection: "instruction_file",
    skill_autoload: false,
    prompt_transform: false,
    wrapper_injection: true
  },
  permissions: {
    deny: true,
    ask: true,
    ask_mode: null,
    accept_edits_without_prompt: false,
    auto_approve_tools: false,
    bypass_prompts: true,
    bypass_sandbox: true,
    permission_prompt_layer: false,
    launch_modes: {
      bypass_all: ["--dangerously-skip-permissions"]
    }
  },
  ...TARGET_CLI_COMMON
};
var AGENTS_FILE_CAPABILITIES = {
  schema_version: "guild.host_capabilities.v1",
  host_kind: "agents-file",
  family: "agents",
  surface_kind: "file",
  package: { installable: false, installability: "target", manifest_format: "agents-file" },
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

// ../src/modules/host-runtime/workflows/host-registry-schema.ts
var HOST_IDS = [
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector"
];
var HOST_FAMILIES = ["claude", "codex", "agents", "pi", "antigravity"];
var CLAUDE_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-code-cli",
  family: "claude",
  surface_kind: "cli",
  detection: { bin: "claude", requires_auth: false, auth_probe: "none" },
  installability: "native",
  result_adapter: false,
  // Claude is the reference author host, not a cross reviewer for itself.
  dispatch_selectable: true,
  capabilities: CLAUDE_CAPABILITIES,
  provenance: "verified"
};
var CODEX_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "codex-cli",
  family: "codex",
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
function inferredCaps(host_kind, family, surface_kind = "cli") {
  return {
    schema_version: "guild.host_capabilities.v1",
    host_kind,
    family,
    // Must equal the registry entry's top-level surface_kind (cross-field invariant,
    // enforced by validateHostRegistryEntry). `.agents` is a file surface, not cli.
    surface_kind,
    package: { installable: false, installability: "target", manifest_format: `${host_kind}-package` },
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
var AGENTS_FILE_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "agents-file",
  family: "agents",
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
var PI_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "pi-cli",
  family: "pi",
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
    structured_output: { native_json: true, schema_validation: false, repair_prompt: true }
    // --mode json
  },
  provenance: "verified"
  // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
};
var ANTIGRAVITY_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "antigravity-cli",
  family: "antigravity",
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
      launch_modes: { bypass_all: ["--dangerously-skip-permissions"] }
    }
  },
  provenance: "verified"
  // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
};
var CLAUDE_APP_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-code-app",
  family: "claude",
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("claude-code-app", "claude", "app"),
  provenance: "inferred"
};
var CLAUDE_WEB_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-code-web",
  family: "claude",
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("claude-code-web", "claude", "app"),
  provenance: "inferred"
};
var CODEX_APP_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "codex-app",
  family: "codex",
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("codex-app", "codex", "app"),
  provenance: "inferred"
};
var CLAUDE_AI_CONNECTOR_ENTRY = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-ai-connector",
  family: "claude",
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("claude-ai-connector", "claude", "app"),
  provenance: "inferred"
};
var HOST_REGISTRY_ROWS = {
  "claude-code-cli": CLAUDE_ENTRY,
  "codex-cli": CODEX_ENTRY,
  "pi-cli": PI_ENTRY,
  "antigravity-cli": ANTIGRAVITY_ENTRY,
  "agents-file": AGENTS_FILE_ENTRY,
  "claude-code-app": CLAUDE_APP_ENTRY,
  "claude-code-web": CLAUDE_WEB_ENTRY,
  "codex-app": CODEX_APP_ENTRY,
  "claude-ai-connector": CLAUDE_AI_CONNECTOR_ENTRY
};
var HOST_ID_SET = new Set(HOST_IDS);
var FAMILY_SET = new Set(HOST_FAMILIES);

// ../src/modules/host-runtime/workflows/host-id-namespace.ts
var HOST_ID_SET2 = new Set(HOST_IDS);

// ../src/modules/host-runtime/workflows/adapter-fallback-ladders.ts
var RUNGS = ["native", "wrapped", "bridged", "emulated", "degraded"];
var ADAPTER_SURFACES = ["interaction", "session", "semantic_tool", "browser"];
var RUNG_SET = new Set(RUNGS);
var SURFACE_SET = new Set(ADAPTER_SURFACES);

// ../src/modules/host-runtime/workflows/host-profiles-validate.ts
var KNOWN_HOST_IDS = new Set(HOST_IDS);

// ../src/modules/host-runtime/workflows/host-registry.ts
var FAMILY_TO_ROW = (() => {
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
function resultAdapterForFamily(family) {
  return FAMILY_TO_ROW[family]?.result_adapter ?? false;
}

// ../src/modules/host-runtime/workflows/provider-detect.ts
var PROVIDER_REGISTRY = [
  // The author host itself — always "detected on the host", never a cross reviewer
  // for a same-family author (the AC-8 guard handles that).
  { id: "claude", kind: "host", family: "claude", hasAdapter: resultAdapterForFamily("claude"), requiresAuth: false },
  // Codex reference adapters (the only selectable cross reviewers today).
  { id: "codex-plugin", kind: "plugin-adapter", family: "codex", bin: "codex", hasAdapter: resultAdapterForFamily("codex"), requiresAuth: true },
  { id: "codex-cli", kind: "cli", family: "codex", bin: "codex", hasAdapter: resultAdapterForFamily("codex"), requiresAuth: true },
  // Detect-only until adapters ship (OD-6) — no registry row for gemini (D10); pi/antigravity rows carry result_adapter:false.
  { id: "gemini-cli", kind: "cli", family: "gemini", bin: "gemini", hasAdapter: resultAdapterForFamily("gemini"), requiresAuth: false },
  { id: "pi", kind: "cli", family: "pi", bin: "pi", hasAdapter: resultAdapterForFamily("pi"), requiresAuth: false },
  // VERIFIED on-host 2026-06-16: the Antigravity CLI is `agy` (1.0.8), not `antigravity` — detection must probe `agy` or it never finds the host.
  { id: "antigravity", kind: "cli", family: "antigravity", bin: "agy", hasAdapter: resultAdapterForFamily("antigravity"), requiresAuth: false }
];

// ../src/modules/kernel/workflows/yaml-loader.ts
var path2 = __toESM(require("node:path"));
function candidateScriptsRoots() {
  return [
    // Source/runtime TS layout: src/modules/kernel/workflows -> plugin/scripts.
    path2.resolve(__dirname, "..", "..", "..", "..", "scripts"),
    // Bundled hook layout: hooks/dist -> plugin/scripts.
    path2.resolve(__dirname, "..", "..", "scripts"),
    // Bundled agent-team hook layout: hooks/agent-team/dist -> plugin/scripts.
    path2.resolve(__dirname, "..", "..", "..", "scripts"),
    path2.resolve(process.cwd(), "scripts")
  ];
}
function loadYamlApi() {
  const tried = [];
  for (const scriptsRoot of candidateScriptsRoots()) {
    tried.push(scriptsRoot);
    try {
      return require(require.resolve("js-yaml", { paths: [scriptsRoot] }));
    } catch {
    }
  }
  throw new Error(`Cannot resolve js-yaml from plugin scripts roots: ${tried.join(", ")}`);
}

// ../src/modules/config/workflows/settings-reader.ts
var yaml = loadYamlApi();
var VALID_TIER_HOST_KEYS = new Set(HOST_IDS);
var KNOWN_HOST_IDS2 = new Set(HOST_IDS);
var DISPATCH_HOST_IDS = new Set(
  HOST_IDS.filter((id) => HOST_REGISTRY_ROWS[id].dispatch_selectable === true)
);

// ../src/modules/state/workflows/frontmatter.ts
var loadedYaml = null;
function yamlApi() {
  if (loadedYaml === null) loadedYaml = loadYamlApi();
  return loadedYaml;
}
function parseYaml(text, opts = {}) {
  try {
    const yaml2 = yamlApi();
    const value = yaml2.load(text, { schema: opts.schema ?? yaml2.JSON_SCHEMA });
    return value === void 0 ? null : value;
  } catch {
    return null;
  }
}
function topLevelKeyLineIndex(lines, key) {
  const prefix = key + ":";
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^[ \t]/.test(ln)) continue;
    if (ln.startsWith(prefix)) return i;
  }
  return -1;
}
function replaceTopLevelLine(text, key, replacementLine) {
  const lines = text.split("\n");
  const i = topLevelKeyLineIndex(lines, key);
  if (i === -1) return { text, replaced: false };
  const hadCr = lines[i].endsWith("\r");
  lines[i] = hadCr ? replacementLine + "\r" : replacementLine;
  return { text: lines.join("\n"), replaced: true };
}

// ../src/modules/migrations/workflows/index-migrate.ts
var import_node_child_process = require("node:child_process");
var fs2 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
function openDatabase(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
var CURRENT_SCHEMA_VERSION = 3;
function resolveGuildRoot2(cwd) {
  try {
    const raw = (0, import_node_child_process.execFileSync)("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const abs = path3.isAbsolute(raw) ? raw : path3.resolve(cwd, raw);
    const root = path3.dirname(abs);
    if (fs2.existsSync(root)) return root;
  } catch {
  }
  return path3.resolve(cwd);
}
var MIGRATIONS = [
  // ── v1: core tables ───────────────────────────────────────────────────────
  {
    version: 1,
    tables: ["kg_nodes", "kg_edges", "kl_edges", "run_provenance", "wiki_fts", "_fingerprints"],
    up(db) {
      db.exec(`
        DROP TABLE IF EXISTS kg_nodes;
        DROP TABLE IF EXISTS kg_edges;
        DROP TABLE IF EXISTS kl_edges;
        DROP TABLE IF EXISTS run_provenance;
        DROP TABLE IF EXISTS wiki_fts;
        DROP TABLE IF EXISTS _fingerprints;
      `);
      db.exec(`
        CREATE TABLE kg_nodes (
          id         TEXT NOT NULL PRIMARY KEY,
          type       TEXT,
          name       TEXT,
          source_refs TEXT,
          confidence TEXT,
          layer      TEXT,
          data       TEXT
        );

        CREATE TABLE kg_edges (
          id        INTEGER PRIMARY KEY,
          source    TEXT NOT NULL,
          target    TEXT NOT NULL,
          type      TEXT,
          direction TEXT,
          weight    REAL,
          data      TEXT
        );

        CREATE TABLE kl_edges (
          id        INTEGER PRIMARY KEY,
          from_node TEXT NOT NULL,
          to_node   TEXT NOT NULL,
          type      TEXT,
          run_id    TEXT,
          data      TEXT
        );

        CREATE TABLE run_provenance (
          run_id TEXT NOT NULL PRIMARY KEY,
          ts     TEXT,
          data   TEXT
        );

        CREATE TABLE _fingerprints (
          table_name   TEXT NOT NULL PRIMARY KEY,
          source_path  TEXT NOT NULL,
          sha256       TEXT NOT NULL,
          populated_at TEXT NOT NULL
        );
      `);
      try {
        db.exec(`
          CREATE VIRTUAL TABLE wiki_fts USING fts5(
            path      UNINDEXED,
            title,
            content,
            tokenize='porter ascii'
          );
        `);
      } catch {
        db.exec(`
          CREATE TABLE wiki_fts (
            path    TEXT,
            title   TEXT,
            content TEXT
          );
        `);
      }
    }
  },
  // ── v2: federation_wiki_cache (TE-14) ────────────────────────────────────
  //
  // Stores a flat BM25-ready snapshot of each federated sub-guild's wiki.
  // Primary key is (sub_guild_root, path) — one row per page per sub-guild.
  // Fingerprint key in _fingerprints: "federation_wiki_cache:<sub_guild_root>".
  //
  // BOUNDARY: this table ONLY lives in the workspace-root index.sqlite.
  // ensureFederationWikiCache() NEVER writes to sub_guild_root/.guild/.
  {
    version: 2,
    tables: ["federation_wiki_cache"],
    up(db) {
      db.exec(`DROP TABLE IF EXISTS federation_wiki_cache;`);
      db.exec(`
        CREATE TABLE federation_wiki_cache (
          sub_guild_root TEXT NOT NULL,
          path           TEXT NOT NULL,
          title          TEXT,
          snippet        TEXT,
          PRIMARY KEY (sub_guild_root, path)
        );
      `);
    }
  },
  // ── v3: optional structural projection (T5.1 / G5) ───────────────────────
  //
  // Two OPTIONAL acceleration tables projected from the canonical, file-first
  // knowledge-graph.json (goals.md §G5). Both are pure, threshold-gated,
  // fingerprinted, fully-rebuildable caches: deleting index.sqlite loses
  // nothing, and `index: off` (in-process JSON BFS via lib/graph-query.ts)
  // remains the source of truth that returns IDENTICAL answers.
  //
  //   kg_calls       — denormalized `calls` edges (source, target, confidence),
  //                    indexed on source AND target so the call-graph BFS
  //                    (kgTrace / kgDeadCode) is fetched without parsing the
  //                    whole JSON graph.
  //   kg_symbols_fts — FTS5 over the camel/snake-split tokens of each named
  //                    node, so identifier search (`process_order` →
  //                    `processOrder`) is an index lookup, not a full node scan.
  //                    Tokens are PRE-SPLIT with the shared identifier-aware
  //                    tokenizer (bm25.ts:tokenizeIdentifierAware) on BOTH the
  //                    document and query side, so the FTS built-in tokenizer
  //                    only has to whitespace-split — the camel/snake behaviour
  //                    lives in the (deterministic, model-free) projection feed.
  {
    version: 3,
    tables: ["kg_calls", "kg_symbols_fts"],
    up(db) {
      db.exec(`
        DROP TABLE IF EXISTS kg_calls;
        DROP TABLE IF EXISTS kg_symbols_fts;
      `);
      db.exec(`
        CREATE TABLE kg_calls (
          id         INTEGER PRIMARY KEY,
          source     TEXT NOT NULL,
          target     TEXT NOT NULL,
          confidence TEXT
        );
        CREATE INDEX kg_calls_source ON kg_calls (source);
        CREATE INDEX kg_calls_target ON kg_calls (target);
      `);
      try {
        db.exec(`
          CREATE VIRTUAL TABLE kg_symbols_fts USING fts5(
            node_id UNINDEXED,
            name_tokens,
            tokenize='ascii'
          );
        `);
      } catch {
        db.exec(`
          CREATE TABLE kg_symbols_fts (
            node_id     TEXT,
            name_tokens TEXT
          );
        `);
      }
    }
  }
];
function runMigrations(dbPath) {
  let db;
  let fromVersion = 0;
  try {
    fs2.mkdirSync(path3.dirname(dbPath), { recursive: true });
    db = openDatabase(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    fromVersion = db.prepare("PRAGMA user_version").get().user_version;
    for (const mig of MIGRATIONS) {
      if (mig.version <= fromVersion) continue;
      try {
        db.exec("BEGIN IMMEDIATE");
        mig.up(db);
        db.exec(`PRAGMA user_version = ${mig.version}`);
        db.exec("COMMIT");
        fromVersion = mig.version;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
        }
        for (const tbl of mig.tables) {
          try {
            db.exec(`DROP TABLE IF EXISTS ${tbl}`);
          } catch {
          }
        }
        db.close();
        return {
          ok: false,
          fromVersion,
          toVersion: fromVersion,
          dbPath,
          message: `migration to v${mig.version} failed: ${err.message}`
        };
      }
    }
    db.close();
    return {
      ok: true,
      fromVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      dbPath
    };
  } catch (err) {
    try {
      db?.close();
    } catch {
    }
    return {
      ok: false,
      fromVersion,
      toVersion: fromVersion,
      dbPath,
      message: `migration runner error: ${err.message}`
    };
  }
}
function runIndexMigrateCli() {
  const argv = process.argv.slice(2);
  let cwd = process.env["GUILD_CWD"] ?? process.cwd();
  let dbPath;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && argv[i + 1]) cwd = argv[++i];
    if (argv[i] === "--db-path" && argv[i + 1]) dbPath = argv[++i];
  }
  if (!dbPath) {
    const guildRoot = resolveGuildRoot2(cwd);
    dbPath = path3.join(guildRoot, ".guild", "index.sqlite");
  }
  const result = runMigrations(dbPath);
  if (result.ok) {
    process.stdout.write(
      `[index-migrate] OK: schema v${result.fromVersion}\u2192v${result.toVersion} at ${result.dbPath}
`
    );
  } else {
    process.stderr.write(`[index-migrate] WARN: ${result.message}
`);
    process.exit(1);
  }
}
if (typeof module !== "undefined" && require.main === module) {
  runIndexMigrateCli();
}

// lib/security/scrubbed-write.ts
var fs5 = __toESM(require("node:fs"));
var path6 = __toESM(require("node:path"));
var crypto = __toESM(require("node:crypto"));

// lib/v1.4/redact-log.ts
var TOKEN_REDACTED = "[REDACTED_TOKEN]";
var PATH_REDACTED = "[REDACTED]";
var KV_REDACTED = "[REDACTED]";
var HIGH_ENTROPY_REDACTED = "<HIGH_ENTROPY_REDACTED>";
var TRUNCATION_SUFFIX = "... [TRUNCATED]";
var FIELD_SIZE_CAP_BYTES = 4 * 1024;
var TOKEN_SHAPE_PATTERNS = [
  /Authorization:\s*Bearer\s+[A-Za-z0-9._\-+/=]+/g,
  /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/g,
  /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/g,
  /\bghp_[A-Za-z0-9]{36}\b/g,
  /\bgh[suor]_[A-Za-z0-9]{36}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
  /\bxox[bp]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
];
function redactTokenShapes(input) {
  let out = input;
  for (const re of TOKEN_SHAPE_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags), TOKEN_REDACTED);
  }
  return out;
}
var HOME_DIR_PATTERN = /(~|\/Users\/[^/\s]+|\/home\/[^/\s]+)\/(\.claude|\.codex|\.ssh|\.aws|\.gnupg)\/[^\s'"]+/g;
function redactHomeDirPaths(input) {
  return input.replace(HOME_DIR_PATTERN, (_match, root, dir) => {
    return `${root}/${dir}/${PATH_REDACTED}`;
  });
}
var KV_SECRET_PATTERN = /\b(password|token|api[_-]?key|secret|authorization|bearer)(\s*[:=]\s*)(\S+)/gi;
function redactKeyValueSecrets(input) {
  return input.replace(
    KV_SECRET_PATTERN,
    (_match, key, sep2) => `${key}${sep2}${KV_REDACTED}`
  );
}
function isWhitelistedHighEntropy(candidate, fullInput, matchIndex) {
  if (matchIndex >= 4 && fullInput.slice(matchIndex - 4, matchIndex) === "run-") {
    return true;
  }
  const lookBackStart = Math.max(0, matchIndex - 16);
  const before = fullInput.slice(lookBackStart, matchIndex).toLowerCase();
  if (/\b(commit|sha|tree|parent|head|merge|object|branch)\s*[:=]?\s*$/.test(before)) {
    return true;
  }
  if (/^[0-9a-f]{40}$/.test(candidate) || /^[0-9a-f]{64}$/.test(candidate)) {
    return true;
  }
  return false;
}
var HIGH_ENTROPY_PATTERN = /[A-Za-z0-9+/=]{20,}/g;
function redactHighEntropy(input) {
  return input.replace(HIGH_ENTROPY_PATTERN, (match, offset) => {
    if (isWhitelistedHighEntropy(match, input, offset)) {
      return match;
    }
    return HIGH_ENTROPY_REDACTED;
  });
}
function truncateToCap(input, cap = FIELD_SIZE_CAP_BYTES) {
  const byteLen = Buffer.byteLength(input, "utf8");
  if (byteLen <= cap) return input;
  const buf = Buffer.from(input, "utf8");
  const truncated = buf.slice(0, cap).toString("utf8");
  const cleaned = truncated.replace(/\uFFFD+$/u, "");
  return cleaned + TRUNCATION_SUFFIX;
}
function redactField(input, cap = FIELD_SIZE_CAP_BYTES) {
  if (typeof input !== "string") return input;
  let out = redactTokenShapes(input);
  out = redactHomeDirPaths(out);
  out = redactKeyValueSecrets(out);
  out = redactHighEntropy(out);
  out = truncateToCap(out, cap);
  return out;
}

// lib/security/secrets.ts
function applySecretsPolicy(value, policy, opts) {
  if (typeof value !== "string") {
    return { value: typeof value === "string" ? value : String(value ?? ""), ok: true, failures: [] };
  }
  let out = redactField(value, opts?.noTruncate ? Number.POSITIVE_INFINITY : void 0);
  const failures = [];
  for (const pat of policy.redaction_patterns) {
    let re;
    try {
      re = new RegExp(pat, "g");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    try {
      out = out.replace(re, "[REDACTED]");
    } catch (err) {
      failures.push(`${pat}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { value: out, ok: failures.length === 0, failures };
}

// lib/security/config.ts
var fs3 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
function securityDefaults() {
  return {
    bypass_permissions_policy: "audit",
    secrets_policy: {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed",
      fail_mode_telemetry: "open"
    },
    tool_description_hashes: {},
    mcp_availability: {
      stdio_available: true,
      http_available: false,
      bridge_package: null
    },
    allowed_tools: []
  };
}
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function parseSecurityConfig(parsed) {
  const out = securityDefaults();
  if (!isPlainObject(parsed)) return out;
  if (isPlainObject(parsed["security"])) {
    const bpp = parsed["security"]["bypass_permissions_policy"];
    if (bpp === "deny" || bpp === "audit" || bpp === "allow") {
      out.bypass_permissions_policy = bpp;
    }
  }
  if (isPlainObject(parsed["secrets_policy"])) {
    const sp = parsed["secrets_policy"];
    if (isStringArray(sp["env_allowlist"])) out.secrets_policy.env_allowlist = sp["env_allowlist"];
    if (isStringArray(sp["redaction_patterns"])) {
      out.secrets_policy.redaction_patterns = sp["redaction_patterns"];
    }
    if (sp["fail_mode_durable"] === "closed" || sp["fail_mode_durable"] === "open") {
      out.secrets_policy.fail_mode_durable = sp["fail_mode_durable"];
    }
    if (sp["fail_mode_telemetry"] === "open" || sp["fail_mode_telemetry"] === "closed") {
      out.secrets_policy.fail_mode_telemetry = sp["fail_mode_telemetry"];
    }
  }
  if (isPlainObject(parsed["defaults"])) {
    const defs = parsed["defaults"];
    if (isStringArray(defs["allowed_tools"])) {
      out.allowed_tools = defs["allowed_tools"];
    }
  }
  if (isPlainObject(parsed["mcp"])) {
    const mcp = parsed["mcp"];
    if (isPlainObject(mcp["tool_description_hashes"])) {
      const hashes = {};
      for (const [k, v] of Object.entries(mcp["tool_description_hashes"])) {
        if (typeof v === "string") hashes[k] = v;
      }
      out.tool_description_hashes = hashes;
    }
    if (typeof mcp["stdio_available"] === "boolean") {
      out.mcp_availability.stdio_available = mcp["stdio_available"];
    }
    if (typeof mcp["http_available"] === "boolean") {
      out.mcp_availability.http_available = mcp["http_available"];
    }
    if (mcp["bridge_package"] === null || typeof mcp["bridge_package"] === "string") {
      out.mcp_availability.bridge_package = mcp["bridge_package"];
    }
  }
  return out;
}
function readSecurityConfig(cwd) {
  const settingsPath = path4.join(resolveGuildRoot(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs3.readFileSync(settingsPath, "utf8");
  } catch {
    return securityDefaults();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return securityDefaults();
  }
  return parseSecurityConfig(parsed);
}

// lib/security/events.ts
var fs4 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));
var SECURITY_EVENT_SCHEMA_VERSION = "guild.security_event.v1";
var KNOWN_GUILD_HOST_KINDS = [
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector"
];
var KNOWN_GUILD_HOST_ID_SET = new Set(KNOWN_GUILD_HOST_KINDS);
var LEGACY_HOST_ALIASES = {
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
function normalizeSecurityHostId(value) {
  const s = value.trim();
  if (KNOWN_GUILD_HOST_ID_SET.has(s)) return s;
  return LEGACY_HOST_ALIASES[s] ?? null;
}
function resolveHostResolution(env) {
  const explicit = (env["GUILD_HOST_ID"] ?? "").trim();
  if (explicit.length > 0) return { id: explicit, degraded: false, rawUnknown: "" };
  const rawHost = (env["GUILD_HOST"] ?? "").trim().toLowerCase();
  if (rawHost.length === 0) return { id: "claude-code-cli", degraded: false, rawUnknown: "" };
  const normalized = normalizeSecurityHostId(rawHost);
  if (normalized) return { id: normalized, degraded: false, rawUnknown: "" };
  return { id: rawHost, degraded: true, rawUnknown: rawHost };
}
function resolveHostId() {
  return resolveHostResolution(process.env).id;
}
function buildSecurityEvent(input) {
  const rec = {
    schema_version: SECURITY_EVENT_SCHEMA_VERSION,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    run_id: input.run_id,
    event_type: input.event_type,
    decision: input.decision,
    tool: input.tool,
    detail: redactField(input.detail ?? ""),
    host: typeof input.host === "string" && input.host.length > 0 ? input.host : resolveHostId()
  };
  if (typeof input.lane_id === "string" && input.lane_id.length > 0) rec.lane_id = input.lane_id;
  if (input.policy !== void 0) rec.policy = input.policy;
  if (typeof input.permission_mode === "string" && input.permission_mode.length > 0) {
    rec.permission_mode = input.permission_mode;
  }
  if (typeof input.dispatch_rung === "string" && input.dispatch_rung.length > 0) {
    rec.dispatch_rung = input.dispatch_rung;
  }
  return rec;
}
function appendSecurityEvent(runDir3, record) {
  try {
    const logsDir2 = path5.join(runDir3, "logs");
    fs4.mkdirSync(logsDir2, { recursive: true });
    fs4.appendFileSync(path5.join(logsDir2, "security-events.jsonl"), JSON.stringify(record) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [security-events] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// lib/security/scrubbed-write.ts
function guildRootFromRunDir(runDir3) {
  return path6.resolve(runDir3, "../../..");
}
function writeScrubApprovalRequest(runDir3, runId, surface, outPath, laneId) {
  try {
    const approvalDir = path6.join(runDir3, "agent-bus", "approvals");
    fs5.mkdirSync(approvalDir, { recursive: true });
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    const safeTs = ts.replace(/[:.]/g, "-");
    const fileName = `${safeTs}-scrub-blocked.json`;
    const record = {
      schema_version: "guild.approval_request.v1",
      ts,
      run_id: runId,
      tool: "scrubbedWrite",
      reason: `Secret scrub failed for durable surface "${surface}" \u2014 write blocked. Human review required. Path: ${path6.basename(outPath)}`,
      permission_mode: "blocked",
      surface
    };
    if (laneId) record["lane_id"] = laneId;
    const rawContent = JSON.stringify(record, null, 2) + "\n";
    let content = rawContent;
    try {
      const secConfig = readSecurityConfig(guildRootFromRunDir(runDir3));
      const scrubResult = applySecretsPolicy(rawContent, secConfig.secrets_policy, { noTruncate: true });
      content = scrubResult.value;
    } catch {
    }
    fs5.writeFileSync(path6.join(approvalDir, fileName), content, "utf8");
  } catch {
  }
}
function scrubbedWrite(outPath, content, opts) {
  const guildRoot = guildRootFromRunDir(opts.runDir);
  let policy;
  try {
    const secConfig = readSecurityConfig(guildRoot);
    policy = secConfig.secrets_policy;
  } catch {
    policy = {
      env_allowlist: [],
      redaction_patterns: [],
      fail_mode_durable: "closed",
      fail_mode_telemetry: "open"
    };
  }
  const scrubResult = applySecretsPolicy(content, policy, { noTruncate: true });
  const failMode = opts.surface === "telemetry" ? policy.fail_mode_telemetry : policy.fail_mode_durable;
  if (scrubResult.ok) {
    try {
      fs5.mkdirSync(path6.dirname(outPath), { recursive: true });
      fs5.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: write failed for surface "${opts.surface}" at ${outPath}: ${err instanceof Error ? err.message : String(err)}
`
      );
      return { written: false, blocked: false };
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }
  if (failMode === "open") {
    process.stderr.write(
      `[scrubbed-write] WARN: secret scrub custom-pattern failure for surface "${opts.surface}" at ${path6.basename(outPath)} \u2014 writing built-in-redacted content (fail-open). Failures: ${scrubResult.failures.join("; ")}
`
    );
    try {
      fs5.mkdirSync(path6.dirname(outPath), { recursive: true });
      fs5.writeFileSync(outPath, scrubResult.value, "utf8");
    } catch (err) {
      process.stderr.write(
        `[scrubbed-write] ERROR: fail-open write failed: ${err instanceof Error ? err.message : String(err)}
`
      );
      return { written: false, blocked: false };
    }
    try {
      const evt = buildSecurityEvent({
        run_id: opts.runId,
        lane_id: opts.laneId,
        event_type: "secret_scrub_blocked",
        decision: "degraded",
        tool: "scrubbedWrite",
        detail: `Secret scrub custom-pattern failure (fail-open) for surface "${opts.surface}" at ${path6.basename(outPath)}. Built-in-redacted content written.`,
        permission_mode: "degraded"
      });
      appendSecurityEvent(opts.runDir, evt);
    } catch {
    }
    const result = { written: true, blocked: false };
    if (opts.surface === "bus") {
      result.sha256 = crypto.createHash("sha256").update(scrubResult.value, "utf8").digest("hex");
    }
    return result;
  }
  process.stderr.write(
    `[scrubbed-write] BLOCKED: secret scrub failed for durable surface "${opts.surface}" at ${outPath} \u2014 file NOT written. Failures: ${scrubResult.failures.join("; ")}
`
  );
  try {
    const evt = buildSecurityEvent({
      run_id: opts.runId,
      lane_id: opts.laneId,
      event_type: "secret_scrub_blocked",
      decision: "blocked",
      tool: "scrubbedWrite",
      detail: `Secret scrub failed for durable surface "${opts.surface}" at ${path6.basename(outPath)} \u2014 write blocked (fail-closed).`,
      permission_mode: "blocked"
    });
    appendSecurityEvent(opts.runDir, evt);
  } catch {
  }
  writeScrubApprovalRequest(opts.runDir, opts.runId, opts.surface, outPath, opts.laneId);
  return { written: false, blocked: true };
}

// ../src/modules/lifecycle/workflows/run-lifecycle.ts
function runDir(root, runId) {
  return path7.join(root, ".guild", "runs", runId);
}
function runYamlPath(root, runId) {
  return path7.join(runDir(root, runId), "run.yaml");
}
function provenancePath(root, runId) {
  return path7.join(runDir(root, runId), "provenance.json");
}
function logsDir(root, runId) {
  return path7.join(runDir(root, runId), "logs");
}
function resolvedSettingsPath(root, runId) {
  return path7.join(runDir(root, runId), "resolved-settings.json");
}
function sentinelPath(root) {
  return path7.join(root, ".guild", "runs", "current-run-id");
}
function logRefFor(runId) {
  return `.guild/runs/${runId}/logs/v1.4-events.jsonl`;
}
function utcCompact(nowIso) {
  const d = new Date(nowIso);
  const iso = Number.isNaN(d.getTime()) ? nowIso : d.toISOString();
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
  const digits = iso.replace(/\D/g, "");
  return `${digits.slice(0, 8)}-${digits.slice(8, 14)}`;
}
function makeRunId(initiative, nowIso) {
  if (initiative) return `run-${initiative}-${utcCompact(nowIso)}`;
  return `run-${crypto2.randomUUID()}`;
}
function yamlScalar(v) {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (v === "") return '""';
  if (/^[\w./:@+-]+$/.test(v) && !/^\d{4}-\d{2}/.test(v)) return v;
  if (/^[^\s#:][^#]*$/.test(v) && !v.includes(": ") && !/[:#]$/.test(v)) return v;
  return JSON.stringify(v);
}
function serializeRunYaml(rec) {
  const lines = [];
  const emit = (obj, indent) => {
    const pad = "  ".repeat(indent);
    for (const [k, val] of Object.entries(obj)) {
      if (val === void 0) continue;
      if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${pad}${k}: []`);
        } else if (val.every((x) => typeof x !== "object" || x === null)) {
          lines.push(`${pad}${k}: [${val.map((x) => yamlScalar(x)).join(", ")}]`);
        } else {
          lines.push(`${pad}${k}:`);
          for (const item of val) {
            if (item && typeof item === "object") {
              const entries = Object.entries(item);
              entries.forEach(([ik, iv], i) => {
                const prefix = i === 0 ? `${pad}  - ` : `${pad}    `;
                lines.push(`${prefix}${ik}: ${yamlScalar(iv)}`);
              });
            } else {
              lines.push(`${pad}  - ${yamlScalar(item)}`);
            }
          }
        }
      } else if (val && typeof val === "object") {
        const entries = Object.entries(val);
        if (entries.length === 0) {
          lines.push(`${pad}${k}: {}`);
        } else {
          lines.push(`${pad}${k}:`);
          emit(val, indent + 1);
        }
      } else {
        lines.push(`${pad}${k}: ${yamlScalar(val)}`);
      }
    }
  };
  emit(rec, 0);
  return lines.join("\n") + "\n";
}
function buildRunManifest(opts, runId, env) {
  const host = env.resolveHost(opts.host_requested);
  const runClass = opts.run_class ?? "full";
  const workspace = {
    is_workspace: opts.workspace.is_workspace,
    root: opts.workspace.root
  };
  if (opts.workspace.sub_guilds && opts.workspace.sub_guilds.length > 0) {
    workspace["sub_guilds"] = opts.workspace.sub_guilds;
  }
  const hostBlock = {
    requested: host.requested,
    resolved: host.resolved
  };
  if (host.capabilities_ref) hostBlock["capabilities_ref"] = host.capabilities_ref;
  const phase = opts.phase ?? null;
  const manifest = {
    schema_version: "guild.run.v1",
    run_id: runId,
    command: opts.command,
    arguments: opts.arguments,
    cwd: opts.cwd,
    target_kind: opts.target_kind,
    workspace,
    project: opts.project,
    host: hostBlock,
    model_tier_policy: opts.model_tier_policy,
    started_at: env.now(),
    ignore_policy: opts.ignore_policy,
    scan_policy: opts.scan_policy,
    initiative_attachment: opts.initiative,
    // NN#5: scalar record ONLY
    phase,
    run_class: runClass,
    gates: {},
    status: "open",
    phases_log: phase ? [{ phase, at: env.now() }] : []
  };
  if (opts.snapshot) {
    manifest["settings_ref"] = {
      path: "resolved-settings.json",
      schema_version: opts.snapshot.schema_version,
      effective_backend: opts.snapshot.effective.agent_mode,
      review: opts.snapshot.effective.review,
      recommended_provider: opts.snapshot.providers.recommended
    };
  }
  return manifest;
}
function emptyTouched() {
  return { tasks: [], agents: [], skills: [], decisions: [], features: [], files: [], runs: [] };
}
function mergeTouched(supplied) {
  const base = emptyTouched();
  if (!supplied) return base;
  for (const k of Object.keys(base)) {
    const v = supplied[k];
    if (Array.isArray(v)) base[k] = v;
  }
  return base;
}
function readStartFacts(env, root, runId) {
  const raw = env.fs.readFile(runYamlPath(root, runId));
  if (raw === null) {
    throw new Error(
      `[run-lifecycle] closeRun("${runId}"): no run.yaml at ${runYamlPath(root, runId)} \u2014 cannot close a run that was never started.`
    );
  }
  const doc = parseYaml(raw);
  const obj = doc !== null && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
  const get = (key) => {
    const v = obj[key];
    return v === void 0 || v === null ? null : String(v);
  };
  const command = get("command") ?? "";
  const initRaw = get("initiative_attachment");
  const initiative = initRaw === null || initRaw === "null" || initRaw === "" ? null : initRaw;
  const runClassRaw = get("run_class");
  const run_class = runClassRaw === "lightweight" ? "lightweight" : "full";
  const started_at = get("started_at") ?? "";
  const self_build = obj["self_build"] === true;
  return { command, initiative, run_class, started_at, self_build };
}
function flipRunStatus(env, root, runId, status) {
  const p = runYamlPath(root, runId);
  const raw = env.fs.readFile(p);
  if (raw === null) return;
  const next = replaceTopLevelLine(raw, "status", `status: ${status}`).text;
  env.fs.writeFile(p, next);
}
function createRunLifecycle(env) {
  return {
    startRun(opts) {
      const runId = makeRunId(opts.initiative, env.now());
      const root = opts.root;
      env.fs.mkdirp(logsDir(root, runId));
      if (opts.snapshot) {
        writeResolvedSettingsSnapshot(runId, opts.snapshot, {
          cwd: root,
          fs: env.fs,
          // Use the run-id as the resolved_at_ref (deterministic, no Date.now).
          resolvedAtRef: runId
        });
      }
      const manifest = buildRunManifest(opts, runId, env);
      env.fs.writeFile(runYamlPath(root, runId), serializeRunYaml(manifest));
      env.fs.writeFile(sentinelPath(root), runId);
      return runId;
    },
    closeRun(runId, opts) {
      const root = resolveCloseRoot(env, runId);
      const facts = readStartFacts(env, root, runId);
      const runClass = facts.run_class;
      const now = env.now();
      const finalCheckpoint = runClass === "lightweight" ? null : opts.final_learning_checkpoint ?? null;
      const terminalTraceEvent = {
        event_id: `evt-${crypto2.randomUUID()}`,
        event_name: "run_closed",
        at: now,
        log_ref: logRefFor(runId)
      };
      const provenance = {
        schema_version: "guild.provenance.v1",
        run_id: runId,
        command: facts.command,
        initiative: facts.initiative,
        retention_class: facts.initiative ? "until-archive" : "one-off-90d",
        started_at: facts.started_at,
        closed_at: now,
        status: opts.status,
        run_class: runClass,
        terminal_trace_event: terminalTraceEvent,
        final_learning_checkpoint: finalCheckpoint,
        gates: opts.gates ?? {},
        touched: mergeTouched(opts.touched),
        artifacts: opts.artifacts ?? {},
        benchmark_eligible: opts.status === "closed"
      };
      if (opts.coverage) provenance.coverage = opts.coverage;
      const provPath = provenancePath(root, runId);
      const provenanceContent = JSON.stringify(provenance, null, 2) + "\n";
      if (env.fs.scrubbedWriteDurable) {
        const runDir3 = path7.join(root, ".guild", "runs", runId);
        const result = env.fs.scrubbedWriteDurable(provPath, provenanceContent, "provenance", runDir3, runId);
        if (result.blocked) {
          process.stderr.write(
            `[run-lifecycle] WARN: provenance.json write BLOCKED by secret scrub (fail-CLOSED) for run ${runId}. Security event emitted.
`
          );
        }
      } else {
        env.fs.writeFile(provPath, provenanceContent);
      }
      flipRunStatus(env, root, runId, opts.status);
    }
  };
}
function resolveCloseRoot(env, runId) {
  const hint = env.__rootHint;
  if (hint) return hint;
  const cwd = resolveGuildRoot(process.cwd());
  if (env.fs.exists(runYamlPath(cwd, runId))) return cwd;
  return cwd;
}
function createRealEnv(root, resolveHost) {
  const env = {
    now: () => (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    fs: {
      mkdirp(absPath) {
        fsNode.mkdirSync(absPath, { recursive: true });
      },
      writeFile(absPath, contents) {
        fsNode.mkdirSync(path7.dirname(absPath), { recursive: true });
        fsNode.writeFileSync(absPath, contents, "utf8");
      },
      readFile(absPath) {
        try {
          return fsNode.readFileSync(absPath, "utf8");
        } catch {
          return null;
        }
      },
      exists(absPath) {
        return fsNode.existsSync(absPath);
      },
      // HK-06: real scrubbedWrite wired for provenance.json (fail-CLOSED).
      scrubbedWriteDurable(outPath, contents, surface, runDir3, runId) {
        return scrubbedWrite(outPath, contents, { surface, runDir: runDir3, runId });
      }
    },
    resolveHost,
    __rootHint: root
  };
  return env;
}
function validateRunId(runId) {
  if (!runId || !runId.trim()) return false;
  if (runId.includes("\0")) return false;
  if (runId.startsWith("/") || runId.startsWith("\\")) return false;
  if (runId.includes("/") || runId.includes("\\")) return false;
  if (runId === ".") return false;
  if (runId === ".." || runId.startsWith("..")) return false;
  if (runId.includes("..")) return false;
  return true;
}
function assertContained(target, base, label) {
  const resolvedTarget = path7.resolve(target);
  const resolvedBase = path7.resolve(base);
  if (!resolvedTarget.startsWith(resolvedBase + path7.sep)) {
    throw new Error(
      `[run-lifecycle] ${label}: resolved path "${resolvedTarget}" escapes runs base "${resolvedBase}"`
    );
  }
}
function realProvenanceFsSeam() {
  return {
    writeFile(absPath, contents) {
      fsNode.mkdirSync(path7.dirname(absPath), { recursive: true });
      fsNode.writeFileSync(absPath, contents, "utf8");
    },
    readFile(absPath) {
      try {
        return fsNode.readFileSync(absPath, "utf8");
      } catch {
        return null;
      }
    },
    // HK-06: real scrubbed write wired for resolved-settings.json (fail-CLOSED).
    scrubbedWriteDurable(outPath, contents, surface, runDir3, runId) {
      return scrubbedWrite(outPath, contents, { surface, runDir: runDir3, runId });
    }
  };
}
function writeResolvedSettingsSnapshot(runId, snapshot, opts) {
  if (!validateRunId(runId)) {
    throw new Error(
      `[run-lifecycle] writeResolvedSettingsSnapshot: invalid runId ${JSON.stringify(runId)} \u2014 must be a non-empty single path component with no separators, no "..", not ".", not absolute`
    );
  }
  const { cwd, fs: fsSeam, resolvedAtRef } = opts;
  const fs9 = fsSeam ?? realProvenanceFsSeam();
  const outPath = resolvedSettingsPath(cwd, runId);
  const runsBase = path7.resolve(cwd, ".guild", "runs");
  assertContained(outPath, runsBase, "writeResolvedSettingsSnapshot");
  const onDisk = {
    ...snapshot,
    resolved_at_ref: resolvedAtRef ?? runId
  };
  const serialized = JSON.stringify(onDisk, null, 2) + "\n";
  if (fs9.scrubbedWriteDurable) {
    const runDir3 = path7.join(cwd, ".guild", "runs", runId);
    const result = fs9.scrubbedWriteDurable(outPath, serialized, "config", runDir3, runId);
    if (result.blocked) {
      process.stderr.write(
        `[run-lifecycle] WARN: resolved-settings.json write BLOCKED by secret scrub (fail-CLOSED) for run ${runId}. Security event emitted.
`
      );
    }
  } else {
    fs9.writeFile(outPath, serialized);
  }
  return outPath;
}

// emit-learning-checkpoint.ts
var fs6 = __toESM(require("fs"));
var path8 = __toESM(require("path"));

// ../src/modules/initiatives/workflows/classify-proposal.ts
function classifyProposal(input) {
  const target = input.target ?? "skill";
  const subject = input.subject ?? "<skill>";
  const countGate = input.distinct_subject_count >= 3 || input.distinct_subject_count >= 2 && input.same_run === true;
  const systemic = countGate && input.same_signature === true && input.user_approved === true;
  const perInstance = `${target}_def: proposal:${subject}`;
  const outputs = [perInstance];
  if (systemic) {
    outputs.push(`${target}_template: systemic-proposal`);
  }
  return { verdict: systemic ? "systemic" : "specific", outputs };
}
function parseFlag(argv, name) {
  const eq = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
    if (argv[i].startsWith(eq)) return argv[i].slice(eq.length);
  }
  return void 0;
}
function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}
function runClassifyProposalCli(argv = process.argv.slice(2)) {
  const distinct = parseInt(parseFlag(argv, "distinct") ?? "0", 10);
  const target = parseFlag(argv, "target") ?? "skill";
  const subject = parseFlag(argv, "subject");
  const res = classifyProposal({
    distinct_subject_count: Number.isFinite(distinct) ? distinct : 0,
    same_run: hasFlag(argv, "same-run"),
    same_signature: hasFlag(argv, "same-signature"),
    user_approved: hasFlag(argv, "user-approved"),
    target: target === "agent" ? "agent" : "skill",
    ...subject ? { subject } : {}
  });
  process.stdout.write(JSON.stringify(res, null, 2) + "\n");
}
if (require.main === module) runClassifyProposalCli();

// ../src/modules/initiatives/workflows/initiative-activity.ts
var ACTIVITY_EVENTS = [
  "created",
  "status_change",
  "definition_updated",
  "work_item_added",
  "work_item_closed",
  "run_attached",
  "summary_updated",
  "released",
  "closed",
  "archived",
  "note"
];
var SET = new Set(ACTIVITY_EVENTS);

// ../src/modules/initiatives/workflows/initiative-workitems.ts
var WORK_ITEM_TYPES = [
  "research",
  "design",
  "implementation",
  "review",
  "validation",
  "docs",
  "release",
  "cleanup"
];
var WORK_ITEM_STATUS = [
  "proposed",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "deferred",
  "cancelled"
];
var TYPES = new Set(WORK_ITEM_TYPES);
var STATUS = new Set(WORK_ITEM_STATUS);

// ../src/modules/evolution/workflows/learning-signatures.ts
function allLearnings(artifacts) {
  const out = [];
  for (const block of artifacts.handoffBlocks ?? []) {
    for (const l of block.learnings ?? []) {
      if (l) out.push(l);
    }
  }
  return out;
}
function allFollowups(artifacts) {
  const out = [];
  for (const block of artifacts.handoffBlocks ?? []) {
    for (const f of block.followups ?? []) {
      if (f) out.push(f);
    }
  }
  return out;
}
function bestRef(artifacts) {
  const wiki = artifacts.provenanceTouched?.wiki ?? [];
  if (wiki.length > 0) return wiki[0];
  return artifacts.evidenceRef ?? artifacts.runId;
}
function filesInclude(artifacts, patterns) {
  const files = [
    ...artifacts.changedFiles ?? [],
    ...artifacts.provenanceTouched?.files ?? []
  ];
  return files.some((f) => patterns.some((p) => p.test(f)));
}
function learningsReferenceSkill(artifacts) {
  const learnings = allLearnings(artifacts);
  const followups = allFollowups(artifacts);
  const all = [...learnings, ...followups];
  for (const text of all) {
    const match = text.match(/\b(?:skill[:\s]+|guild:)([\w:-]+)/i);
    if (match) return match[1] ?? "unknown-skill";
    if (/skill[\s_-](?:improvement|gap|defect|change|update|refactor)/i.test(text)) {
      return "unknown-skill";
    }
  }
  return null;
}
function learningsReferenceAgent(artifacts) {
  const learnings = allLearnings(artifacts);
  const followups = allFollowups(artifacts);
  const all = [...learnings, ...followups];
  for (const text of all) {
    const match = text.match(/\b(?:agent[:\s]+|guild:)([\w:-]+(?:engineer|writer|author|architect|specialist|reviewer|planner|developer|auditor))/i);
    if (match) return match[1] ?? "unknown-agent";
    if (/agent[\s_-](?:improvement|gap|defect|change|update|refactor)/i.test(text)) {
      return "unknown-agent";
    }
  }
  return null;
}
function classifyMemory(artifacts) {
  try {
    const decisions = artifacts.provenanceTouched?.decisions ?? [];
    if (decisions.length > 0) {
      const ref = decisions[0];
      return `candidate:${ref}`;
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyWiki(artifacts) {
  try {
    const wikiTouched = artifacts.provenanceTouched?.wiki ?? [];
    if (wikiTouched.length > 0) {
      return `candidate:${wikiTouched[0]}`;
    }
    const followups = allFollowups(artifacts);
    if (followups.some(
      (f) => /\b(?:wiki[\s_-]?ingest|wiki[\s_-]?page|decisions?[\s_-]?capture|guild:decisions|guild:wiki)/i.test(f)
    )) {
      return `candidate:${bestRef(artifacts)}`;
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyKnowledgeGraph(artifacts) {
  try {
    const initiatives = artifacts.provenanceTouched?.initiatives ?? [];
    if (initiatives.length > 0) {
      return "refresh:initiative-touched";
    }
    if (filesInclude(artifacts, [
      /\.guild\/wiki\//,
      /\.guild\/raw\/sources\//,
      /\.guild\/initiatives\//,
      /\.guild\/reflections\//,
      /\.guild\/evolve\//,
      /\.guild\/indexes\/harvest-/
    ])) {
      return "refresh:stale";
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyDomainModel(artifacts) {
  try {
    if (filesInclude(artifacts, [
      /\.guild\/indexes\/domain-graph\.json/
    ])) {
      return "re-derive";
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyAgentDef(artifacts) {
  try {
    const agentRef = learningsReferenceAgent(artifacts);
    if (agentRef !== null) {
      return `proposal:${agentRef}`;
    }
    const all = [...allLearnings(artifacts), ...allFollowups(artifacts)];
    for (const text of all) {
      const match = text.match(/proposal:([a-z][\w:-]+)/i);
      if (match && /agent/i.test(match[1] ?? "")) {
        return `proposal:${match[1]}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifySkillDef(artifacts) {
  try {
    const skillRef = learningsReferenceSkill(artifacts);
    if (skillRef !== null) {
      return `proposal:${skillRef}`;
    }
    const all = [...allLearnings(artifacts), ...allFollowups(artifacts)];
    for (const text of all) {
      const match = text.match(/proposal:([\w:-]+)/i);
      if (match && /skill/i.test(text)) {
        return `proposal:${match[1]}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyAgentTemplate(artifacts) {
  try {
    const input = artifacts.classifyProposalInput;
    if (!input) return "none";
    const result = classifyProposal({ ...input, target: "agent" });
    return result.verdict === "systemic" ? "systemic-proposal" : "none";
  } catch {
    return "none";
  }
}
function classifySkillTemplate(artifacts) {
  try {
    const input = artifacts.classifyProposalInput;
    if (!input) return "none";
    const result = classifyProposal({ ...input, target: "skill" });
    return result.verdict === "systemic" ? "systemic-proposal" : "none";
  } catch {
    return "none";
  }
}
function classifyConfig(artifacts) {
  try {
    const configKeys = artifacts.provenanceTouched?.config_keys ?? [];
    if (configKeys.length > 0) {
      return `proposal:${configKeys[0]}`;
    }
    const settingsFiles = [
      ...artifacts.changedFiles ?? [],
      ...artifacts.provenanceTouched?.files ?? []
    ].filter(
      (f) => /(?:settings\.json|settings\.local\.json|\.claude-plugin\/|guild\.json|\.guild\/settings|guildstack\.pen)/i.test(f)
    );
    if (settingsFiles.length > 0) {
      const f = settingsFiles[0];
      const keyMatch = f.match(/([^/]+)\.json$/);
      return `proposal:${keyMatch ? keyMatch[1] : "settings"}`;
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyTaskTracking(artifacts) {
  try {
    const tasks = artifacts.provenanceTouched?.tasks ?? [];
    if (tasks.length > 0) {
      const anyDone = (artifacts.handoffBlocks ?? []).some(
        (b) => b.status === "done" || b.status === "shipped"
      );
      if (anyDone || artifacts.handoffBlocks === void 0) {
        return `update:${tasks[0]}`;
      }
    }
    const runs = artifacts.provenanceTouched?.runs ?? [];
    if (runs.length > 0) {
      const anyDone = (artifacts.handoffBlocks ?? []).some(
        (b) => b.status === "done" || b.status === "shipped"
      );
      if (anyDone) {
        return `update:run:${runs[0]}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyWorkflowRules(artifacts) {
  try {
    const decisions = artifacts.provenanceTouched?.decisions ?? [];
    for (const d of decisions) {
      if (/^(?:workflow[\s_-]exception|gate[\s_-]skip|phase[\s_-]override|workflow[\s_-]override)/i.test(d)) {
        return `proposal:${d}`;
      }
    }
    const issues = (artifacts.handoffBlocks ?? []).flatMap((b) => b.issues ?? []);
    for (const text of issues) {
      if (/\b(?:gate[\s_-]skip(?:ped)?|phase[\s_-]order[\s_-]deviation|workflow[\s_-]override|force[\s_-]gate|gate[\s_-]force[d]?)\b/i.test(text)) {
        const ruleMatch = text.match(/(?:gate[\s_-]skip|phase[\s_-]override|workflow[\s_-]override)[:\s]+([\w-]+)/i);
        return `proposal:${ruleMatch ? ruleMatch[1] : "workflow-exception"}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyReviewPolicy(artifacts) {
  try {
    const all = [
      ...allLearnings(artifacts),
      ...allFollowups(artifacts),
      ...(artifacts.handoffBlocks ?? []).flatMap((b) => b.issues ?? []),
      ...(artifacts.handoffBlocks ?? []).map((b) => b.notes ?? ""),
      ...(artifacts.handoffBlocks ?? []).map((b) => b.summary ?? "")
    ];
    for (const text of all) {
      if (/\b(?:BLOCK|block[\s_-]override|owner[\s_-]accepted[\s_-]risk|gate[\s_-]override|releasegate|review[\s_-]gate[\s_-]fail)\b/.test(text)) {
        const gateMatch = text.match(/(?:G[-_]?(\w+)|gate[\s:]+([\w-]+)|releasegate)/i);
        const gate = gateMatch ? gateMatch[1] ?? gateMatch[2] ?? "releasegate" : "releasegate";
        return `proposal:${gate}`;
      }
      if (/\bcap[\s_-]exceeded\b|rounds[\s_-]cap[\s_-]hit\b|codex[\s_-]cap\b/i.test(text)) {
        return "proposal:codex-cap";
      }
    }
    const decisions = artifacts.provenanceTouched?.decisions ?? [];
    if (decisions.some((d) => /review[\s_-]?policy|gate[\s_-]?policy/i.test(d))) {
      return `proposal:${decisions.find((d) => /review|gate/i.test(d))}`;
    }
    return "none";
  } catch {
    return "none";
  }
}
function classifyPhase(artifacts) {
  return {
    memory: classifyMemory(artifacts),
    wiki: classifyWiki(artifacts),
    knowledge_graph: classifyKnowledgeGraph(artifacts),
    domain_model: classifyDomainModel(artifacts),
    agent_def: classifyAgentDef(artifacts),
    skill_def: classifySkillDef(artifacts),
    agent_template: classifyAgentTemplate(artifacts),
    skill_template: classifySkillTemplate(artifacts),
    config: classifyConfig(artifacts),
    task_tracking: classifyTaskTracking(artifacts),
    workflow_rules: classifyWorkflowRules(artifacts),
    review_policy: classifyReviewPolicy(artifacts)
  };
}

// emit-learning-checkpoint.ts
var SCHEMA_VERSION = "guild.learning_checkpoint.v1";
var VALID_PHASES = [
  "init",
  "ideation",
  "planning",
  "development",
  "quality",
  "operations",
  "reflection"
];
var DECISION_TARGETS = [
  "memory",
  "wiki",
  "knowledge_graph",
  "domain_model",
  "agent_def",
  "skill_def",
  "agent_template",
  "skill_template",
  "config",
  "task_tracking",
  "workflow_rules",
  "review_policy"
];
var ALL_NONE_DECISIONS = Object.fromEntries(
  DECISION_TARGETS.map((k) => [k, "none"])
);
var VALID_EDGE_TYPES = [
  "decided_by",
  "used_for",
  "produced",
  "touches",
  "supersedes",
  "learned_from",
  "constrains",
  "opens_question",
  "resolves"
];
var ALLOWED_NODE_PREFIXES = [
  "task:",
  "run:",
  "decision:",
  "skill:",
  "agent:",
  "feature:"
];
var FORBIDDEN_NODE_PREFIXES = [
  "wiki:",
  "file:",
  "domain:",
  "component:"
];
function assertPhase(phase) {
  if (!VALID_PHASES.includes(phase)) {
    throw new Error(
      `[emit-learning-checkpoint] invalid phase: "${phase}". Expected one of: ${VALID_PHASES.join(", ")}`
    );
  }
}
function assertEdgeTypes(links) {
  for (const link of links) {
    if (!VALID_EDGE_TYPES.includes(link.type)) {
      throw new Error(
        `[emit-learning-checkpoint] invalid edge type: "${link.type}". Expected one of: ${VALID_EDGE_TYPES.join(", ")}`
      );
    }
  }
}
function assertNodePrefixes(links) {
  for (const link of links) {
    for (const node of [link.from, link.to]) {
      const allowed = ALLOWED_NODE_PREFIXES.some(
        (p) => node.startsWith(p)
      );
      if (!allowed) {
        const matchedForbidden = FORBIDDEN_NODE_PREFIXES.find(
          (p) => node.startsWith(p)
        );
        const detail = matchedForbidden ? `uses the cross-space prefix "${matchedForbidden}" (code/wiki/domain space)` : `uses an unknown or no-prefix node id "${node}"`;
        throw new Error(
          `[emit-learning-checkpoint] invalid node in edge (from: "${link.from}", to: "${link.to}") \u2014 ${detail}. Node ids must start with an allowed work/decision-space prefix: ${ALLOWED_NODE_PREFIXES.join(", ")}.`
        );
      }
    }
  }
}
function yamlValue(v) {
  if (v === "none") return "none";
  if (/: /.test(v) || // colon-space → would be a mapping
  /:$/.test(v) || // trailing colon
  v.trim() !== v || // leading/trailing whitespace
  v === "" || // empty
  /^[{[\]}&*#?|<>=!%@`'"]/.test(v)) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}
function buildYaml(opts) {
  const lines = [
    `# ${SCHEMA_VERSION}`,
    "learning_checkpoint:",
    `  version: ${SCHEMA_VERSION}`,
    `  phase: ${opts.phase}`,
    `  run_id: ${opts.runId}`
  ];
  if (opts.observed.length === 0) {
    lines.push("  observed: []");
  } else {
    lines.push("  observed:");
    for (const fact of opts.observed) {
      lines.push(`    - ${yamlValue(fact)}`);
    }
  }
  lines.push("  decisions:");
  for (const key of DECISION_TARGETS) {
    lines.push(`    ${key}: ${yamlValue(opts.decisions[key] ?? "none")}`);
  }
  if (opts.knowledgeLinksBatch.length === 0) {
    lines.push("  knowledge_links_batch: []");
  } else {
    lines.push("  knowledge_links_batch:");
    for (const link of opts.knowledgeLinksBatch) {
      lines.push(
        `    - from: ${yamlValue(link.from)}`,
        `      to: ${yamlValue(link.to)}`,
        `      type: ${link.type}`,
        `      run_id: ${link.run_id}`
      );
    }
  }
  lines.push(`  routed_to: ${yamlValue(opts.reflectionsPath)}`);
  lines.push(`  evidence_ref: ${yamlValue(opts.evidenceRef)}`);
  if (opts.backstop === true) {
    lines.push("  backstop: true");
  }
  return lines.join("\n") + "\n";
}
function appendKnowledgeLinksIndex(guildRoot, links) {
  if (links.length === 0) return;
  const indexDir = path8.join(guildRoot, ".guild", "indexes");
  const indexPath = path8.join(indexDir, "knowledge-links.json");
  let existing = [];
  if (fs6.existsSync(indexPath)) {
    try {
      const raw = fs6.readFileSync(indexPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed["links"])) {
        existing = parsed["links"];
      }
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not parse knowledge-links.json \u2014 starting fresh: ${String(e)}
`
      );
      existing = [];
    }
  }
  const existingKeys = new Set(
    existing.map((l) => `${l.from}\0${l.to}\0${l.type}`)
  );
  const novel = links.filter(
    (l) => !existingKeys.has(`${l.from}\0${l.to}\0${l.type}`)
  );
  if (novel.length === 0) return;
  const merged = [...existing, ...novel];
  try {
    fs6.mkdirSync(indexDir, { recursive: true });
    fs6.writeFileSync(
      indexPath,
      JSON.stringify(
        { schema_version: "guild.knowledge_links.v1", links: merged },
        null,
        2
      ) + "\n",
      "utf8"
    );
  } catch (e) {
    process.stderr.write(
      `[emit-learning-checkpoint] WARN: could not write knowledge-links.json: ${String(e)}
`
    );
  }
}
function appendReflections(guildRoot, runId, phase, decisions) {
  const nonNone = DECISION_TARGETS.filter((k) => decisions[k] !== "none");
  if (nonNone.length === 0) return;
  const reflectionsDir = path8.join(guildRoot, ".guild", "reflections");
  fs6.mkdirSync(reflectionsDir, { recursive: true });
  const reflPath = path8.join(reflectionsDir, `${runId}.md`);
  const entry = `
## Phase: ${phase} (${runId})

` + nonNone.map((k) => `- ${k}: ${decisions[k]}`).join("\n") + "\n";
  fs6.appendFileSync(reflPath, entry, "utf8");
}
function writeCheckpoint(opts) {
  assertPhase(opts.phase);
  const links = opts.knowledgeLinksBatch ?? [];
  assertEdgeTypes(links);
  assertNodePrefixes(links);
  const guildRoot = opts.guildRoot ?? process.cwd();
  const decisions = opts.decisions ?? { ...ALL_NONE_DECISIONS };
  const learningDir = path8.join(guildRoot, ".guild", "runs", opts.runId, "learning");
  fs6.mkdirSync(learningDir, { recursive: true });
  const checkpointFile = path8.join(learningDir, `${opts.phase}-${opts.runId}.yaml`);
  const reflectionsRelPath = `.guild/reflections/${opts.runId}.md`;
  const reflectionsAbsPath = path8.join(guildRoot, ".guild", "reflections", `${opts.runId}.md`);
  const observed = opts.observed ?? [];
  const yaml2 = buildYaml({
    runId: opts.runId,
    phase: opts.phase,
    evidenceRef: opts.evidenceRef,
    decisions,
    observed,
    reflectionsPath: reflectionsRelPath,
    knowledgeLinksBatch: links,
    ...opts.backstop === true ? { backstop: true } : {}
  });
  fs6.writeFileSync(checkpointFile, yaml2, "utf8");
  appendReflections(guildRoot, opts.runId, opts.phase, decisions);
  appendKnowledgeLinksIndex(guildRoot, links);
  void reflectionsAbsPath;
  return checkpointFile;
}
function main() {
  const runId = process.env["GUILD_RUN_ID"];
  const phase = process.env["GUILD_PHASE"];
  const evidenceRef = process.env["GUILD_EVIDENCE_REF"] ?? "none";
  const guildRoot = process.env["GUILD_CWD"] ?? process.cwd();
  const verdictPath = process.env["GUILD_CHECKPOINT_VERDICT"];
  const linksPath = process.env["GUILD_CHECKPOINT_LINKS"];
  if (!runId) {
    process.stderr.write("[emit-learning-checkpoint] ERROR: GUILD_RUN_ID not set\n");
    process.exit(1);
  }
  if (!phase) {
    process.stderr.write("[emit-learning-checkpoint] ERROR: GUILD_PHASE not set\n");
    process.exit(1);
  }
  const artifactsJsonPath = process.env["GUILD_CHECKPOINT_ARTIFACTS_JSON"];
  let decisions;
  if (verdictPath) {
    try {
      const raw = fs6.readFileSync(verdictPath, "utf8");
      decisions = JSON.parse(raw);
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not read GUILD_CHECKPOINT_VERDICT (${verdictPath}): ${String(e)}
`
      );
    }
  }
  if (decisions === void 0 && artifactsJsonPath) {
    try {
      const rawArtifacts = fs6.readFileSync(artifactsJsonPath, "utf8");
      const artifacts = JSON.parse(rawArtifacts);
      if (!artifacts.runId) artifacts.runId = runId;
      if (!artifacts.phase) artifacts.phase = phase ?? void 0;
      if (!artifacts.evidenceRef) artifacts.evidenceRef = evidenceRef !== "none" ? evidenceRef : void 0;
      const verdict = classifyPhase(artifacts);
      decisions = verdict;
      process.stderr.write(
        `[emit-learning-checkpoint] INFO: classified artifacts \u2192 non-none: ${Object.entries(verdict).filter(([, v]) => v !== "none").map(([k]) => k).join(", ") || "none"}
`
      );
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not classify GUILD_CHECKPOINT_ARTIFACTS_JSON (${artifactsJsonPath}): ${String(e)}
`
      );
    }
  }
  let knowledgeLinksBatch = [];
  if (linksPath) {
    try {
      const raw = fs6.readFileSync(linksPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        knowledgeLinksBatch = parsed;
      } else {
        process.stderr.write(
          `[emit-learning-checkpoint] WARN: GUILD_CHECKPOINT_LINKS JSON is not an array \u2014 ignoring (${linksPath})
`
        );
      }
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not read GUILD_CHECKPOINT_LINKS (${linksPath}): ${String(e)}
`
      );
    }
  }
  try {
    const written = writeCheckpoint({
      runId,
      phase,
      evidenceRef,
      guildRoot,
      decisions,
      knowledgeLinksBatch
      // populated from GUILD_CHECKPOINT_LINKS (was deferred [] in Wave 1)
    });
    process.stdout.write(written + "\n");
  } catch (e) {
    process.stderr.write(`[emit-learning-checkpoint] ERROR: ${String(e)}
`);
    process.exit(1);
  }
}
if (process.argv[1] !== void 0 && (process.argv[1].endsWith("emit-learning-checkpoint.ts") || process.argv[1].endsWith("emit-learning-checkpoint.js"))) {
  main();
}

// lib/heartbeat.ts
var DEFAULT_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1e3;

// lib/run-trace.ts
function runDir2(root, runId) {
  return path9.join(root, ".guild", "runs", runId);
}
function liveLogPath(root, runId) {
  return path9.join(runDir2(root, runId), "logs", "v1.4-events.jsonl");
}
function provenancePath2(root, runId) {
  return path9.join(runDir2(root, runId), "provenance.json");
}
function resolveRunIdForTrace(root, env) {
  const fromEnv = env.GUILD_RUN_ID;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  const legacy = readSentinel(path9.join(root, ".guild", "runs", "current-run-id"));
  if (legacy) return legacy;
  const b2 = readSentinel(path9.join(root, ".guild", "current-run-id"));
  if (b2) return b2;
  return null;
}
function readSentinel(p) {
  try {
    const v = fs7.readFileSync(p, "utf8").trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
function defaultResolveHost(requested) {
  const raw = (process.env["GUILD_HOST"] ?? requested ?? "").trim().toLowerCase();
  const resolved = raw === "codex" ? "codex" : raw === "gemini" ? "gemini" : raw === "pi" ? "pi" : "claude";
  return { requested, resolved };
}
function appendTraceLine(file, event) {
  fs7.mkdirSync(path9.dirname(file), { recursive: true });
  fs7.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
}
function emitRunClosed(root, runId, resolveHost, opts = {}) {
  try {
    const lifecycle = createRunLifecycle(createRealEnv(root, resolveHost));
    lifecycle.closeRun(runId, {
      status: opts.status ?? "closed",
      touched: opts.touched,
      coverage: opts.coverage,
      final_learning_checkpoint: opts.final_learning_checkpoint,
      artifacts: opts.artifacts
    });
    const prov = JSON.parse(fs7.readFileSync(provenancePath2(root, runId), "utf8"));
    const pointer = prov.terminal_trace_event;
    if (!pointer || typeof pointer.event_id !== "string") {
      process.stderr.write(
        `[run-trace] WARN: provenance.json missing terminal_trace_event pointer for ${runId}
`
      );
      return;
    }
    appendTraceLine(liveLogPath(root, runId), {
      schema_version: "guild.trace_event.v1",
      event_id: pointer.event_id,
      event_name: "run_closed",
      run_id: runId,
      at: typeof pointer.at === "string" ? pointer.at : (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: emitRunClosed failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}

// lib/guild-hook-event.ts
async function readHookStdin() {
  return new Promise((resolve6) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve6(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve6(""));
  });
}
function emitClaudeHookEvent(raw) {
  const parsed = JSON.parse(raw.trim());
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  return { ...parsed, host: "claude" };
}

// run-trace-close.ts
function findTerminalCheckpoint(runDir3, runId) {
  const learningDir = path10.join(runDir3, "learning");
  if (!fs8.existsSync(learningDir)) return null;
  const reflectionFile = path10.join(learningDir, `reflection-${runId}.yaml`);
  if (fs8.existsSync(reflectionFile)) return reflectionFile;
  let yamlFiles;
  try {
    yamlFiles = fs8.readdirSync(learningDir).filter((f) => f.endsWith(".yaml"));
  } catch {
    return null;
  }
  if (yamlFiles.length === 0) return null;
  const sorted = yamlFiles.map((f) => path10.join(learningDir, f)).sort((a, b) => {
    try {
      return fs8.statSync(b).mtimeMs - fs8.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  return sorted[0] ?? null;
}
async function main2() {
  const raw = await readHookStdin();
  let payload = {};
  try {
    payload = emitClaudeHookEvent(raw);
  } catch {
    process.exit(0);
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const root = resolveGuildRoot(cwd);
  const runId = resolveRunIdForTrace(root, { GUILD_RUN_ID: process.env["GUILD_RUN_ID"] });
  if (!runId) process.exit(0);
  const runDir3 = path10.join(root, ".guild", "runs", runId);
  if (!fs8.existsSync(path10.join(runDir3, "run.yaml"))) process.exit(0);
  if (fs8.existsSync(path10.join(runDir3, "provenance.json"))) process.exit(0);
  const finalLearningCheckpoint = findTerminalCheckpoint(runDir3, runId);
  emitRunClosed(root, runId, defaultResolveHost, {
    status: "closed",
    ...finalLearningCheckpoint !== null ? { final_learning_checkpoint: finalLearningCheckpoint } : {}
  });
  process.exit(0);
}
main2().catch((err) => {
  process.stderr.write(
    `[run-trace-close] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  findTerminalCheckpoint
});
