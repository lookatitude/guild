---
name: ops
description: "Operations — five runbook classes (release / monitoring / incident / rollback / maintenance) selected by the positional [runbook] or surfaced detection, each behind a mandatory pre-flight dry-run. Dispatches to guild:operations."
argument-hint: "[runbook]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:ops — Operations phase

Four safety rails the assembler never drops: incident and rollback are never
autonomous, the first run is always interactive, always-ask is unconditional, and
the pre-flight dry-run is mandatory.

## Run recording

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" start --command=/guild:ops --phase=ops --cwd "$(pwd)"
# append --initiative=<id> ONLY when the user supplied one (NN#5); never auto-detect
```

## Dispatch

```
Skill: guild:operations
args: $ARGUMENTS
```

Risky or destructive steps prompt **I always**. Runbooks, evidence and
`.guild/` writes live in the assembler and its L3 runbook chapters.

## Team decision gate (blocking)

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/team-decide.js" gate --proposal <proposal> --cwd "$(pwd)"
```

Verbs: approve · restructure · add · remove · substitute · edit_dependencies.
STOP on a non-zero exit — exit 3 BLOCKS (no persisted decision, a restructure rather
than an approval, a stale or tampered trail).
`--auto-approve` does not cover team approval: never auto-approve a team decision.
