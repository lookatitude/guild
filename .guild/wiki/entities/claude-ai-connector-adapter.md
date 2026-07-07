---
type: concept
owner: architect
confidence: high
importance: medium
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

# Claude.ai connector adapter

Claude.ai custom connectors are **remote MCP connectors**, not an execution host. Anthropic's support documentation states that custom connectors connect Claude to existing or self-built remote MCP servers, and that Claude connects from Anthropic cloud infrastructure rather than the user's local device. It also explicitly states that local MCP servers configured in Claude Desktop are separate and not available in Claude.ai (source: audit §"Source-backed platform facts / Claude.ai custom connectors"). The correct framing for this adapter is **knowledge and control facade**: it exposes Guild's status, wiki/memory, and run-trace query surface through a hosted remote MCP server, and optionally allows enqueuing work to a separate execution host. It cannot load local plugin packages, local hooks, local slash-command files, local subagents, or tmux sessions. It is the Rung 4 (serial, enqueue-only) target in the backend ladder for the 9 host targets.

## Target host capabilities

```yaml
schema_version: guild.host_capabilities.v1
host_id: "claude-ai-connector"
family: "remote"
surface: "claude-ai-connector"
surface_kind: "remote-connector"

packaging:
  format: "remote-mcp-catalog"
  installable: false            # connector configured in Claude.ai settings; no local install
  manifest_path: "hosted MCP server tool catalog"

commands:
  slash_commands: false         # no local slash-command loader in Claude.ai
  toml_commands: false
  mcp_tool_commands: true       # commands exposed as MCP tools
  command_path_pattern: "hosted MCP server tool registrations"

hooks:
  session_start: false
  pre_tool_use: false
  post_tool_use: false
  permission_request: false
  ask_from_pre_tool_use: false
  subagent_stop: false
  stop: false

dispatch:
  in_process_agent: false
  subagent_dispatch: false
  independent_agents: false
  serial_only: true             # enqueue-only; execution happens on a separate host

permissions:
  ask_ui: "none"                # connector-side confirmation tool, if implemented
  deny_at_pre_tool_use: false
  bypass_permissions_mode: false

model_tiers:
  cheap: { provider: "remote", model: "backend-determined" }
  mid: { provider: "remote", model: "backend-determined" }
  powerful: { provider: "remote", model: "backend-determined" }

mcp:
  stdio: false                  # no local stdio; Anthropic cloud connects to remote server
  http: true                    # remote HTTP MCP (required transport)
  plugin_bundled: false
  core_provides_mcp: false      # Guild must host a remote MCP server

team_visibility:
  has_tmux: false
  has_independent_agents: false
  has_subagent_dispatch: false
  can_lead_team: false
  can_join_team: false
  app_threads: false
  app_projects: false
  scheduled_tasks: false        # server-side only

filesystem: "server"            # no direct local filesystem; server-side view

cost_path:
  prefer_native_subscription_path: true
  allow_external_cli_spawn: false
  trace_external_cli: false

detected_at: "runtime"
advertised_at: "session-start"
ttl_seconds: 3600
```

## Contract surfaces — implements vs degrades

| Surface | Implements | Degrades | Notes |
|---|---|---|---|
| (1) Packaging | Remote MCP tool catalog (hosted Guild MCP server registration) | No local manifest | No `plugin.json` or local file. The "package" is a hosted MCP server with a tool catalog. The connector is configured in Claude.ai settings; there is no local install step. |
| (2) Commands | MCP tools exposed as commands: `guild_status`, `guild_query_wiki`, `guild_get_run_trace`, `guild_get_phase_artifact`, `guild_start_phase`, `guild_review_artifact`, `guild_enqueue_codex_task` | No slash commands; no local command Markdown | Read tools available first; write/action tools (`guild_start_phase`, `guild_review_artifact`, `guild_enqueue_codex_task`) gated behind server-side scope checks and auth (audit §"P1: Local stdio MCP does not map to Claude.ai"). |
| (3) Hooks | None | Full hook set unavailable | No local hooks. Telemetry synthesized from file bus on the execution-host side; the connector receives trace summaries via MCP read tools. |
| (4) Dispatch | Enqueue-only (`dispatch.deferred`) via `guild_enqueue_codex_task` or equivalent | No in-process or parallel dispatch | `DispatchAdapter` returns `dispatch.deferred`; execution happens on the configured execution host. Receipt collection is a read-MCP-tool call, not a local file read. |
| (5) Permissions | Connector-side confirmation tool (if implemented) | No local ask UI | `ScopePolicy.resolve()` is not run locally. Write/destructive MCP tools enforce scope server-side; connector implements its own confirmation contract or declines. |
| (6) Model tiers | Backend-determined | Tier ladder not applicable | Tiers are advisory only; the remote execution host resolves actual models. Connector records `tier: <requested>` in enqueue payload. |
| (7) MCP | Remote HTTP MCP only | No stdio | The Guild connector IS a remote MCP server. Auth + workspace scoping required. Anthropic cloud connects from its infrastructure; local device is not involved. |
| (8) Team visibility | None (Rung 4, enqueue-only) | Full team visibility unavailable | No tmux, no app threads, no parallel sessions. Single serial enqueue path. `backend_rung: 4`. |

## Per-feature degradation matrix

