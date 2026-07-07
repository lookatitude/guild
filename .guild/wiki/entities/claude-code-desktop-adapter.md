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

# Claude Code Desktop adapter

Claude Code Desktop is an app surface for Claude Code that runs **local sessions** using the same plugin mechanism as the CLI, plus app-native affordances: parallel sessions/panes, Git isolation, drag-and-drop panes, integrated terminal and file editor, side chats, computer use, visual diff review, app previews, PR monitoring, connectors, and enterprise configuration (source: audit §"Source-backed platform facts / Claude Code Desktop and Web apps"). Plugins added through the desktop plugin browser are available in desktop sessions the same way as in the CLI. The distinction that drives this adapter page versus `claude-code-adapter.md` is the **app execution environment**: the Desktop app can run local sessions (full CLI parity) or cloud sessions (which behave like Claude Code Web and lose local config, local MCP, and tmux). The adapter must detect which session type is active and advertise capabilities accordingly.

## Target host capabilities

```yaml
schema_version: guild.host_capabilities.v1
host_id: "claude-code-desktop"
family: "claude"
surface: "claude-code-desktop"
surface_kind: "desktop-app"

packaging:
  format: "claude-plugin"
  installable: true             # via desktop plugin browser
  manifest_path: ".claude-plugin/plugin.json"

commands:
  slash_commands: true
  toml_commands: false
  mcp_tool_commands: false
  command_path_pattern: "commands/*.md"

hooks:
  session_start: true
  pre_tool_use: true
  post_tool_use: true
  permission_request: false
  ask_from_pre_tool_use: true   # local sessions: Claude-exclusive PreToolUse ask
  subagent_stop: true
  stop: true

dispatch:
  in_process_agent: true        # Agent() tool in local sessions
  subagent_dispatch: true
  independent_agents: true      # app parallel sessions/panes (Rung 2)
  serial_only: false

permissions:
  ask_ui: "pre_tool_use_ask"    # local sessions
  deny_at_pre_tool_use: true
  bypass_permissions_mode: true

model_tiers:
  cheap: { model: "haiku" }
  mid: { model: "sonnet" }
  powerful: { model: "opus" }

mcp:
  stdio: true                   # local sessions
  http: true
  plugin_bundled: true
  core_provides_mcp: true

team_visibility:
  has_tmux: false               # app visual surface replaces tmux
  has_independent_agents: true  # parallel app sessions/panes
  has_subagent_dispatch: true
  can_lead_team: true
  can_join_team: true
  app_threads: true             # parallel session/pane model
  app_projects: false           # app uses sessions/panes, not "Projects" concept
  scheduled_tasks: false        # TBD for cloud desktop sessions

filesystem: "local"             # local sessions; "remote" when cloud session active

cost_path:
  prefer_native_subscription_path: true
  allow_external_cli_spawn: false  # same Claude cost-policy invariant as CLI
  trace_external_cli: true

detected_at: "runtime"
advertised_at: "session-start"
ttl_seconds: 3600
```

## Contract surfaces — implements vs degrades

| Surface | Implements | Degrades | Notes |
|---|---|---|---|
| (1) Packaging | `.claude-plugin/plugin.json` via desktop plugin browser | Cloud sessions: local plugin not loaded | Same manifest as CLI. Desktop adds a GUI plugin browser install path. `installable: true` for local; cloud sessions may not load the plugin. |
| (2) Commands | `commands/*.md` Markdown (identical to CLI) | Cloud sessions: command Markdown from repo only | For local sessions the command surface is byte-identical to the CLI adapter. Cloud sessions read from the cloned repo (same as Claude Code Web). |
| (3) Hooks | Full Claude hook set for local sessions | Cloud sessions: hooks may not fire; synthesize from file bus | Local session: `ask_from_pre_tool_use: true`, full telemetry. Cloud session: `source: file_bus_synthesis`, `fidelity: reduced` (FDC-16). |
| (4) Dispatch | Agent() in-process + app parallel sessions (Rung 2) | Cloud sessions degrade to Rung 3 or serial | Local: Rung 2 (app independent sessions) or Rung 3 (Agent tool). Cloud: Rung 4. `backend_rung` recorded. |
| (5) Permissions | `PreToolUse ask` for local sessions | Cloud: file-bus pause | Local: same as CLI reference. Cloud: `ask_renderer: file_bus_pause`. |
| (6) Model tiers | `haiku / sonnet / opus` (local sessions) | Cloud may differ per environment | `ModelResolver` reads active session type; local sessions use CLI model mapping. |
| (7) MCP | stdio (local); HTTP (both) | Cloud: remote-only | `McpAdapter` detects local vs cloud session at startup and emits appropriate transport. |
| (8) Team visibility | Rung 2 (app parallel sessions) → Rung 3 (Agent tool) | No tmux in app context | `app_threads: true`; `has_tmux: false`. Team backend is `HostIndependentAgentBackend` (app sessions), not `TmuxTeamBackend`. |

