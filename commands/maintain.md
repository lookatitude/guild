---
name: maintain
description: "Self-heal + RSI — sub-verbs evolve | rollback | audit | fix | gc | wiki revert. ONE assembler: every sub-verb dispatches guild:evolve, which routes the token to its own chapter (`guild:evolve §Sub-verbs`). Nothing auto-promotes: the promotion gate is always respected."
argument-hint: "<evolve <id> [--auto] | rollback <skill> [n] | audit | fix [run-id|symptom] | gc | wiki revert>"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:maintain — self-maintenance

One entry, one assembler. `$ARGUMENTS` is forwarded VERBATIM — the sub-verb token is
the assembler's to read, never re-inserted here. An unknown sub-verb prints usage.

## Run recording

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" start --command=/guild:maintain --cwd "$(pwd)"
```

## Sub-verbs (routed by `guild:evolve §Sub-verbs`)

| Token | Chapter the assembler loads |
|---|---|
| `evolve <id> [--auto]` | the evolve pipeline in the assembler body |
| `rollback <skill> [n]` | `references/rollback-skill.md` — non-destructive revert |
| `audit` | `references/audit.md` — static script + boundary audit |
| `fix [run-id\|symptom]` | `../diagnose/references/systematic-debug.md` |
| `wiki revert` | `../../knowledge/wiki/references/wiki-ingest.md` |
| `gc` | durable-state sweep + scratch janitor (storage domain, U-STOR) |

## Dispatch

```
Skill: guild:evolve
args: $ARGUMENTS
```

`--auto` runs unattended; the promotion gate still decides, and a rejected attempt
is archived, not deleted. Pipelines, reports and every `.guild/` write live in the
assembler and the chapter it routes to.
