---
type: decision
owner: architect
confidence: high
importance: high
source_refs:
  - "docs/knowledge/research/06-human-agent-ux-orchestration-ui.md"
  - "docs/knowledge/research/research-backlog.md#L106"
  - "plugin/commands/status.md"
  - "plugin/commands/dashboard.md"
created_at: 2026-06-14
updated_at: 2026-06-14
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related:
  - guild-execution-shape-library-cli-first
  - v2-observability-and-replay
  - v2-review-broker-and-artifact-bus
  - autonomy-locking-validity
---

# ADR: Human-Agent UX — CLI + filesystem surfaces, no bespoke orchestration UI in v2

## Status

Accepted (design decision). Closes research-backlog item 6
([`06-human-agent-ux-orchestration-ui.md`](../research/06-human-agent-ux-orchestration-ui.md))
and architect ADR backlog deferred item 38.

Implementation status per current repo reality:

- **[v2] shipped** — state/risk visibility via `/guild:status` (read-only
  lifecycle helper, `plugin/commands/status.md`); approval model via the
  always-ask hard set + `autonomy_policy` ([autonomy-locking-validity](autonomy-locking-validity.md));
  cloud-review egress consent gate ([v2-review-broker-and-artifact-bus](v2-review-broker-and-artifact-bus.md) §D-BR-E);
  read-only benchmark dashboard viewer (`plugin/commands/dashboard.md`) — **not**
  an in-plugin orchestration UI (see §Options).
- **[v2-contract-only]** — trace-based explainability: the
  `guild.trace_event.v2` log ships; the `trace_replay_timeline` /
  `trace_context_replay` MCP renderers are decided but **unshipped** (tracked
  as G-2, [v2-observability-and-replay](v2-observability-and-replay.md) §D-OBS-5).
