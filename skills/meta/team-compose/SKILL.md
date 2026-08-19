---
name: guild-team-compose
description: Match spec domains against the consuming repo's project specialists (`.guild/agents/*.md`, reused never re-created) AND Guild's shipped specialist TYPE templates (minted into `.guild/agents/` via roster-resolve mint); present existing + gaps with A/B/C/D options, propose the FULL justified logical team — task-derived, UNCAPPED, with necessity rationale + excluded roles (`guild.team_proposal.v2`) — then WAIT at the `guild.team_decision.v1` user gate (approve / restructure: add, remove, substitute, edit dependencies) before any dispatch, assign each specialist a `default_tier` from its frontmatter, derive an optional `capability_scope:` (absent ⇒ no scoping), and write the per-phase `.guild/team/<slug>.<phase>.yaml`. TRIGGER on "propose a team", "who should work on this", "compose specialists for the spec", "compose this phase's team". DO NOT TRIGGER for: writing the code (execute-plan), creating a new specialist TYPE for Guild itself (guild:create-specialist), reviewing completed work (guild:review).
when_to_use: Second step of the `/guild` lifecycle, after `guild:brainstorm` has produced `.guild/spec/<slug>.md`. Also fires when the user asks to reshape an existing team (e.g. "rework the team for this task", "swap the qa slot for security").
type: meta
---

# guild:team-compose

Implements team composition **and the phase-aware composition loop** (G-PHASE-COMPOSE) from the canonical-specialist-roster ADR's sibling `dynamic-team-composition.md`. Composition is **re-evaluated at each phase boundary**, not once per slug: each phase writes its own `.guild/team/<slug>.<phase>.yaml`. Output is a resolved per-phase team file downstream planning and execution consume verbatim (resolved via `resolveTeamFile`).

## Phase-aware composition (per phase)

`team-compose` runs a **phase-composition pass** at each phase boundary (`init → ideate → plan → build → qa → ops`). It is no longer a one-shot artifact — the team for `ideate` ≠ the team for `build` ≠ the team for `ops`.

**The loop** (ADR §1, made operational):

```
phase_P   := readActivePhase(cwd)              # T1: scripts/lib/team-file.ts — run-state authority, NEVER inferred from chat
topic_P   := the phase's working topic         # spec domains for ideate/plan; plan lanes for build;
                                               #   CodebaseMap+plan signals for qa; runbook class for ops
needed_P  := analyse(topic_P)                   # { required_agent_roles, required_skills }
have_P    := roster-resolve(cwd)                 # CODE-BACKED enumeration (ADR §4 / D4): run
                                                 #   npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/roster-resolve.ts --cwd .
                                                 # and consume its guild.roster.v1 JSON — project instances
                                                 # (.guild/agents/*.md + project .guild/skills/*) PLUS `templates`
                                                 # (the shipped type library, templates/specialists/*.md),
                                                 # NEVER a hand-maintained list, NEVER a model-side directory walk
mintable_P := needed_P ∩ templates − instances   # template covers the domain, no instance yet
for each mintable: MINT deterministically — npx tsx .../roster-resolve.ts mint <role> --cwd .
gaps_P    := needed_P − have_P − mintable_P      # covered by NEITHER an instance NOR a template
for each gap: recommend A create (→ create-specialist | create-skill, HUMAN-AUTHORIZED + PROSPECTIVELY GATED) / B skip / C substitute / D compose-from-scratch
proposal_P := propose(needed_P ∩ have_P, approved creations)   # FULL justified logical team — UNCAPPED,
                                                 #   every participant with necessity_rationale,
                                                 #   considered-but-excluded roles recorded (guild.team_proposal.v2)
decision_P := user gate on proposal_P            # guild.team_decision.v1 — approve | restructure; BLOCKS until decided
write teamFilePath(guildRoot, slug, phase_P)     # .guild/team/<slug>.<phase>.yaml  (T1) — the APPROVED team only
writeCurrentPhasePointer(guildRoot, slug, phase_P)  # .guild/team/<slug>.current     (T1)
```

**NULL-PHASE GUARD (load-bearing).** If `readActivePhase(cwd)` returns `null`, **BLOCK** — surface a clear operator error: *"active phase not recorded for this run; phase-entry wiring must record it before a phase team can be composed"* — and write **nothing**. NEVER fabricate `team.null.yaml`, and never silently default to a phase: with phase-entry wiring in place, `null` at compose time signals a genuine defect (phase not recorded / corrupt run-state), so surfacing beats guessing the wrong phase's team.

