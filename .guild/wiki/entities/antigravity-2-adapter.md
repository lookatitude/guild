---
type: concept
owner: architect
confidence: high
importance: high
source_refs:
  - .guild/wiki/_archive/v2-design/audits/cross-platform-compatibility-report.md
  - .guild/wiki/decisions/host-adapter-contract.md
  - .guild/wiki/decisions/feature-degradation-contracts.md
  - .guild/wiki/decisions/phase-continuity-requirements.md
related: [host-adapter-contract, feature-degradation-contracts, phase-continuity-requirements, claude-code-adapter, codex-adapter, gemini-cli-adapter, pi-adapter, claude-code-desktop-adapter, claude-code-web-adapter, codex-app-adapter, antigravity-2-adapter, claude-ai-connector-adapter]
applies_to: [plugin]
created_at: 2026-05-28
updated_at: 2026-05-28
expires_at: null
supersedes: null
sensitivity: public
---

# Antigravity 2.0 adapter

Antigravity 2.0 is a standalone app for launching, monitoring, and orchestrating agents that can execute system commands, read/write files, search the web, integrate with skills and MCP servers, manage subagents, interact with Chrome, and create artifacts/implementation plans (source: audit §"Source-backed platform facts / Antigravity CLI and Antigravity 2.0 app"). The product page describes it as a dedicated platform to work with agents, orchestrate multiple autonomous agents in parallel across independent Projects, define dynamic subagents, schedule tasks, and define global or workspace-specific skills, MCPs, and JSON hooks. Projects provide worktree support, scoped settings, scoped permissions, and multi-folder access. The Antigravity CLI shares the same core agent harness and settings with the app; the CLI uses `plugin.json` staged under `~/.gemini/antigravity-cli/plugins/<plugin_name>/` with optional `mcp_config.json`, `hooks.json`, `skills/`, `agents/`, and `rules/`. The app adapter builds on the CLI plugin contract and adds Projects, dynamic subagents, scheduled tasks, and artifact surfaces. The audit cautions that Antigravity app plugins may not be byte-identical to CLI plugins until verified against a live install.

## Target host capabilities

```yaml
schema_version: guild.host_capabilities.v1
host_id: "antigravity-2"
family: "antigravity"
surface: "antigravity-2"
surface_kind: "desktop-app"

packaging:
  format: "antigravity-plugin"
  installable: true
  manifest_path: "plugin.json"  # plus optional mcp_config.json, hooks.json

commands:
  slash_commands: true          # skills become slash commands in app
  toml_commands: false
  mcp_tool_commands: false
  command_path_pattern: "skills/<name>/SKILL.md (promoted to slash commands)"

hooks:
  session_start: true
  pre_tool_use: true            # via hooks.json JSON hook events
  post_tool_use: true
  permission_request: false
  ask_from_pre_tool_use: false  # scoped-permission UI or hooks.json confirmation
  subagent_stop: true           # dynamic subagent lifecycle events
  stop: true

dispatch:
  in_process_agent: false
  subagent_dispatch: true       # dynamic subagents per app docs
  independent_agents: true      # Projects + parallel dynamic subagent orchestration
  serial_only: false

permissions:
  ask_ui: "app_scoped_perm"     # Project scoped permissions + app approval UI
  deny_at_pre_tool_use: true    # hooks.json can deny
  bypass_permissions_mode: false  # scoped permissions are the control mechanism

model_tiers:
  cheap: { model: "default", thinking: "low" }   # Gemini-family model
  mid: { model: "default", thinking: "medium" }
  powerful: { model: "default", thinking: "high" }

mcp:
  stdio: true                   # via mcp_config.json in plugin
  http: true
  plugin_bundled: true
  core_provides_mcp: true

team_visibility:
  has_tmux: false               # app orchestration replaces tmux
  has_independent_agents: true  # Projects + dynamic subagents
  has_subagent_dispatch: true
  can_lead_team: true
  can_join_team: true
  app_threads: false            # not thread-based; uses Projects
  app_projects: true            # Antigravity Projects with worktrees + scoped permissions
  scheduled_tasks: true         # native scheduled task support

filesystem: "local"             # project folders on local machine

cost_path:
  prefer_native_subscription_path: true
  allow_external_cli_spawn: true  # Antigravity CLI process is native path
  trace_external_cli: false

detected_at: "runtime"
advertised_at: "session-start"
ttl_seconds: 3600
```

