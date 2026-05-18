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
  DH-3 BOUNDARY (static read-only plugin install state).
  This skill body is versioned with the plugin and is NEVER written at runtime.
  Per-run quality artifacts (guild.quality.v1) are written to the consuming
  repo's .guild/runs/<run-id>/ — never back into plugin state. A runtime write
  to plugin skill state is a v2 defect.
  CONTRACT FIDELITY: every guild.quality.v1 body reference below is a POINTER
  through docs/knowledge/implementation/contract-map.md §A row 7 →
  architecture/target-architecture.md §588–637. Zero schema_version / field
  text is reproduced here (named-predicate anti-respell guard).
  Derived from plugin/templates/skills/SKILL.template.md (required-heading set
  preserved).
-->

# guild:quality

Realizes **DI-2 (full Quality skill)** (`decisions/di1-di6-contracts.md`)
against the now-frozen **`guild.quality.v1`** body
(`contract-map.md §A` row 7 → `architecture/target-architecture.md §588–637`;
release predicate `§632–637`). Flow:
`SignalScan → SelectMatrix → RunChecks → G-quality → ReleaseGate`.

# When to use it

At the lifecycle quality phase: to derive the applicable check matrix from
on-disk signals, run discovered harnesses under sandbox + canonical budget,
collect the advisory G-quality trail, and compute (never ask) a release
recommendation over the full disposition enum.

# When not to use it

- Operations / runbooks (release, monitoring, incident, rollback, maintenance)
  → `guild:operations`.
- Authoring or installing a test framework/harness → `qa-*` specialists. This
  skill executes **only discovered** harnesses; it never authors or installs.
- Initiative closure (the D8 close-gate) → `InitiativeCloseout` owns it; this
  skill only **supplies** the quality evidence Operations reads.

# Required inputs

- The run's `task_run` permission envelope + the immutable always-ask hard set
  (`contract-map.md §A` row 1 → `target-architecture.md §"task_run contract"` —
  by pointer).
- The canonical budget `defaults.quality.budget`
  (`per_class_minutes`/`total_minutes`) **by pointer to
  `command-surface.md §4.4`** — numbers never restated here.
- Lifecycle signal rules `lifecycle/lifecycle-overview.md §436–503`.
- The frozen `guild.quality.v1` body — `contract-map.md §A` row 7 →
  `target-architecture.md §588–637` (pointer only).

# Output format

`guild.quality.v1` for the run, written under
`.guild/runs/<run-id>/quality/<run-id>.md` — its `selection` / `results` /
`challenger_trail` / `release_decision` blocks populated **by pointer** to
`target-architecture.md §600–606 / §607–611 / §616–623 / §624–628`
respectively (zero re-spelled fields).

# Workflow steps

## selection

*`P6-quality-001` deliverable — SignalScan → SelectMatrix (deterministic,
surfaced, overridable).*

1. **Deterministic SignalScan.** For the closed class enum
   `{e2e, smoke, a11y, perf, integration}`, decide each class from a
   **deterministic on-disk signal** (the signal→class rules are cited by
   pointer to `lifecycle/lifecycle-overview.md §436`). **No LLM guess** for
   selection.
2. **No class silently skipped.** A skipped class ⇒ explicit
   `not_applicable: <reason>`. A class that is applicable but has no harness ⇒
   `gap: <class> applicable but no harness found`. Every one of the five
   classes therefore has an explicit selected / `not_applicable` / `gap`
   disposition with a reason.
3. **Surfaced + overridable.** Print the derived matrix + estimated budget +
   the 3-choice prompt `[proceed] [edit-selection] [explain-signals]`.
   `edit-selection` records `override: user`.
4. **Selection block.** Populate `guild.quality.v1.selection` **by pointer to
   `target-architecture.md §600–606`** — never re-spell the frozen fields.

*pass_when (named-predicate "Quality selection completeness", lifecycle
§436-451 + §522-524): every class selected/skipped from a deterministic on-disk
signal; no class silently skipped (each has `not_applicable`/`gap` with a
reason); matrix surfaced with the 3-choice prompt; selection block maps to
§600–606 by pointer (zero re-spelled fields). Evidence: this section + grep
showing no copied schema text; `validation-matrix.md §A P6-quality-001`.*

## runchecks

*`P6-quality-002` deliverable — RunChecks under sandbox + canonical budget.*

1. **Discovered harnesses only.** Execute **only discovered** harnesses; never
   author or install a framework (that lives in `qa-*` specialists).
2. **Sandbox / permission envelope.** Execution inherits the run's `task_run`
   permission envelope **plus** the immutable always-ask hard set
   (network/destructive prompts inline **regardless of `--auto-approve`**) —
   cited by pointer to `target-architecture.md §"task_run contract"`.
3. **Canonical budget.** Per-class + total wall-clock budget is the canonical
   `defaults.quality.budget` (`per_class_minutes`/`total_minutes`) consumed
   **BY POINTER to `command-surface.md §4.4`** — the numbers are **never
   restated**. On exhaustion the class is
   `inconclusive: budget exhausted` — **never silently passed**.
4. **Results block.** Populate `guild.quality.v1.results` rows **by pointer to
   `target-architecture.md §607–611`**.

*pass_when (named-predicate "Quality RunChecks under sandbox+budget", lifecycle
§452-466): only discovered harnesses run; budget sourced from
`defaults.quality.budget` by pointer (no restated numbers); exhaustion ⇒
inconclusive (never silent pass); results map to §607–611 by pointer. Evidence:
this section + grep showing the budget is a §4.4 pointer (no
`per_class_minutes`/`total_minutes` literals); `validation-matrix.md §A
P6-quality-002`.*

## g-quality

