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

# Gemini CLI adapter

Gemini CLI is a local terminal agent that packages reusable workflows as **extensions**: installable/shareable bundles declared in `gemini-extension.json` that can include MCP server entries, TOML custom commands, and a `GEMINI.md` context file (source: audit §"Source-backed platform facts / Gemini CLI"). Extensions support `gemini extensions install`, `uninstall`, `enable`, `disable`, `update`, and `link`; changes generally require a CLI restart. Guild's adapter must render a `gemini-extension.json` manifest, one TOML file per Guild command at `commands/<group>/<name>.toml`, a generated `GEMINI.md` host-intro, and MCP entries for `guild-memory` and `guild-telemetry`. The Gemini CLI hook API for event interception exists but its exact `PreToolUse`-equivalent behavior requires live verification — the audit marks it "partial/adapter" for hooks (audit §"CLI plugin/package matrix"). Subagent/independent-agent support in Gemini CLI is also unverified; the audit treats it as "uncertain" until tested against a live install.

## Target host capabilities

```yaml
schema_version: guild.host_capabilities.v1
host_id: "gemini-cli"
family: "gemini"
surface: "gemini-cli"
surface_kind: "cli-package"

packaging:
  format: "gemini-extension"
  installable: true
  manifest_path: "gemini-extension.json"

commands:
  slash_commands: false       # Gemini uses TOML custom commands, not slash-command Markdown
  toml_commands: true         # commands/<group>/<name>.toml
  mcp_tool_commands: false
  command_path_pattern: "commands/<group>/<name>.toml"

hooks:
  session_start: true         # TBD — verify Gemini CLI extension hook API
  pre_tool_use: true          # partial; audit marks as "Partial/Adapter"
  post_tool_use: true         # TBD
  permission_request: false   # Codex-only event
  ask_from_pre_tool_use: false  # not verified; assume unsupported until confirmed
  subagent_stop: false        # TBD
  stop: true                  # TBD

dispatch:
  in_process_agent: false
  subagent_dispatch: false    # TBD — audit marks subagent support "uncertain"
  independent_agents: false
  serial_only: true           # conservative default until subagent support verified

permissions:
  ask_ui: "file_bus_pause"    # no verified ask UI; degrade to file-bus pause
  deny_at_pre_tool_use: true  # hook can deny if hook API supports it
  bypass_permissions_mode: false  # not applicable; TBD

model_tiers:
  cheap: { model: "default", thinking: "low" }
  mid: { model: "default", thinking: "medium" }
  powerful: { model: "default", thinking: "high" }

mcp:
  stdio: true                 # through extension MCP entries
  http: false                 # TBD
  plugin_bundled: true        # gemini-extension.json MCP server entries
  core_provides_mcp: true

team_visibility:
  has_tmux: true              # tmux available for visible lane processes
  has_independent_agents: false  # not verified
  has_subagent_dispatch: false   # not verified
  can_lead_team: true         # via tmux if tmux available
  can_join_team: true
  app_threads: false
  app_projects: false
  scheduled_tasks: false

filesystem: "local"

cost_path:
  prefer_native_subscription_path: true
  allow_external_cli_spawn: true  # gemini CLI process is native path
  trace_external_cli: false

detected_at: "runtime"
advertised_at: "session-start"
ttl_seconds: 3600
```

## Contract surfaces — implements vs degrades

| Surface | Implements | Degrades | Notes |
|---|---|---|---|
| (1) Packaging | `gemini-extension.json` + `commands/*.toml` + `GEMINI.md` renderer | — | `${extensionPath}` substitution used in place of `${CLAUDE_PLUGIN_ROOT}` (audit §"Proposed cross-platform architecture / 6. Gemini CLI adapter"). Extension changes require a CLI restart. |
| (2) Commands | TOML files at `commands/<group>/<name>.toml` rendered from `GuildCommand` registry | No Claude Markdown; no Codex plugin JSON | Gemini custom commands use prompt-template TOML format. `GEMINI.md` carries host-intro and lifecycle contract summary. |
| (3) Hooks | Extension hook API (extent unverified) | Full hook set degrades to partial; ask degrades to file-bus pause | Audit marks Gemini hooks as "partial/adapter." `GuildHookEvent` normalization layer must map Gemini-native event fields. If hooks absent, events synthesized from file bus (`source: file_bus_synthesis`, `fidelity: reduced`). |
| (4) Dispatch | External lane process via tmux (Rung 1) or serial (Rung 4) | No subagent dispatch (unverified) | Dispatch is `gemini ... '<prompt>'` in a tmux pane; fallback to serial if tmux absent. Subagent dispatch added only after live capability verification. |
| (5) Permissions | Hook-based deny if hook API permits; file-bus pause for ask | No verified ask UI | `ScopePolicy.resolve()` runs identically; `PermissionEmitter` writes `approval_request` + pauses when ask required (FDC-11). |
| (6) Model tiers | `{ model: "default", thinking: low/medium/high }` | — | `ModelResolver` maps Guild tiers to Gemini thinking levels (audit §"P0: Model tiers are Claude-specific" registry). |
| (7) MCP | stdio via `gemini-extension.json` MCP entries; `${extensionPath}` path substitution | — | `McpAdapter` emits MCP server entries in extension manifest. Remote HTTP MCP TBD. |
| (8) Team visibility | Rung 1 (tmux + `gemini` panes) → Rung 4 (serial) | No host-native parallelism verified | `TmuxTeamBackend` works if Gemini CLI supports non-interactive `gemini ... '<prompt>'` invocation; serial fallback if not. |

