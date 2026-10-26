---
type: decision
status: accepted
owner: plugin-architect
confidence: high
importance: medium
applies_to: [plugin]
decision_id: v3fu-W2-dispatch
initiative: v3-followups
source_refs:
  - "plugin src/domains/lifecycle/write-task-run.ts:355 (makeDispatch* emit)"
  - "plugin scripts/lib/host/pane-dispatch-trace.ts:168 (guild.trace.dispatch.v1)"
  - "plugin .guild/artifacts/reports/v3-legacy-G04.html row 1"
created_at: 2026-10-18
updated_at: 2026-10-18
expires_at: null
sensitivity: internal
---

# Supersession: `agent_dispatched` -> `guild.trace.dispatch.v1`

The v2 design's `agent_dispatched` run event never gained a v3 emitter. The
shipped dispatch trace is `guild.trace.dispatch.v1`, emitted per specialist by
the pane-dispatch trace (and consumed by run-analysis). This page formalizes
the supersession-in-fact recorded by the Team I validation (G04 row 1):
`agent_dispatched` is a retired vocabulary term, not a pending producer. Any
doc or detector that wants dispatch visibility binds to
`guild.trace.dispatch.v1`.
