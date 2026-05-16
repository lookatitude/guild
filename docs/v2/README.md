# Guild v2 Architecture

This folder is the v2 design reference for Guild's agent-team architecture. It extends the current `guild-plan.md` with the implementation state now present in the repo: `.claude-plugin` manifests, 14 specialists, 18 meta skills, 8 commands, internal adversarial loops, optional Codex gates, run-scoped telemetry, tmux-backed agent teams, and the factory path for new skills and agents.

## Reading Order

1. [architecture.md](architecture.md) - component map, state boundaries, and invariants.
2. [lifecycle.md](lifecycle.md) - every phase, gate, loop, and artifact from brief to reflection.
3. [team-composition.md](team-composition.md) - how each phase gets a tailored team, backend, skills, tools, and MCP access.
4. [agent-and-skill-factory.md](agent-and-skill-factory.md) - how new concise Claude Code-first skills and personas are created, evaluated, shadowed, and registered.
5. [tools-and-mcp.md](tools-and-mcp.md) - tool and MCP attachment rules for subagents and tmux agent teams.
6. [adversarial-review.md](adversarial-review.md) - built-in challenger agent behavior, Codex parity, and review gates.
7. [edge-cases.md](edge-cases.md) - failure modes and advisory defaults.
8. [review-checklist.md](review-checklist.md) - completion and implementation checklist.
9. [review-trail.md](review-trail.md) - adversarial review findings and clean sign-off.

## Diagram Index

- [System component map](diagrams/01-system-map.svg)
- [Lifecycle and gates](diagrams/02-lifecycle-gates.svg)
- [Phase-specific team composition](diagrams/03-team-composition.svg)
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
- Every non-trivial design artifact has an adversarial challenger before it becomes authoritative.
