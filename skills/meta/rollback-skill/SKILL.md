---
name: guild-rollback-skill
description: Rolls back a skill to a previous version from .guild/skill-versions/<skill>/v<N>/. The rollback ITSELF is a snapshot — non-destructive, appends a new vN+1 with "source: rollback-from-vX" metadata. Can walk the stack (rollback N steps at once, default 1). Re-runs the restored version's eval suite after rollback to confirm the older content still passes its own evals against the current repo — flags drift if not. TRIGGER for "roll back guild:<skill> to v3", "revert the last evolve of <skill>", "undo yesterday's tune on brainstorm", "walk guild:<skill> back two steps", "restore guild:<skill> to v<N>". DO NOT TRIGGER for: evolving a skill forward (guild:evolve-skill owns), creating a new specialist (guild:create-specialist), deleting a skill (never supported — rollback-only, no destroy path), auditing scripts (guild:audit), or reviewing a run (guild:review).
when_to_use: Explicit /guild:rollback <skill> [n] command — rolls back n steps (default 1). Also fires when a recently-promoted edit shows regressions post-promote and the user asks to revert.
type: meta
---

# guild:rollback-skill

Implements `guild-plan.md §11.3` (versioning and rollback). Every skill edit is a versioned artifact under `.guild/skill-versions/<skill>/v<N>/`, and this skill walks that stack back. Per `§11.3`, **rollbacks themselves snapshot as new versions — no destructive operations**. The folder only grows.

This skill is the counterpart to `guild:evolve-skill`: evolve writes forward vN+1 on promote, rollback writes forward vN+1 sourced from an older vX. There is exactly one writer (this skill) and one gate (`guild:evolve-skill`) for skill content; neither ever deletes.

## Input

Two fields:

1. **Skill slug** — target skill to revert, e.g. `guild:brainstorm` or `guild:context-assemble`. Must resolve to an existing `skills/<tier>/<slug>/SKILL.md` path AND an existing `.guild/skill-versions/<skill>/` history. If no history exists (the skill has never been evolved), stop — there is nothing to roll back to.
2. **Steps-back count `n`** — optional integer, default `1`. Walks `n` versions back from the current live skill. If `n` would walk past v1, stop and surface the available depth so the user can re-issue with a valid count. An explicit `/guild:rollback <skill> v<N>` form pins to a specific version instead of walking n steps.

## Walk the stack

Enumerate `.guild/skill-versions/<skill>/` to list every available `v<N>/` with its metadata: version number, timestamp, source (fresh evolve-promote vs prior rollback), short diff summary against the live skill. Delegates to `scripts/rollback-walker.ts` (owned by tooling-engineer in P6) — this skill supplies the slug + step count, the script returns the enumerated stack plus the resolved target version.

The walker MUST surface:

- the full version list (v1…vN) so the user can see what else is available,
- the resolved target version (current − n, or the explicit pinned vX),
- the short diff between target and live (so the user sees exactly what rollback will restore),
- any `source:` metadata recording whether a prior vX was itself a rollback (so the user is not blindsided by a rollback-of-a-rollback chain).

If the resolved target equals the live skill (n = 0, or pinned to current version), stop — nothing to do.

## Non-destructive rule

A rollback is a snapshot that **appends** `vN+1` with `source: rollback-from-vX` metadata. The live `skills/<tier>/<slug>/` is replaced with the content of vX, and a new `.guild/skill-versions/<skill>/v<N+1>/` is written containing the restored content plus a `metadata.json` recording:

- `source: rollback-from-v<X>`
- `rolled_back_from_v: <previous live version N>`
- `rolled_back_at: <timestamp>`
- `rolled_back_by: <user or command>`
- `reason: <optional user-supplied note>`

Never overwrite history. `.guild/skill-versions/<skill>/` only grows. A rollback-of-a-rollback is fine — it produces yet another vN+1 sourced from the older vX. Per `§11.3`, there is no destructive path through this skill; delete is not a supported operation.

## Post-rollback verify

After the rollback write, re-run the skill's own eval suite (`should_trigger` / `should_not_trigger` from the restored `evals.json`) against the current repo. The restored version passed its evals at the time it was promoted, but the repo may have drifted since — an older version might have lost signal because adjacent specialists changed their `DO NOT TRIGGER` clauses, or a referenced wiki path was moved, or a skill the older body delegated to was renamed.

Three outcomes, each surfaced in the handoff payload:

1. **All evals pass** — rollback is clean. Confirm vN+1 is live.
2. **Evals fail in a way that suggests repo drift** — surface the failing cases and the drift hypothesis (e.g. "the restored body references `scripts/flip-report.ts` but that path now lives at `scripts/evolve/flip-report.ts`"), and offer the user the choice to (a) keep the rollback and patch the drift in a follow-up evolve, or (b) revert the rollback itself (which creates yet another vN+2 sourced from the pre-rollback live version — still non-destructive).
3. **Evals fail in a way unrelated to drift** — surface the failures verbatim. The user decides whether the older version was always broken against these cases (in which case the gate should have caught it and this is a lesson for `guild:evolve-skill`) or whether the evals themselves have drifted and need editing before the rollback is trustworthy.

This step is part of the skill, not an optional check. Rollback is not considered complete until the verify outcome is recorded.

## Handoff

Emit a `handoff` block confirming the rollback and linking to the restored content.

Payload fields:

- `skill` — the slug rolled back.
- `from_version` — the live version before rollback (vN).
- `to_version` — the target vX whose content was restored.
- `new_version` — the vN+1 slot written for the rollback snapshot.
- `new_version_path` — `.guild/skill-versions/<skill>/v<N+1>/`.
- `live_skill_path` — `skills/<tier>/<slug>/` (for the user to re-read).
- `post_rollback_verify` — one of `passed`, `drift_suspected`, `failed_unrelated`, with the failing cases and drift hypothesis on anything but `passed`.
- `chain_depth` — how many prior rollbacks are in the restored version's lineage (0 for a fresh rollback, ≥1 for a rollback-of-a-rollback), so the user is not surprised by the metadata.

On drift or unrelated failure, the handoff explicitly flags the skill for a follow-up `guild:evolve-skill` run with the restored content as baseline. Rollback does not unilaterally chase drift — it surfaces and hands off.
