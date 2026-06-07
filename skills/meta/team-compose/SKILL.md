---
name: guild-team-compose
description: Match spec domains against BOTH Guild's shipping specialist roster AND the consuming repo's project-local `.guild/agents/*.md` (existing project specialists are reused, never re-created); present existing + gaps with A/B/C/D options, enforce cap-6 and default 3–4 rules, assign each specialist a `default_tier` from its `model:` frontmatter (canonical roster ADR), derive an optional per-specialist `capability_scope:` (tool allow-list; absent ⇒ no scoping — additive) using the role→scope defaults table, resolve the execution backend via the agent_mode ladder (agent-team / tmux visible panes under tmux; subagent only as the no-tmux fallback), and write `.guild/team/<slug>.yaml`. TRIGGER on "propose a team", "who should work on this", "compose specialists for the spec". DO NOT TRIGGER for: writing the code (execute-plan), creating a new specialist TYPE for Guild itself (that's guild:create-specialist in P6), reviewing completed work (guild:review).
when_to_use: Second step of the `/guild` lifecycle, after `guild:brainstorm` has produced `.guild/spec/<slug>.md`. Also fires when the user asks to reshape an existing team (e.g. "rework the team for this task", "swap the qa slot for security").
type: meta
---

# guild:team-compose

Implements `guild-plan.md §7` (team composition). Runs after `guild:brainstorm` writes `.guild/spec/<slug>.md` and before `guild:plan`. Output is a resolved team file downstream planning and execution consume verbatim.

## Input

`.guild/spec/<slug>.md` — the approved spec. Its Goal, Success criteria, Constraints, and Non-goals sections are the authoritative source for domain matching. Do not infer domains from chat history outside the spec.

## Workflow

Five ordered steps (`guild-plan.md §7.1`). The gap-handling options and approval shapes are detailed in `gap-handling.md`:

0. **Self-build check (first).** If the target repo IS the Guild plugin itself (editing `plugin/**` — skills, commands, hooks, scripts, agents, docs, manifests, tests), compose the team from the **dev-team agents under `.claude/agents/`** (`plugin-architect, skill-author, specialist-agent-writer, command-builder, hook-engineer, tooling-engineer, docs-writer, eval-engineer`), routed by changed path (see `CLAUDE.md §"Dev team"` for the path→agent table). Do **not** match against the 14 `guild:` product specialists — those build *user* products. Skip steps 1–3's product-roster matching and go to step 4 with the dev-team lanes. (Cap-6 / 3–4 default and backend choice still apply.)

1. **Match.** (Non-self-build.) Match the spec's domains against the **available-specialist set** — the union of **(a)** the shipped roster, **enumerated from `plugin/agents/*.md`** (the canonical source per `docs/knowledge/decisions/canonical-specialist-roster-groups-and-tiers.md` D4 — never a hand-maintained list; minus the augmenting non-roster types `advisor`/`developer`/`doc-writer`). As of this writing that is the **14 shipping specialists** (`§6.1–§6.3`): architect, researcher, backend, frontend, devops, qa, mobile, security, copywriter, technical-writer, social-media, seo, marketing, sales — but treat this as a derived snapshot of the files, not the authority. **And (b)** the consuming repo's project-local specialists already minted under `.guild/agents/*.md` (the live tree only — the `.guild/agents/proposed/*` incubation tree is **never** a candidate, per `guild:create-specialist`'s incubation contract). A domain either source covers is a candidate match; a project-local specialist minted on a previous task is **reused here, never re-created**.

2. **Classify** every matched domain as either *existing* — covered by **either** the shipped roster **or** an already-minted `.guild/agents/*.md` project specialist (joins the team with **no creation step**) — or *gap* — covered by **neither** (gets a proposed role name + one-line description so the user sees exactly what option A would create).

3. **Present to user.** Show the matched existing specialists with one-line reasoning each, and — for every gap — the four options **A · auto-create / B · skip gap / C · substitute / D · compose from scratch** (full semantics, including the v2 DH-3 mint boundary, in `gap-handling.md`).

4. **Write** `.guild/team/<slug>.yaml` with the resolved team — only after the applicable approval shape (see `gap-handling.md`) has cleared — each entry carrying per-specialist scope and cross-specialist dependencies, plus a **mirror** of the snapshot-resolved execution backend (resolved at intake by `runStartPreflight`, not chosen here — see `## Execution backend`).

**Reuse, never re-create** is load-bearing: an existing specialist from *either* source joins with no creation step and no creation approval. Only a gap covered by neither source can become a newly-minted specialist (option A → `guild:create-specialist`), and only with explicit per-role approval.

## Hard rules

From `guild-plan.md §7.2`. Non-negotiable; if a user request conflicts, raise it before writing `team.yaml`:

- **Cap at 6 specialists** per task. The only override is an explicit `/guild:plan --team-size=N` — context fragmentation destroys coherence above six.
- **Recommended default: 3–4.** Six is the ceiling, not the norm. Widen only when the task has genuinely independent lanes that benefit from parallel specialists.
- **Architect is implied** on any multi-component build (frontend + backend, service + infra, …).
- **Security is implied** on anything touching auth, secrets management, or external integrations (third-party APIs, webhooks, OAuth, payment providers).
- **QA is implied whenever backend is present** in the team. Server-side changes ship with a qa slot by default.
- **Orchestrator is implicit** — the top-level `/guild` session coordinates; it occupies no specialist slot and does not count toward the cap.
- **New specialists must pass the evolve gate** (`§11`) before joining. A failing create-specialist proposal falls back to options B / C / D.

## Execution backend

**`team-compose` does NOT resolve the backend.** The backend is resolved **once at command intake** by `runStartPreflight` (`scripts/lib/runstart-preflight.ts`) — before run-trace start, before `team-compose` is invoked — applying the **`agent_mode` dispatch ladder** (`CLAUDE.md §"Backend default — the agent_mode dispatch ladder"`; ADR D5, `docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md`) and frozen in the run's resolved-settings snapshot (U6). `team-compose` **consumes** `snapshot.effective.agent_mode` (read via `readResolvedSettingsSnapshot`) and **records a mirror** of it in `team.yaml`'s `backend` field for audit/readability — it neither re-reads `.guild/settings.json`, re-runs `scripts/agent-team-launcher.ts`, nor owns the OD-3 operator ask.

For reference, the intake-time ladder `runStartPreflight` applies (you do not re-run it here):

- **`auto` (default):** inside tmux (`$TMUX` set) → **agent-team in-session** (a new window in the current session, **one visible pane per specialist**); tmux installed but not currently inside one → **agent-team new-session** (detached session, then attach); host supports independent agents (no tmux) → **agent**; else → **subagent**.
- **Explicit pin** (`team | agent | subagent`) is honored subject to availability — pinning `team` on a tmux-less host warns and falls back to subagent.

**Team/agent is PRIMARY whenever tmux is available; subagent is the documented last resort** (CI, fresh installs, no tmux) — never the default on a developer machine.

The tmux prompt is **evaluated every run**, not once-and-never-again. Ground truth (`runStartPreflight`): `needsTmuxPrompt = tmuxAvailable && effective agent_mode !== "team"`. So while `agent_mode` is anything other than `team` (including `auto`), and tmux is available, **each run** surfaces the question. On **yes**, `agent_mode: "team"` is persisted via `config-cmd set agent_mode team --scope workspace` (U2 HARD-SET path) — so subsequent runs resolve `team` and the prompt no longer fires. On **no**, nothing is persisted, so the next run prompts again. In this workspace the root is already `team`, so the predicate is false and the prompt stays silent.

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` must be set for any team spawn; if it is absent when the resolved backend is `team`, the launcher **refuses and surfaces the blocker** (it never silently swaps to subagent — that would change execution semantics out from under the plan). `team.yaml`'s top-level `backend` is a **mirror** of the snapshot-resolved value for readability/audit — it is **not** the backend authority. The authoritative backend for `guild:plan` and `guild:execute-plan` is the run's resolved-settings snapshot (`snapshot.effective.agent_mode`, written by U6); `team.yaml` remains authoritative for team **composition** (roster, scope, dependencies, tiers, agent-definition paths), not the backend selection.

## Output contract

Write `.guild/team/<slug>.yaml`. Full annotated schema + per-field semantics in `gap-handling.md`; the shape is:

```yaml
spec: .guild/spec/<slug>.md
backend: agent-team        # MIRROR of the snapshot-resolved backend (snapshot.effective.agent_mode) for audit; NOT the authority — execute-plan reads the snapshot
allow_larger: false        # true only if user passed --allow-larger
specialists:
  - name: architect        # exact roster slug
    scope: "One-sentence bounded responsibility for THIS task."
    depends-on: []          # specialist slugs whose handoff this waits on
    default_tier: powerful  # cheap|mid|powerful — read from the agent model: frontmatter per the canonical roster ADR (a default, NOT a pin)
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

Each composed specialist carries a **default model tier** (`cheap | mid | powerful`). **Do not maintain a tier table here — enumerate it from source.** Canonical ADR: `docs/knowledge/decisions/canonical-specialist-roster-groups-and-tiers.md` (D4 enumeration rule, D2 default-tier table, D3 default-vs-dispatch split). The root cause of the prior drift (R-003) was three sources extrapolating disagreeing tier tables from a cost-aware ADR §7 that only tabulated 5 augmenting types — so this skill no longer keeps its own.

- **Default tier = the specialist's `model:` frontmatter**, mapped through the cost-aware-tiering §1 ladder (`opus`=powerful, `sonnet`=mid, `haiku`=cheap). Read `plugin/agents/<role>.md` (or the project-local `.guild/agents/<role>.md`) `model:` line **at compose time** — never a hand-maintained list. This structurally prevents the tier drift from recurring.
- The tier→model host map is the closed-key `models.tiers` block (cost-aware ADR §10 — bound by pointer, never re-spelled here).

Canonical default tiers for the 14 shipping specialists (the ADR D2 table — a **derived view** of the frontmatter; if it ever disagrees with the files, the files win):

| Default tier | Specialists |
|---|---|
| `powerful` | architect, security |
| `mid` | researcher, backend, frontend, mobile, devops, qa, copywriter, technical-writer, social-media, seo, marketing, sales |

(Augmenting non-roster types, per cost-aware ADR §7: `advisor`=powerful, `developer`=mid, `doc-writer`=mid — they augment, never count toward the 14.)

**Default tier ≠ per-lane dispatch tier (ADR D3).** The default above is the single tier the specialist runs at when dispatched as that type — not a pin. The actual dispatch tier is the cost-aware §2 auto-score computed **per lane**: it may lower a simple lane below its default (a pure read/summarize `researcher` lane, a mechanical `doc-writer` edit, template-guided content/commercial generation → `cheap`) or escalate a hard one (a security-critical lane → `powerful` via the §3 advisor). `--model-tier` / per-lane plan override / the §2 score decide the final dispatch tier (ADR §10 precedence). The old `cheap→mid` "default" notation is **retired** — a cheap floor for mechanical lanes is a property of the §2 scorer, not a dual-valued default. Self-build dev-team lanes inherit by the same frontmatter read (`plugin-architect`→powerful; code/skill/hook/tooling lanes→mid; `docs-writer`→mid, with the §2 cheap floor for mechanical edits).

## Capability scope defaults

Implements the capability-scoping contract from the v2 security ADR (`docs/knowledge/decisions/v2-security-and-untrusted-content.md` — bound by pointer). The `capability_scope:` field is **optional and additive**: absent ⇒ no scoping, current behaviour unchanged. When present it is serialised as `GUILD_CAPABILITY_SCOPE` (JSON string array) by `guild:execute-plan` at dispatch so the PreToolUse hook can enforce it.

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

Hand off to `guild:plan` with the team.yaml path as its argument. Do not proceed into planning yourself — `guild:plan` is a separate skill (`guild-plan.md §8`). Handoff receipt lists: `team_path`, `specialist_count`, `backend`, `gaps_resolved` count, whether any `implied-by` rule fired, and the per-specialist `default_tier` assignments (so `guild:plan` can carry them onto each lane's `complexity_score` + chosen tier).
