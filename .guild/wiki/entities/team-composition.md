---
type: concept
owner: architect
confidence: high
importance: critical
source_refs: []  # consolidated from plugin/docs/v2/ (711f227); supersedes: field below preserves the lineage
created_at: 2026-05-16
updated_at: 2026-07-12
expires_at: null
supersedes: "plugin/docs/v2/team-composition.md"
sensitivity: public
applies_to: [plugin]
related: [claude-code-adapter, codex-openai-adapter, tools-and-mcp, cost-aware-tiering-and-lean-context, agent-communications, canonical-specialist-roster-groups-and-tiers]
---

# Team Composition

Guild v2 composes a new team at every phase entrypoint. The team is saved in a phase-scoped `.guild/team/<phase-slug>.yaml`; if the run started earlier, later phase teams may be appended to a shared phase plan, but no phase silently reuses the prior team. Each phase team is as small as possible, includes hard-rule specialists, attaches advisory memory agents, and records exact scope, tools, skills, MCP access, backend, and dependencies.

![Phase-specific team composition](../architecture/diagrams/03-team-composition.svg)

## Current Specialist Roster

Guild ships **15 domain specialist type templates** (`templates/specialists/*.md`,
`guild.specialist_template.v1`) plus the **2 machinery agents** (`agents/advisor.md`,
`agents/developer.md` — the only host-registered agents). A domain role joins a team
as a **project instance**: team-compose mints the matched template into the consuming
repo's `.guild/agents/<role>.md` (`roster-resolve.ts mint <role>`, deterministic, no
gates) and dispatch uses the definition-path mechanism. Canonical decision:
[`machinery-agents-vs-specialist-template-library.md`](../decisions/machinery-agents-vs-specialist-template-library.md).

The grouping below is the canonical **3-group** taxonomy the definition files
self-declare, set by
[`canonical-specialist-roster-groups-and-tiers.md`](../decisions/canonical-specialist-roster-groups-and-tiers.md)
(D1). Groups are presentation-only — the dynamic composer enumerates capability
per role and never buckets by group.

| # | Specialist (template) | Group |
|---|---|---|
| 1 | `architect` | engineering (`§6.1`) |
| 2 | `researcher` | engineering (`§6.1`) |
| 3 | `backend` | engineering (`§6.1`) |
| 4 | `frontend` | engineering (`§6.1`) |
| 5 | `devops` | engineering (`§6.1`) |
| 6 | `qa` | engineering (`§6.1`) |
| 7 | `mobile` | engineering (`§6.1`) |
| 8 | `security` | engineering (`§6.1`) |
| 9 | `copywriter` | content & communication (`§6.2`) |
| 10 | `doc-writer` | content & communication (`§6.2`) |
| 11 | `technical-writer` | content & communication (`§6.2`) |
| 12 | `social-media` | content & communication (`§6.2`) |
| 13 | `seo` | content & communication (`§6.2`) |
| 14 | `marketing` | commercial (`§6.3`) |
| 15 | `sales` | commercial (`§6.3`) |

Per the roster ADR (D1) the canonical taxonomy is **three groups**: `devops`/`qa`/`security` are **engineering**; `copywriter`/`doc-writer`/`technical-writer`/`social-media`/`seo` are **content & communication**; `marketing`/`sales` are **commercial**. This supersedes the earlier four-group split — the definition files self-identify with these three groups only. Canonical default tiers per specialist live in the same ADR (D2); machinery agents are `augmenting` (excluded from domain matching and cap-6).

`guild-plan.md` is the **frozen v1 record** (it states 13 specialists in
places); it is superseded by this v2 doc set.

### No new analysis specialist

v2 does **not** mint a dedicated codebase-analysis specialist for the
brownfield knowledge-graph engine. Analysis work reuses the existing
`researcher` and `architect` specialists, challenged at the G-init
adversarial-review step. Minting a new specialist requires the §11.2.1
extraction signals to agree (recurring gap across ≥3 unrelated runs, distinct
trigger boundary, context-isolation payoff, ≥3 positive/negative eval cases);
the analysis-engine workload does not meet the distinct-trigger-boundary bar
because `researcher`/`architect` already own it cleanly.

## Team Record

Every phase entry should carry:

```yaml
phases:
  planning:
    backend: agent-team   # audit mirror of the run-start-resolved backend, not the authority
    backend_reason: "D5-resolved at run-start: tmux available, not inside tmux, env set"
    specialists:
      - name: architect
        scope: "Define component boundaries and lane dependencies."
        skills:
          - guild:principles
          - architect-systems-design
          - architect-tradeoff-matrix
        tools:
          - Read
          - Grep
          - Glob
          - Write
        mcp_servers: []
        depends-on: []
        loop_role: producer
        advisory:
          - name: architect-memory-advisor
            sources: [context, standards, products, decisions]
            mode: read-only
```

The actual skill names should match the installed skill directories. The key rule is that team composition must say which capabilities each phase and lane needs instead of relying on ambient routing.

## Phase Team Defaults

