---
# guild.skill_template.v1 — instance (derived). DH-3: this is plugin-static
# canonical skill state (shipped, never runtime-written). derived_from_template
# is carried for traceability to the canonical base per the template's DH-3
# boundary comment.
template_version: guild.skill_template.v1
derived_from_template: guild.skill_template.v1
name: guild-quality
description: The full guild:quality skill — deterministic SignalScan→SelectMatrix selection, RunChecks under sandbox + canonical budget, the advisory G-quality challenger trail, and the COMPUTED ReleaseGate predicate with the --auto-approve BLOCK-override asymmetry. TRIGGER for "run quality", "quality gate", "release readiness", "should we release", "run the checks", "quality selection", "release gate". DO NOT TRIGGER for operations/runbooks (guild:operations owns release/monitoring/incident/rollback/maintenance), for authoring or installing a test framework (qa-* specialists own that), or for the D8 initiative close-gate (InitiativeCloseout owns closure).
when_to_use: Invoked at the quality phase of the lifecycle to select the applicable check matrix, run discovered harnesses under the run's permission envelope + canonical budget, gather the advisory G-quality trail, and emit a COMPUTED release recommendation. Feeds guild:operations' release↔D8 join (consume-only).
type: core
---

<!--
  DH-3 BOUNDARY (static, read-only). NEVER written at runtime; per-run
  guild.quality.v1 artifacts go to the consuming repo's .guild/runs/<run-id>/
  (a runtime write to plugin state is a v2 defect). CONTRACT FIDELITY: every
  guild.quality.v1 reference is a POINTER through contract-map.md §A row 7 →
  target-architecture.md §588–637; zero schema_version / field text reproduced
  (anti-respell guard). PROGRESSIVE DISCLOSURE: step mechanics, full pass_when,
  and the ReleaseGate truth-table live in ./quality-mechanics.md (loaded on
  demand; behaviour unchanged). Derived from SKILL.template.md (heading set kept).
-->

# guild:quality

Realizes **DI-2 (full Quality skill)** (`decisions/di1-di6-contracts.md`)
against the frozen **`guild.quality.v1`** (`contract-map.md §A` row 7 →
`target-architecture.md §588–637`; predicate `§632–637`). Flow:
`SignalScan → SelectMatrix → RunChecks → G-quality → ReleaseGate`. Lean playbook
here; mechanics, full `pass_when`, and the ReleaseGate truth-table in
**`./quality-mechanics.md`** (open per step — behaviour identical).

# When to use it

At the quality phase: derive the check matrix from on-disk signals, run
discovered harnesses under sandbox + canonical budget, collect the advisory
G-quality trail, and **compute** (never ask) a release recommendation over the
full disposition enum.

# When not to use it

- Operations / runbooks (release, monitoring, incident, rollback, maintenance)
  → `guild:operations`.
- Authoring/installing a test harness → `qa-*` specialists; this skill runs
  **only discovered** harnesses, never authors or installs.
- Initiative closure (D8 close-gate) → `InitiativeCloseout`; this skill only
  **supplies** the quality evidence Operations reads.

# Required inputs

- `task_run` permission envelope + the immutable always-ask hard set
  (`contract-map.md §A` row 1 → `target-architecture.md §"task_run contract"`).
- Canonical budget `defaults.quality.budget` **by pointer to
  `command-surface.md §4.4`** (numbers never restated).
- Signal rules `lifecycle/lifecycle-overview.md §436–503`; frozen
  `guild.quality.v1` (`contract-map.md §A` row 7 → `§588–637`, pointer only).

# Output format

`guild.quality.v1` at `.guild/runs/<run-id>/quality/<run-id>.md` — `selection` /
`results` / `challenger_trail` / `release_decision` blocks **by pointer** to
`§600–606 / §607–611 / §616–623 / §624–628` (zero re-spelled fields).

# Workflow steps

Full mechanics + `pass_when` per step: **`./quality-mechanics.md`**.

