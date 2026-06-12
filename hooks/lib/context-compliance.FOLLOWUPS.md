# context-compliance — tracked follow-ups

Spawned from the `/guild:evolve guild:execute-plan` run (verdict: REJECTED —
no content gap; root cause was a *compliance* gap, enforced by the
`context-compliance` hook in this directory). These are the **known scope
boundaries** of that hook, tracked here so they are committed artifacts, not
just commit-message prose. Codex G-lane `glane-context-compliance-hook.md`
BLOCKER 2 requires this to exist.

## FU-1 — model-driven dispatch path parity (skill / tooling — NOT hooks)

**Gap.** The enforcement is wired into the **`TaskCompleted` agent-team
handler** (`hooks/agent-team/task-completed.ts`), which fires on the **team
backend only**. That backend is where all three motivating reflection runs
ran (tmux is primary on this machine), so the *observed* `no-assemble` gap is
100% covered. But the **model-driven path** (`subagent` / in-process `agent`
dispatch) has **no agent-team lane hook**, so a lane completed there is not
checked and emits no `context_mode` marker.

**Fix (owner: skill-author + tooling-engineer, not hook-engineer).**
`guild:execute-plan`'s model-driven lane-completion seam — where it already
emits agent-bus events (`SKILL.md §"Agent-bus event log"`, line ~221) — should
call the exported `evaluateContextCompliance` + `recordContextCompliance`
from `hooks/lib/context-compliance.ts` so the two backends reach parity. The
lib is exported and backend-agnostic; it needs only `(runDir, runId,
specialist, taskId)`.

**Acceptance.** A model-driven build run with a MISSING lane records
`context_mode=MISSING` to `context-compliance.jsonl` + the v1.4 `hook_event`
path, identical to the team-backend path.

## FU-2 — reflect / trace-summarize reads `context_mode` (skill / tooling)

**Gap.** The recurring `all-lanes/no-assemble` reflection signal was a *null*
gap (no telemetry could distinguish valid inlining from a skipped contract).
The hook now emits `context_mode: assemble | inline | MISSING`. `guild:reflect`
/ `scripts/trace-summarize.ts` should READ that field (from
`context-compliance.jsonl` or by filtering the v1.4 `hook_event` for
`context_mode=`) and stop re-flagging `context_mode=inline` lanes as a defect
— only `MISSING` is a real violation.

**Acceptance.** A run with only `inline` lanes does not produce a
`no-assemble` skill-improvement proposal; a run with a `MISSING` lane does.