| Phase | Default team | Why |
|---|---|---|
| Init | `researcher`, `technical-writer`, optional `architect`, advisory memory | Gather, classify, and document product knowledge. |
| Ideation | `architect`, `researcher`, optional product/content/domain specialists, advisory memory | Interactive brainstorm, questions, research, debate, idea spec. |
| Planning | `architect` or tech lead, `technical-writer`, `qa`, `security` when needed, advisory memory | PRD, features/actions, tasks, validation criteria, done conditions. |
| Development | task owners selected by plan, `qa`, `security`, `architect`/tech lead when boundaries change, advisory memory | Autonomous implementation, tests, security and architecture review. |
| Quality | `qa`, relevant implementers, `devops`, `security` when needed, advisory memory | E2E, smoke, accessibility, performance, release validation. |
| Operations | `devops`, relevant implementers, `security`, `qa`, advisory memory | Release, monitoring, incident, rollback, maintenance, runbooks. |

## Backend Selection

For Guild self-build on this operator's machine, the backend resolves to `agent-team` when these D5 preflight conditions hold:

1. `which tmux` succeeds.
2. `$TMUX` is unset.
3. `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set.

The backend is resolved once at run-start intake per the D5 ladder (team/tmux primary when available, in-process agent next, subagent last resort) and frozen in the run's resolved-settings snapshot (`snapshot.effective.agent_mode`). Phases read the frozen backend — they do not re-select per-phase. When `agent_mode != "team"` and tmux is available, the run-start preflight prompts to persist `agent_mode: "team"` (so future runs stop prompting); on NO the setting is not persisted and the prompt may fire again next run.

The ladder falls back to `subagent` when the preflight conditions are missing. `team.yaml` records the backend as a mirror for audit only — it is not the authority. When an audit `backend: agent-team` entry was written but the env var is now missing, execution surfaces the changed semantics to the user rather than silently falling back.

![tmux agent-team backend](../architecture/diagrams/04-agent-team-tmux.svg)

## Team Size Rules

- Recommended: 3-4 specialists.
- Maximum: 6 specialists unless the user explicitly passes an allow-larger override.
- The orchestrator does not count toward the cap.
- If a goal appears to need more than 6 specialists, split it into phases or lanes with separate team files.

## Implied Specialist Rules

| Condition | Specialist | Reason |
|---|---|---|
| Multi-component build | `architect` | Component boundaries and dependencies need ownership. |
| Auth, secrets, payments, webhooks, external APIs | `security` | Threats and trust boundaries must be explicit. |
| Backend present | `qa` | Server-side work needs integration and regression evidence. |
| User-facing UI | `frontend` and often `qa` | Accessibility, responsive behavior, and interaction state need coverage. |
| Public docs | `technical-writer` | Durable docs need task-focused structure and maintenance boundaries. |
| Search/discoverability | `seo` | SEO owns metadata, crawlability, and keyword strategy. |

## Gap Resolution

When no existing specialist fits:

1. Propose a role name and one-line responsibility.
2. Present four options:
   - `A auto-create` through the specialist factory.
   - `B skip` and flag missing coverage.
   - `C substitute` to an existing specialist with scope override.
   - `D compose from scratch`.
3. If auto-create is selected, the proposed specialist must pass extraction signals, boundary evals, paired evals, and shadow mode before it can join a live team.

A newly minted specialist is instantiated from the canonical
`plugin/templates/agents/AGENT.template.md` (`guild.agent_template.v1`) and
written to the **consuming repo's `.guild/agents/`** with
`derived_from_template: guild.agent_template.vN` — never the plugin install
dir, never outside `.guild/`. The plugin ships only the canonical
read-only base library + template; project specialists are project state.
The version string, the `derived_from_template` invariant, and the single
enforceable boundary rule are stated once in
[`target-architecture.md`](../../../../.guild/wiki/entities/target-architecture.md) and the
ownership-map ADR; cited here by pointer, never re-spelled.

## Tools and MCP in Team Compose

Tools and MCP servers are selected per phase and lane:

- Start with least privilege.
- Grant write tools only to lanes that must edit files.
- Grant network or browser access only when the spec requires external verification or UI testing.
- Grant MCP servers only when the lane needs structured access that plain filesystem tools cannot provide.
- Record MCP requirements in team and context artifacts because agent-team teammate frontmatter may not load the same way as subagent definitions.
- Attach at least one advisory memory agent to every producer/reviewer role unless the phase has no durable memory yet.

## Advisory Defaults

- When in doubt between two specialists, choose the narrower owner and add a reviewer rather than giving both broad write scope.
- When tool access is uncertain, give read-only access first and escalate through the orchestrator.
- When a phase has many unknowns, use a researcher in brainstorm instead of expanding the execution team.
- In planning, prefer architect/tech lead and QA over implementation specialists unless task details require implementation expertise.
- In development, maximize autonomy inside the approved task contract and route missing done criteria back to planning.
- When a missing role appears only once, substitute or skip; do not mint a specialist from a single task.
