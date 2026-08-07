# Definition ledger — v23x-deferred-followups

```yaml
items:
  - id: rf-def-goal
    initiative_id: v23x-deferred-followups
    category: goal
    statement: "Close the declared-deferred backlog of v2.3.0/v2.3.1 (18 receipt-sourced items grouped into 7 goals) so no 'deferred' callout in docs/v2 outlives this initiative."
    status: defined
    blocking: true
    evidence_refs: [".guild/reflections/run-37739fa5-014f-4ab9-8fe5-ea50cfa4fb2f.md"]
    updated_at: "2026-07-23T00:12:31Z"
  - id: rf-def-outcome
    initiative_id: v23x-deferred-followups
    category: outcome
    statement: "Guards read registered config; sinks have consumers; tier receipts reach scored_compliant; prompt-only drift is blockable; remote panes get flags only behind verified preconditions; run-state hygiene holds; the execute-plan surface carries the cmux wiring + checklist-as-code + envelope contract."
    status: defined
    blocking: true
    updated_at: "2026-07-23T00:12:31Z"
  - id: rf-def-scope
    initiative_id: v23x-deferred-followups
    category: scope
    statement: "Plugin repo: config schema surfaces, verify-done/reflect skills + MCP telemetry server, dispatch compose/launcher paths, hooks run-lifecycle/pre-compact/pre-tool-use, execute-plan skill surface (one serialized lane), version/dep cleanups. Umbrella docs/v2 deferred-callout flips at close."
    status: defined
    blocking: true
    updated_at: "2026-07-23T00:12:31Z"
  - id: rf-def-nongoal
    initiative_id: v23x-deferred-followups
    category: non_goal
    statement: "No new drift guards or trace schemas beyond the declared items; no codex-pane bypass without its enforcement precondition (shipping the documented refusal is an acceptable G4 outcome); no cross-run evolve-pipeline promotions (G6 folds the 3 reflection proposals by operator decision, not by threshold)."
    status: defined
    blocking: true
    updated_at: "2026-07-23T00:12:31Z"
  - id: rf-def-acceptance
    initiative_id: v23x-deferred-followups
    category: acceptance
    statement: "Per-goal acceptance in goals.md/work items; red-first regression evidence per defect-shaped item; enforcement as deterministic code; G6 does registry re-extraction + pin re-ratification in-commit; codex RAN per lane; docs/v2 deferred callouts flipped in-rollout."
    status: defined
    blocking: true
    updated_at: "2026-07-23T00:12:31Z"
  - id: rf-def-constraint
    initiative_id: v23x-deferred-followups
    category: constraint
    statement: "Branch from next, PR to next; hooks rebuild + sync-module-resources (never bare sync-live-resources after a rebuild); G6 serialized (pin churn); G3 before G7c and ideally before G2's tier-fidelity checks; frozen v1.4 vocabulary stays additive-only."
    status: defined
    blocking: true
    updated_at: "2026-07-23T00:12:31Z"
  - id: rf-def-risk
    initiative_id: v23x-deferred-followups
    category: risk
    statement: "G4 widens native autonomy on remote panes — gate strictly behind verified hook installation + teardown confirmation, warn-first rollout. G3's marker must not break the byte-compat of existing dispatch shapes (additive env/prompt-prefix only). G5d per-tool enforcement risks false-positives on legitimate lead tool use — warn-first, threshold from real run data. Rollback: independent PRs."
    status: defined
    blocking: true
    updated_at: "2026-07-23T00:12:31Z"
  - id: rf-def-oq-codex-enforcement
    initiative_id: v23x-deferred-followups
    category: open_question
    statement: "Whether codex-side PreToolUse-equivalent enforcement is implementable this wave (G4) or the documented-refusal path ships instead — resolve during G4 design."
    status: needs_definition
    blocking: false
    updated_at: "2026-07-23T00:12:31Z"
  - id: rf-def-oq-pertool-design
    initiative_id: v23x-deferred-followups
    category: open_question
    statement: "G5d per-tool enforcement design: PreToolUse counter vs Stop-hook budget vs both — resolve in-lane with real run-trace data."
    status: needs_definition
    blocking: false
    updated_at: "2026-07-23T00:12:31Z"
```

`blockingUnresolved` over these rows is empty ⇒ definition-ready.
