---
name: guild-loop-implement
description: F-3 implementation-phase adversarial-loop dispatcher — wraps `guild:execute-plan` per lane. Runs three nested layers: L3 dev↔tester (`qa-property-based-tests` challenges), L4 owner↔QA (full QA strategy challenges), security-review owner↔security (restart-from-security on a high+unaddressed finding; restart cap 3, per-lane counter isolation). Activates only when `--loops` is `implementation` or `all`; the lane's `loops_applicable` field (`none|l3-only|l4-only|both|full`) selects which layers run. TRIGGER on "run the lane loops", "L3 loop", "L4 loop", "security review for the lane", "implementation-phase adversarial loop", "kick off the dev↔tester / dev↔qa / dev↔security loop". DO NOT TRIGGER for pre-spec clarification (`guild:loop-clarify` owns L1), plan-defect review (`guild:loop-plan-review` owns L2), broader code review outside the lane scope, direct test authoring (qa owns), or any run whose resolved `loops` exclude `implementation` (the default `--rigor=standard` expands to `spec,plan` — the implementation layers run only under `--rigor=deep` / an explicit `--loops=implementation|all`).
when_to_use: Fifth step of the `/guild` lifecycle when `--loops=implementation` or `--loops=all` is active. Fires per-lane during `guild:execute-plan` AFTER the lane's primary writer completes its first pass. Tester / QA / security signal termination with `## NO MORE QUESTIONS` on its own line + a clean post-sentinel region. Restart fires on security findings with `severity: high` AND `addressed_by_owner: false`.
type: meta
---

# guild:loop-implement

Implements `../benchmark/plans/adr-009-v1.4-adversarial-loops-and-plugin-restructure.md` §SC3 (F-3) and the binding
contract `../benchmark/plans/v1.4-loop-skill-contracts.md` §"Skill 3".

This skill **layers atop** `guild:execute-plan` per lane; it does not replace it.
The lane's owning specialist (backend / frontend / mobile / devops / qa) is the
**writer**; the challenger varies per layer.

## What you do

For each lane that activates F-3 via its `loops_applicable` field, run nested
adversarial loops between the lane's owner (writer) and a layer-specific
challenger:

- **L3** dev↔tester — `qa-property-based-tests` challenges (property coverage).
- **L4** owner↔QA — `qa` (full strategy) challenges (suite shape, coverage,
  flaky-hunter).
- **security-review** owner↔security — `security` challenges. On a finding with
  `severity: high` AND `addressed_by_owner: false`, the loop **restarts** from L3.

Each layer is a fixed-cap, sentinel-terminated dialog identical in shape to L1/L2
(same `## NO MORE QUESTIONS` sentinel + post-sentinel regex set); the differences
are per-lane counter isolation and the security-restart machinery.

## `loops_applicable` enum — five valid values

The plan-block `loops_applicable` field selects which layers run. Plan-validate
accepts ONLY `none, l3-only, l4-only, both, full` (fixed order); any other value
is rejected with exit 2. Defaults per lane type, the layer-set table, and the
4-case security-owned-lane decision tree → **`loops-applicable-enum.md`**.

## Input shape

`LoopImplementInput` — `lane_id`, `owner`, `loops_applicable`, `loops_mode`,
`cap` (16), `restart_cap` (3), `run_id`, `task_id`, plus restart-only
`prior_receipts?` / `security_findings?`. Full type → **`io-contract.md`**.

When a receipt is consumed (here, the restart-only `prior_receipts?` / `security_findings?` inputs), the embedded ```` ```guild.handoff.v2 ```` JSON block is the machine truth a consumer reads; the `guild.handoff_receipt.v1` YAML frontmatter is human-review context only (`docs/knowledge/decisions/communication-format-policy.md §"Handoff contract"`). A frontmatter-only receipt with no embedded v2 block is not a valid machine receipt.

## Output shape

`LoopImplementOutput` — `status` (`satisfied|cap_hit|escalated|rework|restart_cap_hit`),
`layers_run`, `rounds_per_layer`, `restart_count` (max 3), `superseded_receipts`,
`unresolved_questions`, `assumptions`, `next`. Full type → **`io-contract.md`**.

## Termination contract per layer — verbatim from the binding contract

Each active layer terminates independently when its challenger emits
`## NO MORE QUESTIONS` on its own line with a clean post-sentinel region. The
three post-sentinel regex patterns are identical to L1/L2; any match →
`malformed_termination` + one extra round. Patterns + per-layer specifics →
**`security-review-restart.md`**.

