---
name: guild-evolve-skill
description: Runs the §11.2 10-step evolve pipeline on one named skill — snapshot, load evals, dispatch paired subagents (A=current, B=proposed), drafter writes assertions, grader evaluates, benchmark + flip report, shadow mode, promotion gate, description optimizer, commit or archive. NEVER auto-edits a skill without passing the promotion gate; rejected attempts are archived, not deleted. TRIGGER for "evolve guild:<skill-name>", "run the evolve loop on <skill>", "re-tune this skill's description", "promote this reflection into a skill edit". DO NOT TRIGGER for creating a new skill from scratch (skill-author authors new skills directly), creating a new specialist (use guild:create-specialist), rolling back a skill version (guild:rollback-skill), reviewing runs (guild:review), composing a team (guild:team-compose), or ingesting wiki sources (guild:wiki-ingest).
when_to_use: Explicit user request /guild:evolve <skill> OR automatic threshold when ≥3 reflection-proposals accumulate for one skill (per §11.1 automatic trigger).
type: meta
---

# guild:evolve-skill

Implements `guild-plan.md §11.2` (self-evolution pipeline — 10 steps) and the two `§11.1` triggers (automatic ≥3-reflection threshold + explicit `/guild:evolve <skill>`). Runs paired-subagent evals in the skill-creator style with an AgentDevel-style flip-centered promotion gate, then commits the edit only if the gate passes. Rejected attempts are archived under `.guild/evolve/<run-id>/archived/` per `§11.3` (no destructive operations — rollbacks themselves snapshot as new versions).

This skill is a **gatekeeper**, not a free-form editor. It refuses to mutate a live skill file without a passed promotion gate. If the gate fails, it stops and surfaces the flip report + shadow-mode output so the user can decide.

## Input

Two fields:

1. **Skill slug** — the target skill to evolve, e.g. `guild:context-assemble` or `guild:brainstorm`. Must resolve to an existing `skills/<tier>/<slug>/SKILL.md` path. If the slug does not exist, stop and hand off to `skill-author` for authoring a net-new skill instead.
2. **Proposed-edit description** — optional when the automatic trigger fires (in which case this skill synthesizes the edit from the ≥3 accumulated reflections under `.guild/reflections/` whose frontmatter `proposals.skill_improvement` names the target skill); required when the explicit trigger is a user-supplied description. The edit may touch the skill body, the YAML frontmatter `description`, or both.

## Pipeline (§11.2 10 steps)

Ten ordered steps. Each step's input and output is explicit so a later step can re-read the prior artifact without re-executing.

1. **Snapshot current skill.** Copy the live skill directory to `.guild/skill-versions/<skill>/v<N>/`. `N` increments monotonically (walk the existing version folders, take max+1). Snapshot includes `SKILL.md`, `evals.json`, and any skill-local helpers. Input: live `skills/<tier>/<skill>/`. Output: `.guild/skill-versions/<skill>/v<N>/`.

2. **Load evals.** Read `skills/<tier>/<skill>/evals.json`. If fewer than 3 positive + 3 negative cases (insufficient for paired evaluation), bootstrap 2–3 additional cases from the accumulated reflections' `proposals.skill_improvement` evidence snippets (per `§11.2` step 2). Input: `skills/<tier>/<skill>/evals.json` + `.guild/reflections/*.md`. Output: `.guild/evolve/<run-id>/evals.json` (merged working set).

