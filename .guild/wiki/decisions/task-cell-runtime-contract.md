---
type: decision
owner: architect
confidence: high
importance: critical
source_refs:
  - .guild/runs/run-20260714-orchestrator-task-team-<HIGH_ENTROPY_REDACTED>-task-teams-vs-guild.md  # the audit that surfaced the gaps + proposed the shape
  - plugin/.guild/wiki/decisions/v2-runtime-and-execution-model.md   # the TeamBackend seam this ADR extends (bound by pointer)
  - plugin/.guild/wiki/decisions/cost-aware-tiering-and-lean-context.md  # §task§agent lifecycle, guild.handoff.v2 (bound by pointer)
  - plugin/.guild/wiki/decisions/machinery-agents-vs-specialist-template-library.md  # type-template vs project-agent distinction this ADR sharpens
  - docs/v2/dispatch-execution.md   # the design doc reconciled to shipped reality in the same rollout (G1)
created_at: 2026-07-14
updated_at: 2026-07-14
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [v2-runtime-and-execution-model, cost-aware-tiering-and-lean-context, machinery-agents-vs-specialist-template-library, v2x-command-surface-dispatch-and-internalization, target-architecture]
---

# ADR: Task-cell lifecycle runtime — TaskCell as the enforceable unit, three-layer specialist identity, conditional fan-out, and immutable terminal attempts

## Status

**Proposed (2026-07-14).** Contract-freeze record for the `task-cell-runtime`
initiative (`.<HIGH_ENTROPY_REDACTED>-cell-runtime/`). This is a **decision
record** (names + schemas + invariants); it does not write the launcher, hooks,
backend, or config schema — each work item (G2…G13 in the initiative ledger) is
handed to its owning dev-team agent (`tooling-engineer`, `hook-engineer`,
`docs-writer`, `plugin-architect`). It **extends**, and does not supersede, the
v2 runtime ADR ([`v2-runtime-and-execution-model`](v2-runtime-and-execution-model.md)):
that ADR froze the `TeamBackend` seam as `{ kind, isAvailable(), launch() }`; this
ADR is the decision to replace that seam with a lifecycle-bearing runtime.

## Context

The 2026-07 orchestrator-task-team audit
([research](../../../../.guild/runs/run-20260714-orchestrator-task-team-<HIGH_ENTROPY_REDACTED>-task-teams-vs-guild.md))
compared Guild's live checkout against primary multi-agent guidance (Anthropic,
OpenAI Agents SDK, LangChain, Microsoft Agent Framework, A2A). Its finding: Guild
ships the *pieces* of a task-team runtime but they **do not compose into an
enforceable per-task runtime**. The docs promise "fresh one-agent-per-task" and
"auto-dismiss"; the code delivers one pane per specialist mapped to a
representative first task, an assignment channel with no production reader, and a
"dismiss" that emits a signal and reaps already-dead panes without terminating a
live worker. The backend seam (`launch()` only) cannot express spawn / readiness
/ assignment / acknowledgment / cancel / terminate, so no uniform code can prove
the lifecycle across tmux, in-process, serial, and remote hosts.

## Decision

### D1 — TaskCell is the unit of Guild work; every lifecycle step emits one; fan-out is conditional

Every ready step of every lifecycle phase (research, ideation, definition,
planning, build, QA, ops, learn/evolve) emits exactly one **TaskCell** — a
code-owned envelope with identical contract and trace regardless of how many
workers it resolves to. A composer scores the step and resolves the cell to:

- `lead_only` — small, linear, low-risk work (may collapse to a single Team Lead execution);
- `lead_plus_one` — one distinct bounded specialty;
- `lead_plus_many` — independent or adversarially valuable work only;
- or a deterministic function/workflow when the operation is fully specified (no agent).

A mandatory multi-agent fan-out for every step is **rejected**: it adds cost and
coordination failure modes without adding capability (audit §TL;DR, §2). "Each
step gets a team" means "each step gets an isolated TaskCell contract," not "each
step spawns many agents."

### D2 — Deterministic code owns the state machine; the Team Lead supplies typed decisions inside it

