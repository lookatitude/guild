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
  guild.quality.v1 reference is a POINTER through ./quality-contract.md
  §"guild.quality.v1 fields"; zero schema_version / field text reproduced
  (anti-respell guard). PROGRESSIVE DISCLOSURE: step mechanics, full pass_when,
  and the ReleaseGate truth-table live in ./quality-mechanics.md (loaded on
  demand; behaviour unchanged). Derived from SKILL.template.md (heading set kept).
-->

# guild:quality

Realizes **DI-2 (full Quality skill)** (`decisions/di1-di6-contracts.md`)
against the frozen **`guild.quality.v1`** (`./quality-contract.md §"guild.quality.v1 fields"`;
predicate `./quality-contract.md §"ReleaseGate predicate"`). Flow:
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

- A **passing `.guild/runs/<run-id>/verify.md`** (the build phase's
  `guild:verify-done` output). Quality runs *after* a passing verify-done,
  never instead (invariant 4, `./quality-contract.md §"Lifecycle ordering"`): absent or
  failing ⇒ **route-back** to Development — do not proceed silently. An
  explicit operator decision to proceed without it MUST be recorded (name +
  reason) in the quality report.
- `task_run` permission envelope + the immutable always-ask hard set
  (`./quality-contract.md §"task_run envelope & always-ask hard set"`, which
  cites `scripts/lib/permission-policy-schema.ts`).
- Canonical budget `defaults.quality.budget` **by pointer to
  `./quality-contract.md §Budget`** (numbers never restated).
- Signal rules `./quality-contract.md §selection`; frozen
  `guild.quality.v1` (`./quality-contract.md §"guild.quality.v1 fields"`, pointer only).

# Output format

`guild.quality.v1` at `.guild/runs/<run-id>/quality/<run-id>.md` — `selection` /
`results` / `challenger_trail` / `release_decision` blocks **by pointer** to
`./quality-contract.md §selection / §results / §challenger_trail / §release_decision`
(zero re-spelled fields).

# Workflow steps

Full mechanics + `pass_when` per step: **`./quality-mechanics.md`**.

## qa-team-gate (step 0 — HOLD before any participant dispatch)

The qa phase dispatches participants — the producer, the advisory-panel
challengers, and the `reviewer_cross_host` broker slot — so it composes and
gates **first** (`team-compose SKILL.md §"Team decision gate"`: every phase
that can dispatch). Before ANY producer/panel/broker dispatch, either run the
per-phase composition pass (`guild:team-compose` with `phase=qa`, proposing the
full qa roster — producer, composer-derived `advisory_panel` challengers,
cross-host reviewer slot — as an immutable `guild.team_proposal.v2`) or
consume an already-approved **current** qa-phase decision. Then **HOLD**: no
participant dispatches until a current `guild.team_decision.v1` `approve`
exists whose `proposal_hash` equals the hash RECOMPUTED from the proposal
artifact; stale, hash-mismatched, or absent decisions **fail closed** — there
is no dispatch-first path. `selection`/`runchecks` are orchestrator-session
work (no participant dispatch) and may proceed while the gate is pending; the
per-dispatch hash checks in `## g-quality` re-verify this same gate at each
dispatch — they never replace it.

## selection

SignalScan → SelectMatrix: deterministic, surfaced, overridable. Each class in
`{e2e, smoke, a11y, perf, integration}` decided from a **deterministic on-disk
signal** (no LLM guess); none silently skipped — each is selected /
`not_applicable: <reason>` / `gap: …no harness found`. Surface matrix + budget +
`[proceed] [edit-selection] [explain-signals]` (**no `--classes=` flag**);
`edit-selection` records `override: user`. Populate `selection` → `./quality-contract.md §selection`.

## runchecks

Run **only discovered** harnesses (never author/install — `qa-*` own that)
under the `task_run` envelope **+** the unconditional always-ask hard set.
Budget = `defaults.quality.budget` **by pointer to `./quality-contract.md §Budget`**
(numbers never restated); exhaustion ⇒ `inconclusive: budget exhausted`,
**never a silent pass**. Populate `results` → `./quality-contract.md §results`.

## g-quality

Two **distinct, both-kept** review mechanisms at this boundary (https://guildstack.dev/docs/adversarial-review):

1. **In-phase advisory panel.** Advisory (non-blocking). Sourced from the station
   composer's `qa` `advisory_panel` (SoT: `src/modules/teams/workflows/station-composer.ts`
   `STATION_POLICY.qa.advisory_panel`) — not a hardcoded fixed pair: producer
   `qa-test-strategy` (matches the composer); challengers `security` (BASELINE — always
   present) + `architect` (GATED on `multi_component`, recorded `chal:qa:architect`);
   cross-model-preferred (flag recorded). Panel members are qa-phase participants
   (`guild.team_proposal.v2` → `guild.team_decision.v1`; advisory labels never
   bypass approval; capacity shapes `guild.team_schedule.v1` waves only, never
   membership) — and at panel dispatch, verify a **current** `approve` decision
   whose hash matches the RECOMPUTED proposal hash covers each member
   (stale/mismatched decisions fail closed), same as any dispatch. Findings resolve by rerun /
   added check / named owner-accepted risk — never itself blocks. Populate
   `challenger_trail` → `./quality-contract.md §challenger_trail`.
