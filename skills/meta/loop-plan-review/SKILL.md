---
name: guild-loop-plan-review
description: F-2 adversarial plan-defect review driver — wraps `guild:plan`, runs an architect↔security loop where security raises plan-defect questions ONLY (security holes, scope creep, autonomy-policy gaps, contract drift, untestable success criteria) and signals satisfaction with the literal sentinel `## NO MORE QUESTIONS`. Activates only when `--loops` is `plan` or `all`. TRIGGER on "review the plan", "L2 loop", "security plan-review", "kick off the plan adversarial loop", "audit the plan for defects before approval", "run the plan loop". Runs AFTER `guild:plan` writes the plan and BEFORE the user-approval gate (Gate 3). Architect can mark a question "dismissed because X" with rationale recorded in the plan, but security MUST independently emit the sentinel — dismissals do NOT terminate the loop. DO NOT TRIGGER for pre-spec clarification (`guild:loop-clarify` owns L1), implementation-phase loops (`guild:loop-implement` owns L3/L4/security-review), code-style review (out of scope; security raises plan-defect questions only), or any run where `--loops=none` (default — loops are off).
when_to_use: Third step of the `/guild` lifecycle when `--loops=plan` or `--loops=all` is active. Fires after `guild:plan` writes `.guild/plan/<slug>.md` (with `approved: false`) and BEFORE the user-approval gate. Security signals termination with `## NO MORE QUESTIONS` on its own line + a clean post-sentinel region.
type: meta
---

# guild:loop-plan-review

Implements `.guild/spec/v1.4.0-adversarial-loops.md` SC2 (F-2) and the binding contract at `benchmark/plans/v1.4-loop-skill-contracts.md` §"Skill 2 — `guild:loop-plan-review`".

This skill **wraps** `guild:plan`; it does not replace it. The loop runs AFTER `guild:plan` writes the plan and BEFORE Gate 3 (user-approval). Security's job is to surface plan-defect questions — security holes, scope creep, autonomy-policy gaps, contract drift, untestable success criteria — NOT general code-style suggestions.

## What you do

Drive a fixed-cap, sentinel-terminated dialog between **architect** (writer) and **security** (challenger). Each round the architect emits a plan or revised plan (with optional "dismissed because X" rationales for dismissed questions); security emits a critique containing either more plan-defect questions OR the literal sentinel `## NO MORE QUESTIONS` on its own line. The loop continues until security signals satisfaction with a clean post-sentinel region, the cap is reached, or two consecutive malformed terminations escalate.

Architect's "dismissed because X" markings do NOT terminate the loop. Security must independently emit the sentinel for clean termination.

## Input shape

```typescript
type LoopPlanReviewInput = {
  plan_path: string;                // Repo-relative path to the plan written by guild:plan.
  spec_path: string;                // Repo-relative path to the spec the plan implements.
  loops_mode: "plan" | "all";       // Active --loops value (only plan/all activate L2).
  cap: number;                      // Effective cap (default 16).
  run_id: string;
};
```

## Output shape

```typescript
type LoopPlanReviewOutput = {
  status: "satisfied" | "cap_hit" | "escalated" | "rework";
  rounds: number;
  architect_handoffs: string[];
  security_handoffs: string[];      // Last one carries the sentinel on success.
  dismissed_questions: Array<{ question: string; rationale: string }>;
  unresolved_questions: string[];
  next: "gate-3-plan-approval" | "abort";
};
```

`dismissed_questions[]` records architect's explicit dismissals; the audit trail is preserved even when the loop terminates cleanly.

## Termination contract — verbatim from the binding contract

The challenger (security) terminates the loop by emitting `## NO MORE QUESTIONS` as a standalone line in its handoff body. The sentinel must:

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

The keyword set `/concern|issue|gap|missing|undefined/i` is REMOVED (round-2 regression guard).

## Workflow

1. **Initialize.** Read `loops_mode`, `cap`, `run_id`, `plan_path`, `spec_path` from the orchestrator. The L2 cap counter is `counters.json` key `L2` (single global counter for the plan phase).

2. **Per round, in order:**
   a. Increment `L2` counter via `incrementCounter(runDir, run_id, "L2")`.
   b. Emit `loop_round_start` JSONL event with `lane_id: "phase:plan"`, `loop_layer: "L2"`.
   c. Dispatch architect (round 1: original plan; round N: revised plan with "dismissed because X" rationales for any dismissals).
   d. Dispatch security with the architect's plan + spec as round-input. Security MUST raise plan-defect questions only.
   e. Inspect security's body with the sentinel detector.
   f. Emit `loop_round_end` JSONL event.

3. **Decide.**
   - `clean` → return `status: "satisfied"`, `next: "gate-3-plan-approval"`. Reset `L2` counter.
   - `malformed_termination` → record; if 2 consecutive at this layer → escalate.
   - `no_sentinel` AND round < cap → continue.
   - round == cap AND no clean termination → escalate (cap-hit).