Guild code owns the phase/step DAG, identity, readiness, dependencies, budgets,
permissions, retries, acknowledgment, cancellation, and termination. A semantic
**Team Lead** decomposes open-ended work, selects specialist types, writes bounded
assignments, and synthesizes accepted handoffs. The Team Lead is **not** the only
state machine (audit §3 — hybrid orchestration).

### D3 — Three identity layers, never conflated

| Layer | Schema | What it is | Where |
|---|---|---|---|
| **Type** | `guild.specialist_type.v2` | Immutable, versioned, **provider-neutral** factory template shipped by Guild: role semantics, capability tags, compatible skill refs, semantic tool requirements, default model **tier** (not a provider model name), constraints, eval fixtures. | `<HIGH_ENTROPY_REDACTED>*.md` |
| **Profile** | `guild.specialist_profile.v1` | Durable project-local customization derived from a type. **This is what `.guild/agents/<role>.md` actually is** — not a running agent. May add project instructions + local skills. | consuming repo `.guild/agents/*.md` |
| **Instance** | `guild.agent_instance.v1` | **Ephemeral** runtime identity created for exactly one `task_run_id`+`attempt`. Binds a profile hash to host, model, context hash, permission scope, budget, timestamps, terminal status. | `.guild/runs/<run-id>/…` |

**An instance is never reused.** Reusing a type or profile is desirable; reusing
the runtime conversation or process is not. This retires the current vocabulary
in `roster.ts` / `team-compose` that calls a persistent `.guild/agents/*.md` file
an "instance" and reuses it forever (audit finding P1.1).

### D4 — Immutable terminal attempts; retry = new attempt

A stable **logical task** (`logical_task_id`) is distinct from `task_run_id` and
`attempt`. Terminal states (`terminated`, `failed`, `cancelled`, `timed_out`,
`rejected`) are immutable. A refinement or retry creates a **new** `task_run_id`,
`attempt`, `attempt_id`, and `instance_id` in the same logical context — never a
revived terminal task (audit §5; A2A "Life of a Task").

**Lineage is mandatory** so a resume-after-crash can reconstruct the attempt
series without reviving terminal instances (adversarial test 15). Every attempt
after the first MUST record `previous_attempt_id` and `retry_reason`, and every
attempt MUST carry the stable `logical_task_id`. Retry preserves
`logical_task_id`; it never reuses `attempt_id` or `instance_id`.

### D5 — Lifecycle contract (the state machine G2 implements)

```
declared → instantiated → ready → assigned → assignment_acknowledged → running
  → handoff_submitted → handoff_validated → handoff_accepted
  → terminating → terminated
       (alt terminal: failed | cancelled | timed_out | rejected)
```

`running` is entered **only after** `awaitAssignmentAck` succeeds — a worker that
never acknowledges its assignment is timed out and terminated, never allowed to
run (adversarial test 4). This closes the "receipt-on-disk false-positive"
channel at the start of the lifecycle, symmetric to the acceptance barrier at the
end.

Required runtime operations (replace the `launch()`-only seam):

```
spawnCell · spawnInstance · awaitReady · deliverAssignment · awaitAssignmentAck
observe · heartbeat · collectHandoff · acceptHandoff · rejectHandoff
cancel · terminate · awaitTerminated · reapOrphan
```

Backend-specific mechanics stay behind adapters; **semantics are identical**
across tmux / in-process / serial / remote. **A receipt on disk must not alone
release dependencies** — downstream is released only on `handoff_accepted`, and a
worker may be terminated only after the durable `guild.handoff_acceptance.v1`
record exists (or a forced terminal policy fires). The distinction between the
three handoff states is contractual, not cosmetic:

- **`handoff_submitted`** — the worker has written a `guild.handoff_receipt.v1`
  and signalled completion. No downstream effect yet. **The receipt is the
  worker's output and is never mutated to imply validation or acceptance.**
- **`handoff_validated`** — the **deterministic floor** passed: the receipt is
  schema-valid, its claimed changed-files trace to the assignment's scope, and
  the assignment's `acceptance` tests pass. Validation is pure/mechanical and
  host-neutral (never a model judgement). Its outcome is persisted as a
  **`guild.handoff_validation.v1`** record.
