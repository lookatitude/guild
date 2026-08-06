# Generated Host Support Matrix

Generated: 2026-08-06T03:29:10.399Z

This file is generated from host-adapter outputs and review-progress schema validation. Do not hand-edit support cells.

**Support** is the human-facing roster label: `Supported` (a committed verified receipt), `Supported (beta)` (an honest installable target — full adapter chain, operator-box receipt pending), `Supported (app)` (a verified-bridged app surface — e.g. a Claude Desktop thread-worktree packet over the file bus), `Supported (connector)` (a verified-bridged connector surface — e.g. the Claude.ai connector), or `Unsupported` (a refuse app/connector surface). It is a PRESENTATION derivation only, decoupled from the honesty column and never an input to the gate.
**Public State** is the evidence-derived honesty column (native / verified_wrapped / verified_bridged / unsupported) — verified_* ONLY when a valid receipt exists.
**Target** is aspirational; **Verification** + **Floor** are DOCS-internal diagnostics (never a public claim).

| Host | Support | Surface | Installability | Public State | Target | Verification | Floor | Final State |
|---|---|---|---|---|---|---|---|---|
| claude-code-cli | Supported | cli | native | native | native | verified | native | degraded |
| codex-cli | Supported | cli | target | verified_wrapped | verified_wrapped | verified | verified_wrapped | degraded |
| pi-cli | Supported | cli | target | verified_wrapped | verified_wrapped | verified | verified_wrapped | degraded |
| antigravity-cli | Supported | cli | target | verified_wrapped | verified_wrapped | verified | verified_wrapped | degraded |
| agents-file | Supported (beta) | file | target | unsupported | verified_bridged | target | — | degraded |
| claude-code-app | Supported (app) | app | none | unsupported | unsupported | manual_instruction | — | manual_instruction |
| claude-code-web | Supported (app) | app | none | unsupported | unsupported | enqueue_only | — | enqueue_only |
| codex-app | Supported (app) | app | none | unsupported | unsupported | enqueue_only | — | enqueue_only |
| claude-ai-connector | Supported (connector) | app | none | unsupported | unsupported | enqueue_only | — | enqueue_only |
| cursor | Supported (beta) | cli | target | unsupported | verified_wrapped | target | — | degraded |
| github-copilot | Supported (beta) | cli | target | unsupported | verified_wrapped | target | — | degraded |
| opencode | Supported (beta) | cli | target | unsupported | verified_wrapped | target | — | degraded |
| rovo-dev | Supported (beta) | cli | target | unsupported | verified_wrapped | target | — | degraded |
| kiro | Supported (beta) | file | target | unsupported | verified_bridged | target | — | degraded |
| qoder | Supported (beta) | file | target | unsupported | verified_bridged | target | — | degraded |
| trae | Supported (beta) | file | target | unsupported | verified_bridged | target | — | degraded |

## Coverage Operations

### claude-code-cli

- capability: verified - registry and adapter capability row resolved
- command_surface: verified - Claude Code exposes Guild commands as native markdown slash-command files
- permission_decision: verified - Claude Code supports deny/ask/allow through PreToolUse and permission-mode launch flags
- preflight: verified - Claude Code hook preflight is registry-verified and includes using-guild SessionStart injection
- model_params: degraded - Claude CLI maps model/effort, but cannot enforce unsupported model param key(s): reasoning, thinking, verbosity
- memory: verified - Claude memory registry enables native stdio MCP first and records filesystem/BM25 fallback degradation
- dispatch: verified - Claude dispatch uses the existing Claude pane/reference command builder
- hook_normalization: verified - host has native hook capability in the registry row
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: verified - Claude Code has the verified native .claude-plugin package shape

### codex-cli

