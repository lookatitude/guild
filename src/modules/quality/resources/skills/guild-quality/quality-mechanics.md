<!--
  DH-3 BOUNDARY (static read-only plugin install state). Supporting reference
  for skills/guild-quality/SKILL.md — progressive-disclosure detail, loaded on
  demand. Same contract-fidelity rule as the parent: every guild.quality.v1
  body reference is a POINTER through ./quality-contract.md §"guild.quality.v1 fields". Zero
  schema_version / field text is reproduced (named-predicate anti-respell
  guard). Never written at runtime.
-->

# guild:quality — mechanics (supporting reference)

Deep mechanics + full `pass_when` predicates + the ReleaseGate truth-table for
the four workflow steps. The parent `SKILL.md` carries the lean playbook and
points here. Flow: `SignalScan → SelectMatrix → RunChecks → G-quality →
ReleaseGate`.

## selection — SignalScan → SelectMatrix

*`P6-quality-001` deliverable — deterministic, surfaced, overridable.*

1. **Deterministic SignalScan.** For the closed class enum
   `{e2e, smoke, a11y, perf, integration}`, decide each class from a
   **deterministic on-disk signal** (signal→class rules by pointer to
   `./quality-contract.md §selection`). **No LLM guess** for selection.
2. **No class silently skipped.** A skipped class ⇒ explicit
   `not_applicable: <reason>`. A class applicable but with no harness ⇒
   `gap: <class> applicable but no harness found`. Every one of the five
   classes therefore has an explicit selected / `not_applicable` / `gap`
   disposition with a reason.
3. **Surfaced + overridable.** Print the derived matrix + estimated budget +
   the 3-choice prompt `[proceed] [edit-selection] [explain-signals]`.
   `edit-selection` records `override: user`. There is **no `--classes=` flag**
   — selection is signal-derived then user-overridable, never flag-passed.
4. **Selection block.** Populate `guild.quality.v1.selection` **by pointer to
   `./quality-contract.md §selection`** — never re-spell the frozen fields.

*pass_when (named-predicate "Quality selection completeness",
`./quality-contract.md §selection`): every class selected/skipped from a deterministic on-disk
signal; no class silently skipped (each has `not_applicable`/`gap` with a
reason); matrix surfaced with the 3-choice prompt; selection block maps to
`./quality-contract.md §selection` by pointer (zero re-spelled fields). Evidence: the selection section +
grep showing no copied schema text; `validation-matrix.md §A P6-quality-001`.*

## runchecks — under sandbox + canonical budget

*`P6-quality-002` deliverable.*

1. **Discovered harnesses only.** Execute **only discovered** harnesses; never
   author or install a framework (that lives in `qa-*` specialists).
2. **Sandbox / permission envelope.** Execution inherits the run's `task_run`
   permission envelope **plus** the immutable always-ask hard set
   (network/destructive prompts inline **regardless of `--auto-approve`**) —
   by pointer to `./quality-contract.md §"task_run envelope & always-ask hard set"`.
3. **Canonical budget.** Per-class + total wall-clock budget is the canonical
   `defaults.quality.budget` (`per_class_minutes`/`total_minutes`) consumed
   **BY POINTER to `./quality-contract.md §Budget`** — the numbers are **never
   restated**. On exhaustion the class is `inconclusive: budget exhausted` —
   **never silently passed**.
4. **Results block.** Populate `guild.quality.v1.results` rows **by pointer to
   `./quality-contract.md §results`**.

*pass_when (named-predicate "Quality RunChecks under sandbox+budget",
`./quality-contract.md §Budget` + `§results`): only discovered harnesses run; budget sourced from
`defaults.quality.budget` by pointer (no restated numbers); exhaustion ⇒
inconclusive (never silent pass); results map to `./quality-contract.md §results` by pointer. Evidence:
the runchecks section + grep showing the budget is a §4.4 pointer (no
`per_class_minutes`/`total_minutes` literals); `validation-matrix.md §A
P6-quality-002`.*

## g-quality — advisory challenger trail

*`P6-quality-003` deliverable.*

