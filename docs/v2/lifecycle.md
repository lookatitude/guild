# v2 Lifecycle

The v2 lifecycle is a set of phase entrypoints, not one mandatory linear command. A user can start from loose ideas in a brand-new project, from an existing codebase with prior product knowledge, from an already-written idea spec, from an approved PRD, or from development output that needs quality validation.

![Lifecycle and gates](diagrams/02-lifecycle-gates.svg)

Every phase repeats the same control pattern:

1. Resolve phase input and run id.
2. Assemble phase memory from `.guild/wiki`, `.guild/raw`, prior phase artifacts, and current repository state.
3. Compose a phase-specific team plus advisory agents.
4. Run the producer work loop.
5. Run phase-level adversarial review with cross-model preference.
6. Resolve findings by revising the artifact or recording an explicit assumption.
7. Write a phase artifact and handoff receipt.

## Phase Entrypoints

| Phase | Start when | Primary artifact | Interaction level |
|---|---|---|---|
| Init | New repo, existing product onboarding, or knowledge refresh. | `.guild/wiki/**`, `.guild/init/<slug>.md` | Interactive for new products; mostly autonomous for existing repos. |
| Ideation | User has loose ideas, goals, alternatives, or a product direction to explore. | `.guild/spec/<idea-slug>.md` | Highly interactive. |
| Planning | User has an idea spec and wants a PRD/action plan. | `.guild/prd/<slug>.md`, `.guild/plan/<slug>.md` | Interactive at approval gates, otherwise structured. |
| Development | User has approved tasks and wants implementation. | `.guild/runs/<run-id>/handoffs/*.md`, changed product artifacts | Autonomous as much as the autonomy contract allows. |
| Quality | Optional after development, when E2E or release validation is needed. | `.guild/quality/<run-id>.md`, test reports | Mostly autonomous, with release/blocker gates. |
| Operations | Existing production product needs release, monitoring, incident, rollback, or maintenance work. | `.guild/ops/<run-id>.md` | Autonomous for approved runbooks; interactive for risky changes. |

See [phase-entrypoints.md](phase-entrypoints.md) for the full contract.

## Init Phase

Goal: create or refresh the product knowledge base.

Inputs:

- Existing repository, docs, tickets, customer notes, product artifacts, or an empty project.
- Optional user brief describing product, market, constraints, and goals.

Process:

1. Determine whether the product already exists.
2. If it exists, gather and classify repo/docs/product knowledge into `.guild/raw` and `.guild/wiki`.
3. If it is new, ask high-level questions about product type, users, value proposition, constraints, non-goals, and success horizon.
4. Create foundational wiki pages: context, goals, non-goals, standards, products, entities, concepts, sources, and initial decisions.
5. Run G-init adversarial review to challenge missing context, stale facts, and unsupported assumptions.

Outputs:

- `.guild/init/<slug>.md`
- `.guild/wiki/index.md`
- foundational `.guild/wiki/**` pages
- `.guild/raw/sources/**` for copied source material

Done criteria:

- The wiki has enough context for an ideation or planning team to operate without relying on hidden chat history.
- Known unknowns are listed explicitly.
- External or repo-derived facts have source refs.

## Ideation Phase

Goal: turn a loose idea into an idea spec.

Inputs:

- User idea or question.
- Init-phase big picture from `.guild/wiki/context`, goals, non-goals, product pages, and decisions.

Process:

1. Run an interactive brainstorm with the user.
2. Ask clarifying questions, research relevant unknowns, debate alternatives, and compare tradeoffs.
3. Use advisory agents to retrieve relevant project memory and prior research for each producer agent.
4. Run G-ideation adversarial review on the idea, assumptions, target user, risks, and success criteria.
5. Iterate until the reviewer has no further findings or the user explicitly accepts assumptions.

Outputs:

- `.guild/spec/<idea-slug>.md`
- optional `.guild/research/<idea-slug>.md`
- decision captures for medium/high-significance choices

Done criteria:

- The idea spec states goal, audience, problem, proposed solution, alternatives rejected, constraints, risks, success criteria, and open assumptions.
- The spec is grounded in init knowledge and cites any new research.

## Planning Phase

Goal: convert the idea spec into a PRD and executable task plan.

Inputs:

- `.guild/spec/<idea-slug>.md`
- relevant wiki pages and decisions

Process:

1. Compose a planning team that may contain architect, product/technical writer, researcher, security, QA, and domain specialists; developers are included only when implementation detail is needed.
2. Produce a PRD-style artifact: problem, users, requirements, non-goals, user journeys, system constraints, edge cases, rollout, risks, and metrics.
3. Break the PRD into features/actions.
4. Break every feature/action into tasks.
5. Give every task validation criteria, done conditions, evidence requirements, dependencies, owner role, and autonomy policy.
6. Run G-planning adversarial review against edge cases, missing requirements, vague done criteria, security/privacy gaps, and untestable claims.

