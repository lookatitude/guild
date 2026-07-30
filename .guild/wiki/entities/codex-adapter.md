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

# Codex CLI adapter

Codex CLI is a local terminal coding agent (source: audit §"Source-backed platform facts / Codex CLI and Codex app") that offers native subagent dispatch, `codex exec` for non-interactive lane execution, MCP support (stdio and streamable HTTP), plugin hooks, and a `.codex-plugin/plugin.json` manifest format. It is the **strong parity target** for Guild's CLI track — the existing `CodexPaneAdapter` (`plugin/scripts/lib/pane-adapter.ts:111-168`) already emits `codex exec '<prompt>'` and exports `GUILD_RUN_ID`, establishing the skeleton. The key adaptation challenges relative to the Claude reference implementation are: hook `permissionDecision: ask` is unsupported in `PreToolUse` (Codex documents this as "parsed but not supported, causes hook failure"); a separate `PermissionRequest` event exists instead; and auth preflight must accept both `OPENAI_API_KEY` and `codex login` paths (audit §"Current local defects blocking generic tmux teams", LEAKS D-6).

## Target host capabilities

```yaml
schema_version: guild.host_capabilities.v1
host_id: "codex-cli"
family: "codex"
surface: "codex-cli"
surface_kind: "cli-package"

packaging:
  format: "codex-plugin"
  installable: true
  manifest_path: ".codex-plugin/plugin.json"

commands:
  slash_commands: true
  toml_commands: false
  mcp_tool_commands: false
  command_path_pattern: ".codex-plugin/plugin.json commands block"

hooks:
  session_start: true
  pre_tool_use: true          # deny/rewrite only; ask NOT supported
  post_tool_use: true
  permission_request: true    # Codex-specific separate event for user-approval ask
  ask_from_pre_tool_use: false  # docs state permissionDecision: ask causes hook failure
  subagent_stop: true
  stop: true

dispatch:
  in_process_agent: false     # no Claude Agent() equivalent; uses codex exec / subagents
  subagent_dispatch: true     # Codex native subagents
  independent_agents: false   # subagents are parallel but not fully independent threads
  serial_only: false

permissions:
  ask_ui: "permission_request"    # Codex PermissionRequest event
  deny_at_pre_tool_use: true
  bypass_permissions_mode: false  # Codex approval modes differ; TBD exact flag

model_tiers:
  cheap: { model: "default", reasoning: "low" }
  mid: { model: "default", reasoning: "medium" }
  powerful: { model: "default", reasoning: "high" }

mcp:
  stdio: true
  http: true                  # streamable HTTP also supported
  plugin_bundled: true
  core_provides_mcp: true

team_visibility:
  has_tmux: true              # when tmux installed; codex exec spawns lane processes
  has_independent_agents: false
  has_subagent_dispatch: true
  can_lead_team: true
  can_join_team: true
  app_threads: false
  app_projects: false
  scheduled_tasks: false

filesystem: "local"

cost_path:
  prefer_native_subscription_path: true
  allow_external_cli_spawn: true    # codex exec IS the native process path for this host
  trace_external_cli: false         # codex exec is native; no external_cli trace flag

detected_at: "runtime"
advertised_at: "session-start"
ttl_seconds: 3600
```

## Contract surfaces — implements vs degrades

