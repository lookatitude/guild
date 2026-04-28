---
name: guild-loop-implement
description: F-3 implementation-phase adversarial-loop dispatcher — wraps `guild:execute-plan` per lane. Runs three nested layers per lane: L3 dev↔tester (`qa-property-based-tests` is challenger), L4 owner↔QA (full QA strategy is challenger), security-review owner↔security (security is challenger; restart-from-security on findings). Activates only when `--loops` is `implementation` or `all`. The lane's `loops_applicable` plan-block field selects which layers run (5 valid values: `none, l3-only, l4-only, both, full`; invalid values rejected at plan-validate with exit 2). Restart semantics: security-review fires a restart from L3 when it surfaces any finding with `severity: high` AND `addressed_by_owner: false`; restart cap = 3 per lane per task; per-lane counter isolation; prior receipts moved to `handoffs/superseded/<lane_id>-restart-<N>/` with `superseded_by:` cross-references. TRIGGER on "run the lane loops", "L3 loop", "L4 loop", "security review for the lane", "implementation-phase adversarial loop", "kick off the dev↔tester / dev↔qa / dev↔security loop". DO NOT TRIGGER for pre-spec clarification (`guild:loop-clarify` owns L1), plan-defect review (`guild:loop-plan-review` owns L2), broader code review outside the lane scope, direct test authoring (qa owns), or any run where `--loops=none` (default — loops are off).
when_to_use: Fifth step of the `/guild` lifecycle when `--loops=implementation` or `--loops=all` is active. Fires per-lane during `guild:execute-plan` AFTER the lane's primary writer completes its first pass. Tester / QA / security signal termination with `## NO MORE QUESTIONS` on its own line + a clean post-sentinel region. Restart fires on security findings with `severity: high` AND `addressed_by_owner: false`.
type: meta
---

# guild:loop-implement

Implements `.guild/spec/v1.4.0-adversarial-loops.md` SC3 (F-3) and the binding contract at `benchmark/plans/v1.4-loop-skill-contracts.md` §"Skill 3 — `guild:loop-implement`".

This skill **layers atop** `guild:execute-plan` per lane; it does not replace it. The lane's owning specialist (backend / frontend / mobile / devops / qa / etc.) is the **writer**; the challenger varies per layer.

## What you do

For each lane that activates F-3 via its `loops_applicable` plan-block field, run a sequence of nested adversarial loops between the lane's owner and a layer-specific challenger:

- **L3** dev↔tester — `qa-property-based-tests` is the challenger. Tests focus on property-based coverage of the lane's deliverable.
- **L4** owner↔QA — `qa` (full strategy) is the challenger. Broader test-suite shape, coverage targets, flaky-hunter.
- **security-review** owner↔security — `security` is the challenger. On findings with `severity: high` AND `addressed_by_owner: false`, the loop **restarts** from L3.

Each layer is a fixed-cap, sentinel-terminated dialog identical in shape to L1/L2 — same `## NO MORE QUESTIONS` sentinel, same post-sentinel regex set. The difference is the per-lane counter isolation and the security-restart machinery.

## `loops_applicable` enum — five valid values

The plan-block `loops_applicable` field selects which layers run for the lane. Plan-validate (T3a-backend-config) accepts ONLY these five values:

```
none, l3-only, l4-only, both, full
```

Any other value is rejected at plan-validate time with exit 2 and the literal stderr line:

```
loops_applicable must be one of: none, l3-only, l4-only, both, full
```

Layer-set per value:

| Order | Value | L3 runs? | L4 runs? | security-review runs? |
|---|---|---|---|---|
| 1 | `none` | no | no | no |
| 2 | `l3-only` | yes | no | no |
| 3 | `l4-only` | no | yes | no |
| 4 | `both` | yes | yes | no |
| 5 | `full` | yes | yes | yes |

The five values appear in this fixed order in `LOOPS_APPLICABLE_VALUES` (`benchmark/src/loop-applicable.ts`).

### Default per lane type (when `loops_applicable` is unset)

| Lane owner | Default `loops_applicable` |
|---|---|
| `backend`, `frontend`, `mobile`, `devops` | `full` |
| `qa` (when primary implementer of test fixtures) | `l4-only` |
| `technical-writer` / `copywriter` / `social-media` (user-facing deliverable) | `l4-only` |
| `researcher` / `architect-as-pure-design` / `marketing` / `sales` / `seo` / non-user-facing copy | `none` |
| `security` (rare — owning an implementation lane) | **plan must explicitly set**; no default. |

