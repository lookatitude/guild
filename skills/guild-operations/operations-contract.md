<!--
  DH-3 BOUNDARY (static, read-only plugin install state). Shipped
  progressive-disclosure support file for skills/guild-operations/SKILL.md and
  the sibling skills/meta/ops-*/SKILL.md runbooks. NEVER written at runtime;
  per-run guild.ops.v1 / guild.incident.v1 / guild.release.v1 artifacts go to
  the consuming repo's .guild/runs/<run-id>/ops/.
-->

# guild.ops.v1 — frozen contract reference

Shipped frozen contract reference for `guild.ops.v1` (and the conditional
`guild.incident.v1` / `guild.release.v1`). Canonical field source of truth.
Skills bind to this by pointer (anti-respell); where a value is owned by code,
the code path cited here is canonical.

This file consolidates the ops report blocks, the runbook posture table, the 4
safety rails → 5-boolean machine-check, the quality-consume proceed/refuse
predicate, and the `guild.release.v1 ↔ D8` close-gate join that
`skills/guild-operations/SKILL.md` and the five `skills/meta/ops-*/SKILL.md`
runbooks own. Point at a named section below instead of restating the tables
inline.

## guild.ops.v1 fields

The routed playbook writes records under `.guild/runs/<run-id>/ops/`, with
per-step evidence under `.guild/runs/<run-id>/ops/evidence/`.

### guild.ops.v1

Emitted **always**, for every class.

- Report head (class, run linkage) + per-step rows.
- `safety_rails` — the 5-boolean machine-check block (see
  [Safety rails](#safety-rails)).
- Each step records `op_class`; every **hard-set step** shows
  `autonomy: prompted_inline` (rail-3 proof).
- Terminal `outcome.status`.

### guild.incident.v1

Emitted when `class ∈ {incident, rollback}`. Carries the incident record fields
alongside `guild.ops.v1`.

### guild.release.v1

Emitted when `class == release`. Supplies the D8 join fields (see
[D8 close-gate join](#d8-close-gate-join)): `outcome.status`, `doc_sync_status`,
`doc_sync_rationale`, `release_evidence_refs[]`, `quality_ref`, plus the
`recommendation` consumed from Quality and any recorded human `force_pass`.

## Posture

The 5 runbook classes + their default autonomy posture + routing target. The
class→producer map is the same source that drives each runbook's producer; it fills
the **`null` ops producer** in the station composer's `ops` `advisory_panel` (SoT:
`src/modules/teams/workflows/station-composer.ts` `STATION_POLICY.ops.advisory_panel`).

| Class | Default posture | Producer | Routes to |
|---|---|---|---|
| `release` | interactive-by-default (not a hard-interactive class) | `devops-ci-cd-pipeline` (+ `technical-writer-release-notes` advisory) | `guild:ops-release` |
| `monitoring` | interactive-by-default | `devops-observability-setup` | `guild:ops-monitoring` |
| `incident` | **INTERACTIVE always — never autonomous** | `devops-incident-runbook` | `guild:ops-incident` |
| `rollback` | **INTERACTIVE always — never autonomous** | `devops-incident-runbook` | `guild:ops-rollback` |
| `maintenance` | interactive-by-default | `devops-infrastructure-as-code` | `guild:ops-maintenance` |

Split posture rides the interactive-by-default policy + the additive
`autonomy_contract`; runbook approval lowers **only the SOFT gate**, never the
hard set (rail 3). Active specialists stay `≤ producer + challenger` for
`incident` / `rollback` (the composer caps). The G-operations advisory
**challengers** are sourced from the same `ops` `advisory_panel`, resolved by
`composeStationTeam` — not a hardcoded list: `security` (BASELINE — always present) +
`architect` (GATED on the `multi_component` signal; recorded as `chal:ops:architect`).

## Safety rails

The 4 non-negotiable rails are enforced by the **guild:operations router**, for
every class, **before dispatch**. Rail 4 yields TWO booleans, so 4 rails → **5
booleans (NOT 1:1)**; each boolean is the RHS of exactly one rail leg (5→5, 0
unmapped, 0 double-mapped). **All 5 `== true` is the rails-satisfied predicate.**

| # | Rail leg | → `safety_rails` boolean |
|---|---|---|
| 1 | rail1: unproven runbook not autonomous; **first run interactive** | `unproven_runbook_was_interactive` |
| 2 | rail2: **incident + rollback never autonomous** | `incident_rollback_not_autonomous` |
| 3 | rail3: always-ask **hard set unconditional** (even `--auto-approve=all`) | `hard_set_prompted_inline` |
| 4 | rail4: pre-flight **dry-run mandatory** (dry-run-ran leg) | `preflight_dry_run_ran` |
| 5 | rail4 **allowlist-guard leg** | `no_hard_set_in_allowlist` |

**Allowlist reject:** `op_class_allowlist` may **NEVER** contain a hard-set class
(destructive / network / spend) — **plan-validate, exit 2** (one validator, two
callers). The always-ask hard set itself is code-owned:
`scripts/lib/permission-policy-schema.ts` (`ALWAYS_ASK_HARD_SET =
{ release, security, ops, destructive }`; `NEVER_AUTONOMOUS_GATES =
{ ops, destructive }`).

## Ops predicate (quality-consume proceed/refuse)

Read the consumed `guild.quality.v1` recommendation at
`.guild/runs/<run-id>/quality/<run-id>.md`:

- If `release.recommendation == block` **and not `force_pass`**, then `release`
  and `rollback` **REFUSE with route-back** to Quality.
- `monitoring` / `maintenance` / `incident` **may proceed** even on a
  non-force-pass Quality `block` (they are in the router's proceed set).
- Only a recorded **human `force_pass`** (owner named) lets `release` /
  `rollback` proceed past a Quality `block`.

## D8 close-gate join

The `guild.release.v1 ↔ D8` **3-leg join** — the field names are the join
contract (consume-only; not a re-spelled body):

| Leg | Reads (release.v1) |
|---|---|
| Release readiness | `release.outcome.status == completed` |
| Documentation sync | `release.doc_sync_status` (`synced` **OR** `not_required` + `doc_sync_rationale`) |
| Evidence trail | `release.release_evidence_refs[]` + `release.quality_ref` |

**Supply-only:** Operations SUPPLIES evidence; **`InitiativeCloseout` owns
closure.** The **[v2]/[v2.x] split:** the D8 contract is frozen `[v2]`, its
automation `[v2.x]` — the ops phase supplies the **contract join only**, no
automation task (DH-2 / GR-7). **No cloud-build task** (GR-7).

**Code source of truth for the docs-reconciled close criterion:**
`src/modules/initiatives/workflows/initiative-workitems.ts` (thin re-export shim
`scripts/lib/initiative-workitems.ts`), `populateReleaseDocsWorkItems` — the
auto-populated D8 work items carry the acceptance criteria, including
`docs/v2 design set reconciled in the same rollout (or 'docs/v2: n/a <reason>'
recorded …)` on the docs leg and `release_status = released (or a documented
rollback stance recorded as release_evidence_refs)` on the release leg. The
workspace-level statement of this gate lives in the umbrella `AGENTS.md` ("the
docs leg of the D8 initiative close gate").