| Surface | Implements | Degrades | Notes |
|---|---|---|---|
| (1) Packaging | `.codex-plugin/plugin.json` renderer | — | `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` compat vars set by Codex for existing hook scripts (audit §"Codex CLI and Codex app"). `PLUGIN_ROOT` / `PLUGIN_DATA` are the native names for new code. |
| (2) Commands | Codex plugin command/workflow entries rendered from `GuildCommand` registry | Claude `allowed-tools` frontmatter not used | Module resources are the canonical command bodies; `commands/*.md` is the generated Claude-compatible mirror that Codex rendering maps into plugin JSON blocks. |
| (3) Hooks | `SessionStart`, `PreToolUse` (deny/rewrite only), `PermissionRequest`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop` | `PreToolUse ask` degrades to `PermissionRequest` | `permissionDecision: ask` unsupported; adapter routes to `PermissionRequest` and records `permission_mode: degraded` in normalized `GuildHookEvent` (audit §"P0: Hook permission semantics differ"). |
| (4) Dispatch | Codex subagents + `codex exec` for tmux lanes | — | `DispatchAdapter` wraps `codex exec '<prompt>'` per lane. Receipt collection via `.guild/runs/<run-id>/handoffs/` unchanged. |
| (5) Permissions | `PermissionRequest` event for ask; `PreToolUse` deny for hard deny | No in-line `PreToolUse ask` | `ScopePolicy.resolve()` runs identically; `PermissionEmitter` maps `ask` → `PermissionRequest`; if `PermissionRequest` unavailable → file-bus `approval_request` + pause (FDC-11). |
| (6) Model tiers | `{ model: "default", reasoning: low/medium/high }` | — | `ModelResolver` maps Guild tiers; no Claude model names used (audit §"P0: Model tiers are Claude-specific"). |
| (7) MCP | stdio (**streamable HTTP is NOT supported** — corrected 2026-07-30 to match the authoritative capability row `mcp.http: false` in host-capabilities-schema.ts); plugin-bundled MCP manifest block | — | `McpAdapter` emits MCP entries in `.codex-plugin/plugin.json`. **CORRECTED 2026-07-30 (#114): `CLAUDE_PLUGIN_ROOT` compat is NOT OK for MCP args** — Codex expands that placeholder for hooks but never for MCP server args (measured, codex 0.146.0). The resolvable form is plugin-relative args + `cwd: "."`, which additionally requires `--no-cwd-fallback` so the server does not take the plugin payload root as its data root. |
| (8) Team visibility | Rung 1 (tmux + `codex exec` panes) → Rung 2 (Codex subagents) → Rung 4 (serial) | No `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` env | Team env gate stays inside `ClaudePaneAdapter` only; Codex pane adapter does not set it (audit §"Current local defects" / D-4). |

## Per-feature degradation matrix

| FDC | Full behavior | This host | Degradation contract |
|---|---|---|---|
| FDC-1 Memory | MCP stdio `guild-memory` | stdio MCP available (HTTP is NOT — see row (7)) | **PARTIAL, corrected 2026-07-30 (#114).** A git-ref install now bundles a working declaration (relative args + `cwd: "."` + `--no-cwd-fallback`), so `guild-memory` runs — but the caller MUST pass `cwd` per tool call, because Codex gives the child no workspace signal (scrubbed env, cwd = plugin root) and the server fails closed rather than serving Guild's own bundled wiki. The runtime adapter still reports `memory` as `degraded` with a filesystem-BM25 primary (`host-adapters/codex-cli.ts`); that row stands until the adapter is rewired to prefer the now-working MCP path. The rendered (local-marketplace) package still declares no MCP servers — tracked in #115. |
| FDC-2 Knowledge-graph + recall | `guild-memory` MCP or fs scan | MCP available | No degradation expected; fallback to fs/BM25 if server fails. |
| FDC-3 Context assembly | Context bundle always written | Full | Bundle written identically; `degraded_retrieval` only if FDC-1/2 degrade. |
| FDC-4 Agent communication | File bus canonical | Full | File bus via `codex exec` pane writes; `SendMessage` not used (FDC-4 contract). |
| FDC-5 Agent coordination | DAG + receipt collection | Full (Rung 1 or subagent Rung 2) | `backend_rung` recorded; receipts identical. |
| FDC-6 All lifecycle phases | All 6 phases on every host | Full | Commands rendered as Codex plugin entries; ask-path via `PermissionRequest` or file-bus pause. |
| FDC-7 Quality gates | Cross-family review | Partial | Codex is typically the reviewer for Claude-authored artifacts; when Codex is the author, Claude review needed. Cross-provider chain applies. |
| FDC-8 Operations | R/O + W + destructive | Full for R/O; W/D via `PermissionRequest` or file-bus pause | Read-only ops run everywhere; writes require approval path. |
| FDC-9 Settings | `.guild/settings.json` authority | Full | Codex plugin config is renderer only. |
| FDC-10 Visuals / UI | Host-native | Codex CLI text / startup card | No degradation; visual renderer is Codex-specific. |
| FDC-11 Security / permissions | Policy core + ask path | `PermissionRequest` replaces `PreToolUse ask` | `ScopePolicy` runs identically; emitter degraded for ask path. `permission_mode: degraded` recorded. |
| FDC-12 Cost + subscription | Native billing path | `cost_path: native_process` (codex exec is native) | No degradation; `codex exec` is Codex's native lane path. |
| FDC-13 MCP | stdio / HTTP | Full | MCP bundled; both transports supported. |
| FDC-14 Host-native subagents | Parallel agents | Codex native subagents (Rung 2) | Subagent dispatch available; no tmux required for parallelism. |
| FDC-15 Work isolation | Worktrees | Via shell/Git | All CLI hosts drive Git; approval policy needed for branch ops. |
| FDC-16 Telemetry + replay | Normalized `guild.trace_event.v1` | Requires `GuildHookEvent` normalization layer | Codex has `turn_id`, `PermissionRequest`, `apply_patch` field names. `HookPayload` normalization (LEAKS H-1) must be applied. `source: host_hook`, `fidelity: full` when hooks present. |

## Packaging format

**Manifest path:** `.codex-plugin/plugin.json`

The Codex manifest renderer emits this file from the same Guild inventory (`skills/`, `agents/`, `commands/`, `hooks/`, `mcp-servers/`) that drives all other host renderers (Surface 1 of `decisions/host-adapter-contract.md`). Codex plugin build docs define fields for `skills`, `mcpServers`, `apps`, and `hooks`; hook paths resolve relative to plugin root; `PLUGIN_ROOT` and `PLUGIN_DATA` are the native env vars, with `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` set by Codex for compat (source: audit §"Source-backed platform facts / Codex CLI and Codex app").

Hook trust flow: Codex plugin-bundled hooks must be reviewed and trusted before they run. The adapter page for the Codex app surface (`codex-app-adapter.md`) covers the app-side trust/setup flow.

Verification: `codex plugin list` or equivalent current plugin check.

## Unresolved questions

1. **`PermissionRequest` full contract.** The audit confirms `permissionDecision: ask` fails on `PreToolUse`, but the exact `PermissionRequest` event shape (fields, response schema, timing relative to tool execution) needs live verification against current Codex docs before the `PermissionEmitter` is coded (audit §"P0: Hook permission semantics differ").
2. **Codex login-aware auth preflight.** The existing `CodexPaneAdapter` (`pane-adapter.ts:128-147`) checks `OPENAI_API_KEY` only. The adapter must also accept `codex login`/`codex status`/`codex doctor` evidence for users authenticated through the ChatGPT/Codex app path (LEAKS D-6 in the reference-impl audit).
3. **`SubagentStart` event availability.** Codex hook docs list `SubagentStart` as a lifecycle event but the current `hooks.json` does not wire it. Whether Guild needs it for liveness tracking (vs polling the file bus) needs a decision.
4. **Codex subagent sandbox inheritance.** Codex docs state subagents inherit the current sandbox policy. Implications for Guild's capability-scope enforcement (e.g. a subagent in a restricted lane inheriting a less-restricted parent sandbox) need explicit verification.
5. **`apply_patch` tool name mapping.** Codex file edits use `apply_patch` rather than `Write`/`Edit`. The `GuildHookEvent` normalization layer must map Codex tool names so telemetry and permission gates match correctly across hosts.
