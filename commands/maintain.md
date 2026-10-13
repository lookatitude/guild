---
name: maintain
description: "Self-heal + RSI — sub-verbs evolve | rollback | audit | fix | gc | wiki revert. ONE assembler: every sub-verb dispatches guild:evolve, which routes the token to its own chapter (`guild:evolve §Sub-verbs`). One gate, two homes: project targets write this repo's .guild/, machinery targets write a candidate a human commits."
argument-hint: "<evolve <id> [--target=<type>] [--auto] | rollback <skill> [n] | audit | fix [run-id|symptom] | gc | wiki revert>"
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
| `evolve <id> [--target=<type>] [--auto]` | `references/evolve-targets.md` — target enum + the two homes |
| `rollback <skill> [n]` | `references/rollback-skill.md` — restore the inverse span |
| `audit` | `references/audit.md` — static script + boundary audit |
| `fix [run-id\|symptom]` | `../diagnose/references/systematic-debug.md` |
| `wiki revert` | `references/wiki-revert.md` — the harvest-journal inverse |
| `gc` | durable-state sweep + scratch janitor (storage domain, U-STOR) |

## Dispatch

```
Skill: guild:evolve
args: $ARGUMENTS
```

`--target=<type>` names one of the eleven evolve targets; omitted, the assembler infers
it. `--auto` runs unattended and is the cheap curator only: it carries `playbook` and
`skill`, and fails closed with `next_need: operator` on everything else. Machinery
targets never write the install tree — they write a candidate a human commits.
