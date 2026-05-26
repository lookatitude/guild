---
name: guild-team-compose
description: Match spec domains against BOTH Guild's shipping specialist roster AND the consuming repo's project-local `.guild/agents/*.md` (existing project specialists are reused, never re-created); present existing + gaps with A/B/C/D options (auto-create / skip / substitute / compose from scratch), enforce cap-6 and default 3–4 rules, choose subagent (default) vs agent-team backend, and write `.guild/team/<slug>.yaml`. TRIGGER on "propose a team", "who should work on this", "compose specialists for the spec". DO NOT TRIGGER for: writing the code (execute-plan), creating a new specialist TYPE for Guild itself (that's guild:create-specialist in P6), reviewing completed work (guild:review).
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

1. **Match.** (Non-self-build.) Match the spec's domains against the **available-specialist set** — the union of **(a)** the shipped roster (`§6.1–§6.3`: architect, researcher, backend, devops, qa, mobile, security, copywriter, technical-writer, social-media, seo, marketing, sales) **and (b)** the consuming repo's project-local specialists already minted under `.guild/agents/*.md` (the live tree only — the `.guild/agents/proposed/*` incubation tree is **never** a candidate, per `guild:create-specialist`'s incubation contract). A domain either source covers is a candidate match; a project-local specialist minted on a previous task is **reused here, never re-created**.

2. **Classify** every matched domain as either *existing* — covered by **either** the shipped roster **or** an already-minted `.guild/agents/*.md` project specialist (joins the team with **no creation step**) — or *gap* — covered by **neither** (gets a proposed role name + one-line description so the user sees exactly what option A would create).

3. **Present to user.** Show the matched existing specialists with one-line reasoning each, and — for every gap — the four options **A · auto-create / B · skip gap / C · substitute / D · compose from scratch** (full semantics, including the v2 DH-3 mint boundary, in `gap-handling.md`).

4. **Write** `.guild/team/<slug>.yaml` with the resolved team — only after the applicable approval shape (see `gap-handling.md`) has cleared — each entry carrying per-specialist scope, cross-specialist dependencies, and the chosen execution backend.

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

From `guild-plan.md §7.3`. **Subagents via the Agent tool — default** (self-contained work; only the final artifact returns; lower cost, simpler cleanup, fewer coordination failures). **Agent teams — opt-in**, gated by three conditions that *all* must hold: (1) the user **explicitly approved** the agent-team backend; (2) `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set; (3) peer-coordination needs the orchestrator can't satisfy by serializing subagents. Agent teams are experimental (one team per session, no nesting, higher cost). If any condition is missing, default to subagents and note the fallback in the presentation. The chosen value is written to `team.yaml`'s top-level `backend`, authoritative for `guild:plan` and `guild:execute-plan`.

## Output contract

Write `.guild/team/<slug>.yaml`. Full annotated schema + per-field semantics in `gap-handling.md`; the shape is:

```yaml
spec: .guild/spec/<slug>.md
backend: subagent          # or: agent-team
allow_larger: false        # true only if user passed --allow-larger
specialists:
  - name: architect        # exact roster slug
    scope: "One-sentence bounded responsibility for THIS task."
    depends-on: []          # specialist slugs whose handoff this waits on
    implied-by: "multi-component"   # or omit if user-requested
gaps_resolved:
  - proposed_role: data-scientist
    resolution: "B"         # A / B / C / D
    notes: "User accepted missing coverage; flagged in final report."
coverage_flags:
  - "No specialist covers ML modelling (B on data-scientist gap)."
```

`implied-by` records which hard rule triggered an inclusion (`multi-component`, `auth-touched`, `backend-present`) for audit. The team is capped at 6 entries unless `allow_larger: true`.

## Handoff

Hand off to `guild:plan` with the team.yaml path as its argument. Do not proceed into planning yourself — `guild:plan` is a separate skill (`guild-plan.md §8`). Handoff receipt lists: `team_path`, `specialist_count`, `backend`, `gaps_resolved` count, and whether any `implied-by` rule fired.
