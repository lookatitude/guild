# Loop mechanics — termination, workflow, escalation (loop-plan-review detail)

Detail for SKILL.md §"Termination contract", §"Workflow", §"Cap-hit escalation
copy", §"Backwards-compat fallback", §"Per-lane counter", and §"JSONL events".
Verbatim from the binding contract (§"Skill 2" in the loop-skill-contracts spec,
part of the separate guild-benchmark repo).

## Termination contract — verbatim from the binding contract

The challenger (security) terminates the loop by emitting `## NO MORE QUESTIONS`
as a standalone line in its handoff body. The sentinel must:

- Equal the entire trimmed line — not appear inline or with bullet decoration.
- Appear **exactly once** in the body. Multiple occurrences = malformed termination.

After the sentinel the driver runs the **post-sentinel regex set** against the
substring AFTER the sentinel line. If any of the three patterns matches, the
round is recorded as `loop_round_end.terminated = "malformed_termination"` and
the loop continues for one extra round.

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

The keyword set `/concern|issue|gap|missing|undefined/i` is REMOVED (round-2
regression guard). Do not re-introduce it.

## Workflow

1. **Initialize.** Read `loops_mode`, `cap`, `run_id`, `plan_path`, `spec_path`
   from the orchestrator. The L2 cap counter is `counters.json` key `L2` (single
   global counter for the plan phase).

2. **Per round, in order:**
   a. Increment `L2` counter via `incrementCounter(runDir, run_id, "L2")`.
   b. Emit `loop_round_start` event via `scripts/emit-loop-event.ts`:
      ```bash
      npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/emit-loop-event.ts \
        --event loop_round_start --layer L2 --lane phase:plan \
        --round <N> --cap <cap> \
        [--run-id <run-id>] [--cwd <repo-root>]
      ```
   c. Dispatch architect (round 1: original plan; round N: revised plan with
      "dismissed because X" rationales for any dismissals).
   d. Dispatch security with the architect's plan + spec as round-input. Security
      MUST raise plan-defect questions only.
   e. Inspect security's body with the sentinel detector.
   f. Emit `loop_round_end` event via `scripts/emit-loop-event.ts`:
      ```bash
      npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/emit-loop-event.ts \
        --event loop_round_end --layer L2 --lane phase:plan \
        --round <N> --terminated <satisfied|malformed_termination|cap_hit|escalation|error> \
        --terminator security \
        [--run-id <run-id>] [--cwd <repo-root>]
      ```
      Use `satisfied` only when security emitted `## NO MORE QUESTIONS` cleanly;
      use the corresponding enum for cap-hit, malformed-termination, escalation,
      or runtime error.

3. **Decide.**
   - `clean` → return `status: "satisfied"`, `next: "gate-3-plan-approval"`. Reset
     `L2` counter.
   - `malformed_termination` → record; if 2 consecutive at this layer → escalate.
   - `no_sentinel` AND round < cap → continue.
   - round == cap AND no clean termination → escalate (cap-hit).

4. **Escalate.** Dispatch `AskUserQuestion` with the binding payload. User's
   choice routes:
   - **`force-pass`** → unresolved security questions written to
     `.guild/runs/<run-id>/assumptions.md`; plan proceeds to Gate 3
     (`status="escalated"`, `next: "gate-3-plan-approval"`).
   - **`extend-cap`** → user supplies N; cap extended; loop continues.
   - **`rework`** → return `status="rework"`, `next: "abort"`. Plan returns to
     `guild:plan` for revision (orchestrator reroutes).

## Cap-hit escalation copy — exact literals

The orchestrator dispatches `AskUserQuestion` with `header: "Loop escalation"`,
`multiSelect: false`, and exactly three options. Their `label` strings are
verbatim:

- **`force-pass`** — "Accept the artifact as-is; log unresolved questions to assumptions.md; proceed."
- **`extend-cap`** — "Extend the cap by N rounds (you'll be asked for N)."
- **`rework`** — "Abort the current loop; return control to the producing skill with the unresolved questions."

Helper functions `buildEscalationPayload` and `buildExtendCapPayload` build the payload; these are implemented in the separate guild-benchmark repo (`src/loop-escalation.ts`).

## Backwards-compat fallback

When the host runtime does NOT support `AskUserQuestion`, fall back to the v1.3
free-text stdin path:

1. Print three options to stderr (numbered list + literal labels).
2. Read one line from stdin.
3. Trim + lowercase; match against `force-pass` / `extend-cap` / `rework`; reject
   otherwise with re-prompt.
4. Log the choice to `escalation.user_choice` identically.

## Per-lane counter

L2 has **one cap counter** for the whole plan phase. Counter file
`.guild/runs/<run-id>/counters.json` key `L2`. Resets when control passes to
user-approval-gate (i.e., on `status="satisfied"`).

Restart semantics are NOT applicable to L2 — restart is L3/L4/security-only (see
`guild:loop-implement`).

## JSONL events emitted

Per the v1.4-jsonl-schema spec in the separate guild-benchmark repo:

- `loop_round_start` — per round; `lane_id: "phase:plan"`, `loop_layer: "L2"`.
- `loop_round_end` — per round.
- `escalation` — on cap-hit OR malformed-termination ×2; `options_offered` is
  ALWAYS `["force-pass", "extend-cap", "rework"]`.
- `assumption_logged` — on `force-pass`.

JSONL events are appended by `scripts/emit-loop-event.ts` (self-contained;
writes directly to `events.ndjson`). The vendored log lib is at
`hooks/lib/v1.4/log-jsonl.ts`. T3c has landed; `loop-jsonl-stub.ts` is no
longer needed.
