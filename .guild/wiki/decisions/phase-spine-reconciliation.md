---
type: decision
owner: architect
confidence: high
importance: high
source_refs: [".guild/runs/v2-final/DECISIONS-LOCKED.md#L43-L48", ".guild/runs/v2-final/20-design-dossier.md#L128-L184", ".guild/runs/v2-final/20-design-dossier.md#L225-L278"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [lifecycle-overview, phase-entrypoints, workflow-operating-model, v2-scope-and-risk-g1-g8]
---

# ADR: Phase / spine / initiative reconciliation — the v2 headline

## Status

Accepted (2026-05-17). This reconciliation IS the headline of v2.

## Context

Three models had to become one coherent shipped architecture:

1. the shipped 7-step linear spine (`guild-plan.md §8`),
2. the designed 6-phase entrypoint model (`lifecycle-overview.md`),
3. the unshipped opt-in initiative layer
   (`initiative-lifecycle-and-release-doc-sync.md`).

## Decision

**One state machine, six phase entrypoints, three lenses (linear / phase /
initiative).** This exact phrase is used once prominently in
`lifecycle-overview.md` and is not re-invented elsewhere.

- The 7-step spine is **re-homed**, not deleted: its stations live inside the
  six phases. Both prose forms ("one machine, three lenses" / "one spine, six
  labelled stations, any-station entry") are equivalent.
- Phases: Init / Ideation / Planning / Development / Quality / Operations
  (phase *concept* names in prose; command *verbs*
  `init ideate plan build qa ops` in command context).
- Backward-then-forward prerequisite resolver: a phase entered without its
  upstream artifact backward-resolves or asks — never fabricates.
- Canonical `.guild/` tree per dossier §1.3 (single source of truth):
  `task_run` at `.guild/runs/<run-id>/task-runs/<task-id>.yaml`; canonical
  trace at `.guild/runs/<run-id>/logs/v1.4-events.jsonl` (`events.ndjson` is a
  legacy compat mirror only).
- Initiatives are an OPT-IN third lens (G4); one-off runs are first-class and
  create no initiative directory.

## Consequences

- `guild-plan.md` becomes the frozen v1 record with a `supersedes:` pointer to
  `lifecycle-overview.md`.
- `lifecycle-overview.md` becomes the single lifecycle truth (embeds diagram
  D-12, the reconciled state machine).
- All docs use the §1.3 canonical paths verbatim; no path drift.