*`P6-quality-003` deliverable — the advisory G-quality challenger trail.*

1. **Fixed producer/challenger pair.** Producer `qa-test-strategy` (fixed);
   challengers `[security, architect]` (fixed pair); **cross-model-preferred**
   (the flag is recorded).
2. **Advisory (non-blocking).** G-quality is **advisory A** — it does **not**
   itself block. Findings are resolved by **rerun**, an **added check**, or an
   **owner-accepted risk** (the accepting owner is named).
3. **challenger_trail block.** Populate `guild.quality.v1.challenger_trail`
   **by pointer to `target-architecture.md §616–623`**.

*pass_when (named-predicate "G-quality advisory completeness", lifecycle
§467-471 + §526-527): fixed producer/challenger pair; cross-model flag
recorded; every finding resolved or owner-accepted with name; G-quality
non-blocking; challenger_trail maps to §616–623 by pointer. Evidence: this
section; `validation-matrix.md §A P6-quality-003`.*

## releasegate

*`P6-quality-004` deliverable — the COMPUTED ReleaseGate predicate
(cite-only, full enum) + the `--auto-approve` asymmetry.*

1. **COMPUTED, not asked, complete over the full enum.** The recommendation is
   **COMPUTED** (never asked) and complete over the full disposition enum
   `{pass | fail | inconclusive | not_applicable | gap}`. The predicate is
   **CITED by pointer** to `target-architecture.md §632–637` +
   `lifecycle/lifecycle-overview.md §472–503` — **NOT re-derived or "extended"
   (GR-5)**.
2. **Pointer-cited truth-table** (block/no-block disposition rows reference the
   canonical §632–637 text — not a copied schema body):

   | Disposition condition (over a *selected* class unless noted) | Per §632–637 |
   |---|---|
   | a selected class is `fail` | **BLOCK** |
   | `inconclusive` with **no owner** | **BLOCK** |
   | a security/privacy/reliability-relevant `gap` with **no owner** | **BLOCK** |
   | `gap` **or** `not_applicable` on a **selected** class with **no owner** | **BLOCK** |
   | none of the above | **RELEASE-READY** |
   | `not_applicable` (not on a selected class) / a **non-safety** `gap` | **never blocks** |

   This table is a **pointer projection** of `§632–637` + `§472–503`; the
   canonical predicate lives there and is not re-derived here (a diff vs
   `§632–637` shows zero predicate drift).
3. **3-choice gate.** `[release] [block] [abort]`. `[release]` on a **BLOCK**
   is a **HUMAN-ONLY force-pass** — the human name + rationale are recorded.
4. **`--auto-approve` asymmetry (printed, not hidden).** Token set
   `[spec, plan, build, all]` — **no `qa`/`ops` token**. A **RELEASE-READY**
   recommendation **IS auto-passed** under `--auto-approve=all`. A
   **BLOCK→release override is NEVER auto-passed** — it is human-gated, and the
   asymmetry is **printed**, never silent.
5. **release_decision block.** Populate `guild.quality.v1.release_decision`
   **by pointer to `target-architecture.md §624–628`**.

*pass_when (named-predicate "release predicate matches target-architecture.md
§632-637", **P6 gating, feeds P7C**): the predicate is byte-faithful to
§632–637 + §472–503 (BLOCK iff fail | inconclusive-no-owner |
safety-gap-no-owner | gap/NA-on-selected-no-owner; else RELEASE-READY);
BLOCK→release override never auto-passed under `--auto-approve=all`. Evidence: a
pointer-cited truth-table whose rows quote section anchors (not copied schema);
a diff vs §632–637 shows zero predicate drift; `validation-matrix.md §A
P6-quality-004` ("release predicate" row). Risk_rollback: replace the
truth-table with the bare §632–637 pointer — the predicate is canonical there,
zero loss / zero drift.*

# Evidence requirements

- `selection`: deterministic-signal table + 3-choice prompt; grep proves zero
  copied schema.
- `runchecks`: budget is a `command-surface.md §4.4` pointer (no literals);
  discovered-harness-only.
- `g-quality`: fixed pair + cross-model flag + advisory (non-blocking).
- `releasegate`: pointer-cited truth-table + zero-drift diff vs §632–637 + the
  printed BLOCK-override asymmetry.

# Escalation rules

- A BLOCK is never overridden by automation. `[release]` on a BLOCK escalates
  to a **human** (name + rationale recorded). No `qa` token exists in
  `--auto-approve`, so no automation path can pass a BLOCK.
- G-quality findings escalate to the named owner (rerun / added check /
  owner-accepted risk) — G-quality itself never blocks.

# Safety constraints

- The always-ask hard set is **unconditional** — network/destructive prompts
  fire inline regardless of `--auto-approve` (cited by pointer, not re-spelled).
- The release predicate is **single-source** (`§632–637`); this skill cites it
  and never extends/restates it (GR-5).
- No frozen `guild.quality.v1` field text is reproduced — all by pointer
  through `contract-map.md §A` row 7.

# Eval cases

1. **All-pass, no defaults config** → COMPUTED `RELEASE-READY`; under
   `--auto-approve=all` it auto-passes.
2. **One selected class `fail`** → COMPUTED `BLOCK`; `[release]` requires a
   named human force-pass; **not** auto-passed under `--auto-approve=all`.
3. **`inconclusive` with no owner** → `BLOCK`. With a named owner-accepted
   risk → not a block by that row.
4. **Budget exhausted on a class** → `inconclusive: budget exhausted` (never
   silent pass).
5. **`not_applicable` on a non-selected class** → never blocks.
6. **Class applicable, no harness** → `gap`; if security/privacy/reliability
   and no owner → `BLOCK`.