## Contract surfaces — implements vs degrades

| Surface | Implements | Degrades | Notes |
|---|---|---|---|
| (1) Packaging | `plugin.json` + `mcp_config.json` + `hooks.json` + `skills/` + `agents/` + `rules/` renderer | — | Antigravity CLI plugin layout defined by docs: `plugin.json` required; optional `mcp_config.json`, `hooks.json`, `skills/`, `agents/`, `rules/`. Staged under `~/.gemini/antigravity-cli/plugins/<plugin_name>/`. **App vs CLI manifest byte-identity unverified** (audit §"Proposed cross-platform architecture / 11. Antigravity 2.0 app adapter"). |
| (2) Commands | Skills promoted to slash commands; `plugin.json` command entries | — | Antigravity skills in `skills/<name>/SKILL.md` can become slash commands when the surface auto-promotes them. Guild command renderer emits skills from the `GuildCommand` registry. |
| (3) Hooks | `hooks.json` JSON hook events (SessionStart, PreToolUse, PostToolUse, Stop, subagent lifecycle) | No `PreToolUse ask`; scoped-permission UI instead | `GuildHookEvent` normalization maps Antigravity hook payload fields. Permission ask → app scoped-permission UI or file-bus pause. |
| (4) Dispatch | Projects + dynamic subagents (Rung 2) → subagent fallback → serial (Rung 4) | No tmux | `HostIndependentAgentBackend` maps Guild lanes to Antigravity Projects/dynamic subagents. `app_projects: true` + `has_independent_agents: true`. |
| (5) Permissions | App scoped-permission UI + hooks.json denial | No `PreToolUse ask` | `ScopePolicy.resolve()` runs; emitter maps `ask` → app scoped-permission UI (`ask_renderer: app_scoped_perm`). Projects provide per-project scoped permissions. |
| (6) Model tiers | `{ model: "default", thinking: low/medium/high }` (Gemini-family) | — | `ModelResolver` uses Gemini thinking levels; same registry entry as Gemini CLI (audit §"P0: Model tiers" registry). |
| (7) MCP | stdio + HTTP via `mcp_config.json` | — | `McpAdapter` emits MCP entries in `mcp_config.json` plugin file. Both local stdio and remote HTTP documented. |
| (8) Team visibility | Rung 2 (Projects + dynamic subagents) → serial Rung 4 | No tmux | `app_projects: true`; Guild initiatives map to Antigravity Projects; lanes map to dynamic subagents. |

## Per-feature degradation matrix

| FDC | Full behavior | This host | Degradation contract |
|---|---|---|---|
| FDC-1 Memory | MCP stdio `guild-memory` | stdio or HTTP via `mcp_config.json` | No degradation expected; fs/BM25 fallback if MCP fails. |
| FDC-2 Knowledge-graph + recall | `guild-memory` or fs scan | MCP or fallback | Index re-scan if MCP unavailable. |
| FDC-3 Context assembly | Context bundle always written | Full | Bundle written in project folder; `degraded_retrieval` if FDC-1/2 degrade. |
| FDC-4 Agent communication | File bus canonical | Full (project folder writes) | `agent_bus.transport: file_bus_native`; Projects provide per-project `.guild/` tree. |
| FDC-5 Agent coordination | DAG + receipt collection | Rung 2 (Projects + subagents) | `coordination.parallelism: host_native`; `backend_rung: 2`. |
| FDC-6 All lifecycle phases | All 6 phases | Full via skills/commands + scoped-permission gates | `command_rendered_as: antigravity_skill`; `ask_path: interactive` via app scoped permissions. |
| FDC-7 Quality gates | Cross-family review | Cross-provider to Claude/Codex | Antigravity-authored artifacts reviewed by Claude or Codex via review broker. |
| FDC-8 Operations | R/O + W + destructive | Full; destructive via app scoped permissions | `ops.approval: interactive` via app permission UI. Safety rails non-negotiable on every host (PCR-Operations). |
| FDC-9 Settings | `.guild/settings.json` | Full | Project settings / artifacts UI is renderer; source of truth is `.guild/settings.json`. |
| FDC-10 Visuals / UI | Host-native | Projects panel, artifacts, skills UI, scheduled task dashboard | App provides richer visual orchestration surface than CLI. No tmux. |
| FDC-11 Security / permissions | Policy core + ask path | App scoped permissions | `ScopePolicy` runs; `ask_renderer: app_scoped_perm`. Project-level scoped permissions are the security perimeter. |
| FDC-12 Cost + subscription | Native billing | `cost_path: native_process` | Antigravity process is native; no external CLI issue. |
| FDC-13 MCP | stdio / HTTP | Full via `mcp_config.json` | Both transports documented for Antigravity (audit §"MCP support matrix"). |
| FDC-14 Host-native subagents | Parallel agents | Projects + dynamic subagents (Rung 2) | `coordination.parallelism: host_native`; multi-project + subagent parallelism per app docs. |
| FDC-15 Work isolation | Worktrees | Projects + worktree support | "Projects with worktree support" per app feature docs. Guild initiatives map 1:1 to Projects. |
| FDC-16 Telemetry + replay | Normalized trace | Normalization required | Antigravity `hooks.json` event field names differ. `GuildHookEvent` normalization mandatory. `source: host_hook`, `fidelity: full` when hooks present. |