**Guard-before-write ordering is mandatory.** Both `teamFilePath(...)` and `writeCurrentPhasePointer(...)` (T1) **THROW** on a null/non-canonical phase — by design, so a bad token can never become a filename (`readActivePhase` and `resolveTeamFile`, by contrast, *swallow* non-canonical → null). Therefore the write step (step 4) MUST call them **only after this guard has confirmed a canonical phase**. `readActivePhase` returns canonical-or-`null`, and this guard rejects `null`, so the writers only ever see a canonical token — do not remove or reorder the guard, or the write path will throw.

**Re-affirm is explicit, never silent.** A phase that needs the prior phase's team re-affirms it as a **surfaced no-op diff** to the operator — never silently reuses it.

**Per-phase team files.** `.guild/team/<slug>.<phase>.yaml` replaces the single `.guild/team/<slug>.yaml`. Each carries its own roster, tiers, scopes, dependencies, a `phase:` field, and a backend mirror. The legacy single-file `team.yaml` is honored **read-only** by `resolveTeamFile` (treated as the active phase's team) — this writer **never** overwrites, splits, or moves it.

## Input

- `.guild/spec/<slug>.md` — the approved spec. Its Goal, Success criteria, Constraints, and Non-goals sections are the authoritative source for domain matching for the `ideate`/`plan` phases. Do not infer domains from chat history outside the spec.
- **`phase`** — the active phase, read via `readActivePhase(cwd)` (T1, `scripts/lib/team-file.ts`) from run-state — the authority, never inferred. A `null` return triggers the NULL-PHASE GUARD above.
- **`topic_P`** — the phase's working topic (per the loop above): spec domains for `ideate`/`plan`; plan lanes for `build`; CodebaseMap + plan signals for `qa`; runbook class for `ops`.

## Workflow

Seven ordered steps (0–5, with the 3b proposal/decision gate between gap handling and the write), run **per phase** against `topic_P` (see `## Phase-aware composition`). The gap-handling options and approval shapes are detailed in `gap-handling.md`:

0. **Self-build check (first).** If the target repo IS the Guild plugin itself (editing `plugin/**` — skills, commands, hooks, scripts, agents, docs, manifests, tests), compose the team from the **dev-team agents enumerated from `.guild/agents/*.md`** — the filesystem IS the dev-team roster; the composer reads that live directory, **never a hand-maintained list** (same net rule as `§1` for the shipped roster). Every selected specialist carries the exact committed `definition_ref` returned by `definition-ref-for-dispatch.ts`; a missing or uncommitted ref blocks composition. Route by changed path (see `CLAUDE.md §"Dev team"` for the path→agent table). Do **not** match against the `guild:` product specialists — those build *user* products. Skip steps 1–3's product-roster matching and go to **step 3b** with the dev-team lanes — the proposal/decision gate is NEVER skipped: the dev-team roster is proposed as a full `guild.team_proposal.v2` and held for the user's `guild.team_decision.v1` before step 4 writes. (Uncapped composition and backend choice also still apply.)

1. **Match.** (Non-self-build.) Build the **available-specialist set** by running the roster resolver — `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/roster-resolve.ts --cwd .` — and consuming its `guild.roster.v1` JSON (`roster` = shipped ∪ project merged union; `templates` = the shipped specialist TYPE library; per-entry `name`, `definition`, `source`, `default_tier`, `skills`, `description`, `augmenting`). This is the code-backed D4 enumeration; never re-derive the set by walking directories yourself. **Filter out entries with `augmenting: true`** (`advisor`/`developer` — the machinery agents: they augment lanes and stay dispatchable, but are never product-roster candidates; after the machinery-vs-template-library ADR they are the ONLY shipped agents, so every domain candidate comes from (b) or (c)). Domain candidates are **(b)** the consuming repo's project specialists already minted under `.guild/agents/*.md` (the live tree only — the `.guild/agents/proposed/*` incubation tree is **never** a candidate, per `guild:create-specialist`'s incubation contract), and **(c)** the shipped **type templates** from the resolver's `templates` array (`templates/specialists/*.md` — architect, researcher, backend, frontend, devops, qa, mobile, security, copywriter, doc-writer, technical-writer, social-media, seo, marketing, sales — a derived snapshot; the files are the authority). An instance is a direct match; a template is a **mint candidate**. A project specialist minted on a previous task is **reused here, never re-created**.