## selection

SignalScan → SelectMatrix: deterministic, surfaced, overridable. Each class in
`{e2e, smoke, a11y, perf, integration}` decided from a **deterministic on-disk
signal** (no LLM guess); none silently skipped — each is selected /
`not_applicable: <reason>` / `gap: …no harness found`. Surface matrix + budget +
`[proceed] [edit-selection] [explain-signals]` (**no `--classes=` flag**);
`edit-selection` records `override: user`. Populate `selection` → `§600–606`.

## runchecks

Run **only discovered** harnesses (never author/install — `qa-*` own that)
under the `task_run` envelope **+** the unconditional always-ask hard set.
Budget = `defaults.quality.budget` **by pointer to `command-surface.md §4.4`**
(numbers never restated); exhaustion ⇒ `inconclusive: budget exhausted`,
**never a silent pass**. Populate `results` → `§607–611`.

## g-quality

Advisory (non-blocking). Fixed producer `qa-test-strategy`; fixed challengers
`[security, architect]`; cross-model-preferred (flag recorded). Findings resolve
by rerun / added check / named owner-accepted risk — never itself blocks.
Populate `challenger_trail` → `§616–623`.

## releasegate

**COMPUTED** (never asked), complete over `{pass | fail | inconclusive |
not_applicable | gap}`, **CITED by pointer** to `§632–637` +
`lifecycle-overview.md §472–503` — never re-derived/"extended" (GR-5). **BLOCK**
iff a selected class is `fail`, or `inconclusive` no-owner, or a safety-relevant
`gap` no-owner, or `gap`/`not_applicable` on a selected class no-owner; **else
RELEASE-READY**. Gate `[release] [block] [abort]`; `[release]` on a BLOCK is a
**HUMAN-ONLY** force-pass (name + rationale recorded). `--auto-approve` tokens
`[spec, plan, build, all]` — **no `qa`/`ops`**: RELEASE-READY auto-passes under
`--auto-approve=all`, but a **BLOCK→release override is NEVER auto-passed**
(asymmetry printed, never silent). Populate `release_decision` → `§624–628`.
*Full truth-table: quality-mechanics.md.*

# Evidence requirements

- `selection`: deterministic-signal table + 3-choice prompt; grep proves zero
  copied schema. `runchecks`: budget a `§4.4` pointer (no literals);
  discovered-harness-only. `g-quality`: fixed pair + cross-model flag +
  advisory. `releasegate`: pointer-cited truth-table (quality-mechanics.md) +
  zero-drift diff vs §632–637 + the printed BLOCK-override asymmetry.

# Escalation rules

- A BLOCK is never overridden by automation: `[release]` on a BLOCK escalates
  to a **human** (name + rationale); no `qa` token exists in `--auto-approve`.
- G-quality findings escalate to the named owner (rerun / added check /
  owner-accepted risk) — G-quality itself never blocks.

# Safety constraints

- Always-ask hard set is **unconditional** — network/destructive prompts fire
  inline regardless of `--auto-approve` (by pointer, not re-spelled).
- Release predicate is **single-source** (`§632–637`); cited, never
  extended/restated (GR-5). No frozen `guild.quality.v1` field text reproduced
  — all by pointer through `contract-map.md §A` row 7.

# Eval cases

1. **All-pass, no defaults config** → `RELEASE-READY`; auto-passes under
   `--auto-approve=all`.
2. **One selected class `fail`** → `BLOCK`; `[release]` needs a named human
   force-pass; **not** auto-passed under `--auto-approve=all`.
3. **`inconclusive`, no owner** → `BLOCK`; with a named owner-accepted risk →
   not a block by that row.
4. **Budget exhausted** → `inconclusive: budget exhausted` (never silent pass).
5. **`not_applicable` on a non-selected class** → never blocks.
6. **Class applicable, no harness** → `gap`; if safety-relevant and no owner →
   `BLOCK`.