- capability: verified - registry and adapter capability row resolved
- command_surface: degraded - Codex plugin renders command descriptors but has no Claude-style slash markdown files
- permission_decision: verified - Codex permission mode maps through CLI approval/sandbox flags where available
- preflight: degraded - Codex fires SessionStart + UserPromptSubmit + PreToolUse natively via codex-hooks.json; the remaining Claude hook events degrade to wrapper/instruction-file
- model_params: degraded - Codex CLI maps model plus effort/reasoning, but cannot enforce unsupported model param key(s): thinking, verbosity
- memory: degraded - Codex CLI uses filesystem/BM25 Guild memory until native MCP memory is available
- dispatch: verified - Codex CLI dispatch uses codex exec with wrapper bootstrap when needed
- hook_normalization: verified - host has native hook capability in the registry row
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - Codex package target renders .codex-plugin plus .agents skill tree; live install is target-level

### pi-cli

- capability: verified - registry and adapter capability row resolved
- command_surface: verified - Pi package renders Guild commands as extension command descriptors and AGENTS.md bootstrap instructions
- permission_decision: degraded - Pi has no Guild permission hook; decisions render to pi tool allow/deny launch flags and recorded policy receipts
- preflight: degraded - Pi has no native Guild hooks/MCP; preflight uses the CLI binary probe plus file-bus fallback receipts
- model_params: degraded - Pi maps model/provider/effort, but cannot enforce unsupported model param key(s): reasoning, verbosity
- memory: degraded - Pi memory uses the package bridge when present and filesystem/BM25 fallback through the active .guild root
- dispatch: verified - Pi dispatch uses pi -p through tmux/plain-process substrate and file-bus coordination
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - Pi package target renders pi-manifest.json plus Guild skill tree and is installed through pi install ./dist/pi

### antigravity-cli

- capability: verified - registry and adapter capability row resolved
- command_surface: verified - Antigravity package renders Guild commands as plugin command descriptors and AGENTS.md bootstrap instructions
- permission_decision: degraded - Antigravity has no per-tool Guild permission hook; sandbox/bypass are coarse launch modes recorded as degraded policy receipts
- preflight: degraded - Antigravity CLI has no native Guild hooks/MCP; preflight uses agy plus file-bus fallback receipts
- model_params: degraded - Antigravity maps model, but cannot enforce unsupported model param key(s): effort, reasoning, thinking, verbosity
- memory: degraded - Antigravity memory uses the package bridge when present and filesystem/BM25 fallback through the active .guild root
- dispatch: verified - Antigravity dispatch uses agy -p through tmux/plain-process substrate and file-bus coordination
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - Antigravity package target renders plugin.json, antigravity-manifest.json, and the Guild skill tree

### agents-file

- capability: verified - registry and adapter capability row resolved
- command_surface: degraded - agents-file exposes instructions and skills, not native command descriptors
- permission_decision: unavailable - agents-file has no permission API; consuming host policy owns approval
- preflight: degraded - agents-file has no host runtime hooks; the consuming host performs execution
- model_params: degraded - agents-file records desired model params but cannot enforce host-native model flags
- memory: degraded - agents-file uses shared .guild memory through the consuming host
- dispatch: degraded - agents-file is an instruction package target, not a process launcher
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - agents-file renders AGENTS.md plus .agents/skills/guild for any AGENTS-consuming host

### claude-code-app

- capability: verified - registry and adapter capability row resolved
- command_surface: manual_instruction - app/connector host has no CLI slash-command package; commands render as instructions or MCP/connector actions
- permission_decision: manual_instruction - app/connector approvals are host-native or manual; Guild records the requested policy and waits for operator/app approval
- preflight: manual_instruction - app/connector host has no local Guild hook; preflight records no-local-hook and connector auth/egress requirements
- model_params: manual_instruction - app/connector model params are recorded for the host/app to apply; unsupported keys are explicit
- memory: unavailable - local app host memory requires a local filesystem companion, MCP bridge, or file-bus import; none was advertised
- dispatch: manual_instruction - app/connector dispatch is not a local CLI process; it enqueues or emits manual instructions
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: unavailable - app/connector hosts are not CLI package targets; installer must refuse and print connector guidance

### claude-code-web

