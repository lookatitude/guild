---
type: decision
owner: architect
confidence: high
importance: high
source_refs: [".guild/wiki/_archive/v2-design/sources/research-backlog.md#open-decisions-d1"]
created_at: 2026-05-26
updated_at: 2026-05-26
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [v2-runtime-and-execution-model, v2x-command-surface-dispatch-and-internalization, di1-di6-contracts]
---

# ADR: Guild Execution Shape — Library + CLI First, Daemon Deferred (D1)

## Status

Accepted (operator-ratified 2026-05-26; v2.0-full-scope program). Captures
research-backlog Open Decision D1, the only non-closed entry after v2
finalization.

## Context

Guild needs a stable execution shape that governs how it is deployed, extended,
and invoked. Three candidates were evaluated:

| Shape | Description | When appropriate |
|---|---|---|
| **Library + CLI** | Claude Code plugin (skills, agents, commands, hooks) + `scripts/` invoked by those commands. No persistent process. | Current: all artifacts are filesystem-based; runs are on-demand. |
| **Daemon** | Persistent background service with its own state loop, IPC/socket, health checks, crash recovery. | When background monitoring, persistent websocket UI, or cross-session event streaming are required. |
| **Hybrid** | Plugin + daemon side-car. | When selective background capability is needed without rewriting the plugin boundary. |

The research backlog explicitly flagged this as an open architectural choice
and recommended "library + CLI first; daemon only when UI/background runners
require it."

## Decision

Guild core ships as **library + CLI first**:

- The **library surface** is the Claude Code plugin mechanism: skills,
  commands, agents, and hooks.
- The **CLI surface** is the `/guild:<verb>` command set, invoked inside a
  Claude Code session.
- The **scripts/** tooling (TypeScript invoked by skills/hooks) is the
  implementation layer — short-lived processes spawned per-invocation, never
  daemons.

A **daemon execution shape is explicitly out of v2 scope.** No persistent
background service, no IPC socket, no separate health-check process.

### Trigger for reconsideration

Revisit at v3.x planning **only if** at least one of the following is
measured:

1. Background agent-team monitoring is required (teams that must run
   autonomously between user sessions).
2. A persistent websocket UI is required (real-time team state viewed in a
   browser without an active Claude session).
3. Cross-session event streaming is required (events from one session must be
   consumed by another without filesystem polling).

Until a trigger is measured, daemon complexity is deferred.

## Consequences

- All Guild state is **on-disk** (`.guild/` artifacts, SQLite optional
  read-through index). No in-process state survives session boundaries.
- The `agent_mode` dispatch ladder (D5) and the tmux launcher are
  **session-scoped** — they do not require a background service.
- Extension points (new skills, new agents, new hooks) are filesystem drops —
  no daemon restart is needed.
- The scripts/ layer remains short-lived TypeScript processes; they may use
  Node's `child_process` for subprocesses but must not daemonize themselves.
- Future daemon work, if triggered, should be a **new opt-in side-car** that
  the plugin can communicate with via a well-defined local socket contract —
  it must not require restructuring the plugin's skill/command/hook surface.
