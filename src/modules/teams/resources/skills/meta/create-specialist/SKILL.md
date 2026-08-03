---
name: guild-create-specialist
description: Runs the §12 7-step workflow to mint a new shipping specialist — interview, draft under .guild/agents/proposed/, boundary scan, gate applicable adjacent-boundary edits, gate the new specialist, register live. Creation authority is either human-requested (an explicit request or approved team-compose option A; no historical extraction prerequisite) or evolution-proposed (all §11.2.1 historical extraction signals required). TRIGGER for "create a new Guild specialist for <domain>", "mint a data-scientist specialist", "add a new role — <role>", "incubate a proposed specialist for <domain>". DO NOT TRIGGER for minting a new skill/capability (guild:create-skill), evolving an existing specialist (guild:evolve-skill), composing a team for the current task (guild:team-compose), editing an existing agent's body (specialist-agent-writer dev agent), or rolling back a specialist (guild:rollback-skill).
when_to_use: An explicit human request, an operator-approved /guild:plan option A after a gap is flagged, OR an evolution/reflection proposal whose §11.2.1 extraction thresholds pass.
type: meta
---

# guild:create-specialist

Implements the specialist creation workflow (7 steps, with adjacent-boundary updates). This is the meta-skill that mints new shipping specialists — what `guild:team-compose`'s operator-approved option A delegates to when a spec surfaces a gap.

## Creation authority (load-bearing)

Classify the request before step 1 and record one authority in the creation run:

- **Human-requested** — the user directly asks for the role, or explicitly selects `guild:team-compose` option A for a surfaced gap. An explicit human request **does not require historical extraction evidence**: a genuinely new role cannot have prior runs, reflections, or gap records. It still must pass the interview, boundary scan, every applicable adjacent-boundary gate, and the new-specialist paired eval gate before registration.
- **Evolution-proposed** — evolution, reflection, or cross-run analysis proposes the role without a current explicit creation request. The historical extraction signals in §11.2.1 **must all pass** before the workflow proceeds past draft, and historical shadow replay remains required.

`force-register` is not a third authority and never bypasses the prospective gates. Human authority waives only the historical prerequisite, not role definition, routing safety, evals, or explicit approval.

## Input

Five fields, captured via the step-1 interview (ask until all five are captured; do not guess): **role name** (single noun phrase), **description** (one-paragraph responsibility, ≤1024 chars, TRIGGER + DO NOT TRIGGER clauses), **typical prompts** (3–5 routing utterances → the `should_trigger` evals), **example outputs** (1–3 concrete artifacts), **dependencies** (upstream/downstream specialists → the `opens_for:` conventions). Field-by-field detail in `workflow.md`.

## DH-3 mint contract (load-bearing)

Everything this skill writes lands in the **consuming repo's `.guild/`** — **never** the read-only plugin install dir (a runtime write into plugin install state is the **v2 DH-3 defect being fixed**):

