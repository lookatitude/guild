# v2 Architecture

Guild v2 is a Claude Code-first orchestration plugin that supports product development from loose ideas to production operations. It is organized around phase entrypoints: init, ideation, planning, development, optional quality, and operations. The orchestrator remains the only global coordinator. Specialists receive compact context bundles, work through either subagents or a tmux-backed agent-team backend, consult advisory memory agents, write receipts, and feed review, verification, reflection, and evolution.

![System component map](diagrams/01-system-map.svg)

## Components

| Component | Responsibility | Durable artifacts |
|---|---|---|
| Orchestrator | Owns the lifecycle, user gates, team selection, dependency graph, review routing, and final verification. | `.guild/spec`, `.guild/team`, `.guild/plan`, `.guild/runs` |
| Meta skills | Implement the workflow spine: brainstorm, team-compose, plan, context-assemble, execute-plan, review, verify, reflect, decisions, Codex review, diagnose, loops, specialist creation. Current count is 18. | `skills/meta/*/SKILL.md` |
| Specialist agents | Execute bounded lane work with role-specific skills and handoff contracts. Current roster is 14 specialists, including `frontend`. | `agents/*.md`, `skills/specialists/*` |
| Advisory agents | Read memory and prior research for a producer or reviewer, then provide grounded advice without owning implementation. | `.guild/context`, `.guild/wiki`, `.guild/runs` |
| Context assembler | Builds the authoritative per-lane brief from universal, role-dependent, and task-dependent layers. | `.guild/context/<run-id>/*.md` |
| Execution backend | Runs lanes as subagents by default or as a tmux agent team when approved and available. | `.guild/runs/<run-id>/agent-team/session.json` |
| Knowledge layer | Stores project memory by lifetime and captures medium/high-significance decisions. | `.guild/wiki`, `.guild/raw` |
| Telemetry and hooks | Capture run events, loop events, skill coverage, receipts, and reflection triggers. | `.guild/runs/<run-id>/events.ndjson`, `logs/v1.4-events.jsonl` |
| Evolution loop | Promotes skill and agent improvements through evals, shadow mode, boundary checks, and rollback snapshots. | `.guild/evolve`, `.guild/skill-versions` |

## State Boundaries

Installed plugin state is static and versioned:

- `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`
- `commands/*.md`
- `skills/**/SKILL.md`
- `agents/*.md`
- `hooks/hooks.json`
- `scripts/**`

Project-local runtime state is mutable and belongs under the consuming repository's `.guild/` directory:

- `spec/`, `team/`, `plan/`, `context/`
- `runs/`, `reflections/`, `evolve/`, `skill-versions/`
- `wiki/` and `raw/`

The Guild repo also has its own `.guild/` for self-build knowledge. That state is repo-scoped, not plugin-shipped state.

## v2 Invariants

- Each phase can be entered directly if its required artifact exists; otherwise the orchestrator asks for or builds the missing prerequisite.
- Init and ideation are interactive by design. Development, quality, and operations run autonomously as far as the approved contract allows.
- The init wiki, idea spec, PRD/plan, team file, and receipts are authoritative artifacts. Later phases do not infer hidden scope from chat.
- User gates are mandatory before autonomous execution: spec approval, team approval, plan/task approval, and any destructive/external operations gate. After task approval, development executes under the approved autonomy contract.
- Every specialist lane has one context bundle before dispatch and one handoff receipt after dispatch.
- Every producer/reviewer gets an advisory memory agent when durable memory exists. If no memory exists yet, init records that exception and creates the first knowledge base.
- Every handoff includes scope, artifacts, assumptions, evidence, open risks, and follow-up tasks.
- Team size defaults to 3-4 specialists and is capped at 6 unless the user explicitly overrides.
- `architect` is implied for multi-component work, `security` is implied for auth/secrets/external integrations, and `qa` is implied when backend is present.
- For general plugin users, agent-team execution needs explicit approval, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, `tmux`, and a non-tmux parent shell. For Guild self-build on this machine, prior policy grants durable approval, so the preflight conditions become the deciding gate.
- Codex review is optional for plugin users, but Guild self-build treats it as always on when running the lifecycle.
- New specialists are incubated, boundary-scanned, eval-gated, shadowed, and only then registered.

## High-Level Flow

1. User enters any phase: init, ideation, planning, development, quality, or operations.
2. Config, run-id, phase inputs, and missing prerequisites are resolved.
3. Init builds or refreshes wiki knowledge.
4. Ideation uses init knowledge to brainstorm, research, debate, and produce an idea spec.
5. Planning turns the idea spec into a PRD, features/actions, tasks, validation criteria, and done conditions.
6. Development autonomously executes approved tasks with test, security, and architecture review.
7. Quality optionally designs and runs E2E/release validation from development output and product goals.
8. Operations handles release, monitoring, incident, rollback, and maintenance work.
9. Every phase composes a tailored team, attaches advisory agents, and runs adversarial review loops.
10. Reflection proposes wiki, skill, and agent improvements.
11. `/guild:diagnose` can inspect recent telemetry, produce a diagnosis/fix plan, optionally run G-diagnose review, and require explicit approval before edits.

## Design Tradeoffs

| Decision | Rationale | Risk | Guardrail |
|---|---|---|---|
| Orchestrator remains central | Keeps user gates, dependencies, and artifact ownership coherent. | Coordination bottleneck. | Parallelize only independent lanes. |
| Context bundles over full repo dumps | Keeps specialists focused and rerunnable. | Missing context. | Hard receipt evidence plus adversarial review. |
| Advisory memory agents per producer/reviewer | Lets agents recall relevant facts without bloating every prompt. | Advisor oversteps and becomes hidden implementer. | Advisors are read-only unless assigned an explicit ingest task. |
| Prefer tmux agent teams when safely available | Enables peer challenge and shared coordination for complex phases. | Experimental backend and nested-session failures. | Preflight tmux, `$TMUX`, env var, and user approval. |
| Skills stay short and role-focused | Reduces trigger ambiguity and prompt bloat. | Too many small skills. | Extraction only after repeated evidence and eval cases. |
| Product-agnostic phase contracts | Supports software, content, commercial, and operational products. | Too generic to execute. | Each phase emits concrete artifacts, criteria, and done conditions. |
| Adjacent-boundary edits for new agents | Prevents old agents from stealing new triggers. | Boundary overcorrection. | Paired evals on every boundary edit. |

## Codex Parity

The primary target is Claude Code. Codex parity is a design constraint, not an equal implementation target. v2 keeps parity possible by:

- putting behavior in markdown skills and agent definitions where possible;
- keeping artifacts filesystem-based instead of runtime-private;
- expressing teams, lanes, tools, and MCP requirements as serializable YAML/markdown;
- treating Codex review as an adversarial gate that can skip gracefully when unavailable;
- avoiding architecture choices that require Claude-only hidden state.