- **`handoff_accepted`** — the acceptance authority (resolved Q3: deterministic
  floor **AND** step Team Lead **AND** a reviewer cell when the risk score
  triggers one) has accepted, persisted as a **`guild.handoff_acceptance.v1`**
  record. **Only the durable acceptance record releases downstream tasks and
  authorizes termination** — dependency-release code reads the acceptance record,
  **never receipt existence**. A `validated` receipt that is not `accepted` blocks
  its dependents.

**Frozen acceptance-record contract.** `guild.handoff_acceptance.v1` MUST carry
the universal `schema_version` envelope field (present on every `guild.*.v1`
record) plus:
`run_id`, `cell_id`, `logical_task_id`, `task_run_id`, `attempt`, `instance_id`,
`assignment_id`, `receipt_id`, `validation_result_id`, `acceptance_policy_version`,
`authorities_required`, `authorities_observed` (per-authority `accepted|rejected`
with timestamp + reason), optional `reviewer_cell_id`, `downstream_release_at`, and
`termination_authorized_at`. Termination may begin **only after this record is
durable**; a forced-terminal policy MUST instead write a rejection/failure terminal
event, never a silent kill. A receipt that fails validation can neither be accepted
nor claim "dismissed."

### D6 — Assignment v2 is authoritative and per-attempt

`guild.task_assignment.v2` is one immutable file **per runtime instance and
attempt** (keyed `task_run_id/attempt/instance_id`), **never per specialist
name**. It carries the full identity + objective + output schema + acceptance
tests + dependencies + context pointer/hash + tool/permission projection +
budgets + host binding + handoff/heartbeat/cancel channels (full field list in
the initiative ledger G3 / audit §Assignment contract). The runtime **must read,
validate, and acknowledge** the assignment before work begins; a malformed or
unreadable assignment is a **hard dispatch failure**, not log-and-continue.

**Self-containment invariant.** The assignment MUST be sufficient to reconstruct
and re-validate the entire dispatch **from the file alone** — no external join
required. **Frozen required fields:**

- **Identity:** `schema_version`, `run_id`, `cell_id`, `goal_id`, `phase_id`,
  `step_id`, `team_id`, `logical_task_id`, `task_run_id`, `attempt`, `attempt_id`,
  `previous_attempt_id` (optional), `retry_reason` (required on every non-first
  attempt — D4), `instance_id`, `team_lead_instance_id` **or** `lead_binding_id`,
  `worker_role`.
- **Type/profile:** `specialist_type_id`, `specialist_type_version`,
  `specialist_type_hash`, `specialist_profile_id`, `specialist_profile_hash`.
- **Context + host:** `context_bundle_id`, `context_bundle_hash`, `host_id`,
  `adapter_id`, `host_capabilities_hash` (so the "not compatible" tool decision is
  reproducible — resolved Q4).
- **Work + policy:** objective, non-goals, output schema, acceptance tests,
  dependencies + accepted-upstream pointers, projected tool/permission set,
  autonomy policy, token/time/cost budgets, deadline.
- **Channels:** `assignment_path`, `handoff_path`, `heartbeat_path`,
  `cancel_channel`.

**Run-tree containment (resolved P0.5 invariant).** The assignment and every
sibling record (task-run/attempt, context, trace, handoff, validation, acceptance,
terminal) MUST live under the **same** `run_id` tree. Canonical path:
`.guild/runs/<run_id>/task-cells/<logical_task_id>/attempts/<attempt>/instances/<instance_id>/assignment.json`.
No record may be scattered outside the authoritative run tree, and `task_run_id`
MUST NOT be overloaded to double as run id, logical-task id, or attempt id. This is
what makes a run reconstructible after an orchestrator crash (adversarial test 15)
and auditable without chat transcripts (D7).

### D7 — Pointer-based artifact bus; workers return typed handoffs, not transcripts

Shared: goal/spec, task DAG, accepted artifacts, decisions, budgets, policy,
status. Private per instance: minimal task bundle, relevant code/knowledge, role
instructions, tool projection, accepted upstream results. Returned: a typed
handoff + pointers — never the worker's full conversation. This preserves
progressive disclosure and makes cross-host delivery possible without copying
chat history (audit §Context and artifacts; consolidated under G10).

### D8 — Naming: "Team Lead" is the user-facing coordinator name

