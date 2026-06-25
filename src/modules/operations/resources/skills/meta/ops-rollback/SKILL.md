---
name: ops-rollback
description: The rollback runbook-class playbook for the guild:operations router — producer devops-incident-runbook, the guild.ops.v1 + guild.incident.v1 outputs, the hard INTERACTIVE-always (never autonomous) posture, and the REFUSE-on-non-force-pass-Quality-block rule. Invoked by the guild-operations router after it selects class=rollback. TRIGGER for "run the rollback runbook", "rollback class", "roll back the deploy", "revert to previous version", "back out the release". DO NOT TRIGGER directly at the ops phase (the guild-operations router selects the class and dispatches here), for the other runbook classes (release/monitoring/incident/maintenance own theirs), for the quality/release-readiness computation (guild:quality owns it), for reverting a single skill version (guild:rollback-skill owns that), for authoring the runbook content (devops-* produce it), or for closing the initiative (InitiativeCloseout owns D8 closure).
when_to_use: Invoked by the guild-operations router when class==rollback — run the discovered rollback runbook INTERACTIVELY (never autonomous) under the router's safety rails + pre-flight and populate guild.ops.v1 + guild.incident.v1.
type: meta
---

<!--
  DH-3 BOUNDARY (static, read-only). NEVER written at runtime; per-run
  guild.ops.v1 / guild.incident.v1 go to the consuming repo's
  .guild/runs/<run-id>/ops/. CONTRACT FIDELITY: every guild.ops.v1 /
  guild.incident.v1 reference is a POINTER through contract-map.md §A rows 8/9 →
  target-architecture.md §639–745; zero field text reproduced (anti-respell).
  The 4 safety rails, the 5-boolean machine-check, the allowlist exit-2, and the
  D8 join LIVE IN the guild:operations router — rollback's never-autonomous
  posture (rail 2) is router-enforced and restated here as the class invariant.
-->

# ops-rollback

Per-class playbook for **`rollback`**, dispatched by the **guild:operations
router** after `ClassSelect` resolves `class == rollback`. **`rollback` is
INTERACTIVE always — never autonomous** (rail 2, router-enforced and
hard-coded). The router has already enforced the 4 safety rails + mandatory
pre-flight; this playbook runs the rollback producer and populates the outputs.

# When to use it

When the guild:operations router routes a selected `rollback` class here — to
execute the discovered rollback runbook interactively (revert a deploy/release
to a known-good state).

# When not to use it

- Other classes → `ops-release` / `ops-monitoring` / `ops-incident` /
  `ops-maintenance` (an active outage with no known revert target is
  `incident`, not `rollback`).
- Reverting a single Guild **skill** version → `guild:rollback-skill` (different
  surface entirely).
- Direct invocation at the ops phase → the router selects the class.
- Quality / release-readiness → `guild:quality`.
- Authoring runbook content → `devops-incident-runbook`.
- Initiative closure → `InitiativeCloseout`.

# Required inputs

- The selected `rollback` runbook + its wiki trust root
  `.guild/wiki/standards/runbooks/<name>.md` (router-validated).
- The consumed `guild.quality.v1` recommendation
  (`.guild/runs/<run-id>/quality/<run-id>.md`).
- Frozen `guild.ops.v1` / `guild.incident.v1` (`contract-map.md §A` rows 8/9 →
  `target-architecture.md §639–745`, pointer only).

# Output format

`guild.ops.v1` **always** + `guild.incident.v1` (class ∈ {incident, rollback}),
populated **by pointer** to `target-architecture.md §639–729` (zero re-spelled
fields); per-step evidence under `.guild/runs/<run-id>/ops/evidence/`.

# Workflow steps

## producer

Producer **`devops-incident-runbook`** — class→producer map per
`lifecycle/lifecycle-overview.md §616–622` (by pointer). **Posture: INTERACTIVE
always — never autonomous** (rail 2), regardless of runbook approval or
`--auto-approve`. Active specialists **≤ producer + challenger**.

## execute

Each step records `op_class`; every **hard-set step** shows
`autonomy: prompted_inline` (rail-3 proof). Populate `guild.ops.v1` head +
`guild.incident.v1` by pointer to `§646–655` / `§639–729`.

# Evidence requirements

- producer is `devops-incident-runbook`; posture interactive (never
  autonomous); per-step `op_class`; hard-set step `prompted_inline`;
  `guild.incident.v1` populated by pointer; active set ≤ producer + challenger.

# Escalation rules

- `rollback` is **never autonomous** — always interactive (rail 2).
- A non-force-pass Quality `block` makes `rollback` **REFUSE with route-back**
  to Quality (rollback is in the router's refuse set, **unlike** incident); only
  a recorded human `force_pass` proceeds.

# Safety constraints

- Rail 2 (never autonomous) is **absolute** for this class; approval lowers only
  the SOFT gate, never the hard set (rail 3).
- No frozen `guild.ops.v1` / `guild.incident.v1` field text reproduced — all by
  pointer through `contract-map.md`. **No cloud-build task** (GR-7).

# Eval cases

1. **`rollback` under `--auto-approve=all`** → still **interactive** (rail 2);
   hard-set steps `prompted_inline` (rail 3).
2. **`rollback`, Quality `block`, no force_pass** → **REFUSE with route-back**
   (rollback is in the refuse set, unlike incident).
3. **`rollback`, Quality `block`, recorded human `force_pass`** → proceeds.
4. **`rollback`** → emits `guild.ops.v1` + `guild.incident.v1`; active set never
   exceeds producer + challenger.
