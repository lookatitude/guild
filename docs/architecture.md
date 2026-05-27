# Architecture

Implements `guild-plan.md §3` (current reality after P0–P6).

## Overview

Guild is a Claude Code plugin that turns a single session into a disciplined team of
specialist agents. The shipped architecture has four layers:

- **Session** — the orchestrator (main Claude Code session) dispatching specialists
  through the Agent tool or, opt-in, the experimental agent-team backend.
- **Plugin** — installed content in this repo: `skills/`, `agents/`, `commands/`,
  `hooks/`, `scripts/`, `mcp-servers/`, `.mcp.json`, `.claude-plugin/plugin.json`.
- **Specialists** — 14 subagents defined in `agents/*.md` with `isolation: worktree`,
  each instructed to treat its context bundle as authoritative.
- **Project-local state** — `.guild/` at the consuming repo root. Every mutable
  artifact lives here: raw sources, wiki, telemetry, reflections, evolve workspaces,
  skill-version snapshots, per-run spec/plan/team/context/handoff files.

The bundle written by `guild-context-assemble` is a **strong context contract**,
not a hard isolation boundary — Claude Code still loads ambient `CLAUDE.md`, plugin
skills, and user memory. See `context-assembly.md` §4 for the caveat.

## Directory layout (what actually exists today)

```
guild/
├── .claude-plugin/plugin.json          # plugin manifest
├── .mcp.json                            # optional MCPs: guild-memory, guild-telemetry
├── CLAUDE.md                            # root operating principles
├── README.md
├── guild-plan.md                        # single source of truth
│
├── skills/                              # 77 skills across 5 tiers
│   ├── core/principles/                 # T1 · 1 skill
│   ├── meta/                            # T2 · 18 skills (see below)
│   ├── knowledge/                       # T3 · 3 skills: wiki-ingest, wiki-query, wiki-lint
│   ├── fallback/                        # T4 · empty; superpowers is referenced directly
│   └── specialists/                     # T5 · 50 authored specialist skills
│
├── agents/                              # 14 specialist definitions (.md)
├── commands/                            # 8 slash commands (.md)
├── hooks/                               # hooks.json + handlers
│   ├── hooks.json
│   ├── bootstrap.sh
│   ├── check-skill-coverage.sh
│   ├── capture-telemetry.ts
│   ├── maybe-reflect.ts
│   └── agent-team/                      # task-created, task-completed, teammate-idle
├── scripts/                             # 7 tooling scripts (tsx)
├── mcp-servers/                         # 2 bundled servers: guild-memory, guild-telemetry
├── tests/                               # cross-cutting fixtures & harnesses
├── templates/                           # specialist and skill scaffolds
└── docs/
    ├── architecture.md  specialist-roster.md  self-evolution.md
    ├── wiki-pattern.md  context-assembly.md
    ├── diagrams/                        # 8 SVGs referenced above
    └── phase-gates/                     # P0–P6 closed gates
```

**Meta skills shipped (T2, 18):** audit · brainstorm · codex-review ·
context-assemble · create-specialist · decisions · diagnose · evolve-skill ·
execute-plan · loop-clarify · loop-implement · loop-plan-review · plan ·
reflect · review · rollback-skill · team-compose · verify-done. `using-guild`
from the plan is not materialized as a separate skill — its role is served by
`commands/guild.md`.

**Fallback skills shipped (T4, 5):** tdd · systematic-debug · worktrees ·
request-review · finish-branch. Each is forked from the corresponding
`superpowers:*` skill (v5.0.7, MIT) with attribution under
`skills/fallback/<name>/LICENSE-attribution.md`. Guild ships self-contained —
no runtime dependency on the superpowers plugin. See `guild-plan.md §5`
forking policy.

## Lifecycle flow — the 7-step `/guild` pipeline

Implemented in `commands/guild.md`, each phase delegates to a T2 skill:

```
User intent
 → guild-brainstorm       spec → .guild/spec/<slug>.md
 → guild-team-compose     team → .guild/team/<slug>.yaml
 → guild-plan             lanes → .guild/plan/<slug>.md
 → guild-context-assemble bundles → .guild/context/<run-id>/<specialist>-<task-id>.md
 → guild-execute-plan     dispatch → subagent or agent-team
 → guild-review           2-stage: spec match, then quality
 → guild-verify-done      tests · scope · success-criteria
 → guild-reflect          post-Stop hook, proposals only
```

