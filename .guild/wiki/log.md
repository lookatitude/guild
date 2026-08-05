# Guild Wiki Log

## 2026-07-25
- decided docs-v2-reconciliation-verifies-shipped-code (v23x-deferred-followups close; D8 docs leg reconciles to merged code, not brief intent — 3 of ~10 callouts needed partial flips)
- reflected run-305333a3 (v23x-deferred-followups: closed the run-37739fa5 followup_backlog; predecessor's 3 execute-plan/codex-review proposals landed and held; 4 re-deferrals filed as #91–#94)

## 2026-07-13
- decided g-series-learn-clis-on-demand-only

## 2026-06-18
- decided v2-final-design-and-doc-artifact-boundary

## 2026-06-17
- decided telemetry-anchors-to-repo-root-not-cwd
- decided universal-host-p2-p3-wave-sequencing

## 2026-05-02

- decided guild-diagnose-self-fix-command
- decided codex-review-user-facing-opt-in
- decided run-scoped-telemetry-and-loop-events
- decided benchmark-import-and-fixture-artifact-policy
- decided archived-phase-gates-remain-historical
- decided emit-loop-event-self-contained
- decided two-audit-schemas
- standard shell-hook-json-parsing


## [2026-06-17] decided wave3-producer-skill-additive


## [2026-07-14] decided task-cell-runtime-contract
- decided task-cell-runtime-contract (freeze record for the task-cell-runtime initiative; G1/P0.1 truth reconciliation of docs/v2/dispatch-execution.md §5)


## [2026-07-25] standard host-distribution-matrix
- standard host-distribution-matrix (xhrd-wi-01 / cross-host-release-distribution G1; Codex already supports git-marketplace distribution — `codex plugin marketplace add lookatitude/guild --ref main` installs 2.3.2 today. install.sh registers a `local` path into a gitignored dist/ instead, freezing every host. Draft-1 claim "no Codex update path exists" refuted by codex adversarial review and corrected.)


## [2026-08-05] decided stacked-prs-for-dependent-lanes
- decided stacked-prs-for-dependent-lanes (v23x-deferred-followups close: dependent lanes stack PRs on the base lane's branch; the lead summary carries the binding merge order; regenerate — don't hand-resolve — generated-file conflicts between merges)


## [2026-08-05] decided skill-surface-lane-serialization
- decided skill-surface-lane-serialization (v23x-deferred-followups close: whole-tree RATIFIED_TREES pins make concurrent skill-surface lanes collide by construction — one surface lane live at a time, surface PRs merge consecutively, later PR re-ratifies pins from the merged tree)
