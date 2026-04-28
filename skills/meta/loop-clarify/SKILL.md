---
name: guild-loop-clarify
description: F-1 adversarial pre-spec clarification driver — wraps `guild:brainstorm`, runs an architect↔researcher loop where the architect proposes scope and the researcher fact-checks, surfaces gaps, and either signals satisfaction with the literal sentinel `## NO MORE QUESTIONS` or returns more questions. Activates only when `--loops` is `spec` or `all`. TRIGGER on "run the brainstorm loop", "L1 loop", "kick off the spec adversarial loop", "researcher review the brief", "fact-check this brief before we write the spec", or any `/guild` invocation under `--loops=spec` / `--loops=all` once `guild:brainstorm` is queued. The loop runs BEFORE `guild:brainstorm` writes the spec; researcher's findings feed brainstorm's "Assumptions" section. DO NOT TRIGGER for plan-defect review (`guild:loop-plan-review` owns L2), implementation-phase loops (`guild:loop-implement` owns L3/L4/security-review), direct spec writing (`guild:brainstorm`), or any run where `--loops=none` (the contract's default — loops are off).
when_to_use: First step inside the `/guild` lifecycle when `--loops=spec` or `--loops=all` is active. Fires after the user submits a brief and before `guild:brainstorm` produces `.guild/spec/<slug>.md`. Researcher signals termination with `## NO MORE QUESTIONS` on its own line and a clean post-sentinel region.
type: meta
---

# guild:loop-clarify

Implements `.guild/spec/v1.4.0-adversarial-loops.md` SC1 (F-1) and the binding contract at `benchmark/plans/v1.4-loop-skill-contracts.md` §"Skill 1 — `guild:loop-clarify`".

This skill **wraps** `guild:brainstorm`; it does not replace it. The loop runs BEFORE `guild:brainstorm` writes the spec. Researcher fact-checking runs alongside the architect's scope proposal so blocking unknowns are surfaced and explicitly converted to assumptions before the spec is committed.

## What you do

Drive a fixed-cap, sentinel-terminated dialog between **architect** (writer) and **researcher** (challenger). Each round the architect emits a brief or revised brief; the researcher emits a critique containing either more questions OR the literal sentinel `## NO MORE QUESTIONS` on its own line. The loop continues until the researcher signals satisfaction with a clean post-sentinel region, the cap is reached, or two consecutive malformed terminations escalate.

The driver is a pure state machine — it does not synthesise content. Architect and researcher are dispatched as Agent-tool subagents with their own context bundles per `guild-plan.md §9.3`; this skill only owns the round-counter, the sentinel detector, and the escalation gate.

## Input shape

```typescript
type LoopClarifyInput = {
  brief: string;                    // The user's initial brief, verbatim.
  loops_mode: "spec" | "all";       // Active --loops value (only spec/all activate L1).
  cap: number;                      // Effective cap (CLI/env-resolved; default 16, ≤ 256).
  run_id: string;                   // .guild/runs/<run-id>/ scope.
};
```

## Output shape

```typescript
type LoopClarifyOutput = {
  status: "satisfied" | "cap_hit" | "escalated" | "rework";
  rounds: number;                   // Total rounds executed (1-indexed).
  architect_handoffs: string[];     // Paths under .guild/runs/<run-id>/handoffs/loop-clarify/.
  researcher_handoffs: string[];    // Last one carries the sentinel on success.
  unresolved_questions: string[];   // Empty on satisfied; populated on cap_hit / force-pass / rework.
  assumptions: string[];            // Appended to spec's Assumptions section.
  next: "guild:brainstorm" | "abort";
};
```

## Termination contract — verbatim from the binding contract

The challenger (researcher) terminates the loop by emitting `## NO MORE QUESTIONS` as a standalone line in its handoff body. The sentinel must:

- Equal the entire trimmed line — not appear inline or with bullet decoration.
- Appear **exactly once** in the body. Multiple occurrences = malformed termination.

After the sentinel the driver runs the **post-sentinel regex set** against the substring AFTER the sentinel line. If any of the three patterns matches, the round is recorded as `loop_round_end.terminated = "malformed_termination"` and the loop continues for one extra round.

### Pattern 1 — lines ending in `?` (unresolved questions)

```regex
/^.*\?\s*$/m
```

### Pattern 2 — bullet lines starting with hard-blocker words

```regex
/^\s*[-*]\s+(blocker|must fix|cannot proceed|MUST|BLOCKING)\b/im
```

### Pattern 3 — TODO/FIXME/XXX markers (case-sensitive)

```regex
/\b(TODO|FIXME|XXX)\b/
```

The keyword set `/concern|issue|gap|missing|undefined/i` was REMOVED after Codex review round 2 because it false-positived on legitimate phrasings like "no concerns remain". Do not re-introduce it.

## Workflow

1. **Initialize.** Read `loops_mode`, `cap`, `run_id` from the orchestrator. The L1 cap counter is `counters.json` key `L1` (single global counter for the whole brainstorm phase — no lane suffix). Reset on `status="satisfied"`.

2. **Per round, in order:**
   a. Increment `L1` counter via `incrementCounter(runDir, run_id, "L1")`.
   b. Emit `loop_round_start` JSONL event with `lane_id: "phase:brainstorm"`, `loop_layer: "L1"`, `round_number`, `cap`.
   c. Dispatch architect (round 1: brief; round N: revised brief incorporating round N-1 researcher questions).
   d. Dispatch researcher with the architect's output as the round-input.
   e. Inspect researcher's body with the sentinel detector.
   f. Emit `loop_round_end` JSONL event with `terminated` ∈ `{"satisfied", "malformed_termination", "error"}` and `terminator: "researcher"`.

3. **Decide.**
   - `clean` (sentinel + clean post-sentinel) → return `status: "satisfied"`, `next: "guild:brainstorm"`. Reset `L1` counter on the next read.
   - `malformed_termination` → record; if 2 consecutive at this layer → escalate.
   - `no_sentinel` AND round < cap → continue.
   - round == cap AND no clean termination → escalate (cap-hit).

4. **Escalate.** Dispatch `AskUserQuestion` with the binding payload (see below). User's choice routes:
   - **`force-pass`** → write `unresolved_questions` to `.guild/runs/<run-id>/assumptions.md`, return `status="escalated"` (force-pass-as-satisfied), `next: "guild:brainstorm"`.
   - **`extend-cap`** → user supplies N (4/8/16/custom — second AskUserQuestion); cap extended; loop continues.
   - **`rework`** → return `status="rework"`, `next: "abort"`.

## Cap-hit escalation copy — exact literals

The orchestrator dispatches `AskUserQuestion` with `header: "Loop escalation"`, `multiSelect: false`, and exactly three options. Their `label` strings are verbatim:

- **`force-pass`** — "Accept the artifact as-is; log unresolved questions to assumptions.md; proceed."
- **`extend-cap`** — "Extend the cap by N rounds (you'll be asked for N)."
- **`rework`** — "Abort the current loop; return control to the producing skill with the unresolved questions."

Helper functions in `benchmark/src/loop-escalation.ts` build the payload (`buildEscalationPayload`, `buildExtendCapPayload`).

## Backwards-compat fallback

When the host runtime does NOT support `AskUserQuestion` (older Claude Code; non-interactive `claude --print`), fall back to the v1.3 free-text stdin path:

1. Print to stderr: a numbered list of the three options + their labels.
2. Read one line from stdin.
3. Trim + lowercase; match against the three labels (`force-pass` / `extend-cap` / `rework`); reject anything else with a re-prompt.
4. Log the choice to `escalation.user_choice` identically to the AskUserQuestion path.

`formatFallbackPrompt(...)` and `parseFallbackChoice(...)` in `benchmark/src/loop-escalation.ts` provide the prompt + parser.

## Per-lane counter

L1 has **one cap counter** for the whole brainstorm phase. Counter file `.guild/runs/<run-id>/counters.json` key `L1`. Resets when control passes to brainstorm-write-spec (i.e., on `status="satisfied"`).

Restart semantics are NOT applicable to L1 — restart is L3/L4/security-only (see `guild:loop-implement`). L1 cap-hit escalates directly via the 3-option choice.

## JSONL events emitted

Per `benchmark/plans/v1.4-jsonl-schema.md` §5/§6/§11:

- `loop_round_start` — per round; `lane_id: "phase:brainstorm"`, `loop_layer: "L1"`.
- `loop_round_end` — per round; same `lane_id`/`loop_layer`/`round_number` pair.
- `escalation` — on cap-hit OR malformed-termination ×2; `reason ∈ {"cap_hit", "malformed_termination_x2"}`; `options_offered` is ALWAYS `["force-pass", "extend-cap", "rework"]`; `user_choice` records the user's choice.
- `assumption_logged` — on `force-pass` (one event per unresolved question).

The JSONL appender is supplied by T3c-backend-logging's `log-jsonl.ts`. Until T3c lands, callers use `loop-jsonl-stub.ts`'s `LoopJsonlAppender` interface — same shape, same call sites.

## Output contract — handoff and follow-on

On `status="satisfied"` (or `force-pass-as-satisfied`):

1. Write a manifest at `.guild/runs/<run-id>/loops/loop-clarify-summary.md` listing rounds, terminator, unresolved-questions count, and the path to each round's architect+researcher handoff under `.guild/runs/<run-id>/handoffs/loop-clarify/`.
2. Append every recorded assumption to `.guild/runs/<run-id>/assumptions.md`.
3. Hand off to `guild:brainstorm` with the architect's last brief + the researcher's residual notes as additional context.

On `rework`: return control to the user; do not invoke `guild:brainstorm`.

## Anti-patterns

- Synthesising the researcher's response from training-data priors. The challenger MUST be a separate dispatch with its own bundle; otherwise the loop is a self-review and the adversarial contract is broken.
- Re-introducing the removed `/concern|issue|gap|missing|undefined/i` keyword set. Codex review pinned this regression — false positives on phrases like "no concerns remain".
- Treating the sentinel as case-insensitive or accepting bullet-decorated variants. The architect contract is exact: trimmed line equals `## NO MORE QUESTIONS`, no exceptions.
- Skipping the JSONL event emit on cap-hit. The verify-done harness reads `escalation` events to confirm `options_offered` is the canonical 3-label list.
- Continuing the loop after `rework`. A `rework` choice ends the loop; orchestrator routes to user-decision.

## Handoff receipt

Per `guild-plan.md §8.2`. Required fields:

- `loop_id: loop-clarify`
- `lane_id: phase:brainstorm`
- `rounds: <int>`
- `status: <satisfied|cap_hit|escalated|rework>`
- `next: <guild:brainstorm|abort>`
- `evidence:` paths to each round's architect+researcher handoff + the manifest + JSONL log path.
