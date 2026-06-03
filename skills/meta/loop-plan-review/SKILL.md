---
name: guild-loop-plan-review
description: F-2 adversarial plan-defect review driver — wraps `guild:plan`, runs an architect↔security loop where security raises plan-defect questions ONLY (security holes, scope creep, autonomy gaps, contract drift, untestable criteria) and signals satisfaction with the literal sentinel `## NO MORE QUESTIONS`; architect dismissals never terminate the loop. Activates only when `--loops` is `plan` or `all`; runs AFTER `guild:plan` writes the plan and BEFORE the Gate-3 user-approval. TRIGGER on "review the plan", "L2 loop", "security plan-review", "kick off the plan adversarial loop", "audit the plan for defects before approval", "run the plan loop". DO NOT TRIGGER for pre-spec clarification (`guild:loop-clarify` owns L1), implementation-phase loops (`guild:loop-implement` owns L3/L4/security-review), code-style review (out of scope), or any run where `--loops=none` (default — loops off).
when_to_use: Third step of the `/guild` lifecycle when `--loops=plan` or `--loops=all` is active. Fires after `guild:plan` writes `.guild/plan/<slug>.md` (with `approved: false`) and BEFORE the user-approval gate. Security signals termination with `## NO MORE QUESTIONS` on its own line + a clean post-sentinel region.
type: meta
---

# guild:loop-plan-review

Implements `../benchmark/plans/adr-009-v1.4-adversarial-loops-and-plugin-restructure.md` §SC2 (F-2) and the binding
contract `../benchmark/plans/v1.4-loop-skill-contracts.md` §"Skill 2".

This skill **wraps** `guild:plan`; it does not replace it. The loop runs AFTER
`guild:plan` writes the plan and BEFORE Gate 3 (user-approval). Security's job is
to surface plan-defect questions — NOT general code-style suggestions.

## What you do

Drive a fixed-cap, sentinel-terminated dialog between **architect** (writer) and
**security** (challenger). Each round the architect emits a plan or revised plan
(with optional "dismissed because X" rationales); security emits a critique
containing either more plan-defect questions OR the literal sentinel
`## NO MORE QUESTIONS` on its own line. The loop continues until security signals
satisfaction with a clean post-sentinel region, the cap is reached, or two
consecutive malformed terminations escalate.

Architect's "dismissed because X" markings do NOT terminate the loop. Security
must independently emit the sentinel for clean termination.

## Input shape

`LoopPlanReviewInput` — `plan_path`, `spec_path`, `loops_mode` (`plan|all`),
`cap` (default 16), `run_id`. Full TypeScript type → **`io-contract.md`**.

## Output shape

`LoopPlanReviewOutput` — `status` (`satisfied|cap_hit|escalated|rework`),
`rounds`, `architect_handoffs`, `security_handoffs`, `dismissed_questions[]`
(question + rationale; audit trail preserved on clean termination too),
`unresolved_questions`, `next`. Full type → **`io-contract.md`**.

## Termination contract — verbatim from the binding contract

Security terminates by emitting `## NO MORE QUESTIONS` as a standalone line,
exactly once, with no inline/bullet decoration. The driver then runs the three
post-sentinel regex patterns against the substring AFTER the sentinel; any match
→ `malformed_termination` + one extra round.

When a round emission is consumed as a receipt, the embedded ```` ```guild.handoff.v2 ```` JSON block is the machine truth a consumer reads; the `guild.handoff_receipt.v1` YAML frontmatter is human-review context only (`docs/knowledge/decisions/communication-format-policy.md §"Handoff contract"`). A frontmatter-only receipt with no embedded v2 block is not a valid machine receipt.

The removed
`/concern|issue|gap|missing|undefined/i` keyword set must NOT be re-introduced.
Patterns → **`loop-mechanics.md`**.

## Workflow

(1) Initialize from the orchestrator (L2 cap counter is `counters.json` key
`L2`). (2) Per round: increment `L2`, emit `loop_round_start`, dispatch architect
then security (plan-defect questions only), `detectSentinel`, emit
`loop_round_end`. (3) Decide clean/malformed/continue/cap-hit. (4) Escalate via
`AskUserQuestion`. Full steps with the `emit-loop-event.ts` invocations →
**`loop-mechanics.md`**.

## Plan-defect filter (security scope)

Security in this loop raises **plan-defect questions only**:

- Security holes — auth gaps, secrets handling, missing audit trails, threat-model omissions.
- Scope creep — lanes whose `scope:` overlaps another specialist's lane.
- Autonomy-policy gaps — missing `requires confirmation:` on a destructive operation.
- Contract drift — lane success criteria that don't match the spec's success criteria.
- Untestable success criteria — vibes-based bullets ("feels better"); each criterion must be measurable.

Security MUST NOT raise general code-style suggestions. Test pin: a
code-style-only review terminates with `## NO MORE QUESTIONS` in round 1.

## Cap-hit escalation copy — exact literals

The orchestrator dispatches `AskUserQuestion` (`header: "Loop escalation"`,
`multiSelect: false`) with three verbatim-labelled options: `force-pass` /
`extend-cap` / `rework`. Exact label strings + `buildEscalationPayload` /
`buildExtendCapPayload` → **`loop-mechanics.md`**.

## Backwards-compat fallback

When `AskUserQuestion` is unavailable, fall back to the v1.3 free-text stdin path
(stderr options → read line → match the three labels → log `escalation.user_choice`).
Full steps → **`loop-mechanics.md`**.

## Per-lane counter

L2 has **one cap counter** for the whole plan phase (`counters.json` key `L2`),
reset on `status="satisfied"`. Restart semantics are NOT applicable to L2 —
restart is L3/L4/security-only (see `guild:loop-implement`). Detail →
**`loop-mechanics.md`**.

## JSONL events emitted

`loop_round_start`, `loop_round_end`, `escalation` (`options_offered` ALWAYS
`["force-pass", "extend-cap", "rework"]`), `assumption_logged` (on `force-pass`).
Appender from T3c's `log-jsonl.ts`. Schema reference → **`loop-mechanics.md`**.

## Output contract — handoff and follow-on

On `status="satisfied"` (or force-pass-as-satisfied): write the
`loop-plan-review-summary.md` manifest, append force-pass unresolved questions to
`assumptions.md`, hand control back to Gate 3. On `rework`: return to
`guild:plan` for revision (orchestrator reroutes). Full steps → **`io-contract.md`**.

## Anti-patterns

- Treating architect's "dismissed because X" as a termination signal — the loop
  only terminates when security independently emits the sentinel.
- Letting security raise code-style suggestions — the plan-defect filter is a
  hard contract.
- Re-introducing the removed `/concern|issue|gap|missing|undefined/i` keyword set.
- Skipping Gate 3 after `force-pass` — force-pass is force-pass-AS-satisfied; the
  user-approval gate still runs immediately after.
- Missing `dismissed_questions[]` in the receipt — the audit trail must preserve
  dismissals + rationales even on clean termination.

## Handoff receipt

Per `guild-plan.md §8.2`: `loop_id`, `lane_id: phase:plan`, `rounds`, `status`,
`next`, and `evidence:` (round handoffs + manifest + JSONL path + dismissed
questions). Full field list → **`io-contract.md`**.