- capability: verified - registry and adapter capability row resolved
- command_surface: manual_instruction - app/connector host has no CLI slash-command package; commands render as instructions or MCP/connector actions
- permission_decision: manual_instruction - app/connector approvals are host-native or manual; Guild records the requested policy and waits for operator/app approval
- preflight: manual_instruction - app/connector host has no local Guild hook; preflight records no-local-hook and connector auth/egress requirements
- model_params: manual_instruction - app/connector model params are recorded for the host/app to apply; unsupported keys are explicit
- memory: unavailable - web/connector target has no local filesystem memory path; caller must provide a connector memory bridge or fail visibly
- dispatch: enqueue_only - app/connector dispatch is not a local CLI process; it enqueues or emits manual instructions
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: unavailable - app/connector hosts are not CLI package targets; installer must refuse and print connector guidance

### codex-app

- capability: verified - registry and adapter capability row resolved
- command_surface: manual_instruction - app/connector host has no CLI slash-command package; commands render as instructions or MCP/connector actions
- permission_decision: manual_instruction - app/connector approvals are host-native or manual; Guild records the requested policy and waits for operator/app approval
- preflight: enqueue_only - app/connector host has no local Guild hook; preflight records no-local-hook and connector auth/egress requirements
- model_params: manual_instruction - app/connector model params are recorded for the host/app to apply; unsupported keys are explicit
- memory: unavailable - local app host memory requires a local filesystem companion, MCP bridge, or file-bus import; none was advertised
- dispatch: enqueue_only - app/connector dispatch is not a local CLI process; it enqueues or emits manual instructions
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: unavailable - app/connector hosts are not CLI package targets; installer must refuse and print connector guidance

### claude-ai-connector

- capability: verified - registry and adapter capability row resolved
- command_surface: manual_instruction - app/connector host has no CLI slash-command package; commands render as instructions or MCP/connector actions
- permission_decision: manual_instruction - app/connector approvals are host-native or manual; Guild records the requested policy and waits for operator/app approval
- preflight: enqueue_only - app/connector host has no local Guild hook; preflight records no-local-hook and connector auth/egress requirements
- model_params: manual_instruction - app/connector model params are recorded for the host/app to apply; unsupported keys are explicit
- memory: unavailable - web/connector target has no local filesystem memory path; caller must provide a connector memory bridge or fail visibly
- dispatch: enqueue_only - app/connector dispatch is not a local CLI process; it enqueues or emits manual instructions
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: unavailable - app/connector hosts are not CLI package targets; installer must refuse and print connector guidance

### cursor

- capability: verified - registry and adapter capability row resolved
- command_surface: degraded - Cursor has no native slash-command surface; Guild commands are invoked via cursor-agent and documented in AGENTS.md
- permission_decision: degraded - Cursor has no per-tool Guild permission hook; approval maps to coarse launch flags recorded as degraded policy receipts
- preflight: degraded - Cursor has no native Guild hooks; preflight is guild-run/instruction-file based and records the loss
- model_params: degraded - Cursor maps model, but cannot enforce unsupported model param key(s): effort, reasoning, thinking, verbosity
- memory: degraded - Cursor uses filesystem/BM25 Guild memory through the active .guild root until native MCP memory is available
- dispatch: verified - Cursor dispatch runs cursor-agent through a plain process with wrapper bootstrap when needed
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - Cursor package target renders the instruction file + .agents skill tree + guild-run launcher; live install is target-level

### github-copilot

- capability: verified - registry and adapter capability row resolved
- command_surface: degraded - GitHub Copilot has no native slash-command surface; Guild commands are invoked via gh copilot and documented in AGENTS.md
- permission_decision: degraded - GitHub Copilot has no per-tool Guild permission hook; approval maps to coarse launch flags recorded as degraded policy receipts
- preflight: degraded - GitHub Copilot has no native Guild hooks; preflight is guild-run/instruction-file based and records the loss
- model_params: degraded - GitHub Copilot maps model, but cannot enforce unsupported model param key(s): effort, reasoning, thinking, verbosity
- memory: degraded - GitHub Copilot uses filesystem/BM25 Guild memory through the active .guild root until native MCP memory is available
- dispatch: verified - GitHub Copilot dispatch runs gh copilot through a plain process with wrapper bootstrap when needed
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - GitHub Copilot package target renders the instruction file + .agents skill tree + guild-run launcher; live install is target-level

