---
name: guild-team-compose
description: Match spec domains against the consuming repo's project specialists (`.guild/agents/*.md`, reused never re-created) AND Guild's shipped specialist TYPE templates (`templates/specialists/*.md` — a matched template is deterministically minted into `.guild/agents/` via roster-resolve mint); present existing + gaps with A/B/C/D options, enforce cap-6 and default 3–4 rules, assign each specialist a `default_tier` from its `model:` frontmatter (canonical roster ADR), derive an optional per-specialist `capability_scope:` (tool allow-list; absent ⇒ no scoping — additive) using the role→scope defaults table, resolve the execution backend via the agent_mode ladder (agent-team / tmux visible panes under tmux; subagent only as the no-tmux fallback), and write the per-phase `.guild/team/<slug>.<phase>.yaml` (per phase). TRIGGER on "propose a team", "who should work on this", "compose specialists for the spec", "compose this phase's team". DO NOT TRIGGER for: writing the code (execute-plan), creating a new specialist TYPE for Guild itself (that's guild:create-specialist in P6), reviewing completed work (guild:review).
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
for each gap: recommend A create (→ create-specialist | create-skill, GATED) / B skip / C substitute / D compose-from-scratch
team_P    := resolve(needed_P ∩ have_P, approved creations)    # cap-6 / default 3–4 PER PHASE
write teamFilePath(guildRoot, slug, phase_P)     # .guild/team/<slug>.<phase>.yaml  (T1)
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

Five ordered steps, run **per phase** against `topic_P` (see `## Phase-aware composition`). The gap-handling options and approval shapes are detailed in `gap-handling.md`:

0. **Self-build check (first).** If the target repo IS the Guild plugin itself (editing `plugin/**` — skills, commands, hooks, scripts, agents, docs, manifests, tests), compose the team from the **dev-team agents enumerated from `.claude/agents/*.md`** — the filesystem IS the dev-team roster; the composer reads that live directory, **never a hand-maintained list** (same net rule as `§1` for the shipped roster). Route by changed path (see `CLAUDE.md §"Dev team"` for the path→agent table). *(Illustrative only, not authoritative — as of this writing `.claude/agents/` holds `plugin-architect, skill-author, specialist-agent-writer, command-builder, hook-engineer, tooling-engineer, docs-writer, eval-engineer` plus `research-digester`/`security-auditor`; enumerate the directory live, do not trust this snapshot.)* Do **not** match against the `guild:` product specialists — those build *user* products. Skip steps 1–3's product-roster matching and go to step 4 with the dev-team lanes. (Cap-6 / 3–4 default and backend choice still apply.)

1. **Match.** (Non-self-build.) Build the **available-specialist set** by running the roster resolver — `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/roster-resolve.ts --cwd .` — and consuming its `guild.roster.v1` JSON (`roster` = shipped ∪ project merged union; `templates` = the shipped specialist TYPE library; per-entry `name`, `definition`, `source`, `default_tier`, `skills`, `description`, `augmenting`). This is the code-backed D4 enumeration; never re-derive the set by walking directories yourself. **Filter out entries with `augmenting: true`** (`advisor`/`developer` — the machinery agents: they augment lanes and stay dispatchable, but are never product-roster candidates and never count toward the cap; after the machinery-vs-template-library ADR they are the ONLY shipped agents, so every domain candidate comes from (b) or (c)). Domain candidates are **(b)** the consuming repo's project specialists already minted under `.guild/agents/*.md` (the live tree only — the `.guild/agents/proposed/*` incubation tree is **never** a candidate, per `guild:create-specialist`'s incubation contract), and **(c)** the shipped **type templates** from the resolver's `templates` array (`templates/specialists/*.md` — architect, researcher, backend, frontend, devops, qa, mobile, security, copywriter, doc-writer, technical-writer, social-media, seo, marketing, sales — a derived snapshot; the files are the authority). An instance is a direct match; a template is a **mint candidate**. A project specialist minted on a previous task is **reused here, never re-created**.

2. **Classify** every matched domain three ways: *existing* — an already-minted `.guild/agents/*.md` instance (joins the team with **no creation step**); *mintable* — a shipped template covers the domain but no instance exists yet (**mint deterministically**: `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/roster-resolve.ts mint <role> --cwd .` — a byte-preserving instantiation stamped `derived_from_template`, NO create-specialist gates: templates are pre-blessed feedstock, and the CLI refuses if the instance already exists; append `--host-native` ONLY if the operator asked for host-native routing — it additionally projects the instance into `.claude/agents/<role>.md` (marker-stamped, never clobbers hand-authored files)); or *gap* — covered by **neither** an instance nor a template (gets a proposed role name + one-line description so the user sees exactly what option A would create).

3. **Present to user.** Show the matched existing specialists and the roles minted from templates this compose (each with one-line reasoning), and — for every genuine gap (agent **or** skill) — the four options **A · auto-create / B · skip gap / C · substitute / D · compose from scratch** (full semantics, including the v2 DH-3 mint boundary, in `gap-handling.md`). **Per-phase gap analysis is the SOLE mid-lifecycle trigger into the GATED create path** (ADR §1): option A routes a *role* gap to `guild:create-specialist` and a *capability/skill* gap to `guild:create-skill`; the proposed creation **must clear its mint gates** (paired evals + shadow, `§11`/`§12`) **before the phase team finalizes** — on gate failure the phase falls back to B/C/D. There is no ungated mid-phase creation of a NOVEL type; template instantiation is not a novel type (the trigger boundaries were blessed when the template shipped).

