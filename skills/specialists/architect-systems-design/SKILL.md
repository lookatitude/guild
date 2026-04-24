---
name: architect-systems-design
description: Multi-component system design. Produces a design doc at `.guild/runs/<run-id>/design/<slug>.md` with component diagram (text/mermaid), data-flow, failure modes, and non-functional requirements (latency, availability, cost envelope). Pulled by the `architect` specialist. TRIGGER: "design the system for X", "sketch the architecture of X", "what are the main components of X", "propose a high-level design", "draft a system diagram", "how should we structure the service for X". DO NOT TRIGGER for: single-option choice between two existing approaches (use `architect-tradeoff-matrix`), capturing a decision after it's already made (use `architect-adr-writer`), API endpoint shape (backend-api-contract), DB schema (backend-data-layer), CI/CD or infra provisioning (devops-infrastructure-as-code), deployment topology (devops group), threat modeling (security-threat-modeling).
when_to_use: The parent `architect` specialist pulls this skill when the task requires sketching a multi-component system from scratch or substantially reshaping an existing one. Also fires on explicit user request.
type: specialist
---

# architect-systems-design

Implements `guild-plan.md §6.1` (architect specialist · systems-design skill) under the engineering group per `§6.4` (TDD-first, surgical diffs, evidence = a design doc the reviewer can trace line by line).

## What you do

Produce a concise design doc that names every component, the data that flows between them, how each component fails, and the non-functional envelope the design must live inside. The doc is the contract a reviewer signs off on before backend/devops pick it up.

- Enumerate components with one-line responsibilities (no empty boxes).
- Draw data flow as a directed list or mermaid graph — who calls whom, sync or async, what payload.
- List the top 3–5 failure modes per critical path and the mitigation for each.
- State non-functional requirements as numbers: latency budget, availability target, throughput ceiling, cost envelope, data-at-rest/in-transit posture.
- Mark every open question explicitly — do not paper over ambiguity.

## Output shape

A markdown file at `.guild/runs/<run-id>/design/<slug>.md` with sections:

1. **Context** — one paragraph on the problem and scope.
2. **Components** — bulleted list, one line each, responsibility + tech hint.
3. **Data flow** — text arrows or mermaid `graph LR`.
4. **Failure modes** — table of failure · blast-radius · mitigation.
5. **Non-functional requirements** — numbered targets.
6. **Open questions** — unresolved forks the reviewer must answer.

Keep the doc under ~400 lines. If it grows larger, the design is too coarse — split into sub-designs.

## Anti-patterns

- Over-modeling: five layers where two suffice. Simplicity-first.
- Enterprise-patterns cargo-cult: dropping in CQRS, saga, or hexagonal because they sound senior. Use them only if a specific failure mode demands them.
- Infra details: AMIs, subnet CIDRs, IaC snippets belong to `devops-infrastructure-as-code`, not here.
- Empty boxes: a component labeled "Gateway" with no responsibility is noise.
- Vague NFRs: "low latency" is not a number. "p95 ≤ 200ms at 500 rps" is.

## Handoff

Return the design-doc path to the invoking `architect` specialist. Downstream, the architect typically chains into `architect-tradeoff-matrix` (when multiple designs are viable) or `architect-adr-writer` (to freeze the chosen path). If the design crosses into API shape or DB schema, the `architect` agent hands off to `backend` — this skill does not dispatch.
