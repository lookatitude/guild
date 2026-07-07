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

# Pi adapter

Pi (`pi.dev`) is a local terminal agent whose design explicitly omits built-in MCP, subagents, permission popups, plan mode, to-dos, and background bash — the Pi design principles page states these workflows can be built as extensions/packages or delegated to external tools (source: audit §"Source-backed platform facts / Pi"). Pi packages bundle extensions, skills, prompt templates, and themes; resources are declared under the `pi` key in `package.json` or auto-discovered from `extensions/`, `skills/`, `prompts/`, and `themes/` directories. Pi extensions are TypeScript modules that subscribe to lifecycle events, register custom tools and commands, provide UI interactions, and intercept or modify behavior. Pi skills implement the Agent Skills standard and can reuse Claude Code or OpenAI Codex skill directories. Because Pi omits the features most other CLI hosts provide natively, Guild's Pi adapter must **supply those missing capabilities via the package itself** — specifically a package-provided MCP bridge, a package-provided team/subagent backend, and `ctx.ui.confirm`-based permission prompts.

## Target host capabilities

```yaml
schema_version: guild.host_capabilities.v1
host_id: "pi"
family: "pi"
surface: "pi"
surface_kind: "cli-package"

packaging:
  format: "pi-manifest"
  installable: true
  manifest_path: "package.json (pi key)"

commands:
  slash_commands: true        # via pi.registerCommand() or prompt templates
  toml_commands: false
  mcp_tool_commands: false
  command_path_pattern: "extensions/guild.ts (pi.registerCommand calls)"

hooks:
  session_start: true         # Pi extension lifecycle event subscription
  pre_tool_use: true          # via Pi extension event interception
  post_tool_use: true
  permission_request: false   # Pi has no built-in permission popup; package provides ctx.ui.confirm
  ask_from_pre_tool_use: false  # no native permission popup; use ctx.ui.confirm instead
  subagent_stop: false        # Pi core omits subagents; package-provided only
  stop: true

dispatch:
  in_process_agent: false     # Pi core omits built-in subagents
  subagent_dispatch: false    # must be package-provided or delegated to external tools
  independent_agents: false
  serial_only: true           # conservative default; package-provided team backend can upgrade

permissions:
  ask_ui: "ctx_ui_confirm"    # Pi extension ctx.ui.confirm / ctx.ui.input
  deny_at_pre_tool_use: true  # event interception can deny
  bypass_permissions_mode: false  # no native bypass mode; package-managed

model_tiers:
  cheap: { provider: "configured", model: "configured" }
  mid: { provider: "configured", model: "configured" }
  powerful: { provider: "configured", model: "configured" }

mcp:
  stdio: false                # Pi core intentionally omits built-in MCP
  http: false
  plugin_bundled: false       # must be package-provided bridge
  core_provides_mcp: false    # explicit: Pi core omits MCP; Guild package bridges it

team_visibility:
  has_tmux: true              # tmux available for visible lane processes
  has_independent_agents: false
  has_subagent_dispatch: false  # package-provided or external
  can_lead_team: true         # via package-provided team backend
  can_join_team: true
  app_threads: false
  app_projects: false
  scheduled_tasks: false

filesystem: "local"

cost_path:
  prefer_native_subscription_path: true
  allow_external_cli_spawn: true  # package-provided team backend uses process spawning
  trace_external_cli: false

detected_at: "runtime"
advertised_at: "session-start"
ttl_seconds: 3600
```

## Contract surfaces — implements vs degrades