## Per-feature degradation matrix

| FDC | Full behavior | This host | Degradation contract |
|---|---|---|---|
| FDC-1 Memory | MCP stdio `guild-memory` | stdio via extension MCP entries | No degradation if extension MCP works; fs/BM25 fallback if not. |
| FDC-2 Knowledge-graph + recall | `guild-memory` or fs scan | MCP or fallback | Index re-scan if MCP unavailable. |
| FDC-3 Context assembly | Context bundle always written | Full | Bundle written identically; `degraded_retrieval` if FDC-1/2 degrade. |
| FDC-4 Agent communication | File bus canonical | Full (file bus, tmux panes write files) | `agent_bus.transport: file_bus_native` or `file_bus_polled`; no Gemini-native notification hook assumed. |
| FDC-5 Agent coordination | DAG + receipt collection | Rung 1 (tmux) or Rung 4 (serial) | `backend_rung` recorded; receipts identical. If serial, `coordination.degraded: true`. |
| FDC-6 All lifecycle phases | All 6 phases | Full via TOML commands + file-bus pause for gates | `phase.command_rendered_as: gemini_toml`; `ask_path: file_bus_pause` when interactive ask unavailable. |
| FDC-7 Quality gates | Cross-family review | Cross-provider to Codex or Claude | Gemini-authored artifacts reviewed by Claude/Codex when configured. |
| FDC-8 Operations | R/O + W + destructive | R/O always; W/D via file-bus pause | Writes blocked pending approval_request when no interactive ask. |
| FDC-9 Settings | `.guild/settings.json` | Full | Gemini extension commands render config; source of truth is `.guild/settings.json`. |
| FDC-10 Visuals / UI | Host-native | `GEMINI.md` context; TOML command help | `GEMINI.md` carries status/startup info. No interactive dashboard. |
| FDC-11 Security / permissions | Policy core + ask path | `file_bus_pause` for ask (unverified hook ask) | `ScopePolicy` runs; emitter defaults to file-bus pause. `approval_request.ask_renderer: file_bus_pause`. |
| FDC-12 Cost + subscription | Native billing | `cost_path: native_process` | Gemini CLI process is native path; no degradation. |
| FDC-13 MCP | stdio | stdio via extension | MCP entries in `gemini-extension.json`; remote HTTP TBD. |
| FDC-14 Host-native subagents | Parallel agents | Not verified; serial fallback | `coordination.parallelism: serial` until Gemini subagent support confirmed. |
| FDC-15 Work isolation | Worktrees | Via shell/Git | Git worktrees available on any CLI host. |
| FDC-16 Telemetry + replay | Normalized trace | Normalization required | Gemini event field names differ from Claude/Codex. `GuildHookEvent` normalization mandatory. If hooks absent: `source: file_bus_synthesis`, `fidelity: reduced`. |

## Packaging format

**Manifest path:** `gemini-extension.json`

The Gemini extension renderer emits three outputs from the Guild inventory:

1. `gemini-extension.json` — the extension manifest, with MCP server entries using `${extensionPath}` substitution.
2. `commands/<group>/<name>.toml` — one TOML prompt-template file per Guild command, rendered from the `GuildCommand` registry.
3. `GEMINI.md` — a generated context file (referenced by `contextFileName` in the manifest) carrying the Guild host-intro, lifecycle contract summaries, and skill/command index.

Extension installation: `gemini extensions install <path>` or `gemini extensions link <path>` for local development. Extension changes require a CLI restart (source: audit §"Source-backed platform facts / Gemini CLI").

Surface 1 of `decisions/host-adapter-contract.md` governs the renderer; `${extensionPath}` maps to the same role as `${CLAUDE_PLUGIN_ROOT}` for Claude/Codex.

## Unresolved questions

1. **Gemini CLI hook API capability.** The audit marks Gemini hooks as "partial/adapter." The exact hook events supported, whether `PreToolUse` denial is possible, and whether lifecycle events like `SessionStart`/`Stop` fire reliably need live verification against current Gemini CLI (audit §"CLI plugin/package matrix / Hooks/event interception").
2. **Gemini CLI subagent/independent-agent support.** The audit marks specialist/subagent dispatch as "adapter/uncertain." Whether Gemini CLI currently has a subagent primitive that Guild can invoke without tmux needs confirmation before the dispatch ladder can be finalized for this host.
3. **Non-interactive invocation path.** The tmux team backend requires a non-interactive `gemini ... '<prompt>'`-style invocation analogous to `codex exec`. The exact CLI flag/mode for this in Gemini CLI is unverified and is a prerequisite for Rung 1 team support.
4. **`${extensionPath}` in MCP server process args.** Whether Gemini CLI substitutes `${extensionPath}` in MCP server command-line args (not just config fields) the same way Codex substitutes `PLUGIN_ROOT` needs live testing before the MCP manifest renderer is finalized.
5. **Extension restart requirement impact on hooks.** If hook configuration changes require a CLI restart, the bootstrap sequence for writing the `host_capabilities.v1` advertisement at session-start may need a different trigger path than Claude/Codex `SessionStart` hooks.