- **Draft** → `.guild/agents/proposed/<role>.md` + `.guild/skills/proposed-<role>-*/`, each stamped **at draft time** with `derived_from_template: guild.agent_template.v2` / `guild.skill_template.v1` (template ids documented at https://guildstack.dev/docs/architecture).
- **Incubate** → files stay under `proposed/` until every applicable boundary-edit gate and the new-specialist gate pass. `guild:team-compose` reads `.guild/agents/*.md` (+ the shipped machinery agents and the `templates/specialists/*.md` type library), **never** `.guild/agents/proposed/*.md`.
- **Register** → a **move within `.guild/`**: `.guild/agents/proposed/<role>.md` → `.guild/agents/<role>.md`, and `.guild/skills/proposed-<role>-*/` → `.guild/skills/<role>-*/`. Register is a move, not a rewrite — the `derived_from_template` stamp is preserved unchanged. The v1 behavior (moving into `agents/<role>.md` / `skills/specialists/<role>-*/` in the plugin install dir) is the explicit **v2 DH-3 defect being fixed**.

**Host-registration constraint** (normative): hosts load agent definitions from the **plugin install** at session start — a project-local `.guild/agents/<role>.md` specialist is **never host-registered** (`Agent({ subagent_type: "<new-role>" })` will not resolve it, in this session or any later one). That is by design, not a defect: project specialists dispatch through the **definition-path mechanism** instead:

- `guild:team-compose` enumerates it via `roster-resolve.ts` and writes `definition: .guild/agents/<role>.md` + `definition_source: project` into the team file, carrying the specialist's own `default_tier` from its frontmatter.
- At dispatch, the in-process backend swaps `subagent_type` to the host-generic type and `buildPrompt` embeds the definition-adoption instruction (read the definition first; load its frontmatter `skills:` from `.guild/skills/<skill>/` where present). tmux/remote panes carry the same instruction in the pane prompt.
- The lane runs at the specialist's **own tier** (from frontmatter), is tracked under its role name (`GUILD_SPECIALIST`, receipts, env `GUILD_AGENT_DEFINITION`), and is fully usable **in the same session it was minted** — the former "degraded mid-tier, opt-in only" path is retired.

The only capability a project specialist lacks vs a shipped one is host-native description-based auto-routing (TRIGGER matching by the host); Guild's own composition and dispatch treat both sources identically.

## 7-step workflow (§12)

Seven ordered steps, each gate passing before the next runs. Full procedure — including the step-3 boundary-scan similarity method and the step-4/5 adjacent-boundary edit + evolve-gate flow — in `workflow.md`:

1. **Interview** — capture the five Input fields; do not invent a role on the user's behalf.
2. **Draft** — write the proposed files under `.guild/` (see DH-3 mint contract).
3. **Boundary scan** — description-similarity between the draft and all existing `templates/specialists/*.md` (the shipped type library — if a template already covers the domain, STOP: mint it via `roster-resolve.ts mint <role>` instead of creating a novel type) + machinery `agents/*.md` + `.guild/agents/*.md`; flag overlaps above threshold (cosine ≥ 0.75, or token-Jaccard ≥ 0.35 fallback) as the adjacent-specialist set.
4. **Propose adjacent-boundary edits** — append a `DO NOT TRIGGER for: <new-domain>` clause to each adjacent specialist's `description` (`§12.1` step 4).
5. **Gate boundary edits** — each edit runs through `guild:evolve-skill` paired evals (A = as-is, B = with the clause); a failing edit stops the workflow.
6. **Gate new specialist** — paired evals (A = no-specialist baseline, B = proposed) always run. Historical shadow replay is required for evolution-proposed creation; for human-requested creation, replay any applicable corpus that exists, but an empty or irrelevant historical corpus is recorded as `not_applicable` and is not a registration blocker.
7. **Register** — after every applicable boundary-edit gate and the new-specialist gate pass, move files live within `.guild/` (see DH-3 mint contract), commit any step-5 boundary edits. The new agent file's **existence** at `.guild/agents/<role>.md` IS its registration — `guild:team-compose` enumerates the live tree via `roster-resolve.ts` (ADR §4); there is no candidate list to append to. Then refresh the derived registry projections: `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/roster-resolve.ts --cwd . --write-registry --quiet` (`.guild/agents/registry.yaml` / `.guild/skills/registry.yaml` are generated indexes of the files — never hand-maintained, never the authority).

## Historical extraction signals (§11.2.1 — evolution-proposed only)

For evolution-proposed creation, five historical extraction signals **must all pass** before minting proceeds past step 2 — if any is missing, stop and report which (detail + how to walk the evidence in `workflow.md`): (1) recurring skill cluster across ≥3 unrelated tasks; (2) distinct triggers + at least one adjacent specialist needing a `DO NOT TRIGGER` clause; (3) context-isolation payoff (≥2k tokens domain context/task); (4) the same proposed role in ≥3 reflections / team-compose gap notes; (5) ≥3 positive + ≥3 negative eval cases derivable. Record the check at `.guild/evolve/<run-id>/extraction-check.json`.

For human-requested creation, write the same artifact with `creation_authority: human-requested` and `status: not_required`; do not invent historical counts. The interview and boundary scan must still yield at least 3 positive and 3 negative cases for the prospective paired eval gate.

## Failure handling

If any gate fails, **stop and surface refinement options to the user** — do not silently archive. A rejected specialist is a design question, not an eval artifact. Surface **which gate failed**, **the specific evidence**, and **refinement options** (narrow the trigger description, add/remove adjacent-boundary clauses, re-interview, or abandon). The user chooses; this skill does not pick. Write `.guild/evolve/<run-id>/proposed-<role>-rejected.md` with the full gate outcomes so the rejection is re-openable. (Full detail in `workflow.md`.)

## Handoff

Emit a `handoff` block naming the creation run and gate outcome:

- On **success** (step 7 completes): confirm registration (live paths for `.guild/agents/<role>.md` and `.guild/skills/<role>-*/`), list the new specialist + the boundary edits applied to adjacent specialists, and note `guild:team-compose` will enumerate the new agent from `.guild/agents/<role>.md` automatically (existence = registration; no candidate list).
- On **failure** (any gate): write `.guild/evolve/<run-id>/proposed-<role>-rejected.md` with the gate outcomes and surface refinement options.

Payload fields: `run_id`, `role`, `creation_authority` (`human-requested`/`evolution-proposed`), `outcome` (`registered`/`rejected`), `gate_failed` (rejection only — one of `extraction-signals`, `boundary-edit`, `new-specialist`; `extraction-signals` applies only to evolution-proposed creation), `boundary_edits` (success only — adjacent-specialist paths that received `DO NOT TRIGGER` clauses), `proposed_path`/`live_path` (traceability), and `refinement_options` (rejection only).