Standardize the visible coordinator role on **"Team Lead"**. `team-prompt.ts`
renders "Team Lead" for the visible phase coordinator. Internal identifiers may
still use `orchestrator` where they name the parent control-plane binding rather
than a user-facing role; product orchestration, phase leadership, and task-cell
lead binding remain separate identity layers.

## Consequences

- **Positive:** the "fresh instance per task" invariant becomes specifiable and
  testable; a run can be <HIGH_ENTROPY_REDACTED> without chat transcripts; hosts can
  be *lifecycle-verified* (not just packaging-verified); docs stop overclaiming.
- **Cost:** the `launch()`-only seam is replaced — a larger backend surface and a
  cross-host conformance suite (G9). Worktree/process termination and orphan
  reaping add operational paths that must themselves be tested.
- **Migration:** `.guild/agents/*.md` semantics are renamed to *profiles* (G7);
  provider model names leave canonical type templates in favor of tiers.

## Frozen-contract impact & migration

This ADR changes runtime behavior; it must state its impact on the two shipped,
frozen contracts it touches. **No frozen `schema_version` is bumped.**

### `guild.task_run.v1` — stays readable; a NEW `guild.task_attempt.v1` companion owns lineage

- **Today:** re-dispatch **overwrites** the task-run file, and the attempt number
  is folded into `task_run_id` (`write-task-run.ts` — "Re-dispatch overwrites the
  file; task_run_id tracks the attempt number"; path uses task-id only).
- **Conflict:** D4 requires **immutable terminal attempts** + logical-task
  identity. Overwriting destroys the prior attempt's record (a retry cannot be
  audited and a terminal attempt can be silently resurrected), and `task_run_id`
  is overloaded to mean both logical task and attempt.
- **Decision:** `guild.task_run.v1` **remains readable as the historical
  task-run record** and is not overloaded further. The TaskCell runtime adds an
  **additive companion `guild.task_attempt.v1`** — the authoritative source for
  retry lineage and terminal-attempt immutability — carrying `logical_task_id`,
  `attempt`, `attempt_id`, `previous_attempt_id`, `retry_reason` (required on every
  non-first attempt — D4), `instance_id`, `cell_id`, and terminal-immutability
  metadata, written **one immutable file per attempt** (never
  overwritten). **No implementation may overload a v1 `task_run_id` to mean both
  logical task and attempt.** (A `guild.task_run.v2` bump carrying the same fields
  is the alternative if a companion proves awkward; the companion is the default —
  it keeps v1 readers untouched.)

### `guild.handoff_receipt.v1` — stays FROZEN; acceptance is a NEW sibling, not a receipt field

- **Constraint:** the receipt is FROZEN and is the **worker's** output. A worker
  must **not** self-accept — acceptance is an <HIGH_ENTROPY_REDACTED> decision
  (resolved Q3). Writing validated/accepted state *into* the worker's own receipt
  would both mutate a frozen contract's semantics and let a worker claim its own
  acceptance.
- **Decision:** validation and acceptance live in **two new orchestrator-owned
  siblings** — `guild.handoff_validation.v1` (the deterministic-floor result) and
  `guild.handoff_acceptance.v1` (the authority decision; frozen field list in D5).
  The frozen `handoff_receipt.v1` is **read, never mutated**, by these records, and
  MUST NOT be reinterpreted as validation, acceptance, dismissal, or termination.
  Because the receipt is lenient-reader, any *future* purely-additive receipt field
  remains possible without a bump, but acceptance deliberately lives **outside** the
  receipt.
- **Consequence:** review/verify continue to read the frozen receipt **as a
  submission record**; existing dependency-release code MUST migrate to read
  `guild.handoff_acceptance.v1` for the release + termination predicate (D5),
  never receipt existence.

### `guild.task_assignment` v1 → v2 — clean replacement (no back-compat burden)

v1 has **no production reader** (audit finding P0.3 — only its own module + unit
test call `readTaskAssignment()`), so v2 is a clean replacement, not a
back-compatible evolution. v2 is keyed per `(task_run_id, attempt, instance_id)`
and is **self-contained**: it carries the full identity, profile+content hashes,
context pointer+hash, output schema, acceptance tests, tool/permission projection,
budgets, host binding, and handoff/heartbeat/cancel channels (D6) — a dispatch can
be reconstructed and re-validated from the assignment file **alone**, without an
external join. A malformed/missing assignment is a hard dispatch failure.

