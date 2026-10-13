---
name: plan
description: "Planning — team compose + PRD + per-specialist lane plan + autonomy contract. Backend (agent_mode/tmux) is resolved once at intake from the run-start preflight snapshot, not per-phase. Sub-verb `goal` emits P.O.V.E.R. goals / task groups from the approved spec. Dispatches to guild:plan."
argument-hint: "[--team-size=N] | goal [new|list|show|from-spec] [slug]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:plan — Planning phase

One spec in; `guild:plan` runs `guild:team-compose` first (its own gate), then writes
`.guild/team/<slug>.<phase>.yaml`, the lane plan and the PRD.

## Run recording

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" start --command=/guild:plan --phase=plan --cwd "$(pwd)"
# append --initiative=<id> ONLY when the user supplied one (NN#5); never auto-detect
```

`goal [new|list|show|from-spec] [slug]` is a sub-verb of this command: it emits
`guild.goal.v1` (or `guild.task_group.v1` on a host with no goal surface) from the
approved spec, keeping ids traceable downstream. It routes through `guild:plan §Sub-verbs`.

## Dispatch

```
Skill: guild:plan
args: $ARGUMENTS
```

## Team decision gate (blocking)

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/team-decide.js" gate --proposal <proposal> --cwd "$(pwd)"
```

Verbs: approve · restructure · add · remove · substitute · edit_dependencies.
STOP on a non-zero exit — exit 3 BLOCKS (no persisted decision, a restructure rather
than an approval, a stale or tampered trail).
`--auto-approve` does not cover team approval: never auto-approve a team decision.
