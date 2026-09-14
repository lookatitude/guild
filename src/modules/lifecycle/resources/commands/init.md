---
name: init
description: "Init — onboard an existing repo or scaffold new-product knowledge; builds wiki + (brownfield) cheap-scan CodebaseMap + architecture-map stub (cheap by default). The full learn-* pipeline runs only under --learn or defaults.auto_learn (D3). Sub-verb `adopt` localizes shipped capability into this project. Dispatches to guild:init."
argument-hint: "[--learn] [--new] | adopt <report|catalog|adopt|rollback|status|window|g5> [options]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:init — Init phase

Cheap by default: wiki + brownfield cheap-scan map + a confidence-tagged
architecture-map stub; `--learn` (or `defaults.auto_learn`) folds in the full
`learn-*` pipeline. Sub-verb `adopt` localizes shipped capability — `report`,
`status` and an unfrozen `catalog` read-only, the rest ask first.

## Run recording

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" start --command=/guild:init --phase=init --cwd "$(pwd)"
# append --initiative=<id> ONLY when the user supplied one (NN#5); never auto-detect
# sub-verb `adopt` — capability localization, forwarded verbatim
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/capability-adopt.js" $REMAINING_ARGS --project-root "$(pwd)"
```

## Dispatch

```
Skill: guild:init
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
