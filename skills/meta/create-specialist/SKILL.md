---
name: guild-create-specialist
description: Runs the §12 7-step workflow to mint a new shipping specialist — interview, draft under .guild/agents/proposed/, boundary scan of existing .guild/agents/*.md, propose adjacent-boundary edits (DO NOT TRIGGER for new-domain), gate boundary edits via guild:evolve-skill, gate the new specialist via paired evals + shadow mode, register live. Minted only when §11.2.1 extraction signals agree (recurring gap across ≥3 runs, distinct triggers, sufficient context isolation, enough eval cases). TRIGGER for "create a new Guild specialist for <domain>", "mint a data-scientist specialist", "add a new role — <role>", "incubate a proposed specialist for <domain>". DO NOT TRIGGER for minting a new skill/capability (guild:create-skill), evolving an existing specialist (guild:evolve-skill), composing a team for the current task (guild:team-compose), editing an existing agent's body (specialist-agent-writer dev agent), or rolling back a specialist (guild:rollback-skill).
when_to_use: Explicit user request, OR /guild:plan auto-create option (A) fires after a gap is flagged, OR §11.2.1 extraction thresholds fire (same skill cluster across ≥3 unrelated tasks with distinct trigger needs + recurring reflection gaps pointing to the same domain).
type: meta
---

# guild:create-specialist

Implements `guild-plan.md §12` (specialist creation with adjacent-boundary updates, 7-step workflow) gated by the `§11.2.1` extraction signals. This is the meta-skill that mints new shipping specialists — what `guild:team-compose`'s option A (auto-create) delegates to when a spec surfaces a gap.

Specialists are not minted on a hunch. The `§11.2.1` extraction signals must **ALL** agree before this skill proceeds past step 2, and even then the role must pass **two gates** — boundary evals via `guild:evolve-skill`, then its own paired evals + shadow mode — before moving from `.guild/agents/proposed/` to live `.guild/agents/`.

## Input

Five fields, captured via the step-1 interview (ask until all five are captured; do not guess): **role name** (single noun phrase), **description** (one-paragraph responsibility, ≤1024 chars, TRIGGER + DO NOT TRIGGER clauses), **typical prompts** (3–5 routing utterances → the `should_trigger` evals), **example outputs** (1–3 concrete artifacts), **dependencies** (upstream/downstream specialists → the `opens_for:` conventions). Field-by-field detail in `workflow.md`.

## DH-3 mint contract (load-bearing)

Everything this skill writes lands in the **consuming repo's `.guild/`** — **never** the read-only plugin install dir (a runtime write into plugin install state is the **v2 DH-3 defect being fixed**):

- **Draft** → `.guild/agents/proposed/<role>.md` + `.guild/skills/proposed-<role>-*/`, each stamped **at draft time** with `derived_from_template: guild.agent_template.v1` / `guild.skill_template.v1` (template ids resolved via `contract-map.md §A`; pointer: `templates-and-migration.md`).
- **Incubate** → files stay under `proposed/` until both gates pass. `guild:team-compose` reads `.guild/agents/*.md` (+ shipped `plugin/agents/*.md`), **never** `.guild/agents/proposed/*.md`.
- **Register** → a **move within `.guild/`**: `.guild/agents/proposed/<role>.md` → `.guild/agents/<role>.md`, and `.guild/skills/proposed-<role>-*/` → `.guild/skills/<role>-*/`. Register is a move, not a rewrite — the `derived_from_template` stamp is preserved unchanged. The v1 behavior (moving into `agents/<role>.md` / `skills/specialists/<role>-*/` in the plugin install dir) is the explicit **v2 DH-3 defect being fixed**.

**Same-session constraint** (normative): Claude Code loads plugin agents once at session start; a specialist registered mid-session is **never discoverable via `Agent({ subagent_type: "<new-role>" })`** in that session.

- **Default (defer to next session):** After step 7, tell the user: _"New specialist registered at `.guild/agents/<role>.md`. Restart Claude Code for the specialist to become available for team composition."_ Do not attempt same-session dispatch unless the user explicitly requests it.
- **Degraded same-session path (opt-in only):** If the user explicitly acknowledges the constraint and requests immediate use, inject the specialist's `.guild/skills/<role>-*/` skill paths into a generic `Agent()` call with no `subagent_type`. This path **must** be logged as `degraded: true` in the step-7 handoff payload and in `.guild/evolve/<run-id>/proposed-<role>-registered.md`. Consequence: TRIGGER/DO NOT TRIGGER routing is bypassed, model tier defaults to `mid`, and the specialist is not addressable by name in subsequent lanes of the same session.

## 7-step workflow (§12)

Seven ordered steps, each gate passing before the next runs. Full procedure — including the step-3 boundary-scan similarity method and the step-4/5 adjacent-boundary edit + evolve-gate flow — in `workflow.md`:

1. **Interview** — capture the five Input fields; do not invent a role on the user's behalf.
2. **Draft** — write the proposed files under `.guild/` (see DH-3 mint contract).
3. **Boundary scan** — description-similarity between the draft and all existing `plugin/agents/*.md` + `.guild/agents/*.md`; flag overlaps above threshold (cosine ≥ 0.75, or token-Jaccard ≥ 0.35 fallback) as the adjacent-specialist set.
4. **Propose adjacent-boundary edits** — append a `DO NOT TRIGGER for: <new-domain>` clause to each adjacent specialist's `description` (`§12.1` step 4).
5. **Gate boundary edits** — each edit runs through `guild:evolve-skill` paired evals (A = as-is, B = with the clause); a failing edit stops the workflow.
6. **Gate new specialist** — paired evals (A = no-specialist baseline, B = proposed) + shadow-mode runs over `.guild/runs/*/`; both must pass (shadow mode is part of the gate, not advisory).
7. **Register** — on both gates passing, move files live within `.guild/` (see DH-3 mint contract), commit the step-5 boundary edits. The new agent file's **existence** at `.guild/agents/<role>.md` IS its registration — `guild:team-compose` enumerates the live `.guild/agents/*.md` directory automatically (ADR §4); there is no candidate list to append to.

## Extraction signals (§11.2.1)

Five thresholds that must **ALL** agree before minting proceeds past step 2 — if any is missing, stop and report which (detail + how to walk the evidence in `workflow.md`): (1) recurring skill cluster across ≥3 unrelated tasks; (2) distinct triggers + at least one adjacent specialist needing a `DO NOT TRIGGER` clause; (3) context-isolation payoff (≥2k tokens domain context/task); (4) the same proposed role in ≥3 reflections / team-compose gap notes; (5) ≥3 positive + ≥3 negative eval cases derivable. Record the check at `.guild/evolve/<run-id>/extraction-check.json`.

## Failure handling

If any gate fails, **stop and surface refinement options to the user** — do not silently archive. A rejected specialist is a design question, not an eval artifact. Surface **which gate failed**, **the specific evidence**, and **refinement options** (narrow the trigger description, add/remove adjacent-boundary clauses, re-interview, or abandon). The user chooses; this skill does not pick. Write `.guild/evolve/<run-id>/proposed-<role>-rejected.md` with the full gate outcomes so the rejection is re-openable. (Full detail in `workflow.md`.)

## Handoff

Emit a `handoff` block naming the creation run and gate outcome:

- On **success** (step 7 completes): confirm registration (live paths for `.guild/agents/<role>.md` and `.guild/skills/<role>-*/`), list the new specialist + the boundary edits applied to adjacent specialists, and note `guild:team-compose` will enumerate the new agent from `.guild/agents/<role>.md` automatically (existence = registration; no candidate list).
- On **failure** (any gate): write `.guild/evolve/<run-id>/proposed-<role>-rejected.md` with the gate outcomes and surface refinement options.

Payload fields: `run_id`, `role`, `outcome` (`registered`/`rejected`), `gate_failed` (rejection only — one of `extraction-signals`, `boundary-edit`, `new-specialist`), `boundary_edits` (success only — adjacent-specialist paths that received `DO NOT TRIGGER` clauses), `proposed_path`/`live_path` (traceability), and `refinement_options` (rejection only).
