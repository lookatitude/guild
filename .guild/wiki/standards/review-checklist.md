---
type: standard
owner: architect
confidence: high
importance: high
source_refs: []  # consolidated from plugin/docs/v2/ (711f227); supersedes: field below preserves the lineage
created_at: 2026-05-16
updated_at: 2026-06-21
expires_at: null
supersedes: "plugin/docs/v2/review-checklist.md"
sensitivity: public
applies_to: [plugin]
related: [review-trail, verification-plan-and-review]
---

# v2 Review Checklist

Use this checklist before treating v2 architecture documentation or implementation as complete.

## Prompt-to-Artifact Coverage

| Requirement | Evidence |
|---|---|
| Research, architecture, and design decisions reflected from ideation to detail | `architecture.md`, `lifecycle.md`, `edge-cases.md` |
| Group of agents/subagents explores concept decisions and research subjects | `team-composition.md`, `lifecycle.md` phase teams, L1/L2/L3/L4 challengers |
| Architecture from high level to each loop detail | `architecture.md`, `lifecycle.md`, `adversarial-review.md` |
| Multiple phase entrypoints exist | `phase-entrypoints.md`, `lifecycle.md` |
| Init sets up wiki and gathers product knowledge | `phase-entrypoints.md`, `knowledge-and-advisory.md`, `lifecycle.md` |
| Ideation is interactive and produces an idea spec | `lifecycle.md`, `phase-entrypoints.md` |
| Planning creates PRD, actions/features, tasks, validation criteria, and done conditions | `lifecycle.md`, `phase-entrypoints.md` |
| Development is autonomous after task approval and includes testing, security, and architecture review | `lifecycle.md`, `team-composition.md` |
| Optional quality phase designs/runs E2E tests from goals and development output | `lifecycle.md`, `phase-entrypoints.md` |
| Start from any phase in existing project | `phase-entrypoints.md`, `lifecycle.md` |
| Advisory memory agents support every producer/reviewer | `knowledge-and-advisory.md`, `team-composition.md`, `tools-and-mcp.md` |
| Cross-model adversarial reviewer selection | `adversarial-review.md` |
| Phase-level adversarial gates exist for all phases | `adversarial-review.md`, `lifecycle.md` |
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
| Current repo surface reflected | `.claude-plugin` generated compatibility manifest, 20 commands, 110 inventory skills, 17 registered specialists, 18 hook bindings, 2 MCP servers, 231 scripts, module-source `src/modules/*` ownership manifests/resources, clean-slate command verbs, `fix` maintenance verb (supersedes legacy diagnose), canonical `logs/v1.4-events.jsonl` + `events.ndjson` legacy mirror |
| Cross-host broker placed in every gate's review step | `cross-host-review-and-loop-control.md`, `adversarial-review.md` |
| Weak-independence (same-host) reviews are stamped and recorded | `cross-host-review-and-loop-control.md`, `review-trail.md` |

## Design Completeness Checks

- Every lifecycle phase has inputs, outputs, owner team, and failure handling.
- The team artifact is unambiguous: each phase composes and records its own team, not hidden reuse of a prior phase team.
- Every adversarial loop has producer, challenger, the correct sentinel
  (`## NO MORE QUESTIONS` for L1–L4 via the shipped `loop-*` skills,
  `## SATISFIED` for the `guild:codex-review` gate), cap behavior, and
  artifact path.
- The cross-host review broker is policy-gated, placed inside every
  gate's adversarial-review step, and stamps cross-host reviews STRONG /
  same-host reviews WEAK.
- Every team decision records backend, scope, skills, tools, MCP servers, and dependencies.
- Every producer/reviewer has an advisory memory pattern or an explicit reason it is unavailable.
- Development has security and architecture review signoff for every phase, including explicit not-applicable rationale when there are no findings.
- Every new-agent path includes extraction signals, proposed path, boundary scan, eval gates, shadow mode, and registration.
- Every tool escalation path routes through autonomy policy and user approval when needed.
- Every runtime artifact path is under `.guild/`.
- Every installed plugin artifact path is outside `.guild/`.
- Every Codex parity claim is backed by filesystem artifact compatibility.
- Self-fix is the `fix` maintenance verb (supersedes the legacy diagnose
  command) with its own Codex/broker gate.
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

If the reviewer has any comment, update the relevant docs and rerun the
review.