2. **Classify** every matched domain three ways: *existing* — an already-minted `.guild/agents/*.md` instance (joins the team with **no creation step**); *mintable* — a shipped template covers the domain but no instance exists yet (**mint deterministically**: `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/roster-resolve.ts mint <role> --cwd .` — a byte-preserving instantiation stamped `derived_from_template`, NO create-specialist gates: templates are pre-blessed feedstock, and the CLI refuses if the instance already exists; append `--host-native` ONLY if the operator asked for host-native routing — it additionally projects the instance into `.claude/agents/<role>.md` (marker-stamped, never clobbers hand-authored files)); or *gap* — covered by **neither** an instance nor a template (gets a proposed role name + one-line description so the user sees exactly what option A would create).

3. **Present to user.** Show the matched existing specialists and the roles minted from templates this compose (each with one-line reasoning), and — for every genuine gap (agent **or** skill) — the four options **A · create / B · skip gap / C · substitute / D · compose from scratch** (full semantics, including the v2 DH-3 mint boundary, in `gap-handling.md`). **Per-phase gap analysis is the SOLE mid-lifecycle trigger into the GATED create path** (ADR §1): option A routes a *role* gap to `guild:create-specialist` or a *capability/skill* gap to `guild:create-skill`. For a role gap, selecting A is explicit human creation authority. A human-requested new role does not require historical extraction evidence, but it **must clear the prospective mint gates** (interview, boundary scan, applicable boundary evals, and new-role paired evals) before the phase team finalizes. Replay applicable historical traces when they exist; no applicable corpus is not itself a blocker. Capability gaps retain `guild:create-skill`'s own mint contract. On gate failure the phase falls back to B/C/D. There is no ungated mid-phase creation of a NOVEL type; template instantiation is not a novel type (the trigger boundaries were blessed when the template shipped).

3b. **Propose the full team and WAIT at the decision gate.** Assemble the **complete justified logical team** as an immutable `guild.team_proposal.v2` — every dispatchable participant of the phase (workers, advisors, challengers, local and cross-host reviewer slots alike; `participation_kind` distinguishes them, an advisory label never bypasses the gate), each with a non-empty `necessity_rationale` and `owned_obligations`, plus `excluded_roles` (`{role_ref, why_unnecessary}`) for every role considered but not proposed, and an obligation-coverage map (every obligation from success criteria, plan items, ownership boundaries, risks, implied rules, and review gates owns ≥1 participant OR an explicit user-accepted exclusion — an unowned obligation invalidates the proposal). Persist it under `.guild/runs/<run-id>/team-plan/` and **BLOCK until the user records a `guild.team_decision.v1`** — see `## Team decision gate (before any dispatch)`. Guild never auto-approves.
4. **Write** the resolved per-phase team — only after a current `approve` decision (`## Team decision gate`) and the applicable approval shape (see `gap-handling.md`) have cleared — to `teamFilePath(guildRoot, slug, phase)` = `.guild/team/<slug>.<phase>.yaml` (T1, `scripts/lib/team-file.ts`), then update the convenience pointer via `writeCurrentPhasePointer(guildRoot, slug, phase)` = `.guild/team/<slug>.current`. Each entry carries per-specialist scope and cross-specialist dependencies, plus a **mirror** of the snapshot-resolved execution backend (resolved at intake by `runStartPreflight`, not chosen here — see `## Execution backend`). **Honor the NULL-PHASE GUARD** (`## Phase-aware composition`): a `null` phase BLOCKS the write. **Never** overwrite, split, or move a legacy `.guild/team/<slug>.yaml` — it is read-only back-compat. Every specialist entry carries `definition:` + `definition_source:` copied from the roster-resolve JSON. Every project specialist also carries the exact compact JSON `definition_ref:` returned by `scripts/definition-ref-for-dispatch.ts`; a missing/uncommitted/mismatched ref blocks the team write. If step 3 minted anything (option A), refresh the derived registries afterwards: `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/roster-resolve.ts --cwd . --write-registry --quiet` (the registries are generated projections of the `.md` trees; the files stay the source of truth).

