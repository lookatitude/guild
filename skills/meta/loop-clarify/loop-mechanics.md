# Loop mechanics — termination, workflow, escalation (loop-clarify detail)

Detail for SKILL.md §"Termination contract", §"Workflow", §"Cap-hit escalation
copy", §"Backwards-compat fallback", §"Per-lane counter", and §"JSONL events".
Verbatim from the binding contract
(`../benchmark/plans/v1.4-loop-skill-contracts.md` §"Skill 1").

## Termination contract — verbatim from the binding contract

The challenger (researcher) terminates the loop by emitting `## NO MORE QUESTIONS`
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

The keyword set `/concern|issue|gap|missing|undefined/i` was REMOVED after Codex
review round 2 because it false-positived on legitimate phrasings like "no
concerns remain". Do not re-introduce it.

## Workflow

1. **Initialize.** Read `loops_mode`, `cap`, `run_id` from the orchestrator. The
   L1 cap counter is `counters.json` key `L1` (single global counter for the
   whole brainstorm phase — no lane suffix). Reset on `status="satisfied"`.

2. **Per round, in order:**
   a. Increment `L1` counter via `incrementCounter(runDir, run_id, "L1")`.
   b. Emit `loop_round_start` event via `scripts/emit-loop-event.ts`:
      ```bash
      npx tsx scripts/emit-loop-event.ts \
        --event loop_round_start --layer L1 --lane phase:brainstorm \
        --round <N> --cap <cap> \
        [--run-id <run-id>] [--cwd <repo-root>]
      ```
   c. Dispatch architect (round 1: brief; round N: revised brief incorporating
      round N-1 researcher questions).
   d. Dispatch researcher with the architect's output as the round-input.
   e. Inspect researcher's body with the sentinel detector.
   f. Emit `loop_round_end` event via `scripts/emit-loop-event.ts`:
      ```bash
      npx tsx scripts/emit-loop-event.ts \
        --event loop_round_end --layer L1 --lane phase:brainstorm \
        --round <N> --terminated <satisfied|malformed_termination|cap_hit|escalation|error> \
        --terminator researcher \
        [--run-id <run-id>] [--cwd <repo-root>]
      ```
      Use `satisfied` when the sentinel was clean (researcher emitted
      `## NO MORE QUESTIONS` with a clean post-sentinel region). Use
      `malformed_termination`, `cap_hit`, `escalation`, or `error` for the
      corresponding non-final outcomes.

3. **Decide.**
   - `clean` (sentinel + clean post-sentinel) → return `status: "satisfied"`,
     `next: "guild:brainstorm"`. Reset `L1` counter on the next read.
   - `malformed_termination` → record; if 2 consecutive at this layer → escalate.
   - `no_sentinel` AND round < cap → continue.
   - round == cap AND no clean termination → escalate (cap-hit).

4. **Escalate.** Dispatch `AskUserQuestion` with the binding payload. User's
   choice routes:
   - **`force-pass`** → write `unresolved_questions` to
     `.guild/runs/<run-id>/assumptions.md`, return `status="escalated"`
     (force-pass-as-satisfied), `next: "guild:brainstorm"`.
   - **`extend-cap`** → user supplies N (4/8/16/custom — second AskUserQuestion);
     cap extended; loop continues.
   - **`rework`** → return `status="rework"`, `next: "abort"`.

## Cap-hit escalation copy — exact literals

The orchestrator dispatches `AskUserQuestion` with `header: "Loop escalation"`,
`multiSelect: false`, and exactly three options. Their `label` strings are
verbatim:

- **`force-pass`** — "Accept the artifact as-is; log unresolved questions to assumptions.md; proceed."
- **`extend-cap`** — "Extend the cap by N rounds (you'll be asked for N)."
- **`rework`** — "Abort the current loop; return control to the producing skill with the unresolved questions."

Helper functions in `../benchmark/src/loop-escalation.ts` build the payload
(`buildEscalationPayload`, `buildExtendCapPayload`).

## Backwards-compat fallback

When the host runtime does NOT support `AskUserQuestion` (older Claude Code;
non-interactive `claude --print`), fall back to the v1.3 free-text stdin path:

1. Print to stderr: a numbered list of the three options + their labels.
2. Read one line from stdin.
3. Trim + lowercase; match against the three labels (`force-pass` / `extend-cap`
   / `rework`); reject anything else with a re-prompt.
4. Log the choice to `escalation.user_choice` identically to the AskUserQuestion
   path.

`formatFallbackPrompt(...)` and `parseFallbackChoice(...)` in
`../benchmark/src/loop-escalation.ts` provide the prompt + parser.

## Per-lane counter

L1 has **one cap counter** for the whole brainstorm phase. Counter file
`.guild/runs/<run-id>/counters.json` key `L1`. Resets when control passes to
brainstorm-write-spec (i.e., on `status="satisfied"`).

Restart semantics are NOT applicable to L1 — restart is L3/L4/security-only (see
`guild:loop-implement`). L1 cap-hit escalates directly via the 3-option choice.

## JSONL events emitted

Per `../benchmark/plans/v1.4-jsonl-schema.md` §5/§6/§11:

- `loop_round_start` — per round; `lane_id: "phase:brainstorm"`, `loop_layer: "L1"`.
- `loop_round_end` — per round; same `lane_id`/`loop_layer`/`round_number` pair.
- `escalation` — on cap-hit OR malformed-termination ×2; `reason ∈ {"cap_hit",
  "malformed_termination_x2"}`; `options_offered` is ALWAYS
  `["force-pass", "extend-cap", "rework"]`; `user_choice` records the user's choice.
- `assumption_logged` — on `force-pass` (one event per unresolved question).

JSONL events are appended by `scripts/emit-loop-event.ts` (self-contained;
writes directly to `events.ndjson`). The vendored log lib is at
`hooks/lib/v1.4/log-jsonl.ts`. T3c has landed; `loop-jsonl-stub.ts` is no
longer needed.
