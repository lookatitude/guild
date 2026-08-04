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
  DH-3 BOUNDARY (static, read-only; never runtime-written — per-run records go
  to .guild/runs/<run-id>/ops/). CONTRACT FIDELITY: every ops/incident/release
  reference is a POINTER (./operations-contract.md §"guild.ops.v1 fields");
  autonomy_contract / task_run pointer-cited (./operations-contract.md §Posture / §"Safety rails"); P5 boundary
  cited via P1-ownership-001 (not the guard impl); zero field text reproduced.
  ROUTER: per-class playbooks live in the sibling ops-* skills; this body owns
  the cross-class taxonomy, safety rails, ExecuteRunbook, and the D8 join, and
  routes [runbook] to guild:ops-<class>. Heading set per SKILL.template.md.
-->

# guild:operations

Realizes **DI-3 (full Operations skill)** (`decisions/di1-di6-contracts.md`)
against the frozen **`guild.ops.v1`** / **`guild.incident.v1`** /
**`guild.release.v1`** (`./operations-contract.md §"guild.ops.v1 fields"`). Verb
**`ops`** (never `ship`); gate **`G-operations`**. **No cloud-build (GR-7).**
The **router**: selects the class, enforces the cross-class rails, then
**dispatches the per-class playbook** `guild:ops-<class>`.

# When to use it

At the operations phase: select a runbook class, enforce the 4 safety rails +
mandatory pre-flight, route to the matching `ops-*` playbook, and supply the D8
close-gate evidence join (consume-only).

# When not to use it

- Quality / release-readiness → `guild:quality`.
- Authoring a runbook's content → `devops-*` specialists.
- Closing the initiative → `InitiativeCloseout` (Operations only **supplies**
  evidence).
- A specific class's playbook detail → the sibling `guild:ops-<class>` skill.

# Required inputs

- The runbook (positional `[runbook]`, else surfaced detection — always
  confirmed).
- The wiki trust root `.guild/wiki/standards/runbooks/<name>.md` (promoted via
  `guild:decisions`; kept under `.guild/` by the **P5 boundary CONTRACT** —
  cited via `P1-ownership-001`, never the guard implementation).
- The additive `autonomy_contract` (`./operations-contract.md §Posture`,
  pointer); frozen ops/incident/release
  (`./operations-contract.md §"guild.ops.v1 fields"`); the consumed `guild.quality.v1`.

# Output format

The routed playbook writes `guild.ops.v1` **always**; `guild.incident.v1` when
`class ∈ {incident, rollback}`; `guild.release.v1` when `class == release` — all
**by pointer** to `./operations-contract.md §"guild.ops.v1 fields"`. Per-step evidence under
`.guild/runs/<run-id>/ops/evidence/`.

# Workflow steps

## taxonomy + routing

The **5 classes + default autonomy posture**, EXACTLY per
`./operations-contract.md §Posture` (cited; not re-derived), and the
**routing target** for each. **ClassSelect** from the `[runbook]` positional
else surfaced detection — **always confirmed** — then dispatch the matching
`ops-*` skill; populate `guild.ops.v1` head by pointer to `./operations-contract.md §"guild.ops.v1 fields"`:

| Class | Default posture (`§Posture`) | Routes to |
|---|---|---|
| `release` | per `§Posture` default | `guild:ops-release` |
| `monitoring` | per `§Posture` default | `guild:ops-monitoring` |
| `incident` | **INTERACTIVE always — never autonomous** | `guild:ops-incident` |
| `rollback` | **INTERACTIVE always — never autonomous** | `guild:ops-rollback` |
| `maintenance` | per `§Posture` default | `guild:ops-maintenance` |

**Split posture** rides the interactive-by-default policy + the additive
`autonomy_contract` (by pointer to `./operations-contract.md §Posture`);
runbook approval lowers **only the SOFT gate**.

## safety-rails (router-enforced, never delegated)

The 4 rails (VERBATIM-BY-POINTER to `./operations-contract.md §"Safety rails"`;
pre-flight + wiki trust root covered there) are enforced **here**, for every
class, **before dispatch** — and decompose into the machine-checkable
`guild.ops.v1.safety_rails` 5-boolean block (**pointer to `./operations-contract.md §"Safety rails"`**). Rail 4
(mandatory pre-flight) yields **TWO** booleans — a dry-run-ran leg and an
allowlist-guard leg — so 4 rails → **5 booleans, NOT 1:1**:

