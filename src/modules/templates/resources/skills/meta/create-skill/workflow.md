# create-skill — full procedure, boundary scan & extraction signals

Detail for `guild:create-skill`. Implements the **G-CREATE-SKILL** capability from `dynamic-team-composition.md` OD-3 §2, mirroring `guild:create-specialist` and reusing the evolve/shadow gate. The SKILL.md carries the summary + DH-3 mint contract; this file carries the step-by-step procedure.

## Creation authority

Classify and record exactly one authority before the interview:

- **Human-requested** — the user directly requested the capability, or explicitly approved option A for a team-compose capability gap. Human-requested skills do not require historical runs, reflections, or prior gap records. They still run the full interview and boundary scan, every applicable boundary-edit gate, and the new-skill gate before Register.
- **Evolution-proposed** — reflection, evolution, or cross-run analysis proposed the capability without a current explicit creation request. All historical extraction signals below are mandatory.

Human authority waives **only** extraction signals 1 (recurring gap across ≥3 unrelated tasks/phases) and 4 (≥3 reflections / phase-compose gap records). Signals 2 (distinct triggers + an adjacent skill needing a `DO NOT TRIGGER` clause), 3 (reusability) and 5 (≥3 positive + ≥3 negative eval cases derivable) are not history gates and remain mandatory on both authorities, as does the step-6 paired-eval gate.

If a human-requested skill has no applicable historical corpus, do not fabricate history and do not call the creation an override. The prospective paired evals are the gate; the absence of an applicable historical corpus alone does not block registration.

## Input fields (step-1 interview)

Capture all fields before drafting (ask the user until complete; do not guess — a skill is a routing surface, not a throwaway helper):

1. **skill name** — the `name:` slug, single hyphenated token (`guild-<verb-or-noun>`, e.g. `guild-api-contract-lint`). Decides the proposed directory `proposed-<name>/`.
2. **description** — one-paragraph `description:` (≤1024 chars) carrying **≥3 distinct trigger phrasings** + a `TRIGGER` clause + a `DO NOT TRIGGER` clause. This is the routing contract; it must be drafted to the same standard skill-author applies to every shipped skill.
3. **when_to_use** — the routing precondition (when in a workflow/lifecycle this skill should fire).
4. **tier placement** — `core` / `meta` / `knowledge` / `specialists`. Determines the live register path and the surrounding conventions to imitate.
5. **typical prompts** — 3–5 user/orchestrator utterances that should route here → the `should_trigger` side of the new skill's paired evals.
6. **example outputs** — 1–3 concrete artifacts or a body outline the skill produces → feeds the body and the `should_not_trigger` boundary cases.
7. **adjacent skills** — skills whose triggers plausibly overlap → seeds the step-3 boundary scan and the step-4 `DO NOT TRIGGER` edits.

## 7-step workflow

Each step's gate must pass before the next runs.

1. **Interview.** Record `creation_authority` and capture the Input fields. If any is missing or underspecified, ask until complete. Do not invent a capability on the user's behalf.

2. **Draft.** Write the proposed files under the incubation path **in the consuming repo's `.guild/`** — never the plugin install dir (a runtime write into plugin install state is the **v2 DH-3 defect being fixed**):
   - `.guild/skills/proposed-<name>/SKILL.md` — frontmatter (`name`, `description`, `when_to_use`, `type`, and `derived_from_template: guild.skill_template.v1` stamped **at draft time**) + body following the conventions of shipped skills in the chosen tier.
   - `.guild/skills/proposed-<name>/evals.json` — ≥3 `should_trigger` + ≥3 `should_not_trigger` cases, derived from the step-1 typical-prompts and adjacent-skill boundaries.

3. **Boundary scan.** Compute description/trigger similarity between the draft `description` and all existing shipped `plugin/skills/**/SKILL.md` + project `.guild/skills/*/SKILL.md` frontmatter descriptions. Flag any overlap above threshold (cosine ≥ 0.75 on description embeddings, or naive token-Jaccard ≥ 0.35 as a fallback). The flagged list is the adjacent-skill set. Note the contrast with `create-specialist`'s scan: it compares **role-routing** descriptions across agents; this compares **trigger-routing** descriptions across skills.

4. **Propose adjacent-boundary edits.** For each adjacent skill, draft an append-only edit to its `description`: a `DO NOT TRIGGER for: <new-capability>` clause naming the new skill's domain. This keeps the adjacent skills from stealing the new skill's triggers once it ships.

5. **Gate boundary edits.** Each proposed edit from step 4 runs through `guild:evolve-skill` as its own paired-evals run (A = adjacent skill as-is, B = adjacent skill with the `DO NOT TRIGGER` clause). The gate verifies the adjacent skill still triggers correctly for its own domain but no longer matches the new skill's triggers. Any edit that fails its evolve gate stops this workflow (see Failure handling).

