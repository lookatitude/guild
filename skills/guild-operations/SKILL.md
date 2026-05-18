---
# guild.skill_template.v1 — instance (derived). DH-3: plugin-static canonical
# skill state (shipped, never runtime-written). derived_from_template carried
# for traceability per the template's DH-3 boundary comment.
template_version: guild.skill_template.v1
derived_from_template: guild.skill_template.v1
name: guild-operations
description: The full guild:operations skill — the 5-runbook-class taxonomy with split autonomy posture, the 4 non-negotiable safety rails + mandatory pre-flight (machine-checkable as 5 booleans), ExecuteRunbook + the advisory G-operations trail, and the guild.release.v1 ↔ D8 close-gate three-leg field join (consume-only). TRIGGER for "run the runbook", "operations", "deploy/release runbook", "monitoring", "incident", "rollback", "maintenance", "ops". DO NOT TRIGGER for the quality gate / release readiness computation (guild:quality owns it), for authoring a runbook's content (devops-* specialists produce it), or for closing the initiative (InitiativeCloseout owns D8 closure — operations only supplies evidence).
when_to_use: Invoked at the operations phase to select a runbook class, enforce the 4 safety rails + mandatory pre-flight dry-run, execute under the split autonomy posture, and supply guild.ops.v1 / conditional guild.incident.v1 / guild.release.v1 evidence into the D8 close-gate join.
type: core
---