## Restart-from-security — machine-checkable trigger

Security's terminating receipt MAY carry a findings section
(`## Findings|Open issues|Blockers`) of YAML bullets. **Restart fires iff ANY
single finding has `severity: high` AND `addressed_by_owner: false`.** Lower or
already-addressed findings are logged (`assumption_logged`), not restarted;
malformed bullets are no-restart. Findings format, regex, test pins, and the
6-step on-restart machinery → **`security-review-restart.md`**.

When this terminating receipt is consumed, the embedded ```` ```guild.handoff.v2 ```` JSON block is the machine truth a consumer reads; the `guild.handoff_receipt.v1` YAML frontmatter is human-review context only (`docs/knowledge/decisions/communication-format-policy.md §"Handoff contract"`). A frontmatter-only receipt with no embedded v2 block is not a valid machine receipt.

## Restart cap = 3

Restart cap default is **`cap = 3`** per lane per task (plan-level per-lane
override only; no global env var). The 4th restart attempt escalates with the
3-option choice. Per-option behavior → **`security-review-restart.md`**.

## Per-lane counters — isolation contract

Counters are keyed by `lane_id` in `counters.json` (`L3:<lane>`, `L4:<lane>`,
`security:<lane>`, `restart:<lane>`). Lane A's modifications NEVER touch lane B's
keys; tests pin parallel-lane non-interference. Example →
**`counters-and-concurrency.md`**.

## `counters.json` concurrency

Concurrent lane updates serialize via atomic-rename + the stable lockfile sidecar
(ADR-009) with optimistic-retry and crash-resume cleanup. Call `incrementCounter`
/ `resetLaneCounters` / `readCounters` from `counter-store.ts`; never reimplement
it. Full protocol → **`counters-and-concurrency.md`**.

## Workflow

For each lane with `loops_applicable ≠ "none"`: (1) resolve the layer set via
`activeLayersFor(...)`; (2) per layer, per round — emit `loop_round_start`,
dispatch owner + challenger, `detectSentinel(...)`, emit `loop_round_end`, decide
clean/malformed/continue/cap-hit; (3) after security-review, parse findings and
restart-or-log; (4) return `LoopImplementOutput`. Full steps + the
`emit-loop-event.ts` calls → **`workflow-and-events.md`**.

## Cap-hit / restart-cap-hit escalation copy — exact literals

Escalations fire at five sites (L3 / L4 / security-review cap-hit, two
consecutive malformed-terminations, restart-cap-hit). Each dispatches
`AskUserQuestion` (`header: "Loop escalation"`, `multiSelect: false`) with three
verbatim-labelled options: `force-pass` / `extend-cap` / `rework`. Exact labels +
`buildEscalationPayload` → **`workflow-and-events.md`**.

## Backwards-compat fallback

When `AskUserQuestion` is unavailable, fall back to the v1.3 free-text stdin path
(stderr options → read line → match the three labels → log `escalation.user_choice`).
Full steps → **`workflow-and-events.md`**.

## JSONL events emitted

`loop_round_start`, `loop_round_end`, `escalation` (`options_offered` ALWAYS
`["force-pass", "extend-cap", "rework"]`), `assumption_logged`. Appender from
T3c's `log-jsonl.ts`. Schema reference → **`workflow-and-events.md`**.

## Anti-patterns

- Re-implementing counter persistence — `counter-store.ts` is the single source
  of truth.
- Treating `BLOCKING:` as a restart trigger — the parser keys on the
  `## Findings|Open issues|Blockers` heading + `severity: high` +
  `addressed_by_owner: false`.
- Resetting `restart:<lane>` on `resetLaneCounters` — T3a preserves it; re-resetting
  breaks the cap-3 invariant.
- Self-review on security-owned lanes — never set `loops_applicable: full` on a
  security lane without rerouting security-review (the 4-case tree prevents it).
- Failing to move prior receipts on restart — `superseded_by:` is the audit trail.
- Cross-lane counter contamination — `resetLaneCounters` only touches
  `L3:<lane>`, `L4:<lane>`, `security:<lane>`.

## Handoff receipt

Per `guild-plan.md §8.2`: `loop_id`, `lane_id`, `loops_applicable`, `layers_run`,
`rounds_per_layer`, `restart_count`, `superseded_receipts`, `status`, `next`, and
`evidence:`. Full field list → **`io-contract.md`**.