User-confirmation gates exist after brainstorm (spec approval), team-compose
(team approval), and plan (plan approval). Post-plan the pipeline runs with
minimal interruption. Decisions captured mid-run are routed through
`skills/meta/decisions/SKILL.md` and land in `.guild/wiki/decisions/`.

Parallelism rules (per `guild-plan.md §8`):
- Architect runs first when present — its output is a common dependency.
- Backend → QA (integration tests); DevOps → QA (staging).
- Content and commercial specialists run in parallel with engineering when they
  only need the spec.

## Command surface

Guild registers a tiered flat-token command surface — `/guild:<verb>` (the `:`
plugin namespace is required by Claude Code; v2 only drops the redundant
`guild-` prefix from sub-commands). Canonical reference:
`docs/knowledge/architecture/command-surface.md`. Core commands:

| Command | Delegates to | Purpose |
|---|---|---|
| `/guild [brief]` | lifecycle meta-skills | Full ideate→verify lifecycle, phase auto-detected. |
| `/guild plan` | `guild:team-compose` + `guild:plan` | Compose the specialist team and lane plan (team is a plan sub-step). |
| `/guild evolve` | `guild:evolve-skill` | Run the skill evolution pipeline. |
| `/guild wiki` | wiki skills | Ingest, query, or lint project memory. |
| `/guild rollback` | `guild:rollback-skill` | Restore a prior skill version. |
| `/guild stats` | telemetry readers | Summarize run, reflection, and audit stats. |
| `/guild audit` | `guild:audit` | Static security audit of plugin scripts. |
| `/guild fix` | `guild:diagnose` | Diagnose failed Guild runs and produce a gated self-fix plan. |

### Workspace federation

On a **workspace** root (a monorepo-of-repos whose immediate children are
themselves sub-projects or sub-guilds — ≥1 child has a nested `.git/` or
`.guild/`), `/guild init` and `/guild learn` check children first and write a
federation manifest (`.guild/workspace.json`, `guild.workspace.v1`) instead of
scanning the union as one repo. The workspace `.guild/` **federates** — it
queries each sub-guild's wiki via the guild-memory `cwd` override and tags
results by source, never copying a sub-guild's pages up. Detection is depth-1
(no nesting, no `max_depth`), overridable via the `workspace.mode: auto|on|off`
setting; a regular repo is unchanged. Canonical model + schema:
`docs/knowledge/decisions/workspace-aware-init-and-federation.md`.

## Execution backend — D5 dispatch ladder

> ADRs: `docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md` (D5 ladder) ·
> `docs/knowledge/decisions/v2-runtime-and-execution-model.md` (ADR-RE-4 `TeamBackend` interface)

`agent_mode: team | agent | subagent | auto` in `.guild/settings.json` governs
every `/guild` run. On `auto`, the orchestrator resolves in order:

1. **Inside tmux** (`$TMUX` set) → `TmuxTeamBackend`: new window in the current
   session, one pane per specialist, immediately visible.
2. **tmux installed (not inside one)** → `TmuxTeamBackend`: fresh detached
   session, then attach terminal to it.
3. **No tmux, host supports independent agents** → `InProcessTeamBackend`:
   dispatches via the Agent tool from a declarative `dispatchPlan` the
   orchestrator consumes. **Fully implemented** (was a stub in prior versions).
4. **Else (CI, no tmux)** → subagent fallback: `guild:execute-plan` dispatches
   specialists via the Agent tool directly.

All three named backends share the `TeamBackend` interface (ADR-RE-4):
`spawn` / `sendTask` / `readState` / `dismiss` / `teardown`. The D5 ladder
picks the mode; the interface decouples dispatch from tmux specifics.

