# Adversarial Review

Guild v2 uses challengers at every load-bearing decision point. The challenger can be an internal specialist loop, Codex adversarial review, or a final review specialist. The objective is not debate for its own sake; it is to force missing requirements, edge cases, and weak evidence into artifacts before execution continues.

![Adversarial loops](diagrams/06-adversarial-loops.svg)

## Challenger Roles

| Gate | Producer | Challenger | Focus |
|---|---|---|---|
| L1 spec clarification | Architect | Researcher | Unknowns, factual gaps, hidden assumptions. |
| L2 plan review | Architect | Security | Plan defects, autonomy policy, scope overlap, untestable criteria. |
| L3 implementation | Lane owner | Tester | Properties, edge cases, minimal failing examples. |
| L4 implementation | Lane owner | QA | Regression strategy, evidence quality, completeness. |
| Security review | Lane owner | Security | High-severity unaddressed findings. |
| G-spec | Spec artifact | Codex | Missing criteria, ambiguity, security, autonomy, untestable claims. |
| G-plan | Plan artifact | Codex | Lane contract defects and unhandled dependencies. |
| G-lane | Handoff receipt | Codex | Missing evidence, incomplete scope, unresolved risks. |
| G-diagnose | Diagnosis report | Codex | Weak self-fix plan, unsafe edit proposal, missing evidence. |
| Final review | Receipts | QA/domain peer | Spec conformance and quality. |

## Internal Loop Contract

Every internal loop has:

- fixed cap;
- round start and round end events;
- producer output;
- challenger response;
- exact termination sentinel `## NO MORE QUESTIONS`;
- post-sentinel scan for unresolved questions, blockers, or TODO markers;
- cap escalation choices: `force-pass`, `extend-cap`, `rework`;
- summary artifact in `.guild/runs/<run-id>/loops/`;
- assumptions appended when force-passed.

Malformed termination never silently passes. Two consecutive malformed terminations escalate.

## Codex Review Contract

Codex review is a separate adversarial gate through `guild:codex-review`.

Pass signal:

```markdown
## SATISFIED
```

The sentinel must be a standalone trimmed line and must not coexist with unresolved findings.

Round cap:

- default: 5;
- configurable by `--codex-cap=N` or `.guild/config.yml`;
- maximum: 10.

Unavailable Codex:

- emit a warning;
- continue the run;
- do not hard-block normal plugin users.

Guild self-build:

- treat Codex review as always on for lifecycle gates;
- if Codex is unavailable, record the skip and continue rather than blocking on tooling outage.

## Adversarial Agent Prompt Shape

An adversarial agent should ask:

- What success criterion is missing or unmeasurable?
- What dependency is implicit but not recorded?
- What user approval or autonomy boundary is unclear?
- What security, privacy, or destructive-action risk is hidden?
- What edge case would cause a lane to produce a plausible but wrong artifact?
- What evidence would prove completion?
- What would make this plan fail under parallel execution?
- What assumption should be promoted into `.guild/wiki/decisions`?

If no issue remains, the challenger emits only the required sentinel.

## Advisory Posture

When in doubt, the adversarial agent should prefer:

- narrowing scope over broadening it;
- explicit assumptions over silent inference;
- user confirmation for destructive or external effects;
- measurable criteria over qualitative statements;
- restarting a lane over accepting a high-severity unaddressed security finding;
- documenting a residual risk over hiding uncertainty.

## Review Artifacts

| Artifact | Path |
|---|---|
| Internal loop round handoffs | `.guild/runs/<run-id>/handoffs/<loop>/` |
| Loop summary | `.guild/runs/<run-id>/loops/<loop>-summary.md` |
| Codex trail | `.guild/runs/<run-id>/codex-review/<gate>.md` |
| Loop JSONL | `.guild/runs/<run-id>/logs/v1.4-events.jsonl` |
| Legacy telemetry | `.guild/runs/<run-id>/events.ndjson` |
| Final review | `.guild/runs/<run-id>/review.md` |
| Verification report | `.guild/runs/<run-id>/verify.md` |

## Clean Review Definition

A design or architecture artifact has a clean review only when:

1. the reviewer maps every explicit requirement to an artifact or calls it missing;
2. all findings are resolved in the artifact, not just acknowledged in chat;
3. no blocking or advisory comments remain;
4. the reviewer states the clean sentinel or equivalent sign-off;
5. the review trail is saved or summarized with evidence.
