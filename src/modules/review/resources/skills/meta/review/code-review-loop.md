# Fresh-context code-review loop — request & response

Detail for `guild:review`'s `## Code-review request & response`. This is Guild's discipline for soliciting a review and acting on one. Guild's adversarial loop layers (`guild:loop-implement` L3/L4) and the cross-model gate (`guild:codex-review`) invoke this discipline; a specialist lane uses it directly before its handoff receipt is trusted into the two-stage review.

## Requesting a review

Dispatch a **fresh reviewer with precisely crafted context — never your session history** — so it evaluates the work product, not your thought process, and your own context stays free for continued work. Use the prompt template at `code-reviewer.md` in this directory, filling: what was implemented, what it should do (plan/requirements), the base and head SHAs, and a one-line summary.

```bash
BASE_SHA=$(git rev-parse HEAD~1)   # or the lane's start commit / origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

Request a review after each lane/task (subagent-driven), after each batch when executing a plan, and before integration. Don't skip it "because it's simple". Classify returned findings as **Critical / Important / Minor**.

## Responding to findings

A finding is a signal — not an order, not an insult. The two failure modes to avoid are reflexively accepting a wrong finding and pushing back with anything other than technical reasoning. Triage each finding:

| Class | Action |
|---|---|
| Correct — Critical | Fix immediately, before any other finding. |
| Correct — Important | Fix before declaring the lane done. |
| Correct — Minor | Fix now if cheap; otherwise record a tracked `followup:`. |
| Wrong / misread | Push back **with technical evidence** — the failing/passing test, the spec clause, the contract pointer, or the code path the finding missed. |
| Ambiguous | Ask one focused clarifying question; do not guess. |

Push back **only** with technical reasoning. "It works on my machine", "I'm sure it's fine", seniority, urgency, or "this is taking too long" are not rebuttals — apply the fix. State a valid rebuttal once, with evidence; do not re-litigate a finding the reviewer already answered. After acting, re-run the spec's defined checks and summarize per finding — accepted-and-fixed / pushed-back-with-evidence / tracked-as-followup. That summary is what the lane's handoff receipt carries into the two-stage review.
