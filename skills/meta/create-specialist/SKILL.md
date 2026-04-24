---
name: guild-create-specialist
description: Runs the §12 7-step workflow to mint a new shipping specialist — interview, draft under agents/proposed/, boundary scan of existing agents/*.md, propose adjacent-boundary edits (DO NOT TRIGGER for new-domain), gate boundary edits via guild:evolve-skill, gate the new specialist via paired evals + shadow mode, register live. Minted only when §11.2.1 extraction signals agree (recurring gap across ≥3 runs, distinct triggers, sufficient context isolation, enough eval cases). TRIGGER for "create a new Guild specialist for <domain>", "mint a data-scientist specialist", "add a new role — <role>", "incubate a proposed specialist for <domain>". DO NOT TRIGGER for authoring a skill (skill-author owns), evolving an existing specialist (guild:evolve-skill), composing a team for the current task (guild:team-compose), editing an existing agent's body (specialist-agent-writer dev agent), or rolling back a specialist (guild:rollback-skill).
when_to_use: Explicit user request, OR /guild:team-compose auto-create option (A) fires after a gap is flagged, OR §11.2.1 extraction thresholds fire (same skill cluster across ≥3 unrelated tasks with distinct trigger needs + recurring reflection gaps pointing to the same domain).
type: meta
---

# guild:create-specialist

Implements `guild-plan.md §12` (specialist creation with adjacent-boundary updates, 7-step workflow) gated by the `§11.2.1` extraction signals. This is the meta-skill that mints new shipping specialists — the one that `guild:team-compose`'s option A (auto-create) delegates to when a spec surfaces a gap.

Specialists do not get minted on a hunch. The extraction signals in `§11.2.1` must ALL agree before this skill proceeds past step 2, and even then the new specialist must pass two gates (boundary evals via `guild:evolve-skill`, then its own paired evals + shadow mode) before it moves from `agents/proposed/` to live `agents/`.

## Input

Five fields, captured via the interview in step 1 (ask the user until all five are captured; do not guess):

1. **Role name** — a single noun phrase, e.g. `data-scientist`, `frontend-engineer`, `ux-writer`.
2. **Description** — one-paragraph responsibility statement, suitable for the agent file's frontmatter `description` (≤1024 chars, TRIGGER + DO NOT TRIGGER clauses required).
3. **Typical prompts** — 3–5 example user utterances that should route to this specialist. Feed the `should_trigger` side of the new specialist's paired evals.
4. **Example outputs** — 1–3 concrete artifacts (file shapes, deliverable types, handoff payloads) this specialist produces. Feeds the body of the agent file and the per-skill evals under `skills/specialists/proposed-<role>-*/`.
5. **Dependencies** — upstream specialists this role reads handoffs from, and downstream specialists that depend on its output. Feeds the `opens_for:` conventions in the agent's handoff contract.

## 7-step workflow (§12)

Seven ordered steps. Each step's gate must pass before the next runs.

1. **Interview.** Capture the five Input fields above. If any is missing or underspecified, ask the user until all five are complete. Do not invent a role on the user's behalf — specialists are too heavy to conjure.

2. **Draft.** Write the proposed files under the incubation path:
   - `agents/proposed/<role>.md` — frontmatter (`name`, `description`, `when_to_use`, `model`) + body (responsibilities, superpowers, handoff contract, scope boundaries per the conventions in existing `agents/*.md`).
   - `skills/specialists/proposed-<role>-*/` — 2–5 specialist skills covering the role's distinct activities. Each skill has its own `SKILL.md` + `evals.json`.

3. **Boundary scan.** Compute description-similarity between the draft agent's `description` and all existing `agents/*.md` frontmatter descriptions. Flag any overlap above the threshold (e.g. cosine ≥ 0.75 on description embeddings, or naive token-Jaccard ≥ 0.35 as a fallback). The flagged list is the adjacent-specialist set.

4. **Propose adjacent-boundary edits.** For each adjacent specialist, draft an append-only edit to its `description`: `DO NOT TRIGGER for: <new-specialist-domain>` (one short clause identifying the new domain and referencing the proposed role). Per `§12.1` step 4, these edits keep the adjacent specialists from continuing to steal the new specialist's triggers once it ships.

5. **Gate boundary edits.** Each proposed boundary edit from step 4 runs through `guild:evolve-skill` as its own paired-evals run (A = adjacent specialist as-is, B = adjacent specialist with the DO NOT TRIGGER clause appended). The gate verifies the adjacent specialist still triggers correctly for its own domain but no longer matches the new specialist's triggers. Any boundary edit that fails its evolve gate stops this workflow (see Failure handling).

6. **Gate new specialist.** Paired evals on the new specialist itself (A = no-specialist baseline, B = proposed specialist), followed by shadow-mode runs on historical specs from `.guild/runs/*/` to surface boundary collisions and trigger-accuracy issues before live routing. Both must pass; shadow mode is not advisory here, it's part of the gate.

7. **Register.** On both gates passing, move the files from `agents/proposed/<role>.md` → `agents/<role>.md` and `skills/specialists/proposed-<role>-*/` → `skills/specialists/<role>-*/`. Commit the boundary edits to the adjacent specialists (from step 5). Add the new role to `guild:team-compose`'s candidate list. The new specialist is live for subsequent `/guild` tasks.

## Extraction signals (§11.2.1)

Five thresholds that must **ALL** agree before minting proceeds past step 2. If any signal is missing, stop and report which — specialists earn their slot, they don't get granted on one task's enthusiasm.

1. **Recurring cluster.** The same skill cluster appears across ≥3 unrelated tasks (walk `.guild/runs/*/summary.md` + reflections for co-activation evidence).
2. **Distinct triggers + boundaries.** The cluster needs trigger rules that don't fit an existing specialist's description, AND at least one adjacent specialist needs a `DO NOT TRIGGER` boundary clause (otherwise the cluster is a skill edit, not a specialist).
3. **Context isolation payoff.** The cluster consumes enough context per task that isolating it into its own specialist improves focus (e.g. ≥2k tokens of domain-specific context per task, or a specialist-specific wiki page set).
4. **≥3 reflections or team-compose gaps.** Walk `.guild/reflections/*.md` `proposals.missing_specialist` and `.guild/team/*.yaml` gap notes — the same proposed role must appear in ≥3 records.
5. **Enough eval cases.** ≥3 positive + ≥3 negative eval cases already derivable from the accumulated evidence (required to gate the role in steps 5 and 6).

Record the signal-check result at `.guild/evolve/<run-id>/extraction-check.json` so the gate is auditable.

## Incubation path

Proposed specialists live at:

- `agents/proposed/<role>.md`
- `skills/specialists/proposed-<role>-*/`

They stay in `proposed/` until both gates (step 5 boundary-edit gates + step 6 new-specialist gate with shadow mode) pass. Only step 7's Register moves them into live paths. The proposed tree is explicitly not loaded by `/guild:team-compose` as a candidate until registered — `guild:team-compose` reads `agents/*.md`, not `agents/proposed/*.md`.

## Failure handling

If any gate fails, **stop and surface refinement options to the user** — do not silently archive and move on. A rejected new specialist is a design question, not an eval artifact.

Surface:

- **Which gate failed** (extraction-signal shortfall, boundary-edit evolve gate, or new-specialist paired-evals / shadow-mode gate).
- **The specific evidence** (missing extraction signal with count, failing eval case with trajectory, or shadow-mode collision with adjacent specialist).
- **Refinement options** — narrow the role's trigger description, add/remove adjacent-boundary clauses, re-interview for a sharper Input, or abandon the proposal. The user chooses; this skill does not pick for them.

Write `.guild/evolve/<run-id>/proposed-<role>-rejected.md` with the full gate outcomes so the rejection is re-openable in a later iteration.

## Handoff

Emit a `handoff` block naming the creation run and gate outcome.

- On **success** (step 7 completes): confirm registration (live paths for `agents/<role>.md` and `skills/specialists/<role>-*/`), emit a summary listing the new specialist + the boundary edits applied to adjacent specialists, and note that `guild:team-compose` now has the role as a candidate.
- On **failure** (any gate): write `.guild/evolve/<run-id>/proposed-<role>-rejected.md` with the gate outcomes and surface refinement options in the handoff payload.

Payload fields: `run_id`, `role`, `outcome` (`registered` / `rejected`), `gate_failed` (only on rejection — one of `extraction-signals`, `boundary-edit`, `new-specialist`), `boundary_edits` (list of adjacent-specialist paths that received `DO NOT TRIGGER` clauses, only on success), `proposed_path` / `live_path` (for traceability), and `refinement_options` (only on rejection).
