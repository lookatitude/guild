---
name: guild-team-compose
description: Match spec domains to Guild's 13 shipping specialists, present existing + gaps with A/B/C/D options (auto-create / skip / substitute / compose from scratch), enforce cap-6 and default 3–4 rules, choose subagent (default) vs agent-team backend, and write `.guild/team/<slug>.yaml`. TRIGGER on "propose a team", "who should work on this", "compose specialists for the spec". DO NOT TRIGGER for: writing the code (execute-plan), creating a new specialist TYPE for Guild itself (that's guild:create-specialist in P6), reviewing completed work (guild:review).
when_to_use: Second step of the `/guild` lifecycle, after `guild:brainstorm` has produced `.guild/spec/<slug>.md`. Also fires when the user asks to reshape an existing team (e.g. "rework the team for this task", "swap the qa slot for security").
type: meta
---

# guild:team-compose

Implements `guild-plan.md §7` (team composition). Runs after `guild:brainstorm` has written `.guild/spec/<slug>.md` and before `guild:plan`. Output is a resolved team file that downstream planning and execution steps consume verbatim.

## Input

`.guild/spec/<slug>.md` — the approved spec from `guild:brainstorm`. The spec's Goal, Success criteria, Constraints, and Non-goals sections are the authoritative source for domain matching. Do not infer domains from the user's chat history outside the spec.

## Workflow

Four ordered steps, lifted from `guild-plan.md §7.1`:

1. **Match.** Read `.guild/spec/<slug>.md` and match its domains against the 13 shipping specialist descriptions (see `guild-plan.md §6.1–§6.3`: architect, researcher, backend, devops, qa, mobile, security, copywriter, technical-writer, social-media, seo, marketing, sales).
2. **Classify.** Bucket every matched domain as either *existing* (a roster specialist covers it) or *gap* (no specialist covers it). Gaps get a proposed role name and one-line description so the user can see exactly what would be created if they pick option A.
3. **Present to user.** Show the matched existing specialists with a one-line reasoning each, and — for every gap — the four gap-handling options:
   - **A · auto-create** — invoke `guild:create-specialist` to mint the missing role before proceeding. Adjacent-specialist boundary updates are proposed as part of that flow (`guild-plan.md §12`).
   - **B · skip gap** — proceed with existing specialists only; the missing coverage is flagged in the final task report.
   - **C · substitute** — reassign the gap to an existing specialist with an explicit scope override recorded in `team.yaml`.
   - **D · compose from scratch** — discard the proposal entirely and hand-pick the team via `/guild:team edit`.
4. **Write** `.guild/team/<slug>.yaml` with the resolved team, each entry carrying per-specialist scope, cross-specialist dependencies, and the chosen execution backend.

## Hard rules

From `guild-plan.md §7.2`. These are non-negotiable; if a user request conflicts, raise it before writing `team.yaml`.

- **Cap at 6 specialists** per task. The only override is an explicit `/guild:team edit --allow-larger` from the user — context fragmentation destroys coherence above six.
- **Recommended default: 3–4 specialists.** Six is the ceiling, not the norm. Only widen the team when the task has genuinely independent lanes that benefit from parallel specialists.
- **Architect is implied** on any multi-component build. If the spec touches two or more components (e.g. frontend + backend, service + infra), add architect whether the user named it or not.
- **Security is implied** on anything touching auth, secrets management, or external integrations (third-party APIs, webhooks, OAuth, payment providers, etc.).
- **QA is implied whenever backend is present** in the team. Server-side changes ship with a qa slot by default.
- **Orchestrator is implicit** — the top-level `/guild` session plays coordinator. It does not occupy a specialist slot and does not count toward the cap.
- **New specialists must pass the evolve gate** (`guild-plan.md §11`) before joining. If a create-specialist proposal fails evals, fall back to options B / C / D.

## Execution backend

From `guild-plan.md §7.3`. Two backends are supported:

- **Subagents via the Agent tool — default.** Use when each specialist's work is self-contained and only the final artifact needs to return to the orchestrator. Lower token cost, simpler cleanup, fewer coordination failures. This is the production default.
- **Agent teams — opt-in.** Use when teammates need to share findings, challenge each other, coordinate dependencies, or run competing hypotheses. Gated by three conditions that *all* must hold:
  1. The user has **explicitly approved** the agent-team backend for this task (not "sounds fine" — explicit yes).
  2. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in the environment.
  3. The task has peer-coordination needs the orchestrator cannot satisfy by serializing subagent runs.

Agent teams are experimental: one team per session, no nested teams, higher token cost. If any of the three conditions is missing, default to subagents and note the fallback in the team-compose presentation.

## Output contract

Write `.guild/team/<slug>.yaml`. Schema:

```yaml
spec: .guild/spec/<slug>.md
backend: subagent  # or: agent-team
allow_larger: false  # true only if user passed --allow-larger
specialists:
  - name: architect
    scope: "System boundaries, component split, tradeoff matrix for the pricing service."
    depends-on: []
    implied-by: "multi-component"  # or omit if user-requested
  - name: backend
    scope: "REST contract + data layer for /pricing endpoints."
    depends-on: [architect]
  - name: qa
    scope: "Property-based tests for quote calculator; regression suite hookup."
    depends-on: [backend]
    implied-by: "backend-present"
  - name: security
    scope: "Auth flow review for the new pricing admin routes."
    depends-on: [backend]
    implied-by: "auth-touched"
gaps_resolved:
  - proposed_role: data-scientist
    resolution: "B"  # A / B / C / D
    notes: "User accepted missing coverage; flagged in final report."
coverage_flags:
  - "No specialist covers ML modelling (user selected B on data-scientist gap)."
```

Per-specialist fields:
- `name` — exact specialist slug from the roster.
- `scope` — one-sentence bounded responsibility for *this* task. No copy-paste of the specialist's full remit.
- `depends-on` — list of other specialist slugs whose handoff this specialist waits on.
- `implied-by` (optional) — records which hard rule triggered the inclusion (`multi-component`, `auth-touched`, `backend-present`) so the user can audit.

The top-level `backend` field is authoritative for `guild:plan` and `guild:execute-plan`. The team is capped at 6 entries unless `allow_larger: true` is set.

## Handoff

Hand off to `guild:plan` with the team.yaml path as its argument. Do not proceed into planning yourself — `guild:plan` is a separate skill with its own responsibilities (`guild-plan.md §8`).

Handoff receipt should list: `team_path`, `specialist_count`, `backend`, `gaps_resolved` count, and whether any `implied-by` rule fired.