<!--
  DH-3 BOUNDARY (static read-only plugin install state).
  This skill body is versioned with the plugin and is NEVER written at runtime.
  Per-run ops artifacts (guild.ops.v1 / guild.incident.v1 / guild.release.v1)
  are written under the consuming repo's .guild/runs/<run-id>/ops/ — never back
  into plugin state. A runtime write to plugin skill state is a v2 defect.
  CONTRACT FIDELITY: every guild.ops.v1 / guild.incident.v1 / guild.release.v1
  body reference is a POINTER through contract-map.md §A rows 8/9/10 →
  architecture/target-architecture.md §639–745. The autonomy_contract /
  task_run bodies are pointer-cited (contract-map.md §B row 1 / §A row 1). Zero
  schema_version / field text is reproduced (named-predicate anti-respell). The
  P5 BOUNDARY is cited as a CONTRACT via P1-ownership-001, never the P5 guard
  implementation (§2.3-#5).
  Derived from plugin/templates/skills/SKILL.template.md.
-->

# guild:operations

Realizes **DI-3 (full Operations skill)** (`decisions/di1-di6-contracts.md`)
against the now-frozen **`guild.ops.v1`** / **`guild.incident.v1`** /
**`guild.release.v1`** bodies (`contract-map.md §A` rows 8/9/10 →
`architecture/target-architecture.md §639–745`). The verb is **`ops`** (never
`ship`); the review gate is **`G-operations`**. **No cloud-build task (GR-7).**

# When to use it

At the lifecycle operations phase: to select a runbook class, enforce the 4
safety rails + mandatory pre-flight, execute under the split autonomy posture,
and supply the D8 close-gate evidence join (consume-only).

# When not to use it

- The quality gate / release-readiness computation → `guild:quality`.
- Authoring a runbook's content → `devops-*` specialists produce it; this skill
  orchestrates and gates it.
- Closing the initiative → `InitiativeCloseout` owns the D8 closure state
  machine; Operations only **supplies** evidence and never itself closes.

# Required inputs

- The runbook (positional `[runbook]`, else surfaced detection — always
  confirmed).
- The wiki runbook-approval trust root
  `.guild/wiki/standards/runbooks/<name>.md` (promoted via `guild:decisions`;
  kept under `.guild/` by the **P5 boundary CONTRACT** — cited via
  `P1-ownership-001`, never the P5 guard implementation).
- The additive `autonomy_contract` (`contract-map.md §B` row 1 →
  `target-architecture.md §"autonomy_policy / autonomy_contract"` — pointer).
- The frozen `guild.ops.v1` / `guild.incident.v1` / `guild.release.v1` bodies —
  `contract-map.md §A` rows 8/9/10 → `target-architecture.md §639–745`
  (pointer only).
- The consumed `guild.quality.v1` recommendation
  (`.guild/runs/<run-id>/quality/<run-id>.md`).

# Output format

`guild.ops.v1` **always**; `guild.incident.v1` when `class ∈ {incident,
rollback}`; `guild.release.v1` when `class == release` — all populated **by
pointer to `target-architecture.md §639–729`** (zero re-spelled fields).
Per-step evidence under `.guild/runs/<run-id>/ops/evidence/`.

# Workflow steps

## taxonomy

*`P6-ops-001` deliverable — the 5-runbook-class taxonomy + split autonomy
posture.*

1. **The 5 classes + per-class default autonomy posture**, EXACTLY per
   `lifecycle/lifecycle-overview.md §548–559` (cited by pointer; postures not
   re-derived):

   | Class | Default autonomy posture (per §548–559, by pointer) |
   |---|---|
   | `release` | per §548–559 default posture |
   | `monitoring` | per §548–559 default posture |
   | `incident` | **INTERACTIVE always — never autonomous** (hard-coded) |
   | `rollback` | **INTERACTIVE always — never autonomous** (hard-coded) |
   | `maintenance` | per §548–559 default posture |

2. **Split posture.** The split rides the interactive-by-default policy + the
   **additive `autonomy_contract`** — the canonical contract shape is **cited
   by pointer** to `target-architecture.md §"autonomy_policy / autonomy_contract"`
   (never re-spelled). Runbook approval lowers **only the SOFT gate**.
3. **ClassSelect.** From the `[runbook]` positional, else surfaced detection —
   **always confirmed**.
4. **Head block.** Populate `guild.ops.v1` head (class enum, `runbook_ref`)
   **by pointer to `target-architecture.md §646–655`**.

*pass_when (named-predicate "Operations taxonomy + split autonomy", lifecycle
§548-572): exactly 5 classes with the §548–559 postures; incident + rollback
never autonomous; `autonomy_contract` cited by pointer (no re-spell); ops.v1
head maps to §646–655 by pointer. Evidence: this section + grep showing no
copied autonomy/ops schema; `validation-matrix.md §A P6-ops-001`.*

## safety-rails

*`P6-ops-002` deliverable — the 4 non-negotiable safety rails + mandatory
pre-flight, machine-checkable in `guild.ops.v1.safety_rails`.*

The **4 conceptual rails** (VERBATIM-BY-POINTER to
`lifecycle/lifecycle-overview.md §574–590`; pre-flight §611–615; wiki trust
root §574–607):

1. **Rail 1** — no class autonomous-by-default for **unproven** runbooks
   (earned per-runbook; first run **always interactive**).
2. **Rail 2** — `incident` + `rollback` **NEVER autonomous**.
3. **Rail 3** — the always-ask **hard set is unconditional** (even under
   `--auto-approve=all`, even inside an approved autonomous runbook).
4. **Rail 4** — pre-flight **dry-run mandatory** (steps + blast radius +
   rollback path; interactive classes gate on it).

**Fixed 4-rail → 5-boolean decomposition** (machine-checkable in the frozen
`guild.ops.v1.safety_rails` bool block — **pointer to
`target-architecture.md §667–672`**, field names cited as the FIXED contract
the task mandates, not a re-spell of the frozen body). **The 4↔5 reason:**
rail 4 (mandatory pre-flight) produces **TWO** booleans — one for the
dry-run-ran leg and one for its allowlist-guard leg. This is a 4-rail → 5-bool
decomposition, **NOT a 1:1 map**:

| # | Rail leg | → `safety_rails` boolean (§667–672, by pointer) |
|---|---|---|
| 1 | rail1 (unproven runbook not autonomous-by-default; first run interactive) | `unproven_runbook_was_interactive` |
| 2 | rail2 (incident + rollback never autonomous) | `incident_rollback_not_autonomous` |
| 3 | rail3 (always-ask hard set unconditional) | `hard_set_prompted_inline` |
| 4 | rail4 (pre-flight dry-run mandatory — dry-run-ran leg) | `preflight_dry_run_ran` |
| 5 | rail4 **allowlist-guard leg** | `no_hard_set_in_allowlist` |

Each of the 5 §667–672 booleans appears **exactly once** as the right-hand
side of exactly one rail leg (5 booleans → 5 rail-leg rows, **0 unmapped, 0
double-mapped**). **All 5 booleans `== true` is the rails-satisfied
predicate.**

**Allowlist reject.** `op_class_allowlist` may **NEVER** contain a hard-set
class (destructive / network / spend) — rejected at **plan-validate, exit 2**
(one deterministic validator, two callers — cited, not re-spelled).

**Wiki trust root.** The runbook-approval trust root is
`.guild/wiki/standards/runbooks/<name>.md`, promoted via `guild:decisions`. The
**P5 boundary keeps it under `.guild/`** — cited as the **P5 boundary CONTRACT
(`P1-ownership-001`)**, not the guard implementation (§2.3-#5).

*pass_when (named-predicate "4 safety rails machine-checkable in
guild.ops.v1.safety_rails §667-672", **P6 gating**): the fixed
4-rail→5-boolean decomposition is stated exactly as
`{rail1→unproven_runbook_was_interactive; rail2→incident_rollback_not_autonomous;
rail3→hard_set_prompted_inline; rail4→preflight_dry_run_ran;
rail4-allowlist-guard→no_hard_set_in_allowlist}` (rail 4 = 2 booleans, the 4↔5
reason stated in-row, NOT a 1:1 claim); each of the 5 §667–672 booleans named
once as the RHS of exactly one rail leg (5 booleans → 5 rail-leg rows, 0
unmapped, 0 double-mapped); all 5 `== true` is rails-satisfied; an
`op_class_allowlist` containing a hard-set class ⇒ plan-validate exit 2.
Evidence: this 5-row enumeration by §667–672 pointer + the in-row 4↔5
reconciliation sentence; `validation-matrix.md §A P6-ops-002`.*

## execute

*`P6-ops-003` deliverable — ExecuteRunbook + G-operations + the
guild.ops.v1 / incident.v1 / release.v1 outputs.*

1. **Class-dependent producer** (cited by pointer to
   `lifecycle/lifecycle-overview.md §616–622`):

   | Class | Producer | Advisory |
   |---|---|---|
   | `incident` / `rollback` | `devops-incident-runbook` | — |
   | `monitoring` | `devops-observability-setup` | — |
   | `release` | `devops-ci-cd-pipeline` | `technical-writer-release-notes` (release advisory) |
   | `maintenance` | `devops-infrastructure-as-code` | — |

2. **Per-step recording.** Each step records `op_class`; every **hard-set
   step** shows `autonomy: prompted_inline` (machine-checkable hard-set proof —
   rail 3).
3. **G-operations advisory.** Challengers `[security, architect]`,
   **cross-model-preferred**; **≤4 active specialists**; incident/rollback
   never exceed **producer + challenger**.
4. **Outputs (conditional, by pointer).** `guild.ops.v1` **always**;
   `guild.incident.v1` when `class ∈ {incident, rollback}`; `guild.release.v1`
   when `class == release` — all **by pointer to
   `target-architecture.md §639–729`** (zero re-spelled fields); per-step
   evidence under `.guild/runs/<run-id>/ops/evidence/`.

*pass_when (named-predicate "Operations done-criteria", lifecycle §657-674):
the executed class has a terminal `outcome.status`; every hard-set step
`autonomy: prompted_inline`; ops.v1 (+ conditional incident/release record)
validates; outputs map to §639–729 by pointer (zero re-spelled fields).
Evidence: this section + grep showing no copied ops/incident/release schema;
`validation-matrix.md §A P6-ops-003`.*

## d8-join

*`P6-ops-004` deliverable — the `guild.release.v1 ↔ D8` close-gate
three-leg field join (consume-only).*

1. **The 3-leg join** — CITED by pointer to `target-architecture.md §736–740`
   (field names referenced as the join contract, not a re-spelled body):

   | Leg | Reads (release.v1, §736–740 by pointer) |
   |---|---|
   | Release readiness | `release.outcome.status == completed` |
   | Documentation sync | `release.doc_sync_status` (`synced` **OR** `not_required` + `doc_sync_rationale`) |
   | Evidence trail | `release.release_evidence_refs[]` + `release.quality_ref` |

2. **Supply-only.** Operations only **SUPPLIES** evidence;
   **`InitiativeCloseout` owns initiative closure** (state machine unchanged) —
   Operations does **not** itself close the initiative.
3. **Quality-consume refuse/proceed.** `/guild ops` reads
   `quality/<run-id>.md`. If `release.recommendation == block` **and not
   `force_pass`**, the `release` / `rollback` classes **REFUSE with
   route-back**; `monitoring` / `maintenance` / `incident` may proceed.
4. **[v2] / [v2.x] split.** The D8 close-gate contract is **frozen `[v2]`**;
   its automation is **`[v2.x]`** — P6 specifies the **contract join only**, no
   automation task (DH-2 / GR-7 boundary respected).

*pass_when (named-predicate "release.v1↔D8 join, 3 legs, satisfied",
target-architecture.md §736-745, **P6 gating, feeds P7C**): the skill reads
ONLY the 3 join fields per §736–740; `release`/`rollback` refuse on a
non-force-pass Quality block; `InitiativeCloseout` (unchanged) is the sole
initiative closer; no automation task scheduled. Evidence: this pointer-cited
3-leg join table + the refuse/proceed rule; `validation-matrix.md §A
P6-ops-004` ("release↔D8 join" row).*

# Evidence requirements

- `taxonomy`: 5-class posture table (incident/rollback never autonomous);
  autonomy_contract by pointer.
- `safety-rails`: the 5-row rail-leg→boolean enumeration (each §667–672 boolean
  named once) + the in-row 4↔5 reconciliation; allowlist exit-2.
- `execute`: class→producer map; per-step `op_class`; hard-set step
  `prompted_inline`; conditional records by pointer.
- `d8-join`: pointer-cited 3-leg table; refuse-on-non-force-pass-block rule;
  InitiativeCloseout sole closer; no automation task.

# Escalation rules

- `incident` / `rollback` are **never autonomous** — always interactive,
  regardless of approval or `--auto-approve`.
- A non-force-pass Quality `block` makes `release`/`rollback` **refuse with
  route-back** to Quality; only a recorded human `force_pass` proceeds.
- An `op_class_allowlist` containing a hard-set class **hard-fails
  plan-validate (exit 2)** — no proceed path.

# Safety constraints

- All 4 rails are **pointer-cited verbatim** (`lifecycle §574–590`); none is
  relaxed under runbook approval — approval lowers only the SOFT gate, never
  the hard set (rail 3).
- The always-ask hard set is unconditional even inside an approved autonomous
  runbook.
- No frozen `guild.ops.v1` / `guild.incident.v1` / `guild.release.v1` /
  `autonomy_contract` field text is reproduced — all by pointer through
  `contract-map.md`.
- **No cloud-build task** anywhere (GR-7; `guild.cloud_task_packet.v1` is
  `[v2-contract-only]`, `contract-map.md §E`).

# Eval cases

1. **`release` class, Quality RELEASE-READY** → proceeds; supplies the 3-leg
   D8 evidence; `InitiativeCloseout` (not this skill) closes.
2. **`release` class, Quality `block`, no force_pass** → **REFUSE with
   route-back**.
3. **`incident` class under `--auto-approve=all`** → still **interactive**
   (rail 2); hard-set steps `prompted_inline` (rail 3).
4. **Unproven runbook, first run** → **interactive** (rail 1);
   `unproven_runbook_was_interactive == true`.
5. **`op_class_allowlist` includes a destructive class** → plan-validate
   **exit 2**; `no_hard_set_in_allowlist == false`.
6. **All 5 `safety_rails` booleans true** → rails-satisfied predicate holds;
   execution may proceed under the class's posture.