5. **Emit the companion `guild.team_plan.v1` (ADDITIVE, FAIL-SOFT — G6b-2b).** After the step-4 yaml write, ALSO emit a typed `team_plan` as a **companion** artifact. Steps 0–4 and every guard above (incl. the NULL-PHASE GUARD) are **UNCHANGED** — this step only ADDS the emit. The `.guild/team/<slug>.<phase>.yaml` stays the **AUTHORITATIVE** dispatch input; the team_plan is the machine-typed mirror (roster + the `advisory_panel` challenger trail + `fired_rules`) that downstream gates (quality/ops) and the benchmark can consume.
   - **Derive a `guild.station_signals.v1` signals block** from the phase's domain signals — the SIX signal keys `team-compose` already reasons about for implied specialists (`## Hard rules` + `team-composition.md §Implied Specialist Rules`): `multi_component`, `auth_touched`, `backend_present`, `user_facing_ui`, `public_docs`, `search_discoverability` (each a boolean; absent ⇒ false). **Do not invent new signals** beyond these six. Set `source_ref` to the spec/plan path the signals were read from. Serialise `{ "schema_version": "guild.station_signals.v1", "signals": {…}, "source_ref": "<spec/plan path>" }` (to a temp file or stdin).
   - **Station = the canonical phase token.** The composer's `STATIONS` cover the six lifecycle phases 1:1 (`init ideate plan build qa ops`, plus `research`/`definition`/`learn`), so the active phase **is** its station. If a phase has NO matching station (`isStation(<phase>)` is false), **SKIP the emit with a logged degradation note** — never fail. Otherwise invoke the CLI:
     ```
     npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/station-compose.ts <phase> --signals <signals.json|-> --cwd . --run-id <run-id> --emit
     ```
     It writes the typed `guild.team_plan.v1` (roster + `advisory_panel` + `fired_rules` + `fired_challenger_rules`) to `.guild/runs/<run-id>/team-plan/<phase>.json` (`scripts/station-compose.ts` → `station-signals.ts writeTeamPlan`).
   - **MIRROR, never a recompose.** The emitted team_plan (roster + `advisory_panel`) is a machine-typed **mirror of the approved proposal** — its participant set MUST equal the approved `guild.team_proposal.v2`'s. If the station CLI's output diverges (an extra/missing role vs. the approved set), do NOT dispatch the divergent entries: record the divergence as a degradation note and surface it to the user — adding a participant is a §4 invalidating change requiring a new proposal+decision cycle. *(Historical, CLOSED — do not act on it: through the v2.3 era the station CLI enforced a legacy `TEAM_CAP = 6` / `config.cap`, so an approved roster >6 diverged here by construction. Lane T2b RETIRED that runtime cap; the composer now rejects `cap`/`capped`/`dropped_roles`/`max_team_size`/`team_size` outright. A >6 roster no longer diverges for size reasons, so a divergence here is a REAL defect to surface — never expected, never rubber-stamped.)*
   - **FAIL-SOFT.** On ANY CLI error (non-zero exit, unknown station, malformed signals), write a one-line degradation-receipt note and **CONTINUE** — the yaml is authoritative, so a missing team_plan never breaks the run.
   - **Record the emitted `team_plan` path** (or the skip note) in the handoff receipt (`## Handoff`).

**Reuse, never re-create** is load-bearing: an existing `.guild/agents/*.md` instance joins with no creation step and no *creation* approval (the step-3b team decision gate still covers it like every participant); a template-covered domain mints its instance ONCE (the mint CLI exits `3` on an existing instance — that exit is your reuse signal, not an error). Only a gap covered by neither an instance nor a template can become a newly-created specialist (option A → `guild:create-specialist`) or skill (option A → `guild:create-skill`), and only with explicit per-role/per-skill approval that clears the mint gate.

## Hard rules

Non-negotiable; if a user request conflicts, raise it before writing `team.yaml`:

- **The logical team is task-derived and UNCAPPED** (dynamic-host-model-routing ADR; frozen `guild.team_proposal.v2` §2). There is NO hard specialist-count cap, NO default size target, and NO truncation/tail-drop path — propose EVERY specialist you can justify from the goal, phase work, dependencies, risk, ownership boundaries, and required review. A large task honestly yields a large team. *(Historical note: the v2.3-era composer enforced a cap of 6 with a 3–4 default — do not reintroduce it under any name.)* **Migration fence — CLOSED (past state, kept only so the history reads straight):** this rule once carried a temporary fence stating that the station-composer runtime still enforced the legacy `TEAM_CAP = 6` / `config.cap`, so an approved roster larger than 6 would produce a divergent step-5 runtime mirror. **Lane T2b landed and retired that cap** — `TEAM_CAP` no longer exists anywhere in `src/` or `scripts/`, and `station-composer.ts` now REJECTS the retired keys `cap` / `capped` / `dropped_roles` / `max_team_size` / `team_size`. Do NOT expect, tolerate, or pre-emptively refuse a size-driven divergence: there is none. The step-5 mirror-divergence guard remains in force for genuine participant-set divergence (an extra or missing role), which is a real defect and a §4 invalidating change.
- **Every inclusion is justified, every exclusion is recorded.** Each proposed participant carries a non-empty `necessity_rationale` + `owned_obligations`; each role considered but not proposed lands in `excluded_roles` with `why_unnecessary`. Coverage is validated: an obligation with no owner and no user-accepted exclusion invalidates the proposal.
- **Backend/host capacity is a SCHEDULING concern, never a roster limit** (`guild.team_schedule.v1`). If the backend cannot run the approved team concurrently, propose dependency-valid execution waves (or another backend) and ask the user — never drop, filter, or reorder specialists to fit capacity. Legacy `--team-size N` / `defaults.team.size` are read only as a concurrency *hint* during the migration window (clamped to verified backend capacity, per the frozen §6 precedence); `allow_larger` is a warned no-op. None of these can cap the logical roster.
- **Architect is implied** on any multi-component build (frontend + backend, service + infra, …).
- **Security is implied** on anything touching auth, secrets management, or external integrations (third-party APIs, webhooks, OAuth, payment providers).
- **QA is implied whenever backend is present** in the team. Server-side changes ship with a qa slot by default.
- **Orchestrator is implicit** — the top-level `/guild` session coordinates; it occupies no specialist slot and is not a proposal participant.
- **New specialists must pass their applicable mint gates** before joining. Human-requested roles require prospective boundary/routing evals but not historical extraction evidence; evolution-proposed roles additionally require all extraction signals and historical shadow replay. A failing create-specialist proposal falls back to options B / C / D.

