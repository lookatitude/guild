---
type: concept
owner: architect
confidence: high
importance: medium
source_refs:
  - docs/knowledge/audits/compatibility-2026-05-28/cross-platform-compatibility-report.md
  - docs/knowledge/decisions/host-adapter-contract.md
  - docs/knowledge/decisions/feature-degradation-contracts.md
  - docs/knowledge/decisions/phase-continuity-requirements.md
related: [host-adapter-contract, feature-degradation-contracts, phase-continuity-requirements, claude-code-adapter, codex-adapter, gemini-cli-adapter, pi-adapter, claude-code-desktop-adapter, claude-code-web-adapter, codex-app-adapter, antigravity-2-adapter, claude-ai-connector-adapter]
applies_to: [plugin]
created_at: 2026-05-28
updated_at: 2026-05-28
expires_at: null
supersedes: null
sensitivity: public
---

# Claude Code Web adapter

Claude Code on the web runs on Anthropic-managed cloud VMs from the browser or mobile Code tab. It clones GitHub repositories into isolated VMs, runs setup scripts, changes code, runs tests, and pushes branches for review (source: audit §"Source-backed platform facts / Claude Code Desktop and Web apps"). The documentation's comparison table explicitly states that local config is **not** used for web sessions; it is available only in the terminal CLI and local desktop sessions. This is the defining constraint for this adapter: no local filesystem, no local plugin installation, no local MCP, no local hooks, no tmux. Guild state and commands must be seeded from the cloned repository, and MCP must be environment-mediated or remote. The adapter is a **cloud execution host** with repo-based constraints, not a "local package host."

## Target host capabilities

```yaml
schema_version: guild.host_capabilities.v1
host_id: "claude-code-web"
family: "claude"
surface: "claude-code-web"
surface_kind: "web-app"

packaging:
  format: "claude-plugin"
  installable: false            # local plugin install not available in web sessions
  manifest_path: "commands/*.md (from cloned repo)"

commands:
  slash_commands: true          # command Markdown read from cloned repo
  toml_commands: false
  mcp_tool_commands: false
  command_path_pattern: "commands/*.md"

hooks:
  session_start: false          # no local plugin hooks in cloud VM
  pre_tool_use: false           # hooks depend on local plugin; not available in web
  post_tool_use: false
  permission_request: false
  ask_from_pre_tool_use: false
  subagent_stop: false
  stop: false

dispatch:
  in_process_agent: true        # Agent() / cloud subagents available
  subagent_dispatch: true
  independent_agents: true      # cloud parallel sessions
  serial_only: false

permissions:
  ask_ui: "file_bus_pause"      # no local hooks; approval via file-bus pause
  deny_at_pre_tool_use: false   # hooks unavailable; deny via scope policy + file-bus
  bypass_permissions_mode: false  # TBD for cloud VM context

model_tiers:
  cheap: { model: "haiku" }
  mid: { model: "sonnet" }
  powerful: { model: "opus" }

mcp:
  stdio: false                  # no local stdio processes in cloud VM
  http: true                    # environment-mediated remote MCP
  plugin_bundled: false         # plugin bundle not loaded
  core_provides_mcp: false      # local MCP servers not started; remote HTTP only

team_visibility:
  has_tmux: false               # no tmux in cloud VM context
  has_independent_agents: true  # cloud parallel sessions
  has_subagent_dispatch: true
  can_lead_team: true           # cloud session can orchestrate
  can_join_team: true
  app_threads: true             # cloud parallel sessions
  app_projects: false
  scheduled_tasks: true         # cloud/app-specific background tasks possible

filesystem: "remote"            # cloned repo in isolated cloud VM; not user's local FS

cost_path:
  prefer_native_subscription_path: true
  allow_external_cli_spawn: false
  trace_external_cli: true

detected_at: "runtime"
advertised_at: "session-start"
ttl_seconds: 3600
```

## Contract surfaces — implements vs degrades

| Surface | Implements | Degrades | Notes |
|---|---|---|---|
| (1) Packaging | Command Markdown read from cloned repo | No plugin install; no manifest emitter | The adapter does not emit a package manifest; it reads Guild's `commands/*.md` files from the repository clone. No `plugin.json` install step. |
| (2) Commands | `commands/*.md` loaded from repo | Full command surface, but from repo clone only | Commands work if the repo includes them; there is no plugin browser or install step. Guild commands must be committed to the consuming repo or loaded via setup script. |
| (3) Hooks | None | Full hook set unavailable | No local plugin = no hooks. Telemetry synthesized from file bus and command wrappers (`source: file_bus_synthesis`, `fidelity: reduced`). |
| (4) Dispatch | Cloud Agent() subagents / parallel cloud sessions (Rung 2) → serial (Rung 4) | No tmux | `HostIndependentAgentBackend` maps Guild lanes to cloud parallel sessions. Rung 1 (tmux) unavailable. |
| (5) Permissions | File-bus `approval_request` + pause | No `PreToolUse ask` | `ScopePolicy.resolve()` runs in-process; emitter always degrades to `ask_renderer: file_bus_pause` (FDC-11). |
| (6) Model tiers | `haiku / sonnet / opus` (same as CLI) | — | `ModelResolver` uses Claude model names; cloud VM runs Anthropic models. |
| (7) MCP | Remote HTTP MCP only | No stdio | `McpAdapter` for cloud uses environment-mediated remote MCP. No `guild-memory` / `guild-telemetry` stdio servers; must use remote HTTP endpoints or fs fallback. |
| (8) Team visibility | Rung 2 (cloud parallel sessions) → Rung 4 (serial) | No tmux, no local panes | `app_threads: true`; `has_tmux: false`. Backend rung = 2 when cloud parallel sessions available, else 4. |

