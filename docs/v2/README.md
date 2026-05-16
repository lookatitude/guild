# Guild v2 Architecture

This folder is the v2 design reference for Guild's phase-entrypoint architecture. It extends the current `guild-plan.md` with the implementation state now present in the repo: `.claude-plugin` manifests, 14 specialists, 18 meta skills, 8 commands, internal adversarial loops, optional Codex gates, run-scoped telemetry, tmux-backed agent teams, advisory memory agents, and the factory path for new skills and agents.

## Reading Order

1. [architecture.md](architecture.md) - component map, state boundaries, and invariants.
2. [phase-entrypoints.md](phase-entrypoints.md) - how to start from init, ideation, planning, development, quality, or operations.
3. [lifecycle.md](lifecycle.md) - every phase, gate, loop, and artifact from loose idea to production operations.
4. [team-composition.md](team-composition.md) - how each phase gets a tailored team, backend, skills, tools, advisory agents, and MCP access.
5. [knowledge-and-advisory.md](knowledge-and-advisory.md) - wiki, memory recall, learning, and per-agent advisors.
6. [agent-and-skill-factory.md](agent-and-skill-factory.md) - how new concise Claude Code-first skills and personas are created, evaluated, shadowed, and registered.
7. [tools-and-mcp.md](tools-and-mcp.md) - tool and MCP attachment rules for subagents and tmux agent teams.
8. [adversarial-review.md](adversarial-review.md) - built-in challenger agent behavior, cross-model review, Codex parity, and review gates.
9. [edge-cases.md](edge-cases.md) - failure modes and advisory defaults.
10. [review-checklist.md](review-checklist.md) - completion and implementation checklist.
11. [review-trail.md](review-trail.md) - adversarial review findings and clean sign-off.

## Diagram Index

- [System component map](diagrams/01-system-map.svg)
- [Lifecycle and gates](diagrams/02-lifecycle-gates.svg)
- [Phase-specific team composition](diagrams/03-team-composition.svg)
- [Phase entrypoints](diagrams/09-phase-entrypoints.svg)
- [Knowledge and advisory memory](diagrams/10-knowledge-advisory.svg)
- [tmux agent-team backend](diagrams/04-agent-team-tmux.svg)
- [Context and handoff flow](diagrams/05-context-and-handoff.svg)
- [Adversarial loops](diagrams/06-adversarial-loops.svg)
- [Skill and agent factory](diagrams/07-skill-agent-factory.svg)
- [Tool and MCP routing](diagrams/08-tools-mcp-routing.svg)

## Binding Principles

- `guild-plan.md` remains the single source of truth for established Guild architecture.
- Current checked-in skills, commands, hooks, and agents refine the v2 design where they are more specific than the older plan.
- `docs/v2` is documentation-only. It does not change runtime behavior by itself.
- For Guild self-build work on this operator's machine, default `team.yaml backend:` to tmux-backed `agent-team` when `tmux` is available, `$TMUX` is unset, and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set. For general plugin users, `agent-team` remains explicit opt-in.
- Every phase composes its own team and review loop. Init and ideation are deliberately interactive; development, quality, and operations are autonomous as far as the approved contract allows.
- Every non-trivial design artifact has an adversarial challenger before it becomes authoritative, with cross-model review preferred when both Claude and Codex are available.
