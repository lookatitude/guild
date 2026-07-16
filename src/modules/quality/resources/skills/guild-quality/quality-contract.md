<!--
  DH-3 BOUNDARY (static, read-only plugin install state). Shipped
  progressive-disclosure support file for skills/guild-quality/SKILL.md +
  quality-mechanics.md — same pattern as quality-mechanics.md. NEVER written at
  runtime; per-run guild.quality.v1 artifacts go to the consuming repo's
  .guild/runs/<run-id>/quality/.
-->

# guild.quality.v1 — frozen contract reference

Shipped frozen contract reference for `guild.quality.v1`. Canonical field source
of truth. Skills bind to this by pointer (anti-respell); where a value is owned
by code, the code path cited here is canonical.

This file consolidates the field blocks, the ReleaseGate predicate, the quality
budget, the `task_run` permission envelope, and the lifecycle-ordering invariant
that `skills/guild-quality/SKILL.md` and `skills/guild-quality/quality-mechanics.md`
own. Point at a named section below instead of restating the tables inline.

## guild.quality.v1 fields

The report at `.guild/runs/<run-id>/quality/<run-id>.md` carries four blocks:
`selection`, `results`, `challenger_trail`, `release_decision`. Populate each by
pointer to the matching sub-section — never re-spell the field text elsewhere.

### selection

Output of `SignalScan → SelectMatrix`. Deterministic, surfaced, overridable.

- Closed class enum: `{e2e, smoke, a11y, perf, integration}`.
- Each class decided from a **deterministic on-disk signal** (no LLM guess).
- Every class carries an explicit disposition + reason: `selected` /
  `not_applicable: <reason>` / `gap: <class> applicable but no harness found`.
  No class is silently skipped.
- The derived matrix + estimated budget are surfaced with the 3-choice prompt
  `[proceed] [edit-selection] [explain-signals]`; there is **no `--classes=`
  flag**. `edit-selection` records `override: user`.

### results

Per-class execution outcomes from `RunChecks`.

- One row per class, each with a disposition over the full enum
  `{pass | fail | inconclusive | not_applicable | gap}`.
- Only **discovered** harnesses run (authoring/installing lives in `qa-*`).
- Budget exhaustion ⇒ `inconclusive: budget exhausted` — **never** a silent
  pass.

### challenger_trail

The advisory G-quality panel trail (non-blocking).

- Sourced from the station composer's **`qa` station `advisory_panel`** (SoT:
  `src/modules/teams/workflows/station-composer.ts` `STATION_POLICY.qa.advisory_panel`,
  resolved by `composeStationTeam`) — not a hardcoded fixed pair. Producer
  `qa-test-strategy` (matches the composer); challengers `security` (BASELINE — always
  present) + `architect` (GATED on the `multi_component` signal; recorded as
  `chal:qa:architect`); **cross-model-preferred** (the flag is recorded).
- Each finding is resolved by **rerun**, an **added check**, or a **named
  owner-accepted risk** (the accepting owner is named). G-quality never itself
  blocks.

### release_decision

The COMPUTED release recommendation + gate outcome.

- `recommendation` computed over the full disposition enum — `BLOCK` or
  `RELEASE-READY` per the [ReleaseGate predicate](#releasegate-predicate).
- Gate choice `[release] [block] [abort]`; a `[release]` over a `BLOCK` records
  the **human** force-pass name + rationale.

## ReleaseGate predicate

**COMPUTED, never asked.** Complete over `{pass | fail | inconclusive |
not_applicable | gap}`. Single-source — cited, never re-derived or "extended"
(GR-5).

| Disposition condition (over a *selected* class unless noted) | Verdict |
|---|---|
| a selected class is `fail` | **BLOCK** |
| `inconclusive` with **no owner-accepted risk** | **BLOCK** |
| a security/privacy/reliability-relevant `gap` with **no owner-accepted risk** | **BLOCK** |
| none of the above | **RELEASE-READY** |
| `not_applicable` (any class) / a **non-safety** `gap` | **NEVER blocks** (surfaced in the gate summary; release-ready by default) |

- `[release]` on a **BLOCK** is a **HUMAN-ONLY force-pass** (name + rationale
  recorded).
- `--auto-approve` tokens `[spec, plan, build, qa, all]` — **no `ops` token**.
  `qa` (and `all`) auto-passes a **RELEASE-READY** verdict ONLY; a
  **BLOCK→release override is NEVER auto-passed** under any token. The asymmetry
  is **printed**, never silent.

## Budget

Canonical per-class + total wall-clock budget is `defaults.quality.budget`.
**The code is the source of truth:**
`src/modules/config/workflows/config-defaults.ts:130` →
`{ per_class_minutes: 10, total_minutes: 30 }`. Consume by pointer to that path;
do not restate the numbers elsewhere. On exhaustion the class is `inconclusive:
budget exhausted` — never silently passed.

## task_run envelope & always-ask hard set

Check execution inherits the run's `task_run` permission envelope **plus** an
immutable always-ask hard set that fires network/destructive prompts inline
**regardless of `--auto-approve`**.

**The code is the source of truth:** `scripts/lib/permission-policy-schema.ts`.
The `ALWAYS_ASK_HARD_SET` constant = `{ release, security, ops, destructive }` —
unconditional and unliftable regardless of any `--auto-approve` token or
`guild_gates` setting. The four unliftable gate types:

| Gate type | Always-ask (unliftable) |
|---|---|
| `release` | yes |
| `security` | yes |
| `ops` | yes |
| `destructive` | yes |

`--auto-approve` (including `all`) may auto-safe only the non-hard-set gates
(`plan`, `qa`); it never touches a gate in `ALWAYS_ASK_HARD_SET`.

## Lifecycle ordering

Quality runs **after** a passing `.guild/runs/<run-id>/verify.md` (the build
phase's `guild:verify-done` / verify-done output). Quality runs after a passing
verify-done, never instead:

- Absent or failing `verify.md` ⇒ **route back to Development** — do not proceed
  silently.
- An explicit operator decision to proceed without a passing verify-done MUST be
  recorded (name + reason) in the quality report.
