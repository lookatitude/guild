---
name: resume
description: "Orchestrator — continue the active run from the next pending gate. --restart clears run state and re-runs from Init/Ideation (confirm-before-clear)."
argument-hint: "[--no-index] [--restart]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:resume — lifecycle helper

Continues the active run from the next pending gate. **No phase** — acts on
the active run.

Canonical surface: `architecture/command-surface.md §3.2` (resume row) +
`§4.1`. `--restart` replaces the v1 first-word `$ARGUMENTS` `--restart` hack.

## Args & local flags

- Args: — (no positional)
- `--no-index` — per-invocation filesystem-scan bypass of the optional
  read-through cache (Invariant FS-CANONICAL, by pointer
  `command-surface.md §5.3`).
- `--restart` — clears run state and re-runs from Init/Ideation
  (**confirm-before-clear I**).

## Gates

Resumes at the next **I** gate. `--restart` adds a confirm-before-clear **I**
gate.

## Output

Continues the active run's phase artifacts (no new artifact kind introduced).

## Dispatch

Thin orchestrator-continue entrypoint. Locate the next pending gate
(filesystem scan, or the optional cache unless `--no-index`) and resume; on
`--restart`, confirm, clear run state, and re-enter from Init/Ideation. Phase
logic and `.guild/` writes live in the phase skill set.