2. **Cross-host G-quality gate via the broker (policy-gated).** *Separate* from
   the same-session panel above: this is the **cross-host** review where a
   **different host family** critiques the quality report. The reviewer slot is a
   qa-phase participant (`participation_kind: reviewer_cross_host`): before
   dispatching the broker, confirm a current `guild.team_decision.v1` `approve`
   whose hash matches the recomputed proposal hash covers it — stale/mismatched
   decisions fail closed (a `skipped` outcome dispatches nothing). After the report is
   written and before `releasegate` computes, invoke `guild-review-broker`:

   ```
   Skill: guild-review-broker
   args: gate=G-quality artifact_path=<quality-report-path> run_id=<run-id> author_host=<run author host>
   ```

   The broker is policy-gated (https://guildstack.dev/docs/adversarial-review): it fires only
   when `risk ≥ high`, `review: cross` / `--review=cross`, or config requires it
   — else it resolves `status: "skipped"` and the boundary passes with no
   cross-host reviewer (self-build runs treat it as always-on). On `"rework"`,
   resolve the findings before `releasegate`. The broker gate is the cross-host
   layer; it does **not** replace the advisory panel and does **not** alter the
   `releasegate` BLOCK semantics below.

## releasegate

**COMPUTED** (never asked), complete over `{pass | fail | inconclusive |
not_applicable | gap}`, **CITED by pointer** to `./quality-contract.md
§"ReleaseGate predicate"` (the canonical predicate) — never
re-derived/"extended" (GR-5). **BLOCK** iff any selected class is `fail`, OR
`inconclusive` with no owner-accepted risk, OR a
security/privacy/reliability-relevant `gap` with no owner-accepted risk;
**else RELEASE-READY**. `not_applicable` and a **non-safety** `gap` **never
block** (surfaced in the gate summary, release-ready by default).
Gate `[release] [block] [abort]`; `[release]` on a BLOCK is a
**HUMAN-ONLY** force-pass (name + rationale recorded). `--auto-approve` tokens
`[spec, plan, build, qa, all]` — **no `ops`**: `qa` (and `all`) auto-passes a
**RELEASE-READY** verdict ONLY; a **BLOCK→release override is NEVER
auto-passed** under any token (asymmetry printed, never silent). Populate
`release_decision` → `./quality-contract.md §release_decision`.
*Full truth-table: quality-mechanics.md.*

## learning-checkpoint (step 7.5 — advisory, no new gate)

After `releasegate` and before phase close, fire the per-phase LearningCheckpoint with `phase=quality` and the quality report as `evidence_ref`. Invoke `guild:learning-checkpoint` to classify the already-written quality report (results, challenger trail, release decision) into the 12-target verdict, then emit via the hook — full call signature + `GUILD_PHASE` mapping canonical in `skills/meta/learning-checkpoint/SKILL.md §"How a phase skill fires the checkpoint"` (do not re-spell). It rides this existing boundary, defaults to all-`none` (a near-zero-token no-op), asks no new prompt, and adds no new gate; it does NOT touch the `releasegate` BLOCK semantics. Non-`none` verdicts route only to `.guild/reflections/<run-id>.md`.

# Evidence requirements

- `qa-team-gate`: the step-0 hold ran BEFORE any producer/panel/broker
  dispatch — a current, recomputed-hash-matching `approve` decision (or the
  composition pass that produced one) is cited ahead of the first dispatch.
- `selection`: deterministic-signal table + 3-choice prompt; grep proves zero
  copied schema. `runchecks`: budget a `§4.4` pointer (no literals);
  discovered-harness-only. `g-quality`: composer-derived qa `advisory_panel` +
  cross-model flag + advisory (non-blocking). `releasegate`: pointer-cited truth-table (quality-mechanics.md) +
  zero-drift diff vs `./quality-contract.md §"ReleaseGate predicate"` + the printed BLOCK-override asymmetry.

# Escalation rules

- A BLOCK is never overridden by automation: `[release]` on a BLOCK escalates
  to a **human** (name + rationale); the `--auto-approve=qa` token is
  PASS-only — it never touches a BLOCK.
- G-quality findings escalate to the named owner (rerun / added check /
  owner-accepted risk) — G-quality itself never blocks.

# Safety constraints

- Always-ask hard set is **unconditional** — network/destructive prompts fire
  inline regardless of `--auto-approve` (by pointer, not re-spelled).
- Release predicate is **single-source** (`./quality-contract.md §"ReleaseGate predicate"`);
  cited, never extended/restated (GR-5). No frozen `guild.quality.v1` field text reproduced
  — all by pointer through `./quality-contract.md §"guild.quality.v1 fields"`.

# Eval cases

1. **All-pass, no defaults config** → `RELEASE-READY`; auto-passes under
   `--auto-approve=all`.
2. **One selected class `fail`** → `BLOCK`; `[release]` needs a named human
   force-pass; **not** auto-passed under `--auto-approve=all`.
3. **`inconclusive`, no owner** → `BLOCK`; with a named owner-accepted risk →
   not a block by that row.
4. **Budget exhausted** → `inconclusive: budget exhausted` (never silent pass).
5. **`not_applicable`** → never blocks (informational only — on any class,
   selected or not).
6. **Class applicable, no harness** → `gap`; if security/privacy/reliability-
   relevant and no owner-accepted risk → `BLOCK`; a non-safety `gap` never
   blocks (surfaced, release-ready by default).