### Why security-owned lanes must explicitly set `loops_applicable`

A security-owned implementation lane cannot also run security-review against itself (self-review defeats the adversarial contract). The plan-validate decision tree is the binding contract:

1. **Security-owned lane omits `loops_applicable`** → reject exit 2 with literal error `security-owned lane <lane_id> must set loops_applicable explicitly`.
2. **Security-owned lane sets `loops_applicable: none` WITH** the literal end-of-line comment marker `# review lane; loops_applicable=none per T6 carve-out` on the same plan-block line → ACCEPT (T6 exemption).
3. **Security-owned lane sets `loops_applicable: none` WITHOUT** the marker → reject exit 2 with literal error `security-owned lane <lane_id> sets loops_applicable=none without the T6 exemption marker`.
4. **Security-owned lane sets `l3-only`, `l4-only`, `both`, or `full`** → ACCEPT (normal path; security-review must be routed to a different specialist via plan-level override when `loops_applicable: full`).

`validatePlanLane(...)` in `benchmark/src/loop-applicable.ts` implements all 4 cases; qa pins each case in `loop-implement.test.ts`.

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

## Termination contract per layer — verbatim from the binding contract

Each active layer terminates independently when its challenger emits `## NO MORE QUESTIONS` on its own line with a clean post-sentinel region:

- L3: tester (`qa-property-based-tests`) emits sentinel.
- L4: qa (full strategy) emits sentinel.
- security-review: security emits sentinel WITHOUT a high+unaddressed finding (with such a finding, restart fires).

The post-sentinel regex set is identical to L1/L2.

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

## Restart-from-security — machine-checkable trigger

Security's terminating receipt contains the sentinel `## NO MORE QUESTIONS` AND an OPTIONAL findings section ABOVE the sentinel. The findings section is matched by:

```regex
/^##\s+(Findings|Open issues|Blockers)\b/im
```

Under that heading, each finding is a YAML-style bullet with two required fields:

```
## Findings

- severity: high
  addressed_by_owner: false
  description: <free-text describing the finding>

- severity: medium
  addressed_by_owner: true
  description: <free-text>
```

- `severity` is one of `high | medium | low` (case-sensitive, unquoted).
- `addressed_by_owner` is one of `true | false` (case-sensitive, unquoted).
- `description` is free text; redaction applies before the receipt is written to disk.

### Restart trigger condition (binding)

The `loop-implement` skill parses every finding entry. **Restart fires iff ANY single finding has `severity: high` AND `addressed_by_owner: false`.** Lower-severity findings, or findings the lane owner has marked addressed, do NOT trigger a restart on their own; they are recorded in the lane's audit trail (`assumption_logged` events) but the loop proceeds.

Tests pin:

- `severity: high` + `addressed_by_owner: false` → restart fires.
- `severity: high` + `addressed_by_owner: true` → no restart; finding logged.
- `severity: medium` / `low` (any addressed value) → no restart; finding logged.
- Findings section absent or no matching bullets → no findings; no restart.
- Malformed bullet (missing `severity` or `addressed_by_owner`) → log `assumption_logged` event with literal text `Malformed security finding bullet — treated as no-restart; lane <lane_id>; round <N>` and proceed without restart. (Defends against typos blocking the lane forever.)

The older draft used a `BLOCKING:` literal marker; that is NOT what the parser detects. The parser keys on the `## Findings|Open issues|Blockers` heading + YAML bullet fields. Test fixtures must use the YAML-bullet format.

### On restart fire

