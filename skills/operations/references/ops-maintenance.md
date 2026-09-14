---
name: ops-maintenance
description: The maintenance runbook-class playbook for the guild:operations router — producer devops-infrastructure-as-code and the guild.ops.v1 output. Invoked by the guild-operations router after it selects class=maintenance. TRIGGER for "run the maintenance runbook", "maintenance class", "dependency-bump runbook", "infra maintenance runbook", "scheduled maintenance runbook". DO NOT TRIGGER directly at the ops phase (the guild-operations router selects the class and dispatches here), for the other runbook classes (release/monitoring/incident/rollback own theirs), for the quality/release-readiness computation (guild:quality owns it), for authoring the IaC content (devops-* produce it), or for closing the initiative (InitiativeCloseout owns D8 closure).
when_to_use: Invoked by the guild-operations router when class==maintenance — run the discovered maintenance runbook under the router's safety rails + pre-flight and populate guild.ops.v1.
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

# ops-maintenance

Per-class playbook for **`maintenance`**, dispatched by the **guild:operations
router** after `ClassSelect` resolves `class == maintenance`. The router has
already enforced the 4 safety rails + mandatory pre-flight; this playbook runs
the maintenance-specific producer and populates `guild.ops.v1`.

# When to use it

When the guild:operations router routes a selected `maintenance` class here — to
execute the discovered maintenance runbook (dependency bumps, infra upkeep,
scheduled maintenance).

# When not to use it

- Other classes → `ops-release` / `ops-monitoring` / `ops-incident` /
  `ops-rollback`.
- Direct invocation at the ops phase → the router selects the class.
- Quality / release-readiness → `guild:quality`.
- Authoring IaC content → `devops-infrastructure-as-code`.
- Initiative closure → `InitiativeCloseout`.

# Required inputs

- The selected `maintenance` runbook + its wiki trust root
  `.guild/wiki/standards/runbooks/<name>.md` (router-validated).
- Frozen `guild.ops.v1`
  (`../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`, pointer only).

# Output format

`guild.ops.v1` populated **by pointer** to `../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`
(zero re-spelled fields); per-step evidence under
`.guild/runs/<run-id>/ops/evidence/`.

# Workflow steps

## producer

Producer **`devops-infrastructure-as-code`** — class→producer map per
`../../guild-operations/operations-contract.md §Posture` (by pointer). Posture is the
**`§Posture` default**, subject to the router's rails (rail 1 first-run
interactive, rail 3 hard set unconditional, rail 4 pre-flight dry-run).

## built-in: run-retention sweep

One recognized `scheduled maintenance runbook` (alongside wiki-authored
dependency-bump / infra-upkeep runbooks) is the deterministic 90-day run
retention sweep — deleting one-off runs never restated in prose. Delegate to
`scripts/lib/retention.ts`'s CLI main, never a hand-rolled `find`/`rm`:

```
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/lib/retention.ts \
  --guild-dir <cwd>/.guild [--apply]
```

Default (no `--apply`) is a **dry-run** report of every `one-off-90d` run past
its 90-day window since `closed_at`; `until-archive` runs are never swept
regardless of age. `--apply` is the hard-set step for this runbook (rail 3:
`prompted_inline` even under `--auto-approve=all`) and actually removes the
listed run directories. Record the dry-run report as pre-flight evidence
(rail 4) before the operator confirms `--apply`.

## execute

Each step records `op_class`; every **hard-set step** shows
`autonomy: prompted_inline` (rail-3 proof). Populate `guild.ops.v1` head by
pointer to `../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`.

# Evidence requirements

- producer is `devops-infrastructure-as-code`; per-step `op_class`; hard-set
  step `prompted_inline`; `guild.ops.v1` populated by pointer.

# Escalation rules

- A non-force-pass Quality `block` does **NOT** block `maintenance` — it may
  proceed (maintenance is in the router's proceed set).
- Any always-ask hard-set step escalates inline regardless of `--auto-approve`.

# Safety constraints

- Rails are router-enforced and **not relaxed here**; approval lowers only the
  SOFT gate, never the hard set (rail 3).
- No frozen `guild.ops.v1` field text reproduced — all by pointer through
  `../../guild-operations/operations-contract.md`. **No cloud-build task** (GR-7).

# Eval cases

1. **`maintenance`, Quality RELEASE-READY** → proceeds; emits `guild.ops.v1`.
2. **`maintenance`, Quality `block`** → **proceeds** (not in the refuse set).
3. **Hard-set step under `--auto-approve=all`** → still `prompted_inline`
   (rail 3).
4. **First run of an unproven maintenance runbook** → interactive (rail 1).
