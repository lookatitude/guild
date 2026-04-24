---
name: guild-stats
description: Show usage stats — task count, completion rate, flip counts, top-used skills, top-requested specialists, open reflection backlog, and audit drift summary. Pure read; never writes. Per guild-plan.md §13.1.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Skill
---

# /guild:stats — Usage statistics

This command aggregates Guild telemetry from `.guild/` into a human-readable summary
(guild-plan.md §13.1). It is **read-only** — it never writes to any file.

---

## What it shows

| Metric | Source |
|--------|--------|
| Task count and completion rate | `.guild/runs/*/verify.md` (PASS/FAIL counts) |
| Top-used skills (by trigger count) | `.guild/runs/*/events.ndjson` (Skill tool invocations) |
| Top-requested specialists (by frequency) | `.guild/team/*.yaml` (specialist roster per task) |
| Flip counts (regressions + fixes) | `.guild/evolve/*/flip-report.md` |
| Open reflection-proposal backlog per skill | `.guild/reflections/` (proposals not yet promoted) |
| Audit drift summary | `.guild/audit/<date>.md` (hash changes since last audit) |

The reflection backlog count per skill is important for §11.1 automatic-trigger visibility:
a backlog of ≥ 3 pending proposals for one skill is the automatic threshold that queues
`/guild:evolve` for that skill.

---

## Data sources

| Directory | What it contains |
|-----------|-----------------|
| `.guild/runs/` | One subdirectory per run-id. Contains `events.ndjson` (telemetry), `verify.md` (pass/fail), `review.md`, and `handoffs/`. |
| `.guild/reflections/` | Post-task reflection proposals, one file per proposed skill edit. Consumed and cleared by `/guild:evolve`. |
| `.guild/evolve/` | Eval attempt records. `flip-report.md` in each attempt subdirectory carries flip counts. |
| `.guild/audit/` | Dated audit reports produced by `/guild:audit`. Each report lists script hashes; drift is detected by comparing consecutive reports. |
| `.guild/team/` | Team YAML files — one per task slug. Used to count specialist requests. |

No data source outside `.guild/` is read. Guild wiki (`.guild/wiki/`) is not included — use
`/guild:wiki query` for knowledge-layer queries.

---

## Output format

```
Guild stats — <date>

Tasks
  Total runs:        <n>
  Completed (PASS):  <n>  (<pct>%)
  Failed (FAIL):     <n>  (<pct>%)
  In progress:       <n>  (verify.md absent)

Top-used skills  (by Skill tool invocations across all runs)
  1. <skill-slug>       <count> invocations
  2. <skill-slug>       <count> invocations
  3. <skill-slug>       <count> invocations
  ... (top 10)

Top-requested specialists  (appearances in team YAML files)
  1. <specialist>       <count> tasks
  2. <specialist>       <count> tasks
  ... (top 10)

Evolution flip counts  (across all promote/reject attempts)
  Total attempts:     <n>
  Promoted:           <n>
  Rejected/deferred:  <n>
  F→P fixes (total):  <n>
  P→F regressions (total): <n>

Reflection backlog  (pending proposals not yet promoted)
  <skill-slug>:  <n> pending  [AUTO-TRIGGER THRESHOLD ≥ 3]
  <skill-slug>:  <n> pending
  ... (all skills with ≥ 1 pending proposal; sorted descending)

Audit drift  (hash changes between most recent consecutive audit reports)
  Last audit:  <date>
  Scripts changed since last audit:  <n>
  <script-path>  <old-hash-prefix> → <new-hash-prefix>
  ... (if any)
  (No drift detected)   ← when hashes match
```

If any `.guild/` directory does not exist, the corresponding section reports "No data yet" and
continues rather than erroring.

---

## Non-destructive note

`/guild:stats` is strictly read-only. It:

- Does **not** write any file under `.guild/` or anywhere else.
- Does **not** clear the reflection backlog or acknowledge audit drift.
- Does **not** invoke any skill that writes state.

To act on the reflection backlog, use `/guild:evolve [skill]`.
To run a fresh audit, use `/guild:audit`.
To query wiki knowledge, use `/guild:wiki query`.