4. **Write** the resolved per-phase team — only after the applicable approval shape (see `gap-handling.md`) has cleared — to `teamFilePath(guildRoot, slug, phase)` = `.guild/team/<slug>.<phase>.yaml` (T1, `scripts/lib/team-file.ts`), then update the convenience pointer via `writeCurrentPhasePointer(guildRoot, slug, phase)` = `.guild/team/<slug>.current`. Each entry carries per-specialist scope and cross-specialist dependencies, plus a **mirror** of the snapshot-resolved execution backend (resolved at intake by `runStartPreflight`, not chosen here — see `## Execution backend`). **Honor the NULL-PHASE GUARD** (`## Phase-aware composition`): a `null` phase BLOCKS the write. **Never** overwrite, split, or move a legacy `.guild/team/<slug>.yaml` — it is read-only back-compat. Every specialist entry carries `definition:` + `definition_source:` copied from the roster-resolve JSON — for a project-local specialist these are load-bearing at dispatch. If step 3 minted anything (option A), refresh the derived registries afterwards: `npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/roster-resolve.ts --cwd . --write-registry --quiet` (the registries are generated projections of the `.md` trees; the files stay the source of truth).

**Reuse, never re-create** is load-bearing: an existing `.guild/agents/*.md` instance joins with no creation step and no approval; a template-covered domain mints its instance ONCE (the mint CLI exits `3` on an existing instance — that exit is your reuse signal, not an error). Only a gap covered by neither an instance nor a template can become a newly-created specialist (option A → `guild:create-specialist`) or skill (option A → `guild:create-skill`), and only with explicit per-role/per-skill approval that clears the mint gate.

## Hard rules

Non-negotiable; if a user request conflicts, raise it before writing `team.yaml`:

- **Cap at 6 specialists PER PHASE** (ADR §1 driver 5; OQ3). The cap bounds the **union of concurrently-active** specialists — **sequential phases each get a fresh ≤6 budget**; the lifecycle's total distinct specialists across phases is unbounded. Overlapping phases (e.g. `qa` spun up before `build` closes) share one cap. The only override is an explicit `/guild:plan --team-size=N` / `allow_larger: true` — context fragmentation destroys coherence above six.
- **Recommended default: 3–4** (per phase). Six is the ceiling, not the norm. Widen only when the phase has genuinely independent lanes that benefit from parallel specialists.
- **Architect is implied** on any multi-component build (frontend + backend, service + infra, …).
- **Security is implied** on anything touching auth, secrets management, or external integrations (third-party APIs, webhooks, OAuth, payment providers).
- **QA is implied whenever backend is present** in the team. Server-side changes ship with a qa slot by default.
- **Orchestrator is implicit** — the top-level `/guild` session coordinates; it occupies no specialist slot and does not count toward the cap.
- **New specialists must pass the evolve gate** (`§11`) before joining. A failing create-specialist proposal falls back to options B / C / D.

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
allow_larger: false        # true only if user passed --allow-larger
specialists:
  - name: architect        # exact roster slug
    scope: "One-sentence bounded responsibility for THIS task."
    depends-on: []          # specialist slugs whose handoff this waits on
    definition: .guild/agents/architect.md   # agent-definition path from roster-resolve (`definition` field).
                            #   Domain specialists are always PROJECT instances (`.guild/agents/<role>.md`,
                            #   minted from the shipped template) — LOAD-BEARING: dispatch embeds the
                            #   definition-adoption instruction and the in-process backend swaps
                            #   subagent_type to the host-generic type. `shipped` appears only on the
                            #   machinery agents (advisor/developer), plugin-relative and informational.
    definition_source: project        # shipped | project — from roster-resolve (`source` field)
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
gaps_resolved:
  - proposed_role: data-scientist
    resolution: "B"         # A / B / C / D
    notes: "User accepted missing coverage; flagged in final report."
coverage_flags:
  - "No specialist covers ML modelling (B on data-scientist gap)."
```

`implied-by` records which hard rule triggered an inclusion (`multi-component`, `auth-touched`, `backend-present`) for audit. The team is capped at 6 entries unless `allow_larger: true`.

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

**Default tier ≠ per-lane dispatch tier (ADR D3).** The default above is the single tier the specialist runs at when dispatched as that type — not a pin. The actual dispatch tier is the cost-aware §2 auto-score computed **per lane**: it may lower a simple lane below its default (a pure read/summarize `researcher` lane, a mechanical `doc-writer` edit, template-guided content/commercial generation → `cheap`) or escalate a hard one (a security-critical lane → `powerful` via the §3 advisor). `--model-tier` / per-lane plan override / the §2 score decide the final dispatch tier (ADR §10 precedence). The old `cheap→mid` "default" notation is **retired** — a cheap floor for mechanical lanes is a property of the §2 scorer, not a dual-valued default. Self-build dev-team lanes inherit by the same frontmatter read (`plugin-architect`→powerful; code/skill/hook/tooling lanes→mid; `docs-writer`→mid, with the §2 cheap floor for mechanical edits).

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

Hand off to `guild:plan` with the **resolved per-phase team-file path** as its argument (the `teamFilePath(...)` result just written, e.g. `.guild/team/<slug>.build.yaml` — not a reconstructed `<slug>.yaml`). Do not proceed into planning yourself — `guild:plan` is a separate skill. Handoff receipt lists: `team_path` (the per-phase path), `phase`, `specialist_count`, `backend`, `gaps_resolved` count (incl. any A→`create-specialist`/`create-skill` mints and their gate outcome), whether any `implied-by` rule fired, and the per-specialist `default_tier` assignments (so `guild:plan` can carry them onto each lane's `complexity_score` + chosen tier).