1. **Move prior receipts.** L3 + L4 + security-review receipts for this lane move to `.guild/runs/<run-id>/handoffs/superseded/<lane_id>-restart-<N>/` (where `<N>` is the post-increment restart counter, starting at 1).
2. **Cross-reference.** Each prior receipt gains a frontmatter field `superseded_by: <new-receipt-path>` (relative path). The `superseded_by` cross-reference is the audit trail; future `summary.md` regen reads both old and new chains. `injectSupersededBy(...)` in `benchmark/src/loop-implement-restart.ts` is the pure transform.
3. **Reset L3/L4/security counters for this lane.** Per spec §"Cap reset boundaries", a security restart resets L3/L4/security counters to 0 for this lane. This does NOT affect other lanes' counters (per-lane isolation). Use `resetLaneCounters(runDir, run_id, laneId)` from `counter-store.ts`; T3a's contract preserves the `restart:<lane>` counter across this call.
4. **Increment restart counter.** `counters.json` key `restart:<lane>` incremented by 1. **Restart cap = 3** per lane per task — the 4th restart triggers escalation.
5. **New context bundle.** The restarted lane's input bundle includes the security findings verbatim, plus pointers to the superseded receipts.
6. **Per-lane counter isolation.** Lane A's restart does NOT affect lane B's counters. Parallel lanes run independently. Tests pin a 2-lane-A-restarts-B-continues case.

## Restart cap = 3

The literal restart-cap default is **`cap = 3`** per lane per task. Configurable only via plan-level override (per-lane), not via a global env var (per spec — "no global state for restarts"). On restart-cap-hit (4th restart attempt), escalate to the user with the standardized 3-option choice:

- **`force-pass`** → log security findings to `.guild/runs/<run-id>/assumptions.md`, return `status="restart_cap_hit"` with the lane marked force-passed-with-findings.
- **`extend-cap`** → user supplies N (additional restart attempts); `restart_cap` extended by N; loop re-attempts.
- **`rework`** → return `status="rework"`. Orchestrator routes to user-decision (out of skill scope).

## Per-lane counters — isolation contract

Counters are keyed by `lane_id` in `counters.json`:

```json
{
  "schema_version": 1,
  "run_id": "run-2026-04-27-v1.4.0-adversarial-loops",
  "counters": {
    "L1": 0,
    "L2": 0,
    "L3:T3a-backend-config": 2,
    "L4:T3a-backend-config": 3,
    "security:T3a-backend-config": 1,
    "restart:T3a-backend-config": 0,
    "L3:T3b-backend-loops": 1,
    "L4:T3b-backend-loops": 1,
    "security:T3b-backend-loops": 0,
    "restart:T3b-backend-loops": 0
  }
}
```

Lane A's counter modifications NEVER touch lane B's keys. Tests pin parallel-lane non-interference under both happy-path and A-restarts-B-continues scenarios.

## `counters.json` concurrency

Specialists run in separate OS PIDs (subagent processes; agent-team panes). Multiple lanes can update `counters.json` concurrently. The write protocol is owned by T3a-backend-config's `counter-store.ts`:

- **Atomic-rename.** All writes use the write-tmp + rename pattern: write to `<runDir>/counters.json.tmp`, fsync, rename to `<runDir>/counters.json`. POSIX `rename` is atomic on the same filesystem.
- **Lock reuse.** Concurrent counter-updates serialize on the SAME stable lockfile sidecar `.guild/runs/<run-id>/logs/.lock` defined in ADR-009 §"Stable-lockfile race control architecture". This is the SINGLE coordination primitive for ALL per-run shared state (JSONL log + counters.json).
- **Optimistic-retry on conflict.** Read-modify-write retries up to 3 times with bounded backoff (10ms, 50ms, 200ms). Failure after the 3rd retry → log a `tool_call status: "err"` event, surface to the orchestrator.
- **Crash-resume cleanup.** On startup, orphaned `counters.json.tmp` is deleted at lock acquisition; reads proceed against the prior `counters.json`.

This skill calls `incrementCounter(...)` / `resetLaneCounters(...)` / `readCounters(...)` from `counter-store.ts`; do NOT reimplement counter persistence.

## Workflow

For each lane the orchestrator dispatches with `loops_applicable ≠ "none"`:

1. **Resolve layer set.** `activeLayersFor(loops_applicable)` returns the ordered list of layers to run (`["L3"]`, `["L4"]`, `["L3", "L4"]`, or `["L3", "L4", "security-review"]`).

2. **Per layer, in order:**
   - For each round (1..cap):
     - Increment `<layer>:<lane_id>` counter (or `security:<lane_id>` for security-review).
     - Emit `loop_round_start` JSONL event with `lane_id: <lane_id>`, `loop_layer: <layer>`, `round_number`, `cap`.
     - Dispatch the lane owner with the prior round's challenger output (or the initial deliverable for round 1).
     - Dispatch the layer's challenger (`qa-property-based-tests` / `qa` / `security`).
     - Inspect the challenger's body with `detectSentinel(...)`.
     - Emit `loop_round_end` JSONL event.
     - Decide: clean → exit layer; malformed → record (escalate on 2 consecutive); no-sentinel + round < cap → continue; cap exhausted → escalate cap-hit.

