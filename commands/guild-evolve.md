---
name: guild-evolve
description: Kick off skill evolution — runs the eval loop, shadow mode, and flip-gating promotion pipeline. Manual mode pauses at the promotion gate for user review; --auto runs unattended if the gate criteria are met without regressions. Per guild-plan.md §13.1.
argument-hint: "[skill] [--auto]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Skill
---

# /guild:evolve — Skill evolution

This command is the user-facing entry point for Guild's self-evolution pipeline (guild-plan.md §13.1 and §11).
It is a thin dispatcher: all eval logic, shadow mode, flip detection, description optimization, and version management
live in the `guild-evolve-skill` skill. No writes to `.guild/` are made by this command directly.

---

## Usage

```
/guild:evolve                    ← evolve the skill most overdue (by reflection backlog)
/guild:evolve <skill>            ← evolve a specific skill by slug
/guild:evolve <skill> --auto     ← evolve unattended; promote if gate criteria pass
/guild:evolve --auto             ← unattended run on the most-overdue skill
```

**Examples:**

```
# Manually evolve the guild-brainstorm skill (pauses for user review at promotion gate)
/guild:evolve guild-brainstorm

# Unattended run — promotes automatically if 0 regressions AND ≥ 1 fix (§11.2 gate)
/guild:evolve guild-brainstorm --auto

# Let Guild pick the most-overdue skill (highest reflection backlog count)
/guild:evolve

# Unattended on the most-overdue skill
/guild:evolve --auto
```

---

## Manual mode

When `--auto` is **not** supplied, the evolution pipeline runs through all steps (§11.2) but
**pauses at the promotion gate** (step 8) to present the flip report to the user:

- Pass rate, duration, token delta, mean±stddev.
- P→F regressions (if any) and F→P fixes.
- Shadow-mode trigger accuracy and boundary collision report.

The user may then respond: `promote`, `reject`, or `defer`.

**Dispatch pattern:**

Parse `$ARGUMENTS`. Extract an optional skill slug (first non-flag word) and check for `--auto`.
When `--auto` is absent, invoke:

```
Skill: guild-evolve-skill
args: skill=<slug-or-empty> auto=false
```

If no slug is provided, pass `skill=` empty — the skill selects the most-overdue candidate by scanning
`.guild/reflections/` for the highest pending-proposal count.

**Expected outputs from the skill:**

- `.guild/skill-versions/<skill>/v<n>/` — snapshot of the current skill before any edit.
- `.guild/evolve/<skill>/<attempt-id>/grading.json` — eval assertion results.
- `.guild/evolve/<skill>/<attempt-id>/flip-report.md` — benchmark + flip summary.
- `.guild/evolve/<skill>/<attempt-id>/shadow-report.md` — shadow-mode accuracy + boundary collisions.
- On promote: updated `skills/<skill>/` and `skills/<skill>/evals/evals.json`; version bumped.
- On reject/defer: attempt archived under `.guild/evolve/<skill>/<attempt-id>/`.

---

## --auto mode (unattended)

When `--auto` is present, the skill runs the same pipeline but applies the promotion gate
autonomously (guild-plan.md §11.2 step 8):

> **Promote if ANY of:**
> - 0 regressions AND ≥ 1 fix.
> - No flip change AND tokens ↓ ≥ 10%.
> - Regressions present AND user approves via review viewer.

The third condition cannot be satisfied unattended — if regressions are present, `--auto` will
**reject** (not promote) and report the outcome to the user. The gate is respected either way;
`--auto` only removes the interactive pause when the criteria are unambiguously met.

**Dispatch pattern:**

```
Skill: guild-evolve-skill
args: skill=<slug-or-empty> auto=true
```

The skill emits a structured outcome line when done:

```
Evolution outcome: PROMOTED | REJECTED | DEFERRED
Skill: <slug>   Version: v<n> → v<n+1> (or unchanged)
Reason: <one-line from flip report>
Full report: .guild/evolve/<skill>/<attempt-id>/flip-report.md
```

---

## Output

After the skill returns, surface the outcome to the user:

**Promoted:**

```
/guild:evolve — PROMOTED
Skill:      <slug>
Version:    v<n> → v<n+1>
Fixes:      <F→P count>
Regressions: 0
Token delta: <±%>
Full report: .guild/evolve/<skill>/<attempt-id>/flip-report.md
Shadow:      .guild/evolve/<skill>/<attempt-id>/shadow-report.md
```

**Rejected / Deferred:**

```
/guild:evolve — REJECTED | DEFERRED
Skill:       <slug>
Regressions: <P→F count>
Fixes:       <F→P count>
Reason:      <summary from flip report>
Attempt archived: .guild/evolve/<skill>/<attempt-id>/
```

If `--auto` rejected due to regressions, suggest running without `--auto` to review and
optionally promote with explicit approval.
