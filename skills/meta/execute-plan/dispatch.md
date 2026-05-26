# Backend choice, routing & parallelism

Detail for `guild:execute-plan`'s `## Backend + routing (summary)` and parallelism scheduling. Per `guild-plan.md §7.3` and §8.

## Backend choice

Guild supports two execution backends. The choice is made at `guild:team-compose` and mirrored into `team.yaml`; `guild:execute-plan` **reads and honors** it — it never re-picks.

| Backend | Default? | Use when | Tradeoff |
|---|---:|---|---|
| **Subagents via Agent tool** | Yes | Work is self-contained; results only need to return to the orchestrator. | Lower token cost, simpler cleanup, fewer coordination failures. |
| **Agent teams** | Opt-in | Teammates need to share findings, challenge each other, coordinate dependencies, or run competing hypotheses. | Experimental; requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; higher token cost; one team per session; no nested teams. |

Two hard constraints:

- **User approval is required for `agent-team`.** If `team.yaml` specifies `backend: agent-team`, confirm the user has explicitly approved the opt-in (the approval is recorded in `team.yaml` by `guild:team-compose`). If `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is not set, refuse to dispatch and surface the blocker to the user rather than silently falling back to subagents — falling back would change the execution semantics out from under the plan.
- **Subagent is the production default.** Unless `team.yaml` explicitly says `agent-team`, dispatch each lane via the Agent tool with **`subagent_type` set to the lane's specialist agent name** (e.g. `subagent_type: backend`, `qa`, `devops`, `architect`) — NOT `general-purpose`. The named agent (`agents/<name>.md` or, for self-build, `.claude/agents/<name>.md`) supplies the lane's persona, scoped skills, tool permissions, and TRIGGER/DO-NOT-TRIGGER boundaries; dispatching `general-purpose` discards all of that and is a defect. The `subagent_type` is the lane's `owner_role` from the plan, resolved against `team.yaml`'s agent-definition paths.

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
