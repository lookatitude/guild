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
updated_at: 2026-07-30
expires_at: null
supersedes: null
sensitivity: public
---

# Codex app adapter

The Codex app is a desktop application for parallel Codex threads with built-in worktree support, automations, Git functionality, local project selection, terminal/actions, in-app browser, skills, and plugins (source: audit §"Source-backed platform facts / Codex CLI and Codex app"). The app has a Plugin Directory for browsing and installing plugins; it loads the same `.codex-plugin/plugin.json` format as the Codex CLI. Codex subagents can run specialized agents in parallel and surface activity in both the app and CLI. The app adds over the CLI: native parallel threads with worktrees (Rung 2), terminal/actions for repeatable scripts, an in-app browser for rendered UI verification, and automations for scheduled or triggered tasks. The adapter uses the same Codex plugin manifest as the CLI adapter (`codex-adapter.md`) with app-specific additions for thread/worktree dispatch, trust/setup flow, and automation.

## Target host capabilities

```yaml
schema_version: guild.host_capabilities.v1
host_id: "codex-app"
family: "codex"
surface: "codex-app"
surface_kind: "desktop-app"

packaging:
  format: "codex-plugin"
  installable: true             # via Codex app Plugin Directory
  manifest_path: ".codex-plugin/plugin.json"

commands:
  slash_commands: true
  toml_commands: false
  mcp_tool_commands: false
  command_path_pattern: ".codex-plugin/plugin.json commands block"

hooks:
  session_start: true
  pre_tool_use: true            # deny/rewrite only; ask NOT supported (same as Codex CLI)
  post_tool_use: true
  permission_request: true      # Codex PermissionRequest event
  ask_from_pre_tool_use: false
  subagent_stop: true
  stop: true

dispatch:
  in_process_agent: false
  subagent_dispatch: true       # Codex native subagents
  independent_agents: true      # app parallel threads/worktrees (Rung 2)
  serial_only: false

permissions:
  ask_ui: "permission_request"  # app trust/approval flow
  deny_at_pre_tool_use: true
  bypass_permissions_mode: false  # app sandbox/approval modes; TBD exact flag

model_tiers:
  cheap: { model: "default", reasoning: "low" }
  mid: { model: "default", reasoning: "medium" }
  powerful: { model: "default", reasoning: "high" }

mcp:
  stdio: true                   # local app context if plugin/config supports it
  http: false                 # corrected 2026-07-30 (#114) — authoritative row is stdio:false, http:false (INFERRED)
  plugin_bundled: true
  core_provides_mcp: true

team_visibility:
  has_tmux: false               # tmux not primary in app context
  has_independent_agents: true  # app parallel threads + subagents
  has_subagent_dispatch: true
  can_lead_team: true
  can_join_team: true
  app_threads: true             # native thread/worktree parallelism
  app_projects: false
  scheduled_tasks: true         # Codex automations

filesystem: "local"             # local project folders

cost_path:
  prefer_native_subscription_path: true
  allow_external_cli_spawn: true  # Codex CLI process is native for Codex family
  trace_external_cli: false

detected_at: "runtime"
advertised_at: "session-start"
ttl_seconds: 3600
```

## Contract surfaces — implements vs degrades

