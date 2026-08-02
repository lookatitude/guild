---
name: guild-create-skill
description: Gated mint of a NEW skill — the capability parallel to `guild:create-specialist` for skills, not agents; what phase-aware composition (G-PHASE-COMPOSE) / `guild:team-compose` takes when a phase needs a missing CAPABILITY, not a role. Interview → draft under `.guild/skills/proposed-<name>/` → boundary scan with `DO NOT TRIGGER` edits gated via `guild:evolve-skill` → paired evals + shadow mode → register within `.guild/`. Creation authority is human-requested (explicit request or team-compose option A; no historical extraction prerequisite) or evolution-proposed (all `§11.2.1` signals required). TRIGGER for "create a new skill for <capability>", "mint a skill for a capability gap", "write a new skill from scratch for <X>", "phase-compose flagged a skill gap — create the skill". DO NOT TRIGGER for minting a specialist/agent (`guild:create-specialist`), evolving or re-tuning an existing skill (`guild:evolve-skill`), composing a team (`guild:team-compose`), or rolling back a skill (`guild:rollback-skill`).
when_to_use: An explicit human request for a new capability, OR a phase-aware composition pass (G-PHASE-COMPOSE) detects a missing CAPABILITY rather than a missing role, OR `guild:team-compose`'s gap-handling option A surfaces a skill (not agent) gap, OR `§11.2.1`-style extraction signals show a recurring capability gap across ≥3 runs with no existing skill covering it. Not for evolving an existing skill (`guild:evolve-skill`) or minting a specialist (`guild:create-specialist`).
type: meta
---

# guild:create-skill

Implements the **G-CREATE-SKILL** capability from the phase-aware-composition ADR (`dynamic-team-composition.md` OD-3 §2) — a first-class `create-skill` meta-skill parallel to `guild:create-specialist`. It mints a **new skill** the way `create-specialist` mints a new agent, reusing the same paired-evals + shadow-mode gate and the same DH-3 incubation discipline. It fills the gap the ADR names: dynamic composition could mint a missing *role* but had no gated path to acquire a missing *capability*.

The dividing line:
- **Missing role** (a new domain owner that routes by `subagent_type`) → `guild:create-specialist`.
- **Missing capability** (a new reusable method/workflow any agent or the orchestrator invokes) → **this skill**.
- **Existing skill needs improvement** (body or description) → `guild:evolve-skill`.

Skills are not minted on a hunch. For evolution-proposed creation the historical extraction signals (below) must agree before this skill proceeds past step 2, and on **every** authority the new skill must pass **two gates** — boundary-edit evals via `guild:evolve-skill`, then its own paired evals + shadow mode — before moving from `.guild/skills/proposed-<name>/` to a live `.guild/skills/<name>/`.

## Creation authority (load-bearing)

Classify the request before step 1 and record one authority in the creation run. This mirrors `guild:create-specialist`'s split exactly — one vocabulary across both meta-skills:

- **Human-requested** — the user directly asks for the capability, or explicitly selects `guild:team-compose` option A for a surfaced capability gap. An explicit human request **does not require historical extraction evidence**: a genuinely new capability cannot have prior runs, reflections, or gap records. It still must pass the interview, boundary scan, every applicable adjacent-boundary gate, and the new-skill paired eval gate before registration.
- **Evolution-proposed** — evolution, reflection, or cross-run analysis proposes the capability without a current explicit creation request. The historical extraction signals below **must all pass** before the workflow proceeds past draft, and historical shadow replay remains required.

Human authority waives **only** the two historical thresholds — (1) recurring gap across ≥3 unrelated tasks/phases and (4) ≥3 reflections / phase-compose gap records. It waives nothing else. The **reuse/boundary** gate (2 — distinct triggers plus at least one adjacent skill needing a `DO NOT TRIGGER` clause; without it the request is really an edit to an existing skill and routes to `guild:evolve-skill`), the **one-off** gate (3), the **eval-derivability** gate (5), and step 6's paired evals + description optimizer stay mandatory on both authorities.

Write `.guild/evolve/<run-id>/extraction-check.json` on both paths. On the human-requested path it carries `creation_authority: human-requested` and `status: not_required` — **do not invent historical counts**. The interview and boundary scan must still yield at least 3 positive and 3 negative cases for the prospective paired eval gate.