4. **Escalate.** Dispatch `AskUserQuestion` with the binding payload. User's choice routes:
   - **`force-pass`** → unresolved security questions written to `.guild/runs/<run-id>/assumptions.md`; plan proceeds to Gate 3 (`status="escalated"`, `next: "gate-3-plan-approval"`).
   - **`extend-cap`** → user supplies N; cap extended; loop continues.
   - **`rework`** → return `status="rework"`, `next: "abort"`. Plan returns to `guild:plan` for revision (orchestrator reroutes).

## Plan-defect filter (security scope)

Security in this loop raises **plan-defect questions only**:

- Security holes — auth gaps, secrets handling, missing audit trails, threat-model omissions.
- Scope creep — lanes whose `scope:` overlaps another specialist's lane.
- Autonomy-policy gaps — missing `requires confirmation:` on a destructive operation.
- Contract drift — lane success criteria that don't match the spec's success criteria.
- Untestable success criteria — vibes-based bullets ("feels better"); each criterion must be measurable.

Security MUST NOT raise general code-style suggestions in this loop. Test pin: a code-style-only review terminates with `## NO MORE QUESTIONS` in round 1.

## Cap-hit escalation copy — exact literals

The orchestrator dispatches `AskUserQuestion` with `header: "Loop escalation"`, `multiSelect: false`, and exactly three options. Their `label` strings are verbatim:

- **`force-pass`** — "Accept the artifact as-is; log unresolved questions to assumptions.md; proceed."
- **`extend-cap`** — "Extend the cap by N rounds (you'll be asked for N)."
- **`rework`** — "Abort the current loop; return control to the producing skill with the unresolved questions."

Helper functions in `benchmark/src/loop-escalation.ts` build the payload (`buildEscalationPayload`, `buildExtendCapPayload`).

## Backwards-compat fallback

When the host runtime does NOT support `AskUserQuestion`, fall back to the v1.3 free-text stdin path:

1. Print three options to stderr (numbered list + literal labels).
2. Read one line from stdin.
3. Trim + lowercase; match against `force-pass` / `extend-cap` / `rework`; reject otherwise with re-prompt.
4. Log the choice to `escalation.user_choice` identically.

## Per-lane counter

L2 has **one cap counter** for the whole plan phase. Counter file `.guild/runs/<run-id>/counters.json` key `L2`. Resets when control passes to user-approval-gate (i.e., on `status="satisfied"`).

Restart semantics are NOT applicable to L2 — restart is L3/L4/security-only (see `guild:loop-implement`).

## JSONL events emitted

Per `benchmark/plans/v1.4-jsonl-schema.md`:

- `loop_round_start` — per round; `lane_id: "phase:plan"`, `loop_layer: "L2"`.
- `loop_round_end` — per round.
- `escalation` — on cap-hit OR malformed-termination ×2; `options_offered` is ALWAYS `["force-pass", "extend-cap", "rework"]`.
- `assumption_logged` — on `force-pass`.

The JSONL appender is supplied by T3c-backend-logging's `log-jsonl.ts` (stub interface in `loop-jsonl-stub.ts` until T3c lands).

## Output contract — handoff and follow-on

On `status="satisfied"` (or `force-pass-as-satisfied`):

1. Write a manifest at `.guild/runs/<run-id>/loops/loop-plan-review-summary.md` listing rounds, terminator, dismissed questions + rationales, unresolved questions count, and the path to each round's architect+security handoff under `.guild/runs/<run-id>/handoffs/loop-plan-review/`.
2. Append every unresolved question (force-pass branch) to `.guild/runs/<run-id>/assumptions.md`.
3. Hand control back to the orchestrator's Gate 3 (plan approval).

On `rework`: return to `guild:plan` for plan revision (orchestrator reroutes; this skill does not invoke `guild:plan` itself).

## Anti-patterns

- Treating architect's "dismissed because X" as a termination signal. The architect can dismiss; the loop only terminates when security independently emits the sentinel. Test pin: architect dismisses + security still has questions → loop continues.
- Letting security raise code-style suggestions. The plan-defect filter is a hard contract. Test pin: a code-style-only review terminates in round 1 with no questions raised.
- Re-introducing the removed `/concern|issue|gap|missing|undefined/i` keyword set.
- Skipping Gate 3 after `force-pass`. Force-pass is force-pass-AS-satisfied; the user-approval gate still runs immediately after with the orchestrator-assembled context.
- Missing `dismissed_questions[]` in the receipt. The audit trail must preserve dismissals + rationales even on clean termination.

## Handoff receipt

Per `guild-plan.md §8.2`. Required fields:

- `loop_id: loop-plan-review`
- `lane_id: phase:plan`
- `rounds: <int>`
- `status: <satisfied|cap_hit|escalated|rework>`
- `next: <gate-3-plan-approval|abort>`
- `evidence:` paths to each round's architect+security handoff + the manifest + JSONL log path; plus the dismissed-questions list with rationales.
