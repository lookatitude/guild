# I/O + handoff-receipt contract (loop-implement detail)

Detail for SKILL.md §"Input shape", §"Output shape", and §"Handoff receipt".

## Input shape

```typescript
type LoopImplementInput = {
  lane_id: string;                  // From plan, e.g., "T3a-backend-config".
  owner: string;                    // Specialist name, e.g., "backend".
  loops_applicable: "none" | "l3-only" | "l4-only" | "both" | "full";
  loops_mode: "implementation" | "all";
  cap: number;                      // Effective cap (default 16).
  restart_cap: number;              // Default 3 per lane per task. cap = 3.
  run_id: string;
  task_id: string;
  prior_receipts?: string[];        // On restart: paths to receipts moved to handoffs/superseded/.
  security_findings?: string[];     // On restart: security's blocking findings verbatim.
};
```

## Output shape

```typescript
type LoopImplementOutput = {
  status: "satisfied" | "cap_hit" | "escalated" | "rework" | "restart_cap_hit";
  layers_run: Array<"L3" | "L4" | "security-review">;
  rounds_per_layer: { L3?: number; L4?: number; "security-review"?: number };
  restart_count: number;            // 0 on first run; increments per security restart; max 3.
  superseded_receipts: string[];    // Paths under handoffs/superseded/ when restart fires.
  unresolved_questions: string[];
  assumptions: string[];
  next: "next-lane" | "abort";
};
```

## Handoff receipt

Per `guild-plan.md §8.2`. Required fields:

- `loop_id: loop-implement`
- `lane_id: <lane>`
- `loops_applicable: <none|l3-only|l4-only|both|full>`
- `layers_run: [<L3?>, <L4?>, <security-review?>]`
- `rounds_per_layer: {L3: ?, L4: ?, security-review: ?}`
- `restart_count: <int>` (max 3)
- `superseded_receipts: [...]` (when restart fired)
- `status: <satisfied|cap_hit|escalated|rework|restart_cap_hit>`
- `next: <next-lane|abort>`
- `evidence:` paths to each round's owner+challenger handoff per layer + the
  manifest + JSONL log path; plus the parsed-findings list with
  severity/addressed flags.
