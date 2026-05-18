---
# Derived from the canonical skill template (DH-3 boundary): instance frontmatter
# carries derived_from_template for traceability to the canonical base.
name: dispatching-parallel-agents
description: "The discipline for dispatching independent specialist lanes in parallel — respect depends-on edges, isolate context, collect handoff receipts, and never parallelize work with ordering or shared-state hazards."
when_to_use: "During the Development phase when guild:execute-plan has independent lanes whose depends-on graph permits concurrent dispatch (subagent default; agent-team opt-in)."
type: meta
derived_from_template: guild.skill_template.v1
---

> **Meta skill** — forked from `superpowers:dispatching-parallel-agents` v5.0.7 §5 (MIT, © 2025 Jesse Vincent). Guild-native adaptation, **zero runtime dependency** on superpowers. See `LICENSE-attribution.md`.

# When to use it

Use during Development when the lane plan has two or more lanes whose
`depends-on:` edges permit concurrent execution. Invoked by
`guild:execute-plan` to fan out independent lanes (subagent backend default;
agent-team opt-in) and fan in their handoff receipts. The autonomy posture
is the `task_run.autonomy_policy` recorded at plan approval (pointer:
`contract-map.md §A` row 1).

# When not to use it

Not for lanes with unsatisfied `depends-on:` (run those in order). Not for
work touching shared mutable state or with ordering hazards. Not for phase
sequencing itself (the orchestrator owns phase advance). Not a substitute
for the plan — it dispatches an approved plan, it does not author one.

# Required inputs

- The approved lane plan with per-lane `task-id`, `owner`, `depends-on:`,
  `scope`, `success-criteria`, `autonomy-policy`.
- The recorded `task_run.autonomy_policy` (pointer, not re-spelled).
- The backend selection (subagent default; agent-team iff approved + tmux
  available).
- Per-lane assembled context bundles (`guild:context-assemble`).

# Output format

Per-lane handoff receipts at
`.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` conforming to the
frozen `guild.handoff_receipt.v1` contract by pointer (`contract-map.md §A`
row 5) — never schema-copied here — plus `assumptions.md` and the changed
files each lane produced.

# Workflow steps

1. Topologically read the `depends-on:` graph; compute the independent
   (parallelizable) lane set.
2. For each ready lane, assemble its context bundle and dispatch it on the
   selected backend.
3. Run independent lanes concurrently; gate dependent lanes until their
   predecessors' receipts land.
4. Collect each lane's handoff receipt; surface blockers immediately.
5. When all lanes report, hand to `guild:review`.

# Evidence requirements

Every dispatched lane has a receipt; every receipt traces to a plan lane;
the parallel set is justified by the `depends-on:` graph (no lane run before
its predecessor's receipt). Concurrency decisions are recorded, not implied.

# Escalation rules

A lane fails or its receipt is missing → do not advance dependents; surface
to the orchestrator. Ambiguous/contradictory `depends-on:` → stop and ask,
do not guess an order. Destructive/network op inside a lane → always-ask
hard set fires regardless of autonomy policy.

# Safety constraints

Never parallelize lanes with ordering or shared-state hazards. The
always-ask hard set (destructive/network/spend) is unconditional and never
relaxed by an autonomy contract or `--auto-approve`. All writes confined to
the consuming repo's `.guild/` (DH-3 boundary). Agent-team backend only when
explicitly approved and tmux is available (else subagent fallback).

# Eval cases

- Two lanes, no `depends-on:` between them → dispatched concurrently; both
  receipts collected.
- Lane B `depends-on: [A]` → B is gated until A's receipt lands.
- Lane A fails → dependents not advanced; blocker surfaced.
- Destructive op inside an autonomous lane → still prompts (always-ask hard
  set).
