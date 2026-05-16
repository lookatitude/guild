# v2 Review Checklist

Use this checklist before treating v2 architecture documentation or implementation as complete.

## Prompt-to-Artifact Coverage

| Requirement | Evidence |
|---|---|
| Research, architecture, and design decisions reflected from ideation to detail | `architecture.md`, `lifecycle.md`, `edge-cases.md` |
| Group of agents/subagents explores concept decisions and research subjects | `team-composition.md`, `lifecycle.md` phase teams, L1/L2/L3/L4 challengers |
| Architecture from high level to each loop detail | `architecture.md`, `lifecycle.md`, `adversarial-review.md` |
| Comprehensive SVG diagrams and flowcharts | `diagrams/*.svg` |
| Process to create new skills | `agent-and-skill-factory.md` |
| Process to create new agents with personas | `agent-and-skill-factory.md` |
| Tools and MCP servers can be added to agents | `tools-and-mcp.md`, `team-composition.md` |
| Each main phase creates tailored agents and skills | `team-composition.md`, `lifecycle.md` |
| Adversarial agent questions every design and architecture decision | `adversarial-review.md` |
| Edge cases and advisory defaults covered | `edge-cases.md` |
| Prefer tmux and teams of agents | `team-composition.md`, `diagrams/04-agent-team-tmux.svg` |
| Skills short, concise, Claude Code-first, Codex parity when possible | `agent-and-skill-factory.md`, `architecture.md` |
| Documentation organized under `/docs/v2` | This folder |
| Clean review by another agent | `review-trail.md` |
| Current repo surface reflected | `.claude-plugin` manifest, 14 specialists, 18 meta skills, 8 commands, `/guild:diagnose`, dual telemetry logs |

## Design Completeness Checks

- Every lifecycle phase has inputs, outputs, owner team, and failure handling.
- The team artifact is unambiguous: one phase-scoped `.guild/team/<slug>.yaml` with phase entries, not hidden later reselection.
- Every adversarial loop has producer, challenger, sentinel, cap behavior, and artifact path.
- Every team decision records backend, scope, skills, tools, MCP servers, and dependencies.
- Every new-agent path includes extraction signals, proposed path, boundary scan, eval gates, shadow mode, and registration.
- Every tool escalation path routes through autonomy policy and user approval when needed.
- Every runtime artifact path is under `.guild/`.
- Every installed plugin artifact path is outside `.guild/`.
- Every Codex parity claim is backed by filesystem artifact compatibility.
- `/guild:diagnose` is treated as a sidecar self-fix flow with its own Codex gate.
- Run resumption starts from the first missing artifact and does not silently invalidate downstream state.

## Review Questions

- Could a specialist execute from only the spec, team file, plan, and context bundle?
- Could review and verify work from only handoff receipts and run logs?
- Is any step relying on a hidden transcript or unrecorded user answer?
- Does any phase grant broader tools than the lane requires?
- Does any proposed new role have enough evidence to justify a specialist instead of a skill?
- Are tmux and agent-team preconditions explicit enough to avoid nested-session failures?
- Are cap-hit and malformed-sentinel branches auditable?
- Are external sources treated as data rather than instructions?

## Clean Sign-Off Criteria

The review is clean only when an independent agent can say:

```text
No blocking or advisory findings remain.
```

If the reviewer has any comment, update the relevant docs and rerun the review.