## Resolved product decisions (operator, 2026-07-14)

The five decisions the audit flagged as the operator's are now **resolved** and
binding on G6/G8:

1. **Goal-level orchestrator — re-instantiated per phase, not persistent.** The
   goal DAG/state lives on disk (consistent with Guild's existing checkpoint/
   resume + `phase_entry` contract); synthesis cost is paid by *reading
   artifacts*, never by holding a long-lived LLM conversation. Reinforces D2.
2. **Team Lead model call — reused for deterministic cells.** A `lead_only` /
   fully-specified cell uses the **parent orchestrator as lead** (no extra model
   call) while **still minting fresh, isolated worker instances**. A distinct
   Team Lead model call is required only for cells needing genuine semantic
   decomposition (`lead_plus_one` / `lead_plus_many` open-ended work). The
   fresh-instance invariant (D3) holds regardless of lead reuse. Aligns with the
   lean-lead cost-aware tiering ADR. **Identity rule:** a reused parent is recorded
   as a **`lead_binding_id`** pointer on the cell (no new lead-instance conversation
   and no new `guild.agent_instance.v1` for the lead); a cell that *does* spawn a
   distinct Team Lead records a `team_lead_instance_id`. Exactly one of the two is
   present per cell — so "fresh worker instances regardless" never becomes "a new
   lead instance is also always minted." Worker instances are always fresh (D3);
   the lead may be a binding.
3. **Acceptance authority — risk-dependent on a deterministic floor.** Downstream
   is released only when: (a) **deterministic validators always pass** — schema/
   tests/scope, the existing `verify-done` checks, the mandatory mechanical floor;
   **and** (b) the **step Team Lead accepts** semantic quality; **and** (c) when
   the composition score flags high-risk / security-sensitive / low-checkability,
   a **<HIGH_ENTROPY_REDACTED> cell also accepts**. `handoff_accepted` (D5) fires
   only when all applicable authorities pass. This makes acceptance deterministic
   at the floor and prevents rubber-stamping.
4. **Portable tool categories — the core execution set, via
   `guild.host_capabilities.v1`.** A specialist type may claim cross-host
   compatibility only if its required **core execution tools** — read, write/edit,
   shell, dispatch-a-specialist, recall/context, agent-bus/file channel — map to
   `native | wrapped | bridged` on the target host's capability row. `ask-user`
   and native-skill-autoload may degrade with a **recorded loss**. An
   `emulated | degraded` mapping on a *core* tool means **not compatible** — never
   a silent pass. Reuses the existing min-loss chain; introduces no new list.
5. **`lead_plus_many` fan-out — signal-gated, not cost-gated (operator override
   of the cost-gate recommendation).** The composer fans out to multiple workers
   **whenever the scored decomposition signals fire** (genuine independence /
   parallelizable branches / distinct disciplines / adversarial value) — there is
   **no token-cost gate** blocking fan-out. **Accepted tradeoff:** the audit
   (§2, Anthropic) warns multi-agent fan-out spends far more tokens; the operator
   accepts that cost in exchange for coverage. G11 telemetry still **measures**
   per-cell cost for observability and eval, but cost does **not** veto a fan-out
   the signals justify. (Fan-out remains conditional on the *signals* — this does
   not make fan-out mandatory for every step; D1's `lead_only` path still applies
   when no decomposition signal fires.) **Auditability requirement (G8):** because
   the cost gate is disabled, the composition record for every cell MUST store the
   evidence — `fanout_signals` (which signals fired), `cost_estimate`,
   `cost_gate_policy: disabled_by_operator`, and the resolved
   `lead_only|lead_plus_one|lead_plus_many` — so G11 can audit *why* a high-cost
   fan-out was allowed, not merely measure it after the fact.

## Rollout coupling

Per workspace Rule 2 + the D8 initiative close gate: any runtime change under this
ADR must reconcile `docs/v2` (08, 03, generated-support-matrix), the umbrella
wiki, and consumer-facing website docs **in the same rollout**. G1 already
reconciles `docs/v2/dispatch-execution.md` §5 to shipped reality; subsequent work items flip those
caveats to "shipped" only as the corresponding runtime lands.