| Surface | Implements | Degrades | Notes |
|---|---|---|---|
| (1) Packaging | `.codex-plugin/plugin.json` via Plugin Directory | — | Same manifest as CLI adapter. App adds GUI install flow through Plugin Directory. Plugin-bundled hooks must be reviewed and trusted before they run (same trust flow as CLI). |
| (2) Commands | Codex plugin command/workflow entries (same as CLI) | — | Commands rendered from `GuildCommand` registry into plugin JSON blocks. App may surface these as app actions in addition to CLI commands. |
| (3) Hooks | Same lifecycle events as Codex CLI + app context | `PreToolUse ask` degrades to `PermissionRequest` | Hook behavior identical to `codex-adapter.md` Surface 3. App adds trust flow for plugin-bundled hooks. |
| (4) Dispatch | Codex app parallel threads/worktrees (Rung 2) + subagents (also Rung 2) → serial (Rung 4) | No tmux | `HostIndependentAgentBackend` maps Guild lanes to app threads with built-in worktrees. `DispatchAdapter` uses app-native thread model rather than `codex exec` tmux panes. |
| (5) Permissions | `PermissionRequest` event (app trust/approval UI) | No `PreToolUse ask` | Same as CLI: `ScopePolicy.resolve()` runs; emitter maps `ask` → `PermissionRequest` → app approval UI, or file-bus pause if not available. |
| (6) Model tiers | `{ model: "default", reasoning: low/medium/high }` | — | Identical to CLI `ModelResolver`. |
| (7) MCP | **UNVERIFIED — authoritative row is `mcp: {stdio: false, http: false}` (provenance `inferred`)** | App trust flow required | **CORRECTED 2026-07-30 (#114):** the earlier "stdio + HTTP via plugin bundle" claim exceeded the registry row and is withdrawn. `McpAdapter` emits MCP entries in `.codex-plugin/plugin.json`, but nothing about MCP in the APP has been exercised on a live host; treat as an unverified target until it is. |
| (8) Team visibility | Rung 2 (app threads/worktrees) → subagent Rung 2 → serial Rung 4 | No tmux as primary surface | `app_threads: true`; Guild lanes mapped to app threads, not tmux panes. `has_tmux: false` in app context. |

## Per-feature degradation matrix

| FDC | Full behavior | This host | Degradation contract |
|---|---|---|---|
| FDC-1 Memory | MCP stdio `guild-memory` | **UNVERIFIED (row says stdio:false, http:false — inferred)** | Corrected 2026-07-30 (#114): no transport is claimed for the app. Falls back to fs/BM25. |
| FDC-2 Knowledge-graph + recall | `guild-memory` or fs scan | MCP or fallback | Index re-scan if MCP unavailable. |
| FDC-3 Context assembly | Context bundle always written | Full | Bundle written in project folder; `degraded_retrieval` if FDC-1/2 degrade. |
| FDC-4 Agent communication | File bus canonical | Full (app writes to local project `.guild/`) | `agent_bus.transport: file_bus_native`; threads write receipts and events to local project tree. |
| FDC-5 Agent coordination | DAG + receipt collection | Rung 2 (app threads) | `coordination.parallelism: host_native`; `backend_rung: 2`. |
| FDC-6 All lifecycle phases | All 6 phases | Full via plugin commands + PermissionRequest gates | `command_rendered_as: codex_plugin_command`; `ask_path: interactive` via `PermissionRequest`. |
| FDC-7 Quality gates | Cross-family review | Codex app can dispatch Claude reviewer | Review broker routes from Codex-authored artifacts to Claude; app can host both sides. |
| FDC-8 Operations | R/O + W + destructive | Full; destructive via `PermissionRequest` or file-bus pause | `ops.approval: interactive` when `PermissionRequest` available. |
| FDC-9 Settings | `.guild/settings.json` | Full | App config panel is renderer; source of truth is `.guild/settings.json`. |
| FDC-10 Visuals / UI | Host-native | App threads panel, terminal/actions, in-app browser, artifacts | No tmux; app provides richer visual surface than CLI for reviewing parallel work. |
| FDC-11 Security / permissions | Policy core + ask path | `PermissionRequest` (app approval UI) | Same as CLI: `ask_renderer: permission_request`. |
| FDC-12 Cost + subscription | Native billing | `cost_path: native_process` | Codex app subscription path is native. |
| FDC-13 MCP | **none claimed** | UNVERIFIED | Corrected 2026-07-30 (#114): "Full (once trusted)" overstated an `inferred` row of stdio:false/http:false. Requires live verification on the app before any transport is claimed. |
| FDC-14 Host-native subagents | Parallel agents | App threads + subagents (Rung 2) | Threads provide worktree isolation; subagents provide parallel execution. `coordination.parallelism: host_native`. |
| FDC-15 Work isolation | Worktrees | Built-in app worktrees | Native worktree support per app docs. No serialization needed for parallel conflicting lanes. |
| FDC-16 Telemetry + replay | Normalized trace | Normalization required | Same as CLI: `GuildHookEvent` normalization for Codex field names. `source: host_hook`, `fidelity: full` when hooks trusted. |

## Packaging format

**Manifest path:** `.codex-plugin/plugin.json` (same as Codex CLI)

The Codex app loads the same `.codex-plugin/plugin.json` manifest as the CLI. The app adds a Plugin Directory GUI for installation. **Hook trust flow is required before plugin-bundled hooks run** — the user must review and trust them in the app UI. This trust flow is the main operational difference from CLI installation (source: audit §"Source-backed platform facts / Codex CLI and Codex app").

App-specific adapter additions over the CLI adapter:

- **Thread/worktree dispatch.** The `DispatchAdapter` maps Guild lanes to app threads with built-in worktrees rather than `codex exec` tmux panes.
- **Terminal/actions.** Repeatable scripts (test runners, build steps, verification commands) can be registered as Codex app actions, providing a more reliable execution surface than manual terminal commands.
- **In-app browser.** Available for rendered UI verification; Guild's QA phase can use this for browser-based checks.
- **Automations.** Codex app automations provide scheduled or triggered task execution; Guild maintenance tasks (e.g. `guild:reflect`, `guild:ops`) can be mapped here.

Verification: `codex plugin list` or app Plugin Directory list.

## Unresolved questions

1. **App MCP trust flow.** The audit marks app MCP support as "must test exact app trust/setup flow" (audit §"MCP support matrix / Codex app"). Whether MCP servers bundled in a Codex app plugin auto-start on install or require a separate trust/setup step needs live verification.
2. **Thread dispatch API.** Whether there is a programmatic API for launching Codex app threads from a Guild skill/command (vs the user manually opening threads in the UI) is unverified. Automated lane dispatch to app threads requires this API.
3. **App vs cloud thread state sync.** The audit cautions "do not assume cloud threads have access to the user's local `.guild/` state unless the project/environment sync model is explicit." Whether app threads that run in Codex cloud (vs locally) share the local project `.guild/` tree needs explicit verification.
4. **Automation trigger model.** Codex app automations support scheduled/triggered tasks. Whether Guild can register automations programmatically via plugin manifest or only through app UI configuration needs investigation.
5. **`PermissionRequest` in app vs CLI context.** Whether the `PermissionRequest` event in the app context presents a GUI approval dialog (vs a CLI prompt) and whether Guild's `PermissionEmitter` needs app-specific response handling needs confirmation.