| Surface | Implements | Degrades | Notes |
|---|---|---|---|
| (1) Packaging | `package.json` `pi` key + `extensions/`, `skills/`, `prompts/` directories | — | Pi renderer emits the `pi` block in `package.json` from Guild inventory. Auto-discovery from conventional directories is supported. Install from npm/git/HTTPS/local path. Package trust and source review must be documented explicitly (audit §"7. Pi adapter"). |
| (2) Commands | `pi.registerCommand()` calls inside Guild TS extension, or prompt templates | No Claude Markdown; no TOML | Commands registered via extension entrypoint (`extensions/guild.ts`). `/guild:<verb>` maps to `pi.registerCommand("guild:verb", …)`. Pi skills as `/skill:name` commands are a secondary surface. |
| (3) Hooks | Pi extension lifecycle event subscription + event interception | Partial: no native `SubagentStart`/`SubagentStop` (Pi omits subagents) | `GuildHookEvent` normalization maps Pi event names. `SessionStart` and tool-call events available via extension. Hook interception can rewrite or block tool calls. |
| (4) Dispatch | External lane process via tmux (Rung 1) or serial (Rung 4) | No built-in subagent dispatch | Pi core omits subagents. Dispatch is package-provided: external processes or tmux lanes. `DispatchAdapter` for Pi delegates to the package team backend (audit §"7. Pi adapter"). |
| (5) Permissions | `ctx.ui.confirm` / `ctx.ui.input` for ask; event interception deny | No native permission popup built-in | `PermissionEmitter` maps `ask` → `ctx.ui.confirm`. If unavailable → file-bus `approval_request` + pause (FDC-11). `ctx.ui.confirm` is Pi's sanctioned user-interaction API. |
| (6) Model tiers | Provider-configured; model name from Pi settings | No model name baked in | `ModelResolver` reads Pi's configured provider/model at runtime. Tier ladder (`cheap/mid/powerful`) preserved; underlying model is environment-specific (audit §"P0: Model tiers"). |
| (7) MCP | Package-provided MCP bridge | Pi core omits MCP entirely | `McpAdapter` for Pi must either ship a companion MCP bridge or fall back to the filesystem scanner over `.guild/wiki/` + `.guild/runs/` (FDC-13). The package bridge is the preferred path; the fs fallback ensures recall still works. |
| (8) Team visibility | Rung 1 (tmux via package-provided team backend) → Rung 4 (serial) | No host-native parallelism | Package provides team backend. `team_visibility.has_tmux: true` when tmux is installed and the package team module is enabled. |

## Per-feature degradation matrix

| FDC | Full behavior | This host | Degradation contract |
|---|---|---|---|
| FDC-1 Memory | MCP stdio `guild-memory` | Package-provided MCP bridge or fs/BM25 fallback | `recall.source: fs_bm25` when bridge absent; `recall.degraded: true`; `degraded_reason: mcp_unavailable`. |
| FDC-2 Knowledge-graph + recall | `guild-memory` or fs scan | Package MCP or fs fallback | `recall.fallback_scan: true` when bridge absent. Indexes re-scanned. |
| FDC-3 Context assembly | Context bundle always written | Full | Bundle written identically; `degraded_retrieval: true` if FDC-1/2 degrade. |
| FDC-4 Agent communication | File bus canonical | Full (Pi extension writes files in `cwd`) | `agent_bus.transport: file_bus_native`; Pi extension polls bus if no event hooks for live notification. |
| FDC-5 Agent coordination | DAG + receipt collection | Rung 1 (package team) or Rung 4 (serial) | `coordination.parallelism: serial` if no package team backend installed; `backend_rung: 4`. |
| FDC-6 All lifecycle phases | All 6 phases | Full via `pi.registerCommand` + `ctx.ui` gates | `phase.command_rendered_as: pi_command`; `ask_path: interactive` via `ctx.ui.confirm` or `file_bus_pause` fallback. |
| FDC-7 Quality gates | Cross-family review | Cross-provider to Codex or Claude | Pi-authored artifacts reviewed by configured different-provider; Pi itself can be reviewer target for other hosts. |
| FDC-8 Operations | R/O + W + destructive | R/O always; W/D via `ctx.ui.confirm` or file-bus pause | `ops.approval: interactive` when `ctx.ui.confirm` available; `file_bus_pause` otherwise. |
| FDC-9 Settings | `.guild/settings.json` | Full | Pi extension reads/writes `.guild/settings.json`; Pi extension UI is renderer only. |
| FDC-10 Visuals / UI | Host-native | Pi command UI + extension notifications | `ctx.ui.notify` for startup card equivalent; no tmux dashboard. |
| FDC-11 Security / permissions | Policy core + ask path | `ctx.ui.confirm` for ask | `ScopePolicy` runs; emitter maps ask to `ctx.ui.confirm`. `approval_request.ask_renderer: ctx_ui_confirm`. |
| FDC-12 Cost + subscription | Native billing | `cost_path: native_process` | Pi uses configured provider; process spawning is native. No external Claude CLI issue. |
| FDC-13 MCP | stdio | Package-provided bridge or fs fallback | `mcp.bridge_package: guild-pi-mcp` (provisional name); `fallback_reader: fs_scanner` when bridge absent. |
| FDC-14 Host-native subagents | Parallel agents | Package-provided or serial | Pi core omits subagents. `coordination.parallelism: serial` unless package team backend provides parallelism. |
| FDC-15 Work isolation | Worktrees | Via shell/Git | Git worktrees available on any CLI host. |
| FDC-16 Telemetry + replay | Normalized trace | Normalization required | Pi extension event fields differ from Claude/Codex. `GuildHookEvent` normalization mandatory. If hooks absent: `source: file_bus_synthesis`, `fidelity: reduced`. |

