---
name: guild-rollback
description: Revert a skill to a previous version by snapshotting the current state as vN+1 and restoring vN (or vN-n). Non-destructive — every rollback is itself a versioned artifact. Per guild-plan.md §13.1 and §11.3.
argument-hint: "<skill> [n]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Skill
---

# /guild:rollback — Skill version rollback

This command is the user-facing entry point for Guild's skill version rollback (guild-plan.md §13.1 and §11.3).
It is a thin dispatcher: all snapshotting, version stack management, and file restoration logic
live in the `guild-rollback-skill` skill. No writes to `.guild/` or `skills/` are made by this command directly.

---

## Usage

```
/guild:rollback <skill>       ← roll back one version (vN → vN-1)
/guild:rollback <skill> <n>   ← roll back n versions (vN → vN-n)
```

`<skill>` is the skill slug (e.g., `guild-brainstorm`, `guild-team-compose`).
`<n>` is an optional step count (positive integer). Defaults to `1` when omitted.

**Dispatch pattern:**

Parse `$ARGUMENTS`. The first word is the skill slug; the optional second word is the step count.
Then invoke:

```
Skill: guild-rollback-skill
args: skill=<slug> steps=<n>
```

Pass `steps=1` when no step count is provided.

---

## Examples

```
# Roll back guild-brainstorm one version (most recent rollback)
/guild:rollback guild-brainstorm

# Roll back guild-brainstorm two versions
/guild:rollback guild-brainstorm 2

# Roll back guild-team-compose to its version before the last three promotions
/guild:rollback guild-team-compose 3
```

---

## Non-destructive note

Per guild-plan.md §11.3: **rollbacks create new versions, never delete old ones.**

The sequence is always:

1. Snapshot the current skill body → `.guild/skill-versions/<skill>/v<N+1>/` — the rollback itself is archived.
2. Copy `.guild/skill-versions/<skill>/v<N-n>/` → `skills/<skill>/` — restoring the target version.
3. Increment the live version counter to `v<N+1>`.

This means:

- No version is ever destroyed. The full history is always traversable under `.guild/skill-versions/<skill>/`.
- Rolling back and then running `/guild:evolve` again starts a new forward branch from the restored baseline.
- You can re-apply a rejected evolution attempt if a later task proves it was correct: just roll forward by running `/guild:evolve` again.

If `<n>` would reach or exceed version `v1` (the original install snapshot), the skill reports the
safe maximum and asks for confirmation before proceeding past `v1`.

---

## Output

After the skill returns, surface the result:

**Success:**

```
/guild:rollback — OK
Skill:    <slug>
Restored: v<N-n>  (was v<N>)
Snapshot: .guild/skill-versions/<skill>/v<N+1>/
Active:   skills/<skill>/
```

**Error (version out of range):**

```
/guild:rollback — STOPPED
Skill: <slug>
Current version: v<N>
Requested steps: <n>  (would reach v<N-n> = v0 or below)
Oldest available: v1
Re-run with steps ≤ <N-1> to proceed.
```