## Per-feature degradation matrix

| FDC | Full behavior | This host | Degradation contract |
|---|---|---|---|
| FDC-1 Memory | MCP stdio `guild-memory` | Remote HTTP MCP or fs fallback | `recall.source: fs_bm25` if remote MCP unavailable. `recall.degraded: true`, `degraded_reason: mcp_unavailable`. |
| FDC-2 Knowledge-graph + recall | `guild-memory` or fs scan | fs fallback in cloud VM | `recall.fallback_scan: true`; `.guild/` tree present in cloned repo. |
| FDC-3 Context assembly | Context bundle always written | Full | Bundle written in cloud VM clone; `degraded_retrieval: true` if MCP unavailable. |
| FDC-4 Agent communication | File bus canonical | File bus polled | `agent_bus.transport: file_bus_polled`; cloud parallel sessions poll `.guild/runs/<run-id>/agent-bus/`. |
| FDC-5 Agent coordination | DAG + receipt collection | Rung 2 (cloud sessions) or Rung 4 | `coordination.parallelism: host_native` (cloud) or `serial`. |
| FDC-6 All lifecycle phases | All 6 phases | Full via command Markdown; no interactive hook ask | `command_rendered_as: claude_markdown`; `ask_path: file_bus_pause` (no `PreToolUse ask`). |
| FDC-7 Quality gates | Cross-family review | Cloud review broker via environment | Cross-provider review possible if configured reviewer is reachable from cloud VM. |
| FDC-8 Operations | R/O + W + destructive | R/O always; W/D via file-bus pause | `ops.approval: file_bus_pause`; no interactive ask UI. |
| FDC-9 Settings | `.guild/settings.json` | From cloned repo | `.guild/settings.json` committed in repo or scaffolded by setup script. No local plugin config renderer. |
| FDC-10 Visuals / UI | Host-native | Native branch/PR review in cloud app | Cloud surface has branch-level diffs and PR review; no local terminal dashboard. |
| FDC-11 Security / permissions | Policy core + ask | File-bus pause | `ScopePolicy` runs; all ask → `approval_request` + pause. `ask_renderer: file_bus_pause`. |
| FDC-12 Cost + subscription | Native billing | `cost_path: native_integration` | Cloud VM runs within Anthropic-managed subscription path. |
| FDC-13 MCP | stdio / HTTP | Remote HTTP only | `mcp.stdio_available: false`; `mcp.http_available: true`; `fallback_reader: fs_scanner`. |
| FDC-14 Host-native subagents | Parallel agents | Cloud parallel sessions (Rung 2) | `coordination.parallelism: host_native`; cloud Agent/subagent dispatch. |
| FDC-15 Work isolation | Worktrees | Branch/session isolation | Cloud VM per-session isolation; no explicit worktree allocation; conflicting lanes serialized. |
| FDC-16 Telemetry + replay | Normalized trace | Synthesized from file bus | No hook payloads; `source: file_bus_synthesis`, `fidelity: reduced`. FROZEN `guild.trace_event.v1` still produced. |

## Packaging format

**No local manifest.** Claude Code Web does not use a local plugin install. Guild's commands and `.guild/` artifacts reach the cloud VM through two paths:

1. **Committed to the consuming repo.** `commands/*.md` files, `.guild/settings.json` scaffold, and any required `commands/` files are committed to the Git repository and available in the cloud VM clone.
2. **Setup script.** The cloud VM runs a setup script from the repo; that script can scaffold `.guild/` structure and any environment configuration that is not committed.

The adapter emits no `plugin.json`. The "packaging" surface for this host is the repo-committed artifact set, not an installable plugin. Source: audit §"Source-backed platform facts / Claude Code Desktop and Web apps" and §"Proposed cross-platform architecture / 9. Claude Code Desktop/Web adapters".

## Unresolved questions

1. **Setup script contract.** The audit identifies setup scripts as the mechanism for cloud VM configuration, but the exact script interface (name, location, expected env outputs, idempotency requirements) is not specified. Defining this contract is a prerequisite for automating Guild's cloud bootstrap.
2. **Remote MCP endpoint for `guild-memory` / `guild-telemetry`.** These servers are stdio-only today. Reaching them from a cloud VM requires a hosted remote MCP endpoint. Whether that endpoint is part of the `claude-ai-connector-adapter` or a separate Guild-hosted service needs a design decision.
3. **Cloud VM `.guild/` persistence.** Whether the cloud VM's `.guild/` tree persists across sessions (e.g. across browser tab reloads or VM restarts) or is rebuilt from the repo clone each time determines how much state can accumulate between sessions. Cross-session resume depends on this.
4. **Parallel cloud session dispatch API.** The capability table advertises `independent_agents: true` for cloud parallel sessions. Whether there is a programmatic API for launching parallel cloud sessions (vs the user opening them manually) needs confirmation.
5. **Permission policy enforcement without hooks.** With no `PreToolUse` hooks, the capability-scope enforcement path relies entirely on file-bus pause. The exact mechanism for inserting this pause point into the cloud Agent's tool-call flow (before the tool executes) needs design.
