# P3 Audit

Date: 2026-04-24
Result: PASS (gate: passed-with-deferrals)

## Shipped
- 10 new shipping specialists (researcher, devops, qa, mobile, security, technical-writer, social-media, seo, marketing, sales)
- 50 T5 specialist skills (8 eng-core-a + 16 eng-b + 16 content + 8 commercial, + 2 already written in dev)
  - Actually: 10 (architect+backend+researcher) + 16 (devops+qa+mobile+security) + 16 (content) + 8 (commercial) = 50
- Cross-specialist boundary-collision evals: 61 cases across 15 axes
- 2 adjacent-boundary update passes on existing P1 specialists (architect, backend, copywriter)

## Review history
- Mid-phase group review on 13-specialist roster found 2 Important DNT completeness gaps (qa/devops missing researcher). Fixed in 8aa2f6a.
- Gate check caught copywriter.md description over 1024 chars (regression from adjacent-boundary updates). Fixed in d490b3f, gate re-verified PASS.
- Lesson learned: automated invariant pre-flight should be part of mid-phase review, not just gate.

## Cumulative repo state on main after merge
- 62 skills total (T1=1 principles + T2=8 spine+decisions + T3=3 wiki + T5=50 specialists)
- 13 shipping specialists — full roster
- 2 commands (/guild, /guild:wiki)
- Evals: trigger (meta+core+boundary) + wiki-lint fixtures (9 scenarios)
- 4 phase gates closed (P0, P1, P2, P3)

## Open followups into P4+
- P4 — agent-team backend + hooks: TaskCreated/TaskCompleted/TeammateIdle handlers, /guild:team edit --allow-larger
- Invariant pre-commit hook (catches description-length drift at commit time, not gate time)
- Boundary-eval runner (P6 tooling-engineer harness consumes tests/boundary/evals.json)
- Live /guild:team propose dogfood (§14 P3 25-spec test, needs team-compose to execute)
- Web-frontend specialist gap (flagged by backend.md, mobile.md, seo.md — deferred)
