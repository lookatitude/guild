# I/O + output/handoff contract (loop-plan-review detail)

Detail for SKILL.md §"Input shape", §"Output shape", §"Output contract — handoff
and follow-on", and §"Handoff receipt".

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

`dismissed_questions[]` records architect's explicit dismissals; the audit trail
is preserved even when the loop terminates cleanly.

## Output contract — handoff and follow-on

On `status="satisfied"` (or `force-pass-as-satisfied`):

1. Write a manifest at `.guild/runs/<run-id>/loops/loop-plan-review-summary.md`
   listing rounds, terminator, dismissed questions + rationales, unresolved
   questions count, and the path to each round's architect+security handoff under
   `.guild/runs/<run-id>/handoffs/loop-plan-review/`.
2. Append every unresolved question (force-pass branch) to
   `.guild/runs/<run-id>/assumptions.md`.
3. Hand control back to the orchestrator's Gate 3 (plan approval).

On `rework`: return to `guild:plan` for plan revision (orchestrator reroutes;
this skill does not invoke `guild:plan` itself).

## Handoff receipt

Per `guild-plan.md §8.2`. Required fields:

- `loop_id: loop-plan-review`
- `lane_id: phase:plan`
- `rounds: <int>`
- `status: <satisfied|cap_hit|escalated|rework>`
- `next: <gate-3-plan-approval|abort>`
- `evidence:` paths to each round's architect+security handoff + the manifest +
  JSONL log path; plus the dismissed-questions list with rationales.