## Per-feature degradation matrix

| FDC | Full behavior | This host | Degradation contract |
|---|---|---|---|
| FDC-1 Memory | MCP stdio `guild-memory` | stdio (local) or remote HTTP (cloud) | No degradation for local sessions. Cloud: remote MCP or fs fallback. |
| FDC-2 Knowledge-graph + recall | `guild-memory` or fs scan | Local full; cloud TBD | Index re-scan if MCP unavailable in cloud session. |
| FDC-3 Context assembly | Context bundle always written | Full (local); partial (cloud) | Bundle always written; `degraded_retrieval` if cloud MCP path unavailable. |
| FDC-4 Agent communication | File bus canonical | Full for local; file bus polled for cloud | `agent_bus.transport: file_bus_native` (local) or `file_bus_polled` (cloud). |
| FDC-5 Agent coordination | DAG + receipt collection | Rung 2 (app sessions, local) or Rung 4 (cloud) | `coordination.parallelism: host_native` (app sessions) or `serial` (cloud). |
| FDC-6 All lifecycle phases | All 6 phases | Full (local); command-file-based (cloud) | Local: `command_rendered_as: claude_markdown`, interactive ask. Cloud: `ask_path: file_bus_pause`. |
| FDC-7 Quality gates | Cross-family review | Available when Codex plugin installed | Identical to CLI behavior; adversarial review routes through `review-broker`. |
| FDC-8 Operations | R/O + W + destructive | Full local; restricted cloud | Cloud: destructive ops require `approval_request` + pause. |
| FDC-9 Settings | `.guild/settings.json` | Full | Desktop GUI config panel is renderer only; source of truth is `.guild/settings.json`. |
| FDC-10 Visuals / UI | Host-native | App panes, visual diff, app preview, startup card | App surfaces (visual diff, side chat, PR monitoring) used for review visualization; no tmux startup card. |
| FDC-11 Security / permissions | Policy core + ask path | `PreToolUse ask` (local) / file-bus pause (cloud) | Local: identical to CLI. Cloud: `ask_renderer: file_bus_pause`. |
| FDC-12 Cost + subscription | Native billing | `cost_path: native_integration` | Same invariant as CLI: prefer `Agent()` / plugin; no shell-spawned `claude -c` by default. |
| FDC-13 MCP | stdio / HTTP | Full (local); remote HTTP (cloud) | MCP bundled in plugin for local; cloud needs environment-mediated MCP. |
| FDC-14 Host-native subagents | Parallel agents | App parallel sessions (Rung 2) | `HostIndependentAgentBackend` maps Guild lanes to app parallel sessions. |
| FDC-15 Work isolation | Worktrees | App Git isolation | Desktop app has built-in Git isolation; worktrees available. |
| FDC-16 Telemetry + replay | Normalized trace | Full (local); synthesized (cloud) | Local: `source: host_hook`, `fidelity: full`. Cloud: `source: file_bus_synthesis`, `fidelity: reduced`. |

## Packaging format

**Manifest path:** `.claude-plugin/plugin.json` (same as Claude Code CLI)

The Claude Code Desktop adapter shares the same manifest renderer as the CLI adapter. The plugin is installed through the desktop plugin browser rather than a shell command, but the manifest format and content are identical. For local sessions, all CLI adapter capabilities apply without change. For cloud desktop sessions, the adapter advertises degraded capabilities (no local filesystem, no local MCP, no `PreToolUse ask`) and the surface behaves like `claude-code-web-adapter.md`.

The capability advertisement at session-start detects whether the active session is local or cloud and emits the correct `host_capabilities.v1` values. This detection is the primary new behavior this adapter adds over the CLI adapter. Source: audit §"Source-backed platform facts / Claude Code Desktop and Web apps" and §"Proposed cross-platform architecture / 9. Claude Code Desktop/Web adapters".

## Unresolved questions

1. **Local vs cloud session detection API.** The exact API or environment signal inside a Claude Code Desktop session that distinguishes a local session from a cloud session is not documented in the audit. The capability advertisement requires this at session-start; the detection mechanism needs verification.
2. **Plugin availability in cloud desktop sessions.** The audit states the desktop comparison table says "local config is available in terminal CLI and local desktop sessions." Whether a plugin installed through the desktop browser is also available in cloud desktop sessions (not just local sessions) needs confirmation.
3. **App parallel sessions as Rung 2 dispatch.** The `HostIndependentAgentBackend` for this host maps Guild lanes to app parallel sessions/panes. Whether the app exposes an API for programmatic parallel session launch (vs the user opening panes manually) needs investigation before Rung 2 can be automated.
4. **Visual diff and app preview integration.** The audit notes app previews and visual diff review as desktop-native affordances. Whether Guild's review packet can trigger an in-app visual diff view, or whether that integration is manual, is unresolved.
5. **Scheduled tasks in cloud desktop sessions.** The audit mentions app-specific scheduled/background tasks for some app surfaces; whether Desktop supports these for cloud sessions is TBD.
