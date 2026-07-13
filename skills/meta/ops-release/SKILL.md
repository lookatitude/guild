---
name: ops-release
description: The release runbook-class playbook for the guild:operations router — producer devops-ci-cd-pipeline + technical-writer-release-notes advisory, the guild.ops.v1 + guild.release.v1 outputs, and the release leg of the guild.release.v1 ↔ D8 close-gate join. Invoked by the guild-operations router after it selects class=release. TRIGGER for "run the release runbook", "release class", "cut a release", "deploy runbook", "ship runbook". DO NOT TRIGGER directly at the ops phase (the guild-operations router selects the class and dispatches here), for the other runbook classes (monitoring/incident/rollback/maintenance own theirs), for the quality/release-readiness computation (guild:quality owns it), for authoring the pipeline content (devops-* produce it), or for closing the initiative (InitiativeCloseout owns D8 closure).
when_to_use: Invoked by the guild-operations router when class==release — run the discovered release runbook under the router's safety rails + pre-flight, populate guild.ops.v1 + guild.release.v1, and supply the 3-leg release evidence into the D8 close-gate join (consume-only).
type: meta
---

<!--
  DH-3 BOUNDARY (static, read-only). NEVER written at runtime; per-run
  guild.ops.v1 / guild.release.v1 go to the consuming repo's
  .guild/runs/<run-id>/ops/. CONTRACT FIDELITY: every guild.ops.v1 /
  guild.release.v1 reference is a POINTER through
  ../../guild-operations/operations-contract.md §"guild.ops.v1 fields"; zero field text reproduced (anti-respell).
  The 4 safety rails, the 5-boolean machine-check, the allowlist exit-2, and the
  D8 3-leg join LIVE IN the guild:operations router — this playbook references
  them, never re-spells them.
-->

# ops-release

Per-class playbook for **`release`**, dispatched by the **guild:operations
router** after `ClassSelect` resolves `class == release`. The router has already
enforced the 4 safety rails + mandatory pre-flight; this playbook runs the
release-specific producer and populates the release outputs.

# When to use it

When the guild:operations router routes a selected `release` class here — to
execute the discovered release runbook and supply the D8 release evidence.

# When not to use it

- Other classes → `ops-monitoring` / `ops-incident` / `ops-rollback` /
  `ops-maintenance`.
- Direct invocation at the ops phase → the router selects the class; do not
  bypass it.
- Quality / release-readiness computation → `guild:quality` (its `block`
  recommendation gates this class — see below).
- Authoring the pipeline content → `devops-ci-cd-pipeline`.
- Initiative closure → `InitiativeCloseout` (this playbook only supplies
  evidence into the D8 join the router owns).

# Required inputs

- The selected `release` runbook + its wiki trust root
  `.guild/wiki/standards/runbooks/<name>.md` (router-validated).
- The consumed `guild.quality.v1` recommendation
  (`.guild/runs/<run-id>/quality/<run-id>.md`).
- Frozen `guild.ops.v1` / `guild.release.v1`
  (`../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`, pointer only).

# Output format

`guild.ops.v1` **always** + `guild.release.v1` (class==release), populated **by
pointer** to `../../guild-operations/operations-contract.md §"guild.ops.v1 fields"` (zero re-spelled fields);
per-step evidence under `.guild/runs/<run-id>/ops/evidence/`.

# Workflow steps

## producer

Producer **`devops-ci-cd-pipeline`**; advisory **`technical-writer-release-notes`**
(release advisory) — class→producer map per `../../guild-operations/operations-contract.md
§Posture` (by pointer). Posture is the **§Posture default** (release is not a
hard-interactive class), still subject to the router's rails: rail 1 (first run
interactive), rail 3 (always-ask hard set unconditional), rail 4 (pre-flight
dry-run mandatory).

## execute

Each step records `op_class`; every **hard-set step** shows
`autonomy: prompted_inline` (rail-3 proof). Populate `guild.ops.v1` head +
`guild.release.v1` by pointer to `../../guild-operations/operations-contract.md §"guild.ops.v1 fields"`.

## d8-supply

Supply the **release leg** of the D8 3-leg join (the join logic lives in the
router, `../../guild-operations/operations-contract.md §"D8 close-gate join"`): release readiness
(`release.outcome.status == completed`), documentation sync
(`release.doc_sync_status`), evidence trail (`release.release_evidence_refs[]` +
`release.quality_ref`). **Supply-only** — `InitiativeCloseout` closes.

# Evidence requirements

- class→producer map (`devops-ci-cd-pipeline` + release-notes advisory);
  per-step `op_class`; hard-set step `prompted_inline`; `guild.release.v1`
  populated by pointer; the 3 D8 release-leg fields present.

# Escalation rules

- A non-force-pass Quality `block` makes `release` **REFUSE with route-back** to
  Quality (release is in the router's refuse set); only a recorded human
  `force_pass` proceeds.
- Any always-ask hard-set step escalates inline regardless of `--auto-approve`.

# Safety constraints

- Rails are router-enforced and **not relaxed here**; runbook approval lowers
  only the SOFT gate, never the hard set (rail 3).
- No frozen `guild.ops.v1` / `guild.release.v1` field text reproduced — all by
  pointer through `../../guild-operations/operations-contract.md`. **No cloud-build task** (GR-7).

# Eval cases

1. **`release`, Quality RELEASE-READY** → proceeds; supplies the 3-leg D8
   evidence; `InitiativeCloseout` (not this skill) closes.
2. **`release`, Quality `block`, no force_pass** → **REFUSE with route-back**.
3. **`release`, Quality `block`, recorded human `force_pass`** → proceeds;
   force-pass owner named.
4. **Hard-set step under `--auto-approve=all`** → still `prompted_inline`
   (rail 3).