6. **Gate new skill.** Paired evals on the new skill itself (A = no-skill baseline, B = proposed skill) always run and always gate, on at least 3 positive and 3 negative cases. For evolution-proposed creation, follow with shadow-mode runs over the historical runs in `.guild/runs/*/` that supplied the extraction evidence, to surface boundary collisions and trigger-accuracy issues before live routing; paired evals and shadow replay must both pass. For human-requested creation, replay any applicable historical runs from `.guild/runs/*/` when present; if the corpus is empty or none apply, record shadow replay as `not_applicable`. Missing history is not a failure on the human-requested path, but the paired eval gate remains mandatory. Run the **description optimizer** to confirm the final `description` is ≤1024 chars with ≥3 trigger phrasings.

7. **Register.** On both gates passing, move the files **within `.guild/`**: `.guild/skills/proposed-<name>/` → `.guild/skills/<name>/`. Register is a move, not a rewrite — the `derived_from_template` stamp from step 2 is preserved unchanged. Commit the step-5 boundary edits to the adjacent skills. The skill is routable for subsequent sessions (see the same-session constraint in SKILL.md).

## Extraction signals (capability-minting adaptation of §11.2.1 — evolution-proposed only)

For evolution-proposed creation, five thresholds must **ALL** agree before minting proceeds past step 2. If any signal is missing, stop and report which — capabilities earn their slot, they are not granted on one task's enthusiasm. Human-requested creation does not run signals **1** and **4** as pass/fail gates: write `creation_authority: human-requested` + `status: not_required` to the extraction-check artifact and continue to the prospective gates. Signals **2**, **3** and **5** are prospective, not historical, and are gated on both authorities:

1. **Recurring gap.** The same capability gap appears across ≥3 unrelated tasks/phases (walk `.guild/runs/*/summary.md`, `.guild/reflections/*.md`, and per-phase `team.<phase>.yaml` gap notes for co-occurrence).
2. **Distinct triggers + boundaries.** The capability needs trigger rules that don't fit an existing skill's description, AND at least one adjacent skill needs a `DO NOT TRIGGER` clause — otherwise it is an **edit to an existing skill** and routes to `guild:evolve-skill`, not here.
3. **Reusability.** The capability is a reusable method/workflow, not a one-off task step. A one-off belongs inline in a lane; a skill is a surface re-invoked across tasks.
4. **≥3 reflections or phase-compose gaps.** The same proposed capability appears in ≥3 records (`proposals.missing_skill` in reflections, or phase-composition gap notes).
5. **Enough eval cases.** ≥3 positive + ≥3 negative eval cases already derivable from the accumulated evidence (required to gate the skill in steps 5 and 6).

Record the signal-check result at `.guild/evolve/<run-id>/extraction-check.json` so the selected authority is auditable. Never synthesize historical evidence for a new human-requested capability.

## Incubation path

Proposed skills live under the consuming repo's `.guild/` at `.guild/skills/proposed-<name>/`. They stay there until both gates (step-5 boundary-edit gates + step-6 new-skill gate with shadow mode) pass. Only step-7 Register moves them into the live path (still **within `.guild/`**, never `plugin/skills/**`). The proposed tree is explicitly not loaded as a routable candidate until registered.

## Failure handling

If any gate fails, **stop and surface refinement options to the user** — do not silently archive and move on. A rejected skill is a design question, not an eval artifact.

Surface:

- **Which gate failed** (evolution-proposed extraction-signal shortfall, applicable boundary-edit evolve gate, or new-skill paired-evals / required shadow-mode gate).
- **The specific evidence** (missing extraction signal with count, failing eval case with trajectory, or shadow-mode collision with an adjacent skill).
- **Refinement options** — narrow the trigger description, add/remove adjacent-boundary clauses, relocate to a different tier, re-interview for a sharper Input, or abandon. The user chooses; this skill does not pick.

Write `.guild/evolve/<run-id>/proposed-<name>-rejected.md` with the full gate outcomes so the rejection is re-openable in a later iteration.

## Relationship to neighbours

- **`guild:create-specialist`** mints a new *agent/role*; this skill mints a new *capability/skill*. The ADR (alternative D) deliberately keeps them as two focused meta-skills rather than one parameterized `create-X`, because agent and skill mints have materially different boundary scans (role-routing vs trigger-routing) and register targets.
- **`guild:evolve-skill`** improves an *existing* skill (body or description) — it does not create one. A gap that is really "this existing skill should also handle X" is an evolve, not a create.
- **`guild:team-compose`** option A (auto-create) routes a *role* gap to `create-specialist` and a *capability* gap to this skill; the phase-aware composition loop (G-PHASE-COMPOSE) is the mid-lifecycle trigger.