| # | Rail leg | → `safety_rails` boolean (`§"Safety rails"`, by pointer) |
|---|---|---|
| 1 | rail1: unproven runbook not autonomous; **first run interactive** | `unproven_runbook_was_interactive` |
| 2 | rail2: **incident + rollback never autonomous** | `incident_rollback_not_autonomous` |
| 3 | rail3: always-ask **hard set unconditional** (even `--auto-approve=all`) | `hard_set_prompted_inline` |
| 4 | rail4: pre-flight **dry-run mandatory** (dry-run-ran leg) | `preflight_dry_run_ran` |
| 5 | rail4 **allowlist-guard leg** | `no_hard_set_in_allowlist` |

Each `§"Safety rails"` boolean is the RHS of **exactly one** rail leg (5→5, **0 unmapped,
0 double-mapped**); **all 5 `== true` is the rails-satisfied predicate.**
**Allowlist reject:** `op_class_allowlist` may **NEVER** contain a hard-set
class (destructive / network / spend) — **plan-validate, exit 2** (one
validator, two callers).

## execute (ExecuteRunbook shell)

0. **Ops team gate (HOLD — precedes every dispatch).** The ops phase's
   participants — the CLASS-driven producer, the composer-derived advisory-panel
   challengers, and the `reviewer_cross_host` broker slot — are composed and
   user-approved BEFORE step 1 (`team-compose SKILL.md §"Team decision gate"`:
   every phase that can dispatch): run the per-phase composition pass
   (`guild:team-compose` with `phase=ops`, an immutable `guild.team_proposal.v2`)
   or consume an already-approved **current** ops-phase decision, then **HOLD**
   every dispatch until a current `guild.team_decision.v1` `approve` exists whose
   `proposal_hash` equals the hash RECOMPUTED from the proposal artifact —
   stale, hash-mismatched, or absent decisions **fail closed**; no participant
   (producer, panel member, broker reviewer) dispatches ahead of this gate. The
   per-dispatch hash checks in step 2 re-verify it, never replace it. The routed
   `ops-*` playbooks **inherit this gate through the router**: they are
   dispatched BY step 1 only after the gate clears and dispatch no participant
   outside the approved set — incident/rollback urgency shapes
   `guild.team_schedule.v1` waves only, never membership and never an early
   escape from the hold.
1. **Dispatch** the confirmed class to `guild:ops-<class>`; the playbook names
   its producer (per `./operations-contract.md §Posture`) and emits the
   outputs.
