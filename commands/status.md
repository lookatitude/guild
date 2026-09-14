---
name: status
description: "Orchestrator read — current run state, furthest phase, next gate, blockers, layout version, and the per-phase active team. Sub-verbs `resume` (continue from the next pending gate), `stats` (telemetry dashboard) and `dashboard` (launch the benchmark UI). Read-only except where `resume` advances the run."
argument-hint: "[--no-index] | resume [--restart] | stats [--rebuild-index] | dashboard [--port N] [--stop]"
allowed-tools: Read, Grep, Glob, Bash, Skill, AskUserQuestion
---

# /guild:status — where am I

Resolves run state by filesystem scan, or the optional `.guild/index.sqlite`
read-through cache unless `--no-index`. The bare form writes no `.guild/` data.

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" status --cwd "$(pwd)"
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/capability-profile.js" candidates --cwd "$(pwd)"
# sub-verbs, flags forwarded verbatim:
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/resume-lanes.js" <runDir> --json      $REMAINING_ARGS
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/dashboard-launch.js" $REMAINING_ARGS
```

## Sub-verbs

| Token | Scope |
|---|---|
| `resume` | continue the active run from the next pending gate; `--restart` clears run state after confirming |
| `stats` | usage + telemetry dashboard over `.guild/runs/**`; pure read |
| `dashboard` | clone / serve the benchmark UI over this project's runs + knowledge |

The active team resolves through `resolveTeamFile`; a legacy single-file `team.yaml` is
surfaced once as legacy and status never acts on it.

## Dispatch

```
Skill: guild:using-guild
args: $ARGUMENTS
```

Read-only: the assembler names the phase and next gate, the CLIs produce the state,
and `resume` hands off to that phase's own command.
