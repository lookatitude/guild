# Workflow, escalation copy, fallback, JSONL events (loop-implement detail)

Detail for SKILL.md §"Workflow", §"Cap-hit / restart-cap-hit escalation copy",
§"Backwards-compat fallback", and §"JSONL events emitted".

## Workflow

For each lane the orchestrator dispatches with `loops_applicable ≠ "none"`:

1. **Resolve layer set.** `activeLayersFor(loops_applicable)` returns the ordered
   list of layers to run (`["L3"]`, `["L4"]`, `["L3","L4"]`, or
   `["L3","L4","security-review"]`).

2. **Per layer, in order:**
   - For each round (1..cap):
     - Increment `<layer>:<lane_id>` counter (or `security:<lane_id>` for
       security-review).
     - Emit `loop_round_start` event via `scripts/emit-loop-event.ts`:
       ```bash
       npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/emit-loop-event.ts \
         --event loop_round_start --layer <L3|L4|security-review> \
         --lane <lane-id> --round <N> --cap <cap> \
         [--run-id <run-id>] [--cwd <repo-root>]
       ```
     - Dispatch the lane owner with the prior round's challenger output (or the
       initial deliverable for round 1).
     - Dispatch the layer's challenger (`qa-property-based-tests` / `qa` /
       `security`).
     - Inspect the challenger's body with `detectSentinel(...)`.
     - Emit `loop_round_end` event via `scripts/emit-loop-event.ts`:
       ```bash
       npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/emit-loop-event.ts \
         --event loop_round_end --layer <L3|L4|security-review> \
         --lane <lane-id> --round <N> \
         --terminated <satisfied|malformed_termination|cap_hit|escalation|error> \
         --terminator <challenger-specialist> \
         [--run-id <run-id>] [--cwd <repo-root>]
       ```
       Use `satisfied` only when the sentinel was clean; use the corresponding
       enum for cap-hit, malformed-termination, escalation, or runtime error.
     - Decide: clean → exit layer; malformed → record (escalate on 2 consecutive);
       no-sentinel + round < cap → continue; cap exhausted → escalate cap-hit.

3. **After security-review layer completes cleanly:**
   - Parse findings via `parseSecurityFindings(security_body)`.
   - If `shouldRestartFromSecurity(parse)` → restart machinery (move receipts,
     reset counters, increment `restart:<lane>`, re-run from L3); cap on
     `restart_count >= restart_cap` → escalate `restart_cap_hit`. (See
     `security-review-restart.md`.)
   - If parse is `malformed_bullet` → emit `assumption_logged` with the literal
     text `Malformed security finding bullet — treated as no-restart; lane
     <lane_id>; round <N>`; proceed without restart.
   - Otherwise (no findings, or findings all medium/low/already-addressed) → log
     findings as `assumption_logged` and exit cleanly.

4. **Return** `LoopImplementOutput` to the orchestrator. On `status="satisfied"`,
   `next: "next-lane"`. On `rework`, `next: "abort"`.

## Cap-hit / restart-cap-hit escalation copy — exact literals

Escalations fire at five sites:

- L3 cap-hit.
- L4 cap-hit.
- security-review cap-hit.
- Two consecutive malformed-terminations at any layer.
- Restart-cap-hit (4th security restart attempt).

At every site the orchestrator dispatches `AskUserQuestion` with
`header: "Loop escalation"`, `multiSelect: false`, and exactly three options. The
`label` strings are verbatim:

- **`force-pass`** — "Accept the artifact as-is; log unresolved questions to assumptions.md; proceed."
- **`extend-cap`** — "Extend the cap by N rounds (you'll be asked for N)."
- **`rework`** — "Abort the current loop; return control to the producing skill with the unresolved questions."

`buildEscalationPayload(...)` in `../benchmark/src/loop-escalation.ts` builds
the payload.

## Backwards-compat fallback

When `AskUserQuestion` is unavailable, fall back to the v1.3 free-text stdin path:

1. Print three options to stderr (numbered list + literal labels).
2. Read one line from stdin.
3. Trim + lowercase; match against `force-pass` / `extend-cap` / `rework`; reject
   otherwise with re-prompt.
4. Log the choice to `escalation.user_choice` identically.

Tests pin both branches at every escalation site.

## JSONL events emitted

Per `../benchmark/plans/v1.4-jsonl-schema.md`:

- `loop_round_start` — per round per layer per lane.
- `loop_round_end` — per round per layer per lane.
- `escalation` — at every escalation site; `options_offered` is ALWAYS
  `["force-pass", "extend-cap", "rework"]`.
- `assumption_logged` — on `force-pass`, on malformed security finding bullets,
  on no-restart-but-logged findings.

JSONL events are appended by `scripts/emit-loop-event.ts` (self-contained;
writes directly to `events.ndjson`). The vendored log lib is at
`hooks/lib/v1.4/log-jsonl.ts`. T3c has landed; `loop-jsonl-stub.ts` is no
longer needed.
