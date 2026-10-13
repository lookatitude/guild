---
name: config
description: "Project config surface — resolve, render, validate and edit .guild/ policy config, pin per-run roles, detect providers, re-pin MCP hashes, and reconcile against the typed schema. Sub-verbs `models` (READ-ONLY session-binding evidence) and `migrate` (v1->v2 layout inspect / dry-run / retry) route to their own CLIs, not to config-cmd."
argument-hint: "<init|set|role|show|validate|providers|ui|update-mcp-hashes|reconcile> [options] | models inspect [--run-id <id>] [--json] [--cwd <path>] | migrate [--root=<path>] [--mode=migrate|dry-run|skip] [--workspace] [--accept-grades]"
allowed-tools: Read, Write, Bash
---

# /guild:config — policy config

Durable config is policy only: it never stores a host family or a concrete model id
(KTD22). Route on the FIRST token; `$REMAINING_ARGS` is every token after it, consumed
exactly once. `config-cmd.js` has no `init` and rejects `models` / `migrate`.

```bash
# set|role|show|validate|providers|ui|update-mcp-hashes|reconcile — forwarded verbatim
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/config-cmd.js" $ARGUMENTS --cwd "$(pwd)"
# init — the CLI spells it `reconcile sync` (never-clobber); translate, do not forward
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/config-cmd.js" reconcile sync --cwd "$(pwd)" $REMAINING_ARGS
# models — $REMAINING_ARGS ALREADY starts with the CLI's sub-verb; never insert another. The CLI defaults --cwd to $PWD, so a user --cwd is never overridden.
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/models-cmd.js" $REMAINING_ARGS
# migrate — v1->v2 layout inspect / dry-run / retry (dry-run is the default)
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/migrate-guild.js" --root="$(pwd)" $REMAINING_ARGS
```

| Sub-verb | Grammar |
|---|---|
| `models` | READ-ONLY routing evidence — `models inspect [--run-id <id>] [--json] [--cwd <path>]` |
| `migrate` | `migrate [--root=<path>] [--mode=migrate|dry-run|skip] [--workspace] [--accept-grades]` |

A danger key needs `--confirm`; `show --sources` annotates inheritance and
`show --render` fails closed on a secret leak. No sub-verb prints the accepted list.

## Dispatch

```
Skill: guild:using-guild
args: $ARGUMENTS
```

The CLIs above own every write; the assembler explains which knob applies here.
