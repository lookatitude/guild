---
name: ops-incident
description: The incident runbook-class playbook for the guild:operations router — producer devops-incident-runbook, the guild.ops.v1 + guild.incident.v1 outputs, and the hard INTERACTIVE-always (never autonomous) posture. Invoked by the guild-operations router after it selects class=incident. TRIGGER for "run the incident runbook", "incident class", "production is down", "page/sev runbook", "incident response runbook". DO NOT TRIGGER directly at the ops phase (the guild-operations router selects the class and dispatches here), for the other runbook classes (release/monitoring/rollback/maintenance own theirs), for the quality/release-readiness computation (guild:quality owns it), for authoring the runbook content (devops-* produce it), or for closing the initiative (InitiativeCloseout owns D8 closure).
when_to_use: Invoked by the guild-operations router when class==incident — run the discovered incident runbook INTERACTIVELY (never autonomous) under the router's safety rails + pre-flight and populate guild.ops.v1 + guild.incident.v1.
type: meta
---

<!--
  DH-3 BOUNDARY (static, read-only). NEVER written at runtime; per-run
  guild.ops.v1 / guild.incident.v1 go to the consuming repo's
  .guild/runs/<run-id>/ops/. CONTRACT FIDELITY: every guild.ops.v1 /
  guild.incident.v1 reference is a POINTER through
  ../../guild-operations/operations-contract.md §"guild.ops.v1 fields"; zero field text reproduced (anti-respell).
  The 4 safety rails, the 5-boolean machine-check, the allowlist exit-2, and the
  D8 join LIVE IN the guild:operations router — incident's never-autonomous
  posture (rail 2) is router-enforced and restated here as the class invariant.
-->

# ops-incident

Per-class playbook for **`incident`**, dispatched by the **guild:operations
router** after `ClassSelect` resolves `class == incident`. **`incident` is
INTERACTIVE always — never autonomous** (rail 2, router-enforced and
hard-coded). The router has already enforced the 4 safety rails + mandatory
pre-flight; this playbook runs the incident producer and populates the incident
outputs.

# When to use it

When the guild:operations router routes a selected `incident` class here — to
execute the discovered incident runbook interactively.

# When not to use it

- Other classes → `ops-release` / `ops-monitoring` / `ops-rollback` /
  `ops-maintenance` (note: a deliberate revert of a known-bad change is
  `rollback`, not `incident`).
- Direct invocation at the ops phase → the router selects the class.
- Quality / release-readiness → `guild:quality`.
- Authoring runbook content → `devops-incident-runbook`.
- Initiative closure → `InitiativeCloseout`.

# Required inputs

- The selected `incident` runbook + its wiki trust root
  `.guild/wiki/standards/runbooks/<name>.md` (router-validated).
- Frozen `guild.ops.v1` / `guild.incident.v1`
  (`../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`, pointer only).

# Output format

`guild.ops.v1` **always** + `guild.incident.v1` (class ∈ {incident, rollback}),
populated **by pointer** to `../../guild-operations/operations-contract.md §"guild.ops.v1 fields"` (zero re-spelled
fields); per-step evidence under `.guild/runs/<run-id>/ops/evidence/`.

# Workflow steps

## producer

Producer **`devops-incident-runbook`** — class→producer map per
`../../guild-operations/operations-contract.md §Posture` (by pointer). **Posture: INTERACTIVE
always — never autonomous** (rail 2), regardless of runbook approval or
`--auto-approve`. **Gate inheritance (via the router):** this playbook runs only
AFTER the guild:operations router's step-0 ops team gate has verified a current,
recomputed-hash-matching `guild.team_decision.v1` `approve` — incident urgency
never bypasses that hold, and this playbook dispatches no participant outside
the approved set. Wave concurrency (`guild.team_schedule.v1`): incident waves run
**producer + challenger concurrently at most**; other approved participants
schedule into later waves — membership was decided at the phase's
`guild.team_decision.v1` gate and is never cut here.

## execute

Each step records `op_class`; every **hard-set step** shows
`autonomy: prompted_inline` (rail-3 proof). Populate `guild.ops.v1` head +
`guild.incident.v1` by pointer to `../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`.

# Evidence requirements

- producer is `devops-incident-runbook`; posture interactive (never
  autonomous); per-step `op_class`; hard-set step `prompted_inline`;
  `guild.incident.v1` populated by pointer; wave concurrency: producer +
  challenger at most run concurrently (schedule-only; approved membership preserved).

# Escalation rules

- `incident` is **never autonomous** — always interactive, regardless of
  approval or `--auto-approve` (rail 2).
- A non-force-pass Quality `block` does **NOT** block `incident` — it may
  proceed (incident is in the router's proceed set; contrast `rollback`, which
  refuses).

# Safety constraints

- Rail 2 (never autonomous) is **absolute** for this class; approval lowers only
  the SOFT gate, never the hard set (rail 3).
- No frozen `guild.ops.v1` / `guild.incident.v1` field text reproduced — all by
  pointer through `../../guild-operations/operations-contract.md`. **No cloud-build task** (GR-7).

# Eval cases

1. **`incident` under `--auto-approve=all`** → still **interactive** (rail 2);
   hard-set steps `prompted_inline` (rail 3).
2. **`incident`, Quality `block`** → **proceeds** (incident is in the proceed
   set, unlike rollback).
3. **`incident`** → emits `guild.ops.v1` + `guild.incident.v1`.
4. **Wave concurrency** → producer + challenger at most run concurrently; remaining approved participants wait in later waves (never removed).
