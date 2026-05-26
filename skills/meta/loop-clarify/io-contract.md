# I/O + output/handoff contract (loop-clarify detail)

Detail for SKILL.md §"Input shape", §"Output shape", §"Output contract — handoff
and follow-on", and §"Handoff receipt".

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

## Output contract — handoff and follow-on

On `status="satisfied"` (or `force-pass-as-satisfied`):

1. Write a manifest at `.guild/runs/<run-id>/loops/loop-clarify-summary.md`
   listing rounds, terminator, unresolved-questions count, and the path to each
   round's architect+researcher handoff under
   `.guild/runs/<run-id>/handoffs/loop-clarify/`.
2. Append every recorded assumption to `.guild/runs/<run-id>/assumptions.md`.
3. Hand off to `guild:brainstorm` with the architect's last brief + the
   researcher's residual notes as additional context.

On `rework`: return control to the user; do not invoke `guild:brainstorm`.

## Handoff receipt

Per `guild-plan.md §8.2`. Required fields:

- `loop_id: loop-clarify`
- `lane_id: phase:brainstorm`
- `rounds: <int>`
- `status: <satisfied|cap_hit|escalated|rework>`
- `next: <guild:brainstorm|abort>`
- `evidence:` paths to each round's architect+researcher handoff + the manifest +
  JSONL log path.
