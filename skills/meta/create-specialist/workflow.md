# 7-step workflow, boundary scan & extraction signals — full procedure

Detail for `guild:create-specialist`. Implements `guild-plan.md §12` gated by `§11.2.1`. The SKILL.md carries the summary + DH-3 mint contract; this file carries the step-by-step procedure.

## Input fields (step-1 interview)

Five fields, captured via the interview in step 1 (ask the user until all five are captured; do not guess):

1. **Role name** — a single noun phrase, e.g. `data-scientist`, `frontend-engineer`, `ux-writer`.
2. **Description** — one-paragraph responsibility statement, suitable for the agent file's frontmatter `description` (≤1024 chars, TRIGGER + DO NOT TRIGGER clauses required).
3. **Typical prompts** — 3–5 example user utterances that should route to this specialist. Feed the `should_trigger` side of the new specialist's paired evals.
4. **Example outputs** — 1–3 concrete artifacts (file shapes, deliverable types, handoff payloads) this specialist produces. Feeds the body of the agent file and the per-skill evals under `.guild/skills/proposed-<role>-*/`.
5. **Dependencies** — upstream specialists this role reads handoffs from, and downstream specialists that depend on its output. Feeds the `opens_for:` conventions in the agent's handoff contract.

## 7-step workflow (§12)

Seven ordered steps. Each step's gate must pass before the next runs.

1. **Interview.** Capture the five Input fields above. If any is missing or underspecified, ask the user until all five are complete. Do not invent a role on the user's behalf — specialists are too heavy to conjure.

2. **Draft.** Write the proposed files under the incubation path **in the consuming repo's `.guild/`** — never the plugin install dir (a runtime write into plugin install state is the **v2 DH-3 defect being fixed**):
   - `.guild/agents/proposed/<role>.md` — frontmatter (`name`, `description`, `when_to_use`, `model`, and `derived_from_template: guild.agent_template.v1` stamped **at draft time**) + body (responsibilities, superpowers, handoff contract, scope boundaries per the conventions in existing shipped `plugin/agents/*.md` + project `.guild/agents/*.md`).
   - `.guild/skills/proposed-<role>-*/` — 2–5 specialist skills covering the role's distinct activities. Each skill has its own `SKILL.md` (with `derived_from_template: guild.skill_template.v1` stamped **at draft time**) + `evals.json`.

3. **Boundary scan.** Compute description-similarity between the draft agent's `description` and all existing shipped `plugin/agents/*.md` + project `.guild/agents/*.md` frontmatter descriptions. Flag any overlap above the threshold (e.g. cosine ≥ 0.75 on description embeddings, or naive token-Jaccard ≥ 0.35 as a fallback). The flagged list is the adjacent-specialist set.

4. **Propose adjacent-boundary edits.** For each adjacent specialist, draft an append-only edit to its `description`: `DO NOT TRIGGER for: <new-specialist-domain>` (one short clause identifying the new domain and referencing the proposed role). Per `§12.1` step 4, these edits keep the adjacent specialists from continuing to steal the new specialist's triggers once it ships.

5. **Gate boundary edits.** Each proposed boundary edit from step 4 runs through `guild:evolve-skill` as its own paired-evals run (A = adjacent specialist as-is, B = adjacent specialist with the DO NOT TRIGGER clause appended). The gate verifies the adjacent specialist still triggers correctly for its own domain but no longer matches the new specialist's triggers. Any boundary edit that fails its evolve gate stops this workflow (see Failure handling).

6. **Gate new specialist.** Paired evals on the new specialist itself (A = no-specialist baseline, B = proposed specialist), followed by shadow-mode runs on historical specs from `.guild/runs/*/` to surface boundary collisions and trigger-accuracy issues before live routing. Both must pass; shadow mode is not advisory here, it's part of the gate.

