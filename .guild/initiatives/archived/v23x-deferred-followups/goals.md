# v23x-deferred-followups — goals

Created 2026-07-23. Source: the declared-deferred backlog of the v2.3.0/v2.3.1
waves — every item below was shipped AS deferred in a lane receipt and echoed in
docs/v2 "deferred" callouts. Origin lane cited per item.

## G1 · rf-wi-01 — config-surface registration (origin: oir-wi-54/57, rth via #70)
`defaults.lean_lead.*`, `defaults.lifecycle_gate.*`, `host_mode` are read
tolerantly but unregistered — invisible to `guild:config validate/set/resolve/
show --sources`, unvalidated, undiscoverable. Register through the canonical
closed schema (scripts/lib/core/config-cli.ts + config-cmd.ts + CONFIG_UI_METADATA),
replace the guards' direct reads with resolved-config reads, render checks for
the 16 host shapes. The #54 lane explicitly reverted an ad-hoc security.host_mode
key because it bypassed this schema — this goal is the sanctioned version.

## G2 · rf-wi-02 — sink consumers (origin: oir-wi-56/60, rth-wi-76)
`logs/backend-degradation.jsonl` + `logs/tier-dispatch.jsonl` have zero readers:
verify-done/reflect must surface degradations and un-tiered dispatches in
verify.md/reflections (a run with silent downgrades becomes visibly dirty);
guild-telemetry MCP `trace_summary` gains `dispatched_lanes`/`dispatch_receipts`
parity with trace-summarize.ts.

## G3 · rf-wi-03 — tier-env producer + structured dispatch marker (origin: oir-wi-60/56)
execute-plan/composeInProcessDispatch never set `GUILD_TIER`/`GUILD_TIER_SCORE`,
so tier receipts cap at `model_present`; prompt-only lane drift is recorded, not
blocked, because nothing structural marks a producer dispatch. Set the env on
every scored dispatch; add the structured producer marker (the
composeInProcessDispatch descriptor work oir-wi-56 queued behind); upgrade the
backend guard's prompt-only rung to blockable once the marker is universal.

## G4 · rf-wi-04 — remote + codex pane enforcement preconditions (origin: oir-wi-54, rth-wi-76)
Remote/SSH and codex panes still launch bare — CORRECTLY, because their
guardrail preconditions don't hold. Land the preconditions: RemoteTeamBackend
preflight verifies Guild hooks are installed on the far host; teardown is
confirmed (kill-session verdict — spawn-fail+teardown-fail may currently leave
a live remote lane no receipt describes); THEN extend the resolved
permission-mode flags to remote Claude panes. Codex panes: document/implement
the codex-side enforcement precondition before any bypass flag; if
codex-side PreToolUse enforcement is not feasible this wave, ship the explicit
refusal rationale in code comments + docs instead of silence.

## G5 · rf-wi-05 — lifecycle/run-state hygiene (origin: oir-wi-58/00/59)
(a) `current-run-id` sentinel not cleared at run close — guards stay armed
after a run ends; clearing belongs to run-lifecycle.ts. (b) `run.yaml gates:`
has no writer — the re-anchor header's next-gate refinement never activates;
emit gate outcomes at review/verify boundaries. (c) PreCompact
`newCustomInstructions` IS consumed by the compaction path — use it as the
second channel to shape the post-compact summary. **[SUPERSEDED 2026-08-06 by
issue #139]** — this premise was wrong. Live verification on Claude Code 2.1.223
showed PreCompact REJECTS the `hookSpecificOutput` envelope entirely (hook marked
FAILED, stdout discarded); the consumed channel is a succeeded hook's raw plain-
text stdout. Corrected in `hooks/pre-compact.ts` — historical text kept as-is
above for provenance. (d) PreToolUse per-tool
lifecycle enforcement — the UserPromptSubmit gate bounds turns, not tools; add
the per-tool bound wi-59 declared as the real limit on a single agentic turn.

## G6 · rf-wi-06 — execute-plan surface lane (origin: rth-wi-76 + reflection proposals)
The ONE lane touching the pinned skill surface — serialize it, and it MUST do
the registry re-extraction + RATIFIED_TREES re-ratification in-commit:
(a) wire the cmux dispatch-receipt CLI into execute-plan SKILL.md (removes the
manual-lead-invocation limitation documented in docs/v2); (b) codify the
skills/commands surface-change checklist as deterministic lane-runnable code
(the miss recurred 3/4 lanes even with steering); (c) receipt contract requires
the guild.handoff.v2 envelope (shape-validated by the lifecycle-gate close
backstop, not just existence); (d) codex-review contract names the two cap
terminal states ("cap + reasoned pushback recorded", "verification-only round
beyond cap").

## G7 · rf-wi-07 — small cleanups (origin: rth-wi-75/73, oir-wi-58)
(a) scripts/ pins js-yaml 4.1.1, hooks/ pins 4.3.0 — harmless post-pinning,
reconcile to one version; (b) trace-summarize buildSpecialistActivity +
slow-call detectors still gate on `event.event === "PostToolUse"` (undercounts
canonical runs) and buildNotableEvents prints `digest: undefined` for canonical
events; (c) drop the legacy 300-char producer-head parsing in
dispatch-attribution once all producers emit the line-1 marker (G3 makes it
universal — sequence after).

## Close criteria (D8)
All 7 goals merged to next with red-first regression evidence + codex review;
released in the next version; docs/v2 "deferred" callouts flipped to shipped in
the same rollout (observability, dispatch-execution, config-surfaces pages) —
the docs leg is NOT n/a for this initiative by construction.
