---
name: guild-loop-clarify
description: F-1 adversarial pre-spec clarification driver — wraps `guild:brainstorm`, runs an architect↔researcher loop where the architect proposes scope and the researcher fact-checks, surfaces gaps, and either signals satisfaction with the literal sentinel `## NO MORE QUESTIONS` or returns more questions. Activates only when `--loops` is `spec` or `all`. TRIGGER on "run the brainstorm loop", "L1 loop", "kick off the spec adversarial loop", "researcher review the brief", "fact-check this brief before we write the spec", or any `/guild` invocation under `--loops=spec` / `--loops=all` once `guild:brainstorm` is queued. The loop runs BEFORE `guild:brainstorm` writes the spec; researcher's findings feed brainstorm's "Assumptions" section. DO NOT TRIGGER for plan-defect review (`guild:loop-plan-review` owns L2), implementation-phase loops (`guild:loop-implement` owns L3/L4/security-review), direct spec writing (`guild:brainstorm`), or any run where `--loops=none` (the contract's default — loops are off).
when_to_use: First step inside the `/guild` lifecycle when `--loops=spec` or `--loops=all` is active. Fires after the user submits a brief and before `guild:brainstorm` produces `.guild/spec/<slug>.md`. Researcher signals termination with `## NO MORE QUESTIONS` on its own line and a clean post-sentinel region.
type: meta
---

# guild:loop-clarify

Implements `.guild/spec/v1.4.0-adversarial-loops.md` SC1 (F-1) and the binding
contract `guild-benchmark/plans/v1.4-loop-skill-contracts.md` §"Skill 1".

This skill **wraps** `guild:brainstorm`; it does not replace it. The loop runs
BEFORE `guild:brainstorm` writes the spec. Researcher fact-checking runs
alongside the architect's scope proposal so blocking unknowns are surfaced and
explicitly converted to assumptions before the spec is committed.

## What you do

Drive a fixed-cap, sentinel-terminated dialog between **architect** (writer) and
**researcher** (challenger). Each round the architect emits a brief or revised
brief; the researcher emits a critique containing either more questions OR the
literal sentinel `## NO MORE QUESTIONS` on its own line. The loop continues until
the researcher signals satisfaction with a clean post-sentinel region, the cap is
reached, or two consecutive malformed terminations escalate.

The driver is a pure state machine — it does not synthesise content. Architect
and researcher are dispatched as Agent-tool subagents with their own context
bundles per `guild-plan.md §9.3`; this skill only owns the round-counter, the
sentinel detector, and the escalation gate.

## Input shape

`LoopClarifyInput` — `brief` (verbatim), `loops_mode` (`spec|all`), `cap`
(default 16, ≤ 256), `run_id`. Full TypeScript type → **`io-contract.md`**.

## Output shape

`LoopClarifyOutput` — `status` (`satisfied|cap_hit|escalated|rework`), `rounds`,
`architect_handoffs`, `researcher_handoffs` (last carries the sentinel on
success), `unresolved_questions`, `assumptions` (fed to the spec's Assumptions
section), `next` (`guild:brainstorm|abort`). Full type → **`io-contract.md`**.

## Termination contract — verbatim from the binding contract

Researcher terminates by emitting `## NO MORE QUESTIONS` as a standalone line,
exactly once, with no inline/bullet decoration. The driver then runs the three
post-sentinel regex patterns against the substring AFTER the sentinel; any match
→ `malformed_termination` + one extra round. The removed
`/concern|issue|gap|missing|undefined/i` keyword set (Codex round-2 regression —
false-positived on "no concerns remain") must NOT be re-introduced. Patterns →
**`loop-mechanics.md`**.

## Workflow

(1) Initialize from the orchestrator (L1 cap counter is `counters.json` key `L1`,
no lane suffix). (2) Per round: increment `L1`, emit `loop_round_start`, dispatch
architect then researcher, `detectSentinel`, emit `loop_round_end`. (3) Decide
clean/malformed/continue/cap-hit. (4) Escalate via `AskUserQuestion`. Full steps
with the `emit-loop-event.ts` invocations → **`loop-mechanics.md`**.

## Cap-hit escalation copy — exact literals

The orchestrator dispatches `AskUserQuestion` (`header: "Loop escalation"`,
`multiSelect: false`) with three verbatim-labelled options: `force-pass` /
`extend-cap` / `rework`. Exact label strings + `buildEscalationPayload` /
`buildExtendCapPayload` → **`loop-mechanics.md`**.

## Backwards-compat fallback

When the host runtime does NOT support `AskUserQuestion` (older Claude Code;
non-interactive `claude --print`), fall back to the v1.3 free-text stdin path
(stderr options → read line → match the three labels → log `escalation.user_choice`).
`formatFallbackPrompt(...)` / `parseFallbackChoice(...)` provide prompt + parser.
Full steps → **`loop-mechanics.md`**.

## Per-lane counter

L1 has **one cap counter** for the whole brainstorm phase (`counters.json` key
`L1`), reset on `status="satisfied"`. Restart semantics are NOT applicable to L1
— restart is L3/L4/security-only (see `guild:loop-implement`); L1 cap-hit
escalates directly via the 3-option choice. Detail → **`loop-mechanics.md`**.

## JSONL events emitted

`loop_round_start`, `loop_round_end`, `escalation` (`reason ∈ {"cap_hit",
"malformed_termination_x2"}`; `options_offered` ALWAYS
`["force-pass", "extend-cap", "rework"]`), `assumption_logged` (one per
unresolved question on `force-pass`). Appender from T3c's `log-jsonl.ts`
(`loop-jsonl-stub.ts` until T3c lands). Schema reference → **`loop-mechanics.md`**.

## Output contract — handoff and follow-on

On `status="satisfied"` (or force-pass-as-satisfied): write the
`loop-clarify-summary.md` manifest, append recorded assumptions to
`assumptions.md`, hand off to `guild:brainstorm` with the last brief +
researcher's residual notes. On `rework`: return control to the user; do not
invoke `guild:brainstorm`. Full steps → **`io-contract.md`**.

## Anti-patterns

- Synthesising the researcher's response from training-data priors — the
  challenger MUST be a separate dispatch with its own bundle, or the loop is a
  self-review and the adversarial contract is broken.
- Re-introducing the removed `/concern|issue|gap|missing|undefined/i` keyword set
  (Codex-pinned regression — false positives on "no concerns remain").
- Treating the sentinel as case-insensitive or accepting bullet-decorated
  variants — the contract is exact: trimmed line equals `## NO MORE QUESTIONS`.
- Skipping the JSONL event emit on cap-hit — the verify-done harness reads
  `escalation` events to confirm `options_offered` is the canonical 3-label list.
- Continuing the loop after `rework` — a `rework` choice ends the loop;
  orchestrator routes to user-decision.

## Handoff receipt

Per `guild-plan.md §8.2`: `loop_id`, `lane_id: phase:brainstorm`, `rounds`,
`status`, `next`, and `evidence:` (round handoffs + manifest + JSONL path). Full
field list → **`io-contract.md`**.
