---
type: decision
owner: architect
confidence: medium
importance: high
source_refs:
  - .guild/wiki/_archive/v2-design/sources/17-provider-role-model-and-capability-routing.md  # §Role Model, §Routing Rules, §Edge Cases (the role taxonomy + locality findings)
  - plugin/.guild/wiki/decisions/v2-cross-host-orchestration.md                    # CR-1..6 routing, CH-4 orchestrator-owns-approval, CR-4 work-type affinity (routing bound by pointer)
  - .guild/wiki/decisions/host-adapter-contract.md                          # host_capabilities.v1, 4-rung backend ladder (capability carrier bound by pointer)
  - plugin/.guild/wiki/decisions/v2-runtime-and-execution-model.md                 # ADR-RE-5 guild.host_capability.v1, ADR-RE-4 TeamBackend seam (bound by pointer)
created_at: 2026-06-14
updated_at: 2026-06-14
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [v2-cross-host-orchestration, host-adapter-contract, v2-runtime-and-execution-model, cost-aware-tiering-and-lean-context, autonomy-locking-validity]
---

# ADR: Provider role model — role taxonomy + role-to-locality constraints (routing bound by pointer)

## Status

**Accepted (design decision).** Records the deferred architect-backlog item 38.

Implementation tags per current repo reality:

- **[v2 shipped] — orchestrator + approval-authority locality.** The
  orchestrator role is pinned to the starting host today: `host-router.ts`
  carries `localHostId` and resolves any lane whose host equals it as a local
  tmux pane (`plugin/scripts/lib/host-router.ts`), and CH-4
  ([`v2-cross-host-orchestration.md`](v2-cross-host-orchestration.md)) makes the
  orchestrator pane "always the starting host" and the sole interactive
  approval surface. Reviewer cross-host affinity (CR-4) likewise ships.
