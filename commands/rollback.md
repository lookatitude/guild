---
name: guild rollback
description: "Self-maintenance — revert a skill to a previous version by snapshotting current state as vN+1 and restoring vN (or vN-n). Non-destructive. Dispatches to guild:rollback-skill."
argument-hint: "<skill> [n]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion
---

# /guild rollback — self-maintenance (Guild-on-Guild)

Reverts a skill to a previous version. Maps to skill
`guild:rollback-skill`. The rollback is itself a versioned artifact —
non-destructive (snapshots current state as vN+1, restores vN or vN-n).

Canonical surface: `architecture/command-surface.md §3.5` (rollback row).

## Usage

```
/guild rollback guild-brainstorm
/guild rollback guild-brainstorm 2
```

## Args

- `<skill>` — the skill to roll back.
- `[n]` — number of steps to walk back (default 1).

## Gates

Confirm past v1 **I**.

## Output

`.guild/skill-versions/<skill>/v<N+1>/`.

## Dispatch

```
Skill: guild:rollback-skill
args: $ARGUMENTS
```

Re-runs the restored version's eval suite after rollback to confirm the
older content still passes; flags drift if not. Rollback logic and `.guild/`
writes live in the `guild:rollback-skill` skill.
