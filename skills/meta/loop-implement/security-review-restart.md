# Termination + restart-from-security (loop-implement detail)

Detail for SKILL.md §"Termination contract per layer", §"Restart-from-security",
and §"Restart cap = 3". Verbatim from the binding contract
(`guild-benchmark/plans/v1.4-loop-skill-contracts.md` §"Skill 3").

## Termination contract per layer

Each active layer terminates independently when its challenger emits
`## NO MORE QUESTIONS` on its own line with a clean post-sentinel region:

- L3: tester (`qa-property-based-tests`) emits sentinel.
- L4: qa (full strategy) emits sentinel.
- security-review: security emits sentinel WITHOUT a high+unaddressed finding
  (with such a finding, restart fires).

The post-sentinel regex set is identical to L1/L2. Run all three against the
substring AFTER the sentinel line; any match → `loop_round_end.terminated =
"malformed_termination"` and the loop continues one extra round.

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

Security's terminating receipt contains the sentinel `## NO MORE QUESTIONS` AND
an OPTIONAL findings section ABOVE the sentinel, matched by:

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
- `description` is free text; redaction applies before the receipt hits disk.

### Restart trigger condition (binding)

`loop-implement` parses every finding entry. **Restart fires iff ANY single
finding has `severity: high` AND `addressed_by_owner: false`.** Lower-severity
findings, or findings the owner marked addressed, do NOT trigger a restart on
their own; they are recorded in the audit trail (`assumption_logged` events) but
the loop proceeds.

Tests pin:

- `severity: high` + `addressed_by_owner: false` → restart fires.
- `severity: high` + `addressed_by_owner: true` → no restart; finding logged.
- `severity: medium` / `low` (any addressed value) → no restart; finding logged.
- Findings section absent or no matching bullets → no findings; no restart.
- Malformed bullet (missing `severity` or `addressed_by_owner`) → log
  `assumption_logged` with literal text `Malformed security finding bullet —
  treated as no-restart; lane <lane_id>; round <N>` and proceed without restart.
  (Defends against typos blocking the lane forever.)

The older draft used a `BLOCKING:` literal marker; that is NOT what the parser
detects. The parser keys on the `## Findings|Open issues|Blockers` heading +
YAML bullet fields. Test fixtures must use the YAML-bullet format.

## On restart fire

1. **Move prior receipts.** L3 + L4 + security-review receipts for this lane move
   to `.guild/runs/<run-id>/handoffs/superseded/<lane_id>-restart-<N>/` (where
   `<N>` is the post-increment restart counter, starting at 1).
2. **Cross-reference.** Each prior receipt gains a frontmatter field
   `superseded_by: <new-receipt-path>` (relative path). This cross-reference is
   the audit trail; `summary.md` regen reads both old and new chains.
   `injectSupersededBy(...)` in `guild-benchmark/src/loop-implement-restart.ts`
   is the pure transform.
3. **Reset L3/L4/security counters for this lane.** Per spec §"Cap reset
   boundaries", a security restart resets L3/L4/security counters to 0 for this
   lane. Does NOT affect other lanes (per-lane isolation). Use
   `resetLaneCounters(runDir, run_id, laneId)` from `counter-store.ts`; T3a's
   contract preserves the `restart:<lane>` counter across this call.
4. **Increment restart counter.** `counters.json` key `restart:<lane>`
   incremented by 1. **Restart cap = 3** per lane per task — the 4th restart
   triggers escalation.
5. **New context bundle.** The restarted lane's input bundle includes the
   security findings verbatim, plus pointers to the superseded receipts.
6. **Per-lane counter isolation.** Lane A's restart does NOT affect lane B's
   counters. Parallel lanes run independently. Tests pin a
   2-lane-A-restarts-B-continues case.

## Restart cap = 3

The literal restart-cap default is **`cap = 3`** per lane per task. Configurable
only via plan-level override (per-lane), not via a global env var (per spec —
"no global state for restarts"). On restart-cap-hit (4th restart attempt),
escalate to the user with the standardized 3-option choice:

- **`force-pass`** → log security findings to
  `.guild/runs/<run-id>/assumptions.md`, return `status="restart_cap_hit"` with
  the lane marked force-passed-with-findings.
- **`extend-cap`** → user supplies N (additional restart attempts); `restart_cap`
  extended by N; loop re-attempts.
- **`rework`** → return `status="rework"`. Orchestrator routes to user-decision
  (out of skill scope).
