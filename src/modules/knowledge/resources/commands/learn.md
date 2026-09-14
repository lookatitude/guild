---
name: learn
description: "Understand-everything — no sub-verb runs the smart full learn-all (detect target, run the pipeline, update indexes, emit knowledge candidates). Sub-verbs map | graph | knowledge | onboard | diff | explain scope it. Dispatches to guild:learn."
argument-hint: "[map|graph|knowledge|onboard|diff|explain] [target] [--rigor=quick|standard|deep]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:learn — knowledge pipeline

One implementation, two triggers (D3): the same `learn-*` chapters run here and
under `/guild:init --learn`. An unknown sub-verb prints usage and stops — no
skill invoked, no file written.

## Run recording

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" start --command=/guild:learn --cwd "$(pwd)"
```

## Sub-verbs

| Token | Scope |
|---|---|
| (none) | smart full learn-all — detect, confirm, run the pipeline |
| `map` | CodebaseMap + architecture overview (cheap scan) |
| `graph` | deep semantic KnowledgeGraph (slow) |
| `knowledge` | deep multi-modal knowledge tier |
| `onboard` | guided architecture tour |
| `diff` | change analysis + blast radius |
| `explain` | file / module / concept deep-dive |

## Dispatch

```
Skill: guild:learn
args: $ARGUMENTS
```

The first token selects the chapter; the rest forwards as `args`. Indexes,
candidates and every `.guild/` write are the assembler's. Unknown token: print usage.