## Team decision gate (before any dispatch)

Implements the frozen `guild.team_proposal.v2` / `guild.team_decision.v1` / `guild.team_schedule.v1` contracts (dynamic-host-model-routing run, `contracts/team-contracts.md` — bound by pointer, never re-spelled; schema fields are normative there). **Every phase that can dispatch composes a proposal and holds at this gate** — all six lifecycle phases (`init · ideate · plan · build · qa · ops`) alike, including advisory panels, cross-host reviewer slots (G-init/G-spec reviewers included), and learn-pipeline agents: if a phase dispatches ANY participant, that participant is in a user-approved proposal first. **Early-phase proposals (`init`/`ideate`):** these phases run before an approved spec exists, so their (typically minimal) proposals are composed by the phase skill itself (`guild:init` / `guild:brainstorm`) *before its first dispatch*, with `spec_ref` pointing at the intake artifact that exists at that moment (init brief / draft spec bytes), and — since the frozen schema requires BOTH refs and no plan exists yet — `plan_ref` set to that SAME intake artifact ref (a deliberate, documented duplication; never omit the field, never invent a placeholder path). The gate requires a justified dispatchable-participant list, not an approved spec. Work the orchestrator session performs itself dispatches no participant and needs no proposal.

- **The proposal is immutable.** `guild.team_proposal.v2` is persisted with a self-referential `proposal_hash` (canonical-YAML SHA-256, hash field omitted from the hashed value). A change is a NEW proposal (`proposal_version`+1, `parent_proposal_hash` set), never an edit. All versions persist under `.guild/runs/<run-id>/team-plan/` — proposals AND their decisions alike, one decision artifact per proposal version (`<phase>-proposal-v<n>.yaml` / `<phase>-decision-v<n>.yaml`), never overwritten — so the audit trail shows the exact bytes proposed, restructured, decided, and approved.
- **Exactly one user decision per proposal hash.** `guild.team_decision.v1` records `approve` or `restructure`, `decided_by` a **user identity/channel — never an agent**. Guild NEVER auto-approves (autonomy policy: requires confirmation). Present the full proposal — participants with necessity rationale, excluded roles, obligation coverage, and the non-binding wave preview — and WAIT.
- **Restructure loops preserve the original proposal.** `restructure` edits (`add` / `remove` / `substitute` / `edit_dependencies`) yield a NEW proposal version plus a new PENDING decision; the parent chain keeps every prior version. Coverage is revalidated on each edit — lost obligations are surfaced before acceptance. Restructure is idempotent and can loop any number of times without losing the v1 proposal.
- **Invalidation.** Any change to a participant, obligation, dependency, tier/purpose, capability scope, backend, wave structure, concurrency, cost posture, or review independence invalidates the prior decision and requires renewed user approval.
- **Dispatch gate (consumed by `guild:execute-plan`).** Dispatch accepts only a current `approve` decision whose `proposal_hash` equals the hash RECOMPUTED from the proposal artifact. Stale or hash-mismatched decisions fail closed.
- **Scheduling, not truncation.** After approval, backend capacity maps the approved participant set onto dependency-valid `guild.team_schedule.v1` waves — approved id set = base-wave union = dispatch receipts = terminal outcomes (set equality; removal only via a new proposal+decision cycle citing the new decision hash). Retries reuse the same `participant_id`; a failed wave preserves not-yet-terminal ids for resume; resource exhaustion produces an explicit scheduling failure or a user-approved backend/concurrency change, never a roster change.

