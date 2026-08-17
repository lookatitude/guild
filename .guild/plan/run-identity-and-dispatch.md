---
type: plan
spec: ../../../.guild/initiatives/active/run-identity-and-dispatch/initiative.yaml
team: .guild/team/run-identity-and-dispatch.build.yaml
backend: agent-team
run_id: run-20260811-010758-run-identity-and-dispatch
proposal_hash: 8ec42d0eb6851c541077bfb746c9a9d59926b3693c09f2a373c3221144ab4ce6
decision_hash: b870f0cf70fed5239195f23b80e616221cedad72843245dbf7ce5f0e52064e9a
created_at: 2026-08-11
approved: true
approved_at: 2026-08-11T00:54:50Z
approval_source: "user:miguelp@interactive_prompt"
---

# Plan: run identity and dispatch convergence — W4/W5

This build pass closes the remaining W4/W5 implementation boundaries in the
current dirty worktree. Existing edits are inputs to audit, not evidence of
completion. The lane must preserve unrelated user work and must not commit.

## Lane: tooling engineer

- task-id: W4-W5-tooling-completion
- owner: tooling-engineer
- depends-on: []
- complexity_score: 4
- tier: powerful
- scope: Audit and complete the first-class cmux backend/run-start snapshot boundary and the deterministic minimum shareable-run validation boundary, including packaged resource parity and executable CLI proof.
- success-criteria:
  - Run-start resolution freezes the selected backend and capability facts; cmux is represented as a first-class backend value rather than a disguised tmux branch.
  - Task-run, scope, trace, receipt, lifecycle, and visible non-focus-stealing surface obligations are covered by executable tests; unavailable live cmux proof is reported as pending rather than fabricated.
  - Share eligibility requires a canonical run name, `run.yaml`, `provenance.json`, `logs/v1.4-events.jsonl`, and at least one valid lane handoff.
  - Non-run document dumps under `.guild/runs/` are rejected without misclassifying lifecycle-owned artifacts.
  - A real CLI emits machine-readable findings, exits non-zero for invalid candidates, and has module-resource packaging parity.
  - Focused and integration tests pass, with exact commands and counts in the handoff.
- autonomy-policy:
  - may act without asking: inspect and edit W4/W5-owned TypeScript, tests, scripts, and module-resource mirrors; run focused tests and safe generation checks.
  - requires confirmation: dependency additions, scope expansion beyond W4/W5, or changes that would overwrite unrelated user work.
  - forbidden: commit, push, publish, mark live cmux proof complete without a real cmux session, edit `docs/v2/**`, or approve its own handoff.

## Review gate

After the worker handoff, the approved `plugin-architect` cross-family reviewer
must independently inspect live source, packaged resources, executable paths,
and the outstanding live-cmux evidence boundary before integration is accepted.

## Lane: plugin architect independent review

- task-id: W4-W5-independent-review
- owner: plugin-architect
- depends-on: [W4-W5-tooling-completion]
- complexity_score: 4
- tier: powerful
- scope: Read-only, fresh-context production-readiness review of Fixes A-C, W4,
  and W5 against the approved plan, exact tooling handoff, live source, generated
  module resources, executable paths, active-host close recovery, and the honest
  live-cmux evidence boundary.
- success-criteria:
  - Stage 1 explicitly evaluates scope, autonomy, and blocking followups.
  - Stage 2 verifies the receipt claims with live file:line evidence and focused
    commands rather than trusting summaries.
  - Every finding is classified Critical, Important, or Minor and the reviewer
    gives an unambiguous integrate verdict.
  - The reviewer makes no implementation edits and writes the assigned handoff.
- autonomy-policy:
  - may act without asking: inspect files, diffs, run records, mirrors, and execute
    read-only tests or validators.
  - requires confirmation: any write or scope expansion.
  - forbidden: edit implementation, tests, docs, lifecycle state, or approve its
    own findings as resolved.