| Backend | Transport | Status |
|---|---|---|
| `TmuxTeamBackend` | tmux `send-keys` + `capture-pane`; `guild.tmux_team.v1` (`session.json`) | Shipped; one-team/session, collision-refuse, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` gate unchanged |
| `InProcessTeamBackend` | Agent-tool dispatch; orchestrator builds a `dispatchPlan` | Shipped (VC-RE-4 validated); no tmux required; suited for CI |
| `RemoteTeamBackend` | `RemoteTransport` seam — `MockTransport` + `SshRemoteTransport` | Shipped as seam + test transports; residual = live real-hardware SSH validation (Track 3 cross-host) |

`RemoteTeamBackend` is the named Track-3 cross-host seam; it consumes the
host-capability routing decision (ADR-RE-5) which is the gate for full cross-host
dispatch. See **Cross-host orchestration** below.

The launcher (`scripts/agent-team-launcher.ts`) was refactored to implement the
`TeamBackend` interface; hook events `task-created`, `task-completed`, and
`teammate-idle` govern ownership, handoff receipts, and stall-detection in all
team modes.

## Cost-aware model tiering

> ADR: `docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md`

Three stable tiers — **`cheap | mid | powerful`** — map to concrete models via
`settings.json models.tiers` (see `configuration.md`). Built-in defaults:
`cheap = haiku` (read/summarize/classify), `mid = sonnet` (draft/reason/plan;
the default task-agent tier), `powerful = opus` (architecture, security review,
graph schema). The `codex`/`gemini` slots are `null` by default and are filled
at runtime from `guild.host_capability.v1` manifests when cross-host is enabled
(see §"Cross-host orchestration").

**Auto-score.** The orchestrator scores each lane from deterministic signals
(work-type verb, blast-radius, security sensitivity, prior-attempt escalation)
and maps the score to a tier. Scores are always printed in the dispatch line.
Precedence: `--model-tier` CLI flag > per-lane `model_tier:` override >
`settings.json models:` > built-in defaults.

**Advisor escalation.** A low-tier agent emitting `status: "escalate"` in its
`guild.handoff.v2` envelope gets one `powerful` advisor answer for that
sub-question only (the advisor sees the draft + the question, never raw file
context), then continues — no wholesale re-run. Advisor consults are capped per
lane at `models.advisorRounds` (default `2`).

**`guild.handoff.v2` dispatch envelope.** The typed in-flight return schema that
the lead accumulates instead of full specialist transcripts (last-N envelopes in
full + a rolling summary). Canonical body: the cost-aware tiering ADR §5.
Distinct from and composes with the frozen `guild.handoff_receipt.v1`
(review/verify receipt). Schema fields are not re-spelled here — link to the ADR.

**§task§agent lifecycle.** One ephemeral agent per task — spawn at the resolved
tier with task-scoped context pulled from the knowledge base (recall-before-read,
6k hard cap) → work → extract `learnings` into `guild.handoff.v2` → terminate.
No agent is shared across tasks; no agent left idle.

## Cross-host orchestration

> ADR: `docs/knowledge/decisions/v2-cross-host-orchestration.md`

Cross-host execution is **off by default** (`defaults.cross_host.enabled:
false`). When enabled, each specialist in `team.yaml` may declare `host:
<host-id>` to route work to a specific host (CH-1).

**Capability routing.** A deterministic three-axis function (mode × tier × host)
selects `(host, model)` per task by filtering `guild.host_capability.v1`
manifests at `.guild/hosts/<host-id>/capability.json`. The function is
synchronous and must return in < 5 ms with no network call. A ranked fallback
chain fires on manifest absence, auth failure, or rate-limit — never silently
downgrading tier.

**`PaneAdapter` interface.** `TmuxTeamBackend` resolves a `PaneAdapter` per
pane from the host manifest. `ClaudePaneAdapter` emits
`claude '<prompt>'` + injects `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
`CodexPaneAdapter` emits `codex exec '<prompt>'` + requires `OPENAI_API_KEY`;
**never** injects the Claude team env gate. Adding a new host (Gemini, …) is
one adapter file.

**Fail-fast preflight.** Before any pane opens, every specialist's
`PaneAdapter.preflight()` is run. A single failure aborts with a specific
error naming the failing specialist + host + missing dependency — zero partial
spawns.

**File-based artifact bus (§CH-3).** Cross-host teams coordinate via the shared
`.guild/runs/<run-id>/` filesystem only — no cross-host agent-team event bus:

```
.guild/runs/<run-id>/
  tasks/<specialist>.json          # guild.task_assignment.v1 — work assignment
  in-progress/<specialist>.json    # structured heartbeat (ADR-RE-3)
  handoffs/<specialist>-<task>.md  # guild.handoff_receipt.v1 — done receipt
  approvals/<specialist>.json      # guild.approval_request.v1 — always-ask escalation
  logs/events.jsonl                # append-only event log (all hosts write)
```

