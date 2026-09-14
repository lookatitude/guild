---
name: ops-monitoring
description: The monitoring runbook-class playbook for the guild:operations router — producer devops-observability-setup and the guild.ops.v1 output. Invoked by the guild-operations router after it selects class=monitoring. TRIGGER for "run the monitoring runbook", "monitoring class", "set up observability runbook", "dashboards/alerts runbook", "SLO runbook". DO NOT TRIGGER directly at the ops phase (the guild-operations router selects the class and dispatches here), for the other runbook classes (release/incident/rollback/maintenance own theirs), for the quality/release-readiness computation (guild:quality owns it), for authoring the observability content (devops-* produce it), or for closing the initiative (InitiativeCloseout owns D8 closure).
when_to_use: Invoked by the guild-operations router when class==monitoring — run the discovered monitoring runbook under the router's safety rails + pre-flight and populate guild.ops.v1.
type: meta
---

<!--
  DH-3 BOUNDARY (static, read-only). NEVER written at runtime; per-run
  guild.ops.v1 goes to the consuming repo's .guild/runs/<run-id>/ops/.
  CONTRACT FIDELITY: every guild.ops.v1 reference is a POINTER through
  ../../guild-operations/operations-contract.md §"guild.ops.v1 fields"; zero field text
  reproduced (anti-respell). The 4 safety rails, the 5-boolean machine-check,
  the allowlist exit-2, and the D8 join LIVE IN the guild:operations router.
-->

# ops-monitoring

Per-class playbook for **`monitoring`**, dispatched by the **guild:operations
router** after `ClassSelect` resolves `class == monitoring`. The router has
already enforced the 4 safety rails + mandatory pre-flight; this playbook runs
the monitoring-specific producer and populates `guild.ops.v1`.

# When to use it

When the guild:operations router routes a selected `monitoring` class here — to
execute the discovered monitoring/observability runbook.

# When not to use it

- Other classes → `ops-release` / `ops-incident` / `ops-rollback` /
  `ops-maintenance`.
- Direct invocation at the ops phase → the router selects the class.
- Quality / release-readiness → `guild:quality`.
- Authoring observability content → `devops-observability-setup`.
- Initiative closure → `InitiativeCloseout`.

# Required inputs

- The selected `monitoring` runbook + its wiki trust root
  `.guild/wiki/standards/runbooks/<name>.md` (router-validated).
- Frozen `guild.ops.v1`
  (`../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`, pointer only).

# Output format

`guild.ops.v1` populated **by pointer** to `../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`
(zero re-spelled fields); per-step evidence under
`.guild/runs/<run-id>/ops/evidence/`.

# Workflow steps

## producer

Producer **`devops-observability-setup`** — class→producer map per
`../../guild-operations/operations-contract.md §Posture` (by pointer). Posture is the
**`§Posture` default**, subject to the router's rails (rail 1 first-run
interactive, rail 3 hard set unconditional, rail 4 pre-flight dry-run).

## execute

Each step records `op_class`; every **hard-set step** shows
`autonomy: prompted_inline` (rail-3 proof). Populate `guild.ops.v1` head by
pointer to `../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`.

# Evidence requirements

- producer is `devops-observability-setup`; per-step `op_class`; hard-set step
  `prompted_inline`; `guild.ops.v1` populated by pointer.

# Escalation rules

- A non-force-pass Quality `block` does **NOT** block `monitoring` — it may
  proceed (monitoring is in the router's proceed set).
- Any always-ask hard-set step escalates inline regardless of `--auto-approve`.

# Safety constraints

- Rails are router-enforced and **not relaxed here**; approval lowers only the
  SOFT gate, never the hard set (rail 3).
- No frozen `guild.ops.v1` field text reproduced — all by pointer through
  `../../guild-operations/operations-contract.md`. **No cloud-build task** (GR-7).

# Eval cases

1. **`monitoring`, Quality RELEASE-READY** → proceeds; emits `guild.ops.v1`.
2. **`monitoring`, Quality `block`** → **proceeds** (not in the refuse set).
3. **Hard-set step under `--auto-approve=all`** → still `prompted_inline`
   (rail 3).
4. **First run of an unproven monitoring runbook** → interactive (rail 1).