2. **G-operations review — two distinct, both-kept mechanisms**
   (https://guildstack.dev/docs/adversarial-review):
   - **In-phase advisory panel.** Challengers sourced from the station composer's
     **`ops` station `advisory_panel`** (SoT: `src/modules/teams/workflows/station-composer.ts`
     `STATION_POLICY.ops.advisory_panel`, resolved by `composeStationTeam`) — not a
     hardcoded `[security, …]` list: `security` (BASELINE — always present) + `architect`
     (GATED on the `multi_component` signal; recorded as `chal:ops:architect`). Producer
     stays **CLASS-driven** (the `§Posture` class→producer map fills the composer's `null`
     ops producer). Cross-model-preferred. Panel membership is proposed in the phase's
     `guild.team_proposal.v2` and user-approved at the `guild.team_decision.v1` gate
     (advisory labels never bypass it) — and at panel dispatch, verify a **current**
     `approve` decision whose hash matches the RECOMPUTED proposal hash covers each
     member (stale/mismatched decisions fail closed). Urgency shapes
     `guild.team_schedule.v1` concurrency waves only — incident/rollback run producer +
     challenger concurrently and schedule the rest in later waves, never dropping
     approved participants. Same-session review; non-blocking.
   - **Cross-host G-operations gate via the broker (policy-gated).** *Separate*
     from the panel: a **different host family** critiques the ops record /
     runbook. The reviewer slot is an ops-phase participant
     (`participation_kind: reviewer_cross_host`): before dispatching the broker,
     confirm a current `guild.team_decision.v1` `approve` whose hash matches the
     recomputed proposal hash covers it — stale/mismatched decisions fail closed
     (a `skipped` outcome dispatches nothing). After the playbook emits its outputs and before done-criteria,
     invoke `guild-review-broker`:

     ```
     Skill: guild-review-broker
     args: gate=G-operations artifact_path=<ops-record-or-runbook-path> run_id=<run-id> author_host=<run author host>
     ```

     Policy-gated (https://guildstack.dev/docs/adversarial-review): fires only on `risk ≥ high`
     / `review: cross` / `--review=cross` / config — else `status: "skipped"`
     and the boundary passes (self-build = always-on). On `"rework"`, resolve
     before done-criteria. The broker gate is the cross-host layer; it does
     **not** replace the advisory panel and does **not** touch the 4 safety
     rails or the split autonomy posture — incident/rollback stay never-autonomous.
3. **Done-criteria.** Terminal `outcome.status`; every hard-set step
   `autonomy: prompted_inline` (rail 3); `guild.ops.v1` (+ conditional
   incident/release) validates by pointer to `./operations-contract.md §"guild.ops.v1 fields"`.

## d8-join (consume-only)

The **`guild.release.v1 ↔ D8` 3-leg join** — CITED by pointer to
`./operations-contract.md §"D8 close-gate join"` (field names as the join contract, not a
re-spelled body):

| Leg | Reads (release.v1, `§"D8 close-gate join"` by pointer) |
|---|---|
| Release readiness | `release.outcome.status == completed` |
| Documentation sync | `release.doc_sync_status` (`synced` **OR** `not_required` + `doc_sync_rationale`) |
| Evidence trail | `release.release_evidence_refs[]` + `release.quality_ref` |

**Supply-only:** Operations SUPPLIES evidence; **`InitiativeCloseout` owns
closure** (unchanged). **Quality-consume refuse/proceed:** read
`quality/<run-id>.md`; if `release.recommendation == block` **and not
`force_pass`**, `release` / `rollback` **REFUSE with route-back**; `monitoring` /
`maintenance` / `incident` may proceed. **[v2]/[v2.x] split:** the D8 contract is
frozen `[v2]`, its automation `[v2.x]` — P6 = **contract join only**, no
automation task (DH-2 / GR-7).

## learning-checkpoint (step 7.5 — advisory, no new gate)

After done-criteria + the d8-join and before phase close, fire the per-phase LearningCheckpoint with `phase=operations` and the ops record / runbook as `evidence_ref`. Invoke `guild:learning-checkpoint` to classify the already-written ops record (`guild.ops.v1`, conditional incident/release evidence) into the 12-target verdict, then emit via the hook — full call signature + `GUILD_PHASE` mapping canonical in `skills/meta/learning-checkpoint/SKILL.md §"How a phase skill fires the checkpoint"` (do not re-spell). It rides this existing boundary, defaults to all-`none` (a near-zero-token no-op), asks no new prompt, and adds no new gate; it does NOT touch the 4 safety rails or the split autonomy posture. Non-`none` verdicts route only to `.guild/reflections/<run-id>.md`.

# Evidence requirements

- `taxonomy+routing`: 5-class posture table (incident/rollback never autonomous)
  + the class→`ops-*` routing column.
- `safety-rails`: the 5-row rail-leg→boolean enumeration (each `§"Safety rails"` boolean
  named once) + the 4↔5 reconciliation; allowlist exit-2.
- `execute`: the step-0 ops team gate (current, recomputed-hash-matching
  `approve`) cleared BEFORE the step-1 dispatch; dispatch to `ops-<class>`;
  per-step `op_class`; hard-set step `prompted_inline`.
- `d8-join`: pointer-cited 3-leg table; refuse-on-non-force-pass-block rule;
  InitiativeCloseout sole closer; no automation task.

# Escalation rules

- `incident` / `rollback` are **never autonomous** (rail 2), regardless of
  approval or `--auto-approve`.
- A non-force-pass Quality `block` makes `release`/`rollback` **refuse with
  route-back**; only a recorded human `force_pass` proceeds.
- `op_class_allowlist` with a hard-set class **hard-fails plan-validate (exit
  2)** — no proceed path.

# Safety constraints

- All 4 rails are **pointer-cited verbatim** (`./operations-contract.md §"Safety rails"`) and **router-enforced
  before dispatch**; none relaxed under approval — approval lowers only the SOFT
  gate, never the hard set (rail 3), unconditional even inside an approved
  autonomous runbook.
- No frozen ops/incident/release/`autonomy_contract` field text reproduced — all
  by pointer through `./operations-contract.md`. **No cloud-build task** (GR-7;
  `guild.cloud_task_packet.v1` is `[v2-contract-only]`, https://guildstack.dev/docs/architecture).

# Eval cases

1. **`release`, Quality RELEASE-READY** → routes to `ops-release`; supplies the
   3-leg D8 evidence; `InitiativeCloseout` closes.
2. **`release`, Quality `block`, no force_pass** → **REFUSE with route-back**.
3. **`incident` under `--auto-approve=all`** → routes to `ops-incident`, still
   **interactive** (rail 2); hard-set steps `prompted_inline` (rail 3).
4. **Unproven runbook, first run** → **interactive** (rail 1);
   `unproven_runbook_was_interactive == true`.
5. **`op_class_allowlist` includes a destructive class** → plan-validate **exit
   2**; `no_hard_set_in_allowlist == false`.
6. **All 5 `safety_rails` booleans true** → rails-satisfied; router dispatches
   under the class's posture.