**Local orchestrator (§CH-4).** The orchestrator pane is always the starting
host. A specialist hitting the always-ask hard set writes
`approvals/<specialist>.json` and pauses; the orchestrator polls, surfaces the
decision, writes `-ack.json`; the specialist unblocks on detecting the ack.
**Security ADR owns** the trust model (tool-permission intersection, autonomy
propagation, no-secrets enforcement in approval files).

## SQLite read-through recall

> ADR: `docs/knowledge/decisions/v2-persistence-and-sqlite-index.md` (D-PS-1/D-PS-2)

`.guild/index.sqlite` is a **rebuildable derived cache** — never the system of
record. Deleting it causes zero data loss (only speed loss). It is **dark until
a measured-slowness threshold fires** (per `defaults.index.*` in `configuration.md`
— default: 500 wiki files, 2 000 KG nodes, 20 runs). Below every threshold all
reads use direct file parse or the `guild-memory` BM25 grep path — zero
`index.sqlite` on disk, byte-identical behavior.

`wiki_fts` (FTS5, `bm25()` ranking) is the recall path **at or above** the wiki
threshold. It is populated exclusively by `guild:wiki-ingest` and
`guild:decisions` as a post-write side-effect — no other skill writes it.
`scripts/lib/wiki-recall.ts` is the recall-before-read consumer: it queries
`wiki_fts` when the cache is populated and above threshold; below threshold or
when absent, it falls through to the `guild-memory` MCP BM25 path — same
interface, same results, zero-cost for small repos.

## Hooks inventory (10 events wired)

From `hooks/hooks.json`:

| Event | Handler | Purpose |
|---|---|---|
| `SessionStart` | `hooks/bootstrap.sh` | Inject short Guild status + command list. |
| `UserPromptSubmit` | `hooks/check-skill-coverage.sh` + `hooks/capture-telemetry.ts` | Nudge missing-skill coverage; log NDJSON event. |
| `PreToolUse` (matcher `*`) | `hooks/pre-tool-use.ts` | Append pre-tool sidecar data for v1.4 audit logging. |
| `PostToolUse` (matcher `*`) | `hooks/capture-telemetry.ts` + `hooks/post-tool-use.ts` | Append v1.3 telemetry to `.guild/runs/<run-id>/events.ndjson` and v1.4 tool-call audit events to `.guild/runs/<run-id>/logs/v1.4-events.jsonl`. |
| `PreCompact` | `hooks/pre-compact.ts` | Append context-preservation audit events when the host dispatches `PreCompact`. |
| `SubagentStop` | `hooks/capture-telemetry.ts` | Flush specialist-level telemetry. |
| `Stop` | `hooks/maybe-reflect.ts` | Heuristic gate (≥1 specialist dispatched + ≥1 edit + no error) → `guild-reflect`. |
| `TaskCreated` | `hooks/agent-team/task-created.ts` | Validate ownership, deps, output contract before tasks join the agent-team queue. |
| `TaskCompleted` | `hooks/agent-team/task-completed.ts` | Block completion if handoff receipt is missing changed-files / evidence / assumptions / risks. |
| `TeammateIdle` | `hooks/agent-team/teammate-idle.ts` | Nudge idle teammates who still own open tasks. |

`PreToolUse` and `PreCompact` are newer Claude Code hook surfaces. Older hosts
may never dispatch them; the handlers exit cleanly on missing or malformed input
and the run continues with fewer audit-log rows.

Tests live under `hooks/__tests__/` and `hooks/agent-team/__tests__/`.

## Codex adversarial review trail

Codex adversarial review is a Guild development standard, separate from the
consumer-facing internal `/guild --loops=*` adversarial loops. When the standard
is used for plugin-development gates, the durable trail belongs at:

```
.guild/runs/<run-id>/codex-review/*.md
```

Each markdown file is one flat review artifact for a gate or lane and must start
with YAML frontmatter. The current validator pins the completion standard:
`final_status:` must be either `satisfied` or `skipped-codex-unavailable`.

Verify a trail with:

```
npx tsx scripts/verify-codex-review-trail.ts .guild/runs/<run-id>/codex-review
```

The validator exists and is tested. Producing those review files is still a
workflow responsibility of the active plugin-development run; consumer `/guild`
runs do not create Codex review trails by default.

## Observability v2

> ADR: `docs/knowledge/decisions/v2-observability-and-replay.md` (D-OBS-1..6)