| FDC | Full behavior | This host | Degradation contract |
|---|---|---|---|
| FDC-1 Memory | MCP stdio `guild-memory` | Remote HTTP `guild_query_wiki` read tool | `recall.source: remote_mcp`; no fs fallback available to connector. Knowledge access is read-only via MCP tool. |
| FDC-2 Knowledge-graph + recall | `guild-memory` or fs scan | Remote MCP read tool | No local index scan possible. `recall.mcp_available: true` (remote); `fallback_scan: false`. |
| FDC-3 Context assembly | Context bundle always written | Not applicable on connector side | Context bundle is written by the execution host; connector surfaces bundle summary via `guild_get_phase_artifact` read tool. |
| FDC-4 Agent communication | File bus canonical | Not applicable locally | File bus lives on the execution host. Connector queries run state via `guild_get_run_trace` MCP tool. No local bus writes. |
| FDC-5 Agent coordination | DAG + receipt collection | Not applicable locally | Coordination is execution-host-side. Connector can query coordination state but cannot schedule lanes. |
| FDC-6 All lifecycle phases | All 6 phases | All phases run on execution host | Connector can trigger phases via `guild_start_phase` (write gate) or `guild_enqueue_codex_task`. `phase.command_rendered_as: mcp_tool`. |
| FDC-7 Quality gates | Cross-family review | Hosted review broker | Connector can submit a review packet via `guild_review_artifact` (write gate). The broker chooses reviewer on the server side. |
| FDC-8 Operations | R/O + W + destructive | R/O via read tools; W/D via write-gate MCP tools | `guild_status`, `guild_get_run_trace` are read-only. `guild_start_phase`, `guild_enqueue_codex_task` are write-gate tools behind auth + scope checks. Destructive ops not exposed via connector. |
| FDC-9 Settings | `.guild/settings.json` | Server-side view only | Connector can expose settings via a read MCP tool; settings auth is server-managed. No local write path. |
| FDC-10 Visuals / UI | Host-native | Connector output in Claude.ai chat | Status summaries, trace digests, and artifact previews returned as MCP tool text/markdown. No interactive dashboard. |
| FDC-11 Security / permissions | Policy core + ask path | Server-side policy only | Connector enforces auth and scope server-side. No `ScopePolicy` run on connector side. Write tools require server-side authorization. |
| FDC-12 Cost + subscription | Native billing | `cost_path: remote_mcp` | All execution costs are on the execution host. Connector itself is a read/enqueue facade; no model invocations on connector. |
| FDC-13 MCP | stdio / HTTP | Remote HTTP only | The connector IS the remote MCP server. No stdio. Auth + workspace scoping mandatory. |
| FDC-14 Host-native subagents | Parallel agents | Not applicable | No dispatch capability on connector. Enqueue target (execution host) handles parallelism. |
| FDC-15 Work isolation | Worktrees | Not applicable locally | Worktrees managed by execution host. Connector has no filesystem view. |
| FDC-16 Telemetry + replay | Normalized trace | Read-only via `guild_get_run_trace` | Trace is produced and stored by execution host. Connector exposes summaries; FROZEN `guild.trace_event.v1` lives on execution host. |

## Packaging format

**No local manifest.** The Claude.ai connector is configured as a remote MCP connector in Claude.ai settings. There is no `plugin.json`, no local file install, and no CLI command to install it.

The "package" for this surface is a **hosted Guild remote MCP server** (`guild-remote-mcp`) that Guild must build and deploy separately. The server exposes:

**Read-first tools** (no scope gate beyond auth):
- `guild_status` — active phase, run state, recent events.
- `guild_query_wiki` — BM25/semantic search over `.guild/wiki/`.
- `guild_get_run_trace` — trace summary for a run ID.
- `guild_get_phase_artifact` — artifact content by path and run ID.

**Write/action tools** (behind explicit server-side scope + auth gates):
- `guild_start_phase` — trigger a phase on the execution host.
- `guild_review_artifact` — submit a review packet.
- `guild_enqueue_codex_task` — enqueue a task to a Guild daemon or execution host.

Source: audit §"P1: Local stdio MCP does not map to Claude.ai" and §"12. Claude.ai facade".

Auth and workspace scoping are server responsibilities. The connector connects **from Anthropic cloud infrastructure**, not from the user's local device.

## Unresolved questions

1. **Hosted `guild-remote-mcp` server design.** The audit recommends building a remote MCP facade as a separate hosted service before writing connector code. The auth model (user-scoped, workspace-scoped, OAuth?), the workspace selection mechanism, and the hosting infrastructure are all unresolved. This is the primary blocker before any connector code can be written.
2. **Write-gate confirmation contract.** Write/action tools require a server-side confirmation mechanism. Whether this is an interactive Claude.ai card (if the connector API supports it), a separate confirmation MCP tool exchange, or simply a per-tool opt-in at connection time needs a design decision.
3. **Enqueue target configuration.** `guild_enqueue_codex_task` and `guild_start_phase` need an execution host to route work to. Whether the execution host is configured at connector setup time (one connector per workspace per execution host) or is dynamically selectable per tool call needs a decision.
4. **Read-tool workspace scoping.** `guild_query_wiki` and `guild_get_run_trace` must be scoped to a specific repo/workspace. Whether workspace selection is a per-tool parameter, a connector-level config, or a session-level binding needs the server design to specify.
5. **Connector availability in Claude.ai chat vs Claude.ai Projects.** Whether the connector is available in standalone Claude.ai chat, in Claude.ai Projects, or both (and whether behavior differs between them) needs confirmation from Anthropic connector documentation.