## Input

Captured via the step-1 interview (ask until all are captured; do not guess). Field-by-field detail in `workflow.md`:

- **skill name** — the `name:` slug (`guild-<verb-or-noun>`), single hyphenated token.
- **description** — one-paragraph `description:` (≤1024 chars) with **≥3 trigger phrasings** plus a TRIGGER + DO NOT TRIGGER clause (the skill-authoring contract — routable at draft time).
- **when_to_use** — the routing precondition (one or two sentences).
- **tier placement** — which taxonomy tier (`core` / `meta` / `knowledge` / `specialists`) the skill belongs in; decides the proposed register path.
- **typical prompts** — 3–5 routing utterances → the `should_trigger` evals.
- **example outputs** — 1–3 concrete artifacts/body outline the skill produces → the body + `should_not_trigger` boundary cases.
- **adjacent skills** — skills whose triggers overlap (seeds the step-3 boundary scan and the step-4 `DO NOT TRIGGER` edits).

## DH-3 mint contract (load-bearing)

Everything this skill writes lands in the **consuming repo's `.guild/`** — **never** the read-only plugin install dir (a runtime write into plugin install state is the **v2 DH-3 defect**, identical to the constraint `create-specialist` enforces):

- **Draft** → `.guild/skills/proposed-<name>/SKILL.md` + `evals.json`, stamped **at draft time** with `derived_from_template: guild.skill_template.v1` (canonical base: `templates/skills/SKILL.template.md`; the template file itself carries no `derived_from` stamp — only instances do).
- **Incubate** → files stay under `proposed-<name>/` until both gates pass. The orchestrator and `guild:team-compose` resolve live skills only; `.guild/skills/proposed-*/` is **never** a routable candidate.
- **Register** → a **move within `.guild/`**: `.guild/skills/proposed-<name>/` → `.guild/skills/<name>/`. Register is a move, not a rewrite — the `derived_from_template` stamp is preserved unchanged. Writing into `plugin/skills/**` at runtime is the explicit **v2 DH-3 defect** and is never done here.

**Same-session constraint** (normative; applies to skills by the same mechanism as specialists): Claude Code loads plugin/project skills at session start; a skill registered mid-session is **not** discoverable via the Skill tool's available-skills list in that session.

- **Default (defer to next session):** after step 7, tell the user: _"New skill registered at `.guild/skills/<name>/`. Restart Claude Code for it to become routable."_
- **Degraded same-session path (opt-in only; deprecated-pending-D11):** if the user explicitly acknowledges the constraint and requests immediate use, inject the skill's `SKILL.md` body path directly into the dispatched agent's task prompt (no `Skill`-tool routing). Log this as `degraded: true` in the step-7 handoff and in `.guild/evolve/<run-id>/proposed-<name>-registered.md`. Consequence: TRIGGER/DO NOT TRIGGER routing is bypassed, and because the body rides as unhashed prompt text it is neither carried by the transport nor bindable to a receipt.

  **Successor (not yet shipped — do not assume it exists):** decision D11 (injection contract versioning) settles the transport half as a **first-class pinned skill-bundle injection** — the definition + skill bundle rides as an **additive optional field on the existing `spawn` request under contract major 1** (no new `ExecutionOperation`, no `transports.v2`), with ports declaring injection support explicitly and the runtime **refusing** (`unsupported` / `capability_absent`) rather than silently dispatching a stripped request. When that lands, it supersedes this degraded path. Until then the degraded path is still the only same-session mechanism and remains supported; treat it as deprecated-pending-D11, not removed.

## 7-step workflow

Seven ordered steps, each gate passing before the next runs. Full procedure — step-3 boundary-scan method and the step-4/5 adjacent-edit + evolve-gate flow — in `workflow.md`:

1. **Interview** — capture the Input fields; do not invent a capability on the user's behalf.
2. **Draft** — write `.guild/skills/proposed-<name>/SKILL.md` + `evals.json` (see DH-3 mint contract). Frontmatter must already satisfy the authoring contract (`name`, `description` ≤1024 chars with ≥3 trigger phrasings, `when_to_use`, `type`).
3. **Boundary scan** — description/trigger similarity between the draft and all existing shipped `plugin/skills/**/SKILL.md` + project `.guild/skills/*/SKILL.md` descriptions; flag overlaps above threshold (cosine ≥ 0.75, or token-Jaccard ≥ 0.35 fallback) as the adjacent-skill set.
4. **Propose adjacent-boundary edits** — append a `DO NOT TRIGGER for: <new-capability>` clause to each adjacent skill's `description` so it stops stealing the new skill's triggers.
5. **Gate boundary edits** — each edit runs through `guild:evolve-skill` paired evals (A = adjacent skill as-is, B = with the clause). A failing edit stops the workflow.
6. **Gate new skill** — paired evals (A = no-skill baseline, B = proposed skill) always run and always gate. Shadow-mode runs over `.guild/runs/*/` are **required for evolution-proposed** creation; for human-requested creation, replay any applicable corpus that exists, but an empty or irrelevant `.guild/runs/*/` corpus is recorded as `not_applicable` and is not a registration blocker (a fresh project has no runs — without this the waiver would be vacuous on exactly the projects it exists to serve). Also run the **description optimizer** so the final description stays ≤1024 chars with ≥3 trigger phrasings.
7. **Register** — on both gates passing, move files live within `.guild/` (see DH-3 mint contract), commit the step-5 boundary edits, and refresh the derived registry projection: `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/roster-resolve.ts --cwd . --write-registry --quiet` (`.guild/skills/registry.yaml` is a generated index of the `SKILL.md` tree — never hand-maintained). From this point the skill is discoverable to `guild:team-compose` (roster-resolve `project_skills`) and loadable by lanes (specialist prompts direct project-skill loading from `.guild/skills/<name>/SKILL.md`); project-local skills are not host-autoloaded.

## Extraction signals (§11.2.1 — historical thresholds apply to evolution-proposed only)

Adapt the `§11.2.1` thresholds from role-minting to capability-minting — for evolution-proposed creation all five must agree before minting proceeds past step 2; if any is missing, stop and report which (detail in `workflow.md`): (1) the same capability gap recurs across ≥3 unrelated tasks/phases (walk `.guild/runs/*/summary.md` + reflections + `team.<phase>.yaml` gap notes); (2) the capability has distinct triggers + at least one adjacent skill needing a `DO NOT TRIGGER` clause (otherwise it is an edit to an existing skill — route to `guild:evolve-skill`, not here); (3) the capability is reusable (not a one-off task step — a one-off belongs inline in a lane, not as a skill); (4) the same proposed capability appears in ≥3 reflections / phase-compose gap records; (5) ≥3 positive + ≥3 negative eval cases derivable. Record the check at `.guild/evolve/<run-id>/extraction-check.json`.

Gates **2, 3 and 5 are not history gates** and stay mandatory on both authorities — they are the reuse, one-off and eval-derivability checks. Only (1) and (4) are waived by human authority. For human-requested creation, write the same artifact with `creation_authority: human-requested` and `status: not_required`; do not invent historical counts.

## Failure handling

If any gate fails, **stop and surface refinement options to the user** — do not silently archive. A rejected skill is a design question, not an eval artifact. Surface **which gate failed**, **the specific evidence**, and **refinement options** (narrow the trigger description, add/remove adjacent-boundary clauses, re-interview, relocate to a different tier, or abandon). The user chooses; this skill does not pick. Write `.guild/evolve/<run-id>/proposed-<name>-rejected.md` with the full gate outcomes so the rejection is re-openable.

## Handoff

Emit a `handoff` block naming the creation run and gate outcome:

- On **success** (step 7 completes): confirm registration (live `.guild/skills/<name>/` path), list the new skill + the boundary edits applied to adjacent skills, and note the skill is routable next session (or `degraded: true` if the same-session path was taken).
- On **failure** (any gate): write `.guild/evolve/<run-id>/proposed-<name>-rejected.md` with the gate outcomes and surface refinement options.

Payload fields: `run_id`, `skill_name`, `tier`, `creation_authority` (`human-requested`/`evolution-proposed`), `outcome` (`registered`/`rejected`), `gate_failed` (rejection only — one of `extraction-signals`, `boundary-edit`, `new-skill`; `extraction-signals` applies only to evolution-proposed creation), `boundary_edits` (success only — adjacent-skill paths that received `DO NOT TRIGGER` clauses), `proposed_path`/`live_path` (traceability), `degraded` (bool, success only), and `refinement_options` (rejection only).