## Packaging format

**Manifest paths:** `plugin.json` (required) + `mcp_config.json` + `hooks.json` + `skills/` + `agents/` + `rules/`

The Antigravity CLI plugin layout is a namespaced bundle staged under `~/.gemini/antigravity-cli/plugins/<plugin_name>/` (source: audit §"Source-backed platform facts / Antigravity CLI and Antigravity 2.0 app"). The renderer emits from Guild's inventory:

- `plugin.json` — required manifest with plugin metadata, skill/command declarations.
- `mcp_config.json` — MCP server entries for `guild-memory` and `guild-telemetry`.
- `hooks.json` — Guild hook events mapped to Antigravity's JSON hook format.
- `skills/<name>/SKILL.md` — Guild skills rendered as Antigravity skills.
- `agents/<name>.md` — Guild agent definitions.
- `rules/` — optional rules/linting entries.

Antigravity CLI docs describe shared settings between CLI and app; the app surfaces Projects, scoped permissions, scheduled tasks, and artifacts on top of the CLI plugin foundation. **The byte-identity of app vs CLI plugin manifest format is unverified** and is the primary open risk for this adapter.

Guild initiatives map to Antigravity Projects; Guild lanes map to dynamic subagents; Guild maintenance schedules map to scheduled tasks. This is the richest semantic mapping of any app surface adapter.

## Unresolved questions

1. **App vs CLI plugin manifest byte-identity.** The audit explicitly warns: "Do not assume Antigravity app plugins are byte-identical to Antigravity CLI plugins until verified." Whether the app loads the same `plugin.json` format from the same directory, or requires a different manifest for app-side features (Projects, scheduled tasks, artifacts), must be confirmed before the app-facing renderer is finalized.
2. **Dynamic subagent dispatch API.** Whether Antigravity provides a programmatic API for launching dynamic subagents from inside a skill/command (rather than the user manually configuring them in the app UI) is unverified. This is a prerequisite for automated Rung 2 dispatch.
3. **`.guild/` state persistence in Projects.** The audit cautions "Do not assume Google app/cloud sync preserves local `.guild/` state unless the project folder is local and writable." Whether Antigravity Projects always map to a writable local folder (or may sync to cloud storage) affects file-bus and receipt path reliability.
4. **`hooks.json` PreToolUse deny semantics.** Whether Antigravity `hooks.json` `PreToolUse` entries can deny a tool call before execution (analogous to Claude/Codex) or only observe/log needs live verification before the `PermissionEmitter` is coded.
5. **Scheduled task API for Guild maintenance.** Guild maintenance tasks (`guild:reflect`, periodic `guild:ops`) would benefit from Antigravity's scheduled task primitive. Whether scheduled tasks can be registered via the plugin manifest (at install time) or only via app UI configuration needs investigation.
6. **Antigravity CLI migration from Gemini CLI.** Antigravity CLI docs describe migration from Gemini CLI and shared settings. Whether an installed Gemini CLI Guild extension auto-migrates to Antigravity on upgrade, or requires a separate adapter install, has operational implications for users running both.