- **[v2.x] deferred** — task-DAG view, approval-inbox UI, trace-timeline
  viewer (the three bespoke views from the brief's minimum-views diagram).

## Context

The research brief asks three questions: what must a human see to trust a
multi-agent run; which states/decisions need approval UI; and how Guild explains
why a plan, specialist, or action was chosen (brief §"Research Plan",
§"Findings"). Its recommended answer is an **artifact-first web UI** — a project
dashboard fanning out to run timeline, task DAG, agent activity, artifact graph,
approval inbox, tool timeline, and eval comparisons (brief §"Guild Implications"
mermaid). That recommendation predates the v2 execution-shape decision and would
mean internalizing the Understand-Anything-style Vite/React dashboard.

Two binding constraints make that recommendation wrong for v2:

1. **Execution shape.** Guild ships **library + CLI first, daemon deferred**
   ([guild-execution-shape-library-cli-first](guild-execution-shape-library-cli-first.md)):
   no persistent process, no IPC socket, all state on-disk under `.guild/`. A
   real-time websocket dashboard is explicitly named there as a *daemon trigger*
   that is **not** measured in v2.
2. **Stated principle.** The research backlog already closed the dashboard
   question: "A Vite/React monorepo violates 'skills short, artifacts
   filesystem-based'; revisit only on measured demand"
   ([research-backlog.md#L106](../research/research-backlog.md) — **CLOSED-in-v2 — NO**).

The brief itself supplies the resolution: it observes that **Guild already has
the right artifacts** (spec, plan, team, context bundles, handoffs, telemetry,
reflections, eval reports) and that the durable record should be the
**artifact graph, not a chat or a bespoke UI** (brief §"Findings" 2–3). The open
decision this ADR records is therefore narrow: *given no bespoke UI, where does
each of the brief's three needs (state/risk, approval, explainability) surface
today, and what triggers a revisit?*

## Decision

**No bespoke orchestration UI ships in v2.** The three human-agent needs are
served by existing CLI + filesystem surfaces, each bound by pointer to the ADR
that owns it. Nothing here re-decides those ADRs; it records *which surface
answers which brief question*.

### D-UX-1 — State & risk visibility = `/guild:status` + the run trace

The brief's "operator must see state, artifacts, risks, approvals" need is
served by **`/guild:status`** (`plugin/commands/status.md`) — a read-only
lifecycle helper that reports current run, furthest phase, next gate, blockers,
and the per-phase active team. It writes no file (matches "artifacts
filesystem-based"). Deeper run inspection rides the **trace event log**
(`logs/v1.4-events.jsonl`, `guild.trace_event.v2`) and the read-only
`guild-telemetry` MCP query/`trace_cost_rollup` tools
([v2-observability-and-replay](v2-observability-and-replay.md) §D-OBS-4). The
brief's "distinguish agent claim from verified evidence" risk (brief §"Open
Risks") is already structurally answered by Guild's evidence rule: handoff
receipts carry an `evidence:` field consumed at the review gate.

### D-UX-2 — Approval model = always-ask checkpoint + `autonomy_policy` (not an inbox)

The brief's "concentrate human control at gates" / approval-card model is served
by the **fixed 3-level `autonomy_policy` enum + the immutable always-ask hard
set** ([autonomy-locking-validity](autonomy-locking-validity.md) §G-A): every
destructive op, network access, and spend **always prompts**, regardless of
level or `--auto-approve`; spec/team/plan gates are the concentrated control
points. The per-lane `autonomy_contract` mini-schema (op-class allowlist +
write-scope + spend-ceiling) is the richer refinement, authored at `/guild:plan`
and approved at the existing G-plan gate (no new gate). Cross-host cloud-review
egress adds a hard always-ask consent checkpoint
([v2-review-broker-and-artifact-bus](v2-review-broker-and-artifact-bus.md)
§D-BR-E). The brief's approval-card fields (what / why / who / risk /
alternatives / reversibility / artifacts) are surfaced **in the prompt text** at
each checkpoint, not in a persistent inbox view. This directly mitigates the
brief's "too many approval prompts → rubber-stamping" risk: the always-ask hard
set is a small, fixed, high-signal set, not a per-step prompt stream.

### D-UX-3 — Explainability = the trace event log + handoff envelopes (not a bespoke UI)

The brief's five explainability questions (why this specialist / context / plan
order / approval / memory update) are answered by **durable artifacts**, read on
the CLI / filesystem:

- *Why this specialist / context / plan order* — the `team`, `plan`, and
  `context` bundle artifacts plus `provenance.json`, reconstructible via
  `trace_context_replay` ("what did the agent see?",
  [v2-observability-and-replay](v2-observability-and-replay.md) §D-OBS-5).
- *Why this approval* — named in the always-ask prompt (D-UX-2) and recorded as
  a `guild.security_event.v1` for egress/consent decisions.
- *Why this memory update* — the pending-memory / harvest-candidate artifacts in
  the wiki flow.

The span tree (`parent_span_id`, D-OBS-6) supplies the brief's tool-timeline
data **as a log**, not as a rendered viewer.

### D-UX-4 — Deferred bespoke views, and their revisit trigger

The three bespoke views from the brief's minimum-views diagram are **`[v2.x]`
deferred**, each with the surface it maps to today:

| Brief view | Today's surface | Deferred renderer |
|---|---|---|
| Task DAG | `guild.run_state.v1` DAG/lane checkpoint on disk ([v2-observability-and-replay](v2-observability-and-replay.md) related) | task-DAG view |
| Approval inbox | always-ask prompt + `autonomy_policy` (D-UX-2) | approval-inbox UI |
| Tool / trace timeline | `guild.trace_event.v2` log + span tree (D-UX-3) | `trace_replay_timeline` renderer (G-2) |

**Revisit trigger (measured demand only).** Reconsider a bespoke view — and,
for a real-time view, the daemon shape it implies — only when one of the
execution-shape daemon triggers is *measured*: a persistent websocket UI is
required, or cross-session event streaming is required
([guild-execution-shape-library-cli-first](guild-execution-shape-library-cli-first.md)
§"Trigger for reconsideration"). Until then the data already exists on the
filesystem; only the renderer is deferred, so a future view is additive over
existing artifacts, not a re-architecture.

## Options considered

| Option | Summary | Why-not |
|---|---|---|
| **A — CLI + filesystem surfaces (chosen)** | `/guild:status` + trace log + always-ask + handoff envelopes; no new UI code. | Chosen — zero new infra, honors execution shape + "skills short, artifacts filesystem-based", and every brief need maps to an existing artifact. |
| **B — In-plugin Vite/React orchestration dashboard** (the brief's recommendation) | Internalize the Understand-Anything-style web UI with the 8-view fan-out. | Rejected. Violates the library+CLI shape (would need a daemon/websocket — an unmeasured v3 trigger) and the "skills short, artifacts filesystem-based" principle; already CLOSED-NO at [research-backlog.md#L106](../research/research-backlog.md). |
| **C — Persistent approval-inbox UI** | A standing queue of approval cards an operator works through. | Rejected for v2. A persistent inbox needs background state survival (daemon) and *increases* the brief's rubber-stamping risk vs. a small fixed always-ask set. The data (consent events) is recorded; the inbox renderer is `[v2.x]`. |
| **D — Read-only benchmark dashboard viewer (already shipped, complementary)** | `/guild:dashboard` launches the **benchmark factory's** web UI as a read-only, opt-in, 127.0.0.1, no-network-without-`--install` viewer over imported runs + knowledge. | **Not the rejected option B.** It is a *separate-repo, read-only artifact browser*, not an in-plugin orchestration/approval surface, and adds no daemon to the plugin. It coexists with this decision and is not the bespoke UI the brief proposed. |

## Consequences

- **Zero new UI infrastructure in v2.** No Vite/React monorepo, no daemon, no
  websocket; the execution shape and the "artifacts filesystem-based" principle
  hold.
- **Every brief need is answered by an existing artifact**, so the deferred
  bespoke views are pure renderers over data that already exists — additive, not
  a re-architecture, when measured demand arrives.
- **Approval stays high-signal.** A fixed always-ask hard set + gate-concentrated
  control directly counters the brief's rubber-stamping risk; the tradeoff is no
  at-a-glance approval queue (acceptable until measured demand).
- **Explainability is log-shaped, not view-shaped.** Operators read the trace
  log / context-replay rather than a timeline viewer; the `trace_replay_timeline`
  renderer remains `[v2-contract-only]` (decided, unshipped — G-2).
- **One naming hazard recorded:** `/guild:dashboard` exists but is the
  benchmark viewer, not the rejected orchestration UI — future readers must not
  read it as a reversal of this decision.