3. **After security-review layer completes cleanly:**
   - Parse findings via `parseSecurityFindings(security_body)`.
   - If `shouldRestartFromSecurity(parse)` → restart machinery (move receipts, reset counters, increment `restart:<lane>`, re-run from L3); cap on `restart_count >= restart_cap` → escalate `restart_cap_hit`.
   - If parse is `malformed_bullet` → emit `assumption_logged` with the literal text `Malformed security finding bullet — treated as no-restart; lane <lane_id>; round <N>`; proceed without restart.
   - Otherwise (no findings, or findings all medium/low/already-addressed) → log findings as `assumption_logged` and exit cleanly.

4. **Return** `LoopImplementOutput` to the orchestrator. On `status="satisfied"`, `next: "next-lane"`. On `rework`, `next: "abort"`.

## Cap-hit / restart-cap-hit escalation copy — exact literals

Escalations fire at five sites:

- L3 cap-hit.
- L4 cap-hit.
- security-review cap-hit.
- Two consecutive malformed-terminations at any layer.
- Restart-cap-hit (4th security restart attempt).

At every site the orchestrator dispatches `AskUserQuestion` with `header: "Loop escalation"`, `multiSelect: false`, and exactly three options. The `label` strings are verbatim:

- **`force-pass`** — "Accept the artifact as-is; log unresolved questions to assumptions.md; proceed."
- **`extend-cap`** — "Extend the cap by N rounds (you'll be asked for N)."
- **`rework`** — "Abort the current loop; return control to the producing skill with the unresolved questions."

`buildEscalationPayload(...)` in `benchmark/src/loop-escalation.ts` builds the payload.

## Backwards-compat fallback

When `AskUserQuestion` is unavailable, fall back to the v1.3 free-text stdin path:

1. Print three options to stderr (numbered list + literal labels).
2. Read one line from stdin.
3. Trim + lowercase; match against `force-pass` / `extend-cap` / `rework`; reject otherwise with re-prompt.
4. Log the choice to `escalation.user_choice` identically.

Tests pin both branches at every escalation site.

## JSONL events emitted

Per `benchmark/plans/v1.4-jsonl-schema.md`:

- `loop_round_start` — per round per layer per lane.
- `loop_round_end` — per round per layer per lane.
- `escalation` — at every escalation site; `options_offered` is ALWAYS `["force-pass", "extend-cap", "rework"]`.
- `assumption_logged` — on `force-pass`, on malformed security finding bullets, on no-restart-but-logged findings.

The JSONL appender is supplied by T3c-backend-logging's `log-jsonl.ts` (stub interface in `loop-jsonl-stub.ts` until T3c lands).

## Anti-patterns

- Re-implementing counter persistence inside this skill. T3a's `counter-store.ts` is the single source of truth; calling `incrementCounter` / `resetLaneCounters` / `readCounters` is the contract.
- Treating the `BLOCKING:` literal as a restart trigger. The parser keys on the `## Findings|Open issues|Blockers` heading + YAML bullet `severity: high` + `addressed_by_owner: false`. A `BLOCKING:` literal alone is a no-op.
- Resetting `restart:<lane>` on `resetLaneCounters` — T3a's contract preserves it across the L3/L4/security counter reset. Re-resetting the restart counter would break the cap-3 invariant.
- Self-review on security-owned lanes. The 4-case decision tree exists for exactly this reason; bypassing it (e.g., by setting `loops_applicable: full` on a security lane without rerouting security-review) breaks the adversarial contract.
- Failing to move prior receipts on restart. The `superseded_by:` cross-reference is the audit trail; without it, `summary.md` regen cannot reconstruct the chain.
- Cross-lane counter contamination. Per-lane isolation is the binding contract; `counter-store.resetLaneCounters` only touches `L3:<lane>`, `L4:<lane>`, `security:<lane>`. Test pin: a 2-lane scenario where one restarts; the other's counters are unaffected.

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
- `evidence:` paths to each round's owner+challenger handoff per layer + the manifest + JSONL log path; plus the parsed-findings list with severity/addressed flags.
