---
name: guild
description: "Bare Guild entry (T0) — no verb runs six-way intake; `research` / `debug` / `--class=` bind the workflow class directly. Surfaces the proposed phase and class for confirmation, never silently. Dispatches to guild:using-guild."
argument-hint: "[brief] [research|debug] [--class=product|research|debug|ops|init] [--rigor=quick|standard|deep] [--auto-approve[=spec,plan,build,qa,all]] [--review=local|cross|off] [--initiative=<id>|new]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:guild — T0 orchestrator session

Bare entry (KTD46): no verb runs intake and the classifier's `intake` decides;
`research`, `debug` and `--class=<product|research|debug|ops|init>` bind the class
as arguments to that same entry (KTD69) — never as command files of their own.

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/hooks/dist/run-trace.js" start --command=/guild:guild --phase=<detected-phase> --cwd "$(pwd)"
# append --initiative=<id> ONLY when the user supplied one (NN#5); never auto-detect
echo "$ARGUMENTS" | node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/classify-intake.js"
```

## Dispatch

```
Skill: guild:using-guild
args: $ARGUMENTS
```

Intake, phase detection, gates and every `.guild/` write live in the
assembler and the class graph it binds.

## Team decision gate (blocking)

```bash
node "${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/runtime/scripts/team-decide.js" gate --proposal <proposal> --cwd "$(pwd)"
```

Verbs: approve · restructure · add · remove · substitute · edit_dependencies.
STOP on a non-zero exit — exit 3 BLOCKS (no persisted decision, a restructure rather
than an approval, a stale or tampered trail).
`--auto-approve` does not cover team approval: never auto-approve a team decision.
