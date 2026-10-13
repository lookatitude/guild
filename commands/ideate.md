---
name: ideate
description: "Ideation — Socratic spec; the L1 clarify loop runs whenever the resolved loops include spec (default --rigor=standard and deep; quick skips it). Dispatches to guild:brainstorm."
argument-hint: "[brief] [--skip]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:ideate — Ideation phase

Turns a vague brief into an approved `.guild/spec/<slug>.md`. `--skip` validates
a supplied spec and flags gaps instead of asking the full question set.

## Run recording

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" start --command=/guild:ideate --phase=ideate --cwd "$(pwd)"
# append --initiative=<id> ONLY when the user supplied one (NN#5); never auto-detect
```

## Dispatch

```
Skill: guild:brainstorm
args: $ARGUMENTS
```

The assembler runs its `loop-clarify` chapter when the resolved loops include
`spec`. Spec approval **I**; gates, question set and `.guild/` writes are the
assembler's.

## Team decision gate (blocking)

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/team-decide.js" gate --proposal <proposal> --cwd "$(pwd)"
```

Verbs: approve · restructure · add · remove · substitute · edit_dependencies.
STOP on a non-zero exit — exit 3 BLOCKS (no persisted decision, a restructure rather
than an approval, a stale or tampered trail).
`--auto-approve` does not cover team approval: never auto-approve a team decision.
