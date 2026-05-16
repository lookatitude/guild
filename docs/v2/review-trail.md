# v2 Review Trail

## Prior Review

The first documentation pass created the `docs/v2` package and received a clean review for the earlier single-lifecycle architecture. That review is now historical because the architecture was revised to a phase-entrypoint model.

## Phase-Entrypoint Review Pass

Reviewer found:

- The universal `output_artifact: .guild/<phase>/<slug>.md` contract contradicted phase-specific outputs.
- Phase-level adversarial gates were underspecified for init, ideation, quality, and operations.
- Advisory memory support used inconsistent `may` versus mandatory language.
- Development security and architecture review were described as conditional rather than requiring explicit signoff.
- The prior clean sign-off text had become stale after the architecture changed.

Resolution:

- `phase-entrypoints.md` now lists primary outputs per phase.
- `adversarial-review.md` now defines `G-init`, `G-ideation`, `G-planning`, `G-development`, `G-quality`, `G-operations`, and `G-diagnose`, with old `G-spec/G-plan/G-lane` names treated as compatibility mappings.
- `architecture.md`, `knowledge-and-advisory.md`, `team-composition.md`, and `tools-and-mcp.md` now require advisory agents for producers and reviewers when memory exists.
- `phase-entrypoints.md` and `lifecycle.md` now require development security and architecture review signoff for every development phase, including `not_applicable` rationale when appropriate.

## Current Status

Final adversarial pass result:

```text
No blocking or advisory findings remain.
```
