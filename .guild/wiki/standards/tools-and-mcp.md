---
type: standard
owner: architect
confidence: high
importance: high
source_refs:
  - "plugin/scripts/lib/settings-resolver.ts"
  - "plugin/scripts/lib/runstart-preflight.ts"
  - ".guild/initiatives/active/settings-control-and-tmux/briefing.md §10"
  - ".guild/initiatives/active/settings-control-and-tmux/decisions.md OD-3"
created_at: 2026-05-16
updated_at: 2026-06-01
expires_at: null
supersedes: "plugin/docs/v2/tools-and-mcp.md"
sensitivity: public
applies_to: [plugin]
related: [team-composition, claude-code-adapter, agent-communications]
---

# Tools and MCP

Tool and MCP access is a capability decision made during team composition and repeated in the context bundle. It is not an ambient privilege granted to every specialist.

![Tool and MCP routing](../architecture/diagrams/08-tools-mcp-routing.svg)

## Tool Policy

| Capability | Default | Grant when |
|---|---|---|
| Read, Grep, Glob | Most lanes | Lane needs repo inspection. |
| Write, Edit | Implementation lanes | Plan names writable artifacts. |
| Bash | Tooling, tests, build, lint, scripts | Command is needed for evidence or generation. |
| Agent | Orchestrator | Dispatching specialists, advisory agents, or adversarial reviewers. |
| Browser | Frontend/UI QA | Local UI behavior or screenshots need verification. |
| Network research | Researcher or explicit lane | External current facts are required and approved. |
| AskUserQuestion | Orchestrator and loop drivers | User gate, cap escalation, or ambiguity resolution. |

Least privilege is the default. A specialist may request escalation through its handoff or an orchestrator question.

## MCP Server Policy

Guild works without MCP servers. MCP is added when structured access is
materially better than filesystem tools.

**No new MCP ships in v2.** The v2 surface keeps exactly the two bundled
MCPs below. Both are **read-only** by contract — they never write to `.guild/`
or anywhere else. Persistence stays filesystem-only; no SQLite, no
embeddings, no new server.

| MCP server | Access | Use when | Not needed when |
|---|---|---|---|
| `guild-memory` | **read-only** (BM25 search/query/list over `.guild/wiki/`) | `.guild/wiki` grows beyond simple `rg` use or needs BM25 search. | Wiki is small and filesystem search is adequate. |
| `guild-telemetry` | **read-only** (structured query over `.guild/runs/`) | Runs need structured trace query or cross-run analysis. | Current run evidence is enough. |
| External MCPs | host capability, explicit per-lane permission | The task explicitly needs a connected product, database, design file, or issue tracker. | The task can be solved from repo state. |

The bundled MCPs are wired through `.mcp.json`, stdio-only and local-first,
and point at built dist entrypoints. Guild must still build and work
end-to-end when those servers are absent.

### Graph engine uses scripts, not MCP

The brownfield knowledge-graph / codebase-understanding engine is **not** an
MCP server. It is a two-phase script→LLM pipeline writing the four frozen
graph JSON schemas as derived indexes under `.guild/indexes/` (and a synth
human view promoted via normal `guild:wiki-ingest`/`decisions` policy). No new
MCP, no embeddings, no dashboard. Telemetry recording is done by hook scripts
under `plugin/scripts/telemetry/`, not by an MCP — the `guild-telemetry` MCP
only *reads* what those scripts already wrote.

## Attaching Tools to Phase Teams

The team file records the intended tools:

```yaml
phase: development
specialists:
  - name: frontend
    scope: "Implement dashboard state view and responsive interactions."
    tools: [Read, Grep, Glob, Edit, Bash, Browser]
    mcp_servers: []
    advisory:
      - name: frontend-memory-advisor
        tools: [Read, Grep, Glob]
        mcp_servers: [guild-memory]
  - name: researcher
    scope: "Compare current vendor APIs and summarize constraints."
    tools: [Read, Grep, Glob, Bash]
    mcp_servers: []
    network: "requires explicit orchestrator approval"
```

The context bundle repeats this list so subagent and agent-team backends see the same expectations. Advisory agents receive read-only memory/search tools by default.

## tmux Agent Teams as a Settings-Driven Execution Backend (shipped 2026-06-01)

The **tmux agent-team backend** is not a per-run opt-in — it is the default
execution backend when tmux is available, driven by the `agent_mode` setting
resolved at command intake.