## Execution backend

**`team-compose` does NOT resolve the backend.** The backend is resolved **once at command intake** by `runStartPreflight` (`scripts/lib/runstart-preflight.ts`) — before run-trace start, before `team-compose` is invoked — applying the **`agent_mode` dispatch ladder** (`CLAUDE.md §"Backend default — the agent_mode dispatch ladder"`; ADR D5 of the command-surface dispatch and internalization ADR) and frozen in the run's resolved-settings snapshot (U6). `team-compose` **consumes** `snapshot.effective.agent_mode` (read via `readResolvedSettingsSnapshot`) and **records a mirror** of it in `team.yaml`'s `backend` field for audit/readability — it neither re-reads `.guild/settings.json`, re-runs `scripts/agent-team-launcher.ts`, nor owns the OD-3 operator ask.

For reference, the intake-time ladder `runStartPreflight` applies (you do not re-run it here):

- **`auto` (default):** inside tmux (`$TMUX` set) → **agent-team in-session** (a new window in the current session, **one visible pane per specialist**); tmux installed but not currently inside one → **agent-team new-session** (detached session, then attach); host supports independent agents (no tmux) → **agent**; else → **subagent**.
- **Explicit pin** (`team | agent | subagent`) is honored subject to availability — pinning `team` on a tmux-less host warns and falls back to subagent.

**Team/agent is PRIMARY whenever tmux is available; subagent is the documented last resort** (CI, fresh installs, no tmux) — never the default on a developer machine.

The tmux prompt is **evaluated every run**, not once-and-never-again. Ground truth (`runStartPreflight`): `needsTmuxPrompt = tmuxAvailable && effective agent_mode !== "team"`. So while `agent_mode` is anything other than `team` (including `auto`), and tmux is available, **each run** surfaces the question. On **yes**, `agent_mode: "team"` is persisted via `config-cmd set agent_mode team --scope workspace` (U2 HARD-SET path) — so subsequent runs resolve `team` and the prompt no longer fires. On **no**, nothing is persisted, so the next run prompts again. In this workspace the root is already `team`, so the predicate is false and the prompt stays silent.

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` must be set for any team spawn; if it is absent when the resolved backend is `team`, the launcher **refuses and surfaces the blocker** (it never silently swaps to subagent — that would change execution semantics out from under the plan). `team.yaml`'s top-level `backend` is a **mirror** of the snapshot-resolved value for readability/audit — it is **not** the backend authority. The authoritative backend for `guild:plan` and `guild:execute-plan` is the run's resolved-settings snapshot (`snapshot.effective.agent_mode`, written by U6); `team.yaml` remains authoritative for team **composition** (roster, scope, dependencies, tiers, agent-definition paths), not the backend selection.

## Output contract

Write `teamFilePath(guildRoot, slug, phase)` = **`.guild/team/<slug>.<phase>.yaml`** (T1; never the legacy single-file `<slug>.yaml`), and update `.guild/team/<slug>.current` via `writeCurrentPhasePointer`. Full annotated schema + per-field semantics in `gap-handling.md`; the shape is:

```yaml
spec: .guild/spec/<slug>.md
phase: build               # the phase this team was composed for (self-description/audit); matches the <phase> in the filename
backend: agent-team        # MIRROR of the snapshot-resolved backend (snapshot.effective.agent_mode) for audit; NOT the authority — execute-plan reads the snapshot. Per-phase files all mirror the SAME intake-resolved value (never re-resolved per phase — ADR A4).
proposal_ref: .guild/runs/<run-id>/team-plan/<phase>-proposal-v<n>.yaml   # the approved guild.team_proposal.v2 this file realizes
decision_ref: .guild/runs/<run-id>/team-plan/<phase>-decision-v<n>.yaml  # the approve decision for THAT proposal version (one decision file per proposal version; prior decisions never overwritten)
specialists:
  - name: architect        # exact roster slug
    participant_id: architect-build-1        # the STABLE id from the approved proposal (constant across retries; the set-equality key)
    participation_kind: worker               # worker | advisor | challenger | reviewer_local | reviewer_cross_host (from the proposal)
    purpose: general                         # the model_policy §2 purpose enum from the participant's authoritative role metadata
    scope: "One-sentence bounded responsibility for THIS task."
    necessity_rationale: "Why this phase cannot meet its obligations without this role."  # required, non-empty (mirrors the proposal)
    owned_obligations: [ob-arch-boundaries]  # obligation ids this participant owns (from the proposal coverage map)
    depends-on: []          # specialist slugs whose handoff this waits on
    definition: .guild/agents/architect.md   # agent-definition path from roster-resolve (`definition` field).
                            #   Domain specialists are always PROJECT instances (`.guild/agents/<role>.md`,
                            #   minted from the shipped template) — LOAD-BEARING: dispatch embeds the
                            #   definition-adoption instruction and the in-process backend swaps
                            #   subagent_type to the host-generic type. `shipped` appears only on the
                            #   machinery agents (advisor/developer), plugin-relative and informational.
    definition_source: project        # shipped | project — from roster-resolve (`source` field)
    definition_ref: {"schema_version":"guild.project_definition_ref.v1","project_id":"<project>","layer":"project-guild","kind":"agent","id":"architect","relative_path":".guild/agents/architect.md","content_hash":"sha256:<64hex>","source_commit":"<commit-or-null>","specialist_profile_hash":"<64hex>","specialist_type_hash":"<64hex>","skills":[]} # exact one-line `result.ref` from definition-ref-for-dispatch; never hand-built
    default_tier: powerful  # cheap|mid|powerful — roster-resolve derives it from the agent's `default_tier:`/`model:` frontmatter per the canonical roster ADR (a default, NOT a pin)
    implied-by: "multi-component"   # or omit if user-requested
    capability_scope:       # OPTIONAL — tool allow-list serialised as GUILD_CAPABILITY_SCOPE at dispatch
      - "Read"              # absent ⇒ no scoping (additive; current behaviour unchanged)
      - "Write"
      - "Edit"
      - "Glob"
      - "Grep"
      - "WebSearch"
      - "WebFetch"
