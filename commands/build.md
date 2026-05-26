---
name: guild build
description: "Development — context-assemble + dispatch lanes (subagent default; agent-team opt-in)"
argument-hint: "[lane-id]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild build — phase: Development

The **Development** phase entrypoint. Assembles per-specialist context and
dispatches lanes (subagent backend default; agent-team opt-in). An optional
positional `[lane-id]` re-runs a single lane.

Canonical surface: `architecture/command-surface.md §3.1` (Development row)
and the verb↔phase edge in `§6` (D-14: `/guild build` → Development). Phase
concept binding: `lifecycle/phase-entrypoints.md` ·
`lifecycle/lifecycle-overview.md`.

## Contract binding (by pointer — never re-spelled)

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract** — bound by pointer through
`docs/knowledge/implementation/contract-map.md §A` row 6 →
`architecture/target-architecture.md §"phase_entry contract"`. The run
executes under the `task_run.autonomy_policy` recorded in the approved plan —
bound by pointer to `contract-map.md §A` row 1 →
`target-architecture.md §"task_run contract"` (the autonomy contract was set
at plan approval; **no new gate**).

## Usage

```
/guild build
/guild build lane-backend-001
```

All six global flags + `--dry-run` apply (`command-surface.md §4`, by
pointer).

## Args & local flags

- Args: `[lane-id]` (re-run one lane)
- Local flags: —

## Gates (default)

- Autonomy contract (set at plan approval) **A**
- Destructive / network ops **I always** (immutable always-ask hard set —
  never relaxed by `--auto-approve`; `command-surface.md §5.2`, by pointer)

## Output artifact

`.guild/runs/<run-id>/handoffs/*.md`, `assumptions.md`, changed files.

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), then drive the Development
phase under the recorded `task_run.autonomy_policy`. **Per lane** (parallel
where `depends-on:` allows; `[lane-id]` re-runs one), invoke in order:

1. **`guild:context-assemble`** (`skills/meta/context-assemble`) — build the
   specialist's 3-layer context bundle (~3k tokens, hard cap 6k).
2. **`guild:execute-plan`** (`skills/meta/execute-plan`) — dispatch the
   specialist (subagent default; agent-team opt-in) and collect the handoff
   receipt at `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md`.
3. **`guild:review`** (`skills/meta/review`) — two-stage per-lane review
   (spec-compliance, then quality) of the handoff receipt; writes
   `.guild/runs/<run-id>/review.md`.

`--rigor=deep` additionally runs **`guild:loop-implement`** (the L3 / L4 /
security-review per-lane adversarial loop) around the lane's primary writer.

Input gate: an approved `.guild/plan/<slug>.md` + `.guild/team/<slug>.yaml`.
Output gate: handoff receipts, `assumptions.md`, `review.md`, changed files.
Confirmation gates (from **Gates**): autonomy contract (set at plan approval)
**A** · destructive / network ops **I always** (never relaxed by
`--auto-approve`).

Thin phase entrypoint — phase logic and `.guild/` writes live in the phase
skill set.
