---
type: decision
status: accepted
owner: plugin-architect
confidence: high
importance: medium
applies_to: [plugin]
decision_id: v3co-D1-learn-bare-route
initiative: v3-carryover
source_refs:
  - "plugin src/domains/knowledge/learn-route.ts (routeLearn, classifyLearnTarget, learnRouteFor)"
  - "plugin scripts/learn/learn-route.ts (CLI, compiled to runtime/scripts/learn-route.js)"
  - "plugin src/domains/knowledge/learn-route.test.ts"
  - "plugin scripts/learn/learn-route.test.ts"
  - "plugin commands/learn.md §Dispatch"
  - "plugin skills/knowledge/learn/SKILL.md §Route"
  - "plugin .guild/artifacts/reports/v3-legacy-G10.html row 7"
created_at: 2026-10-19
updated_at: 2026-10-19
expires_at: null
sensitivity: internal
---

# The bare `/guild:learn` route is a pure knowledge-domain function

`/guild:learn` picks its route in code. `routeLearn` in the knowledge domain
takes the workspace-detect facts plus the command's tokens and returns one
closed `route`: `full_learn`, `cheap_map_only`, `workspace_full_learn`,
`workspace_plan_only`, `confirm_target`, `chapter`, or `usage`. The command and
the learn skill run `runtime/scripts/learn-route.js` and follow its JSON; the
skill prose describes each route and does not decide.

The mapping is the one the skill already documented: brownfield
(`regular_project`, `existing_guild_project`) reaches the full pipeline with
K1–K6 after the OQ1 gate; `new_or_sparse_project` runs the cheap map only; a
workspace runs its fan-out flow with K1–K6 deferred, or plan-only under
`learn_fanout: plan-only` / `--dry-run`; `mixed_or_uncertain` asks one
question; each of the six sub-verbs loads its chapter; any other token prints
usage. A root with neither `.git/` nor `.guild/` and more than five files fits
no documented shape and routes to `confirm_target`.

The router lives in the learn code, not in `classify-intake`
(`src/domains/lifecycle`), which this decision leaves untouched. This closes
G10 row 7: the brownfield route now has executed tests, including a planted
wrong mapping that the same oracle rejects.