3. **Dispatch paired subagents.** Spawn two subagents in the same turn. A = current skill (from the snapshot in step 1), B = proposed edit (from Input #2). For a net-new skill (slug does not yet exist), A = no-skill baseline (skill disabled) and B = proposed. Feed each the merged eval working set from step 2. Input: snapshot + proposed edit + evals. Output: `.guild/evolve/<run-id>/runs/{A,B}/` with per-case trajectories.

4. **Drafter writes assertions.** In parallel with step 3's runs, a drafter subagent derives per-case assertions (expected trigger, expected non-trigger, required body content) from the eval cases. Input: merged evals. Output: `.guild/evolve/<run-id>/assertions.json`.

5. **Grader evaluates.** Grader subagent reads `runs/{A,B}/` + `assertions.json` and emits a per-case pass/fail with rationale. Input: trajectories + assertions. Output: `.guild/evolve/<run-id>/grading.json`.

6. **Benchmark + flip report.** Delegates to `scripts/flip-report.ts`. Computes `pass_rate`, `duration_ms`, `total_tokens`, mean ± stddev, and the delta between A and B. Classifies each case as P→P (stable pass), F→F (stable fail), P→F (**regression**), or F→P (**fix**). Input: `grading.json`. Output: `.guild/evolve/<run-id>/flip-report.json` + a human-readable `.md` summary.

7. **Shadow mode.** Delegates to `scripts/shadow-mode.ts`. Runs the proposed skill (B) on historical tasks from `.guild/runs/*/` without changing live routing — records trigger accuracy against the historical context, boundary collisions with adjacent skills, token deltas, and output quality per `§11.2` step 7. Input: proposed skill + `.guild/runs/`. Output: `.guild/evolve/<run-id>/shadow-mode.json`.

8. **Promotion gate.** Promote B if ANY of the three conditions holds:
   - **0 regressions AND ≥1 fix** (pure improvement).
   - **No flip change AND total_tokens ↓ ≥10%** (cost win without behavior change).
   - **Regressions present AND user approves via review viewer** (explicit override — gate surfaces the flip report + shadow-mode output and blocks until the user acknowledges).

   Gate result is recorded at `.guild/evolve/<run-id>/gate.json` with the triggering condition.

9. **On promote: description optimizer + commit.** Delegates to `scripts/description-optimizer.ts` — trains on the skill's `should_trigger` / `should_not_trigger` eval cases, fixes under-triggers and false triggers, keeps the final description ≤1024 chars per `§11.2` step 9. Then writes the edited skill back to `skills/<tier>/<skill>/`, bumps the version folder in `.guild/skill-versions/<skill>/v<N>/` (the snapshot from step 1 is now the pre-edit record), and updates `evals.json` if new cases were added in step 2.

10. **On reject: archive attempt.** Move the proposed edit (body + frontmatter diff + flip report + shadow-mode output + gate verdict) to `.guild/evolve/<run-id>/archived/` for future iterations per `§11.2` step 10. The live skill is left untouched.

## Artifacts

Two directories, by convention:

- `.guild/skill-versions/<skill>/v<N>/` — pre-edit snapshots, one per evolve run. Monotonically versioned per `§11.3`. Used by `guild:rollback-skill` to walk back the stack.
- `.guild/evolve/<run-id>/` — per-run workspace. Contains `evals.json` (merged), `assertions.json`, `runs/{A,B}/`, `grading.json`, `flip-report.{json,md}`, `shadow-mode.json`, `gate.json`, and on rejection a full `archived/` subtree.

## Non-destructive rule

This skill **NEVER edits a live skill file without passing the promotion gate**. The gate is the single choke point; step 9 is the only writer to `skills/<tier>/<skill>/`. Rejected attempts are archived under `.guild/evolve/<run-id>/archived/`, never deleted — a future iteration can re-open an archived attempt and re-run the pipeline with different inputs. Per `§11.3`, rollbacks themselves snapshot as new versions, so there is no destructive path through this skill.

If the gate returns "regressions present" and the user declines to approve, stop. Do not re-prompt, do not soft-merge a partial edit, do not suggest "just fix the description." Archive and hand control back.

## Handoff

Emit a `handoff` block naming the evolve run and gate outcome so the orchestrator can route downstream:

- On **promote**: emits a summary to `/guild:stats` (the promoted version + flip report highlights) so the next `/guild:stats` surfaces the evolved skill. If the user later invokes `/guild:rollback <skill>`, the snapshot taken in step 1 is the target.
- On **reject**: emits the archived-attempt path + the gate's triggering-condition rationale. The user may re-run with a refined proposed edit; the archived attempt is re-openable.

Payload fields: `run_id`, `skill`, `gate_outcome` (`promoted` / `rejected`), `flip_summary` (`regressions: N, fixes: N, token_delta: ±X%`), `version_path` (the `.guild/skill-versions/<skill>/v<N>/` snapshot), and `archived_path` (only on reject).
