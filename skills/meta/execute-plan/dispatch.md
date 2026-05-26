# Backend choice, routing & parallelism

Detail for `guild:execute-plan`'s `## Backend + routing (summary)` and parallelism scheduling. Per `guild-plan.md §7.3` and §8.

## Backend choice

Guild supports three execution backends. The choice is **resolved by the `agent_mode` ladder** (ADR D5; `CLAUDE.md §"Backend default"`) at `guild:team-compose` and mirrored into `team.yaml`; `guild:execute-plan` **reads and honors** it — it never re-picks. **Team/agent is primary whenever tmux is present; subagent is the fallback, not the default.**

| Backend | Selected when (`agent_mode` resolves to…) | Tradeoff |
|---|---|---|
| **Agent teams (tmux panes)** | `team` — `auto` + tmux available (the common case on a dev machine) **or** an explicit `team` pin. One **visible pane per specialist**. | Experimental; requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; one team per session; no nested teams; higher token cost. **PRIMARY under tmux.** |
| **Independent agents** | `agent` — host supports independent agents, no tmux. | No tmux needed; surfaces as agent activity rather than panes. |
| **Subagents via Agent tool** | `subagent` — the **fallback**: no tmux + no independent-agent support (CI, fresh installs), or an explicit `subagent` pin. | Lower cost, simplest cleanup; runs in the background, only the final artifact returns. The documented last resort. |

Two hard constraints:

- **`agent-team` requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.** When `team.yaml` records `backend: agent-team` (the ladder resolved to `team`), the durable operator approval is the `agent_mode: team|auto` setting itself — no per-run re-prompt. But if `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is not set, **refuse to dispatch and surface the blocker** rather than silently falling back to subagents — falling back would change execution semantics out from under the plan. Invoke `scripts/agent-team-launcher.ts` (below) — it owns the ladder resolution, the env gate, and the tmux strategy.
- **Always dispatch to the lane's NAMED specialist agent — never `general-purpose`.** Whatever backend `team.yaml` records, route each lane to its `owner_role` agent: for subagents, `subagent_type: <name>` (`backend`, `qa`, `devops`, `architect`, …); for teams, the teammate spawned from that agent definition. The named agent (`agents/<name>.md` or, for self-build, `.claude/agents/<name>.md`) supplies the lane's persona, scoped skills, tool permissions, and TRIGGER/DO-NOT-TRIGGER boundaries; dispatching `general-purpose` discards all of that and is a defect. The name is the lane's `owner_role` from the plan, resolved against `team.yaml`'s agent-definition paths.

## Self-build dev-team routing

When the target repo IS the Guild plugin itself (self-build), `team.yaml` is composed from the **dev-team agents under `.claude/agents/`** — `plugin-architect, skill-author, specialist-agent-writer, command-builder, hook-engineer, tooling-engineer, docs-writer, eval-engineer` — each owning a plugin path-slice (see `CLAUDE.md §"Dev team"`). The 14 `guild:` product specialists build *user* products; they are NOT the self-build team. Route by changed path:

| Changed path | Dev-team `subagent_type` |
|---|---|
| `scripts/`, `mcp-servers/`, `.mcp.json` | `tooling-engineer` |
| `hooks/` | `hook-engineer` |
| `commands/` | `command-builder` |
| `skills/**` | `skill-author` |
| `agents/*.md` (the 14 specialists) | `specialist-agent-writer` |
| `tests/` | `eval-engineer` |
| `docs/`, `CLAUDE.md` | `docs-writer` |
| manifests / ADRs / phase-gate integration | `plugin-architect` |

## Agent-team launcher

When `team.yaml` declares `backend: agent-team` and the opt-in is confirmed, invoke `scripts/agent-team-launcher.ts` to spawn the tmux session — one pane for the orchestrator plus one pane per specialist, with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` exported in each pane. The launcher is the canonical entry point for the agent-team backend; it writes a session manifest to `.guild/runs/<run-id>/agent-team/session.json` and refuses to spawn nested teams per §7.3. Run it once per execute-plan invocation:

```
scripts/agent-team-launcher.ts --team .guild/team/<slug>.yaml --cwd <repo-root>
```

Pass `--dry-run` first to preview the tmux commands without spawning the session; use `--session-name` when a name collision would otherwise block launch.

## Parallelism rules

Read the DAG encoded by each lane's `depends-on:` and schedule dispatches accordingly, per `guild-plan.md §8`:

- **Architect first when present.** If a lane is owned by `architect`, it is typically a common dependency — most downstream lanes list its `task-id` in `depends-on`. Dispatch architect before any lane that depends on it, and hold the dependents until architect's receipt is written.
- **Backend → QA.** QA's integration work depends on backend deliverables. Never dispatch QA before backend's receipt is present.
- **DevOps → QA.** Staging hookup must precede QA's regression run.
- **Content and commercial in parallel with engineering** when the lane only depends on the spec. A copywriter lane with `depends-on: []` dispatches at run-start alongside architect; it does not wait for engineering.
- **Worktree isolation.** When dispatching two or more lanes in parallel, run each in its own git worktree so file edits cannot collide. The specialist's subagent is responsible for worktree entry/exit; `guild:execute-plan` only needs to confirm the worktree was distinct before marking a lane dispatched. Serial lanes may share the main worktree.

The schedule is a function of the DAG, not of authoring order. Lanes with empty `depends-on:` are eligible at run-start; every other lane becomes eligible the moment every task-id it lists has a completed receipt.
