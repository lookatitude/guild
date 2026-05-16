# Phase Entrypoints

Guild v2 exposes product-development phases as first-class entrypoints. The user can start at any phase, and the orchestrator must build enough context from local knowledge, repo state, and user input to make that phase safe.

## Entrypoint Contract

Every phase entrypoint resolves the same contract:

```yaml
phase: init | ideation | planning | development | quality | operations
input_artifacts: []
required_memory:
  - context
  - goals
  - standards
  - products
team_path: .guild/team/<phase-slug>.yaml
output_artifacts:
  - phase-specific primary artifact
  - phase handoff/review trail
review:
  adversarial: true
  advisory_agents: true
autonomy:
  interactive_until: <gate>
  autonomous_after: <gate>
```

The contract lets Guild support both new projects and existing projects without assuming a fixed start point.

Primary artifacts are phase-specific:

| Phase | Primary outputs |
|---|---|
| Init | `.guild/init/<slug>.md`, `.guild/wiki/**`, `.guild/raw/**` |
| Ideation | `.guild/spec/<idea-slug>.md`, optional `.guild/research/<idea-slug>.md` |
| Planning | `.guild/prd/<slug>.md`, `.guild/plan/<slug>.md`, `.guild/team/<phase-slug>.yaml` |
| Development | `.guild/runs/<run-id>/handoffs/*.md`, changed files/artifacts, `.guild/runs/<run-id>/assumptions.md` |
| Quality | `.guild/quality/<run-id>.md`, E2E artifacts/logs/screenshots |
| Operations | `.guild/ops/<run-id>.md`, runbook/release/incident updates |

## Phase Inputs And Outputs

| Entrypoint | User phrase | Required existing artifact | If missing |
|---|---|---|---|
| Init | "set up Guild for this product" | none | Ask high-level project questions and inspect repo/docs. |
| Ideation | "I have an idea" | init wiki preferred | Build minimal init context first, then brainstorm. |
| Planning | "turn this spec into a PRD/tasks" | idea spec | Ask for or create an idea spec. |
| Development | "build these tasks" | approved plan/tasks | Refuse autonomous build until tasks have validation criteria. |
| Quality | "run E2E/release validation" | development output | Ask for target build or run receipts. |
| Operations | "prepare release/monitor/fix incident" | product context/runbook preferred | Build operational context and approval gates. |

## Init Entrypoint

Use init when product knowledge is absent, stale, or incomplete.

Existing product path:

1. Inspect repo structure, docs, manifests, tests, and deployment hints.
2. Gather product, users, architecture, standards, and known decisions.
3. Classify knowledge into `.guild/wiki`.
4. Preserve source material in `.guild/raw`.
5. Produce `.guild/init/<slug>.md` with coverage gaps.

New product path:

1. Ask high-level questions about target user, problem, value, constraints, differentiation, product type, risk, and success horizon.
2. Create foundational wiki pages from answers.
3. Mark unknowns explicitly rather than inventing them.

## Ideation Entrypoint

Use ideation when the user wants brainstorming, questioning, research, and debate.

The phase must be interactive:

- ask clarifying questions;
- propose alternatives;
- research unknowns when allowed;
- debate tradeoffs;
- challenge assumptions;
- produce an idea spec grounded in init knowledge.

## Planning Entrypoint

Use planning when an idea spec exists and the user needs a PRD or executable plan.

Planning output must include:

- PRD summary;
- features/actions;
- task breakdown;
- dependencies;
- edge cases;
- validation criteria per task;
- done conditions per task;
- evidence required per task;
- autonomy policy and approval gates.

## Development Entrypoint

Use development when tasks are approved and have validation criteria.

Development should be autonomous by default within the approved contract:

- compose implementer/reviewer team from tasks;
- build context bundles;
- execute tasks;
- test and review;
- run security review and architecture review for every development phase, either with findings or an explicit `not_applicable` signoff and rationale;
- write receipts and evidence.

If a task lacks done criteria, route back to planning.

## Quality Entrypoint

Use quality when the product needs E2E or release-level validation after development.

Quality output should include:

- test plan tied to product goals and user journeys;
- executed E2E/smoke/accessibility/performance checks as applicable;
- artifacts and logs;
- pass/fail release decision;
- blockers and residual risks.

## Operations Entrypoint

Use operations for production readiness and ongoing product work:

- release prep;
- monitoring and observability;
- incidents;
- rollbacks;
- migrations;
- maintenance;
- post-release learning.

Operations must capture useful production facts back into `.guild/wiki`.
