---
name: rollback
description: "Self-maintenance — revert a skill to a previous version by snapshotting current state as vN+1 and restoring vN (or vN-n). Non-destructive. Dispatches to guild:rollback-skill."
argument-hint: "<skill> [n]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild:rollback — self-maintenance (Guild-on-Guild)

Reverts a skill to a previous version. Maps to skill
`guild:rollback-skill`. The rollback is itself a versioned artifact —
non-destructive (snapshots current state as vN+1, restores vN or vN-n).


## Usage

```
/guild:rollback guild-brainstorm
/guild:rollback guild-brainstorm 2
```

## Args

- `<skill>` — the skill to roll back.
- `[n]` — number of steps to walk back (default 1).

## Gates

Confirm past v1 **I**.

## Output

`.guild/skill-versions/<skill>/v<N+1>/`.

## Run-start preflight (settings-control-and-tmux U3/U6)

Before the rollback skill is invoked — and before run-trace start — run the
preflight (`scripts/lib/runstart-preflight.ts`; canonical contract in
`guild.md §Run-start preflight`):

1. Call `runStartPreflight({ cwd, flags? })` — resolves the 7-source
   inheritance chain + validates + probes tmux + detects providers
   (full chain: see `/guild:guild §Run-start preflight`).
2. If `needsTmuxPrompt`: show `tmuxPrompt.question`; on YES run
   `npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/config-cmd.ts <...tmuxPrompt.persistCommand> --cwd <cwd>` (U2 HARD-SET);
   on NO continue with the resolved backend.
3. Pass `result.snapshot` to `startRun` — U6 writes
   `.guild/runs/<id>/resolved-settings.json` + `settings_ref` in `run.yaml`.
4. Proceed to run-trace start.

## Run recording

Before the rollback-skill is invoked, start a run (SC-B, §435):

```bash
node ${CLAUDE_PLUGIN_ROOT}/hooks/dist/run-trace.js start \
  --command=/guild:rollback \
  --cwd "$(pwd)"
```

`run-class` default (`full`). Records the run before the snapshot + restore
so the complete session — confirm-past-v1 gate and eval suite re-run — is
replayable from the entrypoint. Writes to `.guild/skill-versions/` — not
`.guild/initiatives/` (NN#5 unaffected). No `--initiative` flag.

## Dispatch

```
Skill: guild:rollback-skill
args: $ARGUMENTS
```

Re-runs the restored version's eval suite after rollback to confirm the
older content still passes; flags drift if not. Rollback logic and `.guild/`
writes live in the `guild:rollback-skill` skill.