excluded_roles:
  - role_ref: data-scientist
    why_unnecessary: "No ML surface in this phase's obligations."
gaps_resolved:
  - proposed_role: data-scientist
    resolution: "B"         # A / B / C / D
    notes: "User accepted missing coverage; flagged in final report."
coverage_flags:
  - "No specialist covers ML modelling (B on data-scientist gap)."
```

`implied-by` records which hard rule triggered an inclusion (`multi-component`, `auth-touched`, `backend-present`) for audit. The roster is **uncapped** — it lists every participant of the approved proposal, exactly; no entry may be dropped to fit a size target or backend capacity (`## Hard rules`).

## Default tier per specialist

Each composed specialist carries a **default model tier** (`cheap | mid | powerful`). **Do not maintain a tier table here — enumerate it from source.** Canonical ADR: the specialist-roster-groups-and-tiers ADR (D4 enumeration rule, D2 default-tier table, D3 default-vs-dispatch split). The root cause of the prior drift (R-003) was three sources extrapolating disagreeing tier tables from a cost-aware ADR §7 that only tabulated 5 augmenting types — so this skill no longer keeps its own.

- **Default tier = the specialist's frontmatter**, surfaced as `default_tier` in the roster-resolve JSON: an explicit `default_tier:` frontmatter key wins; otherwise the `model:` line is mapped through the cost-aware-tiering §1 ladder (`opus`=powerful, `sonnet`=mid, `haiku`=cheap; unknown models default `mid`). Consume it from the resolver output **at compose time** — never a hand-maintained list. This structurally prevents the tier drift from recurring, and it applies identically to project-local specialists (killing the old "project mint runs at `mid`" degradation).
- The tier→model host map is the closed-key `models.tiers` block (cost-aware ADR §10 — bound by pointer, never re-spelled here).

Canonical default tiers for the 15 domain type templates (the ADR D2 table — a **derived view** of the `templates/specialists/*.md` frontmatter, inherited verbatim by minted instances; if it ever disagrees with the files, the files win):

| Default tier | Specialists |
|---|---|
| `powerful` | architect, security |
| `mid` | researcher, backend, frontend, mobile, devops, qa, copywriter, doc-writer, technical-writer, social-media, seo, marketing, sales |

(Machinery agents, per cost-aware ADR §7: `advisor`=powerful, `developer`=mid — they augment, never count toward the domain roster.)

**Research-purpose floor (authoritative, transitive, non-downgradable).** Each participant carries a `purpose` (the `guild.model_policy.v2` §2 enum) sourced from its **authoritative role definition** (`work_class`/purpose frontmatter on the agent/template — T1b metadata), never guessed from the lane label. A `purpose: research` participant resolves `effective_complexity: hard` / `tier: powerful` (`research_always_hard`), and the floor is **transitive through every handoff**: descendants, advisor consults, retries, resumes, and generic sub-dispatches inherit it and can NEVER downgrade it — no auto-score, `--model-tier` pin, or cheap-lane default lowers a research lane. Record `forced_floor_reason: research_always_hard` wherever the floor fires.

