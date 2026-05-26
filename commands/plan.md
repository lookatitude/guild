---
name: plan
description: "Planning — team-compose + PRD + per-specialist lane plan + autonomy contract"
argument-hint: "[--team-size=N]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent, Skill, AskUserQuestion, TaskCreate, TaskUpdate, TaskList
---

# /guild:plan — phase: Planning

The **Planning** phase entrypoint. Composes the team, writes the PRD and the
per-specialist lane plan, and authors the additive optional per-lane autonomy
contract. **Team composition is a sub-step strictly inside this command**
(its own approval gate); there is no standalone team command in v2 — inspect
via `/guild:status`, edit via the `[edit]` response at the plan/team approval
gate, raise the cap with `--team-size=N`.

Canonical surface: `architecture/command-surface.md §3.1` (Planning row) and
the verb↔phase edge in `§6` (D-14: `/guild:plan` → Planning). Phase concept
binding: `lifecycle/phase-entrypoints.md` · `lifecycle/lifecycle-overview.md`.

## Contract binding (by pointer — never re-spelled)

Before producer work begins, this phase **resolves the frozen
`guild.phase_entry.v1` contract** — bound by pointer through
`docs/knowledge/implementation/contract-map.md §A` row 6 →
`architecture/target-architecture.md §"phase_entry contract"`. The additive
optional per-lane `autonomy_contract` is authored here and approved at the
**existing** plan gate — **no new gate** (bound by pointer:
`command-surface.md §5.2`; `contract-map.md §B` row 1 →
`target-architecture.md §"autonomy_policy / autonomy_contract"`). The Tier-2
`defaults:` config folded at intake is bound by pointer to
`command-surface.md §4.4` (`P1-config-001`).

## Usage

```
/guild:plan
/guild:plan --team-size=8
```

All six global flags + `--dry-run` apply (`command-surface.md §4`, by
pointer).

## Args & local flags

- Args: — (no positional)
- Local flags:
  - `--team-size=N` — cap-6 override; `>6` prints the `guild-plan.md §7.2`
    cap warning.

## Gates (default)

- Team-approval **I**
- Plan/PRD-approval **I**
- G-planning review **A**

## Output artifact

`.guild/prd/<slug>.md`, `.guild/plan/<slug>.md`, `.guild/team/<slug>.yaml`.

## Dispatch

Resolve `guild.phase_entry.v1` (pointer above), then drive the Planning phase
by invoking, in order:

1. **`guild:team-compose`** (`skills/meta/team-compose`) — the team-compose
   sub-step (its own approval gate); writes `.guild/team/<slug>.yaml`.
2. **`guild:plan`** (`skills/meta/plan`) — turns the approved spec + team into
   the PRD and per-specialist lane plan with the additive per-lane autonomy
   contract; writes `.guild/prd/<slug>.md` + `.guild/plan/<slug>.md`.
3. **`guild:loop-plan-review`** — **`--rigor=deep` only**: the L2 architect↔
   security plan-defect loop runs AFTER `guild:plan` writes the plan and
   BEFORE the plan-approval gate.

Input gate: an approved `.guild/spec/<slug>.md`.
Output gate: the **Output artifact** set above is written; the plan carries
`approved:` per the gate outcome.
Confirmation gates (from **Gates**): team-approval **I** · plan/PRD-approval
**I** · G-planning review **A**.

Thin phase entrypoint — phase logic and `.guild/` writes live in the phase
skill set.