`guild.trace_event.v2` is a pure-additive successor to the frozen
`guild.trace_event.v1`. All v1 fields are preserved verbatim; v2 adds:

| Field | Type | Meaning |
|---|---|---|
| `span_id` | 16-hex string | Deterministic: `sha256(run_id\|event_type\|timestamp\|actor_id)[:16]` |
| `parent_span_id` | string \| null | Threaded via `GUILD_PARENT_SPAN_ID` env var; `null` = root span |
| `tier` | `cheap\|mid\|powerful` | Resolved tier of this event's actor |
| `model` | `haiku\|sonnet\|opus` | Concrete model name |
| `tokens` | `{ input, output, cached, cost_usd }` | Present only on LLM-call events (`tool_call` / `state_transition`) |

The **canonical JSONL writer** lives at `hooks/lib/v1.4/log-jsonl.ts` (imports
`hooks/lib/trace-v2.ts` for the v2 fields). `scripts/emit-loop-event.ts` is
repointed to the canonical copy (F-3 consolidation — eliminates the stale
`scripts/lib/v1.4/` duplicate that lacked v2 fields).

**`guild-telemetry` MCP** reads `logs/v1.4-events.jsonl` as primary (legacy
`events.ndjson` as fallback for pre-v2 runs). New read-only tool shipped:

```
trace_cost_rollup { run_id?, since?, group_by?: "tier"|"specialist"|"phase" }
  → { buckets: [{ key, input_tokens, output_tokens, cached_tokens,
                  cost_usd, event_count }] }
```

This powers O-3 short-output threshold calibration queries and the benchmark
analyzer's cost-curve reports.