1. **Composer-derived, signal-gated panel.** The trail is the station composer's
   **`qa` station `advisory_panel`** (SoT: `src/modules/teams/workflows/station-composer.ts`
   `STATION_POLICY.qa.advisory_panel`, resolved by `composeStationTeam`) — no longer a
   hardcoded fixed pair. Producer `qa-test-strategy` (matches the composer); challengers
   `security` (BASELINE — always present, the safety floor) + `architect` (GATED — present
   only when the `multi_component` signal fired, recorded as `chal:qa:architect`);
   **cross-model-preferred** (the flag is recorded).
2. **Advisory (non-blocking).** G-quality is **advisory A** — it does **not**
   itself block. Findings are resolved by **rerun**, an **added check**, or an
   **owner-accepted risk** (the accepting owner is named).
3. **challenger_trail block.** Populate `guild.quality.v1.challenger_trail`
   **by pointer to `./quality-contract.md §challenger_trail`**.

*pass_when (named-predicate "G-quality advisory completeness",
`./quality-contract.md §challenger_trail`): producer + baseline/gated challengers sourced from
the composer's `qa` `advisory_panel` (producer `qa-test-strategy`; `security` baseline;
`architect` gated on `multi_component`) — not a fixed pair; cross-model flag
recorded; every finding resolved or owner-accepted with name; G-quality
non-blocking; challenger_trail maps to `./quality-contract.md §challenger_trail` by pointer. Evidence: the
g-quality section; `validation-matrix.md §A P6-quality-003`.*

## releasegate — the COMPUTED predicate (cite-only, full enum) + the asymmetry

*`P6-quality-004` deliverable.*

1. **COMPUTED, not asked, complete over the full enum.** The recommendation is
   **COMPUTED** (never asked) and complete over the full disposition enum
   `{pass | fail | inconclusive | not_applicable | gap}`. The predicate is
   **CITED by pointer** to `./quality-contract.md §"ReleaseGate predicate"` —
   **NOT re-derived or "extended" (GR-5)**.
2. **Pointer-cited truth-table** (block/no-block rows reference the canonical
   `./quality-contract.md §"ReleaseGate predicate"` text — not a copied schema body):

   | Disposition condition (over a *selected* class unless noted) | Per `§"ReleaseGate predicate"` |
   |---|---|
   | a selected class is `fail` | **BLOCK** |
   | `inconclusive` with **no owner-accepted risk** | **BLOCK** |
   | a security/privacy/reliability-relevant `gap` with **no owner-accepted risk** | **BLOCK** |
   | none of the above | **RELEASE-READY** |
   | `not_applicable` (any class) / a **non-safety** `gap` | **NEVER blocks** (surfaced in the gate summary; release-ready by default) |

   This table is a **pointer projection** of `./quality-contract.md §"ReleaseGate predicate"`; the
   canonical predicate lives there and is not re-derived here (a diff vs
   `./quality-contract.md §"ReleaseGate predicate"` shows zero predicate drift).
3. **3-choice gate.** `[release] [block] [abort]`. `[release]` on a **BLOCK**
   is a **HUMAN-ONLY force-pass** — the human name + rationale are recorded.
4. **`--auto-approve` asymmetry (printed, not hidden).** Token set
   `[spec, plan, build, qa, all]` — **no `ops` token**. A **RELEASE-READY**
   recommendation **IS auto-passed** under `--auto-approve=qa` or `=all`. A
   **BLOCK→release override is NEVER auto-passed** under any token — it is
   human-gated, and the asymmetry is **printed**, never silent.
5. **release_decision block.** Populate `guild.quality.v1.release_decision`
   **by pointer to `./quality-contract.md §release_decision`**.

*pass_when (named-predicate "release predicate matches `./quality-contract.md
§"ReleaseGate predicate"`", **P6 gating, feeds P7C**): the predicate is byte-faithful to
`./quality-contract.md §"ReleaseGate predicate"` (BLOCK iff fail | inconclusive-no-owner |
safety-gap-no-owner; else RELEASE-READY; NA and non-safety gap NEVER block);
BLOCK→release override never auto-passed under `--auto-approve=all`. Evidence: a
pointer-cited truth-table whose rows quote section anchors (not copied schema);
a diff vs `./quality-contract.md §"ReleaseGate predicate"` shows zero predicate drift; `validation-matrix.md §A
P6-quality-004` ("release predicate" row). Risk_rollback: replace the
truth-table with the bare `./quality-contract.md §"ReleaseGate predicate"` pointer — the predicate is canonical there,
zero loss / zero drift.*
