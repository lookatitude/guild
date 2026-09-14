---
name: qa
description: "Quality — the one user-facing review gate: SignalScan, a surfaced selection matrix, checks under the run sandbox and budget, then the computed ReleaseGate recommendation. Opt-in phase; never auto-entered, never silently skipped. Dispatches to guild:quality."
argument-hint: "[run-id]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:qa — Quality phase

Runs *after* a passing `.guild/runs/<run-id>/verify.md`, never instead of it. No
passing verify for the run ⇒ route back to Development and say so; proceeding
anyway is an operator decision recorded in the quality report.

## Run recording

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" start --command=/guild:qa --phase=qa --cwd "$(pwd)"
# append --initiative=<id> ONLY when the user supplied one (NN#5); never auto-detect
```

## Dispatch

```
Skill: guild:quality
args: $ARGUMENTS
```

Release / blocker gate **I** — a BLOCK override stays human-gated even under
`--auto-approve=all`. Checks, evidence and `.guild/` writes are the assembler's.

## Team decision gate (blocking)

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/team-decide.js" gate --proposal <proposal> --cwd "$(pwd)"
```

Verbs: approve · restructure · add · remove · substitute · edit_dependencies.
STOP on a non-zero exit — exit 3 BLOCKS (no persisted decision, a restructure rather
than an approval, a stale or tampered trail).
`--auto-approve` does not cover team approval: never auto-approve a team decision.