Outputs:

- `.guild/prd/<slug>.md`
- `.guild/plan/<slug>.md`
- `.guild/team/<slug>.yaml` with phase and lane entries

Done criteria:

- Every task can be picked up by a development team without asking what "done" means.
- Every feature maps back to idea-spec success criteria.
- Risks, edge cases, and approval gates are explicit.

## Development Phase

Goal: autonomously implement approved tasks.

Inputs:

- approved `.guild/plan/<slug>.md`
- `.guild/team/<slug>.yaml`
- context bundles

Process:

1. Compose the development team from the task graph; include only needed implementers plus QA, security, architect, or devops reviewers as required.
2. Build context bundles per task from the plan, wiki, codebase, and advisory memory.
3. Dispatch tasks through subagents or tmux agent-team.
4. Run implementation loops for each task:
   - owner builds;
   - tester challenges logic and edge cases;
   - QA challenges evidence and regression coverage;
   - security reviews every development phase, either with findings or explicit `not_applicable` signoff and rationale;
   - architect/tech lead reviews every development phase, either with findings or explicit `not_applicable` signoff and rationale.
5. Write a handoff receipt for each task.

Outputs:

- changed files or product artifacts
- `.guild/runs/<run-id>/handoffs/<task>.md`
- `.guild/runs/<run-id>/assumptions.md`
- test, review, and telemetry evidence

Done criteria:

- Every task done condition is met or explicitly blocked.
- Evidence exists for every validation criterion.
- Security and architecture review findings are resolved or accepted by an explicit gate.

## Quality Phase

Goal: optionally validate the developed output against product goals with E2E or release-level tests.

Inputs:

- development receipts
- PRD and plan validation criteria
- product goals and user journeys

Process:

1. Compose a quality team: QA, frontend/mobile/backend as needed, devops for environments, security for sensitive flows, and an advisory memory agent for product expectations.
2. Design E2E tests from user journeys and goals.
3. Run tests, screenshots, accessibility checks, performance checks, integration checks, or release smoke tests as applicable.
4. Run G-quality adversarial review against test coverage and release risk.
5. Produce a pass/fail quality report.

Outputs:

- `.guild/quality/<run-id>.md`
- E2E artifacts, screenshots, logs, or metrics
- release/blocker decision

Done criteria:

- E2E coverage maps to user journeys and goals.
- Blockers are either fixed or explicitly accepted.
- Release readiness is stated with evidence.

## Operations Phase

Goal: carry the product into production and ongoing operations.

Inputs:

- release candidate, deployed product, incident, maintenance request, or monitoring objective
- runbooks, SLOs, known risks, and prior production decisions

Process:

1. Compose an operations team: devops, backend/frontend/mobile as needed, security, QA, and advisory memory.
2. Run release, monitoring, incident, rollback, migration, or maintenance workflows according to approved autonomy policy.
3. Capture production decisions, incidents, and learnings into `.guild/wiki`.
4. Run G-operations adversarial review on blast radius, rollback, observability, customer impact, and security.

Outputs:

- `.guild/ops/<run-id>.md`
- runbook updates
- incident/release records
- wiki decision/source updates

Done criteria:

- Operational action has evidence, rollback notes, and owner.
- Production knowledge is captured for future recall.

## Review Loops

Each phase has review loops, but the producer and challenger change with the phase goal:

| Phase | Producer | Challenger | Typical focus |
|---|---|---|---|
| Init | researcher/technical-writer | G-init adversarial reviewer | Missing or unsupported knowledge. |
| Ideation | architect/researcher/product writer | G-ideation adversarial reviewer | Weak idea, bad assumptions, missing alternatives. |
| Planning | architect/technical-writer | G-planning reviewer plus QA/security | PRD gaps, edge cases, vague validation. |
| Development | task owner | tester/QA/security/architect | Defects, regressions, architecture drift. |
| Quality | QA | G-quality reviewer/domain owner | E2E coverage and release risk. |
| Operations | devops/domain owner | G-operations reviewer/security | Blast radius, rollback, monitoring gaps. |

Cross-model adversarial selection is defined in [adversarial-review.md](adversarial-review.md).

## Resumption

Every phase can resume from its artifact directory. The orchestrator checks for the phase artifact, team file, context bundles, receipts, review trail, and done report. It restarts only the first missing or invalid step unless the user explicitly asks to redo an earlier step.

Forced restart of a completed or partially completed phase requires explicit user confirmation because it can invalidate downstream artifacts.
