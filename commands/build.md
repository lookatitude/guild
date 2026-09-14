---
name: build
description: "Development — per lane: assemble the specialist context bundle, dispatch the lane on the backend locked in at intake (snapshot effective.agent_mode), collect the handoff receipt, then run the G-lane review gate. Dispatches to guild:execute-plan."
argument-hint: "[lane-id]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:build — Development phase

Each lane is an ephemeral one-agent-per-task cell: spawn at its resolved tier → work →
emit `guild.handoff.v2` → dismiss; `depends-on:` decides parallelism, `[lane-id]` re-runs one.

## Run recording

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" start --command=/guild:build --phase=build --cwd "$(pwd)"
# append --initiative=<id> ONLY when the user supplied one (NN#5); never auto-detect
```

## Dispatch

```
Skill: guild:execute-plan
args: $ARGUMENTS
```

The lane roster is the per-phase `.guild/team/<slug>.<phase>.yaml`. Context assembly,
the G-lane gate, receipts under `.guild/runs/<run-id>/handoffs/` and the autonomy
policy are the assembler's.

## Team decision gate (blocking)

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/team-decide.js" gate --proposal <proposal> --cwd "$(pwd)"
```

Verbs: approve · restructure · add · remove · substitute · edit_dependencies.
STOP on a non-zero exit — exit 3 BLOCKS (no persisted decision, a restructure rather
than an approval, a stale or tampered trail).
`--auto-approve` does not cover team approval: never auto-approve a team decision.