7. **Register.** On both gates passing, move the files **within `.guild/`** in the consuming repo: `.guild/agents/proposed/<role>.md` → `.guild/agents/<role>.md` and `.guild/skills/proposed-<role>-*/` → `.guild/skills/<role>-*/`. Register is a move, not a rewrite — the `derived_from_template` stamp drafted in step 2 is preserved through register-live unchanged. Commit the boundary edits to the adjacent specialists (from step 5). Add the new role to `guild:team-compose`'s candidate list. The new specialist is live for subsequent `/guild` tasks. The v1 behavior — moving into `agents/<role>.md` / `skills/specialists/<role>-*/` in the plugin install dir — is an explicit **v2 DH-3 defect being fixed**: the plugin install dir is never written at runtime.

   **Restart required.** Claude Code loads plugin agents once at session start. A specialist created during a running session is NOT available for dispatch via `Agent({ subagent_type: "<new-role>" })` until Claude Code is restarted. Inform the user: "New specialist registered at `.guild/agents/<role>.md`. Restart Claude Code for the specialist to become available in team composition." As a same-session workaround, the specialist's skills can be injected into a generic `Agent()` call by explicitly listing the skill paths in the task prompt — this does not require restart but loses the agent's TRIGGER/DO NOT TRIGGER routing.

## Extraction signals (§11.2.1)

Five thresholds that must **ALL** agree before minting proceeds past step 2. If any signal is missing, stop and report which — specialists earn their slot, they don't get granted on one task's enthusiasm.

1. **Recurring cluster.** The same skill cluster appears across ≥3 unrelated tasks (walk `.guild/runs/*/summary.md` + reflections for co-activation evidence).
2. **Distinct triggers + boundaries.** The cluster needs trigger rules that don't fit an existing specialist's description, AND at least one adjacent specialist needs a `DO NOT TRIGGER` boundary clause (otherwise the cluster is a skill edit, not a specialist).
3. **Context isolation payoff.** The cluster consumes enough context per task that isolating it into its own specialist improves focus (e.g. ≥2k tokens of domain-specific context per task, or a specialist-specific wiki page set).
4. **≥3 reflections or team-compose gaps.** Walk `.guild/reflections/*.md` `proposals.missing_specialist` and `.guild/team/*.yaml` gap notes — the same proposed role must appear in ≥3 records.
5. **Enough eval cases.** ≥3 positive + ≥3 negative eval cases already derivable from the accumulated evidence (required to gate the role in steps 5 and 6).

Record the signal-check result at `.guild/evolve/<run-id>/extraction-check.json` so the gate is auditable.

## Incubation path

Proposed specialists live under the consuming repo's `.guild/` at `.guild/agents/proposed/<role>.md` and `.guild/skills/proposed-<role>-*/`. They stay in `proposed/` until both gates (step 5 boundary-edit gates + step 6 new-specialist gate with shadow mode) pass. Only step 7's Register moves them into live paths (still **within `.guild/`**). The proposed tree is explicitly not loaded by `guild:team-compose` as a candidate until registered — `guild:team-compose` reads `.guild/agents/*.md` (+ shipped `plugin/agents/*.md`), never `.guild/agents/proposed/*.md`.

## Failure handling

If any gate fails, **stop and surface refinement options to the user** — do not silently archive and move on. A rejected new specialist is a design question, not an eval artifact.

Surface:

- **Which gate failed** (extraction-signal shortfall, boundary-edit evolve gate, or new-specialist paired-evals / shadow-mode gate).
- **The specific evidence** (missing extraction signal with count, failing eval case with trajectory, or shadow-mode collision with adjacent specialist).
- **Refinement options** — narrow the role's trigger description, add/remove adjacent-boundary clauses, re-interview for a sharper Input, or abandon the proposal. The user chooses; this skill does not pick for them.

Write `.guild/evolve/<run-id>/proposed-<role>-rejected.md` with the full gate outcomes so the rejection is re-openable in a later iteration.