**Read-only replay tools (v2).** Two non-executing MCP tools that trigger no
LLM calls: `trace_replay_timeline` (span-tree + cost breakdown from
`v1.4-events.jsonl` + `parent_span_id`) and `trace_context_replay` ("what did
the agent see?" from `guild.context.*` + `provenance.json`). Execution-level
replay (eval-replay, full-execution-replay) is deferred pending D-OBS-2
structured payload sidecars.

## Security posture

> ADR: `docs/knowledge/decisions/v2-security-and-untrusted-content.md`

**Capability-scope enforcement (D-CAP).** Agent definitions may carry an
optional `capability_scope:` frontmatter block — an op-class allowlist with
optional per-tool tightening, plus `network: yes|no` and a `write_scope`.
The effective grant is `capability_scope` **AND-masked** with the lane's
`autonomy_contract` and the always-ask hard set. **Absent `capability_scope:`
⇒ byte-identical to current v2 behavior.** Enforcement point: the
**PreToolUse hook** (already the AC-1 gate). A violation blocks the tool call
and emits a `capability_scope` deviation event to the security log. High
blast-radius declarations (`wide write_scope`, `network: yes`) feed the
cost-tiering auto-score, pushing cheap-tier lanes toward mid/powerful.

**`guild.security_event.v1`.** Dedicated append-only log at
`runs/<run-id>/logs/security-events.jsonl` — separate from performance
telemetry (`guild.trace_event`). Events cover: tool-call decisions,
`capability_scope` deviations, bypass attempts, secrets-pattern hits, recall
quarantines, MCP description drift. Each event carries `host:` for cross-host
forensics. Written by extended PreToolUse/PostToolUse path; read by
`/guild:audit`.

**Secrets policy (D-SECRETS).** A single scrubber (`redact-log.ts`) runs over
all `.guild/` artifact writes. **Durable/shared-git** artifacts (handoff,
provenance, wiki, review) are **fail-closed** on scrub failure (write blocked).
**Local/gitignored** telemetry is **fail-open** with a warning + security event.

**Untrusted-content defense.** `guild:context-assemble` wraps every recalled
chunk in `<guild:recall source="…" trusted="…">` markers. Three tiers:
`operator` (skill bodies, `CLAUDE.md` — no wrapper), `reviewed` (human-promoted
wiki pages — `trusted=true`), `synthesized` (auto-generated `learn-*` candidates
— `trusted=false`). External raw sources never enter a bundle. A cheap-tier
instruction-detection probe (D-PROBE) runs at ingest and recall; triggered
chunks are quarantined. A BM25 anomaly gate (D-INGEST-GATE;
`models.ingestSimilarityGate`, default `0.80`) prevents silent semantic
displacement at `guild:wiki-ingest`.

**MCP trust (D-MCP).** `guild-memory` and `guild-telemetry` carry an
`mcp_capability:` manifest field (read-only, no network). The PreToolUse hook
compares live MCP tool-description hashes against the install-time pins stored
in `settings.json` `mcp.tool_description_hashes`. Description drift → warn +
gate on user approval. Undeclared egress → hard-block + security event.

## Scripts

Under `scripts/` — mostly tsx, Node-stdlib-only, filesystem-and-stdio-only. See
`scripts/README.md` for the shared CLI contract. Core operator-facing scripts:

| Script | Plan anchor | Role |
|---|---|---|
| `scripts/evolve-loop.ts` | §11.2 | Orchestration wrapper. Snapshots live skill; writes 10-step pipeline plan. |
| `scripts/flip-report.ts` | §11.2 step 6 | Paired-grading aggregator: P→F regressions, F→P fixes, pass_rate/duration/tokens. |
| `scripts/shadow-mode.ts` | §11.2 step 7 | Replays proposed skill against historical traces. Diagnostic, never blocks. |
| `scripts/description-optimizer.ts` | §11.2 step 9 | Deterministic heuristic deriving a ≤1024-char description from `should_trigger` evals. |
| `scripts/rollback-walker.ts` | §11.3 | Enumerates `.guild/skill-versions/<slug>/v*/`; emits version table. Read-only. |
| `scripts/trace-summarize.ts` | P5 | Summarizes `.guild/runs/<run-id>/events.ndjson` for reflection. |
| `scripts/agent-team-launcher.ts` | §7.3, ADR-RE-4 | D5 backend launcher: implements `TeamBackend` interface; resolves mode → `TmuxTeamBackend` / `InProcessTeamBackend` / `RemoteTeamBackend`. |
| `scripts/verify-codex-review-trail.ts` | v1.4 SC11 | Validates `.guild/runs/<run-id>/codex-review/*.md` final statuses. |

## MCP servers (optional, bundled)

`.mcp.json` wires two local-only MCPs — both stdio, no network:

- `mcp-servers/guild-memory/` — structured read/search/append over `.guild/wiki/`.
  Needed once the wiki crosses ~200 pages for BM25 search; before that,
  `Read`/`Grep` suffice.
- `mcp-servers/guild-telemetry/` — structured trace query over `.guild/runs/`.
  Reads `logs/v1.4-events.jsonl` (legacy `events.ndjson` fallback). Tools:
  `trace_list_runs`, `trace_summary`, `trace_query`, `trace_cost_rollup`
  (token/cost aggregates by tier, specialist, or phase),
  `trace_replay_timeline`, `trace_context_replay`. All read-only; no LLM calls.

Both are optional. Guild runs end-to-end without them.

## See also

- `specialist-roster.md` — the 14 specialists and their skills.
- `context-assembly.md` — the three-layer context contract.
- `wiki-pattern.md` — the knowledge layer.
- `self-evolution.md` — the evolve + rollback pipeline.
- `configuration.md` — full `settings.json` reference (all `models.*`,
  `defaults.index.*`, `defaults.cross_host.*`, `security.*` keys).
- `guild-plan.md §3` / `§4` — the source architecture and repo layout sections.
- `docs/knowledge/decisions/v2-runtime-and-execution-model.md` — ADR-RE-1..6:
  run-state checkpointing, lane retry, structured heartbeat, `TeamBackend` seam,
  host-capability manifest, multi-wave run manifest.
- `docs/knowledge/decisions/v2-cross-host-orchestration.md` — ADR CR-1..6,
  CH-1..6: capability routing, mixed-host tmux composition, `PaneAdapter` interface.
- `docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md` — tier
  ladder, auto-score, advisor escalation, `guild.handoff.v2`, §task§agent lifecycle.
- `docs/knowledge/decisions/v2-persistence-and-sqlite-index.md` — D-PS-1..6:
  `index.sqlite` schema, lazy-gate thresholds, `wiki_fts` ownership.
- `docs/knowledge/decisions/v2-observability-and-replay.md` — D-OBS-1..6:
  `guild.trace_event.v2`, payload sidecars, replay model, `trace_cost_rollup`.
- `docs/knowledge/decisions/v2-security-and-untrusted-content.md` — D-CAP,
  D-AUDIT, D-SECRETS, D-RECALL, D-PROBE, D-INGEST-GATE, D-HANDOFF, D-MCP.