## Packaging format

**Manifest path:** `package.json` (`pi` key) + conventional directories

The Pi renderer emits the `pi` key in `package.json` plus the following conventional directories from the Guild inventory:

- `extensions/guild.ts` — the Guild TypeScript extension entrypoint (lifecycle events, `pi.registerCommand`, `ctx.ui` wrappers, MCP bridge initialization, team backend hooks).
- `skills/<name>/SKILL.md` — Guild skills directly reused; Pi implements the Agent Skills standard and can load from Guild's `skills/` directories.
- `prompts/<verb>.md` — prompt templates for commands not served by `registerCommand`.

Pi packages can be installed from npm, git, HTTPS URLs, or local paths. Source: audit §"Source-backed platform facts / Pi". **Package trust and source review must be explicit in install documentation** because Pi extensions can execute arbitrary TypeScript code.

Surface 1 of `decisions/host-adapter-contract.md` governs the renderer. The key constraint: `core_provides_mcp: false` means the MCP bridge MUST be packaged by the Guild Pi extension or documented as a companion package — the contract (Surface 7) requires the recall layer to keep working even without native MCP.

## Unresolved questions

1. **MCP bridge packaging strategy.** The FDC-13 contract requires a package-provided bridge or fs-fallback. Whether the bridge ships as part of the main Guild Pi package or as a separately installable companion (e.g. `guild-pi-mcp`) is unresolved. The choice affects install UX and dependency footprint.
2. **Pi event interception API completeness.** Whether Pi's extension event interception can deny a tool call in the same hook turn (analogous to `PreToolUse deny`) or only post-process needs verification. If interception is post-only, the deny path degrades to file-bus pause.
3. **Package team backend design.** Pi core omits subagents; the team backend must be entirely package-provided. Whether this is best implemented as tmux process management inside the extension, or as an optional companion package with its own `package.json`, needs a design decision before implementation.
4. **`pi.registerCommand` naming vs `/guild:<verb>` namespace.** Pi commands registered via extension use the package namespace; whether the `/guild:verb` naming convention maps cleanly to Pi's command routing or needs a different public name needs a style decision.
5. **Pi model/provider configuration surface.** Pi's model/provider is user-configured; Guild's `ModelResolver` must read the active Pi provider config at runtime. The exact config API (env var, Pi settings file, `ctx.config`) needs documentation before the `ModelResolver` can be coded.