### opencode

- capability: verified - registry and adapter capability row resolved
- command_surface: degraded - opencode has no native slash-command surface; Guild commands are invoked via opencode and documented in AGENTS.md
- permission_decision: degraded - opencode has no per-tool Guild permission hook; approval maps to coarse launch flags recorded as degraded policy receipts
- preflight: degraded - opencode has no native Guild hooks; preflight is guild-run/instruction-file based and records the loss
- model_params: degraded - opencode maps model, but cannot enforce unsupported model param key(s): effort, reasoning, thinking, verbosity
- memory: degraded - opencode uses filesystem/BM25 Guild memory through the active .guild root until native MCP memory is available
- dispatch: verified - opencode dispatch runs opencode through a plain process with wrapper bootstrap when needed
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - opencode package target renders the instruction file + .agents skill tree + guild-run launcher; live install is target-level

### rovo-dev

- capability: verified - registry and adapter capability row resolved
- command_surface: degraded - Rovo Dev has no native slash-command surface; Guild commands are invoked via acli rovodev and documented in AGENTS.md
- permission_decision: degraded - Rovo Dev has no per-tool Guild permission hook; approval maps to coarse launch flags recorded as degraded policy receipts
- preflight: degraded - Rovo Dev has no native Guild hooks; preflight is guild-run/instruction-file based and records the loss
- model_params: degraded - Rovo Dev maps model, but cannot enforce unsupported model param key(s): effort, reasoning, thinking, verbosity
- memory: degraded - Rovo Dev uses filesystem/BM25 Guild memory through the active .guild root until native MCP memory is available
- dispatch: verified - Rovo Dev dispatch runs acli rovodev through a plain process with wrapper bootstrap when needed
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - Rovo Dev package target renders the instruction file + .agents skill tree + guild-run launcher; live install is target-level

### kiro

- capability: verified - registry and adapter capability row resolved
- command_surface: degraded - agents-file exposes instructions and skills, not native command descriptors
- permission_decision: unavailable - agents-file has no permission API; consuming host policy owns approval
- preflight: degraded - agents-file has no host runtime hooks; the consuming host performs execution
- model_params: degraded - agents-file records desired model params but cannot enforce host-native model flags
- memory: degraded - agents-file uses shared .guild memory through the consuming host
- dispatch: degraded - agents-file is an instruction package target, not a process launcher
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - agents-file renders AGENTS.md plus .agents/skills/guild for any AGENTS-consuming host

### qoder

- capability: verified - registry and adapter capability row resolved
- command_surface: degraded - agents-file exposes instructions and skills, not native command descriptors
- permission_decision: unavailable - agents-file has no permission API; consuming host policy owns approval
- preflight: degraded - agents-file has no host runtime hooks; the consuming host performs execution
- model_params: degraded - agents-file records desired model params but cannot enforce host-native model flags
- memory: degraded - agents-file uses shared .guild memory through the consuming host
- dispatch: degraded - agents-file is an instruction package target, not a process launcher
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - agents-file renders AGENTS.md plus .agents/skills/guild for any AGENTS-consuming host

### trae

- capability: verified - registry and adapter capability row resolved
- command_surface: degraded - agents-file exposes instructions and skills, not native command descriptors
- permission_decision: unavailable - agents-file has no permission API; consuming host policy owns approval
- preflight: degraded - agents-file has no host runtime hooks; the consuming host performs execution
- model_params: degraded - agents-file records desired model params but cannot enforce host-native model flags
- memory: degraded - agents-file uses shared .guild memory through the consuming host
- dispatch: degraded - agents-file is an instruction package target, not a process launcher
- hook_normalization: degraded - host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts
- review_progress: verified - all 10 canonical review_progress.v1 states validate
- install_or_app_refusal: degraded - agents-file renders AGENTS.md plus .agents/skills/guild for any AGENTS-consuming host