**Default tier ≠ per-lane dispatch tier (ADR D3).** The default above is the single tier the specialist runs at when dispatched as that type — not a pin. The actual dispatch tier is the cost-aware §2 auto-score computed **per lane**: it may lower a simple lane below its default (a mechanical `doc-writer` edit, template-guided content/commercial generation → `cheap` — but NEVER a `purpose: research` lane, whose floor is absolute per the paragraph above) or escalate a hard one (a security-critical lane → `powerful` via the §3 advisor). `--model-tier` / per-lane plan override / the §2 score decide the final dispatch tier (ADR §10 precedence). The old `cheap→mid` "default" notation is **retired** — a cheap floor for mechanical lanes is a property of the §2 scorer, not a dual-valued default. Self-build dev-team lanes inherit by the same frontmatter read (`plugin-architect`→powerful; code/skill/hook/tooling lanes→mid; `docs-writer`→mid, with the §2 cheap floor for mechanical edits).

## Capability scope defaults

Implements the capability-scoping contract from the v2 security ADR (bound by pointer). The `capability_scope:` field is **optional and additive**: absent ⇒ no scoping, current behaviour unchanged. When present it is serialised as `GUILD_CAPABILITY_SCOPE` (JSON string array) by `guild:execute-plan` at dispatch so the PreToolUse hook can enforce it.

Derive `capability_scope` from the role→scope defaults below. Override when a task's narrower scope warrants it (e.g. a security audit lane may restrict even further); widen only when explicitly justified.

Rule syntax follows Claude Code's own permission-rule grammar (bound by convention — see `hooks/lib/security/enforce.ts`):
- `"ToolName"` — matches any call to that tool.
- `"ToolName(glob)"` — matches only when the argument string matches the glob.

| Role group | Default `capability_scope` | Rationale |
|---|---|---|
| `architect` | `["Read","Write","Edit","Glob","Grep","WebSearch","WebFetch"]` | Reads codebase, writes ADRs/docs; no Bash execution needed. |
| `researcher` | `["Read","Glob","Grep","WebSearch","WebFetch"]` | Read + search only; no file writes, no shell. |
| `backend`, `frontend`, `mobile`, `devops` (build lanes) | `["Read","Write","Edit","Bash","Glob","Grep"]` | Needs full read/write/bash to implement a lane. |
| `qa` | `["Read","Write","Edit","Bash","Glob","Grep"]` | Runs tests and writes fixtures; same profile as build lanes. |
| `security` | `["Read","Glob","Grep","WebSearch","WebFetch"]` | Audit-only: read + search; no writes, no unguarded bash. |
| `doc-writer`, `copywriter`, `technical-writer` | `["Read","Write","Edit","Glob","Grep"]` | Reads source, writes doc files; no shell or external requests. |
| `seo`, `social-media`, `marketing`, `sales` | `["Read","Write","Edit","Glob","Grep","WebSearch","WebFetch"]` | Needs search for current data; writes copy/config files. |

Self-build dev-team lanes inherit by analogy: `plugin-architect`→`architect` scope; skill/hook/command/tooling lanes→build-lane scope; `docs-writer`→doc-writer scope; `eval-engineer`→build-lane scope.

## Handoff

Hand off to `guild:plan` with the **resolved per-phase team-file path** as its argument (the `teamFilePath(...)` result just written, e.g. `.guild/team/<slug>.build.yaml` — not a reconstructed `<slug>.yaml`). Do not proceed into planning yourself — `guild:plan` is a separate skill. Handoff receipt lists: `team_path` (the per-phase path), `phase`, `proposal_ref` + `proposal_hash` + `decision_ref` (the approved `guild.team_proposal.v2` chain — including any restructure versions — and its `guild.team_decision.v1`), `specialist_count` (audit fact of the approved set, never a target), `backend`, `gaps_resolved` count (incl. any A→`create-specialist`/`create-skill` mints and their gate outcome), whether any `implied-by` rule fired, the per-specialist `default_tier` assignments (so `guild:plan` can carry them onto each lane's `complexity_score` + chosen tier), and `team_plan_path` — the companion `guild.team_plan.v1` emitted at step 5 (`.guild/runs/<run-id>/team-plan/<phase>.json`), or the fail-soft skip note if emission was skipped/failed (so `guild:execute-plan` can wire its `team_result` `team_plan_ref` to it).
