---
name: qa-test-strategy
description: Picks the test shapes (unit / integration / e2e / contract) for a feature, sets coverage targets per layer, and captures the matrix. Output: `test-strategy.md` plus a coverage-target matrix that downstream test writers implement. Pulled by the `qa` specialist. TRIGGER: "what tests do we need for X", "design the test strategy for X", "pick the test types for X", "draft the coverage plan for X", "how should we test X", "decide the test pyramid for X". DO NOT TRIGGER for: writing property-based tests (use `qa-property-based-tests`), authoring snapshot tests (use `qa-snapshot-tests`), diagnosing flaky tests (use `qa-flaky-test-hunter`), writing the actual implementation tests file (backend / mobile groups own those), CI/CD pipeline shape (devops-ci-cd-pipeline), acceptance criteria authored by product.
when_to_use: The parent `qa` specialist pulls this skill when the task requires deciding what kinds of tests a feature needs and what they cover. Also fires on explicit user request.
type: specialist
---

# qa-test-strategy

Implements `guild-plan.md §6.1` (qa · test-strategy) under `§6.4` engineering principles: tests are the contract; the strategy names which contracts a given feature is accountable for, and what shape the proof takes.

## What you do

Decide the test pyramid for one feature or service. Name the shapes, set coverage targets per layer, flag the risky seams that need extra scrutiny, and call out what you are deliberately not testing.

- Apply the pyramid: many unit tests, fewer integration, few e2e — inversion is a red flag.
- Add contract tests at every service-to-service boundary; mocks diverge from reality.
- Set coverage targets per layer, not globally (e.g. unit ≥ 80%, integration covers all error paths).
- Flag risky paths that warrant property-based or fuzz tests.
- List out-of-scope explicitly so nobody later says "you forgot load testing."
- Map each acceptance criterion to the layer(s) that prove it.

## Output shape

A markdown file `test-strategy.md` with:

1. **Feature scope** — what's in, what's out.
2. **Pyramid** — unit / integration / contract / e2e counts and coverage targets.
3. **Risky seams** — what needs property / fuzz / load / chaos tests.
4. **Criterion → test-layer map** — each acceptance criterion anchored to a layer.
5. **Out-of-scope** — tests intentionally omitted, with rationale.

Store next to the feature spec or at `.guild/runs/<run-id>/qa/test-strategy.md`.

## Anti-patterns

- E2E-heavy pyramid inversion — slow, flaky, brittle; pushes bugs to end of pipeline.
- Coverage-% as the goal — 100% line coverage with no assertions proves nothing.
- Testing implementation details — private methods, internal caches; tests break on refactor.
- No contract tests at service seams — integration "passes" until prod.
- No criterion-to-test mapping — QA signs off without knowing what was proved.
- Silent out-of-scope decisions — future readers assume coverage that doesn't exist.

## Handoff

Return the strategy doc path to the invoking `qa` specialist. Downstream, the qa agent chains into `qa-property-based-tests` or `qa-snapshot-tests` when the strategy calls for them; test-writing itself may be handed off to the service specialist (backend / mobile). This skill does not dispatch.