- **[v2-contract-only] — the named role taxonomy as a first-class object.**
  The seven roles below are a **conceptual layer** mapped onto already-shipped
  carriers (`guild.task_assignment.v1`, `guild.approval_request.v1`,
  `guild.host_capability.v1`, the work-type affinity table). There is **no
  `provider_role.schema.json`** in the repo — the research brief recommended one
  (research #17 §Recommended Next Artifacts) and it is **not** adopted here; the
  role names are documentary keys onto existing fields, not a new wire schema.
- **[v2.x deferred] — explicit per-role record in run state.** Persisting
  "which provider played which role" as a structured, queryable field
  (research #17 finding 2) is deferred; today role is inferable from
  `task_assignment` / `approval_request` / `routing_decision` artifacts but is
  not a normalized first-class column.

## Context

Provider **identity** ("Claude Code", "Codex") is not enough to drive a run.
Each provider exposes multiple surfaces — Claude can be the interactive
orchestrator, a subagent, a tmux pane, or a reviewer; Codex can be local CLI,
app worktree, cloud task, subagent workflow, or review surface (research #17
finding 1). A run reasons in terms of **what a participant is doing**, not which
vendor it is.

Two adjacent ADRs already settle the mechanics but leave the **role vocabulary**
unnamed:

- [`v2-cross-host-orchestration.md`](v2-cross-host-orchestration.md) decides
  **capability routing** end to end — CR-1 (the deterministic `(host, tier,
  model)` compose function), CR-2..6 (pre-check, fallback chain, work-type
  affinity, manifest freshness, deferred budget cap), and CH-1..6 (mixed-host
  tmux composition). That is the *routing* layer.
- [`host-adapter-contract.md`](../../../../.guild/wiki/decisions/host-adapter-contract.md) decides the
  **capability advertisement** (`host_capabilities.v1`) and the **4-rung
  backend ladder** every host resolves against. That is the *capability carrier*
  layer.
- [`v2-runtime-and-execution-model.md`](v2-runtime-and-execution-model.md)
  (ADR-RE-5) defines `guild.host_capability.v1` and (ADR-RE-4) the
  `TeamBackend` seam routing rides on.

What none of them names is the **role taxonomy**: the distinct functions a
provider can occupy in a run, what each may and may not do, and which roles are
**locality-constrained** (must stay on the operator's starting host) versus
free to be remote. The research brief proposes exactly this separation —
"define provider roles separately from provider identity" (research #17
acceptance criteria) — and the cross-host ADR's CH-4 already enforces one
instance of it (orchestrator + approval stay local) without ever stating it as
a general rule. This ADR records the rule and the taxonomy; it **does not
re-decide routing** — routing is bound by pointer to the cross-host ADR.

## Decision

### 1. Seven provider roles, defined separately from identity

A run distinguishes seven roles. A single provider on a single host may hold
several roles at once (e.g. the orchestrator host is also the workspace- and
approval-authority); a single role may be filled by different providers across a
run. The roles extend the five in research #17 §Role Model with two locality
authorities (workspace-authority, approval-authority) that the brief's edge
cases and CH-4 already imply but did not name.

| Role | May do | May NOT do | Grounding |
|---|---|---|---|
| **orchestrator** | own user interaction; sequence lifecycle gates; assign lanes; escalate approvals; reconstruct DAG state | mutate another lane's artifacts; delegate its interactive surface to a remote host | research #17 §Role Model `orchestrator`; CH-4 "orchestrator pane is always the starting host" |
| **creator** | produce an artifact; attach evidence; revise after findings | sign off on its own artifact as reviewer when policy requires independence | research #17 §Role Model `creator`; §Edge Cases "reviewer and creator are same provider" |
| **reviewer** | read a frozen review packet; return structured findings | mutate the artifact unless an explicit repair mode is set | research #17 §Role Model `reviewer`; CR-4 adversarial-review → cross-host affinity |
| **teammate** | execute its assigned lane; write status, evidence, handoff | reach outside its lane scope; assume orchestrator duties | research #17 §Role Model `teammate` |
| **verifier** | run validation in its allowed workspace; report command output + residual risk | claim hook-enforced telemetry on a host whose hooks are absent | research #17 §Role Model `verifier`; §Edge Cases "Claude hooks disabled" |
| **workspace-authority** | own the canonical `.guild/` write surface and atomic-write/`.lock` discipline; reconcile detached-head / remote-worktree handoff before merge | let a detached remote worktree write the canonical tree directly | research #17 §Edge Cases "Codex app worktree in detached HEAD … requires explicit branch/handoff before PR"; CR-D (via cross-host ADR) |
| **approval-authority** | surface always-ask escalations to the operator and write the `-ack`; hold the `guild.autonomy_contract.v1` always-ask hard set | be a remote pane (always-ask UX cannot be delegated off the starting host) | research #17 §Role Model orchestrator `approval escalation`; CH-4; [`autonomy-locking-validity.md`](autonomy-locking-validity.md) always-ask hard set |

### 2. Role-to-locality constraints

Two roles are **locality-pinned** — they MUST run on the operator's starting
host and cannot be assigned to a remote provider. The rest MAY be remote,
subject to the routing policy in the cross-host ADR.

- **orchestrator — MUST stay local.** It owns the operator's interactive
  session; CH-4 fixes it to "the CLI the operator invoked Guild from." A remote
  orchestrator would have no interactive surface and no DAG-of-record. (Stated
  in research #17 §Routing Rules "Interactive lifecycle ownership → starting
  host remains orchestrator.")
- **approval-authority — MUST stay local.** The always-ask hard set is enforced
  via the operator's interactive UI; CH-4 routes every cross-host
  `approval_request` back to the local orchestrator for the human decision. A
  remote approval surface would break the always-ask invariant across the host
  boundary. (This is the "CH-4" constraint the task names.)
- **reviewer — SHOULD be remote when independence is required.** CR-4's
  affinity table prefers a cross-host reviewer for adversarial/independent
  review; a same-provider reviewer is allowed **only** when policy accepts weak
  independence (research #17 §Edge Cases). Locality here is a *preference driven
  by independence*, not a hard pin.
- **creator, teammate, verifier — MAY be remote.** These route freely by
  capability + tier + work-type affinity. A creator can be a Codex cloud task; a
  verifier runs wherever its workspace + required tools live.
- **workspace-authority — local by default, with a handoff seam.** The canonical
  `.guild/` tree is on the orchestrator host; a remote worktree (e.g. Codex app
  detached HEAD) does not write it directly — it produces a branch/handoff that
  the local workspace-authority reconciles (research #17 §Edge Cases).

### 3. Routing is bound by pointer — not re-decided here

How a non-pinned role is *assigned to a concrete `(host, tier, model)`* is
**already decided** and is not restated:

- The deterministic compose function, fallback chain, work-type affinity,
  capability pre-check, manifest freshness, and the deferred budget cap are
  CR-1..CR-6 in
  [`v2-cross-host-orchestration.md`](v2-cross-host-orchestration.md).
- The capability advertisement (`host_capabilities.v1`) and 4-rung backend
  ladder are in [`host-adapter-contract.md`](../../../../.guild/wiki/decisions/host-adapter-contract.md).
- The carrier manifest (`guild.host_capability.v1`) and `TeamBackend` seam are
  ADR-RE-5 / ADR-RE-4 in
  [`v2-runtime-and-execution-model.md`](v2-runtime-and-execution-model.md).

This ADR adds the **role vocabulary** the work-type affinity table (CR-4) and
the approval flow (CH-4) already use implicitly, and the **two hard locality
pins**. The mapping is: a role + work-type is the *input* to CR-1; CR-1 honors
the two locality pins as non-negotiable filters before its capability ranking
runs.

## Options considered

| Option | Summary | Why not |
|---|---|---|
| **A — Role taxonomy as a documentary layer over existing carriers (chosen)** | Name seven roles + two locality pins; map them onto `task_assignment` / `approval_request` / `host_capability` / CR-4 affinity already shipped. | — chosen. Adds the missing vocabulary with zero new wire surface; the one hard constraint (orchestrator + approval-authority local) is already enforced by host-router + CH-4. |
| **B — New `provider_role.schema.json` wire contract** | Adopt the brief's recommended schema as a first-class versioned sibling persisted in run state (research #17 §Recommended Next Artifacts). | Deferred to v2.x. No consumer needs a normalized role column today; role is inferable from existing artifacts. A new frozen sibling is cost the routing layer does not yet justify (simplicity-first). |
| **C — Fold roles into the routing ADR** | Add the role names directly into `v2-cross-host-orchestration.md`. | Rejected. That ADR is already operator-ratified and contract-dense; the role taxonomy is a separable concern (one decision per ADR) and belongs in its own record so it can evolve without re-opening the routing ADR. |
| **D — Collapse to five roles (brief's original set)** | Keep only orchestrator/creator/reviewer/teammate/verifier. | Rejected. It leaves the two locality authorities unnamed even though CH-4 and the detached-worktree edge case already enforce them — naming them is what makes "stay local" a rule rather than an accident. |

## Consequences

- **Positive.** Routing, dispatch, and approval code can refer to a stable role
  vocabulary instead of vendor names; "orchestrator + approval-authority stay
  local" is now a recorded invariant, not an implicit behavior of host-router +
  CH-4. The taxonomy is additive — no frozen contract changes, no new wire
  schema, single-host behavior unchanged.
- **Cost / limits.** Role is **inferred**, not persisted as a first-class field;
  a queryable "who played what role" view (research #17 finding 2) waits for
  Option B in v2.x. Until then, provenance is reconstructed from
  `task_assignment` / `approval_request` / `routing_decision` artifacts.
- **Trust boundary is a hand-off, not decided here.** Cross-host
  tool-permission **intersection** (a remote creator/verifier gets the
  intersection of both hosts' permitted tools, never the union), manifest
  anti-spoof, and no-secrets enforcement on `approvals/*` remain owned by the
  security ADR (ADR-RE-5 §"Security is a hand-off"; cross-host ADR OQ-SEC). The
  role pins here are an *availability* constraint; they do not replace the
  *trust* model.
- **Open risk (inherited).** Some surfaces are visible only inside a product UI
  and cannot be probed from CLI (research #17 §Open Risks); a role assignment
  that depends on an undetectable capability degrades to the local fallback per
  CR-3, never to a silent failure.