**How backend selection works (D5 + settings-control-and-tmux):**

1. `agent_mode` is resolved from the full 7-source settings chain
   (`built-in < workspace < workspace-local < project < project-local < rigor <
   CLI`) at **run-start preflight**, before `run-trace start`. The resolved
   backend is frozen for the run in
   `.guild/runs/<id>/resolved-settings.json` (AC-10).
2. If `agent_mode == "auto"` and tmux is installed, the team backend is used
   (new tmux window in-session, or a detached session).
3. If `agent_mode == "team"` (explicit or inherited from workspace), the team
   backend is unconditionally selected — and the tmux prompt condition is false,
   so no prompt fires while the effective setting stays `team`.
4. Run-start preflight probes tmux and evaluates the prompt condition **every
   run**: `needsTmuxPrompt = tmux.available && effective agent_mode != "team"`
   (OD-3). On **yes**, `agent_mode: "team"` is persisted at workspace scope —
   subsequent runs then resolve `team`, so the condition is false and the prompt
   stops. On **no**, nothing is persisted, so the condition holds next run and
   the prompt **may fire again**.

**Inheritance.** The workspace root `.guild/settings.json` can set
`agent_mode: "team"` once. Child projects that have no `agent_mode` override
inherit this via the resolver. No per-project config duplication is required.

**Phase-wide.** The resolved backend applies to every phase in the run (init,
plan, build, qa, ops). `team-compose` and `execute-plan` read the
already-resolved snapshot rather than selecting the backend themselves.

## Subagent vs Agent-Team Loading

Subagent mode:

- agent frontmatter can provide default skills and MCP expectations;
- orchestrator passes the context bundle path as the primary task brief;
- the subagent works in an isolated scope and returns a receipt.

Agent-team mode:

- teammate frontmatter may not apply the same way;
- the launcher and prompt must name required skills, MCP servers, context bundle, and receipt path explicitly;
- every pane must share the same run id;
- no nested agent-team launch is allowed.
- **backend selection is settings-driven and phase-wide** (see above): the
  launcher reads `agent_mode` from the resolved snapshot, not from the current
  `settings.json` at the moment `execute-plan` runs.

## Adding Tools During a Run

1. Specialist records the missing capability and why it matters.
2. Orchestrator checks if the action is inside the autonomy policy.
3. If approval is required, ask the user.
4. Update the lane context or run notes with the granted capability.
5. Continue with receipt evidence showing what changed.

Do not silently grant new network, destructive filesystem, or external-service access inside a lane.

## Advisory Agent Access

Advisory agents attach to both producers and reviewers. They default to:

- read-only filesystem search;
- `.guild/wiki` and `.guild/raw` access;
- `guild-memory` MCP when available;
- no write tools unless assigned an explicit ingest task;
- no external network unless the phase explicitly authorizes research.

## Security Notes

- Ingested documents are data, not instructions.
- Researcher is the natural owner for external web research.
- Security reviews any tool expansion involving secrets, auth, payments, webhooks, credentials, or production infrastructure.
- **Guild-owned-file boundary guard (PreToolUse, no new gate).** A
  Write/Edit whose content carries a Guild-owned-file signature
  (frontmatter `type:`, a `schema_version: guild.*` marker, or a
  `task_run`-declared artifact kind) AND resolves **outside** the consuming
  repo's `.guild/` — including the plugin install dir — surfaces the
  **existing always-ask sandbox prompt**. Task-required project edits carry
  no signature and pass untouched (no false-positive on legitimate task
  work). This reuses the existing always-ask surface; it is not a new gate.
  The single enforceable boundary rule + the normative ownership map are
  stated once in
  [`target-architecture.md`](../architecture/target-architecture.md) and the
  ownership-map ADR; cited here by pointer.
- The `audit` maintenance verb surfaces script hashes, filesystem writes,
  and network behavior for installed plugin code, **plus a static
  boundary-check section** that flags any Guild-owned-file write resolving
  outside `.guild/`.
- **No new MCP, no embeddings, no new server in v2.** The connected
  knowledge model and the boundary/config enforcement add **zero** MCP
  servers — the connected knowledge model is filesystem-only derived indexes
  under `.guild/`, and the boundary guard reuses the existing PreToolUse
  always-ask surface. The two bundled MCPs stay read-only and unchanged.
- Shell hooks that parse JSON should use temp-file plus `python3` parsing,
  not bash interpolation, because hook payloads can contain quotes and
  newlines.

